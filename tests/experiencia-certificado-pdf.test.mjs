// Mejora 9, segunda parte (Juan, 2026-11-10; migración 199): el PDF del certificado en la fila del contrato y la revisión
// de Vig-IA contra el RUP. Los dos certificados que había (Matecaña 050, Medellín 086) son escaneados: van por el OCR del
// servidor, dentro del pase que ya existe (agt002-auto-initial), sin un trabajo nuevo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { certificateReviewReadiness, normalizeCertificateReview, reviewExperienceCertificate, buildCertificateReviewInput } from '../verticales/licitaciones/experience-certificate-review.js';
import { runExperienceCertificateOcrPass } from '../verticales/licitaciones/tender-document-ocr.js';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const ENV = Object.freeze({
  AGT002_WORKBENCH_RUNTIME: 'agt002_workbench_bridge_v1', AGT002_WORKBENCH_DRAIN_ENABLED: 'true', AGT002_WORKBENCH_MODEL: 'modelo',
  AGT002_HETZNER_BRIDGE_URL: 'https://puente.example.com/run', AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'x'.repeat(48),
  AGT002_WORKBENCH_AGENT_ID: '33333333-3333-4333-8333-333333333333', AGT002_WORKBENCH_WORKER_ID: 'prueba',
});
const MEDELLIN_OCR = `CERTIFICADO DE SERIEDAD Y CUMPLIMIENTO SOBRE CONTRATOS SUSCRITOS CON SEGURIDAD NACIONAL LTDA. Nit. 891.408.256-4
Entidad Contratante: TERMINALES DE TRANSPORTE DE MEDELLIN S.A. Contrato No: 051-2024 Objeto: Prestación del servicio de vigilancia en las
instalaciones pertenecientes a terminales de transporte de Medellín S.A y los proyectos de ciudad administrados por la entidad.`.repeat(2);
const ROW = { id: 'e1', rup_consecutive: '086', contracting_party: 'Terminales de Transporte de Medellín S.A.', value_smmlv: 4555.52, certificate_storage_path: 'company-profile/experience-certificates/e1/1-cert.pdf', certificate_text: MEDELLIN_OCR, certificate_text_source: 'ocr', certificate_uploaded_at: '2026-11-10T12:00:00Z' };

function fakeDb(row, updates) {
  return { from: () => {
    const chain = { select() { return chain; }, eq() { return chain; }, maybeSingle: async () => ({ data: row, error: null }), update(values) { updates.push(values); return { eq: async () => ({ error: null }) }; } };
    return chain;
  } };
}

test('la revisión sugiere incompleto si falta la fecha de expedición, aunque el modelo diga completo', () => {
  const review = normalizeCertificateReview({ sugerencia: 'completo', resumen: 'Falta la fecha de expedición.', checks: [
    { item: 'entidad_contratante', estado: 'ok', detalle: 'Terminales de Transporte de Medellín' },
    { item: 'fecha_de_expedicion', estado: 'falta', detalle: 'El certificado no dice cuándo se expidió.' },
    { item: 'inventado', estado: 'ok', detalle: 'x' },
  ] });
  assert.equal(review.sugerencia, 'incompleto');
  assert.equal(review.checks.length, 8);
  assert.equal(review.checks.find(check => check.item === 'firma').estado, 'no_verificable');
  assert.ok(!review.checks.some(check => check.item === 'inventado'));
});

test('sólo se revisa con texto suficiente; un escaneo espera el OCR', () => {
  assert.equal(certificateReviewReadiness({}), 'sin_archivo');
  assert.equal(certificateReviewReadiness({ certificate_storage_path: 'p' }), 'esperando_lectura');
  assert.equal(certificateReviewReadiness({ certificate_storage_path: 'p', certificate_text_source: 'sin_texto' }), 'ilegible');
  assert.equal(certificateReviewReadiness(ROW), 'lista');
  const input = buildCertificateReviewInput(ROW);
  assert.equal(input.contrato_segun_rup.consecutivo, '086');
  assert.equal(input.leido_con_ocr, true);
});

test('Vig-IA revisa, guarda la revisión y no toca el estado (lo pone una persona)', async () => {
  const updates = [];
  const calls = [];
  const bridgeClient = { run: async request => { calls.push(request); return { content: JSON.stringify({ sugerencia: 'incompleto', resumen: 'Falta la fecha de expedición.', checks: [{ item: 'fecha_de_expedicion', estado: 'falta', detalle: 'No aparece.' }] }) }; } };
  const result = await reviewExperienceCertificate(fakeDb(ROW, updates), 'e1', { environment: ENV, bridgeClient, log: () => {} });
  assert.equal(result.status, 'ran');
  assert.equal(calls[0].idempotencyKey, 'experience-certificate:e1:2026-11-10T12:00:00Z');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].certificate_review.sugerencia, 'incompleto');
  assert.ok(!('certificate_status' in updates[0]));
  assert.equal((await reviewExperienceCertificate(fakeDb(ROW, []), 'e1', { environment: {}, bridgeClient, log: () => {} })).reason, 'apagada');
  const failing = { run: async () => ({ content: 'no es json' }) };
  assert.equal((await reviewExperienceCertificate(fakeDb(ROW, []), 'e1', { environment: ENV, bridgeClient: failing, log: () => {} })).status, 'failed');
});

test('el OCR del servidor lee los certificados escaneados pendientes y pide la revisión; sin la 199 no hace nada', async () => {
  const updates = [];
  const database = {
    from: () => { const chain = { select() { return chain; }, not() { return chain; }, is() { return chain; }, order() { return chain; }, limit: async () => ({ data: [{ id: 'e1', certificate_storage_path: 'p.pdf' }], error: null }), update(values) { updates.push(values); return { eq: async () => ({ error: null }) }; } }; return chain; },
    storage: { from: () => ({ download: async () => ({ data: new Blob(['%PDF']), error: null }) }) },
  };
  const reviewed = [];
  const events = await runExperienceCertificateOcrPass(database, { ocr: async () => ({ text: MEDELLIN_OCR + ' de la el los que para con por una se del', pages: 2 }), onText: async row => { reviewed.push(row.id); return { status: 'ran' }; } });
  assert.equal(updates[0].certificate_text_source, 'ocr');
  assert.deepEqual(reviewed, ['e1']);
  assert.ok(events.some(event => event.event === 'experience_certificate_review' && event.status === 'ran'));
  const without199 = { from: () => { const chain = { select() { return chain; }, not() { return chain; }, is() { return chain; }, order() { return chain; }, limit: async () => ({ data: null, error: { code: '42703' } }) }; return chain; } };
  assert.deepEqual(await runExperienceCertificateOcrPass(without199), [{ event: 'experience_certificate_ocr_unavailable' }]);
  assert.match(read('ops/agt002-auto-initial/run-agt002-auto-initial.mjs'), /runExperienceCertificateOcrPass\(database/);
});

test('la 199 agrega el PDF y la revisión, con la cola del OCR, y es reversible', async () => {
  const pg = new PGlite();
  await pg.exec(`create table public.psi_company_experience (id uuid primary key default gen_random_uuid(), rup_consecutive text);
    insert into public.psi_company_experience (rup_consecutive) values ('086');`);
  await pg.exec(read('supabase/migrations/199_experiencia_certificado_pdf_y_revision.sql'));
  await pg.exec(read('supabase/migrations/199_experiencia_certificado_pdf_y_revision.sql'));
  await pg.exec(`update psi_company_experience set certificate_storage_path = 'p', certificate_review = '{"sugerencia":"incompleto"}'`);
  await assert.rejects(pg.exec(`update psi_company_experience set certificate_text_source = 'otro'`));
  await pg.exec(read('supabase/rollbacks/199_experiencia_certificado_pdf_y_revision_rollback.sql'));
  assert.equal((await pg.query(`select count(*)::int n from information_schema.columns where table_name = 'psi_company_experience' and column_name like 'certificate%'`)).rows[0].n, 0);
  await pg.close();
});

test('rutas: subir, procesar y revisar piden configurar; ver el PDF pide ver Licitaciones', () => {
  const server = read('server/index.js');
  for (const route of ['certificate-upload-url', 'certificate-process', 'certificate-review']) {
    assert.match(server, new RegExp(`app\\.post\\('/api/tender-company-experience/${route}'[\\s\\S]{0,200}LICITACIONES_CONFIGURE`));
  }
  assert.match(server, /app\.get\('\/api\/tender-company-experience\/certificate-file'[\s\S]{0,200}LICITACIONES_VIEW/);
  assert.match(server, /storagePath\.startsWith\(experienceCertificatePrefix\(experienceId\)\)/);
  assert.equal(server, read('api/[...path].js'));
});
