#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTenderDocumentExtractionRpcParams } from '../tender-document-extraction-persistence.js';
import { loadEnvFile, createSupabaseRestClient } from './agt002-backfill-document-extractions.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

// Identidad fija y auditable con la que este script declara ante
// psi_backfill_legacy_tender_document_extraction (085) que un registro proviene de la
// columna legada `extracted_text`, nunca de una re-ejecución del parser real. El RPC
// atómico fija esta identidad del lado del servidor; este script nunca la envía.
const LEGACY_EXTRACTOR_VERSION = 'legacy-version-register@1';
const LEGACY_PARSER = 'legacy-version-column';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SAFE_ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const FALLBACK_ERROR_CODE = 'backfill_failed';

// Salida de error segura para el CLI: nunca copia error.message/hint/text (pueden
// llevar texto de pliegos, rutas o identificadores internos). Solo un código de
// error saneado a un identificador conservador y el status HTTP si es un entero
// válido; cualquier otra cosa cae al código/status por defecto.
export function safeCliError(error) {
  const rawCode = String(error?.code ?? '').trim().toLowerCase();
  const errorCode = SAFE_ERROR_CODE_PATTERN.test(rawCode) ? String(error.code) : FALLBACK_ERROR_CODE;
  const rawStatus = error?.status;
  const httpStatus = Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599 ? rawStatus : null;
  return { status: 'failed', error_code: errorCode, http_status: httpStatus };
}

function encodeIn(values) {
  return `(${values.map(value => `"${String(value).replaceAll('"', '')}"`).join(',')})`;
}

export function parseArgs(argv) {
  const options = { commit: false, envPath: resolve(root, '.env.local') };
  let opportunityId;
  let actorId;
  let expectedCountRaw;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--commit') options.commit = true;
    else if (token === '--opportunity-id') opportunityId = argv[++index];
    else if (token === '--actor-id') actorId = argv[++index];
    else if (token === '--expected-count') expectedCountRaw = argv[++index];
    else if (token === '--env-file') options.envPath = resolve(argv[++index] || '');
    else throw new Error(`Argumento no soportado: ${token}`);
  }
  if (!opportunityId) throw new Error('Debe indicar --opportunity-id <uuid>.');
  if (!actorId) throw new Error('Debe indicar --actor-id <uuid>.');
  if (expectedCountRaw === undefined) throw new Error('Debe indicar --expected-count <n>.');
  if (!UUID_PATTERN.test(opportunityId)) throw new Error('--opportunity-id debe ser un UUID válido.');
  if (!UUID_PATTERN.test(actorId)) throw new Error('--actor-id debe ser un UUID válido.');
  const expectedCount = Number(expectedCountRaw);
  if (!Number.isInteger(expectedCount) || expectedCount < 1) throw new Error('--expected-count debe ser un entero positivo.');
  options.opportunityId = opportunityId;
  options.actorId = actorId;
  options.expectedCount = expectedCount;
  return options;
}

async function resolveVerifiedActor(client, actorId) {
  const profiles = await client.get(`psi_sales_profiles?select=id,identity_type,active&id=eq.${encodeURIComponent(actorId)}&limit=1`);
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  const identityType = String(profile?.identity_type || '').trim().toLowerCase();
  if (!profile || identityType !== 'human') throw new Error('El actor indicado no es un perfil humano registrado.');
  if (!profile.active) throw new Error('El actor indicado no está activo.');
  return profile.id;
}

async function loadCurrentVersions(client, opportunityId, expectedCount) {
  const rows = await client.get(`psi_tender_document_versions?select=id,opportunity_id,tender_id,current,extracted_text&opportunity_id=eq.${encodeURIComponent(opportunityId)}&current=eq.true`);
  const versions = Array.isArray(rows) ? rows : [];
  for (const version of versions) {
    if (version.opportunity_id !== opportunityId) throw new Error(`La versión ${version.id} no pertenece a la oportunidad indicada.`);
    if (version.current !== true) throw new Error(`La versión ${version.id} no es la versión vigente.`);
  }
  if (versions.length !== expectedCount) {
    throw new Error(`Se encontraron ${versions.length} versiones vigentes pero se esperaban ${expectedCount}.`);
  }
  return versions;
}

async function loadOkExtractionVersionIds(client, versionIds) {
  if (!versionIds.length) return new Set();
  const rows = await client.get(`psi_tender_document_extractions?select=document_version_id,extractor_version,status,text_hash&document_version_id=in.${encodeURIComponent(encodeIn(versionIds))}`);
  const list = Array.isArray(rows) ? rows : [];
  return new Set(list.filter(row => row.status === 'ok').map(row => row.document_version_id));
}

export async function buildBackfillPlan({ opportunityId, actorId, expectedCount, client }) {
  const verifiedActorId = await resolveVerifiedActor(client, actorId);
  const versions = await loadCurrentVersions(client, opportunityId, expectedCount);
  const okVersionIds = await loadOkExtractionVersionIds(client, versions.map(version => version.id));

  const items = versions.map(version => {
    if (okVersionIds.has(version.id)) {
      return { documentVersionId: version.id, tenderId: version.tender_id, action: 'skip' };
    }
    const text = typeof version.extracted_text === 'string' ? version.extracted_text : '';
    if (!text.trim()) throw new Error(`La versión ${version.id} no tiene texto legado para migrar.`);
    const textHash = createHash('sha256').update(text, 'utf8').digest('hex');
    const rpcParams = buildTenderDocumentExtractionRpcParams({
      status: 'ok',
      extractor_version: LEGACY_EXTRACTOR_VERSION,
      parser: LEGACY_PARSER,
      text,
      text_hash: textHash,
      metadata: {},
    }, {
      opportunityId: version.opportunity_id,
      tenderId: version.tender_id,
      documentVersionId: version.id,
      actorId: verifiedActorId,
    });
    return { documentVersionId: version.id, tenderId: version.tender_id, action: 'insert', rpcParams };
  });

  return { opportunityId, actorId: verifiedActorId, items };
}

export function summarizePlan(plan) {
  const items = plan.items.map(item => ({
    document_version_id: item.documentVersionId,
    action: item.action,
    text_hash: item.action === 'insert' ? item.rpcParams.p_text_hash : null,
    char_count: item.action === 'insert' ? item.rpcParams.p_char_count : null,
  }));
  return {
    opportunity_id: plan.opportunityId,
    total: items.length,
    insert: items.filter(item => item.action === 'insert').length,
    skip: items.filter(item => item.action === 'skip').length,
    items,
  };
}

export async function executeBackfill({ client, plan }) {
  const insertItems = plan.items.filter(item => item.action === 'insert');
  for (const item of insertItems) {
    // Único write, únicamente los parámetros que el RPC atómico legado (085) acepta:
    // scope, versión documental, texto/hash/conteos exactos y actor. La identidad del
    // extractor/parser y el estado 'ok' quedan fijos del lado del servidor, nunca
    // enviados desde aquí.
    const {
      p_opportunity_id, p_tender_id, p_document_version_id,
      p_extracted_text, p_text_hash, p_char_count, p_text_byte_count, p_actor_id,
    } = item.rpcParams;
    await client.rpc('psi_backfill_legacy_tender_document_extraction', {
      p_opportunity_id, p_tender_id, p_document_version_id,
      p_extracted_text, p_text_hash, p_char_count, p_text_byte_count, p_actor_id,
    });
  }
  if (!insertItems.length) return { verifiedCount: 0 };

  const rows = await client.get(`psi_tender_document_extractions?select=document_version_id,extractor_version,status,text_hash&document_version_id=in.${encodeURIComponent(encodeIn(insertItems.map(item => item.documentVersionId)))}`);
  const list = Array.isArray(rows) ? rows : [];
  let verifiedCount = 0;
  for (const item of insertItems) {
    const match = list.find(row => row.document_version_id === item.documentVersionId
      && row.extractor_version === item.rpcParams.p_extractor_version
      && row.status === 'ok'
      && row.text_hash === item.rpcParams.p_text_hash);
    if (!match) throw new Error(`La verificación posterior al commit no encontró la extracción persistida para ${item.documentVersionId}.`);
    verifiedCount += 1;
  }
  return { verifiedCount };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  loadEnvFile(options.envPath);
  const client = createSupabaseRestClient({
    baseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  const plan = await buildBackfillPlan({
    opportunityId: options.opportunityId,
    actorId: options.actorId,
    expectedCount: options.expectedCount,
    client,
  });
  let verification = null;
  if (options.commit) verification = await executeBackfill({ client, plan });
  const summary = summarizePlan(plan);
  console.log(JSON.stringify({
    mode: options.commit ? 'commit' : 'dry-run',
    ...summary,
    verified: verification?.verifiedCount || 0,
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(JSON.stringify(safeCliError(error)));
    process.exitCode = 1;
  });
}
