import { randomUUID } from 'node:crypto';
import { revision } from './crm.mjs';

export class JobStore {
  constructor(db) { this.jobs = db.collection('sync_jobs'); }
  async init() {
    await this.jobs.createIndex({ appId: 1, sourceId: 1 }, { unique: true });
    await this.jobs.createIndex({ appId: 1, nextAttemptAt: 1, leaseUntil: 1 });
  }
  async enqueue(appId, sourceId, payload) {
    const hash = revision(payload);
    const key = `${appId}:lead:${sourceId}`;
    // Source capture is serialized by the service per application.
    await this.jobs.updateOne({ _id: key }, { $setOnInsert: {
      appId, sourceId, createdAt: new Date(), attempts: 0, leaseUntil: new Date(0), sentHash: null
    } }, { upsert: true });
    await this.jobs.updateOne({ _id: key, desiredHash: { $ne: hash } }, {
      $set: { payload, desiredHash: hash, updatedAt: new Date(), attempts: 0, nextAttemptAt: new Date(0), errorCode: null }
    });
    return this.get(appId, sourceId);
  }
  async get(appId, sourceId) {
    const job = await this.jobs.findOne({ _id: `${appId}:lead:${sourceId}` }, { projection: { payload: 0, leaseToken: 0 } });
    if (!job) return null;
    return { ...job, status: job.suspended ? 'suspended' : job.sentHash === job.desiredHash ? 'synced' :
      job.leaseUntil > new Date() ? 'processing' : job.errorCode ? 'retry_pending' :
      job.previewHash === job.desiredHash ? 'previewed' : 'pending' };
  }
  async preview(appId) {
    await this.jobs.updateMany({ appId, suspended: { $ne: true } }, [
      { $set: { previewHash: '$desiredHash', previewedAt: '$$NOW' } }
    ]);
  }
  async claim(appId) {
    const now = new Date();
    return this.jobs.findOneAndUpdate({ appId, suspended: { $ne: true }, desiredHash: { $exists: true },
      $expr: { $ne: ['$desiredHash', '$sentHash'] }, nextAttemptAt: { $lte: now }, leaseUntil: { $lte: now } },
    { $set: { leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 120_000) }, $inc: { attempts: 1 } },
    { sort: { nextAttemptAt: 1 }, returnDocument: 'after' });
  }
  async complete(job, erpId) {
    await this.jobs.updateOne({ _id: job._id, leaseToken: job.leaseToken }, { $set: {
      sentHash: job.desiredHash, erpId, syncedAt: new Date(), leaseUntil: new Date(0), errorCode: null
    }, $unset: { leaseToken: '' } });
  }
  async fail(job, code) {
    const delay = Math.min(3600, 2 ** Math.min(job.attempts, 12) * 5);
    await this.jobs.updateOne({ _id: job._id, leaseToken: job.leaseToken }, { $set: {
      errorCode: code, leaseUntil: new Date(0), nextAttemptAt: new Date(Date.now() + delay * 1000)
    }, $unset: { leaseToken: '' } });
  }
  async suspend(job, code) {
    await this.jobs.updateOne({ _id: job._id, leaseToken: job.leaseToken }, { $set: {
      suspended: true, errorCode: code, leaseUntil: new Date(0)
    }, $unset: { leaseToken: '' } });
  }
  async resume(appId, sourceId) {
    await this.jobs.updateOne({ _id: `${appId}:lead:${sourceId}` }, { $set: { suspended: false } });
  }
}
