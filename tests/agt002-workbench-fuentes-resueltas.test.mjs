import assert from 'node:assert/strict';
import test from 'node:test';

import { createAgt002WorkbenchResponder } from '../agt002-workbench-responder.js';

const ids = Object.freeze({
  job: '20000000-0000-4000-8000-000000000001',
  thread: '20000000-0000-4000-8000-000000000002',
  originMessage: '20000000-0000-4000-8000-000000000003',
  opportunity: '20000000-0000-4000-8000-000000000004',
  tender: '20000000-0000-4000-8000-000000000005',
  snapshot: '20000000-0000-4000-8000-000000000006',
  sourceLink: '20000000-0000-4000-8000-000000000009',
});

function entrada(overrides = {}) {
  return Object.freeze({
    job_id: ids.job,
    thread_id: ids.thread,
    origin_message_id: ids.originMessage,
    opportunity_id: ids.opportunity,
    tender_id: ids.tender,
    snapshot_id: ids.snapshot,
    base_version_id: null,
    capability_id: 'agt002.dossier-workbench.reply.v1',
    contract_version: 'agt002.dossier-workbench.v1',
    policy_version: 'agt002.dossier-workbench.policy.v1',
    context_links: Object.freeze([
      Object.freeze({ kind: 'source', id: ids.sourceLink, label: 'Pliego', source_ref: 'documento:pliego#1' }),
    ]),
    message: '¿Qué códigos del RUP me faltan para este proceso?',
    ...overrides,
  });
}

function clienteDeMentira({ citas = [] } = {}) {
  const visto = {};
  return {
    visto,
    run(args) {
      Object.assign(visto, args);
      return Promise.resolve({
        content: JSON.stringify({
          content_text: 'Respuesta de prueba.',
          source_links: citas,
          missing_information: [],
          required_actions: [],
        }),
        usage: { input_tokens: 10, output_tokens: 10 },
      });
    },
  };
}

const CODIGOS_TIPADOS = Object.freeze({
  nombre: 'empresa.codigos_rup',
  estado: 'vigente',
  forma: 'tipado',
  interpretable: false,
  as_of: '2026-09-28',
  vence_el: '2026-11-27',
  responsable: 'Katherine',
  procedencia: { tabla: 'psi_company_rup_codes' },
  valor: { total: 14, codigos: ['46151600', '92121500'] },
});

const PERFIL_EN_PROSA = Object.freeze({
  nombre: 'empresa.identidad',
  estado: 'vigente',
  forma: 'prosa',
  interpretable: true,
  as_of: '2026-10-13',
  vence_el: null,
  responsable: 'Katherine',
  procedencia: { tabla: 'psi_company_procurement_profile' },
  valor: { razon_social: 'SEGURIDAD NACIONAL LIMITADA' },
});

test('sin catálogo conectado la entrada conserva el contrato de dos claves', async () => {
  const client = clienteDeMentira();
  const responder = createAgt002WorkbenchResponder({ client, model: 'modelo-x' });
  await responder.respond(entrada());
  assert.deepEqual(Object.keys(client.visto.input).sort(), ['context_links', 'message']);
});

test('con catálogo, el dato viaja estampado antes de llamar al modelo', async () => {
  const client = clienteDeMentira();
  const responder = createAgt002WorkbenchResponder({
    client,
    model: 'modelo-x',
    resolveSources: async () => [CODIGOS_TIPADOS],
  });
  await responder.respond(entrada());
  const [fuente] = client.visto.input.fuentes_resueltas;
  assert.equal(fuente.nombre, 'empresa.codigos_rup');
  assert.equal(fuente.sostiene_afirmacion, true);
  assert.equal(fuente.as_of, '2026-09-28');
  assert.equal(fuente.vence_el, '2026-11-27');
  assert.equal(fuente.responsable, 'Katherine');
  assert.match(fuente.valor, /46151600/);
  assert.match(fuente.procedencia, /psi_company_rup_codes/);
});

test('el resolvedor recibe el proceso del expediente, no uno inventado', async () => {
  const client = clienteDeMentira();
  const vistos = [];
  const responder = createAgt002WorkbenchResponder({
    client,
    model: 'modelo-x',
    resolveSources: async (contexto) => { vistos.push(contexto); return []; },
  });
  await responder.respond(entrada());
  assert.equal(vistos[0].tenderId, ids.tender);
  assert.equal(vistos[0].capabilityId, 'agt002.dossier-workbench.reply.v1');
});

test('una entrada de catálogo no se vuelve citable: la cita sigue siendo del expediente', async () => {
  // El contrato de la Mesa exige que todo source_link sea un UUID del expediente. Una fuente
  // resuelta sostiene la afirmación, pero se cita el documento del expediente, no el catálogo.
  const client = clienteDeMentira({ citas: ['empresa.codigos_rup'] });
  const responder = createAgt002WorkbenchResponder({
    client,
    model: 'modelo-x',
    resolveSources: async () => [CODIGOS_TIPADOS],
  });
  await assert.rejects(
    () => responder.respond(entrada()),
    error => error.code === 'AGT002_RESPONDER_FORGED_SOURCE',
  );
});

test('citando el expediente, la fuente resuelta sostiene la respuesta', async () => {
  const client = clienteDeMentira({ citas: [ids.sourceLink] });
  const responder = createAgt002WorkbenchResponder({
    client,
    model: 'modelo-x',
    resolveSources: async () => [CODIGOS_TIPADOS],
  });
  const envelope = await responder.respond(entrada());
  assert.equal(envelope.kind, 'reply');
  assert.deepEqual(envelope.source_links, [ids.sourceLink]);
  assert.equal(client.visto.input.fuentes_resueltas[0].sostiene_afirmacion, true);
});

test('una fuente en prosa viaja como dato, marcada como insuficiente', async () => {
  const client = clienteDeMentira({ citas: [] });
  const responder = createAgt002WorkbenchResponder({
    client,
    model: 'modelo-x',
    resolveSources: async () => [PERFIL_EN_PROSA],
  });
  await responder.respond(entrada());
  // El dato viajó: el modelo supo la razón social y ya no la inventa. Pero sale marcada como
  // interpretable y sin sostener afirmaciones, así que lo honesto es declararla faltante.
  const [fuente] = client.visto.input.fuentes_resueltas;
  assert.equal(fuente.sostiene_afirmacion, false);
  assert.equal(fuente.interpretable, true);
  assert.match(fuente.valor, /SEGURIDAD NACIONAL LIMITADA/);
});

test('si el catálogo falla la Mesa responde igual, sin esas fuentes', async () => {
  const client = clienteDeMentira();
  const responder = createAgt002WorkbenchResponder({
    client,
    model: 'modelo-x',
    resolveSources: async () => { throw Object.assign(new Error('caído'), { code: 'resolver_down' }); },
  });
  const envelope = await responder.respond(entrada());
  assert.equal(envelope.kind, 'reply');
  assert.equal(client.visto.input.fuentes_resueltas, undefined);
});

test('el resolvedor debe ser una función, no cualquier cosa', () => {
  assert.throws(() => createAgt002WorkbenchResponder({
    client: clienteDeMentira(),
    model: 'modelo-x',
    resolveSources: 'no soy una función',
  }), /resolvedor de fuentes sea una función/);
});
