import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { SURFACE_NAMES } from '../agt002-control-plane-identity.js';
import { AGT002_HOST_SURFACE_UNITS } from '../agt002-host-surface-observer.js';
import { observeAgt002Surfaces } from '../agt002-control-plane-observe.js';

function readArgValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function surfaceEnvPrefix(surface) {
  return `AGT002_OBSERVE_${surface.toUpperCase()}`;
}

// Explicit env-injected observation for one surface: AGT002_OBSERVE_<SURFACE>_SHA/_VERSION/
// _SOURCE. Returns null (never invents a source) when neither a sha nor a version was
// explicitly configured. A version alone (no sha) is still preserved here -- e.g. the
// origin_main flow where AGT002_OBSERVE_ORIGIN_MAIN_VERSION is set but the sha arrives later
// via the explicit --git-sha path -- but it stays fail-closed: buildAgt002ControlPlaneIdentity
// nulls out any version whose sha never materializes, so a version alone can never make a
// surface count as observed.
function explicitEnvObservation(surface, env) {
  const prefix = surfaceEnvPrefix(surface);
  const sha = nonEmptyString(env[`${prefix}_SHA`]);
  const version = nonEmptyString(env[`${prefix}_VERSION`]);
  if (!sha && !version) return null;
  return {
    sha,
    version,
    source: sha ? nonEmptyString(env[`${prefix}_SOURCE`]) ?? `${surface}_explicit_env` : null,
    ...(sha ? { observation_status: 'observed' } : {}),
  };
}

// Optional URL-based observation for one surface: AGT002_OBSERVE_<SURFACE>_URL, fetched with the
// injected fetchImpl (never the real network in tests) and expected to return JSON shaped like
// {surface, sha, version, source} -- exactly what the bridge/vercel control-plane GET routes
// already return (buildAgt002ControlPlaneIdentity always stamps its own `surface`). The response's
// `surface` must exactly equal the surface this URL was configured for: a misconfigured/proxied
// URL must never let one surface's response be relabeled and trusted as a different surface's
// observation. Nothing here throws, so one unreachable surface can't take down collection of the
// others -- but every way of NOT observing a surface is recorded in `observation_status` (never as
// a sha), so the drift check can tell "unreachable" (a failure) from "route not deployed yet":
//   not_configured        no URL to fetch
//   fetch_failed          network error / invalid JSON
//   route_unknown         HTTP 404 (e.g. a bridge older than the host-surface allowlist)
//   http_error            any other non-2xx (e.g. 503 observer unavailable), with http_status
//   surface_mismatch      the response is for another surface (or has none)
//   unit_unavailable      the bridge could not read the systemd unit (unit_status.available false)
//   identity_underivable  reachable, but no trusted sha (e.g. the unit no longer runs a release)
//   observed              trusted sha present
//
// Host surfaces (the systemd jobs the bridge observes for us) need no URL of their own: unless an
// explicit AGT002_OBSERVE_<SURFACE>_URL overrides it, their URL is the bridge control-plane URL
// plus `/<surface>`, which is exactly the bridge's read-only host-surface route.
function surfaceObservationUrl(surface, env) {
  const explicit = nonEmptyString(env[`${surfaceEnvPrefix(surface)}_URL`]);
  if (explicit || !Object.prototype.hasOwnProperty.call(AGT002_HOST_SURFACE_UNITS, surface)) return explicit;
  const bridgeUrl = nonEmptyString(env[`${surfaceEnvPrefix('bridge')}_URL`]);
  return bridgeUrl ? `${bridgeUrl.replace(/\/+$/, '')}/${surface}` : null;
}

function unitStatusOf(body) {
  const status = body?.unit_status;
  return status && typeof status === 'object' ? { available: status.available === true } : undefined;
}

async function fetchedSurfaceObservation(surface, env, fetchImpl) {
  const url = surfaceObservationUrl(surface, env);
  if (!url || typeof fetchImpl !== 'function') return { observation_status: 'not_configured' };
  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      if (response.status === 404) return { observation_status: 'route_unknown', http_status: 404 };
      return { observation_status: 'http_error', http_status: Number.isInteger(response.status) ? response.status : null };
    }
    const body = await response.json();
    if (nonEmptyString(body?.surface) !== surface) return { observation_status: 'surface_mismatch' };
    const unitStatus = unitStatusOf(body);
    const sha = nonEmptyString(body?.sha);
    if (!sha) {
      return {
        observation_status: unitStatus?.available === false ? 'unit_unavailable' : 'identity_underivable',
        ...(unitStatus ? { unit_status: unitStatus } : {}),
      };
    }
    return {
      sha,
      version: nonEmptyString(body?.version),
      source: nonEmptyString(body?.source) ?? `${surface}_url_fetch`,
      observation_status: 'observed',
      ...(unitStatus ? { unit_status: unitStatus } : {}),
    };
  } catch {
    return { observation_status: 'fetch_failed' };
  }
}

// Reusable collector: gathers an observation for every watched surface from explicit env inputs
// first, falling back to the surface's URL fetch. No sha is ever invented -- a surface that could
// not be observed carries only its observation_status.
export async function collectAgt002SurfaceObservations({ env = {}, fetchImpl = undefined } = {}) {
  const observations = {};
  for (const surface of SURFACE_NAMES) {
    observations[surface] = explicitEnvObservation(surface, env) ?? (await fetchedSurfaceObservation(surface, env, fetchImpl));
  }
  return observations;
}

export async function buildAgt002ObserveSurfacesResult({
  inputPath,
  inputJson,
  desiredSha,
  desiredVersion,
  gitSha,
  env = {},
  fetchImpl = undefined,
  readFile = readFileSync,
} = {}) {
  const fileObservations = inputJson
    ? JSON.parse(inputJson)?.surfaces ?? {}
    : inputPath
      ? JSON.parse(readFile(inputPath, 'utf8'))?.surfaces ?? {}
      : {};

  const collected = await collectAgt002SurfaceObservations({ env, fetchImpl });

  const observations = {};
  for (const surface of SURFACE_NAMES) {
    const fromFile = fileObservations[surface];
    observations[surface] = fromFile && (fromFile.sha || fromFile.version) ? fromFile : collected[surface];
  }

  if (gitSha) {
    observations.origin_main = {
      sha: gitSha,
      version: observations.origin_main?.version ?? null,
      source: 'github_sha',
      observation_status: 'observed',
    };
  }

  return observeAgt002Surfaces({
    desiredSha: desiredSha || null,
    desiredVersion: desiredVersion || null,
    observations,
  });
}

const isCliEntrypoint = import.meta.url === `file://${process.argv[1]}`;
if (isCliEntrypoint) {
  const args = process.argv.slice(2);
  const rawInputPath = readArgValue(args, '--input');
  const inputPath = rawInputPath && existsSync(rawInputPath) ? rawInputPath : undefined;
  const inputJson = readArgValue(args, '--input-json');
  const outPath = readArgValue(args, '--out');
  const desiredSha = readArgValue(args, '--desired-sha');
  const desiredVersion = readArgValue(args, '--desired-version');
  // Precedence: an explicit --git-sha wins outright; otherwise fall back to the desired-target
  // sha (base sha on a PR, current sha otherwise) so origin_main is always bound to the same
  // target drift is checked against; only with neither flag supplied does GITHUB_SHA (the
  // synthetic PR merge sha, when this runs unflagged) apply, as a last-resort local-run fallback.
  const gitSha = readArgValue(args, '--git-sha') || desiredSha || process.env.GITHUB_SHA;

  const result = await buildAgt002ObserveSurfacesResult({
    inputPath,
    inputJson,
    desiredSha,
    desiredVersion,
    gitSha,
    env: process.env,
    fetchImpl: typeof fetch === 'function' ? fetch : undefined,
  });
  const json = JSON.stringify(result, null, 2);

  if (outPath) {
    writeFileSync(outPath, `${json}\n`, 'utf8');
  } else {
    console.log(json);
  }
}
