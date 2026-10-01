import { evaluateTenderServiceMatrixV2 } from './tender-service-matrix-v2.js';
import { countColombiaBusinessDays } from './tender-fit-v2-business-days.js';
import {
  SMMLV_2026,
  VALUE_FAMILY_FLOORS_SMMLV,
  VALUE_BAND_THRESHOLDS_SMMLV,
  VALUE_BAND_POINTS,
  CAPACITY_FINANCIAL_REVIEW_THRESHOLD_COP,
  CAPACITY_FINANCIAL_ASSUMED_PERCENTAGE,
  CORPORATE_MAX_DEBT_RATIO,
  CORPORATE_EXPERIENCE_CAPACITY_SMMLV,
  TERRITORY_EXACT_CITY_POINTS_15,
  TERRITORY_EXACT_CITY_POINTS_10,
  TERRITORY_DEPARTMENTS_POINTS_5,
  TERRITORY_NATIONAL_COVERAGE_PHRASES,
  TIME_BUSINESS_DAY_BANDS,
  TIME_BUSINESS_DAY_POINTS_ABOVE_20,
  TIME_MISSING_DEADLINE_POINTS,
  TIME_FORCED_LOW_BUSINESS_DAY_THRESHOLD,
  SCORE_BANDS,
  REASON_IMPACT_PRIORITY_GROUPS,
} from './tender-fit-v2-parameters.js';

export const TENDER_FIT_POLICY_VERSION = 'tender-fit-v2';

const TENDER_FIT_COMBINING_DIACRITICS_REGEX = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, 'g');

function normalizeTenderFitV2Text(value) {
  return String(value || '').normalize('NFD').replace(TENDER_FIT_COMBINING_DIACRITICS_REGEX, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const TERRITORY_CITY_15_SET = new Set(TERRITORY_EXACT_CITY_POINTS_15.map(normalizeTenderFitV2Text));
// Variantes de puntuación comunes para "Bogotá D.C." que deben seguir siendo una
// coincidencia EXACTA (no por contención) tras la canonicalización.
TERRITORY_CITY_15_SET.add(normalizeTenderFitV2Text('Bogotá D.C.'));
TERRITORY_CITY_15_SET.add(normalizeTenderFitV2Text('Bogotá DC'));
const TERRITORY_CITY_10_SET = new Set(TERRITORY_EXACT_CITY_POINTS_10.map(normalizeTenderFitV2Text));
const TERRITORY_DEPT_5_SET = new Set(TERRITORY_DEPARTMENTS_POINTS_5.map(normalizeTenderFitV2Text));
const TERRITORY_NATIONAL_COVERAGE_PHRASES_NORMALIZED = TERRITORY_NATIONAL_COVERAGE_PHRASES.map(normalizeTenderFitV2Text);

const DATA_GAP_FIELD_BY_CODE = {
  servicio_ambiguo: 'title+description+detail',
  valor_ausente: 'value',
  valor_bajo_piso: 'value',
  capacidad_financiera_por_validar: 'value',
  endeudamiento_por_validar: 'required_max_debt_ratio',
  experiencia_por_validar: 'required_experience_smmlv',
  territorio_indeterminado: 'city+dept',
  cobertura_por_validar: 'title+description+detail',
  plazo_ausente: 'deadline_at',
};

function tenderFitV2ImpactPriorityOf(code) {
  const index = REASON_IMPACT_PRIORITY_GROUPS.findIndex(group => group.includes(code));
  return index === -1 ? REASON_IMPACT_PRIORITY_GROUPS.length : index;
}

export function classifyTenderFitV2ScoreBand(score) {
  if (score >= SCORE_BANDS.ALTO_MIN) return 'alto';
  if (score >= SCORE_BANDS.MEDIO_MIN) return 'medio';
  return 'bajo';
}

export function compareTenderFitV2ReasonsByImpact(a, b) {
  const priorityA = typeof a.impact_priority === 'number' ? a.impact_priority : tenderFitV2ImpactPriorityOf(a.code);
  const priorityB = typeof b.impact_priority === 'number' ? b.impact_priority : tenderFitV2ImpactPriorityOf(b.code);
  if (priorityA !== priorityB) return priorityA - priorityB;
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  if (a.axis !== b.axis) return a.axis < b.axis ? -1 : 1;
  return 0;
}

function bogotaCalendarDateIso(date) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const year = parts.find(part => part.type === 'year').value;
  const month = parts.find(part => part.type === 'month').value;
  const day = parts.find(part => part.type === 'day').value;
  return `${year}-${month}-${day}`;
}

function isValidIsoCalendarComponents(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

// Deriva la fecha de calendario de cierre en la zona America/Bogota, aceptando tanto
// fechas sin hora (YYYY-MM-DD, tratadas como fecha de calendario directa) como
// timestamps ISO con zona (convertidos al día de calendario de Bogotá). Devuelve
// null si el valor es ausente o no es parseable de forma confiable.
function parseClosingBogotaDateIso(deadlineAt) {
  if (typeof deadlineAt !== 'string') return null;

  const dateOnlyMatch = deadlineAt.match(DATE_ONLY_RE);
  if (dateOnlyMatch) {
    const [, yearStr, monthStr, dayStr] = dateOnlyMatch;
    if (!isValidIsoCalendarComponents(Number(yearStr), Number(monthStr), Number(dayStr))) return null;
    return `${yearStr}-${monthStr}-${dayStr}`;
  }

  const timestampMatch = deadlineAt.match(ISO_TIMESTAMP_RE);
  if (!timestampMatch) return null;
  const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr, offset] = timestampMatch;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const second = secondStr !== undefined ? Number(secondStr) : 0;
  if (!isValidIsoCalendarComponents(year, month, day)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  let offsetMinutesTotal = 0;
  if (offset !== 'Z') {
    const offsetMatch = offset.match(/^([+-])(\d{2}):?(\d{2})$/);
    if (!offsetMatch) return null;
    const sign = offsetMatch[1] === '-' ? -1 : 1;
    const offsetHours = Number(offsetMatch[2]);
    const offsetMinutes = Number(offsetMatch[3]);
    if (offsetHours > 14 || offsetMinutes > 59 || (offsetHours === 14 && offsetMinutes !== 0)) return null;
    offsetMinutesTotal = sign * (offsetHours * 60 + offsetMinutes);
  }
  const utcMillis = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutesTotal * 60_000;
  return bogotaCalendarDateIso(new Date(utcMillis));
}

function pointsForBusinessDays(businessDays) {
  for (const band of TIME_BUSINESS_DAY_BANDS) {
    if (businessDays <= band.max) return band.points;
  }
  return TIME_BUSINESS_DAY_POINTS_ABOVE_20;
}

function evaluateServicioAxis(tender) {
  const matrixResult = evaluateTenderServiceMatrixV2({ title: tender.title, description: tender.description, detail: tender.detail });
  let code;
  let critical = false;
  switch (matrixResult.family) {
    case 'HIBRIDA': code = 'servicio_hibrida'; break;
    case 'ELECTRONICA': code = 'servicio_electronica'; break;
    case 'FISICA': code = 'servicio_fisica'; break;
    case 'SUMINISTRO': code = 'servicio_suministro'; break;
    case 'AMBIGUA': code = 'servicio_ambiguo'; critical = true; break;
    default: code = 'servicio_fuera_de_alcance'; break;
  }
  return {
    axis: 'servicio',
    points: matrixResult.points,
    code,
    detail: `evaluateTenderServiceMatrixV2: status ${matrixResult.status}${matrixResult.family ? `, familia ${matrixResult.family}` : ''}`,
    source: 'title+description+detail',
    critical,
    family: matrixResult.family,
  };
}

function evaluateValorAxis(tender, servicioFamily) {
  const floorFamily = Object.prototype.hasOwnProperty.call(VALUE_FAMILY_FLOORS_SMMLV, servicioFamily) ? servicioFamily : 'FISICA';
  const floorSmmlv = VALUE_FAMILY_FLOORS_SMMLV[floorFamily];
  const floorCop = floorSmmlv * SMMLV_2026.value_cop;
  const numericValue = Number(tender.value);
  const hasPositiveValue = Number.isFinite(numericValue) && numericValue > 0;

  const extras = [];
  let base;
  if (!hasPositiveValue) {
    base = { axis: 'valor', points: 0, code: 'valor_ausente', detail: 'valor del contrato ausente o no positivo', source: 'value', critical: true };
  } else if (numericValue < floorCop) {
    base = {
      axis: 'valor', points: 0, code: 'valor_bajo_piso',
      detail: `valor COP ${numericValue} por debajo del piso de familia ${floorFamily} (COP ${floorCop})`,
      source: 'value', critical: true,
    };
  } else {
    const tier1MaxCop = VALUE_BAND_THRESHOLDS_SMMLV.TIER_1_MAX * SMMLV_2026.value_cop;
    const tier2MaxCop = VALUE_BAND_THRESHOLDS_SMMLV.TIER_2_MAX * SMMLV_2026.value_cop;
    const tier3MaxCop = VALUE_BAND_THRESHOLDS_SMMLV.TIER_3_MAX * SMMLV_2026.value_cop;
    let points;
    let code;
    if (numericValue < tier1MaxCop) { points = VALUE_BAND_POINTS.TIER_1; code = 'valor_banda_1'; }
    else if (numericValue < tier2MaxCop) { points = VALUE_BAND_POINTS.TIER_2; code = 'valor_banda_2'; }
    else if (numericValue < tier3MaxCop) { points = VALUE_BAND_POINTS.TIER_3; code = 'valor_banda_3'; }
    else { points = VALUE_BAND_POINTS.TIER_4; code = 'valor_banda_4'; }
    base = {
      axis: 'valor', points, code,
      detail: `valor COP ${numericValue} (familia ${floorFamily}, piso COP ${floorCop})`,
      source: 'value', critical: false,
    };

    if (numericValue > CAPACITY_FINANCIAL_REVIEW_THRESHOLD_COP) {
      extras.push({
        axis: 'valor', points: 0, code: 'capacidad_financiera_por_validar',
        detail: `valor COP ${numericValue} supera el límite de estimación de capacidad financiera (COP ${CAPACITY_FINANCIAL_REVIEW_THRESHOLD_COP}, supuesto del ${CAPACITY_FINANCIAL_ASSUMED_PERCENTAGE * 100}%)`,
        source: 'value', critical: true,
      });
    }
  }

  const requiredMaxDebtRatio = tender.required_max_debt_ratio;
  if (typeof requiredMaxDebtRatio === 'number' && Number.isFinite(requiredMaxDebtRatio) && requiredMaxDebtRatio < CORPORATE_MAX_DEBT_RATIO) {
    extras.push({
      axis: 'valor', points: 0, code: 'endeudamiento_por_validar',
      detail: `límite de endeudamiento exigido por el proceso (${requiredMaxDebtRatio}) es más restrictivo que el corporativo (${CORPORATE_MAX_DEBT_RATIO})`,
      source: 'required_max_debt_ratio', critical: true,
    });
  }

  const requiredExperienceSmmlv = tender.required_experience_smmlv;
  if (typeof requiredExperienceSmmlv === 'number' && Number.isFinite(requiredExperienceSmmlv) && requiredExperienceSmmlv > CORPORATE_EXPERIENCE_CAPACITY_SMMLV) {
    extras.push({
      axis: 'valor', points: 0, code: 'experiencia_por_validar',
      detail: `experiencia requerida por el proceso (${requiredExperienceSmmlv} SMMLV) supera la capacidad corporativa (${CORPORATE_EXPERIENCE_CAPACITY_SMMLV} SMMLV)`,
      source: 'required_experience_smmlv', critical: true,
    });
  }

  return { base, extras };
}

function evaluateTerritorioAxis(tender) {
  const cityNorm = normalizeTenderFitV2Text(tender.city);
  const deptNorm = normalizeTenderFitV2Text(tender.dept);
  const hasCityData = cityNorm.length > 0;
  const hasDeptData = deptNorm.length > 0;

  let base;
  if (!hasCityData && !hasDeptData) {
    base = { axis: 'territorio', points: 0, code: 'territorio_indeterminado', detail: 'ciudad y departamento ausentes o no confiables', source: 'city+dept', critical: true };
  } else if (hasCityData && TERRITORY_CITY_15_SET.has(cityNorm)) {
    base = { axis: 'territorio', points: 15, code: 'territorio_ciudad_foco_alta', detail: `ciudad "${tender.city}" en el foco de alta prioridad`, source: 'city+dept', critical: false };
  } else if (hasCityData && TERRITORY_CITY_10_SET.has(cityNorm)) {
    base = { axis: 'territorio', points: 10, code: 'territorio_ciudad_foco_media', detail: `ciudad "${tender.city}" en el foco de prioridad media`, source: 'city+dept', critical: false };
  } else if (hasDeptData && TERRITORY_DEPT_5_SET.has(deptNorm)) {
    base = { axis: 'territorio', points: 5, code: 'territorio_departamento_foco', detail: `departamento "${tender.dept}" en el foco`, source: 'city+dept', critical: false };
  } else {
    base = { axis: 'territorio', points: 0, code: 'territorio_fuera_de_foco', detail: 'ciudad/departamento conocido fuera del foco actual', source: 'city+dept', critical: false };
  }

  const coverageHaystack = normalizeTenderFitV2Text(`${tender.title || ''} ${tender.description || ''} ${tender.detail || ''}`);
  const hasNationalCoveragePhrase = TERRITORY_NATIONAL_COVERAGE_PHRASES_NORMALIZED.some(phrase => coverageHaystack.includes(phrase));
  const extras = [];
  if (hasNationalCoveragePhrase) {
    extras.push({
      axis: 'territorio', points: 0, code: 'cobertura_por_validar',
      detail: 'lenguaje de cobertura nacional detectado en título/descripción/detalle',
      source: 'title+description+detail', critical: true,
    });
  }

  return { base, extras };
}

function evaluateTiempoAxis(tender, evaluationDateIso) {
  const closingDateIso = parseClosingBogotaDateIso(tender.deadline_at);
  if (closingDateIso === null) {
    return {
      axis: 'tiempo', points: TIME_MISSING_DEADLINE_POINTS, code: 'plazo_ausente',
      detail: 'fecha de cierre ausente o no parseable de forma confiable',
      source: 'deadline_at', critical: true, forceLow: false,
    };
  }
  if (closingDateIso < evaluationDateIso) {
    return {
      axis: 'tiempo', points: 0, code: 'plazo_vencido',
      detail: `fecha de cierre (${closingDateIso}) ya venció respecto a la fecha de evaluación (${evaluationDateIso})`,
      source: 'deadline_at', critical: false, forceLow: true,
    };
  }
  const businessDays = closingDateIso === evaluationDateIso ? 0 : countColombiaBusinessDays(evaluationDateIso, closingDateIso);
  if (businessDays < TIME_FORCED_LOW_BUSINESS_DAY_THRESHOLD) {
    return {
      axis: 'tiempo', points: 0, code: 'plazo_insuficiente',
      detail: `${businessDays} día(s) hábil(es) disponibles hasta el cierre (${closingDateIso}), insuficiente`,
      source: 'deadline_at', critical: false, forceLow: true,
    };
  }
  return {
    axis: 'tiempo', points: pointsForBusinessDays(businessDays), code: 'plazo_disponible',
    detail: `${businessDays} día(s) hábil(es) disponibles hasta el cierre (${closingDateIso})`,
    source: 'deadline_at', critical: false, forceLow: false,
  };
}

export function evaluateTenderFit(tender, options) {
  if (tender === null || typeof tender !== 'object' || Array.isArray(tender)) {
    throw new TypeError('evaluateTenderFit: invalid tender argument (expected a plain object)');
  }
  const nowIso = options && options.nowIso;
  const nowDate = new Date(nowIso);
  if (typeof nowIso !== 'string' || Number.isNaN(nowDate.getTime()) || nowDate.toISOString() !== nowIso) {
    throw new TypeError('evaluateTenderFit: invalid nowIso argument (expected a canonical UTC ISO date string ending in Z)');
  }
  const evaluationDateIso = bogotaCalendarDateIso(nowDate);

  const servicio = evaluateServicioAxis(tender);
  const { base: valor, extras: valorExtras } = evaluateValorAxis(tender, servicio.family);
  const { base: territorio, extras: territorioExtras } = evaluateTerritorioAxis(tender);
  const tiempo = evaluateTiempoAxis(tender, evaluationDateIso);

  const score = Math.max(0, Math.min(100, servicio.points + valor.points + territorio.points + tiempo.points));

  const { forceLow, ...tiempoReason } = tiempo;

  const reasons = [servicio, valor, territorio, tiempoReason, ...valorExtras, ...territorioExtras]
    .map(reason => ({ ...reason, impact_priority: tenderFitV2ImpactPriorityOf(reason.code) }));

  const dataGaps = reasons
    .filter(reason => reason.critical)
    .map(reason => ({
      gap_id: reason.code,
      field: DATA_GAP_FIELD_BY_CODE[reason.code] || reason.source,
      severity: 'critical',
      detail: reason.detail,
      source: reason.source,
      impact_priority: reason.impact_priority,
    }))
    .sort((a, b) => (a.impact_priority !== b.impact_priority ? a.impact_priority - b.impact_priority : (a.gap_id < b.gap_id ? -1 : a.gap_id > b.gap_id ? 1 : 0)));

  const hasCriticalGap = dataGaps.length > 0;
  const outOfScope = servicio.code === 'servicio_fuera_de_alcance';

  let band;
  if (forceLow) band = 'bajo';
  else if (hasCriticalGap) band = 'por_validar';
  else band = classifyTenderFitV2ScoreBand(score);

  const confidence = hasCriticalGap ? 'baja' : 'alta';
  const participationHint = hasCriticalGap || outOfScope ? 'por_definir' : 'directa';

  return {
    policy_version: TENDER_FIT_POLICY_VERSION,
    score,
    band,
    confidence,
    participation_hint: participationHint,
    reasons,
    data_gaps: dataGaps,
    feedback: { mode: 'evidence_only', applied_points: 0, policy: 'human_reviewed_version_only' },
    evaluated_at: nowIso,
  };
}
