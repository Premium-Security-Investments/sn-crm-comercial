import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const component = readFileSync(new URL('../src/vigia/VigiaOpportunityCopilot.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

for (const marker of [
  'Vig-IA', 'Generar borrador', 'Copiar', 'Descartar', 'Útil', 'Necesita cambios',
  'Revisión humana obligatoria', 'missing_information', 'contact_objective', 'recommended_asset_ids',
  '/api/vigia/copilot/generate', '/api/vigia/copilot/feedback', 'navigator.clipboard.writeText',
  'changeCopilotOpportunity', 'completeCopilotGeneration',
]) assert.ok(component.includes(marker), `panel Vig-IA missing marker: ${marker}`);
for (const forbidden of ['>Enviar<', 'decision_maker_email', 'recipient', '/api/opportunities', 'stage_code']) {
  assert.equal(component.includes(forbidden), false, `panel Vig-IA contains forbidden capability: ${forbidden}`);
}
for (const marker of [
  "import { VigiaOpportunityCopilot } from './vigia/VigiaOpportunityCopilot';",
  'canRenderOpportunityCopilot(data.currentProfile, o.service_type_code)',
  '<VigiaOpportunityCopilot opportunityId={o.id} request={api}',
]) assert.ok(main.includes(marker), `OpportunityDetail missing Vig-IA integration marker: ${marker}`);
for (const marker of ['.vigia-opportunity-copilot', '.vigia-copilot-draft', '.vigia-copilot-actions']) {
  assert.ok(css.includes(marker), `styles missing Vig-IA panel marker: ${marker}`);
}
console.log('Vig-IA opportunity copilot UI static contract passed');
