import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectAgt002RadarLearningObservations } from '../agt002-radar-learning-projection.js';
import { buildAgt002RadarLearningSignals } from '../agt002-radar-learning-retrieval.js';
import { buildAgt002RadarLearningProposals } from '../agt002-radar-learning-proposals.js';
import { extractTenderCoreServiceTerms } from '../tender-relevance-terms.js';

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

async function readRest(baseUrl, serviceKey, table, params, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/rest/v1/${table}?${params}`, {
    method: 'GET',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Lectura ${table} falló con HTTP ${response.status}.`);
  return response.json();
}

function createReadOnlyDatabase(baseUrl, serviceKey, fetchImpl) {
  return {
    from(table) {
      let fields = '*';
      const filters = new Map();
      const ordering = [];
      const query = {
        select(value) { fields = value; return query; },
        eq(column, value) { filters.set(column, `eq.${value}`); return query; },
        in(column, values) { filters.set(column, `in.(${values.join(',')})`); return query; },
        is(column, value) { filters.set(column, value === null ? 'is.null' : `is.${value}`); return query; },
        order(column, { ascending = true } = {}) { ordering.push(`${column}.${ascending ? 'asc' : 'desc'}`); return query; },
        limit(limit) {
          const params = new URLSearchParams({ select: fields, limit: String(limit), ...Object.fromEntries(filters) });
          if (ordering.length) params.set('order', ordering.join(','));
          return readRest(baseUrl, serviceKey, table, params.toString(), fetchImpl)
            .then(data => ({ data, error: null }), error => ({ data: null, error }));
        },
      };
      return query;
    },
  };
}

function candidateFromTender(tender) {
  const normalize = value => typeof value === 'string' && value.trim()
    ? value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    : null;
  return {
    tender_id: tender.id,
    service_terms: extractTenderCoreServiceTerms(`${tender.title || ''} ${tender.description || tender.desc || ''}`),
    entity_key: normalize(tender.entity_nit || tender.entity),
    modality_key: normalize(tender.category || tender.modality),
    source_key: normalize(tender.source),
    territory_key: { city: normalize(tender.city), dept: normalize(tender.dept) },
  };
}

export async function runAgt002RadarLearningSignalsReport({
  baseUrl,
  serviceKey,
  limit = 1000,
  candidateLimit = 25,
  maxSignals = 5,
  generatedAt = new Date().toISOString(),
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!baseUrl || !serviceKey) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');
  const database = createReadOnlyDatabase(baseUrl, serviceKey, fetchImpl);
  const observations = await projectAgt002RadarLearningObservations(database, { limit });
  const candidateParams = new URLSearchParams({
    select: 'id,title,description,entity,city,dept,source,category',
    order: 'last_seen_at.desc',
    limit: String(candidateLimit),
  });
  const candidates = await readRest(baseUrl, serviceKey, 'psi_public_tenders', candidateParams.toString(), fetchImpl);
  const candidateSignals = candidates.map(tender => ({
    tender_id: tender.id,
    learning: buildAgt002RadarLearningSignals({ candidate: candidateFromTender(tender), observations, maxSignals }),
  }));
  return {
    mode: 'read_only_report',
    persisted: false,
    generated_at: new Date(generatedAt).toISOString(),
    observation_count: observations.precedents.length,
    candidate_signals: candidateSignals,
    governance_proposal: buildAgt002RadarLearningProposals({ observations, generatedAt }),
  };
}

export async function main() {
  loadEnvFile(process.env.ENV_FILE || resolve(root, '.env.local'));
  const report = await runAgt002RadarLearningSignalsReport({
    baseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    limit: Number(process.env.AGT002_RADAR_LEARNING_LIMIT || 1000),
    candidateLimit: Number(process.env.AGT002_RADAR_LEARNING_CANDIDATE_LIMIT || 25),
    maxSignals: Number(process.env.AGT002_RADAR_LEARNING_MAX_SIGNALS || 5),
    generatedAt: process.env.AGT002_RADAR_LEARNING_NOW || new Date().toISOString(),
  });
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
