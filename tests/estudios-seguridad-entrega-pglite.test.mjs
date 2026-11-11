// Estudios de Seguridad Física: socialización con el cliente y enlace en línea (migración 206; Juan, 2026-11-11).
//
// Héctor: el estudio no está entregado hasta que se socializa. Juan: además del PDF, un enlace donde el cliente lo vea en
// línea. El enlace es una llave: la base guarda sólo su huella, vence, se anula, y la página no muestra más que lo que
// el cliente ya recibe en el informe, con el estado de hoy de cada recomendación.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addAction, addRisk, createStudy, getStudy, updateAction } from '../verticales/estudios-seguridad/estudios.js';
import { transitionStudy } from '../verticales/estudios-seguridad/flujo.js';
import { createShare, loadDelivery, recordDelivery, renderPublicPage, resolvePublicStudy, revokeShare } from '../verticales/estudios-seguridad/entrega.js';
import { APPROVER, PREPARER, REVIEWER, database, supabaseOver } from './helpers/estudios-seguridad-db.mjs';

const STUDY = {
  title: 'Estudio para entregar', client_source: 'avancys', client_ref: '900123456', client_name: 'Cliente <b>de</b> prueba S.A.S.',
  site_source: 'manual', site_name: 'Bodega principal', site_city: 'Pereira', scope: 'Bodega y perímetro.', visit_date: '2026-11-01',
};
const OUTSIDER = { id: '66666666-6666-4666-8666-666666666666', role: 'colaborador', permissions: ['estudios_seguridad'] };

async function approvedStudy() {
  const pg = await database();
  await pg.query(`insert into public.psi_sales_profiles values ($1, 'colaborador', 'Otra Persona')`, [OUTSIDER.id]);
  const db = supabaseOver(pg);
  const study = await createStudy(db, STUDY, PREPARER);
  const risk = await addRisk(db, study.id, {
    title: 'Intrusión por la malla norte', causes: 'Malla rota detrás de la bodega', probability: 5, impact_company: 4,
    current_control: 'Ronda cada dos horas', current_quality: 3, current_efficacy: 4, current_efficiency: 3, residual_probability: 2,
  }, PREPARER);
  const ours = await addAction(db, study.id, { risk_id: risk.id, description: 'Reparar la malla norte', owner_label: 'Mantenimiento', due_date: '2026-12-15' }, PREPARER);
  await addAction(db, study.id, { risk_id: risk.id, description: 'Instalar concertina', owner_label: 'Cliente', due_date: '2027-01-15', responsible_party: 'cliente' }, PREPARER);
  for (const [action, who] of [['enviar', PREPARER], ['marcar_revisado', REVIEWER], ['aprobar', APPROVER]]) await transitionStudy(db, study.id, { action }, who);
  const detail = await getStudy(db, study.id);
  return { pg, db, study: detail.study, ours };
}

const DELIVERY = { delivered_on: '2026-11-10', medium: 'presencial', presented_by: 'Analista y coordinador', attendees: 'Gerente de planta; jefe de seguridad' };

test('migración 206: tablas sólo del servidor, sin token guardado, y reversa', async () => {
  const pg = await database();
  for (const table of ['psi_security_study_deliveries', 'psi_security_study_shares', 'psi_security_study_share_views']) {
    const grants = await pg.query(`select grantee from information_schema.role_table_grants where table_name = $1 and grantee in ('anon', 'authenticated', 'PUBLIC')`, [table]);
    assert.equal(grants.rows.length, 0, table);
    assert.equal((await pg.query(`select relrowsecurity from pg_class where relname = $1`, [table])).rows[0].relrowsecurity, true);
  }
  const columns = await pg.query(`select column_name from information_schema.columns where table_name = 'psi_security_study_shares'`);
  assert.ok(!columns.rows.some(row => row.column_name === 'token'), 'sólo la huella');
  await pg.exec(readFileSync(new URL('../supabase/rollbacks/206_estudios_seguridad_socializacion_enlace_rollback.sql', import.meta.url), 'utf8'));
  assert.equal((await pg.query(`select to_regclass('public.psi_security_study_shares') as t`)).rows[0].t, null);
});

test('la socialización: sólo de una versión aprobada, ya ocurrida, por quien preparó, revisa o aprueba, y una por versión', async () => {
  const pg = await database();
  const db = supabaseOver(pg);
  const draft = await createStudy(db, STUDY, PREPARER);
  await assert.rejects(recordDelivery(db, draft, DELIVERY, PREPARER), error => error.status === 409);

  const { db: db2, study } = await approvedStudy();
  // La aprobación ocurrió ahora (reloj real): la socialización se registra con la fecha de hoy en Colombia.
  const now = new Date();
  const todayCo = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(now);
  const future = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(now.getTime() + 5 * 86400e3));
  await assert.rejects(recordDelivery(db2, study, { ...DELIVERY, delivered_on: future }, PREPARER, now), /fecha futura/);
  await assert.rejects(recordDelivery(db2, study, { ...DELIVERY, delivered_on: '2026-01-01' }, PREPARER, now), /anterior a la aprobación/);
  await assert.rejects(recordDelivery(db2, study, { ...DELIVERY, delivered_on: todayCo, medium: 'paloma' }, PREPARER, now), /Medio/);
  await assert.rejects(recordDelivery(db2, study, { ...DELIVERY, delivered_on: todayCo, attendees: '' }, PREPARER, now), /Asistentes/);
  await assert.rejects(recordDelivery(db2, study, DELIVERY, OUTSIDER, now), error => error.status === 403);
  const delivery = await recordDelivery(db2, study, { ...DELIVERY, delivered_on: todayCo }, REVIEWER, now);
  assert.equal(delivery.version, 1);
  await assert.rejects(recordDelivery(db2, study, { ...DELIVERY, delivered_on: todayCo }, PREPARER, now), /ya tiene su socialización/);
  const loaded = await loadDelivery(db2, study, PREPARER, now);
  assert.deepEqual([loaded.available, loaded.can, loaded.deliveries.length], [true, true, 1]);
  assert.equal((await loadDelivery(db2, study, OUTSIDER, now)).can, false);
});

test('el enlace: la base guarda la huella, la página muestra lo del informe y el estado de hoy, y queda registrada cada apertura', async () => {
  const { pg, db, study, ours } = await approvedStudy();
  const now = new Date('2026-11-11T15:00:00Z');
  await assert.rejects(createShare(db, study, { days: 500 }, PREPARER, now), /Vigencia/);
  await assert.rejects(createShare(db, study, {}, OUTSIDER, now), error => error.status === 403);
  const share = await createShare(db, study, { label: 'Gerente de planta' }, PREPARER, now);
  assert.match(share.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(share.path, `/api/estudios-seguridad/publico/${share.token}`);
  assert.equal(new Date(share.expires_at).toISOString(), '2027-02-09T15:00:00.000Z', '90 días por defecto');
  const dump = JSON.stringify((await pg.query('select * from public.psi_security_study_shares')).rows);
  assert.ok(!dump.includes(share.token), 'el token no queda en la base');

  // El cliente marcó como cumplida nuestra acción: la página lo dice hoy, aunque la versión es la aprobada.
  await pg.query(`update public.psi_security_study_actions set status = 'cumplida' where id = $1`, [ours.id]);
  const result = await resolvePublicStudy(db, share.token, new Date('2026-11-12T15:00:00Z'));
  assert.equal(result.ok, true);
  const view = result.view;
  assert.equal(view.cliente, 'Cliente <b>de</b> prueba S.A.S.');
  assert.deepEqual(view.riesgos.map(item => [item.codigo, item.actual.nivel, item.residual.nivel]), [['R1', 'inaceptable', 'tolerable']]);
  assert.deepEqual(view.recomendaciones.map(item => [item.accion, item.a_cargo, item.estado]), [['Reparar la malla norte', 'Seguridad Nacional', 'Cumplida'], ['Instalar concertina', 'El cliente', 'Pendiente']]);
  const json = JSON.stringify(view);
  for (const hidden of ['Malla rota detrás', 'Ana Preparadora', 'Alba Aprobadora', 'Rubén Revisor', 'Ronda cada dos horas']) assert.ok(!json.includes(hidden), `no muestra: ${hidden}`);

  const html = renderPublicPage(result);
  assert.ok(html.includes('Cliente &lt;b&gt;de&lt;/b&gt; prueba S.A.S.'), 'escapa el texto');
  assert.ok(html.includes('noindex'));
  assert.ok(!/<script|https?:\/\//i.test(html), 'sin scripts ni recursos externos');
  const loaded = await loadDelivery(db, study, PREPARER, new Date('2026-11-12T16:00:00Z'));
  assert.deepEqual(loaded.shares.map(item => [item.state, item.views, item.label]), [['activo', 1, 'Gerente de planta']]);
});

test('vencido, anulado o inventado: la página no muestra nada del estudio', async () => {
  const { db, study } = await approvedStudy();
  const now = new Date('2026-11-11T15:00:00Z');
  const short = await createShare(db, study, { days: 1 }, PREPARER, now);
  assert.deepEqual(await resolvePublicStudy(db, short.token, new Date('2026-11-13T15:00:00Z')), { ok: false, reason: 'vencido' });
  const other = await createShare(db, study, {}, APPROVER, now);
  await assert.rejects(revokeShare(db, study, other.id, OUTSIDER, now), error => error.status === 403);
  await revokeShare(db, study, other.id, REVIEWER, now);
  await assert.rejects(revokeShare(db, study, other.id, REVIEWER, now), error => error.status === 404);
  assert.deepEqual(await resolvePublicStudy(db, other.token, now), { ok: false, reason: 'anulado' });
  assert.deepEqual(await resolvePublicStudy(db, 'x'.repeat(43), now), { ok: false, reason: 'invalido' });
  assert.deepEqual(await resolvePublicStudy(db, '../../etc/passwd', now), { ok: false, reason: 'invalido' });
  const page = renderPublicPage({ ok: false, reason: 'anulado' });
  assert.match(page, /Este enlace fue anulado/);
  assert.ok(!page.includes('Cliente'), 'ni el nombre del cliente');
  const loaded = await loadDelivery(db, study, PREPARER, now);
  assert.deepEqual(loaded.shares.map(item => item.state).sort(), ['activo', 'anulado'], 'el de 1 día sigue activo a esa hora; el otro, anulado');
});
