// AGT-003 — normalización defensiva de presentación del brief de Vig-IA Comercial.
//
// Puro: nunca muta el brief recibido del backend/modelo. Filtra en la capa de presentación lo que
// el modelo no debería haber devuelto (lenguaje técnico/interno) sin tocar persistencia ni logs.

import { VIGIA_VISIBLE_NAMES } from './agentIdentity';

const TECHNICAL_PATTERNS = [
  /input no confiable/i,
  /instrucciones (embebidas|incrustadas)/i,
  /approved_assets/i,
  /activos aprobados/i,
  /adjuntos aprobados/i,
  /run original/i,
  /\bpayload\b/i,
  /\bschema\b/i,
  /snapshot_id/i,
  /evidence_refs/i,
  /revisi[oó]n humana/i,
];

export function isTechnicalCopilotText(text: string | null | undefined): boolean {
  const value = String(text ?? '');
  return TECHNICAL_PATTERNS.some(pattern => pattern.test(value));
}

export const COMMERCIAL_TEXT_FALLBACKS = Object.freeze({
  summary: 'Sin contexto comercial disponible; revise la oportunidad en el CRM antes de contactar.',
  strategy: 'Revise la oportunidad en el CRM y defina con el equipo el siguiente paso antes de contactar.',
  contactObjective: 'Retomar el contacto y confirmar el interés del cliente.',
});

function presentCommercialText(value: string | null | undefined, fallback: string): string {
  const text = String(value ?? '').trim();
  return !text || isTechnicalCopilotText(text) ? fallback : text;
}

function filterCommercialEntries<T extends { text?: string | null }>(entries: readonly T[] | null | undefined): T[] {
  const result: T[] = [];
  for (const entry of entries ?? []) {
    const text = typeof entry?.text === 'string' ? entry.text.trim() : '';
    if (!text || isTechnicalCopilotText(text)) continue;
    result.push(entry);
  }
  return result;
}

export type CopilotPresentationFact = { text: string; evidence_refs: string[] };
export type CopilotPresentationInference = { text: string; evidence_refs: string[]; confidence: 'low' | 'medium' | 'high' };
export type CopilotPresentationBrief = {
  summary: string;
  facts: CopilotPresentationFact[];
  inferences: CopilotPresentationInference[];
  missing_information: string[];
  contact_objective: string;
  strategy: string;
  draft: { subject: string; body: string };
  recommended_asset_ids: string[];
  warnings: string[];
  human_review_required: true;
};
export type PresentedCopilotBrief = {
  summary: string;
  facts: CopilotPresentationFact[];
  inferences: CopilotPresentationInference[];
  contactObjective: string;
  contactPlanSteps: string[];
  recommendedAssetIds: string[];
  hasApprovedAssets: boolean;
};

const SENTENCE_BOUNDARY = /(?<=[.;:])\s+(?=[A-ZÁÉÍÓÚÑ¿¡])/;
const MAX_CONTACT_PLAN_STEPS = 8;

export function splitContactPlanSteps(text: string): string[] {
  const normalized = String(text ?? '').trim();
  const lines = normalized.includes('\n')
    ? normalized.split('\n').map(line => line.trim()).filter(Boolean)
    : [];
  if (lines.length > 1 && lines.length <= MAX_CONTACT_PLAN_STEPS) return lines;
  if (lines.length > MAX_CONTACT_PLAN_STEPS) return [normalized];

  const sentences = normalized.split(SENTENCE_BOUNDARY).map(sentence => sentence.trim()).filter(Boolean);
  if (sentences.length > 1 && sentences.length <= MAX_CONTACT_PLAN_STEPS) return sentences;
  return [normalized];
}

export function presentCopilotBrief(brief: CopilotPresentationBrief): PresentedCopilotBrief {
  const recommendedAssetIds = brief.recommended_asset_ids ?? [];
  const strategy = presentCommercialText(brief.strategy, COMMERCIAL_TEXT_FALLBACKS.strategy);
  return {
    summary: presentCommercialText(brief.summary, COMMERCIAL_TEXT_FALLBACKS.summary),
    facts: filterCommercialEntries(brief.facts),
    inferences: filterCommercialEntries(brief.inferences),
    contactObjective: presentCommercialText(brief.contact_objective, COMMERCIAL_TEXT_FALLBACKS.contactObjective),
    contactPlanSteps: splitContactPlanSteps(strategy),
    recommendedAssetIds,
    hasApprovedAssets: recommendedAssetIds.length > 0,
  };
}

const COMMERCIAL_AGENT_LABEL = /\bvig-ia\b(?!\s+(?:gerencial|licitaciones)\b)(?:\s+comercial\b)?/gi;

export function normalizeCopilotErrorMessage(message: string | null | undefined): string {
  const text = String(message ?? '').trim();
  if (!text) return 'No fue posible preparar la propuesta.';
  return text.replace(COMMERCIAL_AGENT_LABEL, VIGIA_VISIBLE_NAMES.commercial);
}

const MAX_WHY_BULLETS = 2;

function normalizeForComparison(text: string): string { return text.trim().toLowerCase().replace(/\s+/g, ' '); }

export type CompactCopilotSummary = { nextStep: string | null; whyBullets: string[] };

export function presentCompactCopilotSummary(presented: PresentedCopilotBrief, activeAlerts: readonly { risk_text: string }[]): CompactCopilotSummary {
  const candidate = String(presented?.contactPlanSteps?.[0] ?? '').trim();
  const normalizedCandidate = normalizeForComparison(candidate);
  const alertTexts = new Set((activeAlerts ?? []).map(a => normalizeForComparison(String(a?.risk_text ?? ''))));
  const repeatsAlert = alertTexts.has(normalizedCandidate);
  const isFallback = normalizedCandidate === normalizeForComparison(COMMERCIAL_TEXT_FALLBACKS.strategy);
  const nextStepAbstains = !candidate || repeatsAlert || isFallback;

  if (nextStepAbstains) return { nextStep: null, whyBullets: [] };

  const bulletSource = [...(presented?.facts ?? []), ...(presented?.inferences ?? [])]
    .map(entry => String(entry?.text ?? '').trim())
    .filter(Boolean)
    .filter(text => !alertTexts.has(normalizeForComparison(text)));
  const whyBullets = bulletSource.slice(0, MAX_WHY_BULLETS);

  return { nextStep: candidate, whyBullets };
}
