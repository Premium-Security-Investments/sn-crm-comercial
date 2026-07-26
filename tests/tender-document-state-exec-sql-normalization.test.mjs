import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  stripTopLevelTransactionWrapper,
  createExecSql,
  STATE_SQL,
  PREREQUISITES_SQL,
} from '../scripts/tender-document-state-migrations.mjs';

const MIGRATION_026 = readFileSync(new URL('../supabase/migrations/026_tender_document_versions.sql', import.meta.url), 'utf8');
const MIGRATION_027 = readFileSync(new URL('../supabase/migrations/027_tender_decision_current_analysis.sql', import.meta.url), 'utf8');
const ROLLBACK_026 = readFileSync(new URL('../supabase/rollbacks/026_tender_document_versions_rollback.sql', import.meta.url), 'utf8');
const ROLLBACK_027 = readFileSync(new URL('../supabase/rollbacks/027_tender_decision_current_analysis_rollback.sql', import.meta.url), 'utf8');

const TOP_LEVEL_BEGIN = /^\s*begin\s*;\s*$/im;
const TOP_LEVEL_COMMIT = /^\s*commit\s*;\s*$/im;

function countBarePlpgsqlBeginBlocks(sql) {
  return sql.split(/\r?\n/).filter(line => /^\s*begin\s*$/i.test(line)).length;
}

// 1. Real 026/027 migration + rollback files: production's exec_sql RPC
// (dynamic SQL run via EXECUTE inside PL/pgSQL) rejects embedded BEGIN/COMMIT
// with 0A000 "EXECUTE of transaction commands is not implemented". The
// normalized payload sent over RPC must never contain a top-level
// transaction-control statement, while every internal (bare, semicolon-less)
// PL/pgSQL `begin` block stays completely untouched.
for (const [label, sql] of [
  ['026 migration', MIGRATION_026],
  ['027 migration', MIGRATION_027],
  ['026 rollback', ROLLBACK_026],
  ['027 rollback', ROLLBACK_027],
]) {
  const before = countBarePlpgsqlBeginBlocks(sql);
  const normalized = stripTopLevelTransactionWrapper(sql);
  assert.doesNotMatch(normalized, TOP_LEVEL_BEGIN, `${label}: normalized payload must not contain a top-level begin;`);
  assert.doesNotMatch(normalized, TOP_LEVEL_COMMIT, `${label}: normalized payload must not contain a top-level commit;`);
  const after = countBarePlpgsqlBeginBlocks(normalized);
  assert.equal(after, before, `${label}: internal PL/pgSQL begin blocks must be preserved exactly`);
  // Everything except the two wrapper lines must survive untouched.
  const innerOriginal = sql.replace(/^\s*begin\s*;\s*$/im, '').replace(/^\s*commit\s*;\s*$/im, '').trim();
  assert.equal(normalized.trim(), innerOriginal, `${label}: only the exact top-level begin;/commit; lines may be removed`);
}

// 2. Non-transactional read-only SQL (no wrapper at all) passes through unchanged.
for (const [label, sql] of [['STATE_SQL', STATE_SQL], ['PREREQUISITES_SQL', PREREQUISITES_SQL]]) {
  assert.equal(stripTopLevelTransactionWrapper(sql), sql, `${label}: SQL with no transactional wrapper must pass through unmodified`);
}

// 3. Fail closed: anything that looks like a partial/ambiguous/malformed
// transactional wrapper must throw rather than silently guessing what to
// strip. Must never delete arbitrary internal begin/commit occurrences.
{
  assert.throws(() => stripTopLevelTransactionWrapper('begin;\nselect 1;\n'), /formato inesperado/i, 'begin; without a matching top-level commit; must fail closed');
}
{
  assert.throws(() => stripTopLevelTransactionWrapper('select 1;\ncommit;\n'), /formato inesperado/i, 'commit; without a matching top-level begin; must fail closed');
}
{
  const twoBegins = 'begin;\nbegin;\nselect 1;\ncommit;\n';
  assert.throws(() => stripTopLevelTransactionWrapper(twoBegins), /formato inesperado/i, 'more than one top-level begin; must fail closed, not just strip the first');
}
{
  const twoCommits = 'begin;\nselect 1;\ncommit;\ncommit;\n';
  assert.throws(() => stripTopLevelTransactionWrapper(twoCommits), /formato inesperado/i, 'more than one top-level commit; must fail closed, not just strip the last');
}
{
  // begin; present but not as the first real statement (something runs outside the transaction).
  const beginNotFirst = 'select 1;\nbegin;\nselect 2;\ncommit;\n';
  assert.throws(() => stripTopLevelTransactionWrapper(beginNotFirst), /formato inesperado/i, 'begin; must be the first real statement or normalization must fail closed');
}
{
  // commit; present but not as the last real statement (something runs after the transaction closes).
  const commitNotLast = 'begin;\nselect 1;\ncommit;\nselect 2;\n';
  assert.throws(() => stripTopLevelTransactionWrapper(commitNotLast), /formato inesperado/i, 'commit; must be the last real statement or normalization must fail closed');
}
{
  // A bare PL/pgSQL `begin` (no semicolon) at the top must never be confused with a top-level begin;.
  const bareBeginOnly = 'do $$\nbegin\n  raise notice \'x\';\nend;\n$$;\n';
  assert.equal(stripTopLevelTransactionWrapper(bareBeginOnly), bareBeginOnly, 'a bare plpgsql begin block with no top-level begin;/commit; must pass through unchanged');
}

// 4. Reproduce the production 0A000 failure mode against a mocked exec_sql
// RPC that rejects any payload containing a top-level transaction-control
// statement (the exact production behavior reported: "EXECUTE of transaction
// commands is not implemented"). Prove the fixed transport never sends one,
// and that atomicity is preserved: each migration/rollback file still goes
// out as exactly one RPC call.
async function withMockedExecSql(sqlHandler, run) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body.sql);
    if (TOP_LEVEL_BEGIN.test(body.sql) || TOP_LEVEL_COMMIT.test(body.sql)) {
      return {
        ok: false,
        status: 400,
        json: async () => ({ ok: false, error: 'EXECUTE of transaction commands is not implemented', sqlstate: '0A000' }),
      };
    }
    return { ok: true, status: 200, json: async () => sqlHandler(body.sql) };
  };
  const execSql = createExecSql({ fetchImpl, baseUrl: 'http://mock.test', serviceKey: 'mock-service-key' });
  await run(execSql, calls);
}

await (async function migrationPayloadNeverContainsTopLevelTransactionControl() {
  await withMockedExecSql(() => ({ ok: true, rows: [] }), async (execSql, calls) => {
    await execSql(MIGRATION_026);
    await execSql(MIGRATION_027);
    await execSql(ROLLBACK_027);
    await execSql(ROLLBACK_026);
    assert.equal(calls.length, 4, 'each file must be sent as exactly one RPC call (atomicity preserved per call)');
    for (const sql of calls) {
      assert.doesNotMatch(sql, TOP_LEVEL_BEGIN, 'outgoing RPC payload must never contain a top-level begin;');
      assert.doesNotMatch(sql, TOP_LEVEL_COMMIT, 'outgoing RPC payload must never contain a top-level commit;');
    }
  });
})();

await (async function unfixedTransportWouldHaveHit0A000() {
  // Sanity check on the mock itself: sending the raw, un-normalized file
  // (as the pre-fix runner did) reproduces the exact 0A000 rejection.
  await withMockedExecSql(() => ({ ok: true, rows: [] }), async (_execSql, _calls) => {
    const fetchImpl = async (_url, init) => {
      const body = JSON.parse(init.body);
      if (TOP_LEVEL_BEGIN.test(body.sql) || TOP_LEVEL_COMMIT.test(body.sql)) {
        return { ok: false, status: 400, json: async () => ({ ok: false, error: 'EXECUTE of transaction commands is not implemented', sqlstate: '0A000' }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, rows: [] }) };
    };
    // Bypass normalization entirely to prove the mock reproduces the real failure mode.
    const rawBody = JSON.stringify({ sql: MIGRATION_026.trim().replace(/;\s*$/, '') });
    const response = await fetchImpl('http://mock/exec_sql', { body: rawBody });
    const payload = await response.json();
    assert.equal(response.ok, false);
    assert.equal(payload.sqlstate, '0A000');
  });
})();

console.log('exec_sql transaction-wrapper normalization contract passed');
