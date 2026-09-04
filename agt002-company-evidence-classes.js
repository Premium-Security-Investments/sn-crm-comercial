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
//
// F4: an optional `inventorySnapshot` (the governed SharePoint inventory from
// agt002-company-evidence-sharepoint-catalog.js) may additionally be supplied. When present,
// it is re-validated (never trusted verbatim) and each class gains exactly one additive
// `inventory` field built from that class's own entry — never invented, never
// cross-wired to another class, and never able to promote presence/review/validity/
// applicability/compliance, which stay exclusively derived from the registry row. Omitting it
// (or passing null) keeps the legacy shape byte-for-byte identical.

import { validateAgt002CompanyEvidenceInventorySnapshot } from './agt002-company-evidence-sharepoint-catalog.js';

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

// P2-2: minimum-exposure defense for psi_agt002_company_evidence_registry. This is the
// explicit, closed allowlist of columns any read of this table may ever fetch — never
// select('*') and never a column outside it (e.g. notes, decision_humana, classification,
// sensibilidad, control_de_uso). assertAgt002CompanyEvidenceRegistryMinimalExposureSelect
// enforces this at module-load time below, so a future edit that widens the select (by
// mistake or otherwise) fails loudly instead of silently shipping broader exposure.
export const AGT002_COMPANY_EVIDENCE_CLASS_ALLOWED_COLUMNS = Object.freeze([
  'entry_id', 'document_class', 'existence_status', 'human_review_status', 'applicability_status',
  'source_reference', 'human_gate', 'hash', 'expiry', 'current', 'integration_active', 'updated_at', 'created_at',
  'source_manifest_version',
]);

export function assertAgt002CompanyEvidenceRegistryMinimalExposureSelect(select, allowedColumns) {
  if (typeof select !== 'string' || !select.trim()) {
    throw new Error('AGT-002 company evidence registry: el select debe ser una lista de columnas.');
  }
  if (select.includes('*')) {
    throw new Error('AGT-002 company evidence registry: select(*) está prohibido; usa la allowlist explícita de columnas.');
  }
  const columns = select.split(',').map(column => column.trim());
  if (columns.some(column => !column)) {
    throw new Error('AGT-002 company evidence registry: el select no puede tener columnas vacías.');
  }
  if (new Set(columns).size !== columns.length) {
    throw new Error('AGT-002 company evidence registry: el select no puede repetir columnas.');
  }
  const disallowed = columns.filter(column => !allowedColumns.includes(column));
  if (disallowed.length) {
    throw new Error(`AGT-002 company evidence registry: columnas fuera de la allowlist de mínima exposición: ${disallowed.join(', ')}.`);
  }
  return select;
}

export const AGT002_COMPANY_EVIDENCE_CLASS_SELECT = assertAgt002CompanyEvidenceRegistryMinimalExposureSelect(
  'entry_id,document_class,existence_status,human_review_status,applicability_status,source_reference,human_gate,hash,expiry,current,integration_active,updated_at,created_at,source_manifest_version',
  AGT002_COMPANY_EVIDENCE_CLASS_ALLOWED_COLUMNS,
);

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

  const builtClass = {
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

  // Additive/optional for historical compatibility (pre-v0.3.1 fixtures/históricos never
  // carried this column): only own, non-null/undefined values are validated and emitted.
  // Absent (including inherited) stays byte-for-byte identical to the legacy shape.
  if (Object.hasOwn(rawEntry, 'source_manifest_version') && rawEntry.source_manifest_version != null) {
    builtClass.source_manifest_version = requireNonEmptyString(rawEntry.source_manifest_version, `${entryId}.source_manifest_version`);
  }

  return builtClass;
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
    // No row exists to read a real provenance version from — never invented, and the
    // additive contract omits the key entirely rather than emitting null.
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

// Reads only the four safe per-class fields off an already-validated snapshot class — never
// its entry_id (the caller's own class already has it) and never anything from the snapshot's
// own top-level fields (e.g. its catalog hash, which is run identity, not model input).
function buildInventorySummary(snapshotClassesById, entryId) {
  const snapshotClass = snapshotClassesById.get(entryId);
  return {
    source_file_count: snapshotClass.source_file_count,
    state_counts: snapshotClass.state_counts,
    effective_state: snapshotClass.effective_state,
    last_reconciled_at: snapshotClass.last_reconciled_at,
  };
}

export function buildAgt002CompanyEvidenceClasses({ registryEntries = [], inventorySnapshot = null, asOf = new Date() } = {}) {
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

  if (inventorySnapshot != null) {
    const validatedSnapshot = validateAgt002CompanyEvidenceInventorySnapshot(inventorySnapshot);
    const snapshotClassesById = new Map(validatedSnapshot.classes.map(cls => [cls.entry_id, cls]));
    for (const cls of classes) {
      cls.inventory = buildInventorySummary(snapshotClassesById, cls.entry_id);
    }
  }

  return { classes, coverage: buildCoverage(classes, entriesById) };
}

// PostgREST/Postgres codes meaning "the table itself does not exist" — mirrors
// agt002-company-dossier.js's own fail-soft handling of the optional 061 table.
const TABLE_ABSENT_ERROR_CODES = ['PGRST205', '42P01'];

// Deliberately filters only on current=true (the live version of each class), not
// integration_active — a deactivated-but-current entry must still surface so the
// coverage manifest can honestly report it as omitted instead of hiding it.
//
// Raw-row loader: the real, direct DB source for the v3 engine's
// companyEvidenceClassesProvider(context) contract (agt002-preview-engine.js), which
// hands its return value straight to buildAgt002CompanyEvidenceClasses({ registryEntries })
// itself — so this must return the untouched rows, never the built {classes, coverage}
// shape. loadAgt002CompanyEvidenceClasses below is a thin convenience wrapper over the
// same rows for callers (tests, the legacy dossier's own comparisons) that want the
// already-built typed shape instead.
export async function loadAgt002CompanyEvidenceRegistryEntries(database) {
  const { data, error } = await database
    .from('psi_agt002_company_evidence_registry')
    .select(AGT002_COMPANY_EVIDENCE_CLASS_SELECT)
    .eq('current', true)
    .order('entry_id');
  if (error) {
    if (TABLE_ABSENT_ERROR_CODES.includes(error.code)) return [];
    throw error;
  }
  return data || [];
}

export async function loadAgt002CompanyEvidenceClasses(database, { asOf = new Date() } = {}) {
  const registryEntries = await loadAgt002CompanyEvidenceRegistryEntries(database);
  return buildAgt002CompanyEvidenceClasses({ registryEntries, asOf });
}
