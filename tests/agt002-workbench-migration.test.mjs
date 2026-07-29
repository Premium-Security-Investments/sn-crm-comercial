import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/044_agt002_dossier_workbench.sql', import.meta.url), 'utf8');
const normalized = sql.toLowerCase();
const tables = [
  'psi_agt002_workbench_threads',
  'psi_agt002_workbench_messages',
  'psi_agt002_workbench_message_links',
  'psi_agt002_workbench_jobs',
  'psi_agt002_workbench_job_events',
  'psi_agt002_workbench_required_actions',
  'psi_agt002_learning_proposals',
  'psi_agt002_learning_decisions',
];
const rpcs = [
  'psi_get_or_create_agt002_workbench_thread',
  'psi_append_agt002_workbench_message',
  'psi_get_agt002_workbench',
  'psi_retry_agt002_workbench_job',
  'psi_review_agt002_learning_proposal',
  'psi_claim_agt002_workbench_job',
  'psi_append_agt002_workbench_job_event',
  'psi_append_agt002_agent_result',
  'psi_append_agt002_agent_artifact_version',
];

for (const table of tables) {
  assert.match(normalized, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(normalized, new RegExp(`'${table}'`));
}
for (const rpc of rpcs) {
  assert.match(normalized, new RegExp(`create or replace function public\\.${rpc}\\(`));
  assert.match(normalized, new RegExp(`'${rpc}\\(`));
}

assert.match(normalized, /execute format\('alter table public\.%i enable row level security'/);
assert.match(normalized, /execute format\('revoke all on table public\.%i from public, anon, authenticated'/);
assert.match(normalized, /execute format\('grant execute on function public\.%s to service_role'/);

assert.match(normalized, /origin_agent_job_id uuid/);
assert.match(normalized, /author_kind text not null default 'human'/);
assert.match(normalized, /base_version_id uuid/);
assert.match(normalized, /contract_version text not null/);
assert.match(normalized, /policy_version text not null/);
assert.match(normalized, /idempotency_key text not null unique/);
assert.match(normalized, /where closed_at is null/);
assert.match(normalized, /is append-only/);
assert.match(normalized, /licitaciones_custodia/);
assert.match(normalized, /identity_type[^;]+agent/s);
assert.match(normalized, /event_type[^;]+stale/s);
assert.doesNotMatch(normalized, /insert into public\.psi_agt003_/);
assert.doesNotMatch(normalized, /insert into public\.psi_tender_processing_jobs/);
assert.match(normalized, /commit;/);

console.log('AGT-002 workbench migration static checks passed');
