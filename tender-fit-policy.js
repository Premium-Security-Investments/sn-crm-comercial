import { extractTenderCoreServiceTerms } from './tender-relevance-terms.js';

export const TENDER_FIT_POLICY_VERSION = 'tender-fit-v1';

const TENDER_FIT_COMBINING_DIACRITICS_REGEX = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, 'g');

function normalizeTenderFitText(value) {
  return String(value || '').normalize('NFD').replace(TENDER_FIT_COMBINING_DIACRITICS_REGEX, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const PHYSICAL_SERVICE_TERMS_NORMALIZED = new Set([
  'vigilancia y seguridad privada', 'vigilancia y seguridad', 'servicios de vigilancia', 'servicio de vigilancia',
  'vigilancia armada', 'vigilancia privada', 'seguridad privada',
].map(normalizeTenderFitText));

const ELECTRONIC_SERVICE_TERMS_NORMALIZED = new Set([
  'seguridad electronica', 'seguridad electrónica', 'cctv', 'videovigilancia', 'video vigilancia',
  'control de acceso', 'circuito cerrado',
].map(normalizeTenderFitText));

const TERRITORY_FOCUS_ALIASES = [
  'bogota', 'bogotá', 'cundinamarca', 'soacha', 'mosquera', 'chia', 'chía', 'funza', 'facatativa', 'zipaquira', 'zipaquirá',
  'medellin', 'medellín', 'antioquia', 'envigado', 'bello', 'itagui', 'itagüí', 'sabaneta', 'rio negro', 'rionegro',
].map(normalizeTenderFitText);

function parseTenderFitCalendarDayNumber(deadline) {
  if (deadline === null || deadline === undefined) return null;
  const match = String(deadline).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, offset] = match;
  const calendarDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (calendarDate.getUTCFullYear() !== Number(year) || calendarDate.getUTCMonth() !== Number(month) - 1 || calendarDate.getUTCDate() !== Number(day)) return null;
  if (hour !== undefined && (Number(hour) > 23 || Number(minute) > 59 || (second !== undefined && Number(second) > 59))) return null;
  if (offset && offset !== 'Z') {
    const offsetMatch = offset.match(/^[+-](\d{2}):?(\d{2})$/);
    if (!offsetMatch) return null;
    const offsetHours = Number(offsetMatch[1]);
    const offsetMinutes = Number(offsetMatch[2]);
    if (offsetHours > 14 || offsetMinutes > 59 || (offsetHours === 14 && offsetMinutes !== 0)) return null;
  }
  return calendarDate.getTime() / 86_400_000;
}

function bogotaCalendarDayNumber(nowDate) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(nowDate);
  const year = parts.find(part => part.type === 'year').value;
  const month = parts.find(part => part.type === 'month').value;
  const day = parts.find(part => part.type === 'day').value;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getTime() / 86_400_000;
}

function evaluateServicioAxis(tender) {
  const text = `${tender.title || ''} ${tender.description || ''}`;
  const foundTerms = extractTenderCoreServiceTerms(text);
  const physicalFound = foundTerms.filter(term => PHYSICAL_SERVICE_TERMS_NORMALIZED.has(term));
  const electronicFound = foundTerms.filter(term => ELECTRONIC_SERVICE_TERMS_NORMALIZED.has(term));
  if (physicalFound.length) {
    return { points: 50, code: 'servicio_fisico', detail: `término(s) de vigilancia física/privada/armada: ${physicalFound.join(', ')}` };
  }
  if (electronicFound.length) {
    return { points: 40, code: 'servicio_electronico', detail: `término(s) de seguridad electrónica/CCTV/control de acceso: ${electronicFound.join(', ')}` };
  }
  return { points: 0, code: 'servicio_ausente', detail: 'sin término de vigilancia/seguridad reconocido en título/descripción' };
}

function evaluateEscalaComercialAxis(tender) {
  let value = Number(tender.value);
  if (!Number.isFinite(value)) value = 0;
  const criticalGap = value <= 0;
  if (criticalGap) {
    return { points: 0, code: 'valor_ausente', detail: 'valor del contrato ausente o no positivo', value, criticalGap };
  }
  if (value < 50_000_000) return { points: 0, code: 'valor_bajo', detail: `valor COP ${value} (<50m)`, value, criticalGap };
  if (value < 500_000_000) return { points: 6, code: 'valor_50m_500m', detail: `valor COP ${value} (50m-500m)`, value, criticalGap };
  if (value < 1_000_000_000) return { points: 12, code: 'valor_500m_1b', detail: `valor COP ${value} (500m-1b)`, value, criticalGap };
  if (value < 10_000_000_000) return { points: 20, code: 'valor_1b_10b', detail: `valor COP ${value} (1b-10b)`, value, criticalGap };
  if (value <= 30_000_000_000) return { points: 16, code: 'valor_10b_30b', detail: `valor COP ${value} (10b-30b)`, value, criticalGap };
  return { points: 10, code: 'valor_mayor_30b', detail: `valor COP ${value} (>30b)`, value, criticalGap };
}

function evaluateTerritorioAxis(tender) {
  const cityNorm = normalizeTenderFitText(tender.city);
  const deptNorm = normalizeTenderFitText(tender.dept);
  const hasTerritoryData = Boolean(cityNorm || deptNorm);
  if (!hasTerritoryData) {
    return { points: 0, code: 'territorio_ausente', detail: 'ciudad y departamento ausentes', hasTerritoryData };
  }
  const haystack = normalizeTenderFitText(`${tender.city || ''} ${tender.dept || ''}`);
  const inFocus = TERRITORY_FOCUS_ALIASES.some(alias => haystack.includes(alias));
  if (inFocus) {
    return { points: 15, code: 'territorio_foco', detail: 'ciudad/departamento en foco Bogotá/Cundinamarca o Medellín/Antioquia', hasTerritoryData };
  }
  return { points: 0, code: 'territorio_otro', detail: 'ciudad/departamento conocido fuera del foco actual', hasTerritoryData };
}

function evaluateVentanaOperativaAxis(tender, nowDate) {
  const deadlineDayNumber = parseTenderFitCalendarDayNumber(tender.deadline_at);
  const criticalGap = deadlineDayNumber === null;
  if (criticalGap) {
    return { points: 0, code: 'fecha_ausente', detail: 'fecha de cierre ausente o no verificable', criticalGap };
  }
  const todayDayNumber = bogotaCalendarDayNumber(nowDate);
  const days = deadlineDayNumber - todayDayNumber;
  if (days < 0) return { points: 0, code: 'ventana_vencida', detail: `fecha de cierre vencida hace ${Math.abs(days)} día(s)`, criticalGap };
  if (days <= 7) return { points: 4, code: 'ventana_urgente', detail: `${days} día(s) hasta el cierre`, criticalGap };
  if (days <= 15) return { points: 10, code: 'ventana_media', detail: `${days} día(s) hasta el cierre`, criticalGap };
  return { points: 15, code: 'ventana_amplia', detail: `${days} día(s) hasta el cierre`, criticalGap };
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

  const servicio = evaluateServicioAxis(tender);
  const escala = evaluateEscalaComercialAxis(tender);
  const territorio = evaluateTerritorioAxis(tender);
  const ventana = evaluateVentanaOperativaAxis(tender, nowDate);

  const rawScore = servicio.points + escala.points + territorio.points + ventana.points;
  const score = Math.max(0, Math.min(100, rawScore));

  const hasCriticalGap = escala.criticalGap || ventana.criticalGap;
  let band;
  if (servicio.points === 0) band = 'bajo';
  else if (hasCriticalGap) band = 'por_validar';
  else if (score >= 75) band = 'alto';
  else if (score < 45) band = 'bajo';
  else band = 'medio';

  const hasCategory = Boolean(String(tender.category || '').trim());
  let confidence;
  if (hasCriticalGap) confidence = 'baja';
  else if (escala.value > 0 && !ventana.criticalGap && territorio.hasTerritoryData && hasCategory) confidence = 'alta';
  else confidence = 'media';

  let participationHint;
  if (servicio.points === 0 || escala.criticalGap) participationHint = 'por_definir';
  else if (escala.value > 30_000_000_000) participationHint = 'alianza_probable';
  else participationHint = 'directa';

  const dataGaps = [];
  if (escala.criticalGap) {
    dataGaps.push({ gap_id: 'valor_no_reportado', field: 'value', severity: 'critical', detail: 'valor del contrato ausente o no positivo', source: 'value' });
  }
  if (ventana.criticalGap) {
    dataGaps.push({ gap_id: 'fecha_cierre_no_verificable', field: 'deadline_at', severity: 'critical', detail: 'fecha de cierre ausente o no parseable', source: 'deadline_at' });
  }
  if (!territorio.hasTerritoryData) {
    dataGaps.push({ gap_id: 'territorio_no_reportado', field: 'city/dept', severity: 'noncritical', detail: 'ciudad y departamento ausentes', source: 'city+dept' });
  }
  if (!hasCategory) {
    dataGaps.push({ gap_id: 'categoria_no_reportada', field: 'category', severity: 'noncritical', detail: 'categoría del proceso ausente', source: 'category' });
  }

  return {
    policy_version: TENDER_FIT_POLICY_VERSION,
    score,
    band,
    confidence,
    participation_hint: participationHint,
    reasons: [
      { axis: 'servicio', points: servicio.points, code: servicio.code, detail: servicio.detail, source: 'title+description' },
      { axis: 'escala_comercial', points: escala.points, code: escala.code, detail: escala.detail, source: 'value' },
      { axis: 'territorio', points: territorio.points, code: territorio.code, detail: territorio.detail, source: 'city+dept' },
      { axis: 'ventana_operativa', points: ventana.points, code: ventana.code, detail: ventana.detail, source: 'deadline_at' },
    ],
    data_gaps: dataGaps,
    feedback: { mode: 'evidence_only', applied_points: 0, policy: 'human_reviewed_version_only' },
    evaluated_at: nowIso,
  };
}
