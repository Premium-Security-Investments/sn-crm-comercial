// AGT-002 — formateador determinístico del resumen Discord "Top 5 de mayor encaje".
// Moved from /root/.hermes/scripts into the CRM repo (owner decision 2026-10-06): the CRM builds the message from its own
// Radar; Hermes only delivers the resulting text. Policies resolve from this repository by default.
//
// Lee el export determinístico `{run_date,count,items}` del radar, deja sólo filas `hacer`/`revisar`
// que la política canónica de competibilidad del CRM (`filterActiveTenderCompetibilityRows`)
// clasifica como `competible`, evalúa esas filas con `tender-fit-v2` (`evaluateTenderFit`, resuelta
// por import dinámico canónico, nunca duplicada) y produce un texto plano ≤1900 caracteres, sin
// exponer ningún score numérico. Puro/offline: sin red, DB ni Discord.
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isAbsolute, resolve as resolvePath } from 'node:path';

// Import dinámico canónico de la política de encaje: honra `AGT002_TENDER_FIT_POLICY_PATH` si está
// definida; si no, resuelve `../tender-fit-policy.js` relativo a este módulo (no a cwd), para que el
// script sea instalable fuera de este repositorio sin copiar la lógica de scoring.
function policyFileUrl(overridePath, fallbackRelative) {
  if (!overridePath) return new URL(fallbackRelative, import.meta.url).href;
  return pathToFileURL(isAbsolute(overridePath) ? overridePath : resolvePath(process.cwd(), overridePath)).href;
}

async function resolveAgt002TenderFitPolicyModule() {
  const specifier = policyFileUrl(process.env.AGT002_TENDER_FIT_POLICY_PATH, '../../tender-fit-policy.js');
  const policyModule = await import(specifier);
  if (typeof policyModule.evaluateTenderFit !== 'function') {
    throw new TypeError(`agt002-radar-discord-top5: el módulo de política (${specifier}) no exporta evaluateTenderFit`);
  }
  if (typeof policyModule.TENDER_FIT_POLICY_VERSION !== 'string' || !policyModule.TENDER_FIT_POLICY_VERSION) {
    throw new TypeError(`agt002-radar-discord-top5: el módulo de política (${specifier}) no exporta TENDER_FIT_POLICY_VERSION`);
  }
  return policyModule;
}

async function resolveAgt002TenderCompetibilityPolicyModule() {
  const overridePath = process.env.AGT002_TENDER_COMPETIBILITY_POLICY_PATH
    || (process.env.AGT002_TENDER_FIT_POLICY_PATH
      ? process.env.AGT002_TENDER_FIT_POLICY_PATH.replace(/tender-fit-policy\.js$/, 'tender-competibility-policy.js')
      : '');
  const specifier = policyFileUrl(overridePath || null, '../../tender-competibility-policy.js');
  const policyModule = await import(specifier);
  if (typeof policyModule.filterActiveTenderCompetibilityRows !== 'function') {
    throw new TypeError(`agt002-radar-discord-top5: el módulo de competibilidad (${specifier}) no exporta filterActiveTenderCompetibilityRows`);
  }
  return policyModule;
}

const { evaluateTenderFit, TENDER_FIT_POLICY_VERSION } = await resolveAgt002TenderFitPolicyModule();
const { filterActiveTenderCompetibilityRows } = await resolveAgt002TenderCompetibilityPolicyModule();

const MAX_SUMMARY_LENGTH = 1900;

const DETAILED_RENDER_LEVELS = [
  { entityMax: 120, titleMax: 200, reasonMax: 160, reasonsCount: 2 },
  { entityMax: 70, titleMax: 110, reasonMax: 80, reasonsCount: 1 },
  { entityMax: 45, titleMax: 60, reasonMax: 55, reasonsCount: 1 },
];
const COMPACT_ROW_SEPARATOR = '·';
const COMPACT_ROW_MIN_ENTITY_LENGTH = 8;

const FIT_BAND_LABELS = {
  alto: 'Encaje alto',
  medio: 'Encaje medio',
  por_validar: 'Encaje por validar',
  bajo: 'Encaje bajo',
};

const COMPACT_FIT_BAND_LABELS = {
  alto: 'Alto',
  medio: 'Medio',
  por_validar: 'Por validar',
  bajo: 'Bajo',
};

function assertValidAgt002RadarPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('agt002-radar-discord-top5: payload debe ser un objeto {run_date,count,items}');
  }
  if (!Array.isArray(payload.items)) {
    throw new TypeError('agt002-radar-discord-top5: payload.items debe ser un arreglo');
  }
  if (typeof payload.run_date !== 'string' || !payload.run_date) {
    throw new TypeError('agt002-radar-discord-top5: payload.run_date debe ser una fecha (string) no vacía');
  }
}

function assertValidAgt002RadarOptions(options) {
  if (!options || typeof options.nowIso !== 'string' || !options.nowIso) {
    throw new TypeError('agt002-radar-discord-top5: options.nowIso (string ISO) es requerido');
  }
}

export function mapAgt002RadarExportItemToTenderFitInput(item) {
  return {
    title: item.title,
    description: item.description,
    value: item.value_cop,
    deadline_at: item.deadline,
    city: item.city,
    dept: item.dept,
    category: item.category,
  };
}

export function isAgt002RadarItemEligibleForDiscordTop5(item) {
  return Boolean(item) && (item.decision === 'hacer' || item.decision === 'revisar');
}

function compareAgt002RadarTop5Entries(a, b) {
  if (b.fit.score !== a.fit.score) return b.fit.score - a.fit.score;
  const ad = a.item.deadline ?? null;
  const bd = b.item.deadline ?? null;
  if (ad !== bd) {
    if (ad === null) return 1;
    if (bd === null) return -1;
    return ad < bd ? -1 : ad > bd ? 1 : 0;
  }
  return a.item.stable_key < b.item.stable_key ? -1 : a.item.stable_key > b.item.stable_key ? 1 : 0;
}

export function selectAgt002RadarDiscordTop5(payload, options) {
  assertValidAgt002RadarPayload(payload);
  assertValidAgt002RadarOptions(options);
  const nowIso = options.nowIso;
  const eligibleItems = filterActiveTenderCompetibilityRows(
    payload.items.filter(isAgt002RadarItemEligibleForDiscordTop5),
    { nowIso },
  );
  const evaluated = eligibleItems.map(item => ({
    item,
    fit: evaluateTenderFit(mapAgt002RadarExportItemToTenderFitInput(item), { nowIso }),
  }));
  evaluated.sort(compareAgt002RadarTop5Entries);
  return {
    policy_version: TENDER_FIT_POLICY_VERSION,
    eligible_count: eligibleItems.length,
    selected: evaluated.slice(0, 5),
  };
}

export function humanizeAgt002RadarFitBand(band) {
  return FIT_BAND_LABELS[band] || FIT_BAND_LABELS.por_validar;
}

function dedupeAgt002RadarReasonTexts(texts) {
  const seen = new Set();
  const result = [];
  for (const text of texts) {
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

export function selectAgt002RadarDiscordReasons(fit) {
  if (!fit) return [];
  if (fit.band === 'por_validar') {
    const critical = (fit.data_gaps || [])
      .map((gap, index) => ({ gap, index }))
      .filter(({ gap }) => gap.severity === 'critical')
      .sort((a, b) => (a.gap.impact_priority ?? Number.MAX_SAFE_INTEGER) - (b.gap.impact_priority ?? Number.MAX_SAFE_INTEGER) || a.index - b.index)
      .map(({ gap }) => gap.detail);
    return dedupeAgt002RadarReasonTexts(critical).slice(0, 2);
  }
  const byImpact = (fit.reasons || [])
    .map((reason, index) => ({ reason, index }))
    .sort((a, b) => (a.reason.impact_priority ?? Number.MAX_SAFE_INTEGER) - (b.reason.impact_priority ?? Number.MAX_SAFE_INTEGER) || a.index - b.index)
    .map(({ reason }) => reason.detail);
  return dedupeAgt002RadarReasonTexts(byImpact).slice(0, 2);
}

function truncateField(value, maxLength) {
  const text = String(value ?? '');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function formatAgt002RadarValue(valueCop) {
  const value = Number(valueCop);
  if (!Number.isFinite(value) || value <= 0) return 'valor no reportado';
  return `$${value.toLocaleString('es-CO')} COP`;
}

function formatAgt002RadarDeadline(deadline) {
  return deadline ? String(deadline) : 'sin fecha registrada';
}

// Normaliza la URL de fuente: el exportador puede entregarla como string plano o, en algunos
// ciclos, anidada en un objeto `{url:"..."}`. Nunca se debe stringificar un objeto arbitrario
// (evita el bug "[object Object]").
function normalizeAgt002RadarSourceUrl(url) {
  if (typeof url === 'string' && url) return url;
  if (url && typeof url === 'object' && typeof url.url === 'string' && url.url) return url.url;
  return 'sin URL registrada';
}

function formatAgt002RadarCompactValue(valueCop) {
  const value = Number(valueCop);
  if (!Number.isFinite(value) || value <= 0) return 'valor N/D';
  const units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [factor, suffix] of units) {
    if (value >= factor) return `$${(value / factor).toFixed(2)}${suffix}`;
  }
  return `$${value}`;
}

function formatAgt002RadarDetailedRow(entry, index, level) {
  const { item, fit } = entry;
  const entity = truncateField(item.entity || 'Entidad no reportada', level.entityMax);
  const title = truncateField(item.title || 'Sin título', level.titleMax);
  const reasons = level.reasonsCount > 0
    ? selectAgt002RadarDiscordReasons(fit).slice(0, level.reasonsCount).map(reason => truncateField(reason, level.reasonMax))
    : [];
  const reasonsText = reasons.length ? reasons.join(', ') : 'sin detalle adicional';
  return [
    `${index}. ${entity} — ${title}`,
    `Valor: ${formatAgt002RadarValue(item.value_cop)} · Cierre: ${formatAgt002RadarDeadline(item.deadline)}`,
    `${humanizeAgt002RadarFitBand(fit.band)}: ${reasonsText}`,
    `URL: ${normalizeAgt002RadarSourceUrl(item.url)}`,
  ].join('\n');
}

function assembleAgt002RadarSummaryLines(headerLines, rowTexts) {
  const lines = [...headerLines];
  for (const rowText of rowTexts) {
    lines.push('');
    lines.push(rowText);
  }
  return lines.join('\n');
}

// Filas compactas de último recurso: sin título ni razones, para garantizar ≤1900 caracteres sin
// sacrificar jamás la identidad de entidad, la banda humanizada, el valor, la fecha de cierre ni la
// URL de fuente exacta de ninguna fila seleccionada.
function buildAgt002RadarCompactRowFixedParts(entry, index) {
  const { item, fit } = entry;
  const band = COMPACT_FIT_BAND_LABELS[fit.band] || COMPACT_FIT_BAND_LABELS.por_validar;
  const reason = truncateField(selectAgt002RadarDiscordReasons(fit)[0] || 'sin detalle adicional', 48);
  const value = formatAgt002RadarCompactValue(item.value_cop);
  const deadline = formatAgt002RadarDeadline(item.deadline);
  const url = normalizeAgt002RadarSourceUrl(item.url);
  const prefix = `${index}. `;
  const fixedLength = prefix.length
    + (COMPACT_ROW_SEPARATOR.length * 5)
    + band.length + reason.length + value.length + deadline.length + url.length;
  return { prefix, band, reason, value, deadline, url, fixedLength };
}

function renderAgt002RadarCompactRow(entry, index, entityMax) {
  const entity = truncateField(entry.item.entity || 'Entidad no reportada', entityMax);
  const { prefix, band, reason, value, deadline, url } = buildAgt002RadarCompactRowFixedParts(entry, index);
  const SEP = COMPACT_ROW_SEPARATOR;
  return `${prefix}${entity}${SEP}${band}${SEP}${reason}${SEP}${value}${SEP}${deadline}${SEP}${url}`;
}

function buildAgt002RadarCompactSummary(headerLines, selected) {
  const rowsMeta = selected.map((entry, idx) => buildAgt002RadarCompactRowFixedParts(entry, idx + 1));
  const headerLength = headerLines.join('\n').length;
  const joiningNewlines = headerLines.length + selected.length - 1;
  const fixedLength = headerLength + joiningNewlines + rowsMeta.reduce((sum, meta) => sum + meta.fixedLength, 0);
  const entityBudgetTotal = MAX_SUMMARY_LENGTH - fixedLength;
  const perRowEntityMax = Math.floor(entityBudgetTotal / selected.length);
  if (perRowEntityMax < COMPACT_ROW_MIN_ENTITY_LENGTH) {
    throw new RangeError(
      'agt002-radar-discord-top5: no es posible generar un resumen ≤1900 caracteres que preserve la URL ' +
      'completa y la identidad de entidad de cada fila seleccionada; el payload de entrada es inviable ' +
      '(demasiadas filas y/o URLs/entidades excesivamente largas).',
    );
  }
  const rowTexts = selected.map((entry, idx) => renderAgt002RadarCompactRow(entry, idx + 1, perRowEntityMax));
  return [...headerLines, ...rowTexts].join('\n');
}

function buildAgt002RadarHeaderLines(payload, result) {
  if (result.selected.length === 0) {
    return [
      'Radar AGT-002 — sin procesos de mayor encaje',
      `Fecha: ${payload.run_date} · Política: ${result.policy_version}`,
      'No se encontraron procesos elegibles (hacer/revisar) en este ciclo.',
    ];
  }
  return [
    `Radar AGT-002 — ${result.selected.length} de mayor encaje`,
    `Fecha: ${payload.run_date} · Política: ${result.policy_version}`,
  ];
}

export function formatAgt002RadarDiscordTop5Summary(payload, options) {
  assertValidAgt002RadarPayload(payload);
  assertValidAgt002RadarOptions(options);
  const result = selectAgt002RadarDiscordTop5(payload, options);
  const headerLines = buildAgt002RadarHeaderLines(payload, result);
  if (result.selected.length === 0) {
    return headerLines.join('\n');
  }
  for (const level of DETAILED_RENDER_LEVELS) {
    const rowTexts = result.selected.map((entry, idx) => formatAgt002RadarDetailedRow(entry, idx + 1, level));
    const candidate = assembleAgt002RadarSummaryLines(headerLines, rowTexts);
    if (candidate.length <= MAX_SUMMARY_LENGTH) return candidate;
  }
  const compact = buildAgt002RadarCompactSummary(headerLines, result.selected);
  if (compact.length > MAX_SUMMARY_LENGTH) {
    throw new RangeError(
      'agt002-radar-discord-top5: el resumen compacto calculado excede 1900 caracteres de forma inesperada; ' +
      'revise el payload de entrada.',
    );
  }
  return compact;
}

function runAgt002RadarDiscordTop5Cli() {
  const [, , inputPath, nowIso] = process.argv;
  if (!inputPath || !nowIso) {
    console.error('Uso: node scripts/agt002-radar-discord-top5.mjs <export.json> <nowIso>');
    process.exitCode = 1;
    return;
  }
  const payload = JSON.parse(readFileSync(inputPath, 'utf8'));
  console.log(formatAgt002RadarDiscordTop5Summary(payload, { nowIso }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runAgt002RadarDiscordTop5Cli();
}
