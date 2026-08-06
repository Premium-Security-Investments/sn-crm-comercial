export const AGT002_CONTEXT_VERSION = 2;
export const AGT002_CONTEXT_V2_MAX_TEXT_CHARS = 4000;
export const AGT002_CONTEXT_V2_MAX_ITEMS = 100;
export const AGT002_CONTEXT_V2_MAX_CHARS = 65536;

const ROOT_KEYS = ['snapshot_id', 'opportunity', 'company_dossier', 'commercial_context', 'human_evidence'];
const OPPORTUNITY_KEYS = [
  'opportunity_id', 'tender_id', 'title', 'entity', 'modality', 'budget', 'currency',
  'published_at', 'submission_deadline', 'place', 'duration', 'status', 'official_source',
  'source_url', 'owner_id', 'owner_name', 'conversion_reason', 'authorized_notes',
];
const COMPANY_DOSSIER_KEYS = [
  'legal_name', 'nit', 'rup_status', 'rup_updated_at', 'unspsc_codes', 'services', 'licenses',
  'financial_capacity', 'organizational_capacity', 'experience', 'certifications',
  'recurring_documents', 'restrictions',
];
const COMMERCIAL_CONTEXT_KEYS = [
  'opportunity_status', 'commercial_owner', 'account_relationship', 'next_action', 'due_at', 'authorized_notes',
];
const SOURCED_VALUE_KEYS = ['status', 'value', 'source'];
// Optional sibling of status/value/source: whether a piece of evidence applies to the
// specific case/tender being analyzed. Kept strictly optional and generic to every
// sourced value (not special-cased to company_dossier.licenses) — most fields never set
// it, so its absence must never be treated as a missing required key.
const SOURCED_VALUE_OPTIONAL_KEYS = ['applicability_status'];
const APPLICABILITY_STATUSES = new Set(['pending_case_validation', 'applicable', 'not_applicable']);
const SOURCE_KEYS = ['type', 'reference', 'observed_at', 'label', 'expires_at'];
const HUMAN_EVIDENCE_KEYS = [
  'answer_id', 'question_id', 'question_text', 'status', 'response', 'evidence_notes',
  'responded_by', 'responded_at', 'analysis_run_id', 'source',
];
const SOURCE_TYPES = new Set(['database', 'official_document', 'human', 'system']);
const VALUE_STATUSES = new Set(['verified', 'reported', 'not_verified']);
const HUMAN_STATUSES = new Set(['pending', 'resolved', 'not_applicable']);

function rejectUnknownKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} debe ser un objeto.`);
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter(key => !allowedSet.has(key));
  if (unknown.length) throw new Error(`${label} contiene una clave no permitida o desconocida: ${unknown.sort().join(', ')}.`);
}

function requireCompleteKeys(value, required, label) {
  const missing = required.filter(key => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing.length) throw new Error(`${label} requiere campos explícitos, incluso como not_verified: ${missing.join(', ')}.`);
}

// Narrow exception: a 6-20 digit number immediately after "Resolución" (optionally via
// "No.", "No", "Núm.", "N°"/"Nº") is an administrative act number, not a phone number —
// e.g. "Resolución 20214100005697" — so it must survive the phone redaction below intact.
// Everything else (phones without that prefix, cedulas/NIT, emails, bearer/API secrets)
// keeps redacting exactly as before. Digits are swapped for a printable placeholder
// before the other patterns run, then restored verbatim, so this can never widen what
// the phone/ID patterns themselves match elsewhere in the text. Printable sentinels
// avoid embedding NUL bytes in this JavaScript source file.
const RESOLUTION_NUMBER_RE = /(\bResoluci[oó]n\s*(?:No\.?|N[uú]m\.?|N[°º])?\s*)(\d{6,20})\b/gi;

function protectResolutionNumbers(text) {
  const numbers = [];
  const protectedText = text.replace(RESOLUTION_NUMBER_RE, (_match, prefix, digits) => {
    const token = `__AGT002_RESOLUTION_NUMBER_${numbers.length}__`;
    numbers.push(digits);
    return `${prefix}${token}`;
  });
  return { protectedText, numbers };
}

function restoreResolutionNumbers(text, numbers) {
  return numbers.reduce((acc, digits, index) => acc.replaceAll(`__AGT002_RESOLUTION_NUMBER_${index}__`, digits), text);
}

function redactText(value) {
  const { protectedText, numbers } = protectResolutionNumbers(String(value ?? ''));
  const redacted = protectedText
    .replace(/\b(?:c[eé]dula|cc|nit)\s*[:#-]?\s*[0-9][0-9.\s-]{5,}[0-9]\b/gi, '[REDACTED_ID]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?){2}\d{4}\b/g, '[REDACTED_PHONE]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED_SECRET]')
    .replace(/\b(?:sk|pk|api)[-_][A-Za-z0-9._~-]{8,}\b/gi, '[REDACTED_SECRET]')
    .replace(/([?&](?:token|key|signature|sig|secret|authorization)=)[^&#\s]+/gi, '$1[REDACTED_SECRET]');
  return restoreResolutionNumbers(redacted, numbers);
}

function normalizeText(value, label, { nullable = false, max = AGT002_CONTEXT_V2_MAX_TEXT_CHARS, redact = true } = {}) {
  if (value == null && nullable) return null;
  if (typeof value !== 'string') throw new Error(`${label} debe ser texto${nullable ? ' o null' : ''}.`);
  const normalized = (redact ? redactText(value) : String(value)).trim();
  if (!normalized && !nullable) throw new Error(`${label} no puede estar vacío.`);
  if (normalized.length > max) throw new Error(`${label} excede el límite de longitud de ${max} caracteres.`);
  return normalized || null;
}

function normalizeTimestamp(value, label, { nullable = false } = {}) {
  const text = normalizeText(value, label, { nullable, max: 100 });
  if (text == null) return null;
  if (Number.isNaN(Date.parse(text))) throw new Error(`${label} debe ser una fecha ISO válida.`);
  return text;
}

function normalizeSource(raw, label) {
  rejectUnknownKeys(raw, SOURCE_KEYS, label);
  if (!SOURCE_TYPES.has(raw.type)) throw new Error(`${label}.type no es permitido.`);
  const normalized = {
    type: raw.type,
    reference: normalizeText(raw.reference, `${label}.reference`, { max: 500 }),
    observed_at: normalizeTimestamp(raw.observed_at, `${label}.observed_at`),
  };
  if (raw.label != null) normalized.label = normalizeText(raw.label, `${label}.label`, { max: 500 });
  if (raw.expires_at != null) normalized.expires_at = normalizeTimestamp(raw.expires_at, `${label}.expires_at`);
  return normalized;
}

function normalizeScalar(value, label, { redact = true } = {}) {
  if (typeof value === 'string') return normalizeText(value, label, { redact });
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label} debe ser un número finito.`);
    return value;
  }
  if (typeof value === 'boolean') return value;
  throw new Error(`${label} sólo permite texto, número o booleano.`);
}

function normalizeEvidenceValue(value, label, { redact = true } = {}) {
  if (!Array.isArray(value)) return normalizeScalar(value, label, { redact });
  if (value.length > AGT002_CONTEXT_V2_MAX_ITEMS) throw new Error(`${label} supera el máximo de ${AGT002_CONTEXT_V2_MAX_ITEMS} elementos.`);
  const normalized = value.map((item, index) => normalizeScalar(item, `${label}[${index}]`, { redact }));
  return normalized.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function normalizeSourcedValue(raw, label, { redact = true } = {}) {
  rejectUnknownKeys(raw, [...SOURCED_VALUE_KEYS, ...SOURCED_VALUE_OPTIONAL_KEYS], label);
  requireCompleteKeys(raw, SOURCED_VALUE_KEYS, label);
  if (!VALUE_STATUSES.has(raw.status)) throw new Error(`${label}.status no es permitido.`);
  if (raw.status === 'not_verified' && raw.value !== null) throw new Error(`${label} con estado not_verified debe tener value null.`);
  if (raw.status !== 'not_verified' && raw.value == null) throw new Error(`${label} requiere value cuando está verificado o reportado.`);
  const normalized = {
    status: raw.status,
    value: raw.status === 'not_verified' ? null : normalizeEvidenceValue(raw.value, `${label}.value`, { redact }),
    source: normalizeSource(raw.source, `${label}.source`),
  };
  if (raw.applicability_status !== undefined) {
    if (!APPLICABILITY_STATUSES.has(raw.applicability_status)) throw new Error(`${label}.applicability_status no es permitido.`);
    normalized.applicability_status = raw.applicability_status;
  }
  return normalized;
}

function normalizeSection(raw, keys, label) {
  rejectUnknownKeys(raw, keys, label);
  requireCompleteKeys(raw, keys, label);
  return Object.fromEntries(keys.map(key => [
    key,
    normalizeSourcedValue(raw[key], `${label}.${key}`, { redact: !key.endsWith('_id') }),
  ]));
}

function normalizeHumanEvidence(raw) {
  if (!Array.isArray(raw)) throw new Error('human_evidence debe ser una lista.');
  if (raw.length > AGT002_CONTEXT_V2_MAX_ITEMS) throw new Error(`human_evidence supera el máximo de ${AGT002_CONTEXT_V2_MAX_ITEMS} elementos.`);
  const normalized = raw.map((item, index) => {
    const label = `human_evidence[${index}]`;
    rejectUnknownKeys(item, HUMAN_EVIDENCE_KEYS, label);
    requireCompleteKeys(item, HUMAN_EVIDENCE_KEYS, label);
    if (!HUMAN_STATUSES.has(item.status)) throw new Error(`${label}.status no es permitido.`);
    return {
      answer_id: normalizeText(item.answer_id, `${label}.answer_id`, { max: 200, redact: false }),
      question_id: normalizeText(item.question_id, `${label}.question_id`, { max: 200, redact: false }),
      question_text: normalizeText(item.question_text, `${label}.question_text`),
      status: item.status,
      response: normalizeText(item.response, `${label}.response`),
      evidence_notes: normalizeText(item.evidence_notes, `${label}.evidence_notes`, { nullable: true }),
      responded_by: normalizeText(item.responded_by, `${label}.responded_by`, { max: 500 }),
      responded_at: normalizeTimestamp(item.responded_at, `${label}.responded_at`),
      analysis_run_id: normalizeText(item.analysis_run_id, `${label}.analysis_run_id`, { max: 200, redact: false }),
      source: normalizeSource(item.source, `${label}.source`),
    };
  });
  const seen = new Set();
  for (const item of normalized) {
    if (seen.has(item.answer_id)) throw new Error(`human_evidence contiene answer_id duplicado: ${item.answer_id}.`);
    seen.add(item.answer_id);
  }
  return normalized.sort((left, right) => left.answer_id.localeCompare(right.answer_id));
}

export function buildAgt002ContextV2(raw) {
  rejectUnknownKeys(raw, ROOT_KEYS, 'El contexto v2');
  requireCompleteKeys(raw, ROOT_KEYS, 'El contexto v2');
  const context = {
    context_version: AGT002_CONTEXT_VERSION,
    snapshot_id: normalizeText(raw.snapshot_id, 'snapshot_id', { max: 200, redact: false }),
    opportunity: normalizeSection(raw.opportunity, OPPORTUNITY_KEYS, 'opportunity'),
    company_dossier: normalizeSection(raw.company_dossier, COMPANY_DOSSIER_KEYS, 'company_dossier'),
    commercial_context: normalizeSection(raw.commercial_context, COMMERCIAL_CONTEXT_KEYS, 'commercial_context'),
    human_evidence: normalizeHumanEvidence(raw.human_evidence),
  };
  if (JSON.stringify(context).length > AGT002_CONTEXT_V2_MAX_CHARS) {
    throw new Error(`El contexto v2 excede el límite total de ${AGT002_CONTEXT_V2_MAX_CHARS} caracteres.`);
  }
  return context;
}

export const AGT002_CONTEXT_V2_FIELDS = Object.freeze({
  opportunity: Object.freeze([...OPPORTUNITY_KEYS]),
  company_dossier: Object.freeze([...COMPANY_DOSSIER_KEYS]),
  commercial_context: Object.freeze([...COMMERCIAL_CONTEXT_KEYS]),
});
