export type Agt002InitialReportSource = { documentId: string; documentName: string | null; locator: string };
export type Agt002InitialReportClaim = {
  id: string; type: string; text: string; materiality: string; evidenceStatus: string;
  inferenceBasis: string | null; sources: Agt002InitialReportSource[];
};
export type Agt002InitialReport = {
  runId: string; cutoffAt: string; createdAt: string; modelProfile: string;
  recommendation: { kind: string; label: string; confidence: string; limitations: string[]; basisClaimIds: string[] };
  processStatus: string;
  companyFitAuthorized: boolean;
  checksExecuted: boolean;
  documents: { id: string; name: string | null }[];
  deadlines: { kind: string; value: string | null; certainty: string; status: string }[];
  coverage: { block: string; status: string; critical: boolean; gapReason: string | null }[];
  findings: { id: string; severity: string; category: string; title: string; impact: string; blocker: boolean; claimIds: string[] }[];
  requirements: { id: string; category: string; textClaimId: string; applicability: string; companyEvaluation: string; blocker: boolean; requiredAction: string | null }[];
  openItems: { id: string; kind: string; description: string; critical: boolean; status: string }[];
  contradictions: { id: string; topic: string; impact: string; status: string; requiredAction: string | null; claimIds: string[] }[];
  claims: Agt002InitialReportClaim[];
};
export type Agt002InitialReportResponse = { available: boolean; state: string; report: Agt002InitialReport | null };

const LIST_KEYS = ['documents', 'deadlines', 'coverage', 'findings', 'requirements', 'openItems', 'contradictions', 'claims'] as const;

/** Validates the server-owned report projection; the browser never reads the stored aggregate itself. */
export function parseAgt002InitialReportResponse(value: unknown): Agt002InitialReportResponse {
  const item = value as Partial<Agt002InitialReportResponse> | null;
  if (!item || typeof item.available !== 'boolean' || typeof item.state !== 'string') {
    throw new Error('El servidor devolvió un reporte INITIAL no válido.');
  }
  if (!item.available) {
    if (item.report !== null) throw new Error('Un análisis inicial no listo no puede traer reporte.');
    return item as Agt002InitialReportResponse;
  }
  const report = item.report as Partial<Agt002InitialReport> | null;
  if (!report || typeof report.runId !== 'string' || !report.runId
      || !report.recommendation || typeof report.recommendation.kind !== 'string'
      || LIST_KEYS.some(key => !Array.isArray(report[key]))) {
    throw new Error('El reporte INITIAL no tiene la estructura esperada.');
  }
  return item as Agt002InitialReportResponse;
}

const RECOMMENDATION: Record<string, string> = {
  CONTINUE_RECOMMENDED: 'Continuar',
  CONTINUE_CONDITIONAL_RECOMMENDED: 'Continuar con condiciones',
  HOLD_RECOMMENDED: 'Esperar',
  NO_GO_RECOMMENDED: 'No continuar',
  INSUFFICIENT_INFORMATION: 'Información insuficiente',
};
const CONFIDENCE: Record<string, string> = { HIGH: 'alta', MEDIUM: 'media', LOW: 'baja' };
const SEVERITY: Record<string, string> = { CRITICAL: 'Crítico', HIGH: 'Alto', MEDIUM: 'Medio', LOW: 'Bajo', INFO: 'Informativo' };
const COVERAGE_STATUS: Record<string, string> = { COVERED: 'Cubierto', PARTIAL: 'Parcial', NOT_COVERED: 'Sin cubrir', NOT_APPLICABLE_WITH_REASON: 'No aplica' };
const COVERAGE_BLOCK: Record<string, string> = {
  CURRENT_RULES: 'Reglas vigentes', TECHNICAL_OPERATIONAL_SCOPE: 'Alcance técnico y operativo', LEGAL_ELIGIBILITY: 'Habilitación jurídica',
  EXPERIENCE_FINANCIAL_CAPACITY: 'Experiencia y capacidad financiera', ECONOMIC_VIABILITY: 'Viabilidad económica',
  CONTRACT_RISK: 'Riesgo contractual', TIMELINE_FEASIBILITY: 'Cronograma',
};
const DEADLINE_KIND: Record<string, string> = { OBSERVATIONS: 'Observaciones', ADDENDA: 'Adendas', SUBMISSION: 'Entrega de ofertas', OTHER: 'Otro plazo' };
const CERTAINTY: Record<string, string> = { CONFIRMED: 'confirmado', INFERRED: 'inferido', CONTRADICTED: 'contradictorio', UNKNOWN: 'desconocido' };
const REQUIREMENT_CATEGORY: Record<string, string> = { TECHNICAL: 'Técnico', LEGAL: 'Jurídico', FINANCIAL: 'Financiero', EXPERIENCE: 'Experiencia', PERSONNEL: 'Personal' };
const COMPANY_EVALUATION: Record<string, string> = { NOT_EVALUATED: 'Sin evaluar', VERIFIED: 'Verificado', AVAILABLE: 'Disponible', PENDING: 'Pendiente', BLOCKER: 'Impedimento' };
const OPEN_ITEM_KIND: Record<string, string> = { EVIDENCE_GAP: 'Falta evidencia', QUESTION: 'Pregunta', CONDITION: 'Condición', CONTRADICTION: 'Contradicción', ACTION: 'Acción' };
const CONTRADICTION_IMPACT: Record<string, string> = { ELIGIBILITY: 'Habilitación', SCORE: 'Puntaje', TIMELINE: 'Cronograma', PRICE: 'Precio', CONTRACT_RISK: 'Riesgo contractual' };
const EVIDENCE_STATUS: Record<string, string> = {
  SUPPORTED: 'Respaldada', PARTIALLY_SUPPORTED: 'Parcialmente respaldada', ABSENT: 'Sin evidencia', CONTRADICTED: 'Contradicha',
  INFERRED: 'Inferida', SUPERSEDED: 'Reemplazada', UNRESOLVABLE: 'No resoluble',
};

const label = (map: Record<string, string>, key: string) => map[key] ?? key;
export const initialReportLabels = {
  recommendation: (key: string) => label(RECOMMENDATION, key),
  confidence: (key: string) => label(CONFIDENCE, key),
  severity: (key: string) => label(SEVERITY, key),
  coverageStatus: (key: string) => label(COVERAGE_STATUS, key),
  coverageBlock: (key: string) => label(COVERAGE_BLOCK, key),
  deadlineKind: (key: string) => label(DEADLINE_KIND, key),
  certainty: (key: string) => label(CERTAINTY, key),
  requirementCategory: (key: string) => label(REQUIREMENT_CATEGORY, key),
  companyEvaluation: (key: string) => label(COMPANY_EVALUATION, key),
  openItemKind: (key: string) => label(OPEN_ITEM_KIND, key),
  contradictionImpact: (key: string) => label(CONTRADICTION_IMPACT, key),
  evidenceStatus: (key: string) => label(EVIDENCE_STATUS, key),
};

/** Resolves claim ids to their text, in order, skipping ids the report does not carry. */
export function initialReportClaims(report: Agt002InitialReport, ids: string[]): Agt002InitialReportClaim[] {
  const byId = new Map(report.claims.map(claim => [claim.id, claim]));
  return ids.map(id => byId.get(id)).filter((claim): claim is Agt002InitialReportClaim => Boolean(claim));
}

export function formatInitialReportSource(source: Agt002InitialReportSource): string {
  return `${source.documentName ?? 'Documento sin nombre'} — ${source.locator}`;
}
