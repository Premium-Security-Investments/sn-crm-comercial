import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/098_agt002_checkpoint_generation_2_recovery.sql', import.meta.url), 'utf8');
const statements = sql.split('\n').filter(line => !/^\s*--/.test(line)).join('\n');
const rollback = readFileSync(new URL('../supabase/rollbacks/098_agt002_checkpoint_generation_2_recovery_rollback.sql', import.meta.url), 'utf8');

test('098 creates a separate append-only generation-2 audit without mutating generation 1', () => {
  assert.match(statements, /create table public\.psi_agt002_checkpoint_generation_2_recoveries/i);
  assert.match(statements, /source_generation_recovery_id uuid not null unique references public\.psi_agt002_checkpoint_generation_recoveries/i);
  assert.match(statements, /checkpoint_generation = 2/i);
  assert.match(statements, /reason_code = 'batched_legal_normalization_parity'/i);
  assert.match(statements, /before update or delete on public\.psi_agt002_checkpoint_generation_2_recoveries/i);
  assert.doesNotMatch(statements, /update\s+public\.psi_agt002_analysis_checkpoints/i);
  assert.doesNotMatch(statements, /delete\s+from/i);
});

test('generation-2 authorization is owner-only and fail-closed on the exact failed frontier', () => {
  assert.match(statements, /error_code is distinct from 'invalid_output'/i);
  assert.match(statements, /phase is distinct from 'semantic_discovery'/i);
  assert.match(statements, /resume_count is distinct from 0/i);
  assert.match(statements, /v_last_checkpoint\.stage is distinct from 'semantic_manifest'/i);
  assert.match(statements, /v_plan_count is distinct from 0/i);
  assert.match(statements, /v_integral_count is distinct from 0/i);
  assert.match(statements, /rejected_validation_code[^\n]+v3_legal_assessment_invariant/i);
  for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
    assert.match(statements, new RegExp(`revoke all on function public\\.psi_authorize_agt002_checkpoint_generation_2_recovery\\([^;]+ from ${role}`, 'i'));
  }
  assert.doesNotMatch(statements, /grant execute on function public\.psi_authorize_agt002_checkpoint_generation_2_recovery/i);
});

test('ordinary FIFO excludes both recovery generations and exact-id claim accepts only audited generations', () => {
  const generation2Exclusions = statements.match(/not exists \(select 1 from public\.psi_agt002_checkpoint_generation_2_recoveries r where r\.recovery_job_id = j\.id\)/gi) || [];
  assert.equal(generation2Exclusions.length, 3);
  assert.match(statements, /not exists \(select 1 from public\.psi_agt002_checkpoint_generation_recoveries where recovery_job_id = p_job_id\)[\s\S]+and not exists \(select 1 from public\.psi_agt002_checkpoint_generation_2_recoveries where recovery_job_id = p_job_id\)/i);
});

test('SQL and JavaScript share the byte-exact v2 recovery-key contract', () => {
  assert.match(statements, /'agt002-checkpoint-generation-recovery-v2' \|\| E'\\n'/i);
  assert.match(statements, /\|\| v_source_generation\.root_idempotency_key \|\| E'\\n'/i);
  assert.match(statements, /\|\| v_source_job\.id::text \|\| E'\\n2' \|\| E'\\n'/i);
});

test('098 rollback is evidence-aware and restores 097 behavior only while unused', () => {
  assert.match(rollback, /if exists \(select 1 from public\.psi_agt002_checkpoint_generation_2_recoveries\)/i);
  assert.match(rollback, /raise exception 'bloqueado:/i);
  assert.match(rollback, /create or replace function public\.psi_claim_agt002_reanalysis_job/i);
  assert.match(rollback, /create or replace function public\.psi_claim_agt002_reanalysis_job_by_id/i);
  assert.match(rollback, /drop table public\.psi_agt002_checkpoint_generation_2_recoveries/i);
  assert.doesNotMatch(rollback, /delete\s+from/i);
});
