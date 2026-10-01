// Contrato RED (TDD) del eje D (Tiempo) de tender-fit-v2, construido sobre el
// helper puro `countColombiaBusinessDays` (tender-fit-v2-business-days.js, ver
// tests/tender-fit-v2-business-days.test.mjs) y las bandas de
// tender-fit-v2-parameters.js. Evaluado a través de `evaluateTenderFit` completo;
// se extrae `reasons.find(r => r.axis === 'tiempo')`.
//
// Todos los casos de banda usan `nowIso` fijo en 2026-01-04T15:00:00.000Z (domingo
// en Bogotá) y varían `deadline_at`, de forma que la ventana de días hábiles
// (día siguiente a la evaluación hasta el día anterior al cierre) producen
// exactamente el recuento de días hábiles indicado en cada caso (ver el cálculo
// día a día documentado en tests/tender-fit-v2-business-days.test.mjs, que cubre
// el caso con festivo de forma dedicada).
import assert from 'node:assert/strict';
import { evaluateTenderFit } from '../tender-fit-policy.js';

const NOW = '2026-01-04T15:00:00.000Z';

function baseTender(o = {}) {
  return {
    title: 'Vigilancia armada', description: '', value: 500_000_000, city: 'Bogotá', dept: 'Cundinamarca', ...o,
  };
}
function tiempoReason(result) {
  const reason = result.reasons.find(r => r.axis === 'tiempo');
  assert.ok(reason, 'debe existir una razón del eje tiempo');
  return reason;
}
function evalFor(deadline_at) {
  return evaluateTenderFit(baseTender({ deadline_at }), { nowIso: NOW });
}

// ---------------------------------------------------------------------------
// 1. Vencida o mismo día: 0 puntos (ambas dejan una ventana vacía de días hábiles)
// ---------------------------------------------------------------------------
assert.equal(tiempoReason(evalFor('2026-01-03')).points, 0, 'fecha de cierre anterior a hoy está vencida');
assert.equal(tiempoReason(evalFor('2026-01-04')).points, 0, 'fecha de cierre igual a hoy no deja ningún día hábil disponible');

// ---------------------------------------------------------------------------
// 2. 0-4 días hábiles: 0 puntos (cierre 2026-01-09 -> ventana [01-05..01-08] = 4 hábiles)
// ---------------------------------------------------------------------------
assert.equal(tiempoReason(evalFor('2026-01-09')).points, 0, '4 días hábiles debe dar 0 puntos');

// ---------------------------------------------------------------------------
// 3. Exactamente 5 días hábiles: 4 puntos (cierre 2026-01-10 -> ventana [01-05..01-09] = 5 hábiles)
// ---------------------------------------------------------------------------
assert.equal(tiempoReason(evalFor('2026-01-10')).points, 4, 'exactamente 5 días hábiles debe dar 4 puntos');

// ---------------------------------------------------------------------------
// 4. 6-8 días hábiles: 7 puntos
// ---------------------------------------------------------------------------
assert.equal(tiempoReason(evalFor('2026-01-14')).points, 7, '6 días hábiles -> 7 puntos');
assert.equal(tiempoReason(evalFor('2026-01-15')).points, 7, '7 días hábiles -> 7 puntos');
assert.equal(tiempoReason(evalFor('2026-01-16')).points, 7, '8 días hábiles -> 7 puntos');

// ---------------------------------------------------------------------------
// 5. 9-12 días hábiles: 10 puntos
// ---------------------------------------------------------------------------
assert.equal(tiempoReason(evalFor('2026-01-17')).points, 10, '9 días hábiles -> 10 puntos');
assert.equal(tiempoReason(evalFor('2026-01-22')).points, 10, '12 días hábiles -> 10 puntos');

// ---------------------------------------------------------------------------
// 6. 13-20 días hábiles: 13 puntos
// ---------------------------------------------------------------------------
assert.equal(tiempoReason(evalFor('2026-01-23')).points, 13, '13 días hábiles -> 13 puntos');
assert.equal(tiempoReason(evalFor('2026-02-03')).points, 13, '20 días hábiles -> 13 puntos');

// ---------------------------------------------------------------------------
// 7. Más de 20 días hábiles: 15 puntos
// ---------------------------------------------------------------------------
assert.equal(tiempoReason(evalFor('2026-02-04')).points, 15, '21 días hábiles -> 15 puntos');
assert.equal(tiempoReason(evalFor('2026-12-31')).points, 15, 'una ventana mucho más amplia también debe dar 15 puntos');

// ---------------------------------------------------------------------------
// 8. Fecha de cierre ausente o no parseable: 5 puntos + razón crítica plazo_ausente
// ---------------------------------------------------------------------------
for (const deadline_at of [undefined, null, 'no-es-una-fecha', '2026-99-99']) {
  const reason = tiempoReason(evalFor(deadline_at));
  assert.equal(reason.points, 5, `deadline_at ${deadline_at} debe dar 5 puntos`);
  assert.equal(reason.code, 'plazo_ausente');
  assert.equal(reason.critical, true);
}

// ---------------------------------------------------------------------------
// 9. Las razones de "vencida"/"insuficiente" (<5 hábiles) no son brecha crítica
//    por sí mismas (no fuerzan por_validar vía precedencia 2); fuerzan Bajo vía
//    precedencia 1, ver tests/tender-fit-policy.test.mjs.
// ---------------------------------------------------------------------------
assert.equal(tiempoReason(evalFor('2026-01-03')).critical, false, 'vencida no es brecha crítica de incertidumbre');
assert.equal(tiempoReason(evalFor('2026-01-09')).critical, false, '4 días hábiles no es brecha crítica de incertidumbre');
assert.equal(['plazo_vencido'].includes(tiempoReason(evalFor('2026-01-03')).code), true, 'código de fecha vencida');
assert.equal(['plazo_insuficiente'].includes(tiempoReason(evalFor('2026-01-09')).code), true, 'código de días hábiles insuficientes (no vencida)');

console.log('tender-fit-v2-time-axis: OK');
