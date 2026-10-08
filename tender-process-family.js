// AGT-002 · Familias de proceso SECOP II (republicaciones).
//
// Cuando una entidad modifica un proceso en SECOP II, SECOP lo publica como un proceso NUEVO
// (nuevo id_del_proceso CO1.REQ.*, nuevo noticeUID) con la MISMA referencia_del_proceso salvo
// puntuación o espacios: 'CDPS-0312-2026' / 'CDPS-0312-2026.', 'CP-SDSD-440-2026' /
// 'CP-SDSD-440-2026*', '323-2026' / '323--2026', 'SCJ-SIF-CD-347- 2026' / 'SCJ-SIF-CD-347-2026'.
// La identidad propia de cada fila (stable_key) los separa; este módulo los reúne en una "familia"
// (misma fuente + misma entidad normalizada + misma referencia alfanumérica) y elige la versión
// vigente: la más reciente por fecha de publicación (empate: número de proceso mayor).
//
// Módulo puro: sin red, sin base de datos, sin dependencias de AGT-003.

export const TENDER_PROCESS_FAMILY_SOURCES = new Set(['SECOP II']);
export const TENDER_PROCESS_FAMILY_MIN_REFERENCE_LENGTH = 6;

// SECOP II publica cada fase como otro proceso con la referencia original más uno o varios sufijos de fase,
// a veces anidados: "LP-004-2026 (Presentación de oferta)", "SA-006-2026 (Manifestación de interés (Menor
// Cuantía)) (Presentación de oferta)", "CAS-LP-001-2026 (Fase de Selección (Presentación de ofertas))".
const PHASE_SUFFIX_RE = /^(?:fase de |presentacion de |manifestacion de interes|evaluacion de |apertura de |seleccion)/;

/** Separa los sufijos de fase finales (normalizados, de afuera hacia adentro en orden de aparición) de la referencia. */
export function splitTrailingPhaseSuffixes(text) {
  let base = String(text || '').trim();
  const suffixes = [];
  while (base.endsWith(')')) {
    let depth = 0;
    let open = -1;
    for (let index = base.length - 1; index >= 0; index -= 1) {
      if (base[index] === ')') depth += 1;
      else if (base[index] === '(' && --depth === 0) { open = index; break; }
    }
    if (open < 0) break;
    const inner = stripAccents(base.slice(open + 1, -1)).toLowerCase().trim();
    if (!PHASE_SUFFIX_RE.test(inner)) break;
    suffixes.unshift(inner);
    base = base.slice(0, open).trim();
  }
  return { base, suffixes };
}

const withoutPhaseSuffixes = reference => splitTrailingPhaseSuffixes(stripAccents(reference)).base;

// Referencias que no identifican un proceso: valores de relleno o puras etiquetas de modalidad.
const GENERIC_REFERENCES = new Set([
  'NA', 'NOAPLICA', 'SINREFERENCIA', 'SINNUMERO', 'SINDATO', 'SINDATOS', 'PENDIENTE', 'NINGUNO', 'NINGUNA',
  'LICITACIONPUBLICA', 'CONTRATACIONDIRECTA', 'SELECCIONABREVIADA', 'MINIMACUANTIA', 'CONCURSODEMERITOS',
  'REGIMENESPECIAL', 'SUBASTAINVERSA', 'INVITACIONPUBLICA', 'INVITACIONPRIVADA', 'SOLICITUDDEOFERTA',
]);

function stripAccents(value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** 'CDPS-0312-2026.' → 'CDPS03122026'. Quita el sufijo de fase y todo carácter no alfanumérico. */
export function normalizeTenderFamilyReference(reference) {
  return withoutPhaseSuffixes(reference).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/**
 * 'Rama Judicial \u0096 Dirección' → 'rama judicial direccion'. Quita tildes y caracteres de control y junta espacios,
 * pero conserva la puntuación: SECOP distingue entidades homónimas con ella ('HOSPITAL SAN RAFAEL +' y
 * 'HOSPITAL SAN RAFAEL.*'), igual que la continuidad de fases (tender-phase-identity.js).
 */
export function normalizeTenderFamilyEntity(entity) {
  return stripAccents(entity).toLowerCase().replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Guarda contra falsos positivos: una referencia corta o genérica (sin número propio, sólo un año,
 * un dígito repetido, o una etiqueta de modalidad) no basta para afirmar que dos procesos son el mismo.
 */
export function isDistinctiveTenderFamilyReference(normalizedReference) {
  const ref = String(normalizedReference || '');
  if (ref.length < TENDER_PROCESS_FAMILY_MIN_REFERENCE_LENGTH) return false;
  if (GENERIC_REFERENCES.has(ref)) return false;
  if (/^(.)\1*$/.test(ref)) return false;
  const digits = ref.replace(/\D/g, '');
  if (!digits) return false;
  // Sin contar un año (19xx/20xx), debe quedar algún número propio del proceso: 'LP2026' no basta.
  const withoutYear = digits.replace(/(?:19|20)\d{2}/, '');
  if (!withoutYear || /^0+$/.test(withoutYear)) return false;
  return true;
}

/** Clave de familia o `null` cuando la fila no admite agrupación segura. */
export function tenderProcessFamilyKey(tender) {
  if (!tender || !TENDER_PROCESS_FAMILY_SOURCES.has(String(tender.source || ''))) return null;
  const entity = normalizeTenderFamilyEntity(tender.entity);
  if (!entity || entity === 'sin entidad') return null;
  const reference = normalizeTenderFamilyReference(tender.ref);
  if (!isDistinctiveTenderFamilyReference(reference)) return null;
  // La misma secuencia de grupos de dígitos: '4143.010.32.1.827-2026' y '4143.010.32.1827-2026'
  // (ambas usadas por Cali) dan la misma cadena alfanumérica pero son procesos distintos.
  return `${tender.source}|${entity}|${reference}|${tenderFamilyDigitGroups(tender.ref).join('.')}`;
}

/** 'SCJ-SIF-CD-347- 2026' → ['347', '2026']; ignora el sufijo de fase. */
export function tenderFamilyDigitGroups(reference) {
  return withoutPhaseSuffixes(reference).match(/\d+/g) || [];
}

/** Referencia tal cual (minúsculas, sin tildes ni sufijo de fase), sin quitar puntuación final. */
function referenceWithoutPhaseSuffix(reference) {
  return withoutPhaseSuffixes(reference).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Republicación por modificación: dos filas SECOP II de la misma familia cuyas referencias, aparte
 * del sufijo de fase, difieren en puntuación o espacios ('CDPS-0312-2026' / 'CDPS-0312-2026.').
 * El paso de borrador a "(Presentación de oferta)" deja la misma referencia y NO es republicación.
 */
export function isTenderRepublicationPair(a, b) {
  const familyKey = tenderProcessFamilyKey(a);
  if (!familyKey || familyKey !== tenderProcessFamilyKey(b)) return false;
  return referenceWithoutPhaseSuffix(a.ref) !== referenceWithoutPhaseSuffix(b.ref);
}

// Estados oficiales terminales: un proceso en estos estados nunca pasa a ser la fuente vigente.
const TERMINAL_STATUS_TERMS = ['adjudicado', 'seleccionado', 'celebrado', 'cancelado', 'desierto', 'revocado', 'terminado', 'liquidado', 'suspendido', 'cerrado', 'anulado', 'expirado'];
export function isTerminalTenderStatus(status) {
  const text = stripAccents(status).toLowerCase();
  return TERMINAL_STATUS_TERMS.some(term => text.includes(term));
}

export function tenderFamilyPublishedMs(tender) {
  const parsed = Date.parse(tender?.published_at || tender?.published || '');
  return Number.isFinite(parsed) ? parsed : null;
}

/** 'CO1.REQ.11038226' → 11038226 (último grupo de dígitos), o `null`. */
export function tenderFamilyProcessNumber(tender) {
  const groups = String(tender?.process_id || '').match(/\d+/g);
  if (!groups) return null;
  const parsed = Number(groups[groups.length - 1]);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * >0 si `a` es una versión más reciente que `b`, <0 si es más antigua, 0 si no se puede decidir.
 * Sólo decide cuando ambas filas traen fecha de publicación: la más reciente gana y, a igual
 * fecha, el número de proceso mayor. Sin fechas no se adivina (el llamador conserva su regla).
 */
export function compareTenderFamilyRecency(a, b) {
  const publishedA = tenderFamilyPublishedMs(a);
  const publishedB = tenderFamilyPublishedMs(b);
  if (publishedA === null || publishedB === null) return 0;
  if (publishedA !== publishedB) return publishedA > publishedB ? 1 : -1;
  const numberA = tenderFamilyProcessNumber(a);
  const numberB = tenderFamilyProcessNumber(b);
  if (numberA === null || numberB === null || numberA === numberB) return 0;
  return numberA > numberB ? 1 : -1;
}

function isConvertedFamilyMember(row) {
  return row?.internal_status === 'convertida_oportunidad' || Boolean(row?.converted_opportunity_id);
}

/**
 * Agrupa filas en familias de proceso. Devuelve sólo familias con dos o más miembros (con
 * stable_key distinto), cada una con su versión vigente (`current`) y las anteriores (`superseded`).
 * Una familia sin un "más reciente" único (fechas faltantes o empatadas) queda con `current: null`:
 * no se oculta nada que no se pueda ordenar con certeza.
 */
export function groupTenderProcessFamilies(rows) {
  const byKey = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = tenderProcessFamilyKey(row);
    if (!key || !row?.stable_key) continue;
    const members = byKey.get(key) || new Map();
    if (!members.has(row.stable_key)) members.set(row.stable_key, row);
    byKey.set(key, members);
  }
  const families = [];
  for (const [key, membersByStableKey] of byKey) {
    const members = [...membersByStableKey.values()];
    if (members.length < 2) continue;
    const newest = members.filter(candidate => members.every(other => other === candidate || compareTenderFamilyRecency(candidate, other) > 0));
    const current = newest.length === 1 ? newest[0] : null;
    families.push({
      key,
      members,
      current,
      superseded: current ? members.filter(member => member !== current) : [],
      converted: members.filter(isConvertedFamilyMember),
    });
  }
  return families;
}

// Una fila que una persona está revisando o siguiendo nunca se oculta: queda visible junto a la vigente.
function isHumanManagedFamilyMember(row) {
  return row?.internal_status === 'en_revision' || Boolean(row?.tracking_owner_id);
}

/**
 * Plan de persistencia para familias SIN miembro convertido (los convertidos los resuelve
 * planRadarPhaseIdentitySync). Para cada familia con versión vigente única:
 *   - `supersededMarks`: filas anteriores a marcar como reemplazadas (sin borrarlas), salvo las que
 *     están en revisión o en seguimiento, que siguen visibles.
 *   - `inheritedStatuses`: si la anterior estaba descartada, la vigente que aún no existía en la base
 *     también queda descartada (no reaparece como "nueva" algo que ya se descartó).
 * Determinista e idempotente: las mismas entradas producen el mismo plan.
 */
export function planTenderProcessFamilySupersession({ rows = [], existingStableKeys = new Set() } = {}) {
  const existingKeys = existingStableKeys instanceof Set ? existingStableKeys : new Set(existingStableKeys || []);
  const supersededMarks = [];
  const inheritedStatuses = [];
  for (const family of groupTenderProcessFamilies(rows)) {
    if (!family.current || family.converted.length) continue;
    const current = family.current;
    for (const member of family.superseded) {
      if (isHumanManagedFamilyMember(member)) continue;
      supersededMarks.push({
        stable_key: member.stable_key,
        superseded_by: {
          stable_key: current.stable_key,
          process_id: current.process_id || null,
          url: current.url || null,
          ref: current.ref || null,
        },
      });
    }
    if (existingKeys.has(current.stable_key)) continue;
    if (family.superseded.some(member => member.internal_status === 'descartada') && !family.superseded.some(isHumanManagedFamilyMember)) {
      inheritedStatuses.push({ stable_key: current.stable_key, internal_status: 'descartada' });
    }
  }
  return { supersededMarks, inheritedStatuses };
}

/** Anota (o limpia) en `raw` que la fila fue reemplazada por una versión nueva del mismo proceso. */
export function withProcessFamilySupersededRaw(baseRaw, supersededBy) {
  if (supersededBy) return { ...(baseRaw || {}), process_family_superseded_by: supersededBy };
  if (baseRaw && Object.hasOwn(baseRaw, 'process_family_superseded_by')) {
    const { process_family_superseded_by: _dropped, ...rest } = baseRaw;
    return rest;
  }
  return baseRaw || null;
}

export function isProcessFamilySupersededRow(row) {
  return Boolean(row?.raw?.process_family_superseded_by) && !isConvertedFamilyMember(row);
}
