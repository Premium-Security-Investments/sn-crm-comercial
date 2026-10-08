import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STATE_SQL, statusOf } from '../scripts/agt002-republication-migration.mjs';

test('aplicador 116: estado según las dos funciones', () => {
  assert.equal(statusOf({ retire_functions: 1, append_functions: 1 }), 'applied');
  assert.equal(statusOf({ retire_functions: 0, append_functions: 0 }), 'absent');
  assert.equal(statusOf({ retire_functions: 1, append_functions: 0 }), 'partial');
  assert.equal(statusOf({ retire_functions: 0, append_functions: 1 }), 'partial');
  assert.match(STATE_SQL, /psi_retire_tender_document_versions/);
  assert.match(STATE_SQL, /psi_append_opportunity_observation_line/);
});

test('aplicador 116: apunta a la migración y la reversa correctas, con candado', () => {
  const src = readFileSync(new URL('../scripts/agt002-republication-migration.mjs', import.meta.url), 'utf8');
  assert.match(src, /supabase\/migrations\/116_agt002_retire_republished_tender_documents\.sql/);
  assert.match(src, /supabase\/rollbacks\/116_agt002_retire_republished_tender_documents_rollback\.sql/);
  assert.match(src, /pg_advisory_xact_lock/);
  assert.doesNotMatch(src, /\.(insert|update|upsert|delete)\(/);
});
