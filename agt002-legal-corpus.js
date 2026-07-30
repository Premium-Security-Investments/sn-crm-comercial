export const AGT002_LEGAL_OFFICIAL_HOSTS = Object.freeze([
  'funcionpublica.gov.co',
  'suin-juriscol.gov.co',
  'colombiacompra.gov.co',
  'supervigilancia.gov.co',
]);

export const AGT002_LEGAL_MODIFICATION_TYPES = Object.freeze(['modification', 'derogation']);
export const AGT002_LEGAL_MODIFICATION_SCOPES = Object.freeze(['partial', 'total']);
export const AGT002_LEGAL_RESOLUTION_STATUSES = Object.freeze(['resolved', 'unresolved']);

// Explicit, closed states carried on every source record (Principle 8: identity, provenance,
// version, vigencia and consultation date). These are declarations by whoever curates/verifies
// the corpus entry — evaluateAgt002LegalSourceStatus combines them with as_of-relative dates and
// modification resolution; it never infers them from dates alone.
export const AGT002_LEGAL_SOURCE_VERIFICATION_STATUSES = Object.freeze(['verified', 'unverified']);
export const AGT002_LEGAL_SOURCE_VALIDITY_STATUSES = Object.freeze(['confirmed', 'uncertain']);
export const AGT002_LEGAL_SOURCE_APPLICABILITY_STATUSES = Object.freeze(['applicable', 'uncertain', 'not_applicable']);

export const AGT002_LEGAL_REVIEW_REASONS = Object.freeze([
  'applicability_uncertain',
  'expired',
  'issuance_date_uncertain',
  'modification_unresolved',
  'no_eligible_source',
  'not_applicable_derogated',
  'not_yet_effective',
  'source_unverified',
  'stale_verification',
  'validity_uncertain',
  'verification_date_in_future',
]);

export const AGT002_LEGAL_CONCLUSION_STATUSES = new Set(['verified_law', 'requires_human_legal_review']);

export const AGT002_LEGAL_DEFAULT_STALE_AFTER_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

const MAX_ID_LENGTH = 128;
const MAX_SHORT_LENGTH = 300;
const MAX_URL_LENGTH = 2048;
const MAX_CURRENT_TEXT_LENGTH = 20000;
const MAX_STATEMENT_LENGTH = 2000;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 80;
const MAX_MODIFICATIONS = 50;
const MIN_YEAR = 1810;
const MAX_YEAR = 2100;

// Closed identity pattern: lowercase alnum plus '.', '_', '-' only. No ':' or other separator
// characters, so citation_id (built by joining identity parts with ':') can never collide or be
// ambiguously re-split regardless of which values are concatenated.
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

const SOURCE_KEYS = [
  'source_id', 'norm_type', 'norm_number', 'year', 'article_or_section', 'current_text',
  'issuing_authority', 'issued_at', 'effective_from', 'effective_to', 'modifications',
  'official_url', 'topic', 'sector', 'verified_at', 'corpus_version',
  'verification_status', 'validity_status', 'applicability_status',
];
const MODIFICATION_KEYS = [
  'modification_id', 'modifying_norm_id', 'modification_type', 'scope', 'effective_date', 'official_url', 'resolution_status',
];
const CITATION_KEYS = [
  'citation_id', 'source_id', 'norm_type', 'norm_number', 'year', 'article_or_section',
  'issuing_authority', 'official_url', 'verified_at', 'corpus_version', 'label',
];
const CONCLUSION_KEYS = ['status', 'statement', 'citations', 'reasons'];

// Fields that would grant AGT-002 legal-conclusion authority to decide, approve, sign, send
// or submit. These stay outside the closed contract even under a plausible-looking key name.
const FORBIDDEN_AUTHORITY_KEYS = [
  'go', 'no_go', 'go_no_go', 'decision', 'approval', 'approved', 'signature', 'signed',
  'submission', 'submitted', 'authorized_by', 'authorization',
];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z)?$/;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function rejectUnknownKeys(value, allowed, label) {
  if (!isRecord(value)) throw new Error(`${label} debe ser un objeto.`);
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter(key => !allowedSet.has(key));
  if (unknown.length) throw new Error(`${label} contiene una clave no permitida o desconocida: ${unknown.sort().join(', ')}.`);
}

function requireBoundedString(value, label, maxLength) {
  if (typeof value !== 'string') throw new Error(`${label} debe ser texto.`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} debe ser texto no vacío.`);
  if (trimmed.length > maxLength) throw new Error(`${label} excede la longitud máxima permitida.`);
  return trimmed;
}

function requireIdString(value, label) {
  const trimmed = requireBoundedString(value, label, MAX_ID_LENGTH);
  if (!ID_PATTERN.test(trimmed)) {
    throw new Error(`${label} debe usar solo minúsculas, dígitos, punto, guion o guion bajo, y comenzar con minúscula o dígito (sin espacios ni separadores libres).`);
  }
  return trimmed;
}

function parseIsoDate(value, label) {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) {
    throw new Error(`${label} debe ser una fecha ISO 8601 válida (YYYY-MM-DD o YYYY-MM-DDTHH:mm:ssZ).`);
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`${label} debe ser una fecha ISO 8601 válida.`);
  const [datePart] = value.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const roundTrip = new Date(Date.UTC(y, m - 1, d));
  if (roundTrip.getUTCFullYear() !== y || roundTrip.getUTCMonth() !== m - 1 || roundTrip.getUTCDate() !== d) {
    throw new Error(`${label} no es una fecha calendario válida.`);
  }
  return { raw: value, ms, year: y };
}

/**
 * Contractual offline classification only — never a network check. `official_url` values are
 * validated against a closed, exported host allowlist aligned to the future curated manifest
 * (Función Pública, SUIN/Juriscol, Colombia Compra Eficiente, Supervigilancia).
 */
export function isAgt002OfficialLegalUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_URL_LENGTH) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (url.port) return false;
  if (url.hash) return false;
  const host = url.hostname.toLowerCase();
  return AGT002_LEGAL_OFFICIAL_HOSTS.some(root => host === root || host.endsWith(`.${root}`));
}

function requireOfficialUrl(value, label) {
  const trimmed = requireBoundedString(value, label, MAX_URL_LENGTH);
  if (!isAgt002OfficialLegalUrl(trimmed)) {
    throw new Error(`${label} debe ser HTTPS y pertenecer a un host oficial permitido (allowlist cerrada).`);
  }
  return trimmed;
}

function normalizeTagList(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} debe ser una lista de etiquetas no vacía.`);
  }
  if (value.length > MAX_TAGS) throw new Error(`${label} excede el máximo de etiquetas permitido.`);
  const normalized = value.map((tag, index) => {
    if (typeof tag !== 'string' || !tag.trim()) throw new Error(`${label}[${index}] debe ser texto no vacío.`);
    const cleaned = tag.trim().replace(/\s+/g, ' ').toLowerCase();
    if (cleaned.length > MAX_TAG_LENGTH) throw new Error(`${label}[${index}] excede la longitud máxima permitida.`);
    return cleaned;
  });
  return [...new Set(normalized)].sort();
}

function validateModification(raw, index, sourceIssuedAt) {
  const label = `modifications[${index}]`;
  rejectUnknownKeys(raw, MODIFICATION_KEYS, label);
  const modificationId = requireIdString(raw.modification_id, `${label}.modification_id`);
  const modifyingNormId = requireIdString(raw.modifying_norm_id, `${label}.modifying_norm_id`);
  if (!AGT002_LEGAL_MODIFICATION_TYPES.includes(raw.modification_type)) {
    throw new Error(`${label}.modification_type debe ser modification o derogation.`);
  }
  if (!AGT002_LEGAL_MODIFICATION_SCOPES.includes(raw.scope)) {
    throw new Error(`${label}.scope debe ser partial o total.`);
  }
  if (!AGT002_LEGAL_RESOLUTION_STATUSES.includes(raw.resolution_status)) {
    throw new Error(`${label}.resolution_status debe ser resolved o unresolved.`);
  }

  // A resolved modification/derogation must be fully verifiable: known effective date and an
  // official source. Only an unresolved one may leave both null — that incompleteness is exactly
  // what forces human review at evaluation time.
  const isResolved = raw.resolution_status === 'resolved';
  if (isResolved && raw.effective_date == null) {
    throw new Error(`${label}.effective_date es obligatorio cuando resolution_status es resolved.`);
  }
  if (isResolved && raw.official_url == null) {
    throw new Error(`${label}.official_url es obligatorio cuando resolution_status es resolved.`);
  }

  const effectiveDate = raw.effective_date == null ? null : parseIsoDate(raw.effective_date, `${label}.effective_date`);
  if (effectiveDate && sourceIssuedAt && effectiveDate.ms < sourceIssuedAt.ms) {
    throw new Error(`${label}.effective_date no puede ser anterior a issued_at de la fuente.`);
  }
  const officialUrl = raw.official_url == null ? null : requireOfficialUrl(raw.official_url, `${label}.official_url`);

  return {
    modification_id: modificationId,
    modifying_norm_id: modifyingNormId,
    modification_type: raw.modification_type,
    scope: raw.scope,
    effective_date: effectiveDate ? effectiveDate.raw : null,
    official_url: officialUrl,
    resolution_status: raw.resolution_status,
  };
}

/**
 * Validates and normalizes one canonical Colombian legal-source record. Rejects unknown keys,
 * invalid/incoherent dates, non-official URLs and unbounded/ambiguous fields. Never mutates
 * `raw`; the returned object is JSON-serializable with a stable key order.
 */
export function buildAgt002LegalSource(raw) {
  rejectUnknownKeys(raw, SOURCE_KEYS, 'La fuente normativa');

  const sourceId = requireIdString(raw.source_id, 'source_id');
  const normType = requireBoundedString(raw.norm_type, 'norm_type', MAX_SHORT_LENGTH);
  const normNumber = requireBoundedString(raw.norm_number, 'norm_number', MAX_SHORT_LENGTH);
  const articleOrSection = requireBoundedString(raw.article_or_section, 'article_or_section', MAX_SHORT_LENGTH);
  const issuingAuthority = requireBoundedString(raw.issuing_authority, 'issuing_authority', MAX_SHORT_LENGTH);
  const corpusVersion = requireIdString(raw.corpus_version, 'corpus_version');

  if (!AGT002_LEGAL_SOURCE_VERIFICATION_STATUSES.includes(raw.verification_status)) {
    throw new Error('verification_status debe ser verified o unverified.');
  }
  if (!AGT002_LEGAL_SOURCE_VALIDITY_STATUSES.includes(raw.validity_status)) {
    throw new Error('validity_status debe ser confirmed o uncertain.');
  }
  if (!AGT002_LEGAL_SOURCE_APPLICABILITY_STATUSES.includes(raw.applicability_status)) {
    throw new Error('applicability_status debe ser applicable, uncertain o not_applicable.');
  }

  if (typeof raw.current_text !== 'string' || !raw.current_text.trim()) {
    throw new Error('current_text debe ser texto no vacío.');
  }
  if (raw.current_text.length > MAX_CURRENT_TEXT_LENGTH) {
    throw new Error('current_text excede la longitud máxima permitida.');
  }
  const currentText = raw.current_text.trim();

  if (!Number.isInteger(raw.year) || raw.year < MIN_YEAR || raw.year > MAX_YEAR) {
    throw new Error(`year debe ser un entero entre ${MIN_YEAR} y ${MAX_YEAR}.`);
  }

  const issuedAt = raw.issued_at == null ? null : parseIsoDate(raw.issued_at, 'issued_at');
  if (issuedAt && issuedAt.year !== raw.year) {
    throw new Error('year debe coincidir con el año de issued_at.');
  }
  const effectiveFrom = raw.effective_from == null ? null : parseIsoDate(raw.effective_from, 'effective_from');
  const effectiveTo = raw.effective_to == null ? null : parseIsoDate(raw.effective_to, 'effective_to');
  if (issuedAt && effectiveFrom && effectiveFrom.ms < issuedAt.ms) {
    throw new Error('effective_from no puede ser anterior a issued_at.');
  }
  if (effectiveFrom && effectiveTo && effectiveTo.ms <= effectiveFrom.ms) {
    throw new Error('effective_to debe ser posterior a effective_from.');
  }
  if (issuedAt && effectiveTo && !effectiveFrom && effectiveTo.ms < issuedAt.ms) {
    throw new Error('effective_to no puede ser anterior a issued_at.');
  }
  // A source cannot declare its vigencia as confirmed without an effective_from: "confirmed" is a
  // positive assertion that in-force status is known, which is meaningless without a start date.
  if (raw.validity_status === 'confirmed' && !effectiveFrom) {
    throw new Error('validity_status confirmed exige effective_from; sin fecha de inicio la vigencia no puede darse por confirmada.');
  }

  const verifiedAt = parseIsoDate(raw.verified_at, 'verified_at');
  const officialUrl = requireOfficialUrl(raw.official_url, 'official_url');
  const topic = normalizeTagList(raw.topic, 'topic');
  const sector = normalizeTagList(raw.sector, 'sector');

  if (!Array.isArray(raw.modifications)) throw new Error('modifications debe ser una lista.');
  if (raw.modifications.length > MAX_MODIFICATIONS) throw new Error('modifications excede el máximo permitido.');
  const modifications = raw.modifications.map((modification, index) => validateModification(modification, index, issuedAt));
  const seenModificationIds = new Set();
  for (const modification of modifications) {
    if (seenModificationIds.has(modification.modification_id)) {
      throw new Error(`modification_id duplicado: ${modification.modification_id}.`);
    }
    seenModificationIds.add(modification.modification_id);
  }
  modifications.sort((left, right) => (
    (left.effective_date ?? '').localeCompare(right.effective_date ?? '') || left.modification_id.localeCompare(right.modification_id)
  ));

  return {
    source_id: sourceId,
    norm_type: normType,
    norm_number: normNumber,
    year: raw.year,
    article_or_section: articleOrSection,
    current_text: currentText,
    issuing_authority: issuingAuthority,
    issued_at: issuedAt ? issuedAt.raw : null,
    effective_from: effectiveFrom ? effectiveFrom.raw : null,
    effective_to: effectiveTo ? effectiveTo.raw : null,
    modifications,
    official_url: officialUrl,
    topic,
    sector,
    verified_at: verifiedAt.raw,
    corpus_version: corpusVersion,
    verification_status: raw.verification_status,
    validity_status: raw.validity_status,
    applicability_status: raw.applicability_status,
  };
}

/**
 * Evaluates a normalized source against an explicit `as_of` reference date and staleness
 * threshold — never `Date.now()` — so verification/vigencia/aplicabilidad are always
 * reproducible for the same inputs. Eligibility requires the three declared source states
 * (verification_status=verified, validity_status=confirmed, applicability_status=applicable)
 * AND every date/modification check to pass; any single failure appends a closed reason from
 * AGT002_LEGAL_REVIEW_REASONS and blocks `eligible_for_verified_law`. A resolved total
 * derogation only blocks applicability once its effective_date has arrived as of `as_of` — a
 * future derogation is never treated as already effective.
 */
export function evaluateAgt002LegalSourceStatus(rawSource, { as_of, stale_after_days = AGT002_LEGAL_DEFAULT_STALE_AFTER_DAYS } = {}) {
  const source = buildAgt002LegalSource(rawSource);
  const asOf = parseIsoDate(as_of, 'as_of');
  if (!Number.isInteger(stale_after_days) || stale_after_days <= 0) {
    throw new Error('stale_after_days debe ser un entero mayor que cero.');
  }

  const reasons = [];

  if (source.verification_status !== 'verified') {
    reasons.push('source_unverified');
  } else {
    const verifiedAt = parseIsoDate(source.verified_at, 'verified_at');
    const ageMs = asOf.ms - verifiedAt.ms;
    if (ageMs < 0) reasons.push('verification_date_in_future');
    else if (ageMs > stale_after_days * DAY_MS) reasons.push('stale_verification');
  }

  if (source.issued_at == null) reasons.push('issuance_date_uncertain');
  if (source.validity_status !== 'confirmed') reasons.push('validity_uncertain');
  const effectiveFrom = source.effective_from ? parseIsoDate(source.effective_from, 'effective_from') : null;
  const effectiveTo = source.effective_to ? parseIsoDate(source.effective_to, 'effective_to') : null;
  if (effectiveFrom && asOf.ms < effectiveFrom.ms) reasons.push('not_yet_effective');
  if (effectiveTo && asOf.ms >= effectiveTo.ms) reasons.push('expired');

  if (source.applicability_status === 'uncertain') reasons.push('applicability_uncertain');
  if (source.applicability_status === 'not_applicable') reasons.push('not_applicable_derogated');

  let modificationStatus = 'none';
  if (source.modifications.length) {
    const hasUnresolved = source.modifications.some(modification => modification.resolution_status === 'unresolved');
    modificationStatus = hasUnresolved ? 'unresolved' : 'resolved';
    if (hasUnresolved) reasons.push('modification_unresolved');
    const derogatedAsOfNow = source.modifications.some(modification => (
      modification.modification_type === 'derogation'
      && modification.scope === 'total'
      && modification.resolution_status === 'resolved'
      && parseIsoDate(modification.effective_date, `${modification.modification_id}.effective_date`).ms <= asOf.ms
    ));
    if (derogatedAsOfNow) reasons.push('not_applicable_derogated');
  }

  const uniqueReasons = [...new Set(reasons)].sort();
  const eligible = uniqueReasons.length === 0;

  return {
    as_of: asOf.raw,
    stale_after_days,
    verification_status: source.verification_status,
    validity_status: source.validity_status,
    applicability_status: source.applicability_status,
    modification_status: modificationStatus,
    eligible_for_verified_law: eligible,
    requires_human_legal_review: !eligible,
    reasons: uniqueReasons,
  };
}

/**
 * Produces the deterministic, versioned canonical citation for one normalized corpus source.
 * Always re-derived from `rawSource` through `buildAgt002LegalSource` — a model can never hand
 * in a free-floating citation; it can only exist for a source that actually validates.
 */
export function buildAgt002LegalCitation(rawSource) {
  const source = buildAgt002LegalSource(rawSource);
  const citationId = `citation:${source.source_id}:${source.corpus_version}`;
  const label = `${source.norm_type} ${source.norm_number} de ${source.year}, ${source.article_or_section} (${source.issuing_authority})`;
  return {
    citation_id: citationId,
    source_id: source.source_id,
    norm_type: source.norm_type,
    norm_number: source.norm_number,
    year: source.year,
    article_or_section: source.article_or_section,
    issuing_authority: source.issuing_authority,
    official_url: source.official_url,
    verified_at: source.verified_at,
    corpus_version: source.corpus_version,
    label,
  };
}

/**
 * Closed validator for a legal conclusion. Every citation must reproduce byte-for-byte the
 * canonical citation of an actual corpus source (fails closed on invented/altered
 * citation/source/norm/URL); the corpus itself must be internally consistent (no duplicate
 * source_id, a single corpus_version across all sources supplied — even when only one is cited).
 * `verified_law` additionally requires every cited source to be `eligible_for_verified_law` as of
 * `as_of`, and carries empty `reasons`. `requires_human_legal_review` always carries at least one
 * closed reason (from AGT002_LEGAL_REVIEW_REASONS only — free text is rejected), canonically
 * derived from the real ineligibility of cited sources so uncertainty can never be hidden behind
 * an empty reasons array. Explicitly rejects any GO/NO-GO, decision, approval, signature or
 * submission field — this contract never carries human authority.
 */
export function validateAgt002LegalConclusion(raw, { sources, as_of, stale_after_days = AGT002_LEGAL_DEFAULT_STALE_AFTER_DAYS } = {}) {
  if (!isRecord(raw)) throw new Error('La conclusión jurídica debe ser un objeto.');

  const forbidden = Object.keys(raw).filter(key => FORBIDDEN_AUTHORITY_KEYS.includes(key));
  if (forbidden.length) {
    throw new Error(
      `La conclusión jurídica no puede incluir campos de autoridad humana (GO/NO-GO, aprobación, firma, envío): ${forbidden.sort().join(', ')}.`,
    );
  }
  rejectUnknownKeys(raw, CONCLUSION_KEYS, 'La conclusión jurídica');

  if (!AGT002_LEGAL_CONCLUSION_STATUSES.has(raw.status)) {
    throw new Error('El estado (status) de la conclusión jurídica debe ser verified_law o requires_human_legal_review.');
  }
  const statement = requireBoundedString(raw.statement, 'statement', MAX_STATEMENT_LENGTH);

  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error('Se requiere el corpus de fuentes normativas (sources) para validar citas.');
  }
  const seenSourceIds = new Set();
  const normalizedSources = sources.map(source => {
    const built = buildAgt002LegalSource(source);
    if (seenSourceIds.has(built.source_id)) {
      throw new Error(`El corpus entregado tiene source_id duplicado: ${built.source_id}.`);
    }
    seenSourceIds.add(built.source_id);
    return built;
  });
  const corpusVersions = new Set(normalizedSources.map(source => source.corpus_version));
  if (corpusVersions.size > 1) {
    throw new Error(`El corpus entregado mezcla versiones distintas (corpus_version): ${[...corpusVersions].sort().join(', ')}.`);
  }
  const sourceById = new Map(normalizedSources.map(source => [source.source_id, source]));

  if (!Array.isArray(raw.citations)) throw new Error('citations debe ser una lista.');
  if (raw.status === 'verified_law' && raw.citations.length === 0) {
    throw new Error('Una conclusión verified_law requiere al menos una cita oficial elegible.');
  }

  const asOf = parseIsoDate(as_of, 'as_of');
  if (!Number.isInteger(stale_after_days) || stale_after_days <= 0) {
    throw new Error('stale_after_days debe ser un entero mayor que cero.');
  }

  const seenCitationIds = new Set();
  const evaluations = [];
  const citations = raw.citations.map((citation, index) => {
    const label = `citations[${index}]`;
    rejectUnknownKeys(citation, CITATION_KEYS, label);
    const sourceId = typeof citation.source_id === 'string' ? citation.source_id : null;
    const source = sourceId ? sourceById.get(sourceId) : undefined;
    if (!source) {
      throw new Error(`${label} cita una fuente (source_id) que no existe en el corpus entregado.`);
    }

    const canonical = buildAgt002LegalCitation(source);
    const mismatched = CITATION_KEYS.filter(key => citation[key] !== canonical[key]);
    if (mismatched.length) {
      throw new Error(`${label} no coincide con la cita canónica de la fuente oficial (campos alterados: ${mismatched.sort().join(', ')}).`);
    }
    if (seenCitationIds.has(canonical.citation_id)) {
      throw new Error(`citation_id duplicado en la conclusión: ${canonical.citation_id}.`);
    }
    seenCitationIds.add(canonical.citation_id);

    const evaluation = evaluateAgt002LegalSourceStatus(source, { as_of: asOf.raw, stale_after_days });
    evaluations.push(evaluation);
    if (raw.status === 'verified_law' && !evaluation.eligible_for_verified_law) {
      throw new Error(`${label} referencia una fuente no elegible para derecho verificado (${evaluation.reasons.join(', ') || 'no aplicable'}).`);
    }
    return canonical;
  });

  const rawReasons = raw.reasons == null ? [] : raw.reasons;
  if (!Array.isArray(rawReasons)) throw new Error('reasons debe ser una lista.');
  for (const reason of rawReasons) {
    if (typeof reason !== 'string' || !AGT002_LEGAL_REVIEW_REASONS.includes(reason)) {
      throw new Error(`reasons solo puede contener razones cerradas de AGT002_LEGAL_REVIEW_REASONS; valor no reconocido: ${String(reason)}.`);
    }
  }

  let finalReasons;
  if (raw.status === 'verified_law') {
    if (rawReasons.length > 0) {
      throw new Error('Una conclusión verified_law no admite reasons: toda cita ya es plenamente elegible y cierta.');
    }
    finalReasons = [];
  } else {
    const derived = new Set(rawReasons);
    const anyEligible = evaluations.some(evaluation => evaluation.eligible_for_verified_law);
    if (!anyEligible) derived.add('no_eligible_source');
    for (const evaluation of evaluations) {
      if (!evaluation.eligible_for_verified_law) evaluation.reasons.forEach(reason => derived.add(reason));
    }
    if (derived.size === 0) {
      throw new Error('requires_human_legal_review requiere al menos una razón cerrada válida; no puede ocultarse la incertidumbre con reasons vacías.');
    }
    finalReasons = [...derived].sort();
  }

  return {
    status: raw.status,
    statement,
    citations,
    reasons: finalReasons,
  };
}
