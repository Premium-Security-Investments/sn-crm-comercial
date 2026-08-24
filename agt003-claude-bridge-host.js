export const AGT003_BRIDGE_HOST = 'agt003.5-78-140-24.sslip.io';
export const AGT003_BRIDGE_RUN_PATH = '/v1/agt003-copilot/run';

const DNS_HOST_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function resolveAgt003BridgeHost(environment = process.env) {
  const candidate = typeof environment?.AGT003_BRIDGE_HOST === 'string' && environment.AGT003_BRIDGE_HOST.trim()
    ? environment.AGT003_BRIDGE_HOST.trim().toLowerCase()
    : AGT003_BRIDGE_HOST;
  if (!DNS_HOST_PATTERN.test(candidate)) throw new Error('AGT003_BRIDGE_HOST debe ser un host DNS válido sin protocolo ni ruta.');
  return candidate;
}

export function agt003BridgeRunUrl(host = resolveAgt003BridgeHost()) {
  const validatedHost = resolveAgt003BridgeHost({ AGT003_BRIDGE_HOST: host });
  return `https://${validatedHost}${AGT003_BRIDGE_RUN_PATH}`;
}
