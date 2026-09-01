import { createAgt003CopilotBridgeClient } from './agt003-copilot-bridge-client.js';
import { AGT003_COPILOT_POLICY, createAgt003CopilotEngine } from './agt003-copilot-engine.js';

export const AGT003_COPILOT_ENGINE_ID = 'agt003_bridge_preview';
export const AGT003_COPILOT_DEFAULT_POLICY_VERSION = '2026-09-01.v2';
const DEFAULT_TIMEOUT_MS = 30_000;
// El puente sólo sostiene un turno del proveedor a la vez
// (`AGT003_BRIDGE_MAX_CONCURRENCY = 1`). Un default mayor aquí no añade
// capacidad: sólo produce turnos que el puente rechaza con
// `AGT003_BRIDGE_BUSY`. El operador puede subirlo por entorno junto al puente.
const DEFAULT_MAX_CONCURRENT = 1;
const DEFAULT_DAILY_MAX_RUNS = 20;

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function positiveInt(environment, key, fallback) {
  if (!nonEmpty(environment[key])) return fallback;
  const value = Number(environment[key]);
  return Number.isInteger(value) && value > 0 ? value : NaN;
}

function validHttps(value) {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

export function resolveAgt003BridgeConnection(environment = {}) {
  const wireProtocol = nonEmpty(environment.AGT003_COPILOT_WIRE_PROTOCOL)
    ? environment.AGT003_COPILOT_WIRE_PROTOCOL.trim()
    : 'agt003';
  const shared = wireProtocol === 'agt002';
  return {
    wireProtocol,
    model: nonEmpty(environment.AGT003_COPILOT_MODEL)
      ? environment.AGT003_COPILOT_MODEL
      : (shared ? environment.AGT002_PREVIEW_MODEL : undefined),
    bridgeUrl: nonEmpty(environment.AGT003_COPILOT_BRIDGE_URL)
      ? environment.AGT003_COPILOT_BRIDGE_URL
      : (shared ? environment.AGT002_HETZNER_BRIDGE_URL : undefined),
    hmacSecret: nonEmpty(environment.AGT003_COPILOT_HMAC_SECRET)
      ? environment.AGT003_COPILOT_HMAC_SECRET
      : (shared ? environment.AGT002_HETZNER_BRIDGE_HMAC_SECRET : undefined),
  };
}

export function isAgt003CopilotConfigured(environment = process.env) {
  const resolved = resolveAgt003BridgeConnection(environment);
  return environment?.AGT003_COPILOT_ENGINE === AGT003_COPILOT_ENGINE_ID
    && ['agt002', 'agt003'].includes(resolved.wireProtocol)
    && nonEmpty(resolved.model)
    && validHttps(resolved.bridgeUrl)
    && typeof resolved.hmacSecret === 'string'
    && Buffer.byteLength(resolved.hmacSecret) >= 32;
}

export function getAgt003CopilotRuntimeConfig(environment = process.env) {
  if (!isAgt003CopilotConfigured(environment)) throw new Error('Vig-IA no está configurado.');
  const resolved = resolveAgt003BridgeConnection(environment);
  const timeoutMs = positiveInt(environment, 'AGT003_COPILOT_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
  const maxConcurrent = positiveInt(environment, 'AGT003_COPILOT_MAX_CONCURRENT', DEFAULT_MAX_CONCURRENT);
  const dailyMaxRuns = positiveInt(environment, 'AGT003_COPILOT_DAILY_MAX_RUNS', DEFAULT_DAILY_MAX_RUNS);
  const leaseSeconds = Math.ceil(timeoutMs / 1000) + 15;
  if (!Number.isInteger(timeoutMs) || !Number.isInteger(maxConcurrent) || !Number.isInteger(dailyMaxRuns) || leaseSeconds > 600) {
    throw new Error('Vig-IA no está configurado.');
  }
  return {
    model: resolved.model.trim(),
    policyVersion: nonEmpty(environment.AGT003_COPILOT_POLICY_VERSION)
      ? environment.AGT003_COPILOT_POLICY_VERSION.trim()
      : AGT003_COPILOT_DEFAULT_POLICY_VERSION,
    timeoutMs,
    maxConcurrent,
    dailyMaxRuns,
    leaseSeconds,
    wireProtocol: resolved.wireProtocol,
  };
}

export function createAgt003CopilotRuntime({ environment = process.env, countDailyRuns } = {}) {
  const config = getAgt003CopilotRuntimeConfig(environment);
  const resolved = resolveAgt003BridgeConnection(environment);
  const client = createAgt003CopilotBridgeClient({
    url: resolved.bridgeUrl,
    hmacSecret: resolved.hmacSecret,
    wireProtocol: config.wireProtocol,
  });
  return createAgt003CopilotEngine({
    client,
    model: config.model,
    policyVersion: config.policyVersion,
    policyText: AGT003_COPILOT_POLICY,
    timeoutMs: config.timeoutMs,
    maxConcurrent: config.maxConcurrent,
    dailyMaxRuns: config.dailyMaxRuns,
    ...(countDailyRuns ? { countDailyRuns } : {}),
  });
}
