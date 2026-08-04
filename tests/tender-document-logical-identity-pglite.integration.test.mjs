import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Observed production bug: after refresh, current UI document rows went from 31 to 45
// (Anexo 23->33, Estudios 4->6, Pliego 4->6). Root cause at the DB layer: the
// psi_record_tender_document_version RPC and the "one current" unique index were both
// keyed only by (opportunity_id, source, source_document_id). When a document's
// source_document_id rotated (e.g. an ESU/SECOP fallback id derived from a tokenized
// URL, or a re-import that minted a fresh id), the RPC treated it as a brand new
// logical document instead of recognizing it as the same file, so both the old and
// the new source_document_id ended up "current" simultaneously. This migration moves
// identity for locking/supersession/uniqueness to (opportunity_id, source, normalized
// filename), while keeping source_document_id for provenance only.

const profileMigration = readFileSync(new URL('../supabase/migrations/012_company_procurement_profile.sql', import.meta.url), 'utf8');
const baseMigration = readFileSync(new URL('../supabase/migrations/026_tender_document_versions.sql', import.meta.url), 'utf8');
const logicalIdentityMigration = readFileSync(new URL('../supabase/migrations/057_tender_document_logical_identity.sql', import.meta.url), 'utf8');
const logicalIdentityRollback = readFileSync(new URL('../supabase/rollbacks/057_tender_document_logical_identity_rollback.sql', import.meta.url), 'utf8');

const ids = {
  actor: '11111111-1111-4111-8111-111111111111',
  opportunity: '44444444-4444-4444-8444-444444444444',
  tender: '55555555-5555-4555-8555-555555555555',
};
const hash = character => character.repeat(64);
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];

async function createDatabase({ applyLogicalIdentityMigration = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role authenticated;
    create role service_role;
    create role anon;
    alter role service_role bypassrls;
    grant service_role to current_user;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
    create function public.psi_sales_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
    create table public.psi_sales_opportunities (id uuid primary key);
    create table public.psi_public_tenders (id uuid primary key, converted_opportunity_id uuid references public.psi_sales_opportunities(id));
    insert into public.psi_sales_opportunities (id) values ('${ids.opportunity}');
    insert into public.psi_public_tenders (id, converted_opportunity_id) values ('${ids.tender}', '${ids.opportunity}');
    create table public.psi_sales_profiles (
      id uuid primary key,
      active boolean not null default true,
      role text not null default 'admin',
      microsoft_email text not null default 'test@example.test',
      identity_type text default 'human'
    );
    insert into public.psi_sales_profiles (id, active, identity_type) values ('${ids.actor}', true, 'human');
  `);
  await db.exec(profileMigration);
  await db.exec(baseMigration);
  if (applyLogicalIdentityMigration) await db.exec(logicalIdentityMigration);
  return db;
}

async function recordTenderDocument(db, overrides = {}) {
  const input = {
    opportunityId: ids.opportunity, tenderId: ids.tender, source: 'secop', sourceDocumentId: 'official-42',
    name: 'Pliego oficial.pdf', contentHash: hash('a'), storagePath: `tender-documents/${ids.opportunity}/official-42/a.pdf`,
    mimeType: 'application/pdf', sizeBytes: 1024, documentType: 'pliego', extractedText: 'Texto oficial',
    sourceUrl: 'https://www.colombiacompra.gov.co/document/official-42', actorId: ids.actor, ...overrides,
  };
  return (await one(db, `select public.psi_record_tender_document_version(
    $1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,$9::bigint,$10::text,$11::text,$12::text,$13::uuid
  ) as result`, [
    input.opportunityId, input.tenderId, input.source, input.sourceDocumentId, input.name, input.contentHash,
    input.storagePath, input.mimeType, input.sizeBytes, input.documentType, input.extractedText, input.sourceUrl, input.actorId,
  ])).result;
}

await (async function rotatedSourceIdSameLogicalNameAndHashReturnsUnchanged() {
  const db = await createDatabase();
  const first = await recordTenderDocument(db, { sourceDocumentId: 'id-rotated-1' });
  assert.equal(first.status, 'created');
  assert.equal(first.version, 1);

  const rotated = await recordTenderDocument(db, { sourceDocumentId: 'id-rotated-2' });
  assert.equal(rotated.status, 'unchanged', 'a rotated source_document_id with the same logical filename and identical content must be recognized as the same document');
  assert.equal(rotated.id, first.id);
  assert.equal(rotated.version, first.version);

  const rows = (await db.query(`select source_document_id, current from public.psi_tender_document_versions where opportunity_id = $1`, [ids.opportunity])).rows;
  assert.equal(rows.length, 1, 'no new row should be inserted for a rotated id carrying identical content');
  assert.equal(rows[0].source_document_id, 'id-rotated-1', 'the original source_document_id is preserved; the rotated id is not adopted for an unchanged document');
  await db.close();
})();

await (async function rotatedSourceIdSameLogicalNameChangedHashSupersedesPriorCurrent() {
  const db = await createDatabase();
  const first = await recordTenderDocument(db, { sourceDocumentId: 'id-rotated-1', contentHash: hash('a'), storagePath: `tender-documents/${ids.opportunity}/id-rotated-1/a.pdf` });
  const updated = await recordTenderDocument(db, {
    sourceDocumentId: 'id-rotated-2', contentHash: hash('b'), storagePath: `tender-documents/${ids.opportunity}/id-rotated-2/b.pdf`,
  });
  assert.equal(updated.status, 'created');
  assert.equal(updated.version, 2, 'version numbering must continue the same logical lineage across a rotated source_document_id');
  assert.equal(updated.supersedes_version_id, first.id);

  const rows = (await db.query(`select id, source_document_id, version, current, content_hash from public.psi_tender_document_versions where opportunity_id = $1 order by version`, [ids.opportunity])).rows;
  assert.equal(rows.length, 2, 'both rows must be preserved append-only; nothing is deleted');
  assert.deepEqual(rows.map(row => ({ source_document_id: row.source_document_id, current: row.current })), [
    { source_document_id: 'id-rotated-1', current: false },
    { source_document_id: 'id-rotated-2', current: true },
  ]);
  assert.equal(rows.filter(row => row.current).length, 1, 'exactly one current row must remain for the logical document even though its source_document_id rotated');
  await db.close();
})();

await (async function distinctFilenamesUnderTheSameSourceNeverCollideOrSupersedeEachOther() {
  const db = await createDatabase();
  const pliego = await recordTenderDocument(db, { sourceDocumentId: 'id-1', name: 'Pliego.pdf', contentHash: hash('1'), storagePath: `tender-documents/${ids.opportunity}/id-1/a.pdf` });
  const anexo = await recordTenderDocument(db, { sourceDocumentId: 'id-2', name: 'Anexo.pdf', contentHash: hash('2'), storagePath: `tender-documents/${ids.opportunity}/id-2/b.pdf` });
  assert.equal(pliego.status, 'created');
  assert.equal(anexo.status, 'created');
  assert.notEqual(pliego.id, anexo.id);
  const currentRows = (await db.query(`select name, current from public.psi_tender_document_versions where opportunity_id = $1 and current`, [ids.opportunity])).rows;
  assert.equal(currentRows.length, 2, 'two genuinely different logical filenames must both remain current, never collapsed');
  await db.close();
})();

await (async function legacySourceIdConstraintsAreRemovedFromTheLogicalNameModel() {
  const db = await createDatabase();
  const schema = await one(db, `select
    to_regclass('public.psi_tender_document_versions_one_current_identity') is null as old_current_index_removed,
    not exists (
      select 1 from pg_constraint
      where conrelid = 'public.psi_tender_document_versions'::regclass
        and conname = 'psi_tender_document_versions_opportunity_id_source_source_d_key'
    ) as old_version_constraint_removed`);
  assert.deepEqual(schema, { old_current_index_removed: true, old_version_constraint_removed: true });

  const first = await recordTenderDocument(db, {
    sourceDocumentId: 'stable-source-id', name: 'Pliego borrador.pdf', contentHash: hash('3'),
    storagePath: `tender-documents/${ids.opportunity}/stable-source-id/draft.pdf`,
  });
  const renamed = await recordTenderDocument(db, {
    sourceDocumentId: 'stable-source-id', name: 'Pliego definitivo.pdf', contentHash: hash('4'),
    storagePath: `tender-documents/${ids.opportunity}/stable-source-id/final.pdf`,
  });
  assert.equal(first.status, 'created');
  assert.equal(renamed.status, 'created', 'the new logical-name model must not be blocked by stale source_document_id uniqueness');
  assert.equal(renamed.version, 1, 'each logical filename owns its own version lineage');
  const currentRows = (await db.query(`select name from public.psi_tender_document_versions where opportunity_id = $1 and current order by name`, [ids.opportunity])).rows;
  assert.equal(currentRows.length, 2);
  await db.close();
})();

await (async function uniqueIndexEnforcesOneCurrentLogicalFilenamePerOpportunityAndSource() {
  const db = await createDatabase();
  await recordTenderDocument(db, { sourceDocumentId: 'id-1', name: 'Pliego Definitivo.pdf', contentHash: hash('1'), storagePath: `tender-documents/${ids.opportunity}/id-1/a.pdf` });
  // Insert as the database owner so the assertion reaches the unique index. The
  // service_role intentionally has no direct INSERT grant and writes only through the RPC.
  await assert.rejects(
    () => db.query(`insert into public.psi_tender_document_versions (
      opportunity_id, tender_id, source, source_document_id, version, name, content_hash, storage_path, mime_type, size_bytes, document_type, extracted_text, current, actor_id
    ) values ('${ids.opportunity}', '${ids.tender}', 'secop', 'id-2-direct', 1, '  pliego definitivo.pdf  ', '${hash('9')}', 'tender-documents/${ids.opportunity}/id-2-direct/z.pdf', 'application/pdf', 1, 'pliego', 'Texto', true, '${ids.actor}')`),
    /duplicate key|unique/i,
    'a second current row with a different-only-in-case/whitespace normalized filename for the same opportunity+source must violate the one-current-logical-filename index'
  );
  await db.close();
})();

await (async function migrationDeterministicallyRepairsPreexistingDuplicateCurrentLogicalFilenames() {
  // Reproduces the actual production bug end-to-end: under the pre-057 schema, the
  // RPC's identity was source_document_id-only, so two rotated ids for the same
  // logical file both legitimately became "current" through the real RPC -- exactly
  // how the 31 -> 45 duplication happened. Migration 057 must then repair this
  // pre-existing state before it can add the new unique index.
  const db = await createDatabase({ applyLogicalIdentityMigration: false });
  const first = await recordTenderDocument(db, { sourceDocumentId: 'id-dup-1', name: 'Anexo tecnico.pdf', contentHash: hash('1'), storagePath: `tender-documents/${ids.opportunity}/id-dup-1/a.pdf` });
  const second = await recordTenderDocument(db, { sourceDocumentId: 'id-dup-2', name: 'Anexo tecnico.pdf', contentHash: hash('2'), storagePath: `tender-documents/${ids.opportunity}/id-dup-2/b.pdf` });

  const beforeRepair = (await db.query(`select id, current from public.psi_tender_document_versions where opportunity_id = $1 and current`, [ids.opportunity])).rows;
  assert.equal(beforeRepair.length, 2, 'sanity check: pre-057 schema reproduces the duplication bug (two current rows for one logical filename)');

  const expectedKeeper = (await one(db, `
    select id from public.psi_tender_document_versions
    where opportunity_id = $1 and current
    order by version desc, created_at desc, id desc
    limit 1
  `, [ids.opportunity])).id;

  await db.exec(logicalIdentityMigration);

  const afterRepair = (await db.query(`select id, current from public.psi_tender_document_versions where opportunity_id = $1 order by version`, [ids.opportunity])).rows;
  assert.equal(afterRepair.length, 2, 'the repair must not delete any row -- history stays append-only');
  assert.equal(afterRepair.filter(row => row.current).length, 1, 'exactly one current row must remain for the logical filename after repair');
  assert.equal(afterRepair.find(row => row.current).id, expectedKeeper, 'the repair must deterministically keep the newest row (version desc, then created_at desc, then id desc)');
  await db.close();
})();

await (async function rollbackRestores026IdentityWithoutDeletingHistory() {
  const db = await createDatabase();
  const first = await recordTenderDocument(db, {
    sourceDocumentId: 'id-before-rollback',
    name: 'Pliego rollback.pdf',
    contentHash: hash('7'),
  });

  await db.exec(logicalIdentityRollback);

  const structure = await one(db, `select
    to_regclass('public.psi_tender_document_versions_one_current_logical_name') is null as logical_index_removed,
    to_regclass('public.psi_tender_document_versions_one_current_identity') is not null as source_index_restored,
    exists (
      select 1 from pg_constraint
      where conrelid = 'public.psi_tender_document_versions'::regclass
        and conname = 'psi_tender_document_versions_opportunity_id_source_source_d_key'
    ) as source_version_constraint_restored,
    to_regprocedure('public.psi_normalize_tender_document_name(text)') is null as helper_removed`);
  assert.deepEqual(structure, {
    logical_index_removed: true,
    source_index_restored: true,
    source_version_constraint_restored: true,
    helper_removed: true,
  });

  const rotated = await recordTenderDocument(db, {
    sourceDocumentId: 'id-after-rollback',
    name: 'Pliego rollback.pdf',
    contentHash: hash('7'),
    storagePath: `tender-documents/${ids.opportunity}/id-after-rollback/a.pdf`,
  });
  assert.equal(rotated.status, 'created', 'rollback must restore the source_document_id identity behavior from migration 026');

  const rows = (await db.query(`select id, current from public.psi_tender_document_versions where opportunity_id = $1`, [ids.opportunity])).rows;
  assert.equal(rows.length, 2, 'rollback must preserve the pre-rollback row and append the new row; no history is deleted');
  assert.ok(rows.some(row => row.id === first.id));
  await db.close();
})();

console.log('PGlite tender document logical-identity migration and RPC behavior passed');
