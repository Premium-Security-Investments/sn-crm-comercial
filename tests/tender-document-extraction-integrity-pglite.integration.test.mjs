import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const migration026 = readFileSync(new URL('../supabase/migrations/026_tender_document_versions.sql', import.meta.url), 'utf8');
const migration057 = readFileSync(new URL('../supabase/migrations/057_tender_document_logical_identity.sql', import.meta.url), 'utf8');
const migration065Production = readFileSync(new URL('../supabase/migrations/065_tender_document_extraction_integrity.sql', import.meta.url), 'utf8');
assert.match(migration065Production, /create extension if not exists pgcrypto with schema extensions/i);
assert.match(migration065Production, /text_hash\s*=\s*encode\(extensions\.digest\(convert_to\(extracted_text/i);
assert.match(migration065Production, /p_text_hash\s*<>\s*encode\(extensions\.digest\(convert_to\(p_extracted_text/i);
// PGlite does not ship pgcrypto. Neutralize only the two digest expressions in this
// integration fixture; production SQL above is asserted to contain both storage/RPC checks.
const migration065 = migration065Production
  .replace(/create schema if not exists extensions;\s*create extension if not exists pgcrypto with schema extensions;\s*/i, '')
  .replace(/encode\(extensions\.digest\(convert_to\(extracted_text, 'UTF8'\), 'sha256'\), 'hex'\)/g, 'text_hash')
  .replace(/encode\(extensions\.digest\(convert_to\(p_extracted_text, 'UTF8'\), 'sha256'\), 'hex'\)/g, 'p_text_hash');

const ids = {
  actor: '11111111-1111-4111-8111-111111111111',
  inactiveActor: '22222222-2222-4222-8222-222222222222',
  agentActor: '33333333-3333-4333-8333-333333333333',
  opportunity: '44444444-4444-4444-8444-444444444444',
  tender: '55555555-5555-4555-8555-555555555555',
  opportunity2: '66666666-6666-4666-8666-666666666666',
  tender2: '77777777-7777-4777-8777-777777777777',
};
const hash = text => createHash('sha256').update(text).digest('hex');
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];

async function createDatabase() {
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
    create table public.psi_sales_profiles (
      id uuid primary key, active boolean not null default true, role text not null default 'admin',
      microsoft_email text not null default 'test@example.test', identity_type text default 'human'
    );
    insert into public.psi_sales_opportunities (id) values ('${ids.opportunity}'), ('${ids.opportunity2}');
    insert into public.psi_public_tenders (id, converted_opportunity_id) values
      ('${ids.tender}', '${ids.opportunity}'), ('${ids.tender2}', '${ids.opportunity2}');
    insert into public.psi_sales_profiles (id, active, identity_type) values
      ('${ids.actor}', true, 'human'),
      ('${ids.inactiveActor}', false, 'human'),
      ('${ids.agentActor}', true, 'agent');
  `);
  await db.exec(migration026);
  await db.exec(migration057);
  await db.exec(migration065);
  return db;
}

async function recordDocumentVersion(db, overrides = {}) {
  const input = {
    opportunityId: ids.opportunity, tenderId: ids.tender, source: 'secop', sourceDocumentId: 'official-42',
    name: 'Pliego oficial.pdf', contentHash: hash('doc-v1'), storagePath: `tender-documents/${ids.opportunity}/official-42/a.pdf`,
    mimeType: 'application/pdf', sizeBytes: 1024, documentType: 'pliego', extractedText: 'Texto oficial',
    sourceUrl: null, actorId: ids.actor, ...overrides,
  };
  return (await one(db, `select public.psi_record_tender_document_version(
    $1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,$9::bigint,$10::text,$11::text,$12::text,$13::uuid
  ) as result`, [
    input.opportunityId, input.tenderId, input.source, input.sourceDocumentId, input.name, input.contentHash,
    input.storagePath, input.mimeType, input.sizeBytes, input.documentType, input.extractedText, input.sourceUrl, input.actorId,
  ])).result;
}

function okOverrides(overrides = {}) {
  const text = overrides.extractedText ?? 'Objeto del contrato: vigilancia física.';
  return {
    opportunityId: ids.opportunity, tenderId: ids.tender, documentVersionId: null,
    extractorVersion: 'tender-document-text-extraction@2', status: 'ok', parser: 'pdf-parse',
    extractedText: text, textHash: hash(text), charCount: text.length, textByteCount: Buffer.byteLength(text, 'utf8'),
    metadata: { num_pages: 3 }, gapReason: null, actorId: ids.actor,
    ...overrides,
  };
}

async function recordExtraction(db, overrides = {}) {
  const input = okOverrides(overrides);
  return (await one(db, `select public.psi_record_tender_document_extraction(
    $1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::text,$8::text,$9::integer,$10::integer,$11::jsonb,$12::text,$13::uuid
  ) as result`, [
    input.opportunityId, input.tenderId, input.documentVersionId, input.extractorVersion, input.status, input.parser,
    input.extractedText, input.textHash, input.charCount, input.textByteCount, JSON.stringify(input.metadata), input.gapReason, input.actorId,
  ])).result;
}

await (async function extractionsAreAppendOnlyIdempotentAndDetectContentCollisions() {
  const db = await createDatabase();
  const version1 = await recordDocumentVersion(db);

  const first = await recordExtraction(db, { documentVersionId: version1.id });
  assert.equal(first.status, 'ok');
  assert.equal(first.parser, 'pdf-parse');

  // Same (document_version_id, extractor_version) key + identical payload is idempotent.
  const retry = await recordExtraction(db, { documentVersionId: version1.id });
  assert.equal(retry.id, first.id);
  assert.equal(Number((await one(db, 'select count(*)::int as count from public.psi_tender_document_extractions')).count), 1);

  // Same key with a different payload is an integrity violation, not a silent overwrite.
  await assert.rejects(
    () => recordExtraction(db, { documentVersionId: version1.id, extractedText: 'Texto distinto que cambia el hash.' }),
    /contenido distinto/i,
  );

  // A different extractor_version for the same document_version_id appends a new row.
  const upgraded = await recordExtraction(db, { documentVersionId: version1.id, extractorVersion: 'tender-document-text-extraction@3' });
  assert.notEqual(upgraded.id, first.id);
  assert.equal(Number((await one(db, 'select count(*)::int as count from public.psi_tender_document_extractions')).count), 2);

  await db.close();
})();

await (async function gapExtractionsAreRecordedHonestlyWithZeroedCountsAndNoText() {
  const db = await createDatabase();
  const version1 = await recordDocumentVersion(db, { extractedText: null, sourceDocumentId: 'gap-source', name: 'Documento sin texto.pdf' });
  const storedVersion = await one(db, `select extracted_text from public.psi_tender_document_versions where id = '${version1.id}'`);
  assert.equal(storedVersion.extracted_text, null, 'una versión gap conserva el binario sin texto legado ficticio');
  const gap = await recordExtraction(db, {
    documentVersionId: version1.id, status: 'gap', parser: 'pdf', extractedText: null, textHash: null,
    charCount: 0, textByteCount: 0, gapReason: 'extraction_error', metadata: { gap_reason: 'extraction_error' },
  });
  assert.equal(gap.status, 'gap');
  assert.equal(gap.gap_reason, 'extraction_error');
  assert.equal(gap.text_hash, null);
  assert.equal(gap.char_count, 0);

  // Idempotent retry of the same gap payload returns the existing row.
  const retry = await recordExtraction(db, {
    documentVersionId: version1.id, status: 'gap', parser: 'pdf', extractedText: null, textHash: null,
    charCount: 0, textByteCount: 0, gapReason: 'extraction_error', metadata: { gap_reason: 'extraction_error' },
  });
  assert.equal(retry.id, gap.id);
  await db.close();
})();

await (async function documentVersionMustBelongToTheSameOpportunityAndTender() {
  const db = await createDatabase();
  const version1 = await recordDocumentVersion(db);
  await assert.rejects(
    () => recordExtraction(db, { documentVersionId: version1.id, opportunityId: ids.opportunity2, tenderId: ids.tender2 }),
    /no coincide/i,
  );
  await db.close();
})();

await (async function rpcRejectsInvalidInputsAndInactiveOrMissingActors() {
  const db = await createDatabase();
  const version1 = await recordDocumentVersion(db);
  await assert.rejects(() => recordExtraction(db, { documentVersionId: version1.id, status: 'unknown' }), /ok o gap/i);
  await assert.rejects(() => recordExtraction(db, { documentVersionId: version1.id, textHash: 'not-a-hash' }), /hash/i);
  await assert.rejects(() => recordExtraction(db, { documentVersionId: version1.id, extractedText: '' }), /texto no vacío/i);
  await assert.rejects(() => recordExtraction(db, { documentVersionId: version1.id, charCount: 999 }), /conteo de caracteres/i);
  await assert.rejects(
    () => recordExtraction(db, { documentVersionId: version1.id, status: 'gap', extractedText: null, textHash: null, charCount: 0, textByteCount: 0, gapReason: null }),
    /gap_reason/i,
  );
  await assert.rejects(() => recordExtraction(db, { documentVersionId: version1.id, actorId: ids.inactiveActor }), /actor/i);
  await assert.doesNotReject(() => recordExtraction(db, { documentVersionId: version1.id, actorId: ids.agentActor, extractorVersion: 'tender-document-text-extraction@agent' }));
  await assert.rejects(() => recordExtraction(db, { documentVersionId: '00000000-0000-4000-8000-000000000000' }), /no existe/i);
  await db.close();
})();

await (async function extractionsAreAppendOnlyAtTheStorageLayer() {
  const db = await createDatabase();
  const version1 = await recordDocumentVersion(db);
  const extraction = await recordExtraction(db, { documentVersionId: version1.id });
  await assert.rejects(db.exec(`update public.psi_tender_document_extractions set extracted_text = 'mutado' where id = '${extraction.id}'`), /append-only/i);
  await assert.rejects(db.exec(`delete from public.psi_tender_document_extractions where id = '${extraction.id}'`), /append-only/i);
  await db.close();
})();

await (async function checkConstraintEnforcesHonestOkGapShapeAtTheStorageLayer() {
  const db = await createDatabase();
  const version1 = await recordDocumentVersion(db);
  // Direct inserts (as table owner, bypassing the governed RPC) still must satisfy the
  // CHECK constraint: an 'ok' row can never carry null/blank text, and a 'gap' row can
  // never carry text or a hash. This is a storage-layer guarantee, not just RPC discipline.
  await assert.rejects(db.query(`insert into public.psi_tender_document_extractions (
      opportunity_id, tender_id, document_version_id, extractor_version, status, parser,
      extracted_text, text_hash, char_count, text_byte_count, metadata, gap_reason, actor_id
    ) values ($1,$2,$3,'x@1','ok','pdf',null,null,0,0,'{}'::jsonb,null,$4)`,
    [ids.opportunity, ids.tender, version1.id, ids.actor]));
  await assert.rejects(db.query(`insert into public.psi_tender_document_extractions (
      opportunity_id, tender_id, document_version_id, extractor_version, status, parser,
      extracted_text, text_hash, char_count, text_byte_count, metadata, gap_reason, actor_id
    ) values ($1,$2,$3,'x@2','gap','pdf','texto','${hash('texto')}',5,5,'{}'::jsonb,'extraction_error',$4)`,
    [ids.opportunity, ids.tender, version1.id, ids.actor]));
  await db.close();
})();

await (async function rlsAndRoleBoundariesHold() {
  const db = await createDatabase();
  const version1 = await recordDocumentVersion(db);

  await db.exec('set role service_role');
  const asServiceRole = await recordExtraction(db, { documentVersionId: version1.id });
  assert.ok(asServiceRole.id);
  const selected = await db.query('select id from public.psi_tender_document_extractions limit 1');
  assert.equal(selected.rows.length, 1);
  await assert.rejects(
    () => db.query(`insert into public.psi_tender_document_extractions (
      opportunity_id, tender_id, document_version_id, extractor_version, status, parser,
      extracted_text, text_hash, char_count, text_byte_count, metadata, gap_reason, actor_id
    ) values ('${ids.opportunity}', '${ids.tender}', '${version1.id}', 'direct@1', 'ok', 'pdf', 'texto', '${hash('texto')}', 5, 5, '{}'::jsonb, null, '${ids.actor}')`),
    /permission denied/i,
  );
  await db.exec('reset role; set role authenticated');
  await assert.rejects(() => recordExtraction(db, { documentVersionId: version1.id, extractorVersion: 'auth@1' }), /permission denied/i);
  await assert.rejects(() => db.query('select id from public.psi_tender_document_extractions limit 1'), /permission denied/i);
  await db.exec('reset role; set role anon');
  await assert.rejects(() => recordExtraction(db, { documentVersionId: version1.id, extractorVersion: 'anon@1' }), /permission denied/i);
  await assert.rejects(() => db.query('select id from public.psi_tender_document_extractions limit 1'), /permission denied/i);
  await db.exec('reset role');

  await db.close();
})();

console.log('PGlite tender document extraction integrity integration passed');
