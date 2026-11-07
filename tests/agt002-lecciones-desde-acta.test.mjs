// De acta a lección (encargo AGT-002 del 2026-11-06, PR c): al confirmar un acta, Vig-IA propone de 0 a 3 lecciones,
// en `propuesta`, a nombre de quien confirmó; nunca rompe la confirmación.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { AGT002_ACTA_LESSONS_OUTPUT_SCHEMA, buildActaLessonsInput, normalizeActaLessons, proposeLessonsFromConfirmedActa } from '../verticales/licitaciones/agt002-lessons-from-acta.js';

const OPP = '22222222-2222-4222-8222-222222222222';
const KATHERINE = '8c172493-12aa-4be1-893a-2e5e93f7fba2';
const ENV = Object.freeze({
  AGT002_WORKBENCH_RUNTIME: 'agt002_workbench_bridge_v1', AGT002_WORKBENCH_DRAIN_ENABLED: 'true', AGT002_WORKBENCH_MODEL: 'modelo',
  AGT002_HETZNER_BRIDGE_URL: 'https://puente.example.com/run', AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'x'.repeat(48),
  AGT002_WORKBENCH_AGENT_ID: '33333333-3333-4333-8333-333333333333', AGT002_WORKBENCH_WORKER_ID: 'prueba',
});
const ACTA = {
  id: '44444444-4444-4444-8444-444444444444', status: 'confirmada', confirmed_by: KATHERINE, confirmed_at: '2026-11-07T15:00:00Z',
  closure_kind: 'no_adjudicada', closing_note: 'Perdimos por precio.', reasons: ['Precio'], factors_against: ['Ofertamos al 60 % del techo'],
  confirmed_by_name: 'Katherine Valencia Buitrago', proposed_by_name: 'Juan Botero',
};

function db({ acta = ACTA, existing = [] } = {}) {
  const proposals = [];
  return {
    proposals,
    async rpc(name, args) {
      if (name === 'psi_get_tender_closure_acta') return { data: acta, error: null };
      if (name === 'psi_propose_tender_lesson') { proposals.push(args); return { data: { code: `L-0${proposals.length}` }, error: null }; }
      throw new Error(`rpc inesperado ${name}`);
    },
    from() { return { select() { return this; }, in() { return this; }, order: async () => ({ data: existing, error: null }) }; },
  };
}
const bridge = output => ({ seen: null, async run(args) { this.seen = args; return { content: JSON.stringify(output) }; } });
const silent = () => {};

test('el acta confirmada produce lecciones en propuesta, a nombre de quien confirmó y marcadas como de Vig-IA', async () => {
  const database = db({ existing: [{ code: 'L-01', statement: 'Agencia no es sucursal.' }] });
  const client = bridge({ lecciones: [
    { statement: 'El precio se estima por el centro del mercado.', rationale: 'Terminal: 60 % del techo, puesto 22.', how_to_apply: 'Simular antes de decidir.', category: 'precio' },
    { statement: 'Agencia no es sucursal.', rationale: '', how_to_apply: '', category: 'sede_agencia' },
  ] });
  const result = await proposeLessonsFromConfirmedActa(database, OPP, { environment: ENV, bridgeClient: client, log: silent });
  assert.deepEqual(result, { status: 'ran', proposed: 1 }, 'la repetida no se vuelve a proponer');
  assert.equal(database.proposals[0].p_actor_id, KATHERINE);
  assert.equal(database.proposals[0].p_proposed_by_model, true);
  assert.equal(database.proposals[0].p_payload.source_kind, 'acta');
  assert.equal(database.proposals[0].p_payload.opportunity_id, OPP);
  assert.deepEqual(client.seen.input.lecciones_existentes, [{ id: 'L-01', leccion: 'Agencia no es sucursal.' }]);
  assert.equal(JSON.stringify(client.seen.input).includes('Katherine'), false, 'sin nombres de personas');
});

test('un acta en borrador, la Mesa apagada o una falla del modelo no proponen nada ni lanzan', async () => {
  assert.equal((await proposeLessonsFromConfirmedActa(db({ acta: { ...ACTA, status: 'borrador', confirmed_by: null } }), OPP, { environment: ENV, bridgeClient: bridge({ lecciones: [] }), log: silent })).reason, 'sin_acta_confirmada');
  assert.equal((await proposeLessonsFromConfirmedActa(db(), OPP, { environment: {}, log: silent })).reason, 'apagada');
  const roto = { async run() { throw Object.assign(new Error('caído'), { code: 'BRIDGE_DOWN' }); } };
  assert.deepEqual(await proposeLessonsFromConfirmedActa(db(), OPP, { environment: ENV, bridgeClient: roto, log: silent }), { status: 'failed', code: 'BRIDGE_DOWN' });
});

test('como mucho 3, y una categoría desconocida queda como «otro»', () => {
  assert.equal(AGT002_ACTA_LESSONS_OUTPUT_SCHEMA.properties.lecciones.maxItems, 3);
  const out = normalizeActaLessons({ lecciones: Array.from({ length: 5 }, (_, i) => ({ statement: `Regla ${i}`, rationale: '', how_to_apply: '', category: i ? 'precio' : 'inventada' })) });
  assert.equal(out.length, 3);
  assert.equal(out[0].category, 'otro');
  assert.equal(buildActaLessonsInput(ACTA).motivos[0], 'Precio');
});

test('confirmar el acta pide las lecciones después de guardar, y el espejo del servidor es idéntico', () => {
  const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  const route = server.slice(server.indexOf("app.post('/api/tender-closure-acta/confirm'"), server.indexOf("app.post('/api/tender-closure-acta/reopen'"));
  assert.ok(route.indexOf('callConfirmTenderClosureActa') < route.indexOf('proposeLessonsFromConfirmedActa'));
  assert.equal(server, readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8'));
});
