// AGT-002 P0-06 — PGlite integration for migration 102 (RED then GREEN).
//
// Mirrors the fixture/helper conventions of
// tests/agt002-initial-workflow-and-g1-pglite.integration.test.mjs (026/057/065/099/100 real
// migrations on a minimal hand-rolled opportunity/tender/profile core) and
// tests/agt002-initial-analysis-jobs-pglite.integration.test.mjs (101's admit/claim helpers),
// extended with a hand-rolled psi_tender_analysis_runs mirroring the final 025+050+063 shape
// (canonical, supersedes_run_id, the append-only guard with its one canonical-demotion
// exception) since this suite's purpose is exercising migration 102's ADDITIVE adaptation of
// that exact table, not re-deriving 025/050/063 from scratch via dozens of unrelated
// migrations.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import {
  apply as applyInitialMigrationChain,
  rollback as rollbackInitialMigrationChain,
  verify as verifyInitialMigrationChain,
} from '../scripts/agt002-initial-analysis-migrations.mjs';

const strip = value => value.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const migrationSource = name => strip(readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));

const migration026 = migrationSource('026_tender_document_versions.sql');
const migration057 = migrationSource('057_tender_document_logical_identity.sql');
const migration065Raw = readFileSync(new URL('../supabase/migrations/065_tender_document_extraction_integrity.sql', import.meta.url), 'utf8');
const migration065 = strip(migration065Raw)
  .replace(/create schema if not exists extensions;\s*create extension if not exists pgcrypto with schema extensions;\s*/i, '')
  .replace(/encode\(extensions\.digest\(convert_to\(extracted_text, 'UTF8'\), 'sha256'\), 'hex'\)/g, 'text_hash')
  .replace(/encode\(extensions\.digest\(convert_to\(p_extracted_text, 'UTF8'\), 'sha256'\), 'hex'\)/g, 'p_text_hash');
const migration098 = migrationSource('099_agt002_evidence_packages.sql');
const migration099 = migrationSource('100_agt002_initial_workflow_and_g1.sql');
const migration100 = migrationSource('101_agt002_initial_analysis_jobs.sql');
// RED: not yet authored.
const migration101 = () => migrationSource('102_agt002_initial_analysis_canonical_persistence.sql');
const migration102 = () => migrationSource('103_agt002_initial_analysis_atomic_admission.sql');
const migration103 = () => migrationSource('104_agt002_initial_analysis_server_owned_execution.sql');
// 105 corrige la resolución de pgcrypto en la RPC de admisión: extensions.digest(...) en lugar de
// digest(...) sin calificar bajo `search_path = public, pg_temp`.
const migration104 = () => migrationSource('105_agt002_initial_admission_digest_schema_qualification.sql');
const rollback103 = () => strip(readFileSync(new URL('../supabase/rollbacks/104_agt002_initial_analysis_server_owned_execution_rollback.sql', import.meta.url), 'utf8'));
const rollback101 = () => strip(readFileSync(new URL('../supabase/rollbacks/103_agt002_initial_analysis_atomic_admission_rollback.sql', import.meta.url), 'utf8'));

const O = '10000000-0000-4000-8000-000000000001';
const T = '10000000-0000-4000-8000-000000000002';
const ACTOR = '30000000-0000-4000-8000-000000000001';
const WORKER = 'agt002-initial-analysis-worker';

function hash(text) {
  return createHash('sha256').update(text).digest('hex');
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function callRpc(pg, name, params) {
  const args = Object.values(params).map(sqlLiteral).join(',');
  const result = await pg.query(`select public.${name}(${args}) as data`);
  return result.rows[0]?.data ?? null;
}

// Hand-rolled final (025+050+063) shape of psi_tender_analysis_runs: this suite's purpose is
// exercising 102's ADDITIVE adaptation of this exact table, not re-deriving 025/050/063 from
// their own dozens of unrelated legacy dependencies (psi_tender_go_no_go_decisions,
// psi_sales_interactions, psi_profile_permissions, ...).
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
    if tg_op = 'UPDATE'
       and old.canonical is true
       and new.canonical is false
       and (to_jsonb(old) - 'canonical') = (to_jsonb(new) - 'canonical') then
      return new;
    end if;
    raise exception 'psi_tender_analysis_runs is append-only: UPDATE and DELETE are prohibited (the only allowed transition is canonical true -> false during supersession, changing no other column)';
  end;
  $$;
  create trigger psi_tender_analysis_runs_immutable
    before update or delete on public.psi_tender_analysis_runs
    for each row execute function public.psi_tender_analysis_runs_prevent_mutation();
`;

async function createPreInitialFixture() {
  const pg = new PGlite();
  await pg.exec(`
    create role authenticated; create role service_role; create role anon;
    grant service_role to current_user;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
    create function public.psi_sales_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

    create table public.psi_sales_opportunities (id uuid primary key);
    create table public.psi_public_tenders (id uuid primary key, converted_opportunity_id uuid references public.psi_sales_opportunities(id));
    create table public.psi_sales_profiles (
      id uuid primary key, active boolean not null default true, identity_type text default 'human',
      role text not null default 'admin', microsoft_email text not null default 'test@example.test'
    );
    create table public.psi_access_permissions (code text primary key);
    create table public.psi_profile_permissions (
      profile_id uuid not null references public.psi_sales_profiles(id),
      permission_code text not null references public.psi_access_permissions(code)
    );

    insert into public.psi_sales_opportunities (id) values ('${O}');
    insert into public.psi_public_tenders (id, converted_opportunity_id) values ('${T}', '${O}');
    insert into public.psi_sales_profiles (id, active) values ('${ACTOR}', true);
  `);
  await pg.exec(migration026);
  await pg.exec(migration057);
  await pg.exec(migration065);
  await pg.exec(HAND_ROLLED_ANALYSIS_RUNS);
  return pg;
}

async function createBaseFixture() {
  const pg = await createPreInitialFixture();
  await pg.exec(migration098);
  await pg.exec(migration099);
  await pg.exec(migration100);
  return pg;
}

async function freshDb() {
  const pg = await createBaseFixture();
  await pg.exec(migration101());
  await pg.exec(migration102());
  return pg;
}

test('migration 104 applies after the real 099-103 chain and preserves the one atomic admission signature', async () => {
  const pg = await freshDb();
  try {
    await pg.exec(migration103());
    const row = (await pg.query(`select
      to_regprocedure('public.psi_admit_authorized_agt002_initial_analysis_job(uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,uuid)') is not null as present,
      has_function_privilege('service_role', 'public.psi_admit_authorized_agt002_initial_analysis_job(uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,uuid)', 'EXECUTE') as executable
    `)).rows[0];
    assert.deepEqual(row, { present: true, executable: true });
    await pg.exec(rollback103());
    const restored = (await pg.query(`select pg_get_functiondef(
      'public.psi_admit_authorized_agt002_initial_analysis_job(uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,uuid)'::regprocedure
    ) as definition`)).rows[0].definition;
    assert.doesNotMatch(restored, /analysisRunId|sourceBatchIndexes/);
  } finally {
    await pg.close();
  }
});

test('INITIAL release runner recognizes the real 099-105 chain and its security posture', async () => {
  const pg = await freshDb();
  try {
    await pg.exec(migration103());
    await pg.exec(migration104());
    const result = await verifyInitialMigrationChain(async sql => (await pg.query(sql)).rows);
    assert.equal(result.status, 'applied');
    assert.deepEqual(result.migrations, {
      '099': true,
      '100': true,
      '101': true,
      '102': true,
      '103': true,
      '104': true,
      '105': true,
    });
    assert.equal(result.unsafe_grants, 0);
    assert.equal(result.rls_missing, 0);
    assert.equal(result.missing_service_access, 0);
  } finally {
    await pg.close();
  }
});

test('INITIAL release runner atomically applies and safely rolls back the real empty 099-104 chain', async () => {
  const pg = await createPreInitialFixture();
  const execSql = async sql => {
    if (/AGT002_INITIAL_RUNNER:(?:STATE|PREREQUISITES)/.test(sql)) return (await pg.query(sql)).rows;
    await pg.exec(sql);
    return [];
  };
  try {
    const applied = await applyInitialMigrationChain(execSql);
    assert.equal(applied.status, 'applied');
    const rolledBack = await rollbackInitialMigrationChain(execSql);
    assert.deepEqual(rolledBack, { ok: true, previous: 'applied', status: 'absent' });
  } finally {
    await pg.close();
  }
});

async function seedEvidencePackageVersion(pg, { opportunityId = O, tenderId = T, actorId = ACTOR, label = 'default' } = {}) {
  let packageRow = (await pg.query(
    `select id from public.psi_agt002_evidence_packages where opportunity_id = '${opportunityId}' and tender_id = '${tenderId}'`,
  )).rows[0];
  if (!packageRow) {
    packageRow = (await pg.query(
      `insert into public.psi_agt002_evidence_packages (opportunity_id, tender_id) values ('${opportunityId}', '${tenderId}') returning id`,
    )).rows[0];
  }
  const versionNumber = (await pg.query(
    `select coalesce(max(version_number), 0) + 1 as next from public.psi_agt002_evidence_package_versions where package_id = '${packageRow.id}'`,
  )).rows[0].next;
  const packageHash = hash(`package-${label}`);
  const versionRow = (await pg.query(`
    insert into public.psi_agt002_evidence_package_versions
      (package_id, version_number, idempotency_key, package_hash, document_manifest_hash, semantic_manifest_hash, member_count, batch_count, created_by)
    values ('${packageRow.id}', ${versionNumber}, 'seed-idem-${label}', '${packageHash}', '${hash(`doc-manifest-${label}`)}', '${hash(`semantic-manifest-${label}`)}', 1, 1, '${actorId}')
    returning id
  `)).rows[0];
  return { packageId: packageRow.id, packageVersionId: versionRow.id, packageHash };
}

async function setUpAuthorizedWorkflow(pg, { label, opportunityId = O, tenderId = T, expiresAt = '2026-12-31T00:00:00.000Z' } = {}) {
  const instance = await callRpc(pg, 'psi_create_agt002_workflow_instance', {
    p_opportunity_id: opportunityId, p_tender_id: tenderId, p_workflow_type: 'INITIAL', p_scope: 'A',
    p_profile_snapshot_id: null, p_profile_snapshot_hash: null, p_idempotency_key: `idem-instance-${label}`, p_actor_profile_id: ACTOR,
  });
  const evidence = await seedEvidencePackageVersion(pg, { opportunityId, tenderId, label });
  const grant = await callRpc(pg, 'psi_grant_agt002_g1_analysis_authorization', {
    p_workflow_instance_id: instance.workflow_instance_id, p_package_version_id: evidence.packageVersionId,
    p_package_hash: evidence.packageHash, p_expires_at: expiresAt,
    p_idempotency_key: `idem-grant-${label}`, p_actor_profile_id: ACTOR,
  });
  return { workflowInstanceId: instance.workflow_instance_id, authorizationId: grant.authorization_id, evidence };
}

async function setUpAuthorizedConsumedWorkflow(pg, options = {}) {
  const { label, opportunityId = O, tenderId = T } = options;
  const workflow = await setUpAuthorizedWorkflow(pg, options);
  await callRpc(pg, 'psi_consume_agt002_analysis_authorization', {
    p_authorization_id: workflow.authorizationId, p_workflow_instance_id: workflow.workflowInstanceId,
    p_opportunity_id: opportunityId, p_tender_id: tenderId, p_package_version_id: workflow.evidence.packageVersionId,
    p_package_hash: workflow.evidence.packageHash, p_idempotency_key: `idem-consume-${label}`, p_actor_profile_id: ACTOR,
  });
  return workflow;
}

async function admitAuthorized(pg, workflow, { idempotencyKey, payload = { manifest: 'v1' }, g1Scope = 'A', policyVersion = 'policy-v1' } = {}) {
  return callRpc(pg, 'psi_admit_authorized_agt002_initial_analysis_job', {
    p_authorization_id: workflow.authorizationId,
    p_workflow_instance_id: workflow.workflowInstanceId,
    p_opportunity_id: O,
    p_tender_id: T,
    p_package_version_id: workflow.evidence.packageVersionId,
    p_package_hash: workflow.evidence.packageHash,
    p_g1_scope: g1Scope,
    p_policy_version: policyVersion,
    p_idempotency_key: idempotencyKey,
    p_payload: payload,
    p_actor_profile_id: ACTOR,
  });
}

async function admitAndClaim(pg, { idempotencyKey, opportunityId = O, tenderId = T, payload = { manifest: 'v1' } } = {}) {
  await callRpc(pg, 'psi_admit_agt002_initial_analysis_job', {
    p_opportunity_id: opportunityId, p_tender_id: tenderId, p_idempotency_key: idempotencyKey,
    p_payload: payload, p_requested_by: 'user-1',
  });
  return callRpc(pg, 'psi_claim_agt002_initial_analysis_job', { p_worker_id: WORKER, p_lease_seconds: 600 });
}

async function failJob(pg, { jobId, leaseId, fenceVersion, errorCode }) {
  return callRpc(pg, 'psi_fail_agt002_initial_analysis_job', {
    p_job_id: jobId, p_lease_id: leaseId, p_fence_version: fenceVersion, p_error_code: errorCode,
  });
}

async function storeSynthesisCheckpoint(pg, { job_id, lease_id, fence_version }, output = { synthesis: true }, { usage = null, batchIndex = 0 } = {}) {
  return callRpc(pg, 'psi_store_agt002_initial_analysis_checkpoint', {
    p_job_id: job_id, p_lease_id: lease_id, p_fence_version: fence_version,
    p_batch_index: batchIndex, p_phase: 'synthesis', p_request_hash: hash('request'),
    p_output: output, p_output_sha256: hash(JSON.stringify(output)), p_usage: usage,
  });
}

function buildEnvelope({ analysisRunId, analysisCoreHash, authorizationId, g1Scope, packageHash, opportunityId = O, tenderId = T, overrides = {} }) {
  const meta = {
    schema_version: 'pre_go_analysis.v1',
    analysis_kind: 'INITIAL',
    analysis_version: 1,
    source_analysis_run_id: null,
    aggregate_stage: 'ANALYSIS_PUBLISHED',
    aggregate_version: 1,
    analysis_run_id: analysisRunId,
    analysis_core_hash: analysisCoreHash,
    g1_authorization_id: authorizationId,
    g1_scope: g1Scope,
    package_hash: packageHash,
    opportunity_id: opportunityId,
    tender_id: tenderId,
    ...overrides.meta,
  };
  return { meta, human_decision: null, ...overrides.rest };
}

async function completeJob(pg, params) {
  const analysisRunId = params.analysisRunId;
  const analysisCoreHash = params.analysisCoreHash ?? hash(`core-${analysisRunId}`);
  const envelope = params.envelope ?? buildEnvelope({
    analysisRunId, analysisCoreHash, authorizationId: params.authorizationId,
    g1Scope: params.g1Scope ?? 'A', packageHash: params.packageHash,
  });
  return callRpc(pg, 'psi_complete_agt002_initial_analysis_job', {
    p_job_id: params.jobId,
    p_lease_id: params.leaseId,
    p_fence_version: params.fenceVersion,
    p_analysis_run_id: analysisRunId,
    p_workflow_instance_id: params.workflowInstanceId ?? null,
    p_authorization_id: params.authorizationId,
    p_package_version_id: params.packageVersionId,
    p_package_hash: params.packageHash,
    p_g1_scope: params.g1Scope ?? 'A',
    p_analysis_core_hash: analysisCoreHash,
    p_policy_version: params.policyVersion ?? 'policy-v1',
    p_schema_version: params.schemaVersion ?? 'pre_go_analysis.v1',
    p_envelope: envelope,
    p_envelope_hash: params.envelopeHash ?? hash(JSON.stringify(envelope)),
  });
}

/** Full happy-path setup: admit, claim, synthesis checkpoint, authorized+consumed workflow. */
async function setUpReadyJob(pg, { label }) {
  const claimed = await admitAndClaim(pg, { idempotencyKey: `idem-admit-${label}` });
  const workflow = await setUpAuthorizedConsumedWorkflow(pg, { label });
  const analysisCoreHash = hash(`core-${RUN_1}`);
  const envelope = buildEnvelope({
    analysisRunId: RUN_1,
    analysisCoreHash,
    authorizationId: workflow.authorizationId,
    g1Scope: 'A',
    packageHash: workflow.evidence.packageHash,
  });
  await storeSynthesisCheckpoint(pg, claimed, envelope);
  return { claimed, workflow, envelope };
}

async function runCounts(pg) {
  return (await pg.query(`
    select
      (select count(*)::int from public.psi_tender_analysis_runs) as runs,
      (select count(*)::int from public.psi_agt002_initial_analysis_run_lineage) as lineage,
      (select count(*)::int from public.psi_agt002_pre_go_analysis_versions) as aggregates
  `)).rows[0];
}

const RUN_1 = '40000000-0000-4000-8000-000000000001';
const RUN_2 = '40000000-0000-4000-8000-000000000002';

test('migration 102 applies cleanly and defines the three new tables and the completion RPC', async () => {
  const pg = await freshDb();
  try {
    const tables = (await pg.query(`
      select
        to_regclass('public.psi_agt002_initial_analysis_checkpoints') is not null as checkpoints,
        to_regclass('public.psi_agt002_initial_analysis_run_lineage') is not null as lineage,
        to_regclass('public.psi_agt002_pre_go_analysis_versions') is not null as aggregates
    `)).rows[0];
    assert.equal(tables.checkpoints, true);
    assert.equal(tables.lineage, true);
    assert.equal(tables.aggregates, true);

    const fn = (await pg.query(`
      select to_regprocedure('public.psi_complete_agt002_initial_analysis_job(uuid,uuid,integer,uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb,text)') is not null as present
    `)).rows[0];
    assert.equal(fn.present, true);
  } finally {
    await pg.close();
  }
});

test('migration 103 exposes only the atomic authorized admission RPC to service_role', async () => {
  const pg = await freshDb();
  try {
    const privileges = (await pg.query(`
      select
        to_regprocedure('public.psi_admit_authorized_agt002_initial_analysis_job(uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,uuid)') is not null as atomic_present,
        has_function_privilege('service_role', 'public.psi_admit_authorized_agt002_initial_analysis_job(uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,uuid)', 'EXECUTE') as atomic_execute,
        has_function_privilege('service_role', 'public.psi_admit_agt002_initial_analysis_job(uuid,uuid,text,jsonb,text)', 'EXECUTE') as legacy_execute
    `)).rows[0];
    assert.equal(privileges.atomic_present, true);
    assert.equal(privileges.atomic_execute, true);
    assert.equal(privileges.legacy_execute, false, 'service_role must not bypass G1 consumption through the migration-101 primitive');
  } finally {
    await pg.close();
  }
});

test('authorized admission consumes G1 and creates one job atomically, overwrites caller persistence, and replays idempotently', async () => {
  const pg = await freshDb();
  try {
    const workflow = await setUpAuthorizedWorkflow(pg, { label: 'atomic-happy' });
    await pg.exec('set role service_role');
    const first = await admitAuthorized(pg, workflow, {
      idempotencyKey: 'idem-atomic-happy',
      payload: { manifest: 'v1', persistence: { attackerControlled: true } },
    });
    assert.equal(first.status, 'admitted');
    assert.deepEqual(first.payload, {
      manifest: 'v1',
      persistence: {
        workflowInstanceId: workflow.workflowInstanceId,
        authorizationId: workflow.authorizationId,
        packageVersionId: workflow.evidence.packageVersionId,
        packageHash: workflow.evidence.packageHash,
        g1Scope: 'A',
        policyVersion: 'policy-v1',
      },
    });
    assert.equal(first.requested_by, ACTOR);

    const replay = await admitAuthorized(pg, workflow, {
      idempotencyKey: 'idem-atomic-happy',
      payload: { manifest: 'v1', persistence: { ignoredAgain: true } },
    });
    await pg.exec('reset role');
    assert.equal(replay.status, 'existing');
    assert.equal(replay.job_id, first.job_id);

    const counts = (await pg.query(`
      select
        (select count(*)::int from public.psi_agt002_initial_analysis_jobs) as jobs,
        (select count(*)::int from public.psi_agt002_workflow_events where workflow_instance_id = '${workflow.workflowInstanceId}' and to_state = 'CONSUMED') as consumed
    `)).rows[0];
    assert.deepEqual(counts, { jobs: 1, consumed: 1 });
  } finally {
    await pg.close();
  }
});

test('a job-admission conflict rolls back G1 consumption; no consumed-without-job split state is possible', async () => {
  const pg = await freshDb();
  try {
    await admitAndClaim(pg, { idempotencyKey: 'idem-existing-active' });
    const workflow = await setUpAuthorizedWorkflow(pg, { label: 'atomic-conflict' });

    await assert.rejects(
      admitAuthorized(pg, workflow, { idempotencyKey: 'idem-atomic-conflict' }),
      /Ya existe un job AGT-002 initial-analysis activo/,
    );

    const state = (await pg.query(`
      select to_state from public.psi_agt002_workflow_events
      where workflow_instance_id = '${workflow.workflowInstanceId}'
      order by created_at desc, id desc limit 1
    `)).rows[0];
    assert.equal(state.to_state, 'AUTHORIZED');
    const consumed = (await pg.query(`
      select count(*)::int as n from public.psi_agt002_workflow_events
      where workflow_instance_id = '${workflow.workflowInstanceId}' and to_state = 'CONSUMED'
    `)).rows[0].n;
    assert.equal(consumed, 0);
  } finally {
    await pg.close();
  }
});

test('authorized admission rejects a scope mismatch and an expired grant without creating a job or consuming G1', async () => {
  const pg = await freshDb();
  try {
    const mismatch = await setUpAuthorizedWorkflow(pg, { label: 'atomic-mismatch' });
    await assert.rejects(
      admitAuthorized(pg, mismatch, { idempotencyKey: 'idem-atomic-mismatch', g1Scope: 'A_PLUS_B' }),
      /autorización G1 no coincide/,
    );

    const expired = await setUpAuthorizedWorkflow(pg, { label: 'atomic-expired' });
    await pg.exec(`alter table public.psi_agt002_analysis_authorizations disable trigger psi_agt002_analysis_authorizations_immutable`);
    await pg.exec(`
      update public.psi_agt002_analysis_authorizations
      set granted_at = now() - interval '2 minutes', expires_at = now() - interval '1 minute'
      where id = '${expired.authorizationId}'
    `);
    await pg.exec(`alter table public.psi_agt002_analysis_authorizations enable trigger psi_agt002_analysis_authorizations_immutable`);
    await assert.rejects(
      admitAuthorized(pg, expired, { idempotencyKey: 'idem-atomic-expired' }),
      /expiró/,
    );

    const stateRows = (await pg.query(`
      select workflow_instance_id, to_state from public.psi_agt002_workflow_events
      where workflow_instance_id in ('${mismatch.workflowInstanceId}', '${expired.workflowInstanceId}')
      order by created_at desc, id desc
    `)).rows;
    assert.ok(stateRows.every(row => row.to_state !== 'CONSUMED'));
    const jobs = (await pg.query(`select count(*)::int as n from public.psi_agt002_initial_analysis_jobs`)).rows[0].n;
    assert.equal(jobs, 0);
  } finally {
    await pg.close();
  }
});

test('rollback 103 removes only the atomic wrapper and restores the prior legacy service-role grant', async () => {
  const pg = await freshDb();
  try {
    await pg.exec(rollback101());
    const state = (await pg.query(`
      select
        to_regprocedure('public.psi_admit_authorized_agt002_initial_analysis_job(uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,uuid)') is null as atomic_removed,
        has_function_privilege('service_role', 'public.psi_admit_agt002_initial_analysis_job(uuid,uuid,text,jsonb,text)', 'EXECUTE') as legacy_restored,
        to_regclass('public.psi_agt002_initial_analysis_jobs') is not null as jobs_preserved,
        to_regclass('public.psi_agt002_analysis_authorizations') is not null as authorizations_preserved
    `)).rows[0];
    assert.deepEqual(state, {
      atomic_removed: true,
      legacy_restored: true,
      jobs_preserved: true,
      authorizations_preserved: true,
    });
  } finally {
    await pg.close();
  }
});

test('direct INSERT/UPDATE/DELETE on any of the three new tables is denied to authenticated and to service_role outside the RPCs', async () => {
  const pg = await freshDb();
  try {
    const inserts = [
      `insert into public.psi_agt002_initial_analysis_checkpoints (job_id, batch_index, phase, request_hash, output, output_sha256) values (gen_random_uuid(), 0, 'synthesis', '${hash('x')}', '{}', '${hash('y')}')`,
      `insert into public.psi_agt002_initial_analysis_run_lineage (analysis_run_id, job_id, authorization_id, package_version_id, opportunity_id, tender_id) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), '${O}', '${T}')`,
      `insert into public.psi_agt002_pre_go_analysis_versions (analysis_run_id, aggregate_version, aggregate_stage, schema_version, envelope, envelope_hash, created_by) values (gen_random_uuid(), 1, 'ANALYSIS_PUBLISHED', 'pre_go_analysis.v1', '{"human_decision":null}', '${hash('z')}', 'system')`,
    ];
    for (const sql of inserts) {
      await pg.exec('set role authenticated');
      await assert.rejects(pg.query(sql), /permission denied/i);
      await pg.exec('reset role');
      await pg.exec('set role service_role');
      await assert.rejects(pg.query(sql), /permission denied/i, 'service_role only has SELECT: every write goes exclusively through the governed RPCs');
      await pg.exec('reset role');
    }
  } finally {
    await pg.close();
  }
});

test('happy path: completing a ready job atomically writes the canonical run, lineage, aggregate v1 and job COMPLETED, and appends the workflow COMPLETED event', async () => {
  const pg = await freshDb();
  try {
    const { claimed, workflow } = await setUpReadyJob(pg, { label: 'happy' });

    const result = await completeJob(pg, {
      jobId: claimed.job_id, leaseId: claimed.lease_id, fenceVersion: claimed.fence_version,
      analysisRunId: RUN_1, workflowInstanceId: workflow.workflowInstanceId, authorizationId: workflow.authorizationId,
      packageVersionId: workflow.evidence.packageVersionId, packageHash: workflow.evidence.packageHash,
    });
    assert.equal(result.status, 'completed');
    assert.equal(result.analysis_run_id, RUN_1);
    assert.equal(result.aggregate_version, 1);

    const run = (await pg.query(`select * from public.psi_tender_analysis_runs where id = '${RUN_1}'`)).rows[0];
    assert.equal(run.canonical, true);
    assert.equal(run.status, 'completed');
    assert.equal(run.analysis_kind, 'INITIAL');
    assert.equal(run.analysis_version, 1);
    assert.equal(run.analysis_core_hash, hash(`core-${RUN_1}`));
    assert.equal(run.snapshot_id, null);

    const lineage = (await pg.query(`select * from public.psi_agt002_initial_analysis_run_lineage where analysis_run_id = '${RUN_1}'`)).rows[0];
    assert.equal(lineage.job_id, claimed.job_id);
    assert.equal(lineage.workflow_instance_id, workflow.workflowInstanceId);
    assert.equal(lineage.authorization_id, workflow.authorizationId);

    const aggregate = (await pg.query(`select * from public.psi_agt002_pre_go_analysis_versions where analysis_run_id = '${RUN_1}'`)).rows[0];
    assert.equal(aggregate.aggregate_version, 1);
    assert.equal(aggregate.aggregate_stage, 'ANALYSIS_PUBLISHED');
    assert.equal(aggregate.analysis_core_hash, run.analysis_core_hash, 'the version row must carry the exact same hash the run itself was recorded with');

    const job = (await pg.query(`select status, analysis_run_id from public.psi_agt002_initial_analysis_jobs where id = '${claimed.job_id}'`)).rows[0];
    assert.equal(job.status, 'COMPLETED');
    assert.equal(job.analysis_run_id, RUN_1);

    const latestEvent = (await pg.query(`select to_state from public.psi_agt002_workflow_events where workflow_instance_id = '${workflow.workflowInstanceId}' order by created_at desc, id desc limit 1`)).rows[0];
    assert.equal(latestEvent.to_state, 'COMPLETED');
  } finally {
    await pg.close();
  }
});

test('checkpoint replay is exact: the same identity and declared hashes cannot hide a different output or usage payload', async () => {
  const pg = await freshDb();
  try {
    const claimed = await admitAndClaim(pg, { idempotencyKey: 'idem-checkpoint-exact-replay' });
    const original = { synthesis: 'original' };
    await storeSynthesisCheckpoint(pg, claimed, original, { usage: { totalTokens: 10 } });

    await assert.rejects(
      callRpc(pg, 'psi_store_agt002_initial_analysis_checkpoint', {
        p_job_id: claimed.job_id,
        p_lease_id: claimed.lease_id,
        p_fence_version: claimed.fence_version,
        p_batch_index: 0,
        p_phase: 'synthesis',
        p_request_hash: hash('request'),
        p_output: { synthesis: 'tampered' },
        p_output_sha256: hash(JSON.stringify(original)),
        p_usage: { totalTokens: 999 },
      }),
      /checkpoint distinto/i,
    );

    const persisted = (await pg.query(`
      select output, usage from public.psi_agt002_initial_analysis_checkpoints
      where job_id = '${claimed.job_id}' and phase = 'synthesis'
    `)).rows[0];
    assert.deepEqual(persisted.output, original);
    assert.deepEqual(persisted.usage, { totalTokens: 10 });
  } finally {
    await pg.close();
  }
});

test('completion is bound to the exact persisted synthesis envelope, never merely to the presence of a synthesis checkpoint', async () => {
  const pg = await freshDb();
  try {
    const { claimed, workflow, envelope } = await setUpReadyJob(pg, { label: 'synthesis-binding' });
    const differentEnvelope = { ...envelope, unexpected_uncheckpointed_content: true };

    await assert.rejects(completeJob(pg, {
      jobId: claimed.job_id,
      leaseId: claimed.lease_id,
      fenceVersion: claimed.fence_version,
      analysisRunId: RUN_1,
      workflowInstanceId: workflow.workflowInstanceId,
      authorizationId: workflow.authorizationId,
      packageVersionId: workflow.evidence.packageVersionId,
      packageHash: workflow.evidence.packageHash,
      envelope: differentEnvelope,
    }), /checkpoint de síntesis/i);

    assert.deepEqual(await runCounts(pg), { runs: 0, lineage: 0, aggregates: 0 });
  } finally {
    await pg.close();
  }
});

test('a G1 authorization consumed while valid remains valid for terminal completion after its grant expiry', async () => {
  const pg = await freshDb();
  try {
    const { claimed, workflow } = await setUpReadyJob(pg, { label: 'consumed-before-expiry' });

    // Simulate time having advanced after the already-governed CONSUMED transition. The immutable
    // trigger is disabled only inside this isolated test DB so the fixture can represent that
    // passage of time without sleeping or changing the production append-only contract.
    await pg.exec('alter table public.psi_agt002_analysis_authorizations disable trigger psi_agt002_analysis_authorizations_immutable');
    await pg.query(`
      update public.psi_agt002_analysis_authorizations
      set granted_at = now() - interval '2 minutes', expires_at = now() - interval '1 minute'
      where id = '${workflow.authorizationId}'
    `);
    await pg.exec('alter table public.psi_agt002_analysis_authorizations enable trigger psi_agt002_analysis_authorizations_immutable');

    const result = await completeJob(pg, {
      jobId: claimed.job_id,
      leaseId: claimed.lease_id,
      fenceVersion: claimed.fence_version,
      analysisRunId: RUN_1,
      workflowInstanceId: workflow.workflowInstanceId,
      authorizationId: workflow.authorizationId,
      packageVersionId: workflow.evidence.packageVersionId,
      packageHash: workflow.evidence.packageHash,
    });
    assert.equal(result.status, 'completed');
  } finally {
    await pg.close();
  }
});

test('complete: an exact replay (identical lineage bindings and aggregate v1 row) is idempotent and writes nothing new', async () => {
  const pg = await freshDb();
  try {
    const { claimed, workflow } = await setUpReadyJob(pg, { label: 'exact-replay' });
    const params = {
      jobId: claimed.job_id, leaseId: claimed.lease_id, fenceVersion: claimed.fence_version,
      analysisRunId: RUN_1, workflowInstanceId: workflow.workflowInstanceId, authorizationId: workflow.authorizationId,
      packageVersionId: workflow.evidence.packageVersionId, packageHash: workflow.evidence.packageHash,
    };
    const first = await completeJob(pg, params);
    assert.equal(first.status, 'completed');

    // Replay with the exact same params (completeJob re-derives the same deterministic envelope
    // and hash from them), still using the now-stale leaseId/fenceVersion from the original
    // claim — the COMPLETED idempotent branch is checked before any lease/fence re-validation.
    const replay = await completeJob(pg, params);
    assert.equal(replay.status, 'existing');
    assert.equal(replay.analysis_run_id, RUN_1);
    assert.equal(replay.aggregate_version, 1);

    const counts = await runCounts(pg);
    assert.deepEqual(counts, { runs: 1, lineage: 1, aggregates: 1 }, 'an exact replay must never insert a second run/lineage/aggregate row');
  } finally {
    await pg.close();
  }
});

test('complete: a replay under the same run id with a mismatched analysis_core_hash/envelope is rejected as a conflict, not silently reused', async () => {
  const pg = await freshDb();
  try {
    const { claimed, workflow } = await setUpReadyJob(pg, { label: 'mismatched-replay' });
    const baseParams = {
      jobId: claimed.job_id, leaseId: claimed.lease_id, fenceVersion: claimed.fence_version,
      analysisRunId: RUN_1, workflowInstanceId: workflow.workflowInstanceId, authorizationId: workflow.authorizationId,
      packageVersionId: workflow.evidence.packageVersionId, packageHash: workflow.evidence.packageHash,
    };
    await completeJob(pg, baseParams);

    // Replays the SAME job row (already COMPLETED, same run id) with a deliberately different
    // envelope/hash: this exercises the RPC's own replay comparison directly, independent of the
    // outer job-terminal-shape and opportunity-canonical guards that would normally prevent a
    // second job from ever reaching this run id at all.
    const mismatchedHash = hash('a-different-core-hash');
    const mismatchedEnvelope = buildEnvelope({
      analysisRunId: RUN_1, analysisCoreHash: mismatchedHash, authorizationId: workflow.authorizationId,
      g1Scope: 'A', packageHash: workflow.evidence.packageHash,
    });
    await assert.rejects(completeJob(pg, {
      ...baseParams,
      analysisCoreHash: mismatchedHash,
      envelope: mismatchedEnvelope,
    }), /resultado distinto/i);

    const counts = await runCounts(pg);
    assert.deepEqual(counts, { runs: 1, lineage: 1, aggregates: 1 }, 'the mismatched replay must never insert a second run/lineage/aggregate row');
  } finally {
    await pg.close();
  }
});

test('complete: a replay under the same run id with the same core hash but a different envelope_hash is rejected as a conflict, not silently reused', async () => {
  const pg = await freshDb();
  try {
    const { claimed, workflow } = await setUpReadyJob(pg, { label: 'mismatched-envelope-hash' });
    const analysisCoreHash = hash(`core-${RUN_1}`);
    const baseParams = {
      jobId: claimed.job_id, leaseId: claimed.lease_id, fenceVersion: claimed.fence_version,
      analysisRunId: RUN_1, workflowInstanceId: workflow.workflowInstanceId, authorizationId: workflow.authorizationId,
      packageVersionId: workflow.evidence.packageVersionId, packageHash: workflow.evidence.packageHash,
      analysisCoreHash,
    };
    await completeJob(pg, baseParams);

    // Same job/run, same core hash and lineage bindings, but a different envelope_hash: this
    // isolates the envelope_hash comparison from the analysis_core_hash one exercised above.
    await assert.rejects(completeJob(pg, {
      ...baseParams,
      envelopeHash: hash('a-different-envelope-hash-only'),
    }), /resultado distinto/i);

    const counts = await runCounts(pg);
    assert.deepEqual(counts, { runs: 1, lineage: 1, aggregates: 1 }, 'a mismatched envelope_hash replay must never insert a second run/lineage/aggregate row');
  } finally {
    await pg.close();
  }
});

test('complete: a replay cannot hide a different envelope behind the original envelope_hash', async () => {
  const pg = await freshDb();
  try {
    const { claimed, workflow, envelope } = await setUpReadyJob(pg, { label: 'mismatched-envelope-content' });
    const baseParams = {
      jobId: claimed.job_id,
      leaseId: claimed.lease_id,
      fenceVersion: claimed.fence_version,
      analysisRunId: RUN_1,
      workflowInstanceId: workflow.workflowInstanceId,
      authorizationId: workflow.authorizationId,
      packageVersionId: workflow.evidence.packageVersionId,
      packageHash: workflow.evidence.packageHash,
      envelope,
    };
    const originalEnvelopeHash = hash(JSON.stringify(envelope));
    await completeJob(pg, { ...baseParams, envelopeHash: originalEnvelopeHash });

    await assert.rejects(completeJob(pg, {
      ...baseParams,
      envelope: { ...envelope, hidden_replay_change: true },
      envelopeHash: originalEnvelopeHash,
    }), /resultado distinto/i);

    assert.deepEqual(await runCounts(pg), { runs: 1, lineage: 1, aggregates: 1 });
  } finally {
    await pg.close();
  }
});

test('RED: an INITIAL run with analysis_version other than 1 is rejected by the table CHECK', async () => {
  const pg = await freshDb();
  try {
    const insertSql = `
      insert into public.psi_tender_analysis_runs (
        snapshot_id, opportunity_id, tender_id, producer, method, status, result, idempotency_key, schema_version, policy_version,
        canonical, analysis_kind, analysis_version, g1_authorization_id, g1_scope, package_version_id, analysis_core_hash
      ) values (
        null, '${O}', '${T}', 'AGT-002', 'agent_ai', 'completed', '{}', 'idem-bad-version', 's1', 'p1',
        true, 'INITIAL', 2, gen_random_uuid(), 'A', gen_random_uuid(), '${hash('x')}'
      )`;
    await assert.rejects(pg.query(insertSql), /./);
  } finally {
    await pg.close();
  }
});

test('RED: analysis_kind other than INITIAL is rejected by the table CHECK (this migration defines no REANALYSIS shape)', async () => {
  const pg = await freshDb();
  try {
    const insertSql = `
      insert into public.psi_tender_analysis_runs (
        snapshot_id, opportunity_id, tender_id, producer, method, status, result, idempotency_key, schema_version, policy_version,
        canonical, analysis_kind, analysis_version, g1_authorization_id, g1_scope, package_version_id, analysis_core_hash
      ) values (
        null, '${O}', '${T}', 'AGT-002', 'agent_ai', 'completed', '{}', 'idem-bad-kind', 's1', 'p1',
        true, 'REANALYSIS', 2, gen_random_uuid(), 'A', gen_random_uuid(), '${hash('x')}'
      )`;
    await assert.rejects(pg.query(insertSql), /./);
  } finally {
    await pg.close();
  }
});

test('RED: completing a second job for the same opportunity once a canonical INITIAL run already exists is rejected, and nothing changes', async () => {
  const pg = await freshDb();
  try {
    const first = await setUpReadyJob(pg, { label: 'first' });
    await completeJob(pg, {
      jobId: first.claimed.job_id, leaseId: first.claimed.lease_id, fenceVersion: first.claimed.fence_version,
      analysisRunId: RUN_1, workflowInstanceId: first.workflow.workflowInstanceId, authorizationId: first.workflow.authorizationId,
      packageVersionId: first.workflow.evidence.packageVersionId, packageHash: first.workflow.evidence.packageHash,
    });

    // Simulate a hypothetical second active job for the same opportunity (101 already blocks
    // this through normal admission once a COMPLETED job exists; this directly proves the
    // completion RPC itself is ALSO fail-closed, in depth, at the opportunity-canonical level).
    const job2 = (await pg.query(`
      insert into public.psi_agt002_initial_analysis_jobs (opportunity_id, tender_id, idempotency_key, requested_by, status, lease_id, lease_owner, lease_expires_at, fence_version)
      values ('${O}', '${T}', 'idem-second-active', 'user-1', 'RUNNING', gen_random_uuid(), '${WORKER}', now() + interval '10 minutes', 1)
      returning id, lease_id, fence_version
    `)).rows[0];
    const secondEnvelope = buildEnvelope({
      analysisRunId: RUN_2,
      analysisCoreHash: hash(`core-${RUN_2}`),
      authorizationId: first.workflow.authorizationId,
      g1Scope: 'A',
      packageHash: first.workflow.evidence.packageHash,
    });
    await storeSynthesisCheckpoint(
      pg,
      { job_id: job2.id, lease_id: job2.lease_id, fence_version: job2.fence_version },
      secondEnvelope,
    );

    // p_workflow_instance_id is mandatory (migration 102); reusing the first workflow's already-
    // COMPLETED instance id here is irrelevant to what actually trips this call — the canonical
    // check runs before the workflow-state check, so this must fail on "ya existe un análisis
    // canónico", never on a null/missing workflow id.
    await assert.rejects(completeJob(pg, {
      jobId: job2.id, leaseId: job2.lease_id, fenceVersion: job2.fence_version,
      analysisRunId: RUN_2, workflowInstanceId: first.workflow.workflowInstanceId, authorizationId: first.workflow.authorizationId,
      packageVersionId: first.workflow.evidence.packageVersionId, packageHash: first.workflow.evidence.packageHash,
    }), /ya existe un análisis canónico/i);

    const counts = await runCounts(pg);
    assert.equal(counts.runs, 1, 'a second canonical INITIAL run must never be inserted');
    const job2After = (await pg.query(`select status, analysis_run_id from public.psi_agt002_initial_analysis_jobs where id = '${job2.id}'`)).rows[0];
    assert.equal(job2After.status, 'RUNNING');
    assert.equal(job2After.analysis_run_id, null);
  } finally {
    await pg.close();
  }
});

test('RED: a stale lease (wrong lease_id, the real lease having moved on to a reclaiming worker) is rejected, and nothing is written', async () => {
  const pg = await freshDb();
  try {
    const { claimed, workflow } = await setUpReadyJob(pg, { label: 'stale-lease' });
    const staleLeaseId = '50000000-0000-4000-8000-000000000099';
    assert.notEqual(staleLeaseId, claimed.lease_id);

    await assert.rejects(completeJob(pg, {
      jobId: claimed.job_id, leaseId: staleLeaseId, fenceVersion: claimed.fence_version,
      analysisRunId: RUN_1, workflowInstanceId: workflow.workflowInstanceId, authorizationId: workflow.authorizationId,
      packageVersionId: workflow.evidence.packageVersionId, packageHash: workflow.evidence.packageHash,
    }), /perdió su reserva/i);

    const counts = await runCounts(pg);
    assert.deepEqual(counts, { runs: 0, lineage: 0, aggregates: 0 });
    const job = (await pg.query(`select status, lease_id from public.psi_agt002_initial_analysis_jobs where id = '${claimed.job_id}'`)).rows[0];
    assert.equal(job.status, 'CLAIMED');
    assert.equal(job.lease_id, claimed.lease_id, 'the real lease must be untouched by the rejected call');
  } finally {
    await pg.close();
  }
});

test('RED: a stale fence_version (superseded by a reclaim) is rejected, and nothing is written', async () => {
  const pg = await freshDb();
  try {
    const { claimed, workflow } = await setUpReadyJob(pg, { label: 'stale-fence' });

    await assert.rejects(completeJob(pg, {
      jobId: claimed.job_id, leaseId: claimed.lease_id, fenceVersion: claimed.fence_version + 1,
      analysisRunId: RUN_1, workflowInstanceId: workflow.workflowInstanceId, authorizationId: workflow.authorizationId,
      packageVersionId: workflow.evidence.packageVersionId, packageHash: workflow.evidence.packageHash,
    }), /perdió su reserva/i);

    const counts = await runCounts(pg);
    assert.deepEqual(counts, { runs: 0, lineage: 0, aggregates: 0 });
    const job = (await pg.query(`select status, fence_version from public.psi_agt002_initial_analysis_jobs where id = '${claimed.job_id}'`)).rows[0];
    assert.equal(job.status, 'CLAIMED');
    assert.equal(job.fence_version, claimed.fence_version);
  } finally {
    await pg.close();
  }
});

test('RED: completing without a persisted synthesis checkpoint is rejected, and the job stays unchanged', async () => {
  const pg = await freshDb();
  try {
    const claimed = await admitAndClaim(pg, { idempotencyKey: 'idem-admit-no-checkpoint' });
    const workflow = await setUpAuthorizedConsumedWorkflow(pg, { label: 'no-checkpoint' });

    await assert.rejects(completeJob(pg, {
      jobId: claimed.job_id, leaseId: claimed.lease_id, fenceVersion: claimed.fence_version,
      analysisRunId: RUN_1, workflowInstanceId: workflow.workflowInstanceId, authorizationId: workflow.authorizationId,
      packageVersionId: workflow.evidence.packageVersionId, packageHash: workflow.evidence.packageHash,
    }), /checkpoint de síntesis/i);

    const counts = await runCounts(pg);
    assert.deepEqual(counts, { runs: 0, lineage: 0, aggregates: 0 });
    const job = (await pg.query(`select status from public.psi_agt002_initial_analysis_jobs where id = '${claimed.job_id}'`)).rows[0];
    assert.equal(job.status, 'CLAIMED');
  } finally {
    await pg.close();
  }
});

test('RED: an envelope whose meta.schema_version does not match pre_go_analysis.v1 is rejected, rolling back every write', async () => {
  const pg = await freshDb();
  try {
    const { claimed, workflow } = await setUpReadyJob(pg, { label: 'bad-schema' });
    const analysisCoreHash = hash(`core-${RUN_1}`);
    const envelope = buildEnvelope({
      analysisRunId: RUN_1, analysisCoreHash, authorizationId: workflow.authorizationId,
      g1Scope: 'A', packageHash: workflow.evidence.packageHash,
      overrides: { meta: { schema_version: 'pre_go_analysis.v2' } },
    });

    await assert.rejects(completeJob(pg, {
      jobId: claimed.job_id, leaseId: claimed.lease_id, fenceVersion: claimed.fence_version,
      analysisRunId: RUN_1, workflowInstanceId: workflow.workflowInstanceId, authorizationId: workflow.authorizationId,
      packageVersionId: workflow.evidence.packageVersionId, packageHash: workflow.evidence.packageHash,
      analysisCoreHash, envelope,
    }), /schema_version/i);

    const counts = await runCounts(pg);
    assert.deepEqual(counts, { runs: 0, lineage: 0, aggregates: 0 });
  } finally {
    await pg.close();
  }
});

test('RED: an analysis_core_hash that is not SHA-256 hex is rejected', async () => {
  const pg = await freshDb();
  try {
    const { claimed, workflow } = await setUpReadyJob(pg, { label: 'bad-hash' });
    await assert.rejects(completeJob(pg, {
      jobId: claimed.job_id, leaseId: claimed.lease_id, fenceVersion: claimed.fence_version,
      analysisRunId: RUN_1, workflowInstanceId: workflow.workflowInstanceId, authorizationId: workflow.authorizationId,
      packageVersionId: workflow.evidence.packageVersionId, packageHash: workflow.evidence.packageHash,
      analysisCoreHash: 'not-a-hash',
      envelope: buildEnvelope({
        analysisRunId: RUN_1, analysisCoreHash: 'not-a-hash', authorizationId: workflow.authorizationId,
        g1Scope: 'A', packageHash: workflow.evidence.packageHash,
      }),
    }), /SHA-256/i);
  } finally {
    await pg.close();
  }
});

test('RED: ANALYSIS_PUBLISHED at aggregate_version other than 1 is rejected by the table CHECK', async () => {
  const pg = await freshDb();
  try {
    const { claimed, workflow } = await setUpReadyJob(pg, { label: 'version-check' });
    await completeJob(pg, {
      jobId: claimed.job_id, leaseId: claimed.lease_id, fenceVersion: claimed.fence_version,
      analysisRunId: RUN_1, workflowInstanceId: workflow.workflowInstanceId, authorizationId: workflow.authorizationId,
      packageVersionId: workflow.evidence.packageVersionId, packageHash: workflow.evidence.packageHash,
    });
    const insertSql = `
      insert into public.psi_agt002_pre_go_analysis_versions (analysis_run_id, aggregate_version, aggregate_stage, schema_version, envelope, envelope_hash, analysis_core_hash, created_by)
      values ('${RUN_1}', 2, 'ANALYSIS_PUBLISHED', 'pre_go_analysis.v1', '{"human_decision": null}'::jsonb, '${hash('z')}', '${hash(`core-${RUN_1}`)}', 'system')`;
    await assert.rejects(pg.query(insertSql), /./);
  } finally {
    await pg.close();
  }
});

test('RED: a human_decision on a real ANALYSIS_PUBLISHED row is rejected by the table CHECK', async () => {
  const pg = await freshDb();
  try {
    const { claimed, workflow } = await setUpReadyJob(pg, { label: 'human-decision-check' });
    await completeJob(pg, {
      jobId: claimed.job_id, leaseId: claimed.lease_id, fenceVersion: claimed.fence_version,
      analysisRunId: RUN_1, workflowInstanceId: workflow.workflowInstanceId, authorizationId: workflow.authorizationId,
      packageVersionId: workflow.evidence.packageVersionId, packageHash: workflow.evidence.packageHash,
    });
    const insertSql = `
      insert into public.psi_agt002_pre_go_analysis_versions (analysis_run_id, aggregate_version, aggregate_stage, schema_version, envelope, envelope_hash, analysis_core_hash, created_by)
      values ('${RUN_1}', 1, 'ANALYSIS_PUBLISHED', 'pre_go_analysis.v1', '{"human_decision": {"decision":"CONTINUE"}}'::jsonb, '${hash('zz')}', '${hash(`core-${RUN_1}`)}', 'system')`;
    await assert.rejects(pg.query(insertSql), /./, 'a second version-1 row is already blocked by uniqueness, and this shape is blocked by the human_decision CHECK too');
  } finally {
    await pg.close();
  }
});

test('RED: a second aggregate version whose analysis_core_hash does not match the run\'s own hash is rejected by the FK', async () => {
  const pg = await freshDb();
  try {
    const { claimed, workflow } = await setUpReadyJob(pg, { label: 'hash-fk' });
    await completeJob(pg, {
      jobId: claimed.job_id, leaseId: claimed.lease_id, fenceVersion: claimed.fence_version,
      analysisRunId: RUN_1, workflowInstanceId: workflow.workflowInstanceId, authorizationId: workflow.authorizationId,
      packageVersionId: workflow.evidence.packageVersionId, packageHash: workflow.evidence.packageHash,
    });
    // The run itself was recorded with hash('core-RUN_1'); a later version row claiming a
    // different hash must be rejected by the (analysis_run_id, analysis_core_hash) FK, not
    // merely by re-deriving the hash from each envelope's JSON.
    const insertSql = `
      insert into public.psi_agt002_pre_go_analysis_versions (analysis_run_id, aggregate_version, aggregate_stage, schema_version, envelope, envelope_hash, analysis_core_hash, created_by)
      values ('${RUN_1}', 2, 'G2_RECORDED', 'pre_go_analysis.v1', '{"human_decision": {"decision":"CONTINUE"}}'::jsonb, '${hash('g2-mismatch')}', '${hash('a-different-core-hash')}', 'human')`;
    await assert.rejects(pg.query(insertSql), /foreign key|violates/i);

    const versions = (await pg.query(`select count(*)::int as count from public.psi_agt002_pre_go_analysis_versions where analysis_run_id = '${RUN_1}'`)).rows[0];
    assert.equal(versions.count, 1, 'the mismatched-hash version must never be inserted');
  } finally {
    await pg.close();
  }
});

test('acceptance: a later human event creates a NEW aggregate version without altering the run or the version-1 envelope', async () => {
  const pg = await freshDb();
  try {
    const { claimed, workflow } = await setUpReadyJob(pg, { label: 'g2-structural' });
    await completeJob(pg, {
      jobId: claimed.job_id, leaseId: claimed.lease_id, fenceVersion: claimed.fence_version,
      analysisRunId: RUN_1, workflowInstanceId: workflow.workflowInstanceId, authorizationId: workflow.authorizationId,
      packageVersionId: workflow.evidence.packageVersionId, packageHash: workflow.evidence.packageHash,
    });
    const runBefore = (await pg.query(`select analysis_core_hash, canonical, result from public.psi_tender_analysis_runs where id = '${RUN_1}'`)).rows[0];

    // Structural support only (no G2 RPC exists yet): a future G2_RECORDED event is always a
    // brand-new row, never a mutation of version 1, and must carry the same analysis_core_hash
    // as the run (enforced by the FK, not merely re-derived from the envelope's JSON).
    await pg.query(`
      insert into public.psi_agt002_pre_go_analysis_versions (analysis_run_id, aggregate_version, aggregate_stage, schema_version, envelope, envelope_hash, analysis_core_hash, created_by)
      values ('${RUN_1}', 2, 'G2_RECORDED', 'pre_go_analysis.v1', '{"human_decision": {"decision":"CONTINUE"}}'::jsonb, '${hash('g2')}', '${hash(`core-${RUN_1}`)}', 'human')
    `);

    const versions = (await pg.query(`select aggregate_version, aggregate_stage from public.psi_agt002_pre_go_analysis_versions where analysis_run_id = '${RUN_1}' order by aggregate_version`)).rows;
    assert.deepEqual(versions, [{ aggregate_version: 1, aggregate_stage: 'ANALYSIS_PUBLISHED' }, { aggregate_version: 2, aggregate_stage: 'G2_RECORDED' }]);

    const runAfter = (await pg.query(`select analysis_core_hash, canonical, result from public.psi_tender_analysis_runs where id = '${RUN_1}'`)).rows[0];
    assert.deepEqual(runAfter, runBefore, 'the run row must be byte-for-byte unchanged after a later aggregate version is recorded');

    const v1 = (await pg.query(`select envelope from public.psi_agt002_pre_go_analysis_versions where analysis_run_id = '${RUN_1}' and aggregate_version = 1`)).rows[0];
    assert.equal(v1.envelope.human_decision, null, 'version 1 must remain exactly as first published');
  } finally {
    await pg.close();
  }
});

test('RED: mutating a previous aggregate envelope in place (UPDATE) is rejected — a later stage must always be a new version', async () => {
  const pg = await freshDb();
  try {
    const { claimed, workflow } = await setUpReadyJob(pg, { label: 'no-mutate' });
    await completeJob(pg, {
      jobId: claimed.job_id, leaseId: claimed.lease_id, fenceVersion: claimed.fence_version,
      analysisRunId: RUN_1, workflowInstanceId: workflow.workflowInstanceId, authorizationId: workflow.authorizationId,
      packageVersionId: workflow.evidence.packageVersionId, packageHash: workflow.evidence.packageHash,
    });
    await assert.rejects(
      pg.query(`update public.psi_agt002_pre_go_analysis_versions set envelope = '{"human_decision": null, "tampered": true}'::jsonb where analysis_run_id = '${RUN_1}' and aggregate_version = 1`),
      /append-only/i,
    );
    await assert.rejects(
      pg.query(`delete from public.psi_agt002_pre_go_analysis_versions where analysis_run_id = '${RUN_1}' and aggregate_version = 1`),
      /append-only/i,
    );
  } finally {
    await pg.close();
  }
});

test('RED: changing analysis_core_hash on an existing run (UPDATE) is rejected — append-only inherited from 063, extended to every new column', async () => {
  const pg = await freshDb();
  try {
    const { claimed, workflow } = await setUpReadyJob(pg, { label: 'no-hash-change' });
    await completeJob(pg, {
      jobId: claimed.job_id, leaseId: claimed.lease_id, fenceVersion: claimed.fence_version,
      analysisRunId: RUN_1, workflowInstanceId: workflow.workflowInstanceId, authorizationId: workflow.authorizationId,
      packageVersionId: workflow.evidence.packageVersionId, packageHash: workflow.evidence.packageHash,
    });
    await assert.rejects(
      pg.query(`update public.psi_tender_analysis_runs set analysis_core_hash = '${hash('tampered')}' where id = '${RUN_1}'`),
      /append-only/i,
    );
  } finally {
    await pg.close();
  }
});

test('RED: UPDATE/DELETE on the checkpoints and lineage tables is rejected', async () => {
  const pg = await freshDb();
  try {
    const { claimed, workflow } = await setUpReadyJob(pg, { label: 'no-mutate-lineage' });
    await completeJob(pg, {
      jobId: claimed.job_id, leaseId: claimed.lease_id, fenceVersion: claimed.fence_version,
      analysisRunId: RUN_1, workflowInstanceId: workflow.workflowInstanceId, authorizationId: workflow.authorizationId,
      packageVersionId: workflow.evidence.packageVersionId, packageHash: workflow.evidence.packageHash,
    });

    await assert.rejects(
      pg.query(`update public.psi_agt002_initial_analysis_checkpoints set phase = 'member_batch_analysis' where job_id = '${claimed.job_id}'`),
      /append-only/i,
    );
    await assert.rejects(
      pg.query(`delete from public.psi_agt002_initial_analysis_checkpoints where job_id = '${claimed.job_id}'`),
      /append-only/i,
    );
    await assert.rejects(
      pg.query(`update public.psi_agt002_initial_analysis_run_lineage set package_version_id = gen_random_uuid() where analysis_run_id = '${RUN_1}'`),
      /append-only/i,
    );
    await assert.rejects(
      pg.query(`delete from public.psi_agt002_initial_analysis_run_lineage where analysis_run_id = '${RUN_1}'`),
      /append-only/i,
    );
  } finally {
    await pg.close();
  }
});

test('RED: a job cannot be marked COMPLETED without a run id, and cannot carry a run id otherwise — mechanical terminal-shape CHECK', async () => {
  const pg = await freshDb();
  try {
    const claimed = await admitAndClaim(pg, { idempotencyKey: 'idem-terminal-shape' });
    await assert.rejects(
      pg.query(`update public.psi_agt002_initial_analysis_jobs set status = 'COMPLETED' where id = '${claimed.job_id}'`),
      /./,
    );
    await assert.rejects(
      pg.query(`update public.psi_agt002_initial_analysis_jobs set analysis_run_id = gen_random_uuid() where id = '${claimed.job_id}'`),
      /./,
    );
  } finally {
    await pg.close();
  }
});

test('RED: a job cannot be marked FAILED without an error_code, and cannot carry an error_code otherwise — mechanical terminal-shape CHECK', async () => {
  const pg = await freshDb();
  try {
    const claimed = await admitAndClaim(pg, { idempotencyKey: 'idem-terminal-shape-failed' });
    await assert.rejects(
      pg.query(`update public.psi_agt002_initial_analysis_jobs set status = 'FAILED' where id = '${claimed.job_id}'`),
      /./,
      'FAILED without error_code must be rejected',
    );
    await assert.rejects(
      pg.query(`update public.psi_agt002_initial_analysis_jobs set error_code = 'model_call_failed' where id = '${claimed.job_id}'`),
      /./,
      'error_code set on a non-FAILED row must be rejected',
    );
    await assert.rejects(
      pg.query(`update public.psi_agt002_initial_analysis_jobs set status = 'FAILED', analysis_run_id = gen_random_uuid(), error_code = 'model_call_failed' where id = '${claimed.job_id}'`),
      /./,
      'FAILED can never carry a run id',
    );
  } finally {
    await pg.close();
  }
});

test('RED: a COMPLETED job can never carry an error_code — mechanical terminal-shape CHECK', async () => {
  const pg = await freshDb();
  try {
    const { claimed, workflow } = await setUpReadyJob(pg, { label: 'terminal-shape-completed-error-code' });
    await completeJob(pg, {
      jobId: claimed.job_id, leaseId: claimed.lease_id, fenceVersion: claimed.fence_version,
      analysisRunId: RUN_1, workflowInstanceId: workflow.workflowInstanceId, authorizationId: workflow.authorizationId,
      packageVersionId: workflow.evidence.packageVersionId, packageHash: workflow.evidence.packageHash,
    });
    await assert.rejects(
      pg.query(`update public.psi_agt002_initial_analysis_jobs set error_code = 'model_call_failed' where id = '${claimed.job_id}'`),
      /./,
    );
  } finally {
    await pg.close();
  }
});

test('RED: a forced failure at the very last write (the workflow COMPLETED event) rolls back the run, lineage, aggregate and job update too — true transactional atomicity, not just pre-insert validation', async () => {
  const pg = await freshDb();
  try {
    const { claimed, workflow } = await setUpReadyJob(pg, { label: 'atomic-rollback' });
    const finalEventIdempotencyKey = 'idem-admit-atomic-rollback:workflow-completed';

    // A second, unrelated workflow instance that happens to have an event planted under the
    // EXACT idempotency key the real completion's own final step will use. This forces
    // psi_append_agt002_workflow_event to find an idempotency-key collision whose
    // workflow_instance_id does not match (a 23505 conflict, not a replay) — so the RPC's very
    // last statement fails, after the canonical run, lineage row, aggregate v1 envelope and job
    // COMPLETED update have all already executed inside the same transaction. Crucially this
    // leaves the REAL workflow instance's own latest state at CONSUMED throughout, so the
    // earlier CONSUMED precondition check is never what trips — only the final write is.
    const otherInstance = await callRpc(pg, 'psi_create_agt002_workflow_instance', {
      p_opportunity_id: O, p_tender_id: T, p_workflow_type: 'INITIAL', p_scope: 'A',
      p_profile_snapshot_id: null, p_profile_snapshot_hash: null,
      p_idempotency_key: 'idem-instance-atomic-rollback-other', p_actor_profile_id: ACTOR,
    });
    await pg.query(`
      insert into public.psi_agt002_workflow_events (
        workflow_instance_id, from_state, to_state, actor_profile_id, actor_kind, authority,
        target, env, scope, preconditions, evidence, expires_at, rollback_of_event_id, idempotency_key
      ) values (
        '${otherInstance.workflow_instance_id}', 'REQUESTED', 'REJECTED', null, 'system', 'SYSTEM',
        'INITIAL_ANALYSIS_WORKFLOW', 'production', 'A', '{}'::jsonb, '{}'::jsonb, null, null, '${finalEventIdempotencyKey}'
      )
    `);

    await assert.rejects(completeJob(pg, {
      jobId: claimed.job_id, leaseId: claimed.lease_id, fenceVersion: claimed.fence_version,
      analysisRunId: RUN_1, workflowInstanceId: workflow.workflowInstanceId, authorizationId: workflow.authorizationId,
      packageVersionId: workflow.evidence.packageVersionId, packageHash: workflow.evidence.packageHash,
    }), /conflicto/i);

    const counts = await runCounts(pg);
    assert.deepEqual(counts, { runs: 0, lineage: 0, aggregates: 0 }, 'the run/lineage/aggregate writes that happened earlier in the same call must be rolled back too');
    const job = (await pg.query(`select status, analysis_run_id from public.psi_agt002_initial_analysis_jobs where id = '${claimed.job_id}'`)).rows[0];
    assert.equal(job.status, 'CLAIMED', 'the job COMPLETED update must be rolled back along with everything else');
    assert.equal(job.analysis_run_id, null);
    const events = (await pg.query(`select to_state from public.psi_agt002_workflow_events where workflow_instance_id = '${workflow.workflowInstanceId}' order by created_at, id`)).rows;
    assert.deepEqual(events.map(e => e.to_state), ['REQUESTED', 'AUTHORIZED', 'CONSUMED'], 'the real workflow instance never received the COMPLETED event the rolled-back call attempted to append');
  } finally {
    await pg.close();
  }
});

test('fail: happy path without a bound workflow instance marks the job FAILED and invents no event', async () => {
  const pg = await freshDb();
  try {
    const claimed = await admitAndClaim(pg, { idempotencyKey: 'idem-fail-no-workflow' });
    const result = await failJob(pg, { jobId: claimed.job_id, leaseId: claimed.lease_id, fenceVersion: claimed.fence_version, errorCode: 'model_call_failed' });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.error_code, 'model_call_failed');

    const job = (await pg.query(`select status, error_code, lease_id, lease_expires_at from public.psi_agt002_initial_analysis_jobs where id = '${claimed.job_id}'`)).rows[0];
    assert.equal(job.status, 'FAILED');
    assert.equal(job.error_code, 'model_call_failed');
    assert.equal(job.lease_id, null);
    assert.equal(job.lease_expires_at, null);

    const events = (await pg.query(`select count(*)::int as count from public.psi_agt002_workflow_events`)).rows[0];
    assert.equal(events.count, 0, 'a job with no bound workflow instance must never produce a workflow event');
  } finally {
    await pg.close();
  }
});

test('fail: a malformed optional workflow binding cannot strand the job or invent a workflow event', async () => {
  const pg = await freshDb();
  try {
    const claimed = await admitAndClaim(pg, {
      idempotencyKey: 'idem-fail-malformed-workflow-binding',
      payload: { manifest: 'v1', persistence: { workflowInstanceId: 'not-a-uuid' } },
    });
    const result = await failJob(pg, {
      jobId: claimed.job_id,
      leaseId: claimed.lease_id,
      fenceVersion: claimed.fence_version,
      errorCode: 'invalid_persistence_binding',
    });
    assert.equal(result.status, 'unavailable');

    const job = (await pg.query(`select status, error_code from public.psi_agt002_initial_analysis_jobs where id = '${claimed.job_id}'`)).rows[0];
    assert.equal(job.status, 'FAILED');
    assert.equal(job.error_code, 'invalid_persistence_binding');
    const events = (await pg.query('select count(*)::int as count from public.psi_agt002_workflow_events')).rows[0];
    assert.equal(events.count, 0);
  } finally {
    await pg.close();
  }
});

test('fail: a bound CONSUMED workflow instance gets the governed FAILED event appended in the same transaction, with evidence limited to {error_code}', async () => {
  const pg = await freshDb();
  try {
    const workflow = await setUpAuthorizedConsumedWorkflow(pg, { label: 'fail-with-workflow' });
    const claimed = await admitAndClaim(pg, {
      idempotencyKey: 'idem-fail-with-workflow',
      payload: { manifest: 'v1', persistence: { workflowInstanceId: workflow.workflowInstanceId } },
    });
    const result = await failJob(pg, { jobId: claimed.job_id, leaseId: claimed.lease_id, fenceVersion: claimed.fence_version, errorCode: 'persistence_failure' });
    assert.equal(result.status, 'unavailable');

    const latestEvent = (await pg.query(`
      select to_state, evidence from public.psi_agt002_workflow_events
      where workflow_instance_id = '${workflow.workflowInstanceId}' order by created_at desc, id desc limit 1
    `)).rows[0];
    assert.equal(latestEvent.to_state, 'FAILED');
    assert.deepEqual(latestEvent.evidence, { error_code: 'persistence_failure' }, 'the FAILED event evidence must be limited to {error_code}');
  } finally {
    await pg.close();
  }
});

test('fail: a forced failure at the very last write (the workflow FAILED event) rolls back the job status and error_code too — true transactional atomicity', async () => {
  const pg = await freshDb();
  try {
    const workflow = await setUpAuthorizedConsumedWorkflow(pg, { label: 'fail-atomic-rollback' });
    const claimed = await admitAndClaim(pg, {
      idempotencyKey: 'idem-fail-atomic-rollback',
      payload: { manifest: 'v1', persistence: { workflowInstanceId: workflow.workflowInstanceId } },
    });
    const finalEventIdempotencyKey = 'idem-fail-atomic-rollback:workflow-failed';

    // A second, unrelated workflow instance with an event planted under the EXACT idempotency
    // key the real failure's own final step will use, forcing psi_append_agt002_workflow_event
    // into a 23505 idempotency-key collision on a different workflow_instance_id — so the job
    // status/error_code update that already executed earlier in the same transaction must be
    // rolled back too, not just the event append itself.
    const otherInstance = await callRpc(pg, 'psi_create_agt002_workflow_instance', {
      p_opportunity_id: O, p_tender_id: T, p_workflow_type: 'INITIAL', p_scope: 'A',
      p_profile_snapshot_id: null, p_profile_snapshot_hash: null,
      p_idempotency_key: 'idem-instance-fail-atomic-rollback-other', p_actor_profile_id: ACTOR,
    });
    await pg.query(`
      insert into public.psi_agt002_workflow_events (
        workflow_instance_id, from_state, to_state, actor_profile_id, actor_kind, authority,
        target, env, scope, preconditions, evidence, expires_at, rollback_of_event_id, idempotency_key
      ) values (
        '${otherInstance.workflow_instance_id}', 'REQUESTED', 'REJECTED', null, 'system', 'SYSTEM',
        'INITIAL_ANALYSIS_WORKFLOW', 'production', 'A', '{}'::jsonb, '{}'::jsonb, null, null, '${finalEventIdempotencyKey}'
      )
    `);

    await assert.rejects(
      failJob(pg, { jobId: claimed.job_id, leaseId: claimed.lease_id, fenceVersion: claimed.fence_version, errorCode: 'model_call_failed' }),
      /conflicto/i,
    );

    const job = (await pg.query(`select status, error_code, lease_id from public.psi_agt002_initial_analysis_jobs where id = '${claimed.job_id}'`)).rows[0];
    assert.equal(job.status, 'CLAIMED', 'the job FAILED update must be rolled back along with the rejected workflow-event write');
    assert.equal(job.error_code, null);
    assert.equal(job.lease_id, claimed.lease_id, 'the lease must be untouched by the rolled-back call');

    const events = (await pg.query(`select to_state from public.psi_agt002_workflow_events where workflow_instance_id = '${workflow.workflowInstanceId}' order by created_at, id`)).rows;
    assert.deepEqual(events.map(e => e.to_state), ['REQUESTED', 'AUTHORIZED', 'CONSUMED'], 'the real workflow instance never received the FAILED event the rolled-back call attempted to append');
  } finally {
    await pg.close();
  }
});

test('fail: a bound workflow instance that is not yet CONSUMED is rejected, and the job is left unchanged', async () => {
  const pg = await freshDb();
  try {
    const instance = await callRpc(pg, 'psi_create_agt002_workflow_instance', {
      p_opportunity_id: O, p_tender_id: T, p_workflow_type: 'INITIAL', p_scope: 'A',
      p_profile_snapshot_id: null, p_profile_snapshot_hash: null,
      p_idempotency_key: 'idem-instance-fail-not-consumed', p_actor_profile_id: ACTOR,
    });
    const claimed = await admitAndClaim(pg, {
      idempotencyKey: 'idem-fail-not-consumed',
      payload: { manifest: 'v1', persistence: { workflowInstanceId: instance.workflow_instance_id } },
    });
    await assert.rejects(
      failJob(pg, { jobId: claimed.job_id, leaseId: claimed.lease_id, fenceVersion: claimed.fence_version, errorCode: 'model_call_failed' }),
      /CONSUMED/i,
    );
    const job = (await pg.query(`select status, error_code from public.psi_agt002_initial_analysis_jobs where id = '${claimed.job_id}'`)).rows[0];
    assert.equal(job.status, 'CLAIMED');
    assert.equal(job.error_code, null);
  } finally {
    await pg.close();
  }
});

test('fail: a stale lease_id is rejected, and nothing is written', async () => {
  const pg = await freshDb();
  try {
    const claimed = await admitAndClaim(pg, { idempotencyKey: 'idem-fail-stale-lease' });
    const staleLeaseId = '50000000-0000-4000-8000-000000000098';
    assert.notEqual(staleLeaseId, claimed.lease_id);
    await assert.rejects(
      failJob(pg, { jobId: claimed.job_id, leaseId: staleLeaseId, fenceVersion: claimed.fence_version, errorCode: 'lease_lost' }),
      /perdió su reserva/i,
    );
    const job = (await pg.query(`select status, lease_id, error_code from public.psi_agt002_initial_analysis_jobs where id = '${claimed.job_id}'`)).rows[0];
    assert.equal(job.status, 'CLAIMED');
    assert.equal(job.lease_id, claimed.lease_id);
    assert.equal(job.error_code, null);
  } finally {
    await pg.close();
  }
});

test('fail: a stale fence_version is rejected, and nothing is written', async () => {
  const pg = await freshDb();
  try {
    const claimed = await admitAndClaim(pg, { idempotencyKey: 'idem-fail-stale-fence' });
    await assert.rejects(
      failJob(pg, { jobId: claimed.job_id, leaseId: claimed.lease_id, fenceVersion: claimed.fence_version + 1, errorCode: 'lease_lost' }),
      /perdió su reserva/i,
    );
    const job = (await pg.query(`select status, fence_version, error_code from public.psi_agt002_initial_analysis_jobs where id = '${claimed.job_id}'`)).rows[0];
    assert.equal(job.status, 'CLAIMED');
    assert.equal(job.fence_version, claimed.fence_version);
    assert.equal(job.error_code, null);
  } finally {
    await pg.close();
  }
});

test('fail: a raw/non-closed-shape error code is rejected by the RPC itself, independent of any JS-side validation', async () => {
  const pg = await freshDb();
  try {
    const claimed = await admitAndClaim(pg, { idempotencyKey: 'idem-fail-bad-code' });
    for (const badCode of ['Model_Call_Failed', 'model call failed', 'Error: timeout at line 42', 'ab', '']) {
      await assert.rejects(
        failJob(pg, { jobId: claimed.job_id, leaseId: claimed.lease_id, fenceVersion: claimed.fence_version, errorCode: badCode }),
        new RegExp('.'),
        `error code ${JSON.stringify(badCode)} must be rejected`,
      );
    }
    const job = (await pg.query(`select status, error_code from public.psi_agt002_initial_analysis_jobs where id = '${claimed.job_id}'`)).rows[0];
    assert.equal(job.status, 'CLAIMED', 'a rejected error code must never mutate the job');
    assert.equal(job.error_code, null);
  } finally {
    await pg.close();
  }
});

test('fail: a COMPLETED job can never be degraded to FAILED', async () => {
  const pg = await freshDb();
  try {
    const { claimed, workflow } = await setUpReadyJob(pg, { label: 'fail-after-complete' });
    await completeJob(pg, {
      jobId: claimed.job_id, leaseId: claimed.lease_id, fenceVersion: claimed.fence_version,
      analysisRunId: RUN_1, workflowInstanceId: workflow.workflowInstanceId, authorizationId: workflow.authorizationId,
      packageVersionId: workflow.evidence.packageVersionId, packageHash: workflow.evidence.packageHash,
    });
    await assert.rejects(
      failJob(pg, { jobId: claimed.job_id, leaseId: claimed.lease_id, fenceVersion: claimed.fence_version, errorCode: 'model_call_failed' }),
      /ya se completó/i,
    );
    const job = (await pg.query(`select status, analysis_run_id, error_code from public.psi_agt002_initial_analysis_jobs where id = '${claimed.job_id}'`)).rows[0];
    assert.equal(job.status, 'COMPLETED');
    assert.equal(job.analysis_run_id, RUN_1);
    assert.equal(job.error_code, null);
  } finally {
    await pg.close();
  }
});

test('fail: a replay with the same error code is idempotent; a different error code is a conflicting replay that never overwrites the original', async () => {
  const pg = await freshDb();
  try {
    const claimed = await admitAndClaim(pg, { idempotencyKey: 'idem-fail-replay' });
    const first = await failJob(pg, { jobId: claimed.job_id, leaseId: claimed.lease_id, fenceVersion: claimed.fence_version, errorCode: 'model_call_failed' });
    assert.equal(first.status, 'unavailable');

    const replay = await failJob(pg, { jobId: claimed.job_id, leaseId: claimed.lease_id, fenceVersion: claimed.fence_version, errorCode: 'model_call_failed' });
    assert.equal(replay.status, 'existing');
    assert.equal(replay.error_code, 'model_call_failed');

    await assert.rejects(
      failJob(pg, { jobId: claimed.job_id, leaseId: claimed.lease_id, fenceVersion: claimed.fence_version, errorCode: 'persistence_failure' }),
      /código de error distinto/i,
    );
    const job = (await pg.query(`select status, error_code from public.psi_agt002_initial_analysis_jobs where id = '${claimed.job_id}'`)).rows[0];
    assert.equal(job.status, 'FAILED');
    assert.equal(job.error_code, 'model_call_failed', 'a conflicting replay must never overwrite the original error code');
  } finally {
    await pg.close();
  }
});

test('direct EXECUTE of psi_fail_agt002_initial_analysis_job is denied to authenticated, and granted to service_role', async () => {
  const pg = await freshDb();
  try {
    const claimed = await admitAndClaim(pg, { idempotencyKey: 'idem-fail-grants' });
    await pg.exec('set role authenticated');
    await assert.rejects(
      pg.query(`select public.psi_fail_agt002_initial_analysis_job('${claimed.job_id}', '${claimed.lease_id}', ${claimed.fence_version}, 'model_call_failed')`),
      /permission denied/i,
    );
    await pg.exec('reset role');
    await pg.exec('set role service_role');
    const result = await pg.query(`select public.psi_fail_agt002_initial_analysis_job('${claimed.job_id}', '${claimed.lease_id}', ${claimed.fence_version}, 'model_call_failed') as data`);
    assert.equal(result.rows[0].data.status, 'unavailable');
    await pg.exec('reset role');
  } finally {
    await pg.close();
  }
});

test('the rollback refuses to run while any job carries a recorded FAILED history (error_code), even with no COMPLETED run at all', async () => {
  const seeded = await freshDb();
  try {
    const claimed = await admitAndClaim(seeded, { idempotencyKey: 'idem-rollback-guard-failed' });
    await failJob(seeded, { jobId: claimed.job_id, leaseId: claimed.lease_id, fenceVersion: claimed.fence_version, errorCode: 'model_call_failed' });

    const counts = await runCounts(seeded);
    assert.deepEqual(counts, { runs: 0, lineage: 0, aggregates: 0 }, 'sanity: this installation never produced any canonical run');

    const rollback100 = strip(readFileSync(new URL('../supabase/rollbacks/102_agt002_initial_analysis_canonical_persistence_rollback.sql', import.meta.url), 'utf8'));
    await assert.rejects(seeded.exec(rollback100), /./, 'FAILED-only history must still block the rollback, not just COMPLETED history');
  } finally {
    await seeded.close();
  }
});

test('the rollback refuses to run while any INITIAL analysis history exists, and succeeds against a pristine install', async () => {
  const seeded = await freshDb();
  try {
    const { claimed, workflow } = await setUpReadyJob(seeded, { label: 'rollback-guard' });
    await completeJob(seeded, {
      jobId: claimed.job_id, leaseId: claimed.lease_id, fenceVersion: claimed.fence_version,
      analysisRunId: RUN_1, workflowInstanceId: workflow.workflowInstanceId, authorizationId: workflow.authorizationId,
      packageVersionId: workflow.evidence.packageVersionId, packageHash: workflow.evidence.packageHash,
    });
    const rollback100 = strip(readFileSync(new URL('../supabase/rollbacks/102_agt002_initial_analysis_canonical_persistence_rollback.sql', import.meta.url), 'utf8'));
    await assert.rejects(seeded.exec(rollback100), /./);
  } finally {
    await seeded.close();
  }

  const pristine = await freshDb();
  try {
    const rollback100 = strip(readFileSync(new URL('../supabase/rollbacks/102_agt002_initial_analysis_canonical_persistence_rollback.sql', import.meta.url), 'utf8'));
    await pristine.exec(rollback100);
    const tables = (await pristine.query(`
      select
        to_regclass('public.psi_agt002_pre_go_analysis_versions') is null as aggregates_gone,
        to_regclass('public.psi_agt002_initial_analysis_run_lineage') is null as lineage_gone,
        to_regclass('public.psi_agt002_initial_analysis_checkpoints') is null as checkpoints_gone
    `)).rows[0];
    assert.equal(tables.aggregates_gone, true);
    assert.equal(tables.lineage_gone, true);
    assert.equal(tables.checkpoints_gone, true);

    const preserved = (await pristine.query(`select exists (select 1 from pg_roles where rolname = 'service_role') as still_there`)).rows[0];
    assert.equal(preserved.still_there, true, 'rollback 102 must never touch preexisting harness state');
  } finally {
    await pristine.close();
  }
});

console.log('AGT-002 initial-analysis canonical persistence PGlite integration suite defined');
