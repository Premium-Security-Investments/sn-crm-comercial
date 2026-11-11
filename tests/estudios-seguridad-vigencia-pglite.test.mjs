// Estudios de Seguridad Física: vencimiento y revaloración (migración 209; Juan, 2026-11-11: "vamos adelante").
// Héctor: mínimo cada 6 meses y máximo cada 3 años, y antes si cambian las instalaciones o hay un siniestro.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addAction, addRisk, createStudy, getStudy, listStudies, updateStudy } from '../verticales/estudios-seguridad/estudios.js';
import { buildSnapshot, transitionStudy } from '../verticales/estudios-seguridad/flujo.js';
import { buildStudyReport } from '../verticales/estudios-seguridad/informe.js';
import { requestRevaluation, studyValidity } from '../verticales/estudios-seguridad/vigencia.js';
import { APPROVER, PREPARER, REVIEWER, database, supabaseOver } from './helpers/estudios-seguridad-db.mjs';

const STUDY = {
  title: 'Estudio con vigencia', client_source: 'avancys', client_ref: '900123456', client_name: 'Cliente de prueba S.A.S.',
  site_source: 'manual', site_name: 'Bodega', site_city: 'Pereira', scope: 'Bodega y perímetro.', visit_date: '2026-11-01',
};

test('la vigencia: desde la aprobación, por la frecuencia del estudio, con aviso a 60 días', () => {
  assert.deepEqual(studyValidity({ renewal_months: 12 }), { estado: 'sin_aprobar', aprobado: null, vence: null, dias: null, meses: 12, revalorar: [] });
  const approvedAt = '2026-08-31T20:00:00Z';
  const at = day => new Date(`${day}T17:00:00Z`);
  assert.equal(studyValidity({ renewal_months: 6 }, { approvedAt, now: at('2026-09-01') }).vence, '2027-02-28', 'fin de mes: el último día del mes de llegada');
  assert.deepEqual(['2026-12-01', '2027-01-15', '2027-03-01'].map(day => studyValidity({ renewal_months: 6 }, { approvedAt, now: at(day) }).estado), ['vigente', 'por_vencer', 'vencido']);
  assert.equal(studyValidity({ renewal_months: 99 }, { approvedAt, now: at('2026-09-01') }).meses, 24, 'una frecuencia inválida cae en 2 años');
  // Aprobado a las 9 p. m. de Colombia del 31 de agosto: el día que cuenta es el 31, no el 1 de septiembre.
  assert.equal(studyValidity({ renewal_months: 12 }, { approvedAt: '2026-09-01T02:00:00Z', now: at('2026-09-02') }).aprobado, '2026-08-31');
});

test('revalorar: un pedido o un siniestro POSTERIOR a la aprobación; lo anterior ya quedó en el estudio', () => {
  const approvedAt = '2026-10-01T15:00:00Z';
  const ops = days => ({ data: { status: 'ok', summary: { novedades: { altas_fechas: days } } } });
  const before = studyValidity({ revaluation_requested_at: '2026-09-15T15:00:00Z', revaluation_note: 'Ampliación de la bodega' }, { approvedAt, securityops: ops(['2026-09-20']) });
  assert.deepEqual(before.revalorar, []);
  const after = studyValidity({ revaluation_requested_at: '2026-10-20T15:00:00Z', revaluation_note: 'Ampliación de la bodega' }, { approvedAt, securityops: ops(['2026-09-20', '2026-10-25', '2026-11-02']), now: new Date('2026-11-05T15:00:00Z') });
  assert.deepEqual(after.revalorar.map(item => [item.motivo, item.fecha]), [['pedida', '2026-10-20'], ['siniestro', '2026-11-02']]);
  assert.match(after.revalorar[1].detalle, /2 novedades de prioridad alta o crítica/);
});

test('en la plataforma: la frecuencia se guarda, la lista y la ficha muestran la vigencia, y el informe la dice', async () => {
  const pg = await database();
  const db = supabaseOver(pg);
  await assert.rejects(createStudy(db, { ...STUDY, renewal_months: 18 }, PREPARER), /Renovación/);
  const study = await createStudy(db, { ...STUDY, renewal_months: 12 }, PREPARER);
  assert.equal(study.renewal_months, 12);
  await updateStudy(db, study.id, { renewal_months: 6 }, PREPARER);
  const risk = await addRisk(db, study.id, { title: 'Hurto de mercancía', probability: 3, impact_company: 3 }, PREPARER);
  await addAction(db, study.id, { risk_id: risk.id, description: 'Control de salida', owner_label: 'Seguridad', due_date: '2026-12-15' }, PREPARER);
  assert.equal((await listStudies(db)).find(row => row.id === study.id).validity.estado, 'sin_aprobar');
  for (const [action, who] of [['enviar', PREPARER], ['marcar_revisado', REVIEWER], ['aprobar', APPROVER]]) await transitionStudy(db, study.id, { action }, who);

  const listed = (await listStudies(db)).find(row => row.id === study.id);
  assert.equal(listed.validity.estado, 'vigente');
  assert.equal(listed.validity.meses, 6);
  const detail = await getStudy(db, study.id);
  assert.equal(detail.validity.vence, listed.validity.vence);

  await assert.rejects(requestRevaluation(db, detail.study, { note: '' }), /motivo/);
  await requestRevaluation(db, detail.study, { note: 'El cliente amplió la bodega 3' });
  assert.equal((await getStudy(db, study.id)).validity.revalorar[0].detalle, 'El cliente amplió la bodega 3');

  const { snapshot } = buildSnapshot(detail);
  assert.equal(snapshot.estudio.renovacion_meses, 6);
  const text = JSON.stringify(buildStudyReport(snapshot, { version: 1, sha256: 'a'.repeat(64), approvedAt: '2026-11-11T15:00:00Z', approverName: 'Alba', preparerName: 'Ana' }).blocks);
  assert.match(text, /Vigencia: este estudio se renueva cada 6 meses, a más tardar el 11 de mayo de 2027, o antes si cambian las instalaciones o se presenta un siniestro/);
});

test('migración 209: frecuencia por defecto de 2 años, valores cerrados, y reversa', async () => {
  const pg = await database();
  const db = supabaseOver(pg);
  const study = await createStudy(db, STUDY, PREPARER);
  assert.equal(study.renewal_months, 24);
  await assert.rejects(pg.query('update public.psi_security_studies set renewal_months = 18'), /renewal_months/);
  await pg.exec(readFileSync(new URL('../supabase/rollbacks/209_estudios_seguridad_vencimiento_rollback.sql', import.meta.url), 'utf8'));
  const columns = await pg.query(`select column_name from information_schema.columns where table_name = 'psi_security_studies' and column_name like 'renewal%'`);
  assert.equal(columns.rows.length, 0);
  assert.equal((await listStudies(db))[0].validity.meses, 24, 'sin la columna, la lista sigue: 2 años');
});
