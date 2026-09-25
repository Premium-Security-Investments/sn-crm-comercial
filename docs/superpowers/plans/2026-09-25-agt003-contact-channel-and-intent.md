# Canal e intención del próximo seguimiento Implementation Plan

**Fecha:** 2026-09-25
**Diseño base:** `docs/superpowers/specs/2026-09-25-agt003-contact-channel-and-intent-design.md`
**Worktree de referencia:** HEAD `9a0adb0d96b1a10838cedca9c3f58258d8a6efd0`, rama `feat/agt003-contact-channel-intent`
**Método:** TDD por capa (contrato → input/api/runtime/engine → estado frontend → UI/presentación). Cada tarea es RED → GREEN antes de pasar a la siguiente. No se hace `git commit` en ningún paso de este plan — el commit único del bloque se hace al final, fuera de este documento.
**Convención de comandos:** `node --test <archivo>` por archivo tocado. No correr la suite completa (`npm test`) de un tirón; al cerrar cada tarea correr `node --test tests/agt003-copilot-*.test.mjs tests/vigia-opportunity-copilot-*.test.mjs` (glob focal de este cambio) y, para la Tarea 3 y 4, además `npx tsc --noEmit`.

## Goal

Reemplazar el botón directo "Preparar próximo seguimiento" por una preparación explícita de dos campos — canal de contacto (`WhatsApp` | `Correo`, sin preselección) e intención comercial (texto libre opcional, ≤500 caracteres) — que viaja hasta el modelo gobernado como instrucción del comercial (no como hecho SIIO), y cuya respuesta se adapta al canal (WhatsApp: sin asunto; correo: asunto + cuerpo). Sin pestaña nueva, sin etiqueta de piloto, sin canal por defecto, sin persistencia del texto libre, sin migración de base de datos.

## Architecture

```
VigiaOpportunityCopilot.tsx (capa 4)
  ├─ opportunity-copilot-state.ts (capa 3): contactChannel | commercialIntent viven en todas las fases
  └─ POST /api/vigia/copilot/generate { opportunity_id, contact_channel, commercial_intent? }
        └─ agt003-copilot-api.js (capa 2): parseGenerateBody → buildAgt003CopilotRequest
              └─ agt003-copilot-input.js (capa 2): embebe contact_channel/commercial_intent en el request cerrado
                    └─ agt003-copilot-contract.js (capa 1): valida forma + reglas semánticas de canal/intención/draft
                          └─ agt003-copilot-engine.js (capa 2): policy + outputSchema condicionados al canal
                                └─ agt003-copilot-persistence.js (capa 2): idempotencyKey incluye canal + hash de intención; STRIP de commercial_intent antes de persistir
```

## Tech Stack

Node.js nativo (`node --test`, sin framework de test), TypeScript + React 18 (esbuild para bundlear `.ts`/`.tsx` en tests, `tsc --noEmit` para chequeo de tipos), JSON Schema draft 2020-12 para los contratos AGT-003, `node:crypto` (`createHash('sha256')`) para hashing determinista.

## Global Constraints

- Sin pestaña adicional: todo vive dentro de `VigiaOpportunityCopilot.tsx` existente.
- Sin la etiqueta "Piloto interno: revise antes de usar; no actualiza SIIO ni envía mensajes" — hoy no existe en el código (verificado por grep), así que ninguna tarea la reintroduce; capa 4 agrega una prueba que la prohíbe explícitamente.
- Sin canal por defecto ni fallback silencioso: ningún radio con `checked` inicial en `true`, ningún `?? 'email'` ni similar en backend.
- Sin nueva persistencia del texto libre: `commercial_intent` se recorta del `request` antes de cualquier `p_input_hash`/columna JSON persistida; sólo viaja al modelo gobernado y a la telemetría como booleano.
- Sin migración SQL: ninguna tarea toca `supabase/migrations` ni RPCs `psi_*`.
- `authority.read_only=true`, `human_review_required=true`, `external_send_allowed=false`, `crm_write_allowed=false`, `public_research_allowed=false` permanecen inalterados en las 4 capas.
- Cada tarea deja la rama en estado verde para las pruebas que toca antes de avanzar a la siguiente (ninguna tarea depende de código que la siguiente tarea todavía no escribió).

---

## Task 1 — Contratos y fixtures (`contracts/agents/AGT-003/v2-draft/`)

### Files

- `contracts/agents/AGT-003/v2-draft/opportunity-copilot.request.schema.json` (editar)
- `contracts/agents/AGT-003/v2-draft/opportunity-copilot.response.schema.json` (editar)
- `contracts/agents/AGT-003/v2-draft/fixtures/valid-opportunity-copilot-request.json` (editar: agregar `contact_channel: "email"`)
- `contracts/agents/AGT-003/v2-draft/fixtures/valid-opportunity-copilot-request-whatsapp.json` (nuevo)
- `contracts/agents/AGT-003/v2-draft/fixtures/valid-opportunity-copilot-response-whatsapp.json` (nuevo)
- `contracts/agents/AGT-003/v2-draft/manifest.json` (editar: registrar los 2 fixtures nuevos)
- `agt003-copilot-contract.js` (editar)
- `tests/agt003-copilot-contract.test.mjs` (editar)

### Interfaces

```ts
// request cerrado (agt003-copilot-contract.js)
type Agt003CopilotRequest = {
  contract_version: '2.0-draft.1';
  capability_id: 'agt003.opportunity-copilot.preview';
  correlation_id: string;
  snapshot_id: string;
  opportunity: {/* sin cambios */};
  interactions: unknown[];
  approved_assets: unknown[];
  contact_channel: 'whatsapp' | 'email';   // nuevo, obligatorio
  commercial_intent?: string;               // nuevo, opcional, 1..500 chars recortados
  authority: {/* sin cambios */};
};

// respuesta: draft.subject se vuelve condicional al contact_channel del request
type Agt003CopilotDraft = { subject: string | null; body: string };
```

### Pasos

- [ ] **Write failing test** — en `tests/agt003-copilot-contract.test.mjs`, agregar (sin tocar las aserciones existentes):
  ```js
  const validWhatsappRequest = load('fixtures/valid-opportunity-copilot-request-whatsapp.json');
  const validWhatsappResponse = load('fixtures/valid-opportunity-copilot-response-whatsapp.json');

  assert.deepEqual(validateSchema(requestSchema, validWhatsappRequest), []);
  assert.deepEqual(validateSchema(responseSchema, validWhatsappResponse), []);
  assert.deepEqual(validateAgt003CopilotRequest(validWhatsappRequest), validWhatsappRequest);
  assert.deepEqual(validateAgt003CopilotResponse(validWhatsappResponse, { request: validWhatsappRequest }), validWhatsappResponse);
  assert.equal(validWhatsappRequest.contact_channel, 'whatsapp');
  assert.equal(validWhatsappResponse.brief.draft.subject, null);

  // contact_channel es obligatorio
  const missingChannel = structuredClone(validRequest);
  delete missingChannel.contact_channel;
  assert.throws(() => validateAgt003CopilotRequest(missingChannel), /contact_channel|canal/i);

  // enum cerrado
  const badChannel = { ...structuredClone(validRequest), contact_channel: 'sms' };
  assert.throws(() => validateAgt003CopilotRequest(badChannel), /contact_channel|canal/i);

  // commercial_intent opcional, acotado
  const withIntent = { ...structuredClone(validRequest), commercial_intent: 'Confirmar fecha de instalación.' };
  assert.deepEqual(validateAgt003CopilotRequest(withIntent), withIntent);
  const tooLongIntent = { ...structuredClone(validRequest), commercial_intent: 'x'.repeat(501) };
  assert.throws(() => validateAgt003CopilotRequest(tooLongIntent), /commercial_intent|intenci/i);
  const emptyIntent = { ...structuredClone(validRequest), commercial_intent: '   ' };
  assert.throws(() => validateAgt003CopilotRequest(emptyIntent), /commercial_intent|intenci/i);

  // draft.subject: null sólo permitido para whatsapp; email exige asunto no vacío
  const emailWithNullSubject = structuredClone(validResponse);
  emailWithNullSubject.brief.draft.subject = null;
  assert.throws(() => validateAgt003CopilotResponse(emailWithNullSubject, { request: validRequest }), /asunto|subject/i);
  const whatsappWithSubject = structuredClone(validWhatsappResponse);
  whatsappWithSubject.brief.draft.subject = 'No debería tener asunto';
  assert.throws(() => validateAgt003CopilotResponse(whatsappWithSubject, { request: validWhatsappRequest }), /asunto|subject|whatsapp/i);
  ```
- [ ] **Run (expected FAIL)** — `node --test tests/agt003-copilot-contract.test.mjs`. Falla porque: los 2 fixtures whatsapp no existen (`ENOENT`), `validRequest`/`validResponse` aún no tienen `contact_channel`/`draft.subject` condicional, y `validateAgt003CopilotRequest`/`validateAgt003CopilotResponse` todavía no conocen `contact_channel`/`commercial_intent`.
- [ ] **Minimal impl — schemas.** En `opportunity-copilot.request.schema.json`, dentro de `required` agregar `"contact_channel"` (mantener el orden existente, agregarlo al final antes de `"authority"` no importa el orden del array) y en `properties` agregar:
  ```json
  "contact_channel": { "type": "string", "enum": ["whatsapp", "email"] },
  "commercial_intent": { "type": "string", "minLength": 1, "maxLength": 500 }
  ```
  (No agregar `"commercial_intent"` a `required`: queda opcional por omisión del array.)
  En `opportunity-copilot.response.schema.json`, cambiar `brief.draft.subject`:
  ```json
  "subject": { "type": ["string", "null"], "maxLength": 300 }
  ```
  (La regla "no vacío salvo whatsapp" es semántica, no expresable en este schema plano; la aplica `agt003-copilot-contract.js`, igual que ya hace con `authority`.)
- [ ] **Minimal impl — fixtures.** Editar `valid-opportunity-copilot-request.json`: agregar `"contact_channel": "email"` (justo antes de `"authority"`). Crear `valid-opportunity-copilot-request-whatsapp.json` como copia de la fixture base con `"contact_channel": "whatsapp"` y `"correlation_id": "corr-synthetic-002"` (para no colisionar en pruebas que comparen igualdad). Crear `valid-opportunity-copilot-response-whatsapp.json` como copia de la fixture de respuesta base con `"correlation_id": "corr-synthetic-002"`, `"brief.draft.subject": null` y `"brief.draft.body"` como mensaje corto de chat (sin fórmulas de correo), por ejemplo: `"Hola, ¿tienes 15 minutos esta semana para revisar la cobertura de sedes? Este borrador requiere revisión humana."`.
- [ ] **Minimal impl — manifest.** En `manifest.json`, agregar a `fixtures`:
  ```json
  { "path": "fixtures/valid-opportunity-copilot-request-whatsapp.json", "schema": "opportunity-copilot.request.schema.json", "valid": true },
  { "path": "fixtures/valid-opportunity-copilot-response-whatsapp.json", "schema": "opportunity-copilot.response.schema.json", "valid": true }
  ```
- [ ] **Minimal impl — `agt003-copilot-contract.js`.**
  ```js
  const REQUEST_KEYS = ['contract_version', 'capability_id', 'correlation_id', 'snapshot_id', 'opportunity', 'interactions', 'approved_assets', 'contact_channel', 'authority'];
  const REQUEST_OPTIONAL_KEYS = ['commercial_intent'];
  const CONTACT_CHANNELS = new Set(['whatsapp', 'email']);
  ```
  Agregar helper junto a `requireClosed`:
  ```js
  function requireClosedWithOptional(value, required, optional, label) {
    if (!isRecord(value)) throw new Error(`${label} debe ser un objeto JSON cerrado sin claves inesperadas.`);
    const allowed = new Set([...required, ...optional]);
    const keys = Object.keys(value);
    if (required.some(key => !Object.hasOwn(value, key)) || keys.some(key => !allowed.has(key))) {
      throw new Error(`${label} debe ser un objeto JSON cerrado sin claves inesperadas.`);
    }
  }
  ```
  En `validateAgt003CopilotRequest`, reemplazar `requireClosed(value, REQUEST_KEYS, 'La solicitud AGT-003');` por:
  ```js
  requireClosedWithOptional(value, REQUEST_KEYS, REQUEST_OPTIONAL_KEYS, 'La solicitud AGT-003');
  ```
  y, después de la validación de `authority` (o antes, el orden no importa mientras esté dentro de la misma función), agregar:
  ```js
  if (!CONTACT_CHANNELS.has(value.contact_channel)) {
    throw new Error('contact_channel es obligatorio y debe ser "whatsapp" o "email".');
  }
  if (Object.hasOwn(value, 'commercial_intent')) {
    const intent = value.commercial_intent;
    if (typeof intent !== 'string' || intent !== intent.trim() || intent.length < 1 || intent.length > 500) {
      throw new Error('commercial_intent debe ser texto recortado de 1 a 500 caracteres.');
    }
  }
  ```
  En `validateAgt003CopilotResponse`, reemplazar el bloque de `brief.draft`:
  ```js
  requireClosed(value.brief.draft, DRAFT_KEYS, 'brief.draft');
  if (!nonEmptyString(value.brief.draft.body, 8000)) throw new Error('El borrador requiere un cuerpo acotado.');
  if (request.contact_channel === 'email') {
    if (!nonEmptyString(value.brief.draft.subject, 300)) throw new Error('El borrador de correo requiere un asunto no vacío y acotado.');
  } else if (value.brief.draft.subject !== null) {
    throw new Error('El borrador de WhatsApp no debe incluir asunto (debe ser null).');
  }
  ```
- [ ] **Run (expected PASS)** — `node --test tests/agt003-copilot-contract.test.mjs`. Verde, incluidas todas las aserciones preexistentes (`widenedAuthority`, etc.) sin modificarlas.

### Criterio observable de cierre

`git diff --stat` toca únicamente los 7 archivos listados en Files. `node --test tests/agt003-copilot-contract.test.mjs` verde.

---

## Task 2 — Input, API, persistencia y engine (`agt003-copilot-input.js`, `agt003-copilot-api.js`, `agt003-copilot-persistence.js`, `agt003-copilot-engine.js`)

**Depende de:** Task 1 (usa `validateAgt003CopilotRequest`/`validateAgt003CopilotResponse` ya extendidos).

### Files

- `agt003-copilot-input.js` (editar)
- `agt003-copilot-api.js` (editar)
- `agt003-copilot-persistence.js` (editar)
- `agt003-copilot-engine.js` (editar)
- `tests/agt003-copilot-input.test.mjs` (editar)
- `tests/agt003-copilot-api.test.mjs` (editar)
- `tests/agt003-copilot-persistence.test.mjs` (editar)
- `tests/agt003-copilot-engine.test.mjs` (editar)
- `tests/agt003-copilot-context-currency-date.test.mjs` (editar — cascada: llama a `buildAgt003CopilotRequest` sin canal)
- `tests/agt003-copilot-prompt-injection.test.mjs` (editar — misma cascada)
- `tests/agt003-copilot-end-to-end.integration.test.mjs` (editar — cascada: `body: { opportunity_id }` sin canal)
- `agt003-copilot-runtime.js` (sin cambios — regresión: `node --test tests/agt003-copilot-runtime.test.mjs` debe seguir verde tal cual, confirma que el canal es un dato por-request y no de configuración del runtime)

### Interfaces

```js
// agt003-copilot-input.js
export function buildAgt003CopilotRequest({
  opportunity, interactions, approvedAssets, correlationId, snapshotId,
  contactChannel,          // nuevo, obligatorio: 'whatsapp' | 'email'
  commercialIntent,        // nuevo, opcional: string ya recortada por el llamador
  now,
}) { /* ... */ }

// agt003-copilot-persistence.js
export function computeAgt003CopilotIdempotencyKey({ snapshotId, policyVersion, model, contactChannel, commercialIntent }) { /* ... */ }
```

### Pasos

- [ ] **Write failing test — input.** En `tests/agt003-copilot-input.test.mjs`, agregar (sin tocar las aserciones existentes; también actualizar la llamada existente en línea 42 agregando `contactChannel: 'email'` para que siga pasando):
  ```js
  // (en la llamada existente a buildAgt003CopilotRequest, agregar contactChannel: 'email' a los args)

  assert.equal(request.contact_channel, 'email');
  assert.equal(Object.hasOwn(request, 'commercial_intent'), false, 'sin intención, la clave no debe existir en el request');

  const withIntent = buildAgt003CopilotRequest({
    opportunity, interactions: [], approvedAssets: [], correlationId: 'corr-001', snapshotId: 'snapshot-001',
    contactChannel: 'whatsapp', commercialIntent: '  Confirmar disponibilidad para visita técnica.  ',
  });
  assert.equal(withIntent.contact_channel, 'whatsapp');
  assert.equal(withIntent.commercial_intent, 'Confirmar disponibilidad para visita técnica.', 'se recorta el texto libre');

  assert.throws(() => buildAgt003CopilotRequest({
    opportunity, interactions: [], approvedAssets: [], correlationId: 'corr-001', snapshotId: 'snapshot-001',
  }), /contact_channel|canal/i, 'contact_channel es obligatorio, sin default');

  assert.throws(() => buildAgt003CopilotRequest({
    opportunity, interactions: [], approvedAssets: [], correlationId: 'corr-001', snapshotId: 'snapshot-001',
    contactChannel: 'sms',
  }), /contact_channel|canal/i);

  assert.throws(() => buildAgt003CopilotRequest({
    opportunity, interactions: [], approvedAssets: [], correlationId: 'corr-001', snapshotId: 'snapshot-001',
    contactChannel: 'email', commercialIntent: 'x'.repeat(501),
  }), /commercial_intent|500|intenci/i);
  ```
- [ ] **Run (expected FAIL)** — `node --test tests/agt003-copilot-input.test.mjs`. Falla: `buildAgt003CopilotRequest` no arma `contact_channel`, así que `validateAgt003CopilotRequest` (ya extendido en Task 1) rechaza el request producido incluso en la llamada existente de la línea 42 una vez se le agrega `contactChannel: 'email'` sin implementación aún — en realidad falla antes, dentro de la propia función si se agrega un guard; si no hay guard todavía, falla en `validateAgt003CopilotRequest` al final con "contact_channel es obligatorio". Cualquiera de las dos rutas es una falla legítima de RED.
- [ ] **Minimal impl — `agt003-copilot-input.js`.** Agregar cerca de las constantes de tope:
  ```js
  const CONTACT_CHANNELS = new Set(['whatsapp', 'email']);
  const MAX_COMMERCIAL_INTENT_CHARS = 500;

  function normalizeCommercialIntent(value) {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') throw new Error('commercial_intent debe ser texto.');
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (trimmed.length > MAX_COMMERCIAL_INTENT_CHARS) throw new Error(`commercial_intent excede el máximo de ${MAX_COMMERCIAL_INTENT_CHARS} caracteres.`);
    return trimmed;
  }
  ```
  En `buildAgt003CopilotRequest`, agregar `contactChannel, commercialIntent` a la desestructuración de parámetros, validar antes de construir `request`:
  ```js
  if (!CONTACT_CHANNELS.has(contactChannel)) throw new Error('contactChannel es obligatorio y debe ser "whatsapp" o "email".');
  const intent = normalizeCommercialIntent(commercialIntent);
  ```
  y en el objeto `request`, agregar (después de `approved_assets`, antes de `authority`):
  ```js
  contact_channel: contactChannel,
  ...(intent !== undefined ? { commercial_intent: intent } : {}),
  ```
- [ ] **Run (expected PASS)** — `node --test tests/agt003-copilot-input.test.mjs`. Verde.
- [ ] **Write failing test — cascada de `buildAgt003CopilotRequest` sin canal.** En `tests/agt003-copilot-context-currency-date.test.mjs`, el helper `build` de la línea 31 pasa `options` ya como spread; agregar `contactChannel: 'email'` al objeto por defecto que arma cada llamada (revisar cada invocación de `build(...)` en el archivo y sumar `{ contactChannel: 'email', ...options }` dentro del propio helper para no tocar cada call-site). En `tests/agt003-copilot-prompt-injection.test.mjs`, agregar `contactChannel: 'email'` a la llamada de la línea 8.
- [ ] **Run (expected FAIL)** — `node --test tests/agt003-copilot-context-currency-date.test.mjs tests/agt003-copilot-prompt-injection.test.mjs`. Fallan hoy (antes del fix del helper) porque `buildAgt003CopilotRequest` ahora exige `contactChannel`.
- [ ] **Minimal impl** — aplicar el cambio de helper/call-site descrito arriba (ya cubierto por el paso anterior; no hay código de producción adicional en este micro-paso).
- [ ] **Run (expected PASS)** — `node --test tests/agt003-copilot-context-currency-date.test.mjs tests/agt003-copilot-prompt-injection.test.mjs`. Verde.
- [ ] **Write failing test — persistencia (idempotencia + strip + telemetría).** En `tests/agt003-copilot-persistence.test.mjs`, actualizar las 3 llamadas existentes a `computeAgt003CopilotIdempotencyKey` (líneas 30/32/33) agregando `contactChannel: 'email'`, y agregar:
  ```js
  const keyEmail = computeAgt003CopilotIdempotencyKey({ snapshotId: request.snapshot_id, policyVersion: response.policy_version, model: response.model, contactChannel: 'email' });
  const keyWhatsapp = computeAgt003CopilotIdempotencyKey({ snapshotId: request.snapshot_id, policyVersion: response.policy_version, model: response.model, contactChannel: 'whatsapp' });
  assert.notEqual(keyEmail, keyWhatsapp, 'el canal participa en la clave de idempotencia');

  const keyNoIntent = computeAgt003CopilotIdempotencyKey({ snapshotId: request.snapshot_id, policyVersion: response.policy_version, model: response.model, contactChannel: 'email' });
  const keyWithIntent = computeAgt003CopilotIdempotencyKey({ snapshotId: request.snapshot_id, policyVersion: response.policy_version, model: response.model, contactChannel: 'email', commercialIntent: 'Confirmar fecha de instalación.' });
  assert.notEqual(keyNoIntent, keyWithIntent, 'la intención (hasheada) participa en la clave de idempotencia');

  assert.throws(() => computeAgt003CopilotIdempotencyKey({ snapshotId: request.snapshot_id, policyVersion: response.policy_version, model: response.model }), /contact_channel|canal/i);
  ```
  Agregar también, junto al bloque de `recordAgt003CopilotRun` existente (que ya construye `request`/`response`/`usage` con un `contact_channel` que hay que sumar a su fixture local de `request`), una aserción de que el `input_hash` persistido no depende del texto de `commercial_intent` (usando dos requests idénticos salvo `commercial_intent`, y comparando que `computeAgt003CopilotHash` de la versión "stripeada" que produce `recordAgt003CopilotRun` sea igual para ambos):
  ```js
  const requestNoIntent = { ...request, contact_channel: 'email' };
  const requestWithIntent = { ...request, contact_channel: 'email', commercial_intent: 'Texto libre que nunca debe llegar a la fila persistida.' };
  const calls = [];
  const capturingDb = rpcDatabase(async (name, params) => { calls.push({ name, params }); return { data: { id: ids.run, idempotency_key: keyEmail, status: 'completed', output: response }, error: null }; });
  await recordAgt003CopilotRun(capturingDb, { opportunityId: ids.opportunity, actorId: ids.actor, claimId: ids.claim, idempotencyKey: keyEmail, request: requestNoIntent, response, usage });
  const hashNoIntent = calls.at(-1).params.p_input_hash;
  calls.length = 0;
  await recordAgt003CopilotRun(capturingDb, { opportunityId: ids.opportunity, actorId: ids.actor, claimId: ids.claim, idempotencyKey: keyEmail, request: requestWithIntent, response, usage });
  assert.equal(calls.at(-1).params.p_input_hash, hashNoIntent, 'el hash persistido ignora commercial_intent (se recorta antes de hashear)');
  ```
  (Adaptar nombres de helpers `rpcDatabase`/`ids`/`response`/`request` a los ya definidos en el archivo real; usar los mismos que usan los bloques `claimAgt003CopilotRun`/`recordAgt003CopilotRun` existentes más arriba en el mismo archivo.)
- [ ] **Run (expected FAIL)** — `node --test tests/agt003-copilot-persistence.test.mjs`. Falla: `computeAgt003CopilotIdempotencyKey` no acepta `contactChannel`/`commercialIntent` todavía y no valida su ausencia; el hash de `recordAgt003CopilotRun` sigue incluyendo `commercial_intent`.
- [ ] **Minimal impl — `agt003-copilot-persistence.js`.**
  ```js
  const CONTACT_CHANNELS = new Set(['whatsapp', 'email']);

  export function computeAgt003CopilotIdempotencyKey({ snapshotId, policyVersion, model, contactChannel, commercialIntent }) {
    const snapshot = requireText(snapshotId, 'El snapshot');
    const policy = requireText(policyVersion, 'La versión de política');
    const modelId = requireText(model, 'El modelo');
    if (!CONTACT_CHANNELS.has(contactChannel)) throw new Error('El canal de contacto Vig-IA es obligatorio para la clave de idempotencia.');
    const intentHash = typeof commercialIntent === 'string' && commercialIntent.trim()
      ? createHash('sha256').update(commercialIntent.trim()).digest('hex')
      : 'none';
    return createHash('sha256').update(`agt003-copilot\0${snapshot}\0${policy}\0${modelId}\0${contactChannel}\0${intentHash}`).digest('hex');
  }
  ```
  Agregar helper de stripping y telemetría, usado por `recordAgt003CopilotRun` y `recordAgt003CopilotFailure`:
  ```js
  function stripCommercialIntent(request) {
    const { commercial_intent, ...rest } = request;
    return { persisted: rest, intentPresent: typeof commercial_intent === 'string' && commercial_intent.trim().length > 0 };
  }
  ```
  En `recordAgt003CopilotRun`: reemplazar
  ```js
  const baseIdempotencyKey = computeAgt003CopilotIdempotencyKey({
    snapshotId: response.snapshot_id, policyVersion: response.policy_version, model: response.model,
  });
  ```
  por
  ```js
  const baseIdempotencyKey = computeAgt003CopilotIdempotencyKey({
    snapshotId: response.snapshot_id, policyVersion: response.policy_version, model: response.model,
    contactChannel: request.contact_channel, commercialIntent: request.commercial_intent,
  });
  ```
  y antes de construir `row`, agregar:
  ```js
  const { persisted: persistedRequest, intentPresent } = stripCommercialIntent(request);
  console.info('agt003_copilot_run_recorded', { event: 'agt003_copilot_run_recorded', contact_channel: request.contact_channel, intent_present: intentPresent });
  ```
  y cambiar `p_input_hash: computeAgt003CopilotHash(request),` por `p_input_hash: computeAgt003CopilotHash(persistedRequest),`.
  Aplicar el mismo patrón (baseIdempotencyKey con canal/intención, `stripCommercialIntent`, `console.info('agt003_copilot_failure_recorded', ...)`, `p_input_hash` sobre `persistedRequest`) dentro de `recordAgt003CopilotFailure`.
- [ ] **Run (expected PASS)** — `node --test tests/agt003-copilot-persistence.test.mjs`. Verde.
- [ ] **Write failing test — engine (policy + schema condicionado al canal).** En `tests/agt003-copilot-engine.test.mjs`, agregar:
  ```js
  assert.match(AGT003_COPILOT_POLICY, /contact_channel/i, 'la política nombra contact_channel');
  assert.match(AGT003_COPILOT_POLICY, /commercial_intent/i, 'la política nombra commercial_intent');
  assert.match(AGT003_COPILOT_POLICY, /instrucci[oó]n del comercial[^.]*no[^.]*(hecho|evidencia)/i, 'la política aclara que la intención es instrucción, no evidencia CRM');
  assert.match(AGT003_COPILOT_POLICY, /whatsapp[^.]*subject[^.]*null/i, 'la política exige subject null en whatsapp');
  assert.match(AGT003_COPILOT_POLICY, /nunca inventes el canal/i, 'la política prohíbe inventar el canal');

  const whatsappRequest = { ...request, contact_channel: 'whatsapp', correlation_id: 'corr-whatsapp' };
  const whatsappBrief = { ...structuredClone(brief), draft: { subject: null, body: 'Mensaje corto de WhatsApp, sujeto a revisión humana.' } };
  const whatsappEngine = createAgt003CopilotEngine({ client: fakeClient(JSON.stringify(whatsappBrief)), model: response.model, policyVersion: response.policy_version, now: () => '2030-02-01T10:01:00.000Z', countDailyRuns: async () => 0 });
  const whatsappResult = await whatsappEngine.draft(whatsappRequest);
  assert.equal(whatsappResult.response.brief.draft.subject, null);

  const emailBriefWithBadSubject = { ...structuredClone(brief), draft: { subject: null, body: brief.draft.body } };
  const emailEngine = createAgt003CopilotEngine({ client: fakeClient(JSON.stringify(emailBriefWithBadSubject)), model: response.model, policyVersion: response.policy_version, now: () => '2030-02-01T10:01:00.000Z', countDailyRuns: async () => 0 });
  await assert.rejects(() => emailEngine.draft({ ...request, contact_channel: 'email' }), /Vig-IA no produjo una respuesta válida/);
  ```
  (`request`/`brief`/`fakeClient`/`response` reutilizan los ya definidos en el archivo; agregar `contact_channel: 'email'` al fixture `request` base cargado desde `valid-opportunity-copilot-request.json`, que Task 1 ya dejó con ese campo.)
- [ ] **Run (expected FAIL)** — `node --test tests/agt003-copilot-engine.test.mjs`. Falla: la política no menciona `contact_channel`/`commercial_intent`, y `buildBriefOutputSchema` sigue exigiendo `subject` string no vacío incluso para WhatsApp (el `emailEngine` en cambio pasaría de largo con un `subject:null` inválido para email, porque el schema hoy no lo rechaza tampoco de ese lado — ambas asserts fallan hoy).
- [ ] **Minimal impl — `agt003-copilot-engine.js`.** Agregar a `AGT003_COPILOT_POLICY` (dentro del array, antes del cierre `].join(' ')`):
  ```js
  'El canal del contacto (`contact_channel`) y, si existe, el objetivo declarado por el comercial (`commercial_intent`) son una instrucción del comercial sobre este contacto, no un hecho del CRM: nunca los cites como evidence_id ni los incluyas en evidence_refs.',
  'Si contact_channel es whatsapp, redacta un mensaje de chat breve: draft.subject debe ser exactamente null y draft.body contiene únicamente el mensaje, sin fórmulas ni encabezado de correo.',
  'Si contact_channel es email, draft.subject debe ser un asunto específico y no vacío y draft.body el cuerpo del correo.',
  'Nunca inventes el canal de contacto: usa exactamente el valor recibido en contact_channel, nunca asumas uno distinto ni lo dejes ambiguo.',
  'Si el comercial declaró commercial_intent, el objetivo del brief (contact_objective) y el borrador deben orientarse a lograrlo sin inventar hechos que no estén en la evidencia.',
  ```
  En `buildBriefOutputSchema(request)`, cambiar la construcción de `draft`:
  ```js
  const subjectSchema = request.contact_channel === 'whatsapp'
    ? { type: 'null' }
    : text(300);
  // ...
  draft: {
    type: 'object',
    additionalProperties: false,
    required: ['subject', 'body'],
    properties: { subject: subjectSchema, body: text(8000) },
  },
  ```
- [ ] **Run (expected PASS)** — `node --test tests/agt003-copilot-engine.test.mjs`. Verde.
- [ ] **Write failing test — API (parseGenerateBody + payload al engine + idempotencia).** En `tests/agt003-copilot-api.test.mjs`, actualizar todas las llamadas existentes a `api.generate({ profile, body: { opportunity_id: opportunityId } })` agregando `contact_channel: 'email'` al `body` (líneas 73, 87/84/83 del bloque `for (const body of [...])` deben mantenerse como negativos pero uno de ellos debe pasar a ser exactamente el caso "falta contact_channel" en vez de redundar con "cuerpo vacío"), y agregar:
  ```js
  // canal ausente es 400, no crashea ni toca dependencias
  {
    const { deps, events } = dependencies();
    await assert.rejects(() => createAgt003CopilotApi(deps).generate({ profile, body: { opportunity_id: opportunityId } }), /canal|contact_channel/i);
    assert.deepEqual(events, []);
  }
  // canal desconocido es 400
  {
    const { deps, events } = dependencies();
    await assert.rejects(() => createAgt003CopilotApi(deps).generate({ profile, body: { opportunity_id: opportunityId, contact_channel: 'sms' } }), /canal|contact_channel/i);
    assert.deepEqual(events, []);
  }
  // intención se propaga tal cual al request del engine
  {
    const { deps, events } = dependencies({
      createRuntime: () => ({ draft: async (request, options) => {
        events.push('provider');
        assert.equal(request.contact_channel, 'whatsapp');
        assert.equal(request.commercial_intent, 'Confirmar visita técnica.');
        return { response: { ...output, correlation_id: request.correlation_id }, usage };
      } }),
    });
    await createAgt003CopilotApi(deps).generate({ profile, body: { opportunity_id: opportunityId, contact_channel: 'whatsapp', commercial_intent: 'Confirmar visita técnica.  ' } });
  }
  // intención mayor a 500 caracteres es 400, sin tocar dependencias
  {
    const { deps, events } = dependencies();
    await assert.rejects(() => createAgt003CopilotApi(deps).generate({ profile, body: { opportunity_id: opportunityId, contact_channel: 'email', commercial_intent: 'x'.repeat(501) } }), /intenci/i);
    assert.deepEqual(events, []);
  }
  ```
- [ ] **Run (expected FAIL)** — `node --test tests/agt003-copilot-api.test.mjs`. Falla: `parseGenerateBody` no exige `contact_channel` y `exactKeys(body, ['opportunity_id'])` rechaza el `body` extendido (todas las llamadas con `contact_channel` fallan con "El cuerpo... debe incluir únicamente opportunity_id").
- [ ] **Minimal impl — `agt003-copilot-api.js`.**
  ```js
  const CONTACT_CHANNELS = new Set(['whatsapp', 'email']);
  const MAX_COMMERCIAL_INTENT_CHARS = 500;

  function parseGenerateBody(body) {
    if (!exactKeys(body, ['opportunity_id', 'contact_channel'], ['commercial_intent'])) {
      throw publicError('El cuerpo de generación Vig-IA debe incluir opportunity_id y contact_channel, y opcionalmente commercial_intent.', 400, 'VIGIA_COPILOT_BAD_REQUEST');
    }
    if (!CONTACT_CHANNELS.has(body.contact_channel)) {
      throw publicError('El canal de contacto de Vig-IA no es válido.', 400, 'VIGIA_COPILOT_BAD_REQUEST');
    }
    let commercialIntent;
    if (body.commercial_intent !== undefined) {
      const trimmed = typeof body.commercial_intent === 'string' ? body.commercial_intent.trim() : '';
      if (!trimmed || trimmed.length > MAX_COMMERCIAL_INTENT_CHARS) {
        throw publicError('La intención comercial de Vig-IA no es válida.', 400, 'VIGIA_COPILOT_BAD_REQUEST');
      }
      commercialIntent = trimmed;
    }
    return {
      opportunityId: requireUuid(body.opportunity_id, 'La oportunidad'),
      contactChannel: body.contact_channel,
      commercialIntent,
    };
  }
  ```
  En `generate({ profile, body })`:
  ```js
  const { opportunityId, contactChannel, commercialIntent } = parseGenerateBody(body);
  ```
  y más abajo, al construir `request`:
  ```js
  const request = buildAgt003CopilotRequest({
    opportunity: context.opportunity,
    interactions: context.interactions || [],
    approvedAssets,
    correlationId: correlationId(),
    snapshotId: context.snapshotId,
    contactChannel,
    commercialIntent,
  });
  let idempotencyKey = computeAgt003CopilotIdempotencyKey({
    snapshotId: request.snapshot_id,
    policyVersion: config.policyVersion,
    model: config.model,
    contactChannel,
    commercialIntent,
  });
  ```
- [ ] **Run (expected PASS)** — `node --test tests/agt003-copilot-api.test.mjs`. Verde.
- [ ] **Write failing test — cascada end-to-end integration.** En `tests/agt003-copilot-end-to-end.integration.test.mjs`, agregar `contact_channel: 'email'` a los dos `body: { opportunity_id: opportunityId }` (líneas 38 y 44).
- [ ] **Run (expected FAIL)** — `node --test tests/agt003-copilot-end-to-end.integration.test.mjs`. Falla hoy porque el `body` todavía no lleva `contact_channel` (antes de aplicar el paso anterior) / o, tras aplicarlo pero antes del resto de esta tarea, porque el resto de la cadena (`api.js`/`input.js`) aún no soporta el campo. Ejecutar este archivo **después** de los pasos de `api.js`/`input.js` de arriba: en ese punto ya debe pasar directo a GREEN sin más cambios de producción — si falla, es señal de que faltó algún call-site en esta tarea.
- [ ] **Run (expected PASS)** — `node --test tests/agt003-copilot-end-to-end.integration.test.mjs`. Verde.
- [ ] **Regresión — runtime sin cambios.** `node --test tests/agt003-copilot-runtime.test.mjs`. Verde sin tocar `agt003-copilot-runtime.js`.

### Criterio observable de cierre

`git diff --stat` toca únicamente los archivos listados en Files más `agt003-copilot-contract.js`/fixtures ya cerrados en Task 1 (no se vuelven a tocar). `node --test tests/agt003-copilot-*.test.mjs` completo (todos los archivos de esa carpeta, incluidos los no tocados: `bridge-client`, `single-action-*`, `proposal-render`, `endpoint-static`, `pilot-permission-migration`, `presentation`, `pglite.integration`) verde — estos últimos no dependen de canal/intención server-side y no deberían requerir edición en esta tarea (se re-verifican, no se tocan).

---

## Task 3 — Estado frontend (`src/vigia/opportunity-copilot-state.ts`)

**Depende de:** nada de las tareas 1/2 en tiempo de compilación (módulo puro sin I/O), pero modela el mismo contrato de payload que la Tarea 2 ya validó server-side.

### Files

- `src/vigia/opportunity-copilot-state.ts` (editar)
- `tests/vigia-opportunity-copilot-state.test.mjs` (editar)

### Interfaces

```ts
export type ContactChannel = 'whatsapp' | 'email';

export function createOpportunityCopilotState(opportunityId: string): OpportunityCopilotState; // contactChannel:null, commercialIntent:''
export function changeCopilotOpportunity(state, opportunityId: string): OpportunityCopilotState; // resetea todo, incluido canal/intención
export function setCopilotContactChannel(state, contactChannel: ContactChannel): OpportunityCopilotState;
export function setCopilotIntent(state, commercialIntent: string): OpportunityCopilotState;
export function canBeginCopilotGeneration(state): boolean; // false si contactChannel===null o phase==='loading'
export function beginCopilotGeneration(state, explicitRequestId?: number): { requestId: number; state: OpportunityCopilotState }; // no-op si !canBeginCopilotGeneration
export function completeCopilotGeneration(state, event): OpportunityCopilotState;
export function failCopilotGeneration(state, event): OpportunityCopilotState;
export function editCopilotDraft(state, patch: Partial<{ subject: string | null; body: string }>): OpportunityCopilotState;
export function changeCopilotPreparation(state): OpportunityCopilotState; // reemplaza a discardCopilotDraft: vuelve a 'idle' conservando contactChannel/commercialIntent
```

### Pasos

- [ ] **Write failing test.** En `tests/vigia-opportunity-copilot-state.test.mjs`, actualizar el import (quitar `discardCopilotDraft`, agregar `changeCopilotPreparation`, `setCopilotContactChannel`, `setCopilotIntent`, `canBeginCopilotGeneration`) y agregar, sin romper la lógica ya cubierta por los asserts existentes (adaptar `discardCopilotDraft(state)` → `changeCopilotPreparation(state)` en la línea que lo usa hoy):
  ```js
  let state = createOpportunityCopilotState(opportunityA);
  assert.equal(state.contactChannel, null, 'sin canal preseleccionado');
  assert.equal(state.commercialIntent, '');
  assert.equal(canBeginCopilotGeneration(state), false, 'no se puede generar sin canal');

  state = setCopilotContactChannel(state, 'whatsapp');
  assert.equal(state.contactChannel, 'whatsapp');
  assert.equal(canBeginCopilotGeneration(state), true);

  state = setCopilotIntent(state, 'Confirmar disponibilidad de sedes.');
  assert.equal(state.commercialIntent, 'Confirmar disponibilidad de sedes.');

  const blocked = beginCopilotGeneration(createOpportunityCopilotState(opportunityA));
  assert.equal(blocked.state.phase, 'idle', 'beginCopilotGeneration es no-op sin canal seleccionado');

  const started = beginCopilotGeneration(state);
  assert.equal(started.state.phase, 'loading');
  assert.equal(started.state.contactChannel, 'whatsapp', 'el canal viaja a loading');
  assert.equal(started.state.commercialIntent, 'Confirmar disponibilidad de sedes.', 'la intención viaja a loading');

  const resultWhatsapp = {
    run_id: '33333333-3333-4333-8333-333333333333', status: 'completed', human_review_required: true,
    output: { brief: { summary: 'Resumen', facts: [], inferences: [], missing_information: [], contact_objective: 'Objetivo', strategy: 'Estrategia', draft: { subject: null, body: 'Mensaje' }, recommended_asset_ids: [], warnings: [], human_review_required: true } },
  };
  let ready = completeCopilotGeneration(started.state, { opportunityId: opportunityA, requestId: started.requestId, result: resultWhatsapp });
  assert.equal(ready.phase, 'ready');
  assert.equal(ready.draft.subject, null);
  assert.equal(ready.contactChannel, 'whatsapp', 'el canal sobrevive hasta ready');

  const backToForm = changeCopilotPreparation(ready);
  assert.equal(backToForm.phase, 'idle');
  assert.equal(backToForm.contactChannel, 'whatsapp', 'Cambiar preparación conserva el canal ya elegido');
  assert.equal(backToForm.commercialIntent, 'Confirmar disponibilidad de sedes.', 'Cambiar preparación conserva la intención ya escrita');

  const restarted = beginCopilotGeneration(backToForm);
  const failed = failCopilotGeneration(restarted.state, { opportunityId: opportunityA, requestId: restarted.requestId, message: 'No disponible' });
  assert.equal(failed.phase, 'error');
  assert.equal(failed.contactChannel, 'whatsapp', 'un error conserva el canal para poder reintentar');
  assert.equal(failed.commercialIntent, 'Confirmar disponibilidad de sedes.');

  const afterOpportunityChange = changeCopilotOpportunity(failed, opportunityB);
  assert.equal(afterOpportunityChange.phase, 'idle');
  assert.equal(afterOpportunityChange.contactChannel, null, 'cambiar de oportunidad limpia el canal');
  assert.equal(afterOpportunityChange.commercialIntent, '', 'cambiar de oportunidad limpia la intención');
  ```
- [ ] **Run (expected FAIL)** — `node --test tests/vigia-opportunity-copilot-state.test.mjs`. Falla: `setCopilotContactChannel`/`setCopilotIntent`/`canBeginCopilotGeneration`/`changeCopilotPreparation` no existen (`undefined is not a function`), y el estado creado hoy no tiene `contactChannel`/`commercialIntent`.
- [ ] **Minimal impl.** Reescribir `src/vigia/opportunity-copilot-state.ts` así (mantener `CopilotProfile`/`canRenderOpportunityCopilot` sin cambios):
  ```ts
  export type ContactChannel = 'whatsapp' | 'email';

  export type CopilotFact = { text: string; evidence_refs: string[] };
  export type CopilotInference = { text: string; evidence_refs: string[]; confidence: 'low' | 'medium' | 'high' };
  export type CopilotBrief = {
    summary: string;
    facts: CopilotFact[];
    inferences: CopilotInference[];
    missing_information: string[];
    contact_objective: string;
    strategy: string;
    draft: { subject: string | null; body: string };
    recommended_asset_ids: string[];
    warnings: string[];
    human_review_required: true;
  };
  export type CopilotResult = {
    run_id: string;
    status: string;
    human_review_required: true;
    output: { brief: CopilotBrief };
  };

  type CopilotBase = {
    opportunityId: string;
    sequence: number;
    contactChannel: ContactChannel | null;
    commercialIntent: string;
  };
  export type OpportunityCopilotState =
    | (CopilotBase & { phase: 'idle' })
    | (CopilotBase & { phase: 'loading'; requestId: number })
    | (CopilotBase & { phase: 'ready'; requestId: number; result: CopilotResult; draft: { subject: string | null; body: string } })
    | (CopilotBase & { phase: 'error'; requestId: number; message: string });

  export function createOpportunityCopilotState(opportunityId: string): OpportunityCopilotState {
    return { phase: 'idle', opportunityId, sequence: 0, contactChannel: null, commercialIntent: '' };
  }

  export function changeCopilotOpportunity(state: OpportunityCopilotState, opportunityId: string): OpportunityCopilotState {
    return { phase: 'idle', opportunityId, sequence: state.sequence + 1, contactChannel: null, commercialIntent: '' };
  }

  export function setCopilotContactChannel(state: OpportunityCopilotState, contactChannel: ContactChannel): OpportunityCopilotState {
    return { ...state, contactChannel };
  }

  export function setCopilotIntent(state: OpportunityCopilotState, commercialIntent: string): OpportunityCopilotState {
    return { ...state, commercialIntent };
  }

  export function canBeginCopilotGeneration(state: OpportunityCopilotState): boolean {
    return state.contactChannel !== null && state.phase !== 'loading';
  }

  export function beginCopilotGeneration(state: OpportunityCopilotState, explicitRequestId?: number) {
    if (!canBeginCopilotGeneration(state)) return { requestId: state.sequence, state };
    const requestId = explicitRequestId ?? state.sequence + 1;
    return {
      requestId,
      state: {
        phase: 'loading', opportunityId: state.opportunityId, sequence: Math.max(state.sequence + 1, requestId), requestId,
        contactChannel: state.contactChannel, commercialIntent: state.commercialIntent,
      } as OpportunityCopilotState,
    };
  }

  export function completeCopilotGeneration(state: OpportunityCopilotState, event: { opportunityId: string; requestId: number; result: CopilotResult }): OpportunityCopilotState {
    if (state.phase !== 'loading' || state.opportunityId !== event.opportunityId || state.requestId !== event.requestId) return state;
    return {
      phase: 'ready', opportunityId: state.opportunityId, sequence: state.sequence, requestId: event.requestId,
      contactChannel: state.contactChannel, commercialIntent: state.commercialIntent,
      result: event.result,
      draft: { ...event.result.output.brief.draft },
    };
  }

  export function failCopilotGeneration(state: OpportunityCopilotState, event: { opportunityId: string; requestId: number; message: string }): OpportunityCopilotState {
    if (state.phase !== 'loading' || state.opportunityId !== event.opportunityId || state.requestId !== event.requestId) return state;
    return {
      phase: 'error', opportunityId: state.opportunityId, sequence: state.sequence, requestId: event.requestId,
      contactChannel: state.contactChannel, commercialIntent: state.commercialIntent,
      message: event.message,
    };
  }

  export function editCopilotDraft(state: OpportunityCopilotState, patch: Partial<{ subject: string | null; body: string }>): OpportunityCopilotState {
    if (state.phase !== 'ready') return state;
    return { ...state, draft: { ...state.draft, ...patch } };
  }

  export function changeCopilotPreparation(state: OpportunityCopilotState): OpportunityCopilotState {
    return {
      phase: 'idle', opportunityId: state.opportunityId, sequence: state.sequence + 1,
      contactChannel: state.contactChannel, commercialIntent: state.commercialIntent,
    };
  }
  ```
  (`canRenderOpportunityCopilot` se mantiene exactamente igual, sólo se reubica debajo de los nuevos tipos.)
- [ ] **Run (expected PASS)** — `node --test tests/vigia-opportunity-copilot-state.test.mjs`. Verde.
- [ ] **Run** — `npx tsc --noEmit`. Verde (confirma que `discardCopilotDraft` no tiene otros consumidores fuera de `VigiaOpportunityCopilot.tsx`, que se actualiza en la Tarea 4).

### Criterio observable de cierre

`git diff --stat` toca únicamente `src/vigia/opportunity-copilot-state.ts` y `tests/vigia-opportunity-copilot-state.test.mjs`. Ningún archivo `.tsx` tocado todavía (se rompe la compilación de `VigiaOpportunityCopilot.tsx` hasta la Tarea 4; es esperado y se resuelve ahí — no correr `tsc --noEmit` sobre el proyecto completo como gate de esta tarea, sólo como chequeo informativo del módulo nuevo).

---

## Task 4 — UI, presentación y estilos (`VigiaOpportunityCopilot.tsx`, `copilot-presentation.ts`, `styles.css`)

**Depende de:** Task 3 (usa `setCopilotContactChannel`/`setCopilotIntent`/`canBeginCopilotGeneration`/`changeCopilotPreparation`).

### Files

- `src/vigia/VigiaOpportunityCopilot.tsx` (editar)
- `src/vigia/copilot-presentation.ts` (editar: tipo `draft.subject` a `string | null`)
- `src/styles.css` (editar)
- `tests/vigia-opportunity-copilot-ui-static.test.mjs` (editar)
- `tests/vigia-opportunity-copilot-followup-copy.test.mjs` (editar)
- `tests/agt003-copilot-single-action-dom.test.mjs` (editar — cascada)
- `tests/agt003-copilot-single-action-focus.test.mjs` (editar — cascada)
- `tests/agt003-copilot-proposal-render.test.mjs` (editar — cascada)

### Interfaces

```tsx
type ProposalDraft = { subject: string | null; body: string };
type ProposalProps = {
  brief: CopilotPresentationBrief;
  draft: ProposalDraft;
  alerts: ReturnType<typeof buildCommercialAlerts>;
  onDraftChange: (patch: Partial<ProposalDraft>) => void;
  onCopy: () => void;
  onChangePreparation: () => void; // reemplaza a onDiscard + onRegenerate
};
```

### Pasos

- [ ] **Write failing test — UI estática.** En `tests/vigia-opportunity-copilot-ui-static.test.mjs`, reemplazar en el primer bloque `'Preparar próximo seguimiento'` por `'Generar seguimiento'`, quitar `'Actualizar propuesta'` y `'onRegenerate'` de la lista de marcadores requeridos, y agregar a esa misma lista:
  ```js
  '¿Cómo será el próximo contacto?',
  'WhatsApp',
  '>Correo<',
  '¿Qué necesita lograr con este contacto?',
  'Cambiar preparación',
  'onChangePreparation',
  'Copiar WhatsApp',
  ```
  En la lista de `forbidden`, agregar:
  ```js
  'Piloto interno: revise antes de usar; no actualiza SIIO ni envía mensajes',
  'Preparar próximo seguimiento',
  'defaultChecked',
  ```
  Ajustar el check de orden DOM (línea `header < alerts < generate`) para que `generate` siga apuntando al selector `'<div className="vigia-copilot-generate">'` (se mantiene dentro del nuevo bloque de preparación, ver Minimal impl). Agregar, junto a los estilos requeridos:
  ```js
  '.vigia-copilot-channel', '.vigia-copilot-intent', '.vigia-copilot-preparation',
  ```
- [ ] **Run (expected FAIL)** — `node --test tests/vigia-opportunity-copilot-ui-static.test.mjs`. Falla: el componente actual sigue diciendo "Preparar próximo seguimiento"/"Actualizar propuesta" y no tiene el fieldset de canal ni el textarea de intención; `styles.css` no tiene las 3 clases nuevas.
- [ ] **Write failing test — followup-copy.** En `tests/vigia-opportunity-copilot-followup-copy.test.mjs`, reemplazar `assert.ok(component.includes('>Preparar próximo seguimiento<'), ...)` por `assert.ok(component.includes('>Generar seguimiento<'), 'el CTA de generación usa el texto exacto "Generar seguimiento"');` y `assert.ok(component.includes("state.phase !== 'error' && !ready && <div className=\"vigia-copilot-generate\">"), ...)` por una comprobación equivalente sobre el nuevo wrapper (ver Minimal impl): `assert.ok(component.includes('!ready && <div className="vigia-copilot-preparation">'), 'el formulario de preparación sólo se renderiza antes de tener un borrador (ready)');`. Reemplazar `assert.ok(component.includes('onRegenerate={generate}'), ...)` por `assert.ok(component.includes('onChangePreparation={() => setState(current => changeCopilotPreparation(current))}'), 'la propuesta ofrece Cambiar preparación conservando canal e intención');` y quitar la aserción de `'>Actualizar propuesta<'`.
- [ ] **Run (expected FAIL)** — `node --test tests/vigia-opportunity-copilot-followup-copy.test.mjs`. Falla por el mismo motivo que el paso anterior.
- [ ] **Write failing test — cascada DOM/focus/proposal-render.**
  - En `tests/agt003-copilot-proposal-render.test.mjs`: cambiar `draft: { subject: 'Seguimiento a la propuesta', body: '...' }` → mantenerlo para el caso email, y reemplazar `renderReactComponent(VigiaCopilotProposal, { brief, draft, alerts: [], onDraftChange: noop, onCopy: noop, onDiscard: noop, onRegenerate: noop })` por `renderReactComponent(VigiaCopilotProposal, { brief, draft, alerts: [], onDraftChange: noop, onCopy: noop, onChangePreparation: noop })`; cambiar el `assert.match(headerMatch[1], /<button type="button" class="secondary">Actualizar propuesta<\/button>/);` por `.../<button type="button" class="secondary">Cambiar preparación<\/button>/`.
  - En `tests/agt003-copilot-single-action-dom.test.mjs` y `tests/agt003-copilot-single-action-focus.test.mjs`: antes de cada `await view.click('.vigia-copilot-generate button')` inicial, agregar la selección de canal: `await view.click('.vigia-copilot-channel input[value="email"]');` (usar el helper `view.click` existente, que ya dispara eventos DOM reales incluidos los de `<input type="radio">`). Reemplazar todas las apariciones de `regenerateButton`/`'Actualizar propuesta'` por `'Cambiar preparación'`, y `.vigia-copilot-proposal-header button` sigue siendo el selector correcto (el botón sigue viviendo ahí, sólo cambia su texto). Donde el segundo ciclo de generación se dispara clickeando `.vigia-copilot-proposal-header button`, verificar que tras ese click el `view.container.querySelector('.vigia-copilot-preparation')` vuelve a existir con el mismo canal ya marcado (no hace falta re-seleccionarlo) antes de clickear `.vigia-copilot-generate button` de nuevo.
- [ ] **Run (expected FAIL)** — `node --test tests/agt003-copilot-proposal-render.test.mjs tests/agt003-copilot-single-action-dom.test.mjs tests/agt003-copilot-single-action-focus.test.mjs`. Fallan: `VigiaCopilotProposal` sigue esperando `onDiscard`/`onRegenerate` y el botón dice "Actualizar propuesta"; no existe `.vigia-copilot-channel`.
- [ ] **Minimal impl — `src/vigia/copilot-presentation.ts`.** Cambiar únicamente el tipo:
  ```ts
  export type CopilotPresentationBrief = {
    summary: string;
    facts: CopilotPresentationFact[];
    inferences: CopilotPresentationInference[];
    missing_information: string[];
    contact_objective: string;
    strategy: string;
    draft: { subject: string | null; body: string };
    recommended_asset_ids: string[];
    warnings: string[];
    human_review_required: true;
  };
  ```
  (`presentCopilotBrief` no lee `brief.draft`, así que no requiere más cambios.)
- [ ] **Minimal impl — `src/vigia/VigiaOpportunityCopilot.tsx`.**
  Imports: reemplazar `discardCopilotDraft` por `changeCopilotPreparation, canBeginCopilotGeneration, setCopilotContactChannel, setCopilotIntent` en el import de `./opportunity-copilot-state`.
  `ProposalProps`:
  ```tsx
  type ProposalDraft = { subject: string | null; body: string };
  type ProposalProps = {
    brief: CopilotPresentationBrief;
    draft: ProposalDraft;
    alerts: ReturnType<typeof buildCommercialAlerts>;
    onDraftChange: (patch: Partial<ProposalDraft>) => void;
    onCopy: () => void;
    onChangePreparation: () => void;
  };
  ```
  `VigiaCopilotProposal`:
  ```tsx
  export function VigiaCopilotProposal({ brief, draft, alerts, onDraftChange, onCopy, onChangePreparation }: ProposalProps) {
    const presented = presentCopilotBrief(brief);
    const compact = presentCompactCopilotSummary(presented, alerts);
    const isEmail = draft.subject !== null;
    return <div className="vigia-copilot-result">
      <p role="status" className="sr-only">Propuesta preparada para revisión.</p>
      <header className="vigia-copilot-proposal-header">
        <h4>Propuesta de seguimiento</h4>
        <button type="button" className="secondary" onClick={onChangePreparation}>Cambiar preparación</button>
      </header>
      <section className="vigia-copilot-brief">
        <div className="vigia-copilot-brief-row"><strong>Situación actual</strong><p>{presented.summary}</p></div>
        <div className="vigia-copilot-brief-row"><strong>Información por confirmar</strong><p>{presented.missingSummary}</p></div>
        <div className="vigia-copilot-brief-row"><strong>Objetivo del próximo contacto</strong><p>{presented.contactObjective}</p></div>
      </section>
      {compact.nextStep && <div className="vigia-copilot-next-step">
        <strong>Siguiente paso:</strong> <span>{compact.nextStep}</span>
      </div>}
      <div className="vigia-copilot-draft">
        {isEmail && <label>Asunto<input value={draft.subject as string} maxLength={300} onChange={event => onDraftChange({ subject: event.target.value })}/></label>}
        <label>{isEmail ? 'Cuerpo' : 'Mensaje'}<textarea value={draft.body} maxLength={8000} rows={10} onChange={event => onDraftChange({ body: event.target.value })}/></label>
      </div>
      <div className="vigia-human-warning"><strong>Revisión humana</strong><span>Puede editar esta propuesta sin modificar el historial de la oportunidad. Verifique nombres, fechas, compromisos y tono antes de copiar el mensaje.</span></div>
      <div className="vigia-copilot-actions"><button type="button" onClick={onCopy}>{isEmail ? 'Copiar correo' : 'Copiar WhatsApp'}</button></div>
      <details className="vigia-copilot-context">
        <summary>Contexto y evidencia · {presented.facts.length} datos · {presented.inferences.length} inferencias · {presented.missingInformation.length} pendientes</summary>
        <section><h5>Datos utilizados</h5>{presented.facts.length ? <ul>{presented.facts.map((fact, index) => <li key={`${fact.text}-${index}`}>{fact.text}</li>)}</ul> : <p className="muted">Sin datos adicionales.</p>}</section>
        <section><h5>Inferencias de Vig-IA · por confirmar</h5>{presented.inferences.length ? <ul>{presented.inferences.map((item, index) => <li key={`${item.text}-${index}`}>{item.text} <span className={`vigia-copilot-confidence confidence-${item.confidence}`}>{CONFIDENCE_LABEL[item.confidence]}</span></li>)}</ul> : <p className="muted">Sin inferencias.</p>}</section>
        <section><h5>Información no verificada</h5>{presented.missingInformation.length ? <ul>{presented.missingInformation.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <p className="muted">Sin brechas de información registradas.</p>}</section>
        {presented.hasApprovedAssets && <section><h5>Adjuntos sugeridos</h5><ul>{presented.recommendedAssetIds.map(id => <li key={id}>{id}</li>)}</ul></section>}
      </details>
    </div>;
  }
  ```
  `VigiaOpportunityCopilot`:
  ```tsx
  export function VigiaOpportunityCopilot({ opportunityId, request, preflight }: Props) {
    const [state, setState] = useState(() => createOpportunityCopilotState(opportunityId));
    const [notice, setNotice] = useState('');
    const requestSequenceRef = useRef(0);

    useEffect(() => {
      requestSequenceRef.current += 1;
      setState(current => changeCopilotOpportunity(current, opportunityId));
      setNotice('');
    }, [opportunityId]);

    const generate = () => {
      if (!canBeginCopilotGeneration(state)) return;
      const contactChannel = state.contactChannel as 'whatsapp' | 'email';
      const commercialIntent = state.commercialIntent.trim();
      const requestId = ++requestSequenceRef.current;
      setState(current => beginCopilotGeneration(current, requestId).state);
      const requestedOpportunityId = opportunityId;
      setNotice('');
      void request<CopilotResult>('/api/vigia/copilot/generate', {
        method: 'POST',
        body: JSON.stringify({
          opportunity_id: requestedOpportunityId,
          contact_channel: contactChannel,
          ...(commercialIntent ? { commercial_intent: commercialIntent } : {}),
        }),
      }).then(result => {
        setState(current => completeCopilotGeneration(current, { opportunityId: requestedOpportunityId, requestId, result }));
      }).catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        setState(current => failCopilotGeneration(current, { opportunityId: requestedOpportunityId, requestId, message }));
      });
    };

    const copyDraft = async () => {
      if (state.phase !== 'ready') return;
      const text = state.draft.subject !== null ? `${state.draft.subject}\n\n${state.draft.body}` : state.draft.body;
      await navigator.clipboard.writeText(text);
      setNotice('Borrador copiado. Revísalo antes de usarlo.');
    };

    const alerts = buildCommercialAlerts(preflight);
    const ready = state.phase === 'ready' ? state : null;
    const brief = ready?.result.output.brief;

    return <section className="vigia-opportunity-copilot" aria-labelledby="vigia-copilot-title">
      <header><div><span className="eyebrow">{VIGIA_VISIBLE_NAMES.commercial}</span><h3 id="vigia-copilot-title">Próximo seguimiento</h3><p>Analiza el contexto y propone un siguiente paso de seguimiento</p></div></header>
      <VigiaCommercialAlerts alerts={alerts} />
      {!ready && <div className="vigia-copilot-preparation">
        <fieldset className="vigia-copilot-channel">
          <legend>¿Cómo será el próximo contacto?</legend>
          <label><input type="radio" name="vigia-copilot-channel" value="whatsapp" checked={state.contactChannel === 'whatsapp'} onChange={() => setState(current => setCopilotContactChannel(current, 'whatsapp'))}/> WhatsApp</label>
          <label><input type="radio" name="vigia-copilot-channel" value="email" checked={state.contactChannel === 'email'} onChange={() => setState(current => setCopilotContactChannel(current, 'email'))}/> Correo</label>
        </fieldset>
        <label className="vigia-copilot-intent">¿Qué necesita lograr con este contacto?
          <textarea value={state.commercialIntent} maxLength={500} rows={3} onChange={event => setState(current => setCopilotIntent(current, event.target.value))}/>
        </label>
        <div className="vigia-copilot-generate">
          <button type="button" disabled={!canBeginCopilotGeneration(state)} onClick={generate}>Generar seguimiento</button>
        </div>
      </div>}
      {state.phase === 'idle' && <div className="vigia-copilot-empty"><p className="muted">Prepara un borrador editable de seguimiento, separado del registro original.</p></div>}
      {state.phase === 'loading' && <div className="notice" role="status">{VIGIA_VISIBLE_NAMES.commercial} está preparando un borrador acotado…</div>}
      {state.phase === 'error' && <div className="vigia-copilot-error" role="alert">
        <span>No se pudo preparar el seguimiento. Puede continuar registrándolo manualmente.</span>
        <button type="button" className="secondary" onClick={generate}>Reintentar</button>
      </div>}
      {ready && brief && <VigiaCopilotProposal
        key={ready.requestId}
        brief={brief}
        draft={ready.draft}
        alerts={alerts}
        onDraftChange={patch => setState(current => editCopilotDraft(current, patch))}
        onCopy={() => void copyDraft()}
        onChangePreparation={() => setState(current => changeCopilotPreparation(current))}
      />}
      {notice && <div className="notice" role="status">{notice}</div>}
    </section>;
  }
  ```
  Nota: el bloque `state.phase === 'error'` ya no está protegido por `!ready` (siempre es `false` cuando `phase==='error'`, así que el formulario de preparación (`!ready`) y el bloque de error coexisten — igual que el diseño exige "Timeout... conservar la preparación y permitir reintento": el formulario reaparece junto al error, con canal/intención ya cargados, y el botón "Reintentar" reutiliza `generate` sin pasar por el formulario si el comercial no cambia nada.
- [ ] **Minimal impl — `src/styles.css`.** Agregar, junto a las reglas `.vigia-copilot-generate`/`.vigia-copilot-draft` existentes:
  ```css
  .vigia-copilot-preparation{display:grid;gap:14px;margin-top:10px}
  .vigia-copilot-channel{display:flex;gap:16px;flex-wrap:wrap;margin:0;padding:0;border:0}
  .vigia-copilot-channel legend{font-weight:900;font-size:12px;color:#334e72;padding:0;margin-bottom:6px;width:100%}
  .vigia-copilot-channel label{display:flex;align-items:center;gap:6px;min-height:44px;font-weight:400;color:#17345b}
  .vigia-copilot-intent{display:grid;gap:6px;color:#334e72;font-size:12px;font-weight:900}
  .vigia-copilot-intent textarea{width:100%;box-sizing:border-box;font-weight:400;resize:vertical}
  ```
  y, dentro del `@media(max-width:720px)` ya existente del panel Vig-IA (misma línea que agrega reglas de `.vigia-copilot-error`), sumar `.vigia-copilot-channel{flex-direction:column}`.
- [ ] **Run (expected PASS)** — `node --test tests/vigia-opportunity-copilot-ui-static.test.mjs tests/vigia-opportunity-copilot-followup-copy.test.mjs tests/agt003-copilot-proposal-render.test.mjs tests/agt003-copilot-single-action-dom.test.mjs tests/agt003-copilot-single-action-focus.test.mjs`. Todos verdes.
- [ ] **Run** — `npx tsc --noEmit`. Verde (confirma que `ProposalDraft`/`CopilotPresentationBrief`/`OpportunityCopilotState` quedaron alineados entre los 3 archivos `.ts`/`.tsx` de esta tarea).

### Criterio observable de cierre

`git diff --stat` toca únicamente los 8 archivos listados en Files de esta tarea (más los ya cerrados en tareas previas, no se vuelven a tocar). Ningún archivo contiene la cadena `Piloto interno` ni `Preparar próximo seguimiento` ni `Actualizar propuesta` ni `Descartar` en `VigiaOpportunityCopilot.tsx`. `node --test tests/agt003-copilot-*.test.mjs tests/vigia-opportunity-copilot-*.test.mjs` completo verde; `npx tsc --noEmit` verde.

---

## Cierre del bloque

No se hace `git commit` en ningún paso de las 4 tareas. Al terminar la Tarea 4 con todo verde, correr una última vez `node --test tests/agt003-copilot-*.test.mjs tests/vigia-opportunity-copilot-*.test.mjs`, `npx tsc --noEmit`, y dejar el árbol de trabajo tal cual para que el commit único del bloque (fuera del alcance de este plan) se haga después de la revisión independiente Sonnet mencionada en el criterio de aceptación 9 del diseño.
