import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/104_agt002_initial_analysis_server_owned_execution.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollbacks/104_agt002_initial_analysis_server_owned_execution_rollback.sql', import.meta.url), 'utf8');

test('104 rebuilds execution batches from frozen package members and adds exactly one synthesis batch', () => {
  assert.match(migration, /from public\.psi_agt002_evidence_package_members/);
  assert.match(migration, /'phase', 'member_batch_analysis'/);
  assert.match(migration, /'phase', 'synthesis'/);
  assert.match(migration, /'sourceBatchIndexes', v_source_indexes/);
  assert.match(migration, /jsonb_array_length\(v_batches\) is distinct from v_version\.batch_count/);
});

test('104 discards caller persistence/batches and creates the analysis run id server-side', () => {
  assert.match(migration, /v_analysis_run_id := gen_random_uuid\(\)/);
  assert.match(migration, /'analysisRunId', v_analysis_run_id/);
  assert.match(migration, /p_payload \? 'execution' and p_payload \? 'budget'/);
  assert.doesNotMatch(migration, /coalesce\(p_payload.*- 'persistence'/s);
});

test('104 keeps G1 consumption plus admission in the same transaction and service-role-only', () => {
  assert.match(migration, /perform public\.psi_consume_agt002_analysis_authorization/);
  assert.match(migration, /v_admission := public\.psi_admit_agt002_initial_analysis_job/);
  assert.match(migration, /revoke all on function public\.psi_admit_authorized/);
  assert.match(migration, /grant execute on function public\.psi_admit_authorized.*to service_role/s);
});

test('rollback refuses after any 104 execution evidence and never mutates job history', () => {
  assert.match(rollback, /access exclusive/);
  assert.match(rollback, /analysisRunId/);
  assert.match(rollback, /raise exception 'Rollback 104 refused/);
  assert.doesNotMatch(rollback, /delete from|update public\./i);
});
