// AGT-003 — normalización defensiva de presentación del brief de Vig-IA Comercial.
//
// Puro: nunca muta el brief recibido del backend/modelo. Filtra en la capa de presentación lo que
// el modelo no debería haber devuelto (lenguaje técnico/interno, contradicciones de moneda) sin
// tocar el objeto persistido ni los logs.

export const COMMERCIAL_DEFAULT_CURRENCY = 'COP';

const CURRENCY_CODE = /\b(COP|USD|EUR|GBP|MXN)\b/i;
const CURRENCY_WORDS = /pesos colombianos|d[oó]lares/i;

export function hasExplicitCurrency(text: string | null | undefined): boolean {
  const value = String(text ?? '');
  return CURRENCY_CODE.test(value) || CURRENCY_WORDS.test(value);
}

export function isCurrencyGapRequest(text: string | null | undefined): boolean {
  return /\bmoneda\b/i.test(String(text ?? ''));
}

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

export function filterCommercialWarnings(warnings: Array<string | null | undefined> | null | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of warnings ?? []) {
    const text = String(raw ?? '').trim();
    if (!text || isTechnicalCopilotText(text) || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function filterMissingInformation(items: Array<string | null | undefined> | null | undefined, explicitCurrency: boolean): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of items ?? []) {
    const text = String(raw ?? '').trim();
    if (!text || isTechnicalCopilotText(text) || seen.has(text)) continue;
    if (explicitCurrency && isCurrencyGapRequest(text)) continue;
    seen.add(text);
    result.push(text);
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
  missingInformation: string[];
  contactObjective: string;
  strategy: string;
  recommendedAssetIds: string[];
  hasApprovedAssets: boolean;
  warnings: string[];
};

function collectContextText(brief: CopilotPresentationBrief): string {
  const factsText = Array.isArray(brief.facts) ? brief.facts.map(fact => fact?.text ?? '').join(' ') : '';
  return `${brief.summary ?? ''} ${factsText}`;
}

// Pura: deriva texto y agrupaciones de presentación sin alterar `brief`.
export function presentCopilotBrief(brief: CopilotPresentationBrief): PresentedCopilotBrief {
  const explicitCurrency = hasExplicitCurrency(collectContextText(brief));
  const recommendedAssetIds = brief.recommended_asset_ids ?? [];
  return {
    summary: brief.summary,
    facts: brief.facts,
    inferences: brief.inferences,
    missingInformation: filterMissingInformation(brief.missing_information, explicitCurrency),
    contactObjective: brief.contact_objective,
    strategy: brief.strategy,
    recommendedAssetIds,
    hasApprovedAssets: recommendedAssetIds.length > 0,
    warnings: filterCommercialWarnings(brief.warnings),
  };
}

export function normalizeCopilotErrorMessage(message: string | null | undefined): string {
  const text = String(message ?? '').trim();
  if (!text) return 'No fue posible preparar la propuesta.';
  return text.replace(/Vig-IA/g, 'VIG-IA Comercial');
}
