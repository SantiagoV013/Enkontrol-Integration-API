import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { loadConfig } from './config.mjs';
import { CrmModule } from './crm.mjs';
import { JobStore } from './store.mjs';
import { EnkontrolAdapter } from './erp.mjs';
import { IntegrationService } from './service.mjs';
import { createApi } from './http.mjs';

const clients = [];
let server, timer, inFlight, stopping = false;
try {
  const config = await loadConfig();
  async function mongo(uri) {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, socketTimeoutMS: 30000, maxPoolSize: 5 });
    clients.push(client); await client.connect(); return client;
  }
  const hub = (await mongo(config.hubUri)).db(config.hubDb);
  const modules = new Map();
  for (const app of config.apps) modules.set(app.id, new CrmModule((await mongo(app.mongoUri)).db(app.mongoDb), app));
  const store = new JobStore(hub);
  await store.init();
  const erp = new EnkontrolAdapter(config.erp);
  if (config.mode === 'live') await erp.inspect();
  const service = new IntegrationService({ apps: config.apps, modules, store, erp, mode: config.mode });
  // Single active service instance. Durable owner lease prevents two processes from
  // capturing older snapshots over newer ones. No automatic takeover while running.
  const owner = randomUUID();
  const locks = hub.collection('service_locks');
  const now = new Date();
  try {
    const lock = await locks.findOneAndUpdate({ _id: 'worker', expiresAt: { $lte: now } },
      { $set: { owner, expiresAt: new Date(Date.now() + 300000) } }, { upsert: true, returnDocument: 'after' });
    if (!lock) throw new Error('Service already running');
  } catch { throw new Error('Another integration instance owns the worker lease'); }
  const ready = async () => {
    try { await hub.command({ ping: 1 }); for (const module of modules.values()) await module.db.command({ ping: 1 }); return true; }
    catch { return false; }
  };
  server = createApi({ config, service, store, modules, erp, ready });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
  console.log(JSON.stringify({ event: 'started', port: config.port, mode: config.mode, apps: config.apps.map(a => a.id) }));
  async function cycle() {
    if (stopping) return;
    try {
      const renewed = await locks.updateOne({ _id: 'worker', owner, expiresAt: { $gt: new Date() } },
        { $set: { expiresAt: new Date(Date.now() + 300000) } });
      if (!renewed.matchedCount) throw new Error('LEASE_LOST');
      for (const app of config.apps) {
        try { await service.tick(app); }
        catch { console.error(JSON.stringify({ event: 'poll_failed', appId: app.id })); }
      }
    } catch { process.exit(1); }
    if (!stopping) timer = setTimeout(() => { inFlight = cycle(); }, config.pollSeconds * 1000);
  }
  // Heartbeat runs independently from potentially long source scans.
  const heartbeat = setInterval(async () => {
    try {
      const result = await locks.updateOne({ _id: 'worker', owner, expiresAt: { $gt: new Date() } },
        { $set: { expiresAt: new Date(Date.now() + 300000) } });
      if (!result.matchedCount) process.exit(1);
    } catch { process.exit(1); }
  }, 30000);
  inFlight = cycle();
  async function shutdown() {
    if (stopping) return;
    stopping = true; clearTimeout(timer); clearInterval(heartbeat);
    const deadline = setTimeout(() => process.exit(1), 40000);
    await new Promise(resolve => server.close(resolve));
    await inFlight;
    await locks.deleteOne({ _id: 'worker', owner });
    await Promise.allSettled(clients.map(c => c.close()));
    clearTimeout(deadline);
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch {
  console.error('STARTUP_FAILED: check configuration, MongoDB access, worker lease and ERP driver/identity. Secrets are not logged.');
  await Promise.allSettled(clients.map(c => c.close()));
  process.exitCode = 1;
}
