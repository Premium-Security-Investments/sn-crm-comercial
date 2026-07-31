import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import {
  buildAtomicApplySql,
  buildAtomicRollbackSql,
  buildRollbackVerifySql,
  buildStateSql,
  classifyState,
} from '../scripts/agt002-program-migrations.mjs';

const migration050 = readFileSync(new URL('../supabase/migrations/050_agt002_canonical_analysis.sql', import.meta.url), 'utf8');
const rollback050 = readFileSync(new URL('../supabase/rollbacks/050_agt002_canonical_analysis_rollback.sql', import.meta.url), 'utf8');
const migration051 = readFileSync(new URL('../supabase/migrations/051_agt002_context_versions.sql', import.meta.url), 'utf8');
const rollback051 = readFileSync(new URL('../supabase/rollbacks/051_agt002_context_versions_rollback.sql', import.meta.url), 'utf8');
const migration052 = readFileSync(new URL('../supabase/migrations/052_tender_document_chunks.sql', import.meta.url), 'utf8');

const O = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';
const S = '33333333-3333-4333-8333-333333333333';
const P = '44444444-4444-4444-8444-444444444444';

async function baseDatabase() {
  const pg = new PGlite();
  await pg.exec(`
    create role authenticated; create role service_role; create role anon;
    grant service_role to current_user;
    alter default privileges in schema public grant all on tables to anon;
    create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true);
    create table public.psi_sales_opportunities (id uuid primary key);
    create table public.psi_public_tenders (id uuid primary key);
    create table public.psi_tender_document_snapshots (
      id uuid primary key,
      opportunity_id uuid not null references public.psi_sales_opportunities(id),
      tender_id uuid not null references public.psi_public_tenders(id)
    );
    create table public.psi_tender_document_versions (
      id uuid primary key,
      opportunity_id uuid not null references public.psi_sales_opportunities(id),
      tender_id uuid not null references public.psi_public_tenders(id)
    );
    create table public.psi_tender_analysis_runs (
      id uuid primary key default gen_random_uuid(),
      snapshot_id uuid not null references public.psi_tender_document_snapshots(id),
      opportunity_id uuid not null references public.psi_sales_opportunities(id),
      tender_id uuid not null references public.psi_public_tenders(id),
      producer text not null, method text not null, status text not null, result jsonb,
      critical_open_count integer not null default 0, idempotency_key text not null unique,
      schema_version text not null, policy_version text not null, model text, usage jsonb,
      created_at timestamptz not null default now(), completed_at timestamptz
    );
    alter table public.psi_tender_analysis_runs enable row level security;
    revoke all on table public.psi_tender_analysis_runs from public, authenticated, anon, service_role;
    grant select on table public.psi_tender_analysis_runs to service_role;
    insert into public.psi_sales_profiles values ('${P}', true);
    insert into public.psi_sales_opportunities values ('${O}');
    insert into public.psi_public_tenders values ('${T}');
    insert into public.psi_tender_document_snapshots values ('${S}', '${O}', '${T}');
  `);
  return pg;
}

async function verifyAppliedState(pg, id) {
  const row = (await pg.query(buildStateSql(id))).rows[0];
  assert.equal(classifyState(row), 'applied', `runner state ${id} debe validar objetos, definiciones, RLS y grants reales: ${JSON.stringify(row)}`);
}

async function verifyRollback(pg, id) {
  const row = (await pg.query(buildRollbackVerifySql(id))).rows[0];
  assert.equal(row.ok, true, `rollback ${id} debe terminar exactamente en el estado esperado`);
}

// 050: an absent migration must be allowed to repair legacy grants that the
// migration itself revokes. Partial markers and applied-definition drift remain blocked.
{
  const pg = await baseDatabase();
  await pg.exec('grant all on table public.psi_tender_analysis_runs to anon');
  const before = (await pg.query(buildStateSql('050'))).rows[0];
  assert.equal(classifyState(before), 'absent');
  assert.ok(Number(before.unsafe_table_grants) > 0, 'la reproducción debe contener grants legacy inseguros');
  await pg.exec(buildAtomicApplySql('050', migration050));
  await verifyAppliedState(pg, '050');
}

// A real partial marker remains fail-closed and the migration body never runs.
{
  const pg = await baseDatabase();
  await pg.exec('alter table public.psi_tender_analysis_runs add column canonical boolean not null default false');
  const before = (await pg.query(buildStateSql('050'))).rows[0];
  assert.equal(classifyState(before), 'partial');
  await assert.rejects(pg.exec(buildAtomicApplySql('050', migration050)), /AGT002_STATE_DRIFT_050/);
  assert.equal((await pg.query("select to_regclass('public.psi_agt002_analysis_attempt_events') is null absent")).rows[0].absent, true);
}

// The insecure-absent exception is exclusive to 050. A later migration that
// does not repair the audited legacy table must remain fail-closed.
{
  const pg = await baseDatabase();
  await pg.exec('grant all on table public.psi_tender_analysis_runs to anon');
  const before = (await pg.query(buildStateSql('052'))).rows[0];
  assert.equal(classifyState(before), 'absent');
  assert.ok(Number(before.unsafe_table_grants) > 0);
  await assert.rejects(pg.exec(buildAtomicApplySql('052', migration052)), /AGT002_STATE_DRIFT_052/);
  assert.equal((await pg.query("select to_regclass('public.psi_tender_document_chunks') is null absent")).rows[0].absent, true);
}

// 050: the guard and destructive DDL execute in one real PGlite request. Existing
// attempt evidence must abort the request before any schema object is removed.
{
  const pg = await baseDatabase();
  await pg.exec(buildAtomicApplySql('050', migration050));
  await verifyAppliedState(pg, '050');
  await pg.exec(`insert into public.psi_agt002_analysis_attempt_events
    (snapshot_id, opportunity_id, tender_id, attempt_key, event_key, producer, state)
    values ('${S}', '${O}', '${T}', 'attempt-050', 'event-050', 'AGT-002', 'queued')`);

  await assert.rejects(
    pg.exec(buildAtomicRollbackSql('050', rollback050)),
    /rollback 050 bloqueado: existe evidencia o una migración dependiente/i,
  );
  assert.equal((await pg.query("select to_regclass('public.psi_agt002_analysis_attempt_events') is not null present")).rows[0].present, true);
  assert.equal((await pg.query("select count(*)::int count from information_schema.columns where table_schema='public' and table_name='psi_tender_analysis_runs' and column_name='canonical'")).rows[0].count, 1);
}

// 050 succeeds atomically when the protected surfaces contain no evidence.
{
  const pg = await baseDatabase();
  await pg.exec(buildAtomicApplySql('050', migration050));
  await verifyAppliedState(pg, '050');
  await pg.exec(buildAtomicRollbackSql('050', rollback050));
  await verifyRollback(pg, '050');
}

// 051: a persisted immutable context version blocks rollback and leaves both its
// table and the run reference column intact.
{
  const pg = await baseDatabase();
  await pg.exec(buildAtomicApplySql('050', migration050));
  await verifyAppliedState(pg, '050');
  await pg.exec(buildAtomicApplySql('051', migration051));
  await verifyAppliedState(pg, '051');
  await pg.exec(`insert into public.psi_agt002_context_versions
    (opportunity_id, tender_id, snapshot_id, context_version, context, context_hash, human_evidence_count, idempotency_key, created_by)
    values ('${O}', '${T}', '${S}', 2, '{}'::jsonb, 'hash-051', 0, 'context-051', '${P}')`);

  await assert.rejects(
    pg.exec(buildAtomicRollbackSql('051', rollback051)),
    /rollback 051 bloqueado: existe evidencia o una migración dependiente/i,
  );
  assert.equal((await pg.query("select to_regclass('public.psi_agt002_context_versions') is not null present")).rows[0].present, true);
  assert.equal((await pg.query("select count(*)::int count from information_schema.columns where table_schema='public' and table_name='psi_tender_analysis_runs' and column_name='context_version_id'")).rows[0].count, 1);
}

// 051 succeeds atomically without evidence and restores the exact 050 function surface.
{
  const pg = await baseDatabase();
  await pg.exec(buildAtomicApplySql('050', migration050));
  await verifyAppliedState(pg, '050');
  await pg.exec(buildAtomicApplySql('051', migration051));
  await verifyAppliedState(pg, '051');
  await pg.exec(buildAtomicRollbackSql('051', rollback051));
  await verifyRollback(pg, '051');
}

console.log('AGT-002 runner real atomic rollback 050/051 PGlite integration passed');
