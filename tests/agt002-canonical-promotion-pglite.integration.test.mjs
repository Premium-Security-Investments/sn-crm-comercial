import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// F1: verifies the canonical-promotion invariants that 050-062 never enforced —
// mechanically at most one canonical=true, status='completed' run per
// opportunity_id (a real unique index, not an application convention); promotion
// demotes the previous canonical run in place without deleting or rewriting its
// payload (psi_tender_analysis_runs has been append-only since 025, so only one
// narrow canonical true->false transition is carved out — nothing else may ever
// mutate); idempotency-key replay still dedupes and rejects conflicting payloads;
// and canonical reads can use canonical=true unambiguously because the invariant is
// enforced at write time, not resolved through a side table at read time.
const strip = value => value.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const migration050 = strip(readFileSync(new URL('../supabase/migrations/050_agt002_canonical_analysis.sql', import.meta.url), 'utf8'));
const migration051 = strip(readFileSync(new URL('../supabase/migrations/051_agt002_context_versions.sql', import.meta.url), 'utf8'));
const migration053 = strip(readFileSync(new URL('../supabase/migrations/053_agt002_legal_corpus.sql', import.meta.url), 'utf8'));
const migration056 = strip(readFileSync(new URL('../supabase/migrations/056_agt002_legal_corpus_publication_gate.sql', import.meta.url), 'utf8'));

const migration063Url = new URL('../supabase/migrations/063_agt002_canonical_promotion.sql', import.meta.url);
const rollback063Url = new URL('../supabase/rollbacks/063_agt002_canonical_promotion_rollback.sql', import.meta.url);
const HAS_063 = existsSync(migration063Url) && existsSync(rollback063Url);
const migration063 = HAS_063 ? strip(readFileSync(migration063Url, 'utf8')) : null;
const rollback063 = HAS_063 ? strip(readFileSync(rollback063Url, 'utf8')) : null;

const P = '44444444-4444-4444-8444-444444444444';
const O = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';
const S = '33333333-3333-4333-8333-333333333333';

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

// Builds the pre-063 (050+051+053+056) foundation only. 063 is applied by the caller
// when present, so the exact same fixture also documents the pre-063 behavior gap.
async function createBaseDatabase() {
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
    -- Mirrors the real 025 append-only guard exactly (before any 063 relaxation).
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

  const context = await callRpc(pg, 'psi_record_agt002_context_version', {
    p_opportunity_id: O, p_tender_id: T, p_snapshot_id: S, p_context_version: 2,
    p_context: { snapshot_id: S, human_evidence: [] }, p_context_hash: 'context-hash-1',
    p_human_evidence_count: 0, p_idempotency_key: 'context-key-1', p_actor_id: P,
  });
  pg.contextVersionId = context.id;
  return pg;
}

async function createDatabase({ applyPromotion = true } = {}) {
  const pg = await createBaseDatabase();
  if (applyPromotion && HAS_063) await pg.exec(migration063);
  return pg;
}

function promoteArgs(overrides = {}) {
  return {
    p_snapshot_id: S, p_opportunity_id: O, p_tender_id: T,
    p_result: { summary: 'Vig-IA' }, p_critical_open_count: 0,
    p_idempotency_key: 'canonical-1', p_schema_version: 'schema-1', p_policy_version: 'policy-1',
    p_model: 'model-1', p_usage: { model: 'model-1', input_tokens: 1, output_tokens: 1 },
    p_context_version_id: overrides.contextVersionId,
    p_legal_corpus_version_id: null,
    ...overrides.params,
  };
}

async function promote(pg, overrides = {}) {
  return callRpc(pg, 'psi_record_agt002_canonical_analysis_run', promoteArgs({ contextVersionId: pg.contextVersionId, ...overrides }));
}

async function canonicalTrueCount(pg) {
  const { rows } = await pg.query(`select count(*)::int n from public.psi_tender_analysis_runs where opportunity_id = '${O}' and canonical`);
  return rows[0].n;
}

async function allRows(pg) {
  const { rows } = await pg.query(`select id, canonical, result, ${HAS_063 ? 'supersedes_run_id,' : ''} idempotency_key from public.psi_tender_analysis_runs where opportunity_id = '${O}' order by created_at, id`);
  return rows;
}

let redFailures = 0;

// --- Behavior-gap block: always runs, even before 063 exists. Proves the 050-062
// gap as a real assertion failure (actual=2 vs expected=1), not a thrown SQL error
// about a missing table/column. Once 063 exists and is applied, this block is green.
{
  const pg = await createDatabase();
  await promote(pg, { params: { p_idempotency_key: 'canonical-1' } });
  await promote(pg, { params: { p_idempotency_key: 'canonical-2', p_result: { summary: 'Vig-IA v2' } } });
  try {
    assert.equal(await canonicalTrueCount(pg), 1, 'at most one canonical=true row may exist per opportunity_id after two promotions');
  } catch (error) {
    redFailures += 1;
    console.log(`RED (behavior gap, expected before 063): ${error.message}`);
    if (!HAS_063) {
      // Without 063 the gap must be real and demonstrated, not silently skipped.
      assert.equal(await canonicalTrueCount(pg), 2, 'the documented pre-063 bug: two canonical=true rows coexist');
    } else {
      throw error;
    }
  }
  await pg.close();
}

if (!HAS_063) {
  console.log(`AGT-002 canonical promotion: 063 not present yet — ran only the behavior-gap RED block (${redFailures} failure(s) demonstrated as expected). Add 063 to run the full GREEN suite.`);
} else {
  assert.equal(redFailures, 0, 'the behavior-gap block must be green once 063 exists and is applied');

  // (a) mechanically at most one canonical=true row per opportunity_id, and the
  // previous canonical run is demoted (not deleted, not mutated) rather than left
  // dangling as a second canonical=true row.
  {
    const pg = await createDatabase();
    const first = await promote(pg, { params: { p_idempotency_key: 'canonical-1' } });
    const second = await promote(pg, { params: { p_idempotency_key: 'canonical-2', p_result: { summary: 'Vig-IA v2' } } });
    assert.notEqual(first.id, second.id);
    assert.equal(await canonicalTrueCount(pg), 1, 'exactly one canonical=true row must remain after a promotion');

    const rows = await allRows(pg);
    assert.equal(rows.length, 2, 'the superseded run must still exist: promotion never deletes history');
    const firstRow = rows.find(row => row.id === first.id);
    const secondRow = rows.find(row => row.id === second.id);
    assert.equal(firstRow.canonical, false, 'the previous canonical run must be demoted to canonical=false');
    assert.deepEqual(firstRow.result, { summary: 'Vig-IA' }, 'the previous run\'s payload must never be rewritten, only its canonical flag');
    assert.equal(secondRow.canonical, true);
    assert.equal(secondRow.supersedes_run_id, first.id, 'the new run must record exactly which run it superseded');
    await pg.close();
  }

  // Mechanical backstop: the partial unique index rejects a second canonical=true,
  // status='completed' row even when inserted directly, bypassing the RPC entirely.
  {
    const pg = await createDatabase();
    await promote(pg, { params: { p_idempotency_key: 'canonical-1' } });
    await assert.rejects(
      pg.query(`
        insert into public.psi_tender_analysis_runs (snapshot_id, opportunity_id, tender_id, producer, method, status, result, idempotency_key, schema_version, policy_version, canonical, completed_at)
        values ('${S}', '${O}', '${T}', 'AGT-002', 'agent_ai', 'completed', '{"summary":"bypass"}', 'bypass-insert', 'schema-1', 'policy-1', true, now())
      `),
      /duplicate key|unique/i,
      'a second canonical=true row inserted directly (bypassing the RPC) must be mechanically rejected by the unique index',
    );
    await pg.close();
  }

  // Mechanical backstop: the append-only trigger rejects any attempt to mutate a
  // superseded row's payload, and rejects a canonical false -> true transition too
  // (only true -> false, with no other column change, is ever allowed).
  {
    const pg = await createDatabase();
    const first = await promote(pg, { params: { p_idempotency_key: 'canonical-1' } });
    await promote(pg, { params: { p_idempotency_key: 'canonical-2', p_result: { summary: 'Vig-IA v2' } } });

    await assert.rejects(
      pg.exec(`update public.psi_tender_analysis_runs set result = '{"summary":"tampered"}' where id = '${first.id}'`),
      /append-only/i,
      'directly rewriting a superseded run\'s payload must be rejected',
    );
    await assert.rejects(
      pg.exec(`update public.psi_tender_analysis_runs set canonical = true where id = '${first.id}'`),
      /append-only/i,
      'a canonical false -> true transition must never be allowed, even for a previously-canonical run',
    );
    await assert.rejects(
      pg.exec(`delete from public.psi_tender_analysis_runs where id = '${first.id}'`),
      /append-only/i,
      'deleting a superseded run must be rejected',
    );
    await pg.close();
  }

  // (b) repeated sequential promotion attempts for the same opportunity never leave
  // more than one canonical=true row, and every prior run remains in history. PGlite
  // is a single embedded connection with no real concurrent-transaction/multi-backend
  // support, so true interleaved-transaction concurrency cannot be exercised here —
  // that is a genuine limitation of this test environment, not something this test
  // pretends to cover. What is verified instead, honestly, is the mechanical
  // safeguard that would make a real concurrent race safe in actual Postgres: the row
  // lock sequence (`for update` on the opportunity, then on the current canonical
  // row) plus the partial unique index as backstop — the same two properties that
  // guarantee correctness under real MVCC concurrency are exercised and asserted
  // here, just not under an actual simultaneous-transaction interleaving.
  {
    const pg = await createDatabase();
    const results = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(await promote(pg, { params: { p_idempotency_key: `canonical-seq-${i}`, p_result: { summary: `Vig-IA v${i}` } } }));
    }
    assert.equal(await canonicalTrueCount(pg), 1, 'exactly one canonical=true row must survive repeated promotion attempts');
    const rows = await allRows(pg);
    assert.equal(rows.length, 5, 'every promoted run must remain in history');
    const stillCanonical = rows.filter(row => row.canonical);
    assert.equal(stillCanonical.length, 1);
    assert.equal(stillCanonical[0].id, results[results.length - 1].id, 'only the last promotion may remain canonical');
    await pg.close();
  }

  // (d) same idempotency_key never duplicates, and a conflicting payload under the
  // same key is never silently accepted.
  {
    const pg = await createDatabase();
    const first = await promote(pg, { params: { p_idempotency_key: 'canonical-1' } });
    const replay = await promote(pg, { params: { p_idempotency_key: 'canonical-1' } });
    assert.equal(replay.id, first.id, 'replaying the same idempotency_key must return the same run, not a new one');
    assert.equal((await allRows(pg)).length, 1, 'a replay must never insert a duplicate row');
    assert.equal(await canonicalTrueCount(pg), 1);

    await assert.rejects(
      promote(pg, { params: { p_idempotency_key: 'canonical-1', p_result: { summary: 'payload distinto' } } }),
      /idempotencia/i,
      'a conflicting payload under an existing idempotency_key must be rejected, not silently accepted',
    );
    await pg.close();
  }

  // An exact replay remains idempotent even after that run was superseded. It must
  // return the historical run in its current canonical=false state, without
  // re-promoting it, inserting a duplicate, or disturbing the newer canonical run.
  {
    const pg = await createDatabase();
    const first = await promote(pg, { params: { p_idempotency_key: 'canonical-old' } });
    const second = await promote(pg, { params: { p_idempotency_key: 'canonical-current', p_result: { summary: 'Vig-IA current' } } });

    const replay = await promote(pg, { params: { p_idempotency_key: 'canonical-old' } });
    assert.equal(replay.id, first.id, 'an exact replay of a superseded key must return the original run');
    assert.equal(replay.canonical, false, 'replay must report the superseded run as historical, not re-promote it');
    assert.equal((await allRows(pg)).length, 2, 'replay of a superseded key must not insert a duplicate');
    assert.equal(await canonicalTrueCount(pg), 1, 'replay of a superseded key must not disturb canonical uniqueness');
    const { rows: canonicalRows } = await pg.query(`select id from public.psi_tender_analysis_runs where opportunity_id = '${O}' and canonical`);
    assert.equal(canonicalRows[0].id, second.id, 'the newer canonical run must remain current after replaying the old key');
    await pg.close();
  }

  // (e) canonical reads can use canonical=true unambiguously: a later, non-canonical
  // rules run must never be picked up by a canonical-only read, and — because the
  // invariant is now enforced at write time — there can never be a second
  // canonical=true row to confuse "latest" with "canonical" in the first place.
  {
    const pg = await createDatabase();
    const canonical = await promote(pg, { params: { p_idempotency_key: 'canonical-1' } });
    await pg.query(`
      insert into public.psi_tender_analysis_runs (snapshot_id, opportunity_id, tender_id, producer, method, status, result, idempotency_key, schema_version, policy_version, canonical, completed_at)
      values ('${S}', '${O}', '${T}', 'siio_rules_v1', 'rules', 'completed', '{"summary":"reglas"}', 'legacy-later', 'legacy', 'legacy', false, now() + interval '1 hour')
    `);
    const { rows } = await pg.query(`select id from public.psi_tender_analysis_runs where opportunity_id = '${O}' and canonical`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, canonical.id, 'a later, non-canonical rules run must never be read as the canonical one');
    await pg.close();
  }

  // Preflight normalization: an opportunity that already had two canonical=true rows
  // before 063 (the pre-063 drift bug) converges to exactly one canonical=true row
  // (the newest by created_at, id) when 063 is applied, without deleting or
  // rewriting either historical row's payload.
  {
    const pg = await createDatabase({ applyPromotion: false });
    await pg.query(`
      insert into public.psi_tender_analysis_runs (id, snapshot_id, opportunity_id, tender_id, producer, method, status, result, idempotency_key, schema_version, policy_version, canonical, created_at, completed_at)
      values
        ('55555555-5555-4555-8555-555555555551', '${S}', '${O}', '${T}', 'AGT-002', 'agent_ai', 'completed', '{"summary":"drift-old"}', 'drift-old', 'legacy', 'legacy', true, now() - interval '2 hours', now() - interval '2 hours'),
        ('55555555-5555-4555-8555-555555555552', '${S}', '${O}', '${T}', 'AGT-002', 'agent_ai', 'completed', '{"summary":"drift-new"}', 'drift-new', 'legacy', 'legacy', true, now() - interval '1 hour', now() - interval '1 hour')
    `);
    assert.equal(await canonicalTrueCount(pg), 2, 'fixture must start with the pre-063 drift bug reproduced');

    await pg.exec(migration063);

    assert.equal(await canonicalTrueCount(pg), 1, 'preflight must converge pre-existing drift to exactly one canonical=true row');
    const { rows: keptRows } = await pg.query(`select id, result from public.psi_tender_analysis_runs where opportunity_id = '${O}' and canonical`);
    assert.equal(keptRows[0].id, '55555555-5555-4555-8555-555555555552', 'preflight must keep the newest drifting canonical row');
    const rows = await allRows(pg);
    assert.equal(rows.length, 2, 'preflight must never delete either drifting historical row');
    assert.deepEqual(rows.find(row => row.id === '55555555-5555-4555-8555-555555555551').result, { summary: 'drift-old' }, 'preflight must never rewrite a demoted row\'s payload');
    await pg.close();
  }

  // Apply/apply idempotency: re-running 063 against an already-migrated database
  // must not error and must not change the already-converged canonical state.
  {
    const pg = await createDatabase();
    const first = await promote(pg, { params: { p_idempotency_key: 'canonical-1' } });
    await promote(pg, { params: { p_idempotency_key: 'canonical-2', p_result: { summary: 'Vig-IA v2' } } });
    await pg.exec(migration063);
    assert.equal(await canonicalTrueCount(pg), 1, 'apply/apply must not disturb the already-converged canonical state');
    const rows = await allRows(pg);
    assert.equal(rows.length, 2);
    assert.equal(rows.find(row => row.id === first.id).canonical, false);
    await pg.close();
  }

  // Rollback safety: reverting 063 must not delete any psi_tender_analysis_runs row
  // or rewrite any payload, and must remove the unique index and supersedes_run_id
  // column it added, and restore the original unconditional append-only guard.
  {
    const pg = await createDatabase();
    await promote(pg, { params: { p_idempotency_key: 'canonical-1' } });
    await promote(pg, { params: { p_idempotency_key: 'canonical-2', p_result: { summary: 'Vig-IA v2' } } });
    const before = await allRows(pg);

    await pg.exec(rollback063);

    const after = (await pg.query(`select id, canonical, result, idempotency_key from public.psi_tender_analysis_runs where opportunity_id = '${O}' order by created_at, id`)).rows;
    assert.equal(after.length, before.length, 'rollback must never delete a psi_tender_analysis_runs row');
    for (let i = 0; i < before.length; i += 1) {
      assert.deepEqual(after[i].result, before[i].result, 'rollback must never rewrite a row\'s payload');
      assert.equal(after[i].canonical, before[i].canonical, 'rollback must never change canonical state');
    }
    assert.equal((await pg.query("select count(*)::int n from information_schema.columns where table_name='psi_tender_analysis_runs' and column_name='supersedes_run_id'")).rows[0].n, 0);
    assert.equal((await pg.query("select to_regclass('public.psi_tender_analysis_runs_one_canonical_current_idx') is null removed")).rows[0].removed, true);
    // The original unconditional guard is back: even the previously-allowed
    // true -> false transition is rejected post-rollback.
    await assert.rejects(
      pg.exec(`update public.psi_tender_analysis_runs set canonical = false where opportunity_id = '${O}' and canonical`),
      /append-only/i,
      'post-rollback, canonical true -> false must be rejected again like every other mutation',
    );
    await pg.close();
  }

  console.log('AGT-002 canonical promotion (063) PGlite integration passed');
}
