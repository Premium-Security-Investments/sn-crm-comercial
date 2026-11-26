import assert from 'node:assert/strict';
import test from 'node:test';
import { agt002AplicarHoraMasTemprana, agt002HorasDelDia } from '../verticales/licitaciones/agt002-hora-en-disputa.js';
import { projectAgt002InitialReport } from '../verticales/licitaciones/agt002-initial-analysis-report.js';
import { buildTenderMiDia } from '../verticales/licitaciones/tender-mi-dia.js';

// Texto real de la contradicción de Rama Medellín LP002-2026 (análisis del 25-nov).
const CONTRA_HORAS = {
  claim_id: 'CLM-CONTRA-HORAS', claim_type: 'contradiction', evidence_status: 'CONTRADICTED',
  display_text: 'Las horas del cronograma difieren entre el aviso y el resumen del proceso en SECOP (el más reciente, del 11 de noviembre; la copia capturada hacia el 17 repite las mismas horas): observaciones al proyecto de pliego, 11:59 p. m. frente a 11:00 a. m. del 26 de noviembre; respuesta a esas observaciones, 11:00 a. m. frente a 12:00 m. del 27 de noviembre; y publicación del proyecto de pliego el 11 de noviembre a las 7:55 p. m. frente a 11:59 p. m. Se registra la hora de SECOP. Las fechas coinciden.',
};
const OBS_PROYECTO = { kind: 'PROJECT_OBSERVATIONS', label: 'Plazo para presentar observaciones al proyecto de pliego', value: '2026-11-26T23:59:00-05:00', status: 'UPCOMING', certainty: 'CONFIRMED', source_claim_ids: ['CLM-CRONOGRAMA', 'CLM-CONTRA-HORAS'] };

test('lee las horas que un texto da para un día, tramo por tramo', () => {
  assert.deepEqual(agt002HorasDelDia(CONTRA_HORAS.display_text, 26, 10), [11 * 60, 23 * 60 + 59]);
  assert.deepEqual(agt002HorasDelDia(CONTRA_HORAS.display_text, 27, 10), [11 * 60, 12 * 60]);
  assert.deepEqual(agt002HorasDelDia(CONTRA_HORAS.display_text, 28, 10), []);
});

test('Medellín: el plazo de observaciones baja a las 11:00 a. m. y queda por confirmar', () => {
  const out = agt002AplicarHoraMasTemprana(OBS_PROYECTO, [CONTRA_HORAS]);
  assert.equal(out.value, '2026-11-26T11:00:00-05:00');
  assert.equal(out.hora_por_confirmar, true);
  assert.deepEqual(out.horas_en_fuentes, ['11:00', '23:59']);
});

test('si ya trae la hora más temprana no la mueve, pero la marca por confirmar', () => {
  const respuesta = { kind: 'OBSERVATION_RESPONSES', value: '2026-11-27T11:00:00-05:00', source_claim_ids: ['CLM-CONTRA-HORAS'] };
  const out = agt002AplicarHoraMasTemprana(respuesta, [CONTRA_HORAS]);
  assert.equal(out.value, '2026-11-27T11:00:00-05:00');
  assert.equal(out.hora_por_confirmar, true);
});

test('nunca atrasa ni toca un plazo que no cita una contradicción', () => {
  const sinCita = { ...OBS_PROYECTO, source_claim_ids: ['CLM-CRONOGRAMA'] };
  assert.equal(agt002AplicarHoraMasTemprana(sinCita, [CONTRA_HORAS]), sinCita);
  const otroDia = { kind: 'SUBMISSION', value: '2026-12-07T12:00:00-05:00', source_claim_ids: ['CLM-CONTRA-HORAS'] };
  assert.equal(agt002AplicarHoraMasTemprana(otroDia, [CONTRA_HORAS]), otroDia);
  const noContradiccion = { ...CONTRA_HORAS, claim_type: 'fact', evidence_status: 'CONFIRMED' };
  assert.equal(agt002AplicarHoraMasTemprana(OBS_PROYECTO, [noContradiccion]), OBS_PROYECTO);
  const temprano = { ...OBS_PROYECTO, value: '2026-11-26T08:00:00-05:00' };
  assert.equal(agt002AplicarHoraMasTemprana(temprano, [CONTRA_HORAS]).value, '2026-11-26T08:00:00-05:00');
  const sinHora = { ...OBS_PROYECTO, value: '2026-11-26' };
  assert.equal(agt002AplicarHoraMasTemprana(sinHora, [CONTRA_HORAS]), sinHora);
});

test('el informe y Mi día muestran las 11:00 a. m. «por confirmar»', () => {
  const report = projectAgt002InitialReport({ claims: [CONTRA_HORAS], meta: { process_deadlines: [OBS_PROYECTO] } });
  assert.equal(report.deadlines[0].value, '2026-11-26T11:00:00-05:00');
  assert.equal(report.deadlines[0].horaPorConfirmar, true);
  const dia = buildTenderMiDia({ today: '2026-11-26', processes: [{ opportunity_id: 'med', entity: 'Rama Judicial Medellín', ref: 'LP002-2026', deadlines: report.deadlines }] });
  const item = dia.dias.flatMap(d => d.items).find(row => row.opportunity_id === 'med');
  assert.equal(dia.frase.primero.hora_por_confirmar, true);
  assert.ok(item, 'el plazo sale en Mi día');
  assert.equal(item.value, '2026-11-26T11:00:00-05:00');
  assert.equal(item.hora_por_confirmar, true);
});
