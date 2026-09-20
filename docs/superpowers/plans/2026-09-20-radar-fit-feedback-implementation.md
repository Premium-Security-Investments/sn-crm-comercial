# Plan de implementación — `tender-fit-v1` y retroalimentación gobernada sin doble conteo

**Fecha:** 2026-09-20 · **Spec:** `docs/superpowers/specs/2026-09-20-radar-fit-feedback-design.md` · **Worktree:** `/workspace` (aislado).
Ningún paso usa `git add -A` ni `git add .`. Comandos verificados en `package.json`: `npm test` = `node --test tests/*.test.mjs`; `npm run build` = `check:deployment-safety && tsc && vite build`; `npm run check:backend-parity` = `node scripts/check_backend_parity.mjs`.

> Convención ya vigente: los `*.test.mjs` de este repo son scripts planos (sin `describe`/`test()`) con `assert.*` a nivel superior y mensaje descriptivo; `node --test` falla el archivo si algo lanza. Se sigue el mismo estilo aquí.

## Tarea 0 — Preflight (sin código)
1. `git rev-parse HEAD` y `git status --porcelain` — fijar el `HEAD` real y el estado del árbol.
2. Confirmar que, si aparecen en `git status --porcelain`, estos tres archivos **no se tocan ni se agregan** en ningún commit de este plan (corrección de producción 2026-09-20 ajena al alcance, spec §3.7): `agt002-radar-preanalysis-runtime.js`, `tests/agt002-radar-preanalysis-runtime.test.mjs`, `tests/agt002-radar-preanalysis-usage-authority.test.mjs`.
3. `node --version` para confirmar el runtime de `node --test`.

## Tarea 1 (RED) — Tests de `tender-fit-policy.js`
Crear `tests/tender-fit-policy.test.mjs` (el módulo aún no existe: el import falla y con él todo el archivo — rojo esperado).

```js
import assert from 'node:assert/strict';
import { TENDER_FIT_POLICY_VERSION, evaluateTenderFit } from '../tender-fit-policy.js';

const NOW = '2026-09-20T15:00:00.000Z';
function baseTender(o = {}) {
  return { title: 'Servicio de vigilancia armada', description: 'Guardas de seguridad física',
    value: 2_500_000_000, deadline_at: '2026-10-10', city: 'Bogotá', dept: 'Cundinamarca', category: 'Licitación pública', ...o };
}
const axis = (r, a) => r.reasons.find(x => x.axis === a)?.points;
const gaps = r => r.data_gaps.map(g => g.gap_id).sort();
assert.equal(TENDER_FIT_POLICY_VERSION, 'tender-fit-v1');
const alto = evaluateTenderFit(baseTender(), { nowIso: NOW });
assert.equal(alto.reasons.map(r => r.axis).join(','), 'servicio,escala_comercial,territorio,ventana_operativa');
assert.deepEqual(alto.feedback, { mode: 'evidence_only', applied_points: 0, policy: 'human_reviewed_version_only' });
assert.equal(alto.evaluated_at, NOW);
assert.equal(alto.band, 'alto'); assert.ok(alto.score >= 75);
// Eje servicio: sinónimos no se acumulan; física gana sobre electrónica; sin servicio -> bajo forzado
assert.equal(axis(evaluateTenderFit(baseTender({ title: 'Vigilancia armada y vigilancia privada' }), { nowIso: NOW }), 'servicio'), 50);
assert.equal(axis(evaluateTenderFit(baseTender({ title: 'CCTV y videovigilancia', description: '' }), { nowIso: NOW }), 'servicio'), 40);
assert.equal(axis(evaluateTenderFit(baseTender({ title: 'Vigilancia armada y CCTV', description: '' }), { nowIso: NOW }), 'servicio'), 50);
const sinServicio = evaluateTenderFit(baseTender({ title: 'Suministro de papelería', description: 'Oficina' }), { nowIso: NOW });
assert.equal(axis(sinServicio, 'servicio'), 0);
assert.equal(sinServicio.band, 'bajo', 'sin término de servicio, bajo gana pase lo que pase en los demás ejes');
assert.equal(sinServicio.participation_hint, 'por_definir');
// Eje escala comercial: cada banda de valor + gap crítico + alianza_probable
for (const [value, points] of [[undefined, 0], [0, 0], [-1, 0], [49_999_999, 0], [50_000_000, 6], [499_999_999, 6],
  [500_000_000, 12], [999_999_999, 12], [1_000_000_000, 20], [9_999_999_999, 20], [10_000_000_000, 16], [30_000_000_000, 16], [30_000_000_001, 10]]) {
  assert.equal(axis(evaluateTenderFit(baseTender({ value }), { nowIso: NOW }), 'escala_comercial'), points, `valor ${value} -> ${points}`);
}
assert.ok(gaps(evaluateTenderFit(baseTender({ value: 0 }), { nowIso: NOW })).includes('valor_no_reportado'));
assert.ok(gaps(evaluateTenderFit(baseTender({ value: undefined }), { nowIso: NOW })).includes('valor_no_reportado'));
assert.equal(evaluateTenderFit(baseTender({ value: 35_000_000_000 }), { nowIso: NOW }).participation_hint, 'alianza_probable');
// Eje territorio: foco (city o dept) / otro conocido / ausente
assert.equal(axis(evaluateTenderFit(baseTender({ city: 'Bogotá', dept: '' }), { nowIso: NOW }), 'territorio'), 15);
assert.equal(axis(evaluateTenderFit(baseTender({ city: '', dept: 'Antioquia' }), { nowIso: NOW }), 'territorio'), 15);
const otro = evaluateTenderFit(baseTender({ city: 'Cali', dept: 'Valle del Cauca' }), { nowIso: NOW });
assert.equal(axis(otro, 'territorio'), 0); assert.equal(gaps(otro).includes('territorio_no_reportado'), false);
const sinTerr = evaluateTenderFit(baseTender({ city: '', dept: '' }), { nowIso: NOW });
assert.equal(axis(sinTerr, 'territorio'), 0); assert.ok(gaps(sinTerr).includes('territorio_no_reportado'));
assert.equal(sinTerr.confidence, 'media'); assert.notEqual(sinTerr.band, 'por_validar');
// Eje ventana operativa: cada banda de días + vencida (no es gap) + ausente (sí es gap)
for (const [deadline_at, points] of [['2026-10-06', 15], ['2026-10-05', 10], ['2026-09-28', 10], ['2026-09-27', 4], ['2026-09-20', 4], ['2026-09-19', 0]]) {
  assert.equal(axis(evaluateTenderFit(baseTender({ deadline_at }), { nowIso: NOW }), 'ventana_operativa'), points, `deadline_at ${deadline_at} -> ${points}`);
}
const vencida = evaluateTenderFit(baseTender({ deadline_at: '2026-09-19' }), { nowIso: NOW });
assert.equal(gaps(vencida).includes('fecha_cierre_no_verificable'), false); assert.notEqual(vencida.band, 'por_validar');
const sinFecha = evaluateTenderFit(baseTender({ deadline_at: undefined }), { nowIso: NOW });
assert.ok(gaps(sinFecha).includes('fecha_cierre_no_verificable')); assert.equal(axis(sinFecha, 'ventana_operativa'), 0);
// Bandas: precedencia
assert.equal(evaluateTenderFit(baseTender({ value: 0 }), { nowIso: NOW }).band, 'por_validar');
assert.equal(evaluateTenderFit(baseTender({ deadline_at: null }), { nowIso: NOW }).band, 'por_validar');
assert.equal(evaluateTenderFit(baseTender({ value: 0, title: 'Suministro de papelería', description: '' }), { nowIso: NOW }).band, 'bajo', 'sin servicio, bajo gana incluso con brecha crítica de valor');
const medio = evaluateTenderFit(baseTender({ title: 'CCTV', description: '', value: 200_000_000, city: 'Cali', dept: 'Valle del Cauca', deadline_at: '2026-09-29' }), { nowIso: NOW });
assert.equal(medio.band, 'medio');
const bajoPorScore = evaluateTenderFit(baseTender({ title: 'CCTV', description: '', value: 1, city: '', dept: '', deadline_at: '2026-09-25' }), { nowIso: NOW });
assert.ok(bajoPorScore.score < 45 && bajoPorScore.data_gaps.every(g => g.severity !== 'critical'));
assert.equal(bajoPorScore.band, 'bajo', 'score bajo sin brechas críticas es bajo, no por_validar');
// Determinismo
assert.equal(JSON.stringify(evaluateTenderFit(baseTender(), { nowIso: NOW })), JSON.stringify(evaluateTenderFit(baseTender(), { nowIso: NOW })));
// Totalidad sobre entradas parciales / forma inválida
assert.doesNotThrow(() => evaluateTenderFit({}, { nowIso: NOW }));
assert.equal(evaluateTenderFit({}, { nowIso: NOW }).band, 'bajo');
assert.throws(() => evaluateTenderFit(null, { nowIso: NOW }), /invalid|inválid/i);
assert.throws(() => evaluateTenderFit(42, { nowIso: NOW }), /invalid|inválid/i);
assert.throws(() => evaluateTenderFit(baseTender(), { nowIso: 'no-es-una-fecha' }), /invalid|inválid/i);
console.log('tender-fit-policy: OK');
```

**Ejecutar y confirmar rojo:** `node --test tests/tender-fit-policy.test.mjs`.

## Tarea 2 (GREEN + REFACTOR) — Implementar `tender-fit-policy.js`
Crear `tender-fit-policy.js` en la raíz (mismo nivel que `tender-relevance-terms.js`) con `TENDER_FIT_POLICY_VERSION`, `evaluateTenderFit(tender, { nowIso })` y las tablas de la spec §7: dos subconjuntos físico/electrónico derivados de `TENDER_CORE_SERVICE_TERMS` (vía `extractTenderCoreServiceTerms` de `./tender-relevance-terms.js`), cálculo de días con `Intl.DateTimeFormat('en', { timeZone: 'America/Bogota', ... })` reimplementado localmente (no importar de `radarUtils.ts`/`agt002-radar-gate.js`, spec A4), alias de territorio duplicados localmente (no importar `TENDER_SN_REGIONS`), y bandas/confianza/`participation_hint`/`data_gaps`/`feedback` fijo. Sin red, reloj de sistema ni DB. Tras el verde, refactorizar sólo si hay duplicación evidente entre tablas de puntaje (p. ej. un helper `pointsForAxis`), sin cambiar comportamiento observable.

**Ejecutar y confirmar verde:** `node --test tests/tender-fit-policy.test.mjs`.

## Tarea 3 (RED) — Integración backend
Crear `tests/tender-fit-backend-projection.test.mjs`. Precedente ya vigente en este repo (`tests/agt002-radar-relevance-terms.test.mjs:12`): `await import('../server/index.js')` directo pese a `app.listen` condicionado a `!process.env.VERCEL`; se sigue el mismo patrón, sin introducir uno nuevo, para ambos backends:

```js
import assert from 'node:assert/strict';
const NOW = '2026-09-20T15:00:00.000Z';
for (const path of ['../server/index.js', '../api/[...path].js']) {
  const { dbTenderToPublic, tenderScoreFilters, compareTenderRadarRows, radarPayload } = await import(path);
  const row = { stable_key: 's1', source: 'SECOP II', section: 'hacer', entity: 'E', title: 'Vigilancia armada', description: '',
    value: 2_500_000_000, deadline_at: '2026-10-10', city: 'Bogotá', dept: 'Cundinamarca', category: 'Licitación', score: 190, reasons: [], risks: [] };
  const pub = dbTenderToPublic(row);
  assert.equal(pub.score, 190, `${path}: score legado intacto`);
  assert.equal(pub.fit.policy_version, 'tender-fit-v1', `${path}: fit nuevo`);
  assert.equal(pub.fit.band, 'alto', `${path}: fit se deriva de la fila, no del score legado`);
  assert.deepEqual(tenderScoreFilters, ['todas', 'alto', 'medio', 'por_validar', 'bajo'], `${path}: whitelist score_filter`);
  const altoRow = { internal_status: 'nueva', section: 'revisar', days: 20, score: 10, fit: { band: 'alto', score: 80 } };
  const medioRow = { internal_status: 'nueva', section: 'hacer', days: 1, score: 999, fit: { band: 'medio', score: 99 } };
  assert.ok(compareTenderRadarRows(altoRow, medioRow) < 0, `${path}: banda fit domina sobre score legado`);
  const payload = radarPayload([{ ...pub, id: 's1' }], NOW, 'supabase', []);
  assert.equal(payload.totals.all, 1, `${path}: totals existentes intactos`);
  assert.deepEqual(payload.totals.fit, { alto: 1, medio: 0, porValidar: 0, bajo: 0, sinDatos: 0 }, `${path}: totals.fit nuevo`);
  assert.equal(radarPayload([{ id: 'x', section: 'hacer', score: 10 }], NOW, 'live', []).totals.fit.sinDatos, 1, `${path}: fila sin fit cuenta en sinDatos`);
}
console.log('tender-fit-backend-projection: OK');
```

**Nota:** `readPersistedTenderRadar` ordena hoy con un `.sort(...)` inline no exportado, rodeado de acceso a DB. Para probar el comparador sin mockear Supabase, la Tarea 4 lo extrae a `export function compareTenderRadarRows(a, b)` (mismo criterio que spec §8.2: status → banda fit → score fit → sección → urgencia → score legado), reutilizado en `.sort(compareTenderRadarRows)`. Extracción sin cambio de comportamiento, igual que el `export` ya aplicado a `dbTenderToPublic`/`scoreTender`/`isTenderTrackable`.

**Ejecutar y confirmar rojo:** `node --test tests/tender-fit-backend-projection.test.mjs`.

## Tarea 4 (GREEN) — Implementar en `server/index.js`
1. Import nuevo junto a los demás imports de nivel raíz: `import { evaluateTenderFit } from '../tender-fit-policy.js';` (verificar la profundidad relativa real contra cómo `server/index.js` ya importa otro módulo de raíz, p. ej. `tender-relevance-terms.js`, antes de fijar la ruta final).
2. `function dbTenderToPublic(row) {` (línea ~1577) → `export function dbTenderToPublic(row) {`, agregando `fit: evaluateTenderFit(row, { nowIso: new Date().toISOString() }),` sin tocar ninguna clave existente.
3. `const tenderScoreFilters = [...]` (línea ~1083) → `export const tenderScoreFilters = ['todas','alto','medio','por_validar','bajo'];`.
4. Antes de `readPersistedTenderRadar` (línea ~1633), agregar:
   ```js
   const fitBandOrder = { alto: 0, medio: 1, por_validar: 2, bajo: 3 };
   const tenderRadarUrgency = t => t.days === null || t.days === undefined ? Number.POSITIVE_INFINITY : t.days;
   export function compareTenderRadarRows(a, b) {
     const statusOrder = { nueva: 0, en_revision: 1, convertida_oportunidad: 2, descartada: 3 };
     const sectionOrder = { hacer: 0, revisar: 1, prioridad_baja: 2 };
     return (statusOrder[a.internal_status] ?? 9) - (statusOrder[b.internal_status] ?? 9)
       || (fitBandOrder[a.fit?.band] ?? 9) - (fitBandOrder[b.fit?.band] ?? 9)
       || (b.fit?.score ?? 0) - (a.fit?.score ?? 0)
       || sectionOrder[a.section] - sectionOrder[b.section]
       || tenderRadarUrgency(a) - tenderRadarUrgency(b) || b.score - a.score;
   }
   ```
   y reemplazar el `.sort((a,b) => {...})` inline (línea ~1685-1689) por `.sort(compareTenderRadarRows)`.
5. `function radarPayload(...)` (línea ~1547) → `export function radarPayload(...)`, agregando el sub-objeto `totals.fit` de la spec §8.3 sin tocar ninguna clave existente de `totals`.

No tocar `persistTenderRadar`, `scoreTender`, `classifyTenderSection` ni las secciones `hacer`/`revisar`/`prioridad_baja` (fuera de alcance, spec §4). **Ejecutar y confirmar verde:** `node --test tests/tender-fit-backend-projection.test.mjs`.

## Tarea 5 — Paridad byte a byte
Aplicar exactamente los mismos cinco cambios de la Tarea 4 en `api/[...path].js` (mismas líneas aproximadas: `1083`, `1547`, `1577`, `1633`, `1685-1689`). `npm run check:backend-parity && node --test tests/tender-fit-backend-projection.test.mjs`

## Tarea 6 (RED) — Frontend mínimo
Crear `tests/tender-fit-frontend.test.mjs`, patrón ya usado en `tests/tender-radar-converted-visible.test.mjs` (bundle de `radarUtils.ts` con `esbuild` + `readFileSync` para aserciones de forma sobre `types.ts`/`TenderRadarView.tsx`):

```js
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { buildSync } from 'esbuild';
const types = readFileSync(new URL('../src/tenders/types.ts', import.meta.url), 'utf8');
const view = readFileSync(new URL('../src/tenders/TenderRadarView.tsx', import.meta.url), 'utf8');
const bundled = buildSync({ entryPoints: [new URL('../src/tenders/radarUtils.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false });
const { filterRadarTenders, sortTenderCards } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`);
assert.match(types, /TenderScoreFilter = 'todas' \| 'alto' \| 'medio' \| 'por_validar' \| 'bajo'/);
assert.match(types, /fit\?: TenderFitProjection/);
const baseFilters = { query: '', source: 'todas', region: 'todas', deadline: 'todas', value: 'todas', score: 'todas', section: 'todas', internalStatus: 'todas' };
const conFit = { id: 'a', source: 'S', entity: 'E', title: 'T', section: 'hacer', score: 10, value: 1, fit: { band: 'por_validar', score: 40 } };
const sinFit = { id: 'b', source: 'S', entity: 'E', title: 'T', section: 'hacer', score: 80, value: 1 };
assert.deepEqual(filterRadarTenders([conFit], { ...baseFilters, score: 'por_validar' }).map(t => t.id), ['a']);
assert.deepEqual(filterRadarTenders([conFit], { ...baseFilters, score: 'alto' }), [], 'con fit no debe leer el score legado');
assert.deepEqual(filterRadarTenders([sinFit], { ...baseFilters, score: 'alto' }).map(t => t.id), ['b'], 'sin fit cae al umbral legado score>=70');
assert.deepEqual(filterRadarTenders([sinFit], { ...baseFilters, score: 'por_validar' }), [], 'sin fit, por_validar nunca coincide');
const alto = { ...conFit, id: 'alto', fit: { band: 'alto', score: 90 } };
const bajo = { ...conFit, id: 'bajo', fit: { band: 'bajo', score: 10 } };
assert.deepEqual(sortTenderCards([bajo, alto], 'score', 'desc').map(t => t.id), ['alto', 'bajo']);
assert.deepEqual(sortTenderCards([{ ...sinFit, id: 'la', score: 90 }, { ...sinFit, id: 'lb', score: 10 }], 'score', 'desc').map(t => t.id), ['la', 'lb'], 'fallback legado sin fit');
assert.match(view, /<option value="medio">Medio<\/option><option value="por_validar">Por validar<\/option><option value="bajo">Bajo<\/option>/);
console.log('tender-fit-frontend: OK');
```

**Ejecutar y confirmar rojo:** `node --test tests/tender-fit-frontend.test.mjs`.

## Tarea 7 (GREEN) — Implementar frontend mínimo
1. `src/tenders/types.ts`: tipos de spec §9.1 (`TenderFitBand`, `TenderFitConfidence`, `TenderFitParticipationHint`, `TenderFitReason`, `TenderFitDataGap`, `TenderFitFeedback`, `TenderFitProjection`); `TenderScoreFilter` gana `'por_validar'`; `PublicTender` gana `fit?: TenderFitProjection`; `TenderRadarPayload['totals']` gana `fit?: {...}` opcional.
2. `src/tenders/radarUtils.ts`: reescribir la condición `score` de `filterRadarTenders` (línea ~116-130) y la rama `key === 'score'` de `sortTenderCards` (línea ~132-139) según spec §9.2/§9.3.
3. `src/tenders/TenderRadarView.tsx` línea ~131: insertar `<option value="por_validar">Por validar</option>` entre `medio` y `bajo`, mismo `<select>`, sin cambios de layout.
4. (Opcional, spec §9.5) línea ~136: anotar el badge con la banda si `tender.fit` existe; si se implementa, añadir su aserción a la Tarea 6.

**Ejecutar y confirmar verde:** `node --test tests/tender-fit-frontend.test.mjs` y `npx tsc --noEmit`.

## Tarea 8 (RED) — Colapso de observaciones por precedencia
Crear `tests/agt002-radar-learning-observation-collapse.test.mjs`:

```js
import assert from 'node:assert/strict';
import { AGT002_RADAR_LEARNING_OBSERVATION_PRECEDENCE, collapseAgt002RadarLearningObservationsByTender as collapse } from '../agt002-radar-learning-projection.js';
const obs = (type, id, tenderId, at) => ({ observation_id: `${type}:${id}`, tender_id: tenderId, decided_at: at, signal_polarity: 'favorable', evidence: [{ record_id: id, evidence_type: type }] });
assert.deepEqual([...AGT002_RADAR_LEARNING_OBSERVATION_PRECEDENCE], ['offer_outcome', 'human_decision', 'converted_tender', 'canonical_analysis']);
const cuatro = [obs('converted_tender', '1', 't1', '2026-08-01'), obs('canonical_analysis', '2', 't1', '2026-08-02'), obs('human_decision', '3', 't1', '2026-08-03'), obs('offer_outcome', '4', 't1', '2026-08-04')];
assert.deepEqual(collapse(cuatro).map(o => o.observation_id), ['offer_outcome:4'], 'offer_outcome supera a las otras tres');
assert.deepEqual(collapse(cuatro.filter(o => !o.observation_id.startsWith('offer_outcome'))).map(o => o.observation_id), ['human_decision:3'], 'sin offer_outcome, gana human_decision');
assert.deepEqual(collapse(cuatro.filter(o => o.observation_id.startsWith('converted') || o.observation_id.startsWith('canonical'))).map(o => o.observation_id), ['converted_tender:1'], 'conversión supera análisis canónico');
const dosLic = [obs('offer_outcome', '10', 't1', '2026-08-01'), obs('offer_outcome', '20', 't2', '2026-08-01')];
assert.deepEqual(collapse(dosLic).map(o => o.observation_id), ['offer_outcome:10', 'offer_outcome:20'], 'a lo sumo una observación por tender_id, otras licitaciones no se pierden');
const empate = [obs('human_decision', 'a', 't1', '2026-08-01'), obs('human_decision', 'b', 't1', '2026-08-05')];
assert.deepEqual(collapse(empate).map(o => o.observation_id), ['human_decision:b'], 'empate de tipo: gana decided_at más reciente');
assert.equal(JSON.stringify(collapse(dosLic)), JSON.stringify(collapse(dosLic)), 'determinismo byte a byte');
assert.deepEqual(collapse(dosLic).map(o => o.observation_id), [...collapse(dosLic).map(o => o.observation_id)].sort(), 'salida ordenada por observation_id');
console.log('agt002-radar-learning-observation-collapse: OK');
```

**Ejecutar y confirmar rojo:** `node --test tests/agt002-radar-learning-observation-collapse.test.mjs`.

## Tarea 9 (GREEN) — Implementar el colapso
En `agt002-radar-learning-projection.js` (sin tocar `projectAgt002RadarLearningObservations`, spec §10.1), agregar al final:

```js
export const AGT002_RADAR_LEARNING_OBSERVATION_PRECEDENCE = Object.freeze(['offer_outcome', 'human_decision', 'converted_tender', 'canonical_analysis']);
export function collapseAgt002RadarLearningObservationsByTender(precedents) {
  const rank = id => { const i = AGT002_RADAR_LEARNING_OBSERVATION_PRECEDENCE.indexOf(String(id).split(':')[0]); return i === -1 ? AGT002_RADAR_LEARNING_OBSERVATION_PRECEDENCE.length : i; };
  const winners = new Map();
  for (const item of precedents) {
    const current = winners.get(item.tender_id);
    if (!current) { winners.set(item.tender_id, item); continue; }
    const [a, b] = [rank(item.observation_id), rank(current.observation_id)];
    if (a < b) { winners.set(item.tender_id, item); continue; }
    if (a > b) continue;
    const [d1, d2] = [item.decided_at || '', current.decided_at || ''];
    if (d1 !== d2) { if (d1 > d2) winners.set(item.tender_id, item); continue; }
    if (item.observation_id > current.observation_id) winners.set(item.tender_id, item);
  }
  return [...winners.values()].sort((a, b) => a.observation_id.localeCompare(b.observation_id));
}
```

**Ejecutar y confirmar verde:** `node --test tests/agt002-radar-learning-observation-collapse.test.mjs tests/agt002-radar-learning-retrieval.test.mjs tests/agt002-radar-learning-projection.test.mjs` (las dos últimas son regresión: confirmar que el retrieval sigue sin cambios, spec §10.2).

## Tarea 10 (RED) — Auditoría de cohorte de sólo lectura
Crear `tests/tender-fit-cohort-audit.test.mjs`, guarda de forma como en `tests/agt002-radar-historical-audit.test.mjs:170-177` más un caso funcional con `fetchImpl` doble:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runTenderFitCohortAudit } from '../scripts/tender-fit-cohort-audit.mjs';

const source = readFileSync(new URL('../scripts/tender-fit-cohort-audit.mjs', import.meta.url), 'utf8');
assert.equal(/method:\s*'(POST|PATCH|PUT|DELETE)'/.test(source), false, 'no debe escribir');
assert.equal(source.includes('--apply'), false, 'no debe aceptar --apply');
assert.equal(/psi_record_|psi_append_|psi_enqueue_|psi_claim_|psi_complete_|psi_fail_/.test(source), false, 'no debe llamar RPC de escritura');
const requests = [];
async function fetchImpl(url, options) {
  requests.push({ method: options?.method || 'GET' });
  if (String(url).includes('psi_public_tenders')) return { ok: true, json: async () => [{ id: 't1', title: 'Vigilancia armada', description: '', value: 2_500_000_000, deadline_at: '2026-10-10', city: 'Bogotá', dept: 'Cundinamarca', category: 'Licitación', score: 190 }] };
  return { ok: true, json: async () => [] };
}
const report = await runTenderFitCohortAudit({ baseUrl: 'https://supabase.example.test', serviceKey: 'k', nowIso: '2026-09-20T15:00:00.000Z', fetchImpl });
assert.ok(requests.every(r => r.method === 'GET'));
assert.equal(report.legacy_distribution.alto, 1);
assert.equal(typeof report.fit_distribution.alto, 'number');
assert.ok(report.observed_context.length <= report.cohort_size, 'a lo sumo una fila de contexto por licitación');
console.log('tender-fit-cohort-audit: OK');
```

**Ejecutar y confirmar rojo:** `node --test tests/tender-fit-cohort-audit.test.mjs`.

## Tarea 11 (GREEN) — Implementar `scripts/tender-fit-cohort-audit.mjs`
Copiar la estructura de `scripts/agt002-radar-gate-historical-audit.mjs` (`readAll` REST paginado, `loadEnvFile`, `main()` imprime JSON y fija `process.exitCode`). Exportar `runTenderFitCohortAudit({ baseUrl, serviceKey, nowIso, fetchImpl })`:
1. Leer `psi_public_tenders` completo con `readAll`.
2. Por fila: `legacy_band` con el umbral actual (`score>=70` alto, `40<=score<70` medio, si no bajo) y `evaluateTenderFit(row, { nowIso })` (`../tender-fit-policy.js`).
3. Leer las cuatro fuentes con `projectAgt002RadarLearningObservations` (`../agt002-radar-learning-projection.js`) y colapsar con `collapseAgt002RadarLearningObservationsByTender`.
4. Emitir `{ cohort_size, legacy_distribution: {alto,medio,bajo}, fit_distribution: {alto,medio,por_validar,bajo}, observed_context: [...] }`; el cruce contra `signal_polarity` es sólo descriptivo, nunca ajusta pesos (spec §10.3).
5. Sin `POST`/`PATCH`/`PUT`/`DELETE`, sin `--apply`, sin RPC de escritura.

**Ejecutar y confirmar verde:** `node --test tests/tender-fit-cohort-audit.test.mjs`.

## Tarea 12 — Verificación integral
```
node --test tests/tender-fit-policy.test.mjs tests/tender-fit-backend-projection.test.mjs tests/tender-fit-frontend.test.mjs tests/agt002-radar-learning-observation-collapse.test.mjs tests/tender-fit-cohort-audit.test.mjs
node --test tests/agt002-radar-learning-projection.test.mjs tests/agt002-radar-learning-retrieval.test.mjs tests/tender-search-profiles.test.mjs tests/tender-radar-converted-visible.test.mjs tests/tender-radar-backend-dedup.test.mjs tests/agt002-radar-relevance-terms.test.mjs
npm run check:backend-parity && npm test
```
Si `npm test` (611+ archivos) se cuelga o tarda demasiado por contención de puerto/DB entre archivos, reintentar con `node --test --test-concurrency=1 tests/*.test.mjs`. Luego `npm run build && npm run check:backend-parity && git diff --check`.
Confirmar antes de continuar: sin migración nueva en `supabase/migrations/`, sin bandeja/vista/pestaña nueva en `src/tenders/`, sin escritura a `internal_status`/`converted_opportunity_id`, sin invocación a `/api/tender-convert` ni `psi_convert_tender_to_opportunity`, sin recomendación GO/NO-GO en ningún archivo tocado; `git diff --stat` contra el `HEAD` de la Tarea 0 debe listar únicamente los archivos de este plan.

## Tarea 13 — Revisión de código independiente (sólo lectura)
Invocar el skill `code-review` sobre el diff acumulado (nivel `medium` o superior) antes de cualquier commit. Si hay hallazgos, corregir y repetir Tareas 12-13 hasta revisión limpia o aceptación humana explícita de lo restante. No escribe nada; es puerta de calidad.

## Tarea 14 — Commit (con confirmación humana antes de ejecutar)
`git add` con rutas explícitas únicamente, nunca `-A`/`.`:
```
git add tender-fit-policy.js tests/tender-fit-policy.test.mjs \
  server/index.js api/[...path].js tests/tender-fit-backend-projection.test.mjs \
  src/tenders/types.ts src/tenders/radarUtils.ts src/tenders/TenderRadarView.tsx tests/tender-fit-frontend.test.mjs \
  agt002-radar-learning-projection.js tests/agt002-radar-learning-observation-collapse.test.mjs \
  scripts/tender-fit-cohort-audit.mjs tests/tender-fit-cohort-audit.test.mjs
git status --porcelain
```
Revisar la salida: los tres archivos de la Tarea 0.2 no deben aparecer en el commit. Commitear sólo con autorización explícita del usuario en ese punto de la conversación; no `push`, no tocar `main`.

## Tarea 15 — Deploy y readback (puerta final, fuera de este plan)
No se ejecuta como parte de la implementación. Producción no se asume igual a `main`/`HEAD` de este worktree: cualquier deploy posterior exige leer el SHA realmente desplegado y hacer *readback* contra el entorno vivo antes de dar el cambio por completo. Requiere gate y autorización humana explícita separada, en una conversación posterior a este plan.
