import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';

const migrationPath = new URL('../supabase/migrations/025_tender_analysis_foundation.sql', import.meta.url);
assert.equal(existsSync(migrationPath), true, 'La migración 025 debe existir.');
const migration = readFileSync(migrationPath, 'utf8');

for (const token of [
  'create table if not exists public.psi_tender_document_snapshots',
  'create table if not exists public.psi_tender_analysis_runs',
  'unique (opportunity_id, document_hash, profile_hash)',
  "check (producer in ('siio_rules_v1', 'HERMES-INTERIM', 'AGT-002'))",
  'psi_record_tender_document_snapshot',
  'psi_record_tender_analysis_run',
  'revoke all on table public.psi_tender_document_snapshots from authenticated',
  'revoke all on table public.psi_tender_analysis_runs from authenticated',
  'revoke all on table public.psi_tender_document_snapshots from service_role',
  'revoke all on table public.psi_tender_analysis_runs from service_role',
  'set search_path = public, pg_temp',
]) assert.match(migration, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));

assert.match(migration, /document_hash text not null check \(document_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/i);
assert.match(migration, /profile_hash text not null check \(profile_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/i);
assert.match(migration, /check \(\(producer = 'siio_rules_v1' and method = 'rules'\) or \(producer in \('HERMES-INTERIM', 'AGT-002'\) and method = 'agent_ai'\)\)/i);
assert.match(migration, /check \(\(status = 'completed' and result is not null and jsonb_typeof\(result\) = 'object'\) or \(status = 'failed' and result is null\)\)/i);
assert.match(migration, /on conflict \(opportunity_id, document_hash, profile_hash\) do nothing/i);
assert.match(migration, /on conflict \(idempotency_key\) do nothing/i);
assert.match(migration, /productor de análisis no autorizado/i);
assert.match(migration, /un análisis completado requiere resultado estructurado/i);
assert.match(migration, /prevent_mutation/i);
assert.match(migration, /grant execute on function public\.psi_record_tender_document_snapshot[\s\S]*to service_role/i);
assert.match(migration, /grant execute on function public\.psi_record_tender_analysis_run[\s\S]*to service_role/i);

console.log('tender analysis foundation migration contract passed');
