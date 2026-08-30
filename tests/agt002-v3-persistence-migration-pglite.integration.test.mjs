import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Task 7 (V3 integral persistence, migration layer): migration 067 hardens the
// canonical-run RPC *in place* on top of 063 so a run that self-identifies as the
// integral v3 contract (schema_version = '3.0.0', the exact value emitted by the v3
// runtime) is admitted only when its p_result carries a structurally complete
// integral_analysis (contract_version, coverage object, analysis_units array), its
// coverage.legal_corpus_version_id agrees exactly with the attributable corpus id, and
// no v2 payload can smuggle an integral_analysis under a non-v3 schema_version. A
// truncated/invalid v3 payload is rejected BEFORE any lock, demotion or insert, so it
// can never demote the opportunity's existing canonical run. Everything 063 already
// guarantees — signature, row locking, idempotency, promotion/supersession, grants — is
// preserved byte-for-byte; v2 stays accepted and readable unchanged; the 067 rollback
// restores 063's exact behaviour without touching a single row or undoing 063's own
// column/index. All ids/content below are synthetic; no real expediente.
const strip = value => value.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const migrationSource = name => strip(readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));
const migration050 = migrationSource('050_agt002_canonical_analysis.sql');
const migration051 = migrationSource('051_agt002_context_versions.sql');
const migration053 = migrationSource('053_agt002_legal_corpus.sql');
const migration056 = migrationSource('056_agt002_legal_corpus_publication_gate.sql');
const migration063 = migrationSource('063_agt002_canonical_promotion.sql');

const migration067Url = new URL('../supabase/migrations/067_agt002_integral_v3_persistence.sql', import.meta.url);
const rollback067Url = new URL('../supabase/rollbacks/067_agt002_integral_v3_persistence_rollback.sql', import.meta.url);
const HAS_067 = existsSync(migration067Url) && existsSync(rollback067Url);
const migration067 = HAS_067 ? strip(readFileSync(migration067Url, 'utf8')) : null;
const rollback067 = HAS_067 ? strip(readFileSync(rollback067Url, 'utf8')) : null;
const migration076 = migrationSource('076_agt002_canonical_lock_contention_fix.sql');
const rollback076 = strip(readFileSync(new URL('../supabase/rollbacks/076_agt002_canonical_lock_contention_fix_rollback.sql', import.meta.url), 'utf8'));

// The exact schema_version the v3 runtime emits (agt002-preview-persistence.js /
// agt002-preview-contract.js). 067 keys the whole integral gate off this value.
const V3_SCHEMA_VERSION = '3.0.0';
const V2_SCHEMA_VERSION = '2.0-preview.1';
const V3_CONTRACT_VERSION = 'agt002-integral-analysis-v3';

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

function sqlRpcArgument(name, value) {
  if ((name === 'p_topic' || name === 'p_sector') && Array.isArray(value)) {
    return `array[${value.map(sqlLiteral).join(',')}]::text[]`;
  }
  return sqlLiteral(value);
}

async function callRpc(pg, name, params) {
  const args = Object.entries(params).map(([key, value]) => sqlRpcArgument(key, value)).join(',');
  const result = await pg.query(`select public.${name}(${args}) as data`);
  return result.rows[0]?.data ?? null;
}

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
  await pg.exec(migration063);

  const context = await callRpc(pg, 'psi_record_agt002_context_version', {
    p_opportunity_id: O, p_tender_id: T, p_snapshot_id: S, p_context_version: 2,
    p_context: { snapshot_id: S, human_evidence: [] }, p_context_hash: 'context-hash-1',
    p_human_evidence_count: 0, p_idempotency_key: 'context-key-1', p_actor_id: P,
  });
  pg.contextVersionId = context.id;
  return pg;
}

async function createDatabase({ applyIntegral = true } = {}) {
  const pg = await createBaseDatabase();
  if (applyIntegral && HAS_067) await pg.exec(migration067);
  return pg;
}

// Publishes one synthetic legal corpus version so the coverage-vs-corpus agreement (and
// 056's still-standing published-corpus gate) can be exercised with a real id.
async function publishSyntheticCorpus(pg, { corpusVersion = 'synthetic-corpus-v1' } = {}) {
  const draft = await callRpc(pg, 'psi_create_agt002_legal_corpus_draft', {
    p_corpus_version: corpusVersion, p_description: 'Corpus sintético de prueba', p_actor_id: P, p_based_on_version_id: null,
  });
  await callRpc(pg, 'psi_add_agt002_legal_source', {
    p_corpus_version_id: draft.id, p_source_id: 'ley-80-1993-art-1', p_norm_type: 'ley', p_norm_number: '80',
    p_year: 1993, p_article_or_section: 'Artículo 1', p_current_text: 'Texto sintético de la norma.',
    p_issuing_authority: 'Congreso', p_issued_at: null, p_effective_from: '1993-10-28T00:00:00Z', p_effective_to: null,
    p_modifications: [], p_official_url: 'https://www.funcionpublica.gov.co/norma/ley-80', p_topic: ['contratacion'],
    p_sector: ['publico'], p_verified_at: '2026-01-01T00:00:00Z', p_verification_status: 'verified',
    p_validity_status: 'confirmed', p_applicability_status: 'applicable', p_actor_id: P,
  });
  await callRpc(pg, 'psi_publish_agt002_legal_corpus', {
    p_corpus_version_id: draft.id, p_actor_id: P, p_content_sha256: 'a'.repeat(64),
  });
  return draft.id;
}

// A draft (never published) corpus version — attributing it to a canonical run must
// still be rejected by 056's published-corpus gate, which 067 preserves untouched.
async function createDraftCorpus(pg, { corpusVersion = 'synthetic-draft-v1' } = {}) {
  const draft = await callRpc(pg, 'psi_create_agt002_legal_corpus_draft', {
    p_corpus_version: corpusVersion, p_description: 'Borrador sintético', p_actor_id: P, p_based_on_version_id: null,
  });
  return draft.id;
}

function v2Content(overrides = {}) {
  return {
    recommendation: 'pause', summary: 'Histórico v2 sintético', strengths: [], weaknesses: [],
    blockers: [], questions: [], unverified: [], next_action: 'x', human_review_required: true,
    ...overrides,
  };
}

function integralAnalysis({ legalCorpusVersionId = null, ...overrides } = {}) {
  return {
    contract_version: V3_CONTRACT_VERSION,
    coverage: {
      manifest_version: 'synthetic-manifest-v1',
      expected_requirement_ids: ['req-1'],
      analyzed_requirement_ids: ['req-1'],
      material_omissions: false,
      legal_corpus_version_id: legalCorpusVersionId,
    },
    analysis_units: [{
      unit_id: 'SYNTH-UNIT-1', unit_kind: 'tender_requirement', requirement_id: 'req-1',
      assessment_mode: 'abstained',
    }],
    ...overrides,
  };
}

function v3Content({ legalCorpusVersionId = null, integral, ...v2Overrides } = {}) {
  return {
    ...v2Content(v2Overrides),
    integral_analysis: integral ?? integralAnalysis({ legalCorpusVersionId }),
    ...(legalCorpusVersionId ? { legal_corpus_version_id: legalCorpusVersionId } : {}),
  };
}

function promoteArgs(overrides = {}) {
  return {
    p_snapshot_id: S, p_opportunity_id: O, p_tender_id: T,
    p_result: overrides.p_result ?? { summary: 'Vig-IA' },
    p_critical_open_count: 0,
    p_idempotency_key: 'canonical-1', p_schema_version: V2_SCHEMA_VERSION, p_policy_version: 'policy-1',
    p_model: 'model-1', p_usage: { model: 'model-1', input_tokens: 1, output_tokens: 1 },
    p_context_version_id: overrides.contextVersionId,
    p_legal_corpus_version_id: overrides.p_legal_corpus_version_id ?? null,
    ...overrides.params,
  };
}

async function promote(pg, overrides = {}) {
  return callRpc(pg, 'psi_record_agt002_canonical_analysis_run', promoteArgs({ contextVersionId: pg.contextVersionId, ...overrides }));
}

async function tryPromote(pg, overrides = {}) {
  try {
    return { data: await promote(pg, overrides), error: null };
  } catch (error) {
    return { data: null, error };
  }
}

async function canonicalTrueCount(pg) {
  const { rows } = await pg.query(`select count(*)::int n from public.psi_tender_analysis_runs where opportunity_id = '${O}' and canonical and status = 'completed'`);
  return rows[0].n;
}

async function allRows(pg) {
  const { rows } = await pg.query(`select id, canonical, result, schema_version, supersedes_run_id, idempotency_key from public.psi_tender_analysis_runs where opportunity_id = '${O}' order by created_at, id`);
  return rows;
}

let redFailures = 0;

// --- Behavior-gap block: always runs, even before 067 exists. Under 063 alone a
// truncated v3 payload (schema 3.0.0, integral_analysis missing analysis_units) is
// silently recorded as canonical — the gate 067 introduces. Proven as a real assertion
// failure, not a thrown SQL error. Once 067 exists and is applied, this block is green.
{
  const pg = await createDatabase();
  const truncatedV3 = v3Content({ integral: { contract_version: V3_CONTRACT_VERSION, coverage: { legal_corpus_version_id: null } } });
  const outcome = await tryPromote(pg, { params: { p_idempotency_key: 'v3-truncated', p_schema_version: V3_SCHEMA_VERSION, p_result: truncatedV3 } });
  try {
    assert.ok(outcome.error, 'a truncated V3 payload (schema 3.0.0, integral_analysis without analysis_units) must be rejected, never recorded');
  } catch (error) {
    redFailures += 1;
    console.log(`RED (behavior gap, expected before 067): ${error.message}`);
    if (!HAS_067) {
      assert.ok(outcome.data && outcome.data.id, 'the documented pre-067 gap: 063 records a truncated V3 payload as canonical');
    } else {
      throw error;
    }
  }
  await pg.close();
}

if (!HAS_067) {
  console.log(`AGT-002 V3 persistence migration: 067 not present yet — ran only the behavior-gap RED block (${redFailures} failure(s) demonstrated as expected). Add 067 to run the full GREEN suite.`);
} else {
  assert.equal(redFailures, 0, 'the behavior-gap block must be green once 067 exists and is applied');

  // (1) apply/apply idempotency: re-running 067 against an already-migrated database
  // must not error, and a valid V3 run still records afterward.
  {
    const pg = await createDatabase();
    await pg.exec(migration067);
    const v3 = await promote(pg, { params: { p_idempotency_key: 'v3-after-reapply', p_schema_version: V3_SCHEMA_VERSION, p_result: v3Content() } });
    assert.equal(v3.canonical, true, 'a valid V3 run must still record after re-applying 067');
    await pg.close();
  }

  // (2) V2 stays accepted and readable, byte-for-byte, exactly as under 063.
  {
    const pg = await createDatabase();
    const content = v2Content();
    const v2 = await promote(pg, { params: { p_idempotency_key: 'v2-only', p_schema_version: V2_SCHEMA_VERSION, p_result: content } });
    assert.equal(v2.canonical, true);
    const rows = await allRows(pg);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].schema_version, V2_SCHEMA_VERSION);
    assert.deepEqual(rows[0].result, content, 'the V2 payload must be stored and readable unchanged');
    await pg.close();
  }

  // (3) A valid V3 run is accepted, persists its integral_analysis, and supersedes the
  // opportunity's previous canonical V2 in place (recording supersedes_run_id).
  {
    const pg = await createDatabase();
    const v2 = await promote(pg, { params: { p_idempotency_key: 'v2-historical', p_schema_version: V2_SCHEMA_VERSION, p_result: v2Content() } });
    const v3Payload = v3Content();
    const v3 = await promote(pg, { params: { p_idempotency_key: 'v3-current', p_schema_version: V3_SCHEMA_VERSION, p_result: v3Payload } });
    assert.notEqual(v3.id, v2.id);
    assert.equal(v3.canonical, true);
    assert.equal(v3.supersedes_run_id, v2.id, 'the V3 run must record exactly which run it superseded');
    assert.equal(await canonicalTrueCount(pg), 1, 'exactly one canonical run may remain after a V3 supersedes a V2');

    const rows = await allRows(pg);
    assert.equal(rows.length, 2, 'promotion must never delete history');
    const v2Row = rows.find(row => row.id === v2.id);
    const v3Row = rows.find(row => row.id === v3.id);
    assert.equal(v2Row.canonical, false, 'the historical V2 must be demoted, never deleted');
    assert.deepEqual(v2Row.result, v2Content(), 'the historical V2 payload must never be rewritten');
    assert.equal(v3Row.canonical, true);
    assert.equal(v3Row.schema_version, V3_SCHEMA_VERSION);
    assert.deepEqual(v3Row.result.integral_analysis, v3Payload.integral_analysis, 'the V3 run must persist its integral_analysis');
    await pg.close();
  }

  // (4) A malformed V3 payload is rejected BEFORE any supersession: the existing
  // canonical V2 must stay canonical, and no partial row may be inserted.
  {
    const pg = await createDatabase();
    const v2 = await promote(pg, { params: { p_idempotency_key: 'v2-guarded', p_schema_version: V2_SCHEMA_VERSION, p_result: v2Content() } });

    const malformed = [
      // integral_analysis missing entirely under a 3.0.0 schema.
      { key: 'v3-no-ia', result: { ...v2Content() }, match: /integral V3|analysis_units/i },
      // coverage missing.
      { key: 'v3-no-coverage', result: v3Content({ integral: { contract_version: V3_CONTRACT_VERSION, analysis_units: [] } }), match: /integral V3|coverage/i },
      // analysis_units present but not an array.
      { key: 'v3-units-object', result: v3Content({ integral: { contract_version: V3_CONTRACT_VERSION, coverage: { legal_corpus_version_id: null }, analysis_units: {} } }), match: /integral V3|analysis_units/i },
      // wrong contract_version.
      { key: 'v3-bad-contract', result: v3Content({ integral: { contract_version: 'agt002-integral-analysis-v2', coverage: { legal_corpus_version_id: null }, analysis_units: [] } }), match: /integral V3|contract_version/i },
    ];
    for (const scenario of malformed) {
      await assert.rejects(
        promote(pg, { params: { p_idempotency_key: scenario.key, p_schema_version: V3_SCHEMA_VERSION, p_result: scenario.result } }),
        scenario.match,
        `malformed V3 payload (${scenario.key}) must be rejected`,
      );
    }

    assert.equal(await canonicalTrueCount(pg), 1, 'a rejected malformed V3 must never demote the previous canonical');
    const rows = await allRows(pg);
    assert.equal(rows.length, 1, 'a rejected malformed V3 must never insert a partial row');
    assert.equal(rows[0].id, v2.id);
    assert.equal(rows[0].canonical, true, 'the previous canonical V2 must survive a rejected V3 unchanged');
    await pg.close();
  }

  // (5) A V2 payload may never smuggle an integral_analysis under a non-v3 schema.
  {
    const pg = await createDatabase();
    await assert.rejects(
      promote(pg, { params: { p_idempotency_key: 'v2-smuggle', p_schema_version: V2_SCHEMA_VERSION, p_result: v3Content() } }),
      /integral_analysis.*schema_version 3\.0\.0/i,
      'an integral_analysis under a V2 schema_version must be rejected',
    );
    assert.equal((await allRows(pg)).length, 0, 'a smuggled V2+integral_analysis payload must never be recorded');
    await pg.close();
  }

  // (6) coverage.legal_corpus_version_id must agree exactly with the attributable corpus
  // id, and 056's published-corpus gate is preserved.
  {
    const pg = await createDatabase();
    const corpusId = await publishSyntheticCorpus(pg);

    // null / null -> accepted.
    const nullRun = await promote(pg, { params: { p_idempotency_key: 'v3-corpus-null', p_schema_version: V3_SCHEMA_VERSION, p_result: v3Content() } });
    assert.equal(nullRun.canonical, true, 'coverage null with no corpus id must be accepted');

    // supplied id, coverage carries the exact same id as text -> accepted (supersedes).
    const matchRun = await promote(pg, {
      p_legal_corpus_version_id: corpusId,
      params: { p_idempotency_key: 'v3-corpus-match', p_schema_version: V3_SCHEMA_VERSION, p_result: v3Content({ legalCorpusVersionId: corpusId }) },
    });
    assert.equal(matchRun.canonical, true, 'a coverage id equal to the supplied corpus id must be accepted');
    assert.equal(matchRun.legal_corpus_version_id, corpusId);

    // supplied id, but coverage says null -> rejected.
    await assert.rejects(
      promote(pg, {
        p_legal_corpus_version_id: corpusId,
        params: { p_idempotency_key: 'v3-corpus-null-mismatch', p_schema_version: V3_SCHEMA_VERSION, p_result: v3Content({ integral: integralAnalysis({ legalCorpusVersionId: null }) }) },
      }),
      /coincidir exactamente/i,
      'a null coverage id under a supplied corpus id must be rejected',
    );

    // no corpus id supplied, but coverage carries one -> rejected.
    await assert.rejects(
      promote(pg, {
        params: { p_idempotency_key: 'v3-corpus-orphan', p_schema_version: V3_SCHEMA_VERSION, p_result: v3Content({ integral: integralAnalysis({ legalCorpusVersionId: corpusId }) }) },
      }),
      /debe ser null/i,
      'a coverage id without a supplied corpus id must be rejected',
    );

    // 056 published-corpus gate preserved: a draft corpus id can never be attributed,
    // even with a coverage id that matches it textually.
    const draftId = await createDraftCorpus(pg);
    await assert.rejects(
      promote(pg, {
        p_legal_corpus_version_id: draftId,
        params: { p_idempotency_key: 'v3-corpus-draft', p_schema_version: V3_SCHEMA_VERSION, p_result: v3Content({ legalCorpusVersionId: draftId }) },
      }),
      /publicada/i,
      '056 published-corpus gate must still reject a draft corpus attribution',
    );

    // Only the last accepted run stays canonical.
    assert.equal(await canonicalTrueCount(pg), 1);
    await pg.close();
  }

  // (7) Replays preserve exact semantics; a conflicting payload under the same key fails.
  {
    const pg = await createDatabase();
    const payload = v3Content();
    const first = await promote(pg, { params: { p_idempotency_key: 'v3-replay', p_schema_version: V3_SCHEMA_VERSION, p_result: payload } });
    const replay = await promote(pg, { params: { p_idempotency_key: 'v3-replay', p_schema_version: V3_SCHEMA_VERSION, p_result: payload } });
    assert.equal(replay.id, first.id, 'an exact V3 replay must return the same run');
    assert.equal((await allRows(pg)).length, 1, 'a replay must never insert a duplicate');
    assert.equal(await canonicalTrueCount(pg), 1, 'a replay must never create a second canonical row');

    await assert.rejects(
      promote(pg, { params: { p_idempotency_key: 'v3-replay', p_schema_version: V3_SCHEMA_VERSION, p_result: v3Content({ summary: 'payload distinto' }) } }),
      /idempotencia/i,
      'a conflicting payload under an existing key must be rejected',
    );
    await pg.close();
  }

  // (8) Rollback restores 063 exactly: no row is touched, 063's supersedes_run_id column
  // and unique index survive, and the 067 gate is gone (a truncated V3 records again).
  {
    const pg = await createDatabase();
    const v2 = await promote(pg, { params: { p_idempotency_key: 'v2-pre-rollback', p_schema_version: V2_SCHEMA_VERSION, p_result: v2Content() } });
    const v3 = await promote(pg, { params: { p_idempotency_key: 'v3-pre-rollback', p_schema_version: V3_SCHEMA_VERSION, p_result: v3Content() } });
    const before = await allRows(pg);

    await pg.exec(rollback067);

    const after = await allRows(pg);
    assert.equal(after.length, before.length, 'rollback must never delete a row');
    for (let i = 0; i < before.length; i += 1) {
      assert.deepEqual(after[i].result, before[i].result, 'rollback must never rewrite a payload');
      assert.equal(after[i].canonical, before[i].canonical, 'rollback must never change canonical state');
      assert.equal(after[i].supersedes_run_id, before[i].supersedes_run_id, 'rollback must never touch supersedes_run_id');
    }
    // 063's own column and index must survive the 067 rollback.
    assert.equal((await pg.query("select count(*)::int n from information_schema.columns where table_name='psi_tender_analysis_runs' and column_name='supersedes_run_id'")).rows[0].n, 1, 'the 067 rollback must keep 063\'s supersedes_run_id column');
    assert.equal((await pg.query("select to_regclass('public.psi_tender_analysis_runs_one_canonical_current_idx') is not null present")).rows[0].present, true, 'the 067 rollback must keep 063\'s unique index');

    // The 067 gate is gone: a truncated V3 payload records again exactly as under 063,
    // and it supersedes the current canonical in place (063 promotion still intact).
    const truncated = await promote(pg, { params: { p_idempotency_key: 'v3-truncated-post-rollback', p_schema_version: V3_SCHEMA_VERSION, p_result: v3Content({ integral: { contract_version: V3_CONTRACT_VERSION, coverage: { legal_corpus_version_id: null } } }) } });
    assert.ok(truncated.id, 'post-rollback, 063 records a truncated V3 payload (the gate is gone)');
    assert.equal(truncated.supersedes_run_id, v3.id, 'post-rollback, 063 promotion/supersession is intact');
    assert.equal(await canonicalTrueCount(pg), 1);
    assert.equal(v2 !== undefined && v3 !== undefined, true);
    await pg.close();
  }

  // (9) 076 is additive at the RPC level: apply/re-apply preserves V3 validation,
  // idempotent replay and canonical supersession; rollback changes no persisted row and
  // restores 067 while leaving the V3 gate active.
  {
    const pg = await createDatabase();
    await pg.exec(migration076);
    await pg.exec(migration076);

    const v2 = await promote(pg, { params: { p_idempotency_key: 'v2-under-076', p_schema_version: V2_SCHEMA_VERSION, p_result: v2Content() } });
    const payload = v3Content();
    const v3 = await promote(pg, { params: { p_idempotency_key: 'v3-under-076', p_schema_version: V3_SCHEMA_VERSION, p_result: payload } });
    const replay = await promote(pg, { params: { p_idempotency_key: 'v3-under-076', p_schema_version: V3_SCHEMA_VERSION, p_result: payload } });
    assert.equal(replay.id, v3.id, '076 must preserve exact idempotent replay');
    assert.equal(v3.supersedes_run_id, v2.id, '076 must preserve canonical supersession');
    assert.equal(await canonicalTrueCount(pg), 1);
    await assert.rejects(
      promote(pg, { params: { p_idempotency_key: 'v3-truncated-under-076', p_schema_version: V3_SCHEMA_VERSION, p_result: v3Content({ integral: { contract_version: V3_CONTRACT_VERSION, coverage: { legal_corpus_version_id: null } } }) } }),
      /integral V3|analysis_units/i,
      '076 must preserve the 067 V3 fail-closed gate',
    );

    const before = await allRows(pg);
    await pg.exec(rollback076);
    const after = await allRows(pg);
    assert.deepEqual(after, before, '076 rollback must not mutate persisted runs');
    const afterRollback = await promote(pg, { params: { p_idempotency_key: 'v3-after-076-rollback', p_schema_version: V3_SCHEMA_VERSION, p_result: v3Content({ summary: '067 restored' }) } });
    assert.equal(afterRollback.supersedes_run_id, v3.id, '076 rollback must restore 067 canonical promotion');
    assert.equal(await canonicalTrueCount(pg), 1);
    await pg.close();
  }

  console.log('AGT-002 V3 persistence migration (067 + 076 lock fix) PGlite integration passed');
}
