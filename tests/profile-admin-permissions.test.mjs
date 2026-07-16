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

function profileAdministrationDatabase({ failAuditOnce = false } = {}) {
  const { database: accessDb, tables } = accessDatabase({ failAuditOnce });
  tables.psi_sales_profiles = [];
  const profileDatabase = {
    from(table) {
      if (table !== 'psi_sales_profiles') return accessDb.from(table);
      const pick = row => ({ id: row.id, full_name: row.full_name, microsoft_email: row.microsoft_email, role: row.role, active: row.active, commercial_area: row.commercial_area, can_edit_customer_segment: row.can_edit_customer_segment });
      return {
        update(values) {
          return {
            eq(column, value) {
              assert.equal(column, 'id');
              const index = tables.psi_sales_profiles.findIndex(row => row.id === value);
              if (index >= 0) tables.psi_sales_profiles[index] = { ...tables.psi_sales_profiles[index], ...values };
              return { select() { return { single: async () => ({ data: index >= 0 ? pick(tables.psi_sales_profiles[index]) : null, error: null }) }; } };
            },
          };
        },
        insert(values) {
          return {
            select() {
              return {
                single: async () => {
                  if (tables.psi_sales_profiles.some(row => row.microsoft_email === values.microsoft_email)) {
                    return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
                  }
                  const row = { id: 'new-profile', ...values };
                  tables.psi_sales_profiles.push(row);
                  return { data: pick(row), error: null };
                },
              };
            },
          };
        },
        delete() {
          return {
            eq(column, value) {
              assert.equal(column, 'id');
              tables.psi_sales_profiles = tables.psi_sales_profiles.filter(row => row.id !== value);
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
  };
  return { database: profileDatabase, tables };
}

const oldProfile = { id: 'target', full_name: 'Nombre anterior', microsoft_email: 'old@example.com', role: 'admin', active: true, commercial_area: 'seguridad_fisica', can_edit_customer_segment: false };
const changedProfile = { full_name: 'Nombre nuevo', microsoft_email: 'new@example.com', role: 'colaborador', active: false, commercial_area: null, can_edit_customer_segment: true };
const compensatedExisting = profileAdministrationDatabase({ failAuditOnce: true });
compensatedExisting.tables.psi_sales_profiles.push({ ...oldProfile });
compensatedExisting.tables.psi_profile_area_assignments.push({ profile_id: oldProfile.id, ...beforeAccess.areaRows[0] });
console.error = () => {};
try {
  await assert.rejects(
    persistProfileAccessChange(compensatedExisting.database, { mode: 'patch', targetId: oldProfile.id, beforeProfile: oldProfile, profileValues: changedProfile, beforeAccess, afterAccess, actorProfileId: 'admin' }),
    error => error?.status === 500 && error?.code === 'PROFILE_ADMIN_UPDATE_FAILED' && Boolean(error?.cause),
  );
} finally {
  console.error = originalConsoleError;
}
assert.deepEqual(compensatedExisting.tables.psi_sales_profiles, [oldProfile], 'un fallo de acceso restaura exactamente el perfil previo');
assert.deepEqual(compensatedExisting.tables.psi_profile_area_assignments, [{ profile_id: oldProfile.id, ...beforeAccess.areaRows[0] }], 'un fallo de acceso restaura los alcances previos');
assert.deepEqual(compensatedExisting.tables.psi_profile_permissions, [], 'un fallo de acceso no deja permisos nuevos');
assert.deepEqual(compensatedExisting.tables.psi_access_audit_log, [], 'un audit fallido no deja un audit exitoso');

const compensatedNew = profileAdministrationDatabase({ failAuditOnce: true });
console.error = () => {};
try {
  await assert.rejects(
    persistProfileAccessChange(compensatedNew.database, { mode: 'post', targetId: null, beforeProfile: null, profileValues: changedProfile, beforeAccess: { areas: [], permissions: [], areaRows: [], permissionRows: [] }, afterAccess, actorProfileId: 'admin' }),
    error => error?.status === 500 && error?.code === 'PROFILE_ADMIN_UPDATE_FAILED',
  );
} finally {
  console.error = originalConsoleError;
}
assert.deepEqual(compensatedNew.tables.psi_sales_profiles, [], 'un perfil nuevo se elimina si el acceso no puede persistirse');

const concurrentProfile = { id: 'concurrent-profile', ...changedProfile, full_name: 'Creado por otra solicitud' };
const concurrentCreation = profileAdministrationDatabase({ failAuditOnce: true });
concurrentCreation.tables.psi_sales_profiles.push({ ...concurrentProfile });
console.error = () => {};
try {
  await assert.rejects(
    persistProfileAccessChange(concurrentCreation.database, { mode: 'post', targetId: null, beforeProfile: null, profileValues: changedProfile, beforeAccess: { areas: [], permissions: [], areaRows: [], permissionRows: [] }, afterAccess, actorProfileId: 'admin' }),
    error => error?.status === 409 && error?.code === 'PROFILE_ADMIN_CONFLICT',
  );
} finally {
  console.error = originalConsoleError;
}
assert.deepEqual(
  concurrentCreation.tables.psi_sales_profiles,
  [concurrentProfile],
  'un conflicto concurrente nunca actualiza ni elimina el perfil creado por otra solicitud',
);

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const src = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
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
  assert.match(backend, /compensat|restore/i);
  assert.match(backend, /export function assertNoAdminSelfLockout/);
  assert.match(backend, /export async function persistProfileAccessChange/);
  const post = backend.slice(backend.indexOf("app.post('/api/users'"), backend.indexOf("app.patch('/api/users'"));
  const patch = backend.slice(backend.indexOf("app.patch('/api/users'"), backend.indexOf("const distPath"));
  assert.ok(post.indexOf('assertNoAdminSelfLockout') < post.indexOf('findAuthUserByEmail'), 'POST protege autobloqueo antes de tocar Auth');
  assert.ok(post.indexOf('readProfileAccess') < post.indexOf('findAuthUserByEmail'), 'POST captura acceso previo antes de tocar Auth');
  assert.ok(patch.indexOf('assertNoAdminSelfLockout') < patch.indexOf('findAuthUserByEmail'), 'PATCH protege autobloqueo antes de tocar Auth');
  assert.ok(patch.indexOf('readProfileAccess') < patch.indexOf('findAuthUserByEmail'), 'PATCH captura acceso previo antes de tocar Auth');
  assert.match(post, /persistProfileAccessChange\(database/);
  assert.match(patch, /persistProfileAccessChange\(database/);
  assert.match(backend, /updateUserById\(snapshot\.id/);
  assert.match(backend, /deleteUser\(/);
  assert.match(backend, /password[^\n]{0,160}(unreadable|no se puede|cannot)[^\n]{0,160}(server profile|perfil)/i);
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
