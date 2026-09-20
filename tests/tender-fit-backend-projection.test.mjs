import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.VERCEL = '1';

const NOW = '2026-09-20T15:00:00.000Z';

function baseRow(o = {}) {
  return {
    stable_key: 's1', source: 'SECOP II', section: 'hacer', entity: 'E',
    title: 'Vigilancia armada', description: '', value: 2_500_000_000,
    deadline_at: '2026-10-10', city: 'Bogotá', dept: 'Cundinamarca', category: 'Licitación',
    score: 190, reasons: [], risks: [],
    ...o,
  };
}

for (const path of ['../server/index.js', '../api/[...path].js']) {
  const { dbTenderToPublic, tenderScoreFilters, compareTenderRadarRows, radarPayload } = await import(path);

  // dbTenderToPublic: legacy score preserved, nested fit policy tender-fit-v1/alto for physical guard, COP2.5b, Bogotá, deadline 2026-10-10.
  const row = baseRow();
  const pub = dbTenderToPublic(row, { nowIso: NOW });
  assert.equal(pub.score, 190, `${path}: score legado intacto`);
  assert.equal(pub.fit.policy_version, 'tender-fit-v1', `${path}: fit nuevo con versión de política`);
  assert.equal(pub.fit.band, 'alto', `${path}: fit se deriva de la fila, no del score legado`);
  assert.equal(pub.fit.evaluated_at, NOW, `${path}: fit.evaluated_at refleja el nowIso capturado`);

  // Missing deadline returns por_validar.
  const pubNoDeadline = dbTenderToPublic(baseRow({ deadline_at: undefined }), { nowIso: NOW });
  assert.equal(pubNoDeadline.fit.band, 'por_validar', `${path}: sin fecha de cierre, banda por_validar`);

  // tenderScoreFilters: exactamente agrega por_validar preservando todas/alto/medio/bajo.
  assert.deepEqual(tenderScoreFilters, ['todas', 'alto', 'medio', 'por_validar', 'bajo'], `${path}: whitelist score_filter extendida`);

  // Comparator: status humano manda primero, sin importar fit/score.
  const nuevaRow = { internal_status: 'nueva', section: 'prioridad_baja', days: 999, score: 1, fit: { band: 'bajo', score: 1 } };
  const descartadaRow = { internal_status: 'descartada', section: 'hacer', days: 0, score: 999, fit: { band: 'alto', score: 100 } };
  assert.ok(compareTenderRadarRows(nuevaRow, descartadaRow) < 0, `${path}: internal_status humano manda antes que fit/score`);

  // Dentro del mismo status, la banda fit domina sobre score/sección legados.
  const altoRow = { internal_status: 'nueva', section: 'revisar', days: 20, score: 10, fit: { band: 'alto', score: 80 } };
  const medioRow = { internal_status: 'nueva', section: 'hacer', days: 1, score: 999, fit: { band: 'medio', score: 99 } };
  assert.ok(compareTenderRadarRows(altoRow, medioRow) < 0, `${path}: banda fit domina sobre score legado y sección`);

  // Dentro de la misma banda, gana mayor score de fit.
  const altoHighScore = { internal_status: 'nueva', section: 'hacer', days: 1, score: 1, fit: { band: 'alto', score: 95 } };
  const altoLowScore = { internal_status: 'nueva', section: 'hacer', days: 1, score: 999, fit: { band: 'alto', score: 76 } };
  assert.ok(compareTenderRadarRows(altoHighScore, altoLowScore) < 0, `${path}: dentro de la misma banda, mayor score de fit gana`);

  // Cuando fit está ausente en ambos, el fallback legado permanece determinístico: sección -> urgencia -> score legado.
  const noFitSectionHacer = { internal_status: 'nueva', section: 'hacer', days: 5, score: 10 };
  const noFitSectionRevisar = { internal_status: 'nueva', section: 'revisar', days: 0, score: 999 };
  assert.ok(compareTenderRadarRows(noFitSectionHacer, noFitSectionRevisar) < 0, `${path}: fallback legado, sección hacer antes que revisar`);

  const noFitUrgent = { internal_status: 'nueva', section: 'hacer', days: 2, score: 5 };
  const noFitNotUrgent = { internal_status: 'nueva', section: 'hacer', days: 10, score: 999 };
  assert.ok(compareTenderRadarRows(noFitUrgent, noFitNotUrgent) < 0, `${path}: fallback legado, empatada sección, menor días gana`);

  const noFitHighScore = { internal_status: 'nueva', section: 'hacer', days: 5, score: 50 };
  const noFitLowScore = { internal_status: 'nueva', section: 'hacer', days: 5, score: 10 };
  assert.ok(compareTenderRadarRows(noFitHighScore, noFitLowScore) < 0, `${path}: fallback legado, empatada sección/días, mayor score legado gana`);

  // Empate en status/banda/score de fit: sección y urgencia deciden antes que el score legado, según spec.
  const sameBandSectionHacer = { internal_status: 'nueva', section: 'hacer', days: 5, score: 1, fit: { band: 'medio', score: 50 } };
  const sameBandSectionRevisar = { internal_status: 'nueva', section: 'revisar', days: 0, score: 999, fit: { band: 'medio', score: 50 } };
  assert.ok(compareTenderRadarRows(sameBandSectionHacer, sameBandSectionRevisar) < 0, `${path}: empate banda/score fit, sección desempata`);

  const sameEverythingUrgent = { internal_status: 'nueva', section: 'hacer', days: 1, score: 1, fit: { band: 'medio', score: 50 } };
  const sameEverythingNotUrgent = { internal_status: 'nueva', section: 'hacer', days: 20, score: 999, fit: { band: 'medio', score: 50 } };
  assert.ok(compareTenderRadarRows(sameEverythingUrgent, sameEverythingNotUrgent) < 0, `${path}: empate banda/score fit/sección, urgencia desempata`);

  const daysKnown = { internal_status: 'nueva', section: 'hacer', days: 5, score: 999, fit: { band: 'medio', score: 50 } };
  const daysNull = { internal_status: 'nueva', section: 'hacer', days: null, score: 1, fit: { band: 'medio', score: 50 } };
  assert.ok(compareTenderRadarRows(daysKnown, daysNull) < 0, `${path}: días conocidos son más urgentes que días ausentes`);

  const finalTieHighLegacy = { internal_status: 'nueva', section: 'hacer', days: 5, score: 100, fit: { band: 'medio', score: 50 } };
  const finalTieLowLegacy = { internal_status: 'nueva', section: 'hacer', days: 5, score: 10, fit: { band: 'medio', score: 50 } };
  assert.ok(compareTenderRadarRows(finalTieHighLegacy, finalTieLowLegacy) < 0, `${path}: score legado como desempate final absoluto`);

  // radarPayload: preserva totals existentes y agrega totals.fit por banda.
  const rowHacerAlto = { ...pub, id: 's1', section: 'hacer' };
  const payload = radarPayload([rowHacerAlto], NOW, 'supabase', []);
  assert.equal(payload.totals.all, 1, `${path}: totals.all preservado`);
  assert.equal(payload.totals.hacer, 1, `${path}: totals.hacer preservado`);
  assert.deepEqual(payload.totals.fit, { alto: 1, medio: 0, porValidar: 0, bajo: 0, sinDatos: 0 }, `${path}: totals.fit nuevo`);

  const liveRowWithoutFit = { id: 'x', section: 'hacer', score: 10 };
  const payloadLive = radarPayload([liveRowWithoutFit], NOW, 'live', []);
  assert.equal(payloadLive.totals.fit.sinDatos, 1, `${path}: fila sin fit cuenta en sinDatos`);
  assert.equal(payloadLive.totals.all, 1, `${path}: totals.all sigue contando filas sin fit`);

  // Un mismo nowIso capturado, pasado a múltiples filas, se refleja idéntico en fit.evaluated_at.
  const pubA = dbTenderToPublic(baseRow({ stable_key: 'a' }), { nowIso: NOW });
  const pubB = dbTenderToPublic(baseRow({ stable_key: 'b', title: 'CCTV', description: '', value: 100 }), { nowIso: NOW });
  assert.equal(pubA.fit.evaluated_at, NOW, `${path}: evaluated_at de la fila A refleja el nowIso capturado`);
  assert.equal(pubB.fit.evaluated_at, NOW, `${path}: evaluated_at de la fila B refleja el mismo nowIso capturado`);
  assert.equal(pubA.fit.evaluated_at, pubB.fit.evaluated_at, `${path}: mismo nowIso reflejado idénticamente entre filas`);
}

console.log('tender-fit-backend-projection: OK');
