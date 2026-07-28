import type { TenderDocumentAnalysis } from './types';

export function tenderAnalysisMethodLabel(producer: TenderDocumentAnalysis['producer']) {
  return producer === 'AGT-002'
    ? 'Análisis Vig-IA'
    : producer === 'HERMES-INTERIM'
      ? 'Análisis asistido por Hermes — transitorio'
      : 'Preanálisis por reglas SIIO';
}

export function tenderAnalysisProducerDisclosure(producer: TenderDocumentAnalysis['producer']) {
  return producer === 'AGT-002'
    ? 'Vig-IA con revisión humana obligatoria'
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

export function tenderNextAction(nextAction: string | null | undefined): string {
  return String(nextAction || '').trim().replace(/regenerar dictamen/gi, 'actualizar la conclusión preliminar');
}
