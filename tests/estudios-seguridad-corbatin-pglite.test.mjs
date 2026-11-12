// Estudios de Seguridad Física: corbatín, datos de cada control y dueño del riesgo (migración 216; NTC-IEC/ISO
// 31010:2020, B.4.2; Juan, 2026-11-12: "esta bien" y "pongamos el campo pero si no se sabe pues que no nos frene").
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addRisk, createStudy, getStudy, updateRisk } from '../verticales/estudios-seguridad/estudios.js';
import { bowTie, cleanControlDetails, itemsOf } from '../verticales/estudios-seguridad/corbatin.js';
import { buildSnapshot } from '../verticales/estudios-seguridad/flujo.js';
import { buildStudyReport } from '../verticales/estudios-seguridad/informe.js';
import { reviewStudy } from '../verticales/estudios-seguridad/revisor.js';
import { PREPARER, database, supabaseOver } from './helpers/estudios-seguridad-db.mjs';

const STUDY = {
  title: 'Estudio con corbatín', client_source: 'avancys', client_ref: '900123456', client_name: 'Cliente de prueba S.A.S.',
  site_source: 'manual', site_name: 'Bodega principal', site_city: 'Pereira', scope: 'Bodega y perímetro.', visit_date: '2026-11-10',
};
const RISK = {
  title: 'Hurto en bodega', probability: 5, impact_company: 4, residual_probability: 2,
  causes: '1. Cerramiento roto\n2. Puerta sin alarma\n3. Empleado cómplice',
  consequences: '1. Pérdida de mercancía\n2. Parada de despachos',
  current_control: '1. Ronda nocturna\n2. Alarma a la central', current_quality: 3, current_efficacy: 3, current_efficiency: 3,
  proposed_control: 'Reparar el cerramiento', proposed_quality: 4, proposed_efficacy: 4, proposed_efficiency: 4,
};

test('los renglones de un campo, sin numeración', () => {
  assert.deepEqual(itemsOf('1. Uno\n2) Dos\n- Tres\n\n• Cuatro'), ['Uno', 'Dos', 'Tres', 'Cuatro']);
  assert.deepEqual(itemsOf(null), []);
});

test('los datos se limpian contra los controles escritos: lo que ya no existe o viene vacío se descarta, nada bloquea', () => {
  const details = cleanControlDetails([
    { tipo: 'existente', texto: 'ronda  NOCTURNA', momento: 'antes', causa: 1, verificado: true, puede_fallar: 'Guarda dormido' },
    { tipo: 'existente', texto: 'Control que se borró', momento: 'antes' },
    { tipo: 'existente', texto: 'Alarma a la central' },
    { tipo: 'propuesto', texto: 'Reparar el cerramiento', momento: 'despues', causa: 1, verificado: true },
  ], RISK);
  assert.equal(details.length, 2);
  assert.equal(details[0].causa, 1);
  assert.equal(details[1].causa, null, 'un control de después no va contra una causa');
  assert.equal(details[1].verificado, null, 'un propuesto no se verifica en el recorrido');
  assert.throws(() => cleanControlDetails([{ tipo: 'existente', texto: 'Ronda nocturna', momento: 'durante' }], RISK), /antes o después/);
  assert.equal(cleanControlDetails([{ tipo: 'existente', texto: 'Ronda nocturna', momento: 'antes', causa: 9 }], RISK)[0].causa, null, 'causa que ya no existe');
});

test('el corbatín: causas con sus controles, los de después, y las causas sin defensa', () => {
  const tie = bowTie({ ...RISK, control_details: cleanControlDetails([
    { tipo: 'existente', texto: 'Ronda nocturna', momento: 'antes', causa: 1 },
    { tipo: 'propuesto', texto: 'Reparar el cerramiento', momento: 'antes', causa: 1 },
    { tipo: 'existente', texto: 'Alarma a la central', momento: 'despues' },
  ], RISK) });
  assert.equal(tie.detallado, true);
  assert.deepEqual(tie.causas[0].controles.map(item => item.texto), ['Ronda nocturna', 'Reparar el cerramiento']);
  assert.deepEqual(tie.despues.map(item => item.texto), ['Alarma a la central']);
  assert.deepEqual(tie.consecuencias, ['Pérdida de mercancía', 'Parada de despachos']);
  assert.deepEqual(tie.sin_ningun_control, [2, 3]);
  // Sin ubicar ningún control no se sabe qué causa queda sin defensa: no se acusa nada.
  const plain = bowTie(RISK);
  assert.equal(plain.detallado, false);
  assert.deepEqual(plain.sin_ningun_control, []);
  assert.equal(plain.sin_clasificar.length, 3);
});

test('se guarda con el riesgo, el revisor señala la causa sin control, y va en la versión y en el informe', async () => {
  const pg = await database();
  const db = supabaseOver(pg);
  const study = await createStudy(db, STUDY, PREPARER);
  const risk = await addRisk(db, study.id, { ...RISK, probability_basis: 'Hurtos repetidos en la bodega este año.' }, PREPARER);
  assert.equal(risk.risk_owner, null, 'sin dueño no frena');
  await updateRisk(db, study.id, risk.id, {
    risk_owner: 'Jefe de Logística',
    control_details: [
      { tipo: 'existente', texto: 'Ronda nocturna', momento: 'antes', causa: 1, verificado: true, puede_fallar: 'Guarda dormido', lo_sostiene: 'Supervisión' },
      { tipo: 'existente', texto: 'Alarma a la central', momento: 'despues', depende_de: 'Energía' },
    ],
  }, PREPARER);
  // Editar el texto del control borra los datos del renglón que ya no existe.
  await updateRisk(db, study.id, risk.id, { current_control: '1. Ronda nocturna\n2. Alarma monitoreada' }, PREPARER);
  const detail = await getStudy(db, study.id);
  const saved = detail.risks[0];
  assert.equal(saved.risk_owner, 'Jefe de Logística');
  assert.deepEqual(saved.control_details.map(item => item.texto), ['Ronda nocturna']);

  const review = await reviewStudy(db, detail);
  assert.deepEqual(review.findings.filter(item => item.code === 'causa_sin_control').map(item => item.message), ['R1: las causas 2 y 3 no tienen ningún control, ni existente ni propuesto.']);

  const { snapshot } = buildSnapshot(detail);
  assert.equal(snapshot.riesgos[0].dueno, 'Jefe de Logística');
  const text = JSON.stringify(buildStudyReport(snapshot, { version: 1, sha256: 'a'.repeat(64), approvedAt: '2026-11-12T15:00:00Z', approverName: 'Alba', preparerName: 'Ana' }).blocks);
  assert.match(text, /Dueño del riesgo/);
  assert.match(text, /Corbatín: causas, controles y consecuencias/);
  assert.match(text, /Ronda nocturna \(verificado en el recorrido; puede fallar si: Guarda dormido; lo sostiene: Supervisión\)/);
  assert.match(text, /Ninguno: causa sin defensa/);
  assert.match(text, /NTC-IEC\/ISO 31010:2020/);
});

test('migración 216: sólo listas, con tope, y reversa', async () => {
  const pg = await database();
  const db = supabaseOver(pg);
  const study = await createStudy(db, STUDY, PREPARER);
  const risk = await addRisk(db, study.id, { ...RISK, probability_basis: 'Hurtos repetidos en la bodega este año.' }, PREPARER);
  await assert.rejects(pg.query(`update public.psi_security_study_risks set control_details = '{}'::jsonb where id = $1`, [risk.id]), /check/);
  await pg.exec(readFileSync(new URL('../supabase/rollbacks/216_estudios_seguridad_corbatin_rollback.sql', import.meta.url), 'utf8'));
  const columns = await pg.query(`select column_name from information_schema.columns where table_name = 'psi_security_study_risks' and column_name in ('control_details', 'risk_owner')`);
  assert.equal(columns.rows.length, 0);
});
