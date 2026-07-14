import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transformSync } from 'esbuild';

const sourcePath = new URL('../src/siioAgents.ts', import.meta.url);
assert.ok(existsSync(sourcePath), 'src/siioAgents.ts must exist');
const compiled = transformSync(readFileSync(sourcePath, 'utf8'), { loader: 'ts', format: 'esm', target: 'es2020' });
const tempDir = mkdtempSync(join(tmpdir(), 'siio-agents-'));
const outPath = join(tempDir, 'siioAgents.mjs');
writeFileSync(outPath, compiled.code);
const { SIIO_AGENT_CATALOG, validateSiioAgentCatalog } = await import(`file://${outPath}`);

assert.equal(SIIO_AGENT_CATALOG.length, 4);
assert.deepEqual(SIIO_AGENT_CATALOG.map(agent => agent.id), ['AGT-001', 'AGT-002', 'AGT-003', 'AGT-004']);
assert.equal(new Set(SIIO_AGENT_CATALOG.map(agent => agent.id)).size, SIIO_AGENT_CATALOG.length);
assert.deepEqual(validateSiioAgentCatalog(SIIO_AGENT_CATALOG), []);
assert.ok(SIIO_AGENT_CATALOG.every(agent => agent.owner_role && agent.purpose && agent.authorized_sources.length));
assert.ok(SIIO_AGENT_CATALOG.every(agent => agent.permitted_actions.length && agent.forbidden_actions.length));
assert.ok(SIIO_AGENT_CATALOG.every(agent => agent.human_review_required === true));
assert.ok(SIIO_AGENT_CATALOG.every(agent => agent.can_write_production === false));
assert.ok(SIIO_AGENT_CATALOG.every(agent => agent.audit_rule));
assert.equal(SIIO_AGENT_CATALOG.find(agent => agent.id === 'AGT-001').status, 'piloto');
assert.equal(SIIO_AGENT_CATALOG.find(agent => agent.id === 'AGT-004').status, 'diseño');
const sensitiveAgent = SIIO_AGENT_CATALOG.find(agent => agent.authorized_sources.includes('SRC-012'));
assert.ok(sensitiveAgent.forbidden_actions.some(action => /nómina individual|datos personales/i.test(action)));

console.log('SIIO governed agent catalog OK');
