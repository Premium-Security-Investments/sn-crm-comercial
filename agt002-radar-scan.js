import { createHash } from 'node:crypto';
import { agt002RadarEvaluationDate, evaluateAgt002RadarGate } from './agt002-radar-gate.js';
import { ESU_DIRECT_REFRESH_SOURCE } from './esu-direct-refresh.js';
import { isConvertedTenderRow } from './tender-opportunity-stage.js';

// Deterministic, always-on when invoked: this scan filters the fetched page through the gate and
// appends the result to the ledger.
export const AGT002_RADAR_SCAN_STAGES = Object.freeze(['esu_refresh', 'fetch', 'gate', 'ledger']);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  return value;
}
function computeAgt002RadarGateIdempotencyKey(parts) {
  return createHash('sha256').update(JSON.stringify(stableValue(parts))).digest('hex');
}

async function defaultFetch(database, { limit }) {
  const response = await database.from('psi_public_tenders').select('*').order('last_seen_at', { ascending: false }).order('id', { ascending: true }).limit(limit);
  if (response?.error) throw response.error;
  return response?.data || [];
}
async function defaultRefreshEsuDirect() { return { status: 'skipped_fresh', source: ESU_DIRECT_REFRESH_SOURCE }; }

async function defaultRecordGateEvaluation(database, value) {
  if (!database || typeof database.rpc !== 'function') throw new Error('AGT-002 Radar database client required.');
  const response = await database.rpc('psi_record_agt002_radar_gate_evaluation', {
    p_tender_id: value.tenderId, p_stable_key: value.stableKey, p_verdict: value.verdict, p_rule_ids: value.ruleIds, p_reasons: value.reasons,
    p_data_gaps: value.dataGaps, p_policy_version: value.policyVersion, p_context_version: value.contextVersion, p_source_row_hash: value.sourceRowHash,
    p_idempotency_key: value.idempotencyKey, p_evaluated_at: value.evaluatedAt,
  });
  if (response?.error) throw response.error;
  return response?.data ?? null;
}

export function createAgt002RadarScan({
  database, now, fetchTenderPage = defaultFetch, evaluateGate = evaluateAgt002RadarGate,
  recordGateEvaluation = defaultRecordGateEvaluation, refreshEsuDirect = defaultRefreshEsuDirect,
  maxTendersPerRun = 250,
} = {}) {
  if (!Number.isInteger(maxTendersPerRun) || maxTendersPerRun < 1 || maxTendersPerRun > 1000) throw new Error('AGT002_RADAR_SCAN_CONFIG_INVALID');
  return Object.freeze({
    async runOnce() {
      const stages = [];
      let nowIso, evaluationDate;
      try {
        nowIso = now();
        if (typeof nowIso !== 'string' || !Number.isFinite(Date.parse(nowIso))) throw new Error('invalid injected time');
        evaluationDate = agt002RadarEvaluationDate(nowIso);
      } catch {
        return { status: 'unavailable', stages, error_code: 'provider_error' };
      }
      // ESU direct-refresh runs before candidate fetch/gate but never blocks them: a failed or
      // unavailable refresh still lets the scan continue against whatever was already persisted
      // in psi_public_tenders.
      stages.push('esu_refresh');
      let esuRefresh;
      try {
        const result = await refreshEsuDirect(database, { now: nowIso });
        esuRefresh = result && typeof result === 'object' ? result : { status: 'unavailable', source: ESU_DIRECT_REFRESH_SOURCE };
      } catch {
        esuRefresh = { status: 'unavailable', source: ESU_DIRECT_REFRESH_SOURCE };
      }
      let rows;
      try {
        stages.push('fetch');
        rows = await fetchTenderPage(database, { limit: maxTendersPerRun });
        if (!Array.isArray(rows)) throw new Error('fetch did not return rows');
        // Decisión del dueño (2026-10-09): el filtro del Radar diario nunca evalúa ni registra una licitación convertida
        // en oportunidad (activa o no); las activas las sigue sólo la revisión programada.
        rows = rows.filter(row => !isConvertedTenderRow(row));
      } catch {
        return { status: 'unavailable', stages, esu_refresh: esuRefresh, error_code: 'provider_error' };
      }
      const evaluated = [];
      try {
        stages.push('gate');
        for (const row of rows) evaluated.push({ row, evaluation: evaluateGate(row, { nowIso }) });
        stages.push('ledger');
        for (const item of evaluated) {
          const key = computeAgt002RadarGateIdempotencyKey({
            kind: 'gate', tender_id: item.row.id, source_row_hash: item.evaluation.source_row_hash,
            policy_version: item.evaluation.policy_version, context_version: item.evaluation.context_version,
            evaluation_date: item.evaluation.evaluation_date || evaluationDate,
          });
          const stored = await recordGateEvaluation(database, {
            tenderId: item.row.id, stableKey: item.row.stable_key || item.row.stableKey, verdict: item.evaluation.verdict,
            ruleIds: item.evaluation.rule_ids || [], reasons: item.evaluation.reasons || [], dataGaps: item.evaluation.data_gaps || [],
            policyVersion: item.evaluation.policy_version, contextVersion: item.evaluation.context_version,
            sourceRowHash: item.evaluation.source_row_hash, idempotencyKey: key, evaluatedAt: nowIso,
          });
          item.gateEvaluation = { ...item.evaluation, id: stored?.id, tender_id: item.row.id };
        }
      } catch {
        return { status: 'unavailable', stages, esu_refresh: esuRefresh, evaluated: evaluated.length, error_code: 'persistence_failure' };
      }
      const survivors = evaluated.filter(item => item.evaluation.verdict === 'sobreviviente').length;
      const eliminated = evaluated.length - survivors;
      return {
        status: 'completed', stages, esu_refresh: esuRefresh, evaluated: evaluated.length, survivors, eliminated,
      };
    },
  });
}
