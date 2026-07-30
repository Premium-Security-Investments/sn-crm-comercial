import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { buildAtomicApplySql, buildStateSql, classifyState, getSpec } from '../scripts/agt002-program-migrations.mjs';

const strip = value => value.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const migration050 = strip(readFileSync(new URL('../supabase/migrations/050_agt002_canonical_analysis.sql', import.meta.url), 'utf8'));
const migration051 = strip(readFileSync(new URL('../supabase/migrations/051_agt002_context_versions.sql', import.meta.url), 'utf8'));
const migration038 = strip(readFileSync(new URL('../supabase/migrations/038_tender_question_responses.sql', import.meta.url), 'utf8'));
const migration053 = strip(readFileSync(new URL('../supabase/migrations/053_agt002_legal_corpus.sql', import.meta.url), 'utf8'));

const P = '44444444-4444-4444-8444-444444444444';
const O = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';
const S = '33333333-3333-4333-8333-333333333333';

// A plain JS array is ambiguous between a Postgres text[] (topic/sector tags)
// and a jsonb array (modifications), so jsonb values must be explicitly
// tagged; only a tagged value is ever cast to ::jsonb.
function jsonbArg(value) {
  return { __jsonb: true, value };
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `ARRAY[${value.map(v => `'${String(v).replace(/'/g, "''")}'`).join(',')}]::text[]`;
  if (typeof value === 'object' && value.__jsonb) return `'${JSON.stringify(value.value).replace(/'/g, "''")}'::jsonb`;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function callRpc(pg, name, args) {
  const literal = args.map(sqlLiteral).join(',');
  const result = await pg.query(`select public.${name}(${literal}) as data`);
  return result.rows[0]?.data ?? null;
}

async function createDatabase() {
  const pg = new PGlite();
  await pg.exec(`
    create role authenticated; create role service_role; create role anon;
    alter role service_role bypassrls;
    grant service_role to current_user;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
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
    -- Mirrors the real 025 append-only guard on psi_tender_analysis_runs: this test
    -- exercises a direct UPDATE against the new legal_corpus_version_id column, so the
    -- minimal foundation must reproduce the production trigger it would run against.
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
  await pg.exec(buildAtomicApplySql('050', migration050));
  await pg.exec(migration038);
  await pg.exec(buildAtomicApplySql('051', migration051));
  await pg.exec(buildAtomicApplySql('053', migration053));
  for (const id of ['050', '051', '053']) {
    const state = (await pg.query(buildStateSql(id))).rows[0];
    let markerEvidence = [];
    if (classifyState(state) !== 'applied') {
      markerEvidence = await Promise.all(getSpec(id).markers.map(async (expression, index) => ({
        index, ok: (await pg.query(`select (${expression}) as ok`)).rows[0].ok,
      })));
    }
    assert.equal(classifyState(state), 'applied', `runner state ${id} debe reconocer las definiciones reales post-migración: ${JSON.stringify({ state, markerEvidence })}`);
  }
  const context = await callRpc(pg, 'psi_record_agt002_context_version', [
    O, T, S, 2, jsonbArg({ snapshot_id: S, human_evidence: [] }), 'context-hash-1', 0, 'context-key-1', P,
  ]);
  pg.contextVersionId = context.id;
  return pg;
}

function validSourceArgs(overrides = {}) {
  return {
    corpusVersionId: null,
    sourceId: 'ley-80-1993-art-2',
    normType: 'Ley', normNumber: '80', year: 1993, articleOrSection: 'Artículo 2',
    currentText: 'Texto vigente de la norma sobre modalidades de selección.',
    issuingAuthority: 'Congreso de la República',
    issuedAt: '1993-10-28T00:00:00.000Z', effectiveFrom: '1993-10-28T00:00:00.000Z', effectiveTo: null,
    modifications: [],
    officialUrl: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=304',
    topic: ['contratacion_estatal'], sector: ['vigilancia_privada'],
    verifiedAt: '2026-07-29T00:00:00.000Z',
    verificationStatus: 'verified', validityStatus: 'confirmed', applicabilityStatus: 'applicable',
    actorId: P,
    ...overrides,
  };
}

async function addSource(pg, overrides = {}) {
  const a = validSourceArgs(overrides);
  return callRpc(pg, 'psi_add_agt002_legal_source', [
    a.corpusVersionId, a.sourceId, a.normType, a.normNumber, a.year, a.articleOrSection, a.currentText,
    a.issuingAuthority, a.issuedAt, a.effectiveFrom, a.effectiveTo, jsonbArg(a.modifications), a.officialUrl,
    a.topic, a.sector, a.verifiedAt, a.verificationStatus, a.validityStatus, a.applicabilityStatus, a.actorId,
  ]);
}

async function createDraft(pg, corpusVersion, description, actorId = P, basedOn = null) {
  return callRpc(pg, 'psi_create_agt002_legal_corpus_draft', [corpusVersion, description, actorId, basedOn]);
}

async function publish(pg, corpusVersionId, actorId = P) {
  return callRpc(pg, 'psi_publish_agt002_legal_corpus', [corpusVersionId, actorId]);
}

// --- Full lifecycle: draft -> add source -> publish -------------------------
await (async function draftAddSourcePublishLifecycle() {
  const pg = await createDatabase();

  const draft = await createDraft(pg, 'legal-corpus-v1', 'Corpus normativo inicial para contratación y vigilancia privada.');
  assert.equal(draft.status, 'draft');
  assert.equal(draft.corpus_version, 'legal-corpus-v1');

  const source = await addSource(pg, { corpusVersionId: draft.id });
  assert.equal(source.corpus_version_id, draft.id);
  assert.equal(source.verification_status, 'verified');

  const published = await publish(pg, draft.id);
  assert.equal(published.status, 'published');
  assert.ok(published.published_at);
  assert.equal(published.published_by, P);

  await pg.close();
})();

// --- Published version (and its sources) become mechanically immutable ------
await (async function publishedVersionIsImmutable() {
  const pg = await createDatabase();
  const draft = await createDraft(pg, 'legal-corpus-v1', 'Corpus inicial.');
  const source = await addSource(pg, { corpusVersionId: draft.id });
  const published = await publish(pg, draft.id);

  // Direct UPDATE/DELETE on the version row are rejected.
  await assert.rejects(pg.exec(`update public.psi_agt002_legal_corpus_versions set description = 'mutado' where id = '${published.id}'`), /inmutable/i);
  await assert.rejects(pg.exec(`delete from public.psi_agt002_legal_corpus_versions where id = '${published.id}'`), /append-only/i);

  // Direct UPDATE/DELETE on a published version's sources are rejected too.
  await assert.rejects(pg.exec(`update public.psi_agt002_legal_sources set current_text = 'mutado' where id = '${source.id}'`), /append-only/i);
  await assert.rejects(pg.exec(`delete from public.psi_agt002_legal_sources where id = '${source.id}'`), /append-only/i);

  // Calling the publish RPC again on an already-published version fails.
  await assert.rejects(publish(pg, published.id), /ya está publicada/i);

  // Adding a new source to a published version fails, both via the RPC guard
  // and (defense in depth) at the storage layer if attempted directly.
  await assert.rejects(
    addSource(pg, { corpusVersionId: published.id, sourceId: 'ley-1150-2007-art-2', officialUrl: 'https://www.suin-juriscol.gov.co/viewDocument.asp?id=1', topic: ['modalidades_seleccion'], sector: ['vigilancia_privada'] }),
    /publicada/i,
  );

  await pg.close();
})();

// --- Content revision creates a new draft/version; the prior one is intact --
await (async function contentRevisionCreatesNewVersionWithoutMutatingThePrior() {
  const pg = await createDatabase();
  const draft1 = await createDraft(pg, 'legal-corpus-v1', 'Corpus inicial.');
  const source1 = await addSource(pg, { corpusVersionId: draft1.id });
  const published1 = await publish(pg, draft1.id);

  // A revision clones the published version into a brand-new draft with a new
  // identity/semantic version, carrying its sources forward unmodified.
  const draft2 = await createDraft(pg, 'legal-corpus-v2', 'Revisión: se agrega una fuente adicional.', P, published1.id);
  assert.notEqual(draft2.id, published1.id);
  assert.equal(draft2.status, 'draft');
  assert.equal(draft2.based_on_version_id, published1.id);
  assert.equal(draft2.cloned_sources, 1);

  const clonedSourceRow = (await pg.query(
    `select id, source_id, current_text from public.psi_agt002_legal_sources where corpus_version_id = '${draft2.id}'`,
  )).rows[0];
  assert.equal(clonedSourceRow.source_id, 'ley-80-1993-art-2');
  assert.notEqual(clonedSourceRow.id, source1.id);

  // Add a new source only to the draft revision, then publish it.
  await addSource(pg, {
    corpusVersionId: draft2.id, sourceId: 'ley-1150-2007-art-2', normNumber: '1150', year: 2007,
    officialUrl: 'https://www.suin-juriscol.gov.co/viewDocument.asp?id=1', topic: ['modalidades_seleccion'], sector: ['vigilancia_privada'],
  });
  const published2 = await publish(pg, draft2.id);
  assert.equal(published2.status, 'published');

  // v1 is completely untouched: same status, same single source, same content.
  const rereadV1 = (await pg.query(`select status, description from public.psi_agt002_legal_corpus_versions where id = '${published1.id}'`)).rows[0];
  assert.equal(rereadV1.status, 'published');
  assert.equal(rereadV1.description, 'Corpus inicial.');
  const v1SourceCount = Number((await pg.query(`select count(*)::int as count from public.psi_agt002_legal_sources where corpus_version_id = '${published1.id}'`)).rows[0].count);
  assert.equal(v1SourceCount, 1);
  const v2SourceCount = Number((await pg.query(`select count(*)::int as count from public.psi_agt002_legal_sources where corpus_version_id = '${published2.id}'`)).rows[0].count);
  assert.equal(v2SourceCount, 2);

  await pg.close();
})();

// --- A run references exactly one corpus version; FK rejects nonexistent ----
await (async function runReferencesExactCorpusVersionAndFkRejectsUnknown() {
  const pg = await createDatabase();
  const draft = await createDraft(pg, 'legal-corpus-v1', 'Corpus inicial.');
  await addSource(pg, { corpusVersionId: draft.id });
  const published = await publish(pg, draft.id);

  const run = (await pg.query(`select public.psi_record_agt002_canonical_analysis_run(
    '${S}','${O}','${T}','{"summary":"Vig-IA con corpus v1"}'::jsonb,0,'run-with-corpus','schema-1','policy-1','model-1',null,'${pg.contextVersionId}','${published.id}'
  ) r`)).rows[0].r;
  assert.equal(run.legal_corpus_version_id, published.id);

  const bogus = '99999999-9999-4999-8999-999999999999';
  await assert.rejects(pg.query(`select public.psi_record_agt002_canonical_analysis_run(
    '${S}','${O}','${T}','{"summary":"x"}'::jsonb,0,'run-bad-corpus','schema-1','policy-1',null,null,'${pg.contextVersionId}','${bogus}'
  )`), /no existe/i);

  // Historical/legacy runs recorded before this migration (or without a corpus
  // reference) keep the column null; nothing about them changes.
  const legacyRun = (await pg.query(`select public.psi_record_agt002_canonical_analysis_run(
    '${S}','${O}','${T}','{"summary":"sin corpus"}'::jsonb,0,'run-no-corpus','schema-1','policy-1',null,null,'${pg.contextVersionId}',null
  ) r`)).rows[0].r;
  assert.equal(legacyRun.legal_corpus_version_id, null);

  // A run is append-only: its stored corpus reference cannot be rewritten afterwards.
  await assert.rejects(pg.exec(`update public.psi_tender_analysis_runs set legal_corpus_version_id = '${published.id}' where idempotency_key = 'run-no-corpus'`), /append-only/i);

  await pg.close();
})();

// --- source_id/version uniqueness and closed constraints ---------------------
await (async function uniquenessAndClosedConstraintsHold() {
  const pg = await createDatabase();
  const draft = await createDraft(pg, 'legal-corpus-v1', 'Corpus inicial.');
  await addSource(pg, { corpusVersionId: draft.id });

  // Same source_id, different content, in the same version: rejected as a conflict.
  await assert.rejects(
    addSource(pg, { corpusVersionId: draft.id, currentText: 'Texto distinto y en conflicto.' }),
    /ya pertenece a otro/i,
  );

  // Re-submitting the exact same source is idempotent (same row returned).
  const again = await addSource(pg, { corpusVersionId: draft.id });
  const original = (await pg.query(`select id from public.psi_agt002_legal_sources where corpus_version_id = '${draft.id}' and source_id = 'ley-80-1993-art-2'`)).rows[0];
  assert.equal(again.id, original.id);

  // Non-HTTPS / non-official-host URLs are rejected.
  await assert.rejects(
    addSource(pg, { corpusVersionId: draft.id, sourceId: 'x-1', officialUrl: 'http://www.funcionpublica.gov.co/eva/x' }),
    /https|oficial/i,
  );
  await assert.rejects(
    addSource(pg, { corpusVersionId: draft.id, sourceId: 'x-2', officialUrl: 'https://www.evil.example.com/x' }),
    /https|oficial/i,
  );

  // Invalid enum values are rejected.
  await assert.rejects(
    addSource(pg, { corpusVersionId: draft.id, sourceId: 'x-3', verificationStatus: 'not-a-status' }),
    /verification_status/i,
  );
  await assert.rejects(
    addSource(pg, { corpusVersionId: draft.id, sourceId: 'x-4', applicabilityStatus: 'bogus' }),
    /applicability_status/i,
  );

  // Incoherent dates are rejected: effective_to must be after effective_from.
  await assert.rejects(
    addSource(pg, {
      corpusVersionId: draft.id, sourceId: 'x-5',
      effectiveFrom: '2020-01-01T00:00:00.000Z', effectiveTo: '2019-01-01T00:00:00.000Z',
    }),
    /effective_to/i,
  );

  // validity_status confirmed requires effective_from.
  await assert.rejects(
    addSource(pg, { corpusVersionId: draft.id, sourceId: 'x-6', effectiveFrom: null }),
    /effective_from/i,
  );

  await pg.close();
})();

// --- public/anon/authenticated cannot mutate; only service_role can via RPC -
await (async function rlsAndGrantsFailClosed() {
  const pg = await createDatabase();
  const draft = await createDraft(pg, 'legal-corpus-v1', 'Corpus inicial.');
  await addSource(pg, { corpusVersionId: draft.id });
  await publish(pg, draft.id);

  await pg.exec('set role authenticated');
  await assert.rejects(() => pg.query('select id from public.psi_agt002_legal_corpus_versions limit 1'), /permission denied/i);
  await assert.rejects(() => pg.query('select id from public.psi_agt002_legal_sources limit 1'), /permission denied/i);
  await assert.rejects(() => pg.query(`select public.psi_create_agt002_legal_corpus_draft('x','x','${P}',null)`), /permission denied/i);
  await pg.exec('reset role; set role anon');
  await assert.rejects(() => pg.query('select id from public.psi_agt002_legal_corpus_versions limit 1'), /permission denied/i);
  await assert.rejects(() => pg.query(`select public.psi_create_agt002_legal_corpus_draft('x','x','${P}',null)`), /permission denied/i);
  await pg.exec('reset role; set role service_role');
  const asServiceRole = await pg.query('select id from public.psi_agt002_legal_corpus_versions limit 1');
  assert.ok(asServiceRole.rows.length >= 0);
  await assert.rejects(
    () => pg.query(`insert into public.psi_agt002_legal_corpus_versions (corpus_version, description, created_by) values ('direct-insert', 'x', '${P}')`),
    /permission denied/i,
  );
  await pg.exec('reset role');

  await pg.close();
})();

console.log('AGT-002 legal corpus PGlite integration passed');
