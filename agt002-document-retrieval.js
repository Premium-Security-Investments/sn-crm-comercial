export const AGT002_RETRIEVAL_OMISSION_REASONS = Object.freeze([
  'budget_exhausted',
  'lower_relevance',
  'superseded_for_current_requirement',
  'gap_unavailable',
]);

const ROOT_KEYS = ['snapshot_id', 'chunks', 'gaps', 'requirements', 'max_chunks', 'max_chars', 'max_tokens'];
const CHUNK_KEYS = [
  'chunk_id', 'evidence_ref', 'document_id', 'document_version_id', 'opportunity_id', 'snapshot_id',
  'document_type', 'name', 'version', 'content_hash', 'current', 'page', 'section', 'chunk_index',
  'text', 'char_count', 'chunk_hash', 'precedence', 'superseded_by_addendum',
];
const REQUIREMENT_KEYS = ['requirement_id', 'terms'];
const GAP_KEYS = ['document_id', 'document_version_id', 'document_type', 'name', 'reason'];
const PRECEDENCE_VALUES = new Set(['base', 'addendum']);
const REASON_PRIORITY = { superseded_for_current_requirement: 0, budget_exhausted: 1, lower_relevance: 2 };

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} debe ser texto no vacío.`);
  return value.trim();
}

function requireHash(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} debe ser SHA-256 hexadecimal en minúscula.`);
  }
  return value;
}

function requirePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} debe ser un entero mayor que cero.`);
  return value;
}

function rejectUnknownKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} debe ser un objeto.`);
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter(key => !allowedSet.has(key));
  if (unknown.length) throw new Error(`${label} contiene una clave no permitida o desconocida: ${unknown.sort().join(', ')}.`);
}

function validateChunk(raw, index, snapshotId) {
  const label = `chunks[${index}]`;
  rejectUnknownKeys(raw, CHUNK_KEYS, label);

  const chunkId = requireNonEmptyString(raw.chunk_id, `${label}.chunk_id`);
  const evidenceRef = requireNonEmptyString(raw.evidence_ref, `${label}.evidence_ref`);
  const documentId = requireNonEmptyString(raw.document_id, `${label}.document_id`);
  const documentVersionId = requireNonEmptyString(raw.document_version_id, `${label}.document_version_id`);
  const opportunityId = requireNonEmptyString(raw.opportunity_id, `${label}.opportunity_id`);
  const documentType = requireNonEmptyString(raw.document_type, `${label}.document_type`);
  const name = requireNonEmptyString(raw.name, `${label}.name`);
  const contentHash = requireHash(raw.content_hash, `${label}.content_hash`);
  const chunkHash = requireHash(raw.chunk_hash, `${label}.chunk_hash`);

  if (raw.snapshot_id != null && (typeof raw.snapshot_id !== 'string' || !raw.snapshot_id.trim())) {
    throw new Error(`${label}.snapshot_id debe ser texto no vacío o null.`);
  }
  if (raw.snapshot_id != null && raw.snapshot_id !== snapshotId) {
    throw new Error(`${label}.snapshot_id no coincide con el snapshot solicitado; un snapshot no puede citar chunks de otro.`);
  }
  if (!Number.isInteger(raw.version) || raw.version <= 0) throw new Error(`${label}.version debe ser un entero mayor que cero.`);
  if (typeof raw.current !== 'boolean') throw new Error(`${label}.current debe ser booleano.`);
  if (!Number.isInteger(raw.page) || raw.page <= 0) throw new Error(`${label}.page debe ser un entero mayor que cero.`);
  if (!Number.isInteger(raw.section) || raw.section <= 0) throw new Error(`${label}.section debe ser un entero mayor que cero.`);
  if (!Number.isInteger(raw.chunk_index) || raw.chunk_index < 0) throw new Error(`${label}.chunk_index debe ser un entero mayor o igual a cero.`);
  if (typeof raw.text !== 'string' || !raw.text.trim()) throw new Error(`${label}.text debe ser texto no vacío.`);
  if (!Number.isInteger(raw.char_count) || raw.char_count !== raw.text.length) {
    throw new Error(`${label}.char_count debe coincidir exactamente con la longitud del texto.`);
  }
  if (!PRECEDENCE_VALUES.has(raw.precedence)) throw new Error(`${label}.precedence debe ser base o addendum.`);
  if (typeof raw.superseded_by_addendum !== 'boolean') throw new Error(`${label}.superseded_by_addendum debe ser booleano.`);

  return {
    chunkId, evidenceRef, documentId, documentVersionId, opportunityId,
    snapshotId: raw.snapshot_id ?? null,
    documentType, name,
    version: raw.version,
    contentHash,
    current: raw.current,
    page: raw.page,
    section: raw.section,
    chunkIndex: raw.chunk_index,
    text: raw.text,
    charCount: raw.char_count,
    chunkHash,
    precedence: raw.precedence,
    supersededByAddendum: raw.superseded_by_addendum,
  };
}

function validateGap(raw, index) {
  const label = `gaps[${index}]`;
  rejectUnknownKeys(raw, GAP_KEYS, label);
  const documentId = requireNonEmptyString(raw.document_id, `${label}.document_id`);
  const reason = requireNonEmptyString(raw.reason, `${label}.reason`);
  const documentType = raw.document_type == null ? null : requireNonEmptyString(raw.document_type, `${label}.document_type`);
  const name = raw.name == null ? null : requireNonEmptyString(raw.name, `${label}.name`);
  return { documentId, documentType, name, reason };
}

function validateRequirement(raw, index) {
  const label = `requirements[${index}]`;
  rejectUnknownKeys(raw, REQUIREMENT_KEYS, label);
  const requirementId = requireNonEmptyString(raw.requirement_id, `${label}.requirement_id`);
  if (!Array.isArray(raw.terms) || raw.terms.length === 0) {
    throw new Error(`${label}.terms debe ser una lista de términos de búsqueda no vacía.`);
  }
  const terms = [...new Set(raw.terms.map((term, termIndex) => requireNonEmptyString(term, `${label}.terms[${termIndex}]`)))];
  return { requirementId, terms };
}

function normalizeForSearch(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// Deterministic lexical estimate plus one token for the evidence-packet wrapper.
// This is provider-independent and auditable; it is not a proprietary tokenizer claim.
export function estimateAgt002EvidenceTokens(text) {
  const lexical = String(text ?? '').match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) ?? [];
  return lexical.length + 1;
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let pos = 0;
  while (true) {
    const idx = haystack.indexOf(needle, pos);
    if (idx === -1) break;
    count += 1;
    pos = idx + needle.length;
  }
  return count;
}

function scoreChunkForRequirement(normalizedText, requirement) {
  let termScore = 0;
  for (const term of requirement.terms) {
    termScore += countOccurrences(normalizedText, normalizeForSearch(term));
  }
  return termScore;
}

function presentationSortKey(chunk) {
  const pad = value => String(value).padStart(8, '0');
  return `${chunk.documentId}:${pad(chunk.page)}:${pad(chunk.section)}:${pad(chunk.chunkIndex)}`;
}

function candidateSortKey(candidate) {
  return candidate.chunk.chunkId;
}

function dedupeChunks(chunks) {
  const byEvidenceRef = new Map();
  const unique = [];
  for (const chunk of chunks) {
    const existing = byEvidenceRef.get(chunk.evidenceRef);
    if (existing) {
      if (
        existing.chunkHash !== chunk.chunkHash
        || existing.contentHash !== chunk.contentHash
        || existing.text !== chunk.text
        || existing.documentVersionId !== chunk.documentVersionId
      ) {
        throw new Error(`Violación de integridad: evidence_ref ${chunk.evidenceRef} tiene contenido distinto entre entradas.`);
      }
      continue;
    }
    byEvidenceRef.set(chunk.evidenceRef, chunk);
    unique.push(chunk);
  }
  const opportunityIds = new Set(unique.map(chunk => chunk.opportunityId));
  if (opportunityIds.size > 1) {
    throw new Error('Todos los chunks deben pertenecer a la misma oportunidad; un snapshot no puede citar chunks de otra oportunidad.');
  }
  return unique;
}

function buildCandidates(chunks, requirements) {
  const candidatesByRequirement = new Map();
  for (const requirement of requirements) {
    const scored = [];
    for (const chunk of chunks) {
      const normalizedText = normalizeForSearch(chunk.text);
      const termScore = scoreChunkForRequirement(normalizedText, requirement);
      if (termScore <= 0) continue;
      const score = termScore + (chunk.precedence === 'addendum' ? 0.5 : 0);
      scored.push({ chunk, score });
    }
    scored.sort((left, right) => {
      const precedence = Number(right.chunk.precedence === 'addendum') - Number(left.chunk.precedence === 'addendum');
      if (precedence) return precedence;
      if (left.chunk.precedence === 'addendum' && left.chunk.version !== right.chunk.version) {
        return right.chunk.version - left.chunk.version;
      }
      return (right.score - left.score) || candidateSortKey(left).localeCompare(candidateSortKey(right));
    });
    candidatesByRequirement.set(requirement.requirementId, scored);
  }
  return candidatesByRequirement;
}

function selectEvidence(requirements, candidatesByRequirement, maxChunks, maxChars, maxTokens) {
  const cap = Math.max(1, Math.floor(maxChunks / requirements.length));
  const queues = new Map(requirements.map(r => [r.requirementId, [...candidatesByRequirement.get(r.requirementId)]]));
  const selectedCountByRequirement = new Map(requirements.map(r => [r.requirementId, 0]));
  const selected = new Map(); // chunkId -> { chunk, requirementIds: Set }
  const attemptedBudgetFail = new Set();
  const budgetFailures = [];
  let chunksUsed = 0;
  let charsUsed = 0;
  let tokensUsed = 0;
  let hardStop = false;

  let progressed = true;
  while (progressed && !hardStop) {
    progressed = false;
    for (const requirement of requirements) {
      if (hardStop) break;
      const requirementId = requirement.requirementId;
      const queue = queues.get(requirementId);

      while (queue.length && selected.has(queue[0].chunk.chunkId)) {
        const duplicate = queue.shift();
        selected.get(duplicate.chunk.chunkId).requirementIds.add(requirementId);
        selectedCountByRequirement.set(requirementId, selectedCountByRequirement.get(requirementId) + 1);
        progressed = true;
      }
      if (!queue.length) continue;
      if (selectedCountByRequirement.get(requirementId) >= cap) continue;

      const candidate = queue[0];
      if (chunksUsed >= maxChunks) { hardStop = true; break; }
      const candidateTokens = estimateAgt002EvidenceTokens(candidate.chunk.text);
      if (charsUsed + candidate.chunk.charCount > maxChars || tokensUsed + candidateTokens > maxTokens) {
        queue.shift();
        attemptedBudgetFail.add(candidate.chunk.chunkId);
        budgetFailures.push({ requirementId, chunk: candidate.chunk });
        progressed = true;
        continue;
      }
      queue.shift();
      selected.set(candidate.chunk.chunkId, { chunk: candidate.chunk, requirementIds: new Set([requirementId]) });
      selectedCountByRequirement.set(requirementId, selectedCountByRequirement.get(requirementId) + 1);
      chunksUsed += 1;
      charsUsed += candidate.chunk.charCount;
      tokensUsed += candidateTokens;
      progressed = true;
    }
  }

  const remaining = [];
  for (const { requirementId, chunk } of budgetFailures) {
    if (selected.has(chunk.chunkId)) {
      selected.get(chunk.chunkId).requirementIds.add(requirementId);
      continue;
    }
    remaining.push({ requirementId, chunk, attemptedBudgetFail: true });
  }
  for (const requirement of requirements) {
    const requirementId = requirement.requirementId;
    for (const item of queues.get(requirementId)) {
      if (selected.has(item.chunk.chunkId)) {
        selected.get(item.chunk.chunkId).requirementIds.add(requirementId);
        continue;
      }
      remaining.push({ requirementId, chunk: item.chunk, attemptedBudgetFail: attemptedBudgetFail.has(item.chunk.chunkId) });
    }
  }

  return { selected, remaining, chunksUsed, charsUsed, tokensUsed, cap };
}

function buildOmittedChunkEntries(remaining, selected) {
  const omittedByChunk = new Map();
  for (const { requirementId, chunk, attemptedBudgetFail } of remaining) {
    let reason = attemptedBudgetFail ? 'budget_exhausted' : 'lower_relevance';
    if (chunk.supersededByAddendum) {
      const hasSelectedAddendumForRequirement = [...selected.values()]
        .some(entry => entry.chunk.precedence === 'addendum' && entry.requirementIds.has(requirementId));
      if (hasSelectedAddendumForRequirement) reason = 'superseded_for_current_requirement';
    }
    const existing = omittedByChunk.get(chunk.chunkId);
    if (!existing || REASON_PRIORITY[reason] < REASON_PRIORITY[existing.reason]) {
      omittedByChunk.set(chunk.chunkId, {
        evidence_ref: chunk.evidenceRef,
        chunk_id: chunk.chunkId,
        document_id: chunk.documentId,
        document_type: chunk.documentType,
        requirement_id: requirementId,
        reason,
      });
    }
  }
  return [...omittedByChunk.values()];
}

function buildCoverageManifest({ chunks, gaps, requirements, candidatesByRequirement, selected }) {
  const documentIds = new Set([...chunks.map(c => c.documentId), ...gaps.map(g => g.documentId)]);
  const byDocument = [...documentIds].sort().map(documentId => {
    const docChunks = chunks.filter(c => c.documentId === documentId);
    const selectedCount = [...selected.values()].filter(entry => entry.chunk.documentId === documentId).length;
    const gap = gaps.find(g => g.documentId === documentId);
    const documentType = docChunks[0]?.documentType ?? gap?.documentType ?? null;
    return {
      document_id: documentId,
      document_type: documentType,
      chunks_available: docChunks.length,
      chunks_selected: selectedCount,
      gap: Boolean(gap),
      covered: selectedCount > 0,
    };
  });

  const documentTypes = new Set([
    ...chunks.map(c => c.documentType),
    ...gaps.filter(g => g.documentType != null).map(g => g.documentType),
  ]);
  const byDocumentType = [...documentTypes].sort().map(documentType => {
    const typeChunks = chunks.filter(c => c.documentType === documentType);
    const selectedCount = [...selected.values()].filter(entry => entry.chunk.documentType === documentType).length;
    return {
      document_type: documentType,
      chunks_available: typeChunks.length,
      chunks_selected: selectedCount,
      covered: selectedCount > 0,
    };
  });

  const byRequirement = requirements
    .map(requirement => {
      const candidates = candidatesByRequirement.get(requirement.requirementId);
      const selectedCount = [...selected.values()].filter(entry => entry.requirementIds.has(requirement.requirementId)).length;
      const status = selectedCount > 0 ? 'covered' : (candidates.length > 0 ? 'not_covered' : 'no_evidence');
      return {
        requirement_id: requirement.requirementId,
        candidates_available: candidates.length,
        chunks_selected: selectedCount,
        status,
      };
    })
    .sort((left, right) => left.requirement_id.localeCompare(right.requirement_id));

  return { by_document: byDocument, by_document_type: byDocumentType, by_requirement: byRequirement };
}

export function buildAgt002DocumentRetrieval(raw) {
  rejectUnknownKeys(raw, ROOT_KEYS, 'La solicitud de recuperación de evidencia');
  const snapshotId = requireNonEmptyString(raw.snapshot_id, 'snapshot_id');

  if (!Array.isArray(raw.chunks)) throw new Error('chunks debe ser una lista.');
  const chunks = dedupeChunks(raw.chunks.map((c, i) => validateChunk(c, i, snapshotId)));

  if (raw.gaps != null && !Array.isArray(raw.gaps)) throw new Error('gaps debe ser una lista.');
  const gaps = (raw.gaps ?? []).map((g, i) => validateGap(g, i));

  if (!Array.isArray(raw.requirements) || raw.requirements.length === 0) {
    throw new Error('requirements debe ser una lista con al menos un requisito.');
  }
  const requirements = raw.requirements.map((r, i) => validateRequirement(r, i));
  const seenRequirementIds = new Set();
  for (const requirement of requirements) {
    if (seenRequirementIds.has(requirement.requirementId)) {
      throw new Error(`requirement_id duplicado: ${requirement.requirementId}.`);
    }
    seenRequirementIds.add(requirement.requirementId);
  }
  requirements.sort((left, right) => left.requirementId.localeCompare(right.requirementId));

  const maxChunks = requirePositiveInteger(raw.max_chunks, 'max_chunks');
  if (!Number.isInteger(raw.max_chars) || raw.max_chars <= 0) throw new Error('max_chars debe ser un entero mayor que cero.');
  const maxChars = raw.max_chars;
  const maxTokens = requirePositiveInteger(raw.max_tokens, 'max_tokens');

  const candidatesByRequirement = buildCandidates(chunks, requirements);
  const { selected, remaining, chunksUsed, charsUsed, tokensUsed } = selectEvidence(requirements, candidatesByRequirement, maxChunks, maxChars, maxTokens);

  const selectedChunks = [...selected.values()]
    .map(({ chunk, requirementIds }) => ({
      evidence_ref: chunk.evidenceRef,
      chunk_id: chunk.chunkId,
      document_id: chunk.documentId,
      document_version_id: chunk.documentVersionId,
      document_type: chunk.documentType,
      name: chunk.name,
      version: chunk.version,
      content_hash: chunk.contentHash,
      current: chunk.current,
      page: chunk.page,
      section: chunk.section,
      chunk_index: chunk.chunkIndex,
      text: chunk.text,
      char_count: chunk.charCount,
      chunk_hash: chunk.chunkHash,
      precedence: chunk.precedence,
      superseded_by_addendum: chunk.supersededByAddendum,
      requirement_ids: [...requirementIds].sort(),
    }))
    .sort((left, right) => presentationSortKey(chunks.find(c => c.chunkId === left.chunk_id)).localeCompare(
      presentationSortKey(chunks.find(c => c.chunkId === right.chunk_id)),
    ));

  const citationAllowlist = [...new Set(selectedChunks.map(c => c.evidence_ref))].sort();

  const omittedChunkEntries = buildOmittedChunkEntries(remaining, selected)
    .sort((left, right) => (left.document_id.localeCompare(right.document_id)) || left.chunk_id.localeCompare(right.chunk_id));
  const gapEntries = gaps
    .map(gap => ({
      evidence_ref: null,
      chunk_id: null,
      document_id: gap.documentId,
      document_type: gap.documentType,
      requirement_id: null,
      reason: 'gap_unavailable',
    }))
    .sort((left, right) => left.document_id.localeCompare(right.document_id));
  const omittedChunks = [...gapEntries, ...omittedChunkEntries];

  const coverageManifest = buildCoverageManifest({ chunks, gaps, requirements, candidatesByRequirement, selected });

  const materialOmissions = coverageManifest.by_requirement.some(r => r.status !== 'covered')
    || omittedChunks.some(o => o.reason === 'budget_exhausted' || o.reason === 'gap_unavailable');

  return {
    snapshot_id: snapshotId,
    budget: {
      max_chunks: maxChunks,
      max_chars: maxChars,
      max_tokens: maxTokens,
      chunks_used: chunksUsed,
      chars_used: charsUsed,
      tokens_used: tokensUsed,
      chunks_remaining: maxChunks - chunksUsed,
      chars_remaining: maxChars - charsUsed,
      tokens_remaining: maxTokens - tokensUsed,
    },
    selected_chunks: selectedChunks,
    citation_allowlist: citationAllowlist,
    coverage_manifest: coverageManifest,
    omitted_chunks: omittedChunks,
    material_omissions: materialOmissions,
  };
}
