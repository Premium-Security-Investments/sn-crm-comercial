import { createAgt002HetznerBridgeClient } from './agt002-hetzner-bridge-client.js';
import { AGT002_PREVIEW_POLICY, createAgt002PreviewEngine } from './agt002-preview-engine.js';

export const AGT002_PREVIEW_ENGINE_ID = 'agt002_codex_preview';
const REQUIRED_ENV_KEYS = ['AGT002_PREVIEW_MODEL', 'AGT002_HETZNER_BRIDGE_URL', 'AGT002_HETZNER_BRIDGE_HMAC_SECRET'];
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_DAILY_MAX_RUNS = 20;
export const AGT002_PREVIEW_DEFAULT_POLICY_VERSION = 'agt002-preview-policy-v1';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Checked before anything else: no client is ever constructed unless every required variable is present. */
export function isAgt002PreviewConfigured(environment = process.env) {
  return environment?.TENDER_ANALYSIS_ENGINE === AGT002_PREVIEW_ENGINE_ID
    && REQUIRED_ENV_KEYS.every(key => nonEmpty(environment[key]));
}

/** Single validated source for both the DB reservation and local runtime limits. */
export function getAgt002PreviewRuntimeConfig(environment = process.env) {
  if (!isAgt002PreviewConfigured(environment)) throw new Error('AGT-002 Preview no está configurado.');
  const timeoutMs = positiveIntFromEnv(environment, 'AGT002_PREVIEW_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
  const maxConcurrent = positiveIntFromEnv(environment, 'AGT002_PREVIEW_MAX_CONCURRENT', DEFAULT_MAX_CONCURRENT);
  const dailyMaxRuns = positiveIntFromEnv(environment, 'AGT002_PREVIEW_DAILY_MAX_RUNS', DEFAULT_DAILY_MAX_RUNS);
  const leaseSeconds = Math.ceil(timeoutMs / 1000) + 15;
  if (!Number.isInteger(timeoutMs) || !Number.isInteger(maxConcurrent) || !Number.isInteger(dailyMaxRuns) || leaseSeconds > 600) {
    throw new Error('AGT-002 Preview no está configurado.');
  }
  return {
    model: environment.AGT002_PREVIEW_MODEL.trim(),
    policyVersion: nonEmpty(environment.AGT002_PREVIEW_POLICY_VERSION) ? environment.AGT002_PREVIEW_POLICY_VERSION.trim() : AGT002_PREVIEW_DEFAULT_POLICY_VERSION,
    timeoutMs,
    maxConcurrent,
    dailyMaxRuns,
    leaseSeconds,
  };
}

function positiveIntFromEnv(environment, key, fallback) {
  if (!nonEmpty(environment[key])) return fallback;
  const parsed = Number(environment[key]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : NaN;
}

/**
 * Builds the AGT-002 Preview engine from server-side configuration only.
 * Fails closed (throws) when unconfigured or malformed — callers must catch
 * and keep the deterministic rules-based analysis available.
 */
export function createAgt002PreviewRuntime({ environment = process.env, countDailyRuns } = {}) {
  const config = getAgt002PreviewRuntimeConfig(environment);

  const client = createAgt002HetznerBridgeClient({
    url: environment.AGT002_HETZNER_BRIDGE_URL,
    hmacSecret: environment.AGT002_HETZNER_BRIDGE_HMAC_SECRET,
  });

  return createAgt002PreviewEngine({
    client,
    model: config.model,
    policyVersion: config.policyVersion,
    policyText: AGT002_PREVIEW_POLICY,
    timeoutMs: config.timeoutMs,
    maxConcurrent: config.maxConcurrent,
    dailyMaxRuns: config.dailyMaxRuns,
    ...(countDailyRuns ? { countDailyRuns } : {}),
  });
}
