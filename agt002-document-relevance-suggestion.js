// AGT-002 / Vig-IA — server-owned document relevance suggestion, pure model contract.
// suggestAgt002DocumentRelevance(document) is a pure, synchronous, deterministic function.
// It never decides for Licitaciones: it only produces a conservative suggestion from
// { document_type, name, extracted_text } signals — never exclusion, never a universal
// filename rule, never a reproduction of the document's own text in its output.
// (.hermes/plans/2026-09-21-vigia-document-preselection.md)

const POLICY_VERSION = 'agt002-document-relevance-v1';

const MAX_EXTRACTED_TEXT_SCAN_LENGTH = 200000;

const COMBINING_DIACRITICS_PATTERN = /[̀-ͯ]/g;

// Canonical strong type signals. Deliberately excludes the generic "anexo" — only the
// qualified "anexo tecnico" counts as a strong signal.
const CANONICAL_KEYWORDS = Object.freeze([
  'pliego',
  'estudios previos',
  'anexo tecnico',
  'matriz de riesgos',
  'minuta',
  'cronograma',
  'adenda',
  'requisitos habilitantes',
  'especificaciones tecnicas',
]);

const REASONS = Object.freeze({
  type_and_filename_match:
    'El tipo documental declarado y el nombre de archivo coinciden con un mismo tipo documental clave reconocido por la política, lo que sostiene una recomendación de alta confianza.',
  type_filename_signal:
    'El tipo documental declarado y el nombre de archivo aportan cada uno una señal hacia tipos documentales clave del proceso, lo que sostiene una recomendación de confianza media.',
  multiple_content_headings:
    'El texto extraído contiene al menos dos encabezados fuertes reconocidos como propios de tipos documentales clave del proceso, lo que sostiene una recomendación de confianza media.',
  document_type_match:
    'El tipo documental declarado coincide con un tipo documental clave reconocido por la política, lo que sostiene una recomendación de confianza media.',
  filename_match:
    'El nombre de archivo coincide con un tipo documental clave reconocido por la política, lo que sostiene una recomendación de confianza media.',
  no_signal_detected:
    'No se detectaron señales suficientes de tipo documental, nombre de archivo o encabezados en el texto extraído. Licitaciones puede incluir este documento manualmente si lo considera pertinente para el paquete.',
});

const FALLBACK_RESULT = Object.freeze({
  recommended: false,
  confidence: 'low',
  reason_code: 'no_signal_detected',
  reason: REASONS.no_signal_detected,
  policy_version: POLICY_VERSION,
});

function safeString(value) {
  return typeof value === 'string' ? value : '';
}

function normalizeForMatching(text) {
  return safeString(text)
    .normalize('NFD')
    .replace(COMBINING_DIACRITICS_PATTERN, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findKeywordMatches(normalizedText) {
  const matches = new Set();
  if (!normalizedText) return matches;
  for (const keyword of CANONICAL_KEYWORDS) {
    if (normalizedText.includes(keyword)) matches.add(keyword);
  }
  return matches;
}

function setsIntersect(left, right) {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
}

function buildResult(recommended, confidence, reasonCode) {
  return {
    recommended,
    confidence,
    reason_code: reasonCode,
    reason: REASONS[reasonCode],
    policy_version: POLICY_VERSION,
  };
}

function readDocumentFields(document) {
  const source = document && typeof document === 'object' ? document : {};
  const extractedText = safeString(source.extracted_text).slice(0, MAX_EXTRACTED_TEXT_SCAN_LENGTH);
  return {
    documentType: safeString(source.document_type),
    name: safeString(source.name),
    extractedText,
  };
}

function computeSuggestion(document) {
  const { documentType, name, extractedText } = readDocumentFields(document);

  const typeMatches = findKeywordMatches(normalizeForMatching(documentType));
  const filenameMatches = findKeywordMatches(normalizeForMatching(name));
  const contentMatches = findKeywordMatches(normalizeForMatching(extractedText));

  if (typeMatches.size > 0 && filenameMatches.size > 0) {
    if (setsIntersect(typeMatches, filenameMatches)) {
      return buildResult(true, 'high', 'type_and_filename_match');
    }
    return buildResult(true, 'medium', 'type_filename_signal');
  }

  if (contentMatches.size >= 2) {
    return buildResult(true, 'medium', 'multiple_content_headings');
  }

  if (typeMatches.size > 0) {
    return buildResult(true, 'medium', 'document_type_match');
  }

  if (filenameMatches.size > 0) {
    return buildResult(true, 'medium', 'filename_match');
  }

  return buildResult(false, 'low', 'no_signal_detected');
}

export function suggestAgt002DocumentRelevance(document) {
  try {
    return computeSuggestion(document);
  } catch {
    return { ...FALLBACK_RESULT };
  }
}
