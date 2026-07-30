import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/050_agt002_canonical_analysis.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollbacks/050_agt002_canonical_analysis_rollback.sql', import.meta.url), 'utf8');

assert.match(migration, /add column if not exists canonical boolean not null default false/i);
assert.match(migration, /producer = 'AGT-002'[\s\S]*method = 'agent_ai'/i);
assert.match(migration, /queued[\s\S]*running[\s\S]*completed[\s\S]*retry_wait[\s\S]*needs_attention[\s\S]*unavailable/i);
assert.match(migration, /append-only/i);
assert.match(migration, /grant execute[\s\S]*service_role/i);
assert.doesNotMatch(migration, /delete\s+from\s+public\.psi_tender_analysis_runs|truncate\s+.*psi_tender_analysis_runs/i);

assert.match(rollback, /drop table if exists public\.psi_agt002_analysis_attempt_events/i);
assert.match(rollback, /drop column if exists canonical/i);
assert.doesNotMatch(rollback, /drop table.*psi_tender_analysis_runs|delete\s+from\s+public\.psi_tender_analysis_runs|truncate/i);

console.log('AGT-002 canonical rollback safety contract passed');
