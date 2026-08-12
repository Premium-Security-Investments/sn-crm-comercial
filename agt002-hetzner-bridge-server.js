import { randomUUID } from 'node:crypto';
import { createNonceStore } from './agt002-hetzner-bridge-nonce-store.js';
import { authenticateBridgeRequest } from './agt002-hetzner-bridge-auth.js';
import { logBridgeEvent } from './agt002-hetzner-bridge-log.js';

const BRIDGE_PATH = '/v1/agt002-preview/run';
export const AGT002_BRIDGE_MAX_BODY_BYTES = 1_048_576;

const CODE_TO_STATUS = {
  AGT002_CODEX_TIMEOUT: 504,
  AGT002_CODEX_LOGIN_REQUIRED: 503,
  AGT002_CODEX_ACCOUNT_INVALID: 503,
  AGT002_CODEX_PROVIDER_ERROR: 502,
  AGT002_CODEX_TRANSPORT_ERROR: 502,
  AGT002_CODEX_INVALID_RESPONSE: 422,
};

function sendJson(res, status, payload) {
  if (res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, code) {
  sendJson(res, status, { error: { code, message: 'AGT-002 bridge rejected the request.' }, correlation_id: randomUUID() });
}

export function createAgt002BridgeServer({ hmacSecret, codexClient, nonceStore = createNonceStore(), now = () => Math.floor(Date.now() / 1000), maxBodyBytes = AGT002_BRIDGE_MAX_BODY_BYTES }) {
  if (typeof hmacSecret !== 'string' || hmacSecret.length < 32) throw new Error('El puente AGT-002 requiere un secreto HMAC de al menos 32 bytes.');
  if (!codexClient || typeof codexClient.run !== 'function') throw new Error('El puente AGT-002 requiere un cliente Codex inyectado.');

  return function requestListener(req, res) {
    if (req.method !== 'POST') return sendError(res, 405, 'AGT002_BRIDGE_METHOD_NOT_ALLOWED');
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== BRIDGE_PATH) return sendError(res, 404, 'AGT002_BRIDGE_BAD_REQUEST');
    if (String(req.headers['content-type'] || '').split(';')[0].trim() !== 'application/json') {
      return sendError(res, 415, 'AGT002_BRIDGE_UNSUPPORTED_MEDIA_TYPE');
    }

    const chunks = [];
    let received = 0;
    let rejected = false;

    req.on('data', chunk => {
      if (rejected) return;
      received += chunk.length;
      if (received > maxBodyBytes) {
        rejected = true;
        sendError(res, 413, 'AGT002_BRIDGE_PAYLOAD_TOO_LARGE');
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (rejected) return;
      const rawBody = Buffer.concat(chunks);
      const auth = authenticateBridgeRequest({ method: req.method, path: url.pathname, rawBody, headers: req.headers, secret: hmacSecret, nonceStore, now });
      if (!auth.ok) return sendError(res, auth.status, auth.code);

      let body;
      try { body = JSON.parse(rawBody.toString('utf8')); }
      catch { return sendError(res, 400, 'AGT002_BRIDGE_BAD_REQUEST'); }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) return sendError(res, 400, 'AGT002_BRIDGE_BAD_REQUEST');
      if (Object.hasOwn(body, 'cwd')) return sendError(res, 400, 'AGT002_BRIDGE_BAD_REQUEST');

      const { model, policy, input, outputSchema, timeoutMs, idempotencyKey } = body;
      if (typeof model !== 'string' || !model.trim() || typeof policy !== 'string' || !policy.trim()) {
        return sendError(res, 400, 'AGT002_BRIDGE_BAD_REQUEST');
      }
      if (input === null || typeof input !== 'object' || Array.isArray(input) || outputSchema === null || typeof outputSchema !== 'object' || Array.isArray(outputSchema)) {
        return sendError(res, 422, 'AGT002_CODEX_INVALID_RESPONSE');
      }
      if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) return sendError(res, 400, 'AGT002_BRIDGE_BAD_REQUEST');

      const startedAt = Date.now();
      const correlationId = randomUUID();
      const controller = new AbortController();
      // Cancel only on a real client disconnect. The request IncomingMessage
      // emits 'close' immediately after 'end' on every completed body, so
      // keying off req 'close' would abort each legitimate request. The
      // response 'close' fires before 'finish' only when the connection drops
      // before we flush the reply, so writableFinished distinguishes a genuine
      // disconnect from normal completion.
      res.on('close', () => { if (!res.writableFinished) controller.abort(); });

      const handleError = error => {
        const code = error?.code || 'AGT002_BRIDGE_INTERNAL';
        const status = CODE_TO_STATUS[code] || 500;
        logBridgeEvent('agt002_bridge_error', { correlation_id: correlationId, code, latency_ms: Date.now() - startedAt });
        sendError(res, status, code);
      };

      let runResult;
      try {
        runResult = codexClient.run({ model, policy, input, outputSchema, timeoutMs, idempotencyKey, signal: controller.signal });
      } catch (error) {
        handleError(error);
        return;
      }

      Promise.resolve(runResult)
        .then(result => {
          logBridgeEvent('agt002_bridge_success', {
            correlation_id: correlationId, code: 'OK', latency_ms: Date.now() - startedAt,
            input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens,
          });
          sendJson(res, 200, result);
        })
        .catch(handleError);
    });
  };
}
