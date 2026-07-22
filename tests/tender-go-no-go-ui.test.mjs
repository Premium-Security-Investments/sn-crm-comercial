import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
import { ACTIONS, can } from '../access-control.js';

const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const panelPath = new URL('../src/tenders/components/TenderGoNoGoDecisionPanel.tsx', import.meta.url);
const permissionsPath = new URL('../src/tenders/permissions.ts', import.meta.url);

assert.equal(existsSync(panelPath), true, 'Debe existir el panel formal GO/NO GO.');
const panel = read('src/tenders/components/TenderGoNoGoDecisionPanel.tsx');
const api = read('src/tenders/api.ts');
const types = read('src/tenders/types.ts');
const main = read('src/main.tsx');
assert.match(panel, /opportunityName/);
assert.match(panel, /<dt>Oportunidad<\/dt><dd>\{opportunityName\}<\/dd>/);

for (const text of ['Recomendación del sistema', 'Decisión humana', 'Autorizar GO', 'Registrar NO GO', 'Justificación opcional']) {
  assert.match(panel, new RegExp(text), `El panel debe mostrar ${text}.`);
}
assert.match(panel, /role="dialog"|<dialog/, 'La decisión debe pedir confirmación accesible.');
assert.match(panel, /recordTenderGoNoGoDecision/, 'La confirmación debe usar la API formal.');
assert.match(panel, /analysis_interaction_id:\s*analysis\.interaction_id/, 'Debe auditar el ID exacto del análisis vigente.');
assert.match(panel, /await onChanged\s*\(\)/, 'Al guardar debe notificar al detalle para recargar expediente.');
assert.match(panel, /analysis.*interaction_id|interaction_id.*analysis/, 'Sin análisis vigente el panel debe explicar el bloqueo.');
assert.match(panel, /history/, 'La UI debe mostrar el historial inmutable.');
assert.match(panel, /findings|concerns/, 'La UI debe exponer hallazgos o alertas relevantes.');
assert.match(api, /loadTenderGoNoGoDecision[\s\S]*encodeURIComponent\(opportunityId\)/, 'GET debe codificar el ID.');
assert.match(api, /recordTenderGoNoGoDecision[\s\S]*\/api\/tender-go-no-go-decision[\s\S]*method:\s*'POST'[\s\S]*JSON\.stringify\(input\)/, 'POST debe enviar el input JSON formal.');
assert.match(types, /TenderGoNoGoDecisionInput/, 'Deben existir tipos de input GO/NO GO.');
assert.match(types, /interaction_id\??:\s*string/, 'El análisis debe exponer interaction_id del registro persistido.');
assert.match(main, /TenderGoNoGoDecisionPanel/, 'El detalle debe integrar el panel formal.');
assert.match(main, /onAnalysisChanged/, 'La revisión documental debe elevar el análisis vigente.');
assert.match(main, /onAnalysisChanged\?:\s*\(analysis: TenderDocumentAnalysis \| null\)/, 'La revisión documental debe exponer el análisis vigente al detalle.');
assert.match(main, /onAnalysisChanged\?\.\(data\.analysis \|\| null\)/, 'Cada carga o mutación documental debe elevar análisis o null.');
assert.match(main, /<TenderGoNoGoDecisionPanel[\s\S]*?opportunityId=\{o\.id\}[\s\S]*?analysis=\{tenderAnalysis\}/, 'La decisión debe recibir el análisis vigente de la revisión documental.');
assert.match(main, /key=\{`tender-preparation-\$\{o\.id\}-\$\{tenderRevision\}`\}/, 'La preparación debe recargar después de una decisión formal y aislarse por oportunidad.');
assert.doesNotMatch(main, />Aprobar preparación de oferta</, 'No puede quedar el control legacy de preparación.');
assert.doesNotMatch(main, /\/api\/tender-offer-preparation-approve/, 'La UI no puede invocar la aprobación legacy.');
assert.match(main, /Autorizar GO/, 'Sin preparación la UI debe dirigir a la decisión formal GO.');
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

console.log('tender GO/NO GO UI checks passed');
