// Estudios de Seguridad Física: carta de recomendación al cliente (migración 213; Juan, 2026-11-12: "Si").
// Héctor: si el cliente no aplica lo recomendado, se le recuerda por escrito con la evidencia; "eso nos blinda".
// La carta la arma y sube el servidor de tareas; nadie la envía por el SIIO: una persona la manda y registra el envío.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addAction, addRisk, createStudy, getStudy } from '../verticales/estudios-seguridad/estudios.js';
import { transitionStudy } from '../verticales/estudios-seguridad/flujo.js';
import { loadLetters, markLetterSent, requestLetter, runLetterBatch } from '../verticales/estudios-seguridad/cartas.js';
import { AGT002_DOCUMENT_TEMPLATE_PATH } from '../verticales/licitaciones/agt002-document-render.js';
import { buildStudyReportFodt } from '../verticales/estudios-seguridad/render-informe.js';
import { APPROVER, PREPARER, REVIEWER, database, supabaseOver } from './helpers/estudios-seguridad-db.mjs';

const STUDY = {
  title: 'Estudio con plan', client_source: 'avancys', client_ref: '900123456', client_name: 'Cliente de prueba S.A.S.',
  site_source: 'manual', site_name: 'Bodega principal', site_city: 'Pereira', scope: 'Bodega y perímetro.', visit_date: '2026-03-01',
};
const OUTSIDER = { id: '66666666-6666-4666-8666-666666666666', role: 'colaborador', permissions: ['estudios_seguridad'] };
const NOW = new Date('2027-01-20T15:00:00Z');

async function approvedWithPlan() {
  const pg = await database();
  await pg.query(`insert into public.psi_sales_profiles values ($1, 'colaborador', 'Otra Persona')`, [OUTSIDER.id]);
  const db = supabaseOver(pg);
  const study = await createStudy(db, STUDY, PREPARER);
  const risk = await addRisk(db, study.id, { catalog_risk_code: 'RB-03', title: 'Intrusión por la malla norte', probability: 4, impact_company: 4 }, PREPARER);
  await addAction(db, study.id, { risk_id: risk.id, description: 'Reparar la malla norte', owner_label: 'Mantenimiento del cliente', due_date: '2026-12-15', responsible_party: 'cliente' }, PREPARER);
  await addAction(db, study.id, { risk_id: risk.id, description: 'Iluminar el patio', owner_label: 'Cliente', due_date: '2027-06-30', responsible_party: 'cliente' }, PREPARER);
  await addAction(db, study.id, { risk_id: risk.id, description: 'Ronda cada hora', owner_label: 'Seguridad', due_date: '2026-12-01' }, PREPARER);
  for (const [action, who] of [['enviar', PREPARER], ['marcar_revisado', REVIEWER], ['aprobar', APPROVER]]) await transitionStudy(db, study.id, { action }, who);
  // La aprobación fue "hoy" (reloj real); SecurityOps registró después dos novedades graves y una alerta.
  await pg.query(`update public.psi_security_study_versions set approved_at = '2026-11-15T15:00:00Z'`);
  await pg.query(`insert into public.psi_securityops_puestos (id, name) values ('P1', 'Bodega principal')`);
  await pg.query(`update public.psi_security_studies set securityops_puesto_id = 'P1'`);
  await pg.query(`insert into public.psi_security_study_securityops (study_id, puesto_id, status, synced_at, summary, alerts) values ($1, 'P1', 'ok', '2027-01-19T10:00:00Z', $2, $3)`, [
    study.id, JSON.stringify({ novedades: { total: 9, altas: 3, altas_fechas: ['2027-01-10', '2026-12-20', '2026-10-01'] } }),
    JSON.stringify([{ id: 'A1', fecha: '2026-12-21', riesgo: 'Malla rota otra vez', descripcion: 'Huecos en la malla norte.' }, { id: 'A0', fecha: '2026-09-01', riesgo: 'Antes de aprobar', descripcion: null }]),
  ]);
  return { pg, db, study: (await getStudy(db, study.id)).study };
}

function fakeDeps({ failPdf = false } = {}) {
  const deps = { reports: [], uploads: [] };
  deps.renderDocx = async report => { deps.reports.push(report); return Buffer.from('PK-carta'); };
  deps.toPdf = async () => { if (failPdf) throw new Error('soffice'); return Buffer.from('%PDF-1.7 carta'); };
  deps.upload = async (path, bytes) => { deps.uploads.push({ path, bytes }); return `escrito: x | ${bytes.length} bytes | 201\nreadback: IGUAL\nurl: https://sharepoint.test/carta.pdf\n`; };
  return deps;
}

test('la carta lleva sólo lo pendiente a cargo del cliente y la evidencia posterior a la aprobación', async () => {
  const { db, study } = await approvedWithPlan();
  await assert.rejects(requestLetter(db, study, { recipient: 'Gerente de planta' }, OUTSIDER, NOW), error => error.status === 403);
  await assert.rejects(requestLetter(db, study, { recipient: '' }, PREPARER, NOW), /a quién va dirigida/);
  const loaded = await loadLetters(db, study, PREPARER, NOW);
  assert.deepEqual(loaded.pending.map(item => [item.accion, item.vencida]), [['Reparar la malla norte', true], ['Iluminar el patio', false]], 'la nuestra no va');
  const letter = await requestLetter(db, study, { recipient: 'Ing. Pérez, gerente de planta' }, REVIEWER, NOW);
  assert.equal(letter.status, 'pendiente');
  assert.equal(letter.items.length, 2);
  assert.deepEqual([letter.evidence.novedades_graves, letter.evidence.ultima_grave, letter.evidence.alertas.map(alert => alert.riesgo)], [2, '2027-01-10', ['Malla rota otra vez']]);
  const only = await requestLetter(db, study, { recipient: 'Gerente', items: [loaded.pending[0].id] }, PREPARER, NOW);
  assert.equal(only.items.length, 1);
});

test('el servidor de tareas la arma con el membrete, la sube a la carpeta del estudio y queda lista; el envío lo registra una persona', async () => {
  const { db, study } = await approvedWithPlan();
  const letter = await requestLetter(db, study, { recipient: 'Ing. Pérez, gerente de planta' }, PREPARER, NOW);
  await assert.rejects(markLetterSent(db, study, letter.id, { sent_on: '2027-01-20', sent_to: 'Ing. Pérez', sent_medium: 'correo' }, PREPARER, NOW), /no está lista/);
  const deps = fakeDeps();
  assert.deepEqual(await runLetterBatch(db, deps, () => {}, NOW), { processed: 1, ok: 1 });
  assert.match(deps.uploads[0].path, /^99_Del_CRM\/Estudios_de_Seguridad\/EST-\d{4}-\d{4} Cliente de prueba S\.A\.S\. - Bodega principal\/Cartas\/EST-\d{4}-\d{4}_Carta_recomendacion_2027-01-20_[0-9a-f]{8}\.pdf$/);
  const text = JSON.stringify(deps.reports[0].blocks);
  assert.match(text, /Asunto: seguimiento a las recomendaciones del estudio de seguridad EST-/);
  assert.match(text, /Reparar la malla norte/);
  assert.match(text, /15 de diciembre de 2026 \(vencida\)/);
  assert.match(text, /2 novedades de prioridad alta o crítica \(la última, el 10 de enero de 2027\) y 1 alerta de riesgo/);
  assert.ok(!text.includes('Ronda cada hora'), 'lo nuestro no va en la carta al cliente');
  assert.ok(buildStudyReportFodt(readFileSync(AGT002_DOCUMENT_TEMPLATE_PATH, 'utf8'), deps.reports[0]).includes('Ing. Pérez'), 'pasa la validación del generador con membrete');

  const [ready] = (await loadLetters(db, study, PREPARER, NOW)).letters;
  assert.deepEqual([ready.status, ready.file_url], ['lista', 'https://sharepoint.test/carta.pdf']);
  await assert.rejects(markLetterSent(db, study, letter.id, { sent_on: '2027-02-01', sent_to: 'Ing. Pérez', sent_medium: 'correo' }, PREPARER, NOW), /futura/);
  await assert.rejects(markLetterSent(db, study, letter.id, { sent_on: '2027-01-20', sent_to: 'Ing. Pérez', sent_medium: 'paloma' }, PREPARER, NOW), /Medio/);
  await markLetterSent(db, study, letter.id, { sent_on: '2027-01-20', sent_to: 'Ing. Pérez', sent_medium: 'correo' }, PREPARER, NOW);
  assert.equal((await loadLetters(db, study, PREPARER, NOW)).letters[0].status, 'enviada');
  assert.deepEqual(await runLetterBatch(db, fakeDeps(), () => {}, NOW), { processed: 0, ok: 0 }, 'sin pedidos no hace nada');
});

test('si falla, se reintenta hasta 3 veces y queda fallida con el motivo', async () => {
  const { db, study } = await approvedWithPlan();
  await requestLetter(db, study, { recipient: 'Gerente' }, PREPARER, NOW);
  for (let attempt = 1; attempt <= 3; attempt += 1) await runLetterBatch(db, fakeDeps({ failPdf: true }), () => {}, new Date(NOW.getTime() + attempt * 60e3));
  const [letter] = (await loadLetters(db, study, PREPARER, NOW)).letters;
  assert.deepEqual([letter.status, letter.attempts, letter.error], ['fallida', 3, 'no se pudo convertir a PDF']);
});

test('migración 213: sólo del servidor, el envío completo o nada, y reversa', async () => {
  const pg = await database();
  const grants = await pg.query(`select grantee from information_schema.role_table_grants where table_name = 'psi_security_study_letters' and grantee in ('anon', 'authenticated', 'PUBLIC')`);
  assert.equal(grants.rows.length, 0);
  const study = await createStudy(supabaseOver(pg), STUDY, PREPARER);
  await assert.rejects(pg.query(`insert into public.psi_security_study_letters (study_id, version, recipient, items, status, requested_by) values ($1, 1, 'Gerente', '[{}]', 'enviada', $2)`, [study.id, PREPARER.id]), /sent_consistency/);
  await pg.exec(readFileSync(new URL('../supabase/rollbacks/213_estudios_seguridad_cartas_rollback.sql', import.meta.url), 'utf8'));
  assert.equal((await pg.query(`select to_regclass('public.psi_security_study_letters') as t`)).rows[0].t, null);
  assert.deepEqual(await loadLetters(supabaseOver(pg), study, PREPARER), { available: false, letters: [], pending: [], can: false });
});
