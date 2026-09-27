import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { SURFACE_NAMES } from '../agt002-control-plane-identity.js';
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
  };
}

// Optional URL-based observation for one surface: AGT002_OBSERVE_<SURFACE>_URL, fetched with the
// injected fetchImpl (never the real network in tests) and expected to return JSON shaped like
// {sha, version, source} -- exactly what the bridge/vercel control-plane GET routes already
// return. A missing URL, a non-2xx response, or a fetch failure all collapse to null (honestly
// unobserved) rather than throwing, so one unreachable surface can't take down collection of the
// other five.
async function fetchedSurfaceObservation(surface, env, fetchImpl) {
  const url = nonEmptyString(env[`${surfaceEnvPrefix(surface)}_URL`]);
  if (!url || typeof fetchImpl !== 'function') return null;
  try {
    const response = await fetchImpl(url);
    if (!response.ok) return null;
    const body = await response.json();
    return {
      sha: nonEmptyString(body?.sha),
      version: nonEmptyString(body?.version),
      source: nonEmptyString(body?.source) ?? `${surface}_url_fetch`,
    };
  } catch {
    return null;
  }
}

// Reusable collector: gathers an observation for all six surfaces from explicit env inputs
// first, falling back to an explicit per-surface URL fetch only when configured. No surface is
// ever invented -- a surface with neither an env sha nor a URL configured comes back as {}.
export async function collectAgt002SurfaceObservations({ env = {}, fetchImpl = undefined } = {}) {
  const observations = {};
  for (const surface of SURFACE_NAMES) {
    observations[surface] =
      explicitEnvObservation(surface, env) ?? (await fetchedSurfaceObservation(surface, env, fetchImpl)) ?? {};
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
