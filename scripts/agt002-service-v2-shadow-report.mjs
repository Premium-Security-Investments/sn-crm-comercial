// Reporte sombra AGT-002: compara servicio v1 (tender-fit-policy) vs v2
// (tender-service-matrix-v2) item a item, sin tocar el scoring real.
// Ver docs/superpowers/specs/2026-10-01-agt002-service-matrix-v2-shadow.md.
import { mkdir, rename, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { evaluateTenderFit, TENDER_FIT_POLICY_VERSION } from '../tender-fit-policy.js';
import { TENDER_SERVICE_MATRIX_V2_VERSION } from '../tender-service-matrix-v2.js';

export const AGT002_SERVICE_V2_SHADOW_REPORT_VERSION = 'agt002-service-v2-shadow-report-v1';

const FAMILY_SUMMARY_KEYS = ['HIBRIDA', 'ELECTRONICA', 'FISICA', 'SUMINISTRO'];

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertValidNowIso(nowIso) {
  if (typeof nowIso !== 'string' || nowIso.length === 0) {
    throw new TypeError('nowIso inválido: se requiere un string ISO no vacío');
  }
  const parsed = Date.parse(nowIso);
  if (!Number.isFinite(parsed) || new Date(nowIso).toISOString() !== nowIso) {
    throw new TypeError('nowIso inválido: se requiere un timestamp ISO canónico en UTC (terminado en "Z")');
  }
}

function extractItems(payload) {
  let items;
  if (Array.isArray(payload)) {
    items = payload;
  } else if (isPlainObject(payload) && Array.isArray(payload.items)) {
    items = payload.items;
  } else {
    throw new TypeError('payload inválido: debe ser un arreglo o un objeto {items: [...]}');
  }
  for (const item of items) {
    if (!isPlainObject(item)) {
      throw new TypeError('item inválido: cada elemento de items debe ser un objeto');
    }
  }
  return items;
}

function pick(item, keys) {
  for (const key of keys) {
    const value = item[key];
    if (value !== null && value !== undefined) return value;
  }
  return undefined;
}

function resolveStableKey(item) {
  const raw = pick(item, ['stable_key', 'notice_id', 'id', 'source_url']);
  return raw === undefined ? undefined : String(raw);
}

function pickSafeString(item, keys) {
  const value = pick(item, keys);
  return value === undefined ? null : String(value);
}

function computeServiceV2Flags(v2) {
  if (v2.excluded) return ['EXCLUDED'];
  if (v2.status === 'POR_VALIDAR' || v2.family === 'AMBIGUA') return ['AMBIGUOUS'];
  if (v2.trace.some(entry => entry.verdict === 'absorbida_por_suministro')) return ['ABSORBED_ELECTRONICA'];
  return [];
}

function computeDelta(v1ServicePoints, v2Points) {
  const current_detected = v1ServicePoints > 0;
  const v2_detected = v2Points > 0;
  let classification;
  if (current_detected !== v2_detected) {
    classification = current_detected ? 'CURRENT_IN_V2_OUT' : 'CURRENT_OUT_V2_IN';
  } else if (v1ServicePoints === v2Points) {
    classification = 'SAME_SERVICE_POINTS';
  } else {
    classification = 'POINTS_CHANGED';
  }
  return { current_detected, v2_detected, classification, service_points: v2Points - v1ServicePoints };
}

function buildReportItem(raw, nowIso) {
  const title = pick(raw, ['title', 'object', 'name']);
  const description = pick(raw, ['description', 'desc', 'summary']);
  const value = pick(raw, ['value', 'value_cop', 'contract_value', 'budget']);
  const city = pick(raw, ['city', 'municipality']);
  const dept = pick(raw, ['dept', 'department']);
  const deadline_at = pick(raw, ['deadline_at', 'deadline', 'closing_date']);
  const stable_key = resolveStableKey(raw);
  const source_url = pickSafeString(raw, ['source_url', 'url']);
  const existing_decision = pickSafeString(raw, ['existing_decision', 'decision']);

  const fit = evaluateTenderFit({ title, description, value, city, dept, deadline_at }, { nowIso });
  const servicio = fit.reasons.find(reason => reason.axis === 'servicio');
  const current_v1 = { service_points: servicio.points, total_score: fit.score, band: fit.band };

  const v2 = fit.shadow.servicio_v2;
  const service_v2 = {
    excluded: v2.excluded,
    exclusion_rule: v2.exclusion_rule,
    family: v2.family,
    flags: computeServiceV2Flags(v2),
    points: v2.points,
    status: v2.status,
    trace: v2.trace,
  };

  const delta = computeDelta(current_v1.service_points, service_v2.points);

  return { stable_key, title, source_url, existing_decision, current_v1, service_v2, delta };
}

function familySummaryKey(family) {
  return FAMILY_SUMMARY_KEYS.includes(family) ? family : 'null';
}

function statusSummaryKey(status) {
  if (status === 'EN_ALCANCE') return 'ACTIVA';
  if (status === 'POR_VALIDAR') return 'POR_VALIDAR';
  if (status === 'EXCLUIDA') return 'EXCLUIDA';
  return 'FUERA';
}

function buildSummary(items) {
  const classifications = {
    CURRENT_IN_V2_OUT: 0, CURRENT_OUT_V2_IN: 0, SAME_SERVICE_POINTS: 0, POINTS_CHANGED: 0,
  };
  const statuses = { ACTIVA: 0, POR_VALIDAR: 0, FUERA: 0, EXCLUIDA: 0 };
  const by_family = { HIBRIDA: 0, ELECTRONICA: 0, FISICA: 0, SUMINISTRO: 0, null: 0 };
  let changed_count = 0;

  for (const item of items) {
    classifications[item.delta.classification] += 1;
    if (item.delta.classification !== 'SAME_SERVICE_POINTS') changed_count += 1;
    statuses[statusSummaryKey(item.service_v2.status)] += 1;
    by_family[familySummaryKey(item.service_v2.family)] += 1;
  }

  return { classifications, changed_count, statuses, by_family };
}

export function buildAgt002ServiceV2ShadowReport(payload, { nowIso } = {}) {
  assertValidNowIso(nowIso);
  const rawItems = extractItems(payload);

  const items = rawItems
    .map(raw => buildReportItem(raw, nowIso))
    .sort((a, b) => (a.stable_key < b.stable_key ? -1 : a.stable_key > b.stable_key ? 1 : 0));

  return {
    report_version: AGT002_SERVICE_V2_SHADOW_REPORT_VERSION,
    generated_at: nowIso,
    policy_version: TENDER_FIT_POLICY_VERSION,
    matrix_version: TENDER_SERVICE_MATRIX_V2_VERSION,
    source_count: rawItems.length,
    items,
    summary: buildSummary(items),
  };
}

async function writeAtomic(targetPath, contents) {
  const tempPath = `${targetPath}.tmp-${randomUUID()}`;
  await writeFile(tempPath, contents, 'utf8');
  await rename(tempPath, targetPath);
}

export async function writeAgt002ServiceV2ShadowReport({ payload, nowIso, outputDir } = {}) {
  assertValidNowIso(nowIso);
  extractItems(payload);
  if (typeof outputDir !== 'string' || outputDir.length === 0) {
    throw new TypeError('outputDir inválido: debe ser un string no vacío');
  }

  const report = buildAgt002ServiceV2ShadowReport(payload, { nowIso });
  await mkdir(outputDir, { recursive: true });

  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const dated = join(outputDir, `${nowIso.slice(0, 10)}.json`);
  const latest = join(outputDir, 'latest.json');
  await writeAtomic(dated, serialized);
  await writeAtomic(latest, serialized);

  return { paths: { dated, latest }, report };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [inputPath, outputDir, nowIsoArg] = process.argv.slice(2);
  try {
    const payload = JSON.parse(await readFile(inputPath, 'utf8'));
    const nowIso = nowIsoArg || new Date().toISOString();
    const { paths, report } = await writeAgt002ServiceV2ShadowReport({ payload, nowIso, outputDir });
    console.log(JSON.stringify({
      paths, source_count: report.source_count, changed_count: report.summary.changed_count,
    }));
  } catch (error) {
    console.error(error && error.message ? error.message : String(error));
    process.exitCode = 1;
  }
}
