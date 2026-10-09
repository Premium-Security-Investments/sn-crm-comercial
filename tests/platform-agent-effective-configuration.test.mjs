// Lector de la configuración vigente (puerta única de modelos, Paso 2 parte 3): caché ~60 s, falla abierta con la
// última conocida o los valores del código, versión inválida ignorada con aviso.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultAgentConfiguration } from '../platform-agent-configuration.js';
import {
  CURRENT_AGENT_CONFIGURATION_SQL,
  createEffectiveConfigurationReader,
  normalizeApprovedConfiguration,
} from '../platform-agent-effective-configuration.js';

const COPILOT = 'agt003.opportunity-copilot.preview';
const ANA = '33333333-3333-4333-8333-333333333333';

function approved(maxPerDay = 40) {
  const configuration = defaultAgentConfiguration('AGT-003');
  configuration.capabilities[COPILOT].team_cap = { per: 'day', max: maxPerDay };
  configuration.capabilities[COPILOT].profile_caps = { comercial: { per: 'day', max: 5 } };
  configuration.capabilities[COPILOT].exceptions = [{ person: ANA, extra: 2, per: 'day', expires: '2020-01-01' }];
  return configuration;
}

function harness(script) {
  let clock = 1_000;
  const calls = [];
  const warnings = [];
  const reader = createEffectiveConfigurationReader({
    now: () => clock,
    timeoutMs: 50,
    readRow: async args => { calls.push(args); return script(calls.length); },
  });
  return {
    reader, calls, warnings,
    advance(ms) { clock += ms; },
    async get() {
      const warn = console.warn;
      console.warn = (...args) => { warnings.push(args); };
      try { return await reader.get('AGT-003', { env: {}, environment: 'production' }); } finally { console.warn = warn; }
    },
  };
}

test('consulta sólo la vista de la configuración vigente, por agente y ambiente', () => {
  assert.match(CURRENT_AGENT_CONFIGURATION_SQL, /from platform\.current_agent_configuration/);
  assert.match(CURRENT_AGENT_CONFIGURATION_SQL, /where agent_id = \$1 and environment = \$2/);
  assert.doesNotMatch(CURRENT_AGENT_CONFIGURATION_SQL, /insert|update|delete/i);
});

test('versión aprobada: se valida (una excepción vencida no la invalida) y se guarda en caché ~60 s', async () => {
  const h = harness(() => ({ configuration_version_id: '7', version_number: 3, configuration: approved(40) }));
  const first = await h.get();
  assert.equal(first.source, 'platform');
  assert.equal(first.version_number, 3);
  assert.equal(first.configuration.capabilities[COPILOT].team_cap.max, 40);
  assert.deepEqual(h.calls[0], { agentId: 'AGT-003', environment: 'production', env: {} });
  h.advance(59_000);
  await h.get();
  assert.equal(h.calls.length, 1, 'dentro de 60 s no vuelve a leer');
  h.advance(2_000);
  await h.get();
  assert.equal(h.calls.length, 2, 'pasados 60 s vuelve a leer');
});

test('lecturas simultáneas comparten una sola consulta', async () => {
  const h = harness(() => ({ configuration_version_id: '7', version_number: 3, configuration: approved() }));
  const [a, b] = await Promise.all([h.get(), h.get()]);
  assert.equal(h.calls.length, 1);
  assert.equal(a, b);
});

test('falla abierta: nunca la tuvo → valores del código; la tuvo → última conocida', async () => {
  const h = harness(n => { if (n === 1 || n === 3) throw Object.assign(new Error('down'), { code: 'PLATFORM_AGENTS_UNAVAILABLE' }); return { configuration_version_id: '7', version_number: 3, configuration: approved(40) }; });
  const never = await h.get();
  assert.equal(never.source, 'code');
  assert.equal(never.stale, true);
  assert.equal(never.configuration.capabilities[COPILOT].team_cap.max, 20, 'valores del código: 20/día');
  assert.equal(never.configuration.capabilities['agt003.lead-deep-analysis'].team_cap.max, 30, 'valores del código: 30/mes');
  assert.equal(h.warnings[0][0], 'platform_effective_configuration_fallback');
  h.advance(61_000);
  assert.equal((await h.get()).source, 'platform');
  h.advance(61_000);
  const lastKnown = await h.get();
  assert.equal(lastKnown.source, 'platform');
  assert.equal(lastKnown.stale, true);
  assert.equal(lastKnown.configuration.capabilities[COPILOT].team_cap.max, 40);
});

test('plataforma lenta (más que el tiempo límite) → falla abierta sin esperar', async () => {
  const h = harness(() => new Promise(() => {}));
  const started = Date.now();
  const value = await h.get();
  assert.ok(Date.now() - started < 1_000);
  assert.equal(value.source, 'code');
});

test('versión inválida → se ignora con aviso y se usan los valores previos', async () => {
  const h = harness(n => (n === 1
    ? { configuration_version_id: '7', version_number: 3, configuration: approved(40) }
    : { configuration_version_id: '8', version_number: 4, configuration: { timezone: 'America/Bogota', capabilities: { [COPILOT]: { enabled: true, model: 'gpt', team_cap: { per: 'day', max: 99999 } } } } }));
  await h.get();
  h.advance(61_000);
  const value = await h.get();
  assert.equal(value.version_number, 3, 'sigue la versión anterior');
  assert.equal(value.configuration.capabilities[COPILOT].team_cap.max, 40);
  assert.deepEqual(h.warnings.at(-1), ['platform_effective_configuration_fallback', { agent_id: 'AGT-003', reason: 'invalid', version_id: '8' }]);
  assert.throws(() => normalizeApprovedConfiguration('{"timezone":"UTC","capabilities":{}}', 'AGT-003'));
});

test('sin versión vigente → valores del código (y se olvida la última conocida)', async () => {
  const h = harness(n => (n === 1 ? { configuration_version_id: '7', version_number: 3, configuration: approved(40) } : null));
  await h.get();
  h.advance(61_000);
  const value = await h.get();
  assert.equal(value.source, 'code');
  assert.equal(value.stale, false);
  assert.equal(value.configuration.capabilities[COPILOT].team_cap.max, 20);
});

test('agente sin funciones con IA → null', async () => {
  const reader = createEffectiveConfigurationReader({ readRow: async () => { throw new Error('no debe leer'); } });
  assert.equal(await reader.get('AGT-002', { env: {} }), null);
});
