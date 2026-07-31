import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const moduleUrl = new URL('../scripts/agt002-program-migrations.mjs', import.meta.url);
assert.equal(existsSync(moduleUrl), true, 'debe existir el runner dedicado 049–055');
const mod = await import(moduleUrl);
const {
  MIGRATION_ORDER, getSpec, stripTopLevelTransactionWrapper, classifyState,
  buildStateSql, buildPrerequisitesSql, buildAtomicApplySql, buildAtomicRollbackSql,
  buildRollbackVerifySql, createExecSql, preflight, apply, rollback,
} = mod;

assert.deepEqual(MIGRATION_ORDER, ['049', '050', '051', '052', '053', '054', '055']);
assert.throws(() => getSpec('056'), /selector/i);
assert.throws(() => getSpec('../050'), /selector/i);

for (const id of MIGRATION_ORDER) {
  const spec = getSpec(id);
  assert.match(spec.migrationFile, new RegExp(`^${id}_`));
  assert.match(spec.rollbackFile, new RegExp(`^${id}_`));
  const migration = readFileSync(new URL(`../supabase/migrations/${spec.migrationFile}`, import.meta.url), 'utf8');
  const rollbackSql = readFileSync(new URL(`../supabase/rollbacks/${spec.rollbackFile}`, import.meta.url), 'utf8');
  for (const sql of [migration, rollbackSql]) {
    const stripped = stripTopLevelTransactionWrapper(sql);
    assert.doesNotMatch(stripped.trim().split(/\r?\n/)[0], /^begin;$/i);
    assert.doesNotMatch(stripped.trim(), /\bcommit;\s*$/i);
  }
  assert.ok(spec.markers.length > 0);
  assert.ok(spec.prerequisites.length > 0);
  const stateSql = buildStateSql(id);
  assert.match(stateSql, new RegExp(`AGT002_RUNNER:STATE:${id}`));
  assert.match(stateSql, /unsafe_table_grants/);
  assert.match(stateSql, /unsafe_function_grants/);
  assert.match(stateSql, /unsafe_service_table_grants/);
  assert.match(stateSql, /missing_service_exec/);
  assert.match(stateSql, /missing_service_select/);
  assert.match(stateSql, /pg_get_(function|constraint)def|has_table_privilege/);
  assert.match(buildPrerequisitesSql(id), new RegExp(`AGT002_RUNNER:PREREQUISITES:${id}`));

  const atomicApply = buildAtomicApplySql(id, migration).toLowerCase();
  assert.match(atomicApply, new RegExp(`agt002_runner:atomic_apply:${id}`));
  assert.match(atomicApply, /pg_advisory_xact_lock/);
  assert.ok(atomicApply.indexOf('pg_advisory_xact_lock') < atomicApply.indexOf(migration.match(/create|alter/i)?.[0].toLowerCase() || 'zzzz'));
  assert.match(atomicApply, new RegExp(`agt002_already_applied_${id}`));
  assert.match(atomicApply, new RegExp(`agt002_state_drift_${id}`));
}

for (const id of ['050', '051']) {
  const spec = getSpec(id);
  const rollbackSql = readFileSync(new URL(`../supabase/rollbacks/${spec.rollbackFile}`, import.meta.url), 'utf8');
  const atomic = buildAtomicRollbackSql(id, rollbackSql).toLowerCase();
  const advisory = atomic.indexOf('pg_advisory_xact_lock');
  const lock = atomic.indexOf('lock table');
  const guard = atomic.indexOf('existe evidencia o una migración dependiente');
  const destructive = Math.min(...['drop table', 'drop column'].map(token => {
    const at = atomic.indexOf(token);
    return at === -1 ? Number.POSITIVE_INFINITY : at;
  }));
  assert.ok(advisory > 0 && advisory < lock, `${id} debe tomar advisory lock antes del lock de tablas`);
  assert.ok(lock < guard && guard < destructive, `${id} debe bloquear DML antes de la guarda y del DDL destructivo`);
  assert.match(atomic, /share row exclusive mode/);
  assert.doesNotMatch(atomic.trim().split(/\r?\n/)[0], /^begin;$/i);
  assert.doesNotMatch(atomic.trim(), /\bcommit;\s*$/i);
}

{
  const spec = getSpec('054');
  const rollbackSql = readFileSync(new URL(`../supabase/rollbacks/${spec.rollbackFile}`, import.meta.url), 'utf8');
  const atomic = buildAtomicRollbackSql('054', rollbackSql).toLowerCase();
  assert.ok(atomic.indexOf('pg_advisory_xact_lock') < atomic.indexOf('lock table public.psi_tender_tracking_events'));
  assert.ok(atomic.indexOf('lock table public.psi_tender_tracking_events') < atomic.indexOf("event_type='documents_chunked'"));
  assert.match(atomic, /share row exclusive mode/);
}

const safe = { unsafe_table_grants: 0, unsafe_function_grants: 0, unsafe_service_table_grants: 0, missing_service_exec: 0, missing_service_select: 0, rls_missing: 0 };
assert.equal(classifyState({ markers_present: 0, markers_expected: 5, ...safe }), 'absent');
assert.equal(classifyState({ markers_present: 3, markers_expected: 5, ...safe }), 'partial');
assert.equal(classifyState({ markers_present: 5, markers_expected: 5, ...safe }), 'applied');
assert.equal(classifyState({ markers_present: 5, markers_expected: 5, ...safe, unsafe_table_grants: 1 }), 'drift');
assert.equal(classifyState({ markers_present: 5, markers_expected: 5, ...safe, unsafe_service_table_grants: 1 }), 'drift');
assert.equal(classifyState({ markers_present: 5, markers_expected: 5, ...safe, missing_service_select: 1 }), 'drift');
assert.equal(classifyState({ markers_present: 6, markers_expected: 5, ...safe }), 'drift');

function fakeExec({ id, initial = 'absent', missingPrerequisites = 0, rollbackSafe = true, rollbackOk = true }) {
  const calls = [];
  let status = initial;
  const spec = getSpec(id);
  const exec = async sql => {
    calls.push(sql);
    if (sql.includes(`AGT002_RUNNER:PREREQUISITES:${id}`)) return [{ missing_prerequisites: missingPrerequisites }];
    if (sql.includes(`AGT002_RUNNER:ROLLBACK_VERIFY:${id}`)) return [{ ok: rollbackOk }];
    if (sql.includes(`AGT002_RUNNER:STATE:${id}`)) {
      const expected = spec.markers.length;
      const present = status === 'absent' ? 0
        : status === 'disabled' ? expected - spec.disabledMarkerCount
          : status === 'partial' ? Math.max(1, expected - 1) : expected;
      return [{ markers_present: present, markers_expected: expected, ...safe, unsafe_table_grants: status === 'drift' ? 1 : 0 }];
    }
    if (sql.includes(`AGT002_RUNNER:ATOMIC_APPLY:${id}`)) {
      if (missingPrerequisites) throw new Error(`AGT002_PREREQUISITES_${id}`);
      if (status === 'applied') throw new Error(`AGT002_ALREADY_APPLIED_${id}`);
      if (status === 'partial' || status === 'drift') throw new Error(`AGT002_STATE_DRIFT_${id}`);
      status = 'applied';
      return [];
    }
    if (sql.includes(`AGT002_RUNNER:ATOMIC_ROLLBACK:${id}`)) {
      if (status === 'absent' || status === 'disabled') throw new Error(`AGT002_ALREADY_ROLLED_BACK_${id}`);
      if (status !== 'applied') throw new Error(`AGT002_STATE_DRIFT_${id}`);
      if (!rollbackSafe) throw new Error(`rollback ${id} bloqueado: existe evidencia o una migración dependiente`);
      status = spec.disabledMarkerCount ? 'disabled' : 'absent';
      return [];
    }
    return [];
  };
  exec.calls = calls;
  exec.status = () => status;
  return exec;
}

for (const id of MIGRATION_ORDER) {
  const exec = fakeExec({ id });
  const result = await apply(exec, id);
  assert.equal(result.status, 'applied');
  assert.equal(exec.calls.filter(sql => sql.includes(`AGT002_RUNNER:ATOMIC_APPLY:${id}`)).length, 1);
  const skipped = await apply(exec, id);
  assert.equal(skipped.skipped, true);
}

for (const id of MIGRATION_ORDER) {
  const exec = fakeExec({ id, initial: 'partial' });
  await assert.rejects(apply(exec, id), /STATE_DRIFT|drift/i);
  assert.equal(exec.status(), 'partial');
}

{
  const exec = fakeExec({ id: '050', missingPrerequisites: 1 });
  await assert.rejects(preflight(exec, '050'), /prerrequisitos/i);
  await assert.rejects(apply(exec, '050'), /PREREQUISITES/);
}

for (const id of ['050', '051']) {
  const exec = fakeExec({ id, initial: 'applied', rollbackSafe: false });
  await assert.rejects(rollback(exec, id), /evidencia|dependiente/i);
  assert.equal(exec.status(), 'applied');
}

for (const id of ['052', '053']) {
  const exec = fakeExec({ id, initial: 'applied' });
  const first = await rollback(exec, id);
  assert.equal(first.ok, true);
  assert.equal(exec.status(), 'disabled');
  const second = await rollback(exec, id);
  assert.equal(second.skipped, true);
  assert.equal(second.status, 'disabled');
  const reapplied = await apply(exec, id);
  assert.equal(reapplied.status, 'applied');
}

{
  const exec = fakeExec({ id: '054', initial: 'applied' });
  const first = await rollback(exec, '054');
  assert.equal(first.ok, true);
  assert.equal(exec.status(), 'absent');
  const second = await rollback(exec, '054');
  assert.equal(second.skipped, true);
  assert.equal(second.status, 'absent');
  const reapplied = await apply(exec, '054');
  assert.equal(reapplied.status, 'applied');
}

for (const id of MIGRATION_ORDER) assert.match(buildRollbackVerifySql(id), new RegExp(`ROLLBACK_VERIFY:${id}`));

{
  const requests = [];
  const exec = createExecSql({
    baseUrl: 'https://example.supabase.co/', serviceKey: 'test-secret',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ ok: true, rows: [{ value: 1 }] }) };
    },
  });
  assert.deepEqual(await exec('select 1;'), [{ value: 1 }]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://example.supabase.co/rest/v1/rpc/exec_sql');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers.apikey, 'test-secret');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer test-secret');
  assert.deepEqual(JSON.parse(requests[0].options.body), { sql: 'select 1' });
}

{
  const malformed = createExecSql({
    baseUrl: 'https://example.supabase.co', serviceKey: 'secret',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
  });
  await assert.rejects(malformed('select 1'), /respuesta inválida/i);
}

{
  const ddl = createExecSql({
    baseUrl: 'https://example.supabase.co', serviceKey: 'secret',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, rows: null }) }),
  });
  assert.deepEqual(await ddl('create table example(id bigint);'), [], 'exec_sql representa DDL exitoso sin filas como rows:null');
}

{
  const rejected = createExecSql({
    baseUrl: 'https://example.supabase.co', serviceKey: 'secret',
    fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ ok: false, error: 'password=TOPSECRET and raw SQL' }) }),
  });
  await assert.rejects(rejected('select 1'), error => !error.message.includes('TOPSECRET') && /rechazó/.test(error.message));
}

assert.throws(() => stripTopLevelTransactionWrapper('begin;\nselect 1;\ncommit;\nselect 2;'), /fail-closed/i);

const source = readFileSync(moduleUrl, 'utf8');
assert.match(source, /import\.meta\.url === /);
assert.doesNotMatch(source, /console\.(log|error)\([^)]*(serviceKey|SUPABASE_SERVICE_ROLE_KEY)/i);
assert.doesNotMatch(source, /process\.argv\[[^\]]+\].*readFileSync/i, 'no debe aceptar rutas arbitrarias desde CLI');

console.log('AGT-002 program migrations 049–055 runner contract passed');
