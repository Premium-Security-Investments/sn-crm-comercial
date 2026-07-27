# Puente temporal de runtime AGT-002 en Hetzner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sustituir el seam exacto `agt002-preview-runtime.js:55-58` (`createCodexAppServerClient` local vía `child_process.spawn`) por un cliente HTTP drop-in que hable, por HMAC + TLS, con un servicio Node persistente en Hetzner que sí puede sostener `codex app-server` sobre una sesión ChatGPT autenticada, sin tocar `agt002-preview-engine.js`, `agt002-preview-contract.js`, `agt002-preview-persistence.js` ni el endpoint de `server/index.js`.

**Architecture:** Módulos nuevos y pequeños de responsabilidad única (firma canónica HMAC, almacén de nonce/ventana de tiempo, logging sanitizado, autenticación de petición, servidor HTTP Hetzner, cliente HTTP Vercel) que se componen en capas; el servidor Hetzner reutiliza sin cambios el `createCodexAppServerClient` ya existente como dependencia inyectada, de modo que el protocolo JSON-line de Codex App Server nunca se reimplementa. La activación real permanece detrás de un kill switch apagado por defecto y de gates humanos explícitos por fase (sección 12 del diseño); ninguna tarea de este plan ejecuta un despliegue, un login OAuth real ni una llamada de red real contra Hetzner.

**Tech Stack:** Node.js (ESM), `node:crypto`, `node:http`, `node:assert/strict`, Node como runner de pruebas (`node tests/archivo.test.mjs`), cero dependencias npm nuevas, Caddy + systemd + contenedor Node solo como artefactos de configuración revisables (no aplicados).

## Global Constraints

- Vigencia máxima del puente: 30 días naturales desde su activación real; vencido el plazo, migración a AWS es obligatoria, no opcional (sección 15 del diseño).
- Concurrencia en Hetzner = 1 en todo momento (mutex de proceso), segunda barrera independiente de `AGT002_PREVIEW_MAX_CONCURRENT` en Supabase.
- Cuota diaria durable = 5 ejecuciones/día, contada en Supabase (`AGT002_PREVIEW_DAILY_MAX_RUNS=5`), sin contador propio en Hetzner.
- Ventana de validez de timestamp: `|now - timestamp| ≤ 30s`.
- Nonce: cadena opaca de un solo uso, ≥16 bytes de entropía, recordada en memoria al menos 90s (ventana + margen de reloj).
- Secreto HMAC compartido: ≥32 bytes, nunca en código fuente, fixtures, logs ni mensajería.
- Tamaño máximo de cuerpo y de respuesta: 262.144 bytes (256 KiB) cada uno.
- Sin reintentos automáticos de transporte ante timeout; un timeout no se reintenta.
- Sin allowlist de IP, sin mTLS, sin gateway Cloudflare en esta fase (YAGNI explícito, secciones 4 y 7.4–7.5 del diseño).
- Kill switch: dos mecanismos independientes (variable de entorno ausente en Vercel; servicio detenido en Hetzner), **apagado por defecto**, cualquiera de los dos basta para desactivar el puente.
- `AI_ANALYSIS_RUN` sigue siendo un gate por rol en `access-control.js` (nunca una lista de nombres codificada); cualquier auditoría de elegibilidad se hace por rol/RBAC, nunca hardcodeando "Katherine"/"Juan" en código.
- Ningún payload ni respuesta del modelo se escribe a disco en Hetzner; vive solo en memoria durante la petición.
- Logs sanitizados en ambos lados: únicamente `correlation_id`, código de resultado, latencia y `usage` (tokens); nunca `input`, `content`, encabezados de autenticación, el secreto HMAC ni datos de la sesión OAuth.
- `cwd` nunca viaja por la red; el servidor Hetzner genera su propio directorio de trabajo efímero por petición y rechaza cualquier intento de imponerlo desde el body.
- `signal` (AbortSignal) nunca se serializa; la cancelación se expresa a nivel de conexión (cierre de socket → `turn/interrupt` + kill del subproceso).
- Ningún componente decide, aprueba ni automatiza GO/NO GO, firma, envío o presentación; `human_review_required: true` se mantiene sin excepción.
- Fase 4 (documentos reales) permanece bloqueada por defecto; ningún dato real de licitaciones se usa en ninguna tarea de este plan.
- Cero dependencias npm nuevas: solo `node:crypto`, `node:http`, `node:child_process` (este último ya en uso por `agt002-preview-codex-client.js`, sin cambios).
- Ninguna tarea de código de este plan hace push, deploy ni activa un endpoint real. Excepción autorizada el 2026-07-27: el agente puede ejecutar los pasos 1–4 de la Tarea 13 para crear el usuario aislado, instalar Codex CLI e iniciar/verificar el device login humano solicitado por Juan. El código efímero se entrega únicamente en una conversación privada, nunca en un canal grupal. La Tarea 13 paso 5 (servicio/Caddy) y toda activación permanecen bloqueadas por gates separados.

---

### Task 0: Congelar el contrato — reconciliar `schema_version` (Fase 0, riesgo Crítico 3)

**Files:**
- Modify: `agt002-tender-adapter.js:91`
- Modify: `tests/agt002-tender-analysis-contract.test.mjs`

**Interfaces:**
- Produces: `validateAgt002TenderAnalysisEnvelope(value)` acepta `schema_version === '2.0-preview.1'` (antes exigía `'2.0-draft'`), sin relajar ningún otro campo del `ENVELOPE_KEYS` cerrado ni el enum de `recommendation`.

- [ ] **Step 1: Prueba roja — el adaptador debe rechazar el envelope real hoy**

Añadir a `tests/agt002-tender-analysis-contract.test.mjs`:

```js
function testAcceptsPreviewSchemaVersion() {
  const envelope = { ...validEnvelopeFixture(), schema_version: '2.0-preview.1' };
  const result = validateAgt002TenderAnalysisEnvelope(envelope);
  assert.equal(result.schema_version, '2.0-preview.1');
}

function testStillRejectsUnknownSchemaVersion() {
  const envelope = { ...validEnvelopeFixture(), schema_version: '1.0-legacy' };
  assert.throws(() => validateAgt002TenderAnalysisEnvelope(envelope), /versión de esquema/i);
}

testAcceptsPreviewSchemaVersion();
testStillRejectsUnknownSchemaVersion();
```

(`validEnvelopeFixture()` ya existe en ese archivo de prueba y hoy construye un envelope con `schema_version: '2.0-draft'`; reutilizarlo tal cual y solo sobrescribir el campo bajo prueba.)

- [ ] **Step 2: Ejecutar y comprobar fallo**

Run: `node tests/agt002-tender-analysis-contract.test.mjs`
Expected: FAIL en `testAcceptsPreviewSchemaVersion` — `Error: La versión de esquema AGT-002 no es compatible.`

- [ ] **Step 3: Implementar la reconciliación**

En `agt002-tender-adapter.js:91`, cambiar exactamente:

```js
if (value.schema_version !== '2.0-draft') throw new Error('La versión de esquema AGT-002 no es compatible.');
```

por:

```js
if (value.schema_version !== '2.0-preview.1') throw new Error('La versión de esquema AGT-002 no es compatible.');
```

No tocar ningún otro campo de `ENVELOPE_KEYS`, `RECOMMENDATIONS` ni la validación de `usage`/`findings`.

- [ ] **Step 4: Verificar y correr regresión de paridad de esquema**

Run: `node tests/agt002-tender-analysis-contract.test.mjs`
Expected: PASS (ambas pruebas).

Run adicional (no debe romperse, ya que `agt002-preview-contract.js` produce `2.0-preview.1` hoy):
```bash
node tests/agt002-preview-contract.test.mjs
node tests/agt002-preview-engine.test.mjs
```
Expected: PASS sin cambios de comportamiento.

- [ ] **Step 5: Commit**

```bash
git add agt002-tender-adapter.js tests/agt002-tender-analysis-contract.test.mjs
git commit -m "fix(agt002): reconcile envelope schema_version to 2.0-preview.1"
```

---

### Task 1: Firma canónica HMAC-SHA256

**Files:**
- Create: `agt002-hetzner-bridge-signing.js`
- Create: `tests/agt002-hetzner-bridge-signing.test.mjs`

**Interfaces:**
- Produces: `sha256Hex(input)`, `buildCanonicalString({ method, path, bodySha256Hex, timestamp, nonce })`, `signCanonicalString(secret, canonical)`, `verifySignatureConstantTime(expectedHex, providedHex)`.
- Consumido por: Task 4 (`agt002-hetzner-bridge-auth.js`), Task 6 (`agt002-hetzner-bridge-client.js`).

- [ ] **Step 1: Prueba roja**

```js
// tests/agt002-hetzner-bridge-signing.test.mjs
import assert from 'node:assert/strict';
import { sha256Hex, buildCanonicalString, signCanonicalString, verifySignatureConstantTime } from '../agt002-hetzner-bridge-signing.js';

function testCanonicalStringOrderAndSeparators() {
  const canonical = buildCanonicalString({ method: 'POST', path: '/v1/agt002-preview/run', bodySha256Hex: 'abc123', timestamp: '1700000000', nonce: 'nonce-value' });
  assert.equal(canonical, 'POST\n/v1/agt002-preview/run\nabc123\n1700000000\nnonce-value');
}

function testSha256HexIsDeterministicAndLowercase() {
  const digest = sha256Hex('{"a":1}');
  assert.equal(digest, sha256Hex('{"a":1}'));
  assert.match(digest, /^[a-f0-9]{64}$/);
}

function testSignAndVerifyRoundTrip() {
  const secret = 'a'.repeat(32);
  const canonical = buildCanonicalString({ method: 'POST', path: '/v1/agt002-preview/run', bodySha256Hex: sha256Hex('{}'), timestamp: '1700000000', nonce: 'n'.repeat(16) });
  const signature = signCanonicalString(secret, canonical);
  assert.equal(verifySignatureConstantTime(signature, signature), true);
}

function testVerifyRejectsOneByteDifference() {
  const secret = 'a'.repeat(32);
  const canonical = buildCanonicalString({ method: 'POST', path: '/v1/agt002-preview/run', bodySha256Hex: sha256Hex('{}'), timestamp: '1700000000', nonce: 'n'.repeat(16) });
  const signature = signCanonicalString(secret, canonical);
  const tampered = signature.slice(0, -1) + (signature.at(-1) === '0' ? '1' : '0');
  assert.equal(verifySignatureConstantTime(signature, tampered), false);
}

function testVerifyRejectsBodyTamperedAfterSigning() {
  const secret = 'a'.repeat(32);
  const canonicalOriginal = buildCanonicalString({ method: 'POST', path: '/v1/agt002-preview/run', bodySha256Hex: sha256Hex('{"n":1}'), timestamp: '1700000000', nonce: 'n'.repeat(16) });
  const signature = signCanonicalString(secret, canonicalOriginal);
  const canonicalTamperedBody = buildCanonicalString({ method: 'POST', path: '/v1/agt002-preview/run', bodySha256Hex: sha256Hex('{"n":2}'), timestamp: '1700000000', nonce: 'n'.repeat(16) });
  const expectedForTamperedBody = signCanonicalString(secret, canonicalTamperedBody);
  assert.equal(verifySignatureConstantTime(expectedForTamperedBody, signature), false);
}

testCanonicalStringOrderAndSeparators();
testSha256HexIsDeterministicAndLowercase();
testSignAndVerifyRoundTrip();
testVerifyRejectsOneByteDifference();
testVerifyRejectsBodyTamperedAfterSigning();
console.log('agt002-hetzner-bridge-signing.test.mjs OK');
```

- [ ] **Step 2: Ejecutar y comprobar fallo**

Run: `node tests/agt002-hetzner-bridge-signing.test.mjs`
Expected: FAIL — `Cannot find module '../agt002-hetzner-bridge-signing.js'`.

- [ ] **Step 3: Implementar el módulo**

```js
// agt002-hetzner-bridge-signing.js
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

export function buildCanonicalString({ method, path, bodySha256Hex, timestamp, nonce }) {
  return `${method}\n${path}\n${bodySha256Hex}\n${timestamp}\n${nonce}`;
}

export function signCanonicalString(secret, canonical) {
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

export function verifySignatureConstantTime(expectedHex, providedHex) {
  const expected = Buffer.from(String(expectedHex || ''), 'hex');
  const provided = Buffer.from(String(providedHex || ''), 'hex');
  if (expected.length === 0 || expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}
```

- [ ] **Step 4: Verificar**

Run: `node tests/agt002-hetzner-bridge-signing.test.mjs`
Expected: PASS, imprime `agt002-hetzner-bridge-signing.test.mjs OK`.

- [ ] **Step 5: Commit**

```bash
git add agt002-hetzner-bridge-signing.js tests/agt002-hetzner-bridge-signing.test.mjs
git commit -m "feat(agt002): add HMAC canonical signing module for Hetzner bridge"
```

---

### Task 2: Nonce de un solo uso + ventana de timestamp

**Files:**
- Create: `agt002-hetzner-bridge-nonce-store.js`
- Create: `tests/agt002-hetzner-bridge-nonce-store.test.mjs`

**Interfaces:**
- Produces: `isTimestampWithinWindow(timestamp, nowSeconds, windowSeconds = 30)`, `createNonceStore({ ttlMs = 90_000 })` → `{ consume(nonce, nowMs), size() }`.
- Consumido por: Task 4 (`agt002-hetzner-bridge-auth.js`).

- [ ] **Step 1: Prueba roja**

```js
// tests/agt002-hetzner-bridge-nonce-store.test.mjs
import assert from 'node:assert/strict';
import { isTimestampWithinWindow, createNonceStore } from '../agt002-hetzner-bridge-nonce-store.js';

function testTimestampWindowBoundaries() {
  assert.equal(isTimestampWithinWindow('1000', 1000, 30), true);
  assert.equal(isTimestampWithinWindow('1000', 1030, 30), true);
  assert.equal(isTimestampWithinWindow('1000', 1031, 30), false);
  assert.equal(isTimestampWithinWindow('1000', 969, 30), false);
  assert.equal(isTimestampWithinWindow('not-a-number', 1000, 30), false);
}

function testNonceConsumedOnceThenRejected() {
  const store = createNonceStore({ ttlMs: 90_000 });
  const nonce = 'n'.repeat(16);
  assert.equal(store.consume(nonce, 1_000), true);
  assert.equal(store.consume(nonce, 1_000), false);
}

function testNonceRejectsShortEntropy() {
  const store = createNonceStore({ ttlMs: 90_000 });
  assert.equal(store.consume('short', 1_000), false);
}

function testNonceExpiresAfterTtl() {
  const store = createNonceStore({ ttlMs: 90_000 });
  const nonce = 'n'.repeat(16);
  assert.equal(store.consume(nonce, 1_000), true);
  assert.equal(store.consume('other-nonce-value', 1_000 + 90_001), true);
  assert.equal(store.size(), 1);
}

testTimestampWindowBoundaries();
testNonceConsumedOnceThenRejected();
testNonceRejectsShortEntropy();
testNonceExpiresAfterTtl();
console.log('agt002-hetzner-bridge-nonce-store.test.mjs OK');
```

- [ ] **Step 2: Ejecutar y comprobar fallo**

Run: `node tests/agt002-hetzner-bridge-nonce-store.test.mjs`
Expected: FAIL — `Cannot find module '../agt002-hetzner-bridge-nonce-store.js'`.

- [ ] **Step 3: Implementar el módulo**

```js
// agt002-hetzner-bridge-nonce-store.js
export function isTimestampWithinWindow(timestamp, nowSeconds, windowSeconds = 30) {
  const ts = Number(timestamp);
  if (!Number.isInteger(ts)) return false;
  return Math.abs(nowSeconds - ts) <= windowSeconds;
}

export function createNonceStore({ ttlMs = 90_000 } = {}) {
  const seen = new Map();
  return {
    consume(nonce, nowMs = Date.now()) {
      for (const [key, expiresAt] of seen) if (expiresAt <= nowMs) seen.delete(key);
      if (typeof nonce !== 'string' || Buffer.byteLength(nonce, 'utf8') < 16) return false;
      if (seen.has(nonce)) return false;
      seen.set(nonce, nowMs + ttlMs);
      return true;
    },
    size() {
      return seen.size;
    },
  };
}
```

- [ ] **Step 4: Verificar**

Run: `node tests/agt002-hetzner-bridge-nonce-store.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agt002-hetzner-bridge-nonce-store.js tests/agt002-hetzner-bridge-nonce-store.test.mjs
git commit -m "feat(agt002): add single-use nonce store and timestamp window check"
```

---

### Task 3: Logging sanitizado (observabilidad sin datos)

**Files:**
- Create: `agt002-hetzner-bridge-log.js`
- Create: `tests/agt002-hetzner-bridge-log.test.mjs`

**Interfaces:**
- Produces: `logBridgeEvent(event, fields)` — emite únicamente `event`, `correlation_id`, `code`, `latency_ms`, `input_tokens`, `output_tokens`; cualquier otra clave se descarta en silencio.
- Consumido por: Task 5 (`agt002-hetzner-bridge-server.js`).

- [ ] **Step 1: Prueba roja**

```js
// tests/agt002-hetzner-bridge-log.test.mjs
import assert from 'node:assert/strict';
import { logBridgeEvent } from '../agt002-hetzner-bridge-log.js';

function testOnlySafeKeysAreEmitted() {
  const originalLog = console.log;
  let emitted = null;
  console.log = (line) => { emitted = line; };
  try {
    logBridgeEvent('agt002_bridge_success', {
      correlation_id: 'corr-1',
      code: 'OK',
      latency_ms: 42,
      input_tokens: 10,
      output_tokens: 5,
      input: { evidence_id: 'should-never-appear' },
      content: 'model output should never appear',
      secret: 'hmac-secret-should-never-appear',
    });
  } finally {
    console.log = originalLog;
  }
  assert.ok(emitted, 'logBridgeEvent debe emitir una línea');
  const parsed = JSON.parse(emitted);
  assert.deepEqual(parsed, { event: 'agt002_bridge_success', correlation_id: 'corr-1', code: 'OK', latency_ms: 42, input_tokens: 10, output_tokens: 5 });
  assert.equal(emitted.includes('should-never-appear'), false);
}

function testMissingOptionalFieldsAreOmittedNotNull() {
  const originalLog = console.log;
  let emitted = null;
  console.log = (line) => { emitted = line; };
  try {
    logBridgeEvent('agt002_bridge_error', { correlation_id: 'corr-2', code: 'AGT002_BRIDGE_AUTH_INVALID', latency_ms: 3 });
  } finally {
    console.log = originalLog;
  }
  const parsed = JSON.parse(emitted);
  assert.deepEqual(parsed, { event: 'agt002_bridge_error', correlation_id: 'corr-2', code: 'AGT002_BRIDGE_AUTH_INVALID', latency_ms: 3 });
}

testOnlySafeKeysAreEmitted();
testMissingOptionalFieldsAreOmittedNotNull();
console.log('agt002-hetzner-bridge-log.test.mjs OK');
```

- [ ] **Step 2: Ejecutar y comprobar fallo**

Run: `node tests/agt002-hetzner-bridge-log.test.mjs`
Expected: FAIL — `Cannot find module '../agt002-hetzner-bridge-log.js'`.

- [ ] **Step 3: Implementar el módulo**

```js
// agt002-hetzner-bridge-log.js
const SAFE_KEYS = ['correlation_id', 'code', 'latency_ms', 'input_tokens', 'output_tokens'];

export function logBridgeEvent(event, fields = {}) {
  const sanitized = { event };
  for (const key of SAFE_KEYS) {
    if (Object.hasOwn(fields, key)) sanitized[key] = fields[key];
  }
  console.log(JSON.stringify(sanitized));
}
```

- [ ] **Step 4: Verificar**

Run: `node tests/agt002-hetzner-bridge-log.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agt002-hetzner-bridge-log.js tests/agt002-hetzner-bridge-log.test.mjs
git commit -m "feat(agt002): add sanitized logging helper for Hetzner bridge"
```

---

### Task 4: Autenticación de la petición (HMAC + nonce + timestamp compuestos)

**Files:**
- Create: `agt002-hetzner-bridge-auth.js`
- Create: `tests/agt002-hetzner-bridge-auth.test.mjs`

**Interfaces:**
- Consumes: `sha256Hex`, `buildCanonicalString`, `signCanonicalString`, `verifySignatureConstantTime` (Task 1); `isTimestampWithinWindow`, `createNonceStore` (Task 2).
- Produces: `authenticateBridgeRequest({ method, path, rawBody, headers, secret, nonceStore, now }) → { ok: true } | { ok: false, status: 401, code: 'AGT002_BRIDGE_AUTH_INVALID' }`.
- Consumido por: Task 5 (`agt002-hetzner-bridge-server.js`).

- [ ] **Step 1: Prueba roja**

```js
// tests/agt002-hetzner-bridge-auth.test.mjs
import assert from 'node:assert/strict';
import { authenticateBridgeRequest } from '../agt002-hetzner-bridge-auth.js';
import { sha256Hex, buildCanonicalString, signCanonicalString } from '../agt002-hetzner-bridge-signing.js';
import { createNonceStore } from '../agt002-hetzner-bridge-nonce-store.js';

const SECRET = 'a'.repeat(32);
const METHOD = 'POST';
const PATH = '/v1/agt002-preview/run';

function sign({ body, timestamp, nonce, secret = SECRET }) {
  const canonical = buildCanonicalString({ method: METHOD, path: PATH, bodySha256Hex: sha256Hex(body), timestamp, nonce });
  return signCanonicalString(secret, canonical);
}

function headersFor({ body, timestamp, nonce, secret = SECRET }) {
  return {
    'x-agt002-timestamp': timestamp,
    'x-agt002-nonce': nonce,
    'x-agt002-signature': sign({ body, timestamp, nonce, secret }),
  };
}

function testValidSignatureAccepted() {
  const nonceStore = createNonceStore();
  const body = '{"a":1}';
  const headers = headersFor({ body, timestamp: '1000', nonce: 'n'.repeat(16) });
  const result = authenticateBridgeRequest({ method: METHOD, path: PATH, rawBody: body, headers, secret: SECRET, nonceStore, now: () => 1000 });
  assert.deepEqual(result, { ok: true });
}

function testInvalidSignatureRejected() {
  const nonceStore = createNonceStore();
  const body = '{"a":1}';
  const headers = headersFor({ body, timestamp: '1000', nonce: 'n'.repeat(16), secret: 'b'.repeat(32) });
  const result = authenticateBridgeRequest({ method: METHOD, path: PATH, rawBody: body, headers, secret: SECRET, nonceStore, now: () => 1000 });
  assert.deepEqual(result, { ok: false, status: 401, code: 'AGT002_BRIDGE_AUTH_INVALID' });
}

function testBodyTamperedAfterSigningRejected() {
  const nonceStore = createNonceStore();
  const signedBody = '{"a":1}';
  const headers = headersFor({ body: signedBody, timestamp: '1000', nonce: 'n'.repeat(16) });
  const tamperedBody = '{"a":2}';
  const result = authenticateBridgeRequest({ method: METHOD, path: PATH, rawBody: tamperedBody, headers, secret: SECRET, nonceStore, now: () => 1000 });
  assert.deepEqual(result, { ok: false, status: 401, code: 'AGT002_BRIDGE_AUTH_INVALID' });
}

function testTimestampOutOfWindowRejected() {
  const nonceStore = createNonceStore();
  const body = '{}';
  const tooLate = headersFor({ body, timestamp: '1000', nonce: 'n'.repeat(16) });
  assert.deepEqual(
    authenticateBridgeRequest({ method: METHOD, path: PATH, rawBody: body, headers: tooLate, secret: SECRET, nonceStore, now: () => 1031 }),
    { ok: false, status: 401, code: 'AGT002_BRIDGE_AUTH_INVALID' },
  );
  const tooEarly = headersFor({ body, timestamp: '1000', nonce: 'm'.repeat(16) });
  assert.deepEqual(
    authenticateBridgeRequest({ method: METHOD, path: PATH, rawBody: body, headers: tooEarly, secret: SECRET, nonceStore, now: () => 969 }),
    { ok: false, status: 401, code: 'AGT002_BRIDGE_AUTH_INVALID' },
  );
}

function testRepeatedNonceRejectedEvenWithValidSignature() {
  const nonceStore = createNonceStore();
  const body = '{}';
  const nonce = 'n'.repeat(16);
  const headers = headersFor({ body, timestamp: '1000', nonce });
  const first = authenticateBridgeRequest({ method: METHOD, path: PATH, rawBody: body, headers, secret: SECRET, nonceStore, now: () => 1000 });
  assert.deepEqual(first, { ok: true });
  const replay = authenticateBridgeRequest({ method: METHOD, path: PATH, rawBody: body, headers, secret: SECRET, nonceStore, now: () => 1001 });
  assert.deepEqual(replay, { ok: false, status: 401, code: 'AGT002_BRIDGE_AUTH_INVALID' });
}

function testEachMissingHeaderRejected() {
  const nonceStore = createNonceStore();
  const body = '{}';
  const full = headersFor({ body, timestamp: '1000', nonce: 'n'.repeat(16) });
  for (const missing of ['x-agt002-timestamp', 'x-agt002-nonce', 'x-agt002-signature']) {
    const headers = { ...full };
    delete headers[missing];
    const result = authenticateBridgeRequest({ method: METHOD, path: PATH, rawBody: body, headers, secret: SECRET, nonceStore: createNonceStore(), now: () => 1000 });
    assert.deepEqual(result, { ok: false, status: 401, code: 'AGT002_BRIDGE_AUTH_INVALID' }, `header faltante: ${missing}`);
  }
}

testValidSignatureAccepted();
testInvalidSignatureRejected();
testBodyTamperedAfterSigningRejected();
testTimestampOutOfWindowRejected();
testRepeatedNonceRejectedEvenWithValidSignature();
testEachMissingHeaderRejected();
console.log('agt002-hetzner-bridge-auth.test.mjs OK');
```

- [ ] **Step 2: Ejecutar y comprobar fallo**

Run: `node tests/agt002-hetzner-bridge-auth.test.mjs`
Expected: FAIL — `Cannot find module '../agt002-hetzner-bridge-auth.js'`.

- [ ] **Step 3: Implementar el módulo**

```js
// agt002-hetzner-bridge-auth.js
import { sha256Hex, buildCanonicalString, signCanonicalString, verifySignatureConstantTime } from './agt002-hetzner-bridge-signing.js';
import { isTimestampWithinWindow } from './agt002-hetzner-bridge-nonce-store.js';

const REQUIRED_HEADERS = ['x-agt002-timestamp', 'x-agt002-nonce', 'x-agt002-signature'];
const AUTH_INVALID = { ok: false, status: 401, code: 'AGT002_BRIDGE_AUTH_INVALID' };

export function authenticateBridgeRequest({ method, path, rawBody, headers, secret, nonceStore, now = () => Math.floor(Date.now() / 1000) }) {
  for (const header of REQUIRED_HEADERS) {
    if (typeof headers?.[header] !== 'string' || headers[header].length === 0) return AUTH_INVALID;
  }
  const timestamp = headers['x-agt002-timestamp'];
  const nonce = headers['x-agt002-nonce'];
  const signature = headers['x-agt002-signature'];

  if (!isTimestampWithinWindow(timestamp, now(), 30)) return AUTH_INVALID;

  const canonical = buildCanonicalString({ method: method.toUpperCase(), path, bodySha256Hex: sha256Hex(rawBody), timestamp, nonce });
  const expectedSignature = signCanonicalString(secret, canonical);
  if (!verifySignatureConstantTime(expectedSignature, signature)) return AUTH_INVALID;

  if (!nonceStore.consume(nonce, now() * 1000)) return AUTH_INVALID;

  return { ok: true };
}
```

- [ ] **Step 4: Verificar**

Run: `node tests/agt002-hetzner-bridge-auth.test.mjs`
Expected: PASS (las 6 pruebas).

- [ ] **Step 5: Commit**

```bash
git add agt002-hetzner-bridge-auth.js tests/agt002-hetzner-bridge-auth.test.mjs
git commit -m "feat(agt002): compose HMAC + nonce + timestamp request authentication"
```

---

### Task 5: Servicio HTTP Hetzner (código de aplicación, probado en loopback local)

**Files:**
- Create: `agt002-hetzner-bridge-server.js`
- Create: `tests/agt002-hetzner-bridge-server.test.mjs`

**Interfaces:**
- Consumes: `authenticateBridgeRequest` (Task 4), `createNonceStore` (Task 2), `logBridgeEvent` (Task 3); un `codexClient` inyectado con la misma forma que `createCodexAppServerClient(...).run(...)` (`agt002-preview-codex-client.js:53-54`, sin cambios).
- Produces: `createAgt002BridgeServer({ hmacSecret, codexClient, nonceStore, now, maxBodyBytes }) → requestListener(req, res)`, compatible con `http.createServer(requestListener)`.
- Nota de diseño: este módulo **nunca reimplementa** el protocolo JSON-line de Codex; siempre delega en el `codexClient` inyectado, que en producción será la instancia real de `createCodexAppServerClient` ya existente y sin cambios.

Todas las pruebas de esta tarea levantan el servidor en `127.0.0.1` con puerto efímero (`listen(0)`) solo para el proceso de prueba — no hay red real, no hay Hetzner, no hay Internet.

- [ ] **Step 1: Prueba roja — rutas, método, Content-Type, tamaño**

```js
// tests/agt002-hetzner-bridge-server.test.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAgt002BridgeServer } from '../agt002-hetzner-bridge-server.js';
import { sha256Hex, buildCanonicalString, signCanonicalString } from '../agt002-hetzner-bridge-signing.js';

const SECRET = 'a'.repeat(32);
const PATH = '/v1/agt002-preview/run';

function signedHeaders(body, { timestamp = String(Math.floor(Date.now() / 1000)), nonce = 'n'.repeat(16), secret = SECRET } = {}) {
  const canonical = buildCanonicalString({ method: 'POST', path: PATH, bodySha256Hex: sha256Hex(body), timestamp, nonce });
  return {
    'content-type': 'application/json',
    'x-agt002-timestamp': timestamp,
    'x-agt002-nonce': nonce,
    'x-agt002-signature': signCanonicalString(secret, canonical),
  };
}

async function withServer(codexClient, fn) {
  const server = createServer(createAgt002BridgeServer({ hmacSecret: SECRET, codexClient }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const fakeSuccessClient = { run: async () => ({ content: '{"ok":true}', usage: { input_tokens: 1, output_tokens: 2 }, rate_limit: null }) };

async function testWrongMethodRejected() {
  await withServer(fakeSuccessClient, async (base) => {
    const response = await fetch(`${base}${PATH}`, { method: 'GET' });
    assert.equal(response.status, 405);
    const payload = await response.json();
    assert.equal(payload.error.code, 'AGT002_BRIDGE_METHOD_NOT_ALLOWED');
  });
}

async function testUnknownPathRejected() {
  await withServer(fakeSuccessClient, async (base) => {
    const body = '{}';
    const response = await fetch(`${base}/v1/other`, { method: 'POST', headers: signedHeaders(body), body });
    assert.equal(response.status, 404);
  });
}

async function testWrongContentTypeRejected() {
  await withServer(fakeSuccessClient, async (base) => {
    const body = '{}';
    const headers = { ...signedHeaders(body), 'content-type': 'text/plain' };
    const response = await fetch(`${base}${PATH}`, { method: 'POST', headers, body });
    assert.equal(response.status, 415);
    const payload = await response.json();
    assert.equal(payload.error.code, 'AGT002_BRIDGE_UNSUPPORTED_MEDIA_TYPE');
  });
}

async function testOversizedBodyRejected() {
  await withServer(fakeSuccessClient, async (base) => {
    const oversized = JSON.stringify({ padding: 'x'.repeat(300_000) });
    const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(oversized), body: oversized });
    assert.equal(response.status, 413);
  });
}

testWrongMethodRejected();
testUnknownPathRejected();
testWrongContentTypeRejected();
testOversizedBodyRejected();
console.log('agt002-hetzner-bridge-server.test.mjs Step 1 OK');
```

- [ ] **Step 2: Ejecutar y comprobar fallo**

Run: `node tests/agt002-hetzner-bridge-server.test.mjs`
Expected: FAIL — `Cannot find module '../agt002-hetzner-bridge-server.js'`.

- [ ] **Step 3: Implementar el esqueleto del servidor (rutas, tamaño, Content-Type, auth, mapeo de error)**

```js
// agt002-hetzner-bridge-server.js
import { randomUUID } from 'node:crypto';
import { createNonceStore } from './agt002-hetzner-bridge-nonce-store.js';
import { authenticateBridgeRequest } from './agt002-hetzner-bridge-auth.js';
import { logBridgeEvent } from './agt002-hetzner-bridge-log.js';

const BRIDGE_PATH = '/v1/agt002-preview/run';
const DEFAULT_MAX_BODY_BYTES = 262_144;

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

export function createAgt002BridgeServer({ hmacSecret, codexClient, nonceStore = createNonceStore(), now = () => Math.floor(Date.now() / 1000), maxBodyBytes = DEFAULT_MAX_BODY_BYTES }) {
  if (typeof hmacSecret !== 'string' || hmacSecret.length < 32) throw new Error('El puente AGT-002 requiere un secreto HMAC de al menos 32 bytes.');
  if (!codexClient || typeof codexClient.run !== 'function') throw new Error('El puente AGT-002 requiere un cliente Codex inyectado.');

  let busy = false;

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

      if (busy) return sendError(res, 409, 'AGT002_BRIDGE_BUSY');
      busy = true;
      const startedAt = Date.now();
      const correlationId = randomUUID();
      const controller = new AbortController();
      req.on('close', () => controller.abort());

      codexClient.run({ model, policy, input, outputSchema, timeoutMs, idempotencyKey, signal: controller.signal })
        .then(result => {
          busy = false;
          logBridgeEvent('agt002_bridge_success', {
            correlation_id: correlationId, code: 'OK', latency_ms: Date.now() - startedAt,
            input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens,
          });
          sendJson(res, 200, result);
        })
        .catch(error => {
          busy = false;
          const code = error?.code || 'AGT002_BRIDGE_INTERNAL';
          const status = CODE_TO_STATUS[code] || 500;
          logBridgeEvent('agt002_bridge_error', { correlation_id: correlationId, code, latency_ms: Date.now() - startedAt });
          sendError(res, status, code);
        });
    });
  };
}
```

- [ ] **Step 4: Verificar Step 1**

Run: `node tests/agt002-hetzner-bridge-server.test.mjs`
Expected: PASS (las 4 pruebas de Step 1), imprime `agt002-hetzner-bridge-server.test.mjs Step 1 OK`.

- [ ] **Step 5: Prueba roja — éxito, concurrencia=1, `cwd` rechazado, error mapeado**

Añadir al mismo archivo, antes de las líneas finales de ejecución:

```js
function neverResolvingClient() {
  return { run: () => new Promise(() => {}) };
}

async function testSuccessResponseShape() {
  await withServer(fakeSuccessClient, async (base) => {
    const payload = { model: 'gpt-x', policy: 'policy text', input: { a: 1 }, outputSchema: { type: 'object' }, timeoutMs: 5000, idempotencyKey: 'idem-1' };
    const body = JSON.stringify(payload);
    const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body), body });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result, { content: '{"ok":true}', usage: { input_tokens: 1, output_tokens: 2 }, rate_limit: null });
  });
}

async function testCwdInBodyRejected() {
  await withServer(fakeSuccessClient, async (base) => {
    const payload = { model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-2', cwd: '/etc' };
    const body = JSON.stringify(payload);
    const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body), body });
    assert.equal(response.status, 400);
    const result = await response.json();
    assert.equal(result.error.code, 'AGT002_BRIDGE_BAD_REQUEST');
  });
}

async function testConcurrencyOneRejectsSecondRequest() {
  const server = createServer(createAgt002BridgeServer({ hmacSecret: SECRET, codexClient: neverResolvingClient() }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const payload = { model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-3' };
    const firstBody = JSON.stringify(payload);
    const firstRequest = fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(firstBody), body: firstBody });
    await new Promise(resolve => setTimeout(resolve, 50));
    const secondPayload = { ...payload, idempotencyKey: 'idem-4' };
    const secondBody = JSON.stringify(secondPayload);
    const secondResponse = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(secondBody, { nonce: 'm'.repeat(16) }), body: secondBody });
    assert.equal(secondResponse.status, 409);
    const secondResult = await secondResponse.json();
    assert.equal(secondResult.error.code, 'AGT002_BRIDGE_BUSY');
    firstRequest.catch(() => {});
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function testProviderErrorMappedTo502() {
  const client = { run: async () => { const error = new Error('boom'); error.code = 'AGT002_CODEX_PROVIDER_ERROR'; throw error; } };
  await withServer(client, async (base) => {
    const payload = { model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-5' };
    const body = JSON.stringify(payload);
    const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body), body });
    assert.equal(response.status, 502);
    const result = await response.json();
    assert.equal(result.error.code, 'AGT002_CODEX_PROVIDER_ERROR');
  });
}

async function testLoginRequiredMappedTo503() {
  const client = { run: async () => { const error = new Error('login'); error.code = 'AGT002_CODEX_LOGIN_REQUIRED'; throw error; } };
  await withServer(client, async (base) => {
    const payload = { model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-6' };
    const body = JSON.stringify(payload);
    const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body), body });
    assert.equal(response.status, 503);
    const result = await response.json();
    assert.equal(result.error.code, 'AGT002_CODEX_LOGIN_REQUIRED');
  });
}

await testSuccessResponseShape();
await testCwdInBodyRejected();
await testConcurrencyOneRejectsSecondRequest();
await testProviderErrorMappedTo502();
await testLoginRequiredMappedTo503();
console.log('agt002-hetzner-bridge-server.test.mjs Step 5 OK');
```

Nota: como el archivo ya usa `await` de nivel superior en este bloque, la primera tanda de llamadas (`testWrongMethodRejected()` … `testOversizedBodyRejected()`) debe pasarse también a `await` (`await testWrongMethodRejected();` etc.) para que Node ESM top-level await mantenga el orden. Ajustar esas 4 líneas existentes al añadir este step.

- [ ] **Step 6: Ejecutar y comprobar fallo**

Run: `node tests/agt002-hetzner-bridge-server.test.mjs`
Expected: FAIL en `testConcurrencyOneRejectsSecondRequest` (código ya implementa concurrencia, pero verificar que el resto — éxito, `cwd`, mapeo 502/503 — también pase; si algo falla por un detalle de forma de respuesta, ajustar solo la prueba, no relajar el servidor). Si todo pasa ya en este Step, documentarlo y continuar (la implementación del Step 3 ya cubre estos casos por diseño).

- [ ] **Step 7: Ajustar implementación si el Step 6 mostró fallos reales**

Si `testConcurrencyOneRejectsSecondRequest` falla porque la primera petición nunca libera `busy` (el fake nunca resuelve), no cambiar el servidor: es el comportamiento esperado dentro de la prueba (se cierra el servidor en el `finally` sin esperar la primera petición). Si cualquier otra prueba falla, corregir `agt002-hetzner-bridge-server.js` únicamente en el punto señalado por el mensaje de aserción, sin tocar la autenticación ya verificada en Task 4.

- [ ] **Step 8: Verificar completo**

Run: `node tests/agt002-hetzner-bridge-server.test.mjs`
Expected: PASS — imprime `agt002-hetzner-bridge-server.test.mjs Step 1 OK` y `agt002-hetzner-bridge-server.test.mjs Step 5 OK`.

- [ ] **Step 9: Commit**

```bash
git add agt002-hetzner-bridge-server.js tests/agt002-hetzner-bridge-server.test.mjs
git commit -m "feat(agt002): add Hetzner bridge HTTP service with fail-closed auth and concurrency=1"
```

---

### Task 6: Cliente HTTP drop-in en Vercel

**Files:**
- Create: `agt002-hetzner-bridge-client.js`
- Create: `tests/agt002-hetzner-bridge-client.test.mjs`

**Interfaces:**
- Consumes: `sha256Hex`, `buildCanonicalString`, `signCanonicalString` (Task 1).
- Produces: `createAgt002HetznerBridgeClient({ url, hmacSecret, fetchImpl, randomNonce, now }) → { run({ model, policy, input, outputSchema, timeoutMs, idempotencyKey, signal, cwd }) }`, misma firma y misma forma de retorno/rechazo que `createCodexAppServerClient(...)` (`agt002-preview-codex-client.js:54`).

- [ ] **Step 1: Prueba roja — contrato drop-in, firma, `cwd` nunca viaja, mapeo de error**

```js
// tests/agt002-hetzner-bridge-client.test.mjs
import assert from 'node:assert/strict';
import { createAgt002HetznerBridgeClient } from '../agt002-hetzner-bridge-client.js';
import { sha256Hex, buildCanonicalString, verifySignatureConstantTime, signCanonicalString } from '../agt002-hetzner-bridge-signing.js';

const URL_ = 'https://agt002.5-78-140-24.sslip.io/v1/agt002-preview/run';
const SECRET = 'a'.repeat(32);

function fakeFetch({ status = 200, jsonBody, capture }) {
  return async (url, init) => {
    if (capture) capture({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => jsonBody,
    };
  };
}

async function testExposesSameRunSignatureAndResolvesSameShape() {
  const client = createAgt002HetznerBridgeClient({
    url: URL_, hmacSecret: SECRET,
    fetchImpl: fakeFetch({ jsonBody: { content: '{"ok":true}', usage: { input_tokens: 3, output_tokens: 4 }, rate_limit: null } }),
    randomNonce: () => 'n'.repeat(16), now: () => 1_000,
  });
  const result = await client.run({ model: 'gpt-x', policy: 'policy', input: { a: 1 }, outputSchema: { type: 'object' }, timeoutMs: 5000, idempotencyKey: 'idem-1' });
  assert.deepEqual(result, { content: '{"ok":true}', usage: { input_tokens: 3, output_tokens: 4 }, rate_limit: null });
}

async function testCwdIsNeverSentOverNetwork() {
  let captured = null;
  const client = createAgt002HetznerBridgeClient({
    url: URL_, hmacSecret: SECRET,
    fetchImpl: fakeFetch({ jsonBody: { content: '{}', usage: { input_tokens: 0, output_tokens: 0 }, rate_limit: null }, capture: (c) => { captured = c; } }),
    randomNonce: () => 'n'.repeat(16), now: () => 1_000,
  });
  await client.run({ model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-2', cwd: '/should/never/appear' });
  assert.equal(captured.init.body.includes('/should/never/appear'), false);
  assert.equal(JSON.parse(captured.init.body).cwd, undefined);
}

async function testSignalIsNeverSerializedInBody() {
  let captured = null;
  const controller = new AbortController();
  const client = createAgt002HetznerBridgeClient({
    url: URL_, hmacSecret: SECRET,
    fetchImpl: fakeFetch({ jsonBody: { content: '{}', usage: { input_tokens: 0, output_tokens: 0 }, rate_limit: null }, capture: (c) => { captured = c; } }),
    randomNonce: () => 'n'.repeat(16), now: () => 1_000,
  });
  await client.run({ model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-3', signal: controller.signal });
  const bodyParsed = JSON.parse(captured.init.body);
  assert.equal(bodyParsed.signal, undefined);
}

async function testRequestIsCorrectlySignedForServerCanonical() {
  let captured = null;
  const client = createAgt002HetznerBridgeClient({
    url: URL_, hmacSecret: SECRET,
    fetchImpl: fakeFetch({ jsonBody: { content: '{}', usage: { input_tokens: 0, output_tokens: 0 }, rate_limit: null }, capture: (c) => { captured = c; } }),
    randomNonce: () => 'n'.repeat(16), now: () => 1_000,
  });
  await client.run({ model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-4' });
  const canonical = buildCanonicalString({ method: 'POST', path: '/v1/agt002-preview/run', bodySha256Hex: sha256Hex(captured.init.body), timestamp: '1000', nonce: 'n'.repeat(16) });
  const expected = signCanonicalString(SECRET, canonical);
  assert.equal(verifySignatureConstantTime(expected, captured.init.headers['X-AGT002-Signature']), true);
}

async function testNonOkResponseRejectsWithProvidedCode() {
  const client = createAgt002HetznerBridgeClient({
    url: URL_, hmacSecret: SECRET,
    fetchImpl: fakeFetch({ status: 504, jsonBody: { error: { code: 'AGT002_CODEX_TIMEOUT', message: 'fixed' }, correlation_id: 'c-1' } }),
    randomNonce: () => 'n'.repeat(16), now: () => 1_000,
  });
  await assert.rejects(
    () => client.run({ model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-5' }),
    (error) => { assert.equal(error.code, 'AGT002_CODEX_TIMEOUT'); return true; },
  );
}

async function testTransportFailureRejectsWithSafeTransportCode() {
  const client = createAgt002HetznerBridgeClient({
    url: URL_, hmacSecret: SECRET,
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    randomNonce: () => 'n'.repeat(16), now: () => 1_000,
  });
  await assert.rejects(
    () => client.run({ model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-6' }),
    (error) => { assert.equal(error.code, 'AGT002_CODEX_TRANSPORT_ERROR'); assert.equal(error.message.includes('ECONNREFUSED'), false); return true; },
  );
}

await testExposesSameRunSignatureAndResolvesSameShape();
await testCwdIsNeverSentOverNetwork();
await testSignalIsNeverSerializedInBody();
await testRequestIsCorrectlySignedForServerCanonical();
await testNonOkResponseRejectsWithProvidedCode();
await testTransportFailureRejectsWithSafeTransportCode();
console.log('agt002-hetzner-bridge-client.test.mjs OK');
```

- [ ] **Step 2: Ejecutar y comprobar fallo**

Run: `node tests/agt002-hetzner-bridge-client.test.mjs`
Expected: FAIL — `Cannot find module '../agt002-hetzner-bridge-client.js'`.

- [ ] **Step 3: Implementar el cliente**

```js
// agt002-hetzner-bridge-client.js
import { randomUUID } from 'node:crypto';
import { sha256Hex, buildCanonicalString, signCanonicalString } from './agt002-hetzner-bridge-signing.js';

function transportError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function createAgt002HetznerBridgeClient({ url, hmacSecret, fetchImpl = fetch, randomNonce = () => randomUUID(), now = () => Math.floor(Date.now() / 1000) } = {}) {
  if (typeof url !== 'string' || !url.trim()) throw new Error('El puente AGT-002 requiere una URL configurada.');
  if (typeof hmacSecret !== 'string' || hmacSecret.length < 32) throw new Error('El puente AGT-002 requiere un secreto HMAC de al menos 32 bytes.');
  const path = new URL(url).pathname;

  return {
    async run({ model, policy, input, outputSchema, timeoutMs = 30_000, idempotencyKey = randomUUID(), signal } = {}) {
      if (typeof model !== 'string' || !model.trim()) throw new Error('AGT-002 Preview requiere un modelo configurado.');
      if (typeof policy !== 'string' || !policy.trim()) throw new Error('AGT-002 Preview requiere una política (baseInstructions) configurada.');
      if (!isPlainObject(input)) throw new Error('AGT-002 Preview requiere una entrada cerrada.');
      if (!isPlainObject(outputSchema)) throw new Error('AGT-002 Preview requiere un outputSchema cerrado.');
      if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error('El timeout de AGT-002 Preview no es válido.');
      if (signal?.aborted) throw transportError('La ejecución de AGT-002 Preview fue cancelada.', 'AGT002_CODEX_CANCELLED');

      const body = JSON.stringify({ model, policy, input, outputSchema, timeoutMs, idempotencyKey });
      const timestamp = String(now());
      const nonce = randomNonce();
      const canonical = buildCanonicalString({ method: 'POST', path, bodySha256Hex: sha256Hex(body), timestamp, nonce });
      const signature = signCanonicalString(hmacSecret, canonical);

      const controller = new AbortController();
      const onCallerAbort = () => controller.abort();
      if (signal) signal.addEventListener('abort', onCallerAbort, { once: true });
      const marginTimer = setTimeout(() => controller.abort(), timeoutMs + 2_000);
      marginTimer.unref?.();

      let response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-AGT002-Timestamp': timestamp,
            'X-AGT002-Nonce': nonce,
            'X-AGT002-Signature': signature,
            'Idempotency-Key': idempotencyKey,
          },
          body,
          signal: controller.signal,
        });
      } catch {
        throw transportError('El servicio de AGT-002 Preview no está disponible.', 'AGT002_CODEX_TRANSPORT_ERROR');
      } finally {
        clearTimeout(marginTimer);
        if (signal) signal.removeEventListener('abort', onCallerAbort);
      }

      let payload;
      try { payload = await response.json(); }
      catch { throw transportError('La respuesta de AGT-002 Preview no tiene una estructura segura.', 'AGT002_CODEX_INVALID_RESPONSE'); }

      if (!response.ok) {
        throw transportError('El servicio de AGT-002 Preview devolvió un error.', payload?.error?.code || 'AGT002_BRIDGE_INTERNAL');
      }
      if (typeof payload.content !== 'string'
        || !Number.isInteger(payload.usage?.input_tokens) || payload.usage.input_tokens < 0
        || !Number.isInteger(payload.usage?.output_tokens) || payload.usage.output_tokens < 0) {
        throw transportError('La respuesta de AGT-002 Preview no tiene una estructura segura.', 'AGT002_CODEX_INVALID_RESPONSE');
      }
      return { content: payload.content, usage: payload.usage, rate_limit: payload.rate_limit ?? null };
    },
  };
}
```

- [ ] **Step 4: Verificar**

Run: `node tests/agt002-hetzner-bridge-client.test.mjs`
Expected: PASS (las 6 pruebas).

- [ ] **Step 5: Commit**

```bash
git add agt002-hetzner-bridge-client.js tests/agt002-hetzner-bridge-client.test.mjs
git commit -m "feat(agt002): add drop-in HTTP client for Hetzner bridge"
```

---

### Task 7: Timeout y cancelación de extremo a extremo (cliente + servidor en loopback)

**Files:**
- Create: `tests/agt002-hetzner-bridge-timeout.integration.test.mjs`

**Interfaces:**
- Consumes: `createAgt002BridgeServer` (Task 5), `createAgt002HetznerBridgeClient` (Task 6).
- No produce símbolos nuevos: es una prueba de integración de extremo a extremo sobre loopback, sin red real.

- [ ] **Step 1: Prueba roja — el servidor responde 504 exactamente cuando expira `timeoutMs`**

```js
// tests/agt002-hetzner-bridge-timeout.integration.test.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAgt002BridgeServer } from '../agt002-hetzner-bridge-server.js';
import { createAgt002HetznerBridgeClient } from '../agt002-hetzner-bridge-client.js';

const SECRET = 'a'.repeat(32);

function slowCodexClient({ interruptCalls }) {
  return {
    run({ timeoutMs, signal }) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ content: '{}', usage: { input_tokens: 0, output_tokens: 0 }, rate_limit: null }), timeoutMs + 10_000);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          interruptCalls.push('aborted');
          const error = new Error('cancelled');
          error.code = 'AGT002_CODEX_CANCELLED';
          reject(error);
        }, { once: true });
      });
    },
  };
}

async function testServerTimesOutIndependentlyOfSlowProvider() {
  const codexClient = { run: ({ timeoutMs }) => new Promise((resolve) => setTimeout(resolve, timeoutMs + 5_000)) };
  const server = createServer(createAgt002BridgeServer({ hmacSecret: SECRET, codexClient }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/v1/agt002-preview/run`;
  try {
    const client = createAgt002HetznerBridgeClient({ url, hmacSecret: SECRET });
    await assert.rejects(
      () => client.run({ model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 200, idempotencyKey: 'idem-timeout' }),
      () => true,
    );
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function testClientAbortTriggersServerInterruptAndNoOrphanProcess() {
  const interruptCalls = [];
  const codexClient = slowCodexClient({ interruptCalls });
  const server = createServer(createAgt002BridgeServer({ hmacSecret: SECRET, codexClient }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/v1/agt002-preview/run`;
  try {
    const client = createAgt002HetznerBridgeClient({ url, hmacSecret: SECRET });
    const controller = new AbortController();
    const runPromise = client.run({ model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 30_000, idempotencyKey: 'idem-abort', signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(() => runPromise, () => true);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(interruptCalls, ['aborted']);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

await testServerTimesOutIndependentlyOfSlowProvider();
await testClientAbortTriggersServerInterruptAndNoOrphanProcess();
console.log('agt002-hetzner-bridge-timeout.integration.test.mjs OK');
```

- [ ] **Step 2: Ejecutar y comprobar fallo**

Run: `node tests/agt002-hetzner-bridge-timeout.integration.test.mjs`
Expected: FAIL si la propagación cliente→servidor de `req.on('close', ...)` aún no dispara el abort del `signal` inyectado al `codexClient` (verificar mensaje de aserción exacto antes de tocar código).

- [ ] **Step 3: Corregir solo si el Step 2 mostró una falla real**

Si `testClientAbortTriggersServerInterruptAndNoOrphanProcess` falla porque `req.on('close', ...)` no se disparó a tiempo en Node, confirmar que `agt002-hetzner-bridge-server.js` (Task 5) registra el listener `close` inmediatamente tras validar el body y antes de invocar `codexClient.run(...)` (ya implementado en Step 3 de Task 5); si el test sigue fallando por temporización, aumentar el `setTimeout` de disparo del abort en la prueba (no relajar el servidor) hasta un valor estable, documentando el ajuste en el mensaje de commit.

- [ ] **Step 4: Verificar**

Run: `node tests/agt002-hetzner-bridge-timeout.integration.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/agt002-hetzner-bridge-timeout.integration.test.mjs
git commit -m "test(agt002): cover end-to-end bridge timeout and abort propagation"
```

---

### Task 8: Config fail-closed en Vercel — sustituir el seam y activar el kill switch por defecto apagado

**Files:**
- Modify: `agt002-preview-runtime.js`
- Modify: `tests/agt002-preview-runtime.test.mjs`

**Interfaces:**
- Consumes: `createAgt002HetznerBridgeClient` (Task 6).
- Produces: `isAgt002PreviewConfigured(environment)` ahora exige `AGT002_HETZNER_BRIDGE_URL` y `AGT002_HETZNER_BRIDGE_HMAC_SECRET` además de `AGT002_PREVIEW_MODEL`; `createAgt002PreviewRuntime` construye el cliente del puente en vez de `createCodexAppServerClient`.

- [ ] **Step 1: Prueba roja — kill switch apagado por defecto y nuevo seam**

Añadir a `tests/agt002-preview-runtime.test.mjs`:

```js
function testConfiguredRequiresHetznerBridgeUrlAndSecret() {
  const baseEnv = { TENDER_ANALYSIS_ENGINE: 'agt002_codex_preview', AGT002_PREVIEW_MODEL: 'gpt-x' };
  assert.equal(isAgt002PreviewConfigured(baseEnv), false, 'sin URL de puente, debe fallar cerrado (kill switch apagado por defecto)');
  assert.equal(isAgt002PreviewConfigured({ ...baseEnv, AGT002_HETZNER_BRIDGE_URL: 'https://agt002.5-78-140-24.sslip.io/v1/agt002-preview/run' }), false, 'sin secreto HMAC, debe fallar cerrado');
  assert.equal(isAgt002PreviewConfigured({
    ...baseEnv,
    AGT002_HETZNER_BRIDGE_URL: 'https://agt002.5-78-140-24.sslip.io/v1/agt002-preview/run',
    AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'a'.repeat(32),
  }), true);
}

function testRuntimeBuildsHetznerBridgeClientNotLocalSpawn() {
  const environment = {
    TENDER_ANALYSIS_ENGINE: 'agt002_codex_preview',
    AGT002_PREVIEW_MODEL: 'gpt-x',
    AGT002_HETZNER_BRIDGE_URL: 'https://agt002.5-78-140-24.sslip.io/v1/agt002-preview/run',
    AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'a'.repeat(32),
  };
  const engine = createAgt002PreviewRuntime({ environment, countDailyRuns: async () => 0 });
  assert.equal(typeof engine.analyze, 'function');
}

testConfiguredRequiresHetznerBridgeUrlAndSecret();
testRuntimeBuildsHetznerBridgeClientNotLocalSpawn();
```

(Ajustar los `import` de la cabecera del archivo si `isAgt002PreviewConfigured`/`createAgt002PreviewRuntime` no están ya importados; ambos ya son exports existentes de `agt002-preview-runtime.js`.)

- [ ] **Step 2: Ejecutar y comprobar fallo**

Run: `node tests/agt002-preview-runtime.test.mjs`
Expected: FAIL en `testConfiguredRequiresHetznerBridgeUrlAndSecret` — hoy `isAgt002PreviewConfigured` solo exige `AGT002_PREVIEW_MODEL` y `AGT002_CODEX_APP_SERVER_BIN`, así que el primer `assert.equal(..., false)` falla (la variable requerida hoy es distinta).

- [ ] **Step 3: Sustituir el seam en `agt002-preview-runtime.js`**

Cambiar el import (línea 1):

```js
import { createCodexAppServerClient } from './agt002-preview-codex-client.js';
```

por:

```js
import { createAgt002HetznerBridgeClient } from './agt002-hetzner-bridge-client.js';
```

Cambiar `REQUIRED_ENV_KEYS` (línea 5):

```js
const REQUIRED_ENV_KEYS = ['AGT002_PREVIEW_MODEL', 'AGT002_CODEX_APP_SERVER_BIN'];
```

por:

```js
const REQUIRED_ENV_KEYS = ['AGT002_PREVIEW_MODEL', 'AGT002_HETZNER_BRIDGE_URL', 'AGT002_HETZNER_BRIDGE_HMAC_SECRET'];
```

Cambiar la construcción del cliente dentro de `createAgt002PreviewRuntime` (líneas 55-58):

```js
const client = createCodexAppServerClient({
  command: environment.AGT002_CODEX_APP_SERVER_BIN,
  args: nonEmpty(environment.AGT002_CODEX_APP_SERVER_ARGS) ? JSON.parse(environment.AGT002_CODEX_APP_SERVER_ARGS) : ['app-server'],
});
```

por:

```js
const client = createAgt002HetznerBridgeClient({
  url: environment.AGT002_HETZNER_BRIDGE_URL,
  hmacSecret: environment.AGT002_HETZNER_BRIDGE_HMAC_SECRET,
});
```

No tocar el resto de `getAgt002PreviewRuntimeConfig` ni la llamada a `createAgt002PreviewEngine`.

- [ ] **Step 4: Verificar**

Run: `node tests/agt002-preview-runtime.test.mjs`
Expected: PASS.

Run adicional (no debe romperse):
```bash
node tests/agt002-preview-engine.test.mjs
node tests/agt002-preview-surface.test.mjs
```
Expected: PASS — `agt002-preview-engine.js` sigue recibiendo un `client` con la misma forma `run(...)`, sin cambios en ese archivo.

- [ ] **Step 5: Commit**

```bash
git add agt002-preview-runtime.js tests/agt002-preview-runtime.test.mjs
git commit -m "feat(agt002): wire Hetzner bridge client into preview runtime, kill switch off by default"
```

---

### Task 9: Fixtures sintéticos adaptados a transporte HTTP + paridad end-to-end

**Files:**
- Create: `tests/fixtures/agt002-hetzner-bridge-synthetic-server.mjs`
- Create: `tests/agt002-preview-hetzner-bridge-parity.integration.test.mjs`

**Interfaces:**
- Consumes: `createAgt002BridgeServer` (Task 5), `createAgt002HetznerBridgeClient` (Task 6), fixtures ya existentes `tests/fixtures/agt002-codex-app-server-synthetic.mjs` y `tests/fixtures/agt002-synthetic-responder.mjs` (sin modificarlos).
- Produces: `startSyntheticAgt002HetznerBridge({ hmacSecret, codexClient }) → { url, close() }`, un servidor HTTP sintético en loopback listo para que `agt002-preview-engine.js`/`agt002-preview-runtime.js` apunten en pruebas, análogo en propósito a los fixtures ya existentes pero para transporte HTTP en vez de `child_process`.

- [ ] **Step 1: Prueba roja — el fixture debe levantar/cerrar un servidor sintético reutilizable**

```js
// tests/fixtures/agt002-hetzner-bridge-synthetic-server.mjs
import { createServer } from 'node:http';
import { createAgt002BridgeServer } from '../../agt002-hetzner-bridge-server.js';

export async function startSyntheticAgt002HetznerBridge({ hmacSecret, codexClient }) {
  const server = createServer(createAgt002BridgeServer({ hmacSecret, codexClient }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/v1/agt002-preview/run`,
    async close() {
      await new Promise(resolve => server.close(resolve));
    },
  };
}
```

```js
// tests/agt002-preview-hetzner-bridge-parity.integration.test.mjs
import assert from 'node:assert/strict';
import { startSyntheticAgt002HetznerBridge } from './fixtures/agt002-hetzner-bridge-synthetic-server.mjs';
import { createAgt002HetznerBridgeClient } from '../agt002-hetzner-bridge-client.js';
import { createAgt002PreviewEngine, AGT002_PREVIEW_POLICY } from '../agt002-preview-engine.js';

const SECRET = 'a'.repeat(32);

function syntheticSuccessCodexClient(modelOutput) {
  return { run: async () => ({ content: JSON.stringify(modelOutput), usage: { input_tokens: 12, output_tokens: 34 }, rate_limit: null }) };
}

async function testEngineProducesValidEnvelopeThroughSyntheticBridge() {
  const modelOutput = {
    recommendation: 'advance', summary: 'Resumen sintético.', strengths: [], weaknesses: [], blockers: [], questions: [], unverified: [],
    next_action: 'Continuar revisión humana.', human_review_required: true,
  };
  const bridge = await startSyntheticAgt002HetznerBridge({ hmacSecret: SECRET, codexClient: syntheticSuccessCodexClient(modelOutput) });
  try {
    const client = createAgt002HetznerBridgeClient({ url: bridge.url, hmacSecret: SECRET });
    const engine = createAgt002PreviewEngine({
      client, model: 'gpt-x', policyVersion: 'agt002-preview-policy-v1', policyText: AGT002_PREVIEW_POLICY,
      timeoutMs: 5000, maxConcurrent: 1, dailyMaxRuns: 5, countDailyRuns: async () => 0,
    });
    const envelope = await engine.analyze({
      opportunity: { id: '11111111-1111-1111-1111-111111111111' },
      documents: [{ document_id: '22222222-2222-2222-2222-222222222222', name: 'doc.pdf', document_type: 'legal', content: 'texto', content_sha256: 'a'.repeat(64), current: true }],
      companyProfile: { profile_version: 'v1', fields: [] },
      deepAnalysis: {},
      snapshotId: '33333333-3333-3333-3333-333333333333',
    }, { idempotencyKey: 'idem-parity-1' });
    assert.equal(envelope.agent_id, 'AGT-002');
    assert.equal(envelope.schema_version, '2.0-preview.1');
    assert.equal(envelope.human_review_required, true);
  } finally {
    await bridge.close();
  }
}

await testEngineProducesValidEnvelopeThroughSyntheticBridge();
console.log('agt002-preview-hetzner-bridge-parity.integration.test.mjs OK');
```

Nota: adaptar los campos exactos de `opportunity`/`documents`/`companyProfile`/`deepAnalysis` a la firma real que `agt002-preview-engine.js` espera de `engine.analyze(...)` si difiere del snippet anterior (verificar contra `tests/agt002-preview-engine.test.mjs` ya existente al ejecutar el Step 2; ese archivo de prueba ya existente es la fuente de verdad de la firma, no este plan).

- [ ] **Step 2: Ejecutar y comprobar fallo o ajuste de firma**

Run: `node tests/agt002-preview-hetzner-bridge-parity.integration.test.mjs`
Expected: FAIL inicialmente por módulos faltantes; una vez creados los archivos del Step 1, si falla por forma de argumentos de `engine.analyze(...)`, corregir el fixture de esta prueba para igualar exactamente la firma que ya usa `tests/agt002-preview-engine.test.mjs`, sin modificar `agt002-preview-engine.js`.

- [ ] **Step 3: Verificar**

Run: `node tests/agt002-preview-hetzner-bridge-parity.integration.test.mjs`
Expected: PASS.

Run de paridad adicional (no deben romperse; confirman que el motor y el endpoint siguen comportándose igual que hoy):
```bash
node tests/agt002-preview-engine.test.mjs
node tests/agt002-preview-surface.test.mjs
node tests/agt002-preview-claims-pglite.integration.test.mjs
npm run check:backend-parity
```
Expected: PASS (las mismas 2 fallas preexistentes de PGlite, si ya estaban documentadas antes de este plan, no cuentan como regresión; cualquier falla nueva sí debe investigarse).

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/agt002-hetzner-bridge-synthetic-server.mjs tests/agt002-preview-hetzner-bridge-parity.integration.test.mjs
git commit -m "test(agt002): add synthetic HTTP bridge fixture and end-to-end parity coverage"
```

---

### Task 10: Auditoría RBAC mecánica — lógica pura y reporte (sin tocar `access-control.js`)

**Files:**
- Create: `agt002-hetzner-bridge-rbac-audit.js`
- Create: `tests/agt002-hetzner-bridge-rbac-audit.test.mjs`
- Create: `scripts/check_agt002_bridge_rbac_eligibility.mjs`

**Interfaces:**
- Consumes: `requireAction`, `ACTIONS` (ya existentes en `access-control.js`, sin cambios).
- Produces: `diffEligibility(eligibleIds, expectedIds) → { extra, missing, ok }`; `findEligibleProfiles(profiles, isEligible = defaultIsEligible) → string[]` (ids).

Esta tarea **no** ejecuta la auditoría contra Supabase real ni asume la forma exacta de un perfil humano válido para `canHumanTenderAction` (no verificada por este plan). Por eso la lógica de comparación (`diffEligibility`) se prueba de forma pura e inyectable, y `defaultIsEligible` se ejercita solo con perfiles mínimos que deben resultar en "no elegible" de forma segura (nunca lanza), dejando la verificación real de "exactamente Katherine y Juan" para la Tarea 15 (gate humano de Fase 3, no ejecutada ahora).

- [ ] **Step 1: Prueba roja**

```js
// tests/agt002-hetzner-bridge-rbac-audit.test.mjs
import assert from 'node:assert/strict';
import { diffEligibility, findEligibleProfiles } from '../agt002-hetzner-bridge-rbac-audit.js';

function testDiffEligibilityExactMatch() {
  assert.deepEqual(diffEligibility(['a', 'b'], ['b', 'a']), { extra: [], missing: [], ok: true });
}

function testDiffEligibilityDetectsExtraProfile() {
  assert.deepEqual(diffEligibility(['a', 'b', 'c'], ['a', 'b']), { extra: ['c'], missing: [], ok: false });
}

function testDiffEligibilityDetectsMissingProfile() {
  assert.deepEqual(diffEligibility(['a'], ['a', 'b']), { extra: [], missing: ['b'], ok: false });
}

function testDiffEligibilityDetectsBothExtraAndMissing() {
  const result = diffEligibility(['a', 'x'], ['a', 'b']);
  assert.deepEqual(result, { extra: ['x'], missing: ['b'], ok: false });
}

function testFindEligibleProfilesUsesInjectedPredicate() {
  const profiles = [{ id: '1', role: 'admin' }, { id: '2', role: 'ventas' }, { id: '3', role: 'gerencia' }];
  const isEligible = (profile) => profile.role === 'admin' || profile.role === 'gerencia';
  assert.deepEqual(findEligibleProfiles(profiles, isEligible), ['1', '3']);
}

function testFindEligibleProfilesDefaultNeverThrowsOnMinimalProfile() {
  const profiles = [{ id: 'x', role: 'other' }];
  assert.doesNotThrow(() => findEligibleProfiles(profiles));
  assert.deepEqual(findEligibleProfiles(profiles), []);
}

testDiffEligibilityExactMatch();
testDiffEligibilityDetectsExtraProfile();
testDiffEligibilityDetectsMissingProfile();
testDiffEligibilityDetectsBothExtraAndMissing();
testFindEligibleProfilesUsesInjectedPredicate();
testFindEligibleProfilesDefaultNeverThrowsOnMinimalProfile();
console.log('agt002-hetzner-bridge-rbac-audit.test.mjs OK');
```

- [ ] **Step 2: Ejecutar y comprobar fallo**

Run: `node tests/agt002-hetzner-bridge-rbac-audit.test.mjs`
Expected: FAIL — `Cannot find module '../agt002-hetzner-bridge-rbac-audit.js'`.

- [ ] **Step 3: Implementar la lógica pura**

```js
// agt002-hetzner-bridge-rbac-audit.js
import { requireAction, ACTIONS } from './access-control.js';

export function diffEligibility(eligibleIds, expectedIds) {
  const eligible = new Set(eligibleIds);
  const expected = new Set(expectedIds);
  return {
    extra: [...eligible].filter((id) => !expected.has(id)),
    missing: [...expected].filter((id) => !eligible.has(id)),
    ok: eligible.size === expected.size && [...expected].every((id) => eligible.has(id)),
  };
}

function defaultIsEligible(profile) {
  try {
    requireAction(profile, ACTIONS.AI_ANALYSIS_RUN);
    return true;
  } catch {
    return false;
  }
}

export function findEligibleProfiles(profiles, isEligible = defaultIsEligible) {
  return profiles.filter(isEligible).map((profile) => profile.id);
}
```

- [ ] **Step 4: Verificar**

Run: `node tests/agt002-hetzner-bridge-rbac-audit.test.mjs`
Expected: PASS.

- [ ] **Step 5: Script CLI para la ejecución humana de Fase 3 (no ejecutado ahora)**

```js
// scripts/check_agt002_bridge_rbac_eligibility.mjs
import { readFileSync } from 'node:fs';
import { diffEligibility, findEligibleProfiles } from '../agt002-hetzner-bridge-rbac-audit.js';

function main() {
  const profilesPath = process.argv[2];
  const expectedIdsArg = process.argv[3];
  if (!profilesPath || !expectedIdsArg) {
    console.error('Uso: node scripts/check_agt002_bridge_rbac_eligibility.mjs <perfiles.json> <id1,id2>');
    console.error('perfiles.json debe ser un export humano-generado de la tabla de perfiles reales (Fase 3, gate humano); este script no consulta Supabase.');
    process.exit(2);
  }
  const profiles = JSON.parse(readFileSync(profilesPath, 'utf8'));
  const expectedIds = expectedIdsArg.split(',').map((id) => id.trim()).filter(Boolean);
  const eligibleIds = findEligibleProfiles(profiles);
  const result = diffEligibility(eligibleIds, expectedIds);
  if (!result.ok) {
    console.error('AGT002_BRIDGE_RBAC_AUDIT_FAILED', result);
    process.exit(1);
  }
  console.log('AGT002_BRIDGE_RBAC_AUDIT_OK', { eligibleIds });
}

main();
```

Este script queda **listo pero no se ejecuta en este plan**: requiere un export humano-generado de los perfiles reales (Tarea 15, gate de Fase 3), no una llamada automática a Supabase.

- [ ] **Step 6: Commit**

```bash
git add agt002-hetzner-bridge-rbac-audit.js tests/agt002-hetzner-bridge-rbac-audit.test.mjs scripts/check_agt002_bridge_rbac_eligibility.mjs
git commit -m "feat(agt002): add pure RBAC eligibility diff logic and Phase 3 audit CLI script"
```

---

### Task 11: Artefactos de infraestructura revisables — Caddy, systemd, contenedor portable (NO aplicados)

**Files:**
- Create: `ops/agt002-hetzner-bridge/Caddyfile`
- Create: `ops/agt002-hetzner-bridge/agt002-bridge.service`
- Create: `ops/agt002-hetzner-bridge/Dockerfile`
- Create: `ops/agt002-hetzner-bridge/run-server.mjs`

Esta tarea es **de configuración revisable, no de código con pruebas automatizadas**: produce los artefactos que un humano aplicará manualmente en Hetzner durante la Tarea 14 (Fase 1). Ningún paso de esta tarea instala, aplica, reinicia servicios ni toca Hetzner real.

- [ ] **Step 1: Punto de entrada del proceso Node (composición final, sin lógica nueva)**

```js
// ops/agt002-hetzner-bridge/run-server.mjs
import { createServer } from 'node:http';
import { createAgt002BridgeServer } from '../../agt002-hetzner-bridge-server.js';
import { createCodexAppServerClient } from '../../agt002-preview-codex-client.js';

function requireEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Falta la variable de entorno requerida: ${name}`);
  return value;
}

const hmacSecret = requireEnv('AGT002_BRIDGE_HMAC_SECRET');
const port = Number(requireEnv('AGT002_BRIDGE_LISTEN_PORT'));
const command = process.env.AGT002_CODEX_APP_SERVER_BIN || 'codex';
const args = process.env.AGT002_CODEX_APP_SERVER_ARGS ? JSON.parse(process.env.AGT002_CODEX_APP_SERVER_ARGS) : ['app-server'];

const codexClient = createCodexAppServerClient({ command, args });
const server = createServer(createAgt002BridgeServer({ hmacSecret, codexClient }));
server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'agt002_bridge_listening', port }));
});
```

- [ ] **Step 2: Caddyfile (TLS público automático, reverse proxy a loopback)**

```
# ops/agt002-hetzner-bridge/Caddyfile
# Revisar y aplicar manualmente en Hetzner durante la Tarea 14 (Fase 1). No aplicado por este plan.
agt002.5-78-140-24.sslip.io {
	reverse_proxy 127.0.0.1:{$AGT002_BRIDGE_LISTEN_PORT}
}
```

- [ ] **Step 3: Unidad systemd (usuario de servicio sin privilegios, límites de CPU/memoria)**

```ini
# ops/agt002-hetzner-bridge/agt002-bridge.service
# Revisar y aplicar manualmente en Hetzner durante la Tarea 14 (Fase 1). No aplicado por este plan.
[Unit]
Description=AGT-002 Hetzner bridge (temporary, 30-day bridge)
After=network.target

[Service]
Type=simple
User=agt002-bridge
Group=agt002-bridge
EnvironmentFile=/etc/agt002-bridge/agt002-bridge.env
ExecStart=/usr/bin/node /opt/agt002-bridge/ops/agt002-hetzner-bridge/run-server.mjs
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/agt002-bridge/var
CPUQuota=100%
MemoryMax=512M

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 4: Contenedor portable (para la migración a AWS de la Tarea 20, mismo contrato)**

```dockerfile
# ops/agt002-hetzner-bridge/Dockerfile
# Revisar solamente. No construido ni publicado por este plan.
FROM node:22-slim
WORKDIR /opt/agt002-bridge
COPY agt002-hetzner-bridge-signing.js agt002-hetzner-bridge-nonce-store.js agt002-hetzner-bridge-log.js agt002-hetzner-bridge-auth.js agt002-hetzner-bridge-server.js agt002-preview-codex-client.js ./
COPY ops/agt002-hetzner-bridge/run-server.mjs ./ops/agt002-hetzner-bridge/run-server.mjs
USER node
ENTRYPOINT ["node", "ops/agt002-hetzner-bridge/run-server.mjs"]
```

- [ ] **Step 5: Verificación estática disponible ahora (sin aplicar nada)**

Run: `node --check ops/agt002-hetzner-bridge/run-server.mjs`
Expected: sin salida (sintaxis válida).

No ejecutar `caddy validate`, `systemd-analyze verify` ni `docker build` en este plan: requieren binarios/host de Hetzner reales y quedan para la Tarea 14 (Fase 1, manual, human-gated).

- [ ] **Step 6: Commit**

```bash
git add ops/agt002-hetzner-bridge/Caddyfile ops/agt002-hetzner-bridge/agt002-bridge.service ops/agt002-hetzner-bridge/Dockerfile ops/agt002-hetzner-bridge/run-server.mjs
git commit -m "chore(agt002): add reviewable Caddy/systemd/container artifacts for Hetzner bridge (not applied)"
```

---

### Task 12: Suite final, TypeScript, paridad y build (todavía sin activar el puente)

**Files:**
- Ninguno nuevo (solo ejecución de comandos).

- [ ] **Step 1: Pruebas focales de esta rama**

```bash
node tests/agt002-tender-analysis-contract.test.mjs
node tests/agt002-hetzner-bridge-signing.test.mjs
node tests/agt002-hetzner-bridge-nonce-store.test.mjs
node tests/agt002-hetzner-bridge-log.test.mjs
node tests/agt002-hetzner-bridge-auth.test.mjs
node tests/agt002-hetzner-bridge-server.test.mjs
node tests/agt002-hetzner-bridge-client.test.mjs
node tests/agt002-hetzner-bridge-timeout.integration.test.mjs
node tests/agt002-preview-runtime.test.mjs
node tests/agt002-preview-hetzner-bridge-parity.integration.test.mjs
node tests/agt002-hetzner-bridge-rbac-audit.test.mjs
```

Expected: PASS en las 11.

- [ ] **Step 2: Suite completa una vez**

```bash
for test in tests/*.test.mjs; do node "$test" || exit 1; done
npx tsc --noEmit
npm run check:backend-parity
npm run build
git diff --check
```

Expected: PASS, salvo fallas preexistentes ya documentadas antes de este plan (por ejemplo, las 2 fallas de PGlite ya registradas en planes anteriores); cualquier falla nueva debe investigarse antes de continuar, sin relajar ninguna prueba de este plan.

- [ ] **Step 3: Commit (solo si hubo ajustes de esta verificación)**

```bash
git add -A
git commit -m "test(agt002): confirm full suite and backend parity with Hetzner bridge code present but inactive"
```

Si no hubo ningún cambio de archivos en este Step (la suite pasó sin ajustes), omitir el commit.

---

### Task 13 (Infra, human-gated): Provisionar usuario de servicio, Codex CLI y login humano OAuth autorizado ahora por Juan

Esta tarea describe pasos operativos reales sobre el host Hetzner actual. Juan autorizó explícitamente el 2026-07-27 los pasos 1–4: crear el usuario aislado, instalar Codex CLI, iniciar el device login y verificar la cuenta sin revelar la credencial. El agente puede ejecutar esos pasos, pero el usuario completa personalmente el navegador. Debido a que `#psi-general` es grupal, la URL y el código efímero solo pueden entregarse cuando Juan escriba en una conversación privada con Hermes. El paso 5 (aplicar Caddy/systemd y activar el servicio) conserva un gate posterior y no queda autorizado por esta aprobación.

- [ ] **Paso 1 (manual): Crear usuario de servicio aislado en Hetzner**

En el host Hetzner real (no en este repositorio ni en esta sesión):

```bash
sudo adduser --system --group --home /opt/agt002-bridge --shell /usr/sbin/nologin agt002-bridge
sudo mkdir -p /opt/agt002-bridge/var /etc/agt002-bridge
sudo chown -R agt002-bridge:agt002-bridge /opt/agt002-bridge/var
sudo chmod 700 /etc/agt002-bridge
```

Verificación humana: `id agt002-bridge` muestra el usuario sin `sudo` y sin shell interactivo real.

- [ ] **Paso 2 (manual): Instalar Codex CLI bajo el usuario de servicio**

Instalar `codex` siguiendo la distribución oficial vigente, de forma que el binario quede disponible en el `PATH` del usuario `agt002-bridge` (o referenciado por ruta absoluta en `AGT002_CODEX_APP_SERVER_BIN`). No instalar como root global si el proveedor ofrece instalación por usuario.

- [ ] **Paso 3 (manual, autorizado ahora por Juan): Ejecutar el login humano de dispositivo ChatGPT**

Usando el flujo ya existente y deliberadamente separado (`requestAgt002CodexDeviceCodeLogin`, `agt002-preview-codex-client.js:251-337`, no invocado desde ningún camino automatizado del análisis), un humano con acceso al host Hetzner ejecuta el inicio de sesión de dispositivo **como el usuario de servicio `agt002-bridge`**, en su directorio home.

Importante: la URL de verificación y el código de usuario (`verificationUrl`, `userCode`) que produce este flujo son **efímeros y se generan en el momento real de la ejecución** contra el proveedor; no existen todavía y no pueden preverse ni escribirse en este documento. Cuando el humano ejecute este paso, `verificationUrl`/`userCode` aparecerán en la salida de esa ejecución puntual, se usarán una sola vez en el navegador del humano autorizado, y no deben copiarse a ningún log, commit, issue ni mensaje persistente.

La sesión resultante queda persistida por `codex app-server` dentro del `$HOME` del usuario de servicio `agt002-bridge` (no en `/root`, no en el repositorio, no en Vercel), con permisos de archivo `0600` y propietario exclusivo `agt002-bridge`.

- [ ] **Paso 4 (manual): Verificación de salud sin exponer la credencial**

```bash
sudo -u agt002-bridge codex app-server &
# enviar manualmente initialize + account/read por stdin, confirmar account.type === 'chatgpt'
```

Verificación humana: la sesión quedó activa (`account.type === 'chatgpt'`), sin que ningún fragmento de la credencial haya aparecido en la terminal compartida, en un log persistente o en cualquier canal de mensajería.

- [ ] **Paso 5 (manual): Aplicar los artefactos de la Tarea 11**

Copiar los archivos de aplicación (`agt002-hetzner-bridge-*.js`, `agt002-preview-codex-client.js`, `ops/agt002-hetzner-bridge/run-server.mjs`) al host, instalar `ops/agt002-hetzner-bridge/Caddyfile` y `ops/agt002-hetzner-bridge/agt002-bridge.service`, y habilitar el servicio (`systemctl enable --now agt002-bridge`). Confirmar que Caddy obtuvo certificado público para `agt002.5-78-140-24.sslip.io` y que el servicio responde a una petición autenticada de prueba con datos sintéticos (nunca reales).

Cierre de Fase 1 (criterio de aceptación de la spec, sección 19): el servicio Hetzner responde correctamente a una verificación de salud autenticada y la sesión OAuth quedó activa, sin que ninguna credencial haya aparecido en un log.

---

### Task 14 (Gate, manual — NO ejecutada ahora): Verificar el timeout real del plan de Vercel en uso (riesgo Crítico 2)

- [ ] **Paso 1 (manual): Confirmar el plan de Vercel activo y su `maxDuration` efectivo**

Un humano con acceso al dashboard de Vercel del proyecto confirma, fuera de este repositorio, el plan contratado (Hobby/Pro/Enterprise) y el límite de duración de función serverless que aplica hoy a `POST /api/tender-documents-analyze-agent-preview`. `vercel.json` no declara hoy ningún `functions.maxDuration` (confirmado por inspección del archivo existente); mientras no se confirme el límite real, no debe asumirse que alcanza para: latencia de red + concurrencia=1 en Hetzner + duración del turno (`timeoutMs`, hoy `AGT002_PREVIEW_TIMEOUT_MS` con default 30.000 ms) + margen del cliente (+2s, Task 6).

- [ ] **Paso 2 (manual, condicional): Si el límite confirmado no alcanza**

No improvisar reintentos. Elegir explícitamente, con decisión humana registrada, entre:
- adoptar el patrón asíncrono (alternativa C de la spec, sección 4: submit + poll/webhook), lo cual requeriría un plan nuevo separado (fuera de alcance de este plan), o
- adelantar la migración a AWS (Tarea 20) antes de activar cualquier ejecución real en Hetzner.

No ambas cosas a la vez sin decisión explícita registrada por Juan.

- [ ] **Paso 3 (manual, condicional): Si el límite confirmado sí alcanza**

Si se decide declarar explícitamente `functions.maxDuration` en `vercel.json` para este endpoint, ese cambio de configuración real requiere su propia aprobación separada de Juan antes de aplicarse — no se aplica como parte de este plan.

Este gate bloquea exclusivamente la Fase 3 (activación); no bloquea las Tareas 0–12 de este plan, que no dependen de un despliegue real.

---

### Task 15 (Gate, manual — NO ejecutada ahora): Validar licenciamiento/ToS y cuenta ChatGPT vigentes antes de activación (riesgo Crítico 1)

- [ ] **Paso 1 (manual): Confirmar que el uso de Codex/ChatGPT vía OAuth para este flujo institucional cumple los términos de servicio vigentes**

Un humano (Juan) confirma, fuera de este repositorio, que la cuenta ChatGPT que se usará en el login de la Tarea 13 está habilitada y licenciada para este uso institucional, y que no existe una restricción de ToS que prohíba automatizar `codex app-server` en este contexto.

- [ ] **Paso 2 (manual): Confirmar la vigencia y el propietario de la cuenta**

Documentar (fuera del repositorio, o en un registro operativo separado, nunca con credenciales) qué cuenta se usó, quién la autorizó y desde cuándo es válida.

Este gate bloquea la Tarea 13, Paso 3 (login humano real); no bloquea ninguna tarea de código de este plan.

---

### Task 16 (Gate, manual — NO ejecutada ahora): Auditoría RBAC real de Fase 3

- [ ] **Paso 1 (manual): Exportar perfiles reales elegibles para `AI_ANALYSIS_RUN`**

Un humano con acceso a Supabase exporta a un archivo JSON local (nunca commiteado) los perfiles con rol `admin`, `gerencia` o `director` y su `id`.

- [ ] **Paso 2 (manual): Ejecutar el script de la Tarea 10 contra ese export**

```bash
node scripts/check_agt002_bridge_rbac_eligibility.mjs /ruta/local/perfiles.json <id-katherine>,<id-juan>
```

Expected: `AGT002_BRIDGE_RBAC_AUDIT_OK`. Si aparece `AGT002_BRIDGE_RBAC_AUDIT_FAILED` con `extra` no vacío, la activación permanece bloqueada hasta corregir los módulos/áreas/rol del perfil sobrante mediante el modelo RBAC existente — nunca hardcodeando nombres en `access-control.js`.

Este gate bloquea exclusivamente la Fase 3 (activación en producción); no bloquea las Tareas 0–12.

---

### Task 17 (Fase 3, manual, human-gated — NO ejecutada ahora): Activación controlada y smoke manual

- [ ] **Paso 1 (manual): Confirmar cierre de Tareas 13–16**

Fase 1 (Tarea 13), riesgo Crítico 1 (Tarea 15), riesgo Crítico 2 (Tarea 14) y auditoría RBAC (Tarea 16) deben estar cerrados antes de este paso.

- [ ] **Paso 2 (manual): Encender el kill switch en Vercel**

Configurar `AGT002_HETZNER_BRIDGE_URL`, `AGT002_HETZNER_BRIDGE_HMAC_SECRET`, `AGT002_PREVIEW_MODEL`, `AGT002_PREVIEW_POLICY_VERSION`, `TENDER_ANALYSIS_ENGINE=agt002_codex_preview` como variables de entorno reales del proyecto en Vercel. Este paso es un cambio de configuración real y requiere aprobación explícita de Juan inmediatamente antes de aplicarlo.

- [ ] **Paso 3 (manual): Una única ejecución real con datos sintéticos, revisada por Juan o Katherine**

Ejecutar el flujo de análisis IA desde la interfaz de Licitaciones usando únicamente datos sintéticos o extractos ya minimizados (nunca un expediente real completo), y revisar manualmente el resultado antes de considerar la Fase 3 cerrada.

- [ ] **Paso 4 (manual): Cerrar Fase 3 según criterio de aceptación de la spec (sección 19)**

Confirmar que el resultado se persistió correctamente como `AGT-002`/`agent_ai` en `psi_tender_analysis_runs`, con GO/NO GO permaneciendo una decisión humana separada.

---

### Task 18 (Rollback, verificable ahora + runbook manual): Confirmar los dos mecanismos de kill switch

- [ ] **Step 1: Prueba automatizada ya cubierta**

La Tarea 8, `testConfiguredRequiresHetznerBridgeUrlAndSecret`, ya prueba el mecanismo 1 (ausencia de variable de entorno en Vercel → `isAgt002PreviewConfigured` falla cerrado). No se requiere una prueba nueva: correr de nuevo para confirmar antes del cierre de este plan.

Run: `node tests/agt002-preview-runtime.test.mjs`
Expected: PASS.

- [ ] **Paso 2 (manual, Hetzner real, no ejecutado ahora): Confirmar el mecanismo 2**

```bash
sudo systemctl stop agt002-bridge
```

Verificación humana: una petición firmada contra `https://agt002.5-78-140-24.sslip.io/v1/agt002-preview/run` falla por error de conexión; el cliente Vercel lo traduce a `AGT002_CODEX_TRANSPORT_ERROR` y el endpoint cae a `useRulesFallback` (comportamiento ya existente en `server/index.js`, sin cambios, Tarea de este plan no lo modifica).

- [ ] **Paso 3 (manual): Confirmar que no hay estado huérfano en Supabase**

Verificar que `psi_agt002_preview_claims` sigue expirando por `lease_expires_at` sin intervención (comportamiento ya existente, sin cambios de este plan).

---

### Task 19 (Migración obligatoria, manual, human-gated — NO ejecutada ahora): Migración a AWS dentro de 30 días naturales

Este plan no implementa la migración; documenta su forma obligatoria (spec, sección 15) para que quede como tarea de seguimiento explícita y con fecha límite dura, no orientativa.

- [ ] **Paso 1 (manual): Registrar la fecha límite dura**

Al activar el puente en la Tarea 17, registrar en un lugar operativo (no en código) la fecha de activación + 30 días naturales como fecha límite dura de decommission de Hetzner.

- [ ] **Paso 2 (manual): Reutilizar el mismo contrato/contenedor en AWS**

Desplegar el mismo `Dockerfile`/servicio de la Tarea 11 en AWS, con una **nueva** sesión OAuth de ChatGPT provisionada allí (nunca copiar la sesión de Hetzner entre hosts).

- [ ] **Paso 3 (manual): Repetir el smoke manual (Tarea 17, Paso 3) contra AWS**

Antes de considerar la migración completa.

- [ ] **Paso 4 (manual): Revocar la sesión OAuth en Hetzner explícitamente**

No basta con detener el servicio (Tarea 18): revocar la sesión OAuth de forma explícita.

- [ ] **Paso 5 (manual): Destruir el servicio temporal en Hetzner**

Detener y desaprovisionar, sin dejar el puente corriendo en paralelo una vez confirmado el corte a AWS.

- [ ] **Paso 6 (manual): Confirmar cierre dentro del plazo**

Este plan de migración es obligatorio, no opcional, al cumplirse el límite de 30 días desde la activación del puente, independientemente de si hubo o no incidentes (spec, sección 15, último punto).

---

## Resumen de gates humanos (ninguno se ejecuta en este plan)

| Tarea | Naturaleza | Bloquea |
|---|---|---|
| 13 | Provisionamiento Hetzner + login OAuth humano (autorizado ahora por Juan, ejecutado después, fuera de esta sesión) | Fase 1 |
| 14 | Verificación del timeout/plan real de Vercel | Fase 3 (activación) |
| 15 | Validación de licenciamiento/ToS y cuenta ChatGPT vigente | Fase 1 (login real) |
| 16 | Auditoría RBAC real contra Supabase | Fase 3 (activación) |
| 17 | Encendido real del kill switch + smoke manual | Producción real |
| 19 | Migración a AWS dentro de 30 días | Decommission de Hetzner |

Ninguna tarea de este plan hace push, deploy, aprovisiona Hetzner de verdad, ejecuta un login OAuth real, ni usa datos reales de licitaciones. Las Tareas 0–12 son código puro, probado en loopback local o sin red; las Tareas 13–19 son runbooks humanos explícitamente marcados como no ejecutados.
