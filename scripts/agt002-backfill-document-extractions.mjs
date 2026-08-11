#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractTenderDocumentText } from '../tender-document-text-extraction.js';
import { buildTenderDocumentExtractionRpcParams } from '../tender-document-extraction-persistence.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

export function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

export function parseArgs(argv) {
  const options = { commit: false, envPath: resolve(root, '.env.local'), expectedCount: 17 };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--commit') options.commit = true;
    else if (token === '--manifest') options.manifestPath = resolve(argv[++index] || '');
    else if (token === '--env-file') options.envPath = resolve(argv[++index] || '');
    else if (token === '--expected-count') options.expectedCount = Number(argv[++index]);
    else throw new Error(`Argumento no soportado: ${token}`);
  }
  if (!options.manifestPath) throw new Error('Debe indicar --manifest <ruta>.');
  if (!Number.isInteger(options.expectedCount) || options.expectedCount < 1) throw new Error('--expected-count debe ser un entero positivo.');
  return options;
}

function safeError(error) {
  return String(error?.message || error || 'Error').split(/\r?\n/, 1)[0].replace(/[A-Za-z0-9_-]{40,}/g, '[REDACTED]').slice(0, 200);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function encodeIn(values) {
  return `(${values.map(value => `"${String(value).replaceAll('"', '')}"`).join(',')})`;
}

export function createSupabaseRestClient({ baseUrl, serviceKey, fetchImpl = fetch }) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  if (!base || !serviceKey) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
  async function request(path, init = {}) {
    const response = await fetchImpl(`${base}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (!response.ok) {
      const error = new Error(`Supabase respondió HTTP ${response.status}: ${safeError(body?.message || body?.hint || 'respuesta no disponible')}`);
      error.status = response.status;
      error.code = body?.code || '';
      throw error;
    }
    return body;
  }
  return {
    get: path => request(path),
    rpc: (name, payload) => request(`rpc/${name}`, { method: 'POST', body: JSON.stringify(payload), headers: { Prefer: 'return=representation' } }),
  };
}

export function validateManifest(manifest, expectedCount) {
  if (!manifest || typeof manifest !== 'object') throw new Error('Manifest inválido.');
  const opportunityId = String(manifest.opportunity_id || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(opportunityId)) throw new Error('opportunity_id inválido en manifest.');
  const documents = Array.isArray(manifest.documents) ? manifest.documents : [];
  if (documents.length !== expectedCount) throw new Error(`Se esperaban ${expectedCount} documentos y el manifest contiene ${documents.length}.`);
  const ids = new Set();
  for (const document of documents) {
    if (!/^[0-9a-f-]{36}$/i.test(String(document.id || ''))) throw new Error('El manifest contiene un UUID de versión inválido.');
    if (ids.has(document.id)) throw new Error(`Versión duplicada en manifest: ${document.id}`);
    ids.add(document.id);
    if (!/^[0-9a-f]{64}$/i.test(String(document.content_hash || ''))) throw new Error(`Hash inválido para ${document.name || document.id}.`);
    if (!document.local_path || !existsSync(document.local_path)) throw new Error(`No existe el original local para ${document.name || document.id}.`);
  }
  return { opportunityId, documents };
}

async function resolveVerifiedIdentity(client, opportunityId, documents) {
  const versions = await client.get(`psi_tender_document_versions?select=id,opportunity_id,tender_id,content_hash,current&opportunity_id=eq.${opportunityId}&id=in.${encodeURIComponent(encodeIn(documents.map(document => document.id)))}`);
  if (!Array.isArray(versions) || versions.length !== documents.length) throw new Error(`Producción retornó ${versions?.length || 0}/${documents.length} versiones del manifest.`);
  const versionById = new Map(versions.map(version => [version.id, version]));
  const tenderIds = new Set();
  for (const document of documents) {
    const version = versionById.get(document.id);
    if (!version || version.opportunity_id !== opportunityId) throw new Error(`Identidad DB no coincide para ${document.id}.`);
    if (String(version.content_hash || '') !== String(document.content_hash)) throw new Error(`Hash DB/manifest no coincide para ${document.id}.`);
    if (!version.tender_id) throw new Error(`La versión ${document.id} no tiene tender_id.`);
    tenderIds.add(version.tender_id);
  }
  if (tenderIds.size !== 1) throw new Error('Las versiones del manifest no pertenecen a una única licitación.');
  const tenderId = [...tenderIds][0];
  const snapshots = await client.get(`psi_tender_document_snapshots?select=id,actor_id,tender_id,opportunity_id,created_at&opportunity_id=eq.${opportunityId}&tender_id=eq.${tenderId}&order=created_at.desc&limit=1`);
  const snapshot = snapshots?.[0];
  if (!snapshot?.actor_id) throw new Error('No existe snapshot gobernado con actor para auditar el backfill.');
  const profiles = await client.get(`psi_sales_profiles?select=id,identity_type,active&id=eq.${snapshot.actor_id}&limit=1`);
  const profile = profiles?.[0];
  const identityType = String(profile?.identity_type || '').trim().toLowerCase();
  if (!profile?.active || (identityType && identityType !== 'human')) throw new Error('El actor del snapshot no es un perfil humano activo.');
  return { tenderId, actorId: profile.id, versionById };
}

async function loadExistingExtractions(client, ids) {
  try {
    const rows = await client.get(`psi_tender_document_extractions?select=id,document_version_id,extractor_version,status,text_hash,char_count&document_version_id=in.${encodeURIComponent(encodeIn(ids))}`);
    return { migrationReady: true, rows: rows || [] };
  } catch (error) {
    if (error.status === 404 || ['42P01', 'PGRST205'].includes(error.code)) return { migrationReady: false, rows: [] };
    throw error;
  }
}

export async function buildBackfillPlan({ manifest, expectedCount, client, extractImpl = extractTenderDocumentText, readFileImpl = readFileSync }) {
  const { opportunityId, documents } = validateManifest(manifest, expectedCount);
  const identity = await resolveVerifiedIdentity(client, opportunityId, documents);
  const existing = await loadExistingExtractions(client, documents.map(document => document.id));
  const existingKeys = new Set(existing.rows.map(row => `${row.document_version_id}:${row.extractor_version}`));
  const items = [];
  for (const document of documents) {
    const buffer = readFileImpl(document.local_path);
    const localHash = sha256(buffer);
    if (localHash !== document.content_hash || localHash !== document.sha256) throw new Error(`Hash local/manifest no coincide para ${document.id}.`);
    const extraction = await extractImpl(buffer, document.name, document.mime_type || '');
    if (extraction.status !== 'ok') throw new Error(`Extracción no verificable para ${document.id}: ${extraction.gap_reason || extraction.status}`);
    const rpcParams = buildTenderDocumentExtractionRpcParams(extraction, {
      opportunityId, tenderId: identity.tenderId, documentVersionId: document.id, actorId: identity.actorId,
    });
    items.push({
      documentVersionId: document.id,
      sourceDocumentId: document.source_document_id,
      name: document.name,
      localHash,
      extraction,
      rpcParams,
      action: existingKeys.has(`${document.id}:${extraction.extractor_version}`) ? 'verify_existing' : 'insert',
    });
  }
  return { opportunityId, tenderId: identity.tenderId, actorId: identity.actorId, migrationReady: existing.migrationReady, items };
}

export async function executeBackfill({ client, plan }) {
  if (!plan.migrationReady) throw new Error('La migración 065 no está aplicada; no se puede ejecutar --commit.');
  for (const item of plan.items) await client.rpc('psi_record_tender_document_extraction', item.rpcParams);
  const verified = await loadExistingExtractions(client, plan.items.map(item => item.documentVersionId));
  const expectedKeys = new Set(plan.items.map(item => `${item.documentVersionId}:${item.extraction.extractor_version}:${item.extraction.text_hash}`));
  const actualKeys = new Set(verified.rows.filter(row => row.status === 'ok').map(row => `${row.document_version_id}:${row.extractor_version}:${row.text_hash}`));
  for (const key of expectedKeys) if (!actualKeys.has(key)) throw new Error('La verificación posterior no encontró todas las extracciones esperadas.');
  return { verifiedCount: expectedKeys.size };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  loadEnvFile(options.envPath);
  const client = createSupabaseRestClient({
    baseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  const manifest = JSON.parse(readFileSync(options.manifestPath, 'utf8'));
  const plan = await buildBackfillPlan({ manifest, expectedCount: options.expectedCount, client });
  let verification = null;
  if (options.commit) verification = await executeBackfill({ client, plan });
  const totalChars = plan.items.reduce((sum, item) => sum + item.extraction.char_count, 0);
  const summary = {
    mode: options.commit ? 'commit' : 'dry-run',
    opportunity_id: plan.opportunityId,
    tender_id: plan.tenderId,
    migration_ready: plan.migrationReady,
    documents: plan.items.length,
    extraction_ok: plan.items.filter(item => item.extraction.status === 'ok').length,
    insert: plan.items.filter(item => item.action === 'insert').length,
    verify_existing: plan.items.filter(item => item.action === 'verify_existing').length,
    total_chars: totalChars,
    verified: verification?.verifiedCount || 0,
  };
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(JSON.stringify({ status: 'failed', error: safeError(error) }));
    process.exitCode = 1;
  });
}
