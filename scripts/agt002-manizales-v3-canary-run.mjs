#!/usr/bin/env node
// AGT-002 · Phase 5 · Manizales SA-24-2026 V3 CONTROLLED real-provider canary driver.
//
// Runs the AGT-002 Preview V3 engine ONCE against the REAL Manizales opportunity using ONLY
// existing read-only loaders, following docs/runbooks/agt002-integral-v3-canary.md "Controlled
// single-run". It has two modes:
//   --preflight : assembles the real read-only context and runs engine.analyze with an in-process
//                 SYNTHETIC abstention client. ZERO provider calls. Repeatable. Proves the whole
//                 assembly + verification path against live data before any provider spend.
//   --execute   : assembles the same real context and runs engine.analyze exactly ONCE against the
//                 REAL Hetzner bridge provider. Guarded by a one-shot marker so it can run AT MOST
//                 ONCE total; on failure it is NOT retried.
//
// Hard rules honored:
//   - Credentials are loaded IN-PROCESS ONLY from authorized files; values are never printed,
//     logged, or written to any artifact. Only key NAMES / presence booleans are ever surfaced.
//   - Read-only loaders only; no new access path. No persistence module/RPC, no DB writes, no
//     migration/push/deploy. The persistence module is never imported.
//   - V3 is enabled only inside this process; the flag dies with the process (never written out).
//   - maxConcurrent=1, one-run cap; the bridge client performs no internal retry.
//   - Raw authorized document chunks exist only in process memory; output is sanitized metadata
//     only, guarded by assertNoOpenPii.

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { createAgt002PreviewEngine } from '../agt002-preview-engine.js';
import { createAgt002HetznerBridgeClient } from '../agt002-hetzner-bridge-client.js';
import { AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION } from '../agt002-integral-analysis-v3.js';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS, loadAgt002CompanyEvidenceRegistryEntries } from '../agt002-company-evidence-classes.js';
import { loadAgt002IntegralGovernanceOverrides } from '../agt002-integral-governance-overrides.js';
import { loadAgt002OpportunityContextV2, AGT002_OPPORTUNITY_CONTEXT_SELECT } from '../agt002-opportunity-context-v2.js';
import { loadAgt002CompanyDossier } from '../agt002-company-dossier.js';
import { adaptAgt002RetrievalDocuments } from '../agt002-retrieval-document-adapter.js';
import { getCurrentTenderAnalysis } from '../tender-analysis-foundation.js';
import { selectAgt002ManizalesManifestSource } from '../agt002-manizales-manifest-source.js';
import {
  AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID,
  AGT002_INTEGRAL_MANIFEST_PROCESO,
} from '../agt002-manizales-integral-manifest.js';
import { scrubOpenPii, assertNoOpenPii } from '../agt002-contractual-registry-taxonomy.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXECUTE_MARKER = resolve(PROJECT_ROOT, '.superpowers/sdd/evidence/agt002-v3-canary-execute.marker');

const ABSTAIN_ONLY_STATUSES = new Set(['insufficient_evidence', 'human_validation_required']);

// ---------------------------------------------------------------------------------------------
// In-process credential loading. NEVER prints values. Returns key NAMES only.
// ---------------------------------------------------------------------------------------------
function parseEnvFile(path) {
  const out = {};
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).replace(/^export\s+/, '').trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

// Loads the authorized prerequisites into process.env IN-PROCESS ONLY. Provider config + flags come
// from the f2 verify file; read-only Supabase keys from app/.env.local win for DB reads; controlled
// single-run overrides win last. Returns only key names / presence booleans — never values.
export function loadAgt002CanaryPrerequisitesInProcess({
  providerFile = '/root/worktrees/siio-f2-release/.env.production.f2.verify.tmp',
  supabaseReadOnlyFile = '/root/psi-comercial/plataforma-ventas/app/.env.local',
  environment = process.env,
} = {}) {
  const provider = existsSync(providerFile) ? parseEnvFile(providerFile) : {};
  const supabase = existsSync(supabaseReadOnlyFile) ? parseEnvFile(supabaseReadOnlyFile) : {};

  const providerKeys = ['TENDER_ANALYSIS_ENGINE', 'AGT002_PREVIEW_MODEL', 'AGT002_PREVIEW_POLICY_VERSION', 'AGT002_PREVIEW_TIMEOUT_MS', 'AGT002_HETZNER_BRIDGE_URL', 'AGT002_HETZNER_BRIDGE_HMAC_SECRET'];
  for (const key of providerKeys) {
    // Explicit non-empty process-environment provider settings take precedence over the provider
    // file: the f2 verify file ships redacted placeholders, so a real value injected in-process
    // (e.g. the local systemd bridge's URL/secret mapped in by the operator) must win. The file is
    // only a fallback for keys the environment does not already set.
    const existing = environment[key];
    if (typeof existing === 'string' && existing.trim() !== '') continue;
    if (typeof provider[key] === 'string') environment[key] = provider[key];
  }

  // Read-only Supabase keys win for DB access (least privilege for reads).
  const supabaseKeys = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  for (const key of supabaseKeys) {
    const value = supabase[key] ?? provider[key];
    if (typeof value === 'string') environment[key] = value;
  }

  // Controlled single-run overrides (win last). V3 on only inside this process.
  environment.AGT002_INTEGRAL_CONTRACT_V3 = 'true';
  environment.AGT002_CANONICAL_ONLY = 'true';
  environment.AGT002_CONTEXT_V2 = 'true';
  environment.AGT002_DOCUMENT_RETRIEVAL = 'true';
  environment.AGT002_LEGAL_CORPUS = 'false';
  environment.AGT002_PREVIEW_MAX_CONCURRENT = '1';
  environment.AGT002_PREVIEW_DAILY_MAX_RUNS = '1';
  // Phase 5 remediation for the proven context_window_exceeded failure: the server-owned prompt
  // budget is ON for this controlled run, so both the (zero-provider-call) preflight and any future
  // authorized --execute assemble a measured, deterministically budgeted request that fails closed
  // before the provider call rather than repeating the admission-time overflow. The budget max is
  // the engine default unless the operator sets AGT002_V3_PROMPT_MAX_INPUT_TOKENS explicitly.
  if (typeof environment.AGT002_V3_PROMPT_BUDGET !== 'string' || environment.AGT002_V3_PROMPT_BUDGET.trim() === '') {
    environment.AGT002_V3_PROMPT_BUDGET = 'true';
  }

  const requiredPresent = {
    provider_model: Boolean(environment.AGT002_PREVIEW_MODEL),
    bridge_url: Boolean(environment.AGT002_HETZNER_BRIDGE_URL),
    bridge_hmac_secret: Boolean(environment.AGT002_HETZNER_BRIDGE_HMAC_SECRET),
    supabase_url: Boolean(environment.NEXT_PUBLIC_SUPABASE_URL),
    supabase_service_key: Boolean(environment.SUPABASE_SERVICE_ROLE_KEY),
  };
  return { requiredPresent, keyNamesSeen: [...new Set([...Object.keys(provider), ...Object.keys(supabase)])].sort() };
}

export function turnOffCanaryV3Flag(environment = process.env) {
  // The flag is in-process only; drop it explicitly so nothing downstream observes it after the run.
  delete environment.AGT002_INTEGRAL_CONTRACT_V3;
}

export function createReadOnlySupabaseClient(environment = process.env) {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL || environment.SUPABASE_URL;
  const serviceKey = environment.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('Faltan credenciales Supabase de solo lectura (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

// ---------------------------------------------------------------------------------------------
// Real read-only context assembly (existing loaders only; no writes, no new access path).
// ---------------------------------------------------------------------------------------------
export async function assembleAgt002ManizalesCanaryContext(database) {
  const opportunityId = AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID;

  const opp = await database.from('v_psi_sales_opportunity_enriched').select(AGT002_OPPORTUNITY_CONTEXT_SELECT).eq('id', opportunityId).single();
  if (opp.error) throw new Error(`lectura de oportunidad falló: ${opp.error.code || 'error'}`);
  const opportunity = opp.data;

  const tender = await database.from('psi_public_tenders').select('id,ref').eq('converted_opportunity_id', opportunityId).maybeSingle();
  if (tender.error) throw new Error(`lectura de licitación falló: ${tender.error.code || 'error'}`);
  const tenderId = tender.data?.id ?? null;
  const tenderRef = tender.data?.ref ?? null;

  const currentAnalysis = await getCurrentTenderAnalysis(database, opportunityId, null, { canonicalOnly: true });
  const snapshotId = currentAnalysis?.snapshot_id ?? null;

  const versions = await database.from('psi_tender_document_versions')
    .select('id,opportunity_id,name,document_type,content_hash,storage_path,mime_type,size_bytes,current,source,source_document_id,source_url,version,extracted_text,created_at')
    .eq('opportunity_id', opportunityId).eq('current', true);
  if (versions.error) throw new Error(`lectura de versiones documentales falló: ${versions.error.code || 'error'}`);
  const versionRows = (versions.data || []).filter((row) => row.current !== false);
  const documents = snapshotId ? adaptAgt002RetrievalDocuments(versionRows, { opportunityId, snapshotId }) : [];

  const contextV2Sections = await loadAgt002OpportunityContextV2(database, { opportunityId, tenderId, opportunity });
  const companyDossierV2 = await loadAgt002CompanyDossier(database);
  const companyEvidenceRegistryEntries = await loadAgt002CompanyEvidenceRegistryEntries(database);
  const governance = await loadAgt002IntegralGovernanceOverrides(database, opportunityId);

  // Checked-in manifest, pilot-scope enforced. Category/evidence-link maps are governed by the
  // manifest wiring itself and override any DB overrides for this run.
  const manizalesManifestSource = selectAgt002ManizalesManifestSource({
    integralContractV3: true, opportunityId, process: AGT002_INTEGRAL_MANIFEST_PROCESO,
  });
  const expectedAnalyzableIds = manizalesManifestSource.entries.filter((entry) => entry.analyzable === true).map((entry) => entry.requirement_id);

  const analysisContext = {
    opportunity,
    documents,
    companyProfile: {},
    deepAnalysis: { matrix: { legal: [], financial: [], technical: [] } },
    snapshotId,
    canonicalOnly: true,
    contextV2Sections: { ...contextV2Sections, company_dossier: companyDossierV2 },
  };
  const governed = {
    companyEvidenceRegistryEntries,
    categoryOverrides: governance.categoryOverrides,
    evidenceClassLinkByRequirementId: governance.evidenceClassLinkByRequirementId,
    manizalesManifestSource,
  };
  const meta = {
    opportunity_id: opportunityId,
    tender_ref_matches_pilot: tenderRef === AGT002_INTEGRAL_MANIFEST_PROCESO,
    snapshot_present: Boolean(snapshotId),
    document_count: documents.length,
    evidence_registry_class_count: companyEvidenceRegistryEntries.length,
    canonical_evidence_class_count: AGT002_COMPANY_EVIDENCE_CLASS_IDS.length,
    category_override_count: Object.keys(governance.categoryOverrides || {}).length,
    evidence_class_link_count: Object.keys(governance.evidenceClassLinkByRequirementId || {}).length,
    expected_analyzable_requirement_count: expectedAnalyzableIds.length,
  };
  return { analysisContext, governed, meta, expectedAnalyzableIds };
}

// ---------------------------------------------------------------------------------------------
// Engine builder — identical assembly for preflight and execute; only the client differs.
// ---------------------------------------------------------------------------------------------
export function buildAgt002ManizalesCanaryEngine({ client, environment = process.env, governed, onPromptBudget }) {
  const model = String(environment.AGT002_PREVIEW_MODEL || '').trim() || 'agt002-canary-model';
  const policyVersion = String(environment.AGT002_PREVIEW_POLICY_VERSION || '').trim() || 'agt002-integral-v3-policy-1';
  const timeoutMs = Number.parseInt(environment.AGT002_PREVIEW_TIMEOUT_MS || '30000', 10) || 30000;
  // Phase 5 remediation: prompt budgeting is engine-level (server-owned) configuration, read from
  // the controlled in-process env only. Default max is the engine's conservative default unless the
  // operator sets an explicit AGT002_V3_PROMPT_MAX_INPUT_TOKENS. onPromptBudget surfaces sanitized
  // before/after metadata for the report; it is never given raw content.
  const promptBudget = String(environment.AGT002_V3_PROMPT_BUDGET || '').trim() === 'true';
  const promptMaxRaw = Number.parseInt(environment.AGT002_V3_PROMPT_MAX_INPUT_TOKENS || '', 10);
  const promptMaxInputTokens = Number.isInteger(promptMaxRaw) && promptMaxRaw > 0 ? promptMaxRaw : undefined;
  return createAgt002PreviewEngine({
    client,
    model,
    policyVersion,
    timeoutMs,
    maxConcurrent: 1,
    dailyMaxRuns: 1,
    countDailyRuns: async () => 0,
    contextV2: true,
    documentRetrieval: true,
    integralContractV3: true,
    legalCorpus: false,
    companyEvidenceClassesProvider: () => governed.companyEvidenceRegistryEntries,
    categoryOverrides: governed.categoryOverrides,
    evidenceClassLinkByRequirementId: governed.evidenceClassLinkByRequirementId,
    manizalesManifestSource: governed.manizalesManifestSource,
    ...(promptBudget ? { promptBudget: true } : {}),
    ...(promptBudget && promptMaxInputTokens ? { promptMaxInputTokens } : {}),
    ...(promptBudget && typeof onPromptBudget === 'function' ? { onPromptBudget } : {}),
  });
}

// Synthetic abstention client for the preflight — leaves category/evidence_state null (server
// governs), abstains every unit, adds no evidence and no missing evidence. No network.
export function buildAgt002ManizalesCanaryPreflightClient() {
  const calls = [];
  return {
    calls,
    async run(options) {
      calls.push({ model: options?.model ?? null });
      const manifest = options.input.document_evidence.requirement_manifest;
      const units = manifest.map((entry, index) => ({
        unit_id: `UNIT-${String(index + 1).padStart(2, '0')}`,
        unit_kind: 'tender_requirement',
        requirement_id: entry.requirement_id,
        category: null,
        sequence: index + 1,
        title: `Requisito gobernado ${index + 1}`,
        assessment_mode: 'abstained',
        conclusion: { status: 'human_validation_required', summary: 'Pendiente de validación humana (preflight sintético).', confidence: 'unavailable' },
        blocking: { effect: 'undetermined', curability: 'undetermined', reason: 'Sin determinación automática; requiere revisión humana.' },
        evidence_state: null,
        evidence_refs: [],
        missing_evidence: [],
        commercial_impact: { level: 'unknown', summary: 'Impacto no determinado.', dimension: 'unknown' },
        legal_assessment: { status: 'not_applicable', basis_refs: [], summary: 'No aplica fundamento jurídico.', human_legal_review_required: false },
        actions: [],
        milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito.' },
        escalation: { required: false, level: 'none', reason: 'Sin condición crítica.' },
        closure: { status: 'human_confirmation_required', condition: 'Persona autorizada valida.', evidence_required: [] },
        human_validation: { required: true, status: 'pending', reason: 'Validación humana pendiente.' },
      }));
      return { content: JSON.stringify({ integral_analysis: { analysis_units: units } }), usage: { input_tokens: 13, output_tokens: 13 } };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Pure verification of the engine output against the brief item-3 criteria.
// ---------------------------------------------------------------------------------------------
export function verifyAgt002ManizalesCanaryEnvelope(envelope, { expectedAnalyzableIds }) {
  const failures = [];
  const checks = {};
  const record = (key, ok, message) => { checks[key] = ok; if (!ok) failures.push(message); };

  const integral = envelope?.integral_analysis;
  const units = Array.isArray(integral?.analysis_units) ? integral.analysis_units : [];
  const coverage = integral?.coverage;

  record('contract_version', integral?.contract_version === AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION,
    `integral_analysis.contract_version debe ser "${AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION}".`);
  record('schema_version', envelope?.schema_version === '3.0.0', 'schema_version debe ser "3.0.0".');

  const expected = Array.isArray(expectedAnalyzableIds) ? expectedAnalyzableIds : [];
  const orderedIds = units.map((unit) => unit?.requirement_id);
  const coverageOrdered1to1 = expected.length === 20
    && arraysEqual(coverage?.expected_requirement_ids, expected)
    && arraysEqual(coverage?.analyzed_requirement_ids, expected)
    && arraysEqual(orderedIds, expected);
  record('coverage_ordered_1to1', coverageOrdered1to1, 'cobertura 1:1 ordenada de los 20 requisitos analizables no se cumple.');

  const everyEvidenceOrAbstention = units.length > 0 && units.every((unit) => {
    const abstained = unit?.assessment_mode === 'abstained' && ABSTAIN_ONLY_STATUSES.has(unit?.conclusion?.status);
    const hasEvidence = Array.isArray(unit?.evidence_refs) && unit.evidence_refs.length >= 1;
    return abstained || hasEvidence;
  });
  record('evidence_or_abstention', everyEvidenceOrAbstention, 'cada unidad debe tener evidencia citada o abstención explícita.');

  record('human_review_required', envelope?.v2_projection?.human_review_required === true, 'v2_projection.human_review_required debe ser true.');

  const scope = envelope?.manifest_scope;
  const scopeOk = Boolean(scope) && arraysEqual(scope?.analyzable_requirement_ids, expected);
  record('manifest_scope', scopeOk, 'manifest_scope top-level gobernado por el servidor debe cubrir exactamente los 20 requisitos analizables.');

  return { ok: failures.length === 0, checks, failures };
}

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

// ---------------------------------------------------------------------------------------------
// Sanitized summary — metadata only. No raw content, no model prose, no PII.
// ---------------------------------------------------------------------------------------------
export function buildAgt002ManizalesCanarySanitizedSummary(envelope, verification, meta = {}) {
  const units = Array.isArray(envelope?.integral_analysis?.analysis_units) ? envelope.integral_analysis.analysis_units : [];
  const perRequirement = units.map((unit) => ({
    requirement_id: unit.requirement_id,
    category: unit.category,
    assessment_mode: unit.assessment_mode,
    conclusion_status: unit?.conclusion?.status ?? null,
    evidence_state: unit.evidence_state ? {
      presence: unit.evidence_state.presence,
      review: unit.evidence_state.review,
      validity: unit.evidence_state.validity,
      applicability: unit.evidence_state.applicability,
      compliance: unit.evidence_state.compliance,
    } : null,
    missing_evidence_ids: Array.isArray(unit.missing_evidence) ? unit.missing_evidence.map((item) => item.missing_id) : [],
    evidence_ref_count: Array.isArray(unit.evidence_refs) ? unit.evidence_refs.length : 0,
  }));
  const summary = {
    mode: meta.mode ?? null,
    proceso: AGT002_INTEGRAL_MANIFEST_PROCESO,
    opportunity_id: AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID,
    contract_version: envelope?.integral_analysis?.contract_version ?? null,
    schema_version: envelope?.schema_version ?? null,
    analyzable_requirement_count: units.length,
    every_unit_abstained: units.length > 0 && units.every((unit) => unit.assessment_mode === 'abstained'),
    every_compliance_unknown: units.length > 0 && units.every((unit) => unit?.evidence_state?.compliance === 'unknown'),
    human_review_required: envelope?.v2_projection?.human_review_required === true,
    manifest_scope_analyzable_count: Array.isArray(envelope?.manifest_scope?.analyzable_requirement_ids) ? envelope.manifest_scope.analyzable_requirement_ids.length : 0,
    per_requirement: perRequirement,
    verification: { ok: verification.ok, checks: verification.checks, failures: verification.failures },
    provider_call_count: meta.providerCallCount ?? null,
    persisted_record_count: 0,
    context_meta: meta.contextMeta ?? null,
  };
  assertNoOpenPii(summary);
  return summary;
}

// ---------------------------------------------------------------------------------------------
// One-shot engine invocation: analyze ONCE, verify, sanitize. No retry, ever.
// ---------------------------------------------------------------------------------------------
export async function runAgt002ManizalesV3CanaryWithEngine(engine, analysisContext, { expectedAnalyzableIds, mode, idempotencyKey } = {}) {
  const providerCallCount = mode === 'execute' ? 1 : 0;
  let envelope;
  try {
    envelope = await engine.analyze(analysisContext, idempotencyKey ? { idempotencyKey } : undefined);
  } catch (error) {
    const blocker = scrubOpenPii(String(error?.code || error?.message || 'unknown')).replace(/https?:\/\/\S+/g, '[redacted-url]').slice(0, 200);
    return { ok: false, providerCallCount, blocker, verification: null, sanitizedSummary: null, mode };
  }
  const verification = verifyAgt002ManizalesCanaryEnvelope(envelope, { expectedAnalyzableIds });
  const sanitizedSummary = buildAgt002ManizalesCanarySanitizedSummary(envelope, verification, { mode, providerCallCount });
  return { ok: verification.ok, providerCallCount, envelope, verification, sanitizedSummary, mode };
}

// ---------------------------------------------------------------------------------------------
// Mode orchestration for direct CLI execution.
// ---------------------------------------------------------------------------------------------
async function runMode(mode, { beforeProviderCall = null } = {}) {
  const prereq = loadAgt002CanaryPrerequisitesInProcess();
  const missing = Object.entries(prereq.requiredPresent).filter(([, present]) => !present).map(([name]) => name);
  if (missing.length) {
    return { ok: false, mode, blocker: `prerequisitos ausentes: ${missing.join(', ')}` };
  }
  const database = createReadOnlySupabaseClient();
  let assembled;
  try {
    assembled = await assembleAgt002ManizalesCanaryContext(database);
  } catch (error) {
    return { ok: false, mode, blocker: scrubOpenPii(String(error?.message || 'assembly_failed')).replace(/https?:\/\/\S+/g, '[redacted-url]').slice(0, 200) };
  }
  if (!assembled.meta.snapshot_present) {
    return { ok: false, mode, blocker: 'no existe snapshot de solo lectura vigente para la oportunidad piloto.', contextMeta: assembled.meta };
  }

  const client = mode === 'execute'
    ? buildAgt002ManizalesCanaryRealBridgeClient()
    : buildAgt002ManizalesCanaryPreflightClient();
  // Sanitized before/after prompt-budget metadata is captured off the engine boundary (never raw
  // content). It survives even when analyze throws (budget fail-closed or a provider error), because
  // the engine records the report before propagating the error.
  const promptBudgetReports = [];
  const engine = buildAgt002ManizalesCanaryEngine({
    client, governed: assembled.governed, onPromptBudget: (report) => promptBudgetReports.push(report),
  });

  // Acquire the one-shot fuse only after every local prerequisite, read-only assembly step and
  // client/engine construction has succeeded, but immediately before the sole provider-capable
  // analyze call. A local setup failure therefore cannot consume an attempt that never reached
  // the provider.
  if (mode === 'execute' && typeof beforeProviderCall === 'function') {
    try {
      beforeProviderCall();
    } catch (error) {
      const blocker = error?.code === 'AGT002_CANARY_ALREADY_ATTEMPTED'
        ? 'AGT002_CANARY_ALREADY_ATTEMPTED'
        : 'AGT002_CANARY_MARKER_CLAIM_FAILED';
      return { ok: false, mode, blocker, contextMeta: assembled.meta, promptBudget: null };
    }
  }

  try {
    const outcome = await runAgt002ManizalesV3CanaryWithEngine(engine, assembled.analysisContext, {
      expectedAnalyzableIds: assembled.expectedAnalyzableIds, mode,
    });
    const promptBudget = promptBudgetReports.length ? promptBudgetReports[promptBudgetReports.length - 1] : null;
    if (outcome.sanitizedSummary) {
      outcome.sanitizedSummary.context_meta = assembled.meta;
      outcome.sanitizedSummary.prompt_budget = promptBudget;
    }
    return { ...outcome, contextMeta: assembled.meta, promptBudget };
  } finally {
    turnOffCanaryV3Flag();
  }
}

function buildAgt002ManizalesCanaryRealBridgeClient(environment = process.env) {
  return createAgt002HetznerBridgeClient({
    url: environment.AGT002_HETZNER_BRIDGE_URL,
    hmacSecret: environment.AGT002_HETZNER_BRIDGE_HMAC_SECRET,
  });
}

function printSanitized(result) {
  // Only sanitized metadata is ever written out.
  const payload = {
    ok: result.ok,
    mode: result.mode,
    ...(result.blocker ? { blocker: result.blocker } : {}),
    ...(result.contextMeta ? { context_meta: result.contextMeta } : {}),
    ...(result.promptBudget ? { prompt_budget: result.promptBudget } : {}),
    ...(result.sanitizedSummary ? { summary: result.sanitizedSummary } : {}),
    ...(result.verification ? { verification: result.verification } : {}),
  };
  assertNoOpenPii(payload);
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function claimAgt002CanaryExecuteMarker(markerPath = EXECUTE_MARKER) {
  mkdirSync(dirname(markerPath), { recursive: true });
  try {
    // `wx` maps to O_CREAT|O_EXCL: exactly one concurrent claimant can create the fuse.
    writeFileSync(
      markerPath,
      'agt002-v3-canary execute attempted (marker; no secrets)\n',
      { encoding: 'utf8', flag: 'wx' },
    );
  } catch (error) {
    if (error?.code === 'EEXIST') {
      const alreadyAttempted = new Error('AGT-002 V3 canary already attempted.');
      alreadyAttempted.code = 'AGT002_CANARY_ALREADY_ATTEMPTED';
      throw alreadyAttempted;
    }
    throw error;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const mode = argv.includes('--execute') ? 'execute' : 'preflight';

  const result = await runMode(mode, {
    beforeProviderCall: mode === 'execute' ? () => claimAgt002CanaryExecuteMarker() : null,
  });
  printSanitized(result);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`agt002-manizales-v3-canary-run falló: ${scrubOpenPii(String(error?.message || error)).slice(0, 200)}\n`);
    process.exitCode = 1;
  });
}
