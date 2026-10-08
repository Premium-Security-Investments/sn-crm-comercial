import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/116_agt002_incremental_reanalysis_r1.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollbacks/116_agt002_incremental_reanalysis_r1_rollback.sql', import.meta.url), 'utf8');

test('migration 116 keeps R1 in isolated append-only, service-role-only ledgers', () => {
  for (const table of ['psi_agt002_incremental_signals', 'psi_agt002_incremental_change_sets', 'psi_agt002_incremental_change_set_transitions']) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`));
  }
  assert.match(migration, /psi_agt002_incremental_signals_append_only/);
  assert.match(migration, /psi_agt002_incremental_transitions_append_only/);
  assert.match(migration, /18374300397482569/g);
  assert.match(migration, /R1 nunca crea la primera corrida/);
  assert.doesNotMatch(migration, /GO_NO_GO_APPROVE|sendmail|smtp|publicaci[oó]n/i);
});

test('migration 116 mechanically limits one accumulator and one active set per opportunity', () => {
  assert.match(migration, /unique index psi_agt002_incremental_one_accumulating_idx[\s\S]*where state = 'ACCUMULATING'/);
  assert.match(migration, /unique index psi_agt002_incremental_one_active_idx[\s\S]*where state in \('SEALED', 'DISPATCHED', 'RUNNING'\)/);
  assert.match(migration, /psi_agt002_reanalysis_jobs[\s\S]*status in \('queued', 'running'\)/);
});

test('rollback refuses to erase any recorded incremental evidence', () => {
  assert.match(rollback, /count\(\*\).*psi_agt002_incremental_signals/s);
  assert.match(rollback, /count\(\*\).*psi_agt002_incremental_change_sets/s);
  assert.match(rollback, /count\(\*\).*psi_agt002_incremental_change_set_transitions/s);
  assert.match(rollback, /Rollback 116 refused/);
  assert.match(rollback, /raise exception/);
});
