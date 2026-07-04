import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const src = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const file of [server, api]) {
  assert(file.includes('buildTenderOfferPreparation'), 'Backend debe generar el expediente inicial de preparación de oferta.');
  assert(file.includes("kind: 'tender_offer_preparation'"), 'Expediente debe persistirse como interacción JSON trazable.');
  assert(file.includes("app.get('/api/tender-offer-preparation'"), 'Debe existir endpoint para leer expediente de oferta.');
  assert(file.includes("app.post('/api/tender-offer-preparation-approve'"), 'Debe existir endpoint para aprobar preparación de oferta.');
  assert(file.includes("app.post('/api/tender-offer-preparation-note'"), 'Debe existir endpoint para notas/solicitudes del asistente.');
  assert(file.includes('generic_documents'), 'Expediente debe incluir documentos genéricos reutilizables.');
  assert(file.includes('auto_generated_documents'), 'Expediente debe generar documentos automáticos iniciales.');
  assert(file.includes('human_required_items'), 'Expediente debe separar pendientes que requieren intervención humana.');
  assert(file.includes('sharepoint_folder'), 'Expediente debe reservar vínculo/estado de carpeta SharePoint/OneDrive.');
  assert(file.includes('assistant_notes'), 'Expediente debe tener espacio de notas para informar qué se necesita del humano.');
  assert(file.includes('Generar paquete inicial de preparación'), 'Debe quedar claro que el paquete inicial se genera proactivamente.');
}

assert(src.includes('Expediente de Oferta'), 'UI debe mostrar el Expediente de Oferta.');
assert(src.includes('Aprobar preparación de oferta'), 'UI debe tener botón de aprobación de preparación.');
assert(src.includes('Documentos genéricos automáticos'), 'UI debe mostrar documentos genéricos automáticos.');
assert(src.includes('Requiere intervención humana'), 'UI debe mostrar pendientes humanos.');
assert(src.includes('Carpeta SharePoint / OneDrive'), 'UI debe mostrar estado/enlace de carpeta SharePoint/OneDrive.');
assert(src.includes('Notas para el asistente'), 'UI debe tener espacio de notas para el asistente/comercial.');
assert(src.includes('/api/tender-offer-preparation-approve'), 'UI debe llamar aprobación de preparación.');
assert(src.includes('/api/tender-offer-preparation-note'), 'UI debe permitir guardar notas del asistente.');

console.log('tender offer preparation static checks passed');
