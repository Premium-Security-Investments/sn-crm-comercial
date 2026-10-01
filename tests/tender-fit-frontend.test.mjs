import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { buildSync } from 'esbuild';
const types = readFileSync(new URL('../src/tenders/types.ts', import.meta.url), 'utf8');
const view = readFileSync(new URL('../src/tenders/TenderRadarView.tsx', import.meta.url), 'utf8');
const bundled = buildSync({ entryPoints: [new URL('../src/tenders/radarUtils.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false });
const { filterRadarTenders, sortTenderCards, tenderFitReasonDetails } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`);
assert.match(types, /TenderScoreFilter = 'todas' \| 'alto' \| 'medio' \| 'por_validar' \| 'bajo'/);
assert.match(types, /fit\?: TenderFitProjection/);
const reasonType = types.match(/export type TenderFitReason = \{[^}]*\};/);
assert.ok(reasonType, 'TenderFitReason debe estar declarado');
assert.match(reasonType[0], /axis: string/);
assert.match(reasonType[0], /points: number/);
assert.match(reasonType[0], /code: string/, 'TenderFitReason debe exponer code (código estable del motivo)');
assert.match(reasonType[0], /detail: string/);
assert.match(reasonType[0], /source: string/, 'TenderFitReason debe exponer source (campo de origen del motivo)');
assert.match(reasonType[0], /critical\?: boolean/, 'TenderFitReason debe exponer critical opcional (compatibilidad con filas antiguas sin el campo)');
assert.match(reasonType[0], /impact_priority\?: number/, 'TenderFitReason debe exponer impact_priority opcional (compatibilidad con filas antiguas sin el campo)');
const dataGapType = types.match(/export type TenderFitDataGap = \{[^}]*\};/);
assert.ok(dataGapType, 'TenderFitDataGap debe estar declarado');
assert.match(dataGapType[0], /gap_id: string/);
assert.match(dataGapType[0], /field: string/);
assert.match(dataGapType[0], /severity: 'critical' \| 'noncritical'/);
assert.match(dataGapType[0], /detail: string/, 'TenderFitDataGap debe exponer detail (explicación legible de la brecha)');
assert.match(dataGapType[0], /source: string/, 'TenderFitDataGap debe exponer source (campo de origen de la brecha)');
assert.match(dataGapType[0], /impact_priority\?: number/, 'TenderFitDataGap debe exponer impact_priority opcional (compatibilidad con filas antiguas sin el campo)');
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
// Regresión: el Radar debe abrir con "Mayor encaje primero" (sort='score', direction='desc'), no con el legado "Cierre más próximo" (sort='deadline', direction='asc').
assert.match(view, /const \[sort, setSort\] = useState<TenderSortKey>\('score'\);/, 'Radar debe inicializar sort en "score" (Mayor encaje primero) por defecto');
assert.match(view, /const \[direction, setDirection\] = useState<'asc' \| 'desc'>\('desc'\);/, 'Radar debe inicializar direction en "desc" por defecto');
assert.doesNotMatch(view, /const \[sort, setSort\] = useState<TenderSortKey>\('deadline'\);/, 'Radar no debe inicializar sort en "deadline" (regresión al valor legado)');
assert.doesNotMatch(view, /const \[direction, setDirection\] = useState<'asc' \| 'desc'>\('asc'\);/, 'Radar no debe inicializar direction en "asc" (regresión al valor legado)');
assert.match(view, /<option value="score:desc">Mayor encaje primero<\/option>/, 'La opción "Mayor encaje primero" debe seguir existiendo en el selector de Orden');
assert.match(view, /<option value="deadline:asc">Cierre más próximo<\/option>/, 'La opción "Cierre más próximo" debe seguir existiendo (seleccionable manualmente) tras cambiar el valor por defecto');

// tenderFitReasonDetails (tender-fit-v2): ordena por impact_priority ascendente, no por puntos,
// y deja las filas legadas sin impact_priority al final preservando su orden original.
const reasonHighPriority = { axis: 'tiempo', points: 0, code: 'plazo_insuficiente', detail: 'Plazo insuficiente', source: 'deadline_at', impact_priority: 0 };
const reasonMidPriority = { axis: 'servicio', points: 50, code: 'servicio_hibrida', detail: 'Servicio híbrido de alto puntaje', source: 'title', impact_priority: 1 };
const reasonLegacyNoPriority = { axis: 'valor', points: 999, code: 'legacy_sin_impact_priority', detail: 'Razón legada sin impact_priority', source: 'value' };
const fitOrdenadoPorImpacto = { band: 'alto', reasons: [reasonLegacyNoPriority, reasonMidPriority, reasonHighPriority], data_gaps: [] };
assert.deepEqual(
  tenderFitReasonDetails(fitOrdenadoPorImpacto),
  [reasonHighPriority.detail, reasonMidPriority.detail],
  'tenderFitReasonDetails debe ordenar por impact_priority ascendente (no por puntos) y dejar fuera a la razón legada sin impact_priority, aunque tenga más puntos',
);

const legacyA = { axis: 'servicio', points: 5, code: 'legacy_a', detail: 'Legada A', source: 'title' };
const legacyB = { axis: 'valor', points: 1, code: 'legacy_b', detail: 'Legada B', source: 'value' };
const fitSoloLegado = { band: 'alto', reasons: [legacyA, legacyB], data_gaps: [] };
assert.deepEqual(
  tenderFitReasonDetails(fitSoloLegado),
  [legacyA.detail, legacyB.detail],
  'sin impact_priority en ninguna razón, se preserva el orden original del arreglo',
);

const gapHighPriority = { gap_id: 'g1', field: 'deadline_at', severity: 'critical', detail: 'Brecha de plazo insuficiente', source: 'deadline_at', impact_priority: 0 };
const gapLegacy = { gap_id: 'g2', field: 'value', severity: 'critical', detail: 'Brecha legada sin impact_priority', source: 'value' };
const fitGapsOrdenados = { band: 'por_validar', reasons: [], data_gaps: [gapLegacy, gapHighPriority] };
assert.deepEqual(
  tenderFitReasonDetails(fitGapsOrdenados),
  [gapHighPriority.detail, gapLegacy.detail],
  'en por_validar, tenderFitReasonDetails también ordena data_gaps por impact_priority ascendente, dejando las brechas legadas sin impact_priority al final',
);

console.log('tender-fit-frontend: OK');
