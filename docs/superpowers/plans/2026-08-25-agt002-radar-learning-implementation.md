# AGT-002 Radar Gate, Preanálisis y Aprendizaje Gobernado Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el Radar muestre sólo licitaciones convertidas históricas y licitaciones no convertidas con preanálisis canónico AGT-002 `mostrar_en_radar`, producido por una **cadena real, ejecutable y apagada por defecto** que va de la ingesta al ledger pasando por un gate determinístico fail-closed y una cola durable, sin que AGT-002 convierta, decida GO/NO-GO ni cambie nada visual.

**Architecture:** La ingesta cruda no se toca. Un gate puro y determinístico evalúa cada fila de `psi_public_tenders` y asienta veredictos con evidencia en un ledger append-only (`071`). Los sobrevivientes se **encolan en una cola durable con reserva** y reciben preanálisis AGT-002 por el puente Hetzner existente, persistido en un ledger append-only por licitación con promoción canónica e idempotencia; cola y ledgers viven en la misma migración (`072`). Un **entrypoint real, apagado por defecto** (`agt002-radar-pipeline.js` + `ops/agt002-radar-pipeline/`) encadena `fetch → gate → ledger → claim durable → aprendizaje → AGT-002 → persistencia` en una sola invocación, con a lo sumo un job y una llamada al proveedor por corrida. Dos flags fail-closed apagados por defecto separan producir de mostrar, para permitir backfill antes de filtrar. El aprendizaje es retrieval de sólo lectura sobre conversión manual, análisis canónico, GO/NO-GO y estados de oferta, que entra a la cadena como contexto versionado del preanálisis y produce propuestas DRAFT para curaduría humana, sin mutar reglas.

**Tech Stack:** Node.js ESM, `node:crypto`, `node:test`/`assert`, PGlite (`@electric-sql/pglite`), Supabase/PostgreSQL con RPC `security definer`, puente Hetzner AGT-002 existente.

**Spec:** `docs/superpowers/specs/2026-08-25-agt002-radar-learning-design.md`

**Preflight de ejecución (2026-08-25):** `origin/main` avanzó de la base diseñada `b2ebb80` a `24ee76c` por el commit AGT-003 `feat(agt003): refine commercial follow-up experience (#130)`. Se inspeccionaron todos sus hunks: los cambios de `server/index.js` y `api/[...path].js` son exclusivamente de contexto AGT-003 (`agt003PreparationDate`); no modifican Radar, `readPersistedTenderRadar`, `persistTenderRadar`, AGT-002 ni sus contratos. La rama se rebasó limpiamente a `24ee76c` antes del primer commit documental.

## Global Constraints

- **Autoridad:** AGT-002 nunca crea `psi_sales_opportunities`, nunca invoca `psi_convert_tender_to_opportunity` ni `/api/tender-convert`, nunca escribe `converted_opportunity_id` ni `internal_status`, nunca emite GO/NO-GO.
- **Sin cambios visuales:** ningún archivo bajo `src/` se crea ni se modifica en ninguna tarea.
- **Ingesta cruda intacta:** `persistTenderRadar` no se modifica.
- **Paridad de backend:** `server/index.js` y `api/[...path].js` deben quedar byte-idénticos tras cada tarea que toque el backend.
- **Flags apagados:** `AGT002_RADAR_GATE` y `AGT002_RADAR_VISIBILITY` quedan OFF por defecto y no se encienden en ningún entorno dentro de este plan.
- **Entrypoint real pero apagado:** la cadena se entrega ejecutable y con sus unidades `systemd` escritas, pero **ninguna tarea ejecuta `systemctl`**, ninguna instala o habilita el `.service`/`.timer`, y ninguna ejecuta el entrypoint con `AGT002_RADAR_GATE` encendido. Lo único que se ejecuta del entrypoint dentro del plan es la ruta apagada (`status: 'disabled'`), en pruebas.
- **Numeración de migraciones congelada:** este alcance usa exactamente `071` y `072`. La cola durable va **dentro de `072`**, no en una migración nueva.
- **Gates cerrados:** sin push, sin PR, sin merge, sin migración aplicada a producción, sin deploy, sin cambio de flags productivos. Los commits son locales.
- **Producción ≠ `origin/main`:** ninguna tarea asume que el commit desplegado sea `origin/main`.
- **TDD estricto:** cada tarea escribe la prueba primero, la ejecuta en RED, implementa lo mínimo y la ejecuta en GREEN.

---

### Task 0: Línea base verificada

**Files:**
- Modify: ninguno.

**Interfaces:**
- Establece los conteos reales de partida contra los que se compararán las suites posteriores.

- [ ] **Step 1: Instalar dependencias exactas**

Run: `npm ci --ignore-scripts`
Expected: exit 0.

- [ ] **Step 2: Suite completa de partida**

Run: `node --test --test-force-exit tests/*.test.mjs`
Expected: registrar el total, PASS, FAIL y SKIP reales. Si hay algún FAIL preexistente, anotarlo textualmente y no repararlo en este plan.

- [ ] **Step 3: Gates técnicos de partida**

Run: `npm run check:backend-parity && npx tsc --noEmit && npm run build && git diff --check`
Expected: exit 0 en los cuatro.

- [ ] **Step 4: Confirmar numeración libre de migraciones**

Run: `find supabase/migrations -maxdepth 1 -type f -printf '%f\n' | sort | tail -3 && find supabase/rollbacks -maxdepth 1 -type f -printf '%f\n' | sort | tail -3`
Expected: la última migración es `070_agt002_workbench_job_status.sql`; `071` y `072` están libres.

---

### Task 1: Términos de relevancia compartidos, sin cambio de comportamiento

**Files:**
- Create: `tender-relevance-terms.js`
- Modify: `server/index.js`
- Modify: `api/[...path].js`
- Test: `tests/agt002-radar-relevance-terms.test.mjs`

**Interfaces:**
- Produce `TENDER_NON_SECURITY_CONTEXT_TERMS`, `TENDER_NON_COMMERCIAL_ACT_TERMS`, `TENDER_DISQUALIFYING_TERMS`.
- `server/index.js::isTenderTrackable` los consume sin alterar su comportamiento observable.

- [ ] **Step 1: Write the failing test**

```js
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { TENDER_DISQUALIFYING_TERMS, TENDER_NON_COMMERCIAL_ACT_TERMS, TENDER_NON_SECURITY_CONTEXT_TERMS } from '../tender-relevance-terms.js';
import { isTenderTrackable } from '../server/index.js';

assert.ok(TENDER_NON_SECURITY_CONTEXT_TERMS.includes('vigilancia epidemiologica'));
assert.ok(TENDER_NON_COMMERCIAL_ACT_TERMS.includes('aunar esfuerzos'));
assert.ok(TENDER_DISQUALIFYING_TERMS.includes('interventoria'));
assert.equal(Object.isFrozen(TENDER_DISQUALIFYING_TERMS), true);

// El backend deja de declarar las listas literalmente y las importa.
const backend = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
assert.match(backend, /from '\.\.\/tender-relevance-terms\.js'/);
assert.doesNotMatch(backend, /const tenderDisqualifyingTerms = \[/);

// Comportamiento observable idéntico.
assert.equal(isTenderTrackable({ title: 'Servicio de vigilancia armada', status: 'abierto' }), true);
assert.equal(isTenderTrackable({ title: 'Interventoria tecnica', status: 'abierto' }), false);
assert.equal(isTenderTrackable({ title: 'Vigilancia epidemiologica en salud publica', status: 'abierto' }), false);
assert.equal(isTenderTrackable({ title: 'Aunar esfuerzos institucionales', status: 'abierto' }), false);
assert.equal(isTenderTrackable({ title: 'Servicio de vigilancia armada', status: 'cancelado' }), false);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agt002-radar-relevance-terms.test.mjs`
Expected: FAIL porque `tender-relevance-terms.js` no existe.

- [ ] **Step 3: Write minimal implementation**

Crear `tender-relevance-terms.js` moviendo las tres listas **verbatim** desde `server/index.js`, congeladas:

```js
export const TENDER_NON_SECURITY_CONTEXT_TERMS = Object.freeze([/* copia exacta */]);
export const TENDER_NON_COMMERCIAL_ACT_TERMS = Object.freeze([/* copia exacta */]);
export const TENDER_DISQUALIFYING_TERMS = Object.freeze([/* copia exacta */]);
```

En `server/index.js`, sustituir las tres declaraciones `const` por el import y ajustar los tres usos (`isTenderTrackable` y el bucle de `risks` en `scoreTender`). Copiar el archivo resultante a `api/[...path].js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agt002-radar-relevance-terms.test.mjs && node --test tests/tender-radar-relevance.test.mjs tests/tender-radar-converted-visible.test.mjs tests/tender-radar-backend-dedup.test.mjs && npm run check:backend-parity`
Expected: PASS en todas y `backend parity OK`.

- [ ] **Step 5: Commit**

```bash
git add tender-relevance-terms.js server/index.js "api/[...path].js" tests/agt002-radar-relevance-terms.test.mjs
git commit -m "refactor(radar): extract shared tender relevance terms without behavior change"
```

---

### Task 2: Gate determinístico fail-closed

**Files:**
- Create: `agt002-radar-gate.js`
- Test: `tests/agt002-radar-gate.test.mjs`

**Interfaces:**
- Produce `AGT002_RADAR_GATE_POLICY_VERSION`, `AGT002_RADAR_GATE_CONTEXT_VERSION`, `AGT002_RADAR_GATE_RULE_IDS`, `evaluateAgt002RadarGate(tenderRow, { nowIso, contextVersion })`, `computeAgt002RadarSourceRowHash(tenderRow)`, `computeAgt002RadarGateIdempotencyKey(evaluation)`.
- Consume `tender-source-status.js` y `tender-relevance-terms.js`; no declara lógica de estado terminal propia.

- [ ] **Step 1: Write the failing test**

```js
import { strict as assert } from 'node:assert';
import {
  AGT002_RADAR_GATE_POLICY_VERSION, AGT002_RADAR_GATE_RULE_IDS,
  computeAgt002RadarGateIdempotencyKey, computeAgt002RadarSourceRowHash, evaluateAgt002RadarGate,
} from '../agt002-radar-gate.js';

const NOW = '2026-08-25T15:00:00.000Z';
const base = {
  id: '11111111-1111-4111-8111-111111111111', stable_key: 'k-1', source: 'SECOP II',
  entity: 'Entidad', title: 'Servicio de vigilancia armada con medios tecnologicos',
  status: 'abierto', deadline_at: '2026-12-31T23:59:59.000Z',
  raw: { modalidad_de_contratacion: 'Licitación pública' },
};
const ev = (over, nowIso = NOW) => evaluateAgt002RadarGate({ ...base, ...over }, { nowIso });

// Sobreviviente limpio.
assert.equal(ev({}).verdict, 'sobreviviente');
assert.deepEqual(ev({}).rule_ids, []);

// Las cinco reglas eliminan.
assert.deepEqual(ev({ status: 'Cancelado' }).rule_ids, ['estado_terminal']);
assert.deepEqual(ev({ deadline_at: '2026-08-24T23:59:59.000Z' }).rule_ids, ['fecha_vencida']);
assert.deepEqual(ev({ deadline_at: null }).rule_ids, ['fecha_no_verificable']);
assert.deepEqual(ev({ deadline_at: 'sin fecha' }).rule_ids, ['fecha_no_verificable']);
assert.deepEqual(ev({ raw: { modalidad_de_contratacion: 'Contratación Directa' } }).rule_ids, ['contratacion_directa']);
assert.deepEqual(ev({ title: 'Vigilancia epidemiologica' }).rule_ids, ['contexto_no_seguridad']);

// Orden estable por AGT002_RADAR_GATE_RULE_IDS, no por descubrimiento.
const multi = ev({ title: 'Interventoria tecnica', status: 'Cancelado', deadline_at: null });
assert.deepEqual(multi.rule_ids, ['estado_terminal', 'fecha_no_verificable', 'contexto_no_seguridad']);
assert.equal(multi.verdict, 'eliminada');

// Toda razón lleva evidencia y versión.
for (const reason of multi.reasons) {
  assert.deepEqual(Object.keys(reason).sort(), ['context_version', 'field', 'observed_value', 'policy_version', 'rule_id', 'source'].sort());
  assert.equal(reason.policy_version, AGT002_RADAR_GATE_POLICY_VERSION);
  assert.ok(String(reason.observed_value).length > 0);
  assert.ok(AGT002_RADAR_GATE_RULE_IDS.includes(reason.rule_id));
}

// Modalidad ausente: NO elimina, se reporta como brecha tipada.
const sinModalidad = ev({ raw: {} });
assert.equal(sinModalidad.verdict, 'sobreviviente');
assert.deepEqual(sinModalidad.data_gaps.map(gap => gap.gap_id), ['modalidad_no_reportada']);

// Determinismo byte a byte y sin reloj propio.
assert.equal(JSON.stringify(ev({})), JSON.stringify(ev({})));
assert.equal(computeAgt002RadarSourceRowHash(base), computeAgt002RadarSourceRowHash({ ...base }));
assert.notEqual(computeAgt002RadarSourceRowHash(base), computeAgt002RadarSourceRowHash({ ...base, status: 'otro' }));
assert.match(computeAgt002RadarGateIdempotencyKey(ev({})), /^[0-9a-f]{64}$/);
assert.notEqual(computeAgt002RadarGateIdempotencyKey(ev({})), computeAgt002RadarGateIdempotencyKey(ev({ status: 'otro' })));

// Fail-closed de entrada.
assert.throws(() => evaluateAgt002RadarGate(null, { nowIso: NOW }), /AGT002_RADAR_GATE_INPUT_INVALID/);
assert.throws(() => evaluateAgt002RadarGate(base, { nowIso: 'no-es-fecha' }), /AGT002_RADAR_GATE_INPUT_INVALID/);
assert.throws(() => evaluateAgt002RadarGate({ ...base, id: 'x' }, { nowIso: NOW }), /AGT002_RADAR_GATE_INPUT_INVALID/);

// El gate no habla de conversión ni de GO/NO-GO.
assert.equal(JSON.stringify(ev({})).includes('go_no_go'), false);
assert.equal(JSON.stringify(ev({})).includes('opportunity'), false);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agt002-radar-gate.test.mjs`
Expected: FAIL porque `agt002-radar-gate.js` no existe.

- [ ] **Step 3: Write minimal implementation**

```js
import { createHash } from 'node:crypto';
import { isTenderTerminalStatus, normalizeTenderStatusText, tenderStatusSearchText } from './tender-source-status.js';
import { TENDER_DISQUALIFYING_TERMS, TENDER_NON_COMMERCIAL_ACT_TERMS, TENDER_NON_SECURITY_CONTEXT_TERMS } from './tender-relevance-terms.js';

export const AGT002_RADAR_GATE_POLICY_VERSION = 'agt002-radar-gate-policy-v1';
export const AGT002_RADAR_GATE_CONTEXT_VERSION = 'agt002-radar-context-v1';
export const AGT002_RADAR_GATE_RULE_IDS = Object.freeze([
  'estado_terminal', 'fecha_vencida', 'fecha_no_verificable', 'contratacion_directa', 'contexto_no_seguridad',
]);

export function evaluateAgt002RadarGate(tenderRow, { nowIso, contextVersion = AGT002_RADAR_GATE_CONTEXT_VERSION } = {}) {
  const row = requireTenderRow(tenderRow);
  const today = bogotaCalendarDay(requireIsoInstant(nowIso));
  const reasons = AGT002_RADAR_GATE_RULE_IDS.flatMap(ruleId => RULES[ruleId](row, today, contextVersion));
  return Object.freeze({
    tender_id: row.id, stable_key: row.stable_key,
    verdict: reasons.length ? 'eliminada' : 'sobreviviente',
    rule_ids: reasons.map(reason => reason.rule_id),
    reasons, data_gaps: detectDataGaps(row),
    policy_version: AGT002_RADAR_GATE_POLICY_VERSION, context_version: contextVersion,
    source_row_hash: computeAgt002RadarSourceRowHash(row), evaluated_at: nowIso,
  });
}
```

Las fechas se resuelven con `Intl.DateTimeFormat('en', { timeZone: 'America/Bogota', ... })` sobre `nowIso` y con un parseo calendario estricto de `deadline_at`; una fecha no parseable produce `fecha_no_verificable`, nunca una excepción silenciada. Las entradas inválidas lanzan `Error` con `runtime_boundary_code = 'AGT002_RADAR_GATE_INPUT_INVALID'` y ese código en el mensaje.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agt002-radar-gate.test.mjs`
Expected: PASS, incluidos determinismo, orden estable, evidencia obligatoria y brecha de modalidad.

- [ ] **Step 5: Commit**

```bash
git add agt002-radar-gate.js tests/agt002-radar-gate.test.mjs
git commit -m "feat(radar): add deterministic fail-closed AGT-002 radar gate"
```

---

### Task 3: Migración 071 — ledger de evaluaciones del gate

**Files:**
- Create: `supabase/migrations/071_agt002_radar_gate.sql`
- Create: `supabase/rollbacks/071_agt002_radar_gate_rollback.sql`
- Test: `tests/agt002-radar-gate-migration-pglite.integration.test.mjs`

**Interfaces:**
- Produce `psi_agt002_radar_gate_evaluations` y el RPC `psi_record_agt002_radar_gate_evaluation(p_tender_id uuid, p_stable_key text, p_verdict text, p_rule_ids text[], p_reasons jsonb, p_data_gaps jsonb, p_policy_version text, p_context_version text, p_source_row_hash text, p_idempotency_key text)`.

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const strip = value => value.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const migration071 = strip(readFileSync(new URL('../supabase/migrations/071_agt002_radar_gate.sql', import.meta.url), 'utf8'));
const rollback071 = strip(readFileSync(new URL('../supabase/rollbacks/071_agt002_radar_gate_rollback.sql', import.meta.url), 'utf8'));

// Guardia de autoridad sobre el texto de la migración.
for (const forbidden of ['psi_sales_opportunities', 'psi_convert_tender_to_opportunity', 'converted_opportunity_id', 'internal_status']) {
  assert.equal(migration071.includes(forbidden), false, `071 no debe mencionar ${forbidden}`);
}

const T = '22222222-2222-4222-8222-222222222222';
const pg = new PGlite();
await pg.exec(`
  create role authenticated; create role service_role; create role anon;
  grant service_role to current_user;
  create table public.psi_public_tenders (id uuid primary key, stable_key text unique, internal_status text not null default 'nueva', converted_opportunity_id uuid);
  insert into public.psi_public_tenders (id, stable_key) values ('${T}', 'k-1');
`);
await pg.exec(migration071);

const reasons = [{ rule_id: 'estado_terminal', field: 'status', observed_value: 'Cancelado', source: 'psi_public_tenders.status', policy_version: 'p1', context_version: 'c1' }];
const call = (args) => pg.query(`select public.psi_record_agt002_radar_gate_evaluation(${args}) as data`);
const HASH = 'a'.repeat(64);
const okArgs = `'${T}','k-1','eliminada',array['estado_terminal']::text[],'${JSON.stringify(reasons)}'::jsonb,'[]'::jsonb,'p1','c1','${HASH}','idem-1'`;

const first = await call(okArgs);
assert.equal(first.rows[0].data.verdict, 'eliminada');

// Idempotencia: repetir no crea fila nueva.
await call(okArgs);
const { rows: counted } = await pg.query('select count(*)::int n from public.psi_agt002_radar_gate_evaluations');
assert.equal(counted[0].n, 1);

// Payload en conflicto bajo la misma clave.
await assert.rejects(() => call(okArgs.replace("'eliminada'", "'sobreviviente'").replace("array['estado_terminal']::text[]", "array[]::text[]")), /23505|ya pertenece/);

// Razón sin evidencia: rechazada por el RPC, no por la aplicación.
const sinEvidencia = JSON.stringify([{ rule_id: 'estado_terminal', policy_version: 'p1', context_version: 'c1' }]);
await assert.rejects(() => call(`'${T}','k-1','eliminada',array['estado_terminal']::text[],'${sinEvidencia}'::jsonb,'[]'::jsonb,'p1','c1','${'b'.repeat(64)}','idem-2'`), /22023|evidencia/);

// Eliminada sin reglas y sobreviviente con reglas: ambas imposibles.
await assert.rejects(() => call(`'${T}','k-1','eliminada',array[]::text[],'${JSON.stringify(reasons)}'::jsonb,'[]'::jsonb,'p1','c1','${'c'.repeat(64)}','idem-3'`), /.+/);
await assert.rejects(() => call(`'${T}','k-1','sobreviviente',array['estado_terminal']::text[],'[]'::jsonb,'[]'::jsonb,'p1','c1','${'d'.repeat(64)}','idem-4'`), /.+/);

// Append-only estricto: sin excepciones.
await assert.rejects(() => pg.exec(`update public.psi_agt002_radar_gate_evaluations set verdict = 'sobreviviente'`), /append-only/);
await assert.rejects(() => pg.exec('delete from public.psi_agt002_radar_gate_evaluations'), /append-only/);

// La licitación no fue tocada.
const { rows: tender } = await pg.query(`select internal_status, converted_opportunity_id from public.psi_public_tenders where id = '${T}'`);
assert.deepEqual(tender[0], { internal_status: 'nueva', converted_opportunity_id: null });

// El rollback retira todo sin tocar psi_public_tenders.
await pg.exec(rollback071);
const { rows: gone } = await pg.query(`select to_regclass('public.psi_agt002_radar_gate_evaluations') as t`);
assert.equal(gone[0].t, null);
const { rows: survived } = await pg.query('select count(*)::int n from public.psi_public_tenders');
assert.equal(survived[0].n, 1);
await pg.close();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agt002-radar-gate-migration-pglite.integration.test.mjs`
Expected: FAIL porque `supabase/migrations/071_agt002_radar_gate.sql` no existe.

- [ ] **Step 3: Write minimal implementation**

Escribir `071_agt002_radar_gate.sql` con la tabla, restricciones, índices, trigger append-only estricto, RLS con `revoke all` y `grant select` sólo a `service_role`, y el RPC `security definer` con `set search_path = public, pg_temp`. El RPC valida forma antes de escribir, hace corto circuito por `idempotency_key` antes de cualquier mutación, y recorre `p_reasons` exigiendo `rule_id`, `field`, `observed_value`, `source`, `policy_version` y `context_version` no vacíos en cada elemento (`22023` si falta alguno). Escribir el rollback correspondiente con `drop function`, `drop trigger`, `drop table`, sin ninguna sentencia sobre `psi_public_tenders`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agt002-radar-gate-migration-pglite.integration.test.mjs`
Expected: PASS en las once aserciones, incluidas idempotencia, conflicto, evidencia obligatoria, append-only y rollback limpio.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/071_agt002_radar_gate.sql supabase/rollbacks/071_agt002_radar_gate_rollback.sql tests/agt002-radar-gate-migration-pglite.integration.test.mjs
git commit -m "feat(radar): add append-only AGT-002 radar gate evaluation ledger"
```

---

### Task 4: Contrato cerrado del preanálisis y construcción de entrada

**Files:**
- Create: `agt002-radar-preanalysis-contract.js`
- Create: `agt002-radar-preanalysis-input.js`
- Test: `tests/agt002-radar-preanalysis-contract.test.mjs`

**Interfaces:**
- Produce `AGT002_RADAR_PREANALYSIS_SCHEMA_VERSION`, `AGT002_RADAR_PREANALYSIS_POLICY_VERSION`, `validateAgt002RadarPreanalysis(value)`, `AGT002_RADAR_PREANALYSIS_OUTPUT_SCHEMA`.
- Produce `buildAgt002RadarPreanalysisInput({ tenderRow, gateEvaluation, learningSignals })`.

- [ ] **Step 1: Write the failing test**

```js
import { strict as assert } from 'node:assert';
import { validateAgt002RadarPreanalysis } from '../agt002-radar-preanalysis-contract.js';
import { buildAgt002RadarPreanalysisInput } from '../agt002-radar-preanalysis-input.js';

const valid = {
  schema_version: 'agt002-radar-preanalysis-v1', agent_id: 'AGT-002', run_id: 'run-1',
  policy_version: 'agt002-radar-preanalysis-policy-v1', context_version: 'agt002-radar-context-v1',
  tender_id: '22222222-2222-4222-8222-222222222222',
  gate_evaluation_id: '33333333-3333-4333-8333-333333333333',
  status: 'completed', visibility_verdict: 'mostrar_en_radar',
  summary: 'Proceso de vigilancia con cierre verificable.',
  signals: [{ signal_id: 's1', text: 'Objeto compatible con vigilancia armada.', evidence_refs: ['e1'] }],
  evidence: [{ evidence_id: 'e1', evidence_type: 'tender_field', reference: 'psi_public_tenders.title', observed_value: 'Servicio de vigilancia armada', policy_version: 'agt002-radar-preanalysis-policy-v1', context_version: 'agt002-radar-context-v1' }],
  data_gaps: [], human_review_required: true,
  usage: { provider: 'hetzner_bridge', model: 'm1', input_tokens: 10, output_tokens: 5, cost_usd: 0 },
};

assert.deepEqual(validateAgt002RadarPreanalysis(valid), valid);

// La revisión humana es invariante y no la decide el proveedor.
for (const human_review_required of [false, 'true', 1, null]) {
  assert.throws(() => validateAgt002RadarPreanalysis({ ...valid, human_review_required }), /revisi[oó]n humana|human_review_required/i);
}
const { human_review_required: _omitted, ...withoutHumanReview } = valid;
assert.throws(() => validateAgt002RadarPreanalysis(withoutHumanReview), /cerrad|human_review_required/i);

// Vocabulario de decisión prohibido.
for (const key of ['recommendation', 'decision', 'go_no_go', 'opportunity_id', 'converted_opportunity_id']) {
  assert.throws(() => validateAgt002RadarPreanalysis({ ...valid, [key]: 'go' }), /cerrad|prohibid/i);
}
assert.throws(() => validateAgt002RadarPreanalysis({ ...valid, summary: 'Recomendación: GO' }), /prohibid/i);
for (const allowed of ['riesgo', 'riesgos', 'matriz de riesgos', 'Bogotá', 'catálogo', 'código', 'pliego', 'negociación', 'gobierno', 'agosto', 'algoritmo', 'cargo', 'obligaciones', 'logística', 'pago']) {
  assert.deepEqual(validateAgt002RadarPreanalysis({ ...valid, summary: `Análisis de ${allowed}.` }).summary, `Análisis de ${allowed}.`);
}

// Evidencia obligatoria y sin señales huérfanas.
assert.throws(() => validateAgt002RadarPreanalysis({ ...valid, evidence: [] }), /evidencia/i);
assert.throws(() => validateAgt002RadarPreanalysis({ ...valid, signals: [{ signal_id: 's1', text: 't', evidence_refs: ['no-existe'] }] }), /evidence_id|huérfan/i);

// Coherencia estado/veredicto.
assert.throws(() => validateAgt002RadarPreanalysis({ ...valid, status: 'abstained' }), /veredicto|coheren/i);
assert.deepEqual(
  validateAgt002RadarPreanalysis({ ...valid, status: 'abstained', visibility_verdict: 'no_concluyente', human_review_required: true }).visibility_verdict,
  'no_concluyente',
);

// Identidad del productor.
assert.throws(() => validateAgt002RadarPreanalysis({ ...valid, agent_id: 'AGT-003' }), /AGT-002/);

// La entrada al proveedor no filtra oportunidades ni decisiones.
const input = buildAgt002RadarPreanalysisInput({
  tenderRow: { id: valid.tender_id, stable_key: 'k-1', source: 'SECOP II', entity: 'E', title: 'T', description: 'D', city: 'Bogotá', dept: 'Cundinamarca', value: 100, status: 'abierto', published_at: null, deadline_at: '2026-12-31T23:59:59.000Z', reasons: [], risks: [], raw: {}, internal_status: 'nueva', converted_opportunity_id: null },
  gateEvaluation: { verdict: 'sobreviviente', rule_ids: [], reasons: [], data_gaps: [], policy_version: 'p', context_version: 'c' },
  learningSignals: null,
});
const serialized = JSON.stringify(input);
for (const leak of ['converted_opportunity_id', 'internal_status', 'opportunity', 'go_no_go']) {
  assert.equal(serialized.includes(leak), false, `la entrada no debe contener ${leak}`);
}
assert.throws(() => buildAgt002RadarPreanalysisInput({ tenderRow: null, gateEvaluation: null, learningSignals: null }), /cerrad|inválid/i);
assert.throws(() => buildAgt002RadarPreanalysisInput({ tenderRow: {}, gateEvaluation: { verdict: 'eliminada' }, learningSignals: null }), /sobreviviente/i);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agt002-radar-preanalysis-contract.test.mjs`
Expected: FAIL porque los dos módulos no existen.

- [ ] **Step 3: Write minimal implementation**

Implementar `validateAgt002RadarPreanalysis` con el patrón `exactKeys` de `agt002-tender-adapter.js`: llaves exactas en el sobre, en cada `signal`, en cada `evidence` y en `usage`; guardia léxica por **tokens completos y frases consecutivas** (nunca por subcadena) aplicada a las claves y a los campos de texto libre controlados por la cadena; verificación de que cada `evidence_refs` existe en `evidence[]`; verificación de que cada evidencia `learning_signal` cita un `expectedLearningSignalId`; exigencia de evidencia propia del proceso para `no_mostrar_en_radar`; `human_review_required === true`; y la tabla cerrada de tres veredictos/coherencia con `status`. `buildAgt002RadarPreanalysisInput` proyecta sólo los campos públicos del proceso, exige `gateEvaluation.verdict === 'sobreviviente'`, valida que las señales sean específicas del mismo candidato y estén acotadas por `maxSignals`, y congela el resultado.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agt002-radar-preanalysis-contract.test.mjs`
Expected: PASS, incluida la prohibición de vocabulario GO/NO-GO y la ausencia de fuga de identificadores de oportunidad.

- [ ] **Step 5: Commit**

```bash
git add agt002-radar-preanalysis-contract.js agt002-radar-preanalysis-input.js tests/agt002-radar-preanalysis-contract.test.mjs
git commit -m "feat(radar): add closed AGT-002 radar preanalysis contract and input builder"
```

---

### Task 5: Migración 072 — ledger de preanálisis con promoción canónica y cola durable

**Files:**
- Create: `supabase/migrations/072_agt002_radar_preanalysis_ledger.sql`
- Create: `supabase/rollbacks/072_agt002_radar_preanalysis_ledger_rollback.sql`
- Test: `tests/agt002-radar-preanalysis-ledger-pglite.integration.test.mjs`

**Interfaces:**
- Produce `psi_agt002_radar_preanalysis_runs`, `psi_agt002_radar_preanalysis_attempt_events`, `psi_record_agt002_radar_preanalysis_run(...)` y `psi_append_agt002_radar_preanalysis_attempt(...)`.
- Produce la **cola durable** `psi_agt002_radar_preanalysis_jobs` con `psi_enqueue_agt002_radar_preanalysis_job(p_tender_id, p_gate_evaluation_id, p_attempt_key, p_idempotency_key, p_policy_version, p_context_version, p_source_row_hash)`, `psi_claim_agt002_radar_preanalysis_job(p_lease_seconds)`, `psi_complete_agt002_radar_preanalysis_job(p_job_id, p_lease_id, p_preanalysis_run_id)` y `psi_fail_agt002_radar_preanalysis_job(p_job_id, p_lease_id, p_error_code)`, espejo en técnica de `068_agt002_reanalysis_jobs.sql`.

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const strip = value => value.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const url = name => new URL(`../supabase/${name}`, import.meta.url);
const migration071 = strip(readFileSync(url('migrations/071_agt002_radar_gate.sql'), 'utf8'));
const migration072 = strip(readFileSync(url('migrations/072_agt002_radar_preanalysis_ledger.sql'), 'utf8'));
const rollback072 = strip(readFileSync(url('rollbacks/072_agt002_radar_preanalysis_ledger_rollback.sql'), 'utf8'));

for (const forbidden of ['psi_sales_opportunities', 'psi_convert_tender_to_opportunity', 'converted_opportunity_id', 'internal_status']) {
  assert.equal(migration072.includes(forbidden), false, `072 no debe mencionar ${forbidden}`);
}

const T = '22222222-2222-4222-8222-222222222222';
const pg = new PGlite();
await pg.exec(`
  create role authenticated; create role service_role; create role anon;
  grant service_role to current_user;
  create table public.psi_sales_opportunities (id uuid primary key);
  create table public.psi_public_tenders (id uuid primary key, stable_key text unique, internal_status text not null default 'nueva', converted_opportunity_id uuid);
  insert into public.psi_public_tenders (id, stable_key) values ('${T}', 'k-1');
`);
await pg.exec(migration071);
await pg.exec(migration072);

const survivor = [{ rule_id: 'estado_terminal', field: 'status', observed_value: 'abierto', source: 'psi_public_tenders.status', policy_version: 'p1', context_version: 'c1' }];
const { rows: gateRows } = await pg.query(`select public.psi_record_agt002_radar_gate_evaluation('${T}','k-1','sobreviviente',array[]::text[],'[]'::jsonb,'[]'::jsonb,'p1','c1','${'a'.repeat(64)}','gate-1') as data`);
const gateId = gateRows[0].data.id;
void survivor;

const evidence = JSON.stringify([{ evidence_id: 'e1', evidence_type: 'tender_field', reference: 'title', observed_value: 'vigilancia', policy_version: 'p1', context_version: 'c1' }]);
const run = (key, extra = "'mostrar_en_radar','completed'") =>
  pg.query(`select public.psi_record_agt002_radar_preanalysis_run('${T}','${gateId}',${extra},'{"summary":"ok","human_review_required":true}'::jsonb,'${evidence}'::jsonb,'p1','c1','lv1','m1','{"input_tokens":1}'::jsonb,'${key}') as data`);

const first = (await run('idem-1')).rows[0].data;
assert.equal(first.canonical, true);
assert.equal(first.supersedes_run_id, null);

// Idempotencia: replay no crea fila ni re-supersede.
const replay = (await run('idem-1')).rows[0].data;
assert.equal(replay.id, first.id);
const { rows: c1 } = await pg.query('select count(*)::int n from public.psi_agt002_radar_preanalysis_runs');
assert.equal(c1[0].n, 1);

// Promoción: la anterior se degrada in-place, no se borra ni se reescribe.
const second = (await run('idem-2')).rows[0].data;
assert.equal(second.canonical, true);
assert.equal(second.supersedes_run_id, first.id);
const { rows: previous } = await pg.query(`select canonical, result from public.psi_agt002_radar_preanalysis_runs where id = '${first.id}'`);
assert.equal(previous[0].canonical, false);
assert.deepEqual(previous[0].result, { summary: 'ok', human_review_required: true });
const { rows: canonicalCount } = await pg.query(`select count(*)::int n from public.psi_agt002_radar_preanalysis_runs where tender_id = '${T}' and canonical`);
assert.equal(canonicalCount[0].n, 1);

// Toda corrida terminal nueva gobierna la superficie, incluida abstención y no-mostrar.
const abstained = (await run('idem-abstained', "'no_concluyente','abstained'")).rows[0].data;
assert.equal(abstained.canonical, true);
assert.equal(abstained.supersedes_run_id, second.id);
let current = await pg.query(`select status, visibility_verdict from public.psi_agt002_radar_preanalysis_runs where tender_id = '${T}' and canonical`);
assert.deepEqual(current.rows[0], { status: 'abstained', visibility_verdict: 'no_concluyente' });
const hidden = (await run('idem-hidden', "'no_mostrar_en_radar','completed'")).rows[0].data;
assert.equal(hidden.supersedes_run_id, abstained.id);
current = await pg.query(`select status, visibility_verdict from public.psi_agt002_radar_preanalysis_runs where tender_id = '${T}' and canonical`);
assert.deepEqual(current.rows[0], { status: 'completed', visibility_verdict: 'no_mostrar_en_radar' });

// Payload en conflicto bajo clave existente.
await assert.rejects(() => pg.query(`select public.psi_record_agt002_radar_preanalysis_run('${T}','${gateId}','mostrar_en_radar','completed','{"summary":"otro"}'::jsonb,'${evidence}'::jsonb,'p1','c1','lv1','m1','{"input_tokens":1}'::jsonb,'idem-2')`), /23505|ya pertenece/);

// Un gate 'eliminada' no puede recibir preanálisis.
const { rows: killed } = await pg.query(`select public.psi_record_agt002_radar_gate_evaluation('${T}','k-1','eliminada',array['estado_terminal']::text[],'${JSON.stringify(survivor)}'::jsonb,'[]'::jsonb,'p1','c1','${'b'.repeat(64)}','gate-2') as data`);
await assert.rejects(() => pg.query(`select public.psi_record_agt002_radar_preanalysis_run('${T}','${killed[0].data.id}','mostrar_en_radar','completed','{}'::jsonb,'${evidence}'::jsonb,'p1','c1','lv1','m1','{}'::jsonb,'idem-3')`), /22023|sobreviviente/);

// Evidencia vacía y combinación estado/veredicto incoherente.
await assert.rejects(() => pg.query(`select public.psi_record_agt002_radar_preanalysis_run('${T}','${gateId}','mostrar_en_radar','completed','{}'::jsonb,'[]'::jsonb,'p1','c1','lv1','m1','{}'::jsonb,'idem-4')`), /.+/);
await assert.rejects(() => pg.query(`select public.psi_record_agt002_radar_preanalysis_run('${T}','${gateId}','mostrar_en_radar','abstained','{}'::jsonb,'${evidence}'::jsonb,'p1','c1','lv1','m1','{}'::jsonb,'idem-5')`), /.+/);
await assert.rejects(() => pg.query(`select public.psi_record_agt002_radar_preanalysis_run('${T}','${gateId}','no_concluyente','completed','{"human_review_required":true}'::jsonb,'${evidence}'::jsonb,'p1','c1',null,'m1','{}'::jsonb,'idem-bad-1')`), /.+/);
await assert.rejects(() => pg.query(`select public.psi_record_agt002_radar_preanalysis_run('${T}','${gateId}','no_mostrar_en_radar','abstained','{"human_review_required":true}'::jsonb,'${evidence}'::jsonb,'p1','c1',null,'m1','{}'::jsonb,'idem-bad-2')`), /.+/);
await assert.rejects(() => pg.query(`select public.psi_record_agt002_radar_preanalysis_run('${T}','${gateId}','mostrar_en_radar','completed','{"human_review_required":false}'::jsonb,'${evidence}'::jsonb,'p1','c1',null,'m1','{}'::jsonb,'idem-human-false')`), /22023|human_review_required|revisi[oó]n/);

// Append-only salvo la única transición canónica.
await assert.rejects(() => pg.exec(`update public.psi_agt002_radar_preanalysis_runs set result = '{"summary":"hack"}'::jsonb`), /append-only/);
await assert.rejects(() => pg.exec('delete from public.psi_agt002_radar_preanalysis_runs'), /append-only/);
await assert.rejects(() => pg.exec(`update public.psi_agt002_radar_preanalysis_runs set canonical = true where id = '${first.id}'`), /append-only/);

// Máquina de estados de intentos.
const attempt = (state, key, runId = 'null') => pg.query(`select public.psi_append_agt002_radar_preanalysis_attempt('${T}','attempt-1','${key}','AGT-002','${state}',null,null,${runId})`);
await attempt('queued', 'ev-1');
await assert.rejects(() => attempt('completed', 'ev-2'), /22023|Transición/);
await attempt('running', 'ev-3');
await attempt('completed', 'ev-4', `'${second.id}'`);
await assert.rejects(() => attempt('running', 'ev-5'), /terminal/);

// --- Cola durable: enqueue / claim+lease / complete / fail ---

// Sólo se encola un gate 'sobreviviente'.
await assert.rejects(
  () => pg.query(`select public.psi_enqueue_agt002_radar_preanalysis_job('${T}','${killed[0].data.id}','att-x','job-x','p1','c1','${'b'.repeat(64)}')`),
  /22023|sobreviviente/,
);

// Ya existe canónica para el mismo hash+versiones ⇒ 'satisfied', no se encola nada.
const { rows: satisfied } = await pg.query(`select public.psi_enqueue_agt002_radar_preanalysis_job('${T}','${gateId}','att-1','job-1','p1','c1','${'a'.repeat(64)}') as data`);
assert.equal(satisfied[0].data.status, 'satisfied');
const { rows: queuedCount } = await pg.query('select count(*)::int n from public.psi_agt002_radar_preanalysis_jobs');
assert.equal(queuedCount[0].n, 0);

// Una fila cambiada (hash nuevo) sí se encola, y el replay de la misma clave la reusa.
const { rows: gate3 } = await pg.query(`select public.psi_record_agt002_radar_gate_evaluation('${T}','k-1','sobreviviente',array[]::text[],'[]'::jsonb,'[]'::jsonb,'p1','c1','${'e'.repeat(64)}','gate-3') as data`);
const gate3Id = gate3[0].data.id;
const enqueue = (key = 'job-2', attempt = 'att-2') =>
  pg.query(`select public.psi_enqueue_agt002_radar_preanalysis_job('${T}','${gate3Id}','${attempt}','${key}','p1','c1','${'e'.repeat(64)}') as data`);
assert.equal((await enqueue()).rows[0].data.status, 'created');
assert.equal((await enqueue()).rows[0].data.status, 'existing');
const { rows: activeCount } = await pg.query(`select count(*)::int n from public.psi_agt002_radar_preanalysis_jobs where status in ('queued','running')`);
assert.equal(activeCount[0].n, 1);

// Identidad inmutable tras el insert.
await assert.rejects(() => pg.exec(`update public.psi_agt002_radar_preanalysis_jobs set source_row_hash = '${'f'.repeat(64)}'`), /55000|inmutable/);

// Claim: entrega un job con reserva; el segundo claim no entrega nada.
const { rows: claimed } = await pg.query('select public.psi_claim_agt002_radar_preanalysis_job(120) as data');
assert.equal(claimed[0].data.status, 'claimed');
assert.equal(claimed[0].data.tender_id, T);
assert.equal(claimed[0].data.gate_evaluation_id, gate3Id);
assert.ok(claimed[0].data.lease_id);
assert.equal((await pg.query('select public.psi_claim_agt002_radar_preanalysis_job(120) as data')).rows[0].data.status, 'empty');

// Complete exige reserva vigente y una corrida canónica real del mismo job:
// la corrida debe llevar el gate_evaluation_id con el que se encoló el job.
const runForGate = (gateEvalId, key) =>
  pg.query(`select public.psi_record_agt002_radar_preanalysis_run('${T}','${gateEvalId}','mostrar_en_radar','completed','{"summary":"ok"}'::jsonb,'${evidence}'::jsonb,'p1','c1','lv1','m1','{"input_tokens":1}'::jsonb,'${key}') as data`);
const third = (await runForGate(gate3Id, 'idem-6')).rows[0].data;
await assert.rejects(
  () => pg.query(`select public.psi_complete_agt002_radar_preanalysis_job('${claimed[0].data.job_id}','${'11111111-1111-4111-8111-111111111111'}','${third.id}')`),
  /55000|reserva/,
);
await assert.rejects(
  () => pg.query(`select public.psi_complete_agt002_radar_preanalysis_job('${claimed[0].data.job_id}','${claimed[0].data.lease_id}','${first.id}')`),
  /22023/,
);
const { rows: completed } = await pg.query(`select public.psi_complete_agt002_radar_preanalysis_job('${claimed[0].data.job_id}','${claimed[0].data.lease_id}','${third.id}') as data`);
assert.equal(completed[0].data.status, 'completed');
// Replay idéntico: 'existing'. Con otra corrida: 23505.
assert.equal((await pg.query(`select public.psi_complete_agt002_radar_preanalysis_job('${claimed[0].data.job_id}','${claimed[0].data.lease_id}','${third.id}') as data`)).rows[0].data.status, 'existing');
await assert.rejects(
  () => pg.query(`select public.psi_complete_agt002_radar_preanalysis_job('${claimed[0].data.job_id}','${claimed[0].data.lease_id}','${second.id}')`),
  /23505/,
);

// Reserva vencida: el claim siguiente la cierra terminalmente y NO reentrega el job.
const { rows: gate4 } = await pg.query(`select public.psi_record_agt002_radar_gate_evaluation('${T}','k-1','sobreviviente',array[]::text[],'[]'::jsonb,'[]'::jsonb,'p2','c1','${'e'.repeat(64)}','gate-4') as data`);
await pg.query(`select public.psi_enqueue_agt002_radar_preanalysis_job('${T}','${gate4[0].data.id}','att-3','job-3','p2','c1','${'e'.repeat(64)}')`);
const { rows: claimed2 } = await pg.query('select public.psi_claim_agt002_radar_preanalysis_job(1) as data');
assert.equal(claimed2[0].data.status, 'claimed');
await pg.exec(`update public.psi_agt002_radar_preanalysis_jobs set lease_expires_at = now() - interval '1 minute' where id = '${claimed2[0].data.job_id}'`);
assert.equal((await pg.query('select public.psi_claim_agt002_radar_preanalysis_job(120) as data')).rows[0].data.status, 'empty');
const { rows: lost } = await pg.query(`select status, error_code from public.psi_agt002_radar_preanalysis_jobs where id = '${claimed2[0].data.job_id}'`);
assert.deepEqual(lost[0], { status: 'unavailable', error_code: 'lease_lost' });
// La pérdida de reserva deja rastro en el ledger de intentos, sin huecos.
const { rows: lostEvent } = await pg.query(`select count(*)::int n from public.psi_agt002_radar_preanalysis_attempt_events where event_key = 'att-3:lease_lost'`);
assert.equal(lostEvent[0].n, 1);

// Fail: sólo códigos cerrados, mensaje derivado, y terminal de verdad.
const { rows: gate5 } = await pg.query(`select public.psi_record_agt002_radar_gate_evaluation('${T}','k-1','sobreviviente',array[]::text[],'[]'::jsonb,'[]'::jsonb,'p3','c1','${'e'.repeat(64)}','gate-5') as data`);
await pg.query(`select public.psi_enqueue_agt002_radar_preanalysis_job('${T}','${gate5[0].data.id}','att-4','job-4','p3','c1','${'e'.repeat(64)}')`);
const { rows: claimed3 } = await pg.query('select public.psi_claim_agt002_radar_preanalysis_job(120) as data');
await assert.rejects(() => pg.query(`select public.psi_fail_agt002_radar_preanalysis_job('${claimed3[0].data.job_id}','${claimed3[0].data.lease_id}','disco_duro')`), /22023/);
const { rows: failed } = await pg.query(`select public.psi_fail_agt002_radar_preanalysis_job('${claimed3[0].data.job_id}','${claimed3[0].data.lease_id}','timeout') as data`);
assert.equal(failed[0].data.error_code, 'timeout');
assert.ok(String(failed[0].data.error_message).length > 0);
await assert.rejects(
  () => pg.query(`select public.psi_complete_agt002_radar_preanalysis_job('${claimed3[0].data.job_id}','${claimed3[0].data.lease_id}','${third.id}')`),
  /55000|terminal/,
);

// Ninguna oportunidad creada y la licitación intacta.
const { rows: opportunities } = await pg.query('select count(*)::int n from public.psi_sales_opportunities');
assert.equal(opportunities[0].n, 0);
const { rows: tender } = await pg.query(`select internal_status, converted_opportunity_id from public.psi_public_tenders where id = '${T}'`);
assert.deepEqual(tender[0], { internal_status: 'nueva', converted_opportunity_id: null });

// Rollback limpio: se van los tres objetos de 072 y sobrevive 071.
await pg.exec(rollback072);
for (const relation of ['psi_agt002_radar_preanalysis_runs', 'psi_agt002_radar_preanalysis_attempt_events', 'psi_agt002_radar_preanalysis_jobs']) {
  const { rows: gone } = await pg.query(`select to_regclass('public.${relation}') as t`);
  assert.equal(gone[0].t, null, `${relation} debe desaparecer con el rollback de 072`);
}
const { rows: gateSurvives } = await pg.query(`select to_regclass('public.psi_agt002_radar_gate_evaluations') as t`);
assert.notEqual(gateSurvives[0].t, null);
await pg.close();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agt002-radar-preanalysis-ledger-pglite.integration.test.mjs`
Expected: FAIL porque `supabase/migrations/072_agt002_radar_preanalysis_ledger.sql` no existe.

- [ ] **Step 3: Write minimal implementation**

Escribir `072` con **tres** tablas —`psi_agt002_radar_preanalysis_runs`, `psi_agt002_radar_preanalysis_attempt_events` y la cola `psi_agt002_radar_preanalysis_jobs`—, el índice único parcial `on (tender_id) where canonical` **sin predicado de estado**, el dominio cerrado de tres veredictos, el `check` que exige `result -> 'human_review_required' = true`, y el trigger de inmutabilidad con la única excepción `canonical true → false` comparando `(to_jsonb(old) - 'canonical') = (to_jsonb(new) - 'canonical')` (idéntico en técnica a `063`). RLS concede `select` sólo a `service_role`. Los RPC `security definer` siguen el orden estricto del spec §7.2: validación, corto circuito de idempotencia, `for update` sobre `psi_public_tenders`, verificación del gate, degradación de **cualquier** canónica terminal anterior e inserción de la nueva terminal con `supersedes_run_id`.

Para la cola, copiar la técnica de `068_agt002_reanalysis_jobs.sql` cambiando el sujeto `opportunity_id` por `tender_id`, según el spec §7.2:

- `constraint … lease_all_or_none` y `constraint … terminal_shape`; índice único parcial de un job activo por licitación `where status in ('queued','running')`; índice `claimable` `where status = 'queued' and lease_id is null`.
- trigger `before update` que hace inmutables identidad, versiones, `source_row_hash`, `attempt_key`, `idempotency_key` y `created_at` (`55000`).
- `psi_enqueue_…`: exige gate `sobreviviente` del mismo `tender_id` (`22023`), toma `pg_advisory_xact_lock` por licitación, reusa el job activo (`existing`), lanza `55000` si la clave choca con otra identidad, y devuelve `satisfied` sin encolar cuando ya hay canónica con el mismo `source_row_hash` + `policy_version` + `context_version`.
- `psi_claim_…`: acota `[1, 600]`; **primero** cierra como `lease_lost` toda fila `running` vencida y asienta su evento `unavailable` con `event_key = attempt_key || ':lease_lost'`; luego `for update skip locked limit 1`.
- `psi_complete_…`: exige `running`, reserva vigente y coincidente, y una corrida ya existente `canonical` del mismo `tender_id` **y del mismo `gate_evaluation_id`** (`22023`), sea `completed` o `abstained`; replay idéntico ⇒ `existing`, otra corrida ⇒ `23505`; nunca escribe el ledger.
- `psi_fail_…`: sólo los seis códigos cerrados, mensaje derivado de un `case` fijo, sin aceptar texto crudo.
- `revoke all` + `grant execute` sólo a `service_role` para los cuatro RPC de cola.

Escribir el rollback que retira sólo los objetos de `072` (cola incluida), sin tocar `071` ni `psi_public_tenders`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agt002-radar-preanalysis-ledger-pglite.integration.test.mjs`
Expected: PASS, incluidas promoción canónica única, idempotencia, rechazo de gate eliminado, append-only, cola durable (enqueue/`satisfied`/claim con reserva/complete/fail/`lease_lost`) y ausencia total de escritura sobre `psi_public_tenders`/`psi_sales_opportunities`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/072_agt002_radar_preanalysis_ledger.sql supabase/rollbacks/072_agt002_radar_preanalysis_ledger_rollback.sql tests/agt002-radar-preanalysis-ledger-pglite.integration.test.mjs
git commit -m "feat(radar): add tender-scoped AGT-002 preanalysis ledger and durable job queue"
```

---

### Task 6: Persistencia, cliente de cola, runtime y worker durable

**Files:**
- Create: `agt002-radar-preanalysis-persistence.js`
- Create: `agt002-radar-preanalysis-jobs.js`
- Create: `agt002-radar-preanalysis-runtime.js`
- Create: `agt002-radar-preanalysis-worker.js`
- Test: `tests/agt002-radar-preanalysis-runtime.test.mjs`
- Test: `tests/agt002-radar-preanalysis-worker.test.mjs`

**Interfaces:**
- Produce `recordAgt002RadarGateEvaluation`, `recordAgt002RadarPreanalysisRun`, `appendAgt002RadarPreanalysisAttempt`, `readAgt002RadarCanonicalPreanalysis(database, tenderIds)`, `computeAgt002RadarPreanalysisIdempotencyKey(parts)`.
- Produce `enqueueAgt002RadarPreanalysisJob`, `claimAgt002RadarPreanalysisJob(database, { leaseSeconds })`, `completeAgt002RadarPreanalysisJob(database, { jobId, leaseId, preanalysisRunId })`, `failAgt002RadarPreanalysisJob(database, { jobId, leaseId, errorCode })`.
- Produce `isAgt002RadarPreanalysisConfigured`, `getAgt002RadarPreanalysisRuntimeConfig`, `createAgt002RadarPreanalysisRuntime`.
- Produce `createAgt002RadarPreanalysisWorker({ database, executeJob, leaseSeconds, claimJob, completeJob, failJob })`, `classifyAgt002RadarPreanalysisError` y `AGT002_RADAR_QUEUE_ERROR_CODES`.

- [ ] **Step 1: Write the failing test**

En `tests/agt002-radar-preanalysis-runtime.test.mjs`:

```js
import { strict as assert } from 'node:assert';
import { createAgt002RadarPreanalysisRuntime, getAgt002RadarPreanalysisRuntimeConfig, isAgt002RadarPreanalysisConfigured } from '../agt002-radar-preanalysis-runtime.js';

const env = {
  AGT002_RADAR_GATE: 'true',
  AGT002_RADAR_PREANALYSIS_MODEL: 'm1',
  AGT002_HETZNER_BRIDGE_URL: 'https://bridge.example.test/run',
  AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'x'.repeat(48),
};

assert.equal(isAgt002RadarPreanalysisConfigured(env), true);
assert.equal(isAgt002RadarPreanalysisConfigured({ ...env, AGT002_RADAR_GATE: 'false' }), false);
assert.equal(isAgt002RadarPreanalysisConfigured({ ...env, AGT002_RADAR_PREANALYSIS_MODEL: '' }), false);
assert.equal(isAgt002RadarPreanalysisConfigured({}), false);
assert.equal(getAgt002RadarPreanalysisRuntimeConfig(env).model, 'm1');
assert.throws(() => getAgt002RadarPreanalysisRuntimeConfig({ ...env, AGT002_RADAR_PREANALYSIS_TIMEOUT_MS: 'abc' }), /AGT002_RADAR_RUNTIME_CONFIG_INVALID/);
assert.throws(() => createAgt002RadarPreanalysisRuntime({ environment: {} }), /AGT002_RADAR_RUNTIME_CONFIG_INVALID/);

// Un sobre inválido del proveedor nunca se convierte en un resultado exitoso.
const runtime = createAgt002RadarPreanalysisRuntime({
  environment: env,
  createClient: () => ({ run: async () => ({ output: { agent_id: 'AGT-003' } }) }),
});
await assert.rejects(() => runtime.runOnce({ tenderRow: { id: '22222222-2222-4222-8222-222222222222' }, gateEvaluation: { verdict: 'sobreviviente' }, learningSignals: null }), /AGT002_RADAR_PREANALYSIS_INVALID_OUTPUT/);
```

En `tests/agt002-radar-preanalysis-worker.test.mjs`:

```js
import { strict as assert } from 'node:assert';
import { classifyAgt002RadarPreanalysisError, createAgt002RadarPreanalysisWorker } from '../agt002-radar-preanalysis-worker.js';

assert.equal(classifyAgt002RadarPreanalysisError({ runtime_boundary_code: 'AGT002_RADAR_PREANALYSIS_TIMEOUT' }), 'timeout');
assert.equal(classifyAgt002RadarPreanalysisError({ runtime_boundary_code: 'AGT002_RADAR_PREANALYSIS_INVALID_OUTPUT' }), 'invalid_output');
assert.equal(classifyAgt002RadarPreanalysisError({ runtime_boundary_code: 'AGT002_RADAR_PERSISTENCE_FAILURE' }), 'persistence_failure');
assert.equal(classifyAgt002RadarPreanalysisError({ runtime_boundary_code: 'AGT002_RADAR_LEASE_LOST' }), 'lease_lost');
assert.equal(classifyAgt002RadarPreanalysisError({ runtime_boundary_code: 'AGT002_RADAR_CAPACITY_UNAVAILABLE' }), 'capacity_unavailable');
assert.equal(classifyAgt002RadarPreanalysisError(new Error('boom')), 'provider_error');

// Fallo del proveedor: exactamente una transición terminal, vía la cola durable.
const calls = [];
const job = { jobId: 'j1', leaseId: 'l1', tenderId: 't1', gateEvaluationId: 'g1', attemptKey: 'a1' };
const worker = createAgt002RadarPreanalysisWorker({
  database: {},
  leaseSeconds: 120,
  claimJob: async () => { calls.push('claim'); return job; },
  executeJob: async () => { calls.push('exec'); throw new Error('boom'); },
  completeJob: async () => { calls.push('complete'); },
  failJob: async (_db, { errorCode }) => { calls.push(`fail:${errorCode}`); },
});
assert.deepEqual(await worker.runOnce(), { status: 'unavailable', jobId: 'j1', errorCode: 'provider_error' });
assert.deepEqual(calls, ['claim', 'exec', 'fail:provider_error']);

// Éxito: se cierra contra la corrida canónica ya persistida, una sola vez.
const okCalls = [];
const ok = createAgt002RadarPreanalysisWorker({
  database: {},
  claimJob: async () => job,
  executeJob: async () => { okCalls.push('exec'); return { preanalysis_run_id: 'r1' }; },
  completeJob: async (_db, args) => { okCalls.push(`complete:${args.preanalysisRunId}`); },
  failJob: async () => { okCalls.push('fail'); },
});
assert.deepEqual(await ok.runOnce(), { status: 'completed', jobId: 'j1', preanalysisRunId: 'r1' });
assert.deepEqual(okCalls, ['exec', 'complete:r1']);

// Si el cierre falla después de persistir la canónica, el job queda persistence_failure.
const brokenClose = createAgt002RadarPreanalysisWorker({
  database: {},
  claimJob: async () => job,
  executeJob: async () => ({ preanalysis_run_id: 'r1' }),
  completeJob: async () => { throw new Error('cierre caído'); },
  failJob: async () => {},
});
assert.deepEqual(await brokenClose.runOnce(), { status: 'unavailable', jobId: 'j1', errorCode: 'persistence_failure' });

// Cola vacía: cero llamadas al proveedor.
const empty = createAgt002RadarPreanalysisWorker({ database: {}, claimJob: async () => null, executeJob: async () => { throw new Error('no debe ejecutarse'); }, completeJob: async () => {}, failJob: async () => {} });
assert.deepEqual(await empty.runOnce(), { status: 'empty' });
assert.throws(() => createAgt002RadarPreanalysisWorker({ database: {}, executeJob: async () => {}, claimJob: async () => null, completeJob: async () => {}, failJob: async () => {}, leaseSeconds: 5 }), /leaseSeconds/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agt002-radar-preanalysis-runtime.test.mjs tests/agt002-radar-preanalysis-worker.test.mjs`
Expected: FAIL porque los cuatro módulos no existen.

- [ ] **Step 3: Write minimal implementation**

`agt002-radar-preanalysis-runtime.js` replica la estructura de `agt002-preview-runtime.js`: `withRuntimeBoundaryCode` con los códigos del spec §11, construcción del cliente vía `createAgt002HetznerBridgeClient` (inyectable con `createClient` para pruebas), y `runOnce` que construye la entrada, llama al puente y pasa la salida por `validateAgt002RadarPreanalysis`, convirtiendo cualquier fallo de validación en `AGT002_RADAR_PREANALYSIS_INVALID_OUTPUT`.

`agt002-radar-preanalysis-worker.js` replica `agt002-reanalysis-worker.js` **[EXISTE]** línea por línea en estructura: `claimJob` (a lo sumo un job), `executeJob` **como máximo una vez**, exactamente una transición terminal (`completeJob` o `failJob`), sin reintentos internos, `leaseSeconds` acotado a `[30, 600]`, y `classifyAgt002RadarPreanalysisError` con la misma técnica de subcadenas (`TIMEOUT`, `PERSIST`, `LEASE`, `CAPACITY`/`QUOTA`, `INVALID`/`VALIDATION`/`ENVELOPE`, y `provider_error` como caída por defecto). El fallo de `completeJob` tras una canónica ya persistida cierra el job como `persistence_failure`, igual que en `068`.

`agt002-radar-preanalysis-jobs.js` envuelve los cuatro RPC de cola vía `database.rpc(...)` y normaliza el resultado del claim a `{ jobId, leaseId, leaseExpiresAt, tenderId, gateEvaluationId, attemptKey, policyVersion, contextVersion, sourceRowHash }` o `null` cuando la cola está vacía. Ningún `insert`/`update`/`upsert`/`delete` directo.

`agt002-radar-preanalysis-persistence.js` envuelve los RPC de ledger de `071`/`072` vía `database.rpc(...)`, propaga los errores con `runtime_boundary_code = 'AGT002_RADAR_PERSISTENCE_FAILURE'`, y expone `readAgt002RadarCanonicalPreanalysis` que consulta **toda** corrida vigente con `.eq('canonical', true).in('tender_id', ids)` en lotes de 250, sin filtrar por `status`; debe proyectar `visibility_verdict`, `source_row_hash`, `policy_version` y `context_version` para que una abstención/no-mostrar posterior y la frescura gobiernen correctamente la visibilidad.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agt002-radar-preanalysis-runtime.test.mjs tests/agt002-radar-preanalysis-worker.test.mjs`
Expected: PASS, incluida la conversión de sobre inválido en error de frontera, la transición terminal única y el cierre `persistence_failure` cuando falla el `complete`.

- [ ] **Step 5: Commit**

```bash
git add agt002-radar-preanalysis-persistence.js agt002-radar-preanalysis-jobs.js agt002-radar-preanalysis-runtime.js agt002-radar-preanalysis-worker.js tests/agt002-radar-preanalysis-runtime.test.mjs tests/agt002-radar-preanalysis-worker.test.mjs
git commit -m "feat(radar): add AGT-002 radar preanalysis runtime, persistence, queue client and durable worker"
```

---

### Task 7: Aprendizaje candidate-specific top-K y propuestas DRAFT

**Files:**
- Create: `agt002-radar-learning-projection.js`
- Create: `agt002-radar-learning-retrieval.js`
- Create: `agt002-radar-learning-proposals.js`
- Test: `tests/agt002-radar-learning-retrieval.test.mjs`
- Test: `tests/agt002-radar-learning-proposals.test.mjs`

**Interfaces:**
- Produce `projectAgt002RadarLearningObservations(database, { limit })`: una proyección por corrida, cerrada y **sólo lectura**, sobre conversiones manuales, análisis canónicos, decisiones humanas y resultados de oferta.
- Produce `AGT002_RADAR_LEARNING_SIGNALS_VERSION`, `AGT002_RADAR_LEARNING_MAX_SIGNALS_LIMIT`, `AGT002_RADAR_LEARNING_DIMENSIONS` y `buildAgt002RadarLearningSignals({ candidate, observations, maxSignals })`.
- Produce `buildAgt002RadarLearningProposals({ observations, generatedAt })` con `status: 'DRAFT'` y `human_approval_required: true`; este es el único consumidor global permitido y nunca entra al pipeline.

- [ ] **Step 1: Write the failing tests**

En `tests/agt002-radar-learning-retrieval.test.mjs`, construir tres candidatos normalizados y observaciones barajadas. Probar de forma explícita:

```js
import assert from 'node:assert/strict';
import { AGT002_RADAR_LEARNING_MAX_SIGNALS_LIMIT, buildAgt002RadarLearningSignals } from '../agt002-radar-learning-retrieval.js';

const candidate = {
  tender_id: 'candidate-1', service_terms: ['vigilancia', 'armada'], entity_key: 'entidad-a',
  modality_key: 'licitacion-publica', source_key: 'secop-ii', territory_key: { city: 'bogota', dept: 'cundinamarca' },
};
const observations = {
  precedents: [
    { observation_id: 'p3', tender_id: 't3', service_terms: ['aseo'], entity_key: 'otra', modality_key: 'minima-cuantia', source_key: 'secop-i', territory_key: { city: 'cali', dept: 'valle' }, decided_at: '2026-08-03T00:00:00.000Z', signal_polarity: 'desfavorable', evidence: [{ record_id: 'r3', evidence_type: 'offer_outcome' }] },
    { observation_id: 'p2', tender_id: 't2', service_terms: ['vigilancia'], entity_key: 'otra', modality_key: 'licitacion-publica', source_key: 'secop-ii', territory_key: { city: 'medellin', dept: 'antioquia' }, decided_at: '2026-08-02T00:00:00.000Z', signal_polarity: 'desfavorable', evidence: [{ record_id: 'r2', evidence_type: 'human_decision' }] },
    { observation_id: 'p1', tender_id: 't1', service_terms: ['vigilancia', 'armada'], entity_key: 'entidad-a', modality_key: 'licitacion-publica', source_key: 'secop-ii', territory_key: { city: 'bogota', dept: 'cundinamarca' }, decided_at: '2026-08-01T00:00:00.000Z', signal_polarity: 'favorable', evidence: [{ record_id: 'r1', evidence_type: 'converted_tender' }] },
  ],
};

const top1 = buildAgt002RadarLearningSignals({ candidate, observations, maxSignals: 1 });
assert.equal(top1.candidate_id, candidate.tender_id);
assert.equal(top1.max_signals, 1);
assert.deepEqual(top1.signals.map(signal => signal.observation_id), ['p1']);
assert.equal(top1.considered, 2); // p3 no coincide en ninguna dimensión y no rellena el top-K.
assert.ok(top1.signals[0].candidate_match.length >= 1);
assert.ok(top1.signals[0].candidate_match.every(match => ['servicio_objeto', 'entidad', 'modalidad', 'fuente', 'territorio'].includes(match.dimension)));
assert.equal(top1.signals.some(signal => signal.effect === 'exclude'), false);

// El retrieval es específico del candidato, determinista y con desempate total.
const otherCandidate = { ...candidate, tender_id: 'candidate-2', service_terms: ['aseo'], entity_key: 'otra', modality_key: 'minima-cuantia', source_key: 'secop-i', territory_key: { city: 'cali', dept: 'valle' } };
assert.deepEqual(buildAgt002RadarLearningSignals({ candidate: otherCandidate, observations, maxSignals: 1 }).signals.map(s => s.observation_id), ['p3']);
assert.equal(JSON.stringify(buildAgt002RadarLearningSignals({ candidate, observations, maxSignals: 2 })), JSON.stringify(buildAgt002RadarLearningSignals({ candidate, observations: { precedents: [...observations.precedents].reverse() }, maxSignals: 2 })));

// Cota obligatoria y ausencia legítima.
assert.throws(() => buildAgt002RadarLearningSignals({ candidate, observations }), /AGT002_RADAR_LEARNING_SIGNALS_INVALID/);
assert.throws(() => buildAgt002RadarLearningSignals({ candidate, observations, maxSignals: AGT002_RADAR_LEARNING_MAX_SIGNALS_LIMIT + 1 }), /AGT002_RADAR_LEARNING_SIGNALS_INVALID/);
assert.deepEqual(buildAgt002RadarLearningSignals({ candidate: { ...candidate, tender_id: 'candidate-3', service_terms: ['helicoptero'], entity_key: 'sin-par', modality_key: null, source_key: 'esu', territory_key: { city: 'tunja', dept: 'boyaca' } }, observations, maxSignals: 5 }).signals, []);
```

El mismo test verifica que cada señal lleva `candidate_match`, `score`, `max_score`, evidencia por ids, versión y `signal_polarity`; que GO sólo se proyecta como polaridad favorable; que NO-GO/`no_adjudicada` sólo bajan prioridad relativa; y que el módulo de proyección no contiene `.insert/.update/.upsert/.delete`.

En `tests/agt002-radar-learning-proposals.test.mjs`, llamar `buildAgt002RadarLearningProposals({ observations, generatedAt })` y exigir `DRAFT`, aprobación humana, agregados citados y forma incompatible con `buildAgt002RadarPreanalysisInput` y con el gate. El test debe demostrar que el pipeline no importa ni invoca `agt002-radar-learning-proposals.js`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agt002-radar-learning-retrieval.test.mjs tests/agt002-radar-learning-proposals.test.mjs`
Expected: FAIL porque los tres módulos no existen.

- [ ] **Step 3: Write minimal implementation**

`agt002-radar-learning-projection.js` usa exclusivamente `select` y convierte las cuatro fuentes en `observations.precedents[]` con ids, instante UTC normalizado, campos comparables normalizados, evidencia y polaridad; no emite señales. `agt002-radar-learning-retrieval.js` recibe **un candidato**, puntúa las cinco dimensiones y sus pesos exactos del spec §8.8, descarta coincidencia cero, ordena por score/dimensiones/fecha/id, corta después de ordenar y devuelve a lo sumo `maxSignals`. No admite default global ni agregado. `agt002-radar-learning-proposals.js` consume observaciones globales sólo para producir un DRAFT humano estructuralmente incompatible con las señales candidate-specific.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agt002-radar-learning-retrieval.test.mjs tests/agt002-radar-learning-proposals.test.mjs`
Expected: PASS, incluido top-K candidate-specific, orden determinista, ausencia legítima, ninguna exclusión automática y aislamiento del DRAFT.

- [ ] **Step 5: Commit**

```bash
git add agt002-radar-learning-projection.js agt002-radar-learning-retrieval.js agt002-radar-learning-proposals.js tests/agt002-radar-learning-retrieval.test.mjs tests/agt002-radar-learning-proposals.test.mjs
git commit -m "feat(radar): add candidate-specific governed learning retrieval and DRAFT proposals"
```

---

### Task 8: Cadena real y entrypoint apagado por defecto

**Files:**
- Create: `agt002-radar-pipeline.js`
- Create: `ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs`
- Create: `ops/agt002-radar-pipeline/agt002-radar-pipeline.service`
- Create: `ops/agt002-radar-pipeline/agt002-radar-pipeline.timer`
- Create: `ops/agt002-radar-pipeline/env.example`
- Create: `ops/agt002-radar-pipeline/README.md`
- Test: `tests/agt002-radar-pipeline.test.mjs`
- Test: `tests/agt002-radar-pipeline-systemd.test.mjs`

**Interfaces:**
- Produce `AGT002_RADAR_PIPELINE_STAGES` y `createAgt002RadarPipeline({...})` con `runOnce()`, según el spec §8.9.
- El entrypoint `ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs` ejecuta **una** `runOnce()` e imprime una línea JSON, espejo de `ops/agt002-reanalysis-worker/run-agt002-reanalysis-worker.mjs`.
- El pipeline proyecta `observations` una vez, pero llama `buildAgt002RadarLearningSignals({ candidate, observations, maxSignals })` sólo para la licitación reclamada; el objeto global jamás se pasa al proveedor.

> **Esta tarea crea archivos; no habilita nada.** No se ejecuta `systemctl` en ningún paso, no se instala el `.service` ni el `.timer`, y el entrypoint sólo se ejecuta en su ruta apagada. Encender la cadena es la autorización separada del final del plan.

- [ ] **Step 1: Write the failing test**

En `tests/agt002-radar-pipeline.test.mjs`:

```js
import { strict as assert } from 'node:assert';
import { AGT002_RADAR_PIPELINE_STAGES, createAgt002RadarPipeline } from '../agt002-radar-pipeline.js';

const NOW = '2026-08-25T15:00:00.000Z';
const TENDER = { id: '22222222-2222-4222-8222-222222222222', stable_key: 'k-1' };

// Doble de base de datos que estalla si alguien la toca.
const hostileDatabase = new Proxy({}, { get() { throw new Error('la base no debe tocarse'); } });
const hostile = () => { throw new Error('no debe invocarse'); };

// 1. Flag apagado: no-op total, salida cerrada, cero efectos.
for (const environment of [{}, { AGT002_RADAR_GATE: 'false' }, { AGT002_RADAR_GATE: 'yes' }, { AGT002_RADAR_GATE: '' }]) {
  const disabled = createAgt002RadarPipeline({
    database: hostileDatabase, environment, now: () => NOW,
    fetchTenderPage: hostile, evaluateGate: hostile, recordGateEvaluation: hostile,
    enqueueJob: hostile, claimJob: hostile, completeJob: hostile, failJob: hostile,
    projectLearningObservations: hostile, buildLearningSignals: hostile,
    runPreanalysis: hostile, recordPreanalysisRun: hostile, appendAttempt: hostile,
  });
  assert.deepEqual(await disabled.runOnce(), { status: 'disabled', stages: [], code: 'AGT002_RADAR_PIPELINE_DISABLED' });
}

// 2. Flag encendido: orden real de la cadena, verificado por instrumentación.
const stages = [];
const track = (name, value) => (...args) => { stages.push(name); return typeof value === 'function' ? value(...args) : value; };
const enabled = createAgt002RadarPipeline({
  database: {}, environment: { AGT002_RADAR_GATE: 'true' }, now: () => NOW,
  fetchTenderPage: track('fetch', [TENDER, { id: '33333333-3333-4333-8333-333333333333', stable_key: 'k-2' }]),
  evaluateGate: track('gate', row => (row.stable_key === 'k-1'
    ? { verdict: 'sobreviviente', rule_ids: [], reasons: [], data_gaps: [], tender_id: row.id, source_row_hash: 'a'.repeat(64), policy_version: 'p', context_version: 'c' }
    : { verdict: 'eliminada', rule_ids: ['estado_terminal'], reasons: [{ rule_id: 'estado_terminal' }], data_gaps: [], tender_id: row.id, source_row_hash: 'b'.repeat(64), policy_version: 'p', context_version: 'c' })),
  recordGateEvaluation: track('ledger', { id: 'gate-1' }),
  enqueueJob: track('enqueue', { status: 'created', job_id: 'j1' }),
  claimJob: track('claim', { jobId: 'j1', leaseId: 'l1', tenderId: TENDER.id, gateEvaluationId: 'gate-1', attemptKey: 'a1' }),
  projectLearningObservations: track('learning', { precedents: [] }),
  buildLearningSignals: track('signals', ({ candidate, maxSignals }) => {
    assert.equal(candidate.tender_id, TENDER.id);
    assert.equal(maxSignals, 10);
    return { version: 'agt002-radar-learning-v1', candidate_id: TENDER.id, max_signals: 10, considered: 0, signals: [] };
  }),
  runPreanalysis: track('agt', { status: 'completed', visibility_verdict: 'mostrar_en_radar' }),
  recordPreanalysisRun: track('persist', { id: 'r1', canonical: true }),
  appendAttempt: async () => {},
  completeJob: track('complete', { status: 'completed' }),
  failJob: hostile,
});
const result = await enabled.runOnce();

assert.equal(result.status, 'completed');
assert.equal(result.job_id, 'j1');
assert.equal(result.preanalysis_run_id, 'r1');
assert.equal(result.evaluated, 2);
assert.equal(result.survivors, 1);
assert.equal(result.eliminated, 1);

// El orden es la garantía: aprendizaje DESPUÉS del claim y ANTES de AGT-002; persistencia antes de cerrar el job.
assert.deepEqual(
  stages.filter((stage, index) => stages.indexOf(stage) === index),
  ['fetch', 'gate', 'ledger', 'enqueue', 'claim', 'learning', 'signals', 'agt', 'persist', 'complete'],
);
assert.deepEqual(result.stages, AGT002_RADAR_PIPELINE_STAGES);

// 3. Sólo se encolan sobrevivientes: la eliminada llegó al ledger pero no a la cola.
assert.equal(stages.filter(stage => stage === 'ledger').length, 2);
assert.equal(stages.filter(stage => stage === 'enqueue').length, 1);

// 4. Una corrida = a lo sumo un job y a lo sumo una llamada al proveedor.
assert.equal(stages.filter(stage => stage === 'claim').length, 1);
assert.equal(stages.filter(stage => stage === 'agt').length, 1);

// 5. Cola vacía: se detiene sin llamar al proveedor.
const idle = createAgt002RadarPipeline({
  database: {}, environment: { AGT002_RADAR_GATE: 'true' }, now: () => NOW,
  fetchTenderPage: async () => [], evaluateGate: hostile, recordGateEvaluation: hostile,
  enqueueJob: hostile, claimJob: async () => null, completeJob: hostile, failJob: hostile,
  projectLearningObservations: hostile, buildLearningSignals: hostile,
  runPreanalysis: hostile, recordPreanalysisRun: hostile, appendAttempt: async () => {},
});
assert.equal((await idle.runOnce()).status, 'empty');

// 6. Fallo del aprendizaje: el job se cierra y el proveedor NUNCA se llama.
const learningBroken = createAgt002RadarPipeline({
  database: {}, environment: { AGT002_RADAR_GATE: 'true' }, now: () => NOW,
  fetchTenderPage: async () => [TENDER],
  evaluateGate: () => ({ verdict: 'sobreviviente', rule_ids: [], reasons: [], data_gaps: [], tender_id: TENDER.id, source_row_hash: 'a'.repeat(64), policy_version: 'p', context_version: 'c' }),
  recordGateEvaluation: async () => ({ id: 'gate-1' }),
  enqueueJob: async () => ({ status: 'created', job_id: 'j1' }),
  claimJob: async () => ({ jobId: 'j1', leaseId: 'l1', tenderId: TENDER.id, gateEvaluationId: 'gate-1', attemptKey: 'a1' }),
  projectLearningObservations: async () => { const error = new Error('fuente caída'); error.runtime_boundary_code = 'AGT002_RADAR_LEARNING_SIGNALS_INVALID'; throw error; },
  buildLearningSignals: hostile,
  runPreanalysis: hostile,
  recordPreanalysisRun: hostile,
  appendAttempt: async () => {},
  completeJob: hostile,
  failJob: async (_db, { errorCode }) => { assert.equal(errorCode, 'invalid_output'); },
});
assert.deepEqual(await learningBroken.runOnce(), { status: 'unavailable', stages: ['fetch', 'gate', 'ledger', 'claim', 'learning'], job_id: 'j1', error_code: 'invalid_output' });

// 7. Fallo antes del claim: no se encola ni se llama al proveedor.
const ledgerBroken = createAgt002RadarPipeline({
  database: {}, environment: { AGT002_RADAR_GATE: 'true' }, now: () => NOW,
  fetchTenderPage: async () => [TENDER],
  evaluateGate: () => ({ verdict: 'sobreviviente', rule_ids: [], reasons: [], data_gaps: [], tender_id: TENDER.id, source_row_hash: 'a'.repeat(64), policy_version: 'p', context_version: 'c' }),
  recordGateEvaluation: async () => { throw new Error('ledger caído'); },
  enqueueJob: hostile, claimJob: hostile, completeJob: hostile, failJob: hostile,
  projectLearningObservations: hostile, buildLearningSignals: hostile,
  runPreanalysis: hostile, recordPreanalysisRun: hostile, appendAttempt: async () => {},
});
assert.equal((await ledgerBroken.runOnce()).status, 'unavailable');

// 8. El pipeline no lee reloj propio: un solo nowIso por corrida, inyectado.
const source = (await import('node:fs')).readFileSync(new URL('../agt002-radar-pipeline.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /Date\.now\(\)|new Date\(\)/);
```

En `tests/agt002-radar-pipeline-systemd.test.mjs`, espejo de `tests/agt002-reanalysis-worker-systemd.test.mjs` **[EXISTE]** sobre `ops/agt002-radar-pipeline/`:

```js
// 1. Existen los cinco archivos: runner, .service, .timer, env.example, README.md.
// 2. El runner llama createAgt002RadarPipeline y una sola runOnce().
assert.doesNotMatch(runner, /setInterval|setTimeout|while \(|for \(;;\)|fetch\(|https?:\/\//);
// 3. El runner exige SUPABASE_SERVICE_ROLE_KEY y sale 1 si falta configuración.
// 4. .service: Type=oneshot, EnvironmentFile=, NoNewPrivileges=true, PrivateTmp=true,
//    ProtectSystem=strict|full, RestrictAddressFamilies con AF_UNIX/AF_NETLINK/AF_INET/AF_INET6.
// 5. .timer: OnUnitActiveSec=, Persistent=false, RandomizedDelaySec distinto de 0.
// 6. env.example declara AGT002_RADAR_GATE=false explícitamente.
assert.match(env, /^AGT002_RADAR_GATE=false$/m);
// 7. Nada del directorio ejecuta systemctl ni acepta banderas de escritura.
for (const file of files) {
  assert.equal(read(file).includes('systemctl '), false);
  assert.equal(read(file).includes('--apply'), false);
}
// 8. El README declara que habilitar el timer es una autorización separada.
assert.match(read('README.md'), /autorizaci[oó]n separada/i);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agt002-radar-pipeline.test.mjs tests/agt002-radar-pipeline-systemd.test.mjs`
Expected: FAIL porque `agt002-radar-pipeline.js` y el directorio `ops/agt002-radar-pipeline/` no existen.

- [ ] **Step 3: Write minimal implementation**

`agt002-radar-pipeline.js` implementa el §8.9: guardia de flag con `buildAgt002AnalysisConfig` (o la lectura equivalente hasta que la Task 9 añada el flag; si el flag aún no existe en `ANALYSIS_FLAG_NAMES`, la guardia usa la misma semántica `'true'`/`'1'` y la Task 9 la sustituye por la configuración canónica), captura de un solo `nowIso` vía `now()`, y las siete etapas en orden, con todas las dependencias inyectadas y valores por defecto que apuntan a los módulos reales de las tareas 2–7. Tras el claim carga la fila exacta del job, deriva su candidato normalizado, proyecta observaciones una vez y llama el retrieval con `{ candidate, observations, maxSignals }`; si no hay comparables pasa `learningSignals = null`, nunca un agregado global.

`ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs` copia la estructura de `ops/agt002-reanalysis-worker/run-agt002-reanalysis-worker.mjs` **[EXISTE]**: valida configuración, construye el cliente `@supabase/supabase-js`, ejecuta una `runOnce()`, imprime `{ event: 'agt002_radar_pipeline_finished', ...result }` y sale 0; ante fallo imprime `{ event: 'agt002_radar_pipeline_failed', code: 'PIPELINE_FAILURE' }` y sale 1. Las unidades `systemd` se copian de las del worker de reanálisis, cambiando nombre y `ExecStart`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agt002-radar-pipeline.test.mjs tests/agt002-radar-pipeline-systemd.test.mjs`
Expected: PASS, incluidos el no-op verificable con flag apagado, el orden `fetch → gate → ledger → claim → aprendizaje → AGT → persistencia`, el corte antes del proveedor cuando falla el aprendizaje y la ausencia de reloj propio.

- [ ] **Step 5: Confirmar que no se habilitó nada**

Run: `grep -rn "systemctl" ops/agt002-radar-pipeline/ | wc -l`
Expected: `0`. El directorio describe cómo instalar en su `README.md` en prosa, pero ningún archivo ejecuta la instalación.

- [ ] **Step 6: Commit**

```bash
git add agt002-radar-pipeline.js ops/agt002-radar-pipeline tests/agt002-radar-pipeline.test.mjs tests/agt002-radar-pipeline-systemd.test.mjs
git commit -m "feat(radar): add off-by-default AGT-002 radar pipeline entrypoint end to end"
```

---

### Task 9: Flags de rollout y filtro de visibilidad en la lectura

**Files:**
- Modify: `agt002-analysis-config.js`
- Create: `agt002-radar-visibility.js`
- Modify: `server/index.js`
- Modify: `api/[...path].js`
- Test: `tests/agt002-radar-rollout-flags.test.mjs`
- Test: `tests/agt002-radar-visibility.test.mjs`
- Test: `tests/agt002-radar-visibility-backend.test.mjs`

**Interfaces:**
- `ANALYSIS_FLAG_NAMES` incorpora `AGT002_RADAR_GATE` y `AGT002_RADAR_VISIBILITY`; `AGT002_RADAR_GATE` es también la guardia del entrypoint de la Task 8, que pasa a leerla desde `buildAgt002AnalysisConfig`.
- Produce `filterRadarRowsByCanonicalPreanalysis(rows, { canonicalByTenderId, alwaysVisibleTenderIds, computeSourceRowHash, policyVersion, contextVersion, enabled })`.
- `readPersistedTenderRadar` aplica el filtro sobre las filas de base de datos, antes de `dbTenderToPublic`.

- [ ] **Step 1: Write the failing test**

En `tests/agt002-radar-rollout-flags.test.mjs`:

```js
import { strict as assert } from 'node:assert';
import { ANALYSIS_FLAG_NAMES, buildAgt002AnalysisConfig } from '../agt002-analysis-config.js';

assert.ok(ANALYSIS_FLAG_NAMES.includes('AGT002_RADAR_GATE'));
assert.ok(ANALYSIS_FLAG_NAMES.includes('AGT002_RADAR_VISIBILITY'));

// Apagados por defecto y sólo 'true'/'1' encienden.
assert.equal(buildAgt002AnalysisConfig({}).AGT002_RADAR_GATE, false);
assert.equal(buildAgt002AnalysisConfig({}).AGT002_RADAR_VISIBILITY, false);
assert.equal(buildAgt002AnalysisConfig({ AGT002_RADAR_GATE: 'TRUE' }).AGT002_RADAR_GATE, true);
assert.equal(buildAgt002AnalysisConfig({ AGT002_RADAR_GATE: ' 1 ' }).AGT002_RADAR_GATE, true);
for (const value of ['yes', 'on', '2', '', 'false', 'null']) {
  assert.equal(buildAgt002AnalysisConfig({ AGT002_RADAR_GATE: value }).AGT002_RADAR_GATE, false);
}

// Dependencia fail-closed.
assert.throws(() => buildAgt002AnalysisConfig({ AGT002_RADAR_VISIBILITY: 'true' }), /AGT002_RADAR_VISIBILITY requires AGT002_RADAR_GATE/);
assert.equal(buildAgt002AnalysisConfig({ AGT002_RADAR_GATE: 'true', AGT002_RADAR_VISIBILITY: 'true' }).AGT002_RADAR_VISIBILITY, true);

// Los flags preexistentes no cambian.
assert.equal(buildAgt002AnalysisConfig({ AGT002_RADAR_GATE: 'true' }).AGT002_CONTEXT_V2, false);
assert.throws(() => buildAgt002AnalysisConfig({ AGT002_DOCUMENT_RETRIEVAL: 'true' }), /AGT002_CONTEXT_V2/);
```

En `tests/agt002-radar-visibility.test.mjs`:

```js
import { strict as assert } from 'node:assert';
import { filterRadarRowsByCanonicalPreanalysis } from '../agt002-radar-visibility.js';

// El módulo NO interpreta internal_status ni converted_opportunity_id: recibe un Set de
// identificadores que el backend ya decidió con isConvertedTenderRecord (spec §8.7).
const nueva = { id: 't1', stable_key: 'k1', status: 'abierto' };
const convertida = { id: 't2', stable_key: 'k2', status: 'cerrado' };
const preanalizada = { id: 't3', stable_key: 'k3', status: 'abierto' };
const stale = { id: 't4', stable_key: 'k4', status: 'actualizado' };
const rows = [nueva, convertida, preanalizada, stale];
const alwaysVisibleTenderIds = new Set(['t2']);
const HASH = row => `hash:${row.stable_key}:${row.status}`;
const policyVersion = 'policy-v1';
const contextVersion = 'context-v1';
const canonicalByTenderId = new Map([
  ['t1', { visibility_verdict: 'no_concluyente', source_row_hash: HASH(nueva), policy_version: policyVersion, context_version: contextVersion }],
  ['t3', { visibility_verdict: 'mostrar_en_radar', source_row_hash: HASH(preanalizada), policy_version: policyVersion, context_version: contextVersion }],
  ['t4', { visibility_verdict: 'mostrar_en_radar', source_row_hash: 'hash:anterior', policy_version: policyVersion, context_version: contextVersion }],
]);
const options = { canonicalByTenderId, alwaysVisibleTenderIds, computeSourceRowHash: HASH, policyVersion, contextVersion };

// Flag OFF: identidad de referencia, Radar idéntico.
assert.equal(filterRadarRowsByCanonicalPreanalysis(rows, { ...options, enabled: false }), rows);
assert.equal(filterRadarRowsByCanonicalPreanalysis(rows, { canonicalByTenderId: new Map(), alwaysVisibleTenderIds: new Set(), enabled: false }), rows);

// Flag ON: convertidas siempre; no convertidas sólo con canónica positiva y fresca.
assert.deepEqual(filterRadarRowsByCanonicalPreanalysis(rows, { ...options, enabled: true }).map(row => row.id), ['t2', 't3']);
assert.deepEqual(filterRadarRowsByCanonicalPreanalysis(rows, { ...options, canonicalByTenderId: new Map(), enabled: true }).map(row => row.id), ['t2']);
for (const override of [
  { source_row_hash: 'stale' },
  { policy_version: 'policy-v0' },
  { context_version: 'context-v0' },
]) {
  const staleMap = new Map([['t3', { ...canonicalByTenderId.get('t3'), ...override }]]);
  assert.deepEqual(filterRadarRowsByCanonicalPreanalysis([preanalizada], { ...options, canonicalByTenderId: staleMap, alwaysVisibleTenderIds: new Set(), enabled: true }), []);
}

// El filtro no altera las filas.
assert.equal(filterRadarRowsByCanonicalPreanalysis(rows, { ...options, enabled: true })[1], preanalizada);
assert.throws(() => filterRadarRowsByCanonicalPreanalysis(rows, { ...options, canonicalByTenderId: null, enabled: true }), /AGT002_RADAR_VISIBILITY_LEDGER_UNAVAILABLE/);
assert.throws(() => filterRadarRowsByCanonicalPreanalysis(rows, { ...options, alwaysVisibleTenderIds: null, enabled: true }), /AGT002_RADAR_VISIBILITY_LEDGER_UNAVAILABLE/);

// El módulo no puede nombrar el vocabulario de conversión (I-2).
const visibilitySource = (await import('node:fs')).readFileSync(new URL('../agt002-radar-visibility.js', import.meta.url), 'utf8');
for (const forbidden of ['internal_status', 'converted_opportunity_id']) {
  assert.equal(visibilitySource.includes(forbidden), false);
}
```

En `tests/agt002-radar-visibility-backend.test.mjs`: levantar un Supabase falso (mismo patrón que `tests/tender-radar-converted-visible.test.mjs`) que sirva `psi_public_tenders`, `psi_tender_radar_runs` y `psi_agt002_radar_preanalysis_runs`, y comprobar contra **ambos** entrypoints (`../server/index.js` y `../api/[...path].js`):

```js
// 1. Sin flags: el payload es idéntico con y sin ledger poblado.
// 2. Sin flags: el backend NO consulta psi_agt002_radar_preanalysis_runs.
// 3. Con AGT002_RADAR_GATE=true y AGT002_RADAR_VISIBILITY sin definir: payload idéntico al de (1).
// 4. Con ambos flags: sólo convertidas + no convertidas con canonical 'mostrar_en_radar' cuyo source_row_hash/policy/context coinciden con la fila y versiones vigentes.
// 5. Con ambos flags y una convertida sin ningún preanálisis: sigue presente.
// 6. Con ambos flags y el ledger devolviendo error: HTTP 503 con AGT002_RADAR_VISIBILITY_LEDGER_UNAVAILABLE.
// 7. Hash stale, policy stale o context stale ocultan aunque el veredicto canónico diga mostrar.
// 8. Abstención/no_concluyente o no_mostrar posteriores sustituyen una positiva anterior.
// 9. Las claves de cada tender del payload son exactamente las de dbTenderToPublic hoy.
// 10. persistTenderRadar no menciona el gate ni el ledger.
assert.doesNotMatch(serverSource.slice(serverSource.indexOf('async function persistTenderRadar')), /radar_preanalysis|evaluateAgt002RadarGate/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agt002-radar-rollout-flags.test.mjs tests/agt002-radar-visibility.test.mjs tests/agt002-radar-visibility-backend.test.mjs`
Expected: FAIL: los flags no existen, `agt002-radar-visibility.js` no existe y el backend no consulta el ledger.

- [ ] **Step 3: Write minimal implementation**

En `agt002-analysis-config.js`, añadir los dos nombres a `ANALYSIS_FLAG_NAMES` y la dependencia que lanza:

```js
if (flags.AGT002_RADAR_VISIBILITY && !flags.AGT002_RADAR_GATE) {
  throw new Error('agt002-analysis-config: AGT002_RADAR_VISIBILITY requires AGT002_RADAR_GATE to be enabled.');
}
```

Crear `agt002-radar-visibility.js` con la semántica del spec §8.7: `enabled === false` devuelve la referencia original **sin evaluar ningún parámetro adicional**; con `enabled === true`, sólo conserva convertidas o corridas `mostrar_en_radar` cuyo `source_row_hash`, `policy_version` y `context_version` coincidan con la fila y versiones vigentes. `computeSourceRowHash` es la misma `computeAgt002RadarSourceRowHash` inyectada, nunca una reimplementación. Dependencias ausentes/malformadas lanzan con `runtime_boundary_code = 'AGT002_RADAR_VISIBILITY_LEDGER_UNAVAILABLE'`.

En `readPersistedTenderRadar`, tras construir `mergedRows` y **antes** de `.map(dbTenderToPublic)`, leer todas las canónicas de los ids de la página con `where canonical` (sin `status='completed'`) sólo si el flag está activo, construir `alwaysVisibleTenderIds` con el `isConvertedTenderRecord` que ya vive en el backend, mapear el error de lectura a `AGT002_RADAR_VISIBILITY_LEDGER_UNAVAILABLE` (503) y aplicar el filtro con hash/policy/context vigentes. Con el flag apagado no se emite ninguna consulta adicional. Copiar `server/index.js` a `api/[...path].js`.

Sustituir además la guardia provisional del pipeline (Task 8, Step 3) por `buildAgt002AnalysisConfig`, de modo que exista **una sola** definición de qué significa que el flag esté encendido; volver a ejecutar `node --test tests/agt002-radar-pipeline.test.mjs` tras el cambio.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agt002-radar-rollout-flags.test.mjs tests/agt002-radar-visibility.test.mjs tests/agt002-radar-visibility-backend.test.mjs tests/agt002-radar-pipeline.test.mjs && node --test tests/tender-radar-converted-visible.test.mjs tests/tender-radar-relevance.test.mjs tests/tender-radar-backend-dedup.test.mjs tests/tender-saved-searches-radar.test.mjs && npm run check:backend-parity`
Expected: PASS en todas y `backend parity OK`.

- [ ] **Step 5: Commit**

```bash
git add agt002-analysis-config.js agt002-radar-visibility.js agt002-radar-pipeline.js server/index.js "api/[...path].js" tests/agt002-radar-rollout-flags.test.mjs tests/agt002-radar-visibility.test.mjs tests/agt002-radar-visibility-backend.test.mjs
git commit -m "feat(radar): add fail-closed rollout flags and canonical preanalysis visibility filter"
```

---

### Task 10: Suite de invariantes de autoridad

**Files:**
- Test: `tests/agt002-radar-no-conversion-authority.test.mjs`
- Modify: sólo si una prueba expone un defecto real en los módulos de las tareas 2–9.

**Interfaces:**
- Verifica de forma transversal I-1 a I-5, I-13, I-14, I-15 y I-23 del spec.

- [ ] **Step 1: Write the failing test**

```js
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

// Grupo A — camino de decisión de visibilidad: no puede ni nombrar el vocabulario de
// conversión ni el de GO/NO-GO, porque nada de eso es asunto suyo.
const DECISION_PATH_FILES = [
  'agt002-radar-gate.js', 'agt002-radar-visibility.js',
  'agt002-radar-preanalysis-contract.js', 'agt002-radar-preanalysis-input.js',
  'agt002-radar-preanalysis-runtime.js', 'agt002-radar-preanalysis-persistence.js',
  'agt002-radar-preanalysis-jobs.js', 'agt002-radar-preanalysis-worker.js',
  'agt002-radar-pipeline.js',
  'ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs',
  'supabase/migrations/071_agt002_radar_gate.sql',
  'supabase/migrations/072_agt002_radar_preanalysis_ledger.sql',
  'scripts/agt002-radar-gate-historical-audit.mjs',
  'scripts/agt002-radar-preanalysis-dryrun.mjs',
];
// Grupo B — camino de aprendizaje: SÍ lee decisiones GO/NO-GO humanas históricas y
// estados de oferta, porque el contexto aprobado lo exige. Lo que no puede es convertir,
// escribir sobre la licitación ni emitir una decisión propia.
const LEARNING_FILES = [
  'agt002-radar-learning-projection.js',
  'agt002-radar-learning-retrieval.js', 'agt002-radar-learning-proposals.js',
  'scripts/agt002-radar-learning-signals-report.mjs',
];
const CONVERSION_FORBIDDEN = [
  'psi_sales_opportunities', 'psi_convert_tender_to_opportunity', 'tender-convert',
  'converted_opportunity_id', 'internal_status',
];
const DECISION_FORBIDDEN = ['psi_tender_go_no_go_decisions', 'go_no_go', "'go'", "'no_go'"];

for (const file of [...DECISION_PATH_FILES, ...LEARNING_FILES]) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  for (const forbidden of CONVERSION_FORBIDDEN) {
    if (LEARNING_FILES.includes(file) && ['psi_sales_opportunities', 'converted_opportunity_id', 'internal_status'].includes(forbidden)) continue;
    assert.equal(source.includes(forbidden), false, `${file} no debe referenciar ${forbidden}`);
  }
  assert.equal(/\.(insert|update|upsert|delete)\(/.test(source), false, `${file} no debe escribir en base de datos`);
  assert.equal(/method:\s*'(POST|PATCH|PUT|DELETE)'/.test(source), false, `${file} debe ser de sólo lectura`);
}

for (const file of DECISION_PATH_FILES) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  for (const forbidden of DECISION_FORBIDDEN) {
    assert.equal(source.includes(forbidden), false, `${file} no debe referenciar ${forbidden}`);
  }
}

// El aprendizaje lee decisiones humanas, pero nunca produce una.
for (const file of LEARNING_FILES) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.equal(source.includes('--apply'), false, `${file} no debe aceptar bandera de escritura`);
  assert.equal(/psi_record_agt002_radar|psi_append_agt002_radar/.test(source), false, `${file} no debe persistir`);
  assert.equal(/decision:\s*['"](go|no_go)['"]\s*[,}]/.test(source.replace(/decision === ['"](go|no_go)['"]/g, '')), false, `${file} no debe emitir una decisión`);
}

// I-23: el aprendizaje entra sólo por la entrada del preanálisis. Ni el gate ni el filtro
// de visibilidad lo conocen, así que ninguna señal puede llegar a eliminar u ocultar.
for (const file of ['agt002-radar-gate.js', 'agt002-radar-visibility.js']) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.equal(/learning/i.test(source), false, `${file} no debe conocer el aprendizaje`);
}
assert.match(readFileSync(new URL('../agt002-radar-preanalysis-input.js', import.meta.url), 'utf8'), /learningSignals/);

// El entrypoint no se enciende ni enciende nada por su cuenta.
const runner = readFileSync(new URL('../ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs', import.meta.url), 'utf8');
assert.equal(runner.includes('systemctl'), false, 'el runner no instala ni habilita unidades');
assert.equal(/AGT002_RADAR_(GATE|VISIBILITY)\s*=\s*['"]?(true|1)/.test(runner), false, 'el runner no fija los flags');

// Sin cambios visuales.
for (const file of [...DECISION_PATH_FILES, ...LEARNING_FILES]) {
  assert.equal(file.startsWith('src/'), false, 'ningún archivo del alcance vive bajo src/');
}
```

**Nota de implementación de la prueba:** la separación en dos grupos es deliberada y refleja el contexto aprobado. El camino que decide visibilidad no puede siquiera nombrar GO/NO-GO, y ahora incluye la cadena completa: el pipeline y el entrypoint orquestan, pero no ganan autoridad por orquestar. El camino de aprendizaje sí debe leer `decision === 'go' | 'no_go'` y los estados `presentada`/`adjudicada`/`no_adjudicada`, porque son precisamente las fuentes de señal exigidas; lo que se le prohíbe mecánicamente es escribir, persistir o emitir una decisión propia. `agt002-radar-learning-retrieval.js` recibe observaciones ya proyectadas y por eso no nombra tablas; la proyección de sólo lectura desde `psi_public_tenders`, `psi_tender_analysis_runs`, `psi_tender_go_no_go_decisions` y `psi_sales_opportunities` vive en `agt002-radar-learning-projection.js` (Task 7), que es la pieza que consumen tanto la cadena (Task 8) como el informe (Task 11).

`agt002-radar-pipeline.js` está en el grupo A, de modo que su etapa `fetch` **no puede nombrar `internal_status` ni `converted_opportunity_id`**: lee `psi_public_tenders` con `select('*')` o con una lista explícita que no incluya esas columnas, y quien decide qué es "convertida" sigue siendo `readPersistedTenderRadar` en el backend (Task 9).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agt002-radar-no-conversion-authority.test.mjs`
Expected: FAIL porque los tres scripts de la Task 11 aún no existen.

- [ ] **Step 3: Write minimal implementation**

No se implementa producción en este paso: la prueba queda escrita y en RED hasta que la Task 11 cree los tres scripts. Si al ejecutarla contra los módulos de las tareas 2–9 aparece cualquier violación distinta de "archivo inexistente", corregir ese módulo con el cambio mínimo y volver a ejecutar la suite focal de la tarea correspondiente.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agt002-radar-gate.test.mjs tests/agt002-radar-preanalysis-contract.test.mjs tests/agt002-radar-visibility.test.mjs tests/agt002-radar-pipeline.test.mjs tests/agt002-radar-learning-retrieval.test.mjs`
Expected: PASS. La prueba de autoridad completa se cierra en verde al final de la Task 11, Step 4.

- [ ] **Step 5: Commit**

```bash
git add tests/agt002-radar-no-conversion-authority.test.mjs
git commit -m "test(radar): add cross-cutting AGT-002 conversion-authority invariants"
```

---

### Task 11: Auditoría histórica, corridas read-only y verificación completa

**Files:**
- Create: `scripts/agt002-radar-gate-historical-audit.mjs`
- Create: `scripts/agt002-radar-preanalysis-dryrun.mjs`
- Create: `scripts/agt002-radar-learning-signals-report.mjs`
- Test: `tests/agt002-radar-historical-audit.test.mjs`

**Interfaces:**
- Produce `planAgt002RadarGateAudit({ tenders, nowIso, canonicalPreanalysisByTenderId, policyVersion, contextVersion })` con `total`, `sobrevivientes`, `eliminadas_por_regla`, `data_gaps_por_tipo`, `muestras`, `convertidas_eliminadas_por_gate`, desglose de canónicas frescas/stale por causa y `uncovered_visible_tenders`.
- Los tres scripts exigen `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`, usan sólo `GET` y no aceptan ninguna bandera de escritura.

- [ ] **Step 1: Write the failing test**

```js
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { planAgt002RadarGateAudit } from '../scripts/agt002-radar-gate-historical-audit.mjs';

const NOW = '2026-08-25T15:00:00.000Z';
const tenders = [
  { id: 't1', stable_key: 'k1', internal_status: 'nueva', status: 'abierto', title: 'Servicio de vigilancia armada', deadline_at: '2026-12-31T23:59:59.000Z', raw: { modalidad_de_contratacion: 'Licitación pública' } },
  { id: 't2', stable_key: 'k2', internal_status: 'nueva', status: 'Cancelado', title: 'Vigilancia armada', deadline_at: '2026-12-31T23:59:59.000Z', raw: {} },
  { id: 't3', stable_key: 'k3', internal_status: 'nueva', status: 'abierto', title: 'Vigilancia armada', deadline_at: null, raw: {} },
  { id: 't4', stable_key: 'k4', internal_status: 'convertida_oportunidad', converted_opportunity_id: 'o1', status: 'Cancelado', title: 'Vigilancia armada', deadline_at: '2025-01-01T00:00:00.000Z', raw: {} },
];

const plan = planAgt002RadarGateAudit({ tenders, nowIso: NOW, canonicalPreanalysisByTenderId: new Map() });
assert.equal(plan.total, 4);
assert.equal(plan.sobrevivientes, 1);
assert.equal(plan.eliminadas_por_regla.estado_terminal, 2);
assert.equal(plan.eliminadas_por_regla.fecha_no_verificable, 1);
assert.equal(plan.data_gaps_por_tipo.modalidad_no_reportada, 3);

// Las convertidas se contabilizan pero nunca se proponen para ocultar.
assert.equal(plan.convertidas_eliminadas_por_gate, 1);
assert.equal(plan.ocultables.includes('t4'), false);

// Cobertura: t1 sobrevive y no tiene preanálisis canónico ⇒ bloquea el encendido del flag.
assert.deepEqual(plan.uncovered_visible_tenders, ['t1']);
assert.equal(plan.ready_for_visibility_flag, false);

const covered = planAgt002RadarGateAudit({ tenders, nowIso: NOW, canonicalPreanalysisByTenderId: new Map([['t1', { visibility_verdict: 'mostrar_en_radar' }]]) });
assert.deepEqual(covered.uncovered_visible_tenders, []);
assert.equal(covered.ready_for_visibility_flag, true);

// Cada muestra es verificable.
for (const sample of plan.muestras) {
  assert.ok(sample.tender_id && sample.rule_id && sample.field && String(sample.observed_value).length > 0);
}

// Los tres scripts son de sólo lectura.
for (const name of ['agt002-radar-gate-historical-audit', 'agt002-radar-preanalysis-dryrun', 'agt002-radar-learning-signals-report']) {
  const source = readFileSync(new URL(`../scripts/${name}.mjs`, import.meta.url), 'utf8');
  assert.equal(/method:\s*'(POST|PATCH|PUT|DELETE)'/.test(source), false, `${name} no debe escribir`);
  assert.equal(source.includes('--apply'), false, `${name} no debe aceptar --apply`);
  assert.equal(/psi_record_agt002_radar|psi_append_agt002_radar/.test(source), false, `${name} no debe llamar RPC de persistencia`);
  assert.equal(/psi_(enqueue|claim|complete|fail)_agt002_radar/.test(source), false, `${name} no debe tocar la cola`);
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agt002-radar-historical-audit.test.mjs`
Expected: FAIL porque los tres scripts no existen.

- [ ] **Step 3: Write minimal implementation**

Crear los tres scripts siguiendo el patrón de `scripts/aerocivil-backfill-dryrun.mjs`: `loadEnvFile`, lectura por `GET /rest/v1/...` con la service key, función pura exportada y `main()` que imprime JSON y ajusta `process.exitCode`. El de auditoría exporta `planAgt002RadarGateAudit`, pagina `psi_public_tenders` y `psi_agt002_radar_preanalysis_runs` (todas las canónicas, sin filtrar estado), recalcula el hash de cada fila y desglosa ausencia, hash stale, policy stale, context stale, `no_mostrar_en_radar` y `no_concluyente`; sólo declara `ready_for_visibility_flag` cuando no hay sobrevivientes sin canónica **fresca**. El dry-run construye la entrada, llama al proveedor y valida el sobre sin persistir. El informe de aprendizaje **reutiliza `agt002-radar-learning-projection.js`** y, para cada candidato acotado seleccionado, llama `buildAgt002RadarLearningSignals({ candidate, observations, maxSignals })`; los agregados globales se envían únicamente a `buildAgt002RadarLearningProposals({ observations, generatedAt })`, nunca al preanálisis.

Ninguno de los tres encola, reclama, completa ni falla un job: la cola sólo la toca la cadena de la Task 8. Ese es el criterio que separa "informe" de "ejecución".

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agt002-radar-historical-audit.test.mjs tests/agt002-radar-no-conversion-authority.test.mjs`
Expected: PASS en ambas, incluida la suite de autoridad de la Task 10 que ahora encuentra los tres scripts.

- [ ] **Step 5: Suite focal completa del alcance**

Run: `node --test tests/agt002-radar-*.test.mjs tests/tender-radar-*.test.mjs`
Expected: PASS, sin fallos.

- [ ] **Step 6: Suite completa y gates técnicos**

Run: `node --test --test-force-exit tests/*.test.mjs && npm run check:backend-parity && npx tsc --noEmit && npm run build && git diff --check`
Expected: PASS y exit 0. Comparar el total contra el registrado en Task 0, Step 2; cualquier fallo preexistente debe reportarse textualmente y sin repararse aquí.

- [ ] **Step 7: Verificar que no hubo cambios visuales**

Run: `git diff --name-only $(git merge-base HEAD @{u} 2>/dev/null || echo HEAD~10) HEAD -- src/ | wc -l`
Expected: `0`. Si imprime cualquier otro número, revertir los archivos de `src/` antes de continuar.

- [ ] **Step 7b: Verificar que la cadena quedó apagada**

Run: `ls /etc/systemd/system 2>/dev/null | grep -c agt002-radar-pipeline; grep -rn "AGT002_RADAR_GATE" ops/agt002-radar-pipeline/env.example`
Expected: `0` unidades instaladas y `AGT002_RADAR_GATE=false` en el ejemplo de entorno. No ejecutar `systemctl` para comprobarlo.

- [ ] **Step 8: Commit**

```bash
git add scripts/agt002-radar-gate-historical-audit.mjs scripts/agt002-radar-preanalysis-dryrun.mjs scripts/agt002-radar-learning-signals-report.mjs tests/agt002-radar-historical-audit.test.mjs
git commit -m "feat(radar): add read-only AGT-002 radar gate audit, preanalysis dry-run and learning report"
```

- [ ] **Step 9: Registrar el estado y detener**

Escribir en `CURRENT.md` una sección nueva con: conteos reales de la suite completa antes y después, salida real de la auditoría histórica y dry-run read-only si las credenciales locales estuvieron disponibles, estado de ambos flags (OFF), migraciones `071`/`072` creadas en Git pero **no aplicadas a ninguna base real ni a producción**, entrypoint `ops/agt002-radar-pipeline/` creado pero **no instalado ni habilitado** (`systemctl` nunca ejecutado), cola durable definida sólo como esquema local (sin tabla real creada ni jobs persistidos), y la declaración explícita de que no hubo push, PR, merge, migración productiva ni deploy.

```bash
git add CURRENT.md && git commit -m "docs(radar): record AGT-002 radar gate and learning local verification state"
```

**Detener aquí.** Aplicar `071`/`072` a producción, instalar o habilitar la unidad `systemd` del entrypoint, ejecutar la cadena con el flag encendido, drenar la cola o encender `AGT002_RADAR_GATE` / `AGT002_RADAR_VISIBILITY` requiere una autorización separada y explícita, precedida por reconfirmar cuál es el commit realmente desplegado —no se asume `origin/main`— y por leer el informe de auditoría con `uncovered_visible_tenders = 0`. Son cuatro autorizaciones distintas (migrar, instalar, encender el flag, habilitar el temporizador), no una sola.
