// Estudios de Seguridad Física, tramo 3 — revisión, aprobación y versión congelada (Juan, 2026-11-05).
//
// Con la migración 180 real en PGlite: el flujo preparador → revisor → aprobador, la separación de funciones (en el
// servidor y otra vez en la base), lo que debe estar completo para enviar o aprobar, y la versión inmutable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { addAction, addRisk, createStudy, getStudy, updateRisk, updateStudy } from '../verticales/estudios-seguridad/estudios.js';
import { buildSnapshot, canonicalJson, loadWorkflow, readinessIssues, transitionStudy, workflowPermissions } from '../verticales/estudios-seguridad/flujo.js';
import { APPROVER, PREPARER, REVIEWER, database, supabaseOver } from './helpers/estudios-seguridad-db.mjs';

const STUDY = {
  title: 'Estudio para aprobar', client_source: 'avancys', client_ref: '900123456', client_name: 'Cliente de prueba S.A.S.',
  site_source: 'avancys_puesto', site_ref: 'PU-0001', site_name: 'Bodega principal', scope: 'Bodega principal y perímetro.', visit_date: '2026-11-10',
};

async function readyStudy() {
  const pg = await database();
  const db = supabaseOver(pg);
  const study = await createStudy(db, STUDY, PREPARER);
  // P4 × I4 con control 3/4/3 → actual 12, alto: necesita una acción con responsable y fecha.
  const risk = await addRisk(db, study.id, { title: 'Acceso indebido a la bodega', probability: 4, impact_company: 4, impact_people: 2, current_quality: 3, current_efficacy: 4, current_efficiency: 3 }, PREPARER);
  return { pg, db, study, risk };
}

const go = (db, study, action, profile, note) => transitionStudy(db, study.id, { action, note }, profile);

test('migración 180: tablas de solo agregar, función sólo para el servidor y reversa', async () => {
  const pg = await database();
  for (const table of ['psi_security_study_events', 'psi_security_study_versions']) {
    const grants = await pg.query(`select grantee, privilege_type from information_schema.role_table_grants where table_name = $1 order by grantee, privilege_type`, [table]);
    assert.deepEqual(grants.rows.map(row => `${row.grantee}:${row.privilege_type}`).filter(item => !item.startsWith('postgres')), ['service_role:INSERT', 'service_role:SELECT'], `${table}: sólo se agrega`);
  }
  const execute = await pg.query(`select grantee from information_schema.routine_privileges where routine_name = 'psi_security_study_transition' and privilege_type = 'EXECUTE' order by grantee`);
  assert.deepEqual(execute.rows.map(row => row.grantee).filter(name => name !== 'postgres'), ['service_role'], 'ni PUBLIC ni anon ni authenticated');
  const permissions = await pg.query(`select code from public.psi_access_permissions where code like 'estudios_seguridad_%' order by code`);
  assert.deepEqual(permissions.rows.map(row => row.code), ['estudios_seguridad_aprobar', 'estudios_seguridad_revisar']);
  await pg.exec(readFileSync(new URL('../supabase/rollbacks/180_estudios_seguridad_aprobacion_rollback.sql', import.meta.url), 'utf8'));
  assert.equal((await pg.query(`select to_regprocedure('public.psi_security_study_transition(uuid, text, uuid, text, jsonb, text)') as fn`)).rows[0].fn, null);
});

test('el camino completo: enviar, devolver, corregir, revisar, aprobar, reabrir y versión 2', async () => {
  const { db, study, risk } = await readyStudy();

  // No se envía con un riesgo alto sin acción con responsable y fecha.
  await assert.rejects(go(db, study, 'enviar', PREPARER), error => error.status === 422 && /R1 está en nivel alto/.test(error.message));
  await addAction(db, study.id, { risk_id: risk.id, description: 'Reparar la malla', owner_label: 'Mantenimiento', due_date: '2026-12-15' }, PREPARER);
  assert.deepEqual(await go(db, study, 'enviar', PREPARER), { status: 'en_revision', version: null, followups: 0, sha256: null });

  // En revisión no se edita.
  await assert.rejects(updateRisk(db, study.id, risk.id, { probability: 3 }, PREPARER), error => error.status === 409);

  // El revisor devuelve con observación; sin ella, no.
  await assert.rejects(go(db, study, 'devolver', REVIEWER, ''), /escriba la observación/);
  await go(db, study, 'devolver', REVIEWER, 'Falta la calificación del control propuesto.');
  await updateRisk(db, study.id, risk.id, { proposed_quality: 4, proposed_efficacy: 4, proposed_efficiency: 4 }, PREPARER);
  await go(db, study, 'enviar', PREPARER);
  await go(db, study, 'marcar_revisado', REVIEWER);

  const approved = await go(db, study, 'aprobar', APPROVER);
  assert.equal(approved.status, 'aprobado');
  assert.equal(approved.version, 1);
  assert.match(approved.sha256, /^[0-9a-f]{64}$/);

  const detail = await getStudy(db, study.id);
  assert.equal(detail.editable, false, 'lo aprobado no se edita');
  const workflow = await loadWorkflow(db, detail.study, APPROVER);
  assert.deepEqual(workflow.events.map(event => event.action), ['enviar', 'devolver', 'enviar', 'marcar_revisado', 'aprobar']);
  assert.equal(workflow.events[1].note, 'Falta la calificación del control propuesto.');
  assert.equal(workflow.names[REVIEWER.id], 'Rubén Revisor');
  assert.deepEqual(workflow.versions.map(version => [version.version, version.snapshot_sha256]), [[1, approved.sha256]]);
  assert.deepEqual(workflow.can, { enviar: false, marcar_revisado: false, devolver: false, aprobar: false, reabrir: true });

  // La huella guardada es la de la foto guardada.
  const { data: [{ snapshot }] } = await db.from('psi_security_study_versions').select('snapshot').eq('study_id', study.id);
  assert.equal(createHash('sha256').update(canonicalJson(snapshot)).digest('hex'), approved.sha256);
  assert.equal(snapshot.riesgos[0].valoracion.residual.nivel, 'moderado');

  // Reabrir, corregir y aprobar de nuevo da la versión 2; la 1 no cambia.
  await go(db, study, 'reabrir', APPROVER);
  await updateStudy(db, study.id, { title: 'Estudio para aprobar (corregido)' }, PREPARER);
  await go(db, study, 'enviar', PREPARER);
  await go(db, study, 'marcar_revisado', REVIEWER);
  const second = await go(db, study, 'aprobar', APPROVER);
  assert.equal(second.version, 2);
  assert.notEqual(second.sha256, approved.sha256);
  const versions = await db.from('psi_security_study_versions').select('version, snapshot_sha256').eq('study_id', study.id).order('version');
  assert.deepEqual(versions.data.map(row => row.snapshot_sha256), [approved.sha256, second.sha256]);
});

test('quien preparó no revisa ni aprueba, ni aunque tenga los permisos; y la base lo vuelve a negar', async () => {
  const { pg, db, study, risk } = await readyStudy();
  await addAction(db, study.id, { risk_id: risk.id, description: 'Reparar la malla', owner_label: 'Mantenimiento', due_date: '2026-12-15' }, PREPARER);
  const preparerWithEverything = { ...PREPARER, permissions: ['estudios_seguridad', 'estudios_seguridad_revisar', 'estudios_seguridad_aprobar'] };
  await go(db, study, 'enviar', PREPARER);
  await assert.rejects(go(db, study, 'marcar_revisado', preparerWithEverything), error => error.status === 403 && /no puede revisarlo ni aprobarlo/.test(error.message));
  // Sin permiso de revisor tampoco.
  await assert.rejects(go(db, study, 'marcar_revisado', { ...REVIEWER, permissions: ['estudios_seguridad'] }), error => error.status === 403);
  // Aprobar sin pasar por revisado: no.
  await assert.rejects(go(db, study, 'aprobar', APPROVER), error => error.status === 403);
  // Aunque alguien llamara la función directo, la base no deja al preparador.
  await assert.rejects(pg.query(`select public.psi_security_study_transition($1, 'marcar_revisado', $2)`, [study.id, PREPARER.id]), /PREPARADOR_NO_PUEDE/);
  await assert.rejects(pg.query(`select public.psi_security_study_transition($1, 'aprobar', $2)`, [study.id, APPROVER.id]), /TRANSICION_INVALIDA/);
  await assert.rejects(go(db, study, 'cerrar_riesgo', APPROVER), /Acción no válida/);
});

test('lo que tiene que estar completo, y la foto ordenada', async () => {
  const { db, study } = await readyStudy();
  const detail = await getStudy(db, study.id);
  assert.deepEqual(readinessIssues({ ...detail, study: { ...detail.study, scope: '', visit_date: null } }).slice(0, 2), ['Falta el alcance del estudio.', 'Falta la fecha de la visita.']);
  assert.deepEqual(readinessIssues({ ...detail, risks: [] }), ['El estudio no tiene riesgos.']);
  assert.equal(canonicalJson({ b: 1, a: [2, { d: null, c: 'x' }] }), '{"a":[2,{"c":"x","d":null}],"b":1}');
  const first = buildSnapshot(detail);
  const again = buildSnapshot(JSON.parse(JSON.stringify(detail)));
  assert.equal(first.sha256, again.sha256, 'la misma información da la misma huella');
  assert.deepEqual(workflowPermissions(PREPARER, { status: 'borrador', prepared_by: PREPARER.id }), { enviar: true, marcar_revisado: false, devolver: false, aprobar: false, reabrir: false });
});

test('la ficha se sigue viendo sin la migración 180', async () => {
  const db = supabaseOver(await database({ upTo: 2 }));
  const study = await createStudy(db, STUDY, PREPARER);
  const workflow = await loadWorkflow(db, (await getStudy(db, study.id)).study, PREPARER);
  assert.deepEqual([workflow.available, workflow.events, workflow.versions], [false, [], []]);
});
