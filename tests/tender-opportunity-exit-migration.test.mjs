import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/058_tender_opportunity_exit_destinations.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollbacks/058_tender_opportunity_exit_destinations_rollback.sql', import.meta.url), 'utf8');

assert.match(sql, /^begin;/i);
assert.match(sql, /update public\.psi_public_tenders[\s\S]*tracking_updated_at\s*=\s*coalesce\(/i);
assert.match(sql, /where internal_status in \('convertida_oportunidad', 'en_revision'\)[\s\S]*tracking_updated_at is null/i);
assert.match(sql, /create or replace function public\.psi_exit_tender_opportunity/i);
assert.match(sql, /p_destination[^\n]*text/i);
assert.match(sql, /p_destination not in \('radar', 'seguimiento'\)/i);
assert.match(sql, /when 'radar' then 'nueva'/i);
assert.match(sql, /when 'seguimiento' then 'en_revision'/i);
assert.match(sql, /'returned_to_radar'/i);
assert.match(sql, /'returned_to_tracking'/i);
assert.match(sql, /converted_opportunity_id\s*=\s*v_opportunity\.id/i);
assert.match(sql, /where t\.internal_status = 'convertida_oportunidad'/i);
assert.match(sql, /grant execute on function public\.psi_exit_tender_opportunity/i);
assert.doesNotMatch(sql, /set\s+internal_status\s*=\s*'descartada'/i);
assert.match(sql, /create or replace function public\.psi_convert_tender_to_opportunity/i);
assert.match(sql, /loss_notes\s*=\s*null/i);
assert.match(sql, /create or replace function public\.psi_update_tender_tracking/i);
assert.match(sql, /converted_opportunity_id is not null/i);
assert.match(sql, /create or replace function public\.psi_transition_tender_tracking/i);
assert.match(sql, /gestione la salida desde la oportunidad/i);
assert.match(sql, /commit;\s*$/i);

assert.match(rollback, /^begin;/i);
assert.match(rollback, /drop function if exists public\.psi_exit_tender_opportunity/i);
assert.match(rollback, /create or replace function public\.psi_list_tender_opportunity_page/i);
assert.match(rollback, /commit;\s*$/i);
assert.doesNotMatch(rollback, /delete\s+from\s+public\./i);

// --- Finding 1: the rollback must be self-contained. It must not rely on migration 058's
// psi_update_tender_tracking/psi_transition_tender_tracking accidentally surviving because the
// rollback script never touches them; it must define its own rollback-compatible bodies.
assert.match(
  rollback,
  /create or replace function public\.psi_update_tender_tracking/i,
  'rollback must define its own psi_update_tender_tracking, not merely leave 058\'s version in place',
);
assert.match(
  rollback,
  /create or replace function public\.psi_transition_tender_tracking/i,
  'rollback must define its own psi_transition_tender_tracking, not merely leave 058\'s version in place',
);
assert.match(
  rollback,
  /cannot blindly restore migration 018/i,
  'rollback must document why 018\'s original tracking functions cannot be restored verbatim',
);
assert.match(
  rollback,
  /v_tender\.tracking_updated_at is null/i,
  'rollback-compatible psi_update_tender_tracking must accept a non-null CAS token on a Radar row exited by 058',
);
assert.match(
  rollback,
  /converted_opportunity_id is not null/i,
  'rollback-compatible psi_transition_tender_tracking must keep the guard against orphaning a preserved converted_opportunity_id',
);

// --- Finding 2: AB-BA lock order. psi_convert_tender_to_opportunity's reconversion branch must lock
// psi_sales_opportunities before psi_public_tenders, matching psi_exit_tender_opportunity's order.
function extractFunction(source, name) {
  const re = new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, 'i');
  const m = source.match(re);
  assert.ok(m, `expected to find function ${name} in source`);
  return m[0];
}
const convertFn = extractFunction(sql, 'psi_convert_tender_to_opportunity');
const convertOpportunityLockIdx = convertFn.search(/from public\.psi_sales_opportunities\s+where external_source = p_external_source\s+for update/i);
const convertTenderLockIdx = convertFn.search(/from public\.psi_public_tenders\s+where id = p_tender_id\s+for update/i);
assert.ok(convertOpportunityLockIdx >= 0, 'psi_convert_tender_to_opportunity must lock the opportunity by external_source before locking the tender');
assert.ok(convertTenderLockIdx >= 0, 'psi_convert_tender_to_opportunity must lock the tender by id');
assert.ok(
  convertOpportunityLockIdx < convertTenderLockIdx,
  'psi_convert_tender_to_opportunity must lock psi_sales_opportunities before psi_public_tenders to avoid an AB-BA deadlock with psi_exit_tender_opportunity',
);

const exitFn = extractFunction(sql, 'psi_exit_tender_opportunity');
const exitOpportunityLockIdx = exitFn.search(/from public\.psi_sales_opportunities\s+where id = p_opportunity_id\s+for update/i);
const exitTenderLockIdx = exitFn.search(/from public\.psi_public_tenders\s+where converted_opportunity_id = p_opportunity_id\s+for update/i);
assert.ok(exitOpportunityLockIdx >= 0 && exitTenderLockIdx >= 0, 'psi_exit_tender_opportunity must lock both the opportunity and the tender');
assert.ok(
  exitOpportunityLockIdx < exitTenderLockIdx,
  'psi_exit_tender_opportunity must keep locking the opportunity before the tender',
);

// --- Finding 3: unify anon revokes across every RPC that migration 058 (re)defines.
for (const [name, signature] of [
  ['psi_update_tender_tracking', 'uuid, uuid, uuid, text, text, timestamptz, text, text, timestamptz'],
  ['psi_transition_tender_tracking', 'uuid, uuid, text, uuid, text, timestamptz'],
  ['psi_convert_tender_to_opportunity', 'uuid, uuid, text, text, uuid, text, text, numeric, date, text, text, text, text, text, text, timestamptz'],
  ['psi_exit_tender_opportunity', 'uuid, uuid, text, text, timestamptz'],
  ['psi_list_tender_opportunity_page', 'text, int, int'],
]) {
  const re = new RegExp(`revoke all on function public\\.${name}\\(${signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\) from anon;`, 'i');
  assert.match(sql, re, `migration 058 must revoke execute on ${name} from anon`);
}
for (const [name, signature] of [
  ['psi_update_tender_tracking', 'uuid, uuid, uuid, text, text, timestamptz, text, text, timestamptz'],
  ['psi_transition_tender_tracking', 'uuid, uuid, text, uuid, text, timestamptz'],
  ['psi_convert_tender_to_opportunity', 'uuid, uuid, text, text, uuid, text, text, numeric, date, text, text, text, text, text, text, timestamptz'],
  ['psi_discard_tender_opportunity', 'uuid, uuid, text, timestamptz'],
  ['psi_list_tender_opportunity_page', 'text, int, int'],
]) {
  const re = new RegExp(`revoke all on function public\\.${name}\\(${signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\) from anon;`, 'i');
  assert.match(rollback, re, `rollback must revoke execute on ${name} from anon`);
}

console.log('tender opportunity exit migration static contract passed');
