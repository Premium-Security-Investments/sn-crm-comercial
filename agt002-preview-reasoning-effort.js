// AGT-002 fail-closed reasoning-effort allowlist for the Codex App Server per-turn control
// (v2 TurnStartParams.effort — "overrides reasoning effort for this and subsequent turns").
//
// Root cause (production): a real AGT-002 run inherited the Codex CLI default reasoning effort
// (medium, never explicitly requested by this codebase) and its first provider turn emitted the
// final structured response only near the fixed 285_000ms per-turn deadline, still streaming
// deltas when killed — AGT002_TRANSPORT_ERROR/timeout, no canonical run. The per-turn timeout and
// the fixed two-turn claim lease (600s total) are NOT raised to compensate: instead, this
// workflow pins reasoning effort explicitly on every turn instead of silently inheriting
// whatever the Codex CLI/account default happens to be.
//
// The allowlist is deliberately narrow: only the levels this structured, hard-deadline workflow
// has actually operated under. `high` is excluded — it has never been exercised against this
// workflow's fixed 285_000ms per-turn deadline and would only reintroduce the exact timeout this
// fix closes. `minimal` is excluded — this workflow's output feeds a compliance/legal review
// surface and a reasoning level that (per the Codex reasoning-effort semantics) does little to no
// reasoning is not an operationally validated choice for it.
export const AGT002_PREVIEW_REASONING_EFFORT_VALUES = Object.freeze(['low', 'medium']);

/** The fastest level ever exercised against this workflow's hard per-turn deadline. */
export const AGT002_PREVIEW_DEFAULT_REASONING_EFFORT = 'low';

const AGT002_PREVIEW_REASONING_EFFORT_SET = new Set(AGT002_PREVIEW_REASONING_EFFORT_VALUES);

/** Exact-match, case-sensitive membership check — never coerces, trims or case-folds. */
export function isAgt002PreviewReasoningEffort(value) {
  return typeof value === 'string' && AGT002_PREVIEW_REASONING_EFFORT_SET.has(value);
}
