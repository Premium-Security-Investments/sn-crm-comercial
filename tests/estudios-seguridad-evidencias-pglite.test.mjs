// Estudios de Seguridad Física, tramo 2 — fotos y evidencias (Juan, 2026-11-05).
//
// Con la migración 179 real en PGlite y un depósito en memoria: el servidor sólo registra lo que de verdad subió,
// lo reconoce por sus primeros bytes (no por la extensión) y le calcula la huella.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { addRisk, addZone, createStudy, getStudy } from '../verticales/estudios-seguridad/estudios.js';
import {
  EVIDENCE_BUCKET, MAX_EVIDENCE_BYTES, completeEvidenceUpload, deleteEvidence, evidenceUrls, listEvidence, requestEvidenceUpload, safeFileName, sniffMime,
} from '../verticales/estudios-seguridad/evidencias.js';
import { PREPARER, database, supabaseOver } from './helpers/estudios-seguridad-db.mjs';

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PDF = new TextEncoder().encode('%PDF-1.7\n%prueba');
const STUDY = {
  title: 'Estudio con fotos', client_source: 'avancys', client_ref: '900123456', client_name: 'Cliente de prueba S.A.S.',
  site_source: 'avancys_puesto', site_ref: 'PU-0001', site_name: 'Bodega principal',
};

async function setup() {
  const pg = await database();
  const db = supabaseOver(pg);
  const study = await createStudy(db, STUDY, PREPARER);
  const zone = await addZone(db, study.id, { name: 'Bodega 3' }, PREPARER);
  const risk = await addRisk(db, study.id, { title: 'Malla rota en el costado norte', probability: 4, impact_company: 4, impact_people: 2, zone_id: zone.id }, PREPARER);
  // El navegador sube con el permiso firmado; aquí se simula escribiendo el archivo en el depósito.
  const upload = async (bytes, meta) => {
    const ticket = await requestEvidenceUpload(db, study.id, { size_bytes: bytes.length, ...meta });
    db.objects.set(`${ticket.bucket}/${ticket.path}`, bytes);
    return ticket;
  };
  return { pg, db, study, zone, risk, upload };
}

test('migración 179: tabla con un solo destino, depósito privado, grants y reversa', async () => {
  const { pg, study, zone, risk } = await setup();
  await assert.rejects(pg.exec(`insert into public.psi_security_study_evidence (study_id, zone_id, risk_id, kind, storage_path, file_name, mime_type, size_bytes, sha256, uploaded_by)
    values ('${study.id}', '${zone.id}', '${risk.id}', 'foto', '${study.id}/a.jpg', 'a.jpg', 'image/jpeg', 10, '${'a'.repeat(64)}', '${PREPARER.id}')`), /one_target/);
  await assert.rejects(pg.exec(`insert into public.psi_security_study_evidence (study_id, kind, storage_path, file_name, mime_type, size_bytes, sha256, uploaded_by)
    values ('${study.id}', 'foto', '${study.id}/b.gif', 'b.gif', 'image/gif', 10, '${'a'.repeat(64)}', '${PREPARER.id}')`), /mime_type/);
  const grants = await pg.query(`select grantee, privilege_type from information_schema.role_table_grants where table_name = 'psi_security_study_evidence' order by grantee, privilege_type`);
  assert.deepEqual(grants.rows.map(row => `${row.grantee}:${row.privilege_type}`).filter(item => !item.startsWith('postgres')),
    ['service_role:DELETE', 'service_role:INSERT', 'service_role:SELECT', 'service_role:UPDATE']);
  const rls = await pg.query(`select relrowsecurity from pg_class where relname = 'psi_security_study_evidence'`);
  assert.equal(rls.rows[0].relrowsecurity, true);
  const sql = readFileSync(new URL('../supabase/migrations/179_estudios_seguridad_evidencias.sql', import.meta.url), 'utf8');
  assert.match(sql, /'security-study-evidence',\s*'security-study-evidence',\s*false,\s*15728640/, 'el depósito es privado y de 15 MB');
  await pg.exec(readFileSync(new URL('../supabase/rollbacks/179_estudios_seguridad_evidencias_rollback.sql', import.meta.url), 'utf8'));
  assert.equal((await pg.query(`select to_regclass('public.psi_security_study_evidence') as name`)).rows[0].name, null);
});

test('una foto se sube, se verifica, queda amarrada al riesgo y se puede ver y quitar', async () => {
  const { db, study, risk, upload } = await setup();
  const ticket = await upload(JPEG, { file_name: 'C:\\fotos\\Malla rota ñ.jpg', mime_type: 'image/jpeg', risk_id: risk.id });
  assert.equal(ticket.bucket, EVIDENCE_BUCKET);
  assert.match(ticket.path, new RegExp(`^${study.id}/[0-9a-f-]{36}-Malla-rota-n\\.jpg$`), 'la ruta es del estudio y el nombre queda limpio');

  const evidence = await completeEvidenceUpload(db, study.id, { path: ticket.path, file_name: 'C:\\fotos\\Malla rota ñ.jpg', risk_id: risk.id, caption: 'Costado norte', taken_on: '2026-11-10' }, PREPARER);
  assert.equal(evidence.kind, 'foto');
  assert.equal(evidence.mime_type, 'image/jpeg');
  assert.equal(evidence.size_bytes, JPEG.length);
  assert.equal(evidence.sha256, createHash('sha256').update(JPEG).digest('hex'));
  assert.equal(evidence.file_name, 'Malla rota ñ.jpg');
  assert.equal(evidence.risk_id, risk.id);

  const full = await getStudy(db, study.id);
  assert.equal(full.evidence_available, true);
  assert.deepEqual(full.evidence.map(item => item.id), [evidence.id]);

  const { urls } = await evidenceUrls(db, study.id);
  assert.match(urls[evidence.id], /^https:\/\/firmado\.test\/security-study-evidence\//);

  await deleteEvidence(db, study.id, evidence.id);
  assert.equal((await getStudy(db, study.id)).evidence.length, 0);
  assert.equal(db.objects.has(`${EVIDENCE_BUCKET}/${ticket.path}`), false, 'el archivo también se borra del depósito');
});

test('el servidor no se cree lo que dice el navegador', async () => {
  const { db, study, zone, risk, upload } = await setup();
  await assert.rejects(requestEvidenceUpload(db, study.id, { file_name: 'virus.exe', mime_type: 'application/x-msdownload', size_bytes: 10 }), /Solo se aceptan fotos/);
  await assert.rejects(requestEvidenceUpload(db, study.id, { file_name: 'grande.jpg', mime_type: 'image/jpeg', size_bytes: MAX_EVIDENCE_BYTES + 1 }), /15 MB/);
  await assert.rejects(requestEvidenceUpload(db, study.id, { file_name: 'a.jpg', mime_type: 'image/jpeg', size_bytes: 10, zone_id: zone.id, risk_id: risk.id }), /zona o a un riesgo/);

  // Dice ser JPG pero es texto: se rechaza y se borra del depósito.
  const fake = await upload(new TextEncoder().encode('no soy una foto'), { file_name: 'falsa.jpg', mime_type: 'image/jpeg' });
  await assert.rejects(completeEvidenceUpload(db, study.id, { path: fake.path, file_name: 'falsa.jpg' }, PREPARER), /no es una foto ni un PDF/);
  assert.equal(db.objects.has(`${EVIDENCE_BUCKET}/${fake.path}`), false);

  // Dice ser JPG pero es PDF: se registra como lo que es.
  const pdf = await upload(PDF, { file_name: 'acta.jpg', mime_type: 'image/jpeg' });
  const registered = await completeEvidenceUpload(db, study.id, { path: pdf.path, file_name: 'acta.jpg' }, PREPARER);
  assert.deepEqual([registered.kind, registered.mime_type], ['documento', 'application/pdf']);

  // Ruta de otro estudio o con saltos de carpeta: no.
  await assert.rejects(completeEvidenceUpload(db, study.id, { path: '22222222-2222-4222-8222-222222222222/x.jpg' }, PREPARER), /Ruta de la evidencia inválida/);
  await assert.rejects(completeEvidenceUpload(db, study.id, { path: `${study.id}/../otro/x.jpg` }, PREPARER), /Ruta de la evidencia inválida/);
  // Confirmar algo que nunca se subió: falla y no registra nada.
  await assert.rejects(completeEvidenceUpload(db, study.id, { path: `${study.id}/nunca-subido.jpg` }, PREPARER), /not found/);
  assert.equal((await listEvidence(db, study.id)).evidence.length, 1);
});

test('la ficha se sigue viendo si la migración 179 no se ha aplicado', async () => {
  const pg = await database({ upTo: 1 });
  const db = supabaseOver(pg);
  const study = await createStudy(db, STUDY, PREPARER);
  const full = await getStudy(db, study.id);
  assert.equal(full.evidence_available, false);
  assert.deepEqual(full.evidence, []);
});

test('reconoce los formatos por sus primeros bytes y limpia nombres', () => {
  assert.equal(sniffMime(JPEG), 'image/jpeg');
  assert.equal(sniffMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
  assert.equal(sniffMime(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
  assert.equal(sniffMime(new TextEncoder().encode('\0\0\0\x18ftypheic')), 'image/heic');
  assert.equal(sniffMime(PDF), 'application/pdf');
  assert.equal(sniffMime(new TextEncoder().encode('MZ ejecutable')), null);
  assert.equal(safeFileName('../../etc/passwd'), 'passwd');
  assert.equal(safeFileName('Foto Portería Ñ (1).JPG'), 'Foto-Porteria-N-1-.JPG');
  assert.equal(safeFileName(''), 'archivo');
});
