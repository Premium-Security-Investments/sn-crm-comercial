// Single source of truth for which AGT-002 model alias may ever reach the Hetzner bridge's
// provider argv. The bridge server (agt002-hetzner-bridge-server.js) and the preview runtime's
// server-owned config boundary (getAgt002PreviewRuntimeConfig in agt002-preview-runtime.js) both
// consume this exact list — never a local copy — so a caller can never queue or run a model alias
// the bridge would itself reject. Adding an alias here is a deliberate, reviewed change; nothing
// derives or widens it from a request/environment value.
export const AGT002_PREVIEW_ALLOWED_MODELS = Object.freeze(['sonnet']);
