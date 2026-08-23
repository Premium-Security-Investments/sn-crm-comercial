import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureKatherineCompanyPermission, KATHERINE_PERMISSION_OPT_IN_ENV } from '../scripts/ensure_katherine_company_permission.mjs';

const env = { VERCEL_ENV: 'production', RUN_KATHERINE_COMPANY_PERMISSION_BOOTSTRAP: 'true', NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-service-key' };
const katherine = { id: '00000000-0000-4000-8000-000000000123', full_name: '  Katherine   Valencia Buitrago ', active: true, identity_type: null };
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => body == null ? '' : JSON.stringify(body) });

function mockFetch({
  profiles = [katherine],
  assignments = [{ permission_code: 'licitaciones' }],
  companyCatalog = [],
  catalogInsert = [{ code: 'licitaciones_empresa', active: true }],
  assignmentInsert = [{ profile_id: katherine.id, permission_code: 'licitaciones_empresa' }],
  auditStatus = 201,
} = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || 'GET';
    calls.push({ url: String(url), method, body: options.body ? JSON.parse(options.body) : null });
    if (method === 'GET' && String(url).includes('psi_sales_profiles')) return response(profiles);
    if (method === 'GET' && String(url).includes('psi_access_permissions')) {
      return response(String(url).includes('code=eq.licitaciones_empresa') ? companyCatalog : [{ code: 'licitaciones', active: true }]);
    }
    if (method === 'GET' && String(url).includes('psi_profile_permissions')) return response(assignments);
    if (method === 'POST' && String(url).includes('psi_access_permissions')) return response(catalogInsert, 201);
    if (method === 'POST' && String(url).includes('psi_profile_permissions')) return response(assignmentInsert, 201);
    if (method === 'POST' && String(url).includes('psi_access_audit_log')) return response(auditStatus === 201 ? null : { message: 'audit failed' }, auditStatus);
    if (method === 'DELETE' && String(url).includes('psi_profile_permissions')) return response(null, 204);
    if (method === 'DELETE' && String(url).includes('psi_access_permissions')) return response(null, 204);
    return response({ message: 'unexpected call' }, 500);
  };
  return { calls, fetchImpl };
}

{
  const { calls, fetchImpl } = mockFetch();
  const result = await ensureKatherineCompanyPermission({ env: { VERCEL_ENV: 'preview' }, fetchImpl });
  assert.equal(result.status, 'skipped_non_production');
  assert.equal(calls.length, 0);
}

// El nombre de la variable de opt-in es parte del contrato de despliegue: renombrarla
// sin actualizar Vercel debe romper aquí, no en producción.
assert.equal(KATHERINE_PERMISSION_OPT_IN_ENV, 'RUN_KATHERINE_COMPANY_PERMISSION_BOOTSTRAP');

// Producción sin opt-in explícito: no-op total, incluso sin credenciales Supabase
// (el corte debe ocurrir antes de validarlas y antes de cualquier fetch).
for (const optIn of [undefined, '', 'false', 'FALSE', 'TRUE', 'True', 'yes', '1', ' true ', 'true\n']) {
  const { calls, fetchImpl } = mockFetch();
  const optInEnv = optIn === undefined ? {} : { [KATHERINE_PERMISSION_OPT_IN_ENV]: optIn };
  const result = await ensureKatherineCompanyPermission({ env: { VERCEL_ENV: 'production', ...optInEnv }, fetchImpl });
  assert.equal(result.status, 'skipped_opt_in_not_enabled', `opt-in=${JSON.stringify(optIn)} debe ser no-op.`);
  assert.equal(calls.length, 0, `opt-in=${JSON.stringify(optIn)} no debe emitir ninguna llamada.`);
}

{
  // Con credenciales presentes el resultado es el mismo: solo el opt-in habilita la escritura.
  const { calls, fetchImpl } = mockFetch();
  const { RUN_KATHERINE_COMPANY_PERMISSION_BOOTSTRAP: _optIn, ...envWithoutOptIn } = env;
  const result = await ensureKatherineCompanyPermission({ env: envWithoutOptIn, fetchImpl });
  assert.equal(result.status, 'skipped_opt_in_not_enabled');
  assert.equal(calls.length, 0, 'El despliegue de producción normal nunca debe tocar Supabase.');
}

{
  // El opt-in no habilita ejecuciones fuera de producción.
  const { calls, fetchImpl } = mockFetch();
  const result = await ensureKatherineCompanyPermission({ env: { ...env, VERCEL_ENV: 'preview' }, fetchImpl });
  assert.equal(result.status, 'skipped_non_production');
  assert.equal(calls.length, 0);
}

{
  // Con opt-in exacto la validación de credenciales sigue vigente.
  const { calls, fetchImpl } = mockFetch();
  await assert.rejects(
    () => ensureKatherineCompanyPermission({ env: { VERCEL_ENV: 'production', [KATHERINE_PERMISSION_OPT_IN_ENV]: 'true' }, fetchImpl }),
    /Production Supabase credentials are required/,
  );
  assert.equal(calls.length, 0);
}

// Contrato del postbuild: producción sin opt-in imprime un JSON determinista y sale con 0.
const scriptPath = fileURLToPath(new URL('../scripts/ensure_katherine_company_permission.mjs', import.meta.url));
const runScript = extraEnv => spawnSync(process.execPath, [scriptPath], { encoding: 'utf8', env: { PATH: process.env.PATH, ...extraEnv } });
const SKIP_JSON = '{"script":"ensure_katherine_company_permission","status":"skipped_opt_in_not_enabled","optInEnvVar":"RUN_KATHERINE_COMPANY_PERMISSION_BOOTSTRAP","mutated":false}';

for (const extraEnv of [{ VERCEL_ENV: 'production' }, { VERCEL_ENV: 'production', RUN_KATHERINE_COMPANY_PERMISSION_BOOTSTRAP: 'false' }]) {
  const run = runScript(extraEnv);
  assert.equal(run.status, 0, `El postbuild debe salir con 0. stderr: ${run.stderr}`);
  assert.equal(run.stdout.trim(), SKIP_JSON, 'El resultado de skip debe ser JSON determinista.');
}

{
  const tempDirectory = mkdtempSync(join(tmpdir(), 'katherine postbuild '));
  const spacedScriptPath = join(tempDirectory, 'ensure permission.mjs');
  try {
    copyFileSync(scriptPath, spacedScriptPath);
    const run = spawnSync(process.execPath, [spacedScriptPath], { encoding: 'utf8', env: { PATH: process.env.PATH, VERCEL_ENV: 'production' } });
    assert.equal(run.status, 0, `El postbuild debe ejecutar desde rutas con espacios. stderr: ${run.stderr}`);
    assert.equal(run.stdout.trim(), SKIP_JSON);
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
}

{
  // El skip no productivo preexistente se mantiene tal cual.
  const run = runScript({ VERCEL_ENV: 'preview' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), 'katherine_company_permission=skipped_non_production');
}

{
  const { calls, fetchImpl } = mockFetch({ assignments: [] });
  await assert.rejects(() => ensureKatherineCompanyPermission({ env, fetchImpl }), /lacks active base permission licitaciones/);
  assert.equal(calls.some(call => call.method === 'POST'), false, 'La validación base debe ocurrir antes de toda mutación.');
}

{
  const duplicate = { ...katherine, id: '00000000-0000-4000-8000-000000000456' };
  const { calls, fetchImpl } = mockFetch({ profiles: [katherine, duplicate] });
  await assert.rejects(() => ensureKatherineCompanyPermission({ env, fetchImpl }), /found 2/);
  assert.equal(calls.some(call => call.method === 'POST'), false, 'Una coincidencia ambigua debe fallar sin escribir.');
}

{
  const { calls, fetchImpl } = mockFetch({ companyCatalog: [{ code: 'licitaciones_empresa', active: false }] });
  await assert.rejects(() => ensureKatherineCompanyPermission({ env, fetchImpl }), /inactive; refusing to reactivate/);
  assert.equal(calls.some(call => call.method === 'POST'), false, 'Un permiso globalmente inactivo nunca debe reactivarse durante la asignación.');
}

{
  const { calls, fetchImpl } = mockFetch();
  const result = await ensureKatherineCompanyPermission({ env, fetchImpl });
  assert.equal(result.status, 'granted');
  assert.equal(calls.filter(call => call.method === 'POST' && call.url.includes('psi_access_permissions')).length, 1);
  assert.equal(calls.filter(call => call.method === 'POST' && call.url.includes('psi_profile_permissions')).length, 1);
  assert.equal(calls.filter(call => call.method === 'POST' && call.url.includes('psi_access_audit_log')).length, 1);
  const assignment = calls.find(call => call.method === 'POST' && call.url.includes('psi_profile_permissions'));
  assert.deepEqual(assignment.body, { profile_id: katherine.id, permission_code: 'licitaciones_empresa', created_by: null });
  const audit = calls.find(call => call.method === 'POST' && call.url.includes('psi_access_audit_log'));
  assert.equal(audit.body.after_state.assignment_created, true);
  assert.equal(audit.body.after_state.catalog_created, true);
}

{
  const { calls, fetchImpl } = mockFetch({ companyCatalog: [{ code: 'licitaciones_empresa', active: true }] });
  const result = await ensureKatherineCompanyPermission({ env, fetchImpl });
  assert.equal(result.status, 'granted');
  assert.equal(calls.some(call => call.method === 'POST' && call.url.includes('psi_access_permissions')), false);
  const audit = calls.find(call => call.method === 'POST' && call.url.includes('psi_access_audit_log'));
  assert.equal(audit.body.after_state.catalog_created, false);
}

{
  const { calls, fetchImpl } = mockFetch({ auditStatus: 500 });
  await assert.rejects(() => ensureKatherineCompanyPermission({ env, fetchImpl }), /Access audit insert failed/);
  assert.equal(calls.filter(call => call.method === 'DELETE' && call.url.includes('psi_profile_permissions')).length, 1, 'Una auditoría fallida debe compensar la asignación recién creada.');
  assert.equal(calls.filter(call => call.method === 'DELETE' && call.url.includes('psi_access_permissions')).length, 1, 'La compensación solo elimina el catálogo si esta ejecución lo creó.');
}

{
  const { calls, fetchImpl } = mockFetch({
    companyCatalog: [{ code: 'licitaciones_empresa', active: true }],
    assignments: [{ permission_code: 'licitaciones' }, { permission_code: 'licitaciones_empresa' }],
  });
  const result = await ensureKatherineCompanyPermission({ env, fetchImpl });
  assert.equal(result.status, 'already_present');
  assert.equal(calls.some(call => call.method === 'POST'), false, 'Una asignación preexistente y activa debe ser un no-op total.');
  assert.equal(calls.some(call => call.method === 'POST' && call.url.includes('psi_profile_permissions')), false);
  assert.equal(calls.some(call => call.method === 'POST' && call.url.includes('psi_access_audit_log')), false);
}

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
assert.equal(packageJson.scripts['check:deployment-safety'], 'node tests/katherine-company-permission-deployment.test.mjs');
assert.match(packageJson.scripts.build, /^npm run check:deployment-safety && /, 'Cada build debe ejecutar primero el contrato de seguridad del postbuild.');
assert.equal(packageJson.scripts.postbuild, 'node scripts/ensure_katherine_company_permission.mjs');

const migration = readFileSync(new URL('../supabase/migrations/060_katherine_company_profile_permission.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollbacks/060_katherine_company_profile_permission_rollback.sql', import.meta.url), 'utf8');
for (const source of [migration, rollback]) {
  assert.match(source, /Katherine Valencia Buitrago/);
  assert.match(source, /v_match_count <> 1/);
  assert.match(source, /licitaciones_empresa/);
}
assert.match(migration, /lacks active base permission licitaciones/);
assert.match(migration, /refusing to reactivate/);
assert.doesNotMatch(migration, /on conflict \(code\) do update/i, 'La migración nunca debe reactivar el catálogo con upsert.');
assert.match(migration, /'assignment_created', true/);
assert.match(migration, /'catalog_created', v_catalog_inserted_count = 1/);
assert.match(migration, /profile\.permission\.grant\.deployment/);
assert.match(rollback, /profile\.permission\.revoke\.rollback/);
assert.match(rollback, /v_assignment_owned is not true/);
assert.match(rollback, /v_assignment_created_at > v_grant_created_at/);
assert.match(rollback, /v_latest_source not in \('migration_060', 'deployment_060'\)/);
assert.match(rollback, /if v_catalog_owned then/);
assert.match(rollback, /not exists \(/);

console.log('Katherine company permission deployment contract passed');
