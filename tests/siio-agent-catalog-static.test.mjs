import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const catalog = readFileSync(new URL('../src/siioAgents.ts', import.meta.url), 'utf8');

assert.match(catalog, /id: 'AGT-001'/, 'the governed manager must remain in the catalog');
assert.match(catalog, /id: 'AGT-002'/, 'the tender copilot must remain in the catalog');
assert.match(catalog, /id: 'AGT-003'/, 'the commercial assistant must remain in the catalog');
assert.doesNotMatch(catalog, /AGT-004/, 'Board drafting must not be a standalone agent');
assert.match(catalog, /Preparar borrador de Junta/, 'the SIIO manager must own Board draft preparation');
for (const field of ['owner_role', 'purpose', 'status', 'authorized_sources', 'permitted_actions', 'forbidden_actions', 'human_review_required', 'can_write_production', 'audit_rule', 'next_gate']) {
  assert.match(catalog, new RegExp(field), `catalog must declare ${field}`);
}

assert.match(main, /SIIO_AGENT_CATALOG/, 'F6 view must consume the governed catalog');
assert.match(main, /Propósito/, 'F6 must expose each agent purpose');
assert.match(main, /Fuentes autorizadas/, 'F6 must expose authorized sources');
assert.match(main, /Acciones permitidas/, 'F6 must expose permitted actions');
assert.match(main, /Acciones prohibidas/, 'F6 must expose forbidden actions');
assert.match(main, /Revisión humana obligatoria/, 'F6 must expose the human gate');
assert.match(main, /Regla de auditoría/, 'F6 must expose auditability');
assert.match(main, /Sin escritura automática en producción/, 'F6 must expose write restrictions');
assert.match(styles, /\.siio-agent-grid/, 'F6 grid styles must exist');
assert.match(styles, /\.siio-agent-card/, 'F6 card styles must exist');

console.log('SIIO F6 agent catalog UI contract OK');
