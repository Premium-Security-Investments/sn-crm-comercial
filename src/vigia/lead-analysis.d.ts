export const LEAD_ANALYSIS_CAPABILITY_ID: string;
export const LEAD_ANALYSIS_CONTRACT_VERSION: string;
export const LEAD_ANALYSIS_DEFAULT_MONTHLY_MAX: number;
export const LEAD_ANALYSIS_PRICE_PER_MTOK: { input: number; output: number };
export const LEAD_ANALYSIS_PROFILE_KEYS: readonly string[];
export type LeadAnalysisOutput = {
  empresa: { que_hace: string; sedes: string; tamano: string };
  riesgos_sector: string[];
  servicio_recomendado: { servicio: string; por_que: string };
  mensaje_sugerido: { canal: 'whatsapp' | 'correo'; texto: string };
  pendientes_por_confirmar: string[];
};
export const LEAD_ANALYSIS_OUTPUT_SCHEMA: Record<string, unknown>;
export function leadAnalysisProfileFingerprint(opportunity?: Record<string, unknown>): string;
export function validateLeadAnalysisOutput(raw: unknown): LeadAnalysisOutput;
export function estimateLeadAnalysisCostUsd(usage?: { input_tokens?: number; output_tokens?: number }): number;
export function bogotaMonthStartIso(now?: Date): string;
export function monthlyMaxFrom(environment?: Record<string, string | undefined>): number;
