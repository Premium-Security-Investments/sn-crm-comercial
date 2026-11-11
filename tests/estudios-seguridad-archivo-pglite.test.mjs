// Estudios de Seguridad Física, tramo 4 — informe y archivo en SharePoint (Juan, 2026-11-05: al aprobar, se archiva).
//
// Con la migración 186 real en PGlite y dependencias simuladas (Word, PDF, SharePoint): la aprobación deja el pedido en
// la misma transacción; el trabajo arma el informe desde la versión congelada, comprueba la huella de cada evidencia,
// sube todo bajo 99_Del_CRM/Estudios_de_Seguridad/ y cierra el pedido; lo fallido se reintenta hasta 3 veces.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { addAction, addRisk, addZone, createStudy, getStudy } from '../verticales/estudios-seguridad/estudios.js';
import { completeEvidenceUpload, requestEvidenceUpload } from '../verticales/estudios-seguridad/evidencias.js';
import { loadWorkflow, transitionStudy } from '../verticales/estudios-seguridad/flujo.js';
import { ARCHIVE_BASE_PATH, archiveFolderPath, buildStudyReport, sharepointSafeName } from '../verticales/estudios-seguridad/informe.js';
import { parseUploadOutput, runArchiveBatch } from '../verticales/estudios-seguridad/archivo.js';
import { AGT002_DOCUMENT_TEMPLATE_PATH } from '../verticales/licitaciones/agt002-document-render.js';
import { buildStudyReportFodt } from '../verticales/estudios-seguridad/render-informe.js';
import { APPROVER, PREPARER, REVIEWER, database, supabaseOver } from './helpers/estudios-seguridad-db.mjs';

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02]);
const STUDY = {
  title: 'Estudio bodega principal', client_source: 'avancys', client_ref: '900123456', client_name: 'Cliente: Prueba S.A.S.', client_nit: '900123456',
  site_source: 'avancys_puesto', site_ref: 'PU-0001', site_name: 'Bodega #1 / Zona Franca', site_city: 'Pereira',
  scope: 'Bodega principal, portería y perímetro.', visit_date: '2026-11-10',
};

async function approvedStudy() {
  const pg = await database();
  const db = supabaseOver(pg);
  const study = await createStudy(db, STUDY, PREPARER);
  const zone = await addZone(db, study.id, { name: 'Bodega 3' }, PREPARER);
  const risk = await addRisk(db, study.id, {
    zone_id: zone.id, catalog_risk_code: 'RB-02', process_code: 'P11', title: 'Acceso indebido a la bodega 3', causes: 'Malla rota',
    probability: 4, impact_company: 4, impact_people: 2, current_control: 'Ronda cada dos horas', current_quality: 3, current_efficacy: 4, current_efficiency: 3,
    proposed_control: 'Reparar la malla', proposed_quality: 4, proposed_efficacy: 4, proposed_efficiency: 4,
  }, PREPARER);
  await addAction(db, study.id, { risk_id: risk.id, description: 'Reparar la malla del costado norte', owner_label: 'Mantenimiento', due_date: '2026-12-15', priority: 'alta' }, PREPARER);
  const ticket = await requestEvidenceUpload(db, study.id, { file_name: 'malla.jpg', mime_type: 'image/jpeg', size_bytes: JPEG.length, risk_id: risk.id });
  db.objects.set(`${ticket.bucket}/${ticket.path}`, JPEG);
  await completeEvidenceUpload(db, study.id, { path: ticket.path, file_name: 'malla.jpg', risk_id: risk.id }, PREPARER);
  for (const [action, who] of [['enviar', PREPARER], ['marcar_revisado', REVIEWER], ['aprobar', APPROVER]]) await transitionStudy(db, study.id, { action }, who);
  return { pg, db, study, risk, ticket };
}

function fakeDeps({ existing = new Set(), failOn = null } = {}) {
  const uploads = [];
  const deps = {
    uploads,
    reports: [],
    renderDocx: async report => { deps.reports.push(report); return Buffer.from(`PK-docx ${report.blocks.length}`); },
    // La foto reducida que embebería el informe: un PNG de 2×1 para la prueba.
    prepareImage: async () => Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DAwMDAwAAAD/4B/0vZ8a8AAAAASUVORK5CYII=', 'base64'),
    toPdf: async () => Buffer.from('%PDF-1.7 informe'),
    upload: async (relativePath, bytes) => {
      if (failOn && relativePath.includes(failOn)) return 'FALLÓ la escritura: 503';
      uploads.push({ relativePath, bytes });
      if (existing.has(relativePath)) return `YA EXISTE: ${relativePath}`;
      return `escrito: x | ${bytes.length} bytes | 201\nreadback: IGUAL | sha256 enviado\nurl: https://sharepoint.test/${encodeURIComponent(relativePath)}\n`;
    },
  };
  return deps;
}

test('migración 186: la aprobación deja el pedido; el trabajo lo toma, lo cierra y reintenta hasta 3 veces', async () => {
  const { pg, db, study } = await approvedStudy();
  const pending = await pg.query(`select version, status, attempts, requested_by from public.psi_security_study_archives where study_id = $1`, [study.id]);
  assert.deepEqual(pending.rows, [{ version: 1, status: 'pendiente', attempts: 0, requested_by: APPROVER.id }], 'el pedido nace con la aprobación');

  const grants = await pg.query(`select grantee, privilege_type from information_schema.role_table_grants where table_name = 'psi_security_study_archives' order by 1, 2`);
  assert.deepEqual(grants.rows.map(row => `${row.grantee}:${row.privilege_type}`).filter(item => !item.startsWith('postgres')), ['service_role:SELECT'], 'sólo se escribe por las funciones');
  for (const fn of ['psi_claim_security_study_archives', 'psi_finish_security_study_archive', 'psi_security_study_transition']) {
    const execute = await pg.query(`select grantee from information_schema.routine_privileges where routine_name = $1 and privilege_type = 'EXECUTE' and grantee <> 'postgres'`, [fn]);
    assert.deepEqual(execute.rows.map(row => row.grantee), ['service_role'], fn);
  }

  // Tres intentos fallidos → fallido, con motivo.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { data: claimed } = await db.rpc('psi_claim_security_study_archives', { p_limit: 3 });
    assert.equal(claimed.length, 1, `intento ${attempt}`);
    await db.rpc('psi_finish_security_study_archive', { p_id: claimed[0].id, p_ok: false, p_folder_path: null, p_report_url: null, p_files: null, p_error: 'SharePoint no aceptó un archivo' });
  }
  const { data: none } = await db.rpc('psi_claim_security_study_archives', { p_limit: 3 });
  assert.equal(none.length, 0);
  const final = await pg.query(`select status, attempts, error from public.psi_security_study_archives where study_id = $1`, [study.id]);
  assert.deepEqual(final.rows[0], { status: 'fallido', attempts: 3, error: 'SharePoint no aceptó un archivo' });

  await pg.exec(readFileSync(new URL('../supabase/rollbacks/186_estudios_seguridad_archivo_rollback.sql', import.meta.url), 'utf8'));
  assert.equal((await pg.query(`select to_regclass('public.psi_security_study_archives') as t`)).rows[0].t, null);
});

test('el trabajo arma el paquete desde la versión congelada y lo sube bajo 99_Del_CRM', async () => {
  const { db, study } = await approvedStudy();
  const deps = fakeDeps();
  const events = [];
  const result = await runArchiveBatch(db, deps, event => events.push(event));
  assert.deepEqual(result, { processed: 1, ok: 1 });
  const photo = deps.reports[0].blocks.find(block => block.kind === 'image');
  assert.deepEqual([photo?.mime, photo?.width, photo?.height], ['image/jpeg', 2, 1], 'la foto del riesgo va reducida dentro del informe');

  const folder = `${ARCHIVE_BASE_PATH}/EST-${new Date().getFullYear()}-0001 Cliente Prueba S.A.S. - Bodega 1 Zona Franca/v1`;
  assert.deepEqual(deps.uploads.map(item => item.relativePath), [
    `${folder}/Informe_EST-${new Date().getFullYear()}-0001_v1.pdf`,
    `${folder}/Informe_EST-${new Date().getFullYear()}-0001_v1.docx`,
    `${folder}/Estudio_EST-${new Date().getFullYear()}-0001_v1.json`,
    `${folder}/evidencias/01_R1_malla.jpg`,
  ]);
  assert.ok(deps.uploads.every(item => item.relativePath.startsWith(`${ARCHIVE_BASE_PATH}/`)), 'nunca fuera de la carpeta del CRM');
  assert.deepEqual(Buffer.from(deps.uploads[3].bytes), Buffer.from(JPEG), 'la foto sube tal cual');

  const workflow = await loadWorkflow(db, (await getStudy(db, study.id)).study, APPROVER);
  const archive = workflow.versions[0].archive;
  assert.equal(archive.status, 'archivado');
  assert.match(archive.report_url, /^https:\/\/sharepoint\.test\/.*\.pdf$/);
  assert.deepEqual(archive.files.map(file => file.tipo), ['informe_pdf', 'informe_word', 'estudio_json', 'foto']);
  assert.equal(JSON.stringify(events).includes('Prueba'), false, 'el registro no lleva nombres');

  // El JSON archivado es exactamente la versión aprobada: misma huella.
  const { data: [version] } = await db.from('psi_security_study_versions').select('snapshot_sha256').eq('study_id', study.id);
  assert.equal(createHash('sha256').update(deps.uploads[2].bytes).digest('hex'), version.snapshot_sha256);
});

test('una evidencia alterada detiene el archivo; un archivo que ya estaba (reintento) cuenta como subido', async () => {
  const { db, ticket } = await approvedStudy();
  db.objects.set(`security-study-evidence/${ticket.path}`, Uint8Array.from([0xff, 0xd8, 0xff, 0x00]));
  assert.deepEqual(await runArchiveBatch(db, fakeDeps()), { processed: 1, ok: 0 });
  const { data: [row] } = await db.from('psi_security_study_archives').select('status, error');
  assert.deepEqual(row, { status: 'pendiente', error: 'una evidencia no coincide con la huella de la versión aprobada' });

  db.objects.set(`security-study-evidence/${ticket.path}`, JPEG);
  // Simula que el intento anterior alcanzó a subir el PDF: "YA EXISTE" no es un error.
  const again = fakeDeps({ existing: new Set() });
  const claimedAgain = await runArchiveBatch(db, { ...again, upload: async (relativePath, bytes) => (relativePath.endsWith('.pdf') ? `YA EXISTE: ${relativePath}` : again.upload(relativePath, bytes)) });
  assert.deepEqual(claimedAgain, { processed: 1, ok: 1 });
  assert.deepEqual(parseUploadOutput('YA EXISTE: x'), { ok: true, url: null, readback: 'existente' });
  assert.deepEqual(parseUploadOutput('FALLÓ la escritura: 503'), { ok: false });
});

test('el informe cabe en el generador con membrete y dice lo que se aprobó', async () => {
  const { db, study } = await approvedStudy();
  const { data: [version] } = await db.from('psi_security_study_versions').select('version, snapshot, snapshot_sha256, approved_at').eq('study_id', study.id);
  const report = buildStudyReport(version.snapshot, { version: 1, sha256: version.snapshot_sha256, approvedAt: version.approved_at, approverName: 'Alba Aprobadora', preparerName: 'Ana Preparadora' });
  // Pasa la validación real del generador (bloques, filas, columnas, textos) sobre la plantilla corporativa.
  const fodt = buildStudyReportFodt(readFileSync(AGT002_DOCUMENT_TEMPLATE_PATH, 'utf8'), report);
  assert.match(fodt, /ESTUDIO DE SEGURIDAD FÍSICA/);
  assert.match(fodt, /Evaluación general/);
  assert.match(fodt, /la magnitud total bajaría de 12 a 8 puntos/, 'la evaluación general se calcula y no queda cortada');
  assert.match(fodt, /12 · Alto/, 'riesgo actual de R1');
  assert.match(fodt, /8 · Moderado/, 'riesgo residual de R1');
  assert.match(fodt, /Reparar la malla del costado norte/);
  assert.match(fodt, new RegExp(version.snapshot_sha256));
  assert.equal(sharepointSafeName('Cliente: "A" / B * C?. '), 'Cliente A B C');
  assert.match(archiveFolderPath(version.snapshot, 1), /^99_Del_CRM\/Estudios_de_Seguridad\/EST-\d{4}-0001 Cliente Prueba S\.A\.S\. - Bodega 1 Zona Franca\/v1$/);
});
