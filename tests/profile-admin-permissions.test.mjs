import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

process.env.VERCEL = '1';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const {
  normalizeProfileAccessRequest,
  legacyCommercialAreaFromAssignments,
  enrichProfilesWithAccess,
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
}
assert.equal(server, api, 'server y handler Vercel deben mantenerse idénticos');

assert.match(src, /type AccessAssignment =/);
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
