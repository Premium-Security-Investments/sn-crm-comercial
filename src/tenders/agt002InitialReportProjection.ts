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
  companyFitLabel?: string;
  checksExecuted: boolean;
  documents: { id: string; name: string | null }[];
  deadlines: { kind: string; value: string | null; certainty: string; status: string }[];
  coverage: { block: string; status: string; critical: boolean; gapReason: string | null }[];
  findings: { id: string; severity: string; category: string; title: string; impact: string; blocker: boolean; claimIds: string[] }[];
  requirements: { id: string; category: string; textClaimId: string; applicability: string; companyEvaluation: string; blocker: boolean; requiredAction: string | null }[];
  openItems: { id: string; kind: string; description: string; critical: boolean; status: string; ownerRole?: string | null; dueAt?: string | null }[];
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
const REQUIREMENT_CATEGORY: Record<string, string> = {
  TECHNICAL: 'Técnico', LEGAL: 'Jurídico', FINANCIAL: 'Financiero', EXPERIENCE: 'Experiencia', PERSONNEL: 'Personal',
  LICENSE: 'Licencias y permisos', INSURANCE: 'Garantías y seguros', ECONOMIC: 'Económico', TIMELINE: 'Cronograma', OTHER: 'Otro',
};
const COMPANY_EVALUATION: Record<string, string> = { NOT_EVALUATED: 'Sin evaluar', VERIFIED: 'Verificado', AVAILABLE: 'Disponible', PENDING: 'Pendiente', BLOCKER: 'Impedimento', NOT_APPLICABLE: 'No aplica' };
const OPEN_ITEM_KIND: Record<string, string> = { EVIDENCE_GAP: 'Falta evidencia', QUESTION: 'Pregunta', CONDITION: 'Condición', CONTRADICTION: 'Contradicción', ACTION: 'Acción' };
const CONTRADICTION_IMPACT: Record<string, string> = { ELIGIBILITY: 'Habilitación', SCORE: 'Puntaje', TIMELINE: 'Cronograma', PRICE: 'Precio', CONTRACT_RISK: 'Riesgo contractual', MINOR: 'Menor' };
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

// --- Decision view: the plain-language layer on top of the stored analysis (no new data, only grouping). ---

export type Agt002DecisionVerdict = { label: string; tone: 'go' | 'conditional' | 'evaluate' | 'nogo' };

export function initialReportVerdict(kind: string): Agt002DecisionVerdict {
  if (kind === 'CONTINUE_RECOMMENDED') return { label: 'Participar', tone: 'go' };
  if (kind === 'CONTINUE_CONDITIONAL_RECOMMENDED') return { label: 'Participar con condiciones', tone: 'conditional' };
  if (kind === 'NO_GO_RECOMMENDED') return { label: 'No participar', tone: 'nogo' };
  if (kind === 'INSUFFICIENT_INFORMATION') return { label: 'Evaluar a fondo · falta información', tone: 'evaluate' };
  return { label: 'Evaluar a fondo', tone: 'evaluate' };
}

const COMPANY_FIT: Record<string, string> = {
  APTO: 'La empresa cumple', PARTIAL_NOT_READY: 'Cumple en parte · aún no lista', NO_APTO: 'Hoy no cumple', NOT_AUTHORIZED: 'Sin perfil de empresa',
};
export function initialReportCompanyFit(report: Agt002InitialReport): string {
  return COMPANY_FIT[report.companyFitLabel || (report.companyFitAuthorized ? '' : 'NOT_AUTHORIZED')] ?? 'Sin evaluar';
}

export type Agt002AxisLight = 'cumple' | 'por_confirmar' | 'no_cumple' | 'sin_datos';
export type Agt002DecisionAxis = { key: string; label: string; light: Agt002AxisLight; total: number; blockers: number; pending: number };

const AXES: { key: string; label: string; categories: string[] }[] = [
  { key: 'juridico', label: 'Jurídico y garantías', categories: ['LEGAL', 'INSURANCE'] },
  { key: 'financiero', label: 'Financiero', categories: ['FINANCIAL'] },
  { key: 'tecnico', label: 'Técnico, licencias y personal', categories: ['TECHNICAL', 'LICENSE', 'PERSONNEL', 'TIMELINE'] },
  { key: 'experiencia', label: 'Experiencia', categories: ['EXPERIENCE'] },
  { key: 'economico', label: 'Económico', categories: ['ECONOMIC'] },
];

/** Five decision axes with a traffic light computed from the per-requirement company evaluation. */
export function initialReportAxes(report: Agt002InitialReport): Agt002DecisionAxis[] {
  return AXES.map(axis => {
    const items = report.requirements.filter(requirement => axis.categories.includes(requirement.category) && requirement.applicability !== 'NOT_APPLICABLE');
    const blockers = items.filter(requirement => requirement.blocker || requirement.companyEvaluation === 'BLOCKER').length;
    const pending = items.filter(requirement => ['PENDING', 'AVAILABLE', 'NOT_EVALUATED', ''].includes(requirement.companyEvaluation)).length;
    const light: Agt002AxisLight = items.length === 0 ? 'sin_datos' : blockers > 0 ? 'no_cumple' : pending > 0 ? 'por_confirmar' : 'cumple';
    return { key: axis.key, label: axis.label, light, total: items.length, blockers, pending };
  });
}

export type Agt002DecisionTask = { text: string; owner: string | null; dueAt: string | null; critical: boolean };

/** At most five things to do: critical open items first, then actions on requirements that block or are unconfirmed. */
export function initialReportTasks(report: Agt002InitialReport, limit = 5): Agt002DecisionTask[] {
  const fromOpenItems = report.openItems
    .filter(item => item.status === 'OPEN' || !item.status)
    .map(item => ({ text: item.description, owner: item.ownerRole ?? null, dueAt: item.dueAt ?? null, critical: item.critical }));
  const fromRequirements = report.requirements
    .filter(requirement => requirement.requiredAction && (requirement.blocker || ['BLOCKER', 'PENDING'].includes(requirement.companyEvaluation)))
    .map(requirement => ({ text: requirement.requiredAction as string, owner: null, dueAt: null, critical: requirement.blocker || requirement.companyEvaluation === 'BLOCKER' }));
  const seen = new Set<string>();
  return [...fromOpenItems, ...fromRequirements]
    .sort((a, b) => Number(b.critical) - Number(a.critical))
    .filter(task => { const key = task.text.toLowerCase().slice(0, 60); if (seen.has(key)) return false; seen.add(key); return true; })
    .slice(0, limit);
}

/** The three most serious findings, blockers first. */
export function initialReportAlerts(report: Agt002InitialReport, limit = 3) {
  const order: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
  return [...report.findings]
    .sort((a, b) => Number(b.blocker) - Number(a.blocker) || (order[a.severity] ?? 9) - (order[b.severity] ?? 9))
    .slice(0, limit);
}
