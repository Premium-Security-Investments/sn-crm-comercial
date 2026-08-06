import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSync } from 'esbuild';

const sourcePath = new URL('../src/siioAgents.ts', import.meta.url);
assert.ok(existsSync(sourcePath), 'src/siioAgents.ts must exist');
const tempDir = mkdtempSync(join(tmpdir(), 'siio-agents-'));
const outPath = join(tempDir, 'siioAgents.mjs');
buildSync({
  entryPoints: [sourcePath.pathname],
  bundle: true,
  format: 'esm',
  outfile: outPath,
  platform: 'node',
  target: 'es2020',
});
const { SIIO_AGENT_CATALOG, validateSiioAgentCatalog } = await import(`file://${outPath}`);

assert.equal(SIIO_AGENT_CATALOG.length, 3);
assert.deepEqual(SIIO_AGENT_CATALOG.map(agent => agent.id), ['AGT-001', 'AGT-002', 'AGT-003']);
assert.equal(SIIO_AGENT_CATALOG.some(agent => agent.id === 'AGT-004'), false);
assert.equal(new Set(SIIO_AGENT_CATALOG.map(agent => agent.id)).size, SIIO_AGENT_CATALOG.length);
assert.deepEqual(
  SIIO_AGENT_CATALOG.map(agent => agent.name),
  ['Vig-IA Gerencial', 'Vig-IA Licitaciones', 'Vig-IA Comercial'],
);
assert.equal(SIIO_AGENT_CATALOG.some(agent => /Agente IT/i.test(agent.name)), false);
const tenders = SIIO_AGENT_CATALOG.find(agent => agent.id === 'AGT-002');
assert.match(tenders.purpose, /convertida manualmente desde el Radar/);
assert.ok(tenders.permitted_actions.some(action => /decisión humana GO\/NO GO/.test(action)));
assert.ok(tenders.forbidden_actions.some(action => /Convertir procesos del Radar/.test(action)));
assert.deepEqual(validateSiioAgentCatalog(SIIO_AGENT_CATALOG), []);
assert.ok(SIIO_AGENT_CATALOG.every(agent => agent.owner_role && agent.purpose && agent.authorized_sources.length));
assert.ok(SIIO_AGENT_CATALOG.every(agent => agent.permitted_actions.length && agent.forbidden_actions.length));
assert.ok(SIIO_AGENT_CATALOG.every(agent => agent.human_review_required === true));
assert.ok(SIIO_AGENT_CATALOG.every(agent => agent.can_write_production === false));
assert.ok(SIIO_AGENT_CATALOG.every(agent => agent.audit_rule));
const manager = SIIO_AGENT_CATALOG.find(agent => agent.id === 'AGT-001');
assert.equal(manager.status, 'piloto');
assert.ok(manager.permitted_actions.includes('Preparar borrador de Junta'));
assert.ok(manager.forbidden_actions.includes('Publicar informes'));
assert.ok(manager.forbidden_actions.includes('Aprobar cifras financieras'));
assert.ok(manager.forbidden_actions.includes('Ocultar alertas o restricciones'));
assert.ok(manager.forbidden_actions.includes('Ejecutar decisiones gerenciales'));
const sensitiveAgent = SIIO_AGENT_CATALOG.find(agent => agent.authorized_sources.includes('SRC-012'));
assert.ok(sensitiveAgent.forbidden_actions.some(action => /nómina individual|datos personales/i.test(action)));

console.log('SIIO governed agent catalog OK');
