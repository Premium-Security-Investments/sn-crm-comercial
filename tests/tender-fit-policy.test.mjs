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
// Horas/offsets malformados: deben tratarse como fecha de cierre no verificable, no como fecha válida
const horaInvalida = evaluateTenderFit(baseTender({ deadline_at: '2026-09-20T99:99Z' }), { nowIso: NOW });
assert.ok(gaps(horaInvalida).includes('fecha_cierre_no_verificable'), 'hora/minuto fuera de rango debe ser brecha crítica de fecha de cierre');
assert.equal(horaInvalida.band, 'por_validar', 'hora fuera de rango debe producir la banda por_validar');
const offsetInvalido = evaluateTenderFit(baseTender({ deadline_at: '2026-09-20T12:00+25:00' }), { nowIso: NOW });
assert.ok(gaps(offsetInvalido).includes('fecha_cierre_no_verificable'), 'offset de huso horario fuera de rango debe ser brecha crítica de fecha de cierre');
assert.equal(offsetInvalido.band, 'por_validar', 'offset fuera de rango debe producir la banda por_validar');
// El máximo offset UTC real es +14:00; +14:01 excede el rango real aunque tenga horas/minutos "numéricamente" válidos
const offset1401 = evaluateTenderFit(baseTender({ deadline_at: '2026-09-20T12:00+14:01' }), { nowIso: NOW });
assert.ok(gaps(offset1401).includes('fecha_cierre_no_verificable'), 'offset +14:01 excede el máximo UTC real y debe ser brecha crítica de fecha de cierre');
assert.equal(offset1401.band, 'por_validar', 'offset +14:01 debe producir la banda por_validar');
const offset1400 = evaluateTenderFit(baseTender({ deadline_at: '2026-09-20T12:00+14:00' }), { nowIso: NOW });
assert.ok(!gaps(offset1400).includes('fecha_cierre_no_verificable'), 'offset +14:00 es el máximo UTC real y sigue siendo válido');
assert.notEqual(offset1400.band, 'por_validar', 'offset +14:00 válido no debe producir la banda por_validar');
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
// nowIso en formato no-ISO (aunque parseable por Date) debe rechazarse como inválido
assert.throws(() => evaluateTenderFit(baseTender(), { nowIso: 'September 20, 2026' }), TypeError, 'nowIso en formato no-ISO debe lanzar TypeError inválido');
// nowIso en el límite máximo representable por Date no debe filtrar un RangeError (p.ej. de Intl.DateTimeFormat); debe validarse como TypeError inválido
assert.throws(() => evaluateTenderFit(baseTender(), { nowIso: '275760-09-13T00:00:00.000Z' }), TypeError, 'nowIso en el límite máximo representable debe lanzar TypeError inválido, no RangeError');
console.log('tender-fit-policy: OK');
