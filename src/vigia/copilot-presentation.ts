// AGT-003 — normalización defensiva de presentación del brief de Vig-IA Comercial.
//
// Puro: nunca muta el brief recibido del backend/modelo. Filtra en la capa de presentación lo que
// el modelo no debería haber devuelto (lenguaje técnico/interno, contradicciones de moneda) sin
// tocar el objeto persistido ni los logs.

import { VIGIA_VISIBLE_NAMES } from './agentIdentity';

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

// Fallbacks comerciales: neutros y accionables. No inventan datos del caso (ni valores, ni
// nombres, ni fechas): sólo devuelven al asesor al CRM, que es la fuente de verdad.
export const COMMERCIAL_TEXT_FALLBACKS = Object.freeze({
  summary: 'Sin contexto comercial disponible; revise la oportunidad en el CRM antes de contactar.',
  strategy: 'Revise la oportunidad en el CRM y defina con el equipo el siguiente paso antes de contactar.',
  contactObjective: 'Retomar el contacto y confirmar el interés del cliente.',
});

// Un campo de texto suelto es todo-o-nada: si viene vacío o clasifica como técnico/interno se
// sustituye entero por el fallback comercial, nunca se recorta a medias.
function presentCommercialText(value: string | null | undefined, fallback: string): string {
  const text = String(value ?? '').trim();
  return !text || isTechnicalCopilotText(text) ? fallback : text;
}

// Descarta entradas técnicas, vacías o no-objeto preservando el orden y la identidad de los
// objetos válidos: se construye un array nuevo, jamás se muta el original.
function filterCommercialEntries<T extends { text?: string | null }>(entries: readonly T[] | null | undefined): T[] {
  const result: T[] = [];
  for (const entry of entries ?? []) {
    // Una entrada sólo es válida si trae texto mostrable; así caen también los huecos (`null`,
    // `undefined`) y las formas que no son objetos del contrato.
    const text = typeof entry?.text === 'string' ? entry.text.trim() : '';
    if (!text || isTechnicalCopilotText(text)) continue;
    result.push(entry);
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
//
// Depura todos los campos que `VigiaCopilotProposal` muestra —`summary`, `strategy`,
// `contact_objective`, `facts[].text`, `inferences[].text`—. El borrador editable queda fuera a
// propósito: es texto que el asesor escribe y corrige, no salida del modelo.
export function presentCopilotBrief(brief: CopilotPresentationBrief): PresentedCopilotBrief {
  // La detección de moneda mira el contexto crudo: lo que decide si pedir la moneda es una
  // contradicción son los datos del CRM, no lo que sobrevivió al filtro de presentación.
  const explicitCurrency = hasExplicitCurrency(collectContextText(brief));
  const recommendedAssetIds = brief.recommended_asset_ids ?? [];
  return {
    summary: presentCommercialText(brief.summary, COMMERCIAL_TEXT_FALLBACKS.summary),
    facts: filterCommercialEntries(brief.facts),
    inferences: filterCommercialEntries(brief.inferences),
    missingInformation: filterMissingInformation(brief.missing_information, explicitCurrency),
    contactObjective: presentCommercialText(brief.contact_objective, COMMERCIAL_TEXT_FALLBACKS.contactObjective),
    strategy: presentCommercialText(brief.strategy, COMMERCIAL_TEXT_FALLBACKS.strategy),
    recommendedAssetIds,
    hasApprovedAssets: recommendedAssetIds.length > 0,
    warnings: filterCommercialWarnings(brief.warnings),
  };
}

// Identidad visible del copiloto: exactamente `Vig-IA Comercial`. Acepta la marca desnuda
// (`Vig-IA …`) y la mayúscula legacy (`VIG-IA Comercial …`), absorbiendo el `Comercial` que ya
// venga para no duplicarlo. El lookahead deja intactos los otros dominios visibles del agente y va
// inmediatamente después de `vig-ia`: si fuera detrás del `Comercial` opcional, el motor podría
// retroceder, soltar ese `Comercial` y duplicarlo al reemplazar (`VIG-IA Comercial Gerencial …`).
const COMMERCIAL_AGENT_LABEL = /\bvig-ia\b(?!\s+(?:gerencial|licitaciones)\b)(?:\s+comercial\b)?/gi;

export function normalizeCopilotErrorMessage(message: string | null | undefined): string {
  const text = String(message ?? '').trim();
  if (!text) return 'No fue posible preparar la propuesta.';
  return text.replace(COMMERCIAL_AGENT_LABEL, VIGIA_VISIBLE_NAMES.commercial);
}
