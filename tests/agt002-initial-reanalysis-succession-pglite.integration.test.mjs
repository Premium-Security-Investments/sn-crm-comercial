// AGT-002 migration 108 — PGlite integration for the REANALYSIS successor of the canonical analysis.
//
// Runs the real 099-108 chain (with 104/105's batch-building admission, so evidence package members
// are seeded through the real document/extraction RPCs) on the same minimal opportunity/tender/
// profile core and hand-rolled 025+050+063 psi_tender_analysis_runs used by
// tests/agt002-initial-analysis-canonical-persistence-pglite.integration.test.mjs. PGlite has no
// pgcrypto, so extensions.digest is a sha256-backed stand-in, exactly like
// tests/agt002-company-evidence-sharepoint-catalog-pglite.integration.test.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { verify as verifyInitialMigrationChain } from '../scripts/agt002-initial-analysis-migrations.mjs';

const strip = value => value.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const migrationSource = name => strip(readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));
const rollbackSource = name => strip(readFileSync(new URL(`../supabase/rollbacks/${name}`, import.meta.url), 'utf8'));

const migration065 = strip(readFileSync(new URL('../supabase/migrations/065_tender_document_extraction_integrity.sql', import.meta.url), 'utf8'))
  .replace(/create schema if not exists extensions;\s*create extension if not exists pgcrypto with schema extensions;\s*/i, '')
  .replace(/encode\(extensions\.digest\(convert_to\(extracted_text, 'UTF8'\), 'sha256'\), 'hex'\)/g, 'text_hash')
  .replace(/encode\(extensions\.digest\(convert_to\(p_extracted_text, 'UTF8'\), 'sha256'\), 'hex'\)/g, 'p_text_hash');

const CHAIN = [
  '099_agt002_evidence_packages.sql',
  '100_agt002_initial_workflow_and_g1.sql',
  '101_agt002_initial_analysis_jobs.sql',
  '102_agt002_initial_analysis_canonical_persistence.sql',
  '103_agt002_initial_analysis_atomic_admission.sql',
  '104_agt002_initial_analysis_server_owned_execution.sql',
  '105_agt002_initial_admission_digest_schema_qualification.sql',
  '106_agt002_initial_v2_aggregate_schema_version.sql',
  '107_agt002_company_profile_snapshots.sql',
];
const MIGRATION_108 = '108_agt002_initial_reanalysis_succession.sql';
const ROLLBACK_108 = '108_agt002_initial_reanalysis_succession_rollback.sql';

const O = '10000000-0000-4000-8000-000000000001';
const T = '10000000-0000-4000-8000-000000000002';
const ACTOR = '30000000-0000-4000-8000-000000000001';
const WORKER = 'agt002-initial-analysis-worker';
const RUN_INITIAL = '40000000-0000-4000-8000-000000000001';
const PAYLOAD = Object.freeze({
  execution: { modelId: 'sonnet', timeoutMs: 600000, reasoningEffort: 'medium' },
  budget: { maxTotalTokens: 1000000, maxCostUsd: 10, inputCostPerMillionUsd: 2, outputCostPerMillionUsd: 10 },
});

const hash = text => createHash('sha256').update(text).digest('hex');

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function callRpc(pg, name, params) {
  const args = Object.values(params).map(sqlLiteral).join(',');
  return (await pg.query(`select public.${name}(${args}) as data`)).rows[0]?.data ?? null;
}

const HAND_ROLLED_ANALYSIS_RUNS = `
  create table public.psi_tender_analysis_runs (
    id uuid primary key default gen_random_uuid(),
    snapshot_id uuid,
    opportunity_id uuid not null references public.psi_sales_opportunities(id),
    tender_id uuid not null references public.psi_public_tenders(id),
    producer text not null check (producer in ('siio_rules_v1', 'HERMES-INTERIM', 'AGT-002')),
    method text not null check (method in ('rules', 'agent_ai')),
    status text not null check (status in ('completed', 'failed')),
    result jsonb,
    critical_open_count integer not null default 0 check (critical_open_count >= 0),
    idempotency_key text not null unique check (nullif(btrim(idempotency_key), '') is not null),
    schema_version text not null check (nullif(btrim(schema_version), '') is not null),
    policy_version text not null check (nullif(btrim(policy_version), '') is not null),
    model text,
    usage jsonb check (usage is null or jsonb_typeof(usage) = 'object'),
    created_at timestamptz not null default now(),
    completed_at timestamptz,
    canonical boolean not null default false,
    supersedes_run_id uuid references public.psi_tender_analysis_runs(id),
    check ((producer = 'siio_rules_v1' and method = 'rules') or (producer in ('HERMES-INTERIM', 'AGT-002') and method = 'agent_ai')),
    check ((status = 'completed' and result is not null and jsonb_typeof(result) = 'object') or (status = 'failed' and result is null)),
    check (not canonical or (producer = 'AGT-002' and method = 'agent_ai' and status = 'completed'))
  );
  create unique index psi_tender_analysis_runs_one_canonical_current_idx
    on public.psi_tender_analysis_runs (opportunity_id) where canonical and status = 'completed';
  alter table public.psi_tender_analysis_runs enable row level security;
  revoke all on public.psi_tender_analysis_runs from public, authenticated, anon, service_role;
  grant select on public.psi_tender_analysis_runs to service_role;
  create or replace function public.psi_tender_analysis_runs_prevent_mutation()
  returns trigger language plpgsql as $$
  begin
    if tg_op = 'UPDATE' and old.canonical is true and new.canonical is false
       and (to_jsonb(old) - 'canonical') = (to_jsonb(new) - 'canonical') then
      return new;
    end if;
    raise exception 'psi_tender_analysis_runs is append-only';
  end;
  $$;
  create trigger psi_tender_analysis_runs_immutable
    before update or delete on public.psi_tender_analysis_runs
    for each row execute function public.psi_tender_analysis_runs_prevent_mutation();
`;

async function freshDb({ with108 = true } = {}) {
  const pg = new PGlite();
  await pg.exec(`
    create role authenticated; create role service_role; create role anon;
    grant service_role to current_user;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
    create schema extensions;
    create function extensions.digest(data text, algo text) returns bytea language sql immutable as $$ select sha256(convert_to(data, 'UTF8')) $$;
    create function public.psi_sales_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
    create table public.psi_sales_opportunities (id uuid primary key);
    create table public.psi_public_tenders (id uuid primary key, converted_opportunity_id uuid references public.psi_sales_opportunities(id));
    create table public.psi_sales_profiles (
      id uuid primary key, active boolean not null default true, identity_type text default 'human',
      role text not null default 'admin', microsoft_email text not null default 'test@example.test'
    );
    create table public.psi_access_permissions (code text primary key, name text not null default 'x', description text, active boolean not null default true);
    create table public.psi_profile_permissions (
      profile_id uuid not null references public.psi_sales_profiles(id),
      permission_code text not null references public.psi_access_permissions(code),
      created_at timestamptz not null default now(),
      primary key (profile_id, permission_code)
    );
    insert into public.psi_sales_opportunities (id) values ('${O}');
    insert into public.psi_public_tenders (id, converted_opportunity_id) values ('${T}', '${O}');
    insert into public.psi_sales_profiles (id, active) values ('${ACTOR}', true);
    insert into public.psi_access_permissions (code) values ('licitaciones');
    insert into public.psi_profile_permissions (profile_id, permission_code) values ('${ACTOR}', 'licitaciones');
  `);
  await pg.exec(migrationSource('026_tender_document_versions.sql'));
  await pg.exec(migrationSource('057_tender_document_logical_identity.sql'));
  await pg.exec(migration065);
  await pg.exec(HAND_ROLLED_ANALYSIS_RUNS);
  for (const name of CHAIN) await pg.exec(migrationSource(name));
  if (with108) await pg.exec(migrationSource(MIGRATION_108));
  if (with108) await pg.exec(migrationSource('109_agt002_radar_import_requests.sql'));
  return pg;
}

/** One frozen package version with one real member (document version + ok extraction) in batch 0. */
async function seedPackageVersion(pg, label) {
  const text = `Texto oficial ${label}.`;
  const version = await callRpc(pg, 'psi_record_tender_document_version', {
    p_opportunity_id: O, p_tender_id: T, p_source: 'secop', p_source_document_id: `doc-${label}`,
    p_name: `Pliego ${label}.pdf`, p_content_hash: hash(`content-${label}`), p_storage_path: `tender-documents/${O}/doc-${label}`,
    p_mime_type: 'application/pdf', p_size_bytes: 2048, p_document_type: 'pliego', p_extracted_text: text,
    p_source_url: null, p_actor_id: ACTOR,
  });
  const extraction = await callRpc(pg, 'psi_record_tender_document_extraction', {
    p_opportunity_id: O, p_tender_id: T, p_document_version_id: version.id,
    p_extractor_version: 'tender-document-text-extraction@2', p_status: 'ok', p_parser: 'pdf-parse',
    p_extracted_text: text, p_text_hash: hash(text), p_char_count: text.length,
    p_text_byte_count: Buffer.byteLength(text, 'utf8'), p_metadata: {}, p_gap_reason: null, p_actor_id: ACTOR,
  });
  let pkg = (await pg.query(`select id from public.psi_agt002_evidence_packages where opportunity_id = '${O}'`)).rows[0];
  if (!pkg) pkg = (await pg.query(`insert into public.psi_agt002_evidence_packages (opportunity_id, tender_id) values ('${O}', '${T}') returning id`)).rows[0];
  const next = (await pg.query(`select coalesce(max(version_number), 0) + 1 as n from public.psi_agt002_evidence_package_versions where package_id = '${pkg.id}'`)).rows[0].n;
  const packageHash = hash(`package-${label}`);
  const packageVersion = (await pg.query(`
    insert into public.psi_agt002_evidence_package_versions
      (package_id, version_number, idempotency_key, package_hash, document_manifest_hash, semantic_manifest_hash, member_count, batch_count, created_by)
    values ('${pkg.id}', ${next}, 'seed-${label}', '${packageHash}', '${hash(`dm-${label}`)}', '${hash(`sm-${label}`)}', 1, 1, '${ACTOR}')
    returning id`)).rows[0];
  await pg.query(`
    insert into public.psi_agt002_evidence_package_members
      (package_version_id, document_version_id, batch_index, source_classification, inclusion_reason, content_hash, extraction_id, extraction_text_hash)
    values ('${packageVersion.id}', '${version.id}', 0, 'official', 'Pliego de condiciones.', '${hash(`content-${label}`)}', '${extraction.extraction_id ?? extraction.id}', '${hash(text)}')`);
  await pg.query(`insert into public.psi_agt002_evidence_package_batches (package_version_id, batch_index, member_count) values ('${packageVersion.id}', 0, 1)`);
  return { packageVersionId: packageVersion.id, packageHash };
}

async function authorizedWorkflow(pg, { label, workflowType }) {
  const instance = await callRpc(pg, 'psi_create_agt002_workflow_instance', {
    p_opportunity_id: O, p_tender_id: T, p_workflow_type: workflowType, p_scope: 'A',
    p_profile_snapshot_id: null, p_profile_snapshot_hash: null, p_idempotency_key: `instance-${label}`, p_actor_profile_id: ACTOR,
  });
  const evidence = await seedPackageVersion(pg, label);
  const grant = await callRpc(pg, 'psi_grant_agt002_g1_analysis_authorization', {
    p_workflow_instance_id: instance.workflow_instance_id, p_package_version_id: evidence.packageVersionId,
    p_package_hash: evidence.packageHash, p_expires_at: '2099-12-31T00:00:00.000Z',
    p_idempotency_key: `grant-${label}`, p_actor_profile_id: ACTOR,
  });
  return { workflowInstanceId: instance.workflow_instance_id, authorizationId: grant.authorization_id, evidence };
}

function envelopeFor({ persistence, opportunityId = O, tenderId = T, kind = 'INITIAL', version = 1, source = null }) {
  return {
    meta: {
      schema_version: 'pre_go_analysis.v2', analysis_kind: kind, analysis_version: version, source_analysis_run_id: source,
      aggregate_stage: 'ANALYSIS_PUBLISHED', aggregate_version: 1,
      analysis_run_id: persistence.analysisRunId, analysis_core_hash: hash(`core-${persistence.analysisRunId}`),
      g1_authorization_id: persistence.authorizationId, g1_scope: persistence.g1Scope,
      package_hash: persistence.packageHash, opportunity_id: opportunityId, tender_id: tenderId,
    },
    human_decision: null,
  };
}

async function claimAndCheckpoint(pg, envelopeBuilder) {
  const claimed = await callRpc(pg, 'psi_claim_agt002_initial_analysis_job', { p_worker_id: WORKER, p_lease_seconds: 600 });
  const envelope = envelopeBuilder(claimed.payload.persistence);
  await callRpc(pg, 'psi_store_agt002_initial_analysis_checkpoint', {
    p_job_id: claimed.job_id, p_lease_id: claimed.lease_id, p_fence_version: claimed.fence_version,
    p_batch_index: 1, p_phase: 'synthesis', p_request_hash: hash('request'),
    p_output: envelope, p_output_sha256: hash(JSON.stringify(envelope)), p_usage: null,
  });
  return { claimed, envelope };
}

async function complete(pg, rpcName, { claimed, envelope, persistence = claimed.payload.persistence }) {
  return callRpc(pg, rpcName, {
    p_job_id: claimed.job_id, p_lease_id: claimed.lease_id, p_fence_version: claimed.fence_version,
    p_analysis_run_id: persistence.analysisRunId, p_workflow_instance_id: persistence.workflowInstanceId,
    p_authorization_id: persistence.authorizationId, p_package_version_id: persistence.packageVersionId,
    p_package_hash: persistence.packageHash, p_g1_scope: persistence.g1Scope,
    p_analysis_core_hash: envelope.meta.analysis_core_hash, p_policy_version: persistence.policyVersion,
    p_schema_version: 'pre_go_analysis.v2', p_envelope: envelope, p_envelope_hash: hash(JSON.stringify(envelope)),
  });
}

/** A completed, canonical INITIAL v1 analysis through the real authorized admission. */
async function completedInitial(pg) {
  const workflow = await authorizedWorkflow(pg, { label: 'initial', workflowType: 'INITIAL' });
  const admitted = await callRpc(pg, 'psi_admit_authorized_agt002_initial_analysis_job', {
    p_authorization_id: workflow.authorizationId, p_workflow_instance_id: workflow.workflowInstanceId,
    p_opportunity_id: O, p_tender_id: T, p_package_version_id: workflow.evidence.packageVersionId,
    p_package_hash: workflow.evidence.packageHash, p_g1_scope: 'A', p_policy_version: 'policy-v1',
    p_idempotency_key: 'admit-initial', p_payload: PAYLOAD, p_actor_profile_id: ACTOR,
  });
  assert.equal(admitted.status, 'admitted');
  const ready = await claimAndCheckpoint(pg, persistence => envelopeFor({ persistence }));
  const done = await complete(pg, 'psi_complete_agt002_initial_analysis_job', ready);
  assert.equal(done.status, 'completed');
  return done.analysis_run_id;
}

async function admitReanalysis(pg, { label = 'reanalysis', source, idempotencyKey = `admit-${label}` } = {}) {
  const workflow = await authorizedWorkflow(pg, { label, workflowType: 'REANALYSIS' });
  const admitted = await callRpc(pg, 'psi_admit_authorized_agt002_initial_reanalysis_job', {
    p_authorization_id: workflow.authorizationId, p_workflow_instance_id: workflow.workflowInstanceId,
    p_opportunity_id: O, p_tender_id: T, p_package_version_id: workflow.evidence.packageVersionId,
    p_package_hash: workflow.evidence.packageHash, p_g1_scope: 'A', p_policy_version: 'policy-v1',
    p_idempotency_key: idempotencyKey, p_payload: PAYLOAD, p_actor_profile_id: ACTOR, p_source_analysis_run_id: source,
  });
  return { workflow, admitted };
}

test('the release runner recognizes the full 099-108 chain with a safe security posture', async () => {
  const pg = await freshDb();
  try {
    const result = await verifyInitialMigrationChain(async sql => (await pg.query(sql)).rows);
    assert.equal(result.status, 'applied');
    assert.equal(result.migrations['108'], true);
    assert.equal(result.unsafe_grants, 0);
    assert.equal(result.missing_service_access, 0);
  } finally {
    await pg.close();
  }
});

test('108 keeps existing INITIAL jobs as INITIAL v1 and leaves the one-INITIAL rule (55001) intact', async () => {
  const pg = await freshDb();
  try {
    await completedInitial(pg);
    const job = (await pg.query(`select analysis_kind, analysis_version, source_analysis_run_id from public.psi_agt002_initial_analysis_jobs`)).rows[0];
    assert.deepEqual(job, { analysis_kind: 'INITIAL', analysis_version: 1, source_analysis_run_id: null });
    const second = await authorizedWorkflow(pg, { label: 'initial-again', workflowType: 'INITIAL' });
    await assert.rejects(callRpc(pg, 'psi_admit_authorized_agt002_initial_analysis_job', {
      p_authorization_id: second.authorizationId, p_workflow_instance_id: second.workflowInstanceId,
      p_opportunity_id: O, p_tender_id: T, p_package_version_id: second.evidence.packageVersionId,
      p_package_hash: second.evidence.packageHash, p_g1_scope: 'A', p_policy_version: 'policy-v1',
      p_idempotency_key: 'admit-initial-again', p_payload: PAYLOAD, p_actor_profile_id: ACTOR,
    }), /Ya existe un análisis inicial COMPLETED/);
  } finally {
    await pg.close();
  }
});

test('happy path: a REANALYSIS succeeds the canonical INITIAL — v2 canonical, v1 demoted but intact, full lineage', async () => {
  const pg = await freshDb();
  try {
    const initialRunId = await completedInitial(pg);
    const before = (await pg.query(`select to_jsonb(r) - 'canonical' as row from public.psi_tender_analysis_runs r where id = '${initialRunId}'`)).rows[0].row;

    const { workflow, admitted } = await admitReanalysis(pg, { source: initialRunId });
    assert.equal(admitted.status, 'admitted');
    assert.equal(admitted.payload.persistence.analysisKind, 'REANALYSIS');
    assert.equal(admitted.payload.persistence.analysisVersion, 2);
    assert.equal(admitted.payload.persistence.sourceAnalysisRunId, initialRunId);
    assert.equal(admitted.payload.batches.length, 2, 'one member batch plus the synthesis batch');
    const authorization = (await pg.query(`select workflow_type from public.psi_agt002_analysis_authorizations where id = '${workflow.authorizationId}'`)).rows[0];
    assert.equal(authorization.workflow_type, 'REANALYSIS');

    const ready = await claimAndCheckpoint(pg, persistence => envelopeFor({ persistence, kind: 'REANALYSIS', version: 2, source: initialRunId }));
    const done = await complete(pg, 'psi_complete_agt002_initial_reanalysis_job', ready);
    assert.equal(done.status, 'completed');
    assert.equal(done.supersedes_run_id, initialRunId);

    const runs = (await pg.query(`select id, canonical, analysis_kind, analysis_version, supersedes_run_id from public.psi_tender_analysis_runs order by analysis_version`)).rows;
    assert.deepEqual(runs, [
      { id: initialRunId, canonical: false, analysis_kind: 'INITIAL', analysis_version: 1, supersedes_run_id: null },
      { id: done.analysis_run_id, canonical: true, analysis_kind: 'REANALYSIS', analysis_version: 2, supersedes_run_id: initialRunId },
    ]);
    const after = (await pg.query(`select to_jsonb(r) - 'canonical' as row from public.psi_tender_analysis_runs r where id = '${initialRunId}'`)).rows[0].row;
    assert.deepEqual(after, before, 'the demoted INITIAL run keeps every other column byte-identical');

    const counts = (await pg.query(`select
      (select count(*)::int from public.psi_agt002_initial_analysis_run_lineage) as lineage,
      (select count(*)::int from public.psi_agt002_pre_go_analysis_versions) as aggregates`)).rows[0];
    assert.deepEqual(counts, { lineage: 2, aggregates: 2 });
    const event = (await pg.query(`select to_state from public.psi_agt002_workflow_events where workflow_instance_id = '${workflow.workflowInstanceId}' order by created_at desc, id desc limit 1`)).rows[0];
    assert.equal(event.to_state, 'COMPLETED');

    // Replaying the exact completion is idempotent.
    const replay = await complete(pg, 'psi_complete_agt002_initial_reanalysis_job', ready);
    assert.equal(replay.status, 'existing');
  } finally {
    await pg.close();
  }
});

test('a second REANALYSIS chains from the current canonical run: v3 supersedes v2', async () => {
  const pg = await freshDb();
  try {
    const initialRunId = await completedInitial(pg);
    await admitReanalysis(pg, { label: 'r2', source: initialRunId });
    const r2 = await claimAndCheckpoint(pg, persistence => envelopeFor({ persistence, kind: 'REANALYSIS', version: 2, source: initialRunId }));
    const v2 = await complete(pg, 'psi_complete_agt002_initial_reanalysis_job', r2);

    await assert.rejects(admitReanalysis(pg, { label: 'r3-stale', source: initialRunId }), /no es el análisis canónico vigente/);
    const { admitted } = await admitReanalysis(pg, { label: 'r3', source: v2.analysis_run_id });
    assert.equal(admitted.payload.persistence.analysisVersion, 3);
  } finally {
    await pg.close();
  }
});

test('admission rejects an INITIAL authorization, a missing canonical source, and a second active job', async () => {
  const pg = await freshDb();
  try {
    await assert.rejects(admitReanalysis(pg, { label: 'no-source', source: RUN_INITIAL }), /no es el análisis canónico vigente/);
    const initialRunId = await completedInitial(pg);

    const wrongType = await authorizedWorkflow(pg, { label: 'wrong-type', workflowType: 'INITIAL' });
    await assert.rejects(callRpc(pg, 'psi_admit_authorized_agt002_initial_reanalysis_job', {
      p_authorization_id: wrongType.authorizationId, p_workflow_instance_id: wrongType.workflowInstanceId,
      p_opportunity_id: O, p_tender_id: T, p_package_version_id: wrongType.evidence.packageVersionId,
      p_package_hash: wrongType.evidence.packageHash, p_g1_scope: 'A', p_policy_version: 'policy-v1',
      p_idempotency_key: 'admit-wrong-type', p_payload: PAYLOAD, p_actor_profile_id: ACTOR, p_source_analysis_run_id: initialRunId,
    }), /no coincide con la admisión REANALYSIS/);

    await admitReanalysis(pg, { label: 'first', source: initialRunId });
    await assert.rejects(admitReanalysis(pg, { label: 'second', source: initialRunId }), /activo/);
    const consumed = (await pg.query(`select count(*)::int as n from public.psi_agt002_workflow_events where to_state = 'CONSUMED'`)).rows[0].n;
    assert.equal(consumed, 2, 'a rejected admission never consumes its G1 (INITIAL + first REANALYSIS only)');
  } finally {
    await pg.close();
  }
});

test('completion is refused when the source is no longer canonical, and the INITIAL completion refuses a REANALYSIS job', async () => {
  const pg = await freshDb();
  try {
    const initialRunId = await completedInitial(pg);
    await admitReanalysis(pg, { source: initialRunId });
    const ready = await claimAndCheckpoint(pg, persistence => envelopeFor({ persistence, kind: 'REANALYSIS', version: 2, source: initialRunId }));

    await assert.rejects(complete(pg, 'psi_complete_agt002_initial_analysis_job', ready), /./);
    const wrongMeta = { ...ready, envelope: envelopeFor({ persistence: ready.claimed.payload.persistence, kind: 'REANALYSIS', version: 3, source: initialRunId }) };
    await assert.rejects(complete(pg, 'psi_complete_agt002_initial_reanalysis_job', wrongMeta), /./);

    await pg.query(`update public.psi_tender_analysis_runs set canonical = false where id = '${initialRunId}'`);
    await assert.rejects(complete(pg, 'psi_complete_agt002_initial_reanalysis_job', ready), /quedó obsoleto/);
    const reanalysisRuns = (await pg.query(`select count(*)::int as n from public.psi_tender_analysis_runs where analysis_kind = 'REANALYSIS'`)).rows[0].n;
    assert.equal(reanalysisRuns, 0);
  } finally {
    await pg.close();
  }
});

test('the runs table itself refuses a REANALYSIS without a superseded run or at version 1', async () => {
  const pg = await freshDb();
  try {
    const initialRunId = await completedInitial(pg);
    const base = (await pg.query(`select g1_authorization_id, package_version_id from public.psi_tender_analysis_runs where id = '${initialRunId}'`)).rows[0];
    const insert = (version, supersedes) => pg.query(`
      insert into public.psi_tender_analysis_runs (opportunity_id, tender_id, producer, method, status, result, idempotency_key, schema_version, policy_version,
        canonical, analysis_kind, analysis_version, supersedes_run_id, g1_authorization_id, g1_scope, package_version_id, analysis_core_hash)
      values ('${O}', '${T}', 'AGT-002', 'agent_ai', 'completed', '{}', 'direct-${version}-${supersedes}', 's', 'p',
        false, 'REANALYSIS', ${version}, ${supersedes ? `'${supersedes}'` : 'null'}, '${base.g1_authorization_id}', 'A', '${base.package_version_id}', '${hash('x')}')`);
    await assert.rejects(insert(2, null), /reanalysis_shape_check/);
    await assert.rejects(insert(1, initialRunId), /reanalysis_shape_check/);
  } finally {
    await pg.close();
  }
});

test('rollback 108 is refused once REANALYSIS evidence exists, and restores the INITIAL-only shape on a pristine install', async () => {
  const pristine = await freshDb();
  try {
    await pristine.exec(rollbackSource('109_agt002_radar_import_requests_rollback.sql'));
    await pristine.exec(rollbackSource(ROLLBACK_108));
    const state = await verifyInitialMigrationChain(async sql => (await pristine.query(sql)).rows).catch(error => error);
    assert.match(String(state.message), /partial/);
    const workflow = (await pristine.query(`select
      to_regprocedure('public.psi_admit_authorized_agt002_initial_reanalysis_job(uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,uuid,uuid)') is null as admit_gone,
      exists (select 1 from information_schema.columns where table_name = 'psi_agt002_initial_analysis_jobs' and column_name = 'analysis_kind') as column_left`)).rows[0];
    assert.deepEqual(workflow, { admit_gone: true, column_left: false });
    const instance = await callRpc(pristine, 'psi_create_agt002_workflow_instance', {
      p_opportunity_id: O, p_tender_id: T, p_workflow_type: 'REANALYSIS', p_scope: 'A',
      p_profile_snapshot_id: null, p_profile_snapshot_hash: null, p_idempotency_key: 'instance-after-rollback', p_actor_profile_id: ACTOR,
    });
    const evidence = await seedPackageVersion(pristine, 'after-rollback');
    await assert.rejects(callRpc(pristine, 'psi_grant_agt002_g1_analysis_authorization', {
      p_workflow_instance_id: instance.workflow_instance_id, p_package_version_id: evidence.packageVersionId,
      p_package_hash: evidence.packageHash, p_expires_at: '2099-12-31T00:00:00.000Z',
      p_idempotency_key: 'grant-after-rollback', p_actor_profile_id: ACTOR,
    }), /nunca REANALYSIS/);
  } finally {
    await pristine.close();
  }

  const used = await freshDb();
  try {
    const initialRunId = await completedInitial(used);
    await admitReanalysis(used, { source: initialRunId });
    await assert.rejects(used.exec(rollbackSource(ROLLBACK_108)), /Rollback 108 refused/);
  } finally {
    await used.close();
  }
});
