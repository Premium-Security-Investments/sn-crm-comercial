const DIACRITIC_MARKS = /[\u0300-\u036f]/g;
const EXCERPT_RADIUS = 60;
const MAX_EXCERPT_LENGTH = 160;
const MATERIALITY_WINDOW = 80;

const VALUE_PATTERNS = [
  { kind: 'percentage', pattern: /\d{1,3}(?:[.,]\d+)?\s?%/ },
  { kind: 'money', pattern: /\$\s?[0-9][0-9.,]*/ },
  { kind: 'duration', pattern: /\d+\s*(?:anos?|meses?|dias?)/ },
];
const FINANCIAL_OPERATOR_PATTERN = /no inferior a|no menor a|minimo|maximo|superior a|igual o mayor a/;
const TECHNICAL_SIGNAL_PATTERNS = [/cctv/, /videovigilancia/, /camaras?/, /control de acceso/, /monitoreo/];

// HR-003 (2026-08-11 AGT-002 Rama Judicial human review, governance decision log): the
// governed integral flow classifies RCE and vida colectiva by real textual context —
// never by the old generic /polizas?/ pattern (kept below, unmodified, only for the
// legacy v2 extractLegalGuaranteePolicy/extractLegalRequirements path). No LLM, no
// keyword-presence-implies-compliance: same closed regex/context discipline as every
// other extractor in this module.
const RCE_POLICY_KEYWORD_PATTERN = /responsabilidad civil extracontractual/g;
const COLLECTIVE_LIFE_POLICY_KEYWORD_PATTERN = /vida colectiv[oa]/g;
const EXCLUSION_CONTEXT_WINDOW = 100;
// Post-award execution guarantees (pliego "cronograma" clauses in the style of section
// 110 of SA-24-2026's Pliego de Condiciones Definitivo) are expressly excluded from
// both split requirements per HR-003: a policy required only as a post-adjudication
// contract-execution guarantee is not the pre-award habilitating requirement.
const POST_AWARD_EXECUTION_GUARANTEE_CONTEXT_PATTERN = /ejecucion (?:del )?contrato|posterior(?:es)? a la adjudicacion|ejecucion contractual/;

function normalizeContent(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n');
}

function searchNormalize(value) {
  return value.toLowerCase().normalize('NFD').replace(DIACRITIC_MARKS, '');
}

function isBlank(value) {
  return value.trim().length === 0;
}

function documentIdentity(document) {
  const id = document?.id ?? document?.document_id;
  if (!id || typeof id !== 'string') {
    throw new Error('Cada documento requiere un identificador estable para la extracción de requisitos.');
  }
  return id;
}

function canonicalDocuments(documents) {
  return [...(documents || [])]
    .map(document => {
      const content = normalizeContent(document?.content ?? document?.extracted_text);
      return {
        document_id: documentIdentity(document),
        name: String(document?.name ?? ''),
        document_type: String(document?.document_type ?? ''),
        content,
        search_text: searchNormalize(content),
      };
    })
    .sort((left, right) => left.document_id.localeCompare(right.document_id));
}

function unverifiableDocuments(documents) {
  return documents
    .filter(document => isBlank(document.content))
    .map(document => ({ document_id: document.document_id, name: document.name }));
}

function boundExcerpt(content, matchIndex, matchLength) {
  const start = Math.max(0, matchIndex - EXCERPT_RADIUS);
  const end = Math.min(content.length, matchIndex + matchLength + EXCERPT_RADIUS);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < content.length ? '…' : '';
  const budget = MAX_EXCERPT_LENGTH - prefix.length - suffix.length;
  const raw = content.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, budget);
  return `${prefix}${raw}${suffix}`;
}

function findValuesNear(content, matchIndex, matchLength) {
  const start = Math.max(0, matchIndex - MATERIALITY_WINDOW);
  const end = Math.min(content.length, matchIndex + matchLength + MATERIALITY_WINDOW);
  const region = searchNormalize(content.slice(start, end));
  const values = [];
  for (const { kind, pattern } of VALUE_PATTERNS) {
    const found = region.match(pattern);
    if (found) values.push({ kind, raw: found[0].trim(), normalized: found[0].trim() });
  }
  return values;
}

function hasOperatorNear(content, matchIndex, matchLength) {
  const start = Math.max(0, matchIndex - MATERIALITY_WINDOW);
  const end = Math.min(content.length, matchIndex + matchLength + MATERIALITY_WINDOW);
  return FINANCIAL_OPERATOR_PATTERN.test(searchNormalize(content.slice(start, end)));
}

// HR-003: a match embedded in a post-award execution-guarantee clause (e.g. a
// cronograma entry requiring the policy only from the adjudicatario, after award) is
// excluded from habilitating evidence for both split legal policy requirements.
// Window-based, same discipline as hasOperatorNear/findValuesNear above — local
// context only, never a whole-document heuristic that could suppress an unrelated,
// genuinely habilitating mention elsewhere in the same document.
function isPostAwardExecutionGuaranteeContext(content, matchIndex, matchLength) {
  const start = Math.max(0, matchIndex - EXCLUSION_CONTEXT_WINDOW);
  const end = Math.min(content.length, matchIndex + matchLength + EXCLUSION_CONTEXT_WINDOW);
  return POST_AWARD_EXECUTION_GUARANTEE_CONTEXT_PATTERN.test(searchNormalize(content.slice(start, end)));
}

function collectMatches(documents, keywordPattern) {
  const matches = [];
  for (const document of documents) {
    for (const match of document.search_text.matchAll(keywordPattern)) {
      matches.push({ document, index: match.index, length: match[0].length });
    }
  }
  return matches;
}

function collectEvidence(matches) {
  const evidence = [];
  const seen = new Set();
  for (const { document, index, length } of matches) {
    const excerpt = boundExcerpt(document.content, index, length);
    const key = `${document.document_id}::${excerpt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    evidence.push({
      document_id: document.document_id,
      document_name: document.name,
      document_type: document.document_type,
      excerpt,
    });
  }
  return evidence;
}

function extractLegalGuaranteePolicy(documents) {
  const matches = collectMatches(documents, /polizas?/g);
  const evidence = collectEvidence(matches);
  if (matches.length === 0) {
    return {
      id: 'legal-guarantee-policy', front: 'legal', label: 'Póliza de cumplimiento',
      status: 'pending', severity: 'critical', values: [], evidence: [], confidence: 'low',
      rationale: 'No se encontró mención a póliza de cumplimiento en los documentos disponibles.',
      question: '¿El pliego exige póliza de cumplimiento? Confirmar tipo, cuantía y vigencia con el documento oficial.',
    };
  }
  const values = matches.flatMap(({ document, index, length }) => findValuesNear(document.content, index, length));
  const hasQuantity = values.some(value => value.kind === 'percentage' || value.kind === 'money');
  const hasDuration = values.some(value => value.kind === 'duration');
  if (hasQuantity && hasDuration) {
    return {
      id: 'legal-guarantee-policy', front: 'legal', label: 'Póliza de cumplimiento',
      status: 'confirmed', severity: 'critical', values, evidence, confidence: 'high',
      rationale: 'La póliza de cumplimiento incluye cuantía o porcentaje y vigencia explícitas en el documento.',
      question: null,
    };
  }
  return {
    id: 'legal-guarantee-policy', front: 'legal', label: 'Póliza de cumplimiento',
    status: 'partial', severity: 'critical', values, evidence, confidence: 'medium',
    rationale: 'Se menciona la póliza de cumplimiento, pero falta cuantía/porcentaje o vigencia explícita.',
    question: '¿Cuál es la cuantía o porcentaje y la vigencia exigida para la póliza de cumplimiento mencionada?',
  };
}

// Shared shape for the two HR-003 split legal policy requirements: same evidence/
// values/status discipline as extractLegalGuaranteePolicy above, but with a
// requirement-specific keyword pattern and the post-award execution-guarantee
// exclusion applied before any evidence/value is collected.
function extractContextualLegalPolicy({ documents, requirementId, label, keywordPattern }) {
  const rawMatches = collectMatches(documents, keywordPattern);
  const matches = rawMatches.filter(
    ({ document, index, length }) => !isPostAwardExecutionGuaranteeContext(document.content, index, length),
  );
  const evidence = collectEvidence(matches);
  if (matches.length === 0) {
    return {
      id: requirementId, front: 'legal', label,
      status: 'pending', severity: 'critical', values: [], evidence: [], confidence: 'low',
      rationale: `No se encontró mención habilitante a "${label}" en los documentos disponibles (excluyendo garantías posteriores de ejecución del contrato).`,
      question: `¿El pliego exige "${label}"? Confirmar tipo, cuantía y vigencia con el documento oficial, excluyendo garantías de ejecución posteriores a la adjudicación.`,
    };
  }
  const values = matches.flatMap(({ document, index, length }) => findValuesNear(document.content, index, length));
  const hasQuantity = values.some(value => value.kind === 'percentage' || value.kind === 'money');
  const hasDuration = values.some(value => value.kind === 'duration');
  if (hasQuantity && hasDuration) {
    return {
      id: requirementId, front: 'legal', label,
      status: 'confirmed', severity: 'critical', values, evidence, confidence: 'high',
      rationale: `"${label}" incluye cuantía o porcentaje y vigencia explícitas en el documento, en contexto habilitante (no de ejecución posterior a la adjudicación).`,
      question: null,
    };
  }
  return {
    id: requirementId, front: 'legal', label,
    status: 'partial', severity: 'critical', values, evidence, confidence: 'medium',
    rationale: `Se menciona "${label}" en contexto habilitante, pero falta cuantía/porcentaje o vigencia explícita.`,
    question: `¿Cuál es la cuantía o porcentaje y la vigencia exigida para "${label}"?`,
  };
}

function extractLegalRcePolicyRequirement(documents) {
  return extractContextualLegalPolicy({
    documents,
    requirementId: 'legal-rce-policy',
    label: 'Póliza de responsabilidad civil extracontractual (RCE)',
    keywordPattern: RCE_POLICY_KEYWORD_PATTERN,
  });
}

function extractLegalCollectiveLifePolicyRequirement(documents) {
  return extractContextualLegalPolicy({
    documents,
    requirementId: 'legal-collective-life-policy',
    label: 'Póliza de seguro de vida colectivo',
    keywordPattern: COLLECTIVE_LIFE_POLICY_KEYWORD_PATTERN,
  });
}

function extractFinancialWorkingCapital(documents) {
  const matches = collectMatches(documents, /capital de trabajo/g);
  const evidence = collectEvidence(matches);
  if (matches.length === 0) {
    return {
      id: 'financial-working-capital', front: 'financial', label: 'Capital de trabajo',
      status: 'pending', severity: 'critical', values: [], evidence: [], confidence: 'low',
      rationale: 'No se encontró mención a capital de trabajo en los documentos disponibles.',
      question: '¿El pliego exige un capital de trabajo mínimo? Confirmar el valor exigido con el documento oficial.',
    };
  }
  const values = matches.flatMap(({ document, index, length }) => findValuesNear(document.content, index, length));
  const hasMoney = values.some(value => value.kind === 'money');
  const hasOperator = matches.some(({ document, index, length }) => hasOperatorNear(document.content, index, length));
  if (hasMoney && hasOperator) {
    return {
      id: 'financial-working-capital', front: 'financial', label: 'Capital de trabajo',
      status: 'confirmed', severity: 'critical', values, evidence, confidence: 'high',
      rationale: 'El capital de trabajo exigido incluye operador/condición y valor explícito en el documento.',
      question: null,
    };
  }
  return {
    id: 'financial-working-capital', front: 'financial', label: 'Capital de trabajo',
    status: 'partial', severity: 'critical', values, evidence, confidence: 'medium',
    rationale: 'Se menciona el capital de trabajo exigido, pero falta el operador/condición o el valor umbral explícito.',
    question: '¿Cuál es el valor mínimo de capital de trabajo exigido y bajo qué condición se mide?',
  };
}

function extractTechnicalVideoSurveillanceScope(documents) {
  const signalMatches = TECHNICAL_SIGNAL_PATTERNS
    .map(pattern => collectMatches(documents, new RegExp(pattern.source, 'g')))
    .filter(matches => matches.length > 0);
  if (signalMatches.length === 0) {
    return {
      id: 'technical-video-surveillance-scope', front: 'technical', label: 'Alcance de videovigilancia/CCTV',
      status: 'pending', severity: 'medium', values: [], evidence: [], confidence: 'low',
      rationale: 'No se encontró mención a videovigilancia, CCTV o control de acceso en los documentos disponibles.',
      question: '¿El pliego especifica requisitos de videovigilancia o CCTV?',
    };
  }
  const allMatches = signalMatches.flat();
  const evidence = collectEvidence(allMatches);
  return {
    id: 'technical-video-surveillance-scope', front: 'technical', label: 'Alcance de videovigilancia/CCTV',
    status: 'indication', severity: 'medium', values: [], evidence,
    confidence: signalMatches.length >= 2 ? 'medium' : 'low',
    rationale: 'El documento incluye una referencia contextual a videovigilancia/CCTV; esto es un indicio, no una condición cuantificable confirmada ni cumplimiento.',
    question: '¿Cuáles son las condiciones técnicas exactas (cantidad, cobertura, especificaciones) del componente de videovigilancia mencionado?',
  };
}

export function extractLegalRequirements(documents) {
  const canonical = canonicalDocuments(documents);
  return {
    requirements: [extractLegalGuaranteePolicy(canonical)],
    unverifiable_documents: unverifiableDocuments(canonical),
  };
}

// HR-003 split, for the governed integral flow only. extractLegalRequirements above
// (and therefore extractLegalGuaranteePolicy/legal-guarantee-policy) is left completely
// unmodified for v2 backward compatibility — see AGT002_GOVERNED_REQUIREMENT_CITATION_
// PATTERNS below for the matching closed keyword patterns.
export function extractLegalRcePolicy(documents) {
  const canonical = canonicalDocuments(documents);
  return {
    requirements: [extractLegalRcePolicyRequirement(canonical)],
    unverifiable_documents: unverifiableDocuments(canonical),
  };
}

export function extractLegalCollectiveLifePolicy(documents) {
  const canonical = canonicalDocuments(documents);
  return {
    requirements: [extractLegalCollectiveLifePolicyRequirement(canonical)],
    unverifiable_documents: unverifiableDocuments(canonical),
  };
}

export function extractGovernedLegalRequirements(documents) {
  const canonical = canonicalDocuments(documents);
  return {
    requirements: [extractLegalRcePolicyRequirement(canonical), extractLegalCollectiveLifePolicyRequirement(canonical)],
    unverifiable_documents: unverifiableDocuments(canonical),
  };
}

// Exported so agt002-rama-judicial-governance-draft-generate.mjs (and any future
// governed-flow caller) imports the exact same closed patterns this extractor uses,
// instead of maintaining a private, driftable duplicate.
export const AGT002_GOVERNED_REQUIREMENT_CITATION_PATTERNS = Object.freeze({
  'financial-working-capital': [/capital de trabajo/],
  'legal-rce-policy': [/responsabilidad civil extracontractual/],
  'legal-collective-life-policy': [/vida colectiv[oa]/],
  'technical-video-surveillance-scope': [/cctv/, /videovigilancia/, /camaras?/, /control de acceso/, /monitoreo/],
});

export function extractFinancialRequirements(documents) {
  const canonical = canonicalDocuments(documents);
  return {
    requirements: [extractFinancialWorkingCapital(canonical)],
    unverifiable_documents: unverifiableDocuments(canonical),
  };
}

export function extractTechnicalRequirements(documents) {
  const canonical = canonicalDocuments(documents);
  return {
    requirements: [extractTechnicalVideoSurveillanceScope(canonical)],
    unverifiable_documents: unverifiableDocuments(canonical),
  };
}

// Solo los requisitos con un campo de ficha/RUP numérico comparable entran aquí; el
// requisito técnico de este corte no tiene equivalente cuantificable en la ficha (§9 del
// diseño: no se aceptan equivalencias por similitud textual), por lo que su cruce siempre
// queda `unavailable`.
const COMPANY_PROFILE_CROSSCHECK_CONFIG = {
  'legal-guarantee-policy': { field: 'guarantee_capacity_pct', valueKind: 'percentage', comparison: 'at_least' },
  'financial-working-capital': { field: 'working_capital', valueKind: 'money', comparison: 'at_least' },
};

function parseNumericValue(raw, kind) {
  if (kind === 'percentage') {
    const match = raw.match(/[\d.,]+/);
    return match ? Number(match[0].replace(',', '.')) : null;
  }
  if (kind === 'money') {
    const digits = raw.replace(/[^\d]/g, '');
    return digits ? Number(digits) : null;
  }
  return null;
}

function crosscheckRequirement(requirement, companyProfile) {
  const config = COMPANY_PROFILE_CROSSCHECK_CONFIG[requirement.id];
  if (!config) return { status: 'unavailable', company_evidence: null };

  const requiredValue = requirement.values.find(value => value.kind === config.valueKind);
  if (!requiredValue) return { status: 'unavailable', company_evidence: null };

  const requiredNumber = parseNumericValue(requiredValue.raw, config.valueKind);
  const companyRaw = companyProfile?.[config.field];
  if (requiredNumber == null || typeof companyRaw !== 'number' || !Number.isFinite(companyRaw)) {
    return { status: 'unavailable', company_evidence: null };
  }

  if (requirement.status === 'partial') {
    return {
      status: 'partial',
      company_evidence: `La ficha declara ${config.field} = ${companyRaw}, pero el requisito del pliego no precisa aún el valor/vigencia completos para comparar con certeza.`,
    };
  }

  const meetsThreshold = config.comparison === 'at_least' ? companyRaw >= requiredNumber : companyRaw <= requiredNumber;
  if (meetsThreshold) {
    return {
      status: 'match',
      company_evidence: `La ficha declara ${config.field} = ${companyRaw}, que cumple el umbral exigido (${requiredNumber}).`,
    };
  }
  return {
    status: 'gap',
    company_evidence: `La ficha declara ${config.field} = ${companyRaw}, por debajo del umbral exigido (${requiredNumber}).`,
  };
}

export function crosscheckCompanyProfile(requirements, companyProfile) {
  const profile = companyProfile || {};
  return requirements.map(requirement => ({
    ...requirement,
    company_crosscheck: crosscheckRequirement(requirement, profile),
  }));
}

function isRequirementCritical(requirement) {
  return requirement.severity === 'critical'
    && (requirement.status === 'pending' || requirement.status === 'unverifiable' || requirement.company_crosscheck.status === 'gap');
}

function dedupeUnverifiableDocuments(entries) {
  const seen = new Set();
  const result = [];
  for (const entry of [...entries].sort((left, right) => left.document_id.localeCompare(right.document_id))) {
    if (seen.has(entry.document_id)) continue;
    seen.add(entry.document_id);
    result.push(entry);
  }
  return result;
}

function assembleRequirementAnalysis(legal, financial, technical, companyProfile) {
  const legalWithCrosscheck = crosscheckCompanyProfile(legal.requirements, companyProfile);
  const financialWithCrosscheck = crosscheckCompanyProfile(financial.requirements, companyProfile);
  const technicalWithCrosscheck = crosscheckCompanyProfile(technical.requirements, companyProfile);
  const allRequirements = [...legalWithCrosscheck, ...financialWithCrosscheck, ...technicalWithCrosscheck];

  const unverifiableDocumentsFound = dedupeUnverifiableDocuments([
    ...legal.unverifiable_documents,
    ...financial.unverifiable_documents,
    ...technical.unverifiable_documents,
  ]);

  const coverage = {
    total: allRequirements.length,
    confirmed: allRequirements.filter(requirement => requirement.status === 'confirmed').length,
    partial: allRequirements.filter(requirement => requirement.status === 'partial').length,
    indication: allRequirements.filter(requirement => requirement.status === 'indication').length,
    pending: allRequirements.filter(requirement => requirement.status === 'pending').length,
    unverifiable: allRequirements.filter(requirement => requirement.status === 'unverifiable').length,
    unverifiable_documents: unverifiableDocumentsFound.length,
  };

  const strengths = allRequirements
    .filter(requirement => requirement.company_crosscheck.status === 'match')
    .map(requirement => `${requirement.label}: ${requirement.company_crosscheck.company_evidence}`);

  const weaknesses = allRequirements
    .filter(requirement => requirement.status === 'partial' || requirement.status === 'indication' || requirement.company_crosscheck.status === 'gap')
    .map(requirement => `${requirement.label}: ${requirement.rationale}`);

  const blockers = allRequirements
    .filter(isRequirementCritical)
    .map(requirement => `${requirement.label}: ${requirement.rationale}`);

  const questions = allRequirements
    .filter(requirement => typeof requirement.question === 'string' && requirement.question.length > 0)
    .map(requirement => ({
      id: requirement.id,
      front: requirement.front,
      question: requirement.question,
      critical: isRequirementCritical(requirement),
    }));

  const unverified = allRequirements
    .filter(requirement => requirement.status === 'indication')
    .map(requirement => `${requirement.label}: ${requirement.rationale}`);

  const next_action = blockers.length
    ? `Completar evidencia crítica pendiente antes de decidir: ${blockers.length} bloqueador(es) abierto(s).`
    : questions.some(question => question.critical)
      ? 'Resolver preguntas críticas abiertas antes de decidir.'
      : questions.length
        ? 'Resolver dudas abiertas antes de decidir.'
        : 'Base documental suficiente para revisión; no hay bloqueadores ni preguntas críticas abiertas en este corte.';

  return {
    legal: legalWithCrosscheck,
    financial: financialWithCrosscheck,
    technical: technicalWithCrosscheck,
    coverage,
    strengths,
    weaknesses,
    blockers,
    questions,
    unverified,
    next_action,
    unverifiable_documents: unverifiableDocumentsFound,
  };
}

export function buildRequirementAnalysis(documents, companyProfile) {
  const legal = extractLegalRequirements(documents);
  const financial = extractFinancialRequirements(documents);
  const technical = extractTechnicalRequirements(documents);
  return assembleRequirementAnalysis(legal, financial, technical, companyProfile);
}

// HR-003, governed integral flow only: same assembly discipline as
// buildRequirementAnalysis above (coverage/strengths/weaknesses/blockers/questions/
// next_action), but sourcing the legal front from the two split, closed requirements
// instead of the generic legal-guarantee-policy. financial/technical fronts are
// unchanged. Never used by the v2 legacy path (tender-deep-analysis.js/server
// preanalysis) — see scripts/agt002-rama-judicial-governance-draft-generate.mjs for
// the one real caller today.
export function buildGovernedRequirementAnalysis(documents, companyProfile) {
  const legal = extractGovernedLegalRequirements(documents);
  const financial = extractFinancialRequirements(documents);
  const technical = extractTechnicalRequirements(documents);
  return assembleRequirementAnalysis(legal, financial, technical, companyProfile);
}
