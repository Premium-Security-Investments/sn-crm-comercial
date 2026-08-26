// AGT-002 canonical (durable queue) enqueue gate.
//
// The canonical button never runs the model inside the HTTP request: it only reserves a job the
// Hetzner worker executes later. The worker resolves EVERY pre-claim configuration problem into a
// closed terminal code and never surfaces a runtime/provider message (agt002-reanalysis-executor.js
// validFrozenInput). The HTTP enqueue path must classify identically, so this module answers a
// single question with a closed code instead of an exception: can this host reserve a canonical
// run right now?
//
// It exists because `getAgt002PreviewRuntimeConfig` fails with the SAME operator-facing message
// ("AGT-002 Preview no está configurado.") for two very different situations — the variables are
// absent, or the variables are present but an AGT002_PREVIEW_* numeric override is out of range —
// and only the first was gated by the route. The second escaped the enqueue as an HTTP 400
// carrying that raw message, with no attempt row and no corrida, which reads in the UI as "the
// agent is not configured" on a deployment that is in fact configured.

import { getAgt002PreviewRuntimeConfig, isAgt002PreviewConfigured } from './agt002-preview-runtime.js';
import { isAgt002QueueableTimeoutMs } from './agt002-reanalysis-input.js';

/** Server-side AGT-002 variables are absent or empty: this deployment never enabled Vig-IA. */
export const AGT002_NOT_CONFIGURED_CODE = 'AGT002_NOT_CONFIGURED';
/** The variables are present, but the resolved runtime config cannot fund a durable run. */
export const AGT002_RUNTIME_CONFIG_INVALID_CODE = 'AGT002_RUNTIME_CONFIG_INVALID';

/**
 * Pure classification: no I/O, no clock, no database, and never throws.
 *
 * @param {Record<string, string|undefined>} environment server-side variables only.
 * @returns {null|'AGT002_NOT_CONFIGURED'|'AGT002_RUNTIME_CONFIG_INVALID'} `null` when this host can
 * reserve a canonical run; otherwise the closed code to record on the `unavailable` attempt. The
 * caller never turns this into a client error and never renders the code to a human.
 */
export function agt002CanonicalEnqueueBlockCode(environment = process.env) {
  if (!isAgt002PreviewConfigured(environment)) return AGT002_NOT_CONFIGURED_CODE;
  let config;
  try {
    config = getAgt002PreviewRuntimeConfig(environment);
  } catch {
    // The thrown message is an internal runtime string that says "no está configurado" even when
    // the deployment IS configured, so it is deliberately dropped: the closed code above is the
    // only classification a caller may act on or persist.
    return AGT002_RUNTIME_CONFIG_INVALID_CODE;
  }
  // Resolvable is not enough: a turn timeout the worker's two-turn claim lease cannot fund would
  // reserve a job the executor rejects pre-claim on every cycle — a corrida that can never run.
  return isAgt002QueueableTimeoutMs(config.timeoutMs) ? null : AGT002_RUNTIME_CONFIG_INVALID_CODE;
}
