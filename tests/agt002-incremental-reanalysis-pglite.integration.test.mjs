import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { buildAgt002IncrementalDeltaManifest } from '../agt002-incremental-analysis-input.js';

const migration = readFileSync(new URL('../supabase/migrations/116_agt002_incremental_reanalysis_r1.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollbacks/116_agt002_incremental_reanalysis_r1_rollback.sql', import.meta.url), 'utf8');
const O = '10000000-0000-4000-8000-000000000001';
const T = '10000000-0000-4000-8000-000000000002';
const P = '10000000-0000-4000-8000-000000000003';
const C = '10000000-0000-4000-8000-000000000004';
const R1 = '10000000-0000-4000-8000-000000000005';
const S = '10000000-0000-4000-8000-000000000006';
const B = '10000000-0000-4000-8000-000000000007';
const J = '10000000-0000-4000-8000-000000000008';
const R2 = '10000000-0000-4000-8000-000000000009';

const sql = value => {
  if (value == null) return 'null';
  if (typeof value === 'object') return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  return `'${String(value).replaceAll("'", "''")}'`;
};

async function call(pg, name, values) {
  return (await pg.query(`select public.${name}(${values.map(sql).join(',')}) data`)).rows[0].data;
}

async function fresh() {
  const pg = new PGlite();
  await pg.exec(`
    create schema extensions;
    create function extensions.digest(data bytea, algo text) returns bytea language sql immutable as $$ select sha256(data) $$;
    create role anon; create role authenticated; create role service_role;
    create table public.psi_sales_opportunities (id uuid primary key);
    create table public.psi_public_tenders (id uuid primary key, converted_opportunity_id uuid references public.psi_sales_opportunities(id));
    create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true);
    create table public.psi_agt002_context_versions (
      id uuid primary key, opportunity_id uuid not null, tender_id uuid not null
    );
    create table public.psi_tender_document_snapshots (
      id uuid primary key, opportunity_id uuid not null, tender_id uuid not null
    );
    create table public.psi_tender_analysis_runs (
      id uuid primary key, opportunity_id uuid not null references public.psi_sales_opportunities(id),
      tender_id uuid not null references public.psi_public_tenders(id), producer text not null,
      status text not null, canonical boolean not null, context_version_id uuid references public.psi_agt002_context_versions(id),
      result jsonb, supersedes_run_id uuid references public.psi_tender_analysis_runs(id)
    );
    create table public.psi_agt002_reanalysis_jobs (
      id uuid primary key, opportunity_id uuid not null references public.psi_sales_opportunities(id),
      tender_id uuid not null references public.psi_public_tenders(id), snapshot_id uuid not null references public.psi_tender_document_snapshots(id),
      context_version_id uuid not null references public.psi_agt002_context_versions(id), idempotency_key text not null,
      frozen_engine_input jsonb not null, status text not null, requested_by uuid not null references public.psi_sales_profiles(id),
      analysis_run_id uuid references public.psi_tender_analysis_runs(id), error_code text
    );
    insert into public.psi_sales_opportunities values ('${O}');
    insert into public.psi_public_tenders values ('${T}', '${O}');
    insert into public.psi_sales_profiles values ('${P}');
    insert into public.psi_agt002_context_versions values ('${C}', '${O}', '${T}');
    insert into public.psi_tender_document_snapshots values ('${S}', '${O}', '${T}');
    insert into public.psi_tender_analysis_runs values ('${R1}', '${O}', '${T}', 'AGT-002', 'completed', true, '${C}',
      '{"findings":[{"id":"finding-b"},{"claim_id":"finding-a"}]}'::jsonb, null);
  `);
  await pg.exec(migration);
  return pg;
}

function officialSignal(id, version) {
  return {
    trigger_kind: 'official_document', trust_class: 'trusted', source_table: 'psi_tender_document_versions',
    source_type: 'pliego', source_id: id, source_version: version, content_hash: id.padEnd(64, 'a').slice(0, 64),
    observed_at: '2026-10-08T00:00:00.000Z', actor_profile_id: null, validates_signal_id: null,
  };
}

test('116 groups one official batch, seals it, dispatches one durable job and accumulates late evidence', async () => {
  const pg = await fresh();
  try {
    const recorded = await call(pg, 'psi_record_agt002_incremental_signals', [
      O, T, B, 'official-sync-1', P, [officialSignal('1', 'v1'), officialSignal('2', 'v1')],
    ]);
    assert.equal(recorded.status, 'sealed');
    assert.equal(recorded.members.length, 2);
    assert.equal(recorded.members.every(item => item.source_batch_id === B), true);
    assert.equal((await pg.query('select count(*)::int n from public.psi_agt002_incremental_change_sets')).rows[0].n, 1);

    const manifest = buildAgt002IncrementalDeltaManifest({
      opportunityId: O, tenderId: T, changeSetId: recorded.change_set_id,
      priorCanonicalRunId: recorded.prior_canonical_run_id, priorContextVersionId: recorded.prior_context_version_id,
      policyVersion: recorded.policy_version, members: recorded.members,
      affectedFindingRefs: recorded.affected_finding_refs,
    });
    const sealed = await call(pg, 'psi_seal_agt002_incremental_change_set', [recorded.change_set_id, manifest, manifest.manifest_hash]);
    assert.equal(sealed.status, 'existing');
    const replayed = await call(pg, 'psi_record_agt002_incremental_signals', [
      O, T, B, 'official-sync-1-replay', P, [officialSignal('1', 'v1'), officialSignal('2', 'v1')],
    ]);
    assert.equal(replayed.status, 'existing');
    assert.equal(replayed.manifest_hash, manifest.manifest_hash);
    assert.equal((await pg.query('select count(*)::int n from public.psi_agt002_incremental_change_sets')).rows[0].n, 1,
      'an idempotent replay must not create an empty successor set');

    await pg.query(`insert into public.psi_agt002_reanalysis_jobs
      (id, opportunity_id, tender_id, snapshot_id, context_version_id, idempotency_key, frozen_engine_input, status, requested_by)
      values ('${J}', '${O}', '${T}', '${S}', '${C}', 'r1:${manifest.manifest_hash}',
        '${JSON.stringify({ incremental_delta_manifest: manifest }).replaceAll("'", "''")}'::jsonb, 'queued', '${P}')`);
    const dispatched = await call(pg, 'psi_dispatch_agt002_incremental_change_set', [recorded.change_set_id, J, manifest.manifest_hash]);
    assert.equal(dispatched.status, 'dispatched');
    await pg.query(`update public.psi_agt002_reanalysis_jobs set status = 'running' where id = '${J}'`);
    const started = await call(pg, 'psi_start_agt002_incremental_change_set', [J, 'worker-1']);
    assert.equal(started.status, 'running');
    assert.equal((await pg.query(`select state from public.psi_agt002_incremental_change_sets where id = '${recorded.change_set_id}'`)).rows[0].state, 'RUNNING');

    const late = {
      trigger_kind: 'human_interaction', trust_class: 'trusted', source_table: 'psi_tender_question_responses',
      source_type: 'answer', source_id: 'answer-1', source_version: 'v1', content_hash: 'b'.repeat(64),
      observed_at: '2026-10-08T00:01:00.000Z', actor_profile_id: P, validates_signal_id: null,
    };
    const accumulated = await call(pg, 'psi_record_agt002_incremental_signals', [O, T, null, 'human-tx-1', P, [late]]);
    assert.equal(accumulated.status, 'accumulating');
    assert.notEqual(accumulated.change_set_id, recorded.change_set_id);

    await pg.query(`update public.psi_tender_analysis_runs set canonical = false where id = '${R1}'`);
    await pg.query(`insert into public.psi_tender_analysis_runs values ('${R2}', '${O}', '${T}', 'AGT-002', 'completed', true, '${C}',
      '{"integral_analysis":{"findings":[{"finding_ref":"finding-c"}]}}'::jsonb, '${R1}')`);
    await pg.query(`update public.psi_agt002_reanalysis_jobs set status = 'completed', analysis_run_id = '${R2}' where id = '${J}'`);
    const closed = await call(pg, 'psi_close_agt002_incremental_change_set', [J, 'completed', R2, null, 'agt002-reanalysis-worker']);
    assert.equal(closed.status, 'completed');
    assert.equal(closed.successor_ready_to_dispatch, true);
    assert.equal(closed.successor_change_set_id, accumulated.change_set_id);
    const successor = (await pg.query(`select prior_canonical_run_id,state,manifest from public.psi_agt002_incremental_change_sets where id = '${accumulated.change_set_id}'`)).rows[0];
    assert.equal(successor.prior_canonical_run_id, R2, 'late evidence rebases onto the new canonical predecessor before sealing');
    assert.equal(successor.state, 'SEALED');
    assert.deepEqual(successor.manifest.affected_finding_refs, ['finding-c']);

    await assert.rejects(pg.query(`update public.psi_agt002_incremental_signals set source_version = 'v2'`), /append-only/);
    await assert.rejects(pg.exec(rollback), /Rollback 116 refused/);
  } finally {
    await pg.close();
  }
});

test('116 preserves uncertain evidence without creating a change set or job', async () => {
  const pg = await fresh();
  try {
    const pending = {
      trigger_kind: 'human_interaction', trust_class: 'pending_validation', source_table: 'psi_tender_question_responses',
      source_type: 'answer', source_id: 'uncertain-1', source_version: 'v1', content_hash: 'c'.repeat(64),
      observed_at: '2026-10-08T00:00:00.000Z', actor_profile_id: P, validates_signal_id: null,
    };
    const result = await call(pg, 'psi_record_agt002_incremental_signals', [O, T, null, 'uncertain-tx-1', P, [pending]]);
    assert.equal(result.status, 'pending_validation');
    assert.equal((await pg.query('select count(*)::int n from public.psi_agt002_incremental_change_sets')).rows[0].n, 0);
    const row = (await pg.query('select trust_class, change_set_id from public.psi_agt002_incremental_signals')).rows[0];
    assert.equal(row.trust_class, 'pending_validation');
    assert.equal(row.change_set_id, null);
  } finally {
    await pg.close();
  }
});

test('116 validates uncertain evidence by appending a referenced trusted signal', async () => {
  const pg = await fresh();
  try {
    const pending = {
      trigger_kind: 'human_interaction', trust_class: 'pending_validation', source_table: 'psi_tender_question_responses',
      source_type: 'answer', source_id: 'uncertain-2', source_version: 'v1', content_hash: 'd'.repeat(64),
      observed_at: '2026-10-08T00:00:00.000Z', actor_profile_id: P, validates_signal_id: null,
    };
    const pendingResult = await call(pg, 'psi_record_agt002_incremental_signals', [O, T, null, 'uncertain-tx-2', P, [pending]]);
    const pendingId = pendingResult.signal_ids[0];
    const trusted = { ...pending, trust_class: 'trusted', validates_signal_id: pendingId,
      observed_at: '2026-10-08T00:05:00.000Z' };
    const result = await call(pg, 'psi_record_agt002_incremental_signals', [O, T, null, 'validation-tx-2', P, [trusted]]);
    assert.equal(result.status, 'sealed');
    assert.deepEqual(result.affected_finding_refs, ['finding-a', 'finding-b']);
    const rows = (await pg.query(`select id,trust_class,change_set_id,validates_signal_id from public.psi_agt002_incremental_signals order by created_at,id`)).rows;
    assert.equal(rows.length, 2);
    assert.equal(rows.find(row => row.id === pendingId).trust_class, 'pending_validation');
    assert.equal(rows.find(row => row.trust_class === 'trusted').validates_signal_id, pendingId);
    await assert.rejects(call(pg, 'psi_record_agt002_incremental_signals', [O, T, null, 'bad-validation', P, [{
      ...pending, trust_class: 'trusted', validates_signal_id: null,
    }]]), /referenciar explícitamente/);
  } finally {
    await pg.close();
  }
});

test('116 accepts the authoritative INITIAL predecessor that has no legacy context version', async () => {
  const pg = await fresh();
  try {
    await pg.query(`update public.psi_tender_analysis_runs set context_version_id = null where id = '${R1}'`);
    const recorded = await call(pg, 'psi_record_agt002_incremental_signals', [
      O, T, B, 'official-after-initial', P, [officialSignal('3', 'v1')],
    ]);
    assert.equal(recorded.status, 'sealed');
    assert.equal(recorded.prior_canonical_run_id, R1);
    assert.equal(recorded.prior_context_version_id, null);
    const manifest = buildAgt002IncrementalDeltaManifest({
      opportunityId: O, tenderId: T, changeSetId: recorded.change_set_id,
      priorCanonicalRunId: recorded.prior_canonical_run_id,
      priorContextVersionId: recorded.prior_context_version_id,
      policyVersion: recorded.policy_version, members: recorded.members,
      affectedFindingRefs: recorded.affected_finding_refs,
    });
    assert.equal(manifest.prior_context_version_id, null);
    assert.equal((await call(pg, 'psi_seal_agt002_incremental_change_set', [
      recorded.change_set_id, manifest, manifest.manifest_hash,
    ])).status, 'existing');
  } finally {
    await pg.close();
  }
});
