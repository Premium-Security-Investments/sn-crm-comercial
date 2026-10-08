import { randomUUID } from 'node:crypto';
import { authenticateBridgeRequest } from './agt002-hetzner-bridge-auth.js';
import { createNonceStore } from './agt002-hetzner-bridge-nonce-store.js';

export const AGT002_INCREMENTAL_DISPATCH_PATH = '/v1/agt002/reanalysis/dispatch';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function send(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

export function createAgt002IncrementalWorkerDispatchServer({
  hmacSecret,
  dispatchJob,
  nonceStore = createNonceStore(),
  now = () => Math.floor(Date.now() / 1000),
  defer = queueMicrotask,
  logger = console,
} = {}) {
  if (typeof hmacSecret !== 'string' || hmacSecret.length < 32) throw new Error('El receptor incremental requiere un secreto HMAC.');
  if (typeof dispatchJob !== 'function') throw new Error('El receptor incremental requiere un despachador de jobs.');
  let active = false;
  return function listener(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method !== 'POST' || url.pathname !== AGT002_INCREMENTAL_DISPATCH_PATH) {
      return send(res, req.method === 'POST' ? 404 : 405, { error: { code: 'AGT002_INCREMENTAL_DISPATCH_REJECTED' } });
    }
    if (String(req.headers['content-type'] || '').split(';')[0].trim() !== 'application/json') {
      return send(res, 415, { error: { code: 'AGT002_INCREMENTAL_DISPATCH_REJECTED' } });
    }
    const chunks = [];
    let bytes = 0;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes <= 1024) chunks.push(chunk);
    });
    req.on('end', () => {
      if (bytes > 1024) return send(res, 413, { error: { code: 'AGT002_INCREMENTAL_DISPATCH_REJECTED' } });
      const rawBody = Buffer.concat(chunks);
      const auth = authenticateBridgeRequest({
        method: req.method, path: url.pathname, rawBody, headers: req.headers,
        secret: hmacSecret, nonceStore, now,
      });
      if (!auth.ok) return send(res, auth.status, { error: { code: auth.code } });
      let body;
      try { body = JSON.parse(rawBody.toString('utf8')); } catch { return send(res, 400, { error: { code: 'AGT002_INCREMENTAL_DISPATCH_REJECTED' } }); }
      if (!body || Object.keys(body).length !== 1 || !UUID.test(body.job_id || '')) {
        return send(res, 400, { error: { code: 'AGT002_INCREMENTAL_DISPATCH_REJECTED' } });
      }
      if (active) return send(res, 409, { status: 'busy' });
      active = true;
      const requestId = randomUUID();
      send(res, 202, { status: 'accepted', request_id: requestId });
      defer(() => {
        Promise.resolve(dispatchJob(body.job_id))
          .then(result => logger.info(JSON.stringify({
            event: 'agt002_incremental_dispatch_finished', request_id: requestId,
            status: result?.status || 'unknown', job_id: body.job_id,
          })))
          .catch(() => logger.error(JSON.stringify({
            event: 'agt002_incremental_dispatch_failed', request_id: requestId,
            code: 'WORKER_FAILURE', job_id: body.job_id,
          })))
          .finally(() => { active = false; });
      });
    });
  };
}
