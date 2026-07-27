import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AGT002_BRIDGE_HOST, bridgeRunUrl, resolveAgt002BridgeHost } from '../agt002-bridge-host.js';

assert.equal(AGT002_BRIDGE_HOST, 'agt002.5-78-140-24.sslip.io');
assert.equal(bridgeRunUrl(AGT002_BRIDGE_HOST), 'https://agt002.5-78-140-24.sslip.io/v1/agt002-preview/run');
assert.equal(resolveAgt002BridgeHost({}), AGT002_BRIDGE_HOST);
assert.equal(resolveAgt002BridgeHost({ AGT002_BRIDGE_HOST: 'agt002.5.78.140.24.sslip.io' }), 'agt002.5.78.140.24.sslip.io');
assert.throws(() => resolveAgt002BridgeHost({ AGT002_BRIDGE_HOST: 'https://bad.example/path' }), /host/i);

const caddy = readFileSync(new URL('../ops/agt002-hetzner-bridge/Caddyfile', import.meta.url), 'utf8');
const configuredHost = caddy.split('\n').map(line => line.trim()).find(line => line && !line.startsWith('#'))?.replace(/\s*\{$/, '');
assert.equal(configuredHost, AGT002_BRIDGE_HOST, 'El Caddyfile versionado debe usar el host default canónico');
assert.match(caddy, /agt002\.5\.78\.140\.24\.sslip\.io/);
assert.match(caddy, /AGT002_BRIDGE_HOST/);
assert.match(caddy, /no aplicado/i);

const client = readFileSync(new URL('../agt002-hetzner-bridge-client.js', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../ops/agt002-hetzner-bridge/run-server.mjs', import.meta.url), 'utf8');
assert.match(client, /bridgeRunUrl\(resolveAgt002BridgeHost\(\)\)/, 'El default del cliente debe derivarse del host único');
assert.match(runner, /resolveAgt002BridgeHost\(process\.env\)/, 'El runner debe resolver el mismo host/override');
assert.match(runner, /bridgeRunUrl\(bridgeHost\)/, 'El runner debe publicar la URL derivada en su evento local');

console.log('agt002 bridge host declarative contract passed');
