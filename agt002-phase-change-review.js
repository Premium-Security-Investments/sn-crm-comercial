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

import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  agt002PhaseChangeOpportunityBlocker,
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

/** Marcas "detectado" recientes (de esta revisión o de la cadena diaria), sólo de oportunidades ACTIVAS. */
export async function listRecentAgt002PhaseChangeDetections(database, { now = new Date() } = {}) {
  const { data, error } = await database.from('psi_sales_interactions').select('opportunity_id,notes,created_at')
    .eq('interaction_type', 'documento').gte('created_at', new Date(now.getTime() - DETECTION_LOOKBACK_MS).toISOString())
    .like('notes', '%"kind":"tender_phase_change_detected"%');
  if (error) throw new Error(`marcas recientes: ${error.message}`);
  const detections = (data || []).map(row => ({ row, payload: parseNotes(row.notes) })).filter(item => item.payload?.notice_uid)
    .map(({ row, payload }) => ({ opportunityId: row.opportunity_id, noticeUid: payload.notice_uid, url: payload.url, recordedAt: row.created_at, change: { change: payload.change, newPhase: payload.new_phase, ref: payload.ref } }));
  const active = new Map();
  const result = [];
  for (const detection of detections) {
    if (!active.has(detection.opportunityId)) active.set(detection.opportunityId, !(await agt002PhaseChangeOpportunityBlocker(database, detection.opportunityId, null)));
    if (active.get(detection.opportunityId)) result.push(detection);
  }
  return result;
}

async function opportunityInfo(database, opportunityIds) {
  const info = new Map();
  for (const id of opportunityIds) {
    const { data } = await database.from('psi_public_tenders').select('entity,value,title,converted_opportunity_id').eq('converted_opportunity_id', id).maybeSingle();
    info.set(id, { entity: data?.entity || null, value: data?.value ?? null, title: data?.title || '' });
  }
  return info;
}

// Lo ya informado. Si reported-keys.json falta o está dañado, se reconstruye desde los outbox existentes; si tampoco
// hay outbox, `rebuilt: 'none'` y la revisión sólo informa marcas de las últimas horas (nunca reinforma lo antiguo).
function readReported(dir, fsImpl) {
  try {
    const keys = JSON.parse(fsImpl.readFileSync(join(dir, 'reported-keys.json'), 'utf8')).keys;
    if (keys && typeof keys === 'object') return { keys, rebuilt: false };
  } catch { /* se reconstruye abajo */ }
  const keys = {};
  let files = [];
  try { files = (fsImpl.readdirSync ? fsImpl.readdirSync(dir) : []).filter(name => /^outbox-.+\.json$/.test(name) && name !== 'outbox-latest.json'); } catch { files = []; }
  for (const name of files) {
    try {
      const outbox = JSON.parse(fsImpl.readFileSync(join(dir, name), 'utf8'));
      for (const key of outbox.item_keys || []) keys[key] = { run_id: outbox.run_id, at: outbox.generated_at };
    } catch { /* un outbox dañado no se usa */ }
  }
  return { keys, rebuilt: files.length ? 'outbox' : 'none' };
}
const FRESH_DETECTION_MS = 6 * 60 * 60 * 1000;

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
  fsImpl = { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync }, admit, freezeProfile, log = () => {},
} = {}) {
  const runId = `${bogotaDay(now.toISOString())}-${bogotaTime(now.toISOString()).replace(':', '')}-${now.toISOString().replace(/[-:.]/g, '').slice(0, 15)}Z`;
  const step = async (name, fn, fallback) => { try { return await fn(); } catch (error) { log({ event: `agt002_phase_change_review_${name}_failed`, message: String(error?.message || error).slice(0, 200) }); return fallback; } };
  const isActive = row => isAgt002PhaseChangeActiveOpportunity(database, row);
  const sync = await step('link_sync', () => api.syncConvertedTenderPhaseLinks(database, { isActive, now: now.toISOString() }), null);
  log({ event: 'agt002_phase_change_link_sync', ...(sync || {}) });
  // Limitación conocida: sólo SECOP II tiene seguimiento de fases. Una activa de otra fuente se deja explícita en el log.
  for (const item of sync?.other_sources || []) log({ event: 'agt002_phase_change_review_source_not_followed', opportunityId: item.opportunity_id, source: item.source });
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
  const { keys: reported, rebuilt } = readReported(stateDir, fsImpl);
  if (rebuilt) log({ event: 'agt002_licitaciones_alerts_reported_keys_rebuilt', from: rebuilt, keys: Object.keys(reported).length });
  const freshDetections = rebuilt === 'none' ? detections.filter(item => now.getTime() - Date.parse(item.recordedAt || 0) <= FRESH_DETECTION_MS) : detections;
  const items = agt002AlertItems(agt002ReviewFacts({ documentEvents, analysisEvents, results, detections: freshDetections }), { day })
    .filter((item, index, list) => !reported[item.key] && list.findIndex(other => other.key === item.key) === index);
  if (!items.length) { log({ event: 'agt002_licitaciones_alerts_nothing_new', run_id: runId }); return { runId, outbox: null, items: [] }; }
  const opportunities = await opportunityInfo(database, [...new Set(items.map(item => item.opportunityId))]);
  const outbox = buildAgt002AlertsOutbox({ runId, generatedAt: now.toISOString(), slot: bogotaTime(now.toISOString()), items, opportunities });
  // Lo informado se guarda ANTES del outbox (atómico): una falla nunca produce un correo repetido con otro id. Si el
  // outbox no se puede escribir, se restaura lo anterior y la novedad sale en la revisión siguiente.
  const cutoff = now.getTime() - REPORTED_RETENTION_MS;
  const kept = Object.fromEntries(Object.entries(reported).filter(([, value]) => Date.parse(value?.at || 0) >= cutoff));
  for (const item of items) kept[item.key] = { run_id: runId, at: now.toISOString() };
  fsImpl.mkdirSync(stateDir, { recursive: true });
  writeAtomic(stateDir, 'reported-keys.json', `${JSON.stringify({ keys: kept }, null, 2)}\n`, fsImpl);
  try {
    writeAgt002AlertsOutbox(stateDir, outbox, fsImpl);
  } catch (error) {
    try { writeAtomic(stateDir, 'reported-keys.json', `${JSON.stringify({ keys: reported }, null, 2)}\n`, fsImpl); } catch { /* el evento reporta la falla */ }
    throw error;
  }
  log({ event: 'agt002_licitaciones_alerts_outbox_written', run_id: runId, message_id: outbox.messages[0].id, items: items.length });
  return { runId, outbox, items };
}

export { noticeUidFromTenderUrl };
