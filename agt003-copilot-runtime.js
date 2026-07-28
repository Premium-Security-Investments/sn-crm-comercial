import { createAgt003CopilotBridgeClient } from './agt003-copilot-bridge-client.js';
import { AGT003_COPILOT_POLICY, createAgt003CopilotEngine } from './agt003-copilot-engine.js';

export const AGT003_COPILOT_ENGINE_ID = 'agt003_bridge_preview';
export const AGT003_COPILOT_DEFAULT_POLICY_VERSION = 'agt003-copilot-policy-v1';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CONCURRENT = 2;
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

export function isAgt003CopilotConfigured(environment = process.env) {
  return environment?.AGT003_COPILOT_ENGINE === AGT003_COPILOT_ENGINE_ID
    && nonEmpty(environment.AGT003_COPILOT_MODEL)
    && validHttps(environment.AGT003_COPILOT_BRIDGE_URL)
    && typeof environment.AGT003_COPILOT_HMAC_SECRET === 'string'
    && Buffer.byteLength(environment.AGT003_COPILOT_HMAC_SECRET) >= 32;
}

export function getAgt003CopilotRuntimeConfig(environment = process.env) {
  if (!isAgt003CopilotConfigured(environment)) throw new Error('Vig-IA no está configurado.');
  const timeoutMs = positiveInt(environment, 'AGT003_COPILOT_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
  const maxConcurrent = positiveInt(environment, 'AGT003_COPILOT_MAX_CONCURRENT', DEFAULT_MAX_CONCURRENT);
  const dailyMaxRuns = positiveInt(environment, 'AGT003_COPILOT_DAILY_MAX_RUNS', DEFAULT_DAILY_MAX_RUNS);
  const leaseSeconds = Math.ceil(timeoutMs / 1000) + 15;
  if (!Number.isInteger(timeoutMs) || !Number.isInteger(maxConcurrent) || !Number.isInteger(dailyMaxRuns) || leaseSeconds > 600) {
    throw new Error('Vig-IA no está configurado.');
  }
  return {
    model: environment.AGT003_COPILOT_MODEL.trim(),
    policyVersion: nonEmpty(environment.AGT003_COPILOT_POLICY_VERSION)
      ? environment.AGT003_COPILOT_POLICY_VERSION.trim()
      : AGT003_COPILOT_DEFAULT_POLICY_VERSION,
    timeoutMs,
    maxConcurrent,
    dailyMaxRuns,
    leaseSeconds,
  };
}

export function createAgt003CopilotRuntime({ environment = process.env, countDailyRuns } = {}) {
  const config = getAgt003CopilotRuntimeConfig(environment);
  const client = createAgt003CopilotBridgeClient({
    url: environment.AGT003_COPILOT_BRIDGE_URL,
    hmacSecret: environment.AGT003_COPILOT_HMAC_SECRET,
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
