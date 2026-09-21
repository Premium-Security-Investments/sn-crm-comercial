// AGT-002 governed document worksets — PGlite integration for migration 084
// (.hermes/plans/2026-09-17-agt002-governed-document-worksets.md, Phase 2).
//
// Exercises the real migration against a real PostgreSQL engine, on top of a minimal
// prerequisite fixture (opportunities/tenders/profiles/snapshots/permissions) plus the real,
// untouched migrations 026/057/065 (tender document version + typed extraction registers),
// 051 (AGT-002 context versions) and 068 (the durable reanalysis job queue) — mirroring the
// conventions of tests/agt002-durable-batched-analysis-migration-pglite.integration.test.mjs,
// tests/agt002-reanalysis-jobs-pglite.integration.test.mjs and
// tests/tender-document-extraction-integrity-pglite.integration.test.mjs. All ids/content
// below are synthetic; no real expediente.
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
// integration fixture, exactly like tests/tender-document-extraction-integrity-pglite.integration.test.mjs.
const migration065Raw = readFileSync(new URL('../supabase/migrations/065_tender_document_extraction_integrity.sql', import.meta.url), 'utf8');
const migration065 = strip(migration065Raw)
  .replace(/create schema if not exists extensions;\s*create extension if not exists pgcrypto with schema extensions;\s*/i, '')
  .replace(/encode\(extensions\.digest\(convert_to\(extracted_text, 'UTF8'\), 'sha256'\), 'hex'\)/g, 'text_hash')
  .replace(/encode\(extensions\.digest\(convert_to\(p_extracted_text, 'UTF8'\), 'sha256'\), 'hex'\)/g, 'p_text_hash');
const migration051 = migrationSource('051_agt002_context_versions.sql');
const migration068 = migrationSource('068_agt002_reanalysis_jobs.sql');
const migration084 = migrationSource('084_agt002_governed_document_worksets.sql');
// RED: not yet authored. Exercises the future public.psi_backfill_legacy_tender_document_extraction
// RPC's atomic superseded-version guard on top of the real, untouched 026/057/065 registers.
const migration085 = migrationSource('085_legacy_extraction_backfill_guard.sql');

const O = '10000000-0000-4000-8000-000000000001';
const T = '10000000-0000-4000-8000-000000000002';
const O2 = '10000000-0000-4000-8000-000000000003';
const T2 = '10000000-0000-4000-8000-000000000004';
const S1 = '20000000-0000-4000-8000-000000000001';
const S2 = '20000000-0000-4000-8000-000000000002';
const ACTOR = '30000000-0000-4000-8000-000000000001';
const ACTOR_NO_CUSTODY = '30000000-0000-4000-8000-000000000002';
const ACTOR_INACTIVE = '30000000-0000-4000-8000-000000000003';
const ACTOR_AGENT = '30000000-0000-4000-8000-000000000004';

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

async function freshDb() {
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

    -- Minimal fixture counterpart of 019's real public.psi_access_permissions /
    -- public.psi_profile_permissions (the module authorization tables), NOT a production
    -- schema substitute: only the columns migration 084's freeze RPC actually reads.
    create table public.psi_access_permissions (code text primary key, name text not null, description text, active boolean not null default true);
    create table public.psi_profile_permissions (
      profile_id uuid not null references public.psi_sales_profiles(id) on delete cascade,
      permission_code text not null references public.psi_access_permissions(code) on delete restrict,
      created_at timestamptz not null default now(),
      primary key (profile_id, permission_code)
    );

    insert into public.psi_sales_opportunities (id) values ('${O}'), ('${O2}');
    insert into public.psi_public_tenders (id, converted_opportunity_id) values ('${T}', '${O}'), ('${T2}', '${O2}');
    insert into public.psi_sales_profiles (id, active, identity_type) values
      ('${ACTOR}', true, 'human'),
      ('${ACTOR_NO_CUSTODY}', true, 'human'),
      ('${ACTOR_INACTIVE}', false, 'human'),
      ('${ACTOR_AGENT}', true, 'agent');
    insert into public.psi_tender_document_snapshots (id, opportunity_id, tender_id) values
      ('${S1}', '${O}', '${T}'), ('${S2}', '${O}', '${T}');

    insert into public.psi_access_permissions (code, name) values
      ('licitaciones', 'Licitaciones'), ('licitaciones_custodia', 'Custodia de Licitaciones');
    insert into public.psi_profile_permissions (profile_id, permission_code) values
      ('${ACTOR}', 'licitaciones'), ('${ACTOR}', 'licitaciones_custodia'),
      ('${ACTOR_NO_CUSTODY}', 'licitaciones'),
      ('${ACTOR_INACTIVE}', 'licitaciones'), ('${ACTOR_INACTIVE}', 'licitaciones_custodia'),
      ('${ACTOR_AGENT}', 'licitaciones'), ('${ACTOR_AGENT}', 'licitaciones_custodia');
  `);
  await pg.exec(migration026);
  await pg.exec(migration057);
  await pg.exec(migration065);
  await pg.exec(migration085);
  await pg.exec(migration051);
  await pg.exec(migration068);
  await pg.exec(migration084);
  return pg;
}

async function recordContextVersion(pg, { opportunityId = O, tenderId = T, snapshotId, idempotencyKey, actorId = ACTOR }) {
  return callRpc(pg, 'psi_record_agt002_context_version', {
    p_opportunity_id: opportunityId, p_tender_id: tenderId, p_snapshot_id: snapshotId, p_context_version: 2,
    p_context: { snapshot_id: snapshotId }, p_context_hash: `context-hash-${idempotencyKey}`,
    p_human_evidence_count: 0, p_idempotency_key: idempotencyKey, p_actor_id: actorId,
  });
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

/** RED: calls the future public.psi_backfill_legacy_tender_document_extraction RPC, which
 * must record a legacy-column extraction (extractor_version 'legacy-version-register@1',
 * parser 'legacy-version-column') only when p_document_version_id is still the current
 * version — atomically rejecting a superseded one. */
async function backfillLegacyExtraction(pg, { opportunityId = O, tenderId = T, documentVersionId, extractedText, actorId = ACTOR }) {
  return callRpc(pg, 'psi_backfill_legacy_tender_document_extraction', {
    p_opportunity_id: opportunityId, p_tender_id: tenderId, p_document_version_id: documentVersionId,
    p_extracted_text: extractedText, p_text_hash: hash(extractedText),
    p_char_count: Array.from(extractedText).length, p_text_byte_count: Buffer.byteLength(extractedText, 'utf8'),
    p_actor_id: actorId,
  });
}

async function resolveCandidate(pg, { opportunityId = O, tenderId = T, documentVersionId }) {
  return callRpc(pg, 'psi_resolve_agt002_governed_document_candidate', {
    p_opportunity_id: opportunityId, p_tender_id: tenderId, p_document_version_id: documentVersionId,
  });
}

/** Records one current document version plus its typed `ok` extraction and resolves the
 * governed candidate for it in one call — the common setup every freeze scenario needs. */
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

/** Byte-for-byte the same canonicalization migration 084's freeze RPC computes: members
 * sorted by document_version_id (collate "C"), the same six fields in the same order. */
function canonicalMemberJson(member) {
  return `{"document_version_id":${JSON.stringify(member.document_version_id)}`
    + `,"source_classification":${JSON.stringify(member.source_classification)}`
    + `,"inclusion_reason":${JSON.stringify(member.inclusion_reason)}`
    + `,"content_hash":${JSON.stringify(member.content_hash)}`
    + `,"extraction_id":${JSON.stringify(member.extraction_id)}`
    + `,"extraction_text_hash":${JSON.stringify(member.extraction_text_hash)}}`;
}

function computeSelectionHash(opportunityId, tenderId, members) {
  const sorted = [...members].sort((a, b) => (a.document_version_id < b.document_version_id ? -1 : a.document_version_id > b.document_version_id ? 1 : 0));
  const canonicalMembers = sorted.map(canonicalMemberJson).join(',');
  const payload = `{"opportunityId":${JSON.stringify(opportunityId)},"tenderId":${JSON.stringify(tenderId)},"members":[${canonicalMembers}]}`;
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

const DEFAULT_ENGINE_SCHEMA_VERSION = 2;
const DEFAULT_ENGINE_IDENTITY = { engine: 'agt002', engine_version: '1' };
const DEFAULT_ANALYSIS_FLAGS = { deep_mode: false };

/** The public three-field projection analysis_context.documents must carry: the same p_members,
 * reduced to exactly document_version_id/source_classification/inclusion_reason, sorted by
 * document_version_id (byte-for-byte the same comparator computeSelectionHash uses). */
function canonicalGovernedMember(member) {
  return {
    document_version_id: member.document_version_id,
    source_classification: member.source_classification,
    inclusion_reason: member.inclusion_reason,
  };
}

function canonicalGovernedWorksetMembers(members) {
  return [...members]
    .sort((a, b) => (a.document_version_id < b.document_version_id ? -1 : a.document_version_id > b.document_version_id ? 1 : 0))
    .map(canonicalGovernedMember);
}

/** The canonical governed_workset_members projection p_frozen_engine_input must carry: the same
 * p_members, kept at their full six evidence fields, sorted by document_version_id (byte-for-byte
 * the same comparator/shape computeSelectionHash uses) — never the public three-field projection
 * above, which is exclusively analysis_context.documents' shape. */
function canonicalGovernedMemberSix(member) {
  return {
    document_version_id: member.document_version_id,
    source_classification: member.source_classification,
    inclusion_reason: member.inclusion_reason,
    content_hash: member.content_hash,
    extraction_id: member.extraction_id,
    extraction_text_hash: member.extraction_text_hash,
  };
}

function canonicalGovernedWorksetMembersSix(members) {
  return [...members]
    .sort((a, b) => (a.document_version_id < b.document_version_id ? -1 : a.document_version_id > b.document_version_id ? 1 : 0))
    .map(canonicalGovernedMemberSix);
}

/** The canonical analysis_context every valid freeze must carry: the selected members,
 * reduced to the same three-key projection as governed_workset_members, in the same order. */
function canonicalAnalysisContext(opportunityId, snapshotId, members) {
  return {
    opportunity: { id: opportunityId },
    snapshotId,
    canonicalOnly: true,
    documents: canonicalGovernedWorksetMembers(members),
  };
}

function buildFreezeParams({
  opportunityId = O, tenderId = T, snapshotId, contextVersionId, idempotencyKey, members, actorId = ACTOR,
  engineExtra = {}, governedWorksetMembers, omitEngineFields = [],
  schemaVersion = DEFAULT_ENGINE_SCHEMA_VERSION, identity, identityExtra, analysisContext,
}) {
  const selectionHash = computeSelectionHash(opportunityId, tenderId, members);
  const documentWorksetIdentity = identity !== undefined ? identity : {
    opportunity_id: opportunityId, tender_id: tenderId, snapshot_id: snapshotId,
    context_version_id: contextVersionId, selection_hash: selectionHash,
    ...(identityExtra ?? {}),
  };
  const frozenEngineInput = {
    schema_version: schemaVersion,
    document_workset_identity: documentWorksetIdentity,
    engine_identity: DEFAULT_ENGINE_IDENTITY,
    analysis_flags: DEFAULT_ANALYSIS_FLAGS,
    analysis_context: analysisContext !== undefined ? analysisContext : canonicalAnalysisContext(opportunityId, snapshotId, members),
    governed_workset_members: governedWorksetMembers !== undefined ? governedWorksetMembers : canonicalGovernedWorksetMembersSix(members),
    ...engineExtra,
  };
  for (const field of omitEngineFields) delete frozenEngineInput[field];
  return {
    p_opportunity_id: opportunityId, p_tender_id: tenderId, p_snapshot_id: snapshotId,
    p_context_version_id: contextVersionId, p_idempotency_key: idempotencyKey, p_members: members,
    p_frozen_engine_input: frozenEngineInput,
    p_actor_profile_id: actorId,
  };
}

async function freezeWorkset(pg, opts) {
  return callRpc(pg, 'psi_freeze_agt002_governed_document_workset', buildFreezeParams(opts));
}

async function claimReanalysisJob(pg, leaseSeconds = 60) {
  return callRpc(pg, 'psi_claim_agt002_reanalysis_job', { p_lease_seconds: leaseSeconds });
}

async function failReanalysisJob(pg, { jobId, leaseId, errorCode = 'timeout' }) {
  return callRpc(pg, 'psi_fail_agt002_reanalysis_job', { p_job_id: jobId, p_lease_id: leaseId, p_error_code: errorCode });
}

async function countRow(pg, sql) {
  return (await pg.query(sql)).rows[0].n;
}

test('migration 084 applies cleanly and defines the three governed worksets tables and both RPCs', async () => {
  const pg = await freshDb();
  try {
    const tables = (await pg.query(`
      select
        to_regclass('public.psi_agt002_governed_document_worksets') is not null as worksets,
        to_regclass('public.psi_agt002_governed_document_workset_members') is not null as members,
        to_regclass('public.psi_agt002_governed_document_workset_runs') is not null as runs
    `)).rows[0];
    assert.equal(tables.worksets, true);
    assert.equal(tables.members, true);
    assert.equal(tables.runs, true);

    const fns = (await pg.query(`
      select
        to_regprocedure('public.psi_resolve_agt002_governed_document_candidate(uuid,uuid,uuid)') is not null as resolve,
        to_regprocedure('public.psi_freeze_agt002_governed_document_workset(uuid,uuid,uuid,uuid,text,jsonb,jsonb,uuid)') is not null as freeze
    `)).rows[0];
    assert.equal(fns.resolve, true);
    assert.equal(fns.freeze, true);

    // Re-applying the migration must be idempotent: every statement is if-not-exists/or-replace.
    await pg.exec(migration084);
  } finally {
    await pg.close();
  }
});

test('direct INSERT/UPDATE/DELETE on the governed worksets tables is denied to authenticated, and INSERT is denied to service_role outside the RPCs', async () => {
  const pg = await freshDb();
  try {
    const cv = await recordContextVersion(pg, { snapshotId: S1, idempotencyKey: 'ctx-denied' });
    const insertSql = `insert into public.psi_agt002_governed_document_worksets
      (opportunity_id, tender_id, snapshot_id, context_version_id, idempotency_key, selection_hash, member_count, created_by)
      values ('${O}','${T}','${S1}','${cv.id}','x','${'a'.repeat(64)}',1,'${ACTOR}')`;

    await pg.exec('set role authenticated');
    await assert.rejects(pg.query(insertSql), /permission denied/i);
    await assert.rejects(pg.query(`update public.psi_agt002_governed_document_worksets set member_count = 1 where id = '${O}'`), /permission denied/i);
    await assert.rejects(pg.query(`delete from public.psi_agt002_governed_document_worksets where id = '${O}'`), /permission denied/i);
    await pg.exec('reset role');

    await pg.exec('set role service_role');
    await assert.rejects(pg.query(insertSql), /permission denied/i, 'service_role only has SELECT on this table: every write goes exclusively through the governed RPCs');
    await pg.exec('reset role');
  } finally {
    await pg.close();
  }
});

test('psi_resolve_agt002_governed_document_candidate resolves the exact current in-scope version and its canonical typed (ok) extraction', async () => {
  const pg = await freshDb();
  try {
    const version = await recordDocumentVersion(pg, {
      sourceDocumentId: 'doc-resolve', name: 'Documento resolucion.pdf',
      contentHash: hash('contenido-resolucion-1'), extractedText: 'Contenido tipado de resolucion.',
    });
    const extraction = await recordExtraction(pg, { documentVersionId: version.id, extractedText: 'Contenido tipado de resolucion.' });

    const candidate = await resolveCandidate(pg, { documentVersionId: version.id });
    assert.equal(candidate.document_version_id, version.id);
    assert.equal(candidate.opportunity_id, O);
    assert.equal(candidate.tender_id, T);
    assert.equal(candidate.current, true);
    assert.equal(candidate.content_hash, version.content_hash);
    assert.equal(candidate.extraction_id, extraction.id);
    assert.equal(candidate.extraction_text_hash, extraction.text_hash);
    assert.equal(candidate.extraction_status, 'ok');
    assert.equal(
      candidate.extracted_text_char_count, 'Contenido tipado de resolucion.'.length,
      'extracted_text_char_count must be the server-computed char_length of the real extracted text, never a client-supplied size',
    );
  } finally {
    await pg.close();
  }
});

test('psi_resolve_agt002_governed_document_candidate rejects a document version outside the given opportunity/tender scope', async () => {
  const pg = await freshDb();
  try {
    const foreignVersion = await recordDocumentVersion(pg, {
      opportunityId: O2, tenderId: T2, sourceDocumentId: 'doc-foreign-resolve', name: 'Documento ajeno.pdf',
      contentHash: hash('contenido-ajeno-resolve'), extractedText: 'Contenido ajeno.',
    });
    await recordExtraction(pg, { opportunityId: O2, tenderId: T2, documentVersionId: foreignVersion.id, extractedText: 'Contenido ajeno.' });

    await assert.rejects(
      resolveCandidate(pg, { opportunityId: O, tenderId: T, documentVersionId: foreignVersion.id }),
      /no pertenece/i,
    );
  } finally {
    await pg.close();
  }
});

test('psi_resolve_agt002_governed_document_candidate rejects a superseded (no longer current) document version', async () => {
  const pg = await freshDb();
  try {
    const original = await recordDocumentVersion(pg, {
      sourceDocumentId: 'doc-supersede-1', name: 'Documento vigente.pdf',
      contentHash: hash('contenido-original'), extractedText: 'Contenido original.',
    });
    await recordExtraction(pg, { documentVersionId: original.id, extractedText: 'Contenido original.' });
    // A new version under the SAME normalized name supersedes it (057/065's logical identity).
    await recordDocumentVersion(pg, {
      sourceDocumentId: 'doc-supersede-2', name: 'Documento vigente.pdf',
      contentHash: hash('contenido-nuevo'), extractedText: 'Contenido nuevo.',
    });

    await assert.rejects(resolveCandidate(pg, { documentVersionId: original.id }), /vigente/i);
  } finally {
    await pg.close();
  }
});

test('freeze by an active Licitaciones+custody human atomically writes the header, the exact members, enqueues through the canonical reanalysis queue, and stores the real job id on the run row', async () => {
  const pg = await freshDb();
  try {
    const docA = await seedOkDocument(pg, { sourceDocumentId: 'doc-a', name: 'Documento A.pdf', contentHash: hash('contenido-a'), extractedText: 'Contenido A.' });
    const docB = await seedOkDocument(pg, { sourceDocumentId: 'doc-b', name: 'Documento B.pdf', contentHash: hash('contenido-b'), extractedText: 'Contenido B.' });
    const memberA = memberFromCandidate(docA.candidate, { sourceClassification: 'official', inclusionReason: 'Pliego de condiciones vigente.' });
    const memberB = memberFromCandidate(docB.candidate, { sourceClassification: 'corporate', inclusionReason: 'Certificado de experiencia propio.' });
    const cv = await recordContextVersion(pg, { snapshotId: S1, idempotencyKey: 'ctx-happy' });

    const result = await freezeWorkset(pg, { snapshotId: S1, contextVersionId: cv.id, idempotencyKey: 'idem-happy', members: [memberA, memberB] });
    assert.equal(result.status, 'created');
    assert.equal(result.member_count, 2);
    assert.ok(result.workset_id);
    assert.ok(result.run_id);
    assert.ok(result.reanalysis_job_id);

    const header = (await pg.query(
      `select opportunity_id, tender_id, snapshot_id, context_version_id, idempotency_key, selection_hash, member_count, created_by
       from public.psi_agt002_governed_document_worksets where id = '${result.workset_id}'`,
    )).rows[0];
    assert.equal(header.opportunity_id, O);
    assert.equal(header.tender_id, T);
    assert.equal(header.snapshot_id, S1);
    assert.equal(header.context_version_id, cv.id);
    assert.equal(header.idempotency_key, 'idem-happy');
    assert.equal(header.selection_hash, result.selection_hash);
    assert.equal(header.member_count, 2);
    assert.equal(header.created_by, ACTOR);

    const memberRows = (await pg.query(
      `select document_version_id, source_classification, inclusion_reason, content_hash, extraction_id, extraction_text_hash
       from public.psi_agt002_governed_document_workset_members where workset_id = '${result.workset_id}' order by member_index`,
    )).rows;
    assert.equal(memberRows.length, 2);
    const byDoc = Object.fromEntries(memberRows.map(row => [row.document_version_id, row]));
    assert.equal(byDoc[docA.version.id].source_classification, 'official');
    assert.equal(byDoc[docA.version.id].inclusion_reason, 'Pliego de condiciones vigente.');
    assert.equal(byDoc[docA.version.id].content_hash, docA.candidate.content_hash);
    assert.equal(byDoc[docA.version.id].extraction_id, docA.candidate.extraction_id);
    assert.equal(byDoc[docA.version.id].extraction_text_hash, docA.candidate.extraction_text_hash);
    assert.equal(byDoc[docB.version.id].source_classification, 'corporate');
    assert.equal(byDoc[docB.version.id].content_hash, docB.candidate.content_hash);

    const runRow = (await pg.query(
      `select workset_id, reanalysis_job_id, opportunity_id, tender_id, requested_by
       from public.psi_agt002_governed_document_workset_runs where id = '${result.run_id}'`,
    )).rows[0];
    assert.equal(runRow.workset_id, result.workset_id);
    assert.equal(runRow.reanalysis_job_id, result.reanalysis_job_id);
    assert.equal(runRow.requested_by, ACTOR);

    const jobRow = (await pg.query(
      `select opportunity_id, tender_id, snapshot_id, context_version_id, idempotency_key, status, frozen_engine_input
       from public.psi_agt002_reanalysis_jobs where id = '${result.reanalysis_job_id}'`,
    )).rows[0];
    assert.ok(jobRow, 'the run row must reference a real row already committed in the canonical reanalysis queue');
    assert.equal(jobRow.opportunity_id, O);
    assert.equal(jobRow.tender_id, T);
    assert.equal(jobRow.snapshot_id, S1);
    assert.equal(jobRow.context_version_id, cv.id);
    assert.equal(jobRow.idempotency_key, 'idem-happy');
    assert.equal(jobRow.status, 'queued');
    assert.equal(jobRow.frozen_engine_input.document_workset_identity.selection_hash, result.selection_hash);
  } finally {
    await pg.close();
  }
});

test('a replay of the exact same freeze identity returns the same workset, run and job — creating nothing new', async () => {
  const pg = await freshDb();
  try {
    const doc = await seedOkDocument(pg, { sourceDocumentId: 'doc-replay', name: 'Documento replay.pdf', contentHash: hash('contenido-replay'), extractedText: 'Contenido replay.' });
    const member = memberFromCandidate(doc.candidate);
    const cv = await recordContextVersion(pg, { snapshotId: S1, idempotencyKey: 'ctx-replay' });

    const first = await freezeWorkset(pg, { snapshotId: S1, contextVersionId: cv.id, idempotencyKey: 'idem-replay', members: [member] });
    assert.equal(first.status, 'created');

    const replay = await freezeWorkset(pg, { snapshotId: S1, contextVersionId: cv.id, idempotencyKey: 'idem-replay', members: [member] });
    assert.equal(replay.status, 'existing');
    assert.equal(replay.workset_id, first.workset_id);
    assert.equal(replay.run_id, first.run_id);
    assert.equal(replay.reanalysis_job_id, first.reanalysis_job_id);
    assert.equal(replay.selection_hash, first.selection_hash);

    const counts = (await pg.query(`
      select
        (select count(*)::int from public.psi_agt002_governed_document_worksets) as worksets,
        (select count(*)::int from public.psi_agt002_governed_document_workset_members) as members,
        (select count(*)::int from public.psi_agt002_governed_document_workset_runs) as runs,
        (select count(*)::int from public.psi_agt002_reanalysis_jobs) as jobs
    `)).rows[0];
    assert.deepEqual(counts, { worksets: 1, members: 1, runs: 1, jobs: 1 });
  } finally {
    await pg.close();
  }
});

test('replay with a different member selection under the same idempotency key fails closed at the reanalysis queue boundary, leaving no orphaned workset', async () => {
  const pg = await freshDb();
  try {
    const docA = await seedOkDocument(pg, { sourceDocumentId: 'doc-a', name: 'Documento A.pdf', contentHash: hash('contenido-a'), extractedText: 'Contenido A.' });
    const docB = await seedOkDocument(pg, { sourceDocumentId: 'doc-b', name: 'Documento B.pdf', contentHash: hash('contenido-b'), extractedText: 'Contenido B.' });
    const memberA = memberFromCandidate(docA.candidate);
    const memberB = memberFromCandidate(docB.candidate);
    const cv = await recordContextVersion(pg, { snapshotId: S1, idempotencyKey: 'ctx-member-change' });

    const first = await freezeWorkset(pg, { snapshotId: S1, contextVersionId: cv.id, idempotencyKey: 'idem-member-change', members: [memberA] });
    assert.equal(first.status, 'created');

    await assert.rejects(
      freezeWorkset(pg, { snapshotId: S1, contextVersionId: cv.id, idempotencyKey: 'idem-member-change', members: [memberB] }),
      /otro trabajo|activo/i,
      'a different selection under an active job\'s idempotency_key must collide with the one-active-job-per-opportunity queue guard',
    );

    assert.equal(await countRow(pg, 'select count(*)::int n from public.psi_agt002_governed_document_worksets'), 1, 'the failed replay must never leave a second, orphaned workset behind');
    assert.equal(await countRow(pg, 'select count(*)::int n from public.psi_agt002_governed_document_workset_members'), 1);
    assert.equal(await countRow(pg, 'select count(*)::int n from public.psi_agt002_governed_document_workset_runs'), 1);
  } finally {
    await pg.close();
  }
});

test('replay under the same (opportunity, tender, selection) identity fails closed when the snapshot, context version, or idempotency key differs', async () => {
  const pg = await freshDb();
  try {
    const doc = await seedOkDocument(pg, { sourceDocumentId: 'doc-bound', name: 'Documento vinculado.pdf', contentHash: hash('contenido-vinculado'), extractedText: 'Contenido vinculado.' });
    const member = memberFromCandidate(doc.candidate);
    const cv1a = await recordContextVersion(pg, { snapshotId: S1, idempotencyKey: 'ctx-1a' });
    const cv1b = await recordContextVersion(pg, { snapshotId: S1, idempotencyKey: 'ctx-1b' });
    const cv2 = await recordContextVersion(pg, { snapshotId: S2, idempotencyKey: 'ctx-2' });

    const base = await freezeWorkset(pg, { snapshotId: S1, contextVersionId: cv1a.id, idempotencyKey: 'idem-base', members: [member] });
    assert.equal(base.status, 'created');

    await assert.rejects(
      freezeWorkset(pg, { snapshotId: S2, contextVersionId: cv2.id, idempotencyKey: 'idem-base', members: [member] }),
      /contenido distinto|existe/i,
      'a replay of the exact same selection under a different snapshot_id must fail closed',
    );
    await assert.rejects(
      freezeWorkset(pg, { snapshotId: S1, contextVersionId: cv1b.id, idempotencyKey: 'idem-base', members: [member] }),
      /contenido distinto|existe/i,
      'a replay of the exact same selection under a different context_version_id must fail closed',
    );
    await assert.rejects(
      freezeWorkset(pg, { snapshotId: S1, contextVersionId: cv1a.id, idempotencyKey: 'idem-different', members: [member] }),
      /contenido distinto|existe/i,
      'a replay of the exact same selection under a different idempotency_key must fail closed',
    );

    assert.equal(
      await countRow(pg, `select count(*)::int n from public.psi_agt002_governed_document_worksets where opportunity_id = '${O}' and tender_id = '${T}'`),
      1,
      'none of the conflicting replays may create a second workset row for the same selection identity',
    );
  } finally {
    await pg.close();
  }
});

test('freezing requires an active human actor holding BOTH licitaciones and licitaciones_custodia permissions', async () => {
  const pg = await freshDb();
  try {
    const doc = await seedOkDocument(pg, { sourceDocumentId: 'doc-auth', name: 'Documento autorizacion.pdf', contentHash: hash('contenido-auth'), extractedText: 'Contenido autorizacion.' });
    const member = memberFromCandidate(doc.candidate);
    const cv = await recordContextVersion(pg, { snapshotId: S1, idempotencyKey: 'ctx-auth' });

    await assert.rejects(
      freezeWorkset(pg, { snapshotId: S1, contextVersionId: cv.id, idempotencyKey: 'idem-no-custody', members: [member], actorId: ACTOR_NO_CUSTODY }),
      /custodia/i,
      'a Licitaciones user WITHOUT the custody permission must be rejected',
    );
    await assert.rejects(
      freezeWorkset(pg, { snapshotId: S1, contextVersionId: cv.id, idempotencyKey: 'idem-inactive', members: [member], actorId: ACTOR_INACTIVE }),
      /activa|Licitaciones/i,
      'a deactivated custody user must fail closed even while their permission rows still exist',
    );
    await assert.rejects(
      freezeWorkset(pg, { snapshotId: S1, contextVersionId: cv.id, idempotencyKey: 'idem-agent', members: [member], actorId: ACTOR_AGENT }),
      /Licitaciones|activa/i,
      'an agent identity must never be able to freeze a governed document package on its own',
    );

    assert.equal(await countRow(pg, 'select count(*)::int n from public.psi_agt002_governed_document_worksets'), 0, 'no unauthorized attempt may ever create a workset row');
  } finally {
    await pg.close();
  }
});

test('freeze rejects a member document version that belongs to a different opportunity/tender scope', async () => {
  const pg = await freshDb();
  try {
    const foreignDoc = await seedOkDocument(pg, {
      opportunityId: O2, tenderId: T2, sourceDocumentId: 'doc-foreign', name: 'Documento ajeno.pdf',
      contentHash: hash('contenido-ajeno'), extractedText: 'Contenido ajeno.',
    });
    const member = memberFromCandidate(foreignDoc.candidate);
    const cv = await recordContextVersion(pg, { snapshotId: S1, idempotencyKey: 'ctx-cross' });

    await assert.rejects(
      freezeWorkset(pg, { snapshotId: S1, contextVersionId: cv.id, idempotencyKey: 'idem-cross', members: [member] }),
      /no pertenece|no coincide/i,
    );

    assert.equal(await countRow(pg, 'select count(*)::int n from public.psi_agt002_governed_document_worksets'), 0);
  } finally {
    await pg.close();
  }
});

test('freeze rejects a malformed member hash and a member whose latest extraction is only a gap, not ok', async () => {
  const pg = await freshDb();
  try {
    const doc = await seedOkDocument(pg, { sourceDocumentId: 'doc-malformed', name: 'Documento malformado.pdf', contentHash: hash('contenido-malformado'), extractedText: 'Contenido malformado.' });
    const cv = await recordContextVersion(pg, { snapshotId: S1, idempotencyKey: 'ctx-malformed' });

    const malformedMember = { ...memberFromCandidate(doc.candidate), content_hash: 'not-a-valid-hash' };
    await assert.rejects(
      freezeWorkset(pg, { snapshotId: S1, contextVersionId: cv.id, idempotencyKey: 'idem-malformed', members: [malformedMember] }),
      /huellas|SHA-256/i,
    );

    const gapVersion = await recordDocumentVersion(pg, {
      sourceDocumentId: 'doc-gap', name: 'Documento con vacio.pdf', contentHash: hash('contenido-vacio'), extractedText: null,
    });
    await recordExtraction(pg, { documentVersionId: gapVersion.id, status: 'gap', gapReason: 'extraction_error' });
    await assert.rejects(
      resolveCandidate(pg, { documentVersionId: gapVersion.id }),
      /extracci[oó]n tipada ok/i,
      'a document version whose only recorded extraction is a gap can never resolve a governed candidate',
    );

    assert.equal(await countRow(pg, 'select count(*)::int n from public.psi_agt002_governed_document_worksets'), 0);
  } finally {
    await pg.close();
  }
});

test('a frozen workset header, its members, and its run row are permanently append-only', async () => {
  const pg = await freshDb();
  try {
    const doc = await seedOkDocument(pg, { sourceDocumentId: 'doc-immutable', name: 'Documento inmutable.pdf', contentHash: hash('contenido-inmutable'), extractedText: 'Contenido inmutable.' });
    const member = memberFromCandidate(doc.candidate);
    const cv = await recordContextVersion(pg, { snapshotId: S1, idempotencyKey: 'ctx-immutable' });
    const result = await freezeWorkset(pg, { snapshotId: S1, contextVersionId: cv.id, idempotencyKey: 'idem-immutable', members: [member] });
    assert.equal(result.status, 'created');
    const memberRow = (await pg.query(`select id from public.psi_agt002_governed_document_workset_members where workset_id = '${result.workset_id}' limit 1`)).rows[0];

    await assert.rejects(pg.exec(`update public.psi_agt002_governed_document_worksets set member_count = 99 where id = '${result.workset_id}'`), /append-only/i);
    await assert.rejects(pg.exec(`delete from public.psi_agt002_governed_document_worksets where id = '${result.workset_id}'`), /append-only/i);
    await assert.rejects(pg.exec(`update public.psi_agt002_governed_document_workset_members set inclusion_reason = 'tampered' where id = '${memberRow.id}'`), /append-only/i);
    await assert.rejects(pg.exec(`delete from public.psi_agt002_governed_document_workset_members where id = '${memberRow.id}'`), /append-only/i);
    await assert.rejects(pg.exec(`update public.psi_agt002_governed_document_workset_runs set reanalysis_job_id = gen_random_uuid() where id = '${result.run_id}'`), /append-only/i);
    await assert.rejects(pg.exec(`delete from public.psi_agt002_governed_document_workset_runs where id = '${result.run_id}'`), /append-only/i);
  } finally {
    await pg.close();
  }
});

test('a genuinely different document selection produces its own new workset, run, and reanalysis job', async () => {
  const pg = await freshDb();
  try {
    const docA = await seedOkDocument(pg, { sourceDocumentId: 'doc-a', name: 'Documento A.pdf', contentHash: hash('contenido-a'), extractedText: 'Contenido A.' });
    const docB = await seedOkDocument(pg, { sourceDocumentId: 'doc-b', name: 'Documento B.pdf', contentHash: hash('contenido-b'), extractedText: 'Contenido B.' });
    const memberA = memberFromCandidate(docA.candidate);
    const memberB = memberFromCandidate(docB.candidate);
    const cv = await recordContextVersion(pg, { snapshotId: S1, idempotencyKey: 'ctx-selection' });

    const first = await freezeWorkset(pg, { snapshotId: S1, contextVersionId: cv.id, idempotencyKey: 'idem-selection-1', members: [memberA] });
    assert.equal(first.status, 'created');

    // Terminalize the first job so the opportunity's single-active-job slot frees up.
    const claim = await claimReanalysisJob(pg);
    assert.equal(claim.job_id, first.reanalysis_job_id);
    await failReanalysisJob(pg, { jobId: first.reanalysis_job_id, leaseId: claim.lease_id, errorCode: 'timeout' });

    const second = await freezeWorkset(pg, { snapshotId: S1, contextVersionId: cv.id, idempotencyKey: 'idem-selection-2', members: [memberB] });
    assert.equal(second.status, 'created');
    assert.notEqual(second.workset_id, first.workset_id);
    assert.notEqual(second.run_id, first.run_id);
    assert.notEqual(second.reanalysis_job_id, first.reanalysis_job_id);
    assert.notEqual(second.selection_hash, first.selection_hash);

    assert.equal(await countRow(pg, 'select count(*)::int n from public.psi_agt002_governed_document_worksets'), 2);
    assert.equal(await countRow(pg, 'select count(*)::int n from public.psi_agt002_governed_document_workset_runs'), 2);
  } finally {
    await pg.close();
  }
});

// ---------------------------------------------------------------------------------------
// Extended frozen-engine-input contract (RED): migration 084 does not yet validate
// schema_version/engine_identity/analysis_flags/analysis_context or governed_workset_members.
// Every scenario below uses a fresh, never-before-frozen document selection so its rejection
// (or lack of one) can only be attributed to the field under test, never to the unrelated
// same-identity replay guard.
// ---------------------------------------------------------------------------------------

test('freeze fails closed atomically when p_frozen_engine_input omits schema_version, engine_identity, analysis_flags, or analysis_context', async () => {
  const pg = await freshDb();
  try {
    for (const field of ['schema_version', 'engine_identity', 'analysis_flags', 'analysis_context']) {
      const doc = await seedOkDocument(pg, {
        sourceDocumentId: `doc-omit-${field}`, name: `Documento omision ${field}.pdf`,
        contentHash: hash(`contenido-omit-${field}`), extractedText: `Contenido omision ${field}.`,
      });
      const member = memberFromCandidate(doc.candidate);
      const cv = await recordContextVersion(pg, { snapshotId: S1, idempotencyKey: `ctx-omit-${field}` });

      await assert.rejects(
        freezeWorkset(pg, {
          snapshotId: S1, contextVersionId: cv.id, idempotencyKey: `idem-omit-${field}`, members: [member],
          omitEngineFields: [field],
        }),
        /./,
        `omitting ${field} from p_frozen_engine_input must fail closed`,
      );
    }

    const counts = (await pg.query(`
      select
        (select count(*)::int from public.psi_agt002_governed_document_worksets) as worksets,
        (select count(*)::int from public.psi_agt002_governed_document_workset_members) as members,
        (select count(*)::int from public.psi_agt002_governed_document_workset_runs) as runs,
        (select count(*)::int from public.psi_agt002_reanalysis_jobs) as jobs
    `)).rows[0];
    assert.deepEqual(counts, { worksets: 0, members: 0, runs: 0, jobs: 0 }, 'omitting a canonical frozen-engine-input field must never leave any partial workset/member/run/job behind');
  } finally {
    await pg.close();
  }
});

test('freeze fails closed atomically when p_frozen_engine_input.governed_workset_members diverges from the canonical p_members projection', async () => {
  const pg = await freshDb();
  try {
    for (const label of ['absent', 'extra', 'omitted', 'reordered', 'classification', 'reason']) {
      const docA = await seedOkDocument(pg, {
        sourceDocumentId: `doc-gwm-${label}-a`, name: `Documento GWM ${label} A.pdf`,
        contentHash: hash(`contenido-gwm-${label}-a`), extractedText: `Contenido GWM ${label} A.`,
      });
      const docB = await seedOkDocument(pg, {
        sourceDocumentId: `doc-gwm-${label}-b`, name: `Documento GWM ${label} B.pdf`,
        contentHash: hash(`contenido-gwm-${label}-b`), extractedText: `Contenido GWM ${label} B.`,
      });
      const memberA = memberFromCandidate(docA.candidate, { sourceClassification: 'official', inclusionReason: `Razon A ${label}.` });
      const memberB = memberFromCandidate(docB.candidate, { sourceClassification: 'corporate', inclusionReason: `Razon B ${label}.` });
      const members = [memberA, memberB];
      const canonical = canonicalGovernedWorksetMembers(members);
      const cv = await recordContextVersion(pg, { snapshotId: S1, idempotencyKey: `ctx-gwm-${label}` });

      const opts = { snapshotId: S1, contextVersionId: cv.id, idempotencyKey: `idem-gwm-${label}`, members };
      if (label === 'absent') {
        opts.omitEngineFields = ['governed_workset_members'];
      } else if (label === 'extra') {
        const docC = await seedOkDocument(pg, {
          sourceDocumentId: `doc-gwm-${label}-c`, name: `Documento GWM ${label} C.pdf`,
          contentHash: hash(`contenido-gwm-${label}-c`), extractedText: `Contenido GWM ${label} C.`,
        });
        const extraMember = memberFromCandidate(docC.candidate, { sourceClassification: 'internal', inclusionReason: 'Documento no seleccionado.' });
        opts.governedWorksetMembers = [...canonical, canonicalGovernedMember(extraMember)];
      } else if (label === 'omitted') {
        opts.governedWorksetMembers = [canonical[0]];
      } else if (label === 'reordered') {
        opts.governedWorksetMembers = [...canonical].reverse();
      } else if (label === 'classification') {
        opts.governedWorksetMembers = canonical.map(m => (
          m.document_version_id === memberA.document_version_id ? { ...m, source_classification: 'draft' } : m
        ));
      } else if (label === 'reason') {
        opts.governedWorksetMembers = canonical.map(m => (
          m.document_version_id === memberA.document_version_id
            ? { ...m, inclusion_reason: 'Una justificacion completamente distinta.' }
            : m
        ));
      }

      await assert.rejects(freezeWorkset(pg, opts), /./, `governed_workset_members ${label} divergence must fail closed`);
    }

    const counts = (await pg.query(`
      select
        (select count(*)::int from public.psi_agt002_governed_document_worksets) as worksets,
        (select count(*)::int from public.psi_agt002_governed_document_workset_members) as members,
        (select count(*)::int from public.psi_agt002_governed_document_workset_runs) as runs,
        (select count(*)::int from public.psi_agt002_reanalysis_jobs) as jobs
    `)).rows[0];
    assert.deepEqual(counts, { worksets: 0, members: 0, runs: 0, jobs: 0 }, 'no governed_workset_members divergence may ever leave a partial workset/member/run/job behind');
  } finally {
    await pg.close();
  }
});

test('freeze requires p_frozen_engine_input.schema_version to be exactly the numeric value 2', async () => {
  const pg = await freshDb();
  try {
    const invalidSchemaVersions = [
      { label: 'schema-1', schemaVersion: 1 },
      { label: 'schema-3', schemaVersion: 3 },
      { label: 'schema-string-2', schemaVersion: '2' },
      { label: 'schema-null', schemaVersion: null },
    ];
    for (const { label, schemaVersion } of invalidSchemaVersions) {
      const doc = await seedOkDocument(pg, {
        sourceDocumentId: `doc-${label}`, name: `Documento ${label}.pdf`,
        contentHash: hash(`contenido-${label}`), extractedText: `Contenido ${label}.`,
      });
      const member = memberFromCandidate(doc.candidate);
      const cv = await recordContextVersion(pg, { snapshotId: S1, idempotencyKey: `ctx-${label}` });

      await assert.rejects(
        freezeWorkset(pg, {
          snapshotId: S1, contextVersionId: cv.id, idempotencyKey: `idem-${label}`, members: [member],
          schemaVersion,
        }),
        /./,
        `schema_version ${JSON.stringify(schemaVersion)} must fail closed`,
      );
    }

    const doc = await seedOkDocument(pg, {
      sourceDocumentId: 'doc-schema-absent', name: 'Documento schema absent.pdf',
      contentHash: hash('contenido-schema-absent'), extractedText: 'Contenido schema absent.',
    });
    const member = memberFromCandidate(doc.candidate);
    const cv = await recordContextVersion(pg, { snapshotId: S1, idempotencyKey: 'ctx-schema-absent' });
    await assert.rejects(
      freezeWorkset(pg, {
        snapshotId: S1, contextVersionId: cv.id, idempotencyKey: 'idem-schema-absent', members: [member],
        omitEngineFields: ['schema_version'],
      }),
      /./,
      'absent schema_version must fail closed',
    );

    const counts = (await pg.query(`
      select
        (select count(*)::int from public.psi_agt002_governed_document_worksets) as worksets,
        (select count(*)::int from public.psi_agt002_governed_document_workset_members) as members,
        (select count(*)::int from public.psi_agt002_governed_document_workset_runs) as runs,
        (select count(*)::int from public.psi_agt002_reanalysis_jobs) as jobs
    `)).rows[0];
    assert.deepEqual(counts, { worksets: 0, members: 0, runs: 0, jobs: 0 }, 'no invalid schema_version may ever leave a partial workset/member/run/job behind');
  } finally {
    await pg.close();
  }
});

test('freeze requires p_frozen_engine_input.document_workset_identity to contain exactly the five canonical keys', async () => {
  const pg = await freshDb();
  try {
    const doc = await seedOkDocument(pg, {
      sourceDocumentId: 'doc-identity-extra', name: 'Documento identity extra.pdf',
      contentHash: hash('contenido-identity-extra'), extractedText: 'Contenido identity extra.',
    });
    const member = memberFromCandidate(doc.candidate);
    const cv = await recordContextVersion(pg, { snapshotId: S1, idempotencyKey: 'ctx-identity-extra' });

    await assert.rejects(
      freezeWorkset(pg, {
        snapshotId: S1, contextVersionId: cv.id, idempotencyKey: 'idem-identity-extra', members: [member],
        identityExtra: { unexpected_key: 'x' },
      }),
      /./,
      'an extra key in document_workset_identity must fail closed',
    );

    const counts = (await pg.query(`
      select
        (select count(*)::int from public.psi_agt002_governed_document_worksets) as worksets,
        (select count(*)::int from public.psi_agt002_governed_document_workset_members) as members,
        (select count(*)::int from public.psi_agt002_governed_document_workset_runs) as runs,
        (select count(*)::int from public.psi_agt002_reanalysis_jobs) as jobs
    `)).rows[0];
    assert.deepEqual(counts, { worksets: 0, members: 0, runs: 0, jobs: 0 }, 'an extra document_workset_identity key must never leave any partial workset/member/run/job behind');
  } finally {
    await pg.close();
  }
});

test('freeze fails closed atomically when p_frozen_engine_input.analysis_context.documents diverges from the canonical selected-member projection', async () => {
  const pg = await freshDb();
  try {
    for (const label of ['absent', 'wrong-type', 'extra', 'omitted', 'reordered', 'classification', 'reason', 'extra-key']) {
      const docA = await seedOkDocument(pg, {
        sourceDocumentId: `doc-ctxdocs-${label}-a`, name: `Documento ctxdocs ${label} A.pdf`,
        contentHash: hash(`contenido-ctxdocs-${label}-a`), extractedText: `Contenido ctxdocs ${label} A.`,
      });
      const docB = await seedOkDocument(pg, {
        sourceDocumentId: `doc-ctxdocs-${label}-b`, name: `Documento ctxdocs ${label} B.pdf`,
        contentHash: hash(`contenido-ctxdocs-${label}-b`), extractedText: `Contenido ctxdocs ${label} B.`,
      });
      const memberA = memberFromCandidate(docA.candidate, { sourceClassification: 'official', inclusionReason: `Razon A ${label}.` });
      const memberB = memberFromCandidate(docB.candidate, { sourceClassification: 'corporate', inclusionReason: `Razon B ${label}.` });
      const members = [memberA, memberB];
      const canonicalDocuments = canonicalGovernedWorksetMembers(members);
      const cv = await recordContextVersion(pg, { snapshotId: S1, idempotencyKey: `ctx-ctxdocs-${label}` });

      const baseContext = { opportunity: { id: O }, snapshotId: S1, canonicalOnly: true, documents: canonicalDocuments };
      let analysisContext;
      if (label === 'absent') {
        analysisContext = { opportunity: { id: O }, snapshotId: S1, canonicalOnly: true };
      } else if (label === 'wrong-type') {
        analysisContext = { ...baseContext, documents: 'not-an-array' };
      } else if (label === 'extra') {
        const docC = await seedOkDocument(pg, {
          sourceDocumentId: `doc-ctxdocs-${label}-c`, name: `Documento ctxdocs ${label} C.pdf`,
          contentHash: hash(`contenido-ctxdocs-${label}-c`), extractedText: `Contenido ctxdocs ${label} C.`,
        });
        const extraMember = memberFromCandidate(docC.candidate, { sourceClassification: 'internal', inclusionReason: 'Documento no seleccionado.' });
        analysisContext = { ...baseContext, documents: [...canonicalDocuments, canonicalGovernedMember(extraMember)] };
      } else if (label === 'omitted') {
        analysisContext = { ...baseContext, documents: [canonicalDocuments[0]] };
      } else if (label === 'reordered') {
        analysisContext = { ...baseContext, documents: [...canonicalDocuments].reverse() };
      } else if (label === 'classification') {
        analysisContext = { ...baseContext, documents: canonicalDocuments.map(d => (
          d.document_version_id === memberA.document_version_id ? { ...d, source_classification: 'draft' } : d
        )) };
      } else if (label === 'reason') {
        analysisContext = { ...baseContext, documents: canonicalDocuments.map(d => (
          d.document_version_id === memberA.document_version_id ? { ...d, inclusion_reason: 'Una justificacion completamente distinta.' } : d
        )) };
      } else if (label === 'extra-key') {
        analysisContext = { ...baseContext, documents: canonicalDocuments.map(d => (
          d.document_version_id === memberA.document_version_id ? { ...d, content_hash: memberA.content_hash } : d
        )) };
      }

      await assert.rejects(
        freezeWorkset(pg, {
          snapshotId: S1, contextVersionId: cv.id, idempotencyKey: `idem-ctxdocs-${label}`, members,
          analysisContext,
        }),
        /./,
        `analysis_context.documents ${label} divergence must fail closed`,
      );
    }

    const counts = (await pg.query(`
      select
        (select count(*)::int from public.psi_agt002_governed_document_worksets) as worksets,
        (select count(*)::int from public.psi_agt002_governed_document_workset_members) as members,
        (select count(*)::int from public.psi_agt002_governed_document_workset_runs) as runs,
        (select count(*)::int from public.psi_agt002_reanalysis_jobs) as jobs
    `)).rows[0];
    assert.deepEqual(counts, { worksets: 0, members: 0, runs: 0, jobs: 0 }, 'no analysis_context.documents divergence may ever leave a partial workset/member/run/job behind');
  } finally {
    await pg.close();
  }
});

test('freeze succeeds with a full valid frozen engine input, and the queued job stores schema_version/engine_identity/analysis_flags/analysis_context/governed_workset_members exactly', async () => {
  const pg = await freshDb();
  try {
    const docA = await seedOkDocument(pg, { sourceDocumentId: 'doc-gwm-happy-a', name: 'Documento feliz A.pdf', contentHash: hash('contenido-feliz-a'), extractedText: 'Contenido feliz A.' });
    const docB = await seedOkDocument(pg, { sourceDocumentId: 'doc-gwm-happy-b', name: 'Documento feliz B.pdf', contentHash: hash('contenido-feliz-b'), extractedText: 'Contenido feliz B.' });
    const memberA = memberFromCandidate(docA.candidate, { sourceClassification: 'official', inclusionReason: 'Pliego vigente feliz.' });
    const memberB = memberFromCandidate(docB.candidate, { sourceClassification: 'corporate', inclusionReason: 'Certificado propio feliz.' });
    const members = [memberA, memberB];
    const cv = await recordContextVersion(pg, { snapshotId: S1, idempotencyKey: 'ctx-gwm-happy' });

    const result = await freezeWorkset(pg, { snapshotId: S1, contextVersionId: cv.id, idempotencyKey: 'idem-gwm-happy', members });
    assert.equal(result.status, 'created');

    const jobRow = (await pg.query(
      `select frozen_engine_input from public.psi_agt002_reanalysis_jobs where id = '${result.reanalysis_job_id}'`,
    )).rows[0];
    const stored = jobRow.frozen_engine_input;
    assert.equal(stored.schema_version, DEFAULT_ENGINE_SCHEMA_VERSION);
    assert.deepEqual(stored.engine_identity, DEFAULT_ENGINE_IDENTITY);
    assert.deepEqual(stored.analysis_flags, DEFAULT_ANALYSIS_FLAGS);
    assert.deepEqual(stored.analysis_context, canonicalAnalysisContext(O, S1, members));
    assert.deepEqual(stored.governed_workset_members, canonicalGovernedWorksetMembersSix(members));
  } finally {
    await pg.close();
  }
});

// ---------------------------------------------------------------------------------------
// Migration 085 (RED): public.psi_backfill_legacy_tender_document_extraction does not exist yet.
// ---------------------------------------------------------------------------------------

test('psi_backfill_legacy_tender_document_extraction rejects a superseded document version atomically', async () => {
  const pg = await freshDb();
  try {
    const v1 = await recordDocumentVersion(pg, {
      sourceDocumentId: 'doc-backfill-1', name: 'Documento backfill.pdf',
      contentHash: hash('contenido-backfill-v1'), extractedText: 'Texto legado backfill v1.',
    });
    // A new version under the SAME normalized name supersedes it (057/065's logical identity).
    await recordDocumentVersion(pg, {
      sourceDocumentId: 'doc-backfill-2', name: 'Documento backfill.pdf',
      contentHash: hash('contenido-backfill-v2'), extractedText: 'Texto legado backfill v2.',
    });

    await assert.rejects(
      backfillLegacyExtraction(pg, { documentVersionId: v1.id, extractedText: 'Texto legado backfill v1.' }),
      /vigente|current/i,
    );

    const rows = (await pg.query(
      `select count(*)::int n from public.psi_tender_document_extractions
       where document_version_id = '${v1.id}' and extractor_version = 'legacy-version-register@1'`,
    )).rows[0];
    assert.equal(rows.n, 0, 'a rejected backfill on a superseded version must leave zero legacy extraction rows behind');
  } finally {
    await pg.close();
  }
});

// ---------------------------------------------------------------------------------------
// Rollback for migration 085 (RED): supabase/rollbacks/085_legacy_extraction_backfill_guard_rollback.sql
// does not exist yet. Read lazily inside the test (not as a module-level const like the
// migrations above) so this single test fails on its own instead of crashing every other
// test in this file with an unreadable-file error.
// ---------------------------------------------------------------------------------------

test('rollback 085 disables the legacy backfill RPC but leaves every already-backfilled legacy extraction row intact', async () => {
  const pg = await freshDb();
  try {
    const version = await recordDocumentVersion(pg, {
      sourceDocumentId: 'doc-rollback-085', name: 'Documento rollback 085.pdf',
      contentHash: hash('contenido-rollback-085'), extractedText: 'Texto de version rollback 085.',
    });
    const legacyText = 'Texto legado backfill rollback 085.';
    const backfill = await backfillLegacyExtraction(pg, { documentVersionId: version.id, extractedText: legacyText });

    const rollback085 = readFileSync(new URL('../supabase/rollbacks/085_legacy_extraction_backfill_guard_rollback.sql', import.meta.url), 'utf8');
    await pg.exec(rollback085);

    const fn = (await pg.query(
      `select to_regprocedure('public.psi_backfill_legacy_tender_document_extraction(uuid,uuid,uuid,text,text,integer,integer,uuid)') is null as removed`,
    )).rows[0];
    assert.equal(fn.removed, true, 'the rollback must disable the legacy backfill write RPC');

    const row = (await pg.query(
      `select extractor_version, parser, status, extracted_text
       from public.psi_tender_document_extractions where id = '${backfill.id}'`,
    )).rows[0];
    assert.ok(row, 'a legacy extraction row already backfilled before rollback must survive rollback: rollback disables the write path, never the stored evidence');
    assert.equal(row.extractor_version, 'legacy-version-register@1');
    assert.equal(row.parser, 'legacy-version-column');
    assert.equal(row.status, 'ok');
    assert.equal(row.extracted_text, legacyText);
  } finally {
    await pg.close();
  }
});
