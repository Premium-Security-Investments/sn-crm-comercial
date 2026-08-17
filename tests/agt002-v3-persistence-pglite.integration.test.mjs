import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { AGT002_INTEGRAL_V3_CONTRACT_VERSION, registerAgt002PreviewAnalysis, findAgt002PreviewRun, computeAgt002PreviewIdempotencyKey } from '../agt002-preview-persistence.js';
import { projectAgt002IntegralV3ToV2 } from '../agt002-v3-compatibility.js';
import { validateAgt002IntegralAnalysisV3 } from '../agt002-integral-analysis-v3.js';
import { AGT002_EVIDENCE_STATE_SAFE_UNKNOWN } from '../agt002-evidence-state-manifest.js';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from '../agt002-company-evidence-classes.js';
import { deriveAgt002ManizalesManifestWiring } from '../agt002-manizales-manifest-wiring.js';
import { AGT002_MANIZALES_CHECKED_IN_MANIFEST } from '../agt002-manizales-manifest-source.js';
import { AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID } from '../agt002-manizales-integral-manifest.js';

// Task 7, Step 2: v2/v3 coexistence on the real append-only + canonical-promotion (063)
// schema, driven through the actual JS persistence module (not raw RPC calls) — a
// historical v2 canonical run stays byte-identical after a v3 run supersedes it, exactly
// one canonical=true row remains, and current/historical reads resolve to v3/v2
// respectively. All ids/content below are synthetic; no real expediente.

const strip = value => value.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const migrationSource = name => strip(readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));
const migration050 = migrationSource('050_agt002_canonical_analysis.sql');
const migration051 = migrationSource('051_agt002_context_versions.sql');
const migration053 = migrationSource('053_agt002_legal_corpus.sql');
const migration056 = migrationSource('056_agt002_legal_corpus_publication_gate.sql');
const migration063 = migrationSource('063_agt002_canonical_promotion.sql');

const AGT002_COMPANY_EVIDENCE_MANIFEST_VERSION = 'agt002-company-evidence-classes-v1';
const O = AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID;
const T = '22222222-2222-4222-8222-222222222222';
const S = '33333333-3333-4333-8333-333333333333';
const P = '44444444-4444-4444-8444-444444444444';

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function callRpc(pg, name, params) {
  const result = await pg.query(`select public.${name}(${Object.values(params).map(sqlLiteral).join(',')}) as data`);
  return result.rows[0]?.data ?? null;
}

// Shim minimo estilo Supabase sobre PGlite: reutiliza la lógica productiva real de
// agt002-preview-persistence.js. Object.values(params) preserva el orden de inserción de
// claves, que coincide con el orden posicional de los parámetros SQL de la RPC.
function pgliteDatabase(pg) {
  return {
    rpc: async (name, params = {}) => {
      try {
        return { data: await callRpc(pg, name, params), error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
    from(table) {
      return {
        select() { return this; },
        eq(column, value) { this._filters = { ...(this._filters || {}), [column]: value }; return this; },
        async maybeSingle() {
          if (table !== 'psi_tender_analysis_runs') throw new Error(`unexpected table ${table}`);
          const key = this._filters?.idempotency_key;
          const result = await pg.query(`select id,snapshot_id,producer,method,status,result,critical_open_count,created_at,completed_at,canonical from public.psi_tender_analysis_runs where idempotency_key = ${sqlLiteral(key)}`);
          return { data: result.rows[0] || null, error: null };
        },
      };
    },
  };
}

async function createDatabase() {
  const pg = new PGlite();
  await pg.exec(`
    create role authenticated; create role service_role; create role anon;
    grant service_role to current_user;
    create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true, identity_type text default 'human', full_name text);
    create table public.psi_sales_opportunities (id uuid primary key);
    create table public.psi_public_tenders (id uuid primary key);
    create table public.psi_tender_document_snapshots (id uuid primary key, opportunity_id uuid not null references public.psi_sales_opportunities(id), tender_id uuid not null references public.psi_public_tenders(id));
    create table public.psi_tender_analysis_runs (
      id uuid primary key default gen_random_uuid(), snapshot_id uuid not null references public.psi_tender_document_snapshots(id),
      opportunity_id uuid not null references public.psi_sales_opportunities(id), tender_id uuid not null references public.psi_public_tenders(id),
      producer text not null, method text not null, status text not null, result jsonb, critical_open_count integer not null default 0,
      idempotency_key text not null unique, schema_version text not null, policy_version text not null, model text, usage jsonb,
      created_at timestamptz not null default now(), completed_at timestamptz
    );
    alter table public.psi_tender_analysis_runs enable row level security;
    grant select on public.psi_tender_analysis_runs to service_role;
    create or replace function public.psi_tender_analysis_runs_prevent_mutation()
    returns trigger language plpgsql as $$
    begin
      raise exception 'psi_tender_analysis_runs is append-only: UPDATE and DELETE are prohibited';
    end;
    $$;
    create trigger psi_tender_analysis_runs_immutable
      before update or delete on public.psi_tender_analysis_runs
      for each row execute function public.psi_tender_analysis_runs_prevent_mutation();
    insert into public.psi_sales_profiles values ('${P}', true, 'human', 'Ana Revisora');
    insert into public.psi_sales_opportunities values ('${O}');
    insert into public.psi_public_tenders values ('${T}');
    insert into public.psi_tender_document_snapshots values ('${S}','${O}','${T}');
  `);
  await pg.exec(migration050);
  await pg.exec(migration051);
  await pg.exec(migration053);
  await pg.exec(migration056);
  await pg.exec(migration063);

  const context = await callRpc(pg, 'psi_record_agt002_context_version', {
    p_opportunity_id: O, p_tender_id: T, p_snapshot_id: S, p_context_version: 2,
    p_context: { snapshot_id: S, human_evidence: [] }, p_context_hash: 'context-hash-1',
    p_human_evidence_count: 0, p_idempotency_key: 'context-key-1', p_actor_id: P,
  });
  pg.contextVersionId = context.id;
  return pg;
}

function v2Envelope() {
  return {
    schema_version: '2.0-preview.1', agent_id: 'AGT-002', producer: 'AGT-002',
    run_id: '55555555-5555-4555-8555-555555555551', snapshot_id: S,
    policy_version: 'agt002-preview-policy-v1', status: 'completed', method: 'agent_ai',
    recommendation: 'pause', summary: 'Historical v2 run.', strengths: [], weaknesses: [],
    blockers: [], questions: [], unverified: [], next_action: 'x', human_review_required: true,
    usage: { provider: 'codex_app_server', model: 'v2-model', input_tokens: 1, output_tokens: 1, rate_limit: null },
  };
}

function v3Envelope() {
  const wiring = deriveAgt002ManizalesManifestWiring(AGT002_MANIZALES_CHECKED_IN_MANIFEST);
  const requirements = wiring.requirementManifest.requirement_manifest.map(entry => ({
    requirement_id: entry.requirement_id,
    category: wiring.categoryOverrides[entry.requirement_id],
  }));
  const expectedIds = requirements.map(entry => entry.requirement_id);
  const evidenceStateManifest = expectedIds.map(requirementId => ({
    requirement_id: requirementId,
    evidence_state: structuredClone(AGT002_EVIDENCE_STATE_SAFE_UNKNOWN),
    rule_id: 'manifest_unverified',
    provenance: null,
  }));
  const candidate = {
    contract_version: 'agt002-integral-analysis-v3',
    coverage: {
      manifest_version: wiring.requirementManifest.requirement_manifest_version,
      expected_requirement_ids: expectedIds,
      analyzed_requirement_ids: expectedIds,
      material_omissions: false,
      omission_reasons: [],
      company_evidence_manifest_version: AGT002_COMPANY_EVIDENCE_MANIFEST_VERSION,
      company_evidence_class_ids: [...AGT002_COMPANY_EVIDENCE_CLASS_IDS].sort(),
      legal_corpus_version_id: null,
    },
    analysis_units: requirements.map((requirement, index) => ({
      unit_id: `MANIZALES-UNIT-${index + 1}`,
      unit_kind: 'tender_requirement',
      requirement_id: requirement.requirement_id,
      category: requirement.category,
      sequence: index + 1,
      title: wiring.requirementManifest.requirement_manifest[index].label.slice(0, 200),
      assessment_mode: 'abstained',
      conclusion: { status: 'human_validation_required', summary: 'Pendiente de validación humana.', confidence: 'unavailable' },
      blocking: { effect: 'undetermined', curability: 'undetermined', reason: 'Sin determinación automática.' },
      evidence_state: structuredClone(AGT002_EVIDENCE_STATE_SAFE_UNKNOWN),
      evidence_refs: [],
      missing_evidence: [],
      commercial_impact: { level: 'unknown', summary: 'Impacto no determinado.', dimension: 'unknown' },
      legal_assessment: { status: 'not_applicable', basis_refs: [], summary: 'No aplica fundamento jurídico automático.', human_legal_review_required: false },
      actions: [],
      milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito.' },
      escalation: { required: false, level: 'none', reason: 'Sin condición crítica determinada.' },
      closure: { status: 'human_confirmation_required', condition: 'Persona autorizada valida.', evidence_required: [] },
      human_validation: { required: true, status: 'pending', reason: 'Validación humana pendiente.' },
    })),
  };
  const integral_analysis = validateAgt002IntegralAnalysisV3(candidate, {
    requirementManifestVersion: wiring.requirementManifest.requirement_manifest_version,
    requirementManifest: requirements,
    companyEvidenceManifestVersion: AGT002_COMPANY_EVIDENCE_MANIFEST_VERSION,
    companyEvidenceClassIds: [...AGT002_COMPANY_EVIDENCE_CLASS_IDS].sort(),
    legalCorpusVersionId: null,
    allowlist: { tender_document: [], company_evidence: [], legal_corpus: [], human_evidence: [], objective_validation: [] },
    materialOmissionsObserved: false,
    omissionReasons: [],
    evidenceStateManifest,
  });
  return {
    schema_version: '3.0.0', agent_id: 'AGT-002', run_id: '55555555-5555-4555-8555-555555555552',
    policy_version: 'agt002-integral-v3-policy-1', snapshot_id: S, context_version_id: null,
    status: 'completed', method: 'agent_ai',
    integral_analysis,
    evidence_coverage: undefined,
    legal_corpus_version_id: null,
    human_review_required: true,
    v2_projection: projectAgt002IntegralV3ToV2(integral_analysis),
    usage: { provider: 'codex_app_server', model: 'v3-model', input_tokens: 3, output_tokens: 3, rate_limit: null },
  };
}

async function run() {
  const pg = await createDatabase();
  const database = pgliteDatabase(pg);

  const v2Registered = await registerAgt002PreviewAnalysis(database, {
    opportunity_id: O, tender_id: T, snapshot_id: S, envelope: v2Envelope(),
    canonicalOnly: true, context_version_id: pg.contextVersionId,
  });
  assert.equal(v2Registered.canonical, true);

  const v3Registered = await registerAgt002PreviewAnalysis(database, {
    opportunity_id: O, tender_id: T, snapshot_id: S, envelope: v3Envelope(),
    canonicalOnly: true, context_version_id: pg.contextVersionId,
  });
  assert.equal(v3Registered.canonical, true);
  assert.notEqual(v3Registered.run_id, v2Registered.run_id);
  assert.ok(v3Registered.result.integral_analysis, 'the v3 run must persist integral_analysis');
  assert.equal(v3Registered.result.integral_analysis.analysis_units.length, 20, 'the persisted V3 run must carry all 20 analyzable manifest requirements');
  assert.deepEqual(
    v3Registered.result.integral_analysis.coverage.expected_requirement_ids,
    deriveAgt002ManizalesManifestWiring(AGT002_MANIZALES_CHECKED_IN_MANIFEST).requirementManifest.requirement_manifest.map(entry => entry.requirement_id),
  );
  assert.equal(v3Registered.result.recommendation, 'advance_conditionally', 'the v3 run must also persist its v2 projection fields');

  // Exactly one completed canonical run remains for the opportunity.
  const canonicalCount = await pg.query(`select count(*)::int n from public.psi_tender_analysis_runs where opportunity_id = '${O}' and canonical and status = 'completed'`);
  assert.equal(canonicalCount.rows[0].n, 1);

  // The historical v2 row is demoted (not deleted, not mutated) — byte-identical result.
  const rows = await pg.query(`select id, canonical, result, schema_version, supersedes_run_id from public.psi_tender_analysis_runs where opportunity_id = '${O}' order by created_at, id`);
  assert.equal(rows.rows.length, 2, 'promotion must never delete history');
  const v2Row = rows.rows.find(row => row.id === v2Registered.run_id);
  const v3Row = rows.rows.find(row => row.id === v3Registered.run_id);
  assert.equal(v2Row.canonical, false, 'the historical v2 run must be demoted, never deleted');
  assert.equal(v2Row.schema_version, '2.0-preview.1');
  assert.deepEqual(v2Row.result, v2Registered.result, 'the historical v2 payload must never be rewritten');
  assert.equal(v3Row.canonical, true);
  assert.equal(v3Row.schema_version, '3.0.0');
  assert.equal(v3Row.supersedes_run_id, v2Registered.run_id, 'the v3 run must record exactly which run it superseded');

  // Exact replay of the same v3 idempotency key returns the original payload unchanged
  // (never re-runs supersession a second time).
  const replay = await registerAgt002PreviewAnalysis(database, {
    opportunity_id: O, tender_id: T, snapshot_id: S, envelope: v3Envelope(),
    canonicalOnly: true, context_version_id: pg.contextVersionId,
  });
  assert.equal(replay.run_id, v3Registered.run_id);
  const canonicalCountAfterReplay = await pg.query(`select count(*)::int n from public.psi_tender_analysis_runs where opportunity_id = '${O}' and canonical and status = 'completed'`);
  assert.equal(canonicalCountAfterReplay.rows[0].n, 1, 'a replay must never create a second canonical row');

  // Current reader (idempotency-key lookup) returns v3; historical lookup by the v2
  // idempotency key still returns the original v2 run (demoted but readable).
  const v2Key = computeAgt002PreviewIdempotencyKey({ snapshotId: S, policyVersion: 'agt002-preview-policy-v1', model: 'v2-model', contextVersionId: pg.contextVersionId });
  const v3Key = computeAgt002PreviewIdempotencyKey({
    snapshotId: S,
    policyVersion: 'agt002-integral-v3-policy-1',
    model: 'v3-model',
    contextVersionId: pg.contextVersionId,
    contractVersion: AGT002_INTEGRAL_V3_CONTRACT_VERSION,
  });

  const currentV3 = await findAgt002PreviewRun(database, v3Key, { canonicalOnly: true });
  assert.equal(currentV3.canonical, true);
  assert.equal(currentV3.result.recommendation, 'advance_conditionally');

  const historicalV2 = await findAgt002PreviewRun(database, v2Key, { canonicalOnly: true });
  assert.equal(historicalV2.canonical, false);
  assert.equal(historicalV2.result.recommendation, 'pause');

  await pg.close();
  console.log('AGT-002 v3/v2 canonical coexistence (PGlite, migration 063) passed');
}

await run();
