import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AGT002_BRIDGE_HOST,
  AGT002_BRIDGE_LISTEN_HOST_DEFAULT,
  bridgeRunUrl,
  resolveAgt002BridgeHost,
  resolveAgt002BridgeListenHost,
} from '../agt002-bridge-host.js';

assert.equal(AGT002_BRIDGE_HOST, 'agt002.5-78-140-24.sslip.io');
assert.equal(bridgeRunUrl(AGT002_BRIDGE_HOST), 'https://agt002.5-78-140-24.sslip.io/v1/agt002-preview/run');
assert.equal(resolveAgt002BridgeHost({}), AGT002_BRIDGE_HOST);
assert.equal(resolveAgt002BridgeHost({ AGT002_BRIDGE_HOST: 'agt002.5.78.140.24.sslip.io' }), 'agt002.5.78.140.24.sslip.io');
assert.throws(() => resolveAgt002BridgeHost({ AGT002_BRIDGE_HOST: 'https://bad.example/path' }), /host/i);

// AGT002_BRIDGE_LISTEN_HOST: interfaz de escucha del proceso, distinta del host público resuelto arriba.
assert.equal(AGT002_BRIDGE_LISTEN_HOST_DEFAULT, '127.0.0.1');
assert.equal(resolveAgt002BridgeListenHost({}), '127.0.0.1');
assert.equal(resolveAgt002BridgeListenHost({ AGT002_BRIDGE_LISTEN_HOST: '127.0.0.1' }), '127.0.0.1');
assert.equal(resolveAgt002BridgeListenHost({ AGT002_BRIDGE_LISTEN_HOST: '0.0.0.0' }), '0.0.0.0');
assert.throws(() => resolveAgt002BridgeListenHost({ AGT002_BRIDGE_LISTEN_HOST: ' 0.0.0.0' }), /AGT002_BRIDGE_LISTEN_HOST/);
assert.throws(() => resolveAgt002BridgeListenHost({ AGT002_BRIDGE_LISTEN_HOST: '0.0.0.0 ' }), /AGT002_BRIDGE_LISTEN_HOST/);
assert.throws(() => resolveAgt002BridgeListenHost({ AGT002_BRIDGE_LISTEN_HOST: 'localhost' }), /AGT002_BRIDGE_LISTEN_HOST/);
assert.throws(() => resolveAgt002BridgeListenHost({ AGT002_BRIDGE_LISTEN_HOST: '::1' }), /AGT002_BRIDGE_LISTEN_HOST/);
assert.throws(() => resolveAgt002BridgeListenHost({ AGT002_BRIDGE_LISTEN_HOST: '' }), /AGT002_BRIDGE_LISTEN_HOST/);

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
assert.match(runner, /resolveAgt002BridgeListenHost\(process\.env\)/, 'El runner debe resolver la interfaz de escucha validada');
assert.match(runner, /server\.listen\(port,\s*listenHost/, 'El runner debe escuchar en la interfaz resuelta, no en un literal fijo');
assert.match(runner, /listen_host:\s*listenHost/, 'El evento de arranque debe registrar listen_host separado del host público');

console.log('agt002 bridge host declarative contract passed');
