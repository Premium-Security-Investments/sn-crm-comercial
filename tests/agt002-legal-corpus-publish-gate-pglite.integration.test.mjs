import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { buildAtomicApplySql, buildStateSql, classifyState, getSpec } from '../scripts/agt002-program-migrations.mjs';

const strip = value => value.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const migration050 = strip(readFileSync(new URL('../supabase/migrations/050_agt002_canonical_analysis.sql', import.meta.url), 'utf8'));
const migration051 = strip(readFileSync(new URL('../supabase/migrations/051_agt002_context_versions.sql', import.meta.url), 'utf8'));
const migration038 = strip(readFileSync(new URL('../supabase/migrations/038_tender_question_responses.sql', import.meta.url), 'utf8'));
const migration053 = strip(readFileSync(new URL('../supabase/migrations/053_agt002_legal_corpus.sql', import.meta.url), 'utf8'));
const migration056 = strip(readFileSync(new URL('../supabase/migrations/056_agt002_legal_corpus_publication_gate.sql', import.meta.url), 'utf8'));

const P = '44444444-4444-4444-8444-444444444444'; // human actor
const AGENT = '66666666-6666-4666-8666-666666666666'; // agent actor — never authorized to publish
const O = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';
const S = '33333333-3333-4333-8333-333333333333';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

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
    insert into public.psi_sales_profiles values ('${AGENT}', true, 'agent', 'Vig-IA Agente');
    insert into public.psi_sales_opportunities values ('${O}');
    insert into public.psi_public_tenders values ('${T}');
    insert into public.psi_tender_document_snapshots values ('${S}','${O}','${T}');
  `);
  await pg.exec(buildAtomicApplySql('050', migration050));
  await pg.exec(migration038);
  await pg.exec(buildAtomicApplySql('051', migration051));
  await pg.exec(buildAtomicApplySql('053', migration053));
  await pg.exec(buildAtomicApplySql('056', migration056));
  for (const id of ['050', '051', '053', '056']) {
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

async function publish(pg, corpusVersionId, actorId = P, contentSha256 = HASH_A) {
  return callRpc(pg, 'psi_publish_agt002_legal_corpus', [corpusVersionId, actorId, contentSha256]);
}

// --- An agent identity can curate drafts/sources but can never publish -------
await (async function agentCannotPublish() {
  const pg = await createDatabase();
  const draft = await createDraft(pg, 'legal-corpus-v1', 'Corpus inicial.');
  await addSource(pg, { corpusVersionId: draft.id });
  await assert.rejects(publish(pg, draft.id, AGENT, HASH_A), /humano/i);

  const reread = (await pg.query(`select status from public.psi_agt002_legal_corpus_versions where id = '${draft.id}'`)).rows[0];
  assert.equal(reread.status, 'draft');

  await pg.close();
})();

// --- A corpus with only uncertain sources (none verified+confirmed+applicable) cannot publish --
await (async function allUncertainCorpusCannotPublish() {
  const pg = await createDatabase();
  const draft = await createDraft(pg, 'legal-corpus-v1', 'Corpus inicial.');
  await addSource(pg, {
    corpusVersionId: draft.id,
    verificationStatus: 'unverified', validityStatus: 'uncertain', applicabilityStatus: 'uncertain',
    effectiveFrom: null,
  });
  await assert.rejects(publish(pg, draft.id, P, HASH_A), /verified.*confirmed.*applicable|al menos una fuente/i);
  await pg.close();
})();

// --- Missing/invalid content hash cannot publish ------------------------------
await (async function missingOrInvalidHashCannotPublish() {
  const pg = await createDatabase();
  const draft = await createDraft(pg, 'legal-corpus-v1', 'Corpus inicial.');
  await addSource(pg, { corpusVersionId: draft.id });

  await assert.rejects(publish(pg, draft.id, P, null), /sha-256/i);
  await assert.rejects(publish(pg, draft.id, P, 'not-a-hash'), /sha-256/i);
  await assert.rejects(publish(pg, draft.id, P, 'A'.repeat(64)), /sha-256/i);
  await assert.rejects(publish(pg, draft.id, P, 'a'.repeat(63)), /sha-256/i);

  const reread = (await pg.query(`select status, content_sha256 from public.psi_agt002_legal_corpus_versions where id = '${draft.id}'`)).rows[0];
  assert.equal(reread.status, 'draft');
  assert.equal(reread.content_sha256, null);

  await pg.close();
})();

// --- A human can publish a draft that has at least one eligible source -------
await (async function humanCanPublishWithEligibleSource() {
  const pg = await createDatabase();
  const draft = await createDraft(pg, 'legal-corpus-v1', 'Corpus inicial.');
  await addSource(pg, { corpusVersionId: draft.id });
  const published = await publish(pg, draft.id, P, HASH_A);
  assert.equal(published.status, 'published');
  assert.equal(published.content_sha256, HASH_A);
  assert.equal(published.superseded_version_id, null);
  assert.ok(published.published_at);
  assert.equal(published.published_by, P);

  // The DB-level unique partial index guarantees at most one published version.
  const publishedRows = (await pg.query(`select id from public.psi_agt002_legal_corpus_versions where status = 'published'`)).rows;
  assert.equal(publishedRows.length, 1);

  await pg.close();
})();

// --- Publishing a second version atomically supersedes the first -------------
await (async function publishingSecondSupersedesFirst() {
  const pg = await createDatabase();
  const draftA = await createDraft(pg, 'legal-corpus-v1', 'Corpus A.');
  await addSource(pg, { corpusVersionId: draftA.id });
  const publishedA = await publish(pg, draftA.id, P, HASH_A);

  const draftB = await createDraft(pg, 'legal-corpus-v2', 'Corpus B.', P, publishedA.id);
  const publishedB = await publish(pg, draftB.id, P, HASH_B);
  assert.equal(publishedB.status, 'published');
  assert.equal(publishedB.superseded_version_id, publishedA.id);

  const rows = (await pg.query(
    `select id, status, superseded_at, superseded_by_version_id from public.psi_agt002_legal_corpus_versions order by created_at`,
  )).rows;
  const publishedRows = rows.filter(row => row.status === 'published');
  assert.equal(publishedRows.length, 1);
  assert.equal(publishedRows[0].id, publishedB.id);

  const supersededRow = rows.find(row => row.id === publishedA.id);
  assert.equal(supersededRow.status, 'superseded');
  assert.ok(supersededRow.superseded_at);
  assert.equal(supersededRow.superseded_by_version_id, publishedB.id);

  // A superseded version stays mechanically immutable, exactly like a published one.
  await assert.rejects(pg.exec(`update public.psi_agt002_legal_corpus_versions set description = 'mutado' where id = '${publishedA.id}'`), /inmutable/i);
  await assert.rejects(pg.exec(`delete from public.psi_agt002_legal_corpus_versions where id = '${publishedA.id}'`), /append-only/i);

  // Publishing an already-superseded version again is rejected.
  await assert.rejects(publish(pg, publishedA.id, P, HASH_A), /reemplazada|superseded|ya está publicada/i);

  await pg.close();
})();

// --- The canonical-run RPC accepts only a currently published corpus reference --
await (async function canonicalRunRejectsDraftOrSupersededCorpus() {
  const pg = await createDatabase();
  const draftA = await createDraft(pg, 'legal-corpus-v1', 'Corpus A.');
  await addSource(pg, { corpusVersionId: draftA.id });
  const publishedA = await publish(pg, draftA.id, P, HASH_A);

  const draftOnly = await createDraft(pg, 'legal-corpus-draft-only', 'Draft sin publicar.');
  await addSource(pg, { corpusVersionId: draftOnly.id, sourceId: 'x-draft' });

  await assert.rejects(pg.query(`select public.psi_record_agt002_canonical_analysis_run(
    '${S}','${O}','${T}','{"summary":"x"}'::jsonb,0,'run-draft-corpus','schema-1','policy-1',null,null,'${pg.contextVersionId}','${draftOnly.id}'
  )`), /publicada/i);

  const draftB = await createDraft(pg, 'legal-corpus-v2', 'Corpus B.', P, publishedA.id);
  const publishedB = await publish(pg, draftB.id, P, HASH_B);

  // A now superseded.
  await assert.rejects(pg.query(`select public.psi_record_agt002_canonical_analysis_run(
    '${S}','${O}','${T}','{"summary":"x"}'::jsonb,0,'run-superseded-corpus','schema-1','policy-1',null,null,'${pg.contextVersionId}','${publishedA.id}'
  )`), /publicada/i);

  // B (currently published) is accepted.
  const run = (await pg.query(`select public.psi_record_agt002_canonical_analysis_run(
    '${S}','${O}','${T}','{"summary":"Vig-IA con corpus v2"}'::jsonb,0,'run-published-corpus','schema-1','policy-1',null,null,'${pg.contextVersionId}','${publishedB.id}'
  ) r`)).rows[0].r;
  assert.equal(run.legal_corpus_version_id, publishedB.id);

  // Legacy/no-corpus runs remain unaffected (null still allowed).
  const legacyRun = (await pg.query(`select public.psi_record_agt002_canonical_analysis_run(
    '${S}','${O}','${T}','{"summary":"sin corpus"}'::jsonb,0,'run-no-corpus','schema-1','policy-1',null,null,'${pg.contextVersionId}',null
  ) r`)).rows[0].r;
  assert.equal(legacyRun.legal_corpus_version_id, null);

  await pg.close();
})();

// --- Migration registry recognizes 056 and its rollback markers --------------
await (async function registryRecognizes056() {
  const spec = getSpec('056');
  assert.equal(spec.migrationFile, '056_agt002_legal_corpus_publication_gate.sql');
  assert.equal(spec.rollbackFile, '056_agt002_legal_corpus_publication_gate_rollback.sql');
  assert.ok(Array.isArray(spec.markers) && spec.markers.length > 0);
})();

console.log('AGT-002 legal corpus publish gate PGlite integration passed');
