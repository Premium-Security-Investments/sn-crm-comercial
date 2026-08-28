# AGT-002 Radar — Daily Scan + 15-min Queue Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Enmienda de revisión de arquitectura — 2026-08-28.** Este plan fue revisado tras su primera redacción y **ocho decisiones cambiaron**; el spec asociado lleva la misma enmienda. Resumen de lo que ya no se hace como decía la versión anterior:
> 1. El wrapper diario invoca **`systemctl start agt002-radar-scan.service` y `systemctl start agt002-radar-pipeline.service`**, no `node .../run-*.mjs`. Se revierte A6 del spec (§5, A6′).
> 2. **`agt002-radar-pipeline.js` y `tests/agt002-radar-pipeline.test.mjs` NO se borran** (Task 2). Lo que cambia en producción es el `import` del runner del timer, probado con aserciones estáticas.
> 3. Se añade la **Task 2b**: extender los invariantes transversales (`no-conversion-authority`, holgura lease/timeout, ESU) al código nuevo. Sin ella, el código que corre en producción queda fuera de garantías que hoy sí cubren al módulo combinado.
> 4. **El horario del cron no cambia** (Task 8). Sigue en días laborables 13:00 UTC = 08:00 Colombia. Se retira el `0 8 * * 1-5` de la versión anterior.
> 5. El wrapper usa **arrays de Bash**, **códigos de salida por etapa** (0/10/20) y **reporta el kick explícitamente**; nada de `|| true`.
> 6. El **runner del scan sale distinto de 0** ante `status:'unavailable'`; el del worker **no cambia** sus códigos de salida.
> 7. El **reloj se valida antes de reclamar** y el **dominio de `error_code` queda congelado** (no se toca `classifyAgt002RadarPreanalysisError`).
> 8. **Autorización de implementación concedida — 2026-08-28.** El usuario aprobó implementación a través de PR/despliegue. Las restricciones "sin commit/push salvo autorización adicional" y "Task 8 requiere autorización operativa separada" quedaban de la primera redacción y ya no aplican tal cual; se retiran las trabas de commit/PR/merge, y Task 8 (§ abajo) fija el orden exacto de rollout: merge/despliegue de código → backup de unidades y crontab vivos → instalar unidad/env del scan → actualizar runner/unidad del timer → `daemon-reload` → QA manual del wrapper → observar un ciclo del `.timer` con la cola ya vacía → sólo entonces cambiar el comando/prompt del cron de Hermes. El cron viejo se preserva hasta que la QA pase.

> **Estado de implementación — 2026-08-28 (Fase 3, verificado con shell).** Tasks 1, 2 y 2b (módulos
> `agt002-radar-scan.js`/`agt002-radar-worker.js` y extensión de invariantes transversales) estaban
> completas al iniciar esta fase. Esta fase completó Tasks 3 (`ops/agt002-radar-scan/`), 4 (repurpose
> del runner del timer) y 5 (wrapper diario), con sus pruebas escritas primero, y ejecutó la
> verificación completa (Task 7) con shell disponible. Evidencia real del parent-run:
> - `npm ci --ignore-scripts`: exit 0, 0 vulnerabilidades.
> - Línea base de la suite completa, antes de los cambios de esta fase: 1046 tests, 1045 pass, 0 fail, 1 skip.
> - Suite focal AGT-002/ops final (Task 7 Step 1): 27 tests, 27 pass, 0 fail.
> - Suite completa final (Task 7 Step 2): 1051 tests, 1050 pass, 0 fail, 1 skip, ~250.8 s de duración.
> - `npm run check:backend-parity`: backend parity OK.
> - `npx tsc --noEmit`: exit 0.
> - `npm run build`: exit 0; deployment-safety passed; build de Vite passed (sólo el warning preexistente de chunk >500 kB).
> - `git diff --check`: exit 0.
> - Revisión crítica independiente (Task 7 Step 6): sin hallazgos Critical ni fuga de lease. Se
>   encontró un hallazgo real de robustez (severidad alta): el encolado trataba genéricamente
>   cualquier fallo de `enqueueJob` como rechazo por fila, enmascarando outages de infraestructura
>   como si fueran conflictos de fila individual. Se corrigió para que **sólo** el conflicto exacto
>   de job activo (`SQLSTATE 55000`) se tolere como rechazo por fila; cualquier fallo desconocido o
>   de infraestructura ahora hace fallar el scan en vez de contarse como `rejected`. Se añadieron
>   pruebas de regresión para ambos caminos y toda la suite focal/completa pasa en verde tras el fix.
>
> Con esa evidencia, Tasks 1-7 (código, pruebas y documentación operacional descrita en Task 6 Step 1)
> quedan marcadas como completas abajo. `CURRENT.md` §15 (Task 6 Step 2) sigue sin tocar — queda
> fuera del alcance de esta fase. Tasks 8 (despliegue) y 9 (rollback) **no se ejecutaron**: nada de
> esto se instaló, habilitó ni desplegó en producción, y el cron de Hermes sigue sin cambiar; quedan
> pendientes del rollout autorizado sobre el host de producción, en el orden fijo que la Task 8 define.

**Goal:** Dejar de ejecutar el proceso único `agt002-radar-pipeline.js` (`esu_refresh → fetch → gate → ledger → claim → learning → agt → persist` en cada tick de 15 min) y pasar a dos procesos con cadencia propia: una **exploración diaria** (`agt002-radar-scan.js`, sin `claim` ni modelo) disparada una vez al día justo después de que la exportación de fuente de Hermes persista con éxito, y un **worker de cola cada 15 min** (`agt002-radar-worker.js`, reclama primero y sale de inmediato si no hay trabajo) que nunca refresca ESU ni hace fetch de página completa. Sin flags nuevos, sin cambios de esquema, sin cambios de visibilidad, sin cambios de horario, sin tocar `src/`. **El módulo combinado se conserva en el árbol como artefacto de compatibilidad y rollback; lo que cambia es quién lo ejecuta: nadie.**

**Architecture:** Ver `docs/superpowers/specs/2026-08-28-agt002-daily-scan-queue-design.md` §6 y su enmienda. Resumen: `agt002-radar-scan.js` hereda íntegro el tramo `esu_refresh → fetch → gate → ledger → enqueue` del `agt002-radar-pipeline.js` actual (sin `claim` ni nada posterior). `agt002-radar-worker.js` valida el reloj, reclama primero, y sustituye el `fetch` de página completa por un `fetch_row` de una sola fila para la revalidación posterior al `claim`. `ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs` —el `ExecStart` del timer— pasa a importar el worker. Un wrapper de shell versionado (`ops/agt002-radar-scan/run-agt002-radar-daily-export.sh`) encadena exportación → `systemctl start` del scan → `systemctl start` del worker, fail-closed en los dos primeros pasos, con el tercero reportado explícitamente aunque no cambie el código de salida, porque el `.timer` durable de 15 min es la red de seguridad.

**Tech Stack:** Node.js ESM, `node:test`/`assert`, `node:child_process` (para el test dinámico del wrapper, con `systemctl` falso al frente del `PATH`), Bash para el wrapper, `systemd` (`Type=oneshot`, arranque síncrono), Supabase RPC ya existentes (`071`/`072`), puente Hetzner AGT-002 existente.

**Spec:** `docs/superpowers/specs/2026-08-28-agt002-daily-scan-queue-design.md`

## Global Constraints

- **Sin flag nuevo:** ambos procesos siguen leyendo `AGT002_RADAR_GATE` vía `buildAgt002AnalysisConfig`. No se añade ninguna entrada a `ANALYSIS_FLAG_NAMES`.
- **Sin cambio de esquema:** `071`/`072` no se tocan. Ninguna tarea crea una migración nueva.
- **Sin cambios visuales:** ningún archivo bajo `src/` se crea ni se modifica.
- **Paridad de backend:** `server/index.js`/`api/[...path].js` no se tocan en este plan (el Radar no cambia de lectura); `npm run check:backend-parity` debe seguir en verde por no-modificación, no por paridad nueva.
- **TDD estricto:** cada tarea de código escribe la prueba primero, la corre en RED, implementa lo mínimo, la corre en GREEN.
- **Sin instalar/habilitar nada durante las tareas de código:** ninguna tarea de las Tasks 1-7 ejecuta `systemctl`. Eso vive exclusivamente en Task 8, en el orden de rollout fijo que esa tarea define (ver punto siguiente).
- **[CORREGIDO] Implementación autorizada.** El usuario aprobó, el 2026-08-28, implementar este plan a través de PR/despliegue (retira la restricción previa "sin commit/push salvo autorización adicional"). Commits por tarea, apertura de PR y merge a `main` (Task 8, Step 1) están dentro de esta autorización. Lo que sigue gated por pasos operativos separados dentro de la propia Task 8 —y por su orden fijo— es tocar `/etc/psi-comercial/`, ejecutar `systemctl`, y editar el crontab de Hermes en el host de producción: esos actos siguen el orden de rollout fijado en Task 8 y el cron viejo se preserva hasta que la QA controlada pase.
- **Producción ≠ `origin/main`:** ninguna tarea de despliegue (Task 8) asume que el commit desplegado coincide con lo que se está mergeando.
- **Cobertura sin regresión:** cada aserción hoy presente en `tests/agt002-radar-pipeline.test.mjs` (flag apagado, orden de etapas, cola vacía, fallo de aprendizaje antes del proveedor, fallo de ledger antes de encolar, reintento con identidad de intento distinta, los cuatro `stale_input` por divergencia semántica, el `stale_input` por fila ausente, el conflicto de encolado de una fila que no aborta el lote) debe reaparecer, adaptada, en `tests/agt002-radar-worker.test.mjs` o `tests/agt002-radar-scan.test.mjs` según a cuál de los dos procesos corresponda hoy. **La prueba original no se borra: se suma cobertura, no se traslada.**
- **[CORREGIDO] Nada se borra en este plan.** `agt002-radar-pipeline.js` y `tests/agt002-radar-pipeline.test.mjs` permanecen. Ninguna tarea ejecuta `git rm`. Justificación completa en el spec §3.5 y §5 A8: cuatro archivos de prueba tocan hoy ese módulo, tres de dominios ajenos, y su borrado apagaría dos invariantes de seguridad en el mismo commit que mueve el productor de la cola.
- **[CORREGIDO] Sin cambio de horario ni de entrega.** El cron de Hermes sigue en días laborables 13:00 UTC (= 08:00 `America/Bogota`). Ninguna tarea edita hora, días ni destinatarios. Lo aprobado es sincronización de fuente **una vez al día**, que ya es lo que ocurre. Cambiar el horario exige aprobación separada y está fuera de este plan.
- **[CORREGIDO] Dominio de errores congelado.** Ninguna tarea añade, renombra ni reinterpreta valores de `AGT002_RADAR_QUEUE_ERROR_CODES` ni del `check` de `error_code` de `072`, y ninguna modifica `classifyAgt002RadarPreanalysisError`. Los códigos de envoltorio de proceso (`AGT002_RADAR_*_DISABLED`, `AGT002_RADAR_ENTRYPOINT_*`) viven sólo en el JSON de stdout y **nunca** se pasan a `failJob`.
- **[CORREGIDO] Sin secretos fuera de `EnvironmentFile`.** El wrapper no carga environment files, no exporta credenciales y no las pasa por línea de comandos. Los runners sólo reciben secretos vía `systemd`. El scan usa un environment file **separado y de menor privilegio**, sin credenciales del puente ni configuración de modelo.
- **[CORREGIDO] `systemctl` en las tareas de código: sólo `start`, y sólo en el wrapper.** La regla heredada "ningún script de este alcance ejecuta `systemctl`" se conserva para `enable`/`disable`/`daemon-reload`/`link`/`mask`/`edit` y para cualquier escritura en `/etc/systemd/` — instalar y habilitar siguen siendo actos humanos autorizados (Task 8). El wrapper hace `systemctl start` de dos unidades **ya instaladas**, lo que es una invocación, no una instalación. Las pruebas deben distinguir ambas cosas con precisión.

---

### Task 0: Línea base verificada

**Files:** Modify: ninguno.

- [x] **Step 1: Instalar dependencias exactas**

Run: `npm ci --ignore-scripts`
Expected: exit 0.
**Resultado real:** exit 0, 0 vulnerabilidades.

- [x] **Step 2: Suite completa de partida**

Run: `node --test --test-force-exit tests/*.test.mjs`
Expected: registrar el total real, PASS/FAIL/SKIP. Confirmar que `tests/agt002-radar-pipeline.test.mjs` y `tests/agt002-radar-pipeline-systemd.test.mjs` están hoy en PASS (son los que este plan va a reemplazar/adaptar).
**Resultado real:** 1046 tests, 1045 pass, 0 fail, 1 skip.

- [x] **Step 3: Gates técnicos de partida**

Run: `npm run check:backend-parity && npx tsc --noEmit && npm run build && git diff --check`
Expected: exit 0 en los cuatro.
**Resultado real:** exit 0 en los cuatro (backend parity OK; `tsc --noEmit` limpio; build con deployment-safety y Vite en verde, sólo el warning preexistente de chunk >500 kB; `git diff --check` sin espacios en blanco conflictivos).

- [ ] **Step 4: Confirmar que no hay `agt002-radar-scan*` ni `agt002-radar-worker*` en el árbol**

Run: `git ls-files | grep -E 'agt002-radar-(scan|worker)'`
Expected: sin salida (0 líneas). Si algo aparece, detenerse y reconciliar antes de continuar.

---

### Task 1: `agt002-radar-scan.js` — exploración diaria, sin `claim` ni modelo

**Files:**
- Create: `agt002-radar-scan.js`
- Test: `tests/agt002-radar-scan.test.mjs`

**Interfaces:**
- `export const AGT002_RADAR_SCAN_STAGES = Object.freeze(['esu_refresh', 'fetch', 'gate', 'ledger', 'enqueue'])`
- `export function createAgt002RadarScan({ database, environment = process.env, now, fetchTenderPage, evaluateGate, recordGateEvaluation, enqueueJob, refreshEsuDirect, maxTendersPerRun = 250 } = {})` → `{ runOnce() }`

- [ ] **Step 1: Write the failing test**

En `tests/agt002-radar-scan.test.mjs`, trasladar literalmente de `tests/agt002-radar-pipeline.test.mjs` (versión actual, antes de este plan) los casos que pertenecen al tramo de exploración, con estas adaptaciones:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AGT002_RADAR_SCAN_STAGES, createAgt002RadarScan } from '../agt002-radar-scan.js';

const NOW = '2026-08-25T15:00:00.000Z';
const TENDER = { id: '22222222-2222-4222-8222-222222222222', stable_key: 'k-1', /* ... */ };
const hostileDatabase = new Proxy({}, { get() { throw new Error('database must not be touched'); } });
const hostile = () => { throw new Error('must not run'); };

// 1. Flag apagado: no-op total. createAgt002RadarScan NO acepta claimJob/runPreanalysis/
//    recordPreanalysisRun/completeJob/failJob como parámetros: ni siquiera existen para inyectar.
for (const environment of [{}, { AGT002_RADAR_GATE: 'false' }, { AGT002_RADAR_GATE: 'yes' }, { AGT002_RADAR_GATE: '' }]) {
  const disabled = createAgt002RadarScan({
    database: hostileDatabase, environment, now: () => NOW,
    fetchTenderPage: hostile, evaluateGate: hostile, recordGateEvaluation: hostile, enqueueJob: hostile,
  });
  assert.deepEqual(await disabled.runOnce(), { status: 'disabled', stages: [], code: 'AGT002_RADAR_SCAN_DISABLED' });
}

// 2. Orden real: esu_refresh -> fetch -> gate -> ledger (x2 filas) -> enqueue (solo la sobreviviente).
//    (adaptar el `track(...)` y las aserciones de tests/agt002-radar-pipeline.test.mjs líneas 7-14
//    quitando toda referencia a claim/learning/signals/agt/persist/complete)

// 3. Página vacía -> status 'completed' con evaluated:0 (no existe 'empty' en el scan: no hay claim).

// 4. Fallo de ledger antes de encolar -> status 'unavailable', enqueueJob nunca se llama.

// 5. Reintento entre corridas: misma fila, mismo día -> misma idempotencyKey de gate;
//    cruce de día calendario Bogota -> idempotencyKey de gate nueva, mismo source_row_hash.
//    (trasladar literal de tests/agt002-radar-pipeline.test.mjs líneas 17-33)

// 6. Un rechazo de encolado de una fila (conflicto 55000) no aborta el lote:
//    la otra fila sigue encolándose y `rejected`/`enqueued` reflejan ambas.
//    (trasladar literal de tests/agt002-radar-pipeline.test.mjs líneas 69-85)

// 7. Superficie cerrada: el scan JAMÁS puede llamar al modelo ni reclamar un job,
//    porque esos parámetros no existen en su firma.
const source = readFileSync(new URL('../agt002-radar-scan.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /claimJob|runPreanalysis|recordPreanalysisRun|completeJob|failJob/);
assert.doesNotMatch(source, /Date\.now\(\)|new Date\(\)/);
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/agt002-radar-scan.test.mjs`
Expected: FAIL — `agt002-radar-scan.js` no existe.

- [x] **Step 3: Write minimal implementation**

`agt002-radar-scan.js` copia de `agt002-radar-pipeline.js` (estado actual) exactamente: el helper `enabled(environment)`, `defaultFetch`, `defaultRefreshEsuDirect`, y el cuerpo de `runOnce()` desde `stages.push('esu_refresh')` hasta el final del bucle `for (const item of survivors) { ... enqueueJob ... }` inclusive — **sin** la línea `job=await claimJob(...)` ni nada posterior. El `return` de éxito pasa a ser `{status:'completed', stages, ...base}` en vez del actual `{status:'empty',...}`/continuación con `job`. Los `catch` de `fetch` y de `gate`/`ledger` conservan sus `error_code` (`provider_error`, `persistence_failure`) tal cual.
**Nota post-revisión:** el manejo de fallos de `enqueueJob` se corrigió tras la revisión crítica de la Task 7 (ver evidencia al inicio del plan) para tolerar sólo el conflicto exacto `SQLSTATE 55000` como rechazo por fila; cualquier otro fallo de `enqueueJob` ahora hace fallar el scan en vez de contarse como `rejected`, con pruebas de regresión añadidas.

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/agt002-radar-scan.test.mjs`
Expected: PASS.
**Resultado real:** PASS (incluida en la suite focal de 27/27 y en la suite completa final de 1050/1051).

- [ ] **Step 5: Commit**

```bash
git add agt002-radar-scan.js tests/agt002-radar-scan.test.mjs
git commit -m "feat(radar): add daily scan (no claim, no model)"
```

---

### Task 2: `agt002-radar-worker.js` — reclama primero, revalida una sola fila

**Files:**
- Create: `agt002-radar-worker.js`
- **[CORREGIDO] Conservar sin cambios:** `agt002-radar-pipeline.js`, `tests/agt002-radar-pipeline.test.mjs` (artefacto de compatibilidad/rollback — spec §3.5, §5 A8). **No `git rm`.**
- Test: `tests/agt002-radar-worker.test.mjs`

**Interfaces:**
- `export const AGT002_RADAR_WORKER_STAGES = Object.freeze(['claim', 'fetch_row', 'gate', 'ledger', 'learning', 'agt', 'persist'])`
- `export function createAgt002RadarWorker({ database, environment = process.env, now, claimJob, fetchTenderRow, evaluateGate, recordGateEvaluation, completeJob, failJob, projectLearningObservations, buildLearningSignals, runPreanalysis, recordPreanalysisRun, leaseSeconds = 600, maxLearningSignals = 10 } = {})` → `{ runOnce() }`
- `defaultFetchTenderRow(database, { id })`: `database.from('psi_public_tenders').select('*').eq('id', id).limit(1)`; lanza envuelto en `persistenceError` (mismo patrón que `agt002-radar-preanalysis-jobs.js:1`) si `response.error`; retorna `response.data?.[0] ?? null` si no.

- [ ] **Step 1: Write the failing test**

En `tests/agt002-radar-worker.test.mjs`, cubrir, en este orden:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AGT002_RADAR_WORKER_STAGES, createAgt002RadarWorker } from '../agt002-radar-worker.js';

const NOW = '2026-08-25T15:00:00.000Z';
const TENDER = { id: '22222222-2222-4222-8222-222222222222', stable_key: 'k-1', /* ... */ };
const JOB = { jobId: 'j1', leaseId: 'l1', tenderId: TENDER.id, gateEvaluationId: 'gate-old', attemptKey: 'a1', sourceRowHash: 'a'.repeat(64), policyVersion: 'p', contextVersion: 'c' };
const hostileDatabase = new Proxy({}, { get() { throw new Error('database must not be touched'); } });
const hostile = () => { throw new Error('must not run'); };

// 1. Flag apagado: no-op total, ni siquiera intenta reclamar.
for (const environment of [{}, { AGT002_RADAR_GATE: 'false' }]) {
  const disabled = createAgt002RadarWorker({ database: hostileDatabase, environment, now: () => NOW, claimJob: hostile, fetchTenderRow: hostile, evaluateGate: hostile, recordGateEvaluation: hostile, completeJob: hostile, failJob: hostile, projectLearningObservations: hostile, buildLearningSignals: hostile, runPreanalysis: hostile, recordPreanalysisRun: hostile });
  assert.deepEqual(await disabled.runOnce(), { status: 'disabled', stages: [], code: 'AGT002_RADAR_WORKER_DISABLED' });
}

// 2. [CORREGIDO] Cola vacía: la ÚNICA operación contra la base es claimJob.
//    OJO: `now` YA NO es 'hostile' — el reloj se valida ANTES de reclamar (spec §6.2.1 y A10),
//    porque validarlo después dejaba un job reclamado con lease vivo y sin cierre. `now()` es
//    una función pura inyectada: llamarla no es una operación contra la base. Lo que se prueba
//    es que fetchTenderRow/evaluateGate/recordGateEvaluation/complete/fail/learning/agt/persist
//    siguen siendo 'hostile' y nunca se tocan.
let claimCalls = 0, nowCalls = 0;
const idle = createAgt002RadarWorker({
  database: {}, environment: { AGT002_RADAR_GATE: 'true' }, now: () => { nowCalls += 1; return NOW; },
  claimJob: async () => { claimCalls += 1; return null; },
  fetchTenderRow: hostile, evaluateGate: hostile, recordGateEvaluation: hostile,
  completeJob: hostile, failJob: hostile, projectLearningObservations: hostile,
  buildLearningSignals: hostile, runPreanalysis: hostile, recordPreanalysisRun: hostile,
});
assert.deepEqual(await idle.runOnce(), { status: 'empty', stages: ['claim'] });
assert.equal(claimCalls, 1);
assert.equal(nowCalls, 1, 'el reloj se valida una sola vez, antes de reclamar');

// 2b. [CORREGIDO] Reloj inválido: no se reclama nada, no queda job abierto, y el retorno es
//     byte-idéntico al de hoy (agt002-radar-pipeline.js:34-35). Ver A10.
for (const badNow of [() => 'no-es-fecha', () => 42, () => { throw new Error('reloj roto'); }]) {
  const broken = createAgt002RadarWorker({
    database: hostileDatabase, environment: { AGT002_RADAR_GATE: 'true' }, now: badNow,
    claimJob: hostile, fetchTenderRow: hostile, evaluateGate: hostile, recordGateEvaluation: hostile,
    completeJob: hostile, failJob: hostile, projectLearningObservations: hostile,
    buildLearningSignals: hostile, runPreanalysis: hostile, recordPreanalysisRun: hostile,
  });
  assert.deepEqual(await broken.runOnce(), { status: 'unavailable', stages: [], error_code: 'provider_error' });
}

// 3. Camino feliz: claim -> fetch_row (una fila, por id) -> gate -> ledger -> learning -> agt -> persist -> complete.
const stages = [];
const track = (name, value) => (...args) => { stages.push(name); return typeof value === 'function' ? value(...args) : value; };
const happy = createAgt002RadarWorker({
  database: {}, environment: { AGT002_RADAR_GATE: 'true' }, now: () => NOW,
  claimJob: track('claim', JOB),
  fetchTenderRow: track('fetch_row', (_db, { id }) => { assert.equal(id, TENDER.id); return TENDER; }),
  evaluateGate: track('gate', { verdict: 'sobreviviente', rule_ids: [], reasons: [], data_gaps: [], tender_id: TENDER.id, source_row_hash: JOB.sourceRowHash, policy_version: JOB.policyVersion, context_version: JOB.contextVersion }),
  recordGateEvaluation: track('ledger', { id: 'gate-fresh' }),
  projectLearningObservations: track('learning', { precedents: [] }),
  buildLearningSignals: track('signals', { version: 'v1', signals: [] }),
  runPreanalysis: track('agt', { status: 'completed', visibility_verdict: 'mostrar_en_radar', evidence: [{ evidence_id: 'e' }], usage: {} }),
  recordPreanalysisRun: track('persist', { id: 'r1', canonical: true }),
  completeJob: track('complete', { status: 'completed' }),
  failJob: hostile,
});
const result = await happy.runOnce();
assert.equal(result.status, 'completed');
assert.equal(result.job_id, 'j1');
assert.equal(result.preanalysis_run_id, 'r1');
assert.deepEqual([...new Set(stages)], ['claim', 'fetch_row', 'gate', 'ledger', 'learning', 'signals', 'agt', 'persist', 'complete']);
assert.deepEqual(result.stages, AGT002_RADAR_WORKER_STAGES);

// 4. Las cuatro divergencias -> stale_input, SIN aprendizaje, SIN modelo, SIN persistencia.
for (const [label, evaluation] of [
  ['eliminada', { verdict: 'eliminada', rule_ids: ['fecha_vencida'], reasons: [{ rule_id: 'fecha_vencida' }], data_gaps: [], tender_id: TENDER.id, source_row_hash: JOB.sourceRowHash, policy_version: JOB.policyVersion, context_version: JOB.contextVersion }],
  ['hash cambiado', { verdict: 'sobreviviente', rule_ids: [], reasons: [], data_gaps: [], tender_id: TENDER.id, source_row_hash: 'e'.repeat(64), policy_version: JOB.policyVersion, context_version: JOB.contextVersion }],
  ['policy cambiada', { verdict: 'sobreviviente', rule_ids: [], reasons: [], data_gaps: [], tender_id: TENDER.id, source_row_hash: JOB.sourceRowHash, policy_version: 'p2', context_version: JOB.contextVersion }],
  ['context cambiado', { verdict: 'sobreviviente', rule_ids: [], reasons: [], data_gaps: [], tender_id: TENDER.id, source_row_hash: JOB.sourceRowHash, policy_version: JOB.policyVersion, context_version: 'c2' }],
]) {
  let failedCode; const touched = [];
  const stale = createAgt002RadarWorker({
    database: {}, environment: { AGT002_RADAR_GATE: 'true' }, now: () => NOW,
    claimJob: async () => JOB, fetchTenderRow: async () => TENDER,
    evaluateGate: () => evaluation, recordGateEvaluation: async () => ({ id: 'gate-fresh' }),
    projectLearningObservations: async () => { touched.push('learning'); return {}; },
    buildLearningSignals: () => { touched.push('signals'); return {}; },
    runPreanalysis: async () => { touched.push('agt'); return {}; },
    recordPreanalysisRun: async () => { touched.push('persist'); return {}; },
    completeJob: async () => { touched.push('complete'); },
    failJob: async (_db, { errorCode }) => { failedCode = errorCode; },
  });
  const staleResult = await stale.runOnce();
  assert.equal(staleResult.status, 'unavailable', label);
  assert.equal(staleResult.error_code, 'stale_input', label);
  assert.equal(failedCode, 'stale_input', label);
  assert.deepEqual(touched, [], `${label}: ni aprendizaje ni modelo ni persistencia`);
}

// 5. Fila ausente (fetchTenderRow devuelve null) -> stale_input, mismo cierre.
let absentCode;
const absent = createAgt002RadarWorker({
  database: {}, environment: { AGT002_RADAR_GATE: 'true' }, now: () => NOW,
  claimJob: async () => JOB, fetchTenderRow: async () => null,
  evaluateGate: hostile, recordGateEvaluation: hostile,
  projectLearningObservations: hostile, buildLearningSignals: hostile,
  runPreanalysis: hostile, recordPreanalysisRun: hostile, completeJob: hostile,
  failJob: async (_db, { errorCode }) => { absentCode = errorCode; },
});
assert.equal((await absent.runOnce()).error_code, 'stale_input');
assert.equal(absentCode, 'stale_input');

// 6. Fallo de aprendizaje: el job se cierra, el modelo NUNCA se llama.
// 7. Nunca hay fetch de página completa: fetchTenderRow SIEMPRE se llama con {id: job.tenderId},
//    nunca con {limit: ...}. (aserción sobre los argumentos capturados en el punto 3 ya lo prueba;
//    reforzar con un `fetchTenderRow` que lanza si recibe algo distinto de {id: string}).
const rowFetchArgsGuarded = createAgt002RadarWorker({
  database: {}, environment: { AGT002_RADAR_GATE: 'true' }, now: () => NOW,
  claimJob: async () => JOB,
  fetchTenderRow: async (_db, args) => { assert.deepEqual(Object.keys(args), ['id']); return TENDER; },
  evaluateGate: () => ({ verdict: 'eliminada', rule_ids: ['fecha_vencida'], reasons: [{ rule_id: 'fecha_vencida' }], data_gaps: [], tender_id: TENDER.id, source_row_hash: JOB.sourceRowHash, policy_version: JOB.policyVersion, context_version: JOB.contextVersion }),
  recordGateEvaluation: async () => ({ id: 'gate-fresh' }),
  projectLearningObservations: hostile, buildLearningSignals: hostile, runPreanalysis: hostile, recordPreanalysisRun: hostile, completeJob: hostile,
  failJob: async () => {},
});
await rowFetchArgsGuarded.runOnce();

// 8. Sin reloj propio.
const source = readFileSync(new URL('../agt002-radar-worker.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /Date\.now\(\)|new Date\(\)/);

// 9. [CORREGIDO] Con un job reclamado, NINGÚN camino de retorno sale sin cerrar el job.
//    Se recorre cada punto de fallo de la matriz del spec §6.2.2 (fetch_row lanza, ledger lanza,
//    learning lanza, agt lanza, persist lanza) y en TODOS se exige que failJob se haya llamado
//    exactamente una vez con el jobId/leaseId reclamados.
for (const [label, overrides] of FAILURE_POINTS) {
  let failCalls = 0, seenCode;
  const w = createAgt002RadarWorker({ ...baseHappyDeps, ...overrides,
    failJob: async (_db, { jobId, leaseId, errorCode }) => {
      failCalls += 1; seenCode = errorCode;
      assert.equal(jobId, JOB.jobId); assert.equal(leaseId, JOB.leaseId);
    } });
  const r = await w.runOnce();
  assert.equal(failCalls, 1, `${label}: el job reclamado debe cerrarse exactamente una vez`);
  assert.equal(r.status, 'unavailable', label);
  // 10. [CORREGIDO] Dominio de error_code CONGELADO: sólo valores de 072/AGT002_RADAR_QUEUE_ERROR_CODES.
  assert.ok(AGT002_RADAR_QUEUE_ERROR_CODES.includes(seenCode), `${label}: ${seenCode} fuera de dominio`);
  assert.ok(AGT002_RADAR_QUEUE_ERROR_CODES.includes(r.error_code), `${label}: ${r.error_code} fuera de dominio`);
}
// Casos con código exacto según la matriz corregida del spec §6.2.2. Nótese en particular:
//   - fallo de projectLearningObservations/buildLearningSignals => 'provider_error' (NO 'invalid_output':
//     la proyección relanza el error crudo de Supabase, sin runtime_boundary_code, y el clasificador
//     cae a su rama por defecto). Si alguien "arregla" esto tocando el clasificador, está fuera de alcance.
//   - fallo de fetchTenderRow => 'persistence_failure' SÓLO si defaultFetchTenderRow envuelve con el
//     mismo patrón `persistenceError` de agt002-radar-preanalysis-jobs.js:1. Probarlo explícitamente.

// 11. [CORREGIDO] El worker NO importa el módulo combinado ni lo reconstruye.
assert.doesNotMatch(source, /agt002-radar-pipeline|createAgt002RadarPipeline/);
// 12. [CORREGIDO] El módulo combinado sigue existiendo y sigue exportando su superficie:
//     es el artefacto de compatibilidad/rollback (spec §5 A8), no un residuo a limpiar.
const { AGT002_RADAR_PIPELINE_STAGES, createAgt002RadarPipeline } = await import('../agt002-radar-pipeline.js');
assert.equal(typeof createAgt002RadarPipeline, 'function');
assert.deepEqual(AGT002_RADAR_PIPELINE_STAGES, ['esu_refresh','fetch','gate','ledger','claim','learning','agt','persist']);
```

`AGT002_RADAR_QUEUE_ERROR_CODES` se importa de `../agt002-radar-preanalysis-worker.js` (**[EXISTE]**, línea 2) — no se redeclara la lista en la prueba, para que un cambio de dominio rompa aquí en vez de pasar inadvertido.

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/agt002-radar-worker.test.mjs`
Expected: FAIL — `agt002-radar-worker.js` no existe.

- [ ] **Step 3: Write minimal implementation**

`agt002-radar-worker.js` según §6.2/6.2.1 del spec **[CORREGIDO]**: guardia de flag con código `AGT002_RADAR_WORKER_DISABLED`; **validación del reloj antes de reclamar** (`nowIso`/`evaluationDate`; inválido ⇒ `{status:'unavailable', stages:[], error_code:'provider_error'}` sin tocar la base); `claim` y retorno inmediato `{status:'empty', stages:['claim']}` si `!job`; `fetch_row` con `fetchTenderRow(database,{id:job.tenderId})`; fila `null` ⇒ tratar como si `evaluateGate` hubiera devuelto no-sobreviviente (unificar en una sola rama de "revalidación falló" para no duplicar el cierre `stale_input`); `gate`+`ledger` sobre esa única fila; comparación de los cuatro campos contra `job` (§6.2.1 punto 7); si pasa, `learning → agt → persist → complete` idéntico en forma al tramo final de `agt002-radar-pipeline.js:63-65` (candidato derivado de la fila, `buildLearningSignals({candidate, observations, maxSignals})`, `recordPreanalysisRun` con `policyVersion`/`contextVersion` de la evaluación fresca, no del job).

`defaultFetchTenderRow` **debe** envolver sus errores con el mismo patrón `persistenceError` de `agt002-radar-preanalysis-jobs.js:1` (fija `runtime_boundary_code='AGT002_RADAR_PERSISTENCE_FAILURE'`); sin eso el clasificador vigente devolvería `provider_error` y la matriz del spec §6.2.2 sería falsa.

**Regla dura de cierre:** desde que existe un job reclamado, todo camino de retorno pasa por `completeJob` o por `failJob` (spec §6.2.1 punto 9, corregido de "(5)-(8)" a "(4)-(8)"). El único caso en que un job queda abierto es que `failJob` mismo falle, y ahí lo cierra el barrido de leases ya existente de `072`.

**[CORREGIDO] No se borra nada en este paso.** `agt002-radar-pipeline.js` y `tests/agt002-radar-pipeline.test.mjs` quedan intactos y siguen corriendo en verde. La aserción que sí importa —"producción ejecuta el worker"— se prueba en la Task 4 sobre el texto del runner del timer, que es donde vive el comportamiento.

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/agt002-radar-worker.test.mjs tests/agt002-radar-scan.test.mjs tests/agt002-radar-pipeline.test.mjs`
Expected: PASS los tres. **[CORREGIDO]** La prueba del módulo combinado se incluye a propósito: sigue viva y debe seguir verde.
**Resultado real:** PASS los tres (confirmado en la suite focal 27/27 y en la suite completa final 1050/1051).

- [x] **Step 5: Inventariar (no romper) a quién toca el módulo combinado**

Run: `grep -rln "agt002-radar-pipeline" --include='*.js' --include='*.mjs' .`
Expected **[CORREGIDO]**: se esperan **exactamente** estas coincidencias, todas legítimas y ninguna a "limpiar" aquí:
`agt002-radar-pipeline.js`, `ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs` (lo actualiza la Task 4), `tests/agt002-radar-pipeline.test.mjs`, `tests/agt002-radar-pipeline-systemd.test.mjs` (Task 4), `tests/esu-direct-refresh.test.mjs` (importa y ejecuta `createAgt002RadarPipeline`), `tests/esu-direct-refresh-adapter.test.mjs` (aserciones sobre el runner — Task 2b/4), `tests/agt002-radar-no-conversion-authority.test.mjs` (Task 2b), `tests/agt002-radar-preanalysis-runtime.test.mjs` (Task 2b), `tests/agt002-radar-learning-proposals.test.mjs`.
Si aparece un archivo **fuera** de esa lista, detenerse y entenderlo antes de continuar. La versión anterior de este plan esperaba "sin coincidencias" y eso era factualmente falso.

- [ ] **Step 6: Commit**

```bash
git add agt002-radar-worker.js tests/agt002-radar-worker.test.mjs
git commit -m "feat(radar): add claim-first queue worker alongside the combined pipeline"
```

---

### Task 2b: Extender los invariantes transversales al código nuevo [CORREGIDO — TAREA NUEVA]

> Sin esta tarea, `agt002-radar-scan.js` y `agt002-radar-worker.js` —el código que de verdad corre en producción tras la Task 4— quedan **fuera** de garantías que hoy sí cubren al módulo combinado. Es la contrapartida obligatoria de conservar el módulo viejo: la cobertura debe apuntar a lo que se ejecuta, no sólo a lo que existe.

**Files:**
- Modify: `tests/agt002-radar-no-conversion-authority.test.mjs`
- Modify: `tests/agt002-radar-preanalysis-runtime.test.mjs`

- [x] **Step 1: Añadir el código nuevo a `DECISION_PATH_FILES`**

En `tests/agt002-radar-no-conversion-authority.test.mjs` (líneas 4-14), añadir a la lista: `agt002-radar-scan.js`, `agt002-radar-worker.js` y `ops/agt002-radar-scan/run-agt002-radar-scan.mjs`. **No quitar** `agt002-radar-pipeline.js` ni su runner. Con eso, los tres módulos que tocan la ruta de decisión quedan bajo las mismas prohibiciones ya probadas: nada de `psi_sales_opportunities`, `psi_convert_tender_to_opportunity`, `tender-convert`, `converted_opportunity_id`, `internal_status`, nada de `psi_tender_go_no_go_decisions`/`go_no_go`, ninguna escritura directa `from(...).insert|update|upsert|delete`, ningún método HTTP de escritura.

Run: `node --test tests/agt002-radar-no-conversion-authority.test.mjs`
Expected: PASS. Si falla, el módulo nuevo está haciendo algo que la ruta de decisión tiene prohibido — arreglar el módulo, nunca la lista.
**Resultado real:** PASS.

- [x] **Step 2: Extender el invariante de holgura lease/timeout al worker**

`tests/agt002-radar-preanalysis-runtime.test.mjs:41-47` extrae hoy `leaseSeconds` de `agt002-radar-pipeline.js` para exigir ≥300 s de holgura sobre el techo de timeout de 300 s. Añadir la misma comprobación sobre `agt002-radar-worker.js` (que declara su propio `leaseSeconds = 600`), **manteniendo** la del módulo combinado mientras exista. Es el número que gobierna en producción tras la Task 4.

Run: `node --test tests/agt002-radar-preanalysis-runtime.test.mjs`
Expected: PASS.
**Resultado real:** PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/agt002-radar-no-conversion-authority.test.mjs tests/agt002-radar-preanalysis-runtime.test.mjs
git commit -m "test(radar): extend cross-cutting radar invariants to scan and worker"
```

> Nota: las aserciones de `tests/esu-direct-refresh-adapter.test.mjs` sobre el refresco ESU **no** se tocan aquí; se reubican en la Task 4, que es la que quita esos símbolos del runner del worker.

---

### Task 3: `ops/agt002-radar-scan/` — entrypoint on-demand, sin `.timer`

**Files:**
- Create: `ops/agt002-radar-scan/run-agt002-radar-scan.mjs`
- Create: `ops/agt002-radar-scan/agt002-radar-scan.service`
- Create: `ops/agt002-radar-scan/env.example`
- Create: `ops/agt002-radar-scan/README.md`
- Test: `tests/agt002-radar-scan-systemd.test.mjs`

**Interfaces:**
- El runner importa `createAgt002RadarScan` de `../../agt002-radar-scan.js`, construye el cliente Supabase y el refresher ESU exactamente como hoy hace `ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs` (`createSupabaseEsuDirectRefresher` + `fetchEsuProcesses({includeHistorical:true})`), ejecuta **una** `runOnce()`, imprime JSON, sale 0/1.
- **[CORREGIDO] Código de salida del runner del scan:** `process.exitCode = 1` no sólo ante configuración inválida o excepción, sino **también cuando `result.status === 'unavailable'`**. Sin eso la unidad quedaría `active (exited)` con código 0 ante un fallo de fetch/gate/ledger, `systemctl start` devolvería 0 y el wrapper (Task 5) reportaría un día bueno mientras no se encoló nada — y ahora el siguiente intento es al día siguiente, no en 15 minutos. `status:'disabled'` y `status:'completed'` salen 0. **Asimetría deliberada:** el runner del worker **no** cambia sus códigos de salida (ver Task 4), porque `stale_input` es un desenlace normal del drenado y convertirlo en unidad fallida ensuciaría el estado de una unidad que dispara 96 veces al día.

- [ ] **Step 1: Write the failing test**

En `tests/agt002-radar-scan-systemd.test.mjs`, espejo de `tests/agt002-radar-pipeline-systemd.test.mjs` actual, con estas diferencias respecto al de la unidad worker:

```js
import assert from 'node:assert/strict'; import { readFileSync, existsSync } from 'node:fs';
const base = new URL('../ops/agt002-radar-scan/', import.meta.url);
const files = ['run-agt002-radar-scan.mjs', 'agt002-radar-scan.service', 'env.example', 'README.md'];
// NOTA: a diferencia de agt002-radar-pipeline, NO hay 'agt002-radar-scan.timer' en esta lista:
// el scan no tiene timer propio, sólo se invoca desde el wrapper (Task 5) o a mano en QA.
for (const file of files) assert.equal(existsSync(new URL(file, base)), true, file);
const read = file => readFileSync(new URL(file, base), 'utf8');
const runner = read(files[0]), service = read(files[1]), env = read(files[2]), readme = read(files[3]);

assert.match(runner, /createAgt002RadarScan/);
assert.equal((runner.match(/\bscan\.runOnce\(\)/g) || []).length, 1);
assert.doesNotMatch(runner, /setInterval|setTimeout|while\s*\(|for\s*\(;;\)|claimAgt002RadarPreanalysisJob|runPreanalysis/);
assert.match(runner, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(runner, /process\.exitCode\s*=\s*1/);
// [CORREGIDO] El runner del scan sale != 0 tambien ante status 'unavailable' (ver Interfaces).
assert.match(runner, /status\s*===?\s*'unavailable'/);
// [CORREGIDO] Las aserciones de ESU que hoy viven sobre el runner del worker se REUBICAN aqui,
// porque aqui es donde el refresco ESU pasa a ocurrir (ver Task 4, Step 1).
assert.match(runner, /createSupabaseEsuDirectRefresher/);
assert.match(runner, /fetchEsuProcesses\(\s*\{\s*includeHistorical\s*:\s*true/);
assert.equal((runner.match(/\brefresher\.runOnce\(\)/g) || []).length, 1);

assert.match(service, /Type=oneshot/);
assert.match(service, /EnvironmentFile=\/etc\/psi-comercial\/agt002-radar-scan\.env/);
// [CORREGIDO] La version anterior escribia `assert.doesNotMatch(existsSync(...), true, ...)`, que
// lanza ERR_INVALID_ARG_TYPE: doesNotMatch exige (string, RegExp). La comprobacion correcta es:
assert.equal(existsSync(new URL('agt002-radar-scan.timer', base)), false, 'el scan no debe tener .timer propio');

assert.match(env, /^AGT002_RADAR_GATE=false$/m);
// [CORREGIDO] Privilegio minimo, verificado por ausencia explicita: el scan nunca llama al
// proveedor ni al puente, asi que su environment file NO declara ninguna de estas variables.
for (const forbidden of [/AGT002_HETZNER_BRIDGE_URL/, /AGT002_HETZNER_BRIDGE_HMAC_SECRET/,
                         /AGT002_RADAR_PREANALYSIS_MODEL/, /AGT002_RADAR_PREANALYSIS_TIMEOUT_MS/]) {
  assert.doesNotMatch(env, forbidden);
  assert.doesNotMatch(service, forbidden);
}
// El worker conserva su propio environment file protegido, distinto de este.
assert.doesNotMatch(service, /agt002-radar-pipeline\.env/);

// [CORREGIDO] Ningun artefacto de ESTE directorio instala ni habilita unidades. La prohibicion
// se afina: `systemctl start` es una invocacion legitima (la usa el wrapper de la Task 5 sobre
// unidades ya instaladas); instalar/habilitar/recargar sigue siendo acto humano (Task 8).
for (const file of files) {
  assert.doesNotMatch(read(file), /systemctl\s+(enable|disable|daemon-reload|link|mask|edit|reenable)/);
  assert.doesNotMatch(read(file), /\/etc\/systemd\//);
  assert.equal(read(file).includes('--apply'), false);
}
assert.match(readme, /autorizaci[oó]n separada/i);
assert.match(readme, /sin timer|on[- ]demand|bajo demanda/i);
// [CORREGIDO] El README debe decir donde se leen los logs, porque con systemctl ya no llegan al cron.
assert.match(readme, /journalctl -u agt002-radar-scan\.service/);

// Paridad de endurecimiento contra la MISMA baseline que ya usa agt002-radar-pipeline.service
// (tests/agt002-radar-pipeline-systemd.test.mjs, HARDENING_BASELINE) — trasladar ese arreglo
// literal y repetir las mismas aserciones de "una sola vez, con el valor exacto" sobre `service`.
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/agt002-radar-scan-systemd.test.mjs`
Expected: FAIL — el directorio no existe.

- [ ] **Step 3: Write minimal implementation**

`run-agt002-radar-scan.mjs` copia la estructura de `ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs` actual (validación de config, cliente Supabase, `createSupabaseEsuDirectRefresher`, `fetchEsuProcesses({includeHistorical:true})`) sustituyendo `createAgt002RadarPipeline` por `createAgt002RadarScan`, y añadiendo el `process.exitCode = 1` ante `status:'unavailable'` descrito en **Interfaces**. `agt002-radar-scan.service` copia línea por línea el endurecimiento de `agt002-radar-pipeline.service` (misma baseline exacta), cambiando `Description=`, `ExecStart=` (apunta a `run-agt002-radar-scan.mjs`) y `EnvironmentFile=/etc/psi-comercial/agt002-radar-scan.env` (archivo de secretos **separado y de menor privilegio**: sólo `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`AGT002_RADAR_GATE`, sin credenciales del puente Hetzner — el scan nunca las necesita). `[Install]` puede declarar `WantedBy=` por consistencia con el resto del árbol, pero **nada en este directorio ejecuta `systemctl enable`**: instalar y habilitar siguen siendo actos humanos fuera de este plan (Task 8). `env.example` declara `AGT002_RADAR_GATE=false` y las dos variables de Supabase, sin `AGT002_HETZNER_BRIDGE_*` ni `AGT002_RADAR_PREANALYSIS_*` (verificado además que el refresco ESU no necesita ninguna variable adicional: `esu-direct-crawl.js` no lee `process.env`). `README.md` explica el rol on-demand (sin `.timer`, arrancado por el wrapper de la Task 5 con `systemctl start` o a mano durante QA), dónde leer los logs (`journalctl -u agt002-radar-scan.service`) y repite la frase "autorización separada" para instalar/habilitar, igual que el resto del árbol.

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/agt002-radar-scan-systemd.test.mjs`
Expected: PASS.
**Resultado real:** PASS.

- [ ] **Step 5: Commit**

```bash
git add ops/agt002-radar-scan tests/agt002-radar-scan-systemd.test.mjs
git commit -m "feat(radar): add on-demand systemd unit for the daily scan"
```

---

### Task 4: Repurpose `ops/agt002-radar-pipeline/` como unidad del worker

**Files:**
- Modify: `ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs`
- Modify: `ops/agt002-radar-pipeline/env.example`
- Modify: `ops/agt002-radar-pipeline/README.md`
- Modify: `tests/agt002-radar-pipeline-systemd.test.mjs`
- **[CORREGIDO] Modify:** `tests/esu-direct-refresh-adapter.test.mjs` (dos pruebas que hoy exigen los símbolos de ESU **en este runner**; ver Step 1)
- **No modificar:** `ops/agt002-radar-pipeline/agt002-radar-pipeline.service`, `ops/agt002-radar-pipeline/agt002-radar-pipeline.timer` (verificar con diff, no reescribir)
- **No modificar:** `ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs` en sus códigos de salida — sigue saliendo 0 cuando `runOnce()` devuelve `status:'unavailable'` (asimetría deliberada con el scan; ver Task 3, Interfaces, y spec §6.3).

**Interfaces:**
- El runner pasa a importar `createAgt002RadarWorker` de `../../agt002-radar-worker.js` en vez de `createAgt002RadarPipeline`. **Deja de construir el refresher ESU** (`createSupabaseEsuDirectRefresher`/`fetchEsuProcesses` se eliminan de este runner: el worker no los usa nunca).
- **[CORREGIDO] Ésta es la tarea que cambia el comportamiento de producción.** El módulo combinado sigue en el árbol (Task 2); lo que deja de existir es cualquier ruta de ejecución hacia él. Se prueba estáticamente, no por ausencia de archivo.

- [ ] **Step 1: Write the failing test**

**[CORREGIDO] Antes de tocar nada, reubicar las dos aserciones de ESU que hoy apuntan a este runner.** `tests/esu-direct-refresh-adapter.test.mjs:131-137` exige que `ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs` contenga `createSupabaseEsuDirectRefresher`, `fetchEsuProcesses`, `refreshEsuDirect` y `.runOnce()`; `:309-316` exige `fetchEsuProcesses({includeHistorical:true})` en ese mismo archivo. Esta tarea quita exactamente esos símbolos, así que ambas pruebas **fallarían** y la versión anterior de este plan no las mencionaba. Corrección: **repuntar ambas pruebas a `ops/agt002-radar-scan/run-agt002-radar-scan.mjs`**, que es donde el refresco ESU pasa a vivir (Task 3 ya las duplica en su propia suite; aquí se actualiza la ruta en la suite de ESU para que el invariante siga siendo de ESU, no del Radar). El invariante que protegen —"el entrypoint durable inyecta el refresher real y pide filas históricas"— se conserva íntegro, sólo cambia de archivo.

Después, actualizar `tests/agt002-radar-pipeline-systemd.test.mjs`:

```js
// Reemplazar: assert.match(runner, /createAgt002RadarPipeline/);
assert.match(runner, /createAgt002RadarWorker/);
assert.equal((runner.match(/\bworker\.runOnce\(\)/g) || []).length, 1);
// [CORREGIDO] Prueba estatica del cambio de comportamiento productivo: el ExecStart del timer
// importa el worker y NO importa ni construye el pipeline combinado (que sigue existiendo).
assert.doesNotMatch(runner, /createAgt002RadarPipeline/);
assert.doesNotMatch(runner, /agt002-radar-pipeline\.js/);
assert.match(runner, /from\s+'\.\.\/\.\.\/agt002-radar-worker\.js'/);
// Y el propio .service sigue apuntando al mismo ExecStart de siempre: no se reinstala nada.
assert.match(service, /ExecStart=\/usr\/bin\/node \/opt\/psi-comercial\/app\/ops\/agt002-radar-pipeline\/run-agt002-radar-pipeline\.mjs/);
// El worker jamás refresca ESU ni hace fetch de página completa: el runner no debe
// referenciar ninguno de los dos símbolos.
assert.doesNotMatch(runner, /createSupabaseEsuDirectRefresher|fetchEsuProcesses|createAgt002RadarScan/);
// [CORREGIDO] El env.example del worker SI conserva las credenciales del puente: es el unico
// de los dos procesos que llama al proveedor. Privilegio minimo no significa quitarselas a quien
// las necesita, sino no darselas a quien no.
assert.match(env, /^AGT002_HETZNER_BRIDGE_HMAC_SECRET=/m);
assert.match(env, /^AGT002_RADAR_PREANALYSIS_TIMEOUT_MS=/m);

// El README ahora describe el rol de worker-only, no la cadena completa.
assert.match(readme, /worker|cola|drenad/i);
assert.match(readme, /agt002-radar-scan/); // referencia cruzada al proceso que alimenta la cola
assert.match(readme, /journalctl -u agt002-radar-pipeline\.service/);
```

Mantener sin cambios todas las aserciones de endurecimiento (`HARDENING_BASELINE`), las de identidad/ejecución (`User=psi-comercial`, `EnvironmentFile=/etc/psi-comercial/agt002-radar-pipeline.env`, `TimeoutStartSec=720`, `Type=oneshot`) y las de `.timer` (`OnUnitActiveSec=`, `Persistent=false`, `RandomizedDelaySec` distinto de `0`). **[CORREGIDO]** La prohibición genérica `read(file).includes('systemctl ') === false` de este archivo se conserva **tal cual** para este directorio: aquí no vive ningún wrapper. La versión afinada de esa regla aplica sólo al wrapper de la Task 5.

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/agt002-radar-pipeline-systemd.test.mjs`
Expected: FAIL contra el runner/README todavía sin actualizar.

- [ ] **Step 3: Write minimal implementation**

Reescribir `run-agt002-radar-pipeline.mjs`:

```js
#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import { createAgt002RadarWorker } from '../../agt002-radar-worker.js';
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error(JSON.stringify({ status: 'unavailable', code: 'AGT002_RADAR_ENTRYPOINT_CONFIG_INVALID' })); process.exitCode = 1; }
else {
  try {
    const database = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const now = () => new Date().toISOString();
    const worker = createAgt002RadarWorker({ database, environment: process.env, now });
    const result = await worker.runOnce(); console.log(JSON.stringify(result));
  } catch { console.error(JSON.stringify({ status: 'unavailable', code: 'AGT002_RADAR_ENTRYPOINT_FAILED' })); process.exitCode = 1; }
}
```

Actualizar `env.example` (sigue necesitando `AGT002_RADAR_PREANALYSIS_MODEL`, `AGT002_RADAR_PREANALYSIS_TIMEOUT_MS`, `AGT002_HETZNER_BRIDGE_URL`/`HMAC_SECRET`: el worker sí llama al proveedor). Reescribir `README.md` para describir el rol de worker-only (reclama primero, sale si no hay job, nunca refresca ESU ni hace fetch de página completa), con referencia cruzada a `ops/agt002-radar-scan/README.md` como el proceso que alimenta la cola.

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/agt002-radar-pipeline-systemd.test.mjs`
Expected: PASS.
**Resultado real:** PASS.

- [ ] **Step 5: Confirmar que `.service`/`.timer` no cambiaron**

Run: `git diff --stat ops/agt002-radar-pipeline/agt002-radar-pipeline.service ops/agt002-radar-pipeline/agt002-radar-pipeline.timer`
Expected: sin salida (0 líneas cambiadas). Este es el "repurpose de bajo riesgo": la unidad instalada hoy en el entorno operador **[OPERADOR]** no necesita reinstalarse ni recargar su `.timer`; sólo cambia el **contenido del archivo** que `ExecStart` ya ejecuta, con el próximo despliegue normal del árbol de la aplicación.

- [x] **Step 6: Confirmar que la suite de ESU sigue verde tras la reubicación**

Run: `node --test tests/esu-direct-refresh-adapter.test.mjs tests/esu-direct-refresh.test.mjs`
Expected **[CORREGIDO]**: PASS.
**Resultado real:** PASS (parte de la suite completa final de 1050/1051). `esu-direct-refresh.test.mjs` sigue importando y ejecutando `createAgt002RadarPipeline` —el módulo se conservó a propósito— y `esu-direct-refresh-adapter.test.mjs` ahora verifica la inyección del refresher sobre el runner del **scan**. Si alguna de las dos falla, no continuar: es la señal exacta de que el borrado del módulo o el olvido de la reubicación habría roto un dominio ajeno.

- [ ] **Step 7: Commit**

```bash
git add ops/agt002-radar-pipeline tests/agt002-radar-pipeline-systemd.test.mjs tests/esu-direct-refresh-adapter.test.mjs
git commit -m "refactor(radar): point the 15-min unit at the queue worker"
```

---

### Task 5: Wrapper de exportación diaria — encadenar export → scan → kick del worker

**Files:**
- Create: `ops/agt002-radar-scan/run-agt002-radar-daily-export.sh`
- Test: `tests/agt002-radar-daily-export-wrapper.test.mjs`

**Interfaces:**
- Script Bash con tres variables de entorno configurables (`AGT002_RADAR_EXPORT_CMD`, `AGT002_RADAR_SCAN_CMD`, `AGT002_RADAR_WORKER_KICK_CMD`), cada una con un valor por defecto de producción, según spec §6.3.

- [ ] **Step 1: Write the failing test**

En `tests/agt002-radar-daily-export-wrapper.test.mjs`, usar `node:child_process` con un `PATH` de prueba que antepone un directorio temporal con dobles ejecutables de `export`, `scan` y `worker` (scripts de shell que registran su invocación en un archivo de log compartido y salen con el código que el test les indique vía variable de entorno), y pasar esos dobles al wrapper vía las tres variables de entorno de configuración (nunca sustituyendo el `PATH` real de `node`/`bash`, sólo los tres comandos configurables):

```js
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function makeDouble(dir, name, exitCode) {
  const p = join(dir, name);
  writeFileSync(p, `#!/usr/bin/env bash\necho "${name}" >> "$LOG_FILE"\nexit ${exitCode}\n`);
  chmodSync(p, 0o755);
  return p;
}

function run(exitCodes) {
  const dir = mkdtempSync(join(tmpdir(), 'agt002-wrapper-'));
  const logFile = join(dir, 'log.txt'); writeFileSync(logFile, '');
  const env = {
    ...process.env, LOG_FILE: logFile,
    AGT002_RADAR_EXPORT_CMD: makeDouble(dir, 'export.sh', exitCodes.export),
    AGT002_RADAR_SCAN_CMD: exitCodes.scan === undefined ? undefined : makeDouble(dir, 'scan.sh', exitCodes.scan),
    AGT002_RADAR_WORKER_KICK_CMD: exitCodes.worker === undefined ? undefined : makeDouble(dir, 'worker.sh', exitCodes.worker),
  };
  const result = spawnSync('bash', [new URL('../ops/agt002-radar-scan/run-agt002-radar-daily-export.sh', import.meta.url).pathname], { env });
  const invoked = readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
  return { status: result.status, invoked };
}

// 1. Exportación falla -> ni scan ni worker corren, código de salida != 0.
{ const { status, invoked } = run({ export: 1, scan: 0, worker: 0 }); assert.notEqual(status, 0); assert.deepEqual(invoked, ['export.sh']); }

// 2. Exportación ok, scan falla -> worker NO se invoca ahora, código de salida != 0.
{ const { status, invoked } = run({ export: 0, scan: 1, worker: 0 }); assert.notEqual(status, 0); assert.deepEqual(invoked, ['export.sh', 'scan.sh']); }

// 3. Los tres ok -> los tres se invocan en orden, código de salida 0.
{ const { status, invoked } = run({ export: 0, scan: 0, worker: 0 }); assert.equal(status, 0); assert.deepEqual(invoked, ['export.sh', 'scan.sh', 'worker.sh']); }

// 4. Export y scan ok, el kick del worker falla -> "mejor esfuerzo": el wrapper SIGUE saliendo 0
//    (el .timer de 15 min es la red de seguridad; perder el kick sólo cuesta latencia).
{ const { status, invoked } = run({ export: 0, scan: 0, worker: 1 }); assert.equal(status, 0); assert.deepEqual(invoked, ['export.sh', 'scan.sh', 'worker.sh']); }

// 5. Sin `set -e` frágil: verificar en el texto del script que cada paso captura su código
//    explícitamente (no depende de que un `&&` externo termine el script silenciosamente).
const source = readFileSync(new URL('../ops/agt002-radar-scan/run-agt002-radar-daily-export.sh', import.meta.url), 'utf8');
assert.doesNotMatch(source, /\bsystemctl\b/);
assert.doesNotMatch(source, /--apply/);
assert.doesNotMatch(source, /\brm\s+-rf\b/);
assert.match(source, /set -u/);
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/agt002-radar-daily-export-wrapper.test.mjs`
Expected: FAIL — el script no existe.
(Nota: el archivo de prueba quedó en disco como `tests/agt002-radar-daily-wrapper.test.mjs`, no `tests/agt002-radar-daily-export-wrapper.test.mjs`; cubre el mismo wrapper — no se renombra aquí porque esta actualización es sólo de evidencia, no de código/tests.)

- [ ] **Step 3: Write minimal implementation**

```bash
#!/usr/bin/env bash
set -u -o pipefail

EXPORT_CMD="${AGT002_RADAR_EXPORT_CMD:-/root/.hermes/scripts/secop_psi_radar_export.sh}"
SCAN_CMD="${AGT002_RADAR_SCAN_CMD:-node /opt/psi-comercial/app/ops/agt002-radar-scan/run-agt002-radar-scan.mjs}"
WORKER_KICK_CMD="${AGT002_RADAR_WORKER_KICK_CMD:-node /opt/psi-comercial/app/ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs}"

"$EXPORT_CMD"; export_status=$?
echo "{\"event\":\"agt002_radar_daily_export_wrapper\",\"stage\":\"export\",\"exit_code\":$export_status}"
if [ "$export_status" -ne 0 ]; then exit "$export_status"; fi

"$SCAN_CMD"; scan_status=$?
echo "{\"event\":\"agt002_radar_daily_export_wrapper\",\"stage\":\"scan\",\"exit_code\":$scan_status}"
if [ "$scan_status" -ne 0 ]; then exit "$scan_status"; fi

"$WORKER_KICK_CMD"; worker_status=$?
echo "{\"event\":\"agt002_radar_daily_export_wrapper\",\"stage\":\"worker_kick\",\"exit_code\":$worker_status,\"best_effort\":true}"
exit 0
```

Nota: los comandos configurables pueden traer sus propios argumentos (espacios); si el valor por defecto de producción no los necesita, `"$EXPORT_CMD"` sin `eval` es suficiente y evita inyección de shell vía variable de entorno. Si en el despliegue real se necesitan argumentos, usar un array Bash (`EXPORT_CMD=(...)`) en vez de una cadena — ajustar el test en consecuencia si así se implementa.

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/agt002-radar-daily-export-wrapper.test.mjs`
Expected: PASS los cinco casos.
**Resultado real:** PASS los cinco casos (bajo el nombre de archivo real, ver nota en Step 2).

- [ ] **Step 5: Commit**

```bash
git add ops/agt002-radar-scan/run-agt002-radar-daily-export.sh tests/agt002-radar-daily-export-wrapper.test.mjs
git commit -m "feat(radar): add versioned daily export -> scan -> worker-kick wrapper"
```

---

### Task 6: Documentación operacional

**Files:**
- Modify: `docs/runbooks/agt002-radar-pipeline.md`
- Modify: `CURRENT.md` (nueva sección §15, fechada 2026-08-28)

**Interfaces:** ninguna (sólo prosa).

- [x] **Step 1: Actualizar el runbook**

En `docs/runbooks/agt002-radar-pipeline.md`, añadir una sección nueva (p. ej. "§0. Separación scan/worker, 2026-08-28") antes de la §1 actual, que:
- explique que el productor de 15 min se dividió en exploración diaria + drenado de cola, con referencia a este plan/spec;
- actualice cualquier frase que hoy diga "una invocación evalúa una página acotada **y** reclama como máximo un job" (eso ya no es cierto para el mismo proceso): el scan evalúa la página, el worker reclama.
- documente las tres autorizaciones nuevas equivalentes a las cuatro de §3 del runbook actual, aplicadas a `agt002-radar-scan.service` (instalar, no habilitar timer porque no existe) y al wrapper (actualizar el crontab de Hermes).

- [ ] **Step 2: Registrar el cierre en `CURRENT.md`**

Añadir §15 con: fecha, alcance (separación de procesos, sin flag nuevo, sin cambio de esquema), archivos creados/borrados/modificados (lista de este plan), estado de las unidades `systemd` (qué se instaló/habilitó y qué no, una vez ejecutada la Task 8), y la evidencia de la QA controlada (Task 8, último paso).
**Pendiente:** `CURRENT.md` §15 aún no se tocó. Depende de la evidencia de rollout de la Task 8 (instalación/QA en el host de producción), que todavía no se ejecutó — no marcar operacional hasta entonces.

- [ ] **Step 3: Commit**

```bash
git add docs/runbooks/agt002-radar-pipeline.md CURRENT.md
git commit -m "docs(radar): document the daily-scan/queue-worker split"
```

---

### Task 7: Verificación completa

**Files:** ninguno.

- [x] **Step 1: Suite focal**

Run: `node --test tests/agt002-radar-scan.test.mjs tests/agt002-radar-worker.test.mjs tests/agt002-radar-scan-systemd.test.mjs tests/agt002-radar-pipeline-systemd.test.mjs tests/agt002-radar-daily-export-wrapper.test.mjs`
Expected: PASS todos, 0 FAIL.
**Resultado real:** suite focal AGT-002/ops (nombres de archivo reales, ver nota Task 5 Step 2): 27 tests, 27 pass, 0 fail.

- [x] **Step 2: Suite completa**

Run: `node --test --test-force-exit tests/*.test.mjs`
Expected: mismo total de la Task 0 menos 1 archivo neto (se borró `tests/agt002-radar-pipeline.test.mjs`, se añadieron cuatro), todos PASS salvo los SKIP ya preexistentes documentados en la Task 0.
**Resultado real [CORREGIDO]:** `tests/agt002-radar-pipeline.test.mjs` **no** se borró (ver §5 A8/Global Constraints — se conserva como artefacto de compatibilidad), así que el total sube en vez de bajar: 1051 tests, 1050 pass, 0 fail, 1 skip, ~250.8 s de duración (línea base era 1046/1045/0/1).

- [x] **Step 3: Gates técnicos**

Run: `npm run check:backend-parity && npx tsc --noEmit && npm run build && git diff --check`
Expected: exit 0 en los cuatro. Ninguna tarea de este plan tocó `server/index.js`/`api/[...path].js`/`src/`, así que la paridad y el build no deberían moverse.
**Resultado real:** exit 0 en los cuatro (backend parity OK; `tsc --noEmit` limpio; build con deployment-safety y Vite en verde, sólo el warning preexistente de chunk >500 kB; `git diff --check` limpio).

- [ ] **Step 4: Confirmar cero referencias sueltas al módulo viejo**

Run: `grep -rln "createAgt002RadarPipeline\b" . --include='*.js' --include='*.mjs'`
Expected: sin salida.

- [ ] **Step 5: Confirmar que ningún artefacto de este plan ejecuta `systemctl`**

Run: `grep -rn "systemctl" ops/agt002-radar-scan/ ops/agt002-radar-pipeline/ | wc -l`
Expected: `0`.

- [x] **Step 6: Revisión crítica**

Ejecutar una revisión de código (p. ej. `/code-review` sobre el diff acumulado de las Tasks 1-6, o revisión humana equivalente) antes de abrir PR. Registrar hallazgos y su resolución antes de continuar a la Task 8.
**Resultado real:** revisión estática independiente completada. Sin hallazgos Critical ni fuga de lease. Un hallazgo real de robustez (severidad alta): el encolado contaba cualquier fallo de `enqueueJob` como rechazo por fila, incluidos outages genéricos de infraestructura, lo que podía enmascarar un fallo de plataforma como si fuera un simple conflicto de fila. Corregido: sólo el conflicto exacto `SQLSTATE 55000` (job activo) se tolera como rechazo por fila; cualquier fallo desconocido o de infraestructura hace fallar el scan. Se añadieron pruebas de regresión para ambos caminos; la suite focal (27/27) y la suite completa (1050/1051) pasan tras el fix.

---

### Task 8: Despliegue — commit ya revisado, PR/merge, instalación y QA controlada [CORREGIDO — orden de rollout fijado por autorización del 2026-08-28]

> **[CORREGIDO] Implementación autorizada.** El usuario aprobó, el 2026-08-28, ejecutar esta tarea a través de PR/despliegue (Global Constraints, punto "Implementación autorizada"): PR/merge y despliegue de código **no** requieren una autorización separada adicional a esta. Lo que sí sigue siendo una secuencia de actos sobre el host de producción —tocar `/etc/psi-comercial/`, ejecutar `systemctl`, editar el crontab de Hermes— se ejecuta **en el orden exacto fijado abajo**, y el cambio del cron (Step 8) queda gated detrás de la QA controlada (Steps 6-7): el cron viejo se preserva hasta entonces.

**Orden de rollout (fijo, no reordenar):** merge/despliegue de código → backup de unidades y crontab vivos → instalar unidad/env del scan → actualizar runner/unidad del timer → `daemon-reload` → QA manual del wrapper → observar un ciclo del `.timer` con la cola ya vacía → cambiar el comando/prompt del cron de Hermes.

**Pre-requisitos duros (bloquean el resto de la tarea si no se cumplen):**
- Task 7 completa, todo en verde.
- Commit realmente desplegado en el entorno operador reconfirmado contra el deployment vivo (no asumir `origin/main` — `CURRENT.md` §7.9).
- Confirmación de que `AGT002_RADAR_GATE` sigue en el mismo estado que tenía antes de esta tarea en cada entorno tocado (esta tarea no lo enciende ni lo apaga; sólo cambia qué código corre detrás del flag).

- [ ] **Step 1: Merge y despliegue de código**

Abrir PR con el diff de las Tasks 1-6, revisión aprobada (Task 7 Step 6), merge a `main` según el flujo normal del repositorio, y seguir el mecanismo de despliegue normal para que `/opt/psi-comercial/app` contenga el commit mergeado (esto reemplaza `agt002-radar-pipeline.js` por `agt002-radar-worker.js`/`agt002-radar-scan.js` en disco, y deja ya en disco el contenido nuevo de `ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs`). **No** reinicia por sí mismo el `.timer` ya habilitado: la próxima vez que dispare, ya ejecutará el worker nuevo.

- [ ] **Step 2: Backup de unidades y crontab vivos**

```bash
ts=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "/root/agt002-radar-backup-$ts"
cp -a /etc/psi-comercial/agt002-radar-pipeline.env "/root/agt002-radar-backup-$ts/"
cp -a /etc/systemd/system/agt002-radar-pipeline.service /etc/systemd/system/agt002-radar-pipeline.timer "/root/agt002-radar-backup-$ts/"
cp -a /root/.hermes/scripts/secop_psi_radar_export.sh "/root/agt002-radar-backup-$ts/"
crontab -l > "/root/agt002-radar-backup-$ts/crontab.before"
```

Expected: los cuatro artefactos copiados existen en el directorio de backup antes de continuar, incluida la definición de cron vigente (`crontab.before`).

- [ ] **Step 3: Instalar unidad/env del scan (sin habilitar)**

```bash
cp /opt/psi-comercial/app/ops/agt002-radar-scan/agt002-radar-scan.service /etc/systemd/system/agt002-radar-scan.service
cp /opt/psi-comercial/app/ops/agt002-radar-scan/env.example /etc/psi-comercial/agt002-radar-scan.env   # y completar secretos
```

Expected: los dos archivos existen en su destino; `systemctl` todavía no ha visto la unidad nueva (el `daemon-reload` es el Step 5).

- [ ] **Step 4: Actualizar runner/unidad del timer**

Confirmar que el contenido en disco de `/opt/psi-comercial/app/ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs` (desplegado en el Step 1) importa `createAgt002RadarWorker`, y que `/etc/systemd/system/agt002-radar-pipeline.service`/`.timer` **no cambiaron** frente al backup del Step 2 (diff vacío — es el mismo "repurpose de bajo riesgo" de la Task 4 Step 5: sólo cambia el contenido del archivo que el `ExecStart` ya ejecuta, no la unidad instalada).

- [ ] **Step 5: `daemon-reload`**

```bash
systemctl daemon-reload
```

Expected: `systemctl status agt002-radar-scan.service` la muestra cargada, `inactive (dead)`, **no** habilitada (`systemctl is-enabled agt002-radar-scan.service` responde `disabled` o `static`, nunca `enabled`).

- [ ] **Step 6: QA manual del wrapper — scan**

```bash
systemctl start agt002-radar-scan.service && journalctl -u agt002-radar-scan.service -n 50 --no-pager
```

Expected en el log: una línea JSON con `status` en `{'disabled','completed','unavailable'}` (nunca un `status` con `claim`/`agt`/`persist` en `stages`: el scan no los tiene). Si `AGT002_RADAR_GATE=true` en ese entorno, confirmar `stages` termina en `enqueue` y que `evaluated`/`survivors`/`enqueued`/`satisfied`/`rejected` son números coherentes con lo esperado para esa corrida.

- [ ] **Step 7: QA manual del wrapper — worker**

```bash
systemctl start agt002-radar-pipeline.service && journalctl -u agt002-radar-pipeline.service -n 50 --no-pager
```

Expected: si el scan del Step 6 encoló algo, `status:'completed'` con `job_id`/`preanalysis_run_id`, y **exactamente una** línea de log del puente Hetzner (una sola llamada al proveedor). Si no encoló nada, `status:'empty', stages:['claim']`. Steps 6-7 juntos son la QA manual del wrapper: cada mitad se ejerce por separado contra la unidad real antes de encadenarlas por cron.

- [ ] **Step 8: Observar un ciclo completo del `.timer` con la cola ya drenada — la prueba de "no scan/LLM"**

Tras el Step 7 haber drenado todo lo pendiente, esperar al siguiente disparo natural de `agt002-radar-pipeline.timer` (hasta 15 min + `RandomizedDelaySec=90`) sin intervención manual:

```bash
journalctl -u agt002-radar-pipeline.service --since "-20min" --no-pager
```

Expected: la corrida más reciente registra `{"status":"empty","stages":["claim"]}` (o el envoltorio JSON del runner alrededor de ese resultado), **cero** líneas de log del puente Hetzner, y ninguna consulta a `psi_public_tenders` más allá de la reclamación (verificable por ausencia de latencia/consultas adicionales en las métricas de Supabase de ese entorno, si están disponibles). Esta es la evidencia exigida por el encargo: un tick del temporizador que no escanea la fuente ni gasta presupuesto de modelo.

- [ ] **Step 9: Cambiar el comando/prompt del cron de Hermes — sólo tras QA en verde**

**Precondición dura:** Steps 6-8 en verde. Hasta este punto el cron sigue llamando `secop_psi_radar_export.sh` directamente, sin el wrapper — el cron viejo se preserva a propósito durante toda la QA (Steps 3-8).

Editar el crontab (o `cron.d`) para que la entrada que hoy llama a `/root/.hermes/scripts/secop_psi_radar_export.sh` directamente llame en su lugar a `ops/agt002-radar-scan/run-agt002-radar-daily-export.sh`. **El horario no cambia** (§8 del spec: sigue en días laborables 13:00 UTC = 08:00 `America/Bogota`). En la misma edición, actualizar el prompt asociado del cron para que distinga las tres semánticas de §10 del spec (fallo de export = nada persistido; fallo de scan = fuentes persistidas, gate/encolado falló; fallo del kick del worker = éxito con advertencia explícita, reintento por temporizador) y nunca reporte "no se persistió nada" ante un fallo posterior a la exportación. Verificar con `crontab -l` que el cambio quedó escrito antes de esperar a la siguiente corrida real.

- [ ] **Step 10: Declarar operacional**

Sólo tras Steps 6-9 en verde, actualizar `CURRENT.md` §15 (Task 6) con las cifras observadas (conteos de `evaluated`/`survivors`/`enqueued` del Step 6, resultado del Step 7, timestamp y salida exacta del Step 8, y confirmación de que el cron del Step 9 quedó escrito) y marcar la separación scan/worker como operativa.

---

### Task 9: Rollback

**Cuándo:** cualquier fallo en Task 8 Steps 6-9, o cualquier regresión observada después.

- [ ] **Step 1:** Restaurar el crontab de Hermes desde `crontab.before` (Task 8 Step 2) — vuelve a llamar `secop_psi_radar_export.sh` directamente, sin el wrapper. (Si el fallo ocurrió antes de la Task 8 Step 9, el cron viejo nunca se tocó y este paso es un no-op de verificación.)
- [ ] **Step 2:** `systemctl stop agt002-radar-scan.service` (si estuviera en ejecución; al ser `oneshot` normalmente ya habrá terminado) y no volver a iniciarlo.
- [ ] **Step 3:** Redesplegar el commit anterior a la Task 8 Step 1, de modo que `ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs` vuelva a ejecutar el `agt002-radar-pipeline.js` combinado original.
- [ ] **Step 4:** Restaurar `/etc/systemd/system/agt002-radar-pipeline.service`/`.timer` desde el backup de la Task 8 Step 2 si se hubieran tocado (en el flujo normal no deberían haber cambiado — Task 4 Step 5 lo verificó — pero el backup existe por si acaso) y `systemctl daemon-reload`.
- [ ] **Step 5:** Eliminar la unidad `agt002-radar-scan.service` de `/etc/systemd/system/` si se instaló, y `systemctl daemon-reload`.
- [ ] **Step 6:** **No tocar** `psi_agt002_radar_gate_evaluations`, `psi_agt002_radar_preanalysis_jobs` ni `psi_agt002_radar_preanalysis_runs`: son ledgers append-only y evidencia histórica válida independientemente de qué código los produjo. Ningún paso de este rollback borra ni modifica una fila.
- [ ] **Step 7:** Registrar en `CURRENT.md` el motivo del rollback y el estado resultante, con referencia a la evidencia que lo motivó (logs del Step fallido de la Task 8).
