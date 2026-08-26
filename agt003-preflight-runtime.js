import { createAgt003CopilotBridgeClient } from './agt003-copilot-bridge-client.js';
import { AGT003_PREFLIGHT_POLICY, createAgt003PreflightEngine } from './agt003-preflight-engine.js';
import {
  isAgt003CopilotConfigured,
  resolveAgt003BridgeConnection,
} from './agt003-copilot-runtime.js';

export const AGT003_PREFLIGHT_DEFAULT_POLICY_VERSION = 'agt003-preflight-policy-v1';
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_CONCURRENT = 1;
const DEFAULT_DAILY_MAX_RUNS = 40;

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function positiveInt(environment, key, fallback) {
  if (!nonEmpty(environment[key])) return fallback;
  const value = Number(environment[key]);
  return Number.isInteger(value) && value > 0 ? value : NaN;
}

export const isAgt003PreflightConfigured = isAgt003CopilotConfigured;

export function getAgt003PreflightRuntimeConfig(environment = process.env) {
  if (!isAgt003PreflightConfigured(environment)) throw new Error('Vig-IA no está configurado.');
  const resolved = resolveAgt003BridgeConnection(environment);
  const timeoutMs = positiveInt(environment, 'AGT003_PREFLIGHT_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
  const maxConcurrent = positiveInt(environment, 'AGT003_PREFLIGHT_MAX_CONCURRENT', DEFAULT_MAX_CONCURRENT);
  const dailyMaxRuns = positiveInt(environment, 'AGT003_PREFLIGHT_DAILY_MAX_RUNS', DEFAULT_DAILY_MAX_RUNS);
  if (!Number.isInteger(timeoutMs) || !Number.isInteger(maxConcurrent) || !Number.isInteger(dailyMaxRuns)) {
    throw new Error('Vig-IA no está configurado.');
  }
  return {
    model: resolved.model.trim(),
    policyVersion: nonEmpty(environment.AGT003_PREFLIGHT_POLICY_VERSION)
      ? environment.AGT003_PREFLIGHT_POLICY_VERSION.trim()
      : AGT003_PREFLIGHT_DEFAULT_POLICY_VERSION,
    timeoutMs,
    maxConcurrent,
    dailyMaxRuns,
    wireProtocol: resolved.wireProtocol,
  };
}

export function createAgt003PreflightRuntime({ environment = process.env } = {}) {
  const config = getAgt003PreflightRuntimeConfig(environment);
  const resolved = resolveAgt003BridgeConnection(environment);
  const client = createAgt003CopilotBridgeClient({
    url: resolved.bridgeUrl,
    hmacSecret: resolved.hmacSecret,
    wireProtocol: config.wireProtocol,
  });
  return createAgt003PreflightEngine({
    client,
    model: config.model,
    policyVersion: config.policyVersion,
    policyText: AGT003_PREFLIGHT_POLICY,
    timeoutMs: config.timeoutMs,
    maxConcurrent: config.maxConcurrent,
    dailyMaxRuns: config.dailyMaxRuns,
  });
}
