import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/051_agt002_context_versions.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollbacks/051_agt002_context_versions_rollback.sql', import.meta.url), 'utf8');

assert.match(migration, /create table if not exists public\.psi_agt002_context_versions/i);
assert.match(migration, /check \(context_version = 2\)/i);
assert.match(migration, /append-only/i);
assert.match(migration, /add column if not exists context_version_id uuid references public\.psi_agt002_context_versions/i);
assert.match(migration, /grant execute[\s\S]*service_role/i);
assert.doesNotMatch(migration, /delete\s+from\s+public\.psi_tender_analysis_runs|truncate\s+.*psi_tender_analysis_runs/i);
assert.doesNotMatch(migration, /delete\s+from\s+public\.psi_tender_question_responses|truncate\s+.*psi_tender_question_responses|drop\s+table.*psi_tender_question_responses/i);
assert.doesNotMatch(migration, /drop\s+table.*psi_tender_analysis_runs\b(?!.*context_versions)/i);

assert.match(rollback, /drop table if exists public\.psi_agt002_context_versions/i);
assert.match(rollback, /drop column if exists context_version_id/i);
// The rollback restores the original 050 canonical-run RPC body verbatim rather than
// leaving the function dropped, so 050's own rollback stays valid afterwards.
assert.match(rollback, /create function public\.psi_record_agt002_canonical_analysis_run/i);
assert.doesNotMatch(rollback, /drop\s+table.*psi_tender_analysis_runs|delete\s+from\s+public\.psi_tender_analysis_runs|truncate.*psi_tender_analysis_runs/i);
assert.doesNotMatch(rollback, /drop\s+table.*psi_tender_question_responses|delete\s+from\s+public\.psi_tender_question_responses|truncate.*psi_tender_question_responses/i);

console.log('AGT-002 context versions rollback safety contract passed');
