import {
  AGT002_LEGAL_DEFAULT_STALE_AFTER_DAYS,
  buildAgt002LegalCitation,
  evaluateAgt002LegalSourceStatus,
  validateAgt002LegalConclusion,
} from './agt002-legal-corpus.js';
import { validateAgt002LegalManifest } from './scripts/validate_agt002_legal_corpus.mjs';

const QUERY_KEYS = [
  'corpus', 'corpus_version', 'as_of', 'stale_after_days',
  'process_stage', 'modality', 'topics', 'sector', 'max_results',
];

const HUMAN_REVIEW_STATEMENT = 'No verificado jurídicamente; requiere revisión humana';
const MAX_TAG_LENGTH = 80;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTag(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} debe ser texto no vacío.`);
  const cleaned = value.trim().replace(/\s+/g, ' ').toLowerCase();
  if (cleaned.length > MAX_TAG_LENGTH) throw new Error(`${label} excede la longitud máxima permitida.`);
  return cleaned;
}

function normalizeTagArray(value, label, { allowEmpty = false } = {}) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} debe ser una lista de etiquetas.`);
  if (!allowEmpty && value.length === 0) throw new Error(`${label} debe ser una lista de etiquetas no vacía.`);
  const normalized = value.map((tag, index) => normalizeTag(tag, `${label}[${index}]`));
  return [...new Set(normalized)].sort();
}

function intersects(left, right) {
  const rightSet = new Set(right);
  return left.some(item => rightSet.has(item));
}

/**
 * Deterministic, network-independent, model-free retrieval of applicable official legal evidence
 * from an explicit, already-versioned corpus/manifest (as produced/validated in Task31). Every
 * output field is derived from `evaluateAgt002LegalSourceStatus` / `buildAgt002LegalCitation` /
 * `validateAgt002LegalConclusion` (Task29) — this module never invents a source, URL, norm,
 * article or citation, and never reads a clock: `as_of` must be supplied by the caller.
 */
export function retrieveAgt002LegalEvidence(input) {
  if (!isRecord(input)) throw new Error('La consulta de recuperación jurídica debe ser un objeto.');
  const unknown = Object.keys(input).filter(key => !QUERY_KEYS.includes(key));
  if (unknown.length) {
    throw new Error(`La consulta contiene una clave no permitida o desconocida: ${unknown.sort().join(', ')}.`);
  }

  const manifest = input.corpus;
  const normalizedSources = validateAgt002LegalManifest(manifest);

  if (typeof input.corpus_version !== 'string' || !input.corpus_version.trim()) {
    throw new Error('corpus_version es obligatorio y debe declararse explícitamente en la consulta.');
  }
  if (input.corpus_version !== manifest.corpus_version) {
    throw new Error(
      `corpus_version de la consulta («${input.corpus_version}») no coincide con la del corpus entregado («${manifest.corpus_version}»).`,
    );
  }

  if (typeof input.as_of !== 'string' || !input.as_of.trim()) {
    throw new Error('as_of es obligatorio y debe declararse explícitamente (nunca se infiere del reloj del sistema).');
  }
  const staleAfterDays = input.stale_after_days ?? AGT002_LEGAL_DEFAULT_STALE_AFTER_DAYS;
  if (!Number.isInteger(staleAfterDays) || staleAfterDays <= 0) {
    throw new Error('stale_after_days debe ser un entero mayor que cero.');
  }

  const sector = normalizeTagArray(input.sector, 'sector');
  const topics = normalizeTagArray(input.topics, 'topics', { allowEmpty: true });
  const processStage = input.process_stage == null ? null : normalizeTag(input.process_stage, 'process_stage');
  const modality = input.modality == null ? null : normalizeTag(input.modality, 'modality');

  const requiredTopicTags = [...new Set([...topics, ...(processStage ? [processStage] : []), ...(modality ? [modality] : [])])];
  if (requiredTopicTags.length === 0) {
    throw new Error('Se requiere al menos una dimensión de tema: topics, process_stage o modality.');
  }

  let maxResults = null;
  if (input.max_results != null) {
    if (!Number.isInteger(input.max_results) || input.max_results <= 0) {
      throw new Error('max_results debe ser un entero mayor que cero cuando se especifica.');
    }
    maxResults = input.max_results;
  }

  const matched = normalizedSources
    .filter(source => intersects(source.sector, sector) && intersects(source.topic, requiredTopicTags))
    .sort((left, right) => left.source_id.localeCompare(right.source_id));

  const withinBudget = maxResults == null ? matched : matched.slice(0, maxResults);
  const omissions = (maxResults == null ? [] : matched.slice(maxResults)).map(source => ({
    source_id: source.source_id,
    reason: 'excluded_by_budget',
  }));

  const verifiedLegalEvidence = [];
  const humanLegalReviewItems = [];

  for (const source of withinBudget) {
    const evaluation = evaluateAgt002LegalSourceStatus(source, { as_of: input.as_of, stale_after_days: staleAfterDays });
    const citation = buildAgt002LegalCitation(source);

    if (evaluation.eligible_for_verified_law) {
      const conclusion = validateAgt002LegalConclusion(
        {
          status: 'verified_law',
          statement: `Evidencia jurídica oficial verificada: ${citation.label}.`,
          citations: [citation],
          reasons: [],
        },
        { sources: normalizedSources, as_of: input.as_of, stale_after_days: staleAfterDays },
      );
      verifiedLegalEvidence.push({
        source_id: source.source_id,
        topic: source.topic,
        sector: source.sector,
        citation: conclusion.citations[0],
        statement: conclusion.statement,
      });
    } else {
      const conclusion = validateAgt002LegalConclusion(
        {
          status: 'requires_human_legal_review',
          statement: HUMAN_REVIEW_STATEMENT,
          citations: [citation],
          reasons: [],
        },
        { sources: normalizedSources, as_of: input.as_of, stale_after_days: staleAfterDays },
      );
      humanLegalReviewItems.push({
        source_id: source.source_id,
        topic: source.topic,
        sector: source.sector,
        citation: conclusion.citations[0],
        statement: conclusion.statement,
        reasons: conclusion.reasons,
      });
    }
  }

  return {
    corpus_version: manifest.corpus_version,
    as_of: input.as_of,
    query: {
      process_stage: processStage,
      modality,
      topics,
      sector,
      max_results: maxResults,
    },
    verified_legal_evidence: verifiedLegalEvidence,
    human_legal_review_items: humanLegalReviewItems,
    coverage: {
      matched_source_ids: matched.map(source => source.source_id),
      considered_count: matched.length,
      returned_count: withinBudget.length,
    },
    omissions,
    allowed_citation_ids: verifiedLegalEvidence.map(item => item.citation.citation_id).sort(),
  };
}
