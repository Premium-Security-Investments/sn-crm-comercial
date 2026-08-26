import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
import { ACTIONS, can } from '../access-control.js';
import { presentCurrentTenderAnalysis } from '../tender-analysis-foundation.js';

const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const panelPath = new URL('../src/tenders/components/TenderGoNoGoDecisionPanel.tsx', import.meta.url);
const permissionsPath = new URL('../src/tenders/permissions.ts', import.meta.url);
const decisionGatePath = new URL('../src/tenders/tenderDecisionGate.ts', import.meta.url);

assert.equal(existsSync(panelPath), true, 'Debe existir el panel formal GO/NO GO.');
const panel = read('src/tenders/components/TenderGoNoGoDecisionPanel.tsx');
const gateSource = read('src/tenders/tenderDecisionGate.ts');
const api = read('src/tenders/api.ts');
const types = read('src/tenders/types.ts');
const main = read('src/main.tsx');
const experience = read('src/tenders/components/TenderDecisionExperience.tsx');
assert.match(panel, /opportunityName/);
assert.doesNotMatch(panel, /<dt>Oportunidad<\/dt>/, 'El modal no debe repetir datos ya visibles de la oportunidad.');

for (const text of ['brief de decisión', 'Decisión humana', 'Registrar GO', 'Registrar NO GO', 'Comentario opcional']) {
  assert.match(panel, new RegExp(text, 'i'), `El panel debe mostrar ${text}.`);
}
assert.match(panel, /role="dialog"|<dialog/, 'La decisión debe pedir confirmación accesible.');
assert.match(panel, /recordTenderGoNoGoDecision/, 'La confirmación debe usar la API formal.');
assert.match(panel, /analysis_run_id:\s*analysis\?\.run_id \|\| null/, 'Debe conservar el run disponible y registrar null cuando no existe análisis.');
assert.match(panel, /await onChanged\s*\(\)/, 'Al guardar debe notificar al detalle para recargar expediente.');
for (const warning of ['recomendación contraria', 'preguntas críticas', 'obsoleto', 'falló', 'no está disponible']) assert.match(panel, new RegExp(warning, 'i'), `La UI debe advertir: ${warning}.`);
assert.doesNotMatch(gateSource, /analysis\?\.status\s*===\s*'completed'|critical_open_count[\s\S]*?<=\s*0/, 'El estado del análisis y las preguntas críticas no pueden convertirse en gates humanos.');
assert.match(panel, /history/, 'La UI debe mostrar el historial inmutable.');
assert.doesNotMatch(panel, /tender-go-no-go-risks|Riesgos y hallazgos relevantes/, 'El cierre humano no debe repetir la lista de riesgos ya documentada en el brief.');
assert.doesNotMatch(panel, /analysis\?\.summary/, 'El cierre humano no debe repetir el resumen completo del brief documental.');
assert.doesNotMatch(panel, /analysis\?\.questions/, 'Dudas abiertas debe vivir una sola vez en el brief documental.');
assert.match(api, /loadTenderGoNoGoDecision[\s\S]*encodeURIComponent\(opportunityId\)/, 'GET debe codificar el ID.');
assert.match(api, /recordTenderGoNoGoDecision[\s\S]*\/api\/tender-go-no-go-decision[\s\S]*method:\s*'POST'[\s\S]*JSON\.stringify\(input\)/, 'POST debe enviar el input JSON formal.');
assert.match(types, /TenderGoNoGoDecisionInput/, 'Deben existir tipos de input GO/NO GO.');
assert.match(types, /run_id:\s*string/, 'El análisis debe exponer el run_id tipado requerido.');
assert.match(types, /analysis_run_id\?:\s*string \| null/, 'El input GO/NO GO debe aceptar ausencia de análisis.');
assert.match(main, /TenderDecisionExperience/, 'El detalle debe integrar una sola experiencia de decisión.');
assert.match(experience, /TenderGoNoGoDecisionPanel/, 'El fallback y la superficie nueva deben conservar el panel formal.');
assert.match(main, /onAnalysisChanged/, 'La revisión documental debe elevar el análisis vigente.');
assert.match(main, /onAnalysisChanged\?:\s*\(analysis: TenderDocumentAnalysis \| null\)/, 'La revisión documental debe exponer el análisis vigente al detalle.');
assert.match(main, /onAnalysisChanged\?\.\(data\.analysis \|\| null\)/, 'Cada carga o mutación documental debe elevar análisis o null.');
assert.match(main, /<TenderDecisionExperience[\s\S]*?opportunityId=\{o\.id\}[\s\S]*?analysis=\{tenderAnalysis\}/, 'La decisión debe recibir el análisis vigente de la revisión documental.');
assert.match(main, /key=\{`tender-preparation-\$\{o\.id\}-\$\{tenderRevision\}`\}/, 'La preparación debe recargar después de una decisión formal y aislarse por oportunidad.');
assert.doesNotMatch(main, />Aprobar preparación de oferta</, 'No puede quedar el control legacy de preparación.');
assert.doesNotMatch(main, /\/api\/tender-offer-preparation-approve/, 'La UI no puede invocar la aprobación legacy.');
assert.match(main, /Registrar GO/, 'Sin preparación la UI debe dirigir al registro formal GO.');
assert.doesNotMatch(panel, /Autorizar GO|GO autorizado/, 'La experiencia visible debe llamar Registrar GO sin cambiar los permisos backend.');
assert.match(panel, /const submittedDecision = selectedDecision/, 'El submit debe capturar la decisión antes de limpiar el modal.');
assert.match(panel, /setSelectedDecision\(null\);\s*setJustification\(''\);[\s\S]*?await load\(true, true\)/, 'Un éxito debe cerrar explícitamente el modal antes de sincronizar y conservar la vista optimista.');
assert.match(panel, /let persistedSuccessfully = false[\s\S]*?persistedSuccessfully = true/, 'El flujo debe distinguir persistencia exitosa de sincronización posterior.');
assert.match(panel, /No fue posible registrar la decisión/, 'Un POST fallido no puede comunicarse como decisión registrada.');
assert.match(panel, /Reintentar actualización/, 'Una decisión persistida con refresh fallido debe tener reconciliación explícita sin repetir el POST.');

const bundle = buildSync({ entryPoints: [permissionsPath.pathname], bundle: true, platform: 'node', format: 'esm', write: false });
const permissionsUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
const { canApproveTenderGoNoGo } = await import(permissionsUrl);
const human = (role, permissions = ['licitaciones']) => ({ id: `user-${role}`, role, active: true, identity_type: 'human', permissions });
assert.equal(canApproveTenderGoNoGo({ ...human('admin'), identity_type: 'agent' }), false, 'Un agente admin no puede decidir.');
assert.equal(canApproveTenderGoNoGo({ id: 'legacy-director', role: 'director', active: true, permissions: ['licitaciones'] }), true, 'Un perfil legacy director humano puede decidir.');
const accessProfile = profile => ({ ...profile, areas: [{ area_code: 'licitaciones', subarea_code: null }] });
for (const [label, profile] of [
  ['legacy sin propiedad', { id: 'legacy-director', role: 'director', active: true, permissions: ['licitaciones'] }],
  ['undefined propio', { ...human('director'), identity_type: undefined }],
  ['null propio', { ...human('gerencia'), identity_type: null }],
  ['humano', human('admin')],
  ['agente', { ...human('admin'), identity_type: 'agent' }],
  ['inactivo', { ...human('director'), active: false }],
  ['sin rol', human('comercial')],
  ['sin permiso', human('director', [])],
]) {
  assert.equal(
    canApproveTenderGoNoGo(profile),
    can(accessProfile(profile), ACTIONS.LICITACIONES_GO_NO_GO_APPROVE),
    `La UI debe replicar exactamente el ACL para ${label}.`,
  );
}
assert.equal(canApproveTenderGoNoGo({ ...human('director'), active: false }), false, 'Un perfil inactivo no puede decidir.');
assert.equal(canApproveTenderGoNoGo(human('director', [])), false, 'Un director sin permiso de licitaciones no puede decidir.');
assert.equal(canApproveTenderGoNoGo(human('comercial')), false, 'Comercial no puede decidir.');
assert.match(panel, /requestVersionRef|requestVersion/, 'Las cargas deben descartar respuestas obsoletas.');
assert.match(panel, /syncPending/, 'Un POST persistido debe bloquear reintentos mientras sincroniza.');
assert.match(panel, /document\.activeElement|previouslyFocused/, 'El modal debe recordar el foco previo.');
assert.match(panel, /Escape|Tab/, 'El modal debe manejar Escape y trap de Tab.');
assert.match(
  panel,
  /event\.shiftKey && \(document\.activeElement === first \|\| document\.activeElement === initialFocusRef\.current\)/,
  'Shift+Tab desde el encabezado inicialmente enfocado debe ciclar al último control y no escapar del modal.',
);

const gateBundle = buildSync({ entryPoints: [decisionGatePath.pathname], bundle: true, platform: 'node', format: 'esm', write: false });
const gateUrl = `data:text/javascript;base64,${Buffer.from(gateBundle.outputFiles[0].contents).toString('base64')}`;
const { tenderDecisionGate } = await import(gateUrl);
const actualDocumentResponse = {
  documents: [],
  analyses: [{ kind: 'tender_document_analysis', status: 'analisis_generado', analysis_run_id: 'legacy-run' }],
  analysis: presentCurrentTenderAnalysis({
    run_id: '33333333-3333-4333-8333-33333333333a', snapshot_id: '55555555-5555-4555-8555-555555555555', producer: 'siio_rules_v1', method: 'rules', status: 'completed', current: true, critical_open_count: 0,
    result: { recommendation: 'GO', summary: 'Análisis tipado vigente.' },
  }),
};
for (const analysis of [
  actualDocumentResponse.analysis,
  { ...actualDocumentResponse.analysis, recommendation: 'do_not_advance', critical_open_count: 1 },
  { ...actualDocumentResponse.analysis, status: 'failed' },
  { ...actualDocumentResponse.analysis, current: false },
  null,
]) assert.deepEqual(tenderDecisionGate(analysis), { canGo: true, canNoGo: true }, 'analysis state never blocks an authorized human decision');

const { tenderRecommendationLabel } = await import(gateUrl);
assert.equal(tenderRecommendationLabel('advance'), 'Avanzar el flujo de evidencia');
assert.equal(tenderRecommendationLabel('avanzar'), 'Avanzar el flujo de evidencia');
assert.equal(tenderRecommendationLabel('advance_conditionally'), 'Avanzar de forma condicionada');
assert.equal(tenderRecommendationLabel('avanzar_condicionado'), 'Avanzar de forma condicionada');
assert.equal(tenderRecommendationLabel('do_not_advance'), 'No avanzar el flujo de evidencia');
assert.equal(tenderRecommendationLabel('no_avanzar'), 'No avanzar el flujo de evidencia');
assert.equal(tenderRecommendationLabel('pause'), 'Información insuficiente');
assert.equal(tenderRecommendationLabel('no_avanzar_temporalmente'), 'Información insuficiente');

console.log('tender GO/NO GO UI checks passed');
