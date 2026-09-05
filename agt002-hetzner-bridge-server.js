import { randomUUID } from 'node:crypto';
import { createNonceStore } from './agt002-hetzner-bridge-nonce-store.js';
import { authenticateBridgeRequest } from './agt002-hetzner-bridge-auth.js';
import { logBridgeEvent } from './agt002-hetzner-bridge-log.js';
import { isAgt002PreviewReasoningEffort } from './agt002-preview-reasoning-effort.js';

const BRIDGE_PATH = '/v1/agt002-preview/run';
export const AGT002_BRIDGE_MAX_BODY_BYTES = 1_048_576;
/** El puente decide qué modelos existen: nada fuera de la lista llega al argv del proveedor. */
export const AGT002_BRIDGE_ALLOWED_MODELS = Object.freeze(['sonnet']);

const CODE_TO_STATUS = {
  AGT002_CODEX_TIMEOUT: 504,
  AGT002_CODEX_LOGIN_REQUIRED: 503,
  AGT002_CODEX_ACCOUNT_INVALID: 503,
  AGT002_CODEX_PROVIDER_ERROR: 502,
  AGT002_CODEX_TRANSPORT_ERROR: 502,
  AGT002_CODEX_INVALID_RESPONSE: 422,
};

// AGT-002 cambió su proveedor de Codex a Claude Sonnet, pero el wire hacia el
// motor/cliente/observabilidad sigue siendo AGT002_CODEX_*: el cliente
// inyectado (agt002-claude-client.js) lanza sus propios códigos nativos
// AGT002_CLAUDE_*, y aquí se traducen a los códigos de wire ya existentes
// para que CODE_TO_STATUS, el backoff y la observabilidad no cambien.
const CLAUDE_TO_CODEX_CODE = {
  AGT002_CLAUDE_TIMEOUT: 'AGT002_CODEX_TIMEOUT',
  AGT002_CLAUDE_LOGIN_REQUIRED: 'AGT002_CODEX_LOGIN_REQUIRED',
  AGT002_CLAUDE_PROVIDER_ERROR: 'AGT002_CODEX_PROVIDER_ERROR',
  AGT002_CLAUDE_TRANSPORT_ERROR: 'AGT002_CODEX_TRANSPORT_ERROR',
  AGT002_CLAUDE_INVALID_RESPONSE: 'AGT002_CODEX_INVALID_RESPONSE',
  // AGT-002 wire has no dedicated session-limit code; a temporary Claude
  // session limit is reported the same way as any other provider error.
  AGT002_CLAUDE_SESSION_LIMIT: 'AGT002_CODEX_PROVIDER_ERROR',
};

function sendJson(res, status, payload) {
  if (res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, code, correlationId = randomUUID()) {
  sendJson(res, status, { error: { code, message: 'AGT-002 bridge rejected the request.' }, correlation_id: correlationId });
}

export function createAgt002BridgeServer({
  hmacSecret,
  codexClient,
  nonceStore = createNonceStore(),
  now = () => Math.floor(Date.now() / 1000),
  maxBodyBytes = AGT002_BRIDGE_MAX_BODY_BYTES,
  allowedModels = AGT002_BRIDGE_ALLOWED_MODELS,
}) {
  if (typeof hmacSecret !== 'string' || hmacSecret.length < 32) throw new Error('El puente AGT-002 requiere un secreto HMAC de al menos 32 bytes.');
  if (!codexClient || typeof codexClient.run !== 'function') throw new Error('El puente AGT-002 requiere un cliente inyectado con un método run().');
  if (!Array.isArray(allowedModels) || allowedModels.length === 0
    || !allowedModels.every(entry => typeof entry === 'string' && entry.trim().length > 0)) {
    throw new Error('El puente AGT-002 requiere una allowlist de modelos no vacía de cadenas.');
  }
  // Coincidencia exacta: ni recorte de espacios ni normalización de mayúsculas.
  const allowedModelSet = new Set(allowedModels);

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
        const correlationId = randomUUID();
        logBridgeEvent('agt002_bridge_error', { correlation_id: correlationId, code: 'AGT002_BRIDGE_PAYLOAD_TOO_LARGE', received_bytes: received });
        sendError(res, 413, 'AGT002_BRIDGE_PAYLOAD_TOO_LARGE', correlationId);
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

      const { model, policy, input, outputSchema, timeoutMs, idempotencyKey, effort } = body;
      // El modelo lo propone el cuerpo firmado, pero lo decide el puente: sólo
      // un alias exacto de la allowlist puede llegar al argv del proveedor.
      if (typeof model !== 'string' || !allowedModelSet.has(model) || typeof policy !== 'string' || !policy.trim()) {
        return sendError(res, 400, 'AGT002_BRIDGE_BAD_REQUEST');
      }
      if (input === null || typeof input !== 'object' || Array.isArray(input) || outputSchema === null || typeof outputSchema !== 'object' || Array.isArray(outputSchema)) {
        return sendError(res, 422, 'AGT002_CODEX_INVALID_RESPONSE');
      }
      if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) return sendError(res, 400, 'AGT002_BRIDGE_BAD_REQUEST');
      // Optional at this boundary (older/unrelated callers never sent one), but a value that IS
      // present must be a real allowlisted reasoning effort before it can ever reach the Codex
      // subprocess — fail closed, exactly like every other malformed field above.
      if (effort !== undefined && !isAgt002PreviewReasoningEffort(effort)) return sendError(res, 400, 'AGT002_BRIDGE_BAD_REQUEST');

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
        // Un cliente Claude nativo (agt002-claude-client.js) lanza sus propios
        // códigos AGT002_CLAUDE_*; se traducen aquí al código de wire
        // AGT002_CODEX_* equivalente. Un código que ya viene en formato de
        // wire (fakes de prueba, u otro cliente inyectado) pasa sin tocar.
        const rawCode = error?.code || 'AGT002_BRIDGE_INTERNAL';
        const code = CLAUDE_TO_CODEX_CODE[rawCode] || rawCode;
        const status = CODE_TO_STATUS[code] || 500;
        logBridgeEvent('agt002_bridge_error', {
          correlation_id: correlationId,
          code,
          latency_ms: Date.now() - startedAt,
          provider_status: error?.providerStatus,
          provider_error_code: error?.providerErrorCode,
          effort,
        });
        sendError(res, status, code);
      };

      let runResult;
      try {
        runResult = codexClient.run({ model, policy, input, outputSchema, timeoutMs, idempotencyKey, effort, signal: controller.signal });
      } catch (error) {
        handleError(error);
        return;
      }

      Promise.resolve(runResult)
        .then(result => {
          // Log the caller's own already-validated `effort` (checked above, before ever reaching
          // the Codex subprocess), never `result.effort_ack`. `effort_ack` exists solely so the
          // bridge *client* can validate the response (agt002-hetzner-bridge-client.js) — it is
          // downstream-sourced and must never double as a logging input, or a future edit could
          // silently start logging whatever a stale/misbehaving codex client happens to echo back.
          logBridgeEvent('agt002_bridge_success', {
            correlation_id: correlationId, code: 'OK', latency_ms: Date.now() - startedAt,
            input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens,
            effort,
          });
          sendJson(res, 200, result);
        })
        .catch(handleError);
    });
  };
}
