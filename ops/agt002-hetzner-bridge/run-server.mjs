import { createServer } from 'node:http';
import { createAgt002BridgeServer } from '../../agt002-hetzner-bridge-server.js';
import { createCodexAppServerClient } from '../../agt002-preview-codex-client.js';

function requireEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Falta la variable de entorno requerida: ${name}`);
  return value;
}

const hmacSecret = requireEnv('AGT002_BRIDGE_HMAC_SECRET');
const port = Number(requireEnv('AGT002_BRIDGE_LISTEN_PORT'));
const command = process.env.AGT002_CODEX_APP_SERVER_BIN || 'codex';
const args = process.env.AGT002_CODEX_APP_SERVER_ARGS ? JSON.parse(process.env.AGT002_CODEX_APP_SERVER_ARGS) : ['app-server'];

const codexClient = createCodexAppServerClient({ command, args });
const server = createServer(createAgt002BridgeServer({ hmacSecret, codexClient }));
server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'agt002_bridge_listening', port }));
});
