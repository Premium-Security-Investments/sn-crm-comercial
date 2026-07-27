import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { ACTIONS, can } from '../access-control.js';
import { buildTenderOfferPreparation } from '../tender-offer-preparation.js';

const human = (role, permissions = []) => ({
  id: `user-${role}`,
  role,
  active: true,
  identity_type: 'human',
  areas: [],
  permissions,
});

const viewer = human('director', ['licitaciones']);
const custodian = human('director', ['licitaciones', 'licitaciones_custodia']);
const privilegedWithoutCustody = human('admin', ['licitaciones']);

assert.equal(ACTIONS.LICITACIONES_CONVERT, 'licitaciones.convert', 'La conversión debe tener una acción explícita y auditable.');
assert.equal(can(viewer, ACTIONS.LICITACIONES_CONVERT), false, 'Ver Licitaciones no autoriza convertir una detección.');
assert.equal(can(privilegedWithoutCustody, ACTIONS.LICITACIONES_CONVERT), false, 'Admin no recibe custodia implícita por su rol.');
assert.equal(can(custodian, ACTIONS.LICITACIONES_CONVERT), true, 'La capacidad explícita de custodia autoriza convertir.');
assert.equal(can(viewer, ACTIONS.LICITACIONES_CONFIGURE), false, 'Ver Licitaciones no autoriza cambiar reglas o perfil SN.');
assert.equal(can(privilegedWithoutCustody, ACTIONS.LICITACIONES_CONFIGURE), false, 'Admin no recibe configuración de custodia implícita.');
assert.equal(can(custodian, ACTIONS.LICITACIONES_CONFIGURE), true, 'La custodia explícita autoriza configurar.');

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
assert.equal(server, api, 'Los handlers productivos deben permanecer byte-idénticos.');
for (const source of [server, api]) {
  for (const route of [
    "app.post('/api/tender-search-profiles'",
    "app.delete('/api/tender-search-profiles/:id'",
  ]) {
    const start = source.indexOf(route);
    assert.notEqual(start, -1, `Falta ruta ${route}`);
    const block = source.slice(start, source.indexOf('\n});', start) + 4);
    assert.match(block, /requireAction\(currentProfile, ACTIONS\.LICITACIONES_CONFIGURE\)/, `${route} debe exigir custodia explícita.`);
  }
  for (const route of ["app.post('/api/tenders/convert'", "app.post('/api/tender-convert'"]) {
    const start = source.indexOf(route);
    assert.notEqual(start, -1, `Falta ruta ${route}`);
    const block = source.slice(start, source.indexOf('\n});', start) + 4);
    assert.match(block, /requireAction\(currentProfile, ACTIONS\.LICITACIONES_CONVERT\)/, `${route} debe exigir custodia explícita.`);
  }

  const classifyStart = source.indexOf('function classifyTenderSection');
  const classifyEnd = source.indexOf('\n}', classifyStart) + 2;
  const classifyBody = source.slice(classifyStart, classifyEnd);
  assert.doesNotMatch(classifyBody, /['"]descartar['"]/, 'El score no puede producir descarte automático.');
  assert.match(classifyBody, /prioridad_baja/, 'La capa automática debe expresar prioridad baja, no descarte.');
  assert.doesNotMatch(source, /\.filter\(t\s*=>\s*t\.score\s*>=\s*35\)/, 'El score no puede ocultar candidatos relevantes.');
  assert.doesNotMatch(source, /\.slice\(0,\s*80\)/, 'El radar combinado no puede truncar silenciosamente a 80 resultados.');
}

const migrationPath = new URL('../supabase/migrations/029_agt002_charter_authority.sql', import.meta.url);
assert.equal(existsSync(migrationPath), true, 'Debe existir migración de defensa en profundidad para custodia AGT-002.');
const migration = readFileSync(migrationPath, 'utf8').toLowerCase().replace(/\s+/g, ' ');
assert.match(migration, /licitaciones_custodia/, 'La migración debe registrar la capacidad explícita.');
assert.match(migration, /psi_profile_has_tender_custody/, 'La base debe resolver custodia por perfil activo y permiso explícito.');
assert.match(migration, /psi_convert_tender_to_opportunity/, 'La conversión debe quedar protegida también dentro de la base.');
assert.match(migration, /psi_record_company_procurement_document/, 'Los documentos corporativos deben quedar protegidos también dentro de la base.');
assert.match(migration, /revoke all on function public\.psi_profile_has_tender_custody\(uuid\) from anon/, 'La función de custodia no puede quedar ejecutable por anon.');
assert.match(migration, /revoke all on function public\.psi_upsert_company_procurement_profile\(uuid, jsonb\) from anon/, 'La RPC del perfil institucional no puede quedar ejecutable por anon.');
assert.equal((migration.match(/revoke all on function %s from anon/g) || []).length, 2, 'Conversión y documentos deben revocar EXECUTE a anon.');
assert.doesNotMatch(migration, /directora\.licitaciones@seguridadnacional\.co/, 'La autorización no puede depender de un correo hardcodeado.');
const mainSrc = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
assert.ok(mainSrc.includes('Capacidades operativas exclusivas'), 'Admin debe poder asignar custodia como capacidad, no como módulo.');

const preparation = buildTenderOfferPreparation(
  { id: 'opportunity-1', company_name: 'Entidad pública' },
  [],
  null,
  { id: 'custodian-1', full_name: 'Encargada' },
);
assert.equal(Object.hasOwn(preparation, 'auto_generated_documents'), false, 'No debe existir un arreglo que afirme generación automática inexistente.');
assert.ok(Array.isArray(preparation.planned_documents), 'El expediente debe declarar documentos planificados.');
assert.ok(preparation.planned_documents.length > 0, 'Debe conservar el plan documental post-GO.');
assert.ok(preparation.planned_documents.every(item => !item.status.includes('generado')), 'Ningún estado puede afirmar que un archivo fue generado.');
assert.doesNotMatch(preparation.control_message, /creado|generad[oa]s?/i, 'El mensaje de control no puede afirmar creación o generación de archivos.');

console.log('AGT-002 charter alignment contract passed');
