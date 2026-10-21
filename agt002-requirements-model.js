// Una sola lista: los requisitos del pliego (Juan, 2026-10-13). El análisis AGT-002 entrega requisitos,
// hallazgos, pendientes y fechas que hablan de lo mismo; aquí todo se cuelga del requisito al que se
// refiere. La misma fila sirve antes del GO (¿nos presentamos?) y, sembrada en el expediente, después
// (¿llegamos a tiempo?). Funciones puras sobre la proyección del reporte inicial
// (agt002-initial-analysis-report.js); la usan el navegador y el servidor.

const CATEGORY_LABEL = {
  LEGAL: 'Jurídico', INSURANCE: 'Garantías y seguros', FINANCIAL: 'Financiero', EXPERIENCE: 'Experiencia',
  LICENSE: 'Licencias y permisos', PERSONNEL: 'Personal', TECHNICAL: 'Técnico', ECONOMIC: 'Económico',
  TIMELINE: 'Cronograma', OTHER: 'Otros',
};
// Orden de lectura: primero lo que habilita (sin eso no hay oferta), después lo que suma o cuesta.
const CATEGORY_ORDER = ['LEGAL', 'INSURANCE', 'LICENSE', 'EXPERIENCE', 'FINANCIAL', 'PERSONNEL', 'TECHNICAL', 'ECONOMIC', 'TIMELINE', 'OTHER'];
const AREAS = ['Jurídico', 'Financiero', 'Licitaciones', 'Operaciones', 'Comercial', 'Técnico', 'Gerencia'];
const CATEGORY_AREA = {
  LEGAL: 'Jurídico', INSURANCE: 'Financiero', FINANCIAL: 'Financiero', EXPERIENCE: 'Licitaciones', LICENSE: 'Jurídico',
  PERSONNEL: 'Operaciones', TECHNICAL: 'Operaciones', ECONOMIC: 'Comercial', TIMELINE: 'Licitaciones', OTHER: 'Licitaciones',
};
const SEVERITY_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
const SEVERITY_LABEL = { CRITICAL: 'Crítico', HIGH: 'Alto', MEDIUM: 'Medio', LOW: 'Bajo', INFO: 'Informativo' };
const EVALUATION_RANK = { BLOCKER: 0, PENDING: 1, NOT_EVALUATED: 2, AVAILABLE: 3, VERIFIED: 4, NOT_APPLICABLE: 5 };

/**
 * Estado de la empresa frente al requisito, en pocas palabras que entiende cualquiera. `declarado` y
 * `por_confirmar` se separaron el 2026-10-21 (Juan: "esto no debería estar acá, usted sabe que tenemos
 * sede en Medellín"): no es lo mismo que la empresa diga que lo tiene y falte el soporte, que no saber
 * si lo tiene. Antes los dos se mostraban "Por confirmar" y se leían como un problema.
 */
export const REQUIREMENT_STATUS_LABEL = { falta: 'Falta', por_confirmar: 'Por confirmar', declarado: 'Cumple, falta el soporte', cumple: 'Cumple', no_aplica: 'No aplica' };

function statusFromEvaluation(evaluation) {
  if (evaluation === 'BLOCKER') return 'falta';
  if (evaluation === 'VERIFIED') return 'cumple';
  if (evaluation === 'AVAILABLE') return 'declarado';
  if (evaluation === 'NOT_APPLICABLE') return 'no_aplica';
  return 'por_confirmar';
}

/** El requisito ya está resuelto o no nos aplica: lo que diga el pliego sobre rechazos no nos cuelga. */
const SETTLED_STATUSES = new Set(['cumple', 'declarado', 'no_aplica']);

/** Quita códigos internos (CLM-, REQ-…) y nombres de campos en inglés de un texto que lee una persona. */
export function cleanRequirementText(value) {
  return String(value || '')
    .replace(/\s*\((?:[^()]*\b(?:CLM|REQ|FND|OI|CTR)-[A-Z0-9-]+[^()]*)\)/g, '')
    .replace(/\b(?:CLM|REQ|FND|OI|CTR)-[A-Z0-9-]+\b/g, 'el requisito citado')
    .replace(/\b[a-z]+(?:_[a-z]+)+\b/g, word => word.replace(/_/g, ' '))
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function normalizeArea(value, category) {
  const raw = String(value || '').trim();
  const match = AREAS.find(area => raw.toLowerCase().startsWith(area.toLowerCase()) || raw.toLowerCase().includes(area.toLowerCase()));
  return match || CATEGORY_AREA[category] || 'Licitaciones';
}

/** Nombre corto del requisito a partir del texto exigido: lo que va antes de la primera coma o punto. */
function titleFromDemand(text) {
  const clean = cleanRequirementText(text)
    .replace(/\s*\([^()]*\)/g, '')
    .replace(/^(?:en la respuesta a observaciones\s+)?(?:el pliego|la entidad|el anexo[^,:]*|la experiencia habilitante|el requisito habilitante|el contratista)\s+(?:exige|pide|requiere|mantiene|debe)(?:\s+(?:que|la exigencia de|el requisito de))?\s*:?\s*/i, '')
    .replace(/^(?:además se exigen|se exigen|se exige|entre las obligaciones del contratista figura)\s*:?\s*/i, '');
  const first = (clean.split(/[,;:.](?:\s|$)/)[0] || clean).trim();
  const short = first.length > 70 ? `${first.slice(0, 68).replace(/\s+\S*$/, '')}…` : first;
  return short.charAt(0).toUpperCase() + short.slice(1);
}

const REJECTION_TEXT = /causa(?:l)? (?:de )?rechazo|se rechaza la oferta|no se puede subsanar|no es subsanable|no subsanable/i;
const words = text => new Set(String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z]{4,}|\d+/g) || []);
function similar(a, b) {
  const left = words(a); const right = words(b);
  const shared = [...left].filter(word => right.has(word)).length;
  return shared / Math.max(1, Math.min(left.size, right.size)) >= 0.5;
}

const byId = list => new Map((list || []).map(item => [item.id, item]));
const intersects = (ids, set) => (ids || []).some(id => set.has(id));
const uniq = values => [...new Set(values.filter(value => typeof value === 'string' && value.trim()))];

/**
 * Filas de requisitos. El modelo a veces emite varios requisitos sobre el mismo texto exigido (uno por
 * punto que revisa): el texto se muestra una vez y sus puntos quedan como acciones de la misma fila.
 */
export function buildRequirementRows(report) {
  if (!report || !Array.isArray(report.requirements)) return [];
  const claims = byId(report.claims);
  const groups = new Map();
  for (const requirement of report.requirements) {
    const key = requirement.textClaimId || requirement.id;
    if (!groups.has(key)) groups.set(key, { key, category: requirement.category || 'OTHER', points: [] });
    groups.get(key).points.push(requirement);
  }
  const rows = [...groups.values()].map(group => {
    const points = group.points;
    const claimIds = new Set(points.flatMap(point => [point.textClaimId, ...(point.evidenceClaimIds || [])]).filter(Boolean));
    const textClaim = claims.get(points[0].textClaimId);
    const worst = points.reduce((current, point) => ((EVALUATION_RANK[point.companyEvaluation] ?? 2) < (EVALUATION_RANK[current] ?? 2) ? point.companyEvaluation : current), 'NOT_APPLICABLE');
    const applicable = points.some(point => point.applicability !== 'NOT_APPLICABLE');
    const status = applicable ? statusFromEvaluation(worst) : 'no_aplica';
    const findings = (report.findings || []).filter(finding => intersects(finding.claimIds, new Set([points[0].textClaimId])) || intersects(finding.claimIds, claimIds));
    const openItems = (report.openItems || []).filter(item => (item.status === 'OPEN' || !item.status) && intersects(item.claimIds, claimIds));
    const severity = findings.reduce((current, finding) => ((SEVERITY_RANK[finding.severity] ?? 9) < (SEVERITY_RANK[current] ?? 9) ? finding.severity : current), null);
    const companyIds = report.companyFitAuthorized
      ? uniq(points.flatMap(point => point.evidenceClaimIds || []).filter(id => id !== points[0].textClaimId))
      : [];
    const company = uniq(companyIds.map(id => claims.get(id)?.text).filter(Boolean).map(cleanRequirementText));
    const dueDates = openItems.map(item => item.dueAt).filter(Boolean).sort();
    return {
      key: group.key,
      requirementIds: points.map(point => point.id),
      category: group.category,
      categoryLabel: CATEGORY_LABEL[group.category] || CATEGORY_LABEL.OTHER,
      area: normalizeArea(points.find(point => point.ownerRole)?.ownerRole, group.category),
      title: '',
      demand: cleanRequirementText(textClaim?.text || ''),
      sources: (textClaim?.sources || []).map(source => ({ documentName: source.documentName || null, locator: source.locator || '' })),
      status,
      // El análisis casi nunca marca `blocker`; el pliego sí dice cuándo algo causa rechazo sin remedio.
      // Pero el texto del pliego habla de cualquier oferente: que diga "la oferta conjunta causa rechazo"
      // no nos cuelga si nos presentamos solos (Juan, 2026-10-21). Por eso la marca por texto sólo vale
      // mientras el requisito siga abierto; el bloqueo explícito del análisis vale siempre.
      rejection: points.some(point => point.blocker || point.companyEvaluation === 'BLOCKER')
        || (!SETTLED_STATUSES.has(status)
          && (REJECTION_TEXT.test(textClaim?.text || '') || findings.some(finding => REJECTION_TEXT.test(`${finding.title} ${finding.impact}`)))),
      severity,
      severityLabel: severity ? SEVERITY_LABEL[severity] || null : null,
      company,
      actions: uniq(points.filter(point => point.companyEvaluation !== 'VERIFIED').map(point => point.requiredAction).filter(Boolean).map(cleanRequirementText)),
      notes: findings.map(finding => ({ title: cleanRequirementText(finding.title), impact: cleanRequirementText(finding.impact), severity: finding.severity, severityLabel: SEVERITY_LABEL[finding.severity] || '' })),
      findingIds: findings.map(finding => finding.id),
      openItems: openItems.map(item => ({ text: cleanRequirementText(item.description), dueAt: item.dueAt || null, critical: item.critical === true })),
      dueAt: dueDates[0] || null,
    };
  });
  // Título: el nombre del requisito según el pliego; los hallazgos quedan como notas dentro de la fila.
  // Si el texto exigido no da un nombre útil, el hallazgo exclusivo de la fila lo nombra.
  const findingSpread = new Map();
  for (const row of rows) for (const id of row.findingIds) findingSpread.set(id, (findingSpread.get(id) || 0) + 1);
  const findingTitle = byId(report.findings);
  for (const row of rows) {
    const fromDemand = titleFromDemand(row.demand);
    const exclusive = row.findingIds.filter(id => findingSpread.get(id) === 1).map(id => cleanRequirementText(findingTitle.get(id)?.title || '')).find(Boolean);
    // Un nombre muy corto o que arranca a mitad de frase ("Los techos son", "Con cifras al cierre…") no
    // identifica el requisito: ahí manda el hallazgo exclusivo de la fila, si lo hay.
    const weak = !fromDemand || fromDemand.length < 20 || /^(?:con|en|para|según|entre|de|los|las|el requisito|al menos)\b/i.test(fromDemand);
    row.title = (weak && exclusive ? exclusive : fromDemand) || exclusive || row.categoryLabel;
  }
  const statusOrder = { falta: 0, por_confirmar: 1, declarado: 2, cumple: 3, no_aplica: 4 };
  return rows.sort((a, b) => Number(b.rejection) - Number(a.rejection)
    || (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9)
    || statusOrder[a.status] - statusOrder[b.status]
    || CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));
}

/** Lo que puede tumbar la oferta: causales de rechazo y riesgos altos aún sin resolver (máximo `limit`). */
export function decisiveRequirementRows(rows, limit = 5) {
  return rows.filter(row => !SETTLED_STATUSES.has(row.status)
    && (row.rejection || row.severity === 'CRITICAL' || row.severity === 'HIGH')).slice(0, limit);
}

/** Hallazgos y contradicciones que no se refieren a ningún requisito: van en un apartado corto aparte. */
export function otherRiskNotes(report, rows) {
  if (!report) return [];
  const linked = new Set(rows.flatMap(row => row.findingIds));
  const findings = (report.findings || []).filter(finding => !linked.has(finding.id)
    && finding.severity !== 'INFO')
    .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9))
    .map(finding => ({ id: finding.id, title: cleanRequirementText(finding.title), impact: cleanRequirementText(finding.impact), severity: finding.severity, severityLabel: SEVERITY_LABEL[finding.severity] || '' }));
  const contradictions = (report.contradictions || []).filter(item => item.status !== 'RESOLVED')
    .map(item => ({ id: item.id, title: cleanRequirementText(item.topic), impact: cleanRequirementText(item.requiredAction || ''), severity: 'MEDIUM', severityLabel: 'Por aclarar' }));
  // Una contradicción suele repetir un hallazgo con otras palabras: se queda la primera.
  const kept = [];
  for (const note of [...findings, ...contradictions]) if (!kept.some(other => similar(other.title, note.title))) kept.push(note);
  return kept;
}

export function groupRowsByCategory(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.category)) groups.set(row.category, { category: row.category, label: row.categoryLabel, rows: [] });
    groups.get(row.category).rows.push(row);
  }
  return [...groups.values()].sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));
}

// --- Siembra en el expediente al dar GO --------------------------------------------------------------

export const REQUIREMENT_ITEM_KEY_PREFIX = 'agt002_req:';

function isoDay(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}
function addDays(day, delta) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/**
 * Fecha objetivo hacia atrás desde el cierre: lo que causa rechazo, cinco días antes; lo demás, tres;
 * lo económico, dos (se cierra al final). Si el análisis trae una fecha propia anterior, manda esa.
 * Nunca antes de hoy.
 */
export function requirementTargetDate(row, closeDate, today = new Date().toISOString().slice(0, 10)) {
  const close = isoDay(closeDate);
  const own = isoDay(row.dueAt);
  let target = null;
  if (close) target = addDays(close, row.rejection ? -5 : row.category === 'ECONOMIC' ? -2 : -3);
  if (own && (!target || own < target)) target = own;
  if (target && target < today) target = today;
  return target;
}

/** Ítems del expediente para un GO: uno por requisito aplicable que no esté ya cumplido. */
// La instrucción va como nota de la acción 'created' (psi_tender_dossier_item_actions.note, máximo 2000 caracteres). Con
// 4000 un solo requisito largo hacía fallar todo el lote (Fiscalía, 2026-10-21: 2308 caracteres, 400 en la siembra).
export const REQUIREMENT_SEED_INSTRUCTION_MAX = 2000;
function clipInstruction(text) {
  return text.length <= REQUIREMENT_SEED_INSTRUCTION_MAX ? text : `${text.slice(0, REQUIREMENT_SEED_INSTRUCTION_MAX - 1).trimEnd()}…`;
}

export function requirementSeedItems(rows, closeDate, today) {
  return rows.filter(row => row.status !== 'no_aplica').map(row => {
    const lines = [];
    if (row.actions.length) lines.push(`Qué hacer: ${row.actions.join(' ')}`);
    if (row.demand) lines.push(`Qué exige el pliego: ${row.demand}`);
    const source = row.sources.map(item => [item.documentName, item.locator].filter(Boolean).join(' · ')).filter(Boolean).join('; ');
    if (source) lines.push(`Dónde: ${source}`);
    lines.push(`Estado según el análisis: ${REQUIREMENT_STATUS_LABEL[row.status].toLowerCase()}.`);
    lines.push('Cargado por Vig-IA Licitaciones desde el análisis al registrar el GO. Verificar contra el pliego original.');
    return {
      item_key: `${REQUIREMENT_ITEM_KEY_PREFIX}${row.key}`.slice(0, 200),
      title: `${row.area} · ${row.title}${row.rejection ? ' — CAUSA RECHAZO' : ''}`.slice(0, 400),
      required: true,
      target_date: requirementTargetDate(row, closeDate, today),
      instruction: clipInstruction(lines.join('\n')),
    };
  });
}

// --- Dónde se ve cada aclaración (punto 3 de la definición de Juan, 2026-10-21) ----------------------
// Una aclaración se ve junto al punto que aclara y, además, en la lista de aclaraciones de la licitación.
// El análisis renumera sus claims en cada versión, así que el punto se busca por su id y, si ese id ya no
// existe, por el nombre con el que se guardó. La que no se puede ubicar NO se pierde: sale en la lista
// como "el análisis cambió de nombre", porque callarla sería peor que mostrarla sin su sitio.

const targetText = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
const pushInto = (map, key, item) => { const list = map.get(key) || []; list.push(item); map.set(key, list); };

/**
 * Reparte las aclaraciones de una licitación entre los puntos del análisis vigente. `requirements` son las
 * filas de `buildRequirementRows` y `findings` las notas de `otherRiskNotes`. Devuelve las aclaraciones de
 * cada fila (`byRequirement`, por `row.key`), las de cada hallazgo suelto (`byFinding`, por id) y `listed`:
 * todas en el orden en que se escribieron, cada una con el punto donde quedó.
 */
export function placeAgt002Clarifications(clarifications = [], { requirements = [], findings = [] } = {}) {
  const byRequirement = new Map();
  const byFinding = new Map();
  const listed = [];
  const rowByKey = new Map(requirements.map(row => [row.key, row]));
  const rowByRequirementId = new Map(requirements.flatMap(row => (row.requirementIds || []).map(id => [id, row])));
  const rowByFindingId = new Map(requirements.flatMap(row => (row.findingIds || []).map(id => [id, row])));
  const rowByTitle = new Map(requirements.map(row => [targetText(row.title), row]));
  const findingById = new Map(findings.map(note => [note.id, note]));
  const findingByTitle = new Map(findings.map(note => [targetText(note.title), note]));
  for (const clarification of clarifications) {
    if (!clarification?.target_kind) { listed.push({ clarification, scope: 'general', rowKey: null, findingId: null, label: null }); continue; }
    const id = clarification.target_id;
    const label = targetText(clarification.target_label);
    const row = clarification.target_kind === 'requirement'
      ? rowByKey.get(id) || rowByRequirementId.get(id) || (label ? rowByTitle.get(label) : null)
      : null;
    if (row) {
      pushInto(byRequirement, row.key, clarification);
      listed.push({ clarification, scope: 'requirement', rowKey: row.key, findingId: null, label: row.title });
      continue;
    }
    if (clarification.target_kind === 'finding') {
      const note = findingById.get(id) || (label ? findingByTitle.get(label) : null);
      if (note) {
        pushInto(byFinding, note.id, clarification);
        listed.push({ clarification, scope: 'finding', rowKey: null, findingId: note.id, label: note.title });
        continue;
      }
      // Un hallazgo puede estar dentro de una fila de requisito: la aclaración se ve ahí.
      const host = rowByFindingId.get(id);
      if (host) {
        pushInto(byRequirement, host.key, clarification);
        listed.push({ clarification, scope: 'requirement', rowKey: host.key, findingId: null, label: host.title });
        continue;
      }
    }
    listed.push({ clarification, scope: 'orphan', rowKey: null, findingId: null, label: clarification.target_label || null });
  }
  return { byRequirement, byFinding, listed };
}
