// AGT-002 · Phase 5 remediation — deterministic, server-owned prompt budgeting for the
// manifest-driven integral-V3 provider request.
//
// WHY THIS EXISTS
//   The single controlled real-provider canary (memory: agt002-v3-canary-context-window-exceeded)
//   was rejected at admission with provider_error_code `context_window_exceeded`: the assembled
//   integral-V3 request exceeded the model context window. Nothing estimated or capped the TOTAL
//   assembled request before the call; the only pre-existing budget bounds the retrieval evidence
//   packet inside agt002-preview-input.js.
//
// WHAT DRIVES THE SIZE (measured on the real pilot, read-only preflight, zero provider calls)
//   Total request 592,204 B / ~197,402 conservative tokens, of which:
//     - document_evidence.omitted_chunks   464,140 B (78%) — a ~2,772-entry list of NON-selected
//       chunk provenance {evidence_ref, chunk_id, document_id, document_type, requirement_id,
//       reason}. The model can NEVER cite an omitted chunk (it is not in citation_allowlist); the
//       governed omission signal (material_omissions + omission_reasons) is derived SERVER-side
//       from the original input, and the durable envelope's evidence_coverage keeps the full list
//       (built from the ORIGINAL previewInput, not this budgeted copy). So the model-facing copy is
//       redundant raw-document provenance — the correct primary reduction target.
//     - selected_chunks[].text               24,738 B  — the redacted raw excerpts (secondary).
//   Everything else — the 20-requirement manifest (+governed category/evidence_state), the 17
//   evidence classes, the citation allowlist, the coverage manifest, the output schema, the policy —
//   is governed and MUST be preserved; it is never touched here.
//
// WHAT THIS DOES (and never does)
//   Given the exact request the client would serialize ({ model, policy, input, outputSchema }), it
//   measures a conservative serialized-size/token estimate and, only when over the closed budget,
//   reduces the redundant raw payload in a fixed deterministic order — (1) summarize omitted_chunks
//   to a count/by-reason provenance record, then (2) equal-cap water-fill truncate selected_chunks
//   text to a prefix with provenance — stopping as soon as it fits. It NEVER drops a selected chunk
//   (its evidence_ref is a citation boundary), NEVER touches the requirement manifest, the 17
//   evidence classes, the citation allowlist, the governed evidence_state, material_omissions or the
//   abstention semantics, and NEVER fabricates text. If the request still does not fit after the
//   maximal reduction — i.e. the governed skeleton alone is too large — it FAILS CLOSED (throws
//   AGT002_V3_PROMPT_BUDGET_EXCEEDED) BEFORE the provider call rather than omit governed content.

// Conservative, provider-independent token estimate calibrated against the controlled real canary.
// That accepted request serialized to 128,214 bytes and the provider reported 46,796 input tokens
// (~2.74 bytes/token). Using 2 bytes/token deliberately OVER-counts that observed tokenizer by ~37%,
// so the admission guard remains fail-closed with material headroom instead of relying on the
// disproven generic 3-4 bytes/token assumption. This is an auditable lexical proxy tied to measured
// provider behavior, not a proprietary-tokenizer claim.
const CONSERVATIVE_BYTES_PER_TOKEN = 2;

// Default closed budget, expressed in the conservative estimator's tokens. Anchored to the ONE hard
// datum available: production (non-V3) runs plateaued at exactly 81284 provider input_tokens UNDER
// the window (memory: agt002-v3-canary-context-window-exceeded), i.e. 81284 is the largest prompt
// the model is KNOWN to have admitted. Because the estimator over-counts relative to the provider
// tokenizer, enforcing estimate <= 81284 keeps the real token count comfortably below that
// proven-safe level — deliberately strict. This default is a safe floor, NOT a measured context
// window.
//
// It has since been reconfirmed too low for real V3 runs: an authorized real Procuraduria run
// completed 18 semantic-discovery provider turns and then failed closed BEFORE final analysis with
// validation_code `v3_prompt_budget_exceeded`, under this same floor. The Codex model cache for the
// actual pilot model (gpt-5.6-luna) separately reports context_window=272000 / effective
// context=258400, and the bridge has accepted a 156226-input-token request from it — both well
// above this floor. Rather than bump this constant ahead of a fully reconfirmed operational value,
// the cap is raised via the server-owned env override AGT002_PREVIEW_PROMPT_MAX_INPUT_TOKENS
// (parsed in agt002-preview-runtime.js's getAgt002PreviewRuntimeConfig, forwarded to the engine as
// promptMaxInputTokens only on the V3 path) — never by a caller/browser value, and this constant
// stays the default when the override is absent.
export const AGT002_V3_PROMPT_DEFAULT_MAX_INPUT_TOKENS = 81_284;

// Closed, privacy-safe code for the pre-provider fail-closed rejection.
export const AGT002_V3_PROMPT_BUDGET_EXCEEDED_CODE = 'AGT002_V3_PROMPT_BUDGET_EXCEEDED';

const BUDGET_REASON = 'v3_prompt_budget';

export function measureAgt002V3RequestBytes(request) {
  return Buffer.byteLength(JSON.stringify(request), 'utf8');
}

export function estimateAgt002V3RequestTokens(request) {
  return Math.ceil(measureAgt002V3RequestBytes(request) / CONSERVATIVE_BYTES_PER_TOKEN);
}

function selectedChunksOf(input) {
  const chunks = input?.document_evidence?.selected_chunks;
  return Array.isArray(chunks) ? chunks : [];
}

function omittedChunksOf(input) {
  const omitted = input?.document_evidence?.omitted_chunks;
  return Array.isArray(omitted) ? omitted : [];
}

// Reduction 1 (primary): replace the model-facing omitted_chunks list — redundant raw-document
// provenance the model can never cite — with a compact, deterministic provenance record preserving
// the total count and the by-reason distribution. The governed material_omissions flag and the
// server-derived omission_reasons are NOT here and are untouched; the durable envelope keeps the
// full omitted_chunks list (built from the original input). Returns the SAME input when there is
// nothing to summarize (byte-identical).
function summarizeOmittedChunks(input) {
  const omitted = omittedChunksOf(input);
  if (omitted.length === 0) return input;
  const byReason = {};
  for (const entry of omitted) {
    const reason = typeof entry?.reason === 'string' ? entry.reason : 'unknown';
    byReason[reason] = (byReason[reason] || 0) + 1;
  }
  const byReasonSorted = Object.fromEntries(Object.keys(byReason).sort().map((key) => [key, byReason[key]]));
  return {
    ...input,
    document_evidence: {
      ...input.document_evidence,
      omitted_chunks: [],
      omitted_chunks_reduction: {
        reason: BUDGET_REASON,
        source_count: omitted.length,
        retained_count: 0,
        by_reason_counts: byReasonSorted,
      },
    },
  };
}

// Reduction 2 (secondary): a single common per-chunk character cap. Every chunk keeps min(len, cap)
// leading characters (water-filling with a common level — short chunks are kept whole, only long
// chunks are shortened). A truncated chunk keeps a PREFIX (never rewritten) with explicit
// provenance; char_count stays == len(text) (the retrieval invariant) and the source length + the
// omitted amount are recorded. Returns the SAME input when nothing is truncated.
function applyChunkTextCap(input, cap) {
  const chunks = selectedChunksOf(input);
  let anyTruncated = false;
  const nextChunks = chunks.map((chunk) => {
    const sourceText = typeof chunk?.text === 'string' ? chunk.text : '';
    if (sourceText.length <= cap) return chunk;
    anyTruncated = true;
    const keptText = sourceText.slice(0, cap);
    return {
      ...chunk,
      text: keptText,
      char_count: keptText.length,
      source_char_count: sourceText.length,
      text_omitted_char_count: sourceText.length - keptText.length,
      text_budgeted: true,
      text_budget_reason: BUDGET_REASON,
    };
  });
  if (!anyTruncated) return input;
  return { ...input, document_evidence: { ...input.document_evidence, selected_chunks: nextChunks } };
}

function sumChunkTextChars(input) {
  return selectedChunksOf(input).reduce((total, chunk) => total + (typeof chunk?.text === 'string' ? chunk.text.length : 0), 0);
}

function baseReport(input, maxInputTokens, beforeTokens, beforeBytes) {
  const manifest = input?.document_evidence?.requirement_manifest;
  const classes = input?.company_evidence_classes?.classes;
  const allowlist = input?.document_evidence?.citation_allowlist;
  return {
    budget_max_input_tokens: maxInputTokens,
    conservative_bytes_per_token: CONSERVATIVE_BYTES_PER_TOKEN,
    estimated_input_tokens_before: beforeTokens,
    serialized_bytes_before: beforeBytes,
    selected_chunk_count: selectedChunksOf(input).length,
    omitted_chunk_count_before: omittedChunksOf(input).length,
    chunk_chars_before: sumChunkTextChars(input),
    requirement_manifest_count: Array.isArray(manifest) ? manifest.length : 0,
    company_evidence_class_count: Array.isArray(classes) ? classes.length : 0,
    citation_allowlist_count: Array.isArray(allowlist) ? allowlist.length : 0,
  };
}

function failClosed(report) {
  const error = new Error(
    'AGT-002 Preview v3: el prompt excede el presupuesto de contexto incluso tras reducir al máximo la carga '
    + 'documental redundante (lista de descartes y texto de extractos) sin tocar requisitos, clases de evidencia '
    + 'ni fronteras de citación; se rechaza antes de llamar al proveedor.',
  );
  error.code = AGT002_V3_PROMPT_BUDGET_EXCEEDED_CODE;
  error.report = report;
  return error;
}

/**
 * Budgets the assembled integral-V3 provider request.
 *
 * NEVER throws for an oversized request (only for a malformed `maxInputTokens`).
 *
 * @returns {{ input: object, fits: boolean, applied: boolean, report: object }} — the (possibly
 *   reduced) input to send, whether it fits `maxInputTokens`, whether reduction was applied, and a
 *   sanitized metadata-only report. Under budget → the SAME input reference is returned unchanged
 *   (byte-identical). Over budget after maximal reduction → `fits: false` alongside that maximal
 *   reduction; see budgetAgt002V3PromptRequest below for the fail-closed wrapper.
 */
export function reduceAgt002V3PromptRequestInput({ model, policy, input, outputSchema, maxInputTokens }) {
  if (!Number.isInteger(maxInputTokens) || maxInputTokens <= 0) {
    throw new Error('AGT-002 Preview v3: el presupuesto de prompt requiere maxInputTokens como entero positivo.');
  }
  const requestOf = (candidate) => ({ model, policy, input: candidate, outputSchema });
  const measure = (candidate) => estimateAgt002V3RequestTokens(requestOf(candidate));

  const beforeTokens = measure(input);
  const beforeBytes = measureAgt002V3RequestBytes(requestOf(input));
  const base = baseReport(input, maxInputTokens, beforeTokens, beforeBytes);

  const finish = (candidate, { omittedSummarized, perChunkCap }) => {
    const afterBytes = measureAgt002V3RequestBytes(requestOf(candidate));
    const truncatedCount = selectedChunksOf(candidate).filter((chunk) => chunk?.text_budgeted === true).length;
    return {
      input: candidate,
      fits: true,
      applied: candidate !== input,
      report: {
        ...base,
        applied: candidate !== input,
        estimated_input_tokens_after: measure(candidate),
        serialized_bytes_after: afterBytes,
        omitted_chunks_summarized: omittedSummarized,
        omitted_chunk_count_after: omittedChunksOf(candidate).length,
        truncated_chunk_count: truncatedCount,
        chunk_chars_after: sumChunkTextChars(candidate),
        per_chunk_cap_chars: perChunkCap,
      },
    };
  };

  // Under budget: no-op, byte-identical (same reference). Covers a small run and a generous budget;
  // guarantees the flag-on/under-budget request equals the flag-off request exactly.
  if (beforeTokens <= maxInputTokens) {
    return finish(input, { omittedSummarized: false, perChunkCap: null });
  }

  // Reduction 1: summarize the redundant omitted_chunks provenance first (biggest, safest lever —
  // never citable, governed omission signal preserved server-side). If it alone fits, stop here with
  // every selected-chunk excerpt intact.
  const summarized = summarizeOmittedChunks(input);
  const omittedSummarized = summarized !== input;
  if (omittedSummarized && measure(summarized) <= maxInputTokens) {
    return finish(summarized, { omittedSummarized: true, perChunkCap: null });
  }

  // Reduction 2: on top of the summarized omitted list, water-fill truncate the raw excerpt text.
  // Emptying every excerpt is the floor; if even that (with omitted_chunks summarized) does not fit,
  // the governed skeleton itself is too large — fail closed rather than omit governed content.
  const working = omittedSummarized ? summarized : input;
  const chunks = selectedChunksOf(working);
  const emptied = applyChunkTextCap(working, 0);
  if (chunks.length === 0 || measure(emptied) > maxInputTokens) {
    const emptiedBytes = measureAgt002V3RequestBytes(requestOf(emptied));
    // The maximally-reduced request STILL does not fit. `reduceAgt002V3PromptRequestInput` never
    // throws: it reports `fits: false` alongside that maximal reduction so a caller that measures
    // fit itself (the batch planner, which must decide "split" vs "refuse" per candidate batch)
    // can do so without an exception per trial. budgetAgt002V3PromptRequest below turns exactly
    // this into the unchanged fail-closed AGT002_V3_PROMPT_BUDGET_EXCEEDED throw.
    return {
      input: emptied,
      fits: false,
      applied: false,
      report: {
        ...base,
        applied: false,
        estimated_input_tokens_after: measure(emptied),
        serialized_bytes_after: emptiedBytes,
        omitted_chunks_summarized: omittedSummarized,
        omitted_chunk_count_after: omittedChunksOf(emptied).length,
        truncated_chunk_count: chunks.length,
        chunk_chars_after: 0,
        per_chunk_cap_chars: 0,
        exceeded: true,
      },
    };
  }

  // Binary-search a common per-chunk char cap whose request fits the budget. Request size increases
  // with the cap overall, but not STRICTLY monotonically: dropping the cap just below a chunk's
  // length flips that chunk to "truncated" and adds its small fixed provenance-key overhead, a
  // local upward step. That never threatens the hard guarantee — `bestCap` is only ever assigned
  // inside the explicitly verified `measure(...) <= budget` branch and is seeded with the
  // already-proven-fitting cap 0 — so the returned request ALWAYS fits; at worst the search settles
  // one step below the theoretical optimum (marginally more excerpt trimmed). Deterministic.
  const maxChunkChars = Math.max(0, ...chunks.map((chunk) => (typeof chunk?.text === 'string' ? chunk.text.length : 0)));
  let low = 0;
  let high = maxChunkChars;
  let bestCap = 0; // cap=0 already proven to fit above.
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (measure(applyChunkTextCap(working, mid)) <= maxInputTokens) {
      bestCap = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return finish(applyChunkTextCap(working, bestCap), { omittedSummarized, perChunkCap: bestCap });
}

/**
 * The unchanged fail-closed wrapper around the reduction ladder above: same arguments, same
 * `{ input, applied, report }` result, same AGT002_V3_PROMPT_BUDGET_EXCEEDED throw (with the same
 * `.report`) when even the maximal reduction does not fit. The ladder itself now lives in
 * `reduceAgt002V3PromptRequestInput` so the batch planner can reuse it per candidate batch —
 * byte-for-byte the same reduction the request that is finally SENT goes through — without an
 * exception being the only way to learn that a candidate does not fit.
 */
export function budgetAgt002V3PromptRequest({ model, policy, input, outputSchema, maxInputTokens }) {
  const reduced = reduceAgt002V3PromptRequestInput({ model, policy, input, outputSchema, maxInputTokens });
  if (!reduced.fits) throw failClosed(reduced.report);
  return { input: reduced.input, applied: reduced.applied, report: reduced.report };
}
