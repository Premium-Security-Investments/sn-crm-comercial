import { strict as assert } from 'node:assert';
import { ACTIONS, can, requireAction } from '../access-control.js';
import { callTenderGoNoGoDecision } from '../tender-go-no-go-rpc.js';
import { callTenderOfferStatusTransition } from '../tender-offer-status-rpc.js';
import {
  getAgt002WorkbenchApi,
  postAgt002MessageApi,
  postAgt002RetryApi,
  postAgt002LearningReviewApi,
} from '../agt002-workbench-api.js';
import { validateAgt002WorkbenchResult } from '../agt002-workbench-contract.js';

const OPPORTUNITY_ID = '11111111-1111-4111-8111-111111111111';
const AI_ONLY_ACTIONS = new Set([ACTIONS.AI_ANALYSIS_RUN, ACTIONS.LICITACIONES_GO_NO_GO_RECOMMEND]);

// Agente activo que, además, forja un rol y permisos humanos privilegiados: si la
// identidad de agente por sí sola no bastara para negar autoridad humana, este
// perfil pasaría todas las verificaciones humanas.
const impersonatingAgentProfile = Object.freeze({
  id: '22222222-2222-4222-8222-222222222222',
  active: true,
  identity_type: 'agent',
  role: 'admin',
  permissions: Object.freeze(['licitaciones', 'licitaciones_custodia', 'users.manage']),
  areas: Object.freeze([{ area_code: 'comercial', subarea_code: null }]),
});

const genericResource = Object.freeze({
  technical_authorized: true,
  area_code: 'comercial',
  subarea_code: null,
  owner_id: impersonatingAgentProfile.id,
  assignee_id: impersonatingAgentProfile.id,
  publication_status: 'published',
});

// 1) Matriz completa: ninguna acción reservada humana cede ante identidad de
// agente, ni siquiera con rol/permisos/áreas forjados. Solo las dos acciones de
// asistencia técnica están disponibles, y solo cuando el servidor ya marcó el
// recurso como autorizado.
for (const action of Object.values(ACTIONS)) {
  if (AI_ONLY_ACTIONS.has(action)) continue;
  assert.equal(can(impersonatingAgentProfile, action, genericResource), false, `agente no debe poder ${action}`);
  assert.throws(() => requireAction(impersonatingAgentProfile, action, genericResource), /autorización/i, `requireAction debe rechazar ${action} para un agente`);
}
for (const action of AI_ONLY_ACTIONS) {
  assert.equal(can(impersonatingAgentProfile, action, { technical_authorized: true }), true, `agente debe poder ${action} solo con autorización técnica de servidor`);
  assert.equal(can(impersonatingAgentProfile, action, { technical_authorized: false }), false, `${action} no debe ceder sin autorización técnica`);
  assert.equal(can(impersonatingAgentProfile, action, {}), false, `${action} no debe ceder sin el campo de autorización`);
}

// 2) La ruta humana formal sigue funcionando exclusivamente con perfil humano
// autorizado: mismo permiso, mismo rol, pero identidad humana real.
const authorizedHumanProfile = Object.freeze({
  id: '33333333-3333-4333-8333-333333333333',
  active: true,
  identity_type: 'human',
  role: 'director',
  permissions: Object.freeze(['licitaciones', 'licitaciones_custodia']),
  areas: Object.freeze([{ area_code: 'comercial', subarea_code: null }]),
});
assert.equal(can(authorizedHumanProfile, ACTIONS.LICITACIONES_GO_NO_GO_APPROVE, {}), true);
assert.equal(can(authorizedHumanProfile, ACTIONS.LICITACIONES_WORKBENCH_USE, {}), true);
assert.equal(can(authorizedHumanProfile, ACTIONS.LICITACIONES_WORKBENCH_CUSTODY, {}), true);

// Un humano real sin el rol elevado sigue sin poder aprobar GO/NO-GO: la
// identidad humana es necesaria, pero no suficiente.
const unprivilegedHumanProfile = Object.freeze({
  id: '44444444-4444-4444-8444-444444444444',
  active: true,
  identity_type: 'human',
  role: 'comercial',
  permissions: Object.freeze(['licitaciones']),
});
assert.equal(can(unprivilegedHumanProfile, ACTIONS.LICITACIONES_GO_NO_GO_APPROVE, {}), false);

// 3) RPC humanas reales: identidad de agente debe ser rechazada ANTES de tocar
// la base de datos. Un stub que lanza ante cualquier acceso prueba que no hay
// lectura/escritura alguna intentada para un actor de agente.
function poisonedDatabase() {
  return {
    from() { throw new Error('la base de datos no debe tocarse para un actor de agente'); },
    rpc() { throw new Error('la base de datos no debe tocarse para un actor de agente'); },
  };
}

await assert.rejects(
  () => callTenderGoNoGoDecision(poisonedDatabase(), {
    opportunity_id: OPPORTUNITY_ID, decision: 'go', analysis_run_id: null, justification: 'intento de agente',
  }, impersonatingAgentProfile),
  error => { assert.equal(error.status, 403); return true; },
  'callTenderGoNoGoDecision debe rechazar identidad de agente sin tocar la base de datos',
);

await assert.rejects(
  () => callTenderOfferStatusTransition(poisonedDatabase(), {
    opportunity_id: OPPORTUNITY_ID, to_status: 'presentada', expected_current_status: 'lista_para_presentar', note: 'intento de agente',
  }, impersonatingAgentProfile),
  error => { assert.equal(error.status, 403); return true; },
  'callTenderOfferStatusTransition (presentar oferta) debe rechazar identidad de agente sin tocar la base de datos',
);

// 4) API de la Mesa Vig-IA: cada operación humana (lectura, mensaje, retry,
// revisión de aprendizaje) rechaza identidad de agente antes de invocar la base
// de datos, incluso con la Mesa habilitada.
const workbenchOptions = { enabled: true };
await assert.rejects(
  () => getAgt002WorkbenchApi(poisonedDatabase(), OPPORTUNITY_ID, impersonatingAgentProfile, workbenchOptions),
  error => { assert.equal(error.status, 403); assert.equal(error.code, 'AGT002_WORKBENCH_FORBIDDEN'); return true; },
);
await assert.rejects(
  () => postAgt002MessageApi(poisonedDatabase(), {}, impersonatingAgentProfile, workbenchOptions),
  error => { assert.equal(error.status, 403); assert.equal(error.code, 'AGT002_WORKBENCH_FORBIDDEN'); return true; },
);
await assert.rejects(
  () => postAgt002RetryApi(poisonedDatabase(), {}, impersonatingAgentProfile, workbenchOptions),
  error => { assert.equal(error.status, 403); assert.equal(error.code, 'AGT002_WORKBENCH_FORBIDDEN'); return true; },
);
await assert.rejects(
  () => postAgt002LearningReviewApi(poisonedDatabase(), {}, impersonatingAgentProfile, workbenchOptions),
  error => { assert.equal(error.status, 403); assert.equal(error.code, 'AGT002_WORKBENCH_FORBIDDEN'); return true; },
);

// 5) El contrato cerrado de la Mesa rechaza mecánicamente cualquier salida de
// modelo que se atribuya autoridad humana (aprobar/firmar/enviar/radicar/
// presentar), incluso si el resto del envelope es válido.
const baseInput = Object.freeze({
  job_id: '55555555-5555-4555-8555-555555555555',
  thread_id: '66666666-6666-4666-8666-666666666666',
  origin_message_id: '77777777-7777-4777-8777-777777777777',
  opportunity_id: OPPORTUNITY_ID,
  tender_id: '88888888-8888-4888-8888-888888888888',
  snapshot_id: '99999999-9999-4999-8999-999999999999',
  base_version_id: null,
  capability_id: 'agt002.dossier-workbench.reply.v1',
  contract_version: 'agt002.dossier-workbench.v1',
  policy_version: 'agt002.dossier-workbench.policy.v1',
  context_links: [],
  message: 'Resuma el estado del expediente.',
});
const authorityClaimingResult = {
  kind: 'reply',
  visible_agent_name: 'Vig-IA',
  human_review_required: true,
  snapshot_id: baseInput.snapshot_id,
  base_version_id: baseInput.base_version_id,
  content_text: 'Ya aprobé la oferta y la presentaré hoy mismo.',
  source_links: [],
  missing_information: [],
  required_actions: [],
};
assert.throws(
  () => validateAgt002WorkbenchResult(authorityClaimingResult, { input: baseInput }),
  /autoridad prohibida/i,
  'el contrato de la Mesa debe rechazar una salida que se atribuya aprobar/presentar',
);

console.log('AGT-002 human authority dynamic proof passed');
