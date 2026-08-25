import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/071_agt002_radar_gate.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollbacks/071_agt002_radar_gate_rollback.sql', import.meta.url), 'utf8');

assert.match(migration, /enable row level security/i);
assert.match(migration, /security definer/i);
assert.match(migration, /set search_path\s*=\s*public,\s*pg_temp/i);
assert.match(migration, /revoke all on function public\.psi_record_agt002_radar_gate_evaluation/i);
assert.match(migration, /grant execute on function public\.psi_record_agt002_radar_gate_evaluation[^;]+ to service_role/i);
assert.match(migration, /before update or delete/i);
assert.match(migration, /append-only/i);
assert.match(rollback, /drop function if exists public\.psi_record_agt002_radar_gate_evaluation/i);
assert.match(rollback, /drop table if exists public\.psi_agt002_radar_gate_evaluations/i);
for (const sql of [migration, rollback]) {
  assert.doesNotMatch(sql, /psi_sales_opportunities|psi_convert_tender_to_opportunity|converted_opportunity_id|internal_status/i);
}
console.log('AGT-002 Radar gate migration static safety passed');
