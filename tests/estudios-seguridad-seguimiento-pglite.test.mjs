// Estudios de Seguridad Física, tramo 8 — las acciones aprobadas pasan a Seguimiento gerencial (Juan, 2026-11-06).
//
// Los seguimientos nacen dentro de la transición de aprobar: sólo al aprobar, una sola vez por acción, y sólo las que
// tienen responsable y fecha y siguen abiertas. Cerrar el seguimiento no toca el riesgo ni la acción.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addAction, addRisk, createStudy, getStudy } from '../verticales/estudios-seguridad/estudios.js';
import { loadWorkflow, transitionStudy } from '../verticales/estudios-seguridad/flujo.js';
import { APPROVER, PREPARER, REVIEWER, database, supabaseOver } from './helpers/estudios-seguridad-db.mjs';

const STUDY = {
  title: 'Estudio con plan', client_source: 'avancys', client_ref: '900123456', client_name: 'Cliente de prueba S.A.S.',
  site_source: 'avancys_puesto', site_ref: 'PU-0001', site_name: 'Bodega principal', scope: 'Bodega principal y perímetro.', visit_date: '2026-11-10',
};
const go = (db, study, action, profile) => transitionStudy(db, study.id, { action }, profile);
const followups = async pg => (await pg.query(`select title, owner_label, due_date::text as due_date, origin_type, origin_ref, origin_label, created_by, created_role, status from public.siio_followups order by title`)).rows;

async function studyWithPlan() {
  const pg = await database();
  const db = supabaseOver(pg);
  const study = await createStudy(db, STUDY, PREPARER);
  // P4 × I4 con control 3/4/3 → actual 12, alto: necesita una acción con responsable y fecha.
  const risk = await addRisk(db, study.id, { title: 'Acceso indebido a la bodega', probability: 4, impact_company: 4, impact_people: 2, current_quality: 3, current_efficacy: 4, current_efficiency: 3 }, PREPARER);
  const malla = await addAction(db, study.id, { risk_id: risk.id, description: 'Reparar la malla perimetral', owner_label: 'Mantenimiento', due_date: '2026-12-15', priority: 'alta' }, PREPARER);
  await addAction(db, study.id, { risk_id: risk.id, description: 'Evaluar cámaras térmicas', priority: 'baja' }, PREPARER);
  await addAction(db, study.id, { risk_id: risk.id, description: 'Cambiar candados', owner_label: 'Seguridad', due_date: '2026-11-20', status: 'descartada' }, PREPARER);
  return { pg, db, study, risk, malla };
}

test('migración 188: amplía Seguimiento gerencial sin abrirle permisos, y la reversa conserva los compromisos', async () => {
  const { pg, db, study } = await studyWithPlan();
  await go(db, study, 'enviar', PREPARER);
  await go(db, study, 'marcar_revisado', REVIEWER);
  await go(db, study, 'aprobar', APPROVER);
  const execute = await pg.query(`select grantee from information_schema.routine_privileges where routine_name = 'psi_security_study_transition' and privilege_type = 'EXECUTE'`);
  assert.deepEqual(execute.rows.map(row => row.grantee).filter(name => name !== 'postgres'), ['service_role']);
  const grants = await pg.query(`select grantee from information_schema.role_table_grants where table_name = 'siio_followups' and grantee in ('anon', 'authenticated', 'PUBLIC')`);
  assert.equal(grants.rows.length, 0);

  await pg.exec(readFileSync(new URL('../supabase/rollbacks/188_estudios_seguridad_seguimiento_rollback.sql', import.meta.url), 'utf8'));
  const [kept] = await followups(pg);
  assert.equal(kept.origin_type, 'otro', 'el compromiso se conserva, con el estudio en origin_label');
  assert.equal(kept.created_role, 'admin');
  assert.match(kept.origin_label, /^EST-\d{4}-\d{4} · Cliente de prueba/);
  await assert.rejects(pg.query(`insert into public.siio_followups(title, owner_label, due_date, origin_type, created_role) values ('xxx', 'yy', '2026-12-01', 'estudio_seguridad', 'admin')`), /origin_type_check/);
});

test('al aprobar, cada acción abierta con responsable y fecha crea un compromiso; antes, ninguno', async () => {
  const { pg, db, study, malla } = await studyWithPlan();
  await go(db, study, 'enviar', PREPARER);
  await go(db, study, 'marcar_revisado', REVIEWER);
  assert.equal((await followups(pg)).length, 0, 'enviar y revisar no crean seguimientos');

  const approved = await go(db, study, 'aprobar', APPROVER);
  assert.equal(approved.followups, 1);
  const rows = await followups(pg);
  assert.equal(rows.length, 1, 'sin responsable o fecha, o descartada, no pasa');
  assert.deepEqual({ ...rows[0], origin_label: undefined }, {
    title: 'Reparar la malla perimetral', owner_label: 'Mantenimiento', due_date: '2026-12-15', origin_type: 'estudio_seguridad',
    origin_ref: malla.id, origin_label: undefined, created_by: APPROVER.id, created_role: 'sistema', status: 'abierto',
  });
  assert.match(rows[0].origin_label, /^EST-\d{4}-\d{4} · Cliente de prueba S\.A\.S\. · Bodega principal · R1 Acceso indebido a la bodega$/);

  const detail = await getStudy(db, study.id);
  const workflow = await loadWorkflow(db, detail.study, APPROVER);
  assert.deepEqual(workflow.followups, { total: 1, abiertos: 1, cumplidos: 0 });
});

test('reaprobar no duplica ni reescribe; sólo agrega las acciones nuevas. Cerrar el seguimiento no toca el estudio', async () => {
  const { pg, db, study, risk, malla } = await studyWithPlan();
  for (const [action, who] of [['enviar', PREPARER], ['marcar_revisado', REVIEWER], ['aprobar', APPROVER], ['reabrir', APPROVER]]) await go(db, study, action, who);
  await pg.query(`update public.siio_followups set status = 'cumplido', closed_at = now(), close_reason = 'manual' where origin_ref = $1`, [malla.id]);
  await addAction(db, study.id, { risk_id: risk.id, description: 'Iluminar el patio de cargue', owner_label: 'Mantenimiento', due_date: '2027-01-30' }, PREPARER);
  for (const [action, who] of [['enviar', PREPARER], ['marcar_revisado', REVIEWER]]) await go(db, study, action, who);
  const second = await go(db, study, 'aprobar', APPROVER);
  assert.equal(second.version, 2);
  assert.equal(second.followups, 1, 'sólo la acción nueva');
  const rows = await followups(pg);
  assert.deepEqual(rows.map(row => [row.title, row.status]), [['Iluminar el patio de cargue', 'abierto'], ['Reparar la malla perimetral', 'cumplido']]);

  const detail = await getStudy(db, study.id);
  assert.equal(detail.actions.find(item => item.id === malla.id).status, 'pendiente', 'la acción del estudio no cambia');
  assert.equal(detail.risks[0].valuation.actual.nivel, 'alto', 'el riesgo no se cierra');
  assert.deepEqual((await loadWorkflow(db, detail.study, APPROVER)).followups, { total: 2, abiertos: 1, cumplidos: 1 });
});

test('sin versiones no se consulta el seguimiento, y sin la tabla la ficha se sigue viendo', async () => {
  const { pg, db, study } = await studyWithPlan();
  assert.equal((await loadWorkflow(db, (await getStudy(db, study.id)).study, PREPARER)).followups, null);
  for (const [action, who] of [['enviar', PREPARER], ['marcar_revisado', REVIEWER], ['aprobar', APPROVER]]) await go(db, study, action, who);
  await pg.exec('drop table public.siio_followups cascade');
  assert.equal((await loadWorkflow(db, (await getStudy(db, study.id)).study, APPROVER)).followups, null);
});
