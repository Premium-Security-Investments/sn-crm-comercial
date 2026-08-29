import { randomUUID } from 'node:crypto';
import { spawn as defaultSpawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { isAgt002PreviewReasoningEffort } from './agt002-preview-reasoning-effort.js';

/**
 * Speaks the real Codex App Server JSON-line protocol (initialize,
 * account/read, account/rateLimits/read, thread/start, turn/start,
 * item/completed, thread/tokenUsage/updated, turn/completed, turn/interrupt)
 * as documented by @openai/codex's own app-server schemas. The subprocess
 * owns and never exposes its own ChatGPT sign-in credential to this module:
 * there is no secret header or token for this client to hold, read, forward,
 * or log — account/read is used only to confirm a `chatgpt` session exists,
 * never to read or relay a credential.
 */
export const AGT002_CODEX_CLIENT_NAME = 'siio-agt002-preview';
export const AGT002_CODEX_CLIENT_VERSION = '1.0.0';

const KILL_GRACE_MS = 200;

function transportError(message, code, safeDetails = {}) {
  const error = new Error(message);
  error.code = code;
  if (safeDetails.providerStatus) error.providerStatus = safeDetails.providerStatus;
  if (safeDetails.providerErrorCode) error.providerErrorCode = safeDetails.providerErrorCode;
  return error;
}

function safeProtocolAtom(value, fallback = undefined) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_.-]{0,63}$/.test(normalized) ? normalized : fallback;
}

function turnStatusType(status) {
  return safeProtocolAtom(typeof status === 'string' ? status : status?.type, 'unknown');
}

const CODEX_ERROR_INFO = Object.freeze({
  contextWindowExceeded: 'context_window_exceeded',
  sessionBudgetExceeded: 'session_budget_exceeded',
  usageLimitExceeded: 'usage_limit_exceeded',
  serverOverloaded: 'server_overloaded',
  cyberPolicy: 'cyber_policy',
  internalServerError: 'internal_server_error',
  unauthorized: 'unauthorized',
  badRequest: 'bad_request',
  threadRollbackFailed: 'thread_rollback_failed',
  sandboxError: 'sandbox_error',
  other: 'other',
  httpConnectionFailed: 'http_connection_failed',
  responseStreamConnectionFailed: 'response_stream_connection_failed',
  responseStreamDisconnected: 'response_stream_disconnected',
  responseTooManyFailedAttempts: 'response_too_many_failed_attempts',
  activeTurnNotSteerable: 'active_turn_not_steerable',
});

function codexErrorInfoType(value) {
  if (typeof value === 'string') return CODEX_ERROR_INFO[value] || 'other';
  if (!isPlainObject(value)) return undefined;
  for (const key of Object.keys(CODEX_ERROR_INFO)) {
    if (Object.hasOwn(value, key)) return CODEX_ERROR_INFO[key];
  }
  return 'other';
}

// Adapts a caller's outputSchema to the JSON Schema subset Codex Structured Outputs accepts:
// `const` becomes a single-value `enum`, and `uniqueItems` is dropped — it is not part of that
// subset and a schema declaring it is rejected by the provider before any generation happens
// (AGT002_CODEX_PROVIDER_ERROR / providerErrorCode 'other', failing in ~3s). minLength, maxLength,
// minItems and maxItems are left untouched: the real, proven-working V3 schema already relies on
// them end to end. Dropping uniqueItems from the wire never relaxes anything a caller actually
// depends on — uniqueness is enforced locally, after the response, by the caller's own strict
// validation (e.g. tender-semantic-discovery.js's canonicalizeProposal), never by the provider.
function codexCompatibleOutputSchema(value) {
  if (Array.isArray(value)) return value.map(codexCompatibleOutputSchema);
  if (!isPlainObject(value)) return value;
  const copy = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'const' || key === 'uniqueItems') continue;
    copy[key] = codexCompatibleOutputSchema(child);
  }
  if (Object.hasOwn(value, 'const')) {
    copy.enum = [codexCompatibleOutputSchema(value.const)];
  }
  return copy;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Runs one ephemeral, read-only, non-interactive turn against a Codex App
 * Server subprocess and resolves with the model's raw agentMessage content
 * plus token usage / rate-limit telemetry. Fails closed (rejects with a
 * caller-safe `error.code`) at every stage: transport errors, an account
 * that is missing or not of type `chatgpt`, a turn that does not complete
 * successfully, or a response missing the safety-relevant fields.
 */
export function createCodexAppServerClient({
  spawn = defaultSpawn,
  command = process.env.AGT002_CODEX_APP_SERVER_BIN || 'codex',
  args = ['app-server'],
  cwd = tmpdir(),
  env = process.env,
} = {}) {
  if (typeof spawn !== 'function' || !nonEmptyString(command) || !Array.isArray(args)) {
    throw new Error('El cliente de Codex App Server no está configurado.');
  }

  return {
    run({ model, policy, input, outputSchema, timeoutMs = 30_000, idempotencyKey = randomUUID(), signal, cwd: turnCwd, effort } = {}) {
      if (!nonEmptyString(model)) return Promise.reject(new Error('AGT-002 Preview requiere un modelo configurado.'));
      if (!nonEmptyString(policy)) return Promise.reject(new Error('AGT-002 Preview requiere una política (baseInstructions) configurada.'));
      if (!isPlainObject(outputSchema)) return Promise.reject(new Error('AGT-002 Preview requiere un outputSchema cerrado para turn/start.'));
      if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) return Promise.reject(new Error('El timeout de AGT-002 Preview no es válido.'));
      // Optional at this boundary (a direct/legacy caller may never send one), but a value that
      // IS present must be a real allowlisted reasoning effort before it can ever reach
      // turn/start.params.effort — fail closed, never forward a malformed value to the subprocess.
      if (effort !== undefined && !isAgt002PreviewReasoningEffort(effort)) {
        return Promise.reject(new Error('El nivel de esfuerzo de razonamiento de AGT-002 Preview no es válido.'));
      }
      if (signal?.aborted) return Promise.reject(transportError('La ejecución de AGT-002 Preview fue cancelada.', 'AGT002_CODEX_CANCELLED'));
      void idempotencyKey; // no wire-level idempotency in the official protocol; caller-side dedup only.

      const resolvedCwd = nonEmptyString(turnCwd) ? turnCwd : cwd;
      const child = spawn(command, args, { cwd: resolvedCwd, env, stdio: ['pipe', 'pipe', 'pipe'] });

      return new Promise((resolve, reject) => {
        let settled = false;
        let buffer = '';
        let nextId = 1;
        let stage = 'initialize';
        let threadId = null;
        let turnId = null;
        let lastAgentMessageText = null;
        let lastTokenUsage = null;
        let rateLimitSnapshot = null;

        const settle = (fn, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (signal) signal.removeEventListener('abort', onAbort);
          try { child.stdout?.removeAllListeners?.('data'); } catch { /* best effort */ }
          try { child.stdin?.end?.(); } catch { /* best effort */ }
          if (!child.killed) {
            try { child.kill('SIGTERM'); } catch { /* best effort */ }
            const killer = setTimeout(() => { try { if (!child.killed) child.kill('SIGKILL'); } catch { /* best effort */ } }, KILL_GRACE_MS);
            killer.unref?.();
          }
          fn(value);
        };

        const timer = setTimeout(() => {
          settle(reject, transportError('AGT-002 Preview excedió el tiempo permitido.', 'AGT002_CODEX_TIMEOUT'));
        }, timeoutMs);
        timer.unref?.();

        const send = message => {
          try { child.stdin.write(`${JSON.stringify(message)}\n`); }
          catch { settle(reject, transportError('El servicio de AGT-002 Preview no está disponible.', 'AGT002_CODEX_TRANSPORT_ERROR')); }
        };

        const onAbort = () => {
          if (nonEmptyString(threadId) && nonEmptyString(turnId)) {
            send({ id: nextId++, method: 'turn/interrupt', params: { threadId, turnId } });
          }
          settle(reject, transportError('La ejecución de AGT-002 Preview fue cancelada.', 'AGT002_CODEX_CANCELLED'));
        };
        if (signal) signal.addEventListener('abort', onAbort, { once: true });

        child.on('error', () => settle(reject, transportError('El servicio de AGT-002 Preview no está disponible.', 'AGT002_CODEX_TRANSPORT_ERROR')));
        child.on('exit', () => {
          if (!settled) settle(reject, transportError('El servicio de AGT-002 Preview finalizó sin responder.', 'AGT002_CODEX_TRANSPORT_ERROR'));
        });
        child.stderr?.on?.('data', () => { /* provider detail is never surfaced to the caller */ });

        function handleResponse(message) {
          if (stage === 'initialize') {
            if (message.error) return settle(reject, transportError('El servicio de AGT-002 Preview no está disponible.', 'AGT002_CODEX_TRANSPORT_ERROR'));
            stage = 'account';
            send({ id: nextId++, method: 'account/read', params: {} });
            return;
          }
          if (stage === 'account') {
            if (message.error) return settle(reject, transportError('El servicio de AGT-002 Preview no está disponible.', 'AGT002_CODEX_TRANSPORT_ERROR'));
            const account = message.result?.account;
            if (!isPlainObject(account)) return settle(reject, transportError('AGT-002 Preview requiere una sesión de ChatGPT iniciada; no se inició sesión automáticamente.', 'AGT002_CODEX_LOGIN_REQUIRED'));
            if (account.type !== 'chatgpt') return settle(reject, transportError('AGT-002 Preview solo puede operar con una cuenta ChatGPT autenticada, nunca con una API key.', 'AGT002_CODEX_ACCOUNT_INVALID'));
            stage = 'rateLimits';
            send({ id: nextId++, method: 'account/rateLimits/read', params: {} });
            return;
          }
          if (stage === 'rateLimits') {
            if (message.error) return settle(reject, transportError('El servicio de AGT-002 Preview no está disponible.', 'AGT002_CODEX_TRANSPORT_ERROR'));
            rateLimitSnapshot = message.result?.rateLimits ?? null;
            stage = 'threadStart';
            send({
              id: nextId++,
              method: 'thread/start',
              params: {
                ephemeral: true,
                sandbox: 'read-only',
                approvalPolicy: 'never',
                cwd: resolvedCwd,
                model,
                baseInstructions: policy,
              },
            });
            return;
          }
          if (stage === 'threadStart') {
            if (message.error) return settle(reject, transportError('El servicio de AGT-002 Preview no está disponible.', 'AGT002_CODEX_TRANSPORT_ERROR'));
            threadId = message.result?.thread?.id;
            if (!nonEmptyString(threadId)) return settle(reject, transportError('La respuesta de AGT-002 Preview no tiene una estructura segura.', 'AGT002_CODEX_INVALID_RESPONSE'));
            stage = 'turnStart';
            send({
              id: nextId++,
              method: 'turn/start',
              params: {
                threadId,
                input: [{ type: 'text', text: JSON.stringify(input ?? {}) }],
                outputSchema: codexCompatibleOutputSchema(outputSchema),
                // v2 TurnStartParams.effort: overrides reasoning effort for this (and subsequent)
                // turns — this is the actual root-cause fix, so this key is never optional-away
                // by accident. `effort` is `undefined` when the caller genuinely never set one
                // (a direct/legacy caller), in which case JSON.stringify drops the key entirely
                // and the account/CLI default applies exactly as before this change.
                effort,
              },
            });
            return;
          }
          if (stage === 'turnStart') {
            if (message.error) return settle(reject, transportError('El servicio de AGT-002 Preview no está disponible.', 'AGT002_CODEX_TRANSPORT_ERROR'));
            turnId = message.result?.turn?.id;
            if (!nonEmptyString(turnId)) return settle(reject, transportError('La respuesta de AGT-002 Preview no tiene una estructura segura.', 'AGT002_CODEX_INVALID_RESPONSE'));
            stage = 'running';
            return;
          }
          // stage === 'running': only turn/interrupt's ack can still arrive here, and it
          // carries no further protocol step; completion is entirely notification-driven.
        }

        function handleNotification(message) {
          if (stage !== 'running') return;
          if (message.params?.threadId !== threadId) return;
          if (message.method === 'item/completed') {
            const item = message.params?.item;
            if (item?.type === 'agentMessage' && typeof item.text === 'string') lastAgentMessageText = item.text;
            return;
          }
          if (message.method === 'thread/tokenUsage/updated') {
            lastTokenUsage = message.params?.tokenUsage ?? null;
            return;
          }
          if (message.method === 'turn/completed') {
            const turn = message.params?.turn;
            const providerStatus = turnStatusType(turn?.status);
            if (providerStatus !== 'completed') {
              const providerErrorCode = codexErrorInfoType(turn?.error?.codexErrorInfo)
                || safeProtocolAtom(turn?.error?.code);
              settle(reject, transportError(
                'El servicio de AGT-002 Preview devolvió un error.',
                'AGT002_CODEX_PROVIDER_ERROR',
                { providerStatus, providerErrorCode },
              ));
              return;
            }
            const total = lastTokenUsage?.total;
            const inputTokens = total?.inputTokens;
            const outputTokens = total?.outputTokens;
            if (typeof lastAgentMessageText !== 'string'
              || !Number.isInteger(inputTokens) || inputTokens < 0
              || !Number.isInteger(outputTokens) || outputTokens < 0) {
              settle(reject, transportError('La respuesta de AGT-002 Preview no tiene una estructura segura.', 'AGT002_CODEX_INVALID_RESPONSE'));
              return;
            }
            settle(resolve, {
              content: lastAgentMessageText,
              usage: { input_tokens: inputTokens, output_tokens: outputTokens },
              rate_limit: rateLimitSnapshot,
              // Echoes back the exact effort this code path put on turn/start.params (or `null`
              // when the caller never pinned one). A stale bridge/codex client predating this
              // fix never emits this field at all, which is exactly the signal the Hetzner
              // bridge client uses to fail closed instead of silently reverting to whatever
              // default effort the account/CLI would otherwise apply.
              effort_ack: isAgt002PreviewReasoningEffort(effort) ? effort : null,
            });
          }
        }

        child.stdout.on('data', chunk => {
          buffer += chunk.toString('utf8');
          let index;
          while ((index = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, index);
            buffer = buffer.slice(index + 1);
            if (settled) return;
            if (!line.trim()) continue;
            let message;
            try { message = JSON.parse(line); } catch { continue; }
            if (!isPlainObject(message)) continue;
            if (Object.hasOwn(message, 'id') && (Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error'))) {
              handleResponse(message);
            } else if (typeof message.method === 'string') {
              handleNotification(message);
            }
          }
        });

        try {
          child.stdin.write(`${JSON.stringify({ id: nextId++, method: 'initialize', params: { clientInfo: { name: AGT002_CODEX_CLIENT_NAME, version: AGT002_CODEX_CLIENT_VERSION } } })}\n`);
        } catch {
          settle(reject, transportError('El servicio de AGT-002 Preview no está disponible.', 'AGT002_CODEX_TRANSPORT_ERROR'));
        }
      });
    },
  };
}

/**
 * Starts a real ChatGPT device-code sign-in against a Codex App Server
 * subprocess (`account/login/start` with `{ type: 'chatgptDeviceCode' }`).
 *
 * This is a SEPARATE, human-gated operational flow. It is intentionally not
 * called from anywhere in the AGT-002 Preview analysis path (engine/runtime
 * fail closed with AGT002_CODEX_LOGIN_REQUIRED instead of ever reaching
 * here) — it exists only for an explicit, human-triggered ops action (for
 * example a runbook or an admin-only CLI) to complete outside of any
 * automated request handler.
 */
export function requestAgt002CodexDeviceCodeLogin({
  spawn = defaultSpawn,
  command = process.env.AGT002_CODEX_APP_SERVER_BIN || 'codex',
  args = ['app-server'],
  cwd = tmpdir(),
  env = process.env,
  timeoutMs = 15_000,
} = {}) {
  if (typeof spawn !== 'function' || !nonEmptyString(command) || !Array.isArray(args)) {
    return Promise.reject(new Error('El cliente de Codex App Server no está configurado.'));
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) return Promise.reject(new Error('El timeout de inicio de sesión no es válido.'));

  const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });

  return new Promise((resolve, reject) => {
    let settled = false;
    let buffer = '';
    let nextId = 1;
    let stage = 'initialize';

    const cleanupTimer = () => clearTimeout(timer);
    const failSafe = (message, code) => {
      if (settled) return;
      settled = true;
      cleanupTimer();
      try { child.stdout?.removeAllListeners?.('data'); } catch { /* best effort */ }
      try { if (!child.killed) child.kill('SIGTERM'); } catch { /* best effort */ }
      reject(transportError(message, code));
    };

    const timer = setTimeout(() => failSafe('El inicio de sesión de ChatGPT excedió el tiempo permitido.', 'AGT002_CODEX_TIMEOUT'), timeoutMs);
    timer.unref?.();

    const send = message => {
      try { child.stdin.write(`${JSON.stringify(message)}\n`); }
      catch { failSafe('El servicio de AGT-002 Preview no está disponible.', 'AGT002_CODEX_TRANSPORT_ERROR'); }
    };

    child.on('error', () => failSafe('El servicio de AGT-002 Preview no está disponible.', 'AGT002_CODEX_TRANSPORT_ERROR'));
    child.on('exit', () => { if (!settled) failSafe('El servicio de AGT-002 Preview finalizó sin responder.', 'AGT002_CODEX_TRANSPORT_ERROR'); });
    child.stderr?.on?.('data', () => { /* provider detail is never surfaced to the caller */ });

    child.stdout.on('data', chunk => {
      buffer += chunk.toString('utf8');
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (settled) return;
        if (!line.trim()) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (!isPlainObject(message) || !Object.hasOwn(message, 'id')) continue;

        if (stage === 'initialize') {
          if (message.error) { failSafe('El servicio de AGT-002 Preview no está disponible.', 'AGT002_CODEX_TRANSPORT_ERROR'); return; }
          stage = 'login';
          send({ id: nextId++, method: 'account/login/start', params: { type: 'chatgptDeviceCode' } });
          continue;
        }
        if (stage === 'login') {
          if (message.error) { failSafe('No fue posible iniciar el inicio de sesión de ChatGPT.', 'AGT002_CODEX_TRANSPORT_ERROR'); return; }
          const result = message.result;
          if (!isPlainObject(result) || result.type !== 'chatgptDeviceCode' || !nonEmptyString(result.loginId) || !nonEmptyString(result.userCode) || !nonEmptyString(result.verificationUrl)) {
            failSafe('La respuesta de inicio de sesión de ChatGPT no tiene una estructura segura.', 'AGT002_CODEX_INVALID_RESPONSE');
            return;
          }
          settled = true;
          cleanupTimer();
          try { child.stdout?.removeAllListeners?.('data'); } catch { /* best effort */ }
          resolve({
            loginId: result.loginId,
            userCode: result.userCode,
            verificationUrl: result.verificationUrl,
            async cancel() {
              try { child.stdin.write(`${JSON.stringify({ id: 'cancel', method: 'account/login/cancel', params: { loginId: result.loginId } })}\n`); } catch { /* best effort */ }
              try { child.kill('SIGTERM'); } catch { /* best effort */ }
            },
          });
        }
      }
    });

    send({ id: nextId++, method: 'initialize', params: { clientInfo: { name: AGT002_CODEX_CLIENT_NAME, version: AGT002_CODEX_CLIENT_VERSION } } });
  });
}
