import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const preparation = readFileSync(new URL('../tender-offer-preparation.js', import.meta.url), 'utf8');
const src = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const dossierPanel = readFileSync(new URL('../src/tenders/components/TenderDossierWorkspacePanel.tsx', import.meta.url), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(preparation.includes("kind: 'tender_offer_preparation'"), 'El builder compartido debe conservar el expediente JSON trazable.');
assert(preparation.includes('planned_documents'), 'Expediente debe incluir documentos planificados.');
assert(!preparation.includes('auto_generated_documents'), 'Expediente no debe afirmar generación automática inexistente.');
assert(!preparation.includes('generado_automaticamente'), 'Los estados deben describir planificación, no archivos inexistentes.');
assert(preparation.includes('human_required_items'), 'Expediente debe separar pendientes que requieren intervención humana.');
assert(preparation.includes('sharepoint_folder'), 'Expediente debe reservar vínculo/estado de carpeta SharePoint/OneDrive.');
assert(preparation.includes('assistant_notes'), 'Expediente debe tener espacio de notas para informar qué se necesita del humano.');
assert(preparation.includes('Plan de preparación registrado'), 'Debe quedar claro que el plan se registra proactivamente sin afirmar archivos inexistentes.');

for (const file of [server, api]) {
  assert(file.includes("import { buildTenderOfferPreparation } from '../tender-offer-preparation.js';"), 'Backend debe compartir el builder rico de preparación.');
  assert(file.includes("app.get('/api/tender-offer-preparation'"), 'Debe existir endpoint para leer expediente de oferta.');
  assert(file.includes("app.post('/api/tender-offer-preparation-note'"), 'Debe existir endpoint para notas/solicitudes del asistente.');
  assert(file.includes('requireTenderGoForPreparation'), 'Preparación y notas deben consultar la decisión formal vigente.');
  assert(file.includes("app.post('/api/tender-go-no-go-decision'"), 'GO/NO GO debe tener una ruta formal única.');
  const alias = file.match(/app\.post\('\/api\/tender-offer-preparation-approve'[\s\S]*?\n}\);/);
  assert(alias, 'La ruta anterior debe permanecer como alias controlado durante la transición.');
  assert(alias[0].includes('await getAuthContext(req);'), 'El alias anterior debe autenticar antes de responder.');
  assert(alias[0].includes("res.status(410).json({ error: 'Use Registrar GO para iniciar la preparación de oferta.' });"), 'El alias anterior debe dirigir al flujo de registro GO.');
  assert(!/requireDb|\.from\(|\.rpc\(|storage/.test(alias[0]), 'El alias anterior no puede escribir ni acceder a BD/storage.');
}

assert(src.includes('Expediente de Oferta'), 'UI debe mostrar el Expediente de Oferta.');
assert(src.includes('Registrar GO'), 'Sin expediente la UI debe dirigir al registro formal GO.');
assert(!src.includes('Aprobar preparación de oferta'), 'La UI no puede conservar el control legacy de preparación.');
assert(!src.includes('/api/tender-offer-preparation-approve'), 'La UI no puede invocar la ruta legacy de preparación.');
assert(src.includes('Documentos por generar'), 'UI debe mostrar documentos planificados sin afirmar generación automática.');
assert(src.includes('Requiere intervención humana'), 'UI debe mostrar pendientes humanos.');
assert(src.includes('Carpeta SharePoint / OneDrive'), 'UI debe mostrar estado/enlace de carpeta SharePoint/OneDrive.');
assert(src.includes('Nota interna de preparación'), 'UI debe tener espacio de nota interna para el equipo comercial.');
assert(src.includes('/api/tender-offer-preparation-note'), 'UI debe permitir guardar notas del asistente.');
assert(/const authorizedPreparation\s*=\s*preparation\s*&&\s*payload\.decision\?\.decision\s*===\s*'go'/.test(src), 'Todo el expediente debe quedar oculto si GO ya no es la decisión vigente.');
assert(/authorizedPreparation\s*\?\s*<div className="tender-document-panel">/.test(src), 'Encabezado, carpeta, notas y formulario solo deben montarse con preparación autorizada.');
assert(/if \(!enabled\) return null;/.test(dossierPanel), 'El workspace duplicado no debe renderizar ningún empty-state antes de GO.');
assert(!/if \(!enabled\) return <section/.test(dossierPanel), 'Pre-GO debe dejar un solo estado compacto en TenderOfferPreparationPanel.');

console.log('tender offer preparation static checks passed');
