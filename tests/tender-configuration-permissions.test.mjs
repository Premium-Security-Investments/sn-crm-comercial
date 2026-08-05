import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';

const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const configurationPath = new URL('../src/tenders/TenderConfigurationView.tsx', import.meta.url);
const permissionsPath = new URL('../src/tenders/permissions.ts', import.meta.url);

assert.equal(existsSync(configurationPath), true, 'La vista protegida de Configuración debe existir.');
assert.equal(existsSync(permissionsPath), true, 'El helper de permisos de Configuración debe existir.');

const tabs = read('src/tenders/components/TenderModuleTabs.tsx');
const configuration = read('src/tenders/TenderConfigurationView.tsx');
const moduleSource = read('src/tenders/TendersModule.tsx');
const moduleNavigation = read('src/tenders/components/TenderModuleNavigation.tsx');
const server = read('server/index.js');
const api = read('api/[...path].js');

assert.doesNotMatch(tabs, />Configuración</, 'Configuración debe quedar fuera de tabs operativos.');
assert.match(moduleSource, /TenderModuleNavigation/, 'El módulo debe reutilizar la navegación compacta compartida.');
assert.match(moduleNavigation, />Configuración</, 'Configuración debe ser un botón secundario fuera de tabs.');
assert.match(configuration, /Base empresarial de licitaciones/);
assert.match(configuration, /Actualizar RUP/);
assert.doesNotMatch(configuration, /Guardar búsqueda|Búsquedas guardadas/);
assert.doesNotMatch(moduleSource, /TenderProfilesView/, 'La vista mezclada debe retirarse después de actualizar sus consumidores.');

for (const source of [server, api]) {
  assert.match(source, /ACTIONS\.LICITACIONES_CONFIGURE/);
  assert.match(source, /ACTIONS\.LICITACIONES_COMPANY_PROFILE_UPDATE/);
  assert.match(source, /app\.get\('\/api\/tender-company-profile'[\s\S]*?requireAction\(currentProfile, ACTIONS\.LICITACIONES_VIEW\)/, 'GET debe conservar permiso de lectura.');
  assert.match(source, /app\.get\('\/api\/tender-company-documents'[\s\S]*?requireAction\(currentProfile, ACTIONS\.LICITACIONES_VIEW\)/, 'Inventario documental debe exigir lectura.');
  assert.match(source, /app\.put\('\/api\/tender-company-profile'[\s\S]*?requireAction\(currentProfile, ACTIONS\.LICITACIONES_COMPANY_PROFILE_UPDATE\)/, 'PUT de ficha debe exigir mantenimiento empresarial dedicado.');
  for (const [method, endpoint] of [
    ['post', '/api/tender-company-profile-upload-url'],
    ['post', '/api/tender-company-profile-process-upload'],
    ['post', '/api/tender-company-profile-upload'],
    ['post', '/api/tender-company-document-upload-url'],
    ['post', '/api/tender-company-document-process-upload'],
  ]) {
    const escaped = endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(source, new RegExp(`app\\.${method}\\('${escaped}'[\\s\\S]*?requireAction\\(currentProfile, ACTIONS\\.LICITACIONES_CONFIGURE\\)`), `${method.toUpperCase()} ${endpoint} debe exigir configuración.`);
  }
}
assert.equal(server, api, 'Los handlers deben mantener paridad byte-a-byte.');

const bundle = buildSync({ entryPoints: [permissionsPath.pathname], bundle: true, platform: 'node', format: 'esm', write: false });
const permissionsUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
const { canConfigureTenders, canManageTenderCompanyDocuments } = await import(permissionsUrl);
const human = (role, permissions = ['licitaciones']) => ({ id: `user-${role}`, role, active: true, identity_type: 'human', permissions });
for (const scenario of [
  { name: 'admin sin autoridad explícita no edita ficha', profile: human('admin'), expected: false },
  { name: 'gerencia sin autoridad explícita no edita ficha', profile: human('gerencia'), expected: false },
  { name: 'director con custodia edita ficha', profile: human('director', ['licitaciones', 'licitaciones_custodia']), expected: true },
  { name: 'Katherine con permiso dedicado edita ficha', profile: human('comercial', ['licitaciones', 'licitaciones_empresa']), expected: true },
  { name: 'comercial con permiso no configura', profile: human('comercial'), expected: false },
  { name: 'director sin permiso no configura', profile: human('director', []), expected: false },
  { name: 'agent no configura', profile: { id: 'agent-1', active: true, identity_type: 'agent', role: 'admin', permissions: ['licitaciones'] }, expected: false },
]) assert.equal(canConfigureTenders(scenario.profile), scenario.expected, scenario.name);

for (const scenario of [
  { name: 'custodia administra documentos', profile: human('comercial', ['licitaciones', 'licitaciones_custodia']), expected: true },
  { name: 'Katherine no administra documentos', profile: human('comercial', ['licitaciones', 'licitaciones_empresa']), expected: false },
  { name: 'agente nunca administra documentos', profile: { id: 'agent-1', active: true, identity_type: 'agent', role: 'admin', permissions: ['licitaciones', 'licitaciones_custodia'] }, expected: false },
]) assert.equal(canManageTenderCompanyDocuments(scenario.profile), scenario.expected, scenario.name);

assert.match(moduleSource, /canManageTenderCompanyDocuments/);
assert.match(configuration, /canManageDocuments/);

console.log('tender configuration permission contract passed');
