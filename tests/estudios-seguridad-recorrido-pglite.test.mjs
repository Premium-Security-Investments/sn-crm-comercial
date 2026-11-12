// Estudios de Seguridad Física: recorrido guiado (migración 214; Juan, 2026-11-12: "puede definir un listado de preguntas
// que al ser respondidas permiten generar un estudio muy completo"). Lista de verificación y "¿qué pasaría si…?" de la
// IEC 31010: las respuestas débiles proponen riesgos con causas, controles y contramedidas; nadie califica por el analista.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addRisk, createStudy, getStudy } from '../verticales/estudios-seguridad/estudios.js';
import { buildSnapshot } from '../verticales/estudios-seguridad/flujo.js';
import { buildStudyReport } from '../verticales/estudios-seguridad/informe.js';
import { AREAS, QUESTIONS } from '../verticales/estudios-seguridad/preguntas.js';
import { saveAnswer } from '../verticales/estudios-seguridad/recorrido.js';
import { PLANTILLA_INSTALACIONES_FISICAS_V1 } from '../verticales/estudios-seguridad/plantilla.js';
import { PREPARER, database, supabaseOver } from './helpers/estudios-seguridad-db.mjs';

const STUDY = {
  title: 'Estudio con recorrido', client_source: 'avancys', client_ref: '900123456', client_name: 'Cliente de prueba S.A.S.',
  site_source: 'manual', site_name: 'Bodega principal', site_city: 'Pereira', scope: 'Bodega y perímetro.', visit_date: '2026-11-10',
};

test('el cuestionario: códigos únicos, cada pregunta apunta a riesgos de la lista base y cada riesgo tiene su pregunta', () => {
  const codes = QUESTIONS.map(question => question.codigo);
  assert.equal(new Set(codes).size, codes.length);
  const base = new Set(PLANTILLA_INSTALACIONES_FISICAS_V1.riesgos.map(item => item.codigo));
  for (const question of QUESTIONS) {
    assert.ok(AREAS.some(area => area.codigo === question.area), question.codigo);
    assert.ok(question.riesgos.length && question.riesgos.every(code => base.has(code)), question.codigo);
    if (question.tipo === 'verificacion') {
      assert.ok(['si', 'no'].includes(question.favorable), question.codigo);
      assert.ok(question.vulnerabilidad && question.contramedida, question.codigo);
    }
  }
  const covered = new Set(QUESTIONS.flatMap(question => question.riesgos));
  assert.deepEqual([...base].filter(code => !covered.has(code)), [], 'los 31 riesgos de la lista base tienen al menos una pregunta');
  assert.ok(QUESTIONS.filter(question => question.tipo === 'escenario').length >= 8);
  // Cruce del 2026-11-12 con el material del equipo: cada pregunta dice de dónde sale; sólo la póliza viene de la norma.
  assert.ok(QUESTIONS.every(question => question.fuente), 'todas con fuente');
  assert.deepEqual(QUESTIONS.filter(question => question.fuente.startsWith('Norma')).map(question => question.codigo), ['BIE-06']);
  assert.equal(QUESTIONS.length, 92);
});

test('responder: sí, no o no aplica; los escenarios piden análisis; desmarcar borra', async () => {
  const pg = await database();
  const db = supabaseOver(pg);
  const study = await createStudy(db, STUDY, PREPARER);
  await assert.rejects(saveAnswer(db, study.id, 'XXX-99', { value: 'si' }, PREPARER), error => error.status === 404);
  await assert.rejects(saveAnswer(db, study.id, 'PER-01', { value: 'tal vez' }, PREPARER), /sí, no o no aplica/);
  await assert.rejects(saveAnswer(db, study.id, 'SWI-01', { value: 'si', note: 'xx' }, PREPARER), /sí, no o no aplica/);
  await saveAnswer(db, study.id, 'PER-01', { value: 'si' }, PREPARER);
  await saveAnswer(db, study.id, 'PER-01', { value: 'no', note: 'Tramo caído detrás de la bodega 3.' }, PREPARER);
  let detail = await getStudy(db, study.id);
  assert.equal(detail.recorrido.respondidas, 1, 'la segunda respuesta reemplaza a la primera');
  assert.equal(detail.recorrido.areas.find(area => area.codigo === 'perimetro').preguntas[0].respuesta, 'no');
  assert.deepEqual(await saveAnswer(db, study.id, 'PER-01', { value: null, note: '' }, PREPARER), { deleted: true });
  detail = await getStudy(db, study.id);
  assert.equal(detail.recorrido.respondidas, 0);
});

test('las respuestas proponen riesgos con causas, controles y contramedidas, y quedan como anexo del informe', async () => {
  const pg = await database();
  const db = supabaseOver(pg);
  const study = await createStudy(db, STUDY, PREPARER);
  const answer = (code, value, note) => saveAnswer(db, study.id, code, { value, note }, PREPARER);
  await answer('PER-01', 'no', 'Tramo caído detrás de la bodega 3.');
  await answer('PER-03', 'no');
  await answer('PER-05', 'si');
  await answer('PER-04', 'na');
  await answer('ACC-01', 'si');
  await answer('SWI-01', null, 'Nadie lo detecta hasta la ronda de las 2 a. m.');
  await addRisk(db, study.id, { catalog_risk_code: 'RB-01', title: 'Acceso no autorizado', probability: 2, impact_company: 2 }, PREPARER);

  const detail = await getStudy(db, study.id);
  const intrusion = detail.recorrido.propuestas.find(item => item.codigo === 'RB-03');
  assert.equal(intrusion.vulnerabilidades, 2);
  assert.equal(intrusion.causas, '1. El cerramiento tiene huecos o tramos caídos. Tramo caído detrás de la bodega 3.\n2. El cerramiento no tiene barrera superior.');
  assert.equal(intrusion.control_existente, 'Iluminación perimetral nocturna sin zonas oscuras.', 'lo favorable queda como control');
  assert.match(intrusion.control_propuesto, /Reparar el cerramiento.*\n2\. Instalar concertina/s);
  assert.deepEqual(intrusion.escenarios, ['¿Qué pasaría si alguien entra por el punto más débil del perímetro de noche? ¿Quién lo detecta y en cuánto tiempo? Nadie lo detecta hasta la ronda de las 2 a. m.']);
  assert.equal(detail.recorrido.propuestas.find(item => item.codigo === 'RB-01'), undefined, 'ACC-01 favorable: sin vulnerabilidad no se propone');
  assert.equal(detail.recorrido.propuestas[0].codigo, 'RB-03', 'primero el de más vulnerabilidades');

  const { snapshot } = buildSnapshot(detail);
  assert.equal(snapshot.recorrido.respuestas.length, 6);
  const text = JSON.stringify(buildStudyReport(snapshot, { version: 1, sha256: 'a'.repeat(64), approvedAt: '2026-11-12T15:00:00Z', approverName: 'Alba', preparerName: 'Ana' }).blocks);
  assert.match(text, /Lista de verificación del recorrido/);
  assert.match(text, /¿El cerramiento perimetral es continuo, sin huecos ni tramos caídos\?/);
  assert.match(text, /Escenarios analizados: ¿qué pasaría si…\?/);
  assert.match(text, /Nadie lo detecta hasta la ronda de las 2 a\. m\./);
});

test('migración 214: respuesta o análisis, sólo del servidor, y reversa', async () => {
  const pg = await database();
  const db = supabaseOver(pg);
  const study = await createStudy(db, STUDY, PREPARER);
  await assert.rejects(pg.query(`insert into public.psi_security_study_answers (study_id, question_code, value, answered_by) values ($1, 'PER-01', null, $2)`, [study.id, PREPARER.id]), /not_empty/);
  const grants = await pg.query(`select grantee from information_schema.role_table_grants where table_name = 'psi_security_study_answers' and grantee in ('anon', 'authenticated', 'PUBLIC')`);
  assert.equal(grants.rows.length, 0);
  await pg.exec(readFileSync(new URL('../supabase/rollbacks/214_estudios_seguridad_recorrido_rollback.sql', import.meta.url), 'utf8'));
  assert.equal((await getStudy(db, study.id)).recorrido.available, false, 'sin la tabla, la ficha se sigue viendo');
});
