// AGT-002 — automatic INITIAL analysis after a conversion (owner decision, 2026-10-06): converting a tender into an
// opportunity IS the authorization of its first analysis. Once the durable document pipeline has brought the
// documents (processing job in `awaiting_analysis_authorization`), this admits the INITIAL analysis on behalf of the
// person who converted, with the company profile and the document selection rule.
//
// Guards, all fail-closed: only conversions at or after `since`; only opportunities still `prospecto`; never a second
// INITIAL for an opportunity; at most `dailyCap` INITIAL analyses per Bogotá calendar day (the per-analysis USD cap is
// the runtime's AGT002_INITIAL_ANALYSIS_MAX_COST_USD); admission itself still requires both kill switches on.
// It never touches the retired legacy engine: the processing job is left as is and never authorized (migration 087).

import { admitAgt002InitialAnalysis } from './agt002-initial-analysis-admission.js';
import { freezeAgt002CompanyProfileSnapshot } from './agt002-company-profile-snapshot.js';
import { agt002InitialRequestedMembers, selectAgt002InitialDocuments } from './agt002-initial-document-rule.js';

export const AGT002_AUTO_INITIAL_POLICY_VERSION = 'agt002-initial-analysis-policy-v1';
export const AGT002_AUTO_INITIAL_DEFAULT_DAILY_CAP = 5;
const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;
// The G1 window is derived from the conversion, never from "now": a retry after a partial admission must replay the
// exact same grant (its idempotency key binds the expiry), not attempt a second one.
const AUTHORIZATION_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Start of the Bogotá calendar day containing `now`, as a UTC instant (Colombia has no DST). */
export function agt002BogotaDayStart(now) {
  const local = new Date(now.getTime() - BOGOTA_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + BOGOTA_OFFSET_MS);
}

async function must(promise, label) {
  const { data, error } = await promise;
  if (error) {
    const wrapped = new Error(`${label}: ${error.message || 'error de lectura'}`);
    wrapped.code = 'AGT002_AUTO_INITIAL_READ_FAILED';
    throw wrapped;
  }
  return data;
}

/** INITIAL analyses admitted since the start of today (Bogotá), automatic or not. */
export async function countAgt002InitialAnalysesToday(database, now) {
  const rows = await must(database.from('psi_agt002_initial_analysis_jobs')
    .select('id')
    .eq('analysis_kind', 'INITIAL')
    .gte('created_at', agt002BogotaDayStart(now).toISOString()), 'conteo diario');
  return (rows || []).length;
}

// State record kind written by agt002-phase-change-followup.js for each automatic phase-change analysis decision.
export const AGT002_PHASE_CHANGE_ANALYSIS_KIND = 'tender_phase_change_analysis';

/**
 * Automatic admissions (intents written BEFORE admitting) of the phase-change follow-up since the start of today
 * (Bogotá), one row per admission with its opportunity and kind. Owner decision 2026-10-08: these reanalyses do NOT
 * consume nor wait for the daily cap of automatic first analyses; this list only feeds the follow-up's own technical
 * safety net and lets the cap below exclude a phase-change INITIAL.
 */
export async function listAgt002PhaseChangeAdmissionsToday(database, now) {
  const rows = await must(database.from('psi_sales_interactions')
    .select('opportunity_id,notes')
    .eq('interaction_type', 'documento')
    .gte('created_at', agt002BogotaDayStart(now).toISOString())
    .like('notes', `%"kind":"${AGT002_PHASE_CHANGE_ANALYSIS_KIND}"%`), 'conteo diario de reanálisis por fase nueva');
  return (rows || []).flatMap(row => {
    try {
      const notes = JSON.parse(String(row.notes || ''));
      return notes?.kind === AGT002_PHASE_CHANGE_ANALYSIS_KIND && notes.outcome === 'admitting'
        ? [{ opportunityId: row.opportunity_id, analysisKind: notes.analysis_kind }] : [];
    } catch { return []; }
  });
}

/**
 * The daily cap of automatic FIRST analyses (analysis at conversion). INITIAL jobs admitted today, minus the INITIAL
 * ones admitted by the phase-change follow-up (an opportunity converted without analysis that then changed phase):
 * those, like its reanalyses, are outside this cap.
 */
export async function countAgt002AutomaticAnalysesToday(database, now) {
  const phaseChangeInitials = (await listAgt002PhaseChangeAdmissionsToday(database, now)).filter(row => row.analysisKind === 'INITIAL').length;
  return Math.max(0, (await countAgt002InitialAnalysesToday(database, now)) - phaseChangeInitials);
}

/**
 * Conversions whose documents are ready and that still have no INITIAL analysis, oldest first. Each candidate carries
 * the converting person (`requested_by`) as the authorizing actor.
 */
export async function findAgt002AutoInitialCandidates(database, { since }) {
  const jobs = await must(database.from('psi_tender_processing_jobs')
    .select('id,opportunity_id,tender_id,requested_by,status,created_at')
    .eq('status', 'awaiting_analysis_authorization')
    .gte('created_at', since)
    .order('created_at', { ascending: true }), 'trabajos de procesamiento');
  const candidates = [];
  for (const job of jobs || []) {
    const opportunity = await must(database.from('psi_sales_opportunities')
      .select('id,stage_code,service_type_code').eq('id', job.opportunity_id).maybeSingle(), 'oportunidad');
    if (!opportunity || opportunity.stage_code !== 'prospecto' || opportunity.service_type_code !== 'licitacion_publica') continue;
    const initial = await must(database.from('psi_agt002_initial_analysis_jobs')
      .select('id').eq('opportunity_id', job.opportunity_id).limit(1), 'análisis previos');
    if ((initial || []).length > 0) continue;
    candidates.push(job);
  }
  return candidates;
}

/** The governed document selection for one opportunity, from its current versions and their extractions. */
export async function selectAgt002AutoInitialMembers(database, opportunityId) {
  const versions = await must(database.from('psi_tender_document_versions')
    .select('id,name,tender_id').eq('opportunity_id', opportunityId).eq('current', true), 'documentos');
  const extractions = await must(database.from('psi_tender_document_extractions')
    .select('document_version_id,status,char_count,gap_reason,created_at').eq('opportunity_id', opportunityId), 'extracciones');
  const { included, excluded } = selectAgt002InitialDocuments(versions, extractions);
  return { requestedMembers: agt002InitialRequestedMembers(included), includedCount: included.length, excludedCount: excluded.length };
}

/**
 * One pass: admits the INITIAL analysis for every ready conversion, within the daily cap. Returns one event per
 * candidate (admitted, deferred by the cap, skipped, or failed with a closed code) — never throws on one candidate.
 */
export async function runAgt002AutoInitialAdmissions(database, {
  since,
  dailyCap = AGT002_AUTO_INITIAL_DEFAULT_DAILY_CAP,
  now = new Date(),
  environment = process.env,
  admit = admitAgt002InitialAnalysis,
  freezeProfile = freezeAgt002CompanyProfileSnapshot,
} = {}) {
  if (!since || !Number.isFinite(Date.parse(since))) throw new Error('AGT002_AUTO_INITIAL_SINCE es obligatorio y debe ser una fecha válida.');
  if (environment.AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED !== 'true' || environment.AGT002_MODEL_CALLS_ENABLED !== 'true') {
    return [{ event: 'agt002_auto_initial_disabled', reason: 'kill_switch_off' }];
  }
  const candidates = await findAgt002AutoInitialCandidates(database, { since });
  const events = [];
  let admittedToday = await countAgt002AutomaticAnalysesToday(database, now);
  for (const job of candidates) {
    const base = { opportunityId: job.opportunity_id, processingJobId: job.id };
    if (admittedToday >= dailyCap) {
      events.push({ event: 'agt002_auto_initial_deferred', reason: 'daily_cap', dailyCap, ...base });
      continue;
    }
    const expiresAt = new Date(Date.parse(job.created_at) + AUTHORIZATION_WINDOW_MS);
    if (expiresAt <= now) {
      events.push({ event: 'agt002_auto_initial_skipped', reason: 'authorization_window_elapsed', ...base });
      continue;
    }
    try {
      const { requestedMembers, includedCount } = await selectAgt002AutoInitialMembers(database, job.opportunity_id);
      if (includedCount === 0) {
        events.push({ event: 'agt002_auto_initial_skipped', reason: 'no_readable_documents', ...base });
        continue;
      }
      const profile = await freezeProfile(database, { actorProfileId: job.requested_by });
      const admitted = await admit(database, {
        opportunityId: job.opportunity_id,
        tenderId: job.tender_id,
        actorProfileId: job.requested_by,
        requestedMembers,
        scope: 'A_PLUS_B',
        profileSnapshotId: profile.profileSnapshotId,
        profileSnapshotHash: profile.profileSnapshotHash,
        expiresAt: expiresAt.toISOString(),
        policyVersion: AGT002_AUTO_INITIAL_POLICY_VERSION,
        environment,
      });
      if (admitted.admissionStatus === 'admitted') admittedToday += 1;
      events.push({ event: 'agt002_auto_initial_admitted', jobId: admitted.jobId, admissionStatus: admitted.admissionStatus, documents: includedCount, ...base });
    } catch (error) {
      events.push({ event: 'agt002_auto_initial_failed', code: error?.code || error?.diagnostic?.reason || 'ADMISSION_FAILED', ...base });
    }
  }
  return events;
}
