import { realpathSync, readFileSync } from 'node:fs';

// The one filesystem location every AGT-002 release is unpacked to before its systemd units are
// (re)started. A oneshot reporter is only ever entitled to claim a sha/version when the realpath
// of the script node/bash is *actually executing* resolves -- byte-exact, after following every
// symlink -- into this tree. Hardcoded, never read from an environment variable or argv: nothing
// the process is launched with can move this root.
export const AGT002_RELEASES_ROOT = '/opt/psi-comercial/releases';

// A plain-text, single-token file colocated in the same immutable release directory as the sha
// it describes, so it can never drift out of band from the code it names.
export const AGT002_RELEASE_VERSION_FILE_NAME = 'RELEASE_VERSION';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
// Conservative nonempty token: no whitespace, slashes, quotes, or shell/JSON metacharacters --
// only what a real semver/build-tag string ever legitimately needs.
const VERSION_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function realpathOrNull(candidatePath, realpath) {
  if (typeof candidatePath !== 'string' || candidatePath.length === 0) return null;
  try {
    return realpath(candidatePath);
  } catch {
    return null;
  }
}

// The version file must itself realpath to somewhere inside the *same* sha's release directory --
// a symlink escaping that directory (to another release, or outside the tree entirely) is treated
// exactly like a missing file: version stays null, independent of whether the sha was observed.
function readReleaseVersion({ releasesRoot, sha, realpath, readFile }) {
  const versionPath = `${releasesRoot}/${sha}/${AGT002_RELEASE_VERSION_FILE_NAME}`;
  const resolvedVersionPath = realpathOrNull(versionPath, realpath);
  if (resolvedVersionPath === null || !resolvedVersionPath.startsWith(`${releasesRoot}/${sha}/`)) {
    return null;
  }
  let raw;
  try {
    raw = readFile(resolvedVersionPath, 'utf8');
  } catch {
    return null;
  }
  const trimmed = String(raw).trim();
  return VERSION_TOKEN_PATTERN.test(trimmed) ? trimmed : null;
}

/**
 * The only trusted path from "a script is executing" to a reported sha/version: the realpath of
 * `scriptPath` must resolve into `${releasesRoot}/<40-hex-sha>/<relativePath>`, matched
 * byte-exact against the caller's own allowlisted relativePath -- never a prefix, substring, or
 * normalized match. Nothing here ever reads an environment variable, argv flag, or other
 * caller-supplied claim; the filesystem location the runtime itself resolved to is the only
 * trusted input. Any missing, malformed, or mismatched piece collapses to `{ sha: null, version:
 * null }` -- this never throws.
 */
export function resolveAgt002ReleaseArtifactEvidence({
  scriptPath,
  relativePath,
  releasesRoot = AGT002_RELEASES_ROOT,
  realpath = realpathSync,
  readFile = readFileSync,
} = {}) {
  const resolvedScriptPath = realpathOrNull(scriptPath, realpath);
  if (resolvedScriptPath === null) return Object.freeze({ sha: null, version: null });

  const prefix = `${releasesRoot}/`;
  if (!resolvedScriptPath.startsWith(prefix)) return Object.freeze({ sha: null, version: null });

  const rest = resolvedScriptPath.slice(prefix.length);
  const slashIndex = rest.indexOf('/');
  if (slashIndex === -1) return Object.freeze({ sha: null, version: null });

  const sha = rest.slice(0, slashIndex);
  const remainder = rest.slice(slashIndex + 1);
  if (!SHA_PATTERN.test(sha) || remainder !== relativePath) {
    return Object.freeze({ sha: null, version: null });
  }

  return Object.freeze({ sha, version: readReleaseVersion({ releasesRoot, sha, realpath, readFile }) });
}
