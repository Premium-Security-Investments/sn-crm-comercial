import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateAgt002RadarGate } from '../agt002-radar-gate.js';
import { projectAgt002RadarLearningObservations } from '../agt002-radar-learning-projection.js';
import { buildAgt002RadarLearningSignals } from '../agt002-radar-learning-retrieval.js';
import { createAgt002RadarPreanalysisRuntime } from '../agt002-radar-preanalysis-runtime.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

function loadEnvFile(path = resolve(root, '.env.local')) {
  let source = '';
  try { source = readFileSync(path, 'utf8'); } catch { return; }
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const separator = line.indexOf('=');
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

async function readRest(baseUrl, serviceKey, table, params) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/rest/v1/${table}?${params}`, {
    method: 'GET',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Lectura ${table} falló con HTTP ${response.status}.`);
  return response.json();
}

function createReadOnlyDatabase(baseUrl, serviceKey) {
  return {
    from(table) {
      let fields = '*';
      return {
        select(value) {
          fields = value;
          return {
            limit(limit) {
              const params = new URLSearchParams({ select: fields, limit: String(limit) });
              return readRest(baseUrl, serviceKey, table, params.toString())
                .then(data => ({ data, error: null }), error => ({ data: null, error }));
            },
          };
        },
      };
    },
  };
}

function candidateFromTender(tender) {
  const normalize = value => typeof value === 'string' && value.trim()
    ? value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    : null;
  const serviceTerms = [...new Set(`${tender.title || ''} ${tender.description || tender.desc || ''}`
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .split(/[^a-z0-9]+/).filter(token => token.length > 3))].sort();
  return {
    tender_id: tender.id,
    service_terms: serviceTerms,
    entity_key: normalize(tender.entity_nit || tender.entity),
    modality_key: normalize(tender.category || tender.modality),
    source_key: normalize(tender.source),
    territory_key: { city: normalize(tender.city), dept: normalize(tender.dept) },
  };
}

export async function runAgt002RadarPreanalysisDryRun({
  tenderId,
  baseUrl,
  serviceKey,
  environment = process.env,
  nowIso = new Date().toISOString(),
} = {}) {
  if (!tenderId) throw new Error('Falta tender-id.');
  if (!baseUrl || !serviceKey) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');
  const params = new URLSearchParams({ select: '*', id: `eq.${tenderId}`, limit: '1' });
  const tenders = await readRest(baseUrl, serviceKey, 'psi_public_tenders', params.toString());
  if (tenders.length !== 1) throw new Error('La licitación solicitada no existe o no es única.');
  const tender = tenders[0];
  const gate = evaluateAgt002RadarGate(tender, { nowIso });
  const gateEvaluation = { ...gate, id: `dryrun:${gate.idempotency_key}` };
  const observations = await projectAgt002RadarLearningObservations(createReadOnlyDatabase(baseUrl, serviceKey), { limit: 1000 });
  const learningSignals = buildAgt002RadarLearningSignals({ candidate: candidateFromTender(tender), observations, maxSignals: 5 });
  const runtime = createAgt002RadarPreanalysisRuntime({ environment: { ...environment, AGT002_RADAR_GATE: 'true' } });
  const output = await runtime.runOnce({
    tenderRow: tender,
    gateEvaluation,
    learningSignals,
    idempotencyKey: `dryrun:${gate.idempotency_key}`,
  });
  return {
    mode: 'read_only_dry_run',
    persisted: false,
    tender_id: tender.id,
    gate: gateEvaluation,
    learning_signals: learningSignals,
    preanalysis: output,
  };
}

export async function main(args = process.argv.slice(2)) {
  const [tenderId] = args;
  if (!tenderId) {
    console.error('Uso: node scripts/agt002-radar-preanalysis-dryrun.mjs <tender-id>');
    process.exitCode = 2;
    return;
  }
  loadEnvFile(process.env.ENV_FILE || resolve(root, '.env.local'));
  const report = await runAgt002RadarPreanalysisDryRun({
    tenderId,
    baseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    environment: process.env,
    nowIso: process.env.AGT002_RADAR_DRYRUN_NOW || new Date().toISOString(),
  });
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
