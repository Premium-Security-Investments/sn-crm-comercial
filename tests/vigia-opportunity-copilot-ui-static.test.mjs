import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const component = readFileSync(new URL('../src/vigia/VigiaOpportunityCopilot.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

for (const marker of [
  'VIGIA_VISIBLE_NAMES.commercial',
  'Alertas comerciales',
  'Plan de contacto',
  '/api/vigia/copilot/generate',
  'buildCommercialAlerts',
  'contactPlanSteps',
  'navigator.clipboard.writeText',
  'export function VigiaCommercialAlerts(',
  'export function VigiaCopilotProposal(',
  'Preparar próximo seguimiento',
  'Actualizar borrador',
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
  'contextVersion={`${o.updated_at}|${o.last_interaction_at ?? \'\'}`}',
]) assert.ok(main.includes(marker), `OpportunityDetail missing Vig-IA integration marker: ${marker}`);

for (const marker of [
  '.vigia-opportunity-copilot', '.vigia-copilot-draft', '.vigia-copilot-actions',
  '.vigia-preflight-alerts', '.vigia-copilot-generate', '.vigia-copilot-plan ol',
  '.vigia-copilot-summary', '.vigia-copilot-error',
]) assert.ok(css.includes(marker), `styles missing Vig-IA panel marker: ${marker}`);

console.log('Vig-IA opportunity copilot UI static contract passed');
