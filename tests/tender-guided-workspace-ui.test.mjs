import { existsSync, readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const documentPath = new URL('../src/tenders/components/TenderDocumentSection.tsx', import.meta.url);
const analysisPath = new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url);
assert.equal(existsSync(documentPath), true, 'Debe existir TenderDocumentSection.');
assert.equal(existsSync(analysisPath), true, 'Debe existir TenderAnalysisSection.');

const documents = read('src/tenders/components/TenderDocumentSection.tsx');
const analysis = read('src/tenders/components/TenderAnalysisSection.tsx');
const main = read('src/main.tsx');
const styles = read('src/styles.css');
const detail = main.match(/function OpportunityDetail[\s\S]*?\n}\nconst tenderDocumentTypeOptions/)?.[0] || '';
const coordinator = main.match(/function TenderDocumentReviewPanel[\s\S]*?\n}\nfunction TenderOfferPreparationPanel/)?.[0] || '';

for (const text of ['Actualizar documentos', 'Cargar complementarios', 'Buscar documentos', 'Tipo de documento', 'Última actualización', 'nuevos', 'actualizados', 'sin cambios', 'fallidos']) assert.match(documents, new RegExp(text, 'i'), `Documentos debe incluir ${text}.`);
for (const intent of ['consult', 'refresh', 'upload']) assert.match(documents, new RegExp(`tender-document-action-${intent}`), `Documentos debe distinguir la acción ${intent}.`);
for (const label of ['Consultar', 'Actualizar', 'Cargar']) assert.match(documents, new RegExp(`tender-document-action-kicker[^>]*>${label}<`), `Debe comunicar la intención ${label}.`);
assert.match(documents, /role="group"[^>]*aria-label="Gestión documental"/, 'Las acciones relacionadas deben exponerse como grupo accesible.');
assert.match(documents, /<details/);
assert.match(documents, /documentsByType|groupedDocuments/);
assert.doesNotMatch(documents, /<details[^>]*\sopen(?:=|>)/, 'Listado/uploader deben iniciar cerrados.');

for (const state of ['Análisis pendiente', 'Análisis desactualizado', 'Análisis fallido', 'Sin documentos']) assert.match(analysis, new RegExp(state));
assert.match(analysis, /<TenderGovernedDocumentWorkset/, 'La acción canónica de análisis vive ahora en el selector gobernado.');
assert.doesNotMatch(analysis, /Generar análisis preliminar|Actualizar análisis/, 'No debe reaparecer una acción determinística equivalente a Vig-IA.');
assert.match(analysis, /tenderAnalysisMethodLabel\(analysis\.producer\)/);
assert.doesNotMatch(analysis, /id="tender-analysis"/, 'El componente interno no debe duplicar el ancla de Análisis.');
assert.equal((main.match(/id="tender-analysis"/g) || []).length, 1, 'El coordinador debe declarar una sola ancla de Análisis.');
assert.doesNotMatch(main, /analysis\s*&&\s*<TenderAnalysisSection/, 'La sección de análisis siempre debe renderizarse.');
assert.match(main, /<TenderDocumentSection/);
assert.match(main, /<TenderAnalysisSection/);
const documentsIndex = coordinator.indexOf('<TenderDocumentSection');
const analysisIndex = coordinator.indexOf('<TenderAnalysisSection');
const reviewIndex = detail.indexOf('<TenderDocumentReviewPanel');
const decisionIndex = detail.indexOf('id="tender-decision"');
assert.ok(documentsIndex >= 0 && analysisIndex > documentsIndex && reviewIndex >= 0 && decisionIndex > reviewIndex, 'El orden debe ser Documentos → Análisis → GO/NO GO.');
assert.match(main, /onAnalysisChanged\?\.\(data\.analysis \|\| null\)/);
assert.match(coordinator, /analysisStatus/, 'El coordinador debe mantener feedback propio para la acción Vig-IA.');
assert.match(coordinator, /<TenderAnalysisSection[\s\S]*?statusText=\{analysisStatus\.message\}/, 'El feedback de Vig-IA debe llegar al bloque de análisis, no quedar oculto en Documentos.');
assert.match(coordinator, /<TenderAnalysisSection[\s\S]*?statusTone=\{analysisStatus\.tone\}/, 'El bloque debe recibir el tono accesible del feedback Vig-IA.');
assert.match(coordinator, /<TenderAnalysisSection[\s\S]*?runState=\{[^}]+\}/, 'El coordinador debe exponer al bloque de Análisis un estado de corrida explícito (congelando/en cola/corriendo), no sólo busy.');
assert.match(analysis, /statusText\s*&&[\s\S]*role=\{statusTone === 'error' \? 'alert' : 'status'\}/, 'El bloque Vig-IA debe anunciar progreso y errores de forma accesible.');

// El mismo feedback (statusText/statusTone) y un estado de corrida explícito deben llegar también
// al selector gobernado, para que se anuncien pegados a su propia CTA
// (tests/agt002-governed-document-workset-ui.test.mjs) y no sólo en el bloque que hoy vive arriba
// de la lista larga de candidatos.
const governedMountIndex = analysis.indexOf('<TenderGovernedDocumentWorkset');
assert.notEqual(governedMountIndex, -1, 'TenderAnalysisSection debe montar TenderGovernedDocumentWorkset');
const governedMountCall = analysis.slice(governedMountIndex, analysis.indexOf('/>', governedMountIndex) + 2);
assert.match(governedMountCall, /statusText=\{statusText\}/, 'debe reenviar el mismo statusText al selector gobernado, no dejarlo únicamente en el bloque de arriba.');
assert.match(governedMountCall, /statusTone=\{statusTone\}/, 'debe reenviar el mismo statusTone (accesibilidad status/alert) al selector gobernado.');
assert.match(governedMountCall, /runState=\{[^}]+\}/, 'debe reenviar un estado de corrida explícito (congelando/en cola/corriendo), no sólo el busy genérico.');

// El gating de nivel superior (sin documentos, o sin permiso de corrida) no debe alterarse por
// este cableado nuevo de feedback/estado de corrida.
assert.match(analysis, /hasDocuments && canRunPreview && <TenderGovernedDocumentWorkset/, 'sin documentos vigentes o sin canRunPreview, el selector gobernado no debe montarse; este comportamiento de nivel superior se conserva.');

assert.doesNotMatch(main, /Importando documentos oficiales desde SECOP\/ESU y generando análisis/, 'Actualizar documentos no debe prometer ni disparar análisis.');
assert.match(styles, /\.tender-document-section/);
assert.match(styles, /\.tender-analysis-section/);
assert.match(styles, /\.tender-document-action:focus-visible/);

// --- Reconciling TenderDocumentReviewPanel's run state from the server's reanalysis_job snapshot
// (RED). (.hermes/plans — independent frontend review finding.) TenderDocumentsPayload already
// carries `reanalysis_job` (src/tenders/types.ts); loadDocuments must actually read it and
// reconcile runState/analysisStatus from it, and the mount/reload path must resume polling when
// the server-owned job is still queued or running — otherwise a reload or navigate-away-back can
// silently leave a stale local idle/background state next to an old job still running server-side,
// re-enabling the freeze CTA while a duplicate run is possible, or leaving stale feedback next to
// the CTA once the server later reports completed/unavailable.
assert.match(
  main,
  /import\s*\{[^}]*agt002GovernedRunStateFromReanalysisJob[^}]*\}\s*from\s*'\.\/tenders\/governedWorksetSelection';/,
  'main.tsx debe importar el mapeo puro agt002GovernedRunStateFromReanalysisJob desde governedWorksetSelection.',
);

const loadDocumentsMatch = coordinator.match(/const loadDocuments = async[\s\S]*?\n  \};/);
const loadDocumentsBody = loadDocumentsMatch ? loadDocumentsMatch[0] : '';
assert.notEqual(loadDocumentsBody, '', 'Debe existir loadDocuments con el cuerpo esperado dentro de TenderDocumentReviewPanel.');
assert.match(
  loadDocumentsBody,
  /data\.reanalysis_job/,
  'loadDocuments debe leer el snapshot reanalysis_job devuelto por el servidor, no ignorarlo.',
);
assert.match(
  loadDocumentsBody,
  /setRunState\(\s*agt002GovernedRunStateFromReanalysisJob\(\s*data\.reanalysis_job\s*\)\s*\)/,
  'loadDocuments debe reconciliar runState directamente desde el mapeo puro del snapshot del servidor en cada carga, en vez de conservar siempre el estado local (idle/background).',
);
assert.doesNotMatch(
  loadDocumentsBody,
  /if\s*\(\s*runState\s*===\s*'idle'/,
  'la reconciliación de runState no debe condicionarse a que el estado local siga en idle: una carga posterior debe poder mover completed/unavailable fuera de background/queued/running igualmente, o el feedback y el CTA quedan obsoletos indefinidamente.',
);
assert.match(
  loadDocumentsBody,
  /setAnalysisStatus\(/,
  'loadDocuments debe reconciliar también el feedback (analysisStatus) del bloque de análisis, no sólo runState.',
);

const mountEffectMatch = coordinator.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[opportunity\.id\]\);/);
const mountEffect = mountEffectMatch ? mountEffectMatch[0] : '';
assert.notEqual(mountEffect, '', 'Debe existir el efecto de montaje/recarga por opportunity.id.');
assert.match(mountEffect, /loadDocuments\(\)/, 'El efecto de montaje/recarga debe seguir cargando documentos.');
assert.match(
  mountEffect,
  /pollAgt002Reanalysis\(/,
  'el montaje/recarga por opportunity.id debe reanudar pollAgt002Reanalysis cuando el snapshot del servidor siga en cola o corriendo, para que recargar o navegar y volver no permita re-habilitar el congelamiento mientras un job viejo sigue activo.',
);
assert.match(
  mountEffect,
  /(queued|running)/,
  'la reanudación del polling al montar/recargar debe condicionarse al estado en cola/corriendo reportado por el servidor, no dispararse siempre.',
);

console.log('tender guided workspace UI passed');
