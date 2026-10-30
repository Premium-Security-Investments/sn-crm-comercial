// El recorrido que le pide a Vig-IA los borradores de acta pendientes.
// Cada licitación falla por separado y el acta se escribe siempre como borrador.
import assert from 'node:assert/strict';
import test from 'node:test';
import { runAgt002ClosureActaDrafts, AGT002_CLOSURE_ACTA_MAX_LIMIT } from '../verticales/licitaciones/agt002-closure-acta-run.js';
import { closureActaContextFromAnalysis } from '../verticales/licitaciones/agt002-closure-acta-draft.js';

const VIGIA = 'a0020000-0000-4000-8000-000000000002';
const CALI = '44444444-4444-4444-8444-444444444444';
const PEREIRA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const pendingRow = (overrides = {}) => ({
  opportunity_id: CALI,
  tender_id: '66666666-6666-4666-8666-666666666666',
  closure_kind: 'cerrada_no_go',
  closing_note: 'Es un proceso 100% de tecnología y aún no cumplimos los requisitos.',
  tender_name: 'Cali — Secretaría de Seguridad',
  analysis_result: null,
  ...overrides,
});

const acta = {
  decision_summary: 'No nos presentamos: es tecnología, no vigilancia.',
  decision_quote: 'Es un proceso 100% de tecnología y aún no cumplimos los requisitos.',
  reasons: ['Es de tecnología y no de vigilancia'],
  requirements_unmet: [{ detalle: 'Faltan códigos UNSPSC.' }],
  factors_against: [],
  gaps_to_compete: [],
  recommendation: null,
  system_lesson: null,
};

function fakeDatabase(rows, { writeError = null } = {}) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'psi_list_tender_closure_acta_pending') return { data: rows, error: null };
      if (name === 'psi_upsert_tender_closure_acta') return { data: null, error: writeError };
      throw new Error(`rpc inesperada: ${name}`);
    },
  };
}
const fakeDrafter = (result = acta, calls = []) => ({ calls, async draft(input) { calls.push(input); return typeof result === 'function' ? result(input) : result; } });

test('sin pendientes no se llama al modelo', async () => {
  const drafterCalls = [];
  const events = [];
  const result = await runAgt002ClosureActaDrafts(fakeDatabase([]), { drafter: fakeDrafter(acta, drafterCalls), agentId: VIGIA, log: event => events.push(event) });
  assert.deepEqual(result, { pending: 0, drafted: 0, failed: 0, results: [] });
  assert.equal(drafterCalls.length, 0);
  assert.equal(events[0].event, 'agt002_closure_acta_nothing_pending');
});

test('el borrador se escribe como Vig-IA, sin versión previa y sin confirmar nada', async () => {
  const database = fakeDatabase([pendingRow()]);
  const drafterCalls = [];
  const result = await runAgt002ClosureActaDrafts(database, { drafter: fakeDrafter(acta, drafterCalls), agentId: VIGIA, log: () => {} });

  assert.deepEqual(result.results, [{ opportunityId: CALI, status: 'drafted' }]);
  const write = database.calls.find(call => call.name === 'psi_upsert_tender_closure_acta');
  assert.equal(write.args.p_actor_id, VIGIA, 'el autor del borrador es Vig-IA');
  assert.equal(write.args.p_expected_updated_at, null, 'es un acta nueva');
  assert.deepEqual(write.args.p_payload, acta);
  assert.ok(!database.calls.some(call => call.name.includes('confirm')), 'Vig-IA nunca confirma');
  assert.equal(drafterCalls[0].closing_note, pendingRow().closing_note, 'parte de la nota de la persona');
});

test('una licitación que falla no corta las demás', async () => {
  const database = fakeDatabase([pendingRow(), pendingRow({ opportunity_id: PEREIRA, tender_name: 'Pereira' })]);
  const events = [];
  const drafter = {
    async draft(input) {
      if (input.opportunity_id === CALI) throw Object.assign(new Error('el modelo no respondió'), { code: 'AGT002_ACTA_INVALID_JSON' });
      return acta;
    },
  };
  const result = await runAgt002ClosureActaDrafts(database, { drafter, agentId: VIGIA, log: event => events.push(event) });
  assert.equal(result.drafted, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(result.results.map(entry => entry.status), ['failed', 'drafted']);
  const failure = events.find(event => event.event === 'agt002_closure_acta_failed');
  assert.equal(failure.code, 'AGT002_ACTA_INVALID_JSON');
  assert.equal(failure.opportunity_id, CALI);
  assert.ok(!JSON.stringify(events).includes('decision_summary'), 'el registro no incluye el contenido del acta');
});

test('una licitación sin nota de cierre se reporta, no se inventa el acta', async () => {
  const database = fakeDatabase([pendingRow({ closing_note: '   ' })]);
  const result = await runAgt002ClosureActaDrafts(database, { drafter: fakeDrafter(), agentId: VIGIA, log: () => {} });
  assert.equal(result.failed, 1);
  assert.equal(result.results[0].code, 'AGT002_ACTA_MISSING_CLOSING_NOTE');
  assert.ok(!database.calls.some(call => call.name === 'psi_upsert_tender_closure_acta'));
});

test('si la escritura falla, la licitación queda contada como fallida', async () => {
  const database = fakeDatabase([pendingRow()], { writeError: Object.assign(new Error('ya está confirmada'), { code: '23505' }) });
  const result = await runAgt002ClosureActaDrafts(database, { drafter: fakeDrafter(), agentId: VIGIA, log: () => {} });
  assert.equal(result.drafted, 0);
  assert.equal(result.results[0].code, '23505');
});

test('el recorrido exige base, redactor e identidad de Vig-IA, y acota el límite', async () => {
  await assert.rejects(() => runAgt002ClosureActaDrafts(null, { drafter: fakeDrafter(), agentId: VIGIA }), /conexión a la base/);
  await assert.rejects(() => runAgt002ClosureActaDrafts(fakeDatabase([]), { agentId: VIGIA }), /redactor configurado/);
  await assert.rejects(() => runAgt002ClosureActaDrafts(fakeDatabase([]), { drafter: fakeDrafter() }), /identidad de Vig-IA/);

  for (const [limit, expected] of [[undefined, 5], [0, 5], ['tres', 5], [3, 3], [999, AGT002_CLOSURE_ACTA_MAX_LIMIT]]) {
    const database = fakeDatabase([]);
    await runAgt002ClosureActaDrafts(database, { drafter: fakeDrafter(), agentId: VIGIA, limit, log: () => {} });
    assert.equal(database.calls[0].args.p_limit, expected, `límite ${limit}`);
  }
});

test('el contexto del acta sale del análisis: primero lo que bloquea', () => {
  const context = closureActaContextFromAnalysis({
    integral_analysis: {
      analysis_units: [
        { unit_id: 'u1', title: 'Pólizas', conclusion: { summary: 'Cumple.' } },
        { unit_id: 'u2', title: 'Experiencia específica', conclusion: { status: 'no_cumple', summary: 'No tenemos 1.800 cámaras.' }, blocking: { effect: 'rechazo', reason: 'Requisito habilitante.' }, evidence_refs: [{ ref: 'pliego 11.2' }] },
        { unit_id: 'u3', title: 'Sin texto' },
        'basura',
        null,
      ],
    },
  });
  assert.equal(context.length, 2, 'las unidades sin texto o que no son objetos se descartan');
  assert.equal(context[0].label, 'Experiencia específica', 'lo que bloquea va primero');
  assert.equal(context[0].source_ref, 'pliego 11.2');
  assert.match(context[0].text, /No tenemos 1\.800 cámaras\. Requisito habilitante\./);
  assert.deepEqual(Object.keys(context[0]).sort(), ['label', 'source_ref', 'text'], 'la marca interna de bloqueo no llega al modelo');
  assert.deepEqual(closureActaContextFromAnalysis(null), [], 'sin análisis, no hay contexto y el acta se redacta con la nota sola');
  assert.deepEqual(closureActaContextFromAnalysis({ analysis_units: [{ unit_id: 'x', conclusion: { summary: 'Hola.' } }] }).length, 1, 'tolera el análisis sin envoltura integral');
});

// Punto 5: el recorrido le pasa al acta las aclaraciones de esa licitación, y si no se pueden leer, redacta igual.

test('el acta recibe las aclaraciones de su licitación, y una lectura fallida no la impide', async () => {
  const inputs = [];
  const eventos = [];
  const database = { rpc: async (name, args) => {
    if (name === 'psi_list_tender_closure_acta_pending') return { data: [pendingRow(), pendingRow({ opportunity_id: PEREIRA })], error: null };
    inputs.push(args.p_opportunity_id);
    return { data: null, error: null };
  } };
  const vistas = [];
  const drafter = { draft: async input => { vistas.push(input.human_clarifications || null); return acta; } };
  const resultado = await runAgt002ClosureActaDrafts(database, {
    drafter, agentId: VIGIA, log: evento => eventos.push(evento),
    loadClarifications: async (_db, opportunityId) => {
      if (opportunityId === PEREIRA) throw new Error('sin tabla de aclaraciones');
      return [{ id: 'c1', content: 'En Cali somos agencia, no sucursal.', target_label: 'Domicilio', created_at: '2026-10-20T15:00:00Z', author_name: 'Juan Botero' }];
    },
  });
  assert.equal(resultado.drafted, 2, 'las dos actas se redactan');
  assert.deepEqual(vistas[0].map(item => [item.autor, item.punto, item.aclaracion]), [['Juan Botero', 'Domicilio', 'En Cali somos agencia, no sucursal.']]);
  assert.equal(vistas[1], null, 'la licitación cuya lectura falló va sin aclaraciones');
  assert.deepEqual(eventos.filter(evento => evento.event === 'agt002_closure_acta_clarifications_unavailable').map(evento => evento.opportunity_id), [PEREIRA]);
  assert.deepEqual(eventos.filter(evento => evento.event === 'agt002_closure_acta_drafted').map(evento => evento.clarifications), [1, 0], 'el recibo dice cuántas se usaron');
});
