import { createServer } from 'node:http';
import { agt003BridgeRunUrl, resolveAgt003BridgeHost } from '../../agt003-claude-bridge-host.js';
import {
  AGT003_BRIDGE_ALLOWED_MODELS,
  AGT003_BRIDGE_MAX_CONCURRENCY,
  AGT003_BRIDGE_MAX_TIMEOUT_MS,
  createAgt003BridgeServer,
} from '../../agt003-claude-bridge-server.js';
import { createAgt003ClaudeClient } from '../../agt003-claude-client.js';

function requireEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Falta la variable de entorno requerida: ${name}`);
  return value;
}

/** Entero positivo del entorno; un valor presente pero inválido no arranca. */
function positiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} debe ser un entero positivo.`);
  return value;
}

const hmacSecret = requireEnv('AGT003_BRIDGE_HMAC_SECRET');
const port = Number(process.env.AGT003_BRIDGE_LISTEN_PORT || 8788);
if (!Number.isInteger(port) || port <= 0) throw new Error('AGT003_BRIDGE_LISTEN_PORT no es un puerto válido.');
const bridgeHost = resolveAgt003BridgeHost(process.env);

// Los tres techos operativos se fijan en el EnvironmentFile, no en el código.
// Si falta la variable rige el valor por defecto seguro del módulo; si está
// presente y es inválida el servidor falla cerrado al construirse.
const maxConcurrency = positiveIntEnv('AGT003_BRIDGE_MAX_CONCURRENCY', AGT003_BRIDGE_MAX_CONCURRENCY);
const maxTimeoutMs = positiveIntEnv('AGT003_BRIDGE_MAX_TIMEOUT_MS', AGT003_BRIDGE_MAX_TIMEOUT_MS);
const allowedModels = typeof process.env.AGT003_BRIDGE_ALLOWED_MODELS === 'string' && process.env.AGT003_BRIDGE_ALLOWED_MODELS.trim()
  ? process.env.AGT003_BRIDGE_ALLOWED_MODELS.split(',').map(entry => entry.trim()).filter(Boolean)
  : [...AGT003_BRIDGE_ALLOWED_MODELS];

// Los techos de socket son distintos de los techos de turno: acotan lo que un
// cliente puede retener del proceso *antes* de que exista un turno, de modo que
// nadie agote los descriptores del puente abriendo conexiones ociosas. Mismo
// parser fail-closed: presente pero inválido no arranca el servicio.
const maxConnections = positiveIntEnv('AGT003_BRIDGE_MAX_CONNECTIONS', 16);
const headersTimeoutMs = positiveIntEnv('AGT003_BRIDGE_HEADERS_TIMEOUT_MS', 10_000);
const requestTimeoutMs = positiveIntEnv('AGT003_BRIDGE_REQUEST_TIMEOUT_MS', 15_000);

// El cliente no recibe ninguna credencial: el subproceso lee su propia sesión
// OAuth desde CLAUDE_CONFIG_DIR, que fija la unidad systemd.
const claudeClient = createAgt003ClaudeClient({ command: process.env.AGT003_CLAUDE_CLI_BIN || 'claude' });

// Sólo loopback: el TLS y la exposición pública los aporta Caddy.
const server = createServer(createAgt003BridgeServer({ hmacSecret, claudeClient, maxConcurrency, maxTimeoutMs, allowedModels }));
server.maxConnections = maxConnections;
server.headersTimeout = headersTimeoutMs;
server.requestTimeout = requestTimeoutMs;
server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({
    event: 'agt003_bridge_listening',
    port,
    host: bridgeHost,
    run_url: agt003BridgeRunUrl(bridgeHost),
    max_concurrency: maxConcurrency,
    max_timeout_ms: maxTimeoutMs,
    max_connections: maxConnections,
    headers_timeout_ms: headersTimeoutMs,
    request_timeout_ms: requestTimeoutMs,
  }));
});
