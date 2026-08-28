import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AGT002_RADAR_GATE_CONTEXT_VERSION,
  AGT002_RADAR_GATE_POLICY_VERSION,
  evaluateAgt002RadarGate,
} from '../agt002-radar-gate.js';
import { isAgt002RadarDerivedDayOnlyChurn } from '../agt002-radar-derived-day-churn.js';

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

function emptyBreakdown() {
  return {
    missing: 0,
    stale_hash: 0,
    stale_policy: 0,
    stale_context: 0,
    fresh_mostrar_en_radar: 0,
    no_mostrar_en_radar: 0,
    no_concluyente: 0,
    invalid_verdict: 0,
  };
}

export function planAgt002RadarGateAudit({
  tenders,
  nowIso,
  canonicalPreanalysisByTenderId = new Map(),
  policyVersion = AGT002_RADAR_GATE_POLICY_VERSION,
  contextVersion = AGT002_RADAR_GATE_CONTEXT_VERSION,
} = {}) {
  if (!Array.isArray(tenders) || !(canonicalPreanalysisByTenderId instanceof Map)) throw new Error('AGT002_RADAR_AUDIT_INPUT_INVALID');
  const evaluations = {};
  const eliminadasPorRegla = {};
  const dataGapsPorTipo = {};
  const muestras = [];
  const ocultables = [];
  const uncovered = [];
  const canonicalBreakdown = emptyBreakdown();
  let sobrevivientes = 0;
  let convertidasEliminadas = 0;

  for (const tender of tenders) {
    const evaluation = evaluateAgt002RadarGate(tender, { nowIso, contextVersion });
    evaluations[tender.id] = evaluation;
    for (const ruleId of evaluation.rule_ids) eliminadasPorRegla[ruleId] = (eliminadasPorRegla[ruleId] || 0) + 1;
    for (const gap of evaluation.data_gaps) dataGapsPorTipo[gap.gap_id] = (dataGapsPorTipo[gap.gap_id] || 0) + 1;
    for (const reason of evaluation.reasons) {
      muestras.push({
        tender_id: tender.id,
        rule_id: reason.rule_id,
        field: reason.field,
        observed_value: String(reason.observed_value || '<vacío>'),
      });
    }

    const converted = tender.internal_status === 'convertida_oportunidad';
    if (evaluation.verdict === 'eliminada') {
      if (converted) convertidasEliminadas += 1;
      else ocultables.push(tender.id);
      continue;
    }
    sobrevivientes += 1;
    if (converted) continue;

    const canonical = canonicalPreanalysisByTenderId.get(tender.id);
    let category;
    // Un rollover diario del recolector externo reescribe SÓLO raw.days/raw.window y por eso cambia
    // el hash literal sin cambiar nada material (agt002-radar-derived-day-churn.js). Se reutiliza el
    // mismo clasificador puro que ya usan el scan y el worker antes de encolar: `stale_hash` sólo
    // aplica si el hash exacto no coincide Y el helper tampoco demuestra equivalencia derivada-solo
    // con la política/contexto vigentes. El helper ya exige que `canonical.policy_version`/
    // `context_version` coincidan con los pasados aquí, así que una política/contexto atrasados
    // nunca se "promueven" a fresco por esta vía: siguen cayendo en `stale_hash` igual que antes.
    const hashMatches = Boolean(canonical) && (
      canonical.source_row_hash === evaluation.source_row_hash
      || isAgt002RadarDerivedDayOnlyChurn(tender, canonical, { policyVersion, contextVersion })
    );
    if (!canonical) category = 'missing';
    else if (!hashMatches) category = 'stale_hash';
    else if (canonical.policy_version !== policyVersion) category = 'stale_policy';
    else if (canonical.context_version !== contextVersion) category = 'stale_context';
    else if (canonical.visibility_verdict === 'mostrar_en_radar') category = 'fresh_mostrar_en_radar';
    else if (canonical.visibility_verdict === 'no_mostrar_en_radar') category = 'no_mostrar_en_radar';
    else if (canonical.visibility_verdict === 'no_concluyente') category = 'no_concluyente';
    else category = 'invalid_verdict';
    canonicalBreakdown[category] += 1;
    if (!['fresh_mostrar_en_radar', 'no_mostrar_en_radar', 'no_concluyente'].includes(category)) uncovered.push(tender.id);
  }

  ocultables.sort();
  uncovered.sort();
  muestras.sort((a, b) => `${a.tender_id}:${a.rule_id}`.localeCompare(`${b.tender_id}:${b.rule_id}`));
  return {
    total: tenders.length,
    policy_version: policyVersion,
    context_version: contextVersion,
    sobrevivientes,
    eliminadas_por_regla: Object.fromEntries(Object.entries(eliminadasPorRegla).sort()),
    data_gaps_por_tipo: Object.fromEntries(Object.entries(dataGapsPorTipo).sort()),
    muestras,
    convertidas_eliminadas_por_gate: convertidasEliminadas,
    ocultables,
    canonical_breakdown: canonicalBreakdown,
    uncovered_visible_tenders: uncovered,
    ready_for_visibility_flag: uncovered.length === 0,
    evaluations,
  };
}

export async function runAgt002RadarGateHistoricalAudit({ baseUrl, serviceKey, nowIso = new Date().toISOString(), fetchImpl = globalThis.fetch } = {}) {
  if (!baseUrl || !serviceKey) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');
  const tenders = await readAll(baseUrl, serviceKey, 'psi_public_tenders', '*', fetchImpl);
  let canonicalRows = [];
  let ledgerAvailable = true;
  try {
    canonicalRows = await readAll(baseUrl, serviceKey, 'psi_agt002_radar_preanalysis_runs', 'tender_id,canonical,visibility_verdict,source_row_hash,policy_version,context_version,completed_at', fetchImpl);
  } catch (error) {
    if (error?.status !== 404) throw error;
    ledgerAvailable = false;
  }
  const canonicalByTenderId = new Map(canonicalRows.filter(row => row.canonical === true).map(row => [row.tender_id, row]));
  const report = planAgt002RadarGateAudit({ tenders, nowIso, canonicalPreanalysisByTenderId: canonicalByTenderId });
  return { ...report, ledger_available: ledgerAvailable, ready_for_visibility_flag: ledgerAvailable && report.ready_for_visibility_flag };
}

export async function main() {
  loadEnvFile(process.env.ENV_FILE || resolve(root, '.env.local'));
  const report = await runAgt002RadarGateHistoricalAudit({
    baseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    nowIso: process.env.AGT002_RADAR_AUDIT_NOW || new Date().toISOString(),
  });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ready_for_visibility_flag) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
