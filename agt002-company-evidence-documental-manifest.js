// AGT-002 F1 (2026-08-29): auditable DOCUMENTAL manifest `v0.3.1-approved-20260829`.
//
// The reviewed corporate corpus actually contains 22 distinct documental evidence
// classes, not 17: five TIC documents, one tax return and three antecedentes
// certificates are real, separate pieces of evidence that the closed TECHNICAL
// catalog of 17 classes (agt002-company-evidence-classes.js, seeded by migration 061)
// has no room to represent one-by-one. This module is the explicit, versioned,
// auditable PROJECTION from the 22 documental classes onto the 17 technical classes —
// never a silent renaming, never a merge decided ad hoc at read time. Migration 075
// carries this exact projection into psi_agt002_company_evidence_registry.
//
// What this module is NOT (Fase 1 scope):
//   - It does not write to or read from any database itself.
//   - It does not wire into server/index.js, api/[...path].js or the V3 wire contract —
//     that is explicitly Fase 2+. Nothing here changes AGT002_COMPANY_EVIDENCE_MANIFEST_VERSION
//     in agt002-preview-engine.js ('agt002-company-evidence-classes-v1'), which is a
//     DIFFERENT thing: that constant versions the 17-class CODE CONTRACT itself, never
//     the provenance of a given row's data. This module's own version constant is
//     deliberately named AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_VERSION to avoid
//     colliding with that unrelated, pre-existing concept.
//   - It never asserts compliance, sufficiency, applicability or approval. It is a
//     documental-to-technical projection manifest only.
//
// Every projection group is either:
//   - a 1:1 direct carry-over (13 classes: the documental id equals the technical id),
//   - a many:1 consolidation with `complete: true` (the five TIC classes into
//     communications_license; the three antecedentes into corporate_background_checks),
//     whose `hash` is a deterministic sha256 composite of the ordered source hashes, or
//   - a partial/empty group with `complete: false` (financial_and_tax_pack has only
//     corporate_tax_return, not the full pack; overtime_authorization has zero valid
//     documental classes) — its `hash` is always null, regardless of any hash a
//     component might individually carry, because reporting a hash for an admittedly
//     incomplete or absent basis would misrepresent it as verified.
//
// No PII, SharePoint path, signed URL, OCR output or secret is ever held here — only
// class identifiers, human-readable labels and sha256 fingerprints already safe to
// surface (the same kind of hash agt002-company-evidence-classes.js already exposes).

import { createHash } from 'node:crypto';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS, AGT002_COMPANY_EVIDENCE_PRESENCE_STATUSES } from './agt002-company-evidence-classes.js';

export const AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_VERSION = 'v0.3.1-approved-20260829';
export const AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_ARTIFACT_TYPE = 'agt002_company_evidence_documental_manifest';
export const AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_CONTRACT_VERSION = 'agt002-company-evidence-documental-manifest@1';
export const AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_HASH_ALGORITHM = 'sha256';

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const HASH_JOIN_SEPARATOR = '|';
const VERSION_PATTERN = /^v\d+\.\d+\.\d+-approved-\d{8}$/;

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`AGT-002 manifiesto documental de evidencia: ${label} debe ser texto no vacío.`);
  }
  return value.trim();
}

function requireHashOrNull(value, label) {
  if (value === null) return null;
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new Error(`AGT-002 manifiesto documental de evidencia: ${label} debe ser un hash sha256 hexadecimal (64 caracteres) o null.`);
  }
  return value;
}

// Pure, deterministic and order-sensitive: never a set/sort of the inputs. `complete`
// must be explicit and true for any hash to ever be reported — a partial or empty
// group is always null here, never a hash computed over whatever happens to be
// available. A single-source group passes its one hash through unchanged (not
// re-hashed); a multi-source group's hash is the sha256 of its hashes joined by '|'
// in the exact given order, so swapping the order of the same set of sources yields a
// different, detectably-wrong hash.
export function computeAgt002CompanyEvidenceGroupHash(hashes, { complete } = {}) {
  if (!Array.isArray(hashes)) throw new Error('AGT-002 manifiesto documental de evidencia: hashes debe ser un arreglo.');
  for (const hash of hashes) requireHashOrNull(hash, 'cada hash del grupo');
  if (complete !== true) return null;
  if (hashes.length === 0) return null;
  if (hashes.some((hash) => hash === null)) return null;
  if (hashes.length === 1) return hashes[0];
  return createHash(AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_HASH_ALGORITHM)
    .update(hashes.join(HASH_JOIN_SEPARATOR), 'utf8')
    .digest('hex');
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeysDeep(value[key])]));
  }
  return value;
}

// Fail-closed builder/validator. Never trusts caller-supplied totals: coverage is
// proven by construction (every documental id assigned to exactly one group; every
// group's technical id drawn from, and exhaustively covering, `technicalClassIds`).
// Exported so tests can exercise coverage/duplicate/fail-closed invariants directly
// with synthetic data, independent of the 22/17 real catalog below.
export function buildAgt002CompanyEvidenceDocumentalManifestProjection({
  documentalClasses, groups, technicalClassIds,
} = {}) {
  if (!Array.isArray(documentalClasses) || documentalClasses.length === 0) {
    throw new Error('AGT-002 manifiesto documental de evidencia: documentalClasses debe ser un arreglo no vacío.');
  }
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new Error('AGT-002 manifiesto documental de evidencia: groups debe ser un arreglo no vacío.');
  }
  if (!Array.isArray(technicalClassIds) || technicalClassIds.length === 0) {
    throw new Error('AGT-002 manifiesto documental de evidencia: technicalClassIds debe ser un arreglo no vacío.');
  }
  if (new Set(technicalClassIds).size !== technicalClassIds.length) {
    throw new Error('AGT-002 manifiesto documental de evidencia: technicalClassIds contiene identificadores duplicados.');
  }

  const documentalById = new Map();
  for (const doc of documentalClasses) {
    const documentalId = requireNonEmptyString(doc?.documentalId, 'documentalId');
    if (documentalById.has(documentalId)) {
      throw new Error(`AGT-002 manifiesto documental de evidencia: clase documental duplicada en el catálogo: ${documentalId}.`);
    }
    const label = requireNonEmptyString(doc?.label, `${documentalId}.label`);
    const hash = requireHashOrNull(doc?.hash ?? null, `${documentalId}.hash`);
    documentalById.set(documentalId, Object.freeze({ documental_class_id: documentalId, label, hash }));
  }

  const technicalIdSet = new Set(technicalClassIds);
  const groupsByTechnicalId = new Map();
  const assignedDocumentalIds = new Set();

  for (const group of groups) {
    const technicalClassId = requireNonEmptyString(group?.technicalClassId, 'technicalClassId');
    if (!technicalIdSet.has(technicalClassId)) {
      throw new Error(`AGT-002 manifiesto documental de evidencia: ${technicalClassId} no pertenece al catálogo técnico cerrado suministrado.`);
    }
    if (groupsByTechnicalId.has(technicalClassId)) {
      throw new Error(`AGT-002 manifiesto documental de evidencia: grupo técnico duplicado: ${technicalClassId}.`);
    }
    if (!Array.isArray(group?.documentalIds)) {
      throw new Error(`AGT-002 manifiesto documental de evidencia: ${technicalClassId}.documentalIds debe ser un arreglo.`);
    }
    const documentalIds = [...group.documentalIds];
    if (new Set(documentalIds).size !== documentalIds.length) {
      throw new Error(`AGT-002 manifiesto documental de evidencia: ${technicalClassId} referencia clases documentales repetidas dentro del mismo grupo.`);
    }
    const hashes = documentalIds.map((documentalId) => {
      const doc = documentalById.get(documentalId);
      if (!doc) {
        throw new Error(`AGT-002 manifiesto documental de evidencia: ${technicalClassId} referencia una clase documental fuera del catálogo cerrado: ${documentalId}.`);
      }
      if (assignedDocumentalIds.has(documentalId)) {
        throw new Error(`AGT-002 manifiesto documental de evidencia: clase documental asignada a más de un grupo técnico: ${documentalId}.`);
      }
      assignedDocumentalIds.add(documentalId);
      return doc.hash;
    });
    if (typeof group?.complete !== 'boolean') {
      throw new Error(`AGT-002 manifiesto documental de evidencia: ${technicalClassId}.complete debe ser booleano.`);
    }
    if (!AGT002_COMPANY_EVIDENCE_PRESENCE_STATUSES.includes(group?.existenceStatus)) {
      throw new Error(`AGT-002 manifiesto documental de evidencia: ${technicalClassId}.existenceStatus no es un valor permitido: ${String(group?.existenceStatus)}.`);
    }
    const hash = computeAgt002CompanyEvidenceGroupHash(hashes, { complete: group.complete });
    groupsByTechnicalId.set(technicalClassId, Object.freeze({
      technical_class_id: technicalClassId,
      documental_class_ids: Object.freeze(documentalIds),
      complete: group.complete,
      existence_status: group.existenceStatus,
      hash,
      governance_notes: Object.freeze({ ...(group.governanceNotes || {}) }),
    }));
  }

  for (const technicalClassId of technicalClassIds) {
    if (!groupsByTechnicalId.has(technicalClassId)) {
      throw new Error(`AGT-002 manifiesto documental de evidencia: falta el grupo técnico ${technicalClassId} del catálogo técnico cerrado.`);
    }
  }
  if (groupsByTechnicalId.size !== technicalClassIds.length) {
    throw new Error(`AGT-002 manifiesto documental de evidencia: se esperaban ${technicalClassIds.length} grupos técnicos, hay ${groupsByTechnicalId.size}.`);
  }
  if (assignedDocumentalIds.size !== documentalById.size) {
    throw new Error(
      `AGT-002 manifiesto documental de evidencia: cobertura incompleta — ${assignedDocumentalIds.size} de ${documentalById.size} `
      + 'clases documentales quedaron proyectadas sobre algún grupo técnico.',
    );
  }

  const documentalToTechnicalMap = {};
  for (const group of groupsByTechnicalId.values()) {
    for (const documentalId of group.documental_class_ids) documentalToTechnicalMap[documentalId] = group.technical_class_id;
  }

  return Object.freeze({
    documental_classes: Object.freeze([...documentalById.values()]),
    documental_class_ids: Object.freeze([...documentalById.keys()]),
    technical_class_ids: Object.freeze([...technicalClassIds]),
    groups_by_technical_id: Object.freeze(Object.fromEntries(groupsByTechnicalId)),
    documental_to_technical_map: Object.freeze(documentalToTechnicalMap),
  });
}

function addUtcDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`AGT-002 manifiesto documental de evidencia: fecha inválida ${isoDate}.`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// --- El catálogo documental real de 22 clases (v0.3.1-approved-20260829) --------------------

const REAL_DOCUMENTAL_CLASSES = Object.freeze([
  // 13 clases que se proyectan 1:1 sobre su misma clase técnica.
  { documentalId: 'supervigilancia_operating_license', label: 'Licencia de funcionamiento SuperVigilancia', hash: '45d9857f2a128853d53b6e7040dcff9551668b5e4e936dcc4e2c7249dce88255' },
  { documentalId: 'rup', label: 'Registro Único de Proponentes (RUP)', hash: '8b7d472a37d80cf708cd5f5b4f9591bc0b651421a8b118725487e4e42e8ef856' },
  { documentalId: 'rut', label: 'Registro Único Tributario (RUT)', hash: '881f6ca54b3ee86533626c7605880b7273c71d542057a923dd4eebdb7c8275f6' },
  { documentalId: 'uniforms_resolution', label: 'Resolución de uniformes y distintivos', hash: 'cf8b74af151368015754d4e72d6b8a9ccec79e693023520e924d8d19966f623a' },
  { documentalId: 'no_fines_sanctions_certificate', label: 'Certificado de multas y sanciones', hash: 'dbe65f7def3bcae11932ffbaad7c7ae9b2893bc16539aa5abffd6613563b83cf' },
  { documentalId: 'authorized_weapons_list', label: 'Listado de armas autorizadas', hash: 'f05a33e21c5676fa4f9a6204f67c77a506e2f0ccb6321e8ebd0a093950edd441' },
  { documentalId: 'rce_policy', label: 'Póliza de responsabilidad civil extracontractual', hash: '7fd601428b7b5ad36e52fbbea8f2307b0d2d8d17d2d280c5293d4e5cf59cc3ed' },
  { documentalId: 'collective_life_policy', label: 'Póliza de seguro de vida colectivo', hash: 'e20fc9357268700e4237f4dfdbe1db793ea75d9ad829940140bb434b6e0a93f8' },
  { documentalId: 'accredited_experience', label: 'Experiencia acreditada', hash: '9f6a27af2ec26791d61215edec5d18020f883944cab004c226b5ba213bf656a6' },
  { documentalId: 'bank_certificate', label: 'Certificación bancaria corporativa', hash: '5ec470f047867b0cbeabe2e18ca02f950057b76e2f2cacf1d6516040181c9f76' },
  { documentalId: 'legal_representative_vault', label: 'Documentos y antecedentes de representantes legales', hash: null },
  { documentalId: 'personnel_credentials_vault', label: 'Credenciales, formación, experiencia y afiliaciones de personal', hash: null },
  { documentalId: 'differential_scoring_support', label: 'Soportes de criterios diferenciales', hash: null },
  // 5 clases TIC que se consolidan sobre communications_license (orden fijo, relevante para el hash compuesto).
  { documentalId: 'radio_spectrum_permit', label: 'Permiso de uso del espectro radioeléctrico', hash: '2592774e953ce394d40aa8a7ed6e5501c11720cd0a25e08e00ecabb28101914b' },
  { documentalId: 'radio_network_technical_profile', label: 'Perfil técnico de la red de radiocomunicaciones', hash: '57e78e492150327dadacb4200aa869f3cd29668a24a5b4d1b246410e0ce07cea' },
  { documentalId: 'rutic_registration', label: 'Registro Único de TIC (RUTIC)', hash: '2719cfa8a99fcddd2b09e6781633c3120d003f5026c12d77421d1ece1ddd15bd' },
  { documentalId: 'telecom_service_contract', label: 'Contrato de prestación de servicios de telecomunicaciones', hash: 'e665e1a2a7de4ae619ab555506f7c21cdb313e785aec1e6d7ae007774c0e7281' },
  { documentalId: 'telecom_commercial_reference', label: 'Referencia comercial de telecomunicaciones', hash: '51d7cae16d82da79cea94d9de81a5a615399e08740309c8a9bcacfd1e76ab52d' },
  // 1 clase de renta que sólo cubre parcialmente financial_and_tax_pack.
  { documentalId: 'corporate_tax_return', label: 'Declaración de renta de la persona jurídica', hash: '91013b74437942aa59d5abcb62211fd3e78f2d774cc76503206d6644549f8341' },
  // 3 clases de antecedentes que se consolidan sobre corporate_background_checks (orden fijo).
  { documentalId: 'corporate_disciplinary_certificate', label: 'Certificado de antecedentes disciplinarios de la persona jurídica', hash: '0a518ed958ae4d3a54e638b7f728bcb0a5637798679f9ece8e9dc0f548f6717a' },
  { documentalId: 'corporate_fiscal_certificate', label: 'Certificado de antecedentes fiscales de la persona jurídica', hash: 'e56075f71a7767fc28379b9e42a66020761546b24059e4b2a54225394af89b8d' },
  { documentalId: 'corporate_corrective_measures_rnmc_certificate', label: 'Certificado de medidas correctivas RNMC de la persona jurídica', hash: '9b738f2be4b09b674a646a648d16cb6470897944a6ddf2a61b17c7fdad067e8e' },
]);

// Ventana de vigencia real de las tres consultas de antecedentes: consultadas el
// 2026-06-01, con una ventana de 89 días (vence 2026-08-29) — nunca inventada, siempre
// derivada por aritmética de fecha pura a partir de los dos datos observados.
const CORPORATE_BACKGROUND_CHECKS_CONSULTATION = Object.freeze({
  consulted_at: '2026-06-01',
  validity_days: 89,
  expires_at: addUtcDays('2026-06-01', 89),
});

const REAL_GROUPS = Object.freeze([
  { technicalClassId: 'supervigilancia_operating_license', documentalIds: ['supervigilancia_operating_license'], complete: true, existenceStatus: 'reported' },
  { technicalClassId: 'rup', documentalIds: ['rup'], complete: true, existenceStatus: 'reported' },
  { technicalClassId: 'rut', documentalIds: ['rut'], complete: true, existenceStatus: 'reported' },
  {
    technicalClassId: 'communications_license',
    documentalIds: ['radio_spectrum_permit', 'radio_network_technical_profile', 'rutic_registration', 'telecom_service_contract', 'telecom_commercial_reference'],
    complete: true,
    existenceStatus: 'reported',
    governanceNotes: { review_focus: Object.freeze(['firmeza', 'titularidad', 'territorio']) },
  },
  { technicalClassId: 'uniforms_resolution', documentalIds: ['uniforms_resolution'], complete: true, existenceStatus: 'reported' },
  { technicalClassId: 'no_fines_sanctions_certificate', documentalIds: ['no_fines_sanctions_certificate'], complete: true, existenceStatus: 'reported' },
  { technicalClassId: 'authorized_weapons_list', documentalIds: ['authorized_weapons_list'], complete: true, existenceStatus: 'reported' },
  { technicalClassId: 'rce_policy', documentalIds: ['rce_policy'], complete: true, existenceStatus: 'reported' },
  { technicalClassId: 'collective_life_policy', documentalIds: ['collective_life_policy'], complete: true, existenceStatus: 'reported' },
  { technicalClassId: 'accredited_experience', documentalIds: ['accredited_experience'], complete: true, existenceStatus: 'reported' },
  {
    technicalClassId: 'financial_and_tax_pack',
    documentalIds: ['corporate_tax_return'],
    complete: false,
    existenceStatus: 'not_verified',
    governanceNotes: { pack_complete: false },
  },
  { technicalClassId: 'bank_certificate', documentalIds: ['bank_certificate'], complete: true, existenceStatus: 'reported' },
  {
    technicalClassId: 'overtime_authorization',
    documentalIds: [],
    complete: false,
    existenceStatus: 'not_verified',
    governanceNotes: { reason: 'sin_autorizacion_mintrabajo_valida' },
  },
  {
    technicalClassId: 'corporate_background_checks',
    documentalIds: ['corporate_disciplinary_certificate', 'corporate_fiscal_certificate', 'corporate_corrective_measures_rnmc_certificate'],
    complete: true,
    existenceStatus: 'reported',
    governanceNotes: { consultation: CORPORATE_BACKGROUND_CHECKS_CONSULTATION },
  },
  { technicalClassId: 'legal_representative_vault', documentalIds: ['legal_representative_vault'], complete: true, existenceStatus: 'reported' },
  { technicalClassId: 'personnel_credentials_vault', documentalIds: ['personnel_credentials_vault'], complete: true, existenceStatus: 'reported' },
  { technicalClassId: 'differential_scoring_support', documentalIds: ['differential_scoring_support'], complete: true, existenceStatus: 'reported' },
]);

if (!VERSION_PATTERN.test(AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_VERSION)) {
  throw new Error('AGT-002 manifiesto documental de evidencia: AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_VERSION tiene un formato inesperado.');
}

export const AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_PROJECTION = buildAgt002CompanyEvidenceDocumentalManifestProjection({
  documentalClasses: REAL_DOCUMENTAL_CLASSES,
  groups: REAL_GROUPS,
  technicalClassIds: AGT002_COMPANY_EVIDENCE_CLASS_IDS,
});

// Guardas explícitas de los conteos exigidos por el manifiesto v0.3.1-approved-20260829:
// 22 clases documentales proyectadas sobre el catálogo técnico cerrado de 17. Un cambio
// futuro que rompa alguno de los dos totales falla aquí, en tiempo de carga del módulo,
// nunca en silencio.
if (AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_PROJECTION.documental_class_ids.length !== 22) {
  throw new Error(
    'AGT-002 manifiesto documental de evidencia: se esperaban exactamente 22 clases documentales, hay '
    + `${AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_PROJECTION.documental_class_ids.length}.`,
  );
}
if (AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_PROJECTION.technical_class_ids.length !== 17) {
  throw new Error(
    'AGT-002 manifiesto documental de evidencia: el catálogo técnico cerrado debe tener exactamente 17 clases, hay '
    + `${AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_PROJECTION.technical_class_ids.length}.`,
  );
}

export const AGT002_COMPANY_EVIDENCE_DOCUMENTAL_CLASS_IDS = AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_PROJECTION.documental_class_ids;
export const AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_GROUPS = AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_PROJECTION.groups_by_technical_id;
export const AGT002_COMPANY_EVIDENCE_DOCUMENTAL_TO_TECHNICAL_MAP = AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_PROJECTION.documental_to_technical_map;

// Huella de identidad estable de todo el manifiesto (catálogo documental + grupos +
// versión), recomputable de forma determinista con node:crypto sobre una serialización
// canónica (claves ordenadas). Cualquier cambio de contenido cambia esta huella —
// mecanismo de detección de drift para consumo futuro por gobernanza (Fase 2+).
export function computeAgt002CompanyEvidenceDocumentalManifestIdentityHash(projection) {
  const canonical = JSON.stringify(sortKeysDeep({
    artifact_type: AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_ARTIFACT_TYPE,
    contract_version: AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_CONTRACT_VERSION,
    manifest_version: AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_VERSION,
    documental_classes: projection.documental_classes,
    groups_by_technical_id: projection.groups_by_technical_id,
  }));
  return createHash(AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_HASH_ALGORITHM).update(canonical, 'utf8').digest('hex');
}

export const AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_IDENTITY_HASH = computeAgt002CompanyEvidenceDocumentalManifestIdentityHash(
  AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_PROJECTION,
);

// Superficie segura mínima para integrarse luego con governance (Fase 2+): sólo
// identificadores, etiquetas legibles, huellas sha256 y metadatos de gobernanza ya
// sanitizados — nunca contenido crudo, ruta de almacenamiento, URL firmada o secreto.
export const AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST = Object.freeze({
  artifact_type: AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_ARTIFACT_TYPE,
  contract_version: AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_CONTRACT_VERSION,
  manifest_version: AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_VERSION,
  identity_hash: AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_IDENTITY_HASH,
  documental_total: AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_PROJECTION.documental_class_ids.length,
  technical_total: AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_PROJECTION.technical_class_ids.length,
  documental_classes: AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_PROJECTION.documental_classes,
  groups_by_technical_id: AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_GROUPS,
  documental_to_technical_map: AGT002_COMPANY_EVIDENCE_DOCUMENTAL_TO_TECHNICAL_MAP,
});
