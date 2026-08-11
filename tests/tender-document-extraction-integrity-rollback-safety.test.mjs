import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createHash } from 'node:crypto';

const migration = readFileSync(new URL('../supabase/migrations/065_tender_document_extraction_integrity.sql', import.meta.url), 'utf8');
const migrationForPGlite = migration
  .replace(/create schema if not exists extensions;\s*create extension if not exists pgcrypto with schema extensions;\s*/i, '')
  .replace(/encode\(extensions\.digest\(convert_to\(extracted_text, 'UTF8'\), 'sha256'\), 'hex'\)/g, 'text_hash')
  .replace(/encode\(extensions\.digest\(convert_to\(p_extracted_text, 'UTF8'\), 'sha256'\), 'hex'\)/g, 'p_text_hash');
const rollback = readFileSync(new URL('../supabase/rollbacks/065_tender_document_extraction_integrity_rollback.sql', import.meta.url), 'utf8');
const migration026 = readFileSync(new URL('../supabase/migrations/026_tender_document_versions.sql', import.meta.url), 'utf8');
const migration057 = readFileSync(new URL('../supabase/migrations/057_tender_document_logical_identity.sql', import.meta.url), 'utf8');

// --- Static shape checks -----------------------------------------------------
assert.match(migration, /create table if not exists public\.psi_tender_document_extractions/i);
assert.match(migration, /append-only/i);
assert.match(migration, /unique \(document_version_id, extractor_version\)/i);
assert.match(migration, /grant execute[\s\S]*service_role/i);
assert.match(migration, /revoke all on table public\.psi_tender_document_extractions/i);
assert.match(migration, /status in \('ok', 'gap'\)/i);

// The rollback must disable the new write RPC but never touch stored evidence: no DROP
// TABLE, DELETE or TRUNCATE against the extractions table (or any other table).
assert.doesNotMatch(rollback, /drop\s+table/i);
assert.doesNotMatch(rollback, /delete\s+from/i);
assert.doesNotMatch(rollback, /truncate/i);
assert.match(rollback, /revoke all on function public\.psi_record_tender_document_extraction/i);
assert.match(rollback, /drop function if exists public\.psi_record_tender_document_extraction/i);

// The migration itself must not delete/truncate any pre-existing evidence table either.
assert.doesNotMatch(migration, /delete\s+from\s+public\.psi_tender_document_versions|truncate\s+.*psi_tender_document_versions/i);

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
  insert into public.psi_sales_opportunities (id) values ('${ids.opportunity}');
  insert into public.psi_public_tenders (id, converted_opportunity_id) values ('${ids.tender}', '${ids.opportunity}');
  insert into public.psi_sales_profiles (id, active, identity_type) values ('${ids.actor}', true, 'human');
`);
await db.exec(migration026);
await db.exec(migration057);
await db.exec(migrationForPGlite);

const version = await one(db, `select public.psi_record_tender_document_version(
  $1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,$9::bigint,$10::text,$11::text,$12::text,$13::uuid
) as result`, [
  ids.opportunity, ids.tender, 'secop', 'official-42', 'Pliego.pdf', hash('doc-v1'),
  `tender-documents/${ids.opportunity}/official-42/a.pdf`, 'application/pdf', 1024, 'pliego', 'Texto oficial', null, ids.actor,
]);
const documentVersionId = version.result.id;

const text = 'Objeto del contrato: vigilancia física integral.';
const extraction = await one(db, `select public.psi_record_tender_document_extraction(
  $1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::text,$8::text,$9::integer,$10::integer,$11::jsonb,$12::text,$13::uuid
) as result`, [
  ids.opportunity, ids.tender, documentVersionId, 'tender-document-text-extraction@2', 'ok', 'pdf-parse',
  text, hash(text), text.length, Buffer.byteLength(text, 'utf8'), JSON.stringify({ num_pages: 1 }), null, ids.actor,
]);
const extractionId = extraction.result.id;

const beforeRollback = {
  extractions: Number((await one(db, 'select count(*)::int as count from public.psi_tender_document_extractions')).count),
  versions: Number((await one(db, 'select count(*)::int as count from public.psi_tender_document_versions')).count),
};

await db.exec(rollback);

// Table, row and all evidence columns survive rollback exactly as they were.
assert.equal(Number((await one(db, 'select count(*)::int as count from public.psi_tender_document_extractions')).count), beforeRollback.extractions);
assert.equal(Number((await one(db, 'select count(*)::int as count from public.psi_tender_document_versions')).count), beforeRollback.versions);
const survivingExtraction = await one(db, 'select extracted_text, text_hash, status from public.psi_tender_document_extractions where id = $1', [extractionId]);
assert.equal(survivingExtraction.extracted_text, text);
assert.equal(survivingExtraction.text_hash, hash(text));
assert.equal(survivingExtraction.status, 'ok');

// The write interface is disabled: the RPC no longer exists.
assert.equal((await one(db, "select to_regprocedure('public.psi_record_tender_document_extraction(uuid,uuid,uuid,text,text,text,text,text,integer,integer,jsonb,text,uuid)') is null as removed")).removed, true);

// The append-only guard against direct mutation still holds after rollback.
await assert.rejects(db.exec(`update public.psi_tender_document_extractions set extracted_text = 'mutado' where id = '${extractionId}'`), /append-only/i);

await db.close();

console.log('AGT-002 tender document extraction integrity rollback safety contract passed');
