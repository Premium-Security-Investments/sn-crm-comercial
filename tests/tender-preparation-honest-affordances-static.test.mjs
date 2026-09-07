import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// --- A. SharePoint: no false actionable affordance when the folder URL is absent ---

// La afirmación honesta más simple es no afirmar nada: sin URL resuelta no se muestra enlace, ni
// advertencia, ni la taxonomía de carpetas que nadie puede abrir todavía.
const sharePointAnchor = src.match(/<a className="button" href=\{sharePointUrl\}[^>]*>Abrir carpeta<\/a>/);
assert(sharePointAnchor, 'Cuando sí existe URL pública, debe conservarse un enlace accionable "Abrir carpeta".');
assert(sharePointAnchor[0].includes('rel="noopener noreferrer"'), 'El enlace de SharePoint debe usar rel="noopener noreferrer" para evitar reverse-tabnabbing.');
assert(sharePointAnchor[0].includes('target="_blank"'), 'El enlace de SharePoint debe abrir en una pestaña nueva.');
assert(/\{sharePointUrl \? <a[\s\S]*?>Abrir carpeta<\/a> : null\}/.test(src), 'Sin URL resuelta no puede renderizarse ningún sustituto: ni enlace muerto ni advertencia.');
assert(!src.includes('Carpeta SharePoint / OneDrive: vínculo pendiente de integración automática.'), 'El texto anterior sugería una integración automática inexistente.');
assert(!src.includes('Carpeta de oferta aún no conectada'), 'El estado sin URL ya no necesita una advertencia grande: el trabajo documental vive en el expediente operativo.');
assert(!src.includes('Se creará al configurar integración Graph'), 'No puede prometerse una carpeta que ninguna integración crea todavía.');
assert(!/document-matrix/.test(src), 'La matriz de carpetas planificadas no puede seguir mostrándose como si existiera.');

// --- B. Notes: el editor de notas narrativo se retiró junto al pseudo-expediente ---

assert(!src.includes('Nota interna de preparación'), 'El área de notas legada debe haberse retirado del panel de preparación.');
assert(!src.includes('Guardar nota interna'), 'No puede quedar el botón de guardado del editor retirado.');
assert(!src.includes('Guardar nota para el asistente'), 'El texto anterior sugería que un asistente conversacional procesaría la nota.');
assert(!src.includes('saveAssistantNote'), 'El manejador de guardado debe retirarse con el editor: no puede quedar código muerto.');
assert(!src.includes('/api/tender-offer-preparation-note'), 'Sin editor, la UI no invoca la ruta de notas.');

// --- persistence untouched: el contrato de backend y su autorización siguen intactos ---
for (const [label, file] of [['server', server], ['vercel', api]]) {
  assert(file.includes("app.post('/api/tender-offer-preparation-note'"), `${label}: el endpoint de notas debe conservarse tal cual.`);
  assert(file.includes('requireTenderGoForPreparation'), `${label}: notas y preparación siguen exigiendo la decisión GO vigente.`);
}

console.log('tender preparation honest affordances static checks passed');
