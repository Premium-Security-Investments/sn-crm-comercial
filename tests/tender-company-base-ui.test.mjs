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
  'Cancelar', 'Guardar cambios', 'loadCompanyProcurementDocuments', 'Actualizar RUP', 'Añadir documento empresarial',
  'role="dialog"', 'aria-modal="true"', "event.key === 'Escape'", 'restoreFocus',
]) assert.ok(configuration.includes(marker), `TenderConfigurationView missing marker: ${marker}`);

assert.doesNotMatch(configuration, /Configuración protegida/, 'La base debe comunicar consulta empresarial, no configuración protegida.');
assert.match(configuration, /if \(saved\)[\s\S]*setPersistedCompany[\s\S]*setEditing\(false\)/, 'Guardar sólo sale de edición después de una respuesta exitosa.');
assert.match(configuration, /catch \(cause\)[\s\S]*setMessage[\s\S]*finally/, 'Los fallos deben conservar el borrador y comunicar el error.');
assert.match(configuration, /const cancelEditing[\s\S]*setDraftCompany\(persistedCompany\)[\s\S]*setEditing\(false\)/, 'Cancelar restaura la copia persistida y vuelve a consulta.');
assert.match(configuration, /issuedAt[\s\S]*required/, 'La expedición debe exigirse cuando el API la requiere.');
assert.match(configuration, /Promise\.allSettled\([\s\S]*loadCompanyProfile[\s\S]*loadCompanyProcurementDocuments/, 'Perfil e inventario deben cargarse de forma independiente.');
assert.match(configuration, /uploadRup\(uploadFile\)[\s\S]*setUploadDialog\(null\)[\s\S]*loadCompanyProcurementDocuments[\s\S]*catch/, 'Una carga RUP persistida debe cerrar el diálogo antes del refresh no bloqueante.');
assert.match(configuration, /RUP cargado[\s\S]*inventario/, 'El fallo de refresh debe comunicarse como advertencia posterior, no como fallo de carga.');

for (const marker of [
  'TenderCompanyDocuments', 'display_name', 'document_type', 'version', 'issued_at', 'expires_at', 'current',
  'vigente', 'vence_pronto', 'vencido', 'sin_vencimiento', 'Ver documento',
]) assert.ok(documents.includes(marker), `TenderCompanyDocuments missing marker: ${marker}`);

for (const marker of [
  '.company-base-actions', '.company-document-list', '.company-document-card', '@media(max-width:768px)',
]) assert.ok(styles.includes(marker), `styles.css missing responsive base marker: ${marker}`);

console.log('tender company procurement base UI contract passed');
