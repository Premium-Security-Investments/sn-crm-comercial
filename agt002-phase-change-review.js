// AGT-002 — revisión programada de fases nuevas de SECOP (decisión final del dueño, 2026-10-08).
//
// Corre en su propio servicio (agt002-phase-change-review.timer): lunes a viernes 9:00, 14:00 y 19:00 y sábado y
// domingo 14:00, hora Bogotá. En cada revisión, para cada oportunidad convertida ACTIVA (Por decidir / En curso):
//   1. enlace nuevo: familia del proceso en datos.gov.co (#331) → enlace actualizado + marca "detectado";
//   2. conciliación de cambios sin marca;
//   3. documentos nuevos frente a la línea base; la revisión SIGUIENTE confirma la lista y entonces se bajan, y los
//      obsoletos pasan a historial (tender-document-obsolescence.js);
//   4. reanálisis completo por cada tanda nueva estable (fuera del cupo de 5 del análisis al convertir);
//   5. resultado de los reanálisis lanzados antes;
//   6. si hubo novedad, outbox de correo para Hermes (agt002-licitaciones-alerts.js). El CRM nunca envía correo.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  collectAgt002PhaseChangeAnalysisResults,
  isAgt002PhaseChangeActiveOpportunity,
  reconcileAgt002PendingPhaseChanges,
  runAgt002PhaseChangeAnalysisAdmissions,
  runAgt002PhaseChangeDocumentRefresh,
  noticeUidFromTenderUrl,
} from './agt002-phase-change-followup.js';
import { agt002AlertItems, agt002AlertsOutboxSummary, bogotaDay, bogotaTime, buildAgt002AlertsOutbox } from './agt002-licitaciones-alerts.js';

export const AGT002_ALERTS_STATE_DIR = '/var/lib/agt002-licitaciones-alerts';
const DETECTION_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const REPORTED_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

function parseNotes(notes) {
  try { return JSON.parse(String(notes || '')); } catch { return null; }
}

/** Hechos de la revisión a partir de los eventos de cada paso. */
export function agt002ReviewFacts({ documentEvents = [], analysisEvents = [], results = [], detections = [] }) {
  const analysisOutcome = event => {
    if (event.event === 'agt002_phase_change_analysis_admitted') return 'launched';
    if (event.event === 'agt002_phase_change_analysis_deferred' && event.reason === 'safety_limit') return 'safety_limit';
    if (event.event === 'agt002_phase_change_analysis_skipped' && event.reason === 'authorization_window_elapsed') return 'window_elapsed';
    if (event.event === 'agt002_phase_change_analysis_skipped' && ['terminal_status', 'deadline_passed', 'no_deadline', 'opportunity_closed', 'opportunity_missing'].includes(event.reason)) return 'process_closed';
    if (event.event === 'agt002_phase_change_analysis_skipped' || event.event === 'agt002_phase_change_analysis_not_admitted') return 'not_admitted';
    if (event.event === 'agt002_phase_change_analysis_failed') return 'failed';
    return null;
  };
  return {
    detections,
    documents: documentEvents.filter(event => event.event === 'agt002_phase_change_documents_imported'),
    analyses: analysisEvents.map(event => ({ ...event, outcome: analysisOutcome(event) })).filter(event => event.outcome && event.setHash),
    results,
    reviews: documentEvents.filter(event => event.review),
    failures: documentEvents.filter(event => event.failure && event.setHash),
  };
}

/** Marcas "detectado" recientes (de esta revisión o de la cadena diaria). */
export async function listRecentAgt002PhaseChangeDetections(database, { now = new Date() } = {}) {
  const { data, error } = await database.from('psi_sales_interactions').select('opportunity_id,notes,created_at')
    .eq('interaction_type', 'documento').gte('created_at', new Date(now.getTime() - DETECTION_LOOKBACK_MS).toISOString())
    .like('notes', '%"kind":"tender_phase_change_detected"%');
  if (error) throw new Error(`marcas recientes: ${error.message}`);
  return (data || []).map(row => ({ row, payload: parseNotes(row.notes) })).filter(item => item.payload?.notice_uid)
    .map(({ row, payload }) => ({ opportunityId: row.opportunity_id, noticeUid: payload.notice_uid, url: payload.url, change: { change: payload.change, newPhase: payload.new_phase, ref: payload.ref } }));
}

async function opportunityInfo(database, opportunityIds) {
  const info = new Map();
  for (const id of opportunityIds) {
    const { data } = await database.from('psi_public_tenders').select('entity,value,title,converted_opportunity_id').eq('converted_opportunity_id', id).maybeSingle();
    info.set(id, { entity: data?.entity || null, value: data?.value ?? null, title: data?.title || '' });
  }
  return info;
}

function readReported(dir, fsImpl) {
  try { return JSON.parse(fsImpl.readFileSync(join(dir, 'reported-keys.json'), 'utf8')).keys || {}; } catch { return {}; }
}

function writeAtomic(dir, name, content, fsImpl) {
  const tmp = join(dir, `.${name}.${process.pid}.tmp`);
  fsImpl.writeFileSync(tmp, content, { mode: 0o644 });
  fsImpl.renameSync(tmp, join(dir, name));
}

/** outbox-<run_id>.json + outbox-latest.json/.txt (atómicos) y receipts/ para Hermes. */
export function writeAgt002AlertsOutbox(dir, outbox, fsImpl = { mkdirSync, readFileSync, renameSync, writeFileSync }) {
  fsImpl.mkdirSync(dir, { recursive: true });
  fsImpl.mkdirSync(join(dir, 'receipts'), { recursive: true, mode: 0o755 });
  const json = `${JSON.stringify(outbox, null, 2)}\n`;
  writeAtomic(dir, `outbox-${outbox.run_id}.json`, json, fsImpl);
  writeAtomic(dir, 'outbox-latest.json', json, fsImpl);
  writeAtomic(dir, 'outbox-latest.txt', agt002AlertsOutboxSummary(outbox), fsImpl);
}

/** Una revisión completa. `api`: syncConvertedTenderPhaseLinks / probe / import del CRM (server o api). */
export async function runAgt002PhaseChangeReview(database, {
  api, environment = process.env, now = new Date(), budgetMs, stateDir = AGT002_ALERTS_STATE_DIR,
  fsImpl = { mkdirSync, readFileSync, renameSync, writeFileSync }, admit, freezeProfile, log = () => {},
} = {}) {
  const runId = `${bogotaDay(now.toISOString())}-${bogotaTime(now.toISOString()).replace(':', '')}-${now.toISOString().replace(/[-:.]/g, '').slice(0, 15)}Z`;
  const step = async (name, fn, fallback) => { try { return await fn(); } catch (error) { log({ event: `agt002_phase_change_review_${name}_failed`, message: String(error?.message || error).slice(0, 200) }); return fallback; } };
  const isActive = row => isAgt002PhaseChangeActiveOpportunity(database, row);
  const sync = await step('link_sync', () => api.syncConvertedTenderPhaseLinks(database, { isActive, now: now.toISOString() }), null);
  log({ event: 'agt002_phase_change_link_sync', ...(sync || {}) });
  for (const event of await step('reconcile', () => reconcileAgt002PendingPhaseChanges(database, { now }), [])) log(event);
  const documentEvents = await step('documents', () => runAgt002PhaseChangeDocumentRefresh(database, {
    now, ...(budgetMs ? { budgetMs } : {}),
    probeDocuments: (opportunityId, options) => api.probePhaseChangeTenderDocumentSet(database, opportunityId, options),
    importDocuments: (opportunityId, options) => api.importPhaseChangeTenderDocuments(database, opportunityId, options),
  }), []);
  const analysisEvents = await step('analysis', () => runAgt002PhaseChangeAnalysisAdmissions(database, { now, environment, ...(admit ? { admit } : {}), ...(freezeProfile ? { freezeProfile } : {}) }), []);
  const results = await step('results', () => collectAgt002PhaseChangeAnalysisResults(database, { now }), []);
  const detections = await step('detections', () => listRecentAgt002PhaseChangeDetections(database, { now }), []);
  for (const event of [...documentEvents, ...analysisEvents, ...results]) log({ ...event, change: undefined });

  const day = bogotaDay(now.toISOString());
  const reported = readReported(stateDir, fsImpl);
  const items = agt002AlertItems(agt002ReviewFacts({ documentEvents, analysisEvents, results, detections }), { day })
    .filter((item, index, list) => !reported[item.key] && list.findIndex(other => other.key === item.key) === index);
  if (!items.length) { log({ event: 'agt002_licitaciones_alerts_nothing_new', run_id: runId }); return { runId, outbox: null, items: [] }; }
  const opportunities = await opportunityInfo(database, [...new Set(items.map(item => item.opportunityId))]);
  const outbox = buildAgt002AlertsOutbox({ runId, generatedAt: now.toISOString(), slot: bogotaTime(now.toISOString()), items, opportunities });
  writeAgt002AlertsOutbox(stateDir, outbox, fsImpl);
  // Sólo después de escribir el outbox: lo informado no se repite en la revisión siguiente.
  const cutoff = now.getTime() - REPORTED_RETENTION_MS;
  const kept = Object.fromEntries(Object.entries(reported).filter(([, value]) => Date.parse(value?.at || 0) >= cutoff));
  for (const item of items) kept[item.key] = { run_id: runId, at: now.toISOString() };
  writeAtomic(stateDir, 'reported-keys.json', `${JSON.stringify({ keys: kept }, null, 2)}\n`, fsImpl);
  log({ event: 'agt002_licitaciones_alerts_outbox_written', run_id: runId, message_id: outbox.messages[0].id, items: items.length });
  return { runId, outbox, items };
}

export { noticeUidFromTenderUrl };
