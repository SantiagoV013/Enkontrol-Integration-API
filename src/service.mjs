import { PublicError, revision } from './crm.mjs';

export class IntegrationService {
  constructor({ apps, modules, store, erp, mode }) {
    Object.assign(this, { apps, modules, store, erp, mode });
    this.busy = new Set();
    this.cursors = new Map();
    this.lastPoll = new Map();
  }
  async exclusive(appId, fn) {
    if (this.busy.has(appId)) throw new PublicError(409, 'APP_BUSY_RETRY');
    this.busy.add(appId);
    try { return await fn(); } finally { this.busy.delete(appId); }
  }
  async capture(appId, id) {
    const payload = await this.modules.get(appId).snapshot(id);
    await this.store.enqueue(appId, id, payload);
    await this.store.resume(appId, id);
    return this.store.get(appId, id);
  }
  async enqueue(appId, id) { return this.exclusive(appId, () => this.capture(appId, id)); }
  async tick(app) {
    return this.exclusive(app.id, async () => {
      const module = this.modules.get(app.id);
      const leads = await module.list(this.cursors.get(app.id), 100);
      let rejected = 0;
      for (const lead of leads) {
        try { await this.capture(app.id, lead._id.toHexString()); }
        catch (error) {
          if (!(error instanceof PublicError) || ![404,409,422].includes(error.status)) throw error;
          rejected++;
        }
      }
      this.cursors.set(app.id, leads.length === 100 ? leads.at(-1)._id.toHexString() : undefined);
      if (this.mode === 'preview') await this.store.preview(app.id);
      else for (let i = 0; i < 25; i++) {
        const job = await this.store.claim(app.id);
        if (!job) break;
        try {
          // Revalidate source immediately before delivery: do not send a deleted/reverted lead.
          const current = await module.snapshot(job.sourceId);
          if (revision(current) !== job.desiredHash) {
            await this.store.enqueue(app.id, job.sourceId, current);
            await this.store.fail(job, 'SOURCE_CHANGED');
            continue;
          }
          const erpId = await this.erp.deliver(app, job);
          await this.store.complete(job, erpId);
        } catch (error) {
          if (error instanceof PublicError && [404,409,422].includes(error.status)) await this.store.suspend(job, error.code);
          else await this.store.fail(job, error instanceof PublicError ? error.code : 'DELIVERY_FAILED');
        }
      }
      this.lastPoll.set(app.id, { at: new Date().toISOString(), scanned: leads.length, rejected });
    });
  }
}
