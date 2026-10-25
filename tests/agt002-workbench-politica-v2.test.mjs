import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGT002_WORKBENCH_POLICY_VERSION,
  AGT002_WORKBENCH_POLICY_VERSIONS_ACEPTADAS,
  validateAgt002WorkbenchJobInput,
} from '../verticales/licitaciones/agt002-workbench-contract.js';
import { AGT002_WORKBENCH_POLICY } from '../verticales/licitaciones/agt002-workbench-responder.js';

function trabajo(overrides = {}) {
  return {
    job_id: '40000000-0000-4000-8000-000000000001',
    thread_id: '40000000-0000-4000-8000-000000000002',
    origin_message_id: '40000000-0000-4000-8000-000000000003',
    opportunity_id: '40000000-0000-4000-8000-000000000004',
    tender_id: '40000000-0000-4000-8000-000000000005',
    snapshot_id: '40000000-0000-4000-8000-000000000006',
    base_version_id: null,
    capability_id: 'agt002.dossier-workbench.reply.v1',
    contract_version: 'agt002.dossier-workbench.v1',
    policy_version: AGT002_WORKBENCH_POLICY_VERSION,
    context_links: [{ kind: 'source', id: '40000000-0000-4000-8000-000000000009', label: 'Pliego', source_ref: 'documento:pliego#1' }],
    message: '¿Qué códigos me faltan?',
    ...overrides,
  };
}

test('la política vigente es la v2', () => {
  assert.equal(AGT002_WORKBENCH_POLICY_VERSION, 'agt002.dossier-workbench.policy.v2');
});

test('un trabajo encolado con la política anterior se sigue atendiendo', () => {
  // Es lo que evita que un despliegue bote la pregunta de alguien que ya estaba en la cola.
  const viejo = trabajo({ policy_version: 'agt002.dossier-workbench.policy.v1' });
  assert.doesNotThrow(() => validateAgt002WorkbenchJobInput(viejo));
});

test('una política desconocida sí se rechaza', () => {
  assert.throws(() => validateAgt002WorkbenchJobInput(trabajo({ policy_version: 'politica.inventada.v9' })), /policy_version/);
  assert.throws(() => validateAgt002WorkbenchJobInput(trabajo({ policy_version: 'agt002.dossier-workbench.policy.v0' })), /policy_version/);
});

test('la lista de versiones aceptadas empieza por la vigente', () => {
  assert.equal(AGT002_WORKBENCH_POLICY_VERSIONS_ACEPTADAS[0], AGT002_WORKBENCH_POLICY_VERSION);
  assert.equal(AGT002_WORKBENCH_POLICY_VERSIONS_ACEPTADAS.length, 2);
});

test('la política v2 le dice al modelo qué hacer con las fuentes resueltas', () => {
  assert.match(AGT002_WORKBENCH_POLICY, /fuentes_resueltas son datos que el servidor verificó/);
  assert.match(AGT002_WORKBENCH_POLICY, /respeta su fecha de corte \(as_of\)/);
  assert.match(AGT002_WORKBENCH_POLICY, /sostiene_afirmacion en falso/);
  assert.match(AGT002_WORKBENCH_POLICY, /declárala en missing_information/);
  assert.match(AGT002_WORKBENCH_POLICY, /nunca completes el hueco con lo que recuerdes/);
});
