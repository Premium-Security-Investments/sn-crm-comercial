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

const agt001 = SIIO_AGENT_CATALOG.find(agent => agent.id === 'AGT-001');
assert.match(agt001.next_gate, /important/i, 'AGT-001 next gate must name closing the Important findings, not a stale generic gate');
assert.match(agt001.next_gate, /QA/, 'AGT-001 next gate must require repeating QA');
assert.match(agt001.next_gate, /roles/i, 'AGT-001 next gate must require QA authenticated by roles');

const agt002 = SIIO_AGENT_CATALOG.find(agent => agent.id === 'AGT-002');
assert.match(agt002.production_capability, /drain|timer/i, 'AGT-002 productive capability must disclose that drain/timer remain off');
assert.match(agt002.development_status, /v3/i, 'AGT-002 development status must name the v3 contract still outside production');
assert.doesNotMatch(agt002.production_capability, /v3/i, 'AGT-002 productive capability must never claim v3 as productive');
assert.match(agt002.development_status, /no desplegado|fuera de producci[oó]n/i, 'AGT-002 development status must explicitly disclose v3 is not in production');
assert.match(agt002.development_status, /not ready/i, 'AGT-002 development status must explicitly disclose v3 is not ready for a real canary');

assert.match(agt002.current_capability, /E5\/E6/, 'AGT-002 current capability must name the productive E5/E6 capacity, not a generic feature list');
assert.match(agt002.current_capability, /drain|timer/i, 'AGT-002 current capability must disclose that drain/timer remain off for the productive branch');
assert.doesNotMatch(agt002.current_capability, /v3/i, 'AGT-002 current capability must never claim the v3 branch as productive');
assert.match(agt002.next_gate, /v3/i, 'AGT-002 next gate must name the v3 branch gate, not just a legacy RUP closure');
assert.match(agt002.next_gate, /not ready/i, 'AGT-002 next gate must disclose the v3 canary is NOT READY');
assert.match(agt002.next_gate, /gate humano|canary/i, 'AGT-002 next gate must name the pending human gate/canary for v3');
assert.doesNotMatch(agt002.next_gate, /^Cerrar prueba RUP heredada/, 'AGT-002 next gate must not reduce to only closing the legacy RUP test');

for (const marker of ['Capacidad productiva', 'Desarrollo / no desplegado', 'Corte', 'Fuente']) {
  assert.match(agentsView, new RegExp(marker), `agents view must render ${marker}`);
}
assert.match(agentsView, /state_as_of/, 'agents view must render the cutoff field');
assert.match(agentsView, /state_source/, 'agents view must render the source field');
assert.match(agentsView, /production_capability/, 'agents view must render the productive capability field');
assert.match(agentsView, /development_status/, 'agents view must render the development status field');
assert.match(agentsView, /className="siio-eyebrow"/, 'agents view must use the locally-contrasted siio-eyebrow token');
assert.doesNotMatch(agentsView, /className="eyebrow"/, 'agents view must not render the low-contrast global eyebrow on a light SIIO surface');

const siioCss = readFileSync(new URL('../src/siio/siio.css', import.meta.url), 'utf8');

assert.match(agentsView, /className="siio-insight siio-agent-card"/, 'each agent card must carry the siio-agent-card scoping class for mobile overflow fixes');
assert.match(agentsView, /className="siio-agent-heading"/, 'the agent card header must carry the siio-agent-heading scoping class');
assert.equal((agentsView.match(/className="siio-agent-field"/g) || []).length, 17, 'every rendered agent field row must carry the siio-agent-field scoping class');

assert.match(siioCss, /\.siio-dashboard \.siio-agent-card,\s*\n\.siio-dashboard \.siio-agent-field\{\s*min-width:0;\s*max-width:100%;\s*\}/, 'agent card and field containers must be constrained to min-width:0/max-width:100% so they can shrink below their content width at narrow viewports');
assert.match(siioCss, /\.siio-dashboard \.siio-agent-field,\s*\n\.siio-dashboard \.siio-agent-field span\{\s*overflow-wrap:anywhere;\s*word-break:break-word;\s*\}/, 'agent field text must break/wrap safely instead of forcing horizontal overflow');

const mobileBlock = siioCss.match(/@media\(max-width:760px\)\{[\s\S]*?\n\}/)?.[0] || '';
assert.ok(mobileBlock, 'the <=760px media query must exist');
assert.equal((siioCss.match(/grid-template-columns:1fr;/g) || []).length, 2, 'the mobile overflow fix must not add a second grid-template-columns:1fr rule for .siio-agent-grid — the existing single-column rule already covers it');
assert.match(mobileBlock, /\.siio-dashboard \.siio-agent-heading\{\s*flex-wrap:wrap;\s*\}/, 'the agent heading must wrap safely at <=760px instead of overflowing so the status badge is never clipped');
assert.match(mobileBlock, /\.siio-dashboard \.siio-agent-heading > div\{\s*min-width:0;\s*\}/, 'the agent heading title block must be allowed to shrink at <=760px so it does not push the status badge off-card');
assert.match(mobileBlock, /\.siio-dashboard \.siio-agent-heading \.badge\{\s*white-space:normal;\s*max-width:100%;\s*\}/, 'the status badge must wrap instead of clipping at <=760px');

assert.doesNotMatch(mobileBlock, /font-size/, 'the mobile overflow fix must not shrink agent catalog typography to solve overflow');

console.log('SIIO governed agent catalog contract OK');
