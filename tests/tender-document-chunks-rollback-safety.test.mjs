import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createHash } from 'node:crypto';

const migration = readFileSync(new URL('../supabase/migrations/052_tender_document_chunks.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollbacks/052_tender_document_chunks_rollback.sql', import.meta.url), 'utf8');
const migration026 = readFileSync(new URL('../supabase/migrations/026_tender_document_versions.sql', import.meta.url), 'utf8');

// --- Static shape checks -----------------------------------------------------
assert.match(migration, /create table if not exists public\.psi_tender_document_chunks/i);
assert.match(migration, /append-only/i);
assert.match(migration, /chunk_id text not null unique/i);
assert.match(migration, /grant execute[\s\S]*service_role/i);
assert.match(migration, /revoke all on table public\.psi_tender_document_chunks/i);

// The rollback must disable the new write RPC but never touch stored evidence:
// no DROP TABLE, DELETE or TRUNCATE against the chunks table (or any other table).
assert.doesNotMatch(rollback, /drop\s+table/i);
assert.doesNotMatch(rollback, /delete\s+from/i);
assert.doesNotMatch(rollback, /truncate/i);
assert.match(rollback, /revoke all on function public\.psi_record_tender_document_chunk/i);
assert.match(rollback, /drop function if exists public\.psi_record_tender_document_chunk/i);

// The migration itself must not delete/truncate any pre-existing evidence table either.
assert.doesNotMatch(migration, /delete\s+from\s+public\.psi_tender_document_versions|truncate\s+.*psi_tender_document_versions/i);
assert.doesNotMatch(migration, /delete\s+from\s+public\.psi_tender_document_snapshots|truncate\s+.*psi_tender_document_snapshots/i);

// --- Behavioral rollback safety: applying the rollback preserves rows --------
const ids = {
  actor: '11111111-1111-4111-8111-111111111111',
  opportunity: '44444444-4444-4444-8444-444444444444',
  tender: '55555555-5555-4555-8555-555555555555',
};
const hash = text => createHash('sha256').update(text).digest('hex');
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];

const db = new PGlite();
await db.exec(`
  create role authenticated; create role service_role; create role anon;
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
  create table public.psi_tender_document_snapshots (
    id uuid primary key,
    opportunity_id uuid not null references public.psi_sales_opportunities(id),
    tender_id uuid not null references public.psi_public_tenders(id)
  );
  insert into public.psi_sales_opportunities (id) values ('${ids.opportunity}');
  insert into public.psi_public_tenders (id, converted_opportunity_id) values ('${ids.tender}', '${ids.opportunity}');
  insert into public.psi_sales_profiles (id, active, identity_type) values ('${ids.actor}', true, 'human');
`);
await db.exec(migration026);
await db.exec(migration);

const version = await one(db, `select public.psi_record_tender_document_version(
  $1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,$9::bigint,$10::text,$11::text,$12::text,$13::uuid
) as result`, [
  ids.opportunity, ids.tender, 'secop', 'official-42', 'Pliego.pdf', hash('doc-v1'),
  `tender-documents/${ids.opportunity}/official-42/a.pdf`, 'application/pdf', 1024, 'pliego', 'Texto oficial', null, ids.actor,
]);
const documentVersionId = version.result.id;

const chunk = await one(db, `select public.psi_record_tender_document_chunk(
  $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::text,$7::text,$8::text,$9::integer,$10::text,
  $11::integer,$12::integer,$13::integer,$14::text,$15::text,$16::boolean,$17::text,$18::boolean,$19::uuid
) as result`, [
  ids.opportunity, ids.tender, documentVersionId, null, 'chunk:doc-v1:p1:s1:c0', 'evidence:chunk:doc-v1:p1:s1:c0',
  'pliego', 'Pliego.pdf', 1, hash('doc-v1'), 1, 1, 0, 'Objeto del contrato.', hash('Objeto del contrato.'),
  true, 'base', false, ids.actor,
]);
const chunkId = chunk.result.id;

const beforeRollback = {
  chunks: Number((await one(db, 'select count(*)::int as count from public.psi_tender_document_chunks')).count),
  versions: Number((await one(db, 'select count(*)::int as count from public.psi_tender_document_versions')).count),
};

await db.exec(rollback);

// Table, row and all evidence columns survive rollback exactly as they were.
assert.equal(Number((await one(db, 'select count(*)::int as count from public.psi_tender_document_chunks')).count), beforeRollback.chunks);
assert.equal(Number((await one(db, 'select count(*)::int as count from public.psi_tender_document_versions')).count), beforeRollback.versions);
const survivingChunk = await one(db, 'select text_content, chunk_hash, evidence_ref from public.psi_tender_document_chunks where id = $1', [chunkId]);
assert.equal(survivingChunk.text_content, 'Objeto del contrato.');
assert.equal(survivingChunk.evidence_ref, 'evidence:chunk:doc-v1:p1:s1:c0');

// The write interface is disabled: the RPC no longer exists.
assert.equal((await one(db, "select to_regprocedure('public.psi_record_tender_document_chunk(uuid,uuid,uuid,uuid,text,text,text,text,integer,text,integer,integer,integer,text,text,boolean,text,boolean,uuid)') is null as removed")).removed, true);

// The append-only guard against direct mutation still holds after rollback.
await assert.rejects(db.exec(`update public.psi_tender_document_chunks set text_content = 'mutado' where id = '${chunkId}'`), /append-only/i);

await db.close();

console.log('AGT-002 tender document chunks rollback safety contract passed');
