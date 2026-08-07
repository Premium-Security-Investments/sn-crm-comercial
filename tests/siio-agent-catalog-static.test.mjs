import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

async function loadModule(relativePath) {
  const result = await build({
    entryPoints: [new URL(relativePath, import.meta.url).pathname],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const catalog = readFileSync(new URL('../src/siioAgents.ts', import.meta.url), 'utf8');
const agentsView = readFileSync(new URL('../src/siio/SiioAgentsView.tsx', import.meta.url), 'utf8');
const { SIIO_AGENT_CATALOG } = await loadModule('../src/siioAgents.ts');

assert.match(catalog, /id: 'AGT-001'/, 'the governed manager must remain in the catalog');
assert.match(catalog, /id: 'AGT-002'/, 'the tender copilot must remain in the catalog');
assert.match(catalog, /id: 'AGT-003'/, 'the commercial assistant must remain in the catalog');
assert.match(catalog, /name: VIGIA_VISIBLE_NAMES\.manager/);
assert.match(catalog, /name: VIGIA_VISIBLE_NAMES\.tenders/);
assert.match(catalog, /name: VIGIA_VISIBLE_NAMES\.commercial/);
assert.match(catalog, /convertida manualmente desde el Radar/);
assert.match(catalog, /decisión humana GO\/NO GO/);
assert.doesNotMatch(catalog, /Priorizar procesos públicos|Preparar matriz GO\/NO GO'/);
assert.doesNotMatch(catalog, /Agente IT/);
assert.doesNotMatch(catalog, /AGT-004/, 'Board drafting must not be a standalone agent');
assert.match(catalog, /Preparar borrador de Junta/, 'the SIIO manager must own Board draft preparation');
assert.match(catalog, /SIIO_AGENT_CATALOG: SiioInstitutionalAgent\[\]/, 'the catalog must remain typed');
assert.match(catalog, /id: 'AGT-001'[\s\S]*?id: 'AGT-002'[\s\S]*?id: 'AGT-003'/, 'the catalog must preserve the three governed agents in order');
for (const field of ['owner_role', 'purpose', 'status', 'authorized_sources', 'permitted_actions', 'forbidden_actions', 'human_review_required', 'can_write_production', 'audit_rule', 'next_gate']) {
  assert.match(catalog, new RegExp(field), `catalog must declare ${field}`);
}

for (const field of ['state_as_of', 'state_source', 'production_capability', 'development_status']) {
  assert.match(catalog, new RegExp(field), `catalog must declare ${field}`);
}
for (const agent of SIIO_AGENT_CATALOG) {
  assert.ok(agent.state_as_of, `${agent.id}: missing state_as_of cutoff`);
  assert.ok(agent.state_source, `${agent.id}: missing state_source`);
  assert.ok(agent.production_capability, `${agent.id}: missing production_capability`);
  assert.ok(agent.development_status, `${agent.id}: missing development_status`);
}

const agt002 = SIIO_AGENT_CATALOG.find(agent => agent.id === 'AGT-002');
assert.match(agt002.production_capability, /drain|timer/i, 'AGT-002 productive capability must disclose that drain/timer remain off');
assert.match(agt002.development_status, /v3/i, 'AGT-002 development status must name the v3 contract still outside production');
assert.doesNotMatch(agt002.production_capability, /v3/i, 'AGT-002 productive capability must never claim v3 as productive');
assert.match(agt002.development_status, /no desplegado|fuera de producci[oó]n/i, 'AGT-002 development status must explicitly disclose v3 is not in production');
assert.match(agt002.development_status, /not ready/i, 'AGT-002 development status must explicitly disclose v3 is not ready for a real canary');

for (const marker of ['Capacidad productiva', 'Desarrollo / no desplegado', 'Corte', 'Fuente']) {
  assert.match(agentsView, new RegExp(marker), `agents view must render ${marker}`);
}
assert.match(agentsView, /state_as_of/, 'agents view must render the cutoff field');
assert.match(agentsView, /state_source/, 'agents view must render the source field');
assert.match(agentsView, /production_capability/, 'agents view must render the productive capability field');
assert.match(agentsView, /development_status/, 'agents view must render the development status field');

console.log('SIIO governed agent catalog contract OK');
