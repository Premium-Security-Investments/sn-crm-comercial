import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const documents = readFileSync(new URL('../src/tenders/components/TenderDocumentSection.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

// The document count must appear exactly once (inside "Ver documentos (N)"), not
// duplicated as "N archivo(s)" next to the eyebrow/title as well.
assert.doesNotMatch(documents, /\{documents\.length\} archivo\(s\)/, 'El conteo de archivos no debe repetirse junto al título.');
assert.match(documents, /Ver documentos \(\{documents\.length\}\)/, 'El conteo debe vivir una sola vez en "Ver documentos (N)".');

// "Ver documentos", "Actualizar documentos" and "Cargar complementarios" must be
// grouped together. AGT-002 Task 6: the single "Fuente oficial" link lives exclusively
// in the TenderDetailNavigation shell now; Documentos must not duplicate it.
const groupStart = documents.indexOf('<div className="tender-document-actions-group"');
assert.ok(groupStart >= 0, 'Debe existir un grupo dedicado para las acciones documentales.');
const groupEnd = documents.indexOf('</div>', documents.indexOf('Cargar complementarios', groupStart));
const group = documents.slice(groupStart, groupEnd);
assert.match(group, /Ver documentos/, 'El grupo debe incluir Ver documentos.');
assert.match(group, /Actualizar documentos/, 'El grupo debe incluir Actualizar documentos.');
assert.match(group, /Cargar complementarios/, 'El grupo debe incluir Cargar complementarios.');
assert.doesNotMatch(documents, /Abrir fuente oficial|sourceUrl|tender-document-external-link/, 'Documentos no debe duplicar la Fuente oficial única del shell (TenderDetailNavigation).');
assert.match(group, /role="group"[^>]*aria-label="Gestión documental"/, 'El conjunto debe exponerse como grupo de controles relacionados.');
for (const intent of ['consult', 'refresh', 'upload']) assert.match(group, new RegExp(`tender-document-action-${intent}`), `Falta intención visual ${intent}.`);

const actionsRowStart = documents.indexOf('<div className="tender-document-actions"');
const actionsRowEnd = documents.indexOf('{refreshResult', actionsRowStart);
assert.ok(actionsRowStart >= 0 && actionsRowEnd > actionsRowStart, 'Debe existir la fila de acciones documentales.');
const actionsRow = documents.slice(actionsRowStart, actionsRowEnd);
const groupIndex = actionsRow.indexOf('tender-document-actions-group');
assert.ok(groupIndex >= 0, 'La fila debe contener el grupo de acciones documentales.');

// Responsive wrap + gap for both the outer row and the inner group.
assert.match(styles, /\.tender-document-actions\{[^}]*gap:/, 'La fila de acciones debe declarar gap.');
assert.match(styles, /\.tender-document-actions\{[^}]*flex-wrap:wrap/, 'La fila de acciones debe envolver responsivamente.');
assert.match(styles, /\.tender-document-actions-group\{[^}]*gap:/, 'El grupo de acciones documentales debe declarar gap.');
assert.match(styles, /\.tender-document-actions-group\{[^}]*flex-wrap:wrap/, 'El grupo de acciones documentales debe envolver responsivamente.');
assert.match(styles, /\.tender-document-action\{[^}]*min-height:/, 'Cada acción debe mantener un objetivo táctil consistente.');
assert.match(styles, /\.tender-document-action:focus-visible/, 'Las acciones deben tener foco de teclado visible.');
assert.match(styles, /@media\(max-width:700px\)[\s\S]*?\.tender-document-action[^}]*width:100%/, 'En móvil cada acción debe ocupar el ancho disponible.');

console.log('tender document actions layout checks passed');
