import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const runnerUrl = new URL('../scripts/agt002-initial-analysis-migrations.mjs', import.meta.url);
const {
  MIGRATION_ORDER,
  ROLLBACK_ORDER,
  stripTopLevelTransactionWrapper,
  classifyChainState,
  buildAtomicApplySql,
  buildAtomicRollbackSql,
  createExecSql,
  preflight,
  apply,
  verify,
} = await import(runnerUrl);

assert.deepEqual(MIGRATION_ORDER, ['099', '100', '101', '102', '103', '104', '105', '106', '107']);
assert.deepEqual(ROLLBACK_ORDER, ['107', '106', '105', '104', '103', '102', '101', '100', '099']);

for (const id of MIGRATION_ORDER) {
  const migration = readFileSync(new URL(`../supabase/migrations/${id}_agt002_${({
    '099': 'evidence_packages',
    '100': 'initial_workflow_and_g1',
    '101': 'initial_analysis_jobs',
    '102': 'initial_analysis_canonical_persistence',
    '103': 'initial_analysis_atomic_admission',
    '104': 'initial_analysis_server_owned_execution',
    '105': 'initial_admission_digest_schema_qualification',
    '106': 'initial_v2_aggregate_schema_version',
    '107': 'company_profile_snapshots',
  })[id]}.sql`, import.meta.url), 'utf8');
  const stripped = stripTopLevelTransactionWrapper(migration);
  assert.doesNotMatch(stripped.trim().split(/\r?\n/)[0], /^begin;$/i);
  assert.doesNotMatch(stripped.trim(), /\bcommit;\s*$/i);
}

assert.equal(classifyChainState({ m099: false, m100: false, m101: false, m102: false, m103: false, m104: false, m105: false, m106: false, m107: false }), 'absent');
assert.equal(classifyChainState({ m099: true, m100: true, m101: false, m102: false, m103: false, m104: false, m105: false, m106: false, m107: false }), 'partial');
// 104 applied without 105 is a real intermediate state: the admission RPC exists but cannot resolve
// pgcrypto, so the chain is not complete until 105 lands.
assert.equal(classifyChainState({ m099: true, m100: true, m101: true, m102: true, m103: true, m104: true, m105: false, m106: false, m107: false }), 'partial');
// 105 applied without 106 is a real intermediate state: INITIAL can admit jobs but cannot persist a v2 aggregate.
assert.equal(classifyChainState({ m099: true, m100: true, m101: true, m102: true, m103: true, m104: true, m105: true, m106: false, m107: false }), 'partial');
// 106 applied without 107: INITIAL works in scope A but cannot freeze a company-profile snapshot (A_PLUS_B).
assert.equal(classifyChainState({ m099: true, m100: true, m101: true, m102: true, m103: true, m104: true, m105: true, m106: true, m107: false }), 'partial');
assert.equal(classifyChainState({ m099: true, m100: true, m101: true, m102: true, m103: true, m104: true, m105: true, m106: true, m107: true }), 'applied');
assert.equal(classifyChainState({ m099: true, m100: false, m101: true, m102: false, m103: false, m104: false, m105: false, m106: false, m107: false }), 'drift');
assert.equal(classifyChainState({ m099: true, m100: true, m101: true, m102: true, m103: true, m104: true, m105: true, m106: true, m107: true, unsafe_grants: 1 }), 'drift');

const migrationSql = Object.fromEntries(MIGRATION_ORDER.map(id => [id, `begin;\nselect '${id}' as migration_${id};\ncommit;`]));
const applySql = buildAtomicApplySql(migrationSql, { m099: false, m100: false, m101: false, m102: false, m103: false, m104: false });
assert.match(applySql, /pg_advisory_xact_lock/);
for (let index = 1; index < MIGRATION_ORDER.length; index += 1) {
  assert.ok(applySql.indexOf(`migration_${MIGRATION_ORDER[index - 1]}`) < applySql.indexOf(`migration_${MIGRATION_ORDER[index]}`));
}

const rollbackSql = Object.fromEntries(ROLLBACK_ORDER.map(id => [id, `begin;\nselect '${id}' as rollback_${id};\ncommit;`]));
const rollbackBatch = buildAtomicRollbackSql(rollbackSql);
assert.match(rollbackBatch, /pg_advisory_xact_lock/);
for (let index = 1; index < ROLLBACK_ORDER.length; index += 1) {
  assert.ok(rollbackBatch.indexOf(`rollback_${ROLLBACK_ORDER[index - 1]}`) < rollbackBatch.indexOf(`rollback_${ROLLBACK_ORDER[index]}`));
}

const appliedRow = {
  missing_prerequisites: 0,
  m099: true, m100: true, m101: true, m102: true, m103: true, m104: true, m105: true, m106: true, m107: true,
  unsafe_grants: 0, rls_missing: 0, missing_service_access: 0,
};

await assert.rejects(
  preflight(async sql => /PREREQUISITES/.test(sql) ? [{ missing_prerequisites: 1 }] : [appliedRow]),
  /prerrequisitos/i,
);

await assert.rejects(
  verify(async () => [{ ...appliedRow, m100: false }]),
  /drift/i,
);

{
  const calls = [];
  let stateReads = 0;
  const execSql = async sql => {
    calls.push(sql);
    if (/PREREQUISITES/.test(sql)) return [{ missing_prerequisites: 0 }];
    if (/STATE/.test(sql)) {
      stateReads += 1;
      return [stateReads === 1
        ? { ...appliedRow, m099: false, m100: false, m101: false, m102: false, m103: false, m104: false, m105: false, m106: false, m107: false }
        : appliedRow];
    }
    return [];
  };
  const result = await apply(execSql);
  assert.equal(result.status, 'applied');
  assert.equal(calls.filter(sql => /ATOMIC_APPLY/.test(sql)).length, 1);
  const atomic = calls.find(sql => /ATOMIC_APPLY/.test(sql));
  assert.match(atomic, /psi_agt002_evidence_packages/);
  assert.match(atomic, /analysisRunId/);
  // The atomic apply must carry 105's schema-qualified pgcrypto call, not 104's unqualified one:
  // without it the admission RPC cannot resolve digest() and every admission fails with 42883.
  assert.match(atomic, /extensions\.digest\(/);
  // 106: the completion RPC must require the v2 envelope in the same atomic apply.
  assert.match(atomic, /pre_go_analysis\.v2/);
  assert.match(atomic, /psi_agt002_company_profile_snapshots/);
}

console.log('AGT-002 INITIAL migration runner contract passed');

{
  const previousUrl = process.env.SUPABASE_URL;
  const previousPublicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://initial-runner.test';
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-service-key';
  try {
    let endpoint = null;
    const execSql = createExecSql({
      fetchImpl: async url => {
        endpoint = url;
        return { ok: true, status: 200, json: async () => ({ ok: true, rows: [] }) };
      },
    });
    await execSql('select 1');
    assert.equal(endpoint, 'https://initial-runner.test/rest/v1/rpc/exec_sql');
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousPublicUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previousPublicUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
}

{
  // Each marker must only detect its own slot: a later migration's objects must never become a requirement of an
  // earlier marker (107 once leaked into m102 through an open-ended TABLES.slice(8) and made production read "drift").
  const { STATE_SQL } = await import(runnerUrl);
  const parts = STATE_SQL.split(/ as m(\d{3}),/);
  const markers = {};
  for (let i = 1; i < parts.length; i += 2) markers[parts[i]] = parts[i - 1].slice(parts[i - 1].lastIndexOf('\n  ('));
  for (const id of ['099', '100', '101', '102', '103', '104', '105', '106']) {
    assert.ok(markers[id], `marker m${id} present`);
    assert.doesNotMatch(markers[id], /psi_agt002_company_profile_snapshots|psi_freeze_agt002_company_profile_snapshot/, `m${id} must not depend on migration 107`);
  }
  assert.match(markers['107'], /psi_agt002_company_profile_snapshots/);
}
