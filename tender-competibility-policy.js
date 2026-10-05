// Política pura de competibilidad de procesos (tender-competibility-policy): decide si un
// proceso de Radar sigue siendo una competencia abierta real o si evidencia conjunta
// verificable (o la falta de ella) obliga a ocultarlo o marcarlo incierto antes de convertir.
// Hide automático estrecho tipo Pereira: modalidad EXACTA `Contratación régimen especial`
// (no "con ofertas") + sin plazo + (proveedor nombrado o ref CTO/CONTRATO) → no_competible.

const CONTINUITY_TEXT_PATTERN = /prorroga|renovacion|continuidad/;
const ACCEPTANCE_TEXT_PATTERN = /adjudicacion|aceptacion|ejecucion/;
const COMBINING_DIACRITIC_MIN = 0x0300;
const COMBINING_DIACRITIC_MAX = 0x036f;

function normalizeText(value) {
  return Array.from(String(value || '').normalize('NFD'))
    .filter(ch => {
      const code = ch.codePointAt(0);
      return code < COMBINING_DIACRITIC_MIN || code > COMBINING_DIACRITIC_MAX;
    })
    .join('')
    .toLowerCase();
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidHttpUrl(value) {
  if (!isNonEmptyString(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function hasValidFutureDeadline(value, nowIso) {
  if (!value) return false;
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) return false;
  const now = new Date(nowIso || Date.now()).getTime();
  return parsed >= now;
}

// Campos estructurados booleanos u objetos de evidencia ({kind, source_field, value}): se
// consideran "presentes" si son true o, siendo objeto, tienen un `value` no vacío.
function isPresentEvidenceField(field) {
  if (field === true) return true;
  if (field && typeof field === 'object') {
    const value = field.value;
    if (typeof value === 'string') return isNonEmptyString(value);
    if (typeof value === 'boolean') return value === true;
    return value != null && value !== '';
  }
  return false;
}

// El incumbente es válido como string no vacío o como objeto con `name` no vacío.
function isValidIncumbent(incumbent) {
  if (isNonEmptyString(incumbent)) return true;
  if (incumbent && typeof incumbent === 'object') return isNonEmptyString(incumbent.name);
  return false;
}

function rowText(row) {
  return `${row?.title || ''} ${row?.description || row?.desc || ''}`;
}

// Sólo la evidencia estructurada de la raíz o de raw.competibility_evidence puede bloquear
// la conversión; nunca se deriva no_competible de texto libre (title/description/raw crudo).
function structuredEvidenceCandidates(row) {
  return [row?.competibility_evidence, row?.raw?.competibility_evidence].filter(
    evidence => evidence && typeof evidence === 'object',
  );
}

function hasBlockingStructuredEvidence(row) {
  return structuredEvidenceCandidates(row).some(evidence => (
    isPresentEvidenceField(evidence.continuity_or_renewal)
    && isPresentEvidenceField(evidence.acceptance_award_or_execution)
    && isValidIncumbent(evidence.incumbent)
    && isValidHttpUrl(evidence.evidence_url)
  ));
}

// Registro curado de evidencia estructurada ya verificada manualmente, para los casos en que
// no existe (todavía) una vía de producción en UI/esquema para capturarla en la fila misma.
// Clave por identificadores EXACTOS de proceso (ref + process_id); una coincidencia parcial de
// un solo identificador nunca debe activar una entrada. Caso sembrado: EPM CW396234 /
// CO1.REQ.10871299, continuidad+aceptación con el incumbente ENETEL S.A.S.
export const CURATED_COMPETIBILITY_EVIDENCE_REGISTRY = [
  {
    ref: 'CW396234',
    process_id: 'CO1.REQ.10871299',
    evidence: {
      continuity_or_renewal: true,
      acceptance_award_or_execution: true,
      incumbent: 'ENETEL S.A.S.',
      evidence_url: 'https://community.secop.gov.co/Public/Tendering/NoticeDetail/Index?noticeUID=CO1.NTC.10678178',
    },
  },
  {
    ref: 'CTO 08 DE 2025',
    process_id: 'CO1.REQ.10512285',
    evidence: {
      continuity_or_renewal: true,
      acceptance_award_or_execution: true,
      incumbent: 'ESTATAL DE SEGURIDAD LTDA',
      evidence_url: 'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.10396378',
    },
  },
];

function curatedEvidenceEntryForRow(row) {
  return CURATED_COMPETIBILITY_EVIDENCE_REGISTRY.find(entry => (
    isNonEmptyString(row?.ref) && isNonEmptyString(row?.process_id)
    && entry.ref === row.ref && entry.process_id === row.process_id
  )) || null;
}

function hasCuratedBlockingEvidence(row) {
  const entry = curatedEvidenceEntryForRow(row);
  if (!entry) return false;
  const evidence = entry.evidence;
  return isPresentEvidenceField(evidence.continuity_or_renewal)
    && isPresentEvidenceField(evidence.acceptance_award_or_execution)
    && isValidIncumbent(evidence.incumbent)
    && isValidHttpUrl(evidence.evidence_url);
}

// Campos de texto libre adicionales a inspeccionar: los directos de la fila y los strings
// anidados inmediatamente dentro de `raw` (sin recursión profunda).
function unstructuredTextFields(row) {
  const fields = [row?.title, row?.description, row?.desc, row?.status, row?.category, row?.modality, row?.regimen];
  const raw = row?.raw;
  if (raw && typeof raw === 'object') {
    for (const value of Object.values(raw)) {
      if (typeof value === 'string') fields.push(value);
    }
  }
  return fields;
}

function freeTextSignals(row) {
  const text = normalizeText(unstructuredTextFields(row).join(' '));
  return {
    continuity: CONTINUITY_TEXT_PATTERN.test(text),
    acceptance: ACCEPTANCE_TEXT_PATTERN.test(text),
  };
}

function isSpecialRegimen(row) {
  const raw = row?.raw && typeof row.raw === 'object' ? row.raw : {};
  const candidates = [
    row?.regimen,
    row?.modality,
    row?.category,
    row?.modalidad_de_contratacion,
    raw.regimen,
    raw.modality,
    raw.regime,
    raw.modalidad,
    raw.modalidad_de_contratacion,
  ];
  if (candidates.some(value => normalizeText(value).includes('especial'))) return true;
  return /regimen especial/.test(normalizeText(rowText(row)));
}

function specialRegimeDeadline(row) {
  const raw = row?.raw && typeof row.raw === 'object' ? row.raw : {};
  return row?.deadline_at ?? row?.deadline ?? raw.deadline ?? raw.fecha_de_recepcion_de;
}

const EXACT_SPECIAL_REGIMEN = 'Contratación régimen especial';
const UNNAMED_PROVEEDOR = new Set(['', 'no definido', 'no aplica', 'n/a', 'na', '.', '-', 'none', 'null']);

function isExactSpecialRegimenNotConOfertas(row) {
  const raw = row?.raw && typeof row.raw === 'object' ? row.raw : {};
  const candidates = [row?.modalidad_de_contratacion, raw.modalidad_de_contratacion];
  return candidates.some(value => String(value || '').trim() === EXACT_SPECIAL_REGIMEN);
}

function isNamedProveedor(row) {
  const raw = row?.raw && typeof row.raw === 'object' ? row.raw : {};
  const candidates = [row?.nombre_del_proveedor, raw.nombre_del_proveedor];
  return candidates.some(value => {
    const trimmed = String(value ?? '').trim();
    return trimmed.length > 0 && !UNNAMED_PROVEEDOR.has(normalizeText(trimmed));
  });
}

function hasCtoOrContratoRef(row) {
  const raw = row?.raw && typeof row.raw === 'object' ? row.raw : {};
  const ref = `${row?.ref || ''} ${raw.referencia_del_proceso || ''}`;
  return /\bCTO\b|CONTRATO/i.test(ref);
}

function isSpecialRegimePublicity(row, nowIso) {
  if (!isExactSpecialRegimenNotConOfertas(row)) return false;
  if (hasValidFutureDeadline(specialRegimeDeadline(row), nowIso)) return false;
  return isNamedProveedor(row) || hasCtoOrContratoRef(row);
}

function isConvertedRow(row) {
  // Convertida de verdad: confirmación manual o estado interno. Un converted_opportunity_id
  // colgado (fila aún `nueva`) no bypass: EPM CW396234 vive así y debe seguir no_competible.
  return row?.converted === true
    || row?.internal_status === 'convertida_oportunidad';
}

export function evaluateTenderCompetibility(row, { nowIso } = {}) {
  if (isConvertedRow(row)) return { status: 'competible' };
  if (hasBlockingStructuredEvidence(row) || hasCuratedBlockingEvidence(row)) return { status: 'no_competible' };
  if (isSpecialRegimePublicity(row, nowIso)) return { status: 'no_competible' };
  const signals = freeTextSignals(row);
  if (signals.continuity && signals.acceptance) return { status: 'por_verificar' };
  return { status: 'competible' };
}

export function filterActiveTenderCompetibilityRows(rows, { nowIso } = {}) {
  if (!Array.isArray(rows)) return [];
  return rows.filter(row => evaluateTenderCompetibility(row, { nowIso }).status === 'competible');
}

// API SOLO DE FILA: siempre evalúa la fila con la política pura. Nunca debe aceptar ni confiar
// en un `row.status` ordinario (texto de estado del proceso) como si fuera un resultado de
// política ya calculado, aunque coincida por accidente con un valor de status interno.
export function requireTenderCompetibleForConversion(row, { nowIso } = {}) {
  const result = evaluateTenderCompetibility(row, { nowIso });
  if (result.status === 'competible') return result;
  // Mensaje público genérico: nunca debe filtrar la etiqueta interna de decisión al cliente HTTP.
  const error = new Error('La licitación no está disponible para conversión en este momento.');
  error.code = 'TENDER_COMPETIBILITY_BLOCKED';
  error.status = 409;
  throw error;
}
