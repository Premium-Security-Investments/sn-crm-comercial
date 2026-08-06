import { VIGIA_VISIBLE_NAMES } from '../vigia/agentIdentity';
import type { TenderDocumentAnalysis, TenderDocumentRecord, TenderEvidenceCoverage } from './types';

export function tenderAnalysisMethodLabel(producer: TenderDocumentAnalysis['producer']) {
  return producer === 'AGT-002'
    ? `Análisis ${VIGIA_VISIBLE_NAMES.tenders}`
    : producer === 'HERMES-INTERIM'
      ? 'Análisis asistido por Hermes — transitorio'
      : 'Preanálisis por reglas SIIO';
}

export function tenderAnalysisProducerDisclosure(producer: TenderDocumentAnalysis['producer']) {
  return producer === 'AGT-002'
    ? `${VIGIA_VISIBLE_NAMES.tenders} con revisión humana obligatoria`
    : producer === 'HERMES-INTERIM'
      ? 'Asistencia transitoria de Hermes con revisión humana obligatoria'
      : 'Determinístico por reglas SIIO; no fue producido por un agente';
}

export function tenderDecisionStatusTone(status: string | null | undefined): 'red' | 'green' | 'amber' {
  const normalizedStatus = String(status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const unfavorable = new Set(['no_go', 'cerrada_no_go', 'no_adjudicada']);
  return unfavorable.has(normalizedStatus) ? 'red' : normalizedStatus === 'go' || normalizedStatus === 'adjudicada' ? 'green' : 'amber';
}

const WORD_SIGNAL_CONCLUSIONS: Record<string, string> = {
  coordinador: 'El alcance documental incluye una función de coordinación; falta validar el perfil, la dedicación y el soporte exigidos.',
  supervisor: 'El alcance documental incluye una función de supervisión; falta validar el perfil, la dedicación y el soporte exigidos.',
  'capital de trabajo': 'El análisis detectó una referencia al capital de trabajo; falta validar el valor exigido y el soporte financiero de SN.',
  rup: 'El análisis detectó una referencia al RUP o a experiencia habilitante; falta validar su vigencia y equivalencia.',
  cctv: 'El alcance documental incluye un componente de CCTV; falta confirmar los requisitos técnicos y la capacidad aplicable de SN.',
  videovigilancia: 'El alcance documental incluye un componente de videovigilancia; falta confirmar los requisitos técnicos y la capacidad aplicable de SN.',
  póliza: 'El análisis detectó una referencia a pólizas; falta confirmar tipo, cobertura, cuantía y vigencia.',
  poliza: 'El análisis detectó una referencia a pólizas; falta confirmar tipo, cobertura, cuantía y vigencia.',
};

function tenderEvidenceConclusion(text: string): string {
  return WORD_SIGNAL_CONCLUSIONS[text.toLowerCase()] || text;
}

export function normalizeTenderEvidence(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items.flatMap(item => {
    const text = typeof item === 'string'
      ? item
      : item && typeof item === 'object' && 'text' in item && typeof item.text === 'string'
        ? item.text
        : '';
    const normalized = text.trim();
    return normalized ? [tenderEvidenceConclusion(normalized)] : [];
  });
}

/** Combines persisted finding lists without hiding blockers or duplicating identical conclusions. */
export function mergeTenderEvidence(...groups: unknown[]): string[] {
  return [...new Set(groups.flatMap(normalizeTenderEvidence))];
}

export function tenderNextAction(nextAction: string | null | undefined): string {
  return String(nextAction || '').trim().replace(/regenerar dictamen/gi, 'actualizar la conclusión preliminar');
}

/** Documents currently in force; superseded/historical versions do not count toward the visible total. */
export function tenderCurrentDocumentCount(documents: Pick<TenderDocumentRecord, 'current'>[]): number {
  return documents.filter(document => document.current !== false).length;
}

export type TenderEvidenceCoverageSummary = {
  available: boolean;
  chunksUsed: number | null;
  chunksMax: number | null;
  tokensUsed: number | null;
  tokensMax: number | null;
  requirementsCovered: number | null;
  requirementsNotCovered: number | null;
  requirementsNoEvidence: number | null;
  requirementsTotal: number | null;
  citationCount: number | null;
};

/** Presence of a persisted evidence_coverage run never implies compliance; absence is reported explicitly rather than inferred. */
export function tenderEvidenceCoverageSummary(coverage: TenderEvidenceCoverage | null | undefined): TenderEvidenceCoverageSummary {
  if (!coverage) return { available: false, chunksUsed: null, chunksMax: null, tokensUsed: null, tokensMax: null, requirementsCovered: null, requirementsNotCovered: null, requirementsNoEvidence: null, requirementsTotal: null, citationCount: null };
  const byRequirement = coverage.coverage_manifest?.by_requirement || [];
  return {
    available: true,
    chunksUsed: coverage.budget?.chunks_used ?? null,
    chunksMax: coverage.budget?.max_chunks ?? null,
    tokensUsed: coverage.budget?.tokens_used ?? null,
    tokensMax: coverage.budget?.max_tokens ?? null,
    requirementsCovered: byRequirement.filter(item => item.status === 'covered').length,
    requirementsNotCovered: byRequirement.filter(item => item.status === 'not_covered').length,
    requirementsNoEvidence: byRequirement.filter(item => item.status === 'no_evidence').length,
    requirementsTotal: byRequirement.length,
    citationCount: coverage.citation_allowlist?.length ?? 0,
  };
}

export type TenderAnalysisOpportunityMetadata = {
  entity: string | null;
  processReference: string | null;
  expectedCloseDate: string | null;
  offerValue: number | null;
};

/**
 * Entity and commercial facts come exclusively from the real opportunity record; the tender/process reference is not
 * persisted on the opportunity today, so it is reported as unavailable instead of being fabricated.
 */
export function tenderAnalysisOpportunityMetadata(opportunity: { company_name?: string | null; expected_close_date?: string | null; offer_value?: number | null } | null | undefined): TenderAnalysisOpportunityMetadata {
  const entity = String(opportunity?.company_name || '').trim();
  const offerValue = typeof opportunity?.offer_value === 'number' && Number.isFinite(opportunity.offer_value) ? opportunity.offer_value : null;
  return {
    entity: entity || null,
    processReference: null,
    expectedCloseDate: opportunity?.expected_close_date || null,
    offerValue,
  };
}
