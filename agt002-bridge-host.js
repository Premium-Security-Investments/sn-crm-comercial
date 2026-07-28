export const AGT002_BRIDGE_HOST = 'agt002.5-78-140-24.sslip.io';

const DNS_HOST_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function resolveAgt002BridgeHost(environment = process.env) {
  const candidate = typeof environment?.AGT002_BRIDGE_HOST === 'string' && environment.AGT002_BRIDGE_HOST.trim()
    ? environment.AGT002_BRIDGE_HOST.trim().toLowerCase()
    : AGT002_BRIDGE_HOST;
  if (!DNS_HOST_PATTERN.test(candidate)) throw new Error('AGT002_BRIDGE_HOST debe ser un host DNS válido sin protocolo ni ruta.');
  return candidate;
}

export function bridgeRunUrl(host = resolveAgt002BridgeHost()) {
  const validatedHost = resolveAgt002BridgeHost({ AGT002_BRIDGE_HOST: host });
  return `https://${validatedHost}/v1/agt002-preview/run`;
}
