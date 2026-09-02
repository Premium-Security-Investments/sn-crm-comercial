import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

// AGT-003 — "Mi día": cola diaria de seguimiento comercial (bloque de diseño 2026-09-02).
//
// Pruebas conductuales sobre el módulo puro `src/vigia/my-day-presentation.ts`.
// No tocan AGT-002, ni el contrato del copiloto, ni la persistencia: sólo presentación.

const entry = new URL('../src/vigia/my-day-presentation.ts', import.meta.url).pathname;
const bundle = buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false });
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
const { buildMyDayQueue } = await import(moduleUrl);

const now = new Date('2026-09-02T12:00:00.000Z');
const base = {
  id: 'opp-1', company_name: 'Cliente Uno', stage_code: 'prospecto', stage_name: 'Prospecto', stage_order: 1,
  service_type_code: 'seguridad_fisica', offer_value: 10_000_000, regional_nombre: 'Bogotá',
  next_action_at: '2026-09-10T12:00:00.000Z', expected_close_date: null,
  decision_maker_name: 'Ana Ruiz', decision_maker_email: 'ana@x.co', decision_maker_phone: '3000000000',
};

// --- exclusión de tenders y etapas terminales --------------------------------------------------
const tenderRow = { ...base, id: 'tender-1', service_type_code: 'licitacion_publica', next_action_at: '2026-08-01T12:00:00.000Z' };
const qTender = buildMyDayQueue([tenderRow], now);
assert.equal(qTender.hacerHoy.length, 0, 'licitación pública nunca entra a hacer_hoy aunque esté vencida');
assert.equal(qTender.preparar.length, 0);
assert.equal(qTender.depurarCrm.length, 0);

for (const stage_code of ['aprobado', 'perdido', 'descartado']) {
  const row = { ...base, id: `terminal-${stage_code}`, stage_code, next_action_at: '2026-08-01T12:00:00.000Z' };
  const q = buildMyDayQueue([row], now);
  assert.equal(q.hacerHoy.length, 0, `${stage_code} no debe aparecer en hacer_hoy`);
  assert.equal(q.preparar.length, 0, `${stage_code} no debe aparecer en preparar`);
  assert.equal(q.depurarCrm.length, 0, `${stage_code} no debe aparecer en depurar_crm`);
}

// --- balde hacer_hoy: elegibilidad --------------------------------------------------------------
const overdueRow = { ...base, id: 'overdue-1', next_action_at: '2026-08-01T12:00:00.000Z' };
assert.deepEqual(buildMyDayQueue([overdueRow], now).hacerHoy.map(a => a.id), ['overdue-1'], 'próxima acción vencida cae en hacer_hoy');

const missingRow = { ...base, id: 'missing-1', next_action_at: null };
assert.deepEqual(buildMyDayQueue([missingRow], now).hacerHoy.map(a => a.id), ['missing-1'], 'próxima acción ausente cae en hacer_hoy');

const futureRow = { ...base, id: 'future-1', next_action_at: '2026-09-10T12:00:00.000Z' };
const qFuture = buildMyDayQueue([futureRow], now);
assert.equal(qFuture.hacerHoy.length, 0);
assert.equal(qFuture.preparar.length, 0);
assert.equal(qFuture.depurarCrm.length, 0);

// --- ranking hacer_hoy: desempates ---------------------------------------------------------------
const tie1 = buildMyDayQueue([
  { ...base, id: 'missing-tie', next_action_at: null, offer_value: 5_000_000 },
  { ...base, id: 'overdue-tie', next_action_at: '2026-08-01T12:00:00.000Z', offer_value: 5_000_000 },
], now);
assert.deepEqual(tie1.hacerHoy.map(a => a.id), ['overdue-tie', 'missing-tie'], 'desempate 1: vencida antes que faltante');

const tie2 = buildMyDayQueue([
  { ...base, id: 'low-value', next_action_at: '2026-08-01T12:00:00.000Z', offer_value: 1_000_000 },
  { ...base, id: 'high-value', next_action_at: '2026-08-01T12:00:00.000Z', offer_value: 50_000_000 },
], now);
assert.deepEqual(tie2.hacerHoy.map(a => a.id), ['high-value', 'low-value'], 'desempate 2: valor descendente');

const tie3 = buildMyDayQueue([
  { ...base, id: 'stage-low', next_action_at: '2026-08-01T12:00:00.000Z', offer_value: 5_000_000, stage_order: 1 },
  { ...base, id: 'stage-high', next_action_at: '2026-08-01T12:00:00.000Z', offer_value: 5_000_000, stage_order: 3 },
], now);
assert.deepEqual(tie3.hacerHoy.map(a => a.id), ['stage-high', 'stage-low'], 'desempate 3: etapa más avanzada primero');

const tie4 = buildMyDayQueue([
  { ...base, id: 'b-id', company_name: 'Beta', next_action_at: '2026-08-01T12:00:00.000Z', offer_value: 5_000_000, stage_order: 1 },
  { ...base, id: 'a-id', company_name: 'Alfa', next_action_at: '2026-08-01T12:00:00.000Z', offer_value: 5_000_000, stage_order: 1 },
], now);
assert.deepEqual(tie4.hacerHoy.map(a => a.id), ['a-id', 'b-id'], 'desempate 4: company_name asc (localeCompare es)');

const tie5 = buildMyDayQueue([
  { ...base, id: 'z-id', company_name: 'Misma', next_action_at: '2026-08-01T12:00:00.000Z', offer_value: 5_000_000, stage_order: 1 },
  { ...base, id: 'a-id-2', company_name: 'Misma', next_action_at: '2026-08-01T12:00:00.000Z', offer_value: 5_000_000, stage_order: 1 },
], now);
assert.deepEqual(tie5.hacerHoy.map(a => a.id), ['a-id-2', 'z-id'], 'desempate 5: id asc, final y determinista');

// --- requisito explícito: valor/regional faltante NUNCA desplaza una fila ya elegible ------------
const overdueNoData = buildMyDayQueue([{ ...base, id: 'overdue-no-data', next_action_at: '2026-08-01T12:00:00.000Z', offer_value: null, regional_nombre: null }], now);
assert.equal(overdueNoData.hacerHoy.length, 1, 'una fila vencida con valor/regional ausentes sigue calificando para hacer_hoy');
assert.equal(overdueNoData.hacerHoy[0].id, 'overdue-no-data');
assert.equal(overdueNoData.depurarCrm.length, 0, 'no se recategoriza a depurar_crm habiendo calificado ya para hacer_hoy');

// --- tope de hacer_hoy -----------------------------------------------------------------------
const fiveOverdue = Array.from({ length: 5 }, (_, i) => ({ ...base, id: `overdue-${i}`, next_action_at: '2026-08-01T12:00:00.000Z', offer_value: 1_000_000 * (i + 1) }));
const qFive = buildMyDayQueue(fiveOverdue, now);
assert.equal(qFive.hacerHoy.length, 3, 'hacer_hoy trunca a 3 tarjetas');
assert.equal(qFive.hacerHoyTotal, 5, 'hacerHoyTotal reporta el total elegible sin truncar');

// --- balde preparar: elegibilidad y exclusión mutua ------------------------------------------
const prepararRow = { ...base, id: 'preparar-1', stage_code: 'sustentacion', next_action_at: '2026-09-10T12:00:00.000Z', decision_maker_email: null };
const qPreparar = buildMyDayQueue([prepararRow], now);
assert.deepEqual(qPreparar.preparar.map(a => a.id), ['preparar-1']);
assert.equal(qPreparar.hacerHoy.length, 0);

const prepararButOverdue = { ...prepararRow, id: 'preparar-overdue', next_action_at: '2026-08-01T12:00:00.000Z' };
const qPrepararOverdue = buildMyDayQueue([prepararButOverdue], now);
assert.deepEqual(qPrepararOverdue.hacerHoy.map(a => a.id), ['preparar-overdue'], 'vencida con decisor incompleto cae en hacer_hoy, no en preparar');
assert.equal(qPrepararOverdue.preparar.length, 0, 'no debe duplicarse en preparar si ya calificó para hacer_hoy');

const envioOfertaRow = { ...base, id: 'envio-1', stage_code: 'envio_oferta', next_action_at: '2026-09-10T12:00:00.000Z', decision_maker_phone: null };
assert.deepEqual(buildMyDayQueue([envioOfertaRow], now).preparar.map(a => a.id), ['envio-1'], 'envio_oferta también califica para preparar por el hallazgo de auditoría');

const negociacionComplete = { ...base, id: 'negociacion-complete', stage_code: 'negociacion', next_action_at: '2026-09-10T12:00:00.000Z' };
const qNegComplete = buildMyDayQueue([negociacionComplete], now);
assert.equal(qNegComplete.preparar.length, 0, 'decisor completo no califica para preparar');
assert.equal(qNegComplete.hacerHoy.length, 0);
assert.equal(qNegComplete.depurarCrm.length, 0);

// --- balde depurar_crm: elegibilidad y exclusión mutua ---------------------------------------
const depurarValue = { ...base, id: 'depurar-value', next_action_at: '2026-09-10T12:00:00.000Z', offer_value: 0 };
assert.deepEqual(buildMyDayQueue([depurarValue], now).depurarCrm.map(a => a.id), ['depurar-value']);

const depurarRegional = { ...base, id: 'depurar-regional', next_action_at: '2026-09-10T12:00:00.000Z', regional_nombre: '' };
assert.deepEqual(buildMyDayQueue([depurarRegional], now).depurarCrm.map(a => a.id), ['depurar-regional']);

const prepararAndDepurar = { ...base, id: 'preparar-and-depurar', stage_code: 'sustentacion', next_action_at: '2026-09-10T12:00:00.000Z', decision_maker_name: null, decision_maker_email: null, decision_maker_phone: null, offer_value: 0 };
const qBoth = buildMyDayQueue([prepararAndDepurar], now);
assert.deepEqual(qBoth.preparar.map(a => a.id), ['preparar-and-depurar']);
assert.equal(qBoth.depurarCrm.length, 0, 'una fila ya asignada a preparar no aparece también en depurar_crm');

// --- topes de preparar/depurar_crm -------------------------------------------------------------
const fourPreparar = Array.from({ length: 4 }, (_, i) => ({ ...base, id: `preparar-${i}`, stage_code: 'sustentacion', next_action_at: '2026-09-10T12:00:00.000Z', decision_maker_email: null, offer_value: 1_000_000 * (i + 1) }));
const qFourPreparar = buildMyDayQueue(fourPreparar, now);
assert.equal(qFourPreparar.preparar.length, 3);
assert.equal(qFourPreparar.prepararTotal, 4);

const sixDepurar = Array.from({ length: 6 }, (_, i) => ({ ...base, id: `depurar-${i}`, next_action_at: '2026-09-10T12:00:00.000Z', offer_value: 0 }));
const qSixDepurar = buildMyDayQueue(sixDepurar, now);
assert.equal(qSixDepurar.depurarCrm.length, 5);
assert.equal(qSixDepurar.depurarCrmTotal, 6);

// --- contenido de cada alerta: fact/gap/goal exactos según el diseño ---------------------------
const bogotaDateLabel = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: 'America/Bogota' });

const overdueContentRow = { ...base, id: 'content-overdue', next_action_at: '2026-08-01T12:00:00.000Z' };
const overdueAlertResult = buildMyDayQueue([overdueContentRow], now).hacerHoy[0];
assert.equal(
  overdueAlertResult.fact,
  `Próxima gestión vencida vencida hace 32 días (programada para ${bogotaDateLabel.format(new Date('2026-08-01T12:00:00.000Z'))}).`,
);
assert.equal(overdueAlertResult.gap, 'La fecha pasó y no hay una próxima acción vigente.');
assert.equal(overdueAlertResult.goal, 'Registrar el resultado pendiente, si aplica, y agendar la próxima gestión.');
assert.equal(overdueAlertResult.ctaHref, '#/detail/content-overdue?focus=interaction');

const missingContentRow = { ...base, id: 'content-missing', next_action_at: null };
const missingAlertResult = buildMyDayQueue([missingContentRow], now).hacerHoy[0];
assert.equal(missingAlertResult.fact, 'Sin próxima gestión agendada.');
assert.equal(missingAlertResult.gap, 'No hay fecha ni acción definida para el siguiente contacto.');
assert.equal(missingAlertResult.goal, 'Agendar la próxima gestión con fecha concreta.');
assert.equal(missingAlertResult.ctaHref, '#/detail/content-missing?focus=interaction');

const prepararContentRow = { ...base, id: 'content-preparar', stage_code: 'sustentacion', stage_name: 'Sustentación', next_action_at: '2026-09-10T12:00:00.000Z', decision_maker_email: null, decision_maker_phone: null };
const prepararAlertResult = buildMyDayQueue([prepararContentRow], now).preparar[0];
assert.equal(prepararAlertResult.fact, 'Oportunidad en etapa Sustentación sin decisor verificado.');
assert.equal(prepararAlertResult.gap, 'Falta correo y teléfono');
assert.equal(prepararAlertResult.goal, 'Completar el contacto del decisor antes de avanzar la negociación.');
assert.equal(prepararAlertResult.ctaHref, '#/detail/content-preparar?focus=interaction');

const depurarContentRow = { ...base, id: 'content-depurar', next_action_at: '2026-09-10T12:00:00.000Z', offer_value: 0, regional_nombre: '' };
const depurarAlertResult = buildMyDayQueue([depurarContentRow], now).depurarCrm[0];
assert.equal(depurarAlertResult.fact, 'Faltan datos base de la oportunidad.');
assert.equal(depurarAlertResult.gap, 'valor registrado y regional');
assert.equal(depurarAlertResult.goal, 'Completar los datos para mejorar reportes y priorización.');
assert.equal(depurarAlertResult.ctaHref, '#/detail/content-depurar?focus=interaction');

// --- pureza: determinismo y no mutación ---------------------------------------------------------
const pureInput = [
  { ...base, id: 'pure-1', next_action_at: '2026-08-01T12:00:00.000Z' },
  { ...base, id: 'pure-2', stage_code: 'sustentacion', next_action_at: '2026-09-10T12:00:00.000Z', decision_maker_email: null },
  { ...base, id: 'pure-3', next_action_at: '2026-09-10T12:00:00.000Z', offer_value: 0 },
];
const result1 = buildMyDayQueue(structuredClone(pureInput), now);
const result2 = buildMyDayQueue(structuredClone(pureInput), now);
assert.deepEqual(result1, result2, 'buildMyDayQueue debe ser determinista frente a la misma entrada');

const frozenInput = Object.freeze(pureInput.map(row => Object.freeze({ ...row })));
assert.doesNotThrow(() => buildMyDayQueue(frozenInput, now), 'no debe mutar sus argumentos: mutar lanzaría en modo estricto sobre un objeto congelado');

// --- entrada vacía --------------------------------------------------------------------------
assert.deepEqual(
  buildMyDayQueue([], now),
  { hacerHoy: [], hacerHoyTotal: 0, preparar: [], prepararTotal: 0, depurarCrm: [], depurarCrmTotal: 0 },
);

console.log('AGT-003 "Mi día" presentation checks passed');
