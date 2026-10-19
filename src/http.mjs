import { createServer } from 'node:http';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { PublicError, objectId } from './crm.mjs';

const digest = value => createHash('sha256').update(value).digest();
export function authorized(app, authorization) {
  return typeof authorization === 'string' && authorization.startsWith('Bearer ') &&
    timingSafeEqual(digest(app.apiKey), digest(authorization.slice(7)));
}

export function createApi({ config, service, store, modules, erp, ready = async () => true }) {
  const rates = new Map();
  const server = createServer(async (req, res) => {
    const requestId = randomUUID();
    const send = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'X-Request-Id': requestId });
      res.end(JSON.stringify(data));
    };
    try {
      const now = Date.now();
      for (const [key, value] of rates) if (value.until < now) rates.delete(key);
      const ip = req.socket.remoteAddress;
      if (!rates.has(ip) && rates.size >= 10000) throw new PublicError(429, 'RATE_LIMITED');
      const rate = rates.get(ip) || { until: now + 60000, count: 0 };
      rates.set(ip, rate);
      if (++rate.count > 120) throw new PublicError(429, 'RATE_LIMITED');
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health/live' && req.method === 'GET') return send(200, { status: 'up' });
      const match = /^\/v1\/apps\/([a-z][a-z0-9-]{0,39})\/(.+)$/.exec(url.pathname);
      const app = match && config.apps.find(a => a.id === match[1]);
      if (!app || !authorized(app, req.headers.authorization)) throw new PublicError(401, 'UNAUTHORIZED');
      const scope = (name) => { if (!app.scopes.includes(name)) throw new PublicError(403, 'FORBIDDEN'); };
      const path = match[2];
      if (req.method === 'GET' && path === 'status') {
        scope('read');
        const healthy = await ready();
        return send(healthy ? 200 : 503, { mode: config.mode, appId: app.id,
          mongoReady: healthy, lastPoll: service.lastPoll.get(app.id) || null });
      }
      if (req.method === 'GET' && path === 'erp/identity') {
        scope('erp:inspect'); return send(200, await erp.inspect());
      }
      if (req.method === 'GET' && path === 'leads') {
        scope('read');
        const limit = Number(url.searchParams.get('limit') || 50);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new PublicError(400, 'INVALID_LIMIT');
        const after = url.searchParams.get('after');
        if (after) objectId(after);
        const data = await modules.get(app.id).list(after, limit);
        return send(200, { data, nextCursor: data.length === limit ? String(data.at(-1)._id) : null });
      }
      const lead = /^leads\/([a-f0-9]{24})\/(preview|sync|status)$/i.exec(path);
      if (!lead) throw new PublicError(404, 'NOT_FOUND');
      const id = lead[1].toLowerCase();
      if (req.method === 'GET' && lead[2] === 'preview') {
        scope('read'); return send(200, { mode: config.mode, payload: await modules.get(app.id).snapshot(id) });
      }
      if (req.method === 'GET' && lead[2] === 'status') {
        scope('read'); const job = await store.get(app.id, id);
        if (!job) throw new PublicError(404, 'JOB_NOT_FOUND');
        return send(200, job);
      }
      if (req.method === 'POST' && lead[2] === 'sync') {
        scope('enqueue');
        if (req.headers['transfer-encoding'] || Number(req.headers['content-length'] || 0) !== 0) throw new PublicError(400, 'BODY_NOT_ALLOWED');
        return send(202, { mode: config.mode, job: await service.enqueue(app.id, id) });
      }
      throw new PublicError(405, 'METHOD_NOT_ALLOWED');
    } catch (error) {
      const known = error instanceof PublicError;
      // No driver messages, URIs, payloads, tokens or passwords in responses/logs.
      if (!known) console.error(JSON.stringify({ requestId, code: 'REQUEST_FAILED' }));
      send(known ? error.status : 503, { error: known ? error.code : 'DEPENDENCY_UNAVAILABLE', requestId });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 40;
  return server;
}
