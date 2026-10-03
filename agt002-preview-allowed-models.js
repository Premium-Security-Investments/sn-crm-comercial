// AGT-002 preview model allowlist — the single source of truth both a NEW job's builder
// (agt002-reanalysis-input.js) and an already-durable job's executor validator
// (agt002-reanalysis-executor.js) import, never restate. Exact-match, case-sensitive only: no
// trim/case normalization anywhere in this contract.
export const AGT002_PREVIEW_SONNET_MODEL = 'sonnet';
export const AGT002_PREVIEW_ALLOWED_MODELS = Object.freeze([AGT002_PREVIEW_SONNET_MODEL]);
