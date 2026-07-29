import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const modulePath = new URL('../scripts/agt002-workbench-migration.mjs', import.meta.url);
const mod = await import(modulePath);
const {
  stripTopLevelTransactionWrapper, MIGRATION_FILE, ROLLBACK_FILE,
  classifyState, prerequisitesOk, agt003Ok, verifyOk, verifyAbsentOk,
  preflight, apply, verify, rollback, checkZeroData,
} = mod;

// --- stripTopLevelTransactionWrapper despoja begin;/commit; de 045 y de su rollback ---
{
  const raw = readFileSync(new URL('../supabase/migrations/045_agt002_dossier_workbench.sql', import.meta.url), 'utf8');
  const stripped = stripTopLevelTransactionWrapper(raw);
  assert.doesNotMatch(stripped.trim().split(/\r?\n/)[0], /^begin;$/i);
  assert.doesNotMatch(stripped.trim(), /\bcommit;\s*$/i);
  assert.match(stripped, /create table if not exists public\.psi_agt002_workbench_threads/);

  const rawRb = readFileSync(new URL('../supabase/rollbacks/045_agt002_dossier_workbench_rollback.sql', import.meta.url), 'utf8');
  const strippedRb = stripTopLevelTransactionWrapper(rawRb);
  assert.doesNotMatch(strippedRb.trim().split(/\r?\n/)[0], /^begin;$/i);
  assert.doesNotMatch(strippedRb.trim(), /\bcommit;\s*$/i);
}

// --- Nombres de archivo ---
assert.equal(MIGRATION_FILE, '045_agt002_dossier_workbench.sql');
assert.equal(ROLLBACK_FILE, '045_agt002_dossier_workbench_rollback.sql');

// --- Forma estática del rollback SQL (fail-closed y orden de dependencia) ---
{
  const rb = readFileSync(new URL('../supabase/rollbacks/045_agt002_dossier_workbench_rollback.sql', import.meta.url), 'utf8');
  const norm = rb.toLowerCase();
  // La guarda de evidencia aparece ANTES de cualquier drop table / alter drop column.
  const guardIdx = norm.indexOf('raise exception');
  const firstDropTable = norm.indexOf('drop table');
  const firstDropColumn = norm.indexOf('drop column');
  assert.ok(guardIdx > 0, 'debe existir una guarda raise exception');
  assert.ok(guardIdx < firstDropTable, 'la guarda de evidencia precede a drop table');
  assert.ok(guardIdx < firstDropColumn, 'la guarda de evidencia precede a drop column');
  assert.match(norm, /author_kind='agent' or origin_agent_job_id is not null/);
  assert.match(norm, /evidencia de auditoría no puede destruirse/);
  // Restaura las funciones de la migración 040.
  assert.match(norm, /create or replace function public\.psi_project_tender_dossier_artifact\(/);
  assert.match(norm, /create or replace function public\.psi_record_tender_dossier_artifact_review\(/);
  // Elimina sólo las columnas añadidas por 045.
  assert.match(norm, /drop column if exists origin_agent_job_id/);
  assert.match(norm, /drop column if exists author_kind/);
  // Rompe la FK cíclica messages<->jobs antes de eliminar tablas.
  const fkIdx = norm.indexOf('psi_agt002_workbench_messages_origin_job_fkey');
  const dropJobs = norm.indexOf('drop table if exists public.psi_agt002_workbench_jobs');
  assert.ok(fkIdx > 0 && fkIdx < dropJobs, 'la FK origin_job se retira antes de eliminar jobs');
  // Orden de dependencia: decisions antes que proposals; jobs antes que messages; messages antes que threads.
  const order = [
    'drop table if exists public.psi_agt002_learning_decisions',
    'drop table if exists public.psi_agt002_learning_proposals',
    'drop table if exists public.psi_agt002_workbench_jobs',
    'drop table if exists public.psi_agt002_workbench_messages',
    'drop table if exists public.psi_agt002_workbench_threads',
  ].map(s => norm.indexOf(s));
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i] > order[i - 1] && order[i - 1] >= 0, `orden de drop table incorrecto en índice ${i}`);
  }
  // La función de trigger se elimina al final.
  assert.ok(norm.indexOf('drop function if exists public.psi_reject_agt002_workbench_mutation') > order[order.length - 1]);
}

// --- Revoke explícito de PUBLIC en todas las superficies (migración 045) ---
{
  const mig = readFileSync(new URL('../supabase/migrations/045_agt002_dossier_workbench.sql', import.meta.url), 'utf8').toLowerCase();
  // Tablas: revoke all ... from public (las 8, vía loop dinámico).
  assert.match(mig, /execute format\('revoke all on table public\.%i from public, anon, authenticated'/);
  // RPC de servicio: revoke all ... from public antes del grant a service_role (loop dinámico).
  assert.match(mig, /execute format\('revoke all on function public\.%s from public, anon, authenticated, service_role'/);
  // RPC terminales legacy: revoke explícito de public.
  assert.match(mig, /revoke all on function public\.psi_append_agt002_agent_result\([\s\S]*?from public, anon, authenticated, service_role/);
  assert.match(mig, /revoke all on function public\.psi_append_agt002_agent_artifact_version\([\s\S]*?from public, anon, authenticated, service_role/);
}

// --- Revoke explícito de PUBLIC en las funciones 040 restauradas (rollback 045) ---
{
  const rb = readFileSync(new URL('../supabase/rollbacks/045_agt002_dossier_workbench_rollback.sql', import.meta.url), 'utf8').toLowerCase();
  assert.match(rb, /revoke all on function public\.psi_project_tender_dossier_artifact\(uuid\) from public, anon, authenticated/);
  assert.match(rb, /revoke all on function public\.psi_record_tender_dossier_artifact_review\(uuid,uuid,text,text\) from public, anon, authenticated/);
}

// --- Predicados puros ---
assert.equal(classifyState({ tables_present: 0, rpc_present: 0, trigger_fn_present: false, col_author_kind: false, col_origin_job: false }), 'absent');
assert.equal(classifyState({ tables_present: 8, rpc_present: 8, trigger_fn_present: true, col_author_kind: true, col_origin_job: true }), 'applied');
assert.equal(classifyState({ tables_present: 4, rpc_present: 8, trigger_fn_present: true, col_author_kind: true, col_origin_job: true }), 'partial');
assert.equal(classifyState({ tables_present: 8, rpc_present: 8, trigger_fn_present: true, col_author_kind: true, col_origin_job: false }), 'partial');
assert.equal(prerequisitesOk({ a: 'public.x', b: 'public.y' }), true);
assert.equal(prerequisitesOk({ a: 'public.x', b: null }), false);
assert.equal(agt003Ok({ perm_active: '1', holders: '1' }), true);
assert.equal(agt003Ok({ perm_active: '1', holders: '0' }), false);

const appliedVerifyRow = {
  tables_present: 8, rls_enabled: 8, unsafe_grants: 0, service_allowed: 24, service_forbidden: 0,
  rpc_service_exec: 8, rpc_public_exec: 0, legacy_exec: 0, legacy_present: 2, append_only_triggers: 8,
  idx_one_active: true, idx_queue: true, idx_cursor: true, idx_agent_job_unique: true,
  artifact_constraints: 3, origin_job_fk: 1, col_author_kind: true, col_origin_job: true,
  table_public_grants: 0, service_public_exec: 0, legacy_public_exec: 0,
  idef_present: 4, idef_service_exec: 4, idef_role_exec: 0, idef_public_exec: 0,
  agt003_perm: 1, agt003_holders: 1,
};
assert.equal(verifyOk(appliedVerifyRow), true);
assert.equal(verifyOk({ ...appliedVerifyRow, unsafe_grants: 1 }), false, 'grant inseguro a anon/authenticated debe fallar');
assert.equal(verifyOk({ ...appliedVerifyRow, legacy_exec: 1 }), false, 'RPC legacy ejecutable debe fallar');
assert.equal(verifyOk({ ...appliedVerifyRow, service_forbidden: 1 }), false, 'service_role con INSERT debe fallar');
assert.equal(verifyOk({ ...appliedVerifyRow, agt003_holders: 0 }), false, 'AGT-003 alterado debe fallar');
// PUBLIC (grantee OID 0) debe probarse por catálogo/ACL de forma independiente.
assert.equal(verifyOk({ ...appliedVerifyRow, table_public_grants: 1 }), false, 'privilegio de tabla para PUBLIC debe fallar');
assert.equal(verifyOk({ ...appliedVerifyRow, service_public_exec: 1 }), false, 'EXECUTE de PUBLIC en RPC de servicio debe fallar');
assert.equal(verifyOk({ ...appliedVerifyRow, legacy_public_exec: 1 }), false, 'EXECUTE de PUBLIC en RPC legacy (o proacl NULL) debe fallar');
// psi_project + 3 helpers SECURITY DEFINER: presentes, service_role-only.
assert.equal(verifyOk({ ...appliedVerifyRow, idef_present: 3 }), false, 'helper/projector ausente debe fallar');
assert.equal(verifyOk({ ...appliedVerifyRow, idef_service_exec: 3 }), false, 'service_role sin EXECUTE en helper/projector debe fallar');
assert.equal(verifyOk({ ...appliedVerifyRow, idef_role_exec: 1 }), false, 'anon/authenticated con EXECUTE en helper/projector debe fallar');
assert.equal(verifyOk({ ...appliedVerifyRow, idef_public_exec: 1 }), false, 'PUBLIC (o proacl NULL) con EXECUTE en helper/projector debe fallar');

const absentRow = {
  tables_present: 0, rpc_present: 0, trigger_fn_present: false, legacy_present: false,
  col_author_kind: false, col_origin_job: false, idx_agent_job_unique: false, artifact_constraints: 0,
  fn_project: true, fn_review: true,
  project_service_exec: true, project_role_exec: 0, project_public_exec: false,
  agt003_perm: 1, agt003_holders: 1,
};
assert.equal(verifyAbsentOk(absentRow), true);
assert.equal(verifyAbsentOk({ ...absentRow, tables_present: 1 }), false);
assert.equal(verifyAbsentOk({ ...absentRow, fn_project: false }), false, 'función 040 no restaurada debe fallar');
assert.equal(verifyAbsentOk({ ...absentRow, agt003_perm: 0 }), false, 'AGT-003 ausente debe fallar');
// Tras el rollback psi_project debe quedar endurecida (no sólo restaurada).
assert.equal(verifyAbsentOk({ ...absentRow, project_service_exec: false }), false, 'service_role sin EXECUTE en projector restaurada debe fallar');
assert.equal(verifyAbsentOk({ ...absentRow, project_role_exec: 1 }), false, 'anon/authenticated con EXECUTE en projector restaurada debe fallar');
assert.equal(verifyAbsentOk({ ...absentRow, project_public_exec: true }), false, 'PUBLIC (o proacl NULL) en projector restaurada debe fallar');

// Fake execSql: enruta por el prefijo de cada consulta conocida.
function makeFakeExec({ state, verifyRow, absentRow: absent, zeroData }) {
  const calls = [];
  const exec = async (sql) => {
    calls.push(sql);
    if (/from public\.psi_access_permissions where code='vigia_copilot_pilot' and active\) as perm_active/i.test(sql)) {
      return [{ perm_active: '1', holders: '1' }];
    }
    if (/to_regclass\('public\.psi_sales_opportunities'\)/i.test(sql)) {
      return [{ a: 'public.psi_sales_opportunities', b: 'public.x', c: 'public.y', d: 'public.z' }];
    }
    if (/as tables_present,[\s\S]*as rpc_present,[\s\S]*trigger_fn_present,[\s\S]*col_author_kind,[\s\S]*col_origin_job;/i.test(sql)
        && !/rls_enabled/i.test(sql)) {
      return [state];
    }
    if (/rls_enabled/i.test(sql)) return [verifyRow];
    if (/as fn_project,/i.test(sql)) return [absent];
    if (/as workbench_rows,/i.test(sql)) return [zeroData];
    return [];
  };
  exec.calls = calls;
  return exec;
}

// --- apply desde absent envía el 045 en UNA sola llamada de DDL y luego verifica ---
{
  const exec = makeFakeExec({
    state: { tables_present: 0, rpc_present: 0, trigger_fn_present: false, col_author_kind: false, col_origin_job: false },
    verifyRow: appliedVerifyRow,
  });
  const res = await apply(exec);
  assert.equal(res.ok, true);
  const ddlCalls = exec.calls.filter(s => /create table if not exists public\.psi_agt002_workbench_threads/i.test(s));
  assert.equal(ddlCalls.length, 1, 'apply envía el 045 exactamente una vez');
}

// --- apply desde applied es no-op (no reenvía DDL) y verifica ---
{
  const exec = makeFakeExec({
    state: { tables_present: 8, rpc_present: 8, trigger_fn_present: true, col_author_kind: true, col_origin_job: true },
    verifyRow: appliedVerifyRow,
  });
  const res = await apply(exec);
  assert.equal(res.ok, true);
  assert.equal(exec.calls.filter(s => /create table if not exists/i.test(s)).length, 0, 'no reenvía DDL si ya está aplicado');
}

// --- preflight aborta ante estado parcial ---
{
  const exec = makeFakeExec({
    state: { tables_present: 3, rpc_present: 8, trigger_fn_present: true, col_author_kind: true, col_origin_job: true },
  });
  await assert.rejects(preflight(exec), /parcial/i);
}

// --- rollback desde applied con datos cero envía el rollback y verifica ausencia ---
{
  const exec = makeFakeExec({
    state: { tables_present: 8, rpc_present: 8, trigger_fn_present: true, col_author_kind: true, col_origin_job: true },
    absentRow,
    zeroData: { workbench_rows: 0, agent_versions: 0 },
  });
  const res = await rollback(exec);
  assert.equal(res.ok, true);
  assert.equal(exec.calls.filter(s => /drop table if exists public\.psi_agt002_workbench_threads/i.test(s)).length, 1);
}

// --- rollback aborta si existe evidencia (datos > 0) sin enviar rollback SQL ---
{
  const exec = makeFakeExec({
    state: { tables_present: 8, rpc_present: 8, trigger_fn_present: true, col_author_kind: true, col_origin_job: true },
    zeroData: { workbench_rows: 5, agent_versions: 0 },
  });
  await assert.rejects(rollback(exec), /evidencia/i);
  assert.equal(exec.calls.filter(s => /drop table if exists/i.test(s)).length, 0, 'no envía DDL destructivo con evidencia');
}

// --- rollback desde absent es no-op ---
{
  const exec = makeFakeExec({
    state: { tables_present: 0, rpc_present: 0, trigger_fn_present: false, col_author_kind: false, col_origin_job: false },
    absentRow,
  });
  const res = await rollback(exec);
  assert.equal(res.ok, true);
  assert.equal(exec.calls.filter(s => /drop table if exists/i.test(s)).length, 0);
}

// --- checkZeroData interpreta filas/versiones ---
{
  const exec = async () => [{ workbench_rows: '0', agent_versions: '0' }];
  assert.equal((await checkZeroData(exec)).ok, true);
  const exec2 = async () => [{ workbench_rows: '0', agent_versions: '2' }];
  assert.equal((await checkZeroData(exec2)).ok, false);
}

// --- main() no se ejecuta al importar ---
{
  const source = readFileSync(new URL('../scripts/agt002-workbench-migration.mjs', import.meta.url), 'utf8');
  assert.match(source, /import\.meta\.url === /);
  // Nunca imprime secretos.
  assert.doesNotMatch(source, /console\.log\([^)]*serviceKey/i);
  assert.doesNotMatch(source, /console\.log\([^)]*SUPABASE_SERVICE_ROLE_KEY/i);
}

console.log('AGT-002 workbench migration runner + rollback static checks passed');
