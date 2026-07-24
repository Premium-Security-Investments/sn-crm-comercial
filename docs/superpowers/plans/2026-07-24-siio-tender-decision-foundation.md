# SIIO Tender Decision Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar en SIIO una fuente de verdad tipada, vigente y auditable para análisis documental y GO / NO GO, integrar Hermes como motor temporal `HERMES-INTERIM` apagado por defecto y sustituible, y conservar AGT-002 como destino institucional sin activar datos productivos ni despliegue.

**Architecture:** SIIO captura un snapshot inmutable y liga GO / NO GO al `analysis_run_id` vigente. `TenderAnalysisEngine` selecciona `rules`, `hermes_interim` o `agt002`; cada resultado conserva su productor real. Hermes usa un perfil dedicado y API Server stateless local/privado sin herramientas operativas. AGT-002 v1 permanece intacto y el respondedor sintético existe solo en fixtures.

**Tech Stack:** Node.js ESM, Express, React + TypeScript, Supabase/PostgreSQL, PGlite, JSON Schema draft 2020-12, pruebas Node script y build Vite.

## Global Constraints

- AGT-002 es la única identidad institucional definitiva de IA. Hermes puede operar temporalmente como `HERMES-INTERIM`, sin alias AGT-002 y sin que SIIO llame directamente un proveedor LLM.
- El análisis actual se etiqueta `Preanálisis por reglas SIIO`; nunca se presenta como IA ni como dictamen definitivo.
- El contrato `contracts/agents/AGT-002/v1/**` es inmutable y debe conservar su hash de árbol.
- GO / NO GO es exclusivamente humano, con permiso `LICITACIONES_GO_NO_GO_APPROVE` y justificación obligatoria.
- Un GO requiere un análisis auténtico, completado y vigente para el último snapshot; NO GO también requiere análisis vigente, pero puede reconocer dudas abiertas en su justificación.
- Preguntas críticas abiertas bloquean GO.
- Las rutas generales de interacciones rechazan `tender_document_*` y `tender_offer_preparation`.
- `NO GO`, `cerrada_no_go` y `no_adjudicada` nunca usan tono favorable.
- No desplegar producción, ejecutar migraciones remotas ni enviar documentos reales a Hermes en este plan. El transporte real queda apagado por defecto hasta aprobar proveedor/modelo, tratamiento de datos y presupuesto.
- Mantener paridad exacta entre `server/index.js` y `api/[...path].js` mediante `npm run check:backend-parity`.

## Plan Boundary

Este plan implementa el Lote 1 de SIIO, la frontera AGT-002 verificable y el adaptador temporal Hermes detrás de un selector apagado por defecto. No implementa aún la caja de aclaraciones ni adjuntos. Las pruebas del puente usan transporte inyectado; no realizan llamadas reales. La activación con datos sintéticos/anonimizados y luego productivos tendrá gates separados. AGT-002 sustituirá el motor sin cambiar snapshots, UI ni historia.

---

## File Structure

- `supabase/migrations/025_tender_analysis_foundation.sql`: snapshots, runs, RLS, funciones de persistencia y gate GO / NO GO.
- `tender-analysis-foundation.js`: normalización, hashing, registro y lectura del análisis vigente.
- `agt002-tender-adapter.js`: validación de request y envelope institucionales; no contiene SDK de proveedores ni respondedor sintético.
- `tender-analysis-engine.js`: selector de productor y contrato de dominio común.
- `hermes-tender-analysis-adapter.js`: cliente API Server stateless, productor `HERMES-INTERIM`, validación, timeout y circuit breaker; sin SDK LLM.
- `contracts/agents/AGT-002/v2-draft/*.schema.json`: contrato consumidor propuesto; no activa ni reemplaza v1.
- `server/index.js` y `api/[...path].js`: rutas documentales, tipos reservados y lectura del análisis tipado.
- `tender-go-no-go-rpc.js`: decisión ligada a `analysis_run_id`.
- `src/tenders/types.ts`: tipos de snapshot/run/resultado.
- `src/main.tsx`: resumen orientado a decisión y etiqueta de método.
- `src/tenders/components/TenderGoNoGoDecisionPanel.tsx`: gate visual por vigencia y preguntas críticas.
- `tests/tender-analysis-foundation-*.test.mjs`: contratos, migración, API, UI y seguridad.
- `tests/hermes-interim-tender-analysis.test.mjs`: transporte inyectado, aislamiento, productor, costo, timeout, feature flag y ausencia de llamadas reales.

---

### Task 1: Freeze AGT-002 v1 and define the SIIO consumer envelope

**Files:**
- Create: `contracts/agents/AGT-002/v2-draft/analysis-run.request.schema.json`
- Create: `contracts/agents/AGT-002/v2-draft/analysis-run.response.schema.json`
- Create: `agt002-tender-adapter.js`
- Create: `tests/agt002-tender-analysis-contract.test.mjs`

**Interfaces:**
- Consumes: completed SIIO snapshot `{snapshot_id, opportunity_id, tender_id, document_hash, profile_hash, documents, company_profile}`.
- Produces: `validateAgt002TenderAnalysisRequest(value)` and `validateAgt002TenderAnalysisEnvelope(value)`.
- Test-only fixture: `tests/fixtures/agt002-synthetic-responder.mjs` exports `buildSyntheticAgt002TenderAnalysis(snapshot)` exclusively for contract tests; production code never imports or fabrica envelopes `AGT-002`/`agent_ai`/`completed`.

- [ ] **Step 1: Write the failing contract test**

```js
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validateAgt002TenderAnalysisEnvelope, validateAgt002TenderAnalysisRequest } from '../agt002-tender-adapter.js';
import { buildSyntheticAgt002TenderAnalysis } from './fixtures/agt002-synthetic-responder.mjs';

const v1Files = ['manifest.json', 'analysis.request.schema.json', 'analysis.response.schema.json'];
const v1Hash = createHash('sha256').update(v1Files.map(name => readFileSync(new URL(`../contracts/agents/AGT-002/v1/${name}`, import.meta.url))).join('\n')).digest('hex');
assert.equal(v1Hash, 'b42efca7952e917da93c551400efaa71db7c8fa0c69a8c74b6fb4980782ca82e');

const snapshot = {
  snapshot_id: '11111111-1111-4111-8111-111111111111',
  opportunity_id: '22222222-2222-4222-8222-222222222222',
  tender_id: '33333333-3333-4333-8333-333333333333',
  document_hash: 'a'.repeat(64), profile_hash: 'b'.repeat(64),
  documents: [{ document_id:'doc-001', name:'Pliego', document_type:'pliego', content:'...', content_sha256:'c'.repeat(64), current:true }],
  company_profile: { profile_version:'rup-2026-07', fields:[{ key:'annual_revenue', label:'Ingresos anuales', value:'500000000', source:'RUP' }] },
};
assert.deepEqual(validateAgt002TenderAnalysisRequest(snapshot), snapshot);
const envelope = buildSyntheticAgt002TenderAnalysis(snapshot);
assert.equal(validateAgt002TenderAnalysisEnvelope(envelope).agent_id, 'AGT-002');
assert.equal(envelope.human_review_required, true);
assert.throws(() => validateAgt002TenderAnalysisEnvelope({ ...envelope, agent_id: 'AGT-999' }), /AGT-002/);
assert.throws(() => validateAgt002TenderAnalysisEnvelope({ ...envelope, human_review_required: false }), /revisión humana/i);
console.log('AGT-002 tender analysis consumer contract passed');
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node tests/agt002-tender-analysis-contract.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `agt002-tender-adapter.js`.

- [ ] **Step 3: Add strict request and response schemas**

The request schema must require exactly the top-level snapshot fields shown above. Its minimum closed taxonomy is:

```json
{
  "documents": [{
    "document_id": "non-empty string",
    "name": "non-empty string",
    "document_type": "non-empty string",
    "content": "string",
    "content_sha256": "64 lowercase hex",
    "current": "boolean"
  }],
  "company_profile": {
    "profile_version": "non-empty string",
    "fields": [{ "key": "string", "label": "string", "value": "string", "source": "string|null" }]
  }
}
```

Every request object is closed with `additionalProperties: false`. `validateAgt002TenderAnalysisRequest` must be exactly equivalent: reject extra keys, malformed UUID/hash fields, wrong nested types, or incomplete document/profile items.

The response schema must require exactly:

```json
{
  "schema_version": "2.0-draft",
  "agent_id": "AGT-002",
  "run_id": "uuid",
  "policy_version": "string",
  "snapshot_id": "uuid",
  "status": "completed",
  "method": "agent_ai",
  "recommendation": "advance|advance_conditionally|pause|do_not_advance",
  "summary": "string",
  "strengths": [],
  "weaknesses": [],
  "blockers": [],
  "questions": [],
  "unverified": [],
  "next_action": "string",
  "human_review_required": true,
  "usage": { "provider": "string", "model": "string", "input_tokens": 0, "output_tokens": 0, "cost_usd": 0 }
}
```

Every finding/question item must require `id`, `text`, `critical`, and `evidence_refs`; `additionalProperties` must be `false` at every object level.

- [ ] **Step 4: Implement the provider-neutral adapter and test-only fixture**

```js
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function validateAgt002TenderAnalysisEnvelope(value) {
  if (!value || value.agent_id !== 'AGT-002') throw new Error('El productor debe ser AGT-002.');
  if (!UUID.test(String(value.run_id || '')) || !UUID.test(String(value.snapshot_id || ''))) throw new Error('Run y snapshot deben ser UUID.');
  if (value.status !== 'completed' || value.method !== 'agent_ai') throw new Error('El envelope AGT-002 no está completado.');
  if (value.human_review_required !== true) throw new Error('La revisión humana es obligatoria.');
  for (const key of ['strengths', 'weaknesses', 'blockers', 'questions', 'unverified']) if (!Array.isArray(value[key])) throw new Error(`${key} debe ser arreglo.`);
  return value;
}
export function validateAgt002TenderAnalysisRequest(snapshot) {
  // Exact structural validation matching the closed request schema.
  // This adapter only validates institutional inputs/outputs; it never fabricates one.
}
```

Place `buildSyntheticAgt002TenderAnalysis(snapshot)` in `tests/fixtures/agt002-synthetic-responder.mjs`, import it only from tests, and label it clearly as test-only. The fixture can exercise the envelope validator, but production code must never create an `AGT-002` / `agent_ai` / `completed` response.

- [ ] **Step 5: Run and commit**

Run: `node tests/agt002-tender-analysis-contract.test.mjs`

Expected: `AGT-002 tender analysis consumer contract passed`

```bash
git add contracts/agents/AGT-002/v2-draft agt002-tender-adapter.js tests/fixtures/agt002-synthetic-responder.mjs tests/agt002-tender-analysis-contract.test.mjs
git commit -m "test(agents): define AGT-002 tender analysis boundary"
```

---

### Task 2: Add immutable document snapshots and authenticated analysis runs

**Files:**
- Create: `supabase/migrations/025_tender_analysis_foundation.sql`
- Create: `tests/tender-analysis-foundation-pglite.integration.test.mjs`
- Create: `tests/tender-analysis-foundation-migration.test.mjs`

**Interfaces:**
- Produces tables `psi_tender_document_snapshots`, `psi_tender_analysis_runs`.
- Produces RPCs `psi_record_tender_document_snapshot(...)` and `psi_record_tender_analysis_run(...)`.

- [ ] **Step 1: Write a failing migration contract test**

Assert the migration contains:

```js
for (const token of [
  'create table if not exists public.psi_tender_document_snapshots',
  'create table if not exists public.psi_tender_analysis_runs',
  'unique (opportunity_id, document_hash, profile_hash)',
  "check (producer in ('siio_rules_v1', 'HERMES-INTERIM', 'AGT-002'))",
  'psi_record_tender_document_snapshot', 'psi_record_tender_analysis_run',
  'revoke all on table public.psi_tender_analysis_runs from authenticated',
]) assert.match(migration, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
```

- [ ] **Step 2: Run and verify RED**

Run: `node tests/tender-analysis-foundation-migration.test.mjs`

Expected: FAIL because migration 025 does not exist.

- [ ] **Step 3: Write migration 025**

Create snapshots with UUID PK, opportunity/tender FKs, 64-character lowercase SHA-256 hashes, JSONB manifest/profile snapshot, actor and timestamp. Create runs with snapshot/opportunity/tender FKs, producer `siio_rules_v1|HERMES-INTERIM|AGT-002`, method `rules|agent_ai`, status `completed|failed`, result JSONB, `critical_open_count >= 0`, unique idempotency key, schema/policy/model/usage fields and timestamps. Enforce `rules` only for `siio_rules_v1` and `agent_ai` only for `HERMES-INTERIM`/`AGT-002`.

Both tables must revoke direct authenticated writes. Security-definer RPCs must:

```sql
if p_producer not in ('siio_rules_v1', 'HERMES-INTERIM', 'AGT-002') then
  raise exception 'Productor de análisis no autorizado.' using errcode = '22023';
end if;
if p_status = 'completed' and (p_result is null or jsonb_typeof(p_result) <> 'object') then
  raise exception 'Un análisis completado requiere resultado estructurado.' using errcode = '22023';
end if;
```

Snapshots are deduplicated with `insert ... on conflict (opportunity_id, document_hash, profile_hash) do nothing` followed by a scoped select; runs are idempotent with `on conflict (idempotency_key) do nothing` followed by a scoped select. No conflict path mutates an immutable row.

- [ ] **Step 4: Add PGlite tests**

Cover: re-execution, dedupe, wrong opportunity/tender, bad hash, unauthorized producer, malformed result, duplicate idempotency key, service-role direct insert denied, authenticated direct insert denied, and no mutation through UPDATE/DELETE.

- [ ] **Step 5: Run and commit**

Run:

```bash
node tests/tender-analysis-foundation-migration.test.mjs
node tests/tender-analysis-foundation-pglite.integration.test.mjs
```

Expected: both print `passed`.

```bash
git add supabase/migrations/025_tender_analysis_foundation.sql tests/tender-analysis-foundation-*.test.mjs
git commit -m "feat(tenders): add typed analysis snapshots and runs"
```

---

### Task 3: Register the current rules engine without presenting it as AI

**Files:**
- Create: `tender-analysis-foundation.js`
- Modify: `server/index.js`
- Modify: `api/[...path].js`
- Create: `tests/tender-analysis-rules-registration.test.mjs`

**Interfaces:**
- Produces `buildTenderSnapshotInput(records, companyProfile)`, `registerSiioRulesAnalysis(database, context)`, `getCurrentTenderAnalysis(database, opportunityId)`.
- Returns `{run_id, snapshot_id, producer:'siio_rules_v1', method:'rules', status, current, result}`.

- [ ] **Step 1: Write failing tests for deterministic identity**

```js
const left = buildTenderSnapshotInput([{ id:'b', name:'B' }, { id:'a', name:'A' }], { version: 1 });
const right = buildTenderSnapshotInput([{ id:'a', name:'A' }, { id:'b', name:'B' }], { version: 1 });
assert.equal(left.document_hash, right.document_hash);
assert.equal(left.profile_hash, right.profile_hash);
assert.equal(left.documents[0].id, 'a');
```

Also statically assert both backend entrypoints call `registerSiioRulesAnalysis` after `buildTenderDocumentAnalysis`, and no UI string calls it IA.

- [ ] **Step 2: Run and verify RED**

Run: `node tests/tender-analysis-rules-registration.test.mjs`

Expected: FAIL with missing module/function.

- [ ] **Step 3: Implement canonical JSON hashing and RPC registration**

```js
import { createHash } from 'node:crypto';
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const sha256 = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
export function buildTenderSnapshotInput(documents, companyProfile) {
  const normalized = [...documents].sort((a,b) => String(a.id).localeCompare(String(b.id))).map(({ extracted_text, signed_url, ...document }) => document);
  return { documents: normalized, document_hash: sha256(normalized), company_profile: stable(companyProfile || {}), profile_hash: sha256(companyProfile || {}) };
}
```

`registerSiioRulesAnalysis` calls the two RPCs and writes `producer='siio_rules_v1'`, `method='rules'`, `policy_version='siio-rules-v1'`, zero usage/cost, and an idempotency key derived from opportunity + snapshot + policy.

- [ ] **Step 4: Replace both direct legacy analysis inserts**

Keep the readable timeline interaction for compatibility, but include only the returned `analysis_run_id` and label `Preanálisis por reglas SIIO`. The typed run is authoritative.

- [ ] **Step 5: Run focused tests and parity**

```bash
node tests/tender-analysis-rules-registration.test.mjs
node tests/tender-auto-analysis-contract.test.mjs
npm run check:backend-parity
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add tender-analysis-foundation.js server/index.js 'api/[...path].js' tests/tender-analysis-rules-registration.test.mjs
git commit -m "feat(tenders): register rules analysis as authenticated runs"
```

---

### Task 4: Reserve internal tender events

**Files:**
- Modify: `server/index.js`
- Modify: `api/[...path].js`
- Create: `tests/tender-internal-interaction-kinds.test.mjs`

**Interfaces:**
- Produces `assertPublicInteractionPayload(notes)` used by `POST /api/opportunities/:id/interactions`.

- [ ] **Step 1: Write failing route tests**

Test rejection with HTTP 403/400 for `tender_document_upload`, `tender_document_analysis`, `tender_document_import_error`, `tender_document_clarification`, and `tender_offer_preparation`; permit ordinary `seguimiento` notes and malformed user text that is not parsed as an internal object.

- [ ] **Step 2: Run and verify RED**

Run: `node tests/tender-internal-interaction-kinds.test.mjs`

Expected: FAIL because the generic route accepts reserved kinds.

- [ ] **Step 3: Implement one exact guard in both entrypoints**

```js
const RESERVED_TENDER_INTERACTION_KINDS = new Set([
  'tender_document_upload', 'tender_document_analysis', 'tender_document_import_error',
  'tender_document_clarification', 'tender_offer_preparation',
]);
function assertPublicInteractionPayload(notes) {
  const payload = typeof notes === 'string' ? parseInteractionJson(notes) : notes;
  if (payload?.kind && RESERVED_TENDER_INTERACTION_KINDS.has(payload.kind)) {
    const error = new Error('Este tipo de evento solo puede crearse por la ruta interna autorizada.');
    error.status = 403; throw error;
  }
}
```

Invoke before every generic interaction insert.

- [ ] **Step 4: Run, parity-check and commit**

```bash
node tests/tender-internal-interaction-kinds.test.mjs
npm run check:backend-parity
git add server/index.js 'api/[...path].js' tests/tender-internal-interaction-kinds.test.mjs
git commit -m "fix(tenders): reserve internal documentary events"
```

---

### Task 5: Bind human GO / NO GO to the current typed analysis

**Files:**
- Modify: `supabase/migrations/025_tender_analysis_foundation.sql`
- Modify: `tender-go-no-go-rpc.js`
- Modify: `src/tenders/types.ts`
- Modify: `src/tenders/components/TenderGoNoGoDecisionPanel.tsx`
- Create: `tests/tender-analysis-go-gate-pglite.integration.test.mjs`
- Modify: `tests/tender-go-no-go-api.test.mjs`
- Modify: `tests/tender-go-no-go-ui.test.mjs`

**Interfaces:**
- GO/NO GO input changes from `analysis_interaction_id` to required `analysis_run_id`.
- Decision history preserves legacy `analysis_interaction_id` and adds nullable `analysis_run_id`.

- [ ] **Step 1: Write failing PGlite gates**

Cover: null run, fabricated UUID, run from another opportunity, failed run, historical snapshot, AGT-002 run with critical questions, current SIIO rules run, current authenticated `HERMES-INTERIM` run, current AGT-002 run without critical questions, and mandatory justification for both decisions.

- [ ] **Step 2: Run and verify RED**

Run: `node tests/tender-analysis-go-gate-pglite.integration.test.mjs`

Expected: FAIL because `analysis_run_id` and current-snapshot checks do not exist.

- [ ] **Step 3: Extend the decision table and RPC**

Add `analysis_run_id uuid references psi_tender_analysis_runs(id) on delete restrict`. In `psi_record_tender_go_no_go`, lock and validate the run:

```sql
select r.* into v_analysis
from public.psi_tender_analysis_runs r
where r.id=p_analysis_run_id and r.opportunity_id=p_opportunity_id and r.tender_id=p_tender_id
for share;
if not found or v_analysis.status <> 'completed' then raise exception 'Requiere análisis vigente.'; end if;
select s.id into v_latest_snapshot from public.psi_tender_document_snapshots s
where s.opportunity_id=p_opportunity_id order by s.created_at desc, s.id desc limit 1;
if v_analysis.snapshot_id is distinct from v_latest_snapshot then raise exception 'El análisis está obsoleto.'; end if;
if p_decision='go' and v_analysis.critical_open_count > 0 then raise exception 'GO está bloqueado por preguntas críticas abiertas.'; end if;
if nullif(btrim(p_justification),'') is null then raise exception 'La justificación es obligatoria.'; end if;
```

Keep a compatibility wrapper only for reading old decisions; all new writes use the new signature.

- [ ] **Step 4: Update service and UI types**

`TenderDocumentAnalysis` must require `run_id`, `snapshot_id`, `producer`, `method`, `status`, `current`, and `critical_open_count`. Submit `analysis_run_id: analysis.run_id`; disable both decision buttons if the run is absent, failed or stale, and disable GO when critical count is positive.

- [ ] **Step 5: Run focused tests**

```bash
node tests/tender-analysis-go-gate-pglite.integration.test.mjs
node tests/tender-go-no-go-api.test.mjs
node tests/tender-go-no-go-ui.test.mjs
node tests/tender-go-no-go-pglite.integration.test.mjs
```

Expected: all pass, including legacy-row reads.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/025_tender_analysis_foundation.sql tender-go-no-go-rpc.js src/tenders/types.ts src/tenders/components/TenderGoNoGoDecisionPanel.tsx tests/tender-analysis-go-gate-pglite.integration.test.mjs tests/tender-go-no-go-*.test.mjs
git commit -m "fix(tenders): require current authenticated analysis for decisions"
```

---

### Task 6: Replace “dictamen” with an evidence-oriented decision brief

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Create: `tests/tender-decision-brief-ui.test.mjs`
- Modify: `tests/tender-go-no-go-report-static.test.mjs`

**Interfaces:**
- Consumes `TenderDocumentAnalysis` from Task 5.
- Produces visible sections: recommendation, vigencia/method, strengths, weaknesses/blockers, open questions, unverified, next action, and collapsed `Cómo funciona`.

- [ ] **Step 1: Write failing static UI tests**

Assert presence of:

```js
for (const text of ['Recomendación preliminar', 'Preanálisis por reglas SIIO', 'Fortalezas', 'Debilidades y bloqueadores', 'Dudas abiertas', 'Información no verificada', 'Siguiente acción', 'Cómo funciona']) assert.match(main, new RegExp(text));
assert.doesNotMatch(main, /Dictamen GO \/ NO GO SN/);
assert.doesNotMatch(main, /const favorable = .*\/GO\//);
```

Also assert exact unfavorable states are checked before any positive GO state.

- [ ] **Step 2: Run and verify RED**

Run: `node tests/tender-decision-brief-ui.test.mjs`

Expected: FAIL on missing decision-oriented labels and legacy “Dictamen”.

- [ ] **Step 3: Implement the decision brief**

Use semantic sections and a `<details><summary>Cómo funciona</summary>…</details>`. Map legacy rules output conservatively:

```ts
const strengths = analysis.strengths ?? analysis.commercial_fit?.positives ?? [];
const weaknesses = analysis.weaknesses ?? analysis.blockers ?? analysis.commercial_fit?.concerns ?? [];
const questions = analysis.questions ?? [];
const unverified = analysis.unverified ?? analysis.company_profile_crosscheck?.gaps ?? [];
const methodLabel = analysis.producer === 'AGT-002' ? 'Análisis AGT-002' : analysis.producer === 'HERMES-INTERIM' ? 'Análisis asistido por Hermes — transitorio' : 'Preanálisis por reglas SIIO';
```

Do not add the clarification textbox in this task; it remains behind the approved intelligent-engine activation gate.

- [ ] **Step 4: Fix exact status tones**

```ts
const unfavorable = new Set(['no_go', 'cerrada_no_go', 'no_adjudicada']);
const tone = unfavorable.has(normalizedStatus) ? 'red' : normalizedStatus === 'go' || normalizedStatus === 'adjudicada' ? 'green' : 'amber';
```

- [ ] **Step 5: Run and commit**

```bash
node tests/tender-decision-brief-ui.test.mjs
node tests/tender-go-no-go-report-static.test.mjs
npm run build
git add src/main.tsx src/styles.css tests/tender-decision-brief-ui.test.mjs tests/tender-go-no-go-report-static.test.mjs
git commit -m "feat(tenders): present documentary decision brief"
```

---

### Task 7: Add the audited Hermes interim engine behind a hard-off gate

**Files:**
- Create: `tender-analysis-domain.js`
- Create: `tender-analysis-engine.js`
- Create: `hermes-tender-analysis-adapter.js`
- Modify: `agt002-tender-adapter.js`
- Create: `tests/hermes-interim-tender-analysis.test.mjs`
- Create: `docs/runbooks/hermes-interim-tender-analysis.md`

**Interfaces:**
- Produces `validateTenderAnalysisResult(value)`, accepting only an internally consistent producer/method pair: `siio_rules_v1/rules`, `HERMES-INTERIM/agent_ai`, or `AGT-002/agent_ai`.
- Produces `createTenderAnalysisEngine({ mode, rulesEngine, hermesEngine, agt002Engine })`; allowed modes are `rules`, `hermes_interim`, `agt002` and unknown/missing intelligent dependencies fail closed.
- Produces `createHermesTenderAnalysisEngine({ transport, baseUrl, apiKey, provider, model, policyVersion, timeoutMs, budget })`.
- Production transport uses Hermes API Server `POST /v1/chat/completions`; test transport is injected and performs no network call.

- [ ] **Step 1: Write failing domain and transport tests**

Cover all of the following:

```js
assert.throws(() => createTenderAnalysisEngine({ mode:'hermes_interim' }).analyze(snapshot), /no configurado/i);
assert.equal(validateTenderAnalysisResult(hermesResult).producer, 'HERMES-INTERIM');
assert.throws(() => validateTenderAnalysisResult({ ...hermesResult, producer:'AGT-002' }), /identidad|productor/i);
assert.throws(() => validateTenderAnalysisResult({ ...hermesResult, human_review_required:false }), /revisión humana/i);
```

The injected transport test must prove:

- URL is loopback or an explicitly configured private/allowlisted HTTPS endpoint;
- bearer key is sent only in the header and never embedded in prompt, logs, result or errors;
- endpoint is `/v1/chat/completions` with `stream:false` and no conversation/session persistence;
- system policy marks documents as untrusted data and forbids GO / NO GO, writes, sends and claims without evidence;
- user message contains the canonical snapshot JSON;
- timeout aborts the request;
- malformed/fenced/non-object output is rejected safely;
- `usage` records configured provider/model, input/output tokens, pricing version and computed estimated cost;
- daily/per-run budget is checked before the transport call;
- raw provider errors are sanitized;
- no production module imports the test fixture.

- [ ] **Step 2: Run and verify RED**

Run: `node tests/hermes-interim-tender-analysis.test.mjs`

Expected: FAIL with missing `tender-analysis-domain.js` or `hermes-tender-analysis-adapter.js`.

- [ ] **Step 3: Implement the common domain validator and selector**

```js
const PRODUCER_METHOD = new Map([
  ['siio_rules_v1', 'rules'],
  ['HERMES-INTERIM', 'agent_ai'],
  ['AGT-002', 'agent_ai'],
]);
export function validateTenderAnalysisResult(value) {
  if (!value || PRODUCER_METHOD.get(value.producer) !== value.method) throw new Error('Productor o método de análisis inválido.');
  if (value.human_review_required !== true) throw new Error('La revisión humana es obligatoria.');
  if (!UUID.test(value.run_id) || !UUID.test(value.snapshot_id)) throw new Error('Identidad de análisis inválida.');
  for (const key of ['strengths','weaknesses','blockers','questions','unverified']) if (!Array.isArray(value[key])) throw new Error(`${key} debe ser arreglo.`);
  return value;
}
```

`agt002-tender-adapter.js` maps an institutional AGT-002 envelope to this domain without changing its producer. No adapter may relabel Hermes output as AGT-002.

- [ ] **Step 4: Implement the Hermes API Server adapter with injected transport**

The production request shape is:

```js
{
  model: 'psi-licitaciones-interim',
  stream: false,
  messages: [
    { role:'system', content: HERMES_TENDER_POLICY },
    { role:'user', content: JSON.stringify(snapshot) },
  ],
}
```

Requirements:

- use `Authorization: Bearer <server-secret>` and `Content-Type: application/json`;
- never pass documents in CLI arguments;
- parse only one strict JSON object from `choices[0].message.content`;
- overwrite/reject producer metadata so accepted output is exactly `HERMES-INTERIM` and cannot claim `AGT-002`;
- validate through `validateTenderAnalysisResult` before returning;
- implement AbortController timeout and one bounded retry only for a retry-safe transport failure under the same idempotency key;
- never retry schema/policy/budget failures;
- return safe errors without response bodies or credentials.

- [ ] **Step 5: Add a deployment-readiness guard and runbook**

The engine remains unavailable unless all variables exist and the selector explicitly says `hermes_interim`:

```text
TENDER_ANALYSIS_ENGINE=hermes_interim
HERMES_INTERIM_BASE_URL=http://127.0.0.1:<dedicated-port>
HERMES_INTERIM_API_KEY=[secret]
HERMES_INTERIM_PROVIDER=[approved]
HERMES_INTERIM_MODEL=[approved]
HERMES_INTERIM_POLICY_VERSION=[approved]
HERMES_INTERIM_MAX_COST_USD=[approved]
```

The runbook must require a dedicated Hermes profile `psi-licitaciones-interim`, API Server bearer authentication, loopback/private binding, no browser CORS, stateless calls, fresh analysis context, and all operational toolsets disabled. It must document verification via authenticated `/v1/toolsets`, `/v1/capabilities`, and `/health/detailed`. Do not create the profile, store a secret, restart the gateway or activate the variables in this task.

- [ ] **Step 6: Run and commit**

```bash
node tests/hermes-interim-tender-analysis.test.mjs
node tests/agt002-tender-analysis-contract.test.mjs
npm run build
git diff --check
git add tender-analysis-domain.js tender-analysis-engine.js hermes-tender-analysis-adapter.js agt002-tender-adapter.js tests/hermes-interim-tender-analysis.test.mjs docs/runbooks/hermes-interim-tender-analysis.md
git commit -m "feat(tenders): add gated Hermes interim analysis engine"
```

Expected: tests/build PASS; no network call, profile mutation, secret write, gateway restart or real analysis.

---

### Task 8: Full verification and non-production closeout

**Files:**
- Modify: `docs/superpowers/plans/2026-07-24-siio-tender-decision-foundation.md` (checkboxes only)
- Create: `docs/evidence/2026-07-24-siio-tender-decision-foundation-verification.md`

**Interfaces:**
- Produces a reproducible PASS/FAIL record; does not deploy or mutate production.

- [ ] **Step 1: Verify v1 immutability**

Run the literal SHA-256 test from Task 1 and:

```bash
git diff c531bdb -- contracts/agents/AGT-002/v1
```

Expected: no output.

- [ ] **Step 2: Run focused suites**

```bash
node tests/agt002-tender-analysis-contract.test.mjs
node tests/hermes-interim-tender-analysis.test.mjs
node tests/tender-analysis-foundation-migration.test.mjs
node tests/tender-analysis-foundation-pglite.integration.test.mjs
node tests/tender-analysis-rules-registration.test.mjs
node tests/tender-internal-interaction-kinds.test.mjs
node tests/tender-analysis-go-gate-pglite.integration.test.mjs
node tests/tender-decision-brief-ui.test.mjs
node tests/tender-go-no-go-api.test.mjs
node tests/tender-go-no-go-ui.test.mjs
node tests/tender-go-no-go-pglite.integration.test.mjs
```

Expected: every command exits 0 and prints `passed`.

- [ ] **Step 3: Run global gates**

```bash
npm run check:backend-parity
npm run build
for test in tests/*.test.mjs; do node "$test" || exit 1; done
git diff --check
git status --short
```

Expected: parity PASS, build PASS, all test scripts PASS, no whitespace errors, only the verification evidence file modified before final commit.

- [ ] **Step 4: Record evidence**

The evidence document must list commit range, commands, exact exit status, migrations not applied remotely, Hermes transport and AGT-002 runtime not called, production not deployed, and residual gates: Hermes provider/model/data-region/budget/profile activation plus institutional AGT-002 v2 approval and technical identity.

- [ ] **Step 5: Request code review and commit closeout**

Run the requesting-code-review workflow, fix only findings within this plan, rerun affected tests, then:

```bash
git add docs/evidence/2026-07-24-siio-tender-decision-foundation-verification.md docs/superpowers/plans/2026-07-24-siio-tender-decision-foundation.md
git commit -m "docs: verify SIIO tender decision foundation"
```

Do not push, merge, migrate or deploy without Juan's explicit production authorization.
