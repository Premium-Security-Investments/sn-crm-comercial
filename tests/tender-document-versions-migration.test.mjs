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
  'max(version)',
  'grant execute on function public.psi_record_company_procurement_document',
  'to service_role',
]) assert.match(migration, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `migration missing marker: ${token}`);

assert.match(migration, /check \(content_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/i);
assert.match(migration, /check \(storage_path like 'company-profile\/%'\)/i);
assert.match(migration, /check \(size_bytes > 0 and size_bytes <= 50 \* 1024 \* 1024\)/i);
assert.match(migration, /unique \(document_type, version\)/i);
assert.match(migration, /current` means latest registered version, not temporal validity/i);
assert.doesNotMatch(migration, /p_expires_at\s*<\s*current_date/i, 'La expiración temporal no puede impedir el registro.');
assert.match(migration, /revoke all on function public\.psi_record_company_procurement_document[\s\S]*from authenticated/i);
assert.match(migration, /grant execute on function public\.psi_record_company_procurement_document[\s\S]*to service_role/i);

console.log('tender document versions migration contract passed');
