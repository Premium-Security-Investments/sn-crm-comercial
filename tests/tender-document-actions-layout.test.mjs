import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const documents = readFileSync(new URL('../src/tenders/components/TenderDocumentSection.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

// The document count must appear exactly once (inside "Ver documentos (N)"), not
// duplicated as "N archivo(s)" next to the eyebrow/title as well.
assert.doesNotMatch(documents, /\{documents\.length\} archivo\(s\)/, 'El conteo de archivos no debe repetirse junto al título.');
assert.match(documents, /Ver documentos \(\{documents\.length\}\)/, 'El conteo debe vivir una sola vez en "Ver documentos (N)".');

// "Ver documentos", "Actualizar documentos" and "Cargar complementarios" must be
// grouped together, and "Abrir fuente oficial" (external navigation) must be a
// sibling outside that group, not interleaved with the document-management actions.
const groupStart = documents.indexOf('<div className="tender-document-actions-group"');
const groupEnd = documents.indexOf('tender-document-external-link');
assert.ok(groupStart >= 0 && groupEnd > groupStart, 'Debe existir un grupo dedicado para las acciones documentales.');
const group = documents.slice(groupStart, groupEnd);
assert.match(group, /Ver documentos/, 'El grupo debe incluir Ver documentos.');
assert.match(group, /Actualizar documentos/, 'El grupo debe incluir Actualizar documentos.');
assert.match(group, /Cargar complementarios/, 'El grupo debe incluir Cargar complementarios.');
assert.doesNotMatch(group, /Abrir fuente oficial/, 'Abrir fuente oficial no debe mezclarse dentro del grupo de acciones documentales.');
assert.match(documents, /Abrir fuente oficial/, 'Abrir fuente oficial debe seguir disponible como navegación externa separada.');

const actionsRowStart = documents.indexOf('<div className="tender-document-actions"');
const actionsRowEnd = documents.indexOf('{refreshResult', actionsRowStart);
assert.ok(actionsRowStart >= 0 && actionsRowEnd > actionsRowStart, 'Debe existir la fila de acciones documentales.');
const actionsRow = documents.slice(actionsRowStart, actionsRowEnd);
const externalIndex = actionsRow.indexOf('Abrir fuente oficial');
const groupIndex = actionsRow.indexOf('tender-document-actions-group');
assert.ok(externalIndex >= 0 && groupIndex >= 0, 'La fila debe contener tanto el grupo como el enlace externo.');

// Responsive wrap + gap for both the outer row and the inner group.
assert.match(styles, /\.tender-document-actions\{[^}]*gap:/, 'La fila de acciones debe declarar gap.');
assert.match(styles, /\.tender-document-actions\{[^}]*flex-wrap:wrap/, 'La fila de acciones debe envolver responsivamente.');
assert.match(styles, /\.tender-document-actions-group\{[^}]*gap:/, 'El grupo de acciones documentales debe declarar gap.');
assert.match(styles, /\.tender-document-actions-group\{[^}]*flex-wrap:wrap/, 'El grupo de acciones documentales debe envolver responsivamente.');

console.log('tender document actions layout checks passed');
