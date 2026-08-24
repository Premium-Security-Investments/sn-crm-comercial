import { randomUUID } from 'node:crypto';
import { AGT003_BRIDGE_RUN_PATH } from './agt003-claude-bridge-host.js';
import { createAgt003NonceStore } from './agt003-claude-bridge-nonce-store.js';
import { authenticateAgt003BridgeRequest } from './agt003-claude-bridge-auth.js';
import { logAgt003BridgeEvent } from './agt003-claude-bridge-log.js';

/** Ruta dedicada del puente AGT-003. Ninguna otra ruta se atiende aquí. */
export const AGT003_BRIDGE_PATH = AGT003_BRIDGE_RUN_PATH;
export const AGT003_BRIDGE_MAX_BODY_BYTES = 1_048_576;

/**
 * Techos operativos del puente. El servidor de 2 vCPU no puede sostener dos
 * subprocesos `claude` a la vez, así que el valor por defecto es un solo turno
 * simultáneo; el operador puede subirlo por entorno, nunca la petición.
 */
export const AGT003_BRIDGE_MAX_CONCURRENCY = 1;
/** Ninguna petición puede pedir un turno más largo que este techo. */
export const AGT003_BRIDGE_MAX_TIMEOUT_MS = 120_000;
/** El puente decide qué modelos existen: nada fuera de la lista llega al argv. */
export const AGT003_BRIDGE_ALLOWED_MODELS = Object.freeze(['sonnet']);

const CODE_TO_STATUS = {
  AGT003_CLAUDE_TIMEOUT: 504,
  AGT003_CLAUDE_LOGIN_REQUIRED: 503,
  AGT003_CLAUDE_PROVIDER_ERROR: 502,
  AGT003_CLAUDE_TRANSPORT_ERROR: 502,
  AGT003_CLAUDE_OUTPUT_TOO_LARGE: 502,
  AGT003_CLAUDE_SCHEMA_TOO_LARGE: 413,
  AGT003_CLAUDE_INVALID_RESPONSE: 422,
};

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sendJson(res, status, payload) {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  } catch {
    // La conexión ya no existe (desconexión del cliente): no hay a quién
    // responder y el fallo de escritura nunca debe propagarse como rechazo.
  }
}

// El cuerpo de error es siempre el mismo texto fijo: el detalle del proveedor
// (stderr, rutas internas, mensajes de excepción) nunca llega al llamador.
function sendError(res, status, code, correlationId = randomUUID()) {
  sendJson(res, status, { error: { code, message: 'AGT-003 bridge rejected the request.' }, correlation_id: correlationId });
}

/**
 * Rechazo estándar: un único evento con sólo `event`, `code` y
 * `correlation_id`, y el mismo correlation_id en la respuesta. Nada del cuerpo,
 * de las cabeceras firmadas ni del modelo pedido entra en el registro.
 */
function rejectRequest(res, status, code) {
  const correlationId = randomUUID();
  logAgt003BridgeEvent('agt003_bridge_error', { correlation_id: correlationId, code });
  sendError(res, status, code, correlationId);
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

export function createAgt003BridgeServer({
  hmacSecret,
  claudeClient,
  nonceStore = createAgt003NonceStore(),
  now = () => Math.floor(Date.now() / 1000),
  maxBodyBytes = AGT003_BRIDGE_MAX_BODY_BYTES,
  maxConcurrency = AGT003_BRIDGE_MAX_CONCURRENCY,
  maxTimeoutMs = AGT003_BRIDGE_MAX_TIMEOUT_MS,
  allowedModels = AGT003_BRIDGE_ALLOWED_MODELS,
}) {
  if (typeof hmacSecret !== 'string' || Buffer.byteLength(hmacSecret, 'utf8') < 32) {
    throw new Error('El puente AGT-003 requiere un secreto HMAC de al menos 32 bytes.');
  }
  if (!claudeClient || typeof claudeClient.run !== 'function') {
    throw new Error('El puente AGT-003 requiere un cliente de proveedor inyectado.');
  }
  // Los tres techos operativos fallan cerrado: un valor mal configurado impide
  // arrancar el puente en lugar de degradarlo en silencio.
  if (!positiveInteger(maxConcurrency)) {
    throw new Error('El puente AGT-003 requiere una concurrencia máxima entera y positiva.');
  }
  if (!positiveInteger(maxTimeoutMs)) {
    throw new Error('El puente AGT-003 requiere un techo de timeout entero y positivo en milisegundos.');
  }
  if (!Array.isArray(allowedModels) || allowedModels.length === 0
    || !allowedModels.every(entry => typeof entry === 'string' && entry.trim().length > 0)) {
    throw new Error('El puente AGT-003 requiere una allowlist de modelos no vacía de cadenas.');
  }
  // Coincidencia exacta: ni recorte de espacios ni normalización de mayúsculas.
  const allowedModelSet = new Set(allowedModels);

  // Techo global de turnos en vuelo. No es por conexión ni por llamador: es el
  // número de subprocesos `claude` que la máquina puede sostener a la vez.
  let activeRuns = 0;

  return function requestListener(req, res) {
    // Un corte a mitad del cuerpo hace que `req` emita 'error'. Sin este oyente
    // el fallo escalaría a excepción no capturada y derribaría el proceso.
    req.on('error', () => { /* la conexión murió: no hay a quién responder */ });
    res.on('error', () => { /* idem en el lado de la respuesta */ });

    if (req.method !== 'POST') return rejectRequest(res, 405, 'AGT003_BRIDGE_METHOD_NOT_ALLOWED');
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== AGT003_BRIDGE_PATH) return rejectRequest(res, 404, 'AGT003_BRIDGE_BAD_REQUEST');
    if (String(req.headers['content-type'] || '').split(';')[0].trim() !== 'application/json') {
      return rejectRequest(res, 415, 'AGT003_BRIDGE_UNSUPPORTED_MEDIA_TYPE');
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
        logAgt003BridgeEvent('agt003_bridge_error', { correlation_id: correlationId, code: 'AGT003_BRIDGE_PAYLOAD_TOO_LARGE', received_bytes: received });
        sendError(res, 413, 'AGT003_BRIDGE_PAYLOAD_TOO_LARGE', correlationId);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (rejected) return;
      const rawBody = Buffer.concat(chunks);
      const auth = authenticateAgt003BridgeRequest({ method: req.method, path: url.pathname, rawBody, headers: req.headers, secret: hmacSecret, nonceStore, now });
      if (!auth.ok) return rejectRequest(res, auth.status ?? 401, auth.code ?? 'AGT003_BRIDGE_AUTH_INVALID');

      let body;
      try { body = JSON.parse(rawBody.toString('utf8')); }
      catch { return rejectRequest(res, 400, 'AGT003_BRIDGE_BAD_REQUEST'); }
      if (!isRecord(body)) return rejectRequest(res, 400, 'AGT003_BRIDGE_BAD_REQUEST');
      // El directorio de trabajo del proveedor es fijo y sólo lo decide el
      // proceso local: un cuerpo que intente redirigirlo se rechaza entero.
      if (Object.hasOwn(body, 'cwd')) return rejectRequest(res, 400, 'AGT003_BRIDGE_BAD_REQUEST');

      const { model, policy, input, outputSchema, timeoutMs, idempotencyKey } = body;
      // El modelo lo propone el cuerpo firmado, pero lo decide el puente: sólo
      // un alias exacto de la allowlist puede llegar al argv del proveedor.
      if (typeof model !== 'string' || !allowedModelSet.has(model)) return rejectRequest(res, 400, 'AGT003_BRIDGE_BAD_REQUEST');
      if (typeof policy !== 'string' || !policy.trim()) return rejectRequest(res, 400, 'AGT003_BRIDGE_BAD_REQUEST');
      if (!isRecord(input) || !isRecord(outputSchema)) return rejectRequest(res, 422, 'AGT003_CLAUDE_INVALID_RESPONSE');
      // El techo del timeout no se recorta en silencio: pedir más se rechaza.
      if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > maxTimeoutMs) {
        return rejectRequest(res, 400, 'AGT003_BRIDGE_BAD_REQUEST');
      }

      // El slot es un recurso escaso: se toma después de la autenticación y de
      // toda la validación, de modo que una petición inválida o no firmada
      // jamás pueda negarle el turno a un llamador legítimo.
      if (activeRuns >= maxConcurrency) return rejectRequest(res, 429, 'AGT003_BRIDGE_BUSY');
      activeRuns += 1;
      let slotReleased = false;
      // El slot sigue al turno del proveedor, no al socket: se devuelve cuando
      // la promesa termina, incluida la rama de cancelación por desconexión.
      const releaseSlot = () => {
        if (slotReleased) return;
        slotReleased = true;
        activeRuns -= 1;
      };

      const startedAt = Date.now();
      const correlationId = randomUUID();
      const controller = new AbortController();
      // Cancelar sólo ante una desconexión real del cliente. El IncomingMessage
      // emite 'close' justo tras 'end' en todo cuerpo completo, así que atarse a
      // req 'close' abortaría cada petición legítima. En la respuesta, 'close'
      // precede a 'finish' únicamente cuando la conexión cae antes de escribir
      // la réplica: writableFinished distingue la desconexión del cierre normal.
      res.on('close', () => { if (!res.writableFinished) controller.abort(); });

      const handleError = error => {
        releaseSlot();
        const code = error?.code || 'AGT003_BRIDGE_INTERNAL';
        const status = CODE_TO_STATUS[code] || 500;
        logAgt003BridgeEvent('agt003_bridge_error', {
          correlation_id: correlationId,
          code,
          latency_ms: Date.now() - startedAt,
          provider_error_code: error?.providerErrorCode,
        });
        sendError(res, status, code, correlationId);
      };

      let runResult;
      try {
        runResult = claudeClient.run({ model, policy, input, outputSchema, timeoutMs, idempotencyKey, signal: controller.signal });
      } catch (error) {
        // Un cliente que lanza de forma síncrona también debe fallar cerrado.
        handleError(error);
        return;
      }

      Promise.resolve(runResult)
        .then(result => {
          releaseSlot();
          logAgt003BridgeEvent('agt003_bridge_success', {
            correlation_id: correlationId,
            code: 'OK',
            latency_ms: Date.now() - startedAt,
            input_tokens: result.usage.input_tokens,
            output_tokens: result.usage.output_tokens,
          });
          // Proyección explícita: sólo estos tres campos cruzan al llamador.
          sendJson(res, 200, {
            content: result.content,
            usage: { input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens },
            rate_limit: result.rate_limit ?? null,
          });
        })
        .catch(handleError);
    });
  };
}
