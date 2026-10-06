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
  requirements: { id: string; category: string; textClaimId: string; applicability: string; companyEvaluation: string; blocker: boolean; requiredAction: string | null; evidenceClaimIds?: string[] }[];
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
    // Counted per requirement text: several points checked over one requirement are still one requirement.
    const applicable = report.requirements.filter(requirement => axis.categories.includes(requirement.category) && requirement.applicability !== 'NOT_APPLICABLE');
    const items = initialReportRequirementGroups({ ...report, requirements: applicable });
    const blockers = items.filter(group => group.blocker).length;
    const pending = items.filter(group => !group.blocker && ['PENDING', 'AVAILABLE', 'NOT_EVALUATED', ''].includes(group.evaluation)).length;
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
  // The same task often comes twice in other words (an open item and a requirement action): keep the first.
  const words = (text: string) => new Set(text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z]{4,}|\d+/g) ?? []);
  const similar = (a: Set<string>, b: Set<string>) => {
    const shared = [...a].filter(word => b.has(word)).length;
    return shared / Math.max(1, Math.min(a.size, b.size)) >= 0.6;
  };
  const kept: { task: Agt002DecisionTask; words: Set<string> }[] = [];
  for (const task of [...fromOpenItems, ...fromRequirements].sort((a, b) => Number(b.critical) - Number(a.critical))) {
    const taskWords = words(task.text);
    if (kept.some(entry => similar(entry.words, taskWords))) continue;
    kept.push({ task: { ...task, text: cleanInitialReportText(task.text) }, words: taskWords });
  }
  return kept.map(entry => entry.task).slice(0, limit);
}

/** The three most serious findings, blockers first. */
export function initialReportAlerts(report: Agt002InitialReport, limit = 3) {
  const order: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
  return [...report.findings]
    .sort((a, b) => Number(b.blocker) - Number(a.blocker) || (order[a.severity] ?? 9) - (order[b.severity] ?? 9))
    .slice(0, limit);
}

// --- Clarity layer (owner review 2026-10-06): one requirement once, notes that stand on their own, no internal codes. ---

const EVALUATION_RANK: Record<string, number> = { BLOCKER: 0, PENDING: 1, NOT_EVALUATED: 2, AVAILABLE: 3, VERIFIED: 4, NOT_APPLICABLE: 5 };
const rank = (evaluation: string) => EVALUATION_RANK[evaluation] ?? 2;

export type Agt002RequirementPoint = { id: string; evaluation: string; blocker: boolean; action: string | null };
export type Agt002RequirementGroup = {
  key: string; category: string; text: string; blocker: boolean; evaluation: string; points: Agt002RequirementPoint[];
};

/**
 * The model may emit several requirements over the same requirement text, one per point it checks (each with its own
 * company evaluation and action). The text is shown once; its points are listed under it, worst evaluation first.
 */
export function initialReportRequirementGroups(report: Agt002InitialReport): Agt002RequirementGroup[] {
  const groups = new Map<string, Agt002RequirementGroup>();
  for (const requirement of report.requirements) {
    const key = requirement.textClaimId || requirement.id;
    let group = groups.get(key);
    if (!group) {
      const text = initialReportClaims(report, [requirement.textClaimId])[0]?.text ?? '';
      group = { key, category: requirement.category, text, blocker: false, evaluation: 'VERIFIED', points: [] };
      groups.set(key, group);
    }
    const blocker = requirement.blocker || requirement.companyEvaluation === 'BLOCKER';
    group.blocker ||= blocker;
    if (rank(requirement.companyEvaluation) < rank(group.evaluation)) group.evaluation = requirement.companyEvaluation;
    group.points.push({ id: requirement.id, evaluation: requirement.companyEvaluation, blocker, action: requirement.requiredAction });
  }
  for (const group of groups.values()) group.points.sort((a, b) => rank(a.evaluation) - rank(b.evaluation));
  return [...groups.values()];
}

const CERTAINTY_BY_EVALUATION: Record<string, string> = {
  BLOCKER: 'Según el perfil declarado, hoy no cumple; confirmar con los documentos originales (RUP).',
  PENDING: 'Por confirmar: el perfil no trae la información.',
  AVAILABLE: 'El perfil lo declara; falta el documento que lo soporte.',
  VERIFIED: 'Cumple según el perfil declarado.',
  NOT_EVALUATED: 'Sin evaluar contra la empresa.',
};

export type Agt002FindingNote = { demand: string[]; company: string[]; impact: string; actions: string[]; certainty: string | null };

/**
 * A finding written so it can be read without opening its sources: what the rules demand (the requirement text the
 * finding rests on), how the company stands (the company evidence of that requirement), why it matters, what to do
 * and how sure it is. Built only from what the stored analysis already holds.
 */
export function initialReportFindingNote(report: Agt002InitialReport, finding: Agt002InitialReport['findings'][number]): Agt002FindingNote {
  const ids = new Set(finding.claimIds);
  const linked = report.requirements.filter(requirement => ids.has(requirement.textClaimId));
  const unique = (values: (string | null | undefined)[]) => [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))];
  const demand = unique(initialReportClaims(report, unique(linked.map(requirement => requirement.textClaimId))).map(claim => claim.text));
  // Only the company evidence this finding itself cites: a requirement's evidence may be about other points.
  // Never a requirement text (that is "Qué exigen"), and nothing at all without an authorized company profile.
  const requirementTextIds = new Set(report.requirements.map(requirement => requirement.textClaimId));
  const companyIds = report.companyFitAuthorized
    ? unique(linked.flatMap(requirement => requirement.evidenceClaimIds ?? []).filter(id => ids.has(id) && !requirementTextIds.has(id)))
    : [];
  const company = unique(initialReportClaims(report, companyIds).map(claim => cleanInitialReportText(claim.text))).slice(0, 2);
  const worst = linked.reduce<string | null>((current, requirement) => (current === null || rank(requirement.companyEvaluation) < rank(current) ? requirement.companyEvaluation : current), null);
  // What to do about the point that drives the finding (the worst evaluated), not about points already in order.
  const actions = unique(linked.filter(requirement => requirement.companyEvaluation === worst).map(requirement => requirement.requiredAction)).slice(0, 2);
  // With the demand and the company already stated, the impact's first sentence is the consequence; the rest restates.
  const impact = demand.length > 0 ? (finding.impact.match(/^.*?\.(?=\s|$)/)?.[0] ?? finding.impact) : finding.impact;
  return { demand, company, impact, actions, certainty: worst ? CERTAINTY_BY_EVALUATION[worst] ?? null : null };
}

const FIELD_WORDS: Record<string, string> = {
  pending_case_validation: 'pendiente de validar', accredited_experience: 'experiencia acreditada', experience: 'experiencia',
  services: 'servicios', certifications: 'certificaciones', financials: 'datos financieros', licenses: 'licencias',
  insurance: 'pólizas', personnel: 'personal', profile: 'perfil',
};

/** Removes internal claim codes and English field names from text a person reads. */
export function cleanInitialReportText(value: string): string {
  return value
    .replace(/\s*\((?:[^()]*\b(?:CLM|REQ|FND|OI|CTR)-[A-Z0-9-]+[^()]*)\)/g, '')
    .replace(/\b(?:CLM|REQ|FND|OI|CTR)-[A-Z0-9-]+\b/g, 'el requisito citado')
    .replace(/\b[a-z]+(?:_[a-z]+)+\b/g, word => FIELD_WORDS[word] ?? word.replace(/_/g, ' '))
    .replace(/\b(experience|services|certifications|financials|licenses|insurance|personnel)\b/g, field => FIELD_WORDS[field])
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** The model's verdict text often closes by restating that the decision is human; the report says it once, at the end. */
export function initialReportRecommendationText(label: string): string {
  const kept = label.split(/(?<=\.)\s+/).filter(sentence => !/GO\s*\/?\s*NO[- ]?GO|decisi[oó]n humana/i.test(sentence));
  return (kept.length > 0 ? kept.join(' ') : label).trim();
}

// Only expansions that are certain; an unknown acronym is left as the analysis wrote it.
const ACRONYMS: Record<string, string> = {
  RUP: 'Registro Único de Proponentes', UNSPSC: 'códigos de clasificación de bienes y servicios', SMMLV: 'salarios mínimos mensuales',
  SMLMV: 'salarios mínimos mensuales', CDP: 'certificado de disponibilidad presupuestal', TRM: 'tasa de cambio oficial',
  VMS: 'software de gestión de video', LPR: 'lectura de placas', CCTV: 'cámaras de circuito cerrado', PTZ: 'cámara móvil con zoom',
  SAN: 'sistema de almacenamiento en red', SST: 'seguridad y salud en el trabajo', RCE: 'póliza de responsabilidad civil extracontractual',
  PAC: 'programa anual de caja', MPLS: 'canal de datos dedicado', SECAD: 'sistema de la Policía Nacional', UT: 'unión temporal',
  PMP: 'certificación en gerencia de proyectos', SECOP: 'portal de contratación pública', MinTIC: 'Ministerio de Tecnologías de la Información',
};

/** Acronyms used in the given texts, with a plain explanation, in first-appearance order. */
export function initialReportAcronyms(texts: string[]): { acronym: string; meaning: string }[] {
  const joined = texts.join(' ');
  const found = Object.keys(ACRONYMS)
    .map(acronym => ({ acronym, index: joined.search(new RegExp(`\\b${acronym}\\b`)) }))
    .filter(entry => entry.index >= 0)
    .sort((a, b) => a.index - b.index);
  const seen = new Set<string>();
  return found.map(({ acronym }) => ({ acronym, meaning: ACRONYMS[acronym] })).filter(entry => !seen.has(entry.meaning) && Boolean(seen.add(entry.meaning)));
}
