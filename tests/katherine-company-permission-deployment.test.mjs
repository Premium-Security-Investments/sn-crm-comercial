import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { ensureKatherineCompanyPermission } from '../scripts/ensure_katherine_company_permission.mjs';

const env = { VERCEL_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-service-key' };
const katherine = { id: '00000000-0000-4000-8000-000000000123', full_name: '  Katherine   Valencia Buitrago ', active: true, identity_type: null };
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => body == null ? '' : JSON.stringify(body) });

function mockFetch({ profiles = [katherine], assignments = [{ permission_code: 'licitaciones' }], assignmentInsert = [{ profile_id: katherine.id, permission_code: 'licitaciones_empresa' }], auditStatus = 201 } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || 'GET';
    calls.push({ url: String(url), method, body: options.body ? JSON.parse(options.body) : null });
    if (method === 'GET' && String(url).includes('psi_sales_profiles')) return response(profiles);
    if (method === 'GET' && String(url).includes('psi_access_permissions')) return response([{ code: 'licitaciones', active: true }]);
    if (method === 'GET' && String(url).includes('psi_profile_permissions')) return response(assignments);
    if (method === 'POST' && String(url).includes('psi_access_permissions')) return response(null, 201);
    if (method === 'POST' && String(url).includes('psi_profile_permissions')) return response(assignmentInsert, 201);
    if (method === 'POST' && String(url).includes('psi_access_audit_log')) return response(auditStatus === 201 ? null : { message: 'audit failed' }, auditStatus);
    if (method === 'DELETE' && String(url).includes('psi_profile_permissions')) return response(null, 204);
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
  const { calls, fetchImpl } = mockFetch();
  const result = await ensureKatherineCompanyPermission({ env, fetchImpl });
  assert.equal(result.status, 'granted');
  assert.equal(calls.filter(call => call.method === 'POST' && call.url.includes('psi_access_permissions')).length, 1);
  assert.equal(calls.filter(call => call.method === 'POST' && call.url.includes('psi_profile_permissions')).length, 1);
  assert.equal(calls.filter(call => call.method === 'POST' && call.url.includes('psi_access_audit_log')).length, 1);
  const assignment = calls.find(call => call.method === 'POST' && call.url.includes('psi_profile_permissions'));
  assert.deepEqual(assignment.body, { profile_id: katherine.id, permission_code: 'licitaciones_empresa', created_by: null });
}

{
  const { calls, fetchImpl } = mockFetch({ auditStatus: 500 });
  await assert.rejects(() => ensureKatherineCompanyPermission({ env, fetchImpl }), /Access audit insert failed/);
  assert.equal(calls.filter(call => call.method === 'DELETE' && call.url.includes('psi_profile_permissions')).length, 1, 'Una auditoría fallida debe compensar la asignación recién creada.');
}

{
  const { calls, fetchImpl } = mockFetch({ assignments: [{ permission_code: 'licitaciones' }, { permission_code: 'licitaciones_empresa' }] });
  const result = await ensureKatherineCompanyPermission({ env, fetchImpl });
  assert.equal(result.status, 'already_present');
  assert.equal(calls.some(call => call.method === 'POST' && call.url.includes('psi_profile_permissions')), false);
  assert.equal(calls.some(call => call.method === 'POST' && call.url.includes('psi_access_audit_log')), false);
}

const migration = readFileSync(new URL('../supabase/migrations/060_katherine_company_profile_permission.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollbacks/060_katherine_company_profile_permission_rollback.sql', import.meta.url), 'utf8');
for (const source of [migration, rollback]) {
  assert.match(source, /Katherine Valencia Buitrago/);
  assert.match(source, /v_match_count <> 1/);
  assert.match(source, /licitaciones_empresa/);
}
assert.match(migration, /lacks active base permission licitaciones/);
assert.match(migration, /profile\.permission\.grant\.deployment/);
assert.match(rollback, /profile\.permission\.revoke\.rollback/);
assert.match(rollback, /not exists \(/);

console.log('Katherine company permission deployment contract passed');
