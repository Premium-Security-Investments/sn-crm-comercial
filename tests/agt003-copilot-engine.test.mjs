import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { AGT003_COPILOT_POLICY, createAgt003CopilotEngine } from '../agt003-copilot-engine.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const request = JSON.parse(readFileSync(path.join(root, 'contracts/agents/AGT-003/v2-draft/fixtures/valid-opportunity-copilot-request.json'), 'utf8'));
const response = JSON.parse(readFileSync(path.join(root, 'contracts/agents/AGT-003/v2-draft/fixtures/valid-opportunity-copilot-response.json'), 'utf8'));
const brief = response.brief;

function fakeClient(content = JSON.stringify(brief), usage = { input_tokens: 10, output_tokens: 20 }) {
  return {
    calls: [],
    async run(input) {
      this.calls.push(input);
      return { content, usage, rate_limit: null };
    },
  };
}

assert.match(AGT003_COPILOT_POLICY, /no confiable/i);
assert.match(AGT003_COPILOT_POLICY, /no uses herramientas/i);
assert.match(AGT003_COPILOT_POLICY, /no envíes/i);
assert.match(AGT003_COPILOT_POLICY, /evidence_id/i);
assert.match(AGT003_COPILOT_POLICY, /asset_id/i);

// AGT-003 hotfix: la política prohíbe explícitamente las aperturas genéricas y exige que el
// borrador arranque desde el hito comercial más reciente respaldado por evidencia, con una única
// solicitud concreta de baja fricción y una razón centrada en el destinatario.
assert.match(AGT003_COPILOT_POLICY, /asunto[^.]*específic/i, 'la política exige un asunto específico de la oportunidad');
assert.match(AGT003_COPILOT_POLICY, /hito comercial más reciente/i, 'la política exige anclar la apertura en el último hito comercial respaldado por evidencia');
assert.match(AGT003_COPILOT_POLICY, /Te escribo para retomar la conversación sobre la propuesta/, 'la política nombra explícitamente la apertura genérica prohibida');
assert.match(AGT003_COPILOT_POLICY, /una solicitud concreta y de baja fricción/i, 'la política exige exactamente una solicitud concreta de baja fricción');
assert.match(AGT003_COPILOT_POLICY, /por qué responder beneficia al destinatario/i, 'la política exige justificar el beneficio para el destinatario');
assert.match(AGT003_COPILOT_POLICY, /Nunca inventes hechos, cifras, nombres/i, 'la política prohíbe inventar hechos no respaldados por evidencia');

const client = fakeClient();
const engine = createAgt003CopilotEngine({ client, model: response.model, policyVersion: response.policy_version, now: () => '2030-02-01T10:01:00.000Z', countDailyRuns: async () => 0 });
const generated = await engine.draft(request);
assert.deepEqual(generated.response, response);
assert.deepEqual(generated.usage, { provider: 'agent_bridge', model: response.model, input_tokens: 10, output_tokens: 20, rate_limit: null });
assert.equal(client.calls.length, 1);
assert.equal(client.calls[0].outputSchema.additionalProperties, false);
assert.deepEqual(client.calls[0].outputSchema.properties.facts.items.properties.evidence_refs.items.enum.sort(), ['evidence:interaction:001', 'evidence:opportunity:service', 'evidence:opportunity:stage']);
assert.deepEqual(client.calls[0].outputSchema.properties.recommended_asset_ids.items.enum, ['asset-synthetic-001']);

const collapseClient = fakeClient();
let release;
collapseClient.run = function run(input) {
  this.calls.push(input);
  return new Promise(resolve => { release = () => resolve({ content: JSON.stringify(brief), usage: { input_tokens: 1, output_tokens: 1 }, rate_limit: null }); });
};
const collapseEngine = createAgt003CopilotEngine({ client: collapseClient, model: 'm', policyVersion: 'p', now: () => response.generated_at, countDailyRuns: async () => 0 });
const first = collapseEngine.draft(request);
const second = collapseEngine.draft(request);
await new Promise(resolve => setImmediate(resolve));
assert.equal(collapseClient.calls.length, 1, 'same snapshot/policy/model collapses in flight');
release();
assert.deepEqual(await first, await second);

const quotaEngine = createAgt003CopilotEngine({ client: fakeClient(), model: 'm', policyVersion: 'p', dailyMaxRuns: 2, countDailyRuns: async () => 2 });
await assert.rejects(() => quotaEngine.draft(request), /cuota/i);

for (const [mutate, pattern] of [
  [value => ({ ...value, send_now: true }), /válida/i],
  [value => ({ ...value, facts: [{ ...value.facts[0], evidence_refs: ['invented'] }] }), /válida/i],
  [value => ({ ...value, recommended_asset_ids: ['invented'] }), /válida/i],
  [value => ({ ...value, human_review_required: false }), /válida/i],
]) {
  const badEngine = createAgt003CopilotEngine({ client: fakeClient(JSON.stringify(mutate(structuredClone(brief)))), model: 'm', policyVersion: 'p', countDailyRuns: async () => 0 });
  await assert.rejects(() => badEngine.draft(request), pattern);
}
const jsonEngine = createAgt003CopilotEngine({ client: fakeClient('not-json'), model: 'm', policyVersion: 'p', countDailyRuns: async () => 0 });
await assert.rejects(() => jsonEngine.draft(request), /válida/i);

const noAssetsRequest = structuredClone(request);
noAssetsRequest.approved_assets = [];
const noAssetsBrief = structuredClone(brief);
noAssetsBrief.recommended_asset_ids = [];
const noAssetsClient = fakeClient(JSON.stringify(noAssetsBrief));
const noAssetsEngine = createAgt003CopilotEngine({ client: noAssetsClient, model: 'm', policyVersion: 'p', now: () => response.generated_at, countDailyRuns: async () => 0 });
await noAssetsEngine.draft(noAssetsRequest);
assert.equal(noAssetsClient.calls[0].outputSchema.properties.recommended_asset_ids.maxItems, 0);

for (const [providerCode, expectedCode] of [
  ['AGT003_CLAUDE_SESSION_LIMIT', 'AGT003_CLAUDE_SESSION_LIMIT'],
  ['AGT003_CLAUDE_LOGIN_REQUIRED', 'AGT003_CLAUDE_LOGIN_REQUIRED'],
  // Rechazos del puente anteriores al proveedor: recuperables, así que su
  // código debe cruzar para que la API no los persista como run fallido.
  ['AGT003_BRIDGE_BUSY', 'AGT003_BRIDGE_BUSY'],
  ['AGT003_BRIDGE_AUTH_INVALID', 'AGT003_BRIDGE_AUTH_INVALID'],
  // El resto de códigos del puente sigue colapsando: sólo esos dos son seguros.
  ['AGT003_BRIDGE_BAD_REQUEST', undefined],
  ['AGT003_BRIDGE_INTERNAL', undefined],
  ['AGT003_BRIDGE_PAYLOAD_TOO_LARGE', undefined],
  ['REMOTE_TIMEOUT', undefined],
  ['AGT003_CLAUDE_PRIVATE_DETAIL', undefined],
]) {
  const failingClient = { async run() { const error = new Error('detalle privado'); error.code = providerCode; throw error; } };
  const failingEngine = createAgt003CopilotEngine({ client: failingClient, model: 'm', policyVersion: 'p', countDailyRuns: async () => 0 });
  await assert.rejects(() => failingEngine.draft(request), error => {
    assert.equal(error.message, 'Vig-IA no está disponible en este momento.');
    assert.equal(error.code, expectedCode, `${providerCode} debe cruzar sólo si está allowlisted`);
    assert.equal(error.message.includes('privado'), false);
    return true;
  });
}

console.log('AGT-003 copilot fail-closed engine passed');
