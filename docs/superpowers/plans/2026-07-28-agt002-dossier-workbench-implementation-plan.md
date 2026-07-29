# AGT-002 Dossier Workbench (Lote 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la Mesa de trabajo post-GO de Vig-IA dentro del expediente de Licitaciones: conversación contextual durable, borradores versionados con revisión humana, fuentes/faltantes, acciones requeridas y aprendizaje gobernado, sin conectar ni activar todavía AGT-002 real.

**Architecture:** Se crea un dominio conversacional propio de AGT-002 en la migración `045`, separado de AGT-003 y del pipeline documental. Hilos, mensajes, vínculos, trabajos y eventos son append-only; el estado de trabajo se proyecta desde eventos. La versión documental producida por agente se añade mediante un RPC interno con `base_version_id` optimista y procedencia al trabajo originador; nunca crea revisión. Un API Express/Vercel deriva el actor de sesión y queda cerrado por un kill switch cableado a `false`. El frontend usa un shell reutilizable, configurado para Vig-IA, pero no se monta mientras el backend informe `enabled:false`. El worker se prueba sólo con un respondedor sintético inyectado desde `tests/fixtures/`; no existe bridge productivo en este lote.

**Tech Stack:** PostgreSQL/Supabase (`plpgsql`, RLS, `SECURITY DEFINER`, service-role-only), Node.js ESM + Express, React + TypeScript + Vite, CSS plano, Node native test runner por archivo, PGlite, esbuild y Chrome headless para QA visual local.

## Global Constraints

- La especificación canónica es `docs/superpowers/specs/2026-07-28-agt002-dossier-workbench-design.md`; ante conflicto, prevalece.
- Identidad visible: `Vig-IA · Copiloto de Licitaciones`. `AGT-002` sólo aparece en contrato y auditoría técnica.
- Vig-IA nunca aprueba, firma, envía, radica, presenta, decide GO/NO-GO ni ejecuta acciones humanas.
- Toda versión agente nace `pendiente_revision`; una versión nueva no hereda aprobación.
- La encargada revisa documentos/aprendizajes con `licitaciones_custodia`; esto no concede `LICITACIONES_GO_NO_GO_APPROVE`.
- Un hilo principal activo por oportunidad; ningún recurso puede cruzar `opportunity_id`.
- Tablas de conversación, trabajos, eventos y aprendizaje: RLS activa, sin acceso directo para `anon` ni `authenticated`; RPC cerrados a `service_role`.
- No reutilizar `psi_agt003_copilot_runs`, `psi_agt003_copilot_claims`, `psi_agt003_copilot_feedback` ni `psi_tender_processing_jobs`.
- `contract_version`, `policy_version`, snapshot y `base_version_id` se congelan al crear el trabajo.
- Resultado obsoleto: registrar `stale`; no insertar mensaje agente vigente ni versión documental.
- El shell común no concede capacidades implícitas; ausencia de configuración = fail-closed.
- Paridad byte-idéntica obligatoria entre `server/index.js` y `api/[...path].js`.
- Sólo datos sintéticos en tests. Sin migración remota, datos reales, secretos, bridge, bot, push, PR, deploy ni activación.
- TDD estricto: test primero, observar RED correcto, implementación mínima, observar GREEN, refactor sólo en verde.
- Una revisión por tarea. Re-revisión únicamente por hallazgo Critical/Important o regresión.

---

## 0. Mapa de archivos

### Crear

- `supabase/migrations/045_agt002_dossier_workbench.sql` — dominio, permisos, RPC, grants, RLS e integración aditiva con versiones.
- `agt002-workbench-contract.js` — contratos cerrados, capacidades y validadores puros.
- `agt002-workbench-persistence.js` — adapter único de RPC y hashes/idempotencia.
- `agt002-workbench-api.js` — handlers puros con actor de sesión, autorización y kill switch.
- `agt002-workbench-worker.js` — claim/lease, ejecución inyectada y persistencia atómica.
- `src/agents/workbench/types.ts` — interfaces neutrales del shell.
- `src/agents/workbench/AgentWorkbenchShell.tsx` — layout reutilizable sin autoridad propia.
- `src/agents/workbench/agent-workbench.css` — estilos aislados del shell.
- `src/tenders/components/TenderDossierVigiaWorkbench.tsx` — adapter Vig-IA → shell.
- `tests/fixtures/agt002-workbench-synthetic-responder.mjs` — respondedor sintético exclusivo de pruebas.
- `tests/agt002-workbench-contract.test.mjs`
- `tests/agt002-workbench-migration.test.mjs`
- `tests/agt002-workbench-pglite.integration.test.mjs`
- `tests/agt002-workbench-persistence.test.mjs`
- `tests/agt002-workbench-api.test.mjs`
- `tests/agt002-workbench-endpoint-static.test.mjs`
- `tests/agt002-workbench-worker.test.mjs`
- `tests/agt002-workbench-ui.test.mjs`
- `tests/agt002-workbench-prompt-injection.test.mjs`

### Modificar

- `access-control.js` — acciones operativas/custodia separadas.
- `tests/access-control.test.mjs` — matriz de permisos y separación de GO/NO-GO.
- `module-access.js` — conservar `licitaciones_custodia`; sólo ajustar descripción si el test exige reflejar custodia documental.
- `tender-dossier-rpc.js` — incluir `workbench_enabled:false` en la proyección HTTP; no activar runtime.
- `server/index.js` y `api/[...path].js` — imports/rutas idénticas y wiring `isEnabled: () => false`.
- `src/tenders/types.ts` — tipos de workbench y procedencia de versiones.
- `src/tenders/api.ts` — funciones tipadas del workbench.
- `src/tenders/components/TenderDossierWorkspacePanel.tsx` — montar adapter sólo cuando `workbench_enabled === true`.
- `src/tenders/components/tender-dossier.css` — integración mínima de pestaña, sin duplicar estilos del shell.
- `tests/tender-dossier-api.test.mjs` — proyección `workbench_enabled:false`.
- `tests/tender-dossier-ui.test.mjs` — shell ausente cuando flag está apagado.

### Interfaces canónicas entre tareas

```js
// agt002-workbench-contract.js
export const AGT002_WORKBENCH_CONTRACT_VERSION = 'agt002.dossier-workbench.v1';
export const AGT002_WORKBENCH_POLICY_VERSION = 'agt002.dossier-workbench.policy.v1';
export const AGT002_WORKBENCH_CAPABILITIES = Object.freeze({
  reply: 'agt002.dossier-workbench.reply.v1',
  draft: 'agt002.dossier-workbench.draft.v1',
  learningProposal: 'agt002.dossier-workbench.learning-proposal.v1',
});
export function validateAgt002WorkbenchJobInput(value) {}
export function validateAgt002WorkbenchResult(value, { input }) {}
```

```js
// agt002-workbench-persistence.js
export function computeAgt002WorkbenchIdempotencyKey(input) {}
export async function getAgt002Workbench(database, { opportunityId, actorId }) {}
export async function appendAgt002HumanMessage(database, input) {}
export async function claimAgt002WorkbenchJob(database, limits) {}
export async function appendAgt002WorkbenchJobEvent(database, event) {}
export async function appendAgt002AgentResult(database, result) {}
export async function appendAgt002AgentArtifactVersion(database, version) {}
export async function reviewAgt002LearningProposal(database, review) {}
```

```js
// agt002-workbench-api.js
export function createAgt002WorkbenchApi(dependencies) {
  return Object.freeze({
    getWorkspace: async ({ profile, opportunityId }) => {},
    postMessage: async ({ profile, body }) => {},
    retryJob: async ({ profile, body }) => {},
    reviewLearning: async ({ profile, body }) => {},
  });
}
```

```js
// agt002-workbench-worker.js
export async function runAgt002WorkbenchWorker({
  persistence, responder, now = () => new Date(), limits,
}) {}
```

---

## Task 1: Contrato cerrado y matriz de autoridad

**Files:**
- Create: `agt002-workbench-contract.js`
- Create: `tests/agt002-workbench-contract.test.mjs`
- Modify: `access-control.js:22-30, 298-306`
- Modify: `tests/access-control.test.mjs`
- Modify only if required: `module-access.js:18`

**Interfaces:**
- Consumes: tipos/convenciones de `agt003-copilot-contract.js`; acciones actuales de `access-control.js`.
- Produces: constantes y validadores canónicos usados por SQL adapters, API y worker; acciones `LICITACIONES_WORKBENCH_USE` y `LICITACIONES_WORKBENCH_CUSTODY`.

- [ ] **Step 1: Escribir RED del contrato**

El test debe importar y exigir:

```js
import { strict as assert } from 'node:assert';
import {
  AGT002_WORKBENCH_CONTRACT_VERSION,
  AGT002_WORKBENCH_POLICY_VERSION,
  AGT002_WORKBENCH_CAPABILITIES,
  validateAgt002WorkbenchJobInput,
  validateAgt002WorkbenchResult,
} from '../agt002-workbench-contract.js';

assert.equal(AGT002_WORKBENCH_CONTRACT_VERSION, 'agt002.dossier-workbench.v1');
assert.equal(AGT002_WORKBENCH_POLICY_VERSION, 'agt002.dossier-workbench.policy.v1');
assert.equal(AGT002_WORKBENCH_CAPABILITIES.reply, 'agt002.dossier-workbench.reply.v1');

const input = Object.freeze({
  job_id: '10000000-0000-4000-8000-000000000001',
  thread_id: '10000000-0000-4000-8000-000000000002',
  origin_message_id: '10000000-0000-4000-8000-000000000003',
  opportunity_id: '10000000-0000-4000-8000-000000000004',
  tender_id: '10000000-0000-4000-8000-000000000005',
  snapshot_id: '10000000-0000-4000-8000-000000000006',
  base_version_id: null,
  capability_id: AGT002_WORKBENCH_CAPABILITIES.reply,
  contract_version: AGT002_WORKBENCH_CONTRACT_VERSION,
  policy_version: AGT002_WORKBENCH_POLICY_VERSION,
  context_links: [],
  message: 'Identifique los faltantes con sus fuentes.',
});
assert.equal(validateAgt002WorkbenchJobInput(input), true);
assert.throws(() => validateAgt002WorkbenchJobInput({ ...input, opportunity_id: 'otra' }));
assert.throws(() => validateAgt002WorkbenchJobInput({ ...input, action: 'presentar' }));
```

Añadir resultados válidos `reply`, `draft` y `learning_proposal`, y rechazar claves extra, citas fuera de `context_links`, acciones `aprobar|firmar|enviar|radicar|presentar`, identidad visible `AGT-002` y cualquier `human_review_required !== true`.

- [ ] **Step 2: Verificar RED**

Run: `node tests/agt002-workbench-contract.test.mjs`

Expected: FAIL con `ERR_MODULE_NOT_FOUND` para `agt002-workbench-contract.js`.

- [ ] **Step 3: Implementar validadores mínimos**

Usar objetos de claves exactas y conjuntos cerrados. No coercionar valores. Exportar sólo las constantes/funciones de la interfaz canónica. El resultado `draft` debe exigir:

```js
{
  kind: 'draft',
  visible_agent_name: 'Vig-IA',
  human_review_required: true,
  snapshot_id,
  base_version_id,
  artifact_id,
  content_kind: 'markdown' | 'texto' | 'metadata',
  content_text,
  content_metadata,
  source_links,
  missing_information,
}
```

- [ ] **Step 4: Escribir RED de permisos**

Añadir casos a `tests/access-control.test.mjs`:

```js
assert.equal(canAction(custodian, ACTIONS.LICITACIONES_WORKBENCH_CUSTODY), true);
assert.equal(canAction(operator, ACTIONS.LICITACIONES_WORKBENCH_CUSTODY), false);
assert.equal(canAction(custodian, ACTIONS.LICITACIONES_GO_NO_GO_APPROVE), false);
assert.equal(canAction(operator, ACTIONS.LICITACIONES_WORKBENCH_USE), true);
```

El fixture `custodian` tiene permiso `licitaciones_custodia` y no rol manager; `operator` tiene `licitaciones`.

- [ ] **Step 5: Verificar RED y aplicar GREEN**

Run: `node tests/access-control.test.mjs`

Expected RED: acciones inexistentes. Añadir acciones y mapear:

```js
LICITACIONES_WORKBENCH_USE: 'licitaciones.workbench.use',
LICITACIONES_WORKBENCH_CUSTODY: 'licitaciones.workbench.custody',
```

`USE` reutiliza el techo humano operativo y permiso `licitaciones`; `CUSTODY` exige permiso `licitaciones_custodia`, identidad humana activa y no implica GO/NO-GO.

- [ ] **Step 6: Verificar GREEN y commit local**

Run:

```bash
node tests/agt002-workbench-contract.test.mjs
node tests/access-control.test.mjs
```

Expected: ambos imprimen `passed` y exit 0.

Commit:

```bash
git add agt002-workbench-contract.js tests/agt002-workbench-contract.test.mjs access-control.js tests/access-control.test.mjs module-access.js
git commit -m "feat(tenders): definir contrato y custodia de Mesa Vig-IA"
```

---

## Task 2: Migración 045 — dominio append-only y RLS fail-closed

**Files:**
- Create: `supabase/migrations/045_agt002_dossier_workbench.sql`
- Create: `tests/agt002-workbench-migration.test.mjs`
- Create: `tests/agt002-workbench-pglite.integration.test.mjs`

**Interfaces:**
- Consumes: tablas/RPC de `040`; patrón claim/eventos de `043`; permiso `licitaciones_custodia` de Task 1.
- Produces: tablas/RPC `psi_*_agt002_workbench_*` y extensión aditiva de `psi_tender_dossier_artifact_versions`.

- [ ] **Step 1: Escribir RED estático del esquema**

Exigir en `tests/agt002-workbench-migration.test.mjs` estas tablas propias:

```text
psi_agt002_workbench_threads
psi_agt002_workbench_messages
psi_agt002_workbench_message_links
psi_agt002_workbench_jobs
psi_agt002_workbench_job_events
psi_agt002_workbench_required_actions
psi_agt002_learning_proposals
psi_agt002_learning_decisions
```

Exigir `enable row level security`, revoke a `anon, authenticated`, grants sólo a `service_role`, triggers anti-`update/delete` para streams, índice único parcial de hilo activo por oportunidad, unique de idempotencia en jobs, y ausencia de referencias a tablas AGT-003/pipeline.

Run: `node tests/agt002-workbench-migration.test.mjs`

Expected: FAIL porque `045_agt002_dossier_workbench.sql` no existe.

- [ ] **Step 2: Escribir RED PGlite del dominio**

El fixture crea roles/tablas prerequisito mínimos, aplica `040`, luego `045` dos veces. Debe verificar:

```js
await assert.rejects(() => queryAsAuthenticated('select * from public.psi_agt002_workbench_messages'));
await assert.rejects(() => updateAsServiceRole('psi_agt002_workbench_messages'));
assert.equal(await activeThreadCount(OPPORTUNITY_ID), 1);
assert.equal(await duplicateJobCount(IDEMPOTENCY_KEY), 1);
```

Añadir casos de cruce de expedientes: un vínculo a `artifact_id` de otra oportunidad devuelve SQLSTATE `23514`; actor humano forjado/inactivo/agente en RPC humano devuelve `42501`.

Run: `node tests/agt002-workbench-pglite.integration.test.mjs`

Expected: FAIL por migración ausente.

- [ ] **Step 3: Implementar tablas y proyecciones mínimas**

El esquema fija:

```sql
create unique index ... on psi_agt002_workbench_threads(opportunity_id)
where closed_at is null;

alter table psi_tender_dossier_artifact_versions
  add column if not exists author_kind text not null default 'human',
  add column if not exists origin_agent_job_id uuid;
```

Añadir constraints:

```sql
check (author_kind in ('human','agent'));
check (
  (author_kind='human' and origin_agent_job_id is null)
  or (author_kind='agent' and origin_agent_job_id is not null)
);
```

Crear FK de `origin_agent_job_id` después de crear jobs. Los jobs contienen entrada congelada, `idempotency_key`, `contract_version`, `policy_version`, `snapshot_id`, `base_version_id`, capability y actor solicitante; no contienen estado mutable. Los eventos contienen `queued|claimed|released|completed|failed|stale`, `claim_id`, `lease_expires_at`, código y metadata cerrada.

- [ ] **Step 4: Implementar RPC humanos**

Firmas exactas:

```sql
psi_get_or_create_agt002_workbench_thread(p_opportunity_id uuid, p_actor_id uuid) returns jsonb
psi_append_agt002_workbench_message(p_opportunity_id uuid, p_actor_id uuid, p_thread_id uuid, p_content text, p_context_links jsonb, p_idempotency_key text, p_contract_version text, p_policy_version text) returns jsonb
psi_get_agt002_workbench(p_opportunity_id uuid, p_actor_id uuid) returns jsonb
psi_review_agt002_learning_proposal(p_opportunity_id uuid, p_actor_id uuid, p_proposal_id uuid, p_decision text, p_scope text, p_comment text) returns jsonb
```

`append_message` crea atómicamente mensaje humano + job + evento `queued`; actor deriva del servidor y el RPC lo revalida. `review_learning` exige `licitaciones_custodia`; no usa manager GO/NO-GO.

- [ ] **Step 5: Implementar RPC internos del worker**

```sql
psi_claim_agt002_workbench_job(p_worker_id text, p_daily_max_jobs int, p_max_concurrent int, p_lease_seconds int) returns jsonb
psi_append_agt002_workbench_job_event(p_job_id uuid, p_claim_id uuid, p_event_type text, p_metadata jsonb) returns jsonb
psi_append_agt002_agent_result(p_job_id uuid, p_claim_id uuid, p_result jsonb) returns jsonb
psi_append_agt002_agent_artifact_version(p_job_id uuid, p_claim_id uuid, p_artifact_id uuid, p_base_version_id uuid, p_content_kind text, p_content_text text, p_content_metadata jsonb) returns jsonb
```

El último RPC bloquea el artefacto, compara la versión máxima con `p_base_version_id`, valida perfil técnico AGT-002 activo/agent y pertenencia del job. Si difiere: evento `stale`, cero insert de versión. Si coincide: inserta `author_kind='agent'`, `origin_agent_job_id=p_job_id`; no toca reviews.

- [ ] **Step 6: GREEN del esquema**

Run:

```bash
node tests/agt002-workbench-migration.test.mjs
node tests/agt002-workbench-pglite.integration.test.mjs
```

Expected: ambos `passed`; segunda aplicación de `045` no altera conteos ni falla.

- [ ] **Step 7: Commit local**

```bash
git add supabase/migrations/045_agt002_dossier_workbench.sql tests/agt002-workbench-migration.test.mjs tests/agt002-workbench-pglite.integration.test.mjs
git commit -m "feat(tenders): crear dominio durable de Mesa Vig-IA"
```

---

## Task 3: Adapter de persistencia e idempotencia

**Files:**
- Create: `agt002-workbench-persistence.js`
- Create: `tests/agt002-workbench-persistence.test.mjs`

**Interfaces:**
- Consumes: RPC de Task 2; validadores de Task 1.
- Produces: las funciones canónicas de persistencia para API/worker.

- [ ] **Step 1: Escribir RED del adapter**

Usar un `database.rpc` espía y exigir nombres/parámetros exactos. La clave se calcula con canonicalización y SHA-256:

```js
computeAgt002WorkbenchIdempotencyKey({
  threadId,
  originMessageId,
  snapshotId,
  capabilityId,
  contractVersion,
  policyVersion,
  baseVersionId,
});
```

Dos objetos con distinto orden de claves producen el mismo hash; cambiar cualquiera de las versiones produce otro hash.

Run: `node tests/agt002-workbench-persistence.test.mjs`

Expected: FAIL con módulo ausente.

- [ ] **Step 2: Implementar GREEN mínimo**

Usar `unwrapRpc` estricto; no devolver `response.error` al consumidor. Validar estados cerrados de claim: `claimed|existing|in_progress|quota|saturated|empty`. `appendAgt002AgentResult` valida contrato antes de llamar SQL. `appendAgt002AgentArtifactVersion` exige `baseVersionId` explícito: `null` significa artefacto sin versión, no “omitir control”.

- [ ] **Step 3: Añadir RED de duplicado/stale**

El mock devuelve `existing` para la misma clave y `stale` desde el RPC de versión. Verificar que adapter no reintenta ni transforma `stale` en success.

- [ ] **Step 4: Verificar GREEN y commit**

Run: `node tests/agt002-workbench-persistence.test.mjs`

Expected: `agt002-workbench-persistence tests passed`.

```bash
git add agt002-workbench-persistence.js tests/agt002-workbench-persistence.test.mjs
git commit -m "feat(tenders): añadir persistencia de Mesa Vig-IA"
```

---

## Task 4: API fail-closed y paridad Express/Vercel

**Files:**
- Create: `agt002-workbench-api.js`
- Create: `tests/agt002-workbench-api.test.mjs`
- Create: `tests/agt002-workbench-endpoint-static.test.mjs`
- Modify: `tender-dossier-rpc.js`
- Modify: `tests/tender-dossier-api.test.mjs`
- Modify identically: `server/index.js`, `api/[...path].js`

**Interfaces:**
- Consumes: Task 1 acciones; Task 3 persistence; `getAuthContext`/`requireAction` existentes.
- Produces: GET workspace, POST message, POST retry, POST learning review; payload `workbench_enabled:false` en dossier.

- [ ] **Step 1: Escribir RED de API pura**

`createAgt002WorkbenchApi` exige dependencias exactas:

```js
{
  isEnabled, resolveOpportunityResource, getWorkspace,
  appendHumanMessage, retryJob, reviewLearning,
}
```

Casos obligatorios:

```js
await assert.rejects(
  () => api.postMessage({ profile: operator, body: validBody }),
  error => error.status === 503 && error.code === 'AGT002_WORKBENCH_DISABLED',
);
assert.equal(appendHumanMessage.calls.length, 0);
```

Con flag de test `true`, validar claves exactas, UUID, contenido 1..12000, máximo 20 context links, pertenencia de oportunidad resuelta, `LICITACIONES_WORKBENCH_USE`; review exige `CUSTODY`. Un `actor_id` en body debe producir `400 AGT002_WORKBENCH_BAD_REQUEST`.

- [ ] **Step 2: Verificar RED**

Run: `node tests/agt002-workbench-api.test.mjs`

Expected: módulo ausente.

- [ ] **Step 3: Implementar API pura**

Errores públicos estables:

```text
AGT002_WORKBENCH_DISABLED
AGT002_WORKBENCH_BAD_REQUEST
AGT002_WORKBENCH_FORBIDDEN
AGT002_WORKBENCH_NOT_FOUND
AGT002_WORKBENCH_IN_PROGRESS
AGT002_WORKBENCH_QUOTA
AGT002_WORKBENCH_SATURATED
AGT002_WORKBENCH_UNAVAILABLE
```

El handler no acepta `actor_id`, `agent_id`, `contract_version`, `policy_version`, modelo ni estado desde cliente.

- [ ] **Step 4: Escribir RED de endpoints y paridad**

Exigir las mismas rutas en ambos backends:

```text
GET  /api/tender-dossier-workbench
POST /api/tender-dossier-workbench/messages
POST /api/tender-dossier-workbench/jobs/retry
POST /api/tender-dossier-workbench/learning/review
```

Cada ruta obtiene `profile` de `getAuthContext(req)`. El wiring de este lote debe ser literal:

```js
isEnabled: () => false,
```

No leer env para convertirlo en `true`; la activación futura reemplazará el wiring en otro plan.

Run: `node tests/agt002-workbench-endpoint-static.test.mjs`

Expected RED: rutas/import ausentes.

- [ ] **Step 5: Implementar rutas idénticas**

Aplicar exactamente el mismo bloque en `server/index.js` y `api/[...path].js`. Añadir `app.all` 405 para cada ruta. No registrar endpoint interno de worker.

- [ ] **Step 6: Proyectar flag apagado en dossier**

`tender-dossier-rpc.js` añade al payload HTTP:

```js
workbench_enabled: false,
```

El valor no viene del cliente ni de la BD. Actualizar test existente.

- [ ] **Step 7: Verificar GREEN y commit**

Run:

```bash
node tests/agt002-workbench-api.test.mjs
node tests/agt002-workbench-endpoint-static.test.mjs
node tests/tender-dossier-api.test.mjs
npm run check:backend-parity
```

Expected: tests `passed`; parity exit 0.

```bash
git add agt002-workbench-api.js tests/agt002-workbench-api.test.mjs tests/agt002-workbench-endpoint-static.test.mjs tender-dossier-rpc.js tests/tender-dossier-api.test.mjs server/index.js 'api/[...path].js'
git commit -m "feat(tenders): exponer Mesa Vig-IA con kill switch cerrado"
```

---

## Task 5: Shell reutilizable y adapter Vig-IA oculto

**Files:**
- Create: `src/agents/workbench/types.ts`
- Create: `src/agents/workbench/AgentWorkbenchShell.tsx`
- Create: `src/agents/workbench/agent-workbench.css`
- Create: `src/tenders/components/TenderDossierVigiaWorkbench.tsx`
- Create: `tests/agt002-workbench-ui.test.mjs`
- Modify: `src/tenders/types.ts:65-99`
- Modify: `src/tenders/api.ts:79-114`
- Modify: `src/tenders/components/TenderDossierWorkspacePanel.tsx:10-93`
- Modify: `src/tenders/components/tender-dossier.css`
- Modify: `tests/tender-dossier-ui.test.mjs`

**Interfaces:**
- Consumes: API de Task 4; tipos de dossier existentes.
- Produces: shell neutral y adapter Vig-IA; cero llamadas cuando `workbench_enabled=false`.

- [ ] **Step 1: Escribir RED de UI estática y lógica**

Exigir que el shell reciba capabilities explícitas:

```ts
export type AgentWorkbenchCapability = 'message' | 'attach' | 'draft' | 'review' | 'learning';
export type AgentWorkbenchConfig = {
  visibleAgentName: string;
  subtitle: string;
  contextLabel: string;
  capabilities: readonly AgentWorkbenchCapability[];
  humanReviewRequired: true;
};
```

Prohibir `AGT-002` en JSX/copy visible. Exigir paneles: frentes, hilo, contexto/fuentes, acciones requeridas y artefactos/revisión. El test del dossier debe verificar que el componente sólo se monta bajo:

```tsx
{workspace.workbench_enabled && <TenderDossierVigiaWorkbench ... />}
```

Run:

```bash
node tests/agt002-workbench-ui.test.mjs
node tests/tender-dossier-ui.test.mjs
```

Expected RED: archivos/componentes ausentes.

- [ ] **Step 2: Implementar tipos API/frontend**

Añadir tipos cerrados de thread/message/job/action/learning y:

```ts
workbench_enabled: boolean;
```

al `TenderDossierWorkspace`. Añadir loaders/mutators con las cuatro rutas de Task 4. No añadir polling cuando flag está apagado.

- [ ] **Step 3: Implementar shell sin autoridad implícita**

El shell sólo renderiza controles presentes en `config.capabilities`; no infiere permisos por nombre del agente. Botones de aprobar llaman callbacks humanos del adapter; el shell no contiene rutas ni acciones de dominio.

Copy obligatorio del footer:

```text
Control humano obligatorio: Vig-IA prepara borradores y señala faltantes. La encargada debe revisar y aprobar cada versión antes de integrarla al paquete final.
```

- [ ] **Step 4: Implementar adapter de Licitaciones**

Config:

```ts
const VIGIA_DOSSIER_CONFIG = Object.freeze({
  visibleAgentName: 'Vig-IA',
  subtitle: 'Copiloto de Licitaciones',
  contextLabel: 'Expediente activo',
  capabilities: ['message', 'attach', 'draft', 'review', 'learning'],
  humanReviewRequired: true,
} as const);
```

Aunque configure capabilities, el padre no lo monta con flag falso. No usar query param ni localStorage para saltar el gate.

- [ ] **Step 5: GREEN, build y commit**

Run:

```bash
node tests/agt002-workbench-ui.test.mjs
node tests/tender-dossier-ui.test.mjs
npm run build
```

Expected: tests `passed`; `tsc && vite build` exit 0 sin warnings nuevos.

```bash
git add src/agents/workbench src/tenders/components/TenderDossierVigiaWorkbench.tsx src/tenders/types.ts src/tenders/api.ts src/tenders/components/TenderDossierWorkspacePanel.tsx src/tenders/components/tender-dossier.css tests/agt002-workbench-ui.test.mjs tests/tender-dossier-ui.test.mjs
git commit -m "feat(tenders): crear shell desactivado de Mesa Vig-IA"
```

---

## Task 6: Worker durable con respondedor sintético exclusivo de tests

**Files:**
- Create: `agt002-workbench-worker.js`
- Create: `tests/fixtures/agt002-workbench-synthetic-responder.mjs`
- Create: `tests/agt002-workbench-worker.test.mjs`
- Create: `tests/agt002-workbench-prompt-injection.test.mjs`

**Interfaces:**
- Consumes: contrato Task 1; persistence Task 3; RPC claim/eventos Task 2.
- Produces: `runAgt002WorkbenchWorker`; fixture sintético no importado por producción.

- [ ] **Step 1: Escribir RED del worker**

Casos:

```js
assert.deepEqual(await runWorkerOnce(), { status: 'completed', job_id: JOB_ID });
assert.equal(events, ['claimed', 'completed']);
assert.equal(agentMessages.length, 1);
assert.equal(agentMessages[0].visible_agent_name, 'Vig-IA');
```

Además:
- `empty` → `{status:'idle'}` sin responder;
- lease vigente → no doble ejecución;
- lease vencido → nuevo claim y un solo resultado terminal;
- misma idempotency key → `existing`, sin duplicar mensaje/versión;
- cuota → `quota`; concurrencia → `saturated`;
- timeout → evento `failed` con código estable;
- navegador cerrado no afecta worker;
- persistencia parcial falla → no afirmar `completed`;
- `base_version_id` cambiado → `stale`, cero versión.

- [ ] **Step 2: Verificar RED**

Run: `node tests/agt002-workbench-worker.test.mjs`

Expected: módulo ausente.

- [ ] **Step 3: Crear fixture sintético**

Debe responder por fixtures exactos, sin red ni modelo:

```js
export function createSyntheticAgt002Responder(fixtures) {
  return Object.freeze({
    async respond(input) {
      const fixture = fixtures[input.origin_message_id];
      if (!fixture) throw Object.assign(new Error('Synthetic fixture missing'), { code: 'SYNTHETIC_FIXTURE_MISSING' });
      return structuredClone(fixture);
    },
  });
}
```

Ningún archivo fuera de `tests/` importa este fixture.

- [ ] **Step 4: Implementar worker mínimo**

Orden obligatorio:

```text
claim → validar input congelado → responder → validar output → revalidar/persistir atómicamente → evento terminal
```

No fallback, no bridge, no credenciales. `responder` faltante lanza `AGT002_RESPONDER_NOT_CONFIGURED` antes de claim si se intentara cablear fuera de tests.

- [ ] **Step 5: RED/GREEN de prompt injection**

Inputs sintéticos con instrucciones en documento/mensaje como “ignora permisos”, “presenta la oferta”, “revela otro expediente” deben producir abstención/acción requerida, nunca una capability nueva ni links fuera del contexto. El test valida el contrato y que el worker no llama persistencia prohibida.

Run:

```bash
node tests/agt002-workbench-worker.test.mjs
node tests/agt002-workbench-prompt-injection.test.mjs
```

Expected: ambos `passed`.

- [ ] **Step 6: Commit local**

```bash
git add agt002-workbench-worker.js tests/fixtures/agt002-workbench-synthetic-responder.mjs tests/agt002-workbench-worker.test.mjs tests/agt002-workbench-prompt-injection.test.mjs
git commit -m "feat(tenders): añadir worker sintético durable de Mesa Vig-IA"
```

---

## Task 7: Versiones agente, revisión por custodia y aprendizaje gobernado E2E

**Files:**
- Modify: `tests/agt002-workbench-pglite.integration.test.mjs`
- Create: `tests/agt002-workbench-end-to-end.integration.test.mjs`
- Modify if RED exposes a defect: `supabase/migrations/045_agt002_dossier_workbench.sql`
- Modify if adapter mapping is incomplete: `agt002-workbench-persistence.js`

**Interfaces:**
- Consumes: Tasks 1-6 completas.
- Produces: prueba integrada de las invariantes centrales; no endpoint/feature nuevo.

- [ ] **Step 1: Escribir RED de versión agente**

Escenario PGlite:

1. humano operativo crea mensaje/job sobre artefacto versión 1;
2. worker claim válido crea versión 2 agente;
3. versión 2 tiene `author_kind='agent'`, `origin_agent_job_id`, perfil `identity_type='agent'`;
4. proyección muestra `review_status='pendiente'` y `has_approved_version=false`;
5. intento de review por operador sin custodia → `42501`;
6. custodia aprueba versión 2;
7. custodia sigue sin poder ejecutar GO/NO-GO;
8. un nuevo job con base versión 1 queda `stale` y no crea versión 3.

- [ ] **Step 2: Escribir RED de aprendizaje**

Escenario:

```text
mensaje/corrección origen → propuesta pending → no aparece en políticas activas → custodia aprueba con scope/vigencia → decisión append-only → política proyectada activa
```

Rechazar:
- propuesta que cambia límites inmutables;
- scope fuera de `tender|entity|modality_sector|psi_rule`;
- actor sin custodia;
- promoción automática por el agente;
- decisión que cruza oportunidad.

- [ ] **Step 3: Verificar RED correcto**

Run:

```bash
node tests/agt002-workbench-pglite.integration.test.mjs
node tests/agt002-workbench-end-to-end.integration.test.mjs
```

Expected: nuevos asserts fallan por el comportamiento faltante concreto, no por syntax/fixture.

- [ ] **Step 4: GREEN mínimo**

Corregir únicamente contratos/RPC/adapters necesarios. No añadir bridge ni habilitar API. La operación de resultado debe ser transaccional: mensaje agente, required actions, propuesta y versión —cuando existan— quedan todos o ninguno; el evento terminal se añade al final de la misma transacción.

- [ ] **Step 5: Verificar GREEN y commit**

Run:

```bash
node tests/agt002-workbench-pglite.integration.test.mjs
node tests/agt002-workbench-end-to-end.integration.test.mjs
node tests/tender-dossier-offer-gate-pglite.integration.test.mjs
```

Expected: `passed`; el gate de presentación existente continúa exigiendo aprobación de la versión vigente.

```bash
git add supabase/migrations/045_agt002_dossier_workbench.sql agt002-workbench-persistence.js tests/agt002-workbench-pglite.integration.test.mjs tests/agt002-workbench-end-to-end.integration.test.mjs
git commit -m "test(tenders): cerrar versiones y aprendizaje de Mesa Vig-IA"
```

---

## Task 8: QA integral, visual y cierre del plan sin activación

**Files:**
- Modify only for defects found: archivos de Tasks 1-7.
- Do not modify: secrets, deployment, systemd, bridge or production config.

**Interfaces:**
- Consumes: implementación completa de Cortes A/B.
- Produces: evidencia mecánica fresca y gate humano; no activación.

- [ ] **Step 1: Suite focal completa**

Run:

```bash
node tests/agt002-workbench-contract.test.mjs
node tests/access-control.test.mjs
node tests/agt002-workbench-migration.test.mjs
node tests/agt002-workbench-pglite.integration.test.mjs
node tests/agt002-workbench-persistence.test.mjs
node tests/agt002-workbench-api.test.mjs
node tests/agt002-workbench-endpoint-static.test.mjs
node tests/agt002-workbench-worker.test.mjs
node tests/agt002-workbench-prompt-injection.test.mjs
node tests/agt002-workbench-ui.test.mjs
node tests/agt002-workbench-end-to-end.integration.test.mjs
node tests/tender-dossier-api.test.mjs
node tests/tender-dossier-ui.test.mjs
node tests/tender-dossier-offer-gate-pglite.integration.test.mjs
```

Expected: todos imprimen `passed`, exit 0.

- [ ] **Step 2: Build y paridad**

Run:

```bash
npm run check:backend-parity
npm run build
```

Expected: parity exit 0; `tsc && vite build` exitoso.

- [ ] **Step 3: Verificación explícita de kill switch**

Run:

```bash
node tests/agt002-workbench-api.test.mjs
node tests/agt002-workbench-endpoint-static.test.mjs
```

Verificar en salida/asserts:

```text
isEnabled: () => false
AGT002_WORKBENCH_DISABLED
cero invocaciones de persistence/responder con flag apagado
```

Además buscar imports productivos del fixture sintético; el resultado permitido es cero:

```bash
rg "agt002-workbench-synthetic-responder" --glob '!tests/**' .
```

Expected: sin coincidencias.

- [ ] **Step 4: QA visual local del componente aislado**

Renderizar el shell con datos sintéticos mediante un fixture temporal fuera de Git y Chrome headless; no habilitar el componente en la app productiva. Capturar 1440×1200 y revisar:

- identidad visible sólo `Vig-IA`;
- frentes, chat, contexto/fuentes, acciones requeridas y revisión humana visibles;
- footer de control humano completo;
- sin recortes/overlaps;
- foco/labels de botones accesibles;
- sin KPI duplicado ni notas internas.

Expected: PNG de evidencia en `/tmp/agt002-workbench-implementation-qa.png`; no se añade al repo salvo pedido humano.

- [ ] **Step 5: Revisión final del diff**

Run:

```bash
git diff --check
git status --short
git log --oneline --decorate -8
```

Expected: sin whitespace errors; sólo archivos de este plan; varios commits locales; sin push.

- [ ] **Step 6: Gate humano obligatorio**

Presentar a Juan:

```text
Cortes A/B implementados y verificados con respondedor sintético.
AGT-002 real sigue desactivado: no hay bridge, credenciales, servicio, datos reales ni wiring enabled.
```

No redactar ni ejecutar activación hasta autorización explícita. El plan separado de activación deberá cubrir: bridge/credenciales, modelo/cuota/concurrencia/costo, kill switch operativo, prueba sintética end-to-end en entorno objetivo, expediente piloto seleccionado y rollback.

---

## Cobertura de especificación → tareas

| Requisito | Tarea(s) | Evidencia |
|---|---:|---|
| Un hilo por licitación | 2, 7 | índice único + PGlite |
| Contexto/links sin cruce | 1, 2, 4, 7 | contrato + SQLSTATE + API |
| Procesamiento durable | 2, 3, 6 | jobs/eventos + lease/retry |
| Tres niveles de autoridad | 1, 5, 7 | capabilities + UI + E2E |
| Revisión humana por versión | 2, 7 | RPC agente sin review + custodia |
| Resultado stale no vigente | 2, 3, 6, 7 | `base_version_id` + cero insert |
| Fuentes/faltantes/acciones | 1, 2, 5, 6 | contrato + shell + resultado sintético |
| Aprendizaje gobernado | 2, 4, 7 | proposals/decisions + custodia |
| Límites inmutables | 1, 6, 7 | validación + injection + SQL |
| Vig-IA visible; AGT-002 auditoría | 1, 5 | contract/UI source scan |
| Shell reutilizable aislado | 5 | config/capabilities explícitas |
| Sin mezclar AGT-003/pipeline | 2 | static migration test |
| RLS/service role only | 2 | PGlite roles/grants |
| Actor de sesión no forjable | 2, 4 | RPC/API negative tests |
| Express/Vercel parity | 4, 8 | static + parity script |
| AGT-002 desactivado | 4, 5, 8 | wiring literal false + UI oculta |
| Sin bridge/modelo/datos reales | 6, 8 | fixture tests-only + import scan |

## Self-review obligatorio del implementador

- [ ] Cada función nueva tuvo un test que se observó fallar antes de implementarla.
- [ ] Cada RED falló por la capacidad ausente, no por typo o fixture roto.
- [ ] No quedan marcadores de trabajo pendiente, referencias vagas ni pasos sin contenido ejecutable.
- [ ] Firmas de contrato, persistence, API y worker coinciden exactamente entre tareas.
- [ ] No hay referencias productivas al respondedor sintético.
- [ ] `server/index.js` y `api/[...path].js` conservan paridad.
- [ ] No se concedió GO/NO-GO a custodia.
- [ ] Ningún RPC agente acepta `actor_id` arbitrario desde HTTP.
- [ ] Resultado stale no inserta versión ni mensaje vigente.
- [ ] Una versión agente no puede crear su propia revisión.
- [ ] El shell no aparece ni hace requests con `workbench_enabled=false`.
- [ ] No se añadieron secrets, bridge, servicio, cron, deploy ni activación.
- [ ] La suite focal, build y parity tienen evidencia fresca.

## Límite final del plan

Completar este plan deja **Cortes A y B construidos y probados localmente con datos sintéticos**, pero AGT-002 continúa desactivado. La activación real es otro bloque, otra especificación/plan y otro gate humano.