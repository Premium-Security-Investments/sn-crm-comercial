const TOP_LEVEL_KEYS = ['schema_version', 'extracted_values', 'unverifiable_documents', 'integrity_checks'];
const VALUE_KEYS = ['requirement_id', 'front', 'kind', 'raw', 'normalized', 'evidence_refs'];
const DOCUMENT_KEYS = ['document_id', 'name'];
const CHECK_KEYS = ['code', 'status', 'count'];
const VALUE_KINDS = new Set(['date', 'money', 'percentage', 'duration']);
const CHECK_STATUSES = new Set(['passed', 'warning']);
const FRONTS = new Set(['legal', 'financial', 'technical']);
const MAX_VALUES = 500;
const MAX_DOCUMENTS = 100;

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} debe ser un objeto.`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${label}: clave no permitida: ${key}.`);
  }
  for (const key of allowed) {
    if (!Object.hasOwn(value, key)) throw new Error(`${label}: falta la clave obligatoria ${key}.`);
  }
}

function boundedString(value, max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

function stableUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function validateAgt002ObjectiveValidations(value) {
  exactKeys(value, TOP_LEVEL_KEYS, 'Las validaciones objetivas');
  if (value.schema_version !== '1.0') throw new Error('La versión de validaciones objetivas no es válida.');
  if (!Array.isArray(value.extracted_values) || value.extracted_values.length > MAX_VALUES) throw new Error('Los valores extraídos no son válidos.');
  if (!Array.isArray(value.unverifiable_documents) || value.unverifiable_documents.length > MAX_DOCUMENTS) throw new Error('Los documentos no verificables no son válidos.');
  if (!Array.isArray(value.integrity_checks) || value.integrity_checks.length > 20) throw new Error('Los controles de integridad no son válidos.');

  for (const item of value.extracted_values) {
    exactKeys(item, VALUE_KEYS, 'Valor extraído');
    if (!boundedString(item.requirement_id) || !FRONTS.has(item.front) || !VALUE_KINDS.has(item.kind)) throw new Error('Valor extraído inválido.');
    if (!boundedString(item.raw) || !boundedString(item.normalized)) throw new Error('Valor extraído sin contenido.');
    if (!Array.isArray(item.evidence_refs) || item.evidence_refs.some(ref => !/^document:[^\s]+$/.test(ref))) throw new Error('Referencias de evidencia inválidas.');
  }
  for (const item of value.unverifiable_documents) {
    exactKeys(item, DOCUMENT_KEYS, 'Documento no verificable');
    if (!boundedString(item.document_id) || typeof item.name !== 'string') throw new Error('Documento no verificable inválido.');
  }
  for (const item of value.integrity_checks) {
    exactKeys(item, CHECK_KEYS, 'Control de integridad');
    if (!boundedString(item.code) || !CHECK_STATUSES.has(item.status) || !Number.isInteger(item.count) || item.count < 0) throw new Error('Control de integridad inválido.');
  }
  return value;
}

export function buildAgt002ObjectiveValidations(deepAnalysis = {}) {
  const extractedValues = [];
  const matrix = deepAnalysis?.matrix && typeof deepAnalysis.matrix === 'object' ? deepAnalysis.matrix : {};
  for (const front of [...FRONTS]) {
    for (const requirement of Array.isArray(matrix[front]) ? matrix[front] : []) {
      const requirementId = boundedString(requirement?.id, 120);
      if (!requirementId) continue;
      const evidenceRefs = stableUnique((Array.isArray(requirement?.evidence) ? requirement.evidence : [])
        .map(item => boundedString(item?.document_id, 180))
        .filter(Boolean)
        .map(id => `document:${id}`));
      for (const entry of Array.isArray(requirement?.values) ? requirement.values : []) {
        const kind = boundedString(entry?.kind, 40);
        const raw = boundedString(entry?.raw);
        const normalized = boundedString(entry?.normalized ?? entry?.raw);
        if (!VALUE_KINDS.has(kind) || !raw || !normalized) continue;
        extractedValues.push({ requirement_id: requirementId, front, kind, raw, normalized, evidence_refs: evidenceRefs });
      }
    }
  }
  extractedValues.sort((left, right) => left.requirement_id.localeCompare(right.requirement_id)
    || left.kind.localeCompare(right.kind)
    || left.raw.localeCompare(right.raw));

  const documents = [];
  const seenDocuments = new Set();
  for (const item of Array.isArray(deepAnalysis?.unverifiable_documents) ? deepAnalysis.unverifiable_documents : []) {
    const documentId = boundedString(item?.document_id, 180);
    if (!documentId || seenDocuments.has(documentId)) continue;
    seenDocuments.add(documentId);
    documents.push({ document_id: documentId, name: boundedString(item?.name, 300) });
  }
  documents.sort((left, right) => left.document_id.localeCompare(right.document_id));

  return validateAgt002ObjectiveValidations({
    schema_version: '1.0',
    extracted_values: extractedValues.slice(0, MAX_VALUES),
    unverifiable_documents: documents.slice(0, MAX_DOCUMENTS),
    integrity_checks: [
      { code: 'extracted_value_count', status: 'passed', count: extractedValues.length },
      { code: 'unverifiable_document_count', status: documents.length ? 'warning' : 'passed', count: documents.length },
    ],
  });
}
