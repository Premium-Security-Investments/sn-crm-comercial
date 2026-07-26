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
