// F2 foundation: a typed contract for the 17 company evidence classes carried by
// psi_agt002_company_evidence_registry (061), separate from the legacy
// recurring_documents presentation (agt002-company-dossier.js), which compresses
// them into pipe-delimited strings and never even fetches human_review_status. Every
// class object here separates its status dimensions strictly by DB column: presence
// (existence_status), review (human_review_status) and applicability
// (applicability_status) are read verbatim from their own columns; validity is
// computed only from expiry; compliance has no write path yet and is never
// auto-promoted from any other dimension. This keeps "the document was reported
// present" structurally incapable of implying "it is current", "it applies to this
// case" or "it is sufficient". recurring_documents is left untouched: this is an
// additive, separate read surface for v3 foundations, not a replacement.

export const AGT002_COMPANY_EVIDENCE_PRESENCE_STATUSES = Object.freeze(['verified', 'reported', 'not_verified']);
export const AGT002_COMPANY_EVIDENCE_REVIEW_STATUSES = Object.freeze(['pending_human_review', 'approved', 'rejected']);
export const AGT002_COMPANY_EVIDENCE_VALIDITY_STATUSES = Object.freeze(['current', 'expired', 'unknown']);
export const AGT002_COMPANY_EVIDENCE_APPLICABILITY_STATUSES = Object.freeze(['pending_case_validation', 'applicable', 'not_applicable']);
// No RPC/write path exists yet to set this beyond its default (out of scope for F1/F2:
// the integral v3 report contract). It is a real, independent dimension in the typed
// shape so a future write path has somewhere honest to land, but nothing in this
// module — or anywhere else today — may ever promote it off pending_review.
export const AGT002_COMPANY_EVIDENCE_COMPLIANCE_STATUSES = Object.freeze(['pending_review', 'sufficient', 'insufficient', 'not_applicable']);
export const AGT002_COMPANY_EVIDENCE_COVERAGE_CATEGORIES = Object.freeze(['available', 'selected', 'omitted', 'expired', 'inaccessible', 'pending_review']);

const CLASS_CATALOG = Object.freeze([
  ['supervigilancia_operating_license', 'Licencia de funcionamiento SuperVigilancia'],
  ['rup', 'Registro Único de Proponentes (RUP)'],
  ['rut', 'Registro Único Tributario (RUT)'],
  ['communications_license', 'Licencia o permisos de comunicaciones'],
  ['uniforms_resolution', 'Resolución de uniformes y distintivos'],
  ['no_fines_sanctions_certificate', 'Certificado de multas y sanciones'],
  ['authorized_weapons_list', 'Listado de armas autorizadas'],
  ['rce_policy', 'Póliza de responsabilidad civil extracontractual'],
  ['collective_life_policy', 'Póliza de seguro de vida colectivo'],
  ['accredited_experience', 'Experiencia acreditada'],
  ['financial_and_tax_pack', 'Estados financieros, declaración de renta y soportes contables'],
  ['bank_certificate', 'Certificación bancaria corporativa'],
  ['overtime_authorization', 'Certificado o autorización de horas extras'],
  ['corporate_background_checks', 'Antecedentes y consultas de la persona jurídica'],
  ['legal_representative_vault', 'Documentos y antecedentes de representantes legales'],
  ['personnel_credentials_vault', 'Credenciales, formación, experiencia y afiliaciones de personal'],
  ['differential_scoring_support', 'Soportes de criterios diferenciales'],
].map(([entryId, evidenceType]) => Object.freeze({ entryId, evidenceType })));

export const AGT002_COMPANY_EVIDENCE_CLASS_IDS = Object.freeze(CLASS_CATALOG.map(item => item.entryId));
const CLASS_CATALOG_BY_ID = new Map(CLASS_CATALOG.map(item => [item.entryId, item]));

export const AGT002_COMPANY_EVIDENCE_CLASS_SELECT = 'entry_id,document_class,existence_status,human_review_status,applicability_status,source_reference,human_gate,hash,expiry,current,integration_active,updated_at,created_at';

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} debe ser texto no vacío.`);
  return value.trim();
}

function requireEnum(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label} no es un valor permitido: ${String(value)}.`);
  return value;
}

function toIso(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('La fecha registrada no es una fecha válida.');
  return parsed.toISOString();
}

// Validity is derived exclusively from expiry (a date the corpus reviewer actually
// observed and recorded) compared against asOf — never from existence_status, never
// invented. Entries whose vigencia is only known as free text (no parseable expiry)
// stay honestly 'unknown' rather than being guessed into 'current'.
function computeValidityStatus(expiry, asOf) {
  if (!expiry) return 'unknown';
  const expiryDate = new Date(`${String(expiry).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(expiryDate.getTime())) return 'unknown';
  return expiryDate.getTime() < asOf.getTime() ? 'expired' : 'current';
}

function buildSource(entry) {
  const source = {
    type: 'database',
    reference: `psi_agt002_company_evidence_registry:${entry.entry_id}`,
    observed_at: toIso(entry.updated_at || entry.created_at),
  };
  if (entry.document_class) source.label = entry.document_class;
  if (entry.human_gate) source.human_gate = requireNonEmptyString(entry.human_gate, 'human_gate');
  return source;
}

function buildClass(rawEntry, asOf) {
  if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
    throw new Error('Cada entrada del registro de evidencia debe ser un objeto.');
  }
  const entryId = requireNonEmptyString(rawEntry.entry_id, 'entry_id');
  const evidenceType = requireNonEmptyString(rawEntry.document_class, `${entryId}.document_class`);
  const presenceStatus = requireEnum(rawEntry.existence_status, AGT002_COMPANY_EVIDENCE_PRESENCE_STATUSES, `${entryId}.presence_status (existence_status)`);
  const reviewStatus = requireEnum(rawEntry.human_review_status, AGT002_COMPANY_EVIDENCE_REVIEW_STATUSES, `${entryId}.review_status (human_review_status)`);
  const applicabilityStatus = requireEnum(rawEntry.applicability_status, AGT002_COMPANY_EVIDENCE_APPLICABILITY_STATUSES, `${entryId}.applicability_status`);
  if (typeof rawEntry.integration_active !== 'boolean') throw new Error(`${entryId}.integration_active debe ser booleano.`);

  return {
    entry_id: entryId,
    evidence_type: evidenceType,
    presence_status: presenceStatus,
    review_status: reviewStatus,
    validity_status: computeValidityStatus(rawEntry.expiry, asOf),
    applicability_status: applicabilityStatus,
    compliance_status: 'pending_review',
    source: buildSource(rawEntry),
    last_reconciled_at: toIso(rawEntry.updated_at),
  };
}

function buildMissingClass({ entryId, evidenceType }) {
  return {
    entry_id: entryId,
    evidence_type: evidenceType,
    presence_status: 'not_verified',
    review_status: 'pending_human_review',
    validity_status: 'unknown',
    applicability_status: 'pending_case_validation',
    compliance_status: 'pending_review',
    source: {
      type: 'system',
      reference: `missing:psi_agt002_company_evidence_registry:${entryId}`,
      observed_at: null,
      label: evidenceType,
    },
    last_reconciled_at: null,
  };
}

// Coverage is a set of independent flags, not a partition: an entry can be both
// available and pending_review at once. Each flag reads exactly one underlying
// signal (never a combination that would let presence imply validity/applicability/
// compliance), matching the same registry rows the classes themselves were built
// from — never re-deriving anything from the already-built class objects' other
// dimensions.
function buildCoverage(classes, entriesById) {
  const coverage = Object.fromEntries(AGT002_COMPANY_EVIDENCE_COVERAGE_CATEGORIES.map(key => [key, []]));
  for (const cls of classes) {
    const entry = entriesById.get(cls.entry_id);
    if (!entry) {
      coverage.inaccessible.push(cls.entry_id);
      coverage.pending_review.push(cls.entry_id);
      continue;
    }
    if (cls.presence_status !== 'not_verified' && entry.integration_active) coverage.available.push(cls.entry_id);
    if (!entry.integration_active) coverage.omitted.push(cls.entry_id);
    if (cls.applicability_status === 'applicable') coverage.selected.push(cls.entry_id);
    if (cls.validity_status === 'expired') coverage.expired.push(cls.entry_id);
    if (!entry.hash) coverage.inaccessible.push(cls.entry_id);
    if (cls.review_status === 'pending_human_review') coverage.pending_review.push(cls.entry_id);
  }
  for (const key of Object.keys(coverage)) coverage[key].sort();
  return coverage;
}

export function buildAgt002CompanyEvidenceClasses({ registryEntries = [], asOf = new Date() } = {}) {
  if (!Array.isArray(registryEntries)) throw new Error('registryEntries debe ser una lista.');
  if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) throw new Error('asOf debe ser una fecha válida.');

  const entriesById = new Map();
  for (const rawEntry of registryEntries) {
    const entryId = typeof rawEntry?.entry_id === 'string' ? rawEntry.entry_id.trim() : '';
    if (!entryId) throw new Error('entry_id es obligatorio.');
    if (entriesById.has(entryId)) throw new Error(`entry_id duplicado: ${entryId}.`);
    if (!CLASS_CATALOG_BY_ID.has(entryId)) throw new Error(`entry_id fuera del catálogo cerrado de 17 clases: ${entryId}.`);
    entriesById.set(entryId, rawEntry);
  }

  const classes = CLASS_CATALOG.map(catalogEntry => {
    const rawEntry = entriesById.get(catalogEntry.entryId);
    return rawEntry ? buildClass(rawEntry, asOf) : buildMissingClass(catalogEntry);
  });

  return { classes, coverage: buildCoverage(classes, entriesById) };
}

// PostgREST/Postgres codes meaning "the table itself does not exist" — mirrors
// agt002-company-dossier.js's own fail-soft handling of the optional 061 table.
const TABLE_ABSENT_ERROR_CODES = ['PGRST205', '42P01'];

// Deliberately filters only on current=true (the live version of each class), not
// integration_active — a deactivated-but-current entry must still surface so the
// coverage manifest can honestly report it as omitted instead of hiding it.
export async function loadAgt002CompanyEvidenceClasses(database, { asOf = new Date() } = {}) {
  const { data, error } = await database
    .from('psi_agt002_company_evidence_registry')
    .select(AGT002_COMPANY_EVIDENCE_CLASS_SELECT)
    .eq('current', true)
    .order('entry_id');
  if (error) {
    if (TABLE_ABSENT_ERROR_CODES.includes(error.code)) return buildAgt002CompanyEvidenceClasses({ registryEntries: [], asOf });
    throw error;
  }
  return buildAgt002CompanyEvidenceClasses({ registryEntries: data || [], asOf });
}
