import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateTenderFit } from '../tender-fit-policy.js';
import {
  projectAgt002RadarLearningObservations,
  collapseAgt002RadarLearningObservationsByTender,
} from '../agt002-radar-learning-projection.js';

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
  if (!response.ok) {
    const error = new Error(`Lectura ${table} falló con HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function readAll(baseUrl, serviceKey, table, select = '*', fetchImpl = globalThis.fetch) {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const params = new URLSearchParams({ select, order: 'id.asc', limit: String(pageSize), offset: String(offset) });
    const page = await readRest(baseUrl, serviceKey, table, params.toString(), fetchImpl);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

// Adaptador de sólo lectura sobre REST: expone la forma `database.from(table).select().eq()...limit()`
// que espera `projectAgt002RadarLearningObservations`, sin introducir un cliente Supabase real.
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
        order(column, { ascending = true } = {}) { ordering.push(`${column}.${ascending ? 'asc' : 'desc'}`); return query; },
        async limit(pageSize) {
          try {
            const rows = [];
            for (let offset = 0; ; offset += pageSize) {
              const params = new URLSearchParams({ select: fields, limit: String(pageSize), offset: String(offset), ...Object.fromEntries(filters) });
              if (ordering.length) params.set('order', ordering.join(','));
              const page = await readRest(baseUrl, serviceKey, table, params.toString(), fetchImpl);
              rows.push(...page);
              if (page.length < pageSize) break;
            }
            return { data: rows, error: null };
          } catch (error) {
            return { data: null, error };
          }
        },
      };
      return query;
    },
  };
}

function legacyBand(score) {
  const value = Number(score);
  if (Number.isFinite(value) && value >= 70) return 'alto';
  if (Number.isFinite(value) && value >= 40) return 'medio';
  return 'bajo';
}

function emptyDistribution(bands) {
  return Object.fromEntries(bands.map(band => [band, 0]));
}

export async function runTenderFitCohortAudit({ baseUrl, serviceKey, nowIso = new Date().toISOString(), fetchImpl = globalThis.fetch } = {}) {
  if (!baseUrl || !serviceKey) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');
  const tenders = await readAll(baseUrl, serviceKey, 'psi_public_tenders', '*', fetchImpl);

  const legacyDistribution = emptyDistribution(['alto', 'medio', 'bajo']);
  const fitDistribution = emptyDistribution(['alto', 'medio', 'por_validar', 'bajo']);
  const tenderById = new Map();
  const fitByTenderId = new Map();
  for (const tender of tenders) {
    legacyDistribution[legacyBand(tender.score)] += 1;
    const fit = evaluateTenderFit(tender, { nowIso });
    fitDistribution[fit.band] += 1;
    tenderById.set(String(tender.id), tender);
    fitByTenderId.set(String(tender.id), fit);
  }

  const database = createReadOnlyDatabase(baseUrl, serviceKey, fetchImpl);
  const observations = await projectAgt002RadarLearningObservations(database, { limit: 1000 });
  const collapsed = collapseAgt002RadarLearningObservationsByTender(observations.precedents);

  // Cruce meramente descriptivo contra `signal_polarity`: nunca ajusta puntajes ni pesos (spec §10.3).
  const observedContext = [];
  for (const observation of collapsed) {
    const tenderId = String(observation.tender_id);
    const fit = fitByTenderId.get(tenderId);
    if (!fit) continue;
    observedContext.push({
      tender_id: tenderId,
      observation_id: observation.observation_id,
      signal_polarity: observation.signal_polarity,
      legacy_band: legacyBand(tenderById.get(tenderId).score),
      fit_band: fit.band,
    });
  }
  observedContext.sort((a, b) => a.tender_id.localeCompare(b.tender_id));

  return {
    cohort_size: tenders.length,
    legacy_distribution: legacyDistribution,
    fit_distribution: fitDistribution,
    observed_context: observedContext,
  };
}

export async function main() {
  loadEnvFile(process.env.ENV_FILE || resolve(root, '.env.local'));
  const report = await runTenderFitCohortAudit({
    baseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    nowIso: process.env.TENDER_FIT_AUDIT_NOW || new Date().toISOString(),
  });
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
