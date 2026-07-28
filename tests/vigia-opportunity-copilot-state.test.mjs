import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

const entry = new URL('../src/vigia/opportunity-copilot-state.ts', import.meta.url).pathname;
const bundle = buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false });
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
const {
  beginCopilotGeneration,
  canRenderOpportunityCopilot,
  changeCopilotOpportunity,
  completeCopilotGeneration,
  createOpportunityCopilotState,
  discardCopilotDraft,
  editCopilotDraft,
  failCopilotGeneration,
} = await import(moduleUrl);

const opportunityA = '11111111-1111-4111-8111-111111111111';
const opportunityB = '22222222-2222-4222-8222-222222222222';
const profile = { active: true, identity_type: 'human', permissions: ['modulo_vig_ia', 'modulo_oportunidades', 'vigia_copilot_pilot'] };
assert.equal(canRenderOpportunityCopilot(profile, 'seguridad_fisica'), true);
assert.equal(canRenderOpportunityCopilot({ ...profile, permissions: ['modulo_vig_ia', 'modulo_oportunidades'] }, 'seguridad_fisica'), false);
assert.equal(canRenderOpportunityCopilot(profile, 'licitacion_publica'), false);
assert.equal(canRenderOpportunityCopilot({ ...profile, identity_type: 'agent' }, 'seguridad_fisica'), false);
assert.equal(canRenderOpportunityCopilot({ ...profile, permissions: ['modulo_vig_ia'] }, 'seguridad_fisica'), false);

let state = createOpportunityCopilotState(opportunityA);
assert.equal(state.phase, 'idle');
const first = beginCopilotGeneration(state);
state = first.state;
assert.equal(state.phase, 'loading');
const result = {
  run_id: '33333333-3333-4333-8333-333333333333', status: 'completed', human_review_required: true,
  output: { brief: { summary: 'Resumen', facts: [], inferences: [], missing_information: [], contact_objective: 'Objetivo', strategy: 'Estrategia', draft: { subject: 'Asunto', body: 'Cuerpo' }, recommended_asset_ids: [], warnings: [], human_review_required: true } },
};
state = completeCopilotGeneration(state, { opportunityId: opportunityA, requestId: first.requestId, result });
assert.equal(state.phase, 'ready');
assert.equal(state.draft.subject, 'Asunto');
state = editCopilotDraft(state, { subject: 'Asunto editado' });
assert.equal(state.draft.subject, 'Asunto editado');
assert.equal(state.result.output.brief.draft.subject, 'Asunto', 'la edición local no muta el run original');
state = discardCopilotDraft(state);
assert.equal(state.phase, 'idle');

const staleStart = beginCopilotGeneration(state);
state = changeCopilotOpportunity(staleStart.state, opportunityB);
assert.equal(state.phase, 'idle');
assert.equal(completeCopilotGeneration(state, { opportunityId: opportunityA, requestId: staleStart.requestId, result }), state, 'respuesta tardía de otra oportunidad se descarta');
const currentStart = beginCopilotGeneration(state);
const staleRegeneration = beginCopilotGeneration(currentStart.state);
assert.equal(completeCopilotGeneration(staleRegeneration.state, { opportunityId: opportunityB, requestId: currentStart.requestId, result }), staleRegeneration.state, 'regeneración descarta respuesta anterior');
state = failCopilotGeneration(staleRegeneration.state, { opportunityId: opportunityB, requestId: staleRegeneration.requestId, message: 'No disponible' });
assert.equal(state.phase, 'error');
assert.equal(state.message, 'No disponible');

console.log('Vig-IA opportunity copilot state machine passed');
