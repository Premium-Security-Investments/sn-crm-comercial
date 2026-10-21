// AGT-002 migration 139 — PGlite integration for the INCREMENTAL reanalysis (Juan, 2026-10-20): only the documents that
// were not in the source run's package are read; the synthesis carries the prior run. Harness copied from the 108 test.
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
  if (with108) await pg.exec(migrationSource('138_agt002_manual_reanalysis_requests.sql'));
  if (with108) await pg.exec(migrationSource('139_agt002_incremental_reanalysis.sql'));
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


/** Records one more document version + ok extraction, returns the member row data. */
async function seedDocument(pg, label) {
  const text = `Texto ${label}.`;
  const version = await callRpc(pg, 'psi_record_tender_document_version', {
    p_opportunity_id: O, p_tender_id: T, p_source: 'carga manual', p_source_document_id: `doc-${label}`,
    p_name: `${label}.pdf`, p_content_hash: hash(`content-${label}`), p_storage_path: `tender-documents/${O}/doc-${label}`,
    p_mime_type: 'application/pdf', p_size_bytes: 1024, p_document_type: 'otro', p_extracted_text: text,
    p_source_url: null, p_actor_id: ACTOR,
  });
  const extraction = await callRpc(pg, 'psi_record_tender_document_extraction', {
    p_opportunity_id: O, p_tender_id: T, p_document_version_id: version.id,
    p_extractor_version: 'tender-document-text-extraction@2', p_status: 'ok', p_parser: 'pdf-parse',
    p_extracted_text: text, p_text_hash: hash(text), p_char_count: text.length,
    p_text_byte_count: Buffer.byteLength(text, 'utf8'), p_metadata: {}, p_gap_reason: null, p_actor_id: ACTOR,
  });
  return { id: version.id, contentHash: hash(`content-${label}`), extractionId: extraction.extraction_id ?? extraction.id, textHash: hash(text) };
}

/** A REANALYSIS-authorized package that holds the source run's members plus `extra` new documents. */
async function incrementalWorkflow(pg, { label, sourcePackageVersionId, extra }) {
  const instance = await callRpc(pg, 'psi_create_agt002_workflow_instance', {
    p_opportunity_id: O, p_tender_id: T, p_workflow_type: 'REANALYSIS', p_scope: 'A',
    p_profile_snapshot_id: null, p_profile_snapshot_hash: null, p_idempotency_key: `instance-${label}`, p_actor_profile_id: ACTOR,
  });
  const pkg = (await pg.query(`select package_id from public.psi_agt002_evidence_package_versions where id = '${sourcePackageVersionId}'`)).rows[0];
  const next = (await pg.query(`select coalesce(max(version_number), 0) + 1 as n from public.psi_agt002_evidence_package_versions where package_id = '${pkg.package_id}'`)).rows[0].n;
  const oldMembers = (await pg.query(`select * from public.psi_agt002_evidence_package_members where package_version_id = '${sourcePackageVersionId}'`)).rows;
  const packageHash = hash(`package-${label}`);
  const total = oldMembers.length + extra.length;
  const packageVersion = (await pg.query(`
    insert into public.psi_agt002_evidence_package_versions
      (package_id, version_number, idempotency_key, package_hash, document_manifest_hash, semantic_manifest_hash, member_count, batch_count, created_by)
    values ('${pkg.package_id}', ${next}, 'seed-${label}', '${packageHash}', '${hash(`dm-${label}`)}', '${hash(`sm-${label}`)}', ${total}, 1, '${ACTOR}')
    returning id`)).rows[0];
  for (const member of oldMembers) {
    await pg.query(`insert into public.psi_agt002_evidence_package_members
      (package_version_id, document_version_id, batch_index, source_classification, inclusion_reason, content_hash, extraction_id, extraction_text_hash)
      values ('${packageVersion.id}', '${member.document_version_id}', 0, 'official', 'Pliego.', '${member.content_hash}', '${member.extraction_id}', '${member.extraction_text_hash}')`);
  }
  for (const doc of extra) {
    await pg.query(`insert into public.psi_agt002_evidence_package_members
      (package_version_id, document_version_id, batch_index, source_classification, inclusion_reason, content_hash, extraction_id, extraction_text_hash)
      values ('${packageVersion.id}', '${doc.id}', 0, 'official', 'Respuestas a observaciones.', '${doc.contentHash}', '${doc.extractionId}', '${doc.textHash}')`);
  }
  await pg.query(`insert into public.psi_agt002_evidence_package_batches (package_version_id, batch_index, member_count) values ('${packageVersion.id}', 0, ${total})`);
  const grant = await callRpc(pg, 'psi_grant_agt002_g1_analysis_authorization', {
    p_workflow_instance_id: instance.workflow_instance_id, p_package_version_id: packageVersion.id,
    p_package_hash: packageHash, p_expires_at: '2099-12-31T00:00:00.000Z',
    p_idempotency_key: `grant-${label}`, p_actor_profile_id: ACTOR,
  });
  return { workflowInstanceId: instance.workflow_instance_id, authorizationId: grant.authorization_id, packageVersionId: packageVersion.id, packageHash };
}

const admitIncremental = (pg, workflow, source, key = 'admit-incremental') => callRpc(pg, 'psi_admit_authorized_agt002_incremental_reanalysis_job', {
  p_authorization_id: workflow.authorizationId, p_workflow_instance_id: workflow.workflowInstanceId,
  p_opportunity_id: O, p_tender_id: T, p_package_version_id: workflow.packageVersionId,
  p_package_hash: workflow.packageHash, p_g1_scope: 'A', p_policy_version: 'policy-v1',
  p_idempotency_key: key, p_payload: PAYLOAD, p_actor_profile_id: ACTOR, p_source_analysis_run_id: source,
});

const sourcePackageOf = async (pg, runId) => (await pg.query(`select payload -> 'persistence' ->> 'packageVersionId' as id from public.psi_agt002_initial_analysis_jobs where analysis_run_id = '${runId}'`)).rows[0].id;

test('incremental: only the new documents are read; the synthesis carries the prior run; it completes like a REANALYSIS', async () => {
  const pg = await freshDb();
  try {
    const initialRunId = await completedInitial(pg);
    const sourcePackage = await sourcePackageOf(pg, initialRunId);
    const oldIds = (await pg.query(`select document_version_id::text as id from public.psi_agt002_evidence_package_members where package_version_id = '${sourcePackage}'`)).rows.map(row => row.id);
    const respuestas = await seedDocument(pg, 'respuestas');
    const acta = await seedDocument(pg, 'acta');
    const workflow = await incrementalWorkflow(pg, { label: 'inc', sourcePackageVersionId: sourcePackage, extra: [respuestas, acta] });

    const admitted = await admitIncremental(pg, workflow, initialRunId);
    assert.equal(admitted.status, 'admitted');
    const [members, synthesis, ...rest] = admitted.payload.batches;
    assert.equal(rest.length, 0, 'one member batch (the 2 new documents) plus the synthesis');
    assert.deepEqual([...members.memberIds].sort(), [respuestas.id, acta.id].sort());
    assert.ok(!members.memberIds.some(id => oldIds.includes(id)), 'the source run documents are not re-read');
    assert.equal(synthesis.phase, 'synthesis');
    assert.equal(synthesis.mode, 'incremental');
    assert.equal(synthesis.priorAnalysisRunId, initialRunId);
    assert.equal(members.requestHash, hash(`${workflow.packageHash}:incremental:${initialRunId}:member_batch_analysis:0`));
    assert.equal(admitted.payload.persistence.analysisKind, 'REANALYSIS');
    assert.equal(admitted.payload.persistence.analysisVersion, 2);
    assert.equal(admitted.payload.persistence.packageVersionId, workflow.packageVersionId, 'the full package stays the evidence');

    const replay = await admitIncremental(pg, workflow, initialRunId);
    assert.equal(replay.status, 'existing');

    const ready = await claimAndCheckpoint(pg, persistence => envelopeFor({ persistence, kind: 'REANALYSIS', version: 2, source: initialRunId }));
    const done = await complete(pg, 'psi_complete_agt002_initial_reanalysis_job', ready);
    assert.equal(done.status, 'completed');
    assert.equal(done.supersedes_run_id, initialRunId);
  } finally {
    await pg.close();
  }
});

test('la cola de solicitudes lleva el modo: full por defecto, incremental permitido, otro valor no', async () => {
  const pg = await freshDb();
  try {
    await pg.query(`insert into public.psi_agt002_manual_reanalysis_requests (opportunity_id, requested_by) values ('${O}', '${ACTOR}')`);
    const row = (await pg.query(`select mode from public.psi_agt002_manual_reanalysis_requests`)).rows[0];
    assert.equal(row.mode, 'full');
    await pg.query(`update public.psi_agt002_manual_reanalysis_requests set status = 'rejected', started_at = now(), finished_at = now(), reason = 'x'`);
    await pg.query(`insert into public.psi_agt002_manual_reanalysis_requests (opportunity_id, requested_by, mode) values ('${O}', '${ACTOR}', 'incremental')`);
    await assert.rejects(pg.query(`insert into public.psi_agt002_manual_reanalysis_requests (opportunity_id, requested_by, mode) values ('${O}', '${ACTOR}', 'parcial')`));
  } finally {
    await pg.close();
  }
});

test('incremental without new documents is rejected (nothing to analyze)', async () => {
  const pg = await freshDb();
  try {
    const initialRunId = await completedInitial(pg);
    const sourcePackage = await sourcePackageOf(pg, initialRunId);
    const workflow = await incrementalWorkflow(pg, { label: 'same', sourcePackageVersionId: sourcePackage, extra: [] });
    await assert.rejects(admitIncremental(pg, workflow, initialRunId, 'admit-same'), /No hay documentos nuevos/);
    const jobs = (await pg.query(`select count(*)::int as n from public.psi_agt002_initial_analysis_jobs where analysis_kind = 'REANALYSIS'`)).rows[0].n;
    assert.equal(jobs, 0);
  } finally {
    await pg.close();
  }
});

test('incremental still requires the canonical source and is service_role only; rollback removes it', async () => {
  const pg = await freshDb();
  try {
    const initialRunId = await completedInitial(pg);
    const sourcePackage = await sourcePackageOf(pg, initialRunId);
    const doc = await seedDocument(pg, 'nuevo');
    const workflow = await incrementalWorkflow(pg, { label: 'bad-source', sourcePackageVersionId: sourcePackage, extra: [doc] });
    await assert.rejects(admitIncremental(pg, workflow, '40000000-0000-4000-8000-0000000000ff', 'admit-bad'), /corrida fuente/);
    const grants = (await pg.query(`select
      has_function_privilege('anon', 'public.psi_admit_authorized_agt002_incremental_reanalysis_job(uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb, uuid, uuid)', 'execute') as anon,
      has_function_privilege('service_role', 'public.psi_admit_authorized_agt002_incremental_reanalysis_job(uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb, uuid, uuid)', 'execute') as service`)).rows[0];
    assert.deepEqual(grants, { anon: false, service: true });
    await pg.exec(rollbackSource('139_agt002_incremental_reanalysis_rollback.sql'));
    const left = (await pg.query(`select count(*)::int as n from pg_proc where proname = 'psi_admit_authorized_agt002_incremental_reanalysis_job'`)).rows[0].n;
    assert.equal(left, 0);
    const modeColumn = (await pg.query(`select count(*)::int as n from information_schema.columns where table_name = 'psi_agt002_manual_reanalysis_requests' and column_name = 'mode'`)).rows[0].n;
    assert.equal(modeColumn, 0, 'el rollback también quita el modo de la cola');
  } finally {
    await pg.close();
  }
});
