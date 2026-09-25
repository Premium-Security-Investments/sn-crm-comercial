import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

const entry = new URL('../src/vigia/opportunity-copilot-state.ts', import.meta.url).pathname;
const bundle = buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false });
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
const {
  beginCopilotGeneration,
  canGenerateCopilotFollowup,
  changeCopilotOpportunity,
  changeCopilotPreparation,
  completeCopilotGeneration,
  copilotClipboardPayload,
  createOpportunityCopilotState,
  failCopilotGeneration,
  setCopilotCommercialIntent,
  setCopilotContactChannel,
} = await import(moduleUrl);

const opportunityA = '11111111-1111-4111-8111-111111111111';
const opportunityB = '22222222-2222-4222-8222-222222222222';

function makeResult({ subject, body }) {
  return {
    run_id: '33333333-3333-4333-8333-333333333333',
    status: 'completed',
    human_review_required: true,
    output: {
      brief: {
        summary: 'Resumen',
        facts: [],
        inferences: [],
        missing_information: [],
        contact_objective: 'Objetivo',
        strategy: 'Estrategia',
        draft: { subject, body },
        recommended_asset_ids: [],
        warnings: [],
        human_review_required: true,
      },
    },
  };
}

test('createOpportunityCopilotState: preparación vacía, sin canal por defecto', () => {
  const state = createOpportunityCopilotState(opportunityA);
  assert.equal(state.preparation.contactChannel, null);
  assert.equal(state.preparation.commercialIntent, '');
  assert.equal(canGenerateCopilotFollowup(state), false);
});

test('setCopilotContactChannel: whatsapp y email habilitan generar, sin preselección', () => {
  const state = createOpportunityCopilotState(opportunityA);
  const whatsappState = setCopilotContactChannel(state, 'whatsapp');
  assert.equal(whatsappState.preparation.contactChannel, 'whatsapp');
  assert.equal(canGenerateCopilotFollowup(whatsappState), true);

  const emailState = setCopilotContactChannel(state, 'email');
  assert.equal(emailState.preparation.contactChannel, 'email');
  assert.equal(canGenerateCopilotFollowup(emailState), true);
});

test('setCopilotCommercialIntent: recorta espacios, limita a 500 caracteres, permite vacío', () => {
  const state = createOpportunityCopilotState(opportunityA);

  const trimmed = setCopilotCommercialIntent(state, '  cerrar agenda  ');
  assert.equal(trimmed.preparation.commercialIntent, 'cerrar agenda');

  const long = setCopilotCommercialIntent(state, 'x'.repeat(600));
  assert.equal(long.preparation.commercialIntent.length, 500);

  const empty = setCopilotCommercialIntent(state, '   ');
  assert.equal(empty.preparation.commercialIntent, '');
});

test('beginCopilotGeneration: sin canal seleccionado lanza', () => {
  const state = createOpportunityCopilotState(opportunityA);
  assert.throws(() => beginCopilotGeneration(state), /canal|contact_channel/i);
});

test('flujo email: ready conserva borrador, changeCopilotPreparation vuelve a idle conservando canal e intención', () => {
  let state = createOpportunityCopilotState(opportunityA);
  state = setCopilotContactChannel(state, 'email');
  state = setCopilotCommercialIntent(state, 'cerrar agenda');

  const begin = beginCopilotGeneration(state);
  state = begin.state;

  const result = makeResult({ subject: 'Asunto seguimiento', body: 'Cuerpo del correo' });
  state = completeCopilotGeneration(state, { opportunityId: opportunityA, requestId: begin.requestId, result });
  assert.equal(state.phase, 'ready');
  assert.equal(typeof state.draft.subject, 'string');

  state = changeCopilotPreparation(state);
  assert.equal(state.phase, 'idle');
  assert.equal(state.preparation.contactChannel, 'email');
  assert.equal(state.preparation.commercialIntent, 'cerrar agenda');
  assert.equal(Object.hasOwn(state, 'result'), false);
});

test('flujo whatsapp: draft.subject null y copilotClipboardPayload sólo incluye el cuerpo', () => {
  let state = createOpportunityCopilotState(opportunityA);
  state = setCopilotContactChannel(state, 'whatsapp');

  const begin = beginCopilotGeneration(state);
  state = begin.state;

  const result = makeResult({ subject: null, body: 'Hola, seguimos en contacto' });
  state = completeCopilotGeneration(state, { opportunityId: opportunityA, requestId: begin.requestId, result });
  assert.equal(state.draft.subject, null);

  const payload = copilotClipboardPayload(state);
  assert.deepEqual(payload, {
    channel: 'whatsapp',
    subject: null,
    body: 'Hola, seguimos en contacto',
    text: 'Hola, seguimos en contacto',
  });
});

test('flujo email: copilotClipboardPayload incluye asunto y cuerpo en el texto', () => {
  let state = createOpportunityCopilotState(opportunityA);
  state = setCopilotContactChannel(state, 'email');

  const begin = beginCopilotGeneration(state);
  state = begin.state;

  const result = makeResult({ subject: 'Asunto seguimiento', body: 'Cuerpo del correo' });
  state = completeCopilotGeneration(state, { opportunityId: opportunityA, requestId: begin.requestId, result });

  const payload = copilotClipboardPayload(state);
  assert.equal(payload.channel, 'email');
  assert.equal(payload.subject, 'Asunto seguimiento');
  assert.equal(payload.body, 'Cuerpo del correo');
  assert.ok(payload.text.includes('Asunto seguimiento'));
  assert.ok(payload.text.includes('Cuerpo del correo'));
});

test('failCopilotGeneration: conserva canal e intención en preparación', () => {
  let state = createOpportunityCopilotState(opportunityA);
  state = setCopilotContactChannel(state, 'whatsapp');
  state = setCopilotCommercialIntent(state, 'urgente');

  const begin = beginCopilotGeneration(state);
  state = failCopilotGeneration(begin.state, { opportunityId: opportunityA, requestId: begin.requestId, message: 'No disponible' });

  assert.equal(state.phase, 'error');
  assert.equal(state.preparation.contactChannel, 'whatsapp');
  assert.equal(state.preparation.commercialIntent, 'urgente');
});

test('changeCopilotOpportunity: limpia canal, intención, resultado y error (idle fresco)', () => {
  let state = createOpportunityCopilotState(opportunityA);
  state = setCopilotContactChannel(state, 'email');
  state = setCopilotCommercialIntent(state, 'algo');

  const begin = beginCopilotGeneration(state);
  state = failCopilotGeneration(begin.state, { opportunityId: opportunityA, requestId: begin.requestId, message: 'falló' });
  assert.equal(state.phase, 'error');

  const nextState = changeCopilotOpportunity(state, opportunityB);
  assert.equal(nextState.phase, 'idle');
  assert.equal(nextState.opportunityId, opportunityB);
  assert.equal(nextState.preparation.contactChannel, null);
  assert.equal(nextState.preparation.commercialIntent, '');
  assert.equal(Object.hasOwn(nextState, 'result'), false);
  assert.equal(Object.hasOwn(nextState, 'message'), false);
});
