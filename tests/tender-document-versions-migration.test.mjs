import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';

const migrationPath = new URL('../supabase/migrations/026_tender_document_versions.sql', import.meta.url);
assert.equal(existsSync(migrationPath), true, 'La migración 026 debe existir.');
const migration = readFileSync(migrationPath, 'utf8');

for (const token of [
  'create table if not exists public.psi_company_procurement_documents',
  'document_type text not null',
  'display_name text not null',
  'issued_at date not null',
  'expires_at date',
  'version integer not null',
  'content_hash text not null',
  'storage_path text not null',
  'mime_type text not null',
  'size_bytes bigint not null',
  'current boolean not null default true',
  'uploaded_by uuid not null references public.psi_sales_profiles(id)',
  'created_at timestamptz not null default now()',
  'updated_at timestamptz not null default now()',
  'enable row level security',
  'revoke all on table public.psi_company_procurement_documents from public',
  'revoke all on table public.psi_company_procurement_documents from authenticated',
  'revoke all on table public.psi_company_procurement_documents from service_role',
  'psi_record_company_procurement_document',
  'security definer',
  'set search_path = public, pg_temp',
  'p_replace_document_id uuid default null',
  "p_storage_path not like 'company-profile/%'",
  "p_content_hash !~ '^[0-9a-f]{64}$'",
  'p_size_bytes > 50 * 1024 * 1024',
  "v_document_type = 'rup'",
  'lock table public.psi_company_procurement_documents in share row exclusive mode',
  'max(version)',
  'grant execute on function public.psi_record_company_procurement_document',
  'to service_role',
]) assert.match(migration, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `migration missing marker: ${token}`);

assert.match(migration, /check \(content_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/i);
assert.match(migration, /check \(storage_path like 'company-profile\/%'\)/i);
assert.match(migration, /check \(size_bytes > 0 and size_bytes <= 50 \* 1024 \* 1024\)/i);
assert.match(migration, /unique \(document_type, version\)/i);
assert.match(migration, /unique \(document_type, content_hash\)/i, 'El hash debe ser idempotente dentro del tipo de documento.');
assert.match(migration, /current` means latest registered version, not temporal validity/i);
assert.doesNotMatch(migration, /p_expires_at\s*<\s*current_date/i, 'La expiración temporal no puede impedir el registro.');
assert.match(migration, /revoke all on function public\.psi_record_company_procurement_document[\s\S]*from authenticated/i);
assert.match(migration, /grant execute on function public\.psi_record_company_procurement_document[\s\S]*to service_role/i);

for (const token of [
  'create table if not exists public.psi_tender_document_versions',
  'opportunity_id uuid not null references public.psi_sales_opportunities(id)',
  'tender_id uuid not null references public.psi_public_tenders(id)',
  'source text not null',
  'source_document_id text not null',
  'version integer not null',
  'supersedes_version_id uuid references public.psi_tender_document_versions(id)',
  'name text not null',
  'content_hash text not null',
  'storage_path text not null',
  'mime_type text not null',
  'size_bytes bigint not null',
  'document_type text not null',
  'extracted_text text',
  'source_url text',
  'current boolean not null default true',
  'actor_id uuid not null references public.psi_sales_profiles(id)',
  'unique (opportunity_id, source, source_document_id, version)',
  'psi_tender_document_versions_one_current_identity',
  'psi_record_tender_document_version',
  'pg_advisory_xact_lock',
  'security definer',
  'set search_path = public, pg_temp',
  "p_storage_path not like 'tender-documents/%'",
  "p_content_hash !~ '^[0-9a-f]{64}$'",
  'p_size_bytes > 50 * 1024 * 1024',
  "coalesce(p.identity_type, 'human') in ('human', 'agent')",
  "'status', 'unchanged'",
  'grant execute on function public.psi_record_tender_document_version',
  'to service_role',
]) assert.match(migration, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `tender version migration missing marker: ${token}`);

assert.match(migration, /check \(content_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/i);
assert.match(migration, /check \(storage_path like 'tender-documents\/%'[\s\S]*?\)/i);
assert.match(migration, /check \(size_bytes > 0 and size_bytes <= 50 \* 1024 \* 1024\)/i);
assert.match(migration, /create unique index if not exists psi_tender_document_versions_one_current_identity[\s\S]*where current/i);
assert.match(migration, /revoke all on table public\.psi_tender_document_versions from authenticated/i);
assert.match(migration, /revoke all on table public\.psi_tender_document_versions from service_role[\s\S]*grant select on table public\.psi_tender_document_versions to service_role/i, 'service_role sólo debe recuperar SELECT directo.');
assert.match(migration, /extracted_text text not null check \(nullif\(btrim\(extracted_text\), ''\) is not null and octet_length\(extracted_text\) <= 10 \* 1024 \* 1024\)/i);
assert.match(migration, /psi_is_public_https_url/i, 'La URL persistida debe usar una política SQL pública y HTTPS.');
assert.doesNotMatch(migration, /\^https\?\:\/\//i, 'La persistencia no puede admitir HTTP.');
for (const marker of ['username', 'password', 'port', 'private', 'loopback', 'link-local', 'ula', 'ipv4-mapped']) {
  assert.match(migration, new RegExp(marker, 'i'), `La política SQL debe documentar o validar ${marker}.`);
}
assert.match(migration, /if v_previous\.id is not null then[\s\S]*set current = false/i, 'La desactivación debe depender de una versión previa real, no de FOUND tras un agregado.');
assert.match(migration, /jsonb_build_array\(p_opportunity_id, v_source, v_source_document_id\)::text/i, 'El lock debe serializar una identidad sin delimitadores ambiguos.');
assert.match(migration, /revoke all on function public\.psi_record_tender_document_version[\s\S]*from authenticated/i);

console.log('tender document versions migration contract passed');
