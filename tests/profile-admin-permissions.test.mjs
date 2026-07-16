import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

process.env.VERCEL = '1';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const {
  normalizeProfileAccessRequest,
  legacyCommercialAreaFromAssignments,
  enrichProfilesWithAccess,
  replaceProfileAccess,
  assertNoAdminSelfLockout,
  persistProfileAccessChange,
  ensureProfileAuthAfterCommit,
} = await import('../server/index.js');

const catalog = {
  areas: [{ code: 'comercial', name: 'Comercial' }, { code: 'operaciones', name: 'Operaciones' }],
  subareas: [
    { code: 'seguridad_fisica', area_code: 'comercial', name: 'Seguridad física' },
    { code: 'tecnologia', area_code: 'comercial', name: 'Tecnología' },
    { code: 'licitaciones', area_code: 'comercial', name: 'Licitaciones' },
    { code: 'vigilancia_fisica', area_code: 'operaciones', name: 'Vigilancia física' },
  ],
  permissions: [{ code: 'licitaciones', name: 'Licitaciones', description: 'Acceso a licitaciones' }],
};

const profileAccessStateTs = readFileSync(new URL('../src/profileAccessState.ts', import.meta.url), 'utf8');
const profileAccessStateJs = ts.transpileModule(profileAccessStateTs, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { setAreaScopeSelection } = await import(`data:text/javascript;base64,${Buffer.from(profileAccessStateJs).toString('base64')}`);
const operationsWhole = { area_code: 'operaciones', subarea_code: null };
assert.deepEqual(
  setAreaScopeSelection([operationsWhole], 'comercial', 'tecnologia', true),
  [operationsWhole, { area_code: 'comercial', subarea_code: 'tecnologia' }],
  'seleccionar una subárea conserva el área completa de otra área',
);
assert.deepEqual(
  setAreaScopeSelection([operationsWhole, { area_code: 'comercial', subarea_code: null }], 'comercial', 'tecnologia', true),
  [operationsWhole, { area_code: 'comercial', subarea_code: 'tecnologia' }],
  'seleccionar una subárea reemplaza solo el alcance completo de su propia área',
);
assert.deepEqual(
  setAreaScopeSelection([operationsWhole, { area_code: 'comercial', subarea_code: 'seguridad_fisica' }], 'comercial', 'tecnologia', true),
  [operationsWhole, { area_code: 'comercial', subarea_code: 'seguridad_fisica' }, { area_code: 'comercial', subarea_code: 'tecnologia' }],
  'permite varias subáreas sin perder otras áreas',
);
assert.deepEqual(
  setAreaScopeSelection([operationsWhole, { area_code: 'comercial', subarea_code: 'tecnologia' }], 'comercial', null, true),
  [operationsWhole, { area_code: 'comercial', subarea_code: null }],
  'seleccionar área completa elimina solo las subáreas de esa área',
);

assert.deepEqual(
  normalizeProfileAccessRequest({
    areas: [
      { area_code: 'comercial', subarea_code: 'tecnologia' },
      { area_code: 'operaciones', subarea_code: 'vigilancia_fisica' },
      { area_code: 'comercial', subarea_code: 'tecnologia' },
    ],
    permissions: ['licitaciones', 'licitaciones'],
  }, catalog, 'comercial'),
  {
    areas: [
      { area_code: 'comercial', subarea_code: 'tecnologia' },
      { area_code: 'operaciones', subarea_code: 'vigilancia_fisica' },
    ],
    permissions: ['licitaciones'],
  },
  'normaliza asignaciones múltiples y deduplica exactamente',
);

for (const [body, message] of [
  [{ permissions: [] }, /áreas/i],
  [{ areas: [] }, /permisos/i],
  [{ areas: [{ area_code: 'desconocida', subarea_code: null }], permissions: [] }, /área/i],
  [{ areas: [{ area_code: 'comercial', subarea_code: 'vigilancia_fisica' }], permissions: [] }, /subárea/i],
  [{ areas: [{ area_code: 'comercial', subarea_code: null }, { area_code: 'comercial', subarea_code: 'tecnologia' }], permissions: [] }, /ambigua/i],
  [{ areas: [], permissions: ['desconocido'] }, /permiso/i],
  [{ areas: Array.from({ length: 101 }, () => ({ area_code: 'comercial', subarea_code: 'tecnologia' })), permissions: [] }, /máximo/i],
]) {
  assert.throws(() => normalizeProfileAccessRequest(body, catalog, 'comercial'), message);
}
assert.throws(
  () => normalizeProfileAccessRequest({ areas: [], permissions: ['licitaciones'] }, catalog, 'colaborador'),
  /licitaciones/i,
  'no concede Licitaciones a un rol sin sentido para ese permiso',
);

assert.equal(legacyCommercialAreaFromAssignments([{ area_code: 'comercial', subarea_code: 'seguridad_fisica' }]), 'seguridad_fisica');
assert.equal(legacyCommercialAreaFromAssignments([{ area_code: 'comercial', subarea_code: 'tecnologia' }]), 'tecnologia');
assert.equal(legacyCommercialAreaFromAssignments([{ area_code: 'comercial', subarea_code: 'licitaciones' }]), 'licitacion_publica');
assert.equal(legacyCommercialAreaFromAssignments([{ area_code: 'comercial', subarea_code: null }]), null);
assert.equal(legacyCommercialAreaFromAssignments([{ area_code: 'comercial', subarea_code: 'tecnologia' }, { area_code: 'operaciones', subarea_code: 'vigilancia_fisica' }]), null);

assert.deepEqual(
  enrichProfilesWithAccess(
    [{ id: 'one', full_name: 'Uno' }, { id: 'two', full_name: 'Dos' }],
    [{ profile_id: 'one', area_code: 'comercial', subarea_code: 'tecnologia' }, { profile_id: 'two', area_code: 'operaciones', subarea_code: null }],
    [{ profile_id: 'two', permission_code: 'licitaciones' }, { profile_id: 'one', permission_code: 'licitaciones' }],
  ),
  [
    { id: 'one', full_name: 'Uno', areas: [{ area_code: 'comercial', subarea_code: 'tecnologia' }], permissions: ['licitaciones'] },
    { id: 'two', full_name: 'Dos', areas: [{ area_code: 'operaciones', subarea_code: null }], permissions: ['licitaciones'] },
  ],
  'agrupa filas batched sin mezclar perfiles',
);
for (const [profiles, assignments, permissions, message] of [
  [[{ id: 'one' }], [{ profile_id: 'one', area_code: 'comercial' }], [], /asignaciones/i],
  [[{ id: 'one' }], [], [{ profile_id: 'one', permission_code: ' ' }], /permisos/i],
  [[{ id: 'one' }], [{ profile_id: 'other', area_code: 'comercial', subarea_code: null }], [], /perfil inesperado/i],
  [[{ id: 'one' }], [], [{ profile_id: 'other', permission_code: 'licitaciones' }], /perfil inesperado/i],
]) {
  assert.throws(() => enrichProfilesWithAccess(profiles, assignments, permissions), message, 'las lecturas administrativas deben fallar cerradamente');
}
assert.throws(() => enrichProfilesWithAccess(null, [], []), /perfiles/i);

function accessDatabase({ failAuditOnce = false } = {}) {
  const tables = {
    psi_profile_area_assignments: [],
    psi_profile_permissions: [],
    psi_access_audit_log: [],
  };
  let shouldFailAudit = failAuditOnce;
  return {
    tables,
    database: {
      from(table) {
        assert.ok(Object.hasOwn(tables, table), `tabla simulada inesperada: ${table}`);
        return {
          delete() {
            return {
              eq(column, value) {
                assert.equal(column, 'profile_id');
                tables[table] = tables[table].filter(row => row.profile_id !== value);
                return Promise.resolve({ data: null, error: null });
              },
            };
          },
          insert(value) {
            if (table === 'psi_access_audit_log' && shouldFailAudit) {
              shouldFailAudit = false;
              return Promise.resolve({ data: null, error: new Error('relation psi_access_audit_log unavailable') });
            }
            tables[table].push(...(Array.isArray(value) ? value : [value]));
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    },
  };
}
const beforeAccess = {
  areas: [{ area_code: 'comercial', subarea_code: 'seguridad_fisica' }],
  permissions: [],
  areaRows: [{ area_code: 'comercial', subarea_code: 'seguridad_fisica', created_by: 'old-actor' }],
  permissionRows: [],
};
const afterAccess = {
  areas: [{ area_code: 'operaciones', subarea_code: null }],
  permissions: ['licitaciones'],
};
const successDb = accessDatabase();
successDb.tables.psi_profile_area_assignments.push({ profile_id: 'target', ...beforeAccess.areaRows[0] });
await replaceProfileAccess(successDb.database, { profileId: 'target', actorProfileId: 'admin', before: beforeAccess, after: afterAccess });
assert.deepEqual(successDb.tables.psi_profile_area_assignments, [{ profile_id: 'target', area_code: 'operaciones', subarea_code: null, created_by: 'admin' }]);
assert.deepEqual(successDb.tables.psi_profile_permissions, [{ profile_id: 'target', permission_code: 'licitaciones', created_by: 'admin' }]);
assert.deepEqual(successDb.tables.psi_access_audit_log[0], {
  actor_profile_id: 'admin', target_profile_id: 'target', action: 'profile.access.replace',
  before_state: { areas: beforeAccess.areas, permissions: beforeAccess.permissions }, after_state: afterAccess,
});
const failingDb = accessDatabase({ failAuditOnce: true });
failingDb.tables.psi_profile_area_assignments.push({ profile_id: 'target', ...beforeAccess.areaRows[0] });
const originalConsoleError = console.error;
console.error = () => {};
try {
  await assert.rejects(
    replaceProfileAccess(failingDb.database, { profileId: 'target', actorProfileId: 'admin', before: beforeAccess, after: afterAccess }),
    error => error?.status === 500 && error?.code === 'PROFILE_ACCESS_WRITE_FAILED' && error?.message === 'No se pudo guardar el alcance de acceso. Intente nuevamente.' && Boolean(error?.cause),
  );
} finally {
  console.error = originalConsoleError;
}
assert.deepEqual(failingDb.tables.psi_profile_area_assignments, [{ profile_id: 'target', ...beforeAccess.areaRows[0] }], 'restaura áreas exactas después de un fallo');
assert.deepEqual(failingDb.tables.psi_profile_permissions, [], 'restaura permisos exactos después de un fallo');

for (const target of [
  { profileId: 'admin-id', microsoftEmail: 'other@example.com', role: 'colaborador', active: true },
  { profileId: 'other-id', microsoftEmail: ' ADMIN@EXAMPLE.COM ', role: 'admin', active: false },
  { microsoftEmail: ' admin@example.com ', role: 'junta', active: true },
]) {
  assert.throws(
    () => assertNoAdminSelfLockout({ id: 'admin-id', microsoft_email: 'Admin@example.com' }, target),
    error => error?.status === 400 && /propio rol de administrador/i.test(error.message),
    'bloquea el autobloqueo por id del perfil o email normalizado',
  );
}
assert.doesNotThrow(
  () => assertNoAdminSelfLockout({ id: 'admin-id', microsoft_email: 'Admin@example.com' }, { profileId: 'admin-id', microsoftEmail: ' admin@example.com ', role: 'admin', active: true }),
  'conservar administrador activo para el propio perfil es inocuo',
);
assert.doesNotThrow(
  () => assertNoAdminSelfLockout({ id: 'admin-id', microsoft_email: 'admin@example.com' }, { profileId: 'other-id', microsoftEmail: 'other@example.com', role: 'colaborador', active: false }),
  'la administración de otro perfil permanece permitida',
);

const oldProfile = { id: 'target', full_name: 'Nombre anterior', microsoft_email: 'old@example.com', role: 'admin', active: true, commercial_area: 'seguridad_fisica', can_edit_customer_segment: false };
const changedProfile = { full_name: 'Nombre nuevo', microsoft_email: 'new@example.com', role: 'colaborador', active: false, commercial_area: null, can_edit_customer_segment: true };
const rpcCalls = [];
const rpcDatabase = {
  rpc(name, params) {
    rpcCalls.push({ name, params });
    return Promise.resolve({ data: { id: oldProfile.id, ...changedProfile }, error: null });
  },
};
assert.deepEqual(
  await persistProfileAccessChange(rpcDatabase, { mode: 'patch', targetId: oldProfile.id, beforeProfile: oldProfile, profileValues: changedProfile, beforeAccess, afterAccess, actorProfileId: 'admin', operationId: 'operation' }),
  { id: oldProfile.id, ...changedProfile },
);
assert.deepEqual(rpcCalls, [{
  name: 'psi_admin_persist_profile_access',
  params: {
    p_mode: 'patch', p_target_id: oldProfile.id, p_expected_profile: oldProfile,
    p_profile: changedProfile, p_areas: afterAccess.areas, p_permissions: afterAccess.permissions, p_actor_profile_id: 'admin', p_operation_id: 'operation',
  },
}], 'el helper envía un único comando transaccional con snapshot optimista');
await assert.rejects(
  persistProfileAccessChange({ rpc: () => Promise.resolve({ data: null, error: { code: '23505' } }) }, { mode: 'post', targetId: null, beforeProfile: null, profileValues: changedProfile, afterAccess, actorProfileId: 'admin' }),
  error => error?.status === 409 && error?.code === 'PROFILE_ADMIN_CONFLICT',
);
await assert.rejects(
  persistProfileAccessChange({ rpc: () => Promise.resolve({ data: null, error: { code: '40001' } }) }, { mode: 'patch', targetId: oldProfile.id, beforeProfile: oldProfile, profileValues: changedProfile, afterAccess, actorProfileId: 'admin' }),
  error => error?.status === 409 && error?.code === 'PROFILE_ADMIN_STALE',
);

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const src = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
await assert.rejects(
  persistProfileAccessChange({ rpc: () => Promise.resolve({ data: null, error: { code: '55P03' } }) }, { mode: 'patch', targetId: oldProfile.id, beforeProfile: oldProfile, profileValues: changedProfile, afterAccess, actorProfileId: 'admin', operationId: 'operation' }),
  error => error?.status === 409 && error?.code === 'PROFILE_ADMIN_BUSY',
);

const req = { headers: { origin: 'https://crm.example.test' } };
const newCalls = [];
const newAuthResult = await ensureProfileAuthAfterCommit({
  rpc: async (name, args) => { newCalls.push(['bind', name, args]); return { data: true, error: null }; },
  auth: {
  admin: {
    listUsers: async () => ({ data: { users: [] }, error: null }),
    createUser: async attributes => { newCalls.push(['create', attributes]); return { data: { user: { id: 'new-auth', email: attributes.email } }, error: null }; },
    updateUserById: async (id, attributes) => { newCalls.push(['confirm', id, attributes]); return { data: { user: { id, email: 'new@example.test', email_confirmed_at: 'now' } }, error: null }; },
    generateLink: async () => { newCalls.push(['link']); return { data: { properties: { action_link: 'https://auth.example.test/access' } }, error: null }; },
  },
  resetPasswordForEmail: async email => { newCalls.push(['reset', email]); return { error: null }; },
} }, { targetProfileId: 'new-profile', email: 'new@example.test', password: 'temporary-secret', userMetadata: { role: 'admin' }, active: true, sendInvite: true, req });
assert.equal(newCalls.filter(([kind]) => kind === 'create').length, 1, 'identidad nueva se crea una sola vez después del commit');
assert.equal(newCalls.filter(([kind]) => kind === 'bind').length, 1, 'identidad nueva se vincula al perfil original antes de enviar acceso');
assert.equal(newCalls.find(([kind]) => kind === 'create')[1].email_confirm, false, 'la identidad nace sin confirmar hasta obtener vínculo durable');
assert.deepEqual(newCalls.map(([kind]) => kind), ['create', 'bind', 'confirm', 'reset', 'link'], 'orden seguro: crear sin confirmar, vincular, confirmar y luego enviar acceso');
assert.equal(newAuthResult.invited, true);
assert.equal(newAuthResult.accessLink, 'https://auth.example.test/access');
assert.equal(newAuthResult.authWarning, null);

const existingCalls = [];
const existingUser = { id: 'existing-auth', email: 'existing@example.test', email_confirmed_at: 'now' };
const existingAuthResult = await ensureProfileAuthAfterCommit({
  rpc: async () => ({ data: true, error: null }),
  auth: {
  admin: {
    listUsers: async () => ({ data: { users: [existingUser] }, error: null }),
    createUser: async () => { existingCalls.push(['create']); throw new Error('no debe crear'); },
    updateUserById: async () => { existingCalls.push(['update']); throw new Error('no debe sobrescribir'); },
    generateLink: async () => ({ data: { properties: { action_link: 'https://auth.example.test/existing' } }, error: null }),
  },
  resetPasswordForEmail: async email => { existingCalls.push(['reset', email]); return { error: null }; },
} }, { targetProfileId: 'existing-profile', email: existingUser.email, password: 'replacement-secret', userMetadata: { role: 'junta' }, active: true, sendInvite: false, req });
assert.deepEqual(existingCalls, [['reset', existingUser.email]], 'identidad existente conserva email/password y recibe recuperación controlada');
assert.equal(existingAuthResult.invited, true);
assert.equal(existingAuthResult.authWarning, null);

const failedAuthResult = await ensureProfileAuthAfterCommit({ auth: { admin: {
  listUsers: async () => ({ data: null, error: new Error('auth unavailable') }),
} } }, { targetProfileId: 'failed-profile', email: 'failed@example.test', password: '', userMetadata: {}, active: true, sendInvite: true, req });
assert.match(failedAuthResult.authWarning, /perfil quedó guardado/i, 'fallo Auth post-commit se reporta sin fingir rollback');

const staleCalls = [];
const staleAuthResult = await ensureProfileAuthAfterCommit({
  rpc: async (name, args) => { staleCalls.push(['bind', name, args]); return { data: false, error: null }; },
  auth: {
    admin: {
      listUsers: async () => ({ data: { users: [{ id: 'stale-auth', email: 'reused@example.test', email_confirmed_at: 'now' }] }, error: null }),
      updateUserById: async () => { staleCalls.push(['update']); return { data: {}, error: null }; },
      generateLink: async () => { staleCalls.push(['link']); return { data: {}, error: null }; },
    },
    resetPasswordForEmail: async () => { staleCalls.push(['reset']); return { error: null }; },
  },
}, { targetProfileId: 'original-profile', email: 'reused@example.test', password: '', userMetadata: {}, active: true, sendInvite: true, req });
assert.deepEqual(staleCalls.map(([kind]) => kind), ['bind'], 'provisión obsoleta no confirma ni envía acceso para un email reutilizado');
assert.match(staleAuthResult.authWarning, /perfil cambió|obsolet/i);

for (const backend of [server, api]) {
  for (const route of ["app.get('/api/users'", "app.post('/api/users'", "app.patch('/api/users'", "app.get('/api/access-catalog'"]) {
    const start = backend.indexOf(route);
    assert.ok(start >= 0, `${route} debe existir`);
    assert.match(backend.slice(start, start + 1200), /requireAction\(currentProfile, ACTIONS\.USERS_MANAGE, \{\}\)/, `${route} usa el motor de autorización`);
  }
  assert.match(backend, /psi_org_areas.*active.*true/is);
  assert.match(backend, /psi_org_subareas.*active.*true/is);
  assert.match(backend, /psi_access_permissions.*active.*true/is);
  assert.match(backend, /psi_profile_area_assignments[\s\S]{0,500}\.in\('profile_id', ids\)/);
  assert.match(backend, /psi_profile_permissions[\s\S]{0,500}\.in\('profile_id', ids\)/);
  assert.match(backend, /psi_access_audit_log/);
  assert.match(backend, /created_by:\s*currentProfile\.id/);
  assert.doesNotMatch(backend, /compensateAuthMutation|deleteUser\(/, 'Auth no tiene rollback destructivo');
  assert.match(backend, /export function assertNoAdminSelfLockout/);
  assert.match(backend, /export async function persistProfileAccessChange/);
  assert.match(backend, /database\.rpc\('psi_admin_persist_profile_access'/);
  assert.doesNotMatch(backend.slice(backend.indexOf('export async function persistProfileAccessChange'), backend.indexOf('function authContextUnavailable')), /\.delete\(\).*psi_sales_profiles|Profile administration database compensation/s);
  const post = backend.slice(backend.indexOf("app.post('/api/users'"), backend.indexOf("app.patch('/api/users'"));
  const patch = backend.slice(backend.indexOf("app.patch('/api/users'"), backend.indexOf("const distPath"));
  assert.ok(post.indexOf('assertNoAdminSelfLockout') < post.indexOf('persistProfileAccessChange'), 'POST protege autobloqueo antes del commit');
  assert.ok(patch.indexOf('assertNoAdminSelfLockout') < patch.indexOf('persistProfileAccessChange'), 'PATCH protege autobloqueo antes del commit');
  assert.ok(post.lastIndexOf('persistProfileAccessChange') < post.indexOf('ensureProfileAuthAfterCommit'), 'POST persiste autoridad DB antes de tocar Auth');
  assert.ok(patch.lastIndexOf('persistProfileAccessChange') < patch.indexOf('ensureProfileAuthAfterCommit'), 'PATCH persiste autoridad DB antes de tocar Auth');
  assert.match(backend.slice(backend.indexOf('async function ensureProfileAuthAfterCommit'), backend.indexOf('async function generateAccessLink')), /sendAccessEmail/, 'helper post-commit controla el envío de acceso');
  assert.doesNotMatch(post, /inviteUserByEmail/, 'POST no usa invitación con envío implícito antes del commit');
  assert.doesNotMatch(post, /updateUserById[^\n]*(password|email\s*:)/, 'POST no sobrescribe password/email de Auth existente');
  assert.doesNotMatch(patch, /updateUserById[^\n]*(password|email\s*:)/, 'PATCH no sobrescribe password/email de Auth existente');
  assert.match(post, /releaseProfileAdministrationLock/);
  assert.match(patch, /releaseProfileAdministrationLock/);
}
assert.equal(server, api, 'server y handler Vercel deben mantenerse idénticos');

assert.match(profileAccessStateTs, /export type AccessAssignment =/);
assert.match(src, /type AccessAssignment/);
assert.match(src, /areas\?: AccessAssignment\[\]/);
assert.match(src, /permissions\?: string\[\]/);
assert.match(src, /api<AccessCatalog>\('\/api\/access-catalog'\)/);
assert.match(src, /Toda el área/);
assert.match(src, /<fieldset/);
assert.match(src, /<legend/);
assert.match(src, /'licitaciones'/);
assert.match(src, /\['colaborador','Colaborador'\]/);
assert.match(src, /\['junta','Junta'\]/);
assert.match(src, /Permisos/);
assert.doesNotMatch(src.slice(src.indexOf('function UsersAdmin'), src.indexOf('createRoot')), /<label>Área comercial/);

execFileSync('npm', ['run', 'build'], { stdio: 'inherit', cwd: new URL('..', import.meta.url) });
console.log('profile admin permissions checks passed');
