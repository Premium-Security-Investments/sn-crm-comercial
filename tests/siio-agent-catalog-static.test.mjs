import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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

// Governed identity and permissions survive the post-GO activation untouched.
assert.equal(agt002.name, 'Vig-IA Licitaciones', 'AGT-002 must keep its visible Vig-IA Licitaciones identity');
assert.equal(agt002.human_review_required, true, 'AGT-002 must keep mandatory human review');
assert.equal(agt002.can_write_production, false, 'AGT-002 must never gain autonomous production writes');
assert.ok(
  agt002.permitted_actions.includes('Preparar insumos y matriz para decisión humana GO/NO GO'),
  'AGT-002 must keep preparing inputs for the human GO/NO GO decision',
);
for (const forbidden of ['Decidir, aprobar o registrar GO/NO GO', 'Presentar ofertas', 'Firmar documentos']) {
  assert.ok(agt002.forbidden_actions.includes(forbidden), `AGT-002 must keep forbidding: ${forbidden}`);
}

// The visible channel must name the surface exactly as the workbench header does, so the
// catalog and the UI never call the same place two different things.
assert.equal(agt002.channel, 'Oportunidades / Mesa de ayuda', 'AGT-002 visible channel must name the post-GO surface as "Mesa de ayuda"');
assert.notEqual(agt002.channel, 'Oportunidades / Mesa Vig-IA Licitaciones', 'AGT-002 must not resurrect the former visible channel');
assert.doesNotMatch(agt002.channel, /Mesa Vig-IA Licitaciones/i, 'AGT-002 visible channel must not resurrect the former post-GO surface name');

// Declared state as of the activation cutoff. The pre-GO chain is genuinely productive; the
// post-GO Mesa is gated by a server-side runtime switch, so the catalog may only claim it as
// available under controlled activation. That sentence stays true on both sides of a kill
// switch flip — a "continuous production" claim would become false the moment it is turned off.
assert.equal(agt002.state_as_of, '2026-08-22', 'AGT-002 state cutoff must be the post-GO activation date');
assert.match(agt002.current_capability, /producci[oó]n|productiva/i, 'AGT-002 current capability must be stated as a production capability');
assert.match(agt002.current_capability, /an[aá]lisis can[oó]nico pre-GO/i, 'AGT-002 current capability must name the canonical pre-GO analysis');
assert.match(agt002.current_capability, /GO humano/i, 'AGT-002 current capability must name the human GO');
assert.match(agt002.current_capability, /expediente/i, 'AGT-002 current capability must name the dossier');

// The post-GO surface is named for what the user sees in the workbench header — "Mesa de
// ayuda" — not for the agent identity, which the eyebrow already carries.
for (const [field, value] of [['current_capability', agt002.current_capability], ['production_capability', agt002.production_capability]]) {
  assert.match(value, /Mesa de ayuda post-GO/i, `AGT-002 ${field} must name the post-GO surface as "Mesa de ayuda"`);
  assert.doesNotMatch(value, /Mesa Vig-IA Licitaciones/i, `AGT-002 ${field} must not resurrect the former post-GO surface name`);
  assert.match(value, /activaci[oó]n controlada/i, `AGT-002 ${field} must describe the post-GO Mesa as available under controlled activation`);
  assert.doesNotMatch(value, /post-GO continua|continua en producci[oó]n/i,
    `AGT-002 ${field} must not promise the post-GO Mesa as a continuously running production service`);
}
assert.match(agt002.production_capability, /no como servicio continuo garantizado/i,
  'AGT-002 productive capability must say outright that the post-GO Mesa is not a guaranteed continuous service');

assert.match(agt002.next_gate, /primer caso real post-GO/i, 'AGT-002 next gate must be the first real post-GO case');
assert.match(agt002.next_gate, /evaluaci[oó]n humana/i, 'AGT-002 next gate must remain a human evaluation');
assert.match(agt002.next_gate, /Juan/, 'AGT-002 next gate must name Juan as the human evaluator');
assert.doesNotMatch(agt002.next_gate, /\d/, 'AGT-002 next gate must not embed a volatile opportunity number or date');

// Only the specifically obsolete claims are banned: the undeployed-branch framing and the
// NOT READY verdict. Words like "drain" or "timer" are not forbidden — a future truthful
// statement about the drain or its timer must remain expressible.
for (const field of ['current_capability', 'next_gate', 'production_capability', 'development_status']) {
  assert.doesNotMatch(agt002[field], /not ready/i, `AGT-002 ${field} must not resurrect the NOT READY claim`);
  assert.doesNotMatch(agt002[field], /en rama|sin desplegar|no desplegad/i, `AGT-002 ${field} must not claim the capability still lives on an undeployed branch`);
}
assert.doesNotMatch(catalog, /NOT READY/i, 'the catalog source must not reintroduce the NOT READY verdict');
assert.doesNotMatch(catalog, /permanece en rama sin desplegar/i, 'the catalog source must not reintroduce the undeployed-branch claim');

// The declared source must be stable and checkable, not a branch that no longer describes the program.
assert.doesNotMatch(agt002.state_source, /feat\/agt002-v3-foundations/, 'AGT-002 state source must not point at the stale v3 foundations branch');
assert.doesNotMatch(agt002.state_source, /\bfeat\/|\bbranch\b|\brama\b/i, 'AGT-002 state source must not be a branch reference');
const agt002StateSourceDoc = agt002.state_source.match(/docs\/[^\s]+\.md/)?.[0];
assert.equal(
  agt002StateSourceDoc,
  'docs/plans/2026-07-29-agt002-vigia-analysis-improvement-program.md',
  'AGT-002 state source must cite the governed program plan',
);
assert.ok(
  existsSync(new URL(`../${agt002StateSourceDoc}`, import.meta.url)),
  `AGT-002 state source must cite a document that exists in the repo: ${agt002StateSourceDoc}`,
);
assert.match(agt002.state_source, /verificaci[oó]n productiva/i, 'AGT-002 state source must also cite the productive verification');

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
