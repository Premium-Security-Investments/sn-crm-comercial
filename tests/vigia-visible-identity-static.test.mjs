import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const identityUrl = new URL('../src/vigia/agentIdentity.ts', import.meta.url);
const identity = existsSync(identityUrl) ? readFileSync(identityUrl, 'utf8') : '';
const catalog = readFileSync(new URL('../src/siioAgents.ts', import.meta.url), 'utf8');

for (const [key, label] of [
  ['manager', 'Vig-IA Gerencial'],
  ['tenders', 'Vig-IA Licitaciones'],
  ['commercial', 'Vig-IA Comercial'],
]) {
  assert.match(identity, new RegExp(`${key}: '${label}'`), `${key} must have its domain-qualified label`);
}
assert.match(identity, /PSI_AGENT_ROUTER_NAME = 'Agente Comercial PSI'/);
assert.match(catalog, /id: 'AGT-001'[\s\S]*?name: VIGIA_VISIBLE_NAMES\.manager/);
assert.match(catalog, /id: 'AGT-002'[\s\S]*?name: VIGIA_VISIBLE_NAMES\.tenders/);
assert.match(catalog, /id: 'AGT-003'[\s\S]*?name: VIGIA_VISIBLE_NAMES\.commercial/);
assert.doesNotMatch(catalog, /AGT-004|Agente IT/);

console.log('Vig-IA visible identity contract OK');
