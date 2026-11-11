import assert from 'node:assert/strict';
import test from 'node:test';

import { agt002UsaTopeDeBorrador } from '../verticales/licitaciones/agt002-mesa-document-intent.js';
import { runAgt002WorkbenchWorker } from '../verticales/licitaciones/agt002-workbench-worker.js';
import { createAgt002WorkbenchResponder } from '../verticales/licitaciones/agt002-workbench-responder.js';
import { AGT002_WORKBENCH_CONTRACT_VERSION, AGT002_WORKBENCH_POLICY_VERSION } from '../verticales/licitaciones/agt002-workbench-contract.js';

// F7 de la auditoría del piloto Fiscalía: el pedido `4ef8df10` (2026-11-05 01:50Z) era una respuesta —antes del GO no
// hay otra cosa— y se cortó a los 30 s redactando dos observaciones. Ésta es la cola literal de ese mensaje.
const PEDIDO_FISCALIA = 'Te paso el texto literal del pliego definitivo, numeral 5.3.2, punto 1, páginas 37-38, que no te llega completo: «…»\n\n'
  + 'Con eso, redacta las observaciones para radicar en SECOP antes de mañana 5 de noviembre a las 11:00 a. m. (hora Colombia). '
  + 'Una sobre cómo se lee la regla de consorcios y uniones temporales, y otra que pida aceptar como acreditación una solicitud ya '
  + 'radicada ante la SuperVigilancia. Texto formal, listo para pegar.';
const REPLY = 'agt002.dossier-workbench.reply.v1';

// 11-nov: la pregunta de análisis del piloto Fiscalía (no pide redactar) también se cortó a los 30 s.
const PREGUNTA_ANALISIS = 'Si armamos una unión temporal con Sepecol o con Vigilancia Acosta para cubrir Armenia y Quibdó, ¿qué requisitos '
  + 'habilitantes debe cumplir cada integrante por separado, cuáles se suman entre los dos y qué documentos le debo pedir hoy al socio? '
  + 'Cita el numeral del pliego de cada uno.';
const LEARNING = 'agt002.dossier-workbench.learning-proposal.v1';

test('toda respuesta y todo borrador tienen el tope largo; la propuesta de aprendizaje no', () => {
  assert.equal(agt002UsaTopeDeBorrador({ capability_id: REPLY, message: PEDIDO_FISCALIA }), true);
  assert.equal(agt002UsaTopeDeBorrador({ capability_id: REPLY, message: PREGUNTA_ANALISIS }), true);
  assert.equal(agt002UsaTopeDeBorrador({ capability_id: REPLY, message: '¿Cuándo cierra?' }), true);
  assert.equal(agt002UsaTopeDeBorrador({ capability_id: 'agt002.dossier-workbench.draft.v1', message: 'x' }), true);
  assert.equal(agt002UsaTopeDeBorrador({ capability_id: LEARNING, message: 'x' }), false);
});

const ids = {
  job: '30000000-0000-4000-8000-000000000001', thread: '30000000-0000-4000-8000-000000000002', origin: '30000000-0000-4000-8000-000000000003',
  opportunity: '30000000-0000-4000-8000-000000000004', tender: '30000000-0000-4000-8000-000000000005', snapshot: '30000000-0000-4000-8000-000000000006',
  agent: '30000000-0000-4000-8000-000000000007', actor: '30000000-0000-4000-8000-000000000008',
};
const job = message => ({
  id: ids.job, thread_id: ids.thread, origin_message_id: ids.origin, opportunity_id: ids.opportunity, tender_id: ids.tender,
  snapshot_id: ids.snapshot, base_version_id: null, capability_id: REPLY, contract_version: AGT002_WORKBENCH_CONTRACT_VERSION,
  policy_version: AGT002_WORKBENCH_POLICY_VERSION, context_links: [], message, requested_by: ids.actor, idempotency_key: 'a'.repeat(64),
  created_at: '2026-11-05T01:50:01Z',
});
function persistencia(message) {
  const eventos = [];
  return {
    eventos,
    async claimAgt002WorkbenchJob() { return { status: 'claimed', claim_id: '30000000-0000-4000-8000-0000000000aa', job: job(message) }; },
    async appendAgt002WorkbenchJobEvent({ eventType, metadata }) { eventos.push({ eventType, code: metadata?.code }); return { status: eventType }; },
    async completeAgt002WorkbenchJob() { eventos.push({ eventType: 'completed' }); return { status: 'completed', message_id: 'm' }; },
  };
}
const lento = { async respond(input) {
  await new Promise(resolve => setTimeout(resolve, 60));
  return { kind: 'reply', visible_agent_name: 'Vig-IA', human_review_required: true, snapshot_id: input.snapshot_id, base_version_id: null,
    content_text: 'OBSERVACIÓN 1…', source_links: [], missing_information: [], required_actions: [] };
} };
const limits = { workerId: 'w', dailyMaxJobs: 0, maxConcurrent: 0, leaseSeconds: 300, responderTimeoutMs: 20, draftResponderTimeoutMs: 500, agentId: ids.agent };

test('caso Fiscalía: una respuesta que pide redactar tiene el tope del borrador y termina', async () => {
  const persistence = persistencia(PEDIDO_FISCALIA);
  await runAgt002WorkbenchWorker({ persistence, responder: lento, limits });
  assert.deepEqual(persistence.eventos, [{ eventType: 'completed' }]);
});

test('caso Fiscalía 11-nov: una pregunta de análisis también tiene el tope del borrador y termina', async () => {
  const persistence = persistencia(PREGUNTA_ANALISIS);
  await runAgt002WorkbenchWorker({ persistence, responder: lento, limits });
  assert.deepEqual(persistence.eventos, [{ eventType: 'completed' }]);
});

test('el puente recibe el tope del borrador menos 5 s en toda respuesta', async () => {
  const vistos = [];
  const client = { async run(args) { vistos.push(args.timeoutMs); return { content: JSON.stringify({ content_text: 'x', source_links: [], missing_information: [], required_actions: [] }), usage: { input_tokens: 1, output_tokens: 1 } }; } };
  const responder = createAgt002WorkbenchResponder({ client, model: 'm', timeoutMs: 30_000, draftTimeoutMs: 90_000 });
  const entrada = message => {
    const { id, requested_by, idempotency_key, created_at, ...resto } = job(message);
    return { ...resto, job_id: id };
  };
  await responder.respond(entrada(PEDIDO_FISCALIA));
  await responder.respond(entrada('¿Qué dice el numeral 5.3.2?'));
  assert.deepEqual(vistos, [85_000, 85_000]);
});
