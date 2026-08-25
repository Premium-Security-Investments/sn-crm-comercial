import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const component = readFileSync(new URL('../src/vigia/VigiaOpportunityCopilot.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

// AGT-003 — la propuesta pasó a una jerarquía action-first (ver `agt003-copilot-proposal-render`
// y `VigiaCopilotProposal`): el feedback `Útil`/`Necesita cambios` y su endpoint se retiraron de
// esta UI (la API histórica de feedback se conserva en el backend, sin llamarla desde aquí), y el
// copy de revisión humana cambió. Los campos snake_case del brief ahora se leen únicamente dentro
// de `copilot-presentation.ts`, no en este archivo.
for (const marker of [
  'VIGIA_VISIBLE_NAMES.commercial', 'Preparar seguimiento', 'Copiar correo', 'Descartar',
  '/api/vigia/copilot/generate', 'navigator.clipboard.writeText',
  'changeCopilotOpportunity', 'completeCopilotGeneration', 'export function VigiaCopilotProposal(',
  'normalizeCopilotErrorMessage', 'presentCopilotBrief',
]) assert.ok(component.includes(marker), `panel Vig-IA missing marker: ${marker}`);
for (const forbidden of [
  '>Enviar<', 'decision_maker_email', 'recipient', '/api/opportunities', 'stage_code',
  '>Útil<', 'Necesita cambios', '/api/vigia/copilot/feedback',
]) {
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
