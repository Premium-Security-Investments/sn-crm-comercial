import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const component = readFileSync(new URL('../src/vigia/VigiaOpportunityCopilot.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

for (const marker of [
  'VIGIA_VISIBLE_NAMES.commercial',
  'Alertas comerciales',
  '/api/vigia/copilot/generate',
  'buildCommercialAlerts',
  'navigator.clipboard.writeText',
  'export function VigiaCommercialAlerts(',
  'export function VigiaCopilotProposal(',
  'Preparar próximo seguimiento',
  'Actualizar propuesta',
  'onRegenerate',
  'No se pudo preparar el seguimiento. Puede continuar registrándolo manualmente.',
  'vigia-copilot-error',
]) assert.ok(component.includes(marker), `panel Vig-IA missing marker: ${marker}`);

for (const forbidden of [
  '>Enviar<', 'decision_maker_email', 'recipient', '/api/opportunities', 'stage_code',
  '>Útil<', 'Necesita cambios', '/api/vigia/copilot/feedback',
  'Antes de contactar', 'Acción recomendada', 'vigia-copilot-missing', 'vigia-copilot-warnings',
  'Preparar seguimiento', 'Acciones para mejorar la propuesta',
  'Análisis inteligente del seguimiento', 'Analizar cómo fortalecer el seguimiento', 'Actualizar análisis',
  'Entiendo que no se ejecutó el análisis inteligente antes de generar.', 'Sugerencia contextual',
  '/api/vigia/copilot/preflight', 'VigiaPreflightAnalysis',
  'Plan de contacto', 'Actualizar borrador', 'Ver contexto analizado', 'Siguiente paso sugerido', 'Borrador editable',
]) assert.equal(component.includes(forbidden), false, `panel Vig-IA contains forbidden capability/copy: ${forbidden}`);

const header = component.indexOf('<header>');
const alerts = component.indexOf('<VigiaCommercialAlerts');
const generate = component.indexOf('<div className="vigia-copilot-generate">');
assert.ok(header >= 0 && header < alerts && alerts < generate, 'DOM source order is header → alerts → generation');

for (const file of readdirSync(new URL('../src/vigia/', import.meta.url)).filter(f => /\.tsx?$/.test(f))) {
  assert.equal(readFileSync(new URL(`../src/vigia/${file}`, import.meta.url), 'utf8').includes('/api/vigia/copilot/preflight'), false, `${file} no debe llamar a /preflight`);
}

for (const marker of [
  "import { VigiaOpportunityCopilot } from './vigia/VigiaOpportunityCopilot';",
  'canRenderOpportunityCopilot(data.currentProfile, o.service_type_code)',
  'preflight={{ nextAction: priorityNextAction, expectedClose: priorityClose, decisionMaker: priorityDecisionMaker }}',
]) assert.ok(main.includes(marker), `OpportunityDetail missing Vig-IA integration marker: ${marker}`);

for (const marker of [
  '.vigia-opportunity-copilot', '.vigia-copilot-draft', '.vigia-copilot-actions',
  '.vigia-preflight-alerts', '.vigia-copilot-generate', '.vigia-copilot-error',
  '.vigia-copilot-proposal-header', '.vigia-copilot-brief', '.vigia-copilot-next-step',
  '.vigia-copilot-confidence', '.vigia-copilot-context>summary',
]) assert.ok(css.includes(marker), `styles missing Vig-IA panel marker: ${marker}`);

for (const removedMarker of ['.vigia-copilot-plan ol', '.vigia-copilot-summary']) {
  assert.ok(!css.includes(removedMarker), `styles.css debe retirar el selector huérfano: ${removedMarker}`);
}

assert.equal(existsSync(new URL('../src/vigia/opportunity-preflight-state.ts', import.meta.url)), false, 'opportunity-preflight-state.ts debe eliminarse');

const preflightPresentation = readFileSync(new URL('../src/vigia/opportunity-preflight-presentation.ts', import.meta.url), 'utf8');
for (const removed of ['PreflightAction', 'ConsolidatedPreflightAction', 'BaseCommercialAlert', 'PreflightMergeResult', 'KNOWN_PREFLIGHT_ISSUE_CODES', 'PREFLIGHT_ANALYSIS_UNAVAILABLE_MESSAGE', 'TECHNICAL_PREFLIGHT_ERROR_PATTERNS', 'normalizePreflightErrorMessage', 'consolidatePreflightActions', 'mergeCommercialAlertsWithPreflight']) {
  assert.equal(preflightPresentation.includes(removed), false, `opportunity-preflight-presentation.ts no debe contener ${removed}`);
}

assert.equal(component.includes('contextVersion'), false, 'VigiaOpportunityCopilot.tsx no debe contener contextVersion');
assert.equal(main.includes('contextVersion'), false, 'main.tsx no debe contener contextVersion');

// AGT-003 hotfix: el CTA primario no debe estirarse a lo ancho del panel — un botón de ancho
// completo dentro de un contenedor `display:grid` produce un anillo de foco nativo del navegador
// que envuelve todo el contenedor en vez de ceñirse al control. `justify-items:start` mantiene el
// botón (y su anillo de foco) del tamaño de su contenido.
assert.match(
  css,
  /\.vigia-copilot-generate\{[^}]*justify-items:start[^}]*\}/,
  '.vigia-copilot-generate debe fijar justify-items:start para un foco compacto en el CTA primario',
);

// El botón de generación externo sólo existe mientras no hay propuesta lista: una vez generada,
// el refresco vive en la cabecera de la propuesta ("Actualizar propuesta"), nunca huérfano.
assert.match(
  component,
  /\{state\.phase !== 'error' && !ready && <div className="vigia-copilot-generate">/,
  'el botón de generación externo sólo debe renderizarse mientras no hay propuesta lista (!ready)',
);
assert.equal(
  component.includes("className={ready ? 'secondary' : undefined}"),
  false,
  'el botón de generación externo ya no alterna a "secondary": ese slot deja de existir una vez lista la propuesta',
);
assert.match(component, /onRegenerate=\{generate\}/, 'VigiaCopilotProposal debe recibir onRegenerate para refrescar desde su propia cabecera');

console.log('Vig-IA opportunity copilot UI static contract passed');
