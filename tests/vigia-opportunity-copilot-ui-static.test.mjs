import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const component = readFileSync(new URL('../src/vigia/VigiaOpportunityCopilot.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

for (const marker of [
  'VIGIA_VISIBLE_NAMES.commercial',
  'Alertas comerciales',
  'Acciones para mejorar la propuesta',
  'Plan de contacto',
  'Análisis inteligente del seguimiento',
  'Analizar cómo fortalecer el seguimiento',
  'Generar propuesta con el contexto actual',
  'Entiendo que no se ejecutó el análisis inteligente antes de generar.',
  '/api/vigia/copilot/preflight',
  '/api/vigia/copilot/generate',
  'buildCommercialAlerts',
  'mergeCommercialAlertsWithPreflight',
  'createOpportunityPreflightState',
  'invalidateStalePreflight',
  'beginPreflightAnalysis',
  'completePreflightAnalysis',
  'failPreflightAnalysis',
  "preflightState.phase !== 'loading'",
  'contactPlanSteps',
  'navigator.clipboard.writeText',
  'export function VigiaCommercialAlerts(',
  'export function VigiaPreflightAnalysis(',
  'export function VigiaCopilotProposal(',
]) assert.ok(component.includes(marker), `panel Vig-IA missing marker: ${marker}`);

for (const forbidden of [
  '>Enviar<', 'decision_maker_email', 'recipient', '/api/opportunities', 'stage_code',
  '>Útil<', 'Necesita cambios', '/api/vigia/copilot/feedback',
  'Antes de contactar', 'Acción recomendada', 'vigia-copilot-missing', 'vigia-copilot-warnings',
  'Preparar seguimiento',
]) assert.equal(component.includes(forbidden), false, `panel Vig-IA contains forbidden capability/copy: ${forbidden}`);

const header = component.indexOf('<header>');
const alerts = component.indexOf('<VigiaCommercialAlerts');
const analysis = component.indexOf('<VigiaPreflightAnalysis');
const generate = component.indexOf('<div className="vigia-copilot-generate">');
assert.ok(header >= 0 && header < alerts && alerts < analysis && analysis < generate, 'DOM source order is header → alerts → analysis → generation');

for (const marker of [
  "import { VigiaOpportunityCopilot } from './vigia/VigiaOpportunityCopilot';",
  'canRenderOpportunityCopilot(data.currentProfile, o.service_type_code)',
  'preflight={{ nextAction: priorityNextAction, expectedClose: priorityClose, decisionMaker: priorityDecisionMaker }}',
  'contextVersion={`${o.updated_at}|${o.last_interaction_at ?? \'\'}`}',
]) assert.ok(main.includes(marker), `OpportunityDetail missing Vig-IA integration marker: ${marker}`);

for (const marker of [
  '.vigia-opportunity-copilot', '.vigia-copilot-draft', '.vigia-copilot-actions',
  '.vigia-preflight-alerts', '.vigia-preflight-analysis', '.vigia-preflight-standalone',
  '.vigia-copilot-generate', '.vigia-preflight-ack', '.vigia-copilot-plan ol',
]) assert.ok(css.includes(marker), `styles missing Vig-IA panel marker: ${marker}`);

console.log('Vig-IA opportunity copilot UI static contract passed');
