import { normalizeTenderStatusText } from './tender-source-status.js';

// Objective critical-document taxonomy for public tender GO/NO-GO review:
// pliego/estudios previos, anexo técnico o financiero, experiencia/
// habilitantes, matriz de riesgos, minuta, adendas y cronograma/cierre.
// A terminal import failure on any of these must never resolve a job to
// 'ready_for_snapshot' silently; unmatched/ambiguous names fail closed as
// non-critical only when they match none of these terms.
const CRITICAL_TENDER_DOCUMENT_TERMS = [
  'pliego', 'estudio', 'tecnico', 'financier', 'experiencia', 'habilitante',
  'matriz', 'riesgo', 'minuta', 'adenda', 'cronograma', 'cierre', 'plazo',
];

export function isCriticalTenderDocument(name) {
  const normalized = normalizeTenderStatusText(name);
  return CRITICAL_TENDER_DOCUMENT_TERMS.some(term => normalized.includes(term));
}
