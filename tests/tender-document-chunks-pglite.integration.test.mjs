import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { buildAtomicApplySql, buildStateSql, classifyState } from '../scripts/agt002-program-migrations.mjs';

const migration026 = readFileSync(new URL('../supabase/migrations/026_tender_document_versions.sql', import.meta.url), 'utf8');
const migration052 = readFileSync(new URL('../supabase/migrations/052_tender_document_chunks.sql', import.meta.url), 'utf8');

const ids = {
  actor: '11111111-1111-4111-8111-111111111111',
  inactiveActor: '22222222-2222-4222-8222-222222222222',
  agentActor: '33333333-3333-4333-8333-333333333333',
  opportunity: '44444444-4444-4444-8444-444444444444',
  tender: '55555555-5555-4555-8555-555555555555',
  opportunity2: '66666666-6666-4666-8666-666666666666',
  tender2: '77777777-7777-4777-8777-777777777777',
  snapshot: '88888888-8888-4888-8888-888888888888',
  snapshot2: '99999999-9999-4999-8999-999999999999',
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
    -- Minimal stand-in for 025's snapshot table: only the columns 052 references.
    create table public.psi_tender_document_snapshots (
      id uuid primary key,
      opportunity_id uuid not null references public.psi_sales_opportunities(id),
      tender_id uuid not null references public.psi_public_tenders(id)
    );
    insert into public.psi_sales_opportunities (id) values ('${ids.opportunity}'), ('${ids.opportunity2}');
    insert into public.psi_public_tenders (id, converted_opportunity_id) values
      ('${ids.tender}', '${ids.opportunity}'), ('${ids.tender2}', '${ids.opportunity2}');
    insert into public.psi_sales_profiles (id, active, identity_type) values
      ('${ids.actor}', true, 'human'),
      ('${ids.inactiveActor}', false, 'human'),
      ('${ids.agentActor}', true, 'agent');
    insert into public.psi_tender_document_snapshots (id, opportunity_id, tender_id) values
      ('${ids.snapshot}', '${ids.opportunity}', '${ids.tender}'),
      ('${ids.snapshot2}', '${ids.opportunity2}', '${ids.tender2}');
  `);
  await db.exec(migration026);
  await db.exec(buildAtomicApplySql('052', migration052));
  const state = (await db.query(buildStateSql('052'))).rows[0];
  assert.equal(classifyState(state), 'applied', `runner state 052 debe reconocer la definición real: ${JSON.stringify(state)}`);
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

async function recordChunk(db, overrides = {}) {
  const input = {
    opportunityId: ids.opportunity, tenderId: ids.tender, documentVersionId: null, snapshotId: null,
    chunkId: 'chunk:doc-v1:p1:s1:c0', evidenceRef: 'evidence:chunk:doc-v1:p1:s1:c0',
    documentType: 'pliego', name: 'Pliego oficial.pdf', version: 1, contentHash: hash('doc-v1'),
    page: 1, section: 1, chunkIndex: 0, text: 'Objeto del contrato: vigilancia física.',
    chunkHash: hash('Objeto del contrato: vigilancia física.'), current: true, precedence: 'base',
    supersededByAddendum: false, actorId: ids.actor, ...overrides,
  };
  return (await one(db, `select public.psi_record_tender_document_chunk(
    $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::text,$7::text,$8::text,$9::integer,$10::text,
    $11::integer,$12::integer,$13::integer,$14::text,$15::text,$16::boolean,$17::text,$18::boolean,$19::uuid
  ) as result`, [
    input.opportunityId, input.tenderId, input.documentVersionId, input.snapshotId, input.chunkId, input.evidenceRef,
    input.documentType, input.name, input.version, input.contentHash, input.page, input.section, input.chunkIndex,
    input.text, input.chunkHash, input.current, input.precedence, input.supersededByAddendum, input.actorId,
  ])).result;
}

await (async function chunksAreAppendOnlyDeduplicateAndAppendNewVersions() {
  const db = await createDatabase();
  const version1 = await recordDocumentVersion(db);

  const first = await recordChunk(db, { documentVersionId: version1.id });
  assert.equal(first.chunk_id, 'chunk:doc-v1:p1:s1:c0');
  assert.equal(first.precedence, 'base');
  assert.equal(first.superseded_by_addendum, false);

  // Same chunk_id + same content re-submitted (e.g. a retried worker phase) is idempotent.
  const retry = await recordChunk(db, { documentVersionId: version1.id });
  assert.equal(retry.id, first.id);
  assert.equal(Number((await one(db, 'select count(*)::int as count from public.psi_tender_document_chunks')).count), 1);

  // Same chunk_id with different content is an integrity violation, not a silent overwrite.
  await assert.rejects(
    () => recordChunk(db, { documentVersionId: version1.id, text: 'Texto distinto', chunkHash: hash('Texto distinto') }),
    /pertenece a otro/i,
  );

  // A second chunk (distinct chunk_index) of the same version appends alongside the first.
  const secondChunk = await recordChunk(db, {
    documentVersionId: version1.id, chunkIndex: 1,
    chunkId: 'chunk:doc-v1:p1:s1:c1', evidenceRef: 'evidence:chunk:doc-v1:p1:s1:c1',
    text: 'Segundo fragmento.', chunkHash: hash('Segundo fragmento.'),
  });
  assert.notEqual(secondChunk.id, first.id);
  assert.equal(Number((await one(db, 'select count(*)::int as count from public.psi_tender_document_chunks')).count), 2);

  // A new document version (distinct document_version_id) appends its own chunks; the
  // prior version's rows are never overwritten or removed — full history is preserved.
  const version2 = await recordDocumentVersion(db, { contentHash: hash('doc-v2'), storagePath: `tender-documents/${ids.opportunity}/official-42/b.pdf`, extractedText: 'Texto actualizado' });
  const versionedChunk = await recordChunk(db, {
    documentVersionId: version2.id, version: 2, contentHash: hash('doc-v2'),
    chunkId: 'chunk:doc-v2:p1:s1:c0', evidenceRef: 'evidence:chunk:doc-v2:p1:s1:c0',
    text: 'Texto actualizado.', chunkHash: hash('Texto actualizado.'),
  });
  assert.notEqual(versionedChunk.document_version_id, first.document_version_id);
  assert.equal(Number((await one(db, 'select count(*)::int as count from public.psi_tender_document_chunks')).count), 3);
  assert.equal(
    Number((await one(db, 'select count(*)::int as count from public.psi_tender_document_chunks where document_version_id = $1', [version1.id])).count),
    2,
    'los chunks de la versión anterior deben seguir existiendo intactos',
  );

  await db.close();
})();

await (async function snapshotCannotCiteChunksFromAnotherOpportunity() {
  const db = await createDatabase();
  const version1 = await recordDocumentVersion(db);

  const withOwnSnapshot = await recordChunk(db, { documentVersionId: version1.id, snapshotId: ids.snapshot });
  assert.equal(withOwnSnapshot.snapshot_id, ids.snapshot);

  await assert.rejects(
    () => recordChunk(db, {
      documentVersionId: version1.id, snapshotId: ids.snapshot2,
      chunkId: 'chunk:doc-v1:p1:s1:c9', evidenceRef: 'evidence:chunk:doc-v1:p1:s1:c9',
    }),
    /otra oportunidad/i,
  );

  await db.close();
})();

await (async function documentVersionMustBelongToTheSameOpportunityAndTender() {
  const db = await createDatabase();
  const version1 = await recordDocumentVersion(db);
  await assert.rejects(
    () => recordChunk(db, { documentVersionId: version1.id, opportunityId: ids.opportunity2, tenderId: ids.tender2 }),
    /no coincide/i,
  );
  await db.close();
})();

await (async function rpcRejectsInvalidInputsAndInactiveOrMissingActors() {
  const db = await createDatabase();
  const version1 = await recordDocumentVersion(db);
  await assert.rejects(() => recordChunk(db, { documentVersionId: version1.id, contentHash: 'not-a-hash' }), /hash/i);
  await assert.rejects(() => recordChunk(db, { documentVersionId: version1.id, chunkHash: 'not-a-hash' }), /hash/i);
  await assert.rejects(() => recordChunk(db, { documentVersionId: version1.id, text: '   ' }), /vacío/i);
  await assert.rejects(() => recordChunk(db, { documentVersionId: version1.id, page: 0 }), /página/i);
  await assert.rejects(() => recordChunk(db, { documentVersionId: version1.id, precedence: 'go' }), /precedencia/i);
  await assert.rejects(() => recordChunk(db, { documentVersionId: version1.id, actorId: ids.inactiveActor }), /actor/i);
  await assert.doesNotReject(() => recordChunk(db, { documentVersionId: version1.id, actorId: ids.agentActor, chunkId: 'chunk:doc-v1:p1:s1:c2', evidenceRef: 'evidence:chunk:doc-v1:p1:s1:c2' }));
  await db.close();
})();

await (async function chunksAreAppendOnlyAtTheStorageLayer() {
  const db = await createDatabase();
  const version1 = await recordDocumentVersion(db);
  const chunk = await recordChunk(db, { documentVersionId: version1.id });
  await assert.rejects(db.exec(`update public.psi_tender_document_chunks set text_content = 'mutado' where id = '${chunk.id}'`), /append-only/i);
  await assert.rejects(db.exec(`delete from public.psi_tender_document_chunks where id = '${chunk.id}'`), /append-only/i);
  await db.close();
})();

await (async function rlsAndRoleBoundariesHold() {
  const db = await createDatabase();
  const version1 = await recordDocumentVersion(db);

  await db.exec('set role service_role');
  const asServiceRole = await recordChunk(db, { documentVersionId: version1.id });
  assert.ok(asServiceRole.id);
  await assert.rejects(
    () => db.query(`insert into public.psi_tender_document_chunks (
      opportunity_id, tender_id, document_version_id, chunk_id, evidence_ref, document_type, name, version,
      content_hash, page, section, chunk_index, text_content, char_count, chunk_hash, current, precedence,
      superseded_by_addendum, actor_id
    ) values (
      '${ids.opportunity}', '${ids.tender}', '${version1.id}', 'chunk:direct', 'evidence:chunk:direct', 'pliego', 'x', 1,
      '${hash('x')}', 1, 1, 0, 'texto', 5, '${hash('texto')}', true, 'base', false, '${ids.actor}'
    )`),
    /permission denied/i,
  );
  await db.exec('reset role; set role authenticated');
  await assert.rejects(() => recordChunk(db, { documentVersionId: version1.id, chunkId: 'chunk:auth', evidenceRef: 'evidence:chunk:auth' }), /permission denied/i);
  await assert.rejects(() => db.query('select id from public.psi_tender_document_chunks limit 1'), /permission denied/i);
  await db.exec('reset role; set role anon');
  await assert.rejects(() => recordChunk(db, { documentVersionId: version1.id, chunkId: 'chunk:anon', evidenceRef: 'evidence:chunk:anon' }), /permission denied/i);
  await assert.rejects(() => db.query('select id from public.psi_tender_document_chunks limit 1'), /permission denied/i);
  await db.exec('reset role');

  await db.close();
})();

console.log('PGlite tender document chunks integration passed');
