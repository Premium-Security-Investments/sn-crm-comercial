// Deployment/runbook verification for the review blocker: production must never silently run
// against an installed Codex App Server binary whose v2 TurnStartParams lacks `effort`. This
// module never speaks the live App Server turn protocol (no initialize/turn/start/etc.) — it only
// parses text a deployment step already captured from the binary's own generated protocol
// artifacts (`codex app-server generate-json-schema` or `generate-ts`), so the check is
// deterministic and safe to run before any traffic is routed to a new binary.

export const AGT002_CODEX_EFFORT_CAPABILITY_OK = 'AGT002_CODEX_EFFORT_CAPABILITY_OK';
export const AGT002_CODEX_EFFORT_CAPABILITY_MISSING = 'AGT002_CODEX_EFFORT_CAPABILITY_MISSING';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function findTurnStartParamsSchema(node, seen = new Set()) {
  if (!isPlainObject(node) || seen.has(node)) return null;
  seen.add(node);
  for (const bucketKey of ['definitions', '$defs']) {
    const bucket = node[bucketKey];
    if (!isPlainObject(bucket)) continue;
    for (const [name, value] of Object.entries(bucket)) {
      if (/TurnStartParams$/.test(name) && isPlainObject(value)) return value;
    }
  }
  for (const value of Object.values(node)) {
    const found = findTurnStartParamsSchema(value, seen);
    if (found) return found;
  }
  return null;
}

function jsonSchemaTurnStartParamsHasEffort(jsonText) {
  let parsed;
  try { parsed = JSON.parse(jsonText); } catch { return false; }
  const schema = findTurnStartParamsSchema(parsed);
  return !!(schema && isPlainObject(schema.properties) && Object.hasOwn(schema.properties, 'effort'));
}

function tsBindingsTurnStartParamsHasEffort(tsText) {
  const match = tsText.match(/(?:interface|type)\s+\w*TurnStartParams\w*\s*(?:=\s*)?\{([\s\S]*?)\n\}/);
  if (!match) return false;
  return /(?:^|\s)effort\s*\??\s*:/.test(match[1]);
}

/** Fail-closed: any malformed, empty or unrecognized input reports no `effort` capability. */
export function turnStartParamsExposesEffort(generatedText) {
  const trimmed = typeof generatedText === 'string' ? generatedText.trim() : '';
  if (!trimmed) return false;
  return trimmed.startsWith('{') ? jsonSchemaTurnStartParamsHasEffort(trimmed) : tsBindingsTurnStartParamsHasEffort(trimmed);
}

/**
 * `generate` must be an injected, synchronous function returning the text already captured from
 * `codex app-server generate-json-schema` / `generate-ts` — this module never invokes the binary
 * itself, so it is required rather than defaulted.
 */
export function checkCodexEffortCapability({ generate } = {}) {
  if (typeof generate !== 'function') throw new Error('checkCodexEffortCapability requiere una función generate() inyectada.');
  const ok = turnStartParamsExposesEffort(generate());
  return { ok, code: ok ? AGT002_CODEX_EFFORT_CAPABILITY_OK : AGT002_CODEX_EFFORT_CAPABILITY_MISSING };
}
