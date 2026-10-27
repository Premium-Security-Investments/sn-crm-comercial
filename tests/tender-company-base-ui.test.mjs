import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = relative => readFileSync(new URL(relative, root), 'utf8');
const configuration = read('src/tenders/TenderConfigurationView.tsx');
const documentsPath = new URL('src/tenders/components/TenderCompanyDocuments.tsx', root);
assert.ok(existsSync(documentsPath), 'TenderCompanyDocuments must render the versioned inventory.');
const documents = readFileSync(documentsPath, 'utf8');
const styles = read('src/styles.css');

for (const marker of [
  'Base empresarial de licitaciones', 'persistedCompany', 'draftCompany', 'const [editing', 'Editar información',
  'Cancelar', 'Guardar cambios', 'loadCompanyProcurementDocuments', 'Actualizar RUP', 'Actualizar documento empresarial',
  'role="dialog"', 'aria-modal="true"', "event.key === 'Escape'", 'restoreFocus',
]) assert.ok(configuration.includes(marker), `TenderConfigurationView missing marker: ${marker}`);

assert.doesNotMatch(configuration, /Configuración protegida/, 'La base debe comunicar consulta empresarial, no configuración protegida.');
assert.match(configuration, /if \(saved\)[\s\S]*setPersistedCompany[\s\S]*setEditing\(false\)/, 'Guardar sólo sale de edición después de una respuesta exitosa.');
assert.match(configuration, /catch \(cause\)[\s\S]*setMessage[\s\S]*finally/, 'Los fallos deben conservar el borrador y comunicar el error.');
assert.match(configuration, /const cancelEditing[\s\S]*setDraftCompany\(persistedCompany\)[\s\S]*setEditing\(false\)/, 'Cancelar restaura la copia persistida y vuelve a consulta.');
assert.match(configuration, /issuedAt[\s\S]*required/, 'La expedición debe exigirse cuando el API la requiere.');
assert.match(configuration, /Promise\.allSettled\([\s\S]*loadCompanyProfile[\s\S]*loadCompanyProcurementDocuments/, 'Perfil e inventario deben cargarse de forma independiente.');
// Un solo camino de carga (2026-10-27). El RUP entra por el mismo formulario con el bloque
// preseleccionado, para que el documento quede siempre ligado a su ficha y para que el registro
// del documento ocurra antes de releer el PDF: si el releído falla, la carga no se pierde.
assert.doesNotMatch(configuration, /uploadRup\(/, 'La vista ya no usa la ruta propia del RUP: hay un solo camino de carga.');
assert.match(configuration, /openUploadDialog\(event\.currentTarget, 'rup'\)/, 'El botón del RUP abre el formulario único con su bloque preseleccionado.');
assert.match(configuration, /onUploadSupport=\{canManageDocuments && !editing \? openUploadDialog : undefined\}/, 'Cada bloque sin soporte debe poder cargarlo desde su propia fila.');
assert.match(configuration, /if \(presetType\) setDocumentType\(presetType\)/, 'Abrir desde una fila preselecciona el bloque, para que nada quede desligado.');
assert.match(configuration, /companyBase\.registry\.map\(entry => <option/, 'Los tipos de documento son las fichas del registro, no una lista genérica aparte.');
assert.match(configuration, /RUP cargado y ficha corporativa actualizada/, 'Cargar el RUP debe confirmar que la ficha corporativa se releyó.');
assert.match(configuration, /openUploadDialog[\s\S]*!canManageDocuments \|\| editing/, 'No se debe abrir una carga sin custodia documental ni mientras existe un borrador empresarial activo.');
assert.equal((configuration.match(/disabled=\{editing\}/g) || []).length, 2, 'Actualizar RUP y Añadir documento deben bloquearse durante la edición.');

for (const marker of [
  'TenderCompanyDocuments', 'display_name', 'document_type', 'version', 'issued_at', 'expires_at', 'current',
  'vigente', 'vence_pronto', 'vencido', 'sin_vencimiento', 'Ver documento',
]) assert.ok(documents.includes(marker), `TenderCompanyDocuments missing marker: ${marker}`);

for (const marker of [
  '.company-base-actions', '.company-document-list', '.company-document-card', '@media(max-width:768px)',
]) assert.ok(styles.includes(marker), `styles.css missing responsive base marker: ${marker}`);

console.log('tender company procurement base UI contract passed');
