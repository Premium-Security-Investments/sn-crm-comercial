import { randomUUID, createHash } from 'node:crypto';
import { spawn as defaultSpawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Cliente del proveedor de AGT-003. Lanza un turno efímero, no interactivo y
 * sin herramientas de Claude Code (`claude -p`) y resuelve con el objeto
 * estructurado devuelto por el modelo más su consumo de tokens.
 *
 * Autenticación: el subproceso lee su PROPIA sesión OAuth desde
 * CLAUDE_CONFIG_DIR. Este módulo no posee, no lee, no reenvía y no registra
 * ninguna credencial; al contrario, borra del entorno del hijo cualquier clave
 * de API o redirección de proveedor que pudiera existir en el host, de modo que
 * un turno sólo puede completarse con la sesión OAuth aprobada. Si esa sesión
 * falta o caducó, falla cerrado con AGT003_CLAUDE_LOGIN_REQUIRED: nunca inicia
 * sesión por su cuenta ni cae hacia una API key.
 */

/** Techo duro de stdout: por encima se aborta el turno sin citar la salida. */
export const AGT003_CLAUDE_MAX_STDOUT_BYTES = 262_144;

/**
 * Techo del `--json-schema` serializado, medido en bytes UTF-8. Linux limita
 * cada argumento de `execve` a MAX_ARG_STRLEN (32 páginas = 131072 bytes) y el
 * esquema viaja como un único argumento: sin este techo un esquema grande no
 * daría un error legible sino un E2BIG del kernel en el spawn. 64 KiB deja el
 * argumento holgadamente por debajo del límite.
 */
export const AGT003_CLAUDE_MAX_SCHEMA_BYTES = 65_536;

/**
 * Claves que jamás pueden llegar al subproceso: credenciales directas y
 * conmutadores que redirigirían el turno a otro proveedor o pasarela.
 */
export const AGT003_CLAUDE_FORBIDDEN_ENV_KEYS = Object.freeze([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_VERTEX_BASE_URL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'AWS_BEARER_TOKEN_BEDROCK',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_API_KEY_HELPER',
  'CLAUDE_CODE_OAUTH_TOKEN',
]);

const FORBIDDEN = new Set(AGT003_CLAUDE_FORBIDDEN_ENV_KEYS);

/** Subtipos de error del proveedor que significan «no hay sesión utilizable». */
const LOGIN_SUBTYPES = new Set([
  'login_required',
  'authentication_error',
  'oauth_token_expired',
  'unauthorized',
  'invalid_api_key',
]);

const KILL_GRACE_MS = 200;
const FLUSH_GRACE_MS = 250;
const SESSION_LIMIT_PHRASE = "you've hit your session limit";
const STDERR_TRACE_CHAR_LIMIT = 16_384;
const REDACTED = '[REDACTED]';

/**
 * Redacta un volcado de stderr sólo para la traza interna: nunca se usa para
 * construir el error que ve el llamador. El texto se acota primero para no
 * cargar en memoria ni procesar con regex un stderr arbitrariamente grande.
 */
function redactStderrForTrace(text) {
  if (!text) return '';
  let out = text.slice(0, STDERR_TRACE_CHAR_LIMIT);
  out = out.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, `Bearer ${REDACTED}`);
  out = out.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED);
  out = out.replace(
    /\b(token|secret|authorization|api[_-]?key|password)\b\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/gi,
    (_match, key) => `${key}=${REDACTED}`,
  );
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, REDACTED);
  out = out.replace(/\S{80,}/g, REDACTED);
  return out;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function failure(message, code, providerErrorCode) {
  const error = new Error(message);
  error.code = code;
  if (providerErrorCode) error.providerErrorCode = providerErrorCode;
  return error;
}

/** Sólo un átomo corto y acotado del proveedor puede cruzar hacia el llamador. */
function safeProviderAtom(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_.-]{0,63}$/.test(normalized) ? normalized : undefined;
}

function providerFailure(parsed) {
  // Claude CLI puede marcar el envelope como `subtype: success` y a la vez
  // `is_error: true`. Sólo la frase operativa conocida se clasifica; ninguna
  // otra parte de `result` cruza esta frontera.
  if (typeof parsed?.result === 'string' && parsed.result.toLowerCase().includes(SESSION_LIMIT_PHRASE)) {
    return failure('La sesión de Claude Code alcanzó temporalmente su límite.', 'AGT003_CLAUDE_SESSION_LIMIT');
  }
  const subtype = safeProviderAtom(parsed?.subtype);
  const atom = subtype && subtype !== 'success'
    ? subtype
    : safeProviderAtom(parsed?.error?.type);
  if (atom && LOGIN_SUBTYPES.has(atom)) {
    return failure('AGT-003 requiere una sesión de Claude Code iniciada; no se inició sesión automáticamente.', 'AGT003_CLAUDE_LOGIN_REQUIRED');
  }
  return failure('El servicio de AGT-003 devolvió un error.', 'AGT003_CLAUDE_PROVIDER_ERROR', atom);
}

/**
 * Clasificador cerrado sobre el `result` del proveedor: sólo produce átomos
 * booleanos/numéricos derivados (nunca el texto ni fragmentos) para que la
 * traza pueda registrar evidencia sin persistir el `result` en sí.
 */
const AGT003_CLASSIFIER_PATTERNS = {
  mentions_schema: /\bschema\b/i,
  mentions_json: /\bjson\b/i,
  mentions_invalid: /\binvalid\b/i,
  mentions_length_or_tokens: /\b(?:length|tokens?)\b/i,
  mentions_rate_limit: /\brate[\s_-]?limit/i,
  mentions_overload: /\boverload(?:ed)?\b/i,
  mentions_auth_or_permission: /\b(?:auth(?:entication|orization)?|permission)\b/i,
  mentions_model: /\bmodel\b/i,
  mentions_timeout: /\btimeout\b/i,
};

const HTTP_STATUS_PATTERN = /\b(\d+)\b/g;

function classifyProviderResult(result) {
  const fields = {};
  for (const [field, pattern] of Object.entries(AGT003_CLASSIFIER_PATTERNS)) {
    fields[field] = typeof result === 'string' && pattern.test(result);
  }
  let embeddedHttpStatus = null;
  if (typeof result === 'string') {
    HTTP_STATUS_PATTERN.lastIndex = 0;
    let match;
    while ((match = HTTP_STATUS_PATTERN.exec(result))) {
      const status = Number(match[1]);
      if (status >= 400 && status <= 599) { embeddedHttpStatus = status; break; }
    }
  }
  fields.embedded_http_status = embeddedHttpStatus;
  return fields;
}

function sanitizeEnv(source) {
  const sanitized = {};
  for (const [key, value] of Object.entries(source ?? {})) {
    if (FORBIDDEN.has(key)) continue;
    // Toda la familia ANTHROPIC_* queda fuera: cubre claves y redirecciones
    // futuras sin depender de mantener la lista explícita al día.
    if (key.startsWith('ANTHROPIC_')) continue;
    if (typeof value === 'string' && value.includes('sk-ant-')) continue;
    sanitized[key] = value;
  }
  return sanitized;
}

export function createAgt003ClaudeClient({
  spawn = defaultSpawn,
  command = 'claude',
  cwd = tmpdir(),
  env = process.env,
  persistTrace,
} = {}) {
  if (typeof spawn !== 'function' || !nonEmptyString(command)) {
    throw new Error('El cliente de AGT-003 no está configurado.');
  }
  // El cwd es fijo, absoluto y decidido por el proceso local. Ningún llamador
  // puede redirigirlo por petición.
  if (!nonEmptyString(cwd) || !isAbsolute(cwd)) {
    throw new Error('El cliente de AGT-003 requiere un cwd absoluto y fijo.');
  }
  const baseEnv = sanitizeEnv(env);

  return {
    run({ model, policy, input, outputSchema, timeoutMs = 30_000, idempotencyKey = randomUUID(), signal, cwd: callerCwd } = {}) {
      if (!nonEmptyString(model)) return Promise.reject(new Error('AGT-003 requiere un modelo configurado.'));
      if (!nonEmptyString(policy)) return Promise.reject(new Error('AGT-003 requiere una política configurada.'));
      if (!isRecord(input)) return Promise.reject(new Error('AGT-003 requiere una entrada estructurada.'));
      if (!isRecord(outputSchema)) return Promise.reject(new Error('AGT-003 requiere un outputSchema cerrado.'));
      if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) return Promise.reject(new Error('El timeout de AGT-003 no es válido.'));
      if (signal?.aborted) return Promise.reject(failure('La ejecución de AGT-003 fue cancelada.', 'AGT003_CLAUDE_CANCELLED'));
      void idempotencyKey; // el protocolo no tiene idempotencia de wire; la deduplicación es del llamador.
      void callerCwd; // se acepta y se descarta: el cwd nunca lo elige la petición.

      let serializedSchema;
      try { serializedSchema = JSON.stringify(outputSchema); }
      catch { return Promise.reject(new Error('AGT-003 requiere un outputSchema cerrado.')); }
      if (typeof serializedSchema !== 'string') return Promise.reject(new Error('AGT-003 requiere un outputSchema cerrado.'));
      // El techo se mide en bytes UTF-8, no en caracteres: el límite del kernel
      // también lo es. El esquema rechazado nunca se cita en el error.
      const schemaBytes = Buffer.byteLength(serializedSchema, 'utf8');
      if (schemaBytes > AGT003_CLAUDE_MAX_SCHEMA_BYTES) {
        return Promise.reject(failure('El outputSchema de AGT-003 excede el tamaño permitido.', 'AGT003_CLAUDE_SCHEMA_TOO_LARGE'));
      }

      const serializedInput = JSON.stringify(input);
      const stdinBytes = Buffer.byteLength(serializedInput, 'utf8');

      const args = [
        '-p',
        '--model', model,
        '--output-format', 'json',
        '--json-schema', serializedSchema,
        // Sin herramientas, sin sesión persistida y en modo seguro: el turno no
        // puede leer ni escribir el disco del puente. No se usa --bare porque
        // impediría al subproceso leer su propia sesión OAuth.
        '--tools', '',
        '--no-session-persistence',
        '--safe-mode',
        '--system-prompt', policy,
      ];
      const argvBytes = [command, ...args].reduce(
        (sum, part) => sum + Buffer.byteLength(String(part), 'utf8'),
        0,
      );

      return new Promise((resolve, reject) => {
        let child;
        try {
          child = spawn(command, args, { cwd, env: baseEnv, stdio: ['pipe', 'pipe', 'pipe'] });
        } catch {
          reject(failure('El servicio de AGT-003 no está disponible.', 'AGT003_CLAUDE_TRANSPORT_ERROR'));
          return;
        }
        const tSpawn = Date.now();

        let settled = false;
        let stdout = '';
        let stdoutBytes = 0;
        let stdoutEnded = false;
        let exited = false;
        let exitCode = null;
        let exitSignal = null;
        let flushTimer = null;
        let tFirstStdout = null;
        let tFirstStderr = null;
        let tClose = null;
        let stderrBytes = 0;
        let stderrCaptured = '';
        const stdoutIsStream = typeof child.stdout?.pipe === 'function';
        // Sólo átomos cortos y el hash/tamaño del `result` pueden cruzar hacia
        // la traza; el texto del `result` en sí nunca se persiste.
        let providerIsError = false;
        let providerSubtype = null;
        let providerErrorType = null;
        let providerResultBytes = 0;
        let providerResultSha256 = null;
        let providerResultClassification = 'absent';
        let classifierFields = classifyProviderResult(null);

        const settle = (fn, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (flushTimer) clearTimeout(flushTimer);
          if (signal) signal.removeEventListener('abort', onAbort);
          try { child.stdout?.removeAllListeners?.('data'); } catch { /* best effort */ }
          try { child.stderr?.removeAllListeners?.('data'); } catch { /* best effort */ }
          try { child.stdin?.end?.(); } catch { /* best effort */ }
          if (!child.killed) {
            try { child.kill('SIGTERM'); } catch { /* best effort */ }
            const killer = setTimeout(() => { try { if (!child.killed) child.kill('SIGKILL'); } catch { /* best effort */ } }, KILL_GRACE_MS);
            killer.unref?.();
          }
          if (typeof persistTrace === 'function') {
            try {
              persistTrace({
                t_spawn: tSpawn,
                t_first_stdout_byte: tFirstStdout,
                t_first_stderr_byte: tFirstStderr,
                t_close: tClose,
                exit_code: exitCode,
                exit_signal: exitSignal,
                stdout_bytes: stdoutBytes,
                stderr_bytes: stderrBytes,
                stderr_redacted: redactStderrForTrace(stderrCaptured),
                schema_bytes: schemaBytes,
                stdin_bytes: stdinBytes,
                argv_bytes: argvBytes,
                provider_is_error: providerIsError,
                provider_subtype: providerSubtype,
                provider_error_type: providerErrorType,
                provider_result_bytes: providerResultBytes,
                provider_result_sha256: providerResultSha256,
                provider_result_classification: providerResultClassification,
                ...classifierFields,
              });
            } catch { /* la traza nunca puede hacer fallar el turno */ }
          }
          fn(value);
        };

        // El temporizador no se desreferencia: un turno vencido debe terminar
        // siempre el subproceso, aunque nada más mantenga vivo el bucle.
        const timer = setTimeout(() => {
          settle(reject, failure('AGT-003 excedió el tiempo permitido.', 'AGT003_CLAUDE_TIMEOUT'));
        }, timeoutMs);

        const onAbort = () => settle(reject, failure('La ejecución de AGT-003 fue cancelada.', 'AGT003_CLAUDE_CANCELLED'));
        if (signal) signal.addEventListener('abort', onAbort, { once: true });

        const finalize = () => {
          if (settled) return;
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }

          const raw = stdout.trim();
          let parsed = null;
          if (raw) { try { parsed = JSON.parse(raw); } catch { parsed = null; } }
          if (!isRecord(parsed)) {
            // Sin JSON interpretable: un cierre limpio es una respuesta inválida;
            // un cierre con código distinto de cero es un fallo de transporte.
            settle(reject, exitCode === 0
              ? failure('La respuesta de AGT-003 no tiene una estructura segura.', 'AGT003_CLAUDE_INVALID_RESPONSE')
              : failure('El servicio de AGT-003 no está disponible.', 'AGT003_CLAUDE_TRANSPORT_ERROR'));
            return;
          }
          if (parsed.is_error === true || exitCode !== 0) {
            providerIsError = parsed.is_error === true;
            providerSubtype = safeProviderAtom(parsed.subtype) ?? null;
            providerErrorType = safeProviderAtom(parsed.error?.type) ?? null;
            if (typeof parsed.result === 'string') {
              providerResultBytes = Buffer.byteLength(parsed.result, 'utf8');
              providerResultSha256 = createHash('sha256').update(parsed.result, 'utf8').digest('hex');
              providerResultClassification = parsed.result.toLowerCase().includes(SESSION_LIMIT_PHRASE)
                ? 'session_limit'
                : 'unclassified_text';
              classifierFields = classifyProviderResult(parsed.result);
            }
            settle(reject, providerFailure(parsed));
            return;
          }

          const structured = parsed.structured_output;
          const inputTokens = parsed.usage?.input_tokens;
          const outputTokens = parsed.usage?.output_tokens;
          if (!isRecord(structured)
            || !Number.isInteger(inputTokens) || inputTokens < 0
            || !Number.isInteger(outputTokens) || outputTokens < 0) {
            settle(reject, failure('La respuesta de AGT-003 no tiene una estructura segura.', 'AGT003_CLAUDE_INVALID_RESPONSE'));
            return;
          }
          settle(resolve, {
            content: JSON.stringify(structured),
            usage: { input_tokens: inputTokens, output_tokens: outputTokens },
            rate_limit: null,
          });
        };

        const noteExit = (code, exitedSignal) => {
          exited = true;
          if (typeof code === 'number') exitCode = code;
          if (typeof exitedSignal === 'string') exitSignal = exitedSignal;
          if (settled) return;
          if (!stdoutIsStream || stdoutEnded) { setImmediate(finalize); return; }
          if (!flushTimer) {
            // En un subproceso real 'exit' puede preceder a los últimos
            // fragmentos de stdout; se espera al cierre del flujo con una
            // gracia acotada para no interpretar una salida truncada.
            flushTimer = setTimeout(finalize, FLUSH_GRACE_MS);
            flushTimer.unref?.();
          }
        };

        child.on('error', () => settle(reject, failure('El servicio de AGT-003 no está disponible.', 'AGT003_CLAUDE_TRANSPORT_ERROR')));
        child.on('exit', noteExit);
        child.on('close', (code, closeSignal) => { stdoutEnded = true; tClose = Date.now(); noteExit(code, closeSignal); });

        // stderr se cuenta y se captura (acotado) sólo para la traza interna;
        // nunca se acumula sin límite ni se adjunta al error del llamador.
        child.stderr?.on?.('data', chunk => {
          if (tFirstStderr === null) tFirstStderr = Date.now();
          const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
          stderrBytes += Buffer.byteLength(text, 'utf8');
          if (stderrCaptured.length < STDERR_TRACE_CHAR_LIMIT) {
            stderrCaptured = (stderrCaptured + text).slice(0, STDERR_TRACE_CHAR_LIMIT);
          }
        });
        child.stdin?.on?.('error', () => { /* el subproceso puede cerrar stdin antes de leerlo */ });

        child.stdout?.on?.('end', () => { stdoutEnded = true; if (exited) finalize(); });
        child.stdout.on('data', chunk => {
          if (settled) return;
          if (tFirstStdout === null) tFirstStdout = Date.now();
          const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
          stdoutBytes += Buffer.byteLength(text, 'utf8');
          if (stdoutBytes > AGT003_CLAUDE_MAX_STDOUT_BYTES) {
            stdout = '';
            settle(reject, failure('La respuesta de AGT-003 excede el tamaño permitido.', 'AGT003_CLAUDE_OUTPUT_TOO_LARGE'));
            return;
          }
          stdout += text;
        });

        // La entrada no confiable del CRM viaja sólo por stdin, nunca por argv:
        // así no aparece en la tabla de procesos ni en ningún registro del host.
        try {
          child.stdin.write(serializedInput);
          child.stdin.end();
        } catch {
          settle(reject, failure('El servicio de AGT-003 no está disponible.', 'AGT003_CLAUDE_TRANSPORT_ERROR'));
        }
      });
    },
  };
}
