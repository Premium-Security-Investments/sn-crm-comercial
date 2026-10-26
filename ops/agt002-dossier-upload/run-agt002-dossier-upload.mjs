#!/usr/bin/env node
// AGT-002 — cargar al expediente de una licitación un documento que ya está en el servidor, sin navegador.
//
// Por qué existe. La única vía para meter al expediente un documento aportado era la ruta web, con la sesión de
// una persona. El 2026-10-25, en Supersalud `SNS-LP-2-2026`, eso dejó fuera la impresión de "Información del
// procedimiento" —la única copia del cronograma vigente, porque el cronograma no viaja en ningún documento del
// expediente: vive en el formulario de SECOP II— mientras el análisis canónico seguía con las fechas de la fase
// anterior y la inscripción a la visita técnica se vencía sin que nadie lo viera.
//
// Usa la MISMA secuencia gobernada que la ruta web (`ingestTenderDossierDocuments`): versionado por contenido,
// extracción tipada, nota en la línea de tiempo, snapshot y reanálisis incremental. El actor es la identidad
// técnica de Vig-IA, no una persona: queda registrado que lo cargó el agente.
//
// Uso:
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
//   node ops/agt002-dossier-upload/run-agt002-dossier-upload.mjs \
//     --opportunity <uuid> --file <ruta> --origin entidad|propio|tercero [--document-type <tipo>] [--dry-run]
//
// `--origin` es obligatorio y no se adivina: declara QUIÉN produjo el documento (migración 150). Una impresión
// del formulario de SECOP II es `entidad`; un análisis nuestro es `propio`; una carta de un competidor es
// `tercero`. El tipo sí puede omitirse: lo normaliza la cadena a partir del nombre.
import { basename, extname } from 'node:path';
import { readFile } from 'node:fs/promises';

process.env.CRM_SKIP_LISTEN = '1';
process.env.NEXT_PUBLIC_SUPABASE_URL ||= process.env.SUPABASE_URL;

const log = event => console.log(JSON.stringify(event));

const MIME_BY_EXTENSION = Object.freeze({
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.doc': 'application/msword',
  '.xls': 'application/vnd.ms-excel',
  '.zip': 'application/zip',
  '.txt': 'text/plain',
});

function parseArgs(argv) {
  const args = { files: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--opportunity') { args.opportunityId = String(value || ''); index += 1; }
    else if (flag === '--file') { args.files.push(String(value || '')); index += 1; }
    else if (flag === '--origin') { args.origin = String(value || ''); index += 1; }
    else if (flag === '--document-type') { args.documentType = String(value || ''); index += 1; }
    else if (flag === '--dry-run') args.dryRun = true;
    else return { error: `Opción desconocida: ${flag}` };
  }
  if (!args.opportunityId) return { error: 'Falta --opportunity <uuid>.' };
  if (!args.files.length) return { error: 'Falta --file <ruta> (se puede repetir).' };
  if (!args.origin) return { error: 'Falta --origin entidad|propio|tercero: el origen se declara, no se adivina.' };
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.error) {
  log({ event: 'agt002_dossier_upload_usage', message: args.error });
  process.exit(2);
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  log({ event: 'agt002_dossier_upload_unavailable', message: 'Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.' });
  process.exit(2);
}

const api = await import('../../api/[...path].js');
const { AGT002_VIGIA_AGENT_PROFILE_ID } = await import('../../verticales/licitaciones/agt002-phase-change-followup.js');
const { normalizeTenderDocumentOrigin } = await import('../../verticales/licitaciones/tender-document-origin.js');
const { createClient } = await import('@supabase/supabase-js');
const database = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const origin = normalizeTenderDocumentOrigin(args.origin);
if (!origin) {
  log({ event: 'agt002_dossier_upload_usage', message: `--origin inválido: ${args.origin}` });
  process.exit(2);
}

const { data: opportunity, error: opportunityError } = await database
  .from('psi_sales_opportunities')
  .select('id,company_name,deleted_at,archived_at')
  .eq('id', args.opportunityId)
  .maybeSingle();
if (opportunityError || !opportunity) {
  log({ event: 'agt002_dossier_upload_failed', opportunityId: args.opportunityId, message: opportunityError?.message || 'La oportunidad no existe.' });
  process.exit(1);
}
if (opportunity.deleted_at || opportunity.archived_at) {
  log({ event: 'agt002_dossier_upload_failed', opportunityId: args.opportunityId, message: 'La oportunidad está archivada o eliminada.' });
  process.exit(1);
}

const files = [];
for (const path of args.files) {
  const buffer = await readFile(path);
  const name = basename(path);
  files.push({
    name,
    content_base64: buffer.toString('base64'),
    mime_type: MIME_BY_EXTENSION[extname(name).toLowerCase()] || 'application/octet-stream',
    document_type: args.documentType || undefined,
    origin,
  });
  log({ event: 'agt002_dossier_upload_file', name, bytes: buffer.length, origin });
}

if (args.dryRun) {
  log({ event: 'agt002_dossier_upload_dry_run', opportunityId: args.opportunityId, opportunity: opportunity.company_name, files: files.map(file => file.name) });
  process.exit(0);
}

try {
  const result = await api.ingestTenderDossierDocuments(database, {
    opportunityId: args.opportunityId,
    opportunity,
    actorProfileId: AGT002_VIGIA_AGENT_PROFILE_ID,
    files,
  });
  log({
    event: 'agt002_dossier_upload_done',
    opportunityId: args.opportunityId,
    opportunity: opportunity.company_name,
    results: result.upload_results,
    analysis_request: result.analysis_request,
  });
} catch (error) {
  log({ event: 'agt002_dossier_upload_failed', opportunityId: args.opportunityId, message: String(error?.message || error).slice(0, 300) });
  process.exit(1);
}
