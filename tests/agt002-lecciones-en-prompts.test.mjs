// Lecciones de la empresa en Vig-IA (encargo AGT-002 del 2026-11-06, PR b): sólo las activas entran, con tope; la Mesa
// las recibe en cada pedido con la regla de citarlas por id; si no se pueden leer, la Mesa responde como siempre.
import assert from 'node:assert/strict';
import test from 'node:test';

import { AGT002_LESSONS_POLICY, agt002LessonsForPrompt, loadAgt002LessonsForPrompt } from '../verticales/licitaciones/agt002-company-lessons.js';
import { AGT002_WORKBENCH_POLICY, createAgt002WorkbenchResponder } from '../verticales/licitaciones/agt002-workbench-responder.js';

const leccion = (code, status, extra = {}) => ({ code, status, version: 1, category: 'sede_agencia', statement: `Lección ${code}.`, rationale: null, how_to_apply: null, ...extra });
const AGENCIA = leccion('L-01', 'activa', { statement: 'Agencia no es sucursal: para puntaje y habilitación solo cuenta la resolución.', rationale: 'DEAJ LP-07-2026; en Cali rechazaron una agencia.', how_to_apply: 'Si piden sucursal, marcar inhabilitante.' });

test('sólo las activas entran al prompt; propuestas, retiradas y descartadas no', () => {
  const out = agt002LessonsForPrompt([AGENCIA, leccion('L-02', 'propuesta'), leccion('L-03', 'retirada'), leccion('L-04', 'descartada')]);
  assert.deepEqual(out.map(item => item.id), ['L-01']);
  assert.deepEqual(out[0], { id: 'L-01', categoria: 'Sede o agencia', leccion: AGENCIA.statement, por_que: AGENCIA.rationale, como_aplicar: AGENCIA.how_to_apply });
});

test('se respeta el tope de cantidad y de tamaño, sin cortar una lección a medias', () => {
  const muchas = Array.from({ length: 60 }, (_, i) => leccion(`L-${String(i + 1).padStart(2, '0')}`, 'activa', { statement: 'x'.repeat(400) }));
  assert.equal(agt002LessonsForPrompt(muchas, { maxLessons: 5 }).length, 5);
  const porTamano = agt002LessonsForPrompt(muchas, { maxChars: 2000 });
  assert.ok(JSON.stringify(porTamano).length <= 2000);
  assert.ok(porTamano.every(item => item.leccion.length === 400));
  assert.deepEqual(porTamano.map(item => item.id).slice(0, 2), ['L-01', 'L-02'], 'en orden de código');
});

test('sin la tabla o con error, el lector devuelve vacío y no hace fallar nada', async () => {
  const sinTabla = { from: () => ({ select() { return this; }, in() { return this; }, order: async () => ({ data: null, error: { code: '42P01', message: 'relation psi_tender_lessons_current does not exist' } }) }) };
  assert.deepEqual(await loadAgt002LessonsForPrompt(sinTabla), []);
  const roto = { from: () => { throw new Error('caída'); } };
  assert.deepEqual(await loadAgt002LessonsForPrompt(roto), []);
});

const entrada = Object.freeze({
  job_id: '20000000-0000-4000-8000-000000000001', thread_id: '20000000-0000-4000-8000-000000000002',
  origin_message_id: '20000000-0000-4000-8000-000000000003', opportunity_id: '20000000-0000-4000-8000-000000000004',
  tender_id: '20000000-0000-4000-8000-000000000005', snapshot_id: '20000000-0000-4000-8000-000000000006', base_version_id: null,
  capability_id: 'agt002.dossier-workbench.reply.v1', contract_version: 'agt002.dossier-workbench.v1', policy_version: 'agt002.dossier-workbench.policy.v1',
  context_links: Object.freeze([Object.freeze({ kind: 'source', id: '20000000-0000-4000-8000-000000000009', label: 'Pliego', source_ref: 'documento:pliego#1' })]),
  message: '¿Podemos acreditar presencia en Quibdó?',
});

function cliente() {
  const visto = {};
  return {
    visto,
    run(args) {
      Object.assign(visto, args);
      return Promise.resolve({ content: JSON.stringify({ content_text: 'Según la lección L-01…', source_links: [], missing_information: [], required_actions: [] }), usage: { input_tokens: 1, output_tokens: 1 } });
    },
  };
}

test('la Mesa recibe las lecciones activas y la regla de citarlas', async () => {
  const client = cliente();
  await createAgt002WorkbenchResponder({ client, model: 'm', loadLessons: async () => agt002LessonsForPrompt([AGENCIA, leccion('L-02', 'propuesta')]) }).respond(entrada);
  assert.deepEqual(client.visto.input.lecciones_de_la_empresa.map(item => item.id), ['L-01']);
  assert.equal(client.visto.policy, `${AGT002_WORKBENCH_POLICY} ${AGT002_LESSONS_POLICY}`);
  assert.match(client.visto.policy, /patrón, no prueba de cumplimiento/);
  assert.match(client.visto.policy, /«lección L-01»/);
});

test('sin lecciones activas, o si fallan, la Mesa queda exactamente como antes', async () => {
  for (const loadLessons of [null, async () => [], async () => { throw new Error('caída'); }]) {
    const client = cliente();
    await createAgt002WorkbenchResponder({ client, model: 'm', loadLessons }).respond(entrada);
    assert.deepEqual(Object.keys(client.visto.input).sort(), ['context_links', 'fecha_de_trabajo', 'message']);
    assert.equal(client.visto.policy, AGT002_WORKBENCH_POLICY);
  }
});
