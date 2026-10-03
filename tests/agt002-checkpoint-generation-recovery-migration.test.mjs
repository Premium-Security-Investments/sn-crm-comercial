import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/097_agt002_checkpoint_generation_recovery.sql', import.meta.url), 'utf8');
const statements = sql.split('\n').filter(line => !/^\s*--/.test(line)).join('\n');
const rollback = readFileSync(new URL('../supabase/rollbacks/097_agt002_checkpoint_generation_recovery_rollback.sql', import.meta.url), 'utf8');

test('097 preserves history and creates an append-only, owner-authorized generation audit', () => {
  assert.match(statements, /create table public\.psi_agt002_checkpoint_generation_recoveries/i);
  assert.match(statements, /source_job_id uuid not null unique/i);
  assert.match(statements, /recovery_job_id uuid not null unique/i);
  assert.match(statements, /before update or delete on public\.psi_agt002_checkpoint_generation_recoveries/i);
  assert.match(statements, /force row level security/i);
  assert.match(statements, /reason_code = 'checkpoint_contract_drift'/i);
  assert.doesNotMatch(statements, /delete\s+from\s+public\.psi_agt002_analysis_checkpoints/i);
  assert.doesNotMatch(statements, /update\s+public\.psi_agt002_analysis_checkpoints/i);
});

test('authorization is fail-closed on the exact failed job, workset, checkpoint and progress evidence', () => {
  assert.match(statements, /status is distinct from 'unavailable'/i);
  assert.match(statements, /error_code is distinct from 'persistence_failure'/i);
  assert.match(statements, /phase is distinct from 'integral_analysis'/i);
  assert.match(statements, /completed_batch_count is distinct from p_expected_completed_batch_count/i);
  assert.match(statements, /total_batch_count is distinct from p_expected_total_batch_count/i);
  assert.match(statements, /v_rejected\.request_hash is distinct from p_expected_request_hash/i);
  assert.match(statements, /v_rejected\.output_sha256 is distinct from p_expected_output_sha256/i);
  assert.match(statements, /v_integral_max is distinct from p_expected_completed_batch_count - 1/i);
  for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
    assert.match(statements, new RegExp(`revoke all on function public\\.psi_authorize_agt002_checkpoint_generation_recovery\\([^;]+ from ${role}`, 'i'));
  }
  assert.doesNotMatch(statements, /grant execute on function public\.psi_authorize_agt002_checkpoint_generation_recovery/i);
});

test('ordinary queue excludes recovery generations and exact-id claim cannot target an unaudited job', () => {
  const exclusions = statements.match(/not exists \(select 1 from public\.psi_agt002_checkpoint_generation_recoveries r where r\.recovery_job_id = j\.id\)/gi) || [];
  assert.equal(exclusions.length, 3, 'both ordinary expiry paths and FIFO selection must exclude recovery jobs');
  assert.match(statements, /create function public\.psi_claim_agt002_reanalysis_job_by_id/i);
  assert.match(statements, /where recovery_job_id = p_job_id/i);
  assert.match(statements, /raise exception 'el job objetivo no es una recuperación de generación autorizada'/i);
  assert.match(statements, /grant execute on function public\.psi_claim_agt002_reanalysis_job_by_id\(uuid, integer\) to service_role/i);
});

test('SQL and JavaScript share the byte-exact v1 recovery-key contract', () => {
  assert.match(statements, /'agt002-checkpoint-generation-recovery-v1' \|\| E'\\n'/i);
  assert.match(statements, /\|\| v_source_job\.idempotency_key \|\| E'\\n'/i);
  assert.match(statements, /\|\| v_source_job\.id::text \|\| E'\\n1' \|\| E'\\n'/i);
  assert.match(statements, /sha256\(convert_to\([\s\S]+?'UTF8'\s*\)\)/i);
});

test('097 rollback is evidence-aware and restores the ordinary 081 claim only when unused', () => {
  assert.match(rollback, /if exists \(select 1 from public\.psi_agt002_checkpoint_generation_recoveries\)/i);
  assert.match(rollback, /raise exception 'bloqueado:/i);
  assert.match(rollback, /create or replace function public\.psi_claim_agt002_reanalysis_job/i);
  assert.match(rollback, /drop function if exists public\.psi_claim_agt002_reanalysis_job_by_id/i);
  assert.match(rollback, /drop table public\.psi_agt002_checkpoint_generation_recoveries/i);
  assert.doesNotMatch(rollback, /delete\s+from/i);
});
