import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../src/config.mjs';
import { canonical, revision, PublicError, CrmModule } from '../src/crm.mjs';
import { EnkontrolAdapter } from '../src/erp.mjs';
import { IntegrationService } from '../src/service.mjs';
import { createApi } from '../src/http.mjs';

const app = { id: 'crm', module: 'crm', mongoUriEnv: 'CRM_URI', mongoDbEnv: 'CRM_DB', apiKeyEnv: 'KEY',
  scopes: ['read', 'enqueue', 'erp:inspect'], eligibleStates: ['compra'], erpProcedure: 'DBA.import_crm' };
const env = { HUB_MONGODB_URI: 'mongodb://hub', HUB_MONGODB_DB: 'hub', CRM_URI: 'mongodb://crm', CRM_DB: 'crm', KEY: 'a'.repeat(40) };
const payload = { schemaVersion: 1, appId: 'crm', sourceId: 'a'.repeat(24), lead: { estado: 'compra', nombreCompleto: 'Prueba' } };

test('configuration isolates app credentials and refuses incomplete live mode', () => {
  assert.equal(validateConfig(env, [app]).mode, 'preview');
  assert.throws(() => validateConfig({ ...env, SYNC_MODE: 'live' }, [app]));
  assert.throws(() => validateConfig(env, [app, { ...app, id: 'other' }]));
  assert.throws(() => validateConfig(env, [{ ...app, erpProcedure: 'DBA.foo; DROP TABLE x' }]));
  assert.throws(() => validateConfig(env, [{ ...app, module: 'suppliers' }]));
  assert.throws(() => validateConfig({ ...env, CRM_DB: 'hub' }, [app]));
});

test('revision is stable across key order, changes for business changes', () => {
  assert.equal(revision({ a: 1, b: 2 }), revision({ b: 2, a: 1 }));
  assert.notEqual(revision(payload), revision({ ...payload, lead: { estado: 'nuevo' } }));
  assert.equal(canonical({ a: undefined, b: new Date('2026-01-01Z') }), '{"b":"2026-01-01T00:00:00.000Z"}');
});

test('CRM rejects missing/noneligible leads before accessing related data', async () => {
  const module = new CrmModule({ collection: () => ({ findOne: async () => null }) }, app);
  await assert.rejects(module.snapshot('bad'), { code: 'INVALID_ID' });
  await assert.rejects(module.snapshot('a'.repeat(24)), { code: 'LEAD_NOT_FOUND' });
  module.db = { collection: () => ({ findOne: async () => ({ estado: 'nuevo' }) }) };
  await assert.rejects(module.snapshot('a'.repeat(24)), { code: 'LEAD_NOT_ELIGIBLE' });
});

function erpFixture(overrides = {}) {
  const calls = [];
  let closed = false;
  const identity = { db_name: 'test_db', server_name: 'test_ck', db_file: 'C:\\test.db' };
  const adapter = new EnkontrolAdapter({ connectionString: 'secret', writes: true, database: 'test_db', server: 'test_ck', file: 'C:\\test.db', ...overrides },
    async () => ({ query: async (sql, params) => { calls.push({ sql, params }); return sql.startsWith('SELECT') ? [identity] : [{ erp_id: '42' }]; }, close: async () => { closed = true; } }));
  return { adapter, calls, closed: () => closed };
}

test('ERP refuses wrong server/database/file before calling write procedure', async () => {
  for (const override of [{ database: 'production' }, { server: 'production' }, { file: 'C:\\prod.db' }]) {
    const f = erpFixture(override);
    await assert.rejects(f.adapter.deliver(app, {}), { code: 'ERP_IDENTITY_MISMATCH' });
    assert.equal(f.calls.length, 1);
    assert.equal(f.closed(), true);
  }
});

test('ERP writes are disabled unless explicitly configured', async () => {
  const f = erpFixture({ writes: false });
  await assert.rejects(f.adapter.deliver(app, {}), { code: 'ERP_MAPPING_NOT_ENABLED' });
  assert.equal(f.calls.length, 0);
});

test('ERP parameterizes payload and uses stable idempotency key on retry', async () => {
  const f = erpFixture();
  const job = { _id: 'crm:lead:1', sourceId: '1', desiredHash: revision(payload), payload };
  assert.equal(await f.adapter.deliver(app, job), '42');
  assert.equal(await f.adapter.deliver(app, job), '42');
  assert.equal(f.calls[1].sql, 'CALL DBA.import_crm(?, ?, ?, ?)');
  assert.deepEqual(f.calls[1].params, f.calls[3].params);
  assert.equal(f.calls[1].params[3], JSON.stringify(payload));
});

function serviceFixture(mode = 'live', snapshot = async () => payload, deliver = async () => '42') {
  const events = [];
  let claimed = false;
  const job = { _id: 'crm:lead:1', sourceId: 'a'.repeat(24), desiredHash: revision(payload), payload };
  const store = {
    claim: async () => { if (claimed) return null; claimed = true; return job; },
    preview: async () => events.push('preview'),
    complete: async () => events.push('complete'), fail: async (_, code) => events.push(code),
    suspend: async (_, code) => events.push(`suspend:${code}`),
    enqueue: async () => events.push('enqueue'), resume: async () => {}
  };
  const modules = new Map([['crm', { list: async () => [], snapshot }]]);
  const service = new IntegrationService({ apps: [app], modules, store, mode,
    erp: { deliver: async (...args) => { events.push('deliver'); return deliver(...args); } } });
  return { service, events };
}

test('preview never invokes ERP or marks records synchronized', async () => {
  const f = serviceFixture('preview'); await f.service.tick(app);
  assert.deepEqual(f.events, ['preview']);
});
test('worker delivers and acknowledges only after ERP success', async () => {
  const f = serviceFixture(); await f.service.tick(app);
  assert.deepEqual(f.events, ['deliver', 'complete']);
});
test('worker suspends a lead reverted out of eligible stages', async () => {
  const f = serviceFixture('live', async () => { throw new PublicError(409, 'LEAD_NOT_ELIGIBLE'); });
  await f.service.tick(app); assert.deepEqual(f.events, ['suspend:LEAD_NOT_ELIGIBLE']);
});
test('worker refreshes stale payload instead of delivering it', async () => {
  const f = serviceFixture('live', async () => ({ ...payload, version: 2 }));
  await f.service.tick(app); assert.deepEqual(f.events, ['enqueue', 'SOURCE_CHANGED']);
});
test('worker retains failure for retry without logging sensitive driver text', async () => {
  const f = serviceFixture('live', undefined, async () => { throw new Error('PWD=secret'); });
  await f.service.tick(app); assert.deepEqual(f.events, ['deliver', 'DELIVERY_FAILED']);
});
test('concurrent source captures for same app are rejected', async () => {
  const f = serviceFixture(); let release;
  const first = f.service.exclusive('crm', () => new Promise(resolve => { release = resolve; }));
  await assert.rejects(f.service.exclusive('crm', async () => {}), { code: 'APP_BUSY_RETRY' });
  release(); await first;
});

test('HTTP enforces per-app auth, scopes, pagination, and payload from Mongo only', async () => {
  const config = validateConfig(env, [app]);
  config.apps.push({ ...config.apps[0], id: 'viewer', apiKey: 'b'.repeat(40), scopes: ['read'] });
  let captures = 0;
  const server = createApi({ config, service: { lastPoll: new Map(), enqueue: async () => { captures++; return { status: 'pending' }; } },
    store: { get: async () => null }, erp: { inspect: async () => ({}) },
    modules: new Map([['crm', { list: async () => [], snapshot: async () => payload }]]) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, options = {}, key = env.KEY) => fetch(base + path, { ...options, headers: { Authorization: `Bearer ${key}`, ...options.headers } });
  try {
    assert.equal((await call('/v1/apps/crm/leads', {}, 'wrong')).status, 401);
    assert.equal((await call('/v1/apps/viewer/status')).status, 401);
    assert.equal((await call('/v1/apps/crm/leads?limit=10000')).status, 400);
    assert.equal((await call('/v1/apps/crm/leads?after=invalid')).status, 400);
    assert.equal((await call('/v1/apps/crm/leads')).status, 200);
    const path = '/v1/apps/crm/leads/' + 'a'.repeat(24) + '/sync';
    assert.equal((await call(path, { method: 'POST', body: '{"estado":"compra"}' })).status, 400);
    assert.equal((await call(path, { method: 'POST' })).status, 202);
    assert.equal(captures, 1);
    assert.equal((await call(path.replace('crm', 'viewer'), { method: 'POST' }, 'b'.repeat(40))).status, 403);
    assert.equal((await call('/v1/apps/crm/sql', { method: 'POST' })).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
