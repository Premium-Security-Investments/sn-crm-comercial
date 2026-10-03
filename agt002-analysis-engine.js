// AGT-002 P0-05 — initial-analysis engine, pure unit half (docs/agt002/initial-analysis/
// CURRENT.md). A pure, dependency-injected per-batch analysis engine for the initial-analysis
// slice: never touches a database, never retries a failed model call under a different model id,
// and never lets a raw provider payload leak into a thrown error. Belongs to the initial-analysis
// slice only — never imports, and is never imported by, any agt002-reanalysis-*.js module.

import { createHash } from 'node:crypto';

export const AGT002_ANALYSIS_ENGINE_MAX_BATCH_SIZE = 12;

export const AGT002_ANALYSIS_ENGINE_ERROR_CODES = Object.freeze({
  MEMBER_HASH_MISMATCH: 'AGT002_ENGINE_MEMBER_HASH_MISMATCH',
  BATCH_INCOMPLETE: 'AGT002_ENGINE_BATCH_INCOMPLETE',
  BATCH_DUPLICATE_MEMBER: 'AGT002_ENGINE_BATCH_DUPLICATE_MEMBER',
  BATCH_TOO_LARGE: 'AGT002_ENGINE_BATCH_TOO_LARGE',
  BUDGET_EXCEEDED: 'AGT002_ENGINE_BUDGET_EXCEEDED',
  MODEL_CALL_FAILED: 'AGT002_ENGINE_MODEL_CALL_FAILED',
});

function engineError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function stableForHash(value) {
  if (Array.isArray(value)) return value.map(stableForHash);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableForHash(value[key])]));
  }
  return value;
}

function canonicalSha256(value) {
  return createHash('sha256').update(JSON.stringify(stableForHash(value))).digest('hex');
}

/** Fails closed if any rehydrated member's content no longer re-derives its declared hash. */
export function assertAgt002RehydratedMembersMatchHashes(members) {
  for (const member of members) {
    if (canonicalSha256(member.content) !== member.contentHash) {
      throw engineError(
        AGT002_ANALYSIS_ENGINE_ERROR_CODES.MEMBER_HASH_MISMATCH,
        'AGT-002 analysis engine: el contenido rehidratado de un miembro no coincide con su hash declarado.',
      );
    }
  }
}

/** Pure structural validation of one analysis batch before it is ever handed to a model. */
export function validateAgt002AnalysisBatch({ members, expectedMemberIds }) {
  if (members.length > AGT002_ANALYSIS_ENGINE_MAX_BATCH_SIZE) {
    throw engineError(
      AGT002_ANALYSIS_ENGINE_ERROR_CODES.BATCH_TOO_LARGE,
      `AGT-002 analysis engine: el lote excede el tamaño máximo de ${AGT002_ANALYSIS_ENGINE_MAX_BATCH_SIZE}.`,
    );
  }

  const seen = new Set();
  for (const member of members) {
    if (seen.has(member.memberId)) {
      throw engineError(
        AGT002_ANALYSIS_ENGINE_ERROR_CODES.BATCH_DUPLICATE_MEMBER,
        'AGT-002 analysis engine: el lote contiene un memberId duplicado.',
      );
    }
    seen.add(member.memberId);
  }

  for (const expectedId of expectedMemberIds) {
    if (!seen.has(expectedId)) {
      throw engineError(
        AGT002_ANALYSIS_ENGINE_ERROR_CODES.BATCH_INCOMPLETE,
        'AGT-002 analysis engine: el lote no contiene todos los memberId esperados.',
      );
    }
  }
}

/**
 * Validates and hash-asserts the batch, then invokes the model exactly once (never retrying
 * under a different model id on failure), then fails closed if the response would exceed the
 * remaining job budget. A raw provider payload (e.g. `raw_response`) never surfaces in any
 * thrown error.
 */
export async function runAgt002AnalysisBatch({ members, expectedMemberIds, modelId, budget, usedTotalTokens, callModel }) {
  validateAgt002AnalysisBatch({ members, expectedMemberIds });
  assertAgt002RehydratedMembersMatchHashes(members);

  let response;
  try {
    response = await callModel({ modelId, members });
  } catch {
    throw engineError(
      AGT002_ANALYSIS_ENGINE_ERROR_CODES.MODEL_CALL_FAILED,
      'AGT-002 analysis engine: la llamada al modelo falló.',
    );
  }

  if (usedTotalTokens + response.usage.totalTokens > budget.maxTotalTokens) {
    throw engineError(
      AGT002_ANALYSIS_ENGINE_ERROR_CODES.BUDGET_EXCEEDED,
      'AGT-002 analysis engine: la respuesta excedería el presupuesto de tokens del job.',
    );
  }

  return { output: response.output, usage: response.usage };
}
