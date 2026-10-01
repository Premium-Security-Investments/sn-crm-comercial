import assert from 'node:assert/strict';
import {
  AGT002_RADAR_RUN_DELTA_CATEGORIES,
  AGT002_RADAR_RUN_DELTA_MAX_FIT_REASONS,
  Agt002RadarRunDeltaValidationError,
  agt002RadarRunDeltaCategoryLabel,
  buildAgt002RadarRunSnapshot,
  computeAgt002RadarRunDelta,
} from '../agt002-radar-run-delta.js';

const CANDIDATE_KEYS_SORTED = ['deadline', 'entity', 'fit_band', 'fit_reasons', 'known_phases', 'source', 'stable_key', 'title'];

const candidate = (overrides = {}) => ({
  stable_key: 'k-1',
  source: 'SECOP II',
  title: 'Vigilancia armada',
  entity: 'Alcaldía de Manizales',
  deadline: '2026-10-15',
  fit_band: 'alto',
  fit_reasons: ['coincide objeto', 'ciudad habilitada'],
  known_phases: ['radar'],
  ...overrides,
});

const src = (source, status, candidates = []) => ({ source, status, candidates: status === 'success' ? candidates : undefined });
const receipt = (runId, finishedAt, sources) => ({ run_id: runId, finished_at: finishedAt, sources });
const snap = (runId, finishedAt, sources) => buildAgt002RadarRunSnapshot(receipt(runId, finishedAt, sources));
const findChange = (changes, category, key) => changes.find((c) => c.category === category && (c.stable_key ?? c.source) === key);
const assertThrowsValidation = (fn, message) => assert.throws(fn, Agt002RadarRunDeltaValidationError, message);

// 1. Sin baseline: nunca se inventa "nuevo", y no hay previous_run.
{
  const current = snap('run-1', '2026-10-01T08:00:00.000Z', [src('SECOP II', 'success', [candidate()])]);
  const delta = computeAgt002RadarRunDelta(null, current);
  assert.equal(delta.baseline_available, false);
  assert.equal(delta.previous_run, null);
  assert.deepEqual(delta.changes, []);
  assert.deepEqual(delta.counts, Object.fromEntries(AGT002_RADAR_RUN_DELTA_CATEGORIES.map((c) => [c, 0])));
  assert.equal(delta.run.run_id, 'run-1');
  assert.equal(delta.run.finished_at, '2026-10-01T08:00:00.000Z');
  assert.equal(delta.run.status, 'complete');
  // `undefined` se trata igual que `null`.
  const deltaUndefined = computeAgt002RadarRunDelta(undefined, current);
  assert.equal(deltaUndefined.baseline_available, false);
  assert.deepEqual(deltaUndefined.changes, []);
}

// 2. complete -> complete sin ningún cambio material: cero cambios.
{
  const previous = snap('run-1', '2026-10-01T08:00:00.000Z', [src('SECOP II', 'success', [candidate()])]);
  const current = snap('run-2', '2026-10-02T08:00:00.000Z', [src('SECOP II', 'success', [candidate()])]);
  const delta = computeAgt002RadarRunDelta(previous, current);
  assert.equal(delta.baseline_available, true);
  assert.equal(delta.previous_run.run_id, 'run-1');
  assert.equal(delta.previous_run.status, 'complete');
  assert.equal(delta.run.status, 'complete');
  assert.deepEqual(delta.changes, []);
}

// 3. Partial: una fuente falla en la corrida actual. Sólo se comparan las fuentes exitosas en
//    ambos lados; la fuente caída no produce ningún cambio de candidato.
{
  const previous = snap('run-1', '2026-10-01T08:00:00.000Z', [
    src('SECOP II', 'success', [candidate({ stable_key: 'k-a', source: 'SECOP II', deadline: '2026-10-15' })]),
    src('TVEC', 'success', [candidate({ stable_key: 'k-b', source: 'TVEC', deadline: '2026-11-01' })]),
  ]);
  const current = snap('run-2', '2026-10-02T08:00:00.000Z', [
    src('SECOP II', 'success', [candidate({ stable_key: 'k-a', source: 'SECOP II', deadline: '2026-10-20' })]),
    src('TVEC', 'failed'),
  ]);
  const delta = computeAgt002RadarRunDelta(previous, current);
  assert.equal(delta.run.status, 'partial');
  assert.equal(delta.counts.deadline_changed, 1);
  const changed = findChange(delta.changes, 'deadline_changed', 'k-a');
  assert.ok(changed);
  assert.equal(changed.before, '2026-10-15');
  assert.equal(changed.after, '2026-10-20');
  // k-b pertenece a TVEC, que falló esta corrida: ningún cambio debe mencionarla.
  assert.equal(delta.changes.some((c) => c.stable_key === 'k-b'), false);
}

// 4. Failed: ambas fuentes fallan en la corrida actual. Cero cambios de candidato, pero sí se
//    permiten eventos de salud de fuente (degradación).
{
  const previous = snap('run-1', '2026-10-01T08:00:00.000Z', [
    src('SECOP II', 'success', [candidate({ stable_key: 'k-a', source: 'SECOP II' })]),
    src('TVEC', 'success', [candidate({ stable_key: 'k-b', source: 'TVEC' })]),
  ]);
  const current = snap('run-2', '2026-10-02T08:00:00.000Z', [src('SECOP II', 'failed'), src('TVEC', 'failed')]);
  const delta = computeAgt002RadarRunDelta(previous, current);
  assert.equal(delta.run.status, 'failed');
  assert.equal(delta.counts.new, 0);
  assert.equal(delta.counts.deadline_changed, 0);
  assert.equal(delta.counts.fit_changed, 0);
  assert.equal(delta.counts.expired, 0);
  assert.equal(delta.counts.source_degraded, 2);
  const degraded = delta.changes.filter((c) => c.category === 'source_degraded').map((c) => c.source);
  assert.deepEqual(degraded, ['SECOP II', 'TVEC']); // orden estable por nombre de fuente
  assert.ok(delta.changes.every((c) => c.label === 'Fuente degradada' || c.category !== 'source_degraded'));
}

// 5. Fuente recuperada/degradada por nombre; una fuente recién recuperada no produce "nuevo" para
//    sus candidatos, porque no tuvo éxito en la corrida anterior.
{
  const previous = snap('run-1', '2026-10-01T08:00:00.000Z', [src('SECOP II', 'failed'), src('TVEC', 'success', [candidate({ stable_key: 'k-b', source: 'TVEC' })])]);
  const current = snap('run-2', '2026-10-02T08:00:00.000Z', [
    src('SECOP II', 'success', [candidate({ stable_key: 'k-recovered', source: 'SECOP II' })]),
    src('TVEC', 'failed'),
  ]);
  const delta = computeAgt002RadarRunDelta(previous, current);
  assert.equal(delta.counts.source_recovered, 1);
  assert.equal(delta.counts.source_degraded, 1);
  assert.equal(delta.counts.new, 0, 'SECOP II falló en la corrida anterior: su candidato no es "nuevo"');
  assert.deepEqual(findChange(delta.changes, 'source_recovered', 'SECOP II'), {
    category: 'source_recovered', source: 'SECOP II', label: 'Fuente recuperada',
  });
  assert.deepEqual(findChange(delta.changes, 'source_degraded', 'TVEC'), {
    category: 'source_degraded', source: 'TVEC', label: 'Fuente degradada',
  });
}

// 6. Nuevo: aparece sólo si la fuente tuvo éxito tanto antes como ahora.
{
  const previous = snap('run-1', '2026-10-01T08:00:00.000Z', [src('SECOP II', 'success', [candidate({ stable_key: 'k-1' })])]);
  const current = snap('run-2', '2026-10-02T08:00:00.000Z', [
    src('SECOP II', 'success', [candidate({ stable_key: 'k-1' }), candidate({ stable_key: 'k-2', title: 'Obra pública' })]),
  ]);
  const delta = computeAgt002RadarRunDelta(previous, current);
  assert.equal(delta.counts.new, 1);
  assert.deepEqual(findChange(delta.changes, 'new', 'k-2'), {
    category: 'new', stable_key: 'k-2', source: 'SECOP II', title: 'Obra pública', label: 'Nuevo',
  });
}

// 7. Cierre modificado: mismo stable_key, antes/después de la fecha canónica.
{
  const previous = snap('run-1', '2026-10-01T08:00:00.000Z', [src('SECOP II', 'success', [candidate({ deadline: '2026-10-15' })])]);
  const current = snap('run-2', '2026-10-02T08:00:00.000Z', [src('SECOP II', 'success', [candidate({ deadline: '2026-10-25' })])]);
  const delta = computeAgt002RadarRunDelta(previous, current);
  assert.equal(delta.counts.deadline_changed, 1);
  assert.deepEqual(findChange(delta.changes, 'deadline_changed', 'k-1'), {
    category: 'deadline_changed', stable_key: 'k-1', source: 'SECOP II', before: '2026-10-15', after: '2026-10-25', label: 'Cierre modificado',
  });
}

// 8. Encaje actualizado con razón; diferencias de mayúsculas/espacios en fit_band no cuentan como cambio.
{
  const previous = snap('run-1', '2026-10-01T08:00:00.000Z', [
    src('SECOP II', 'success', [candidate({ fit_band: 'bajo', fit_reasons: ['objeto parcial'] })]),
  ]);
  const current = snap('run-2', '2026-10-02T08:00:00.000Z', [
    src('SECOP II', 'success', [candidate({ fit_band: 'alto', fit_reasons: ['coincide objeto exacto', 'ciudad habilitada'] })]),
  ]);
  const delta = computeAgt002RadarRunDelta(previous, current);
  assert.equal(delta.counts.fit_changed, 1);
  assert.deepEqual(findChange(delta.changes, 'fit_changed', 'k-1'), {
    category: 'fit_changed', stable_key: 'k-1', source: 'SECOP II', before: 'bajo', after: 'alto',
    reason: 'coincide objeto exacto', label: 'Encaje actualizado',
  });

  const previousNorm = snap('run-3', '2026-10-01T08:00:00.000Z', [src('SECOP II', 'success', [candidate({ fit_band: 'Alto' })])]);
  const currentNorm = snap('run-4', '2026-10-02T08:00:00.000Z', [src('SECOP II', 'success', [candidate({ fit_band: 'alto ' })])]);
  const deltaNorm = computeAgt002RadarRunDelta(previousNorm, currentNorm);
  assert.equal(deltaNorm.counts.fit_changed, 0, 'fit_band normalizado (trim+lowercase) no cambió');
}

// 9. Vencido por cruce real entre `previous.finished_at` y `current.finished_at`.
{
  // 9a. Sigue listado con la fecha ya vencida.
  const previousA = snap('run-1', '2026-10-01T08:00:00.000Z', [src('SECOP II', 'success', [candidate({ deadline: '2026-10-05' })])]);
  const currentA = snap('run-2', '2026-10-07T08:00:00.000Z', [src('SECOP II', 'success', [candidate({ deadline: '2026-10-05' })])]);
  const deltaA = computeAgt002RadarRunDelta(previousA, currentA);
  assert.equal(deltaA.counts.expired, 1);
  assert.deepEqual(findChange(deltaA.changes, 'expired', 'k-1'), {
    category: 'expired', stable_key: 'k-1', source: 'SECOP II', deadline: '2026-10-05', still_listed: true, label: 'Vencido desde la última corrida',
  });

  // 9b. Ya no está listado: también cuenta como vencido, usando la fecha conocida en la corrida anterior.
  const previousB = snap('run-1', '2026-10-01T08:00:00.000Z', [src('SECOP II', 'success', [candidate({ deadline: '2026-10-05' })])]);
  const currentB = snap('run-2', '2026-10-07T08:00:00.000Z', [src('SECOP II', 'success', [])]);
  const deltaB = computeAgt002RadarRunDelta(previousB, currentB);
  assert.equal(deltaB.counts.expired, 1);
  assert.equal(findChange(deltaB.changes, 'expired', 'k-1').still_listed, false);

  // 9c. Ya estaba vencido ANTES de la corrida anterior: no se vuelve a reportar como recién vencido.
  const previousC = snap('run-1', '2026-10-10T08:00:00.000Z', [src('SECOP II', 'success', [candidate({ deadline: '2026-10-05' })])]);
  const currentC = snap('run-2', '2026-10-20T08:00:00.000Z', [src('SECOP II', 'success', [])]);
  const deltaC = computeAgt002RadarRunDelta(previousC, currentC);
  assert.equal(deltaC.counts.expired, 0, 'un cierre ya vencido antes de la corrida anterior no cruza entre estas dos corridas');

  // 9d. Falso vencido por confundir "fin de día UTC" con "fin de día America/Bogota": el cierre
  //     real del 2026-10-05 ocurre a las 2026-10-06T05:00:00Z (medianoche en Bogotá, UTC-5).
  //     Tanto la corrida anterior (20:00Z del 05) como la actual (02:00Z del 06) caen ANTES de
  //     ese instante real, así que no debe emitirse "expired".
  const previousD = snap('run-1', '2026-10-05T20:00:00.000Z', [src('SECOP II', 'success', [candidate({ deadline: '2026-10-05' })])]);
  const currentD = snap('run-2', '2026-10-06T02:00:00.000Z', [src('SECOP II', 'success', [candidate({ deadline: '2026-10-05' })])]);
  const deltaD = computeAgt002RadarRunDelta(previousD, currentD);
  assert.equal(deltaD.counts.expired, 0, 'el cierre del 2026-10-05 en America/Bogota sigue vigente hasta las 2026-10-06T05:00:00Z');
  assert.equal(findChange(deltaD.changes, 'expired', 'k-1'), undefined);
}

// 10. Ausencia SIN cruce verificable: nunca se deriva como vencido.
{
  const previous = snap('run-1', '2026-10-01T08:00:00.000Z', [src('SECOP II', 'success', [candidate({ deadline: '2026-12-31' })])]);
  const current = snap('run-2', '2026-10-02T08:00:00.000Z', [src('SECOP II', 'success', [])]);
  const delta = computeAgt002RadarRunDelta(previous, current);
  assert.equal(delta.counts.expired, 0);
  assert.deepEqual(delta.changes, []);
}

// 11. Fuente fallida en cualquiera de las dos corridas nunca produce "nuevo" ni "vencido".
{
  // 11a. Previamente falló: aparición posterior nunca es "nuevo" (ya cubierto en 5, caso aislado aquí).
  const previous11a = snap('run-1', '2026-10-01T08:00:00.000Z', [src('SECOP II', 'failed')]);
  const current11a = snap('run-2', '2026-10-02T08:00:00.000Z', [src('SECOP II', 'success', [candidate({ stable_key: 'k-x' })])]);
  const delta11a = computeAgt002RadarRunDelta(previous11a, current11a);
  assert.equal(delta11a.counts.new, 0);

  // 11b. Fuente falla en la corrida ACTUAL: aunque el cierre ya habría cruzado, no se marca vencido.
  const previous11b = snap('run-1', '2026-10-01T08:00:00.000Z', [src('SECOP II', 'success', [candidate({ deadline: '2026-10-05' })])]);
  const current11b = snap('run-2', '2026-10-07T08:00:00.000Z', [src('SECOP II', 'failed')]);
  const delta11b = computeAgt002RadarRunDelta(previous11b, current11b);
  assert.equal(delta11b.counts.expired, 0);
  assert.equal(delta11b.counts.source_degraded, 1);
}

// 12. Determinismo: el orden de entrada (fuentes y candidatos) no afecta la salida.
{
  const candA = candidate({ stable_key: 'k-a', source: 'ESU', deadline: '2026-10-10' });
  const candB = candidate({ stable_key: 'k-b', source: 'SECOP II', deadline: '2026-10-11' });
  const prev1 = snap('run-1', '2026-10-01T08:00:00.000Z', [src('ESU', 'success', [candA]), src('SECOP II', 'success', [candB])]);
  const prev2 = snap('run-1', '2026-10-01T08:00:00.000Z', [src('SECOP II', 'success', [candB]), src('ESU', 'success', [candA])]);
  assert.deepEqual(prev1, prev2);

  const curA = candidate({ stable_key: 'k-a', source: 'ESU', deadline: '2026-11-10' });
  const curB = candidate({ stable_key: 'k-b', source: 'SECOP II', deadline: '2026-10-11' });
  const cur1 = snap('run-2', '2026-10-02T08:00:00.000Z', [src('ESU', 'success', [curA]), src('SECOP II', 'success', [curB])]);
  const cur2 = snap('run-2', '2026-10-02T08:00:00.000Z', [src('SECOP II', 'success', [curB]), src('ESU', 'success', [curA])]);

  const deltaAB = computeAgt002RadarRunDelta(prev1, cur1);
  const deltaBA = computeAgt002RadarRunDelta(prev2, cur2);
  assert.deepEqual(deltaAB, deltaBA);
}

// 13. Sin raw payload ni secretos en el snapshot, pase lo que pase en la entrada.
{
  const dirty = {
    stable_key: 'k-1', source: 'SECOP II', title: 'Vigilancia armada', entity: 'Alcaldía',
    deadline: '2026-10-15', fit_band: 'alto', fit_reasons: ['coincide objeto'], known_phases: ['radar'],
    raw: { api_key: 'sk-topsecret-123', nit: '900123456', objeto: 'Vigilancia armada completa' },
    secret: 'nunca-debe-salir', token: 'abc123token', internal_notes: 'contiene password=hunter2',
  };
  const snapshot = buildAgt002RadarRunSnapshot(receipt('run-1', '2026-10-01T08:00:00.000Z', [src('SECOP II', 'success', [dirty])]));
  assert.deepEqual(Object.keys(snapshot.candidates[0]).sort(), CANDIDATE_KEYS_SORTED);
  const serialized = JSON.stringify(snapshot);
  for (const secret of ['topsecret', 'nunca-debe-salir', 'abc123token', 'hunter2', 'api_key', 'internal_notes']) {
    assert.equal(serialized.includes(secret), false, `el snapshot no debe contener "${secret}"`);
  }

  // Un snapshot con un campo extra (p. ej. `raw` colado a mano) se rechaza en la frontera de computeDelta.
  const pollutedSnapshot = { ...snapshot, candidates: [{ ...snapshot.candidates[0], raw: { leak: true } }] };
  assertThrowsValidation(() => computeAgt002RadarRunDelta(null, pollutedSnapshot), 'snapshot candidate con campo extra debe rechazarse');
}

// 14. Validación fail-closed de recibos.
{
  const base = receipt('run-1', '2026-10-01T08:00:00.000Z', [src('SECOP II', 'success', [candidate()])]);
  for (const broken of [null, undefined, 'x', 42, []]) {
    assertThrowsValidation(() => buildAgt002RadarRunSnapshot(broken));
  }
  assertThrowsValidation(() => buildAgt002RadarRunSnapshot({ ...base, run_id: '' }));
  assertThrowsValidation(() => buildAgt002RadarRunSnapshot({ ...base, finished_at: '2026-10-01' }), 'finished_at debe ser datetime, no sólo fecha');
  assertThrowsValidation(() => buildAgt002RadarRunSnapshot({ ...base, finished_at: 'not-a-date' }));
  assertThrowsValidation(() => buildAgt002RadarRunSnapshot({ ...base, sources: [] }));
  assertThrowsValidation(() => buildAgt002RadarRunSnapshot({ ...base, sources: [src('SECOP II', 'success', []), src('SECOP II', 'failed')] }), 'fuente duplicada');
  assertThrowsValidation(() => buildAgt002RadarRunSnapshot({ ...base, sources: [{ source: 'SECOP II', status: 'unknown' }] }));
  assertThrowsValidation(() => buildAgt002RadarRunSnapshot({ ...base, sources: [{ source: 'SECOP II', status: 'failed', candidates: [candidate()] }] }), 'fuente fallida no puede traer candidatos');
  assertThrowsValidation(() => buildAgt002RadarRunSnapshot({ ...base, sources: [{ source: 'SECOP II', status: 'success' }] }), 'fuente exitosa requiere candidates');
  assertThrowsValidation(() => buildAgt002RadarRunSnapshot({ ...base, sources: [src('SECOP II', 'success', [candidate({ stable_key: '' })])] }));
  assertThrowsValidation(() => buildAgt002RadarRunSnapshot({ ...base, sources: [src('SECOP II', 'success', [candidate({ source: 'TVEC' })])] }), 'source del candidato debe coincidir con la fuente padre');
  assertThrowsValidation(() => buildAgt002RadarRunSnapshot({ ...base, sources: [src('SECOP II', 'success', [candidate({ deadline: '15-10-2026' })])] }));
  assertThrowsValidation(() => buildAgt002RadarRunSnapshot({ ...base, sources: [src('SECOP II', 'success', [candidate({ fit_band: '' })])] }));
  assertThrowsValidation(() => buildAgt002RadarRunSnapshot({ ...base, sources: [src('SECOP II', 'success', [candidate({ fit_reasons: ['ok', ''] })])] }));
  assertThrowsValidation(() => buildAgt002RadarRunSnapshot({ ...base, sources: [src('SECOP II', 'success', [candidate({ known_phases: [1] })])] }));
  assertThrowsValidation(() => buildAgt002RadarRunSnapshot({
    ...base,
    sources: [src('SECOP II', 'success', [candidate({ stable_key: 'dup' })]), src('TVEC', 'success', [candidate({ stable_key: 'dup', source: 'TVEC' })])],
  }), 'stable_key duplicado entre fuentes exitosas');

  // Validación fail-closed de snapshots pasados directamente a computeAgt002RadarRunDelta.
  const goodSnapshot = snap('run-1', '2026-10-01T08:00:00.000Z', [src('SECOP II', 'success', [candidate()])]);
  for (const broken of [null, undefined, 'x', 42, []]) {
    assertThrowsValidation(() => computeAgt002RadarRunDelta(null, broken), 'current snapshot inválido debe rechazarse');
  }
  assertThrowsValidation(() => computeAgt002RadarRunDelta(null, { ...goodSnapshot, extra_field: true }));
  assertThrowsValidation(() => computeAgt002RadarRunDelta(null, { ...goodSnapshot, sources: [{ source: 'SECOP II', status: 'success', extra: true }] }));
  assertThrowsValidation(() => computeAgt002RadarRunDelta(null, {
    ...goodSnapshot, candidates: [{ ...goodSnapshot.candidates[0], fit_reasons: ['a', 'b', 'c', 'd'] }],
  }), 'más de 3 fit_reasons en un snapshot debe rechazarse');
  assertThrowsValidation(() => computeAgt002RadarRunDelta(null, {
    ...goodSnapshot, sources: [{ source: 'SECOP II', status: 'failed' }],
  }), 'candidato cuya fuente quedó failed en el snapshot debe rechazarse');
  assertThrowsValidation(() => computeAgt002RadarRunDelta(null, {
    ...goodSnapshot, candidates: [goodSnapshot.candidates[0], goodSnapshot.candidates[0]],
  }), 'stable_key duplicado dentro de un snapshot debe rechazarse');
  assertThrowsValidation(() => computeAgt002RadarRunDelta({ ...goodSnapshot, extra_field: true }, goodSnapshot), 'el snapshot anterior también se valida');
}

// 15. Helpers de etiqueta en español: catálogo cerrado, falla ante categoría desconocida.
{
  assert.equal(agt002RadarRunDeltaCategoryLabel('new'), 'Nuevo');
  assert.equal(agt002RadarRunDeltaCategoryLabel('deadline_changed'), 'Cierre modificado');
  assert.equal(agt002RadarRunDeltaCategoryLabel('fit_changed'), 'Encaje actualizado');
  assert.equal(agt002RadarRunDeltaCategoryLabel('expired'), 'Vencido desde la última corrida');
  assert.equal(agt002RadarRunDeltaCategoryLabel('source_recovered'), 'Fuente recuperada');
  assert.equal(agt002RadarRunDeltaCategoryLabel('source_degraded'), 'Fuente degradada');
  assertThrowsValidation(() => agt002RadarRunDeltaCategoryLabel('bogus'));
}

// 16. fit_reasons se recorta a un máximo de 3 en el snapshot, sin importar cuántas lleguen.
{
  const snapshot = snap('run-1', '2026-10-01T08:00:00.000Z', [
    src('SECOP II', 'success', [candidate({ fit_reasons: ['r1', 'r2', 'r3', 'r4', 'r5'] })]),
  ]);
  assert.equal(snapshot.candidates[0].fit_reasons.length, AGT002_RADAR_RUN_DELTA_MAX_FIT_REASONS);
  assert.deepEqual(snapshot.candidates[0].fit_reasons, ['r1', 'r2', 'r3']);
}

// 17. known_phases se deduplica y ordena de forma determinística en el snapshot.
{
  const snapshot = snap('run-1', '2026-10-01T08:00:00.000Z', [
    src('SECOP II', 'success', [candidate({ known_phases: ['scored', 'ingested', 'scored'] })]),
  ]);
  assert.deepEqual(snapshot.candidates[0].known_phases, ['ingested', 'scored']);
}

// 18. Un mismo stable_key puede llevar varias etiquetas (cierre + encaje a la vez), pero cada
//     categoría aparece como máximo una vez por stable_key, y el orden de salida es estable:
//     por categoría (orden canónico) y luego por stable_key/fuente.
{
  const previous = snap('run-1', '2026-10-01T08:00:00.000Z', [
    src('ESU', 'success', [candidate({ stable_key: 'k-z', source: 'ESU', deadline: '2026-10-10', fit_band: 'bajo' })]),
    src('SECOP II', 'success', [candidate({ stable_key: 'k-a', source: 'SECOP II' })]),
  ]);
  const current = snap('run-2', '2026-10-02T08:00:00.000Z', [
    src('ESU', 'success', [
      candidate({ stable_key: 'k-z', source: 'ESU', deadline: '2026-11-10', fit_band: 'alto' }),
      candidate({ stable_key: 'k-new', source: 'ESU', title: 'Nueva' }),
    ]),
    src('SECOP II', 'success', [candidate({ stable_key: 'k-a', source: 'SECOP II' })]),
  ]);
  const delta = computeAgt002RadarRunDelta(previous, current);
  const kzChanges = delta.changes.filter((c) => c.stable_key === 'k-z');
  assert.deepEqual(kzChanges.map((c) => c.category), ['deadline_changed', 'fit_changed']);
  assert.equal(kzChanges.filter((c) => c.category === 'deadline_changed').length, 1);
  assert.equal(kzChanges.filter((c) => c.category === 'fit_changed').length, 1);
  // Orden de salida: por categoría canónica (new antes que deadline_changed/fit_changed), y dentro
  // de una misma categoría por stable_key ascendente.
  assert.deepEqual(delta.changes.map((c) => [c.category, c.stable_key ?? c.source]), [
    ['new', 'k-new'],
    ['deadline_changed', 'k-z'],
    ['fit_changed', 'k-z'],
  ]);
}

console.log('AGT-002 Radar run delta (Corte 3) passed');
