import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

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
