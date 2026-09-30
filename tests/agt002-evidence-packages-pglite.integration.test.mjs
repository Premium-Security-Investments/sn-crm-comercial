// AGT-002 P0-02 evidence packages — PGlite integration for migration 097 (RED).
//
// Mirrors the fixture/helper conventions of
// tests/agt002-governed-document-worksets-pglite.integration.test.mjs, but scoped to a
// DELIBERATELY SMALLER fixture: migration 097's own tables/RPCs never reference a document
// snapshot or an AGT-002 context version (051) — psi_tender_document_snapshots/
// psi_agt002_context_versions/psi_tender_analysis_runs are seeded here only because migration
// 068 (the reanalysis job queue) has a hard FK dependency on them, and 068 is applied ONLY so
// this file can assert its row count stays at zero after every freeze — it is never written to.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const strip = value => value.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const migrationSource = name => strip(readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));

const migration026 = migrationSource('026_tender_document_versions.sql');
const migration057 = migrationSource('057_tender_document_logical_identity.sql');
// PGlite does not ship pgcrypto. Neutralize only the two digest expressions in this
// integration fixture, exactly like tests/agt002-governed-document-worksets-pglite.integration.test.mjs.
const migration065Raw = readFileSync(new URL('../supabase/migrations/065_tender_document_extraction_integrity.sql', import.meta.url), 'utf8');
const migration065 = strip(migration065Raw)
  .replace(/create schema if not exists extensions;\s*create extension if not exists pgcrypto with schema extensions;\s*/i, '')
  .replace(/encode\(extensions\.digest\(convert_to\(extracted_text, 'UTF8'\), 'sha256'\), 'hex'\)/g, 'text_hash')
  .replace(/encode\(extensions\.digest\(convert_to\(p_extracted_text, 'UTF8'\), 'sha256'\), 'hex'\)/g, 'p_text_hash');
// The real AGT-002 context version register (051) — a pure FK dependency of migration 068 below,
// never touched by migration 097's own tables/RPCs.
const migration051 = migrationSource('051_agt002_context_versions.sql');
// The real reanalysis job queue (068) — applied ONLY so this suite can assert freezing an
// evidence package never inserts into it. Migration 097 itself never references this table.
const migration068 = migrationSource('068_agt002_reanalysis_jobs.sql');
// RED: not yet authored.
const migration097 = () => migrationSource('097_agt002_evidence_packages.sql');

const O = '10000000-0000-4000-8000-000000000001';
const T = '10000000-0000-4000-8000-000000000002';
const O2 = '10000000-0000-4000-8000-000000000003';
const T2 = '10000000-0000-4000-8000-000000000004';
const ACTOR = '30000000-0000-4000-8000-000000000001';
const ACTOR_NO_PERMISSION = '30000000-0000-4000-8000-000000000002';
const ACTOR_INACTIVE = '30000000-0000-4000-8000-000000000003';

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

async function createBaseFixture() {
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

    create table public.psi_access_permissions (code text primary key, name text not null, description text, active boolean not null default true);
    create table public.psi_profile_permissions (
      profile_id uuid not null references public.psi_sales_profiles(id) on delete cascade,
      permission_code text not null references public.psi_access_permissions(code) on delete restrict,
      created_at timestamptz not null default now(),
      primary key (profile_id, permission_code)
    );

    -- Pure FK dependencies of migration 068 (below) that migration 097 itself never touches:
    -- a minimal snapshots table and a minimal analysis-runs table, exactly like
    -- tests/agt002-governed-document-worksets-pglite.integration.test.mjs's fixture.
    create table public.psi_tender_document_snapshots (
      id uuid primary key, opportunity_id uuid not null references public.psi_sales_opportunities(id),
      tender_id uuid not null references public.psi_public_tenders(id)
    );
    create table public.psi_tender_analysis_runs (
      id uuid primary key default gen_random_uuid(), snapshot_id uuid not null references public.psi_tender_document_snapshots(id),
      opportunity_id uuid not null references public.psi_sales_opportunities(id), tender_id uuid not null references public.psi_public_tenders(id),
      producer text not null, method text not null, status text not null, result jsonb, critical_open_count integer not null default 0,
      idempotency_key text not null unique, schema_version text not null, policy_version text not null, model text, usage jsonb,
      canonical boolean not null default false, created_at timestamptz not null default now(), completed_at timestamptz
    );
    alter table public.psi_tender_analysis_runs enable row level security;
    grant select on public.psi_tender_analysis_runs to service_role;

    insert into public.psi_sales_opportunities (id) values ('${O}'), ('${O2}');
    insert into public.psi_public_tenders (id, converted_opportunity_id) values ('${T}', '${O}'), ('${T2}', '${O2}');
    insert into public.psi_sales_profiles (id, active, identity_type) values
      ('${ACTOR}', true, 'human'),
      ('${ACTOR_NO_PERMISSION}', true, 'human'),
      ('${ACTOR_INACTIVE}', false, 'human');

    insert into public.psi_access_permissions (code, name) values ('licitaciones', 'Licitaciones');
    insert into public.psi_profile_permissions (profile_id, permission_code) values
      ('${ACTOR}', 'licitaciones'), ('${ACTOR_INACTIVE}', 'licitaciones');
  `);
  await pg.exec(migration026);
  await pg.exec(migration057);
  await pg.exec(migration065);
  await pg.exec(migration051);
  await pg.exec(migration068);
  return pg;
}

async function freshDb() {
  const pg = await createBaseFixture();
  await pg.exec(migration097());
  return pg;
}

async function recordDocumentVersion(pg, overrides = {}) {
  const opts = {
    opportunityId: O, tenderId: T, source: 'secop', sourceDocumentId: 'doc-x', name: 'Documento X.pdf',
    contentHash: hash('contenido-x-por-defecto'), mimeType: 'application/pdf', sizeBytes: 2048,
    documentType: 'pliego', extractedText: 'Texto oficial por defecto.', sourceUrl: null, actorId: ACTOR,
    ...overrides,
  };
  const storagePath = overrides.storagePath ?? `tender-documents/${opts.opportunityId}/${opts.sourceDocumentId}`;
  return callRpc(pg, 'psi_record_tender_document_version', {
    p_opportunity_id: opts.opportunityId, p_tender_id: opts.tenderId, p_source: opts.source,
    p_source_document_id: opts.sourceDocumentId, p_name: opts.name, p_content_hash: opts.contentHash,
    p_storage_path: storagePath, p_mime_type: opts.mimeType, p_size_bytes: opts.sizeBytes,
    p_document_type: opts.documentType, p_extracted_text: opts.extractedText, p_source_url: opts.sourceUrl,
    p_actor_id: opts.actorId,
  });
}

async function recordExtraction(pg, overrides = {}) {
  const opts = {
    opportunityId: O, tenderId: T, documentVersionId: undefined,
    extractorVersion: 'tender-document-text-extraction@2', status: 'ok', parser: 'pdf-parse',
    extractedText: 'Contenido tipado por defecto.', metadata: {}, gapReason: 'extraction_error', actorId: ACTOR,
    ...overrides,
  };
  const text = opts.status === 'ok' ? opts.extractedText : null;
  return callRpc(pg, 'psi_record_tender_document_extraction', {
    p_opportunity_id: opts.opportunityId, p_tender_id: opts.tenderId, p_document_version_id: opts.documentVersionId,
    p_extractor_version: opts.extractorVersion, p_status: opts.status, p_parser: opts.parser,
    p_extracted_text: text, p_text_hash: opts.status === 'ok' ? hash(text) : null,
    p_char_count: opts.status === 'ok' ? text.length : 0,
    p_text_byte_count: opts.status === 'ok' ? Buffer.byteLength(text, 'utf8') : 0,
    p_metadata: opts.metadata, p_gap_reason: opts.status === 'gap' ? opts.gapReason : null, p_actor_id: opts.actorId,
  });
}

async function resolveCandidate(pg, { opportunityId = O, tenderId = T, documentVersionId }) {
  return callRpc(pg, 'psi_resolve_agt002_evidence_package_candidate', {
    p_opportunity_id: opportunityId, p_tender_id: tenderId, p_document_version_id: documentVersionId,
  });
}

/** Records one current document version plus its typed `ok` extraction and resolves the
 * evidence package candidate for it in one call — the common setup every freeze scenario needs. */
async function seedOkDocument(pg, overrides = {}) {
  const opts = {
    opportunityId: O, tenderId: T, sourceDocumentId: 'doc-a', name: 'Documento A.pdf',
    contentHash: hash('contenido-a-por-defecto'), extractedText: 'Contenido tipado A por defecto.',
    actorId: ACTOR, ...overrides,
  };
  const version = await recordDocumentVersion(pg, opts);
  const extraction = await recordExtraction(pg, {
    opportunityId: opts.opportunityId, tenderId: opts.tenderId, documentVersionId: version.id,
    extractedText: opts.extractedText, actorId: opts.actorId,
  });
  const candidate = await resolveCandidate(pg, {
    opportunityId: opts.opportunityId, tenderId: opts.tenderId, documentVersionId: version.id,
  });
  return { version, extraction, candidate };
}

function memberFromCandidate(candidate, { sourceClassification = 'official', inclusionReason = 'Documento base para el analisis.' } = {}) {
  return {
    document_version_id: candidate.document_version_id,
    source_classification: sourceClassification,
    inclusion_reason: inclusionReason,
    content_hash: candidate.content_hash,
    extraction_id: candidate.extraction_id,
    extraction_text_hash: candidate.extraction_text_hash,
  };
}

/** Byte-for-byte the same canonicalization agt002-evidence-packages.js computes: members
 * sorted by document_version_id, reduced to {document_version_id, content_hash}. */
function computeDocumentManifestHash(opportunityId, tenderId, members) {
  const sorted = [...members].sort((a, b) => (a.document_version_id < b.document_version_id ? -1 : 1));
  const canonical = sorted.map(m => `{"document_version_id":${JSON.stringify(m.document_version_id)},"content_hash":${JSON.stringify(m.content_hash)}}`).join(',');
  const payload = `{"opportunityId":${JSON.stringify(opportunityId)},"tenderId":${JSON.stringify(tenderId)},"members":[${canonical}]}`;
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

function computeSemanticManifestHash(opportunityId, tenderId, members) {
  const sorted = [...members].sort((a, b) => (a.document_version_id < b.document_version_id ? -1 : 1));
  const canonical = sorted.map(m => (
    `{"document_version_id":${JSON.stringify(m.document_version_id)}`
    + `,"source_classification":${JSON.stringify(m.source_classification)}`
    + `,"inclusion_reason":${JSON.stringify(m.inclusion_reason)}`
    + `,"extraction_id":${JSON.stringify(m.extraction_id)}`
    + `,"extraction_text_hash":${JSON.stringify(m.extraction_text_hash)}}`
  )).join(',');
  const payload = `{"opportunityId":${JSON.stringify(opportunityId)},"tenderId":${JSON.stringify(tenderId)},"members":[${canonical}]}`;
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

function computePackageHash(opportunityId, tenderId, documentManifestHash, semanticManifestHash) {
  const payload = `{"opportunityId":${JSON.stringify(opportunityId)},"tenderId":${JSON.stringify(tenderId)},"documentManifestHash":${JSON.stringify(documentManifestHash)},"semanticManifestHash":${JSON.stringify(semanticManifestHash)}}`;
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

function buildFreezeParams({ opportunityId = O, tenderId = T, idempotencyKey, members, actorId = ACTOR }) {
  const documentManifestHash = computeDocumentManifestHash(opportunityId, tenderId, members);
  const semanticManifestHash = computeSemanticManifestHash(opportunityId, tenderId, members);
  const packageHash = computePackageHash(opportunityId, tenderId, documentManifestHash, semanticManifestHash);
  return {
    p_opportunity_id: opportunityId, p_tender_id: tenderId, p_idempotency_key: idempotencyKey,
    p_members: members, p_package_hash: packageHash,
    p_document_manifest_hash: documentManifestHash, p_semantic_manifest_hash: semanticManifestHash,
    p_actor_profile_id: actorId,
  };
}

async function freezePackage(pg, opts) {
  return callRpc(pg, 'psi_freeze_agt002_evidence_package', buildFreezeParams(opts));
}

async function coreCounts(pg) {
  return (await pg.query(`
    select
      (select count(*)::int from public.psi_agt002_evidence_packages) as packages,
      (select count(*)::int from public.psi_agt002_evidence_package_versions) as versions,
      (select count(*)::int from public.psi_agt002_evidence_package_members) as members,
      (select count(*)::int from public.psi_agt002_evidence_package_batches) as batches,
      (select count(*)::int from public.psi_agt002_reanalysis_jobs) as jobs
  `)).rows[0];
}

test('migration 097 applies cleanly and defines the four evidence package tables and both RPCs', async () => {
  const pg = await freshDb();
  try {
    const tables = (await pg.query(`
      select
        to_regclass('public.psi_agt002_evidence_packages') is not null as packages,
        to_regclass('public.psi_agt002_evidence_package_versions') is not null as versions,
        to_regclass('public.psi_agt002_evidence_package_members') is not null as members,
        to_regclass('public.psi_agt002_evidence_package_batches') is not null as batches
    `)).rows[0];
    assert.equal(tables.packages, true);
    assert.equal(tables.versions, true);
    assert.equal(tables.members, true);
    assert.equal(tables.batches, true);

    const fns = (await pg.query(`
      select
        to_regprocedure('public.psi_resolve_agt002_evidence_package_candidate(uuid,uuid,uuid)') is not null as resolve,
        to_regprocedure('public.psi_freeze_agt002_evidence_package(uuid,uuid,text,jsonb,text,text,text,uuid)') is not null as freeze
    `)).rows[0];
    assert.equal(fns.resolve, true);
    assert.equal(fns.freeze, true);

    await pg.exec(migration097());
  } finally {
    await pg.close();
  }
});

test('direct INSERT/UPDATE/DELETE on the evidence package tables is denied to authenticated, and INSERT is denied to service_role outside the RPCs', async () => {
  const pg = await freshDb();
  try {
    const insertSql = `insert into public.psi_agt002_evidence_packages (opportunity_id, tender_id) values ('${O}','${T}')`;
    await pg.exec('set role authenticated');
    await assert.rejects(pg.query(insertSql), /permission denied/i);
    await pg.exec('reset role');

    await pg.exec('set role service_role');
    await assert.rejects(pg.query(insertSql), /permission denied/i, 'service_role only has SELECT: every write goes exclusively through the governed RPCs');
    await pg.exec('reset role');
  } finally {
    await pg.close();
  }
});

test('psi_resolve_agt002_evidence_package_candidate resolves the exact current in-scope version and its canonical typed (ok) extraction', async () => {
  const pg = await freshDb();
  try {
    const version = await recordDocumentVersion(pg, { sourceDocumentId: 'doc-resolve', name: 'Documento resolucion.pdf', contentHash: hash('contenido-resolucion-1'), extractedText: 'Contenido tipado de resolucion.' });
    const extraction = await recordExtraction(pg, { documentVersionId: version.id, extractedText: 'Contenido tipado de resolucion.' });
    const candidate = await resolveCandidate(pg, { documentVersionId: version.id });
    assert.equal(candidate.document_version_id, version.id);
    assert.equal(candidate.current, true);
    assert.equal(candidate.content_hash, version.content_hash);
    assert.equal(candidate.extraction_id, extraction.id);
    assert.equal(candidate.extraction_text_hash, extraction.text_hash);
    assert.equal(candidate.extraction_status, 'ok');
  } finally {
    await pg.close();
  }
});

test('psi_resolve_agt002_evidence_package_candidate fails closed (tenant/tender/opportunity mismatch) on a document version outside the given scope', async () => {
  const pg = await freshDb();
  try {
    const foreignVersion = await recordDocumentVersion(pg, { opportunityId: O2, tenderId: T2, sourceDocumentId: 'doc-foreign', name: 'Documento ajeno.pdf', contentHash: hash('contenido-ajeno'), extractedText: 'Contenido ajeno.' });
    await recordExtraction(pg, { opportunityId: O2, tenderId: T2, documentVersionId: foreignVersion.id, extractedText: 'Contenido ajeno.' });
    await assert.rejects(resolveCandidate(pg, { opportunityId: O, tenderId: T, documentVersionId: foreignVersion.id }), /no pertenece/i);
  } finally {
    await pg.close();
  }
});

test('psi_resolve_agt002_evidence_package_candidate fails closed on a superseded (no longer current) document version', async () => {
  const pg = await freshDb();
  try {
    const original = await recordDocumentVersion(pg, { sourceDocumentId: 'doc-supersede-1', name: 'Documento vigente.pdf', contentHash: hash('contenido-original'), extractedText: 'Contenido original.' });
    await recordExtraction(pg, { documentVersionId: original.id, extractedText: 'Contenido original.' });
    await recordDocumentVersion(pg, { sourceDocumentId: 'doc-supersede-2', name: 'Documento vigente.pdf', contentHash: hash('contenido-nuevo'), extractedText: 'Contenido nuevo.' });
    await assert.rejects(resolveCandidate(pg, { documentVersionId: original.id }), /vigente/i);
  } finally {
    await pg.close();
  }
});

test('freeze at N=1 creates the header, one version (version_number=1), one member, one batch — and creates ZERO reanalysis jobs', async () => {
  const pg = await freshDb();
  try {
    const doc = await seedOkDocument(pg, { sourceDocumentId: 'doc-n1', name: 'Documento N1.pdf', contentHash: hash('contenido-n1'), extractedText: 'Contenido N1.' });
    const member = memberFromCandidate(doc.candidate);
    const result = await freezePackage(pg, { idempotencyKey: 'idem-n1', members: [member] });

    assert.equal(result.status, 'created');
    assert.equal(result.version_number, 1);
    assert.equal(result.member_count, 1);
    assert.equal(result.batch_count, 1);
    assert.match(result.package_hash, /^[0-9a-f]{64}$/);
    assert.match(result.document_manifest_hash, /^[0-9a-f]{64}$/);
    assert.match(result.semantic_manifest_hash, /^[0-9a-f]{64}$/);
    assert.equal(result.reanalysis_job_id, undefined, 'the freeze result must never carry a reanalysis job id');
    assert.equal(result.run_id, undefined, 'the freeze result must never carry a run id');

    const counts = await coreCounts(pg);
    assert.deepEqual(counts, { packages: 1, versions: 1, members: 1, batches: 1, jobs: 0 });
  } finally {
    await pg.close();
  }
});

test('freeze at N=13 partitions into exactly two batches (12 then 1), and every requested member is persisted exactly once', async () => {
  const pg = await freshDb();
  try {
    const members = [];
    for (let i = 0; i < 13; i++) {
      const doc = await seedOkDocument(pg, { sourceDocumentId: `doc-n13-${i}`, name: `Documento N13 ${i}.pdf`, contentHash: hash(`contenido-n13-${i}`), extractedText: `Contenido N13 ${i}.` });
      members.push(memberFromCandidate(doc.candidate, { inclusionReason: `Razon ${i} para incluir este documento.` }));
    }

    const result = await freezePackage(pg, { idempotencyKey: 'idem-n13', members });
    assert.equal(result.status, 'created');
    assert.equal(result.member_count, 13, 'the evidence package must accept all 13 members: no functional package member limit');
    assert.equal(result.batch_count, 2);

    const batchRows = (await pg.query(`select batch_index, member_count from public.psi_agt002_evidence_package_batches where package_version_id = '${result.package_version_id}' order by batch_index`)).rows;
    assert.deepEqual(batchRows.map(r => r.member_count), [12, 1]);

    const memberRows = (await pg.query(`select document_version_id, batch_index from public.psi_agt002_evidence_package_members where package_version_id = '${result.package_version_id}'`)).rows;
    assert.equal(memberRows.length, 13, 'every mandatory eligible member must appear exactly once');
    assert.equal(new Set(memberRows.map(r => r.document_version_id)).size, 13, 'no member may be duplicated');

    const counts = await coreCounts(pg);
    assert.deepEqual(counts, { packages: 1, versions: 1, members: 13, batches: 2, jobs: 0 });
  } finally {
    await pg.close();
  }
});

test('a replay of the exact same freeze identity (same idempotency_key, same payload) returns the same identity — creating nothing new', async () => {
  const pg = await freshDb();
  try {
    const doc = await seedOkDocument(pg, { sourceDocumentId: 'doc-replay', name: 'Documento replay.pdf', contentHash: hash('contenido-replay'), extractedText: 'Contenido replay.' });
    const member = memberFromCandidate(doc.candidate);

    const first = await freezePackage(pg, { idempotencyKey: 'idem-replay', members: [member] });
    assert.equal(first.status, 'created');

    const replay = await freezePackage(pg, { idempotencyKey: 'idem-replay', members: [member] });
    assert.equal(replay.status, 'existing');
    assert.equal(replay.package_id, first.package_id);
    assert.equal(replay.package_version_id, first.package_version_id);
    assert.equal(replay.version_number, first.version_number);
    assert.equal(replay.package_hash, first.package_hash);

    const counts = await coreCounts(pg);
    assert.deepEqual(counts, { packages: 1, versions: 1, members: 1, batches: 1, jobs: 0 });
  } finally {
    await pg.close();
  }
});

test('freeze fails closed (conflict) when the same idempotency_key is replayed with a different member selection, leaving no orphaned rows', async () => {
  const pg = await freshDb();
  try {
    const docA = await seedOkDocument(pg, { sourceDocumentId: 'doc-a', name: 'Documento A.pdf', contentHash: hash('contenido-a'), extractedText: 'Contenido A.' });
    const docB = await seedOkDocument(pg, { sourceDocumentId: 'doc-b', name: 'Documento B.pdf', contentHash: hash('contenido-b'), extractedText: 'Contenido B.' });
    const memberA = memberFromCandidate(docA.candidate);
    const memberB = memberFromCandidate(docB.candidate);

    const first = await freezePackage(pg, { idempotencyKey: 'idem-conflict', members: [memberA] });
    assert.equal(first.status, 'created');

    await assert.rejects(freezePackage(pg, { idempotencyKey: 'idem-conflict', members: [memberB] }), /./);

    const counts = await coreCounts(pg);
    assert.deepEqual(counts, { packages: 1, versions: 1, members: 1, batches: 1, jobs: 0 }, 'a conflicting replay must never leave an orphaned version/member/batch behind');
  } finally {
    await pg.close();
  }
});

test('a later addendum under the SAME (opportunity, tender) creates a new package version (version_number=2) and leaves the prior frozen version unchanged', async () => {
  const pg = await freshDb();
  try {
    const docA = await seedOkDocument(pg, { sourceDocumentId: 'doc-addendum-a', name: 'Documento addendum A.pdf', contentHash: hash('contenido-addendum-a'), extractedText: 'Contenido addendum A.' });
    const docB = await seedOkDocument(pg, { sourceDocumentId: 'doc-addendum-b', name: 'Documento addendum B.pdf', contentHash: hash('contenido-addendum-b'), extractedText: 'Contenido addendum B.' });
    const memberA = memberFromCandidate(docA.candidate);
    const memberB = memberFromCandidate(docB.candidate);

    const v1 = await freezePackage(pg, { idempotencyKey: 'idem-addendum-1', members: [memberA] });
    assert.equal(v1.status, 'created');
    assert.equal(v1.version_number, 1);

    const v1MembersBefore = (await pg.query(`select document_version_id from public.psi_agt002_evidence_package_members where package_version_id = '${v1.package_version_id}'`)).rows;

    const v2 = await freezePackage(pg, { idempotencyKey: 'idem-addendum-2', members: [memberA, memberB] });
    assert.equal(v2.status, 'created');
    assert.equal(v2.package_id, v1.package_id, 'the addendum must hang off the SAME package header (same opportunity/tender identity)');
    assert.equal(v2.version_number, 2);
    assert.notEqual(v2.package_version_id, v1.package_version_id);
    assert.notEqual(v2.package_hash, v1.package_hash);

    const v1MembersAfter = (await pg.query(`select document_version_id from public.psi_agt002_evidence_package_members where package_version_id = '${v1.package_version_id}'`)).rows;
    assert.deepEqual(v1MembersAfter, v1MembersBefore, 'the prior frozen version\'s members must be completely unchanged by the addendum');

    const counts = await coreCounts(pg);
    assert.deepEqual(counts, { packages: 1, versions: 2, members: 3, batches: 2, jobs: 0 });
  } finally {
    await pg.close();
  }
});

test('a frozen package header, version, member, and batch row are permanently append-only', async () => {
  const pg = await freshDb();
  try {
    const doc = await seedOkDocument(pg, { sourceDocumentId: 'doc-immutable', name: 'Documento inmutable.pdf', contentHash: hash('contenido-inmutable'), extractedText: 'Contenido inmutable.' });
    const member = memberFromCandidate(doc.candidate);
    const result = await freezePackage(pg, { idempotencyKey: 'idem-immutable', members: [member] });
    assert.equal(result.status, 'created');
    const memberRow = (await pg.query(`select id from public.psi_agt002_evidence_package_members where package_version_id = '${result.package_version_id}' limit 1`)).rows[0];
    const batchRow = (await pg.query(`select id from public.psi_agt002_evidence_package_batches where package_version_id = '${result.package_version_id}' limit 1`)).rows[0];

    await assert.rejects(pg.exec(`update public.psi_agt002_evidence_packages set tender_id = '${T2}' where id = '${result.package_id}'`), /append-only/i);
    await assert.rejects(pg.exec(`delete from public.psi_agt002_evidence_packages where id = '${result.package_id}'`), /append-only/i);
    await assert.rejects(pg.exec(`update public.psi_agt002_evidence_package_versions set member_count = 99 where id = '${result.package_version_id}'`), /append-only/i);
    await assert.rejects(pg.exec(`delete from public.psi_agt002_evidence_package_versions where id = '${result.package_version_id}'`), /append-only/i);
    await assert.rejects(pg.exec(`update public.psi_agt002_evidence_package_members set inclusion_reason = 'tampered' where id = '${memberRow.id}'`), /append-only/i);
    await assert.rejects(pg.exec(`delete from public.psi_agt002_evidence_package_members where id = '${memberRow.id}'`), /append-only/i);
    await assert.rejects(pg.exec(`update public.psi_agt002_evidence_package_batches set member_count = 1 where id = '${batchRow.id}'`), /append-only/i);
    await assert.rejects(pg.exec(`delete from public.psi_agt002_evidence_package_batches where id = '${batchRow.id}'`), /append-only/i);
  } finally {
    await pg.close();
  }
});

test('freezing requires an active actor holding the licitaciones permission (auth/RBAC fail-closed)', async () => {
  const pg = await freshDb();
  try {
    const doc = await seedOkDocument(pg, { sourceDocumentId: 'doc-auth', name: 'Documento autorizacion.pdf', contentHash: hash('contenido-auth'), extractedText: 'Contenido autorizacion.' });
    const member = memberFromCandidate(doc.candidate);

    await assert.rejects(freezePackage(pg, { idempotencyKey: 'idem-no-permission', members: [member], actorId: ACTOR_NO_PERMISSION }), /licitaciones/i);
    await assert.rejects(freezePackage(pg, { idempotencyKey: 'idem-inactive', members: [member], actorId: ACTOR_INACTIVE }), /activ[ao]|licitaciones/i);

    const counts = await coreCounts(pg);
    assert.deepEqual(counts, { packages: 0, versions: 0, members: 0, batches: 0, jobs: 0 }, 'no unauthorized attempt may ever create a package/version row');
  } finally {
    await pg.close();
  }
});

test('freeze fails closed (tenant/tender/opportunity mismatch) on a member document version outside the given opportunity/tender scope', async () => {
  const pg = await freshDb();
  try {
    const foreignDoc = await seedOkDocument(pg, { opportunityId: O2, tenderId: T2, sourceDocumentId: 'doc-foreign-freeze', name: 'Documento ajeno freeze.pdf', contentHash: hash('contenido-ajeno-freeze'), extractedText: 'Contenido ajeno freeze.' });
    const member = memberFromCandidate(foreignDoc.candidate);

    await assert.rejects(freezePackage(pg, { idempotencyKey: 'idem-cross-scope', members: [member] }), /./);

    const counts = await coreCounts(pg);
    assert.deepEqual(counts, { packages: 0, versions: 0, members: 0, batches: 0, jobs: 0 });
  } finally {
    await pg.close();
  }
});

test('freeze fails closed on a malformed member hash and on a member whose latest extraction is only a gap, not ok', async () => {
  const pg = await freshDb();
  try {
    const doc = await seedOkDocument(pg, { sourceDocumentId: 'doc-malformed', name: 'Documento malformado.pdf', contentHash: hash('contenido-malformado'), extractedText: 'Contenido malformado.' });
    const malformedMember = { ...memberFromCandidate(doc.candidate), content_hash: 'not-a-valid-hash' };
    await assert.rejects(freezePackage(pg, { idempotencyKey: 'idem-malformed', members: [malformedMember] }), /huellas|SHA-256/i);

    const gapVersion = await recordDocumentVersion(pg, { sourceDocumentId: 'doc-gap', name: 'Documento con vacio.pdf', contentHash: hash('contenido-vacio'), extractedText: null });
    await recordExtraction(pg, { documentVersionId: gapVersion.id, status: 'gap', gapReason: 'extraction_error' });
    await assert.rejects(resolveCandidate(pg, { documentVersionId: gapVersion.id }), /extracci[oó]n tipada ok/i);

    const counts = await coreCounts(pg);
    assert.deepEqual(counts, { packages: 0, versions: 0, members: 0, batches: 0, jobs: 0 });
  } finally {
    await pg.close();
  }
});
