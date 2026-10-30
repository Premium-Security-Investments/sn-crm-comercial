export const AGT002_REQUIREMENT_EVIDENCE_STATUSES = Object.freeze([
  'cumplido_con_evidencia',
  'cumplimiento_parcial',
  'no_cumplido',
  'sin_evidencia_suficiente',
  'requiere_validacion_humana',
]);
const POSITIVE_STATUSES = new Set(['cumplido_con_evidencia', 'cumplimiento_parcial']);

const REQUIREMENT_KEYS = ['requirement_id', 'front', 'dossier_field', 'requirement_status'];
const FRONTS = new Set(['legal', 'financial', 'technical']);
const REQUIREMENT_STATUSES = new Set(['met', 'not_met', 'unknown']);

function boundedString(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function validateRequirement(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Cada requisito debe ser un objeto.');
  const unknown = Object.keys(raw).filter(key => !REQUIREMENT_KEYS.includes(key));
  if (unknown.length) throw new Error(`Requisito con clave no permitida: ${unknown.sort().join(', ')}.`);
  const requirementId = boundedString(raw.requirement_id, 200);
  if (!requirementId) throw new Error('Cada requisito necesita un requirement_id no vacío.');
  if (!FRONTS.has(raw.front)) throw new Error(`${requirementId}: front debe ser legal, financial o technical.`);
  const requirementStatus = raw.requirement_status === undefined ? 'unknown' : raw.requirement_status;
  if (!REQUIREMENT_STATUSES.has(requirementStatus)) throw new Error(`${requirementId}: requirement_status inválido.`);
  const dossierField = raw.dossier_field === undefined ? null : raw.dossier_field;
  if (dossierField !== null && (typeof dossierField !== 'string' || !dossierField.trim())) {
    throw new Error(`${requirementId}: dossier_field debe ser texto no vacío o ausente.`);
  }
  return { requirementId, front: raw.front, requirementStatus, dossierField: dossierField ? dossierField.trim() : null };
}

/**
 * Deterministic crosswalk only: a requirement is linked to company evidence via an
 * explicit, pre-reviewed dossier_field — never by automatic textual similarity — so an
 * unmapped or unknown field always routes to human review instead of guessing a match.
 */
function classify({ requirementStatus, dossierField }, companyDossier) {
  const field = dossierField ? companyDossier?.[dossierField] : undefined;
  const hasField = field && typeof field === 'object' && ['verified', 'reported', 'not_verified'].includes(field.status);

  if (!hasField) {
    return { status: 'requiere_validacion_humana', evidenceRefs: [] };
  }
  if (field.status === 'not_verified') {
    return { status: 'sin_evidencia_suficiente', evidenceRefs: [] };
  }
  const citation = typeof field.source?.reference === 'string' ? field.source.reference.trim() : '';
  if (!citation) throw new Error(`El campo de evidencia ${dossierField} no tiene una fuente citable.`);

  if (requirementStatus === 'met') {
    return { status: field.status === 'verified' ? 'cumplido_con_evidencia' : 'cumplimiento_parcial', evidenceRefs: [citation] };
  }
  if (requirementStatus === 'not_met') {
    return { status: 'no_cumplido', evidenceRefs: [citation] };
  }
  return { status: 'requiere_validacion_humana', evidenceRefs: [] };
}

export function buildAgt002RequirementEvidenceCrosswalk({ requirements = [], companyDossier = {} } = {}) {
  if (!Array.isArray(requirements)) throw new Error('Los requisitos deben ser una lista.');
  const items = requirements.map(raw => {
    const requirement = validateRequirement(raw);
    const { status, evidenceRefs } = classify(requirement, companyDossier);
    if (POSITIVE_STATUSES.has(status) && evidenceRefs.length === 0) {
      throw new Error(`${requirement.requirementId}: una clasificación positiva requiere al menos una cita de evidencia.`);
    }
    return {
      requirement_id: requirement.requirementId,
      front: requirement.front,
      status,
      evidence_refs: evidenceRefs,
      rationale: boundedString(rationaleFor(status), 500),
    };
  });
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.requirement_id)) throw new Error(`requirement_id duplicado: ${item.requirement_id}.`);
    seen.add(item.requirement_id);
  }
  return items.sort((left, right) => left.requirement_id.localeCompare(right.requirement_id));
}

function rationaleFor(status) {
  switch (status) {
    case 'cumplido_con_evidencia':
      return 'La evidencia verificada del expediente corporativo respalda el cumplimiento del requisito.';
    case 'cumplimiento_parcial':
      return 'La evidencia reportada (no verificada de forma independiente) respalda el cumplimiento del requisito.';
    case 'no_cumplido':
      return 'La evidencia del expediente corporativo indica que el requisito no se cumple.';
    case 'sin_evidencia_suficiente':
      return 'El expediente corporativo no tiene evidencia suficiente para este requisito.';
    default:
      return 'No es posible clasificar automáticamente este requisito; requiere revisión humana.';
  }
}
