import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildAgt003CopilotRequest } from '../verticales/comercial/agt003-copilot-input.js';
import { createAgt003CopilotEngine } from '../verticales/comercial/agt003-copilot-engine.js';

// El copiloto comercial, con el mismo catálogo que la Mesa. Lo que estas pruebas vigilan no es la
// empresa: es que el mecanismo sirva a un segundo lector sin que haya que modificarlo.
const brief = JSON.parse(readFileSync(new URL('../contracts/agents/AGT-003/v2-draft/fixtures/valid-opportunity-copilot-response.json', import.meta.url), 'utf8')).brief;
const briefSeguro = { ...structuredClone(brief), facts: [], inferences: [], recommended_asset_ids: [] };

const PETICION = buildAgt003CopilotRequest({
  opportunity: { id: 'opp-1', title: 'Prueba', company_name: 'Cliente Sintético', stage: 'Contacto', service: 'Seguridad', owner_name: 'Humano' },
  interactions: [],
  approvedAssets: [],
  correlationId: 'corr-fuentes',
  snapshotId: 'snapshot-fuentes',
  contactChannel: 'email',
});

const IDENTIDAD = Object.freeze({
  nombre: 'empresa.identidad',
  estado: 'vigente',
  forma: 'tipado',
  requiere_interpretacion: false,
  as_of: '2026-10-13',
  vence_el: null,
  responsable: 'Katherine',
  procedencia: { tabla: 'psi_company_procurement_profile' },
  valor: { razon_social: 'SEGURIDAD NACIONAL LIMITADA', nit: '891408256-4' },
});

function motor(extra = {}) {
  const visto = [];
  const engine = createAgt003CopilotEngine({
    client: { async run(args) { visto.push(args); return { content: JSON.stringify(briefSeguro), usage: { input_tokens: 10, output_tokens: 20 } }; } },
    model: 'modelo-x',
    policyVersion: 'policy-v1',
    countDailyRuns: async () => 0,
    now: () => '2030-01-01T00:00:01.000Z',
    ...extra,
  });
  return { engine, visto };
}

test('sin catálogo conectado, la petición viaja exactamente como antes', async () => {
  const { engine, visto } = motor();
  await engine.draft(PETICION);
  assert.equal(visto[0].input.fuentes_resueltas, undefined);
  assert.equal(visto[0].input, PETICION);
});

test('con catálogo, la empresa viaja resuelta sin tocar el contrato de la petición', async () => {
  const { engine, visto } = motor({ resolveSources: async () => [IDENTIDAD] });
  await engine.draft(PETICION);
  const [fuente] = visto[0].input.fuentes_resueltas;
  assert.equal(fuente.nombre, 'empresa.identidad');
  assert.equal(fuente.sostiene_afirmacion, true);
  assert.equal(fuente.responsable, 'Katherine');
  assert.match(fuente.valor, /SEGURIDAD NACIONAL LIMITADA/);
  // El contrato de la petición no cambió: sus claves siguen igual, una por una.
  for (const clave of Object.keys(PETICION)) {
    assert.deepEqual(visto[0].input[clave], PETICION[clave], clave);
  }
});

test('el resolvedor recibe la capacidad, para poder servir distinto a cada una', async () => {
  const vistos = [];
  const { engine } = motor({ resolveSources: async (contexto) => { vistos.push(contexto); return []; } });
  await engine.draft(PETICION);
  assert.equal(vistos[0].capabilityId, PETICION.capability_id);
});

test('el resolvedor recibe también la oportunidad: hay fuentes que dependen del cliente', async () => {
  const vistos = [];
  const { engine, visto } = motor({ resolveSources: async (contexto) => { vistos.push(contexto); return []; } });
  await engine.draft(PETICION);
  // El NIT del cliente no viaja en la petición —el contrato es cerrado—, así que quien atiende lo
  // resuelve por este id. Sin él, la fuente de Avancys no se podría pedir.
  assert.equal(vistos[0].opportunityId, PETICION.opportunity.opportunity_id);
  // Y el contrato sigue intacto: pasar la oportunidad al resolvedor no la agrega a la petición.
  for (const clave of Object.keys(PETICION)) {
    assert.deepEqual(visto[0].input[clave], PETICION[clave], clave);
  }
});

test('si el catálogo falla, el copiloto corre igual y sin esas fuentes', async () => {
  const { engine, visto } = motor({ resolveSources: async () => { throw new Error('caído'); } });
  const salida = await engine.draft(PETICION);
  assert.equal(salida.response.brief.human_review_required, true);
  assert.equal(visto[0].input.fuentes_resueltas, undefined);
});

test('el resolvedor debe ser una función', () => {
  assert.throws(() => motor({ resolveSources: 'no soy una función' }), /no está configurado/);
});
