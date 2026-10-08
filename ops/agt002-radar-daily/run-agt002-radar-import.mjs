#!/usr/bin/env node
// AGT-002 Radar import on the host (owner decision 2026-10-06: the daily import lives in the CRM, not in Hermes).
//   --daily     the full daily import (deep SECOP search + TVEC + ESU), persisted as a `cron` run; then the official
//               documents of the new SECOP phase (or republication) of processes already converted
//               (agt002-phase-change-followup.js).
//   --requests  runs the full import for a pending "Sincronizar fuentes oficiales" request, if any.
//   --compare   reads the sources with the full import and compares against the Radar, writing nothing.
//   --top5      writes the Discord "5 de mayor encaje" text and the Radar export built from the CRM's own Radar
//               into AGT002_RADAR_STATE_DIR (default /var/lib/agt002-radar); Hermes only delivers that text.
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

process.env.CRM_SKIP_LISTEN = '1';
process.env.NEXT_PUBLIC_SUPABASE_URL ||= process.env.SUPABASE_URL;
const log = event => console.log(JSON.stringify(event));
const mode = process.argv[2];
if (!['--daily', '--requests', '--compare', '--top5'].includes(mode)) {
  log({ event: 'agt002_radar_import_usage', usage: 'run-agt002-radar-import.mjs --daily|--requests|--compare|--top5' });
  process.exit(2);
}

const api = await import('../../api/[...path].js');
const { createClient } = await import('@supabase/supabase-js');
const database = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function summarize(result) {
  const receipt = result?.run_receipt || {};
  return { status: receipt.status || null, visible: result?.tenders?.length ?? null, sources: (result?.diagnostics || []).map(d => `${d.source}: ${d.status} (${d.records_read ?? d.count})`) };
}

// Procesos SECOP II ya convertidos cuya fase nueva (o republicación) se detectó: importa los documentos del aviso nuevo
// (sin modelo, sin costo) cuando datos.gov.co trae documentos nuevos y publica el mismo conjunto en dos corridas seguidas.
// Best-effort: lo que aún no está listo queda pendiente para la siguiente corrida y nunca hace fallar la importación.
async function runPhaseChangeDocuments() {
  try {
    const { runAgt002PhaseChangeDocumentRefresh } = await import('../../agt002-phase-change-followup.js');
    const events = await runAgt002PhaseChangeDocumentRefresh(database, {
      probeDocuments: (opportunityId, options) => api.probePhaseChangeTenderDocumentSet(database, opportunityId, options),
      importDocuments: (opportunityId, options) => api.importPhaseChangeTenderDocuments(database, opportunityId, options),
    });
    for (const event of events) log(event);
  } catch (error) {
    log({ event: 'agt002_phase_change_documents_pass_failed', message: String(error?.message || error).slice(0, 200) });
  }
}

async function runDaily() {
  const started = Date.now();
  const result = await api.persistTenderRadar(database, null, 'cron', { deep: true });
  log({ event: 'agt002_radar_import_daily', seconds: Math.round((Date.now() - started) / 1000), ...summarize(result) });
  await runPhaseChangeDocuments();
}

async function runRequests() {
  const { data: pending, error } = await database.from('psi_agt002_radar_import_requests')
    .select('id,requested_by').eq('status', 'pending').order('requested_at').limit(1).maybeSingle();
  if (error) throw error;
  if (!pending) return log({ event: 'agt002_radar_import_requests_idle' });
  const claimed = await database.from('psi_agt002_radar_import_requests')
    .update({ status: 'running', started_at: new Date().toISOString() }).eq('id', pending.id).eq('status', 'pending').select('id').maybeSingle();
  if (claimed.error || !claimed.data) return log({ event: 'agt002_radar_import_request_not_claimed', id: pending.id });
  try {
    const result = await api.persistTenderRadar(database, pending.requested_by ? { id: pending.requested_by } : null, 'manual', { deep: true });
    if (result?.run_receipt?.status === 'failed') throw new Error('la corrida terminó fallida');
    await database.from('psi_agt002_radar_import_requests').update({ status: 'done', finished_at: new Date().toISOString() }).eq('id', pending.id);
    log({ event: 'agt002_radar_import_request_done', id: pending.id, ...summarize(result) });
  } catch (cause) {
    await database.from('psi_agt002_radar_import_requests').update({ status: 'failed', finished_at: new Date().toISOString(), error: String(cause?.message || cause).slice(0, 500) }).eq('id', pending.id);
    throw cause;
  }
}

async function runCompare() {
  const started = Date.now();
  const deep = await api.fetchPublicTenderRadar({ deep: true });
  const current = await api.readPersistedTenderRadar(database);
  const deepKeys = new Set(deep.tenders.map(t => t.stable_key));
  const convertedKeys = new Set((current?.tenders || []).filter(t => t.internal_status === 'convertida_oportunidad').map(t => t.stable_key || t.id));
  const currentKeys = new Set((current?.tenders || []).filter(t => t.internal_status !== 'convertida_oportunidad').map(t => t.stable_key || t.id));
  const onlyDeep = deep.tenders.filter(t => !currentKeys.has(t.stable_key) && !convertedKeys.has(t.stable_key));
  const onlyCurrent = (current?.tenders || []).filter(t => t.internal_status !== 'convertida_oportunidad' && !deepKeys.has(t.stable_key || t.id));
  const brief = t => ({ source: t.source, entity: String(t.entity || '').slice(0, 60), title: String(t.title || '').slice(0, 70), value: t.value, deadline: t.deadline || t.deadline_at || null, section: t.section });
  log({
    event: 'agt002_radar_import_compare', seconds: Math.round((Date.now() - started) / 1000),
    diagnostics: deep.diagnostics.map(d => `${d.source}: ${d.status} (${d.records_read})`),
    import_visible: deep.tenders.length, radar_visible_now: currentKeys.size, both: deep.tenders.length - onlyDeep.length,
    only_in_import: onlyDeep.length, only_in_radar_now: onlyCurrent.length,
  });
  for (const t of onlyDeep) log({ event: 'only_in_import', ...brief(t) });
  for (const t of onlyCurrent) log({ event: 'only_in_radar_now', ...brief(t) });
}

async function runTop5() {
  const { formatAgt002RadarDiscordTop5Summary } = await import('./agt002-radar-top5.mjs');
  const radar = await api.readPersistedTenderRadar(database);
  const nowIso = new Date().toISOString();
  const items = (radar?.tenders || []).filter(t => t.internal_status !== 'convertida_oportunidad').map(t => ({
    ...t, stable_key: t.stable_key || t.id, decision: t.section, description: t.desc || t.description || '',
    // The message shows a day, as Hermes did: the CRM stores timestamps ("2026-11-13T00:00:00+00:00").
    value_cop: Number(t.value || 0), deadline: String(t.deadline || t.deadline_at || '').slice(0, 10) || null, deadline_at: t.deadline || t.deadline_at || null,
  }));
  const payload = { run_date: nowIso.slice(0, 10), count: items.length, items };
  const text = formatAgt002RadarDiscordTop5Summary(payload, { nowIso });
  const dir = process.env.AGT002_RADAR_STATE_DIR || '/var/lib/agt002-radar';
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of [['discord-top5-latest.txt', `${text}\n`], ['radar-latest.json', JSON.stringify(payload)]]) {
    writeFileSync(join(dir, `${name}.tmp`), content);
    renameSync(join(dir, `${name}.tmp`), join(dir, name));
  }
  log({ event: 'agt002_radar_top5_written', items: items.length, dir });
}

try {
  if (mode === '--daily') await runDaily();
  if (mode === '--requests') await runRequests();
  if (mode === '--compare') await runCompare();
  if (mode === '--top5') await runTop5();
  process.exit(0);
} catch (error) {
  const cause = error?.cause ? { cause: String(error.cause?.code || error.cause?.name || ''), cause_message: String(error.cause?.message || error.cause).slice(0, 300) } : {};
  log({ event: 'agt002_radar_import_failed', mode, message: String(error?.message || error).slice(0, 300), ...cause, stack: String(error?.stack || '').split('\n').slice(1, 6).join(' | ').slice(0, 600) });
  process.exit(1);
}
