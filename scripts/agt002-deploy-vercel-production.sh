#!/usr/bin/env bash
#
# agt002-deploy-vercel-production.sh
#
# Duplicate-safe production deploy to Vercel for AGT-002.
#
# Manual production policy:
#   - run only from /root/worktrees/siio-e6-scheduler-fix
#   - require that worktree to be clean and HEAD == origin/main
#   - invoke this script; never invoke `vercel --prod` directly
#   - pass AGT002_VERCEL_PRODUCTION_CONTROL_PLANE_URL explicitly on the invocation
# AGT002_DEPLOY_REPO_DIR remains configurable for the isolated mock test harness; it is not an
# authorization to deploy manually from any other checkout.
#
# Safety properties:
#   - a nonblocking flock prevents two concurrent invocations from both deploying
#   - the worktree must be clean and HEAD must be exactly origin/main (no local-only
#     commits, no dirty state, no deploying from a branch)
#   - the canonical control-plane URL is read first; if the exact full sha + f0
#     version are already live, nothing is deployed (idempotent re-runs are free)
#   - vercel is invoked at most once per run
#   - after a real deploy, the control-plane URL is polled a bounded number of times
#     for an exact sha+version readback; anything else is a hard failure
#   - secret values (tokens, etc.) are never echoed; only sha/version are logged
#
# All external commands, the control-plane URL, and poll timing are configurable via
# environment variables so this script can be driven by tests with mock commands and
# no network access.
#
# Configuration (env vars):
#   AGT002_DEPLOY_REPO_DIR             git worktree to deploy from (default: $PWD)
#   AGT002_DEPLOY_LOCK_PATH            flock path (default: /tmp/agt002-deploy-vercel-production.lock)
#   AGT002_VERCEL_PRODUCTION_CONTROL_PLANE_URL
#                                      URL returning JSON {"sha":"...","version":"..."} (required)
#   AGT002_DEPLOY_GIT_BIN              git executable (default: git)
#   AGT002_DEPLOY_CURL_BIN             curl executable (default: curl)
#   VERCEL_BIN                        vercel executable (default: vercel)
#   AGT002_DEPLOY_POLL_ATTEMPTS        max post-deploy readback attempts (default: 10)
#   AGT002_DEPLOY_POLL_INTERVAL_SECONDS seconds between readback attempts (default: 3)
#   AGT002_DEPLOY_SKIP_FETCH           set to 1 to skip `git fetch origin main` (default: unset,
#                                      i.e. always fetch); without a fresh fetch, origin/main is
#                                      whatever stale ref the worktree last fetched, and HEAD could
#                                      be compared against -- and deploy -- a stale target
#
# Exit codes:
#   0  already live at the exact sha+version, or deployed and verified
#   2  another run already holds the lock
#   3  worktree is not clean
#   4  HEAD is not exactly origin/main
#   5  post-deploy readback never matched within the poll budget

set -Eeuo pipefail
IFS=$'\n\t'

repo_dir="${AGT002_DEPLOY_REPO_DIR:-$PWD}"
lock_path="${AGT002_DEPLOY_LOCK_PATH:-/tmp/agt002-deploy-vercel-production.lock}"
git_bin="${AGT002_DEPLOY_GIT_BIN:-git}"
curl_bin="${AGT002_DEPLOY_CURL_BIN:-curl}"
vercel_bin="${VERCEL_BIN:-vercel}"
poll_attempts="${AGT002_DEPLOY_POLL_ATTEMPTS:-10}"
poll_interval_seconds="${AGT002_DEPLOY_POLL_INTERVAL_SECONDS:-3}"

: "${AGT002_VERCEL_PRODUCTION_CONTROL_PLANE_URL:?AGT002_VERCEL_PRODUCTION_CONTROL_PLANE_URL env var is required}"
control_plane_url="$AGT002_VERCEL_PRODUCTION_CONTROL_PLANE_URL"

log() {
  printf '[agt002-deploy-vercel-production] %s\n' "$1" >&2
}

exec {lock_fd}>"$lock_path"
if ! flock -n "$lock_fd"; then
  log "another deploy is already running (lock held: $lock_path)"
  exit 2
fi

if [ -n "$("$git_bin" -C "$repo_dir" status --porcelain)" ]; then
  log "worktree at $repo_dir is not clean; refusing to deploy"
  exit 3
fi

if [ "${AGT002_DEPLOY_SKIP_FETCH:-}" != "1" ]; then
  "$git_bin" -C "$repo_dir" fetch origin main
fi

head_sha="$("$git_bin" -C "$repo_dir" rev-parse HEAD)"
origin_main_sha="$("$git_bin" -C "$repo_dir" rev-parse origin/main)"
if [ "$head_sha" != "$origin_main_sha" ]; then
  log "HEAD ($head_sha) is not exactly origin/main ($origin_main_sha); refusing to deploy"
  exit 4
fi

sha="$(printf '%s' "$head_sha" | tr '[:upper:]' '[:lower:]')"
version="f0-${sha:0:7}"

extract_json_field() {
  local field="$1" json="$2"
  printf '%s' "$json" | tr -d '\n' | sed -n "s/.*\"${field}\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p"
}

fetch_control_plane() {
  "$curl_bin" -fsS "$control_plane_url" 2>/dev/null || true
}

is_live_match() {
  local body live_sha live_version
  body="$(fetch_control_plane)"
  live_sha="$(extract_json_field sha "$body" | tr '[:upper:]' '[:lower:]')"
  live_version="$(extract_json_field version "$body")"
  [ -n "$live_sha" ] && [ "$live_sha" = "$sha" ] && [ "$live_version" = "$version" ]
}

if is_live_match; then
  log "sha=$sha version=$version already live; skipping deploy"
  exit 0
fi

log "deploying sha=$sha version=$version"
(
  cd -- "$repo_dir"
  "$vercel_bin" deploy --prod --yes \
    -e AGT002_DEPLOYED_GIT_SHA="$sha" \
    -e AGT002_DEPLOYED_VERSION="$version" \
    -b AGT002_DEPLOYED_GIT_SHA="$sha" \
    -b AGT002_DEPLOYED_VERSION="$version"
)

attempt=1
verified=0
while [ "$attempt" -le "$poll_attempts" ]; do
  if is_live_match; then
    verified=1
    break
  fi
  if [ "$attempt" -lt "$poll_attempts" ]; then
    sleep "$poll_interval_seconds"
  fi
  attempt=$((attempt + 1))
done

if [ "$verified" -ne 1 ]; then
  log "readback never matched sha=$sha version=$version after $poll_attempts attempts"
  exit 5
fi

log "verified sha=$sha version=$version live"
