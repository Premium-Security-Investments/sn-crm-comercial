// La Mesa lee la conversación y el CRM de hoy (Juan, 2026-11-20, DEAJ): sin los mensajes anteriores, Vig-IA contestó que
// el cierre «no cambió» dos minutos después de haberlo movido.
import test from 'node:test';
import assert from 'node:assert/strict';
import { conversacionPrevia, estadoEnElCrm, leerConversacionDeLaMesa, AGT002_CONVERSACION_POLICY } from '../verticales/licitaciones/agt002-mesa-conversacion.js';
import { createAgt002WorkbenchResponder } from '../verticales/licitaciones/agt002-workbench-responder.js';
import { AGT002_WORKBENCH_CAPABILITIES, AGT002_WORKBENCH_CONTRACT_VERSION, AGT002_WORKBENCH_POLICY_VERSION } from '../verticales/licitaciones/agt002-workbench-contract.js';

const FILAS = [
  { author_kind: 'agent', content: 'Corregí la fecha de cierre: de 2026-11-26 a 2026-11-27.', created_at: '2026-11-21T03:34:31Z' },
  { author_kind: 'human', content: "Presentación de Ofertas ha cambiado desde '26/11/2026 9:00:00 AM' hasta '27/11/2026 9:00:00 AM'", created_at: '2026-11-21T03:34:03Z', author: { full_name: 'Juan Botero' } },
];

test('la conversación previa va del más antiguo al más reciente, con quién habló', () => {
  const mensajes = conversacionPrevia(FILAS);
  assert.deepEqual(mensajes.map(mensaje => mensaje.quien), ['Juan Botero', 'Vig-IA']);
  assert.match(mensajes[0].cuando, /20\/11\/2026/, 'en hora de Colombia: las 3:34 UTC del 21 son el 20 en Bogotá');
});

test('el estado del CRM dice el cierre con su hora y si se corrigió en la Mesa', () => {
  const estado = estadoEnElCrm({
    licitacion: { deadline_at: '2026-11-27T14:00:00.000Z', raw: { deadline_source: 'pliego', deadline_mesa: { applied_at: '2026-11-21T03:36:00Z', by: 'Juan Botero', fuente: 'aviso de cambio de SECOP pegado en la Mesa' } } },
    oportunidad: { expected_close_date: '2026-11-27', offer_value: '9000000000', tender_offer_status: 'en_preparacion' },
  });
  assert.match(estado.cierre, /27\/11\/2026.*9:00.*hora de Colombia/);
  assert.match(estado.cierre_corregido_en_la_mesa, /a pedido de Juan Botero; fuente: aviso de cambio de SECOP/);
  assert.equal(estado.fecha_de_cierre_de_la_oportunidad, '2026-11-27');
  assert.equal(estado.presupuesto, '$9.000.000.000');
});

test('lee del CRM los mensajes anteriores del hilo y lo que escribió la persona, del mensaje actual hacia atrás', async () => {
  const consultas = [];
  const database = {
    from: tabla => {
      const filtros = {};
      const q = {
        select: () => q, eq: (columna, valor) => { filtros[columna] = valor; return q; }, lt: (columna, valor) => { filtros.lt = valor; return q; },
        order: () => q,
        limit: async limite => { consultas.push({ tabla, filtros, limite }); return { data: FILAS, error: null }; },
        maybeSingle: async () => ({ data: tabla === 'psi_agt002_workbench_messages'
          ? { created_at: '2026-11-21T03:36:13Z', content: 'la idea es que actualice el cronograma completo', author_kind: 'human' }
          : tabla === 'psi_public_tenders' ? { deadline_at: '2026-11-27T14:00:00.000Z', raw: {} } : { expected_close_date: '2026-11-27' }, error: null }),
      };
      return q;
    },
  };
  const leido = await leerConversacionDeLaMesa(database, { threadId: 'h1', originMessageId: 'm3', opportunityId: 'o1', tenderId: 't1' });
  assert.deepEqual(consultas[0].filtros, { thread_id: 'h1', lt: '2026-11-21T03:36:13Z' });
  assert.equal(leido.mensajes.length, 2);
  assert.equal(leido.textosDeLaPersona[0], 'la idea es que actualice el cronograma completo');
  assert.match(leido.textosDeLaPersona[1], /Presentación de Ofertas ha cambiado/);
  assert.equal(leido.estado.fecha_de_cierre_de_la_oportunidad, '2026-11-27');
});

test('el pedido a Vig-IA lleva la conversación previa, el CRM de hoy y la regla para leerlos', async () => {
  const llamadas = [];
  const responder = createAgt002WorkbenchResponder({
    client: { run: async args => { llamadas.push(args); return { content: JSON.stringify({ content_text: 'Listo.', source_links: [], missing_information: [], required_actions: [] }), usage: { input_tokens: 1, output_tokens: 1 } }; } },
    model: 'sonnet', timeoutMs: 30_000,
    cargarConversacion: async () => ({ mensajes: conversacionPrevia(FILAS), estado: { cierre: '27/11/2026, 9:00 a. m. (hora de Colombia)' } }),
  });
  const id = n => `0000000${n}-0000-4000-8000-00000000000${n}`;
  await responder.respond({ job_id: id(1), thread_id: id(2), origin_message_id: id(3), opportunity_id: id(4), tender_id: id(5), snapshot_id: id(6), base_version_id: id(7),
    capability_id: AGT002_WORKBENCH_CAPABILITIES.reply, contract_version: AGT002_WORKBENCH_CONTRACT_VERSION, policy_version: AGT002_WORKBENCH_POLICY_VERSION,
    context_links: [], message: 'la idea es que actualice el cronograma completo' });
  assert.equal(llamadas[0].input.conversacion_previa.length, 2);
  assert.match(llamadas[0].input.conversacion_previa[0].texto, /Presentación de Ofertas ha cambiado/);
  assert.equal(llamadas[0].input.estado_en_el_crm.cierre, '27/11/2026, 9:00 a. m. (hora de Colombia)');
  assert.ok(llamadas[0].policy.includes(AGT002_CONVERSACION_POLICY));
});

test('si la conversación no se puede leer, la Mesa contesta igual, sin ella', async () => {
  const llamadas = [];
  const responder = createAgt002WorkbenchResponder({
    client: { run: async args => { llamadas.push(args); return { content: JSON.stringify({ content_text: 'Listo.', source_links: [], missing_information: [], required_actions: [] }), usage: { input_tokens: 1, output_tokens: 1 } }; } },
    model: 'sonnet', timeoutMs: 30_000,
    cargarConversacion: async () => { throw new Error('caída'); },
  });
  const id = n => `0000000${n}-0000-4000-8000-00000000000${n}`;
  await responder.respond({ job_id: id(1), thread_id: id(2), origin_message_id: id(3), opportunity_id: id(4), tender_id: id(5), snapshot_id: id(6), base_version_id: id(7),
    capability_id: AGT002_WORKBENCH_CAPABILITIES.reply, contract_version: AGT002_WORKBENCH_CONTRACT_VERSION, policy_version: AGT002_WORKBENCH_POLICY_VERSION,
    context_links: [], message: 'hola' });
  assert.equal(llamadas[0].input.conversacion_previa, undefined);
  assert.ok(!llamadas[0].policy.includes(AGT002_CONVERSACION_POLICY));
});
