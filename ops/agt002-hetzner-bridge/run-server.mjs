import { createServer } from 'node:http';
import { bridgeRunUrl, resolveAgt002BridgeHost } from '../../agt002-bridge-host.js';
import { createAgt002BridgeServer } from '../../agt002-hetzner-bridge-server.js';
import { createAgt002ClaudeClient } from '../../agt002-claude-client.js';

function requireEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Falta la variable de entorno requerida: ${name}`);
  return value;
}

const hmacSecret = requireEnv('AGT002_BRIDGE_HMAC_SECRET');
const port = Number(requireEnv('AGT002_BRIDGE_LISTEN_PORT'));
const bridgeHost = resolveAgt002BridgeHost(process.env);
const command = process.env.AGT002_CLAUDE_CLI_BIN || 'claude';

// El cliente no recibe ninguna credencial: el subproceso lee su propia sesión
// OAuth desde CLAUDE_CONFIG_DIR, fijado por la unidad systemd en
// /opt/agt002-bridge/.claude. El cwd es fijo y absoluto: nunca lo decide la
// petición.
const claudeClient = createAgt002ClaudeClient({ command, cwd: '/opt/agt002-bridge' });
// La allowlist de modelos nunca se construye desde el entorno ni se inyecta aquí: el puente
// (agt002-hetzner-bridge-server.js) siempre usa el contrato frozen compartido.
const server = createServer(createAgt002BridgeServer({ hmacSecret, codexClient: claudeClient }));
server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'agt002_bridge_listening', port, host: bridgeHost, run_url: bridgeRunUrl(bridgeHost) }));
});
