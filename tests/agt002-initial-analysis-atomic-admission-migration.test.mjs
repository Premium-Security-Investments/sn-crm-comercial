import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/101_agt002_initial_analysis_atomic_admission.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollbacks/101_agt002_initial_analysis_atomic_admission_rollback.sql', import.meta.url), 'utf8');

const RPC = 'psi_admit_authorized_agt002_initial_analysis_job';

assert.match(migration, new RegExp(`create or replace function public\\.${RPC}`, 'i'));
assert.match(migration, /security definer/i);
assert.match(migration, /set search_path = public, pg_temp/i);
assert.match(migration, /perform public\.psi_consume_agt002_analysis_authorization[\s\S]*v_admission := public\.psi_admit_agt002_initial_analysis_job/i);
assert.match(migration, /coalesce\(p_payload, '\{\}'::jsonb\) - 'persistence'/i);
for (const binding of ['workflowInstanceId', 'authorizationId', 'packageVersionId', 'packageHash', 'g1Scope', 'policyVersion']) {
  assert.match(migration, new RegExp(`'${binding}'`), `the database must construct persistence.${binding}`);
}
assert.match(migration, /if v_admission ->> 'status' = 'payload_mismatch'[\s\S]*raise exception/i);
assert.match(migration, /revoke all on function public\.psi_admit_agt002_initial_analysis_job[\s\S]*service_role/i);
assert.match(migration, new RegExp(`grant execute on function public\\.${RPC}[\\s\\S]*to service_role`, 'i'));
assert.doesNotMatch(migration, new RegExp(`grant execute on function public\\.${RPC}[\\s\\S]*to (public|authenticated|anon)`, 'i'));

assert.match(rollback, /^\s*begin\s*;/i);
assert.match(rollback, /commit\s*;\s*$/i);
assert.match(rollback, new RegExp(`drop function if exists public\\.${RPC}`, 'i'));
assert.match(rollback, /grant execute on function public\.psi_admit_agt002_initial_analysis_job[\s\S]*to service_role/i);
assert.doesNotMatch(rollback, /delete\s+from|truncate\s+/i);

for (const sql of [migration, rollback]) {
  assert.doesNotMatch(sql, /psi_agt002_reanalysis_jobs|psi_(create|claim|complete|fail)_agt002_reanalysis_job/i);
}

console.log('AGT-002 INITIAL atomic authorized-admission migration static safety passed');
