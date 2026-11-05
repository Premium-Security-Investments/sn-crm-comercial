import assert from 'node:assert/strict';
import test from 'node:test';

import { agt002FechaDeTrabajo } from '../verticales/licitaciones/agt002-fecha-de-trabajo.js';
import { createAgt002WorkbenchResponder } from '../verticales/licitaciones/agt002-workbench-responder.js';

// F3 de la auditoría del piloto Fiscalía: el pedido de 2026-11-05T01:35Z se hizo a las 20:35 del 4-nov en Colombia,
// y la Mesa contestó «hoy es 5 de noviembre, el plazo vence hoy».
const PEDIDO_FISCALIA = new Date('2026-11-05T01:35:00Z');

function entrada() {
  return Object.freeze({
    job_id: '30000000-0000-4000-8000-000000000001',
    thread_id: '30000000-0000-4000-8000-000000000002',
    origin_message_id: '30000000-0000-4000-8000-000000000003',
    opportunity_id: '30000000-0000-4000-8000-000000000004',
    tender_id: '30000000-0000-4000-8000-000000000005',
    snapshot_id: '30000000-0000-4000-8000-000000000006',
    base_version_id: null,
    capability_id: 'agt002.dossier-workbench.reply.v1',
    contract_version: 'agt002.dossier-workbench.v1',
    policy_version: 'agt002.dossier-workbench.policy.v1',
    context_links: Object.freeze([
      Object.freeze({ kind: 'source', id: '30000000-0000-4000-8000-000000000009', label: 'Pliego', source_ref: 'documento:pliego#1' }),
    ]),
    message: '¿Hasta cuándo hay plazo para las observaciones?',
  });
}

function clienteDeMentira() {
  const visto = {};
  return {
    visto,
    async run(args) {
      Object.assign(visto, args);
      return {
        content: JSON.stringify({ content_text: 'Respuesta de prueba.', source_links: [], missing_information: [], required_actions: [] }),
        usage: { input_tokens: 10, output_tokens: 10 },
      };
    },
  };
}

test('la fecha de trabajo es la de Colombia aunque en UTC ya sea el día siguiente', () => {
  const fecha = agt002FechaDeTrabajo(PEDIDO_FISCALIA);
  assert.equal(fecha.fecha, '2026-11-04');
  assert.equal(fecha.hora, '20:35');
  assert.match(fecha.dia, /miércoles, 4 de noviembre de 2026/);
  assert.match(fecha.zona, /America\/Bogota/);
});

test('a medianoche de Colombia cambia el día; antes, no', () => {
  assert.equal(agt002FechaDeTrabajo(new Date('2026-11-05T04:59:00Z')).fecha, '2026-11-04');
  assert.equal(agt002FechaDeTrabajo(new Date('2026-11-05T05:00:00Z')).fecha, '2026-11-05');
});

test('la Mesa le estampa al modelo la fecha de Colombia del momento del pedido, y la política le dice que la use', async () => {
  const client = clienteDeMentira();
  const responder = createAgt002WorkbenchResponder({ client, model: 'modelo-x', now: () => PEDIDO_FISCALIA });
  await responder.respond(entrada());
  assert.deepEqual({ ...client.visto.input.fecha_de_trabajo }, {
    fecha: '2026-11-04', hora: '20:35', dia: 'miércoles, 4 de noviembre de 2026', zona: 'America/Bogota (UTC-5)',
  });
  assert.match(client.visto.policy, /fecha_de_trabajo, en hora de Colombia/);
});
