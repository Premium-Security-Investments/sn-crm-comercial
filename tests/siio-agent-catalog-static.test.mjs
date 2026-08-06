import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const catalog = readFileSync(new URL('../src/siioAgents.ts', import.meta.url), 'utf8');

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

console.log('SIIO governed agent catalog contract OK');
