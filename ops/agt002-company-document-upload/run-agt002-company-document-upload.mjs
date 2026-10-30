#!/usr/bin/env node
// AGT-002 — cargar a la ficha de empresa un documento que ya está en el servidor, sin navegador.
//
// Por qué existe. Los documentos corporativos —BASC, las tres ISO, los antecedentes, las resoluciones de agencia—
// están en SharePoint y la única vía para meterlos al CRM era la pantalla, con la sesión de una persona. El
// 2026-10-30 eso atascó la carga tres veces en el mismo día, con Terminal cerrando el 4-nov y 250 de sus 1.000
// puntos dependiendo de cuatro de esos archivos.
//
// Qué hace, y qué NO hace. Sube el archivo al almacenamiento y lo registra con la misma función núcleo que usa la
// ruta web (migración 167: mismas validaciones de tipo, fechas, hash, ruta y tamaño, mismo versionado por
// contenido). **No aprueba la ficha.** La ruta web sí lo hace, porque allí una persona escogió el bloque y subió el
// archivo; aquí lo hace un agente, así que el bloque queda `pending_human_review` y la pantalla lo muestra como
// "Falta confirmar" hasta que alguien lo confirme. Eso es el diseño, no una limitación: la decisión humana sobre la
// evidencia de la empresa no se delega (migraciones 061, 158 y 159).
//
// Uso:
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
//   node ops/agt002-company-document-upload/run-agt002-company-document-upload.mjs \
//     --block <entry_id> --file <ruta> --issued-at AAAA-MM-DD [--expires-at AAAA-MM-DD] [--name "<nombre visible>"] [--dry-run]
//
// `--block` es el `entry_id` del registro de evidencia (`quality_certifications`, `agency_authorizations`,
// `chamber_of_commerce`, `rup`…). La migración 167 exige que exista vigente: un agente no inventa bloques.
// `--issued-at` es obligatorio y no se adivina: es la fecha que los pliegos miran para contar la antigüedad.
import { basename, extname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const log = event => console.log(JSON.stringify(event));

const BUCKET = 'tender-documents';
const MAX_BYTES = 50 * 1024 * 1024;
const MIME_BY_EXTENSION = Object.freeze({
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.doc': 'application/msword',
  '.xls': 'application/vnd.ms-excel',
  '.zip': 'application/zip',
  '.txt': 'text/plain',
});
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--block') { args.block = String(value || ''); index += 1; }
    else if (flag === '--file') { args.file = String(value || ''); index += 1; }
    else if (flag === '--issued-at') { args.issuedAt = String(value || ''); index += 1; }
    else if (flag === '--expires-at') { args.expiresAt = String(value || ''); index += 1; }
    else if (flag === '--name') { args.name = String(value || ''); index += 1; }
    else if (flag === '--dry-run') args.dryRun = true;
    else return { error: `Opción desconocida: ${flag}` };
  }
  if (!args.block) return { error: 'Falta --block <entry_id del registro de evidencia>.' };
  if (!args.file) return { error: 'Falta --file <ruta>.' };
  if (!CALENDAR_DATE.test(args.issuedAt || '')) return { error: 'Falta --issued-at AAAA-MM-DD: la fecha de expedición no se adivina.' };
  if (args.expiresAt && !CALENDAR_DATE.test(args.expiresAt)) return { error: '--expires-at debe ser AAAA-MM-DD.' };
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.error) {
  log({ event: 'agt002_company_document_upload_usage', message: args.error });
  process.exit(2);
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  log({ event: 'agt002_company_document_upload_unavailable', message: 'Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.' });
  process.exit(2);
}

const { AGT002_VIGIA_AGENT_PROFILE_ID } = await import('../../verticales/licitaciones/agt002-phase-change-followup.js');
const { createClient } = await import('@supabase/supabase-js');
const database = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// El bloque tiene que existir vigente. La RPC lo vuelve a comprobar; esto es para fallar temprano y con un mensaje
// que se entienda, en vez de con el error de la base.
const { data: block, error: blockError } = await database
  .from('psi_agt002_company_evidence_registry')
  .select('entry_id,document_class,human_review_status')
  .eq('entry_id', args.block).eq('current', true).eq('integration_active', true)
  .maybeSingle();
if (blockError || !block) {
  log({ event: 'agt002_company_document_upload_failed', block: args.block, message: blockError?.message || 'El bloque no existe vigente en el registro de evidencia empresarial.' });
  process.exit(1);
}

const buffer = await readFile(args.file);
if (!buffer.length) {
  log({ event: 'agt002_company_document_upload_failed', message: `Archivo vacío: ${args.file}` });
  process.exit(1);
}
if (buffer.length > MAX_BYTES) {
  log({ event: 'agt002_company_document_upload_failed', message: `El archivo supera 50 MB: ${args.file}` });
  process.exit(1);
}

const fileName = basename(args.file);
const displayName = args.name || fileName;
const contentHash = createHash('sha256').update(buffer).digest('hex');
const mimeType = MIME_BY_EXTENSION[extname(fileName).toLowerCase()] || 'application/octet-stream';
// Misma forma que la ruta web (`companyDocumentStoragePath`): company-profile/documents/<quien carga>/<id>-<nombre>.
// Con el hash del contenido en vez de un reloj, así que un reintento no deja dos objetos del mismo archivo.
const storagePath = `company-profile/documents/${AGT002_VIGIA_AGENT_PROFILE_ID}/${contentHash.slice(0, 24)}-${fileName}`;

if (args.dryRun) {
  log({
    event: 'agt002_company_document_upload_dry_run',
    block: block.entry_id, document_class: block.document_class, review: block.human_review_status,
    name: displayName, bytes: buffer.length, mime_type: mimeType,
    issued_at: args.issuedAt, expires_at: args.expiresAt || null,
    storage_path: storagePath, content_sha256: contentHash,
  });
  process.exit(0);
}

const upload = await database.storage.from(BUCKET).upload(storagePath, buffer, { contentType: mimeType, upsert: true });
if (upload.error) {
  log({ event: 'agt002_company_document_upload_failed', block: block.entry_id, message: `Almacenamiento: ${String(upload.error.message || upload.error).slice(0, 200)}` });
  process.exit(1);
}

const { data: recorded, error: recordError } = await database.rpc('psi_record_company_procurement_document_as_agent', {
  p_document_type: block.entry_id,
  p_display_name: displayName,
  p_issued_at: args.issuedAt,
  p_expires_at: args.expiresAt || null,
  p_content_hash: contentHash,
  p_storage_path: storagePath,
  p_mime_type: mimeType,
  p_size_bytes: buffer.length,
  p_agent_profile_id: AGT002_VIGIA_AGENT_PROFILE_ID,
});
if (recordError) {
  log({ event: 'agt002_company_document_upload_failed', block: block.entry_id, message: String(recordError.message || recordError).slice(0, 300) });
  process.exit(1);
}

// Readback: el documento se lee de vuelta de la base, no se da por escrito desde la respuesta de la RPC.
const { data: readBack } = await database
  .from('psi_company_procurement_documents')
  .select('id,document_type,display_name,issued_at,expires_at,version,current,size_bytes')
  .eq('id', recorded?.id).maybeSingle();

log({
  event: 'agt002_company_document_upload_done',
  block: block.entry_id,
  document: readBack || recorded,
  // Se dice en cada corrida, para que nadie suponga que cargar aprobó algo.
  ficha: 'El bloque queda pendiente de confirmación humana: la aprobación se registra en la pantalla de Empresa.',
});
