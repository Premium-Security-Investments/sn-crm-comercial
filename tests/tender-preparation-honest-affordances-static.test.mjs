import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// --- A. SharePoint: no false actionable affordance when the folder URL is absent ---

assert(src.includes('Carpeta de oferta aún no conectada'), 'Cuando no hay URL de SharePoint, debe mostrarse un estado informativo honesto.');
assert(/gestionan (directamente )?en el expediente/.test(src), 'El estado sin URL debe aclarar que los documentos se gestionan en el expediente mientras se habilita la integración.');
assert(!src.includes('Carpeta SharePoint / OneDrive: vínculo pendiente de integración automática.'), 'El texto anterior sugería una integración automática inexistente; debe reemplazarse por el estado honesto.');

const sharePointAnchor = src.match(/<a className="button" href=\{sharePointUrl\}[^>]*>Abrir carpeta<\/a>/);
assert(sharePointAnchor, 'Cuando sí existe URL pública, debe conservarse un enlace accionable "Abrir carpeta".');
assert(sharePointAnchor[0].includes('rel="noopener noreferrer"'), 'El enlace de SharePoint debe usar rel="noopener noreferrer" quo evitar reverse-tabnabbing.');
assert(sharePointAnchor[0].includes('target="_blank"'), 'El enlace de SharePoint debe abrir en una pestaña nueva.');

// --- B. Notes: no false Vig-IA interaction affordance ---

assert(src.includes('Nota interna de preparación'), 'El área de notas debe renombrarse explícitamente a "Nota interna de preparación".');
assert(/no es procesada ni respondida autom[aá]ticamente por Vig-IA/i.test(src), 'Debe aclararse visiblemente que la nota no es procesada ni respondida automáticamente por Vig-IA.');
assert(src.includes('Guardar nota interna'), 'El botón de guardar debe decir "Guardar nota interna".');
assert(!src.includes('Guardar nota para el asistente'), 'El texto anterior sugería que un asistente conversacional procesaría la nota; debe eliminarse.');
assert(!src.includes('Informar qué necesitamos para seguir adelante'), 'El encabezado anterior sugería una interacción con un asistente; debe reemplazarse por el área de nota interna renombrada.');

// --- persistence untouched ---
assert(src.includes('/api/tender-offer-preparation-note'), 'La persistencia de la nota interna debe conservarse sin simular conversación.');
assert(src.includes('saveAssistantNote'), 'El manejador de guardado existente debe conservarse (solo cambia el texto visible, no el flujo).');

console.log('tender preparation honest affordances static checks passed');
