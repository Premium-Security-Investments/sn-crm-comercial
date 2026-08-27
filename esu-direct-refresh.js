// ESU Contratación direct-refresh: periodically re-crawls esucontratacion.com and merges fresh
// deadline/status data into the already-persisted psi_public_tenders rows for that source,
// independent of the manual/auto-empty full-radar sync in server/index.js and api/[...path].js.

export const ESU_DIRECT_REFRESH_SOURCE = 'ESU Contratación directo';
export const ESU_DIRECT_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

function isBlank(value) {
  return value === null || value === undefined || value === '';
}

// A transient blank/null crawl read (e.g. a partially-rendered ESU detail page) can never erase
// an authoritative deadline_at/status recorded by a prior successful refresh; every other field
// follows the incoming crawl.
export function mergeAuthoritativeEsuTender(existing, incoming) {
  const base = existing && typeof existing === 'object' ? existing : {};
  const next = incoming && typeof incoming === 'object' ? incoming : {};
  const merged = { ...base, ...next };
  for (const field of ['deadline_at', 'status']) {
    if (isBlank(next[field]) && !isBlank(base[field])) merged[field] = base[field];
  }
  return merged;
}

function toEpochMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value);
  return NaN;
}

export function createEsuDirectRefresher({
  now,
  readLastCheckpoint,
  fetchDirectProcesses,
  upsertTenders,
  recordCheckpoint,
  intervalMs = ESU_DIRECT_REFRESH_INTERVAL_MS,
} = {}) {
  if (typeof now !== 'function' || typeof readLastCheckpoint !== 'function' || typeof fetchDirectProcesses !== 'function'
    || typeof upsertTenders !== 'function' || typeof recordCheckpoint !== 'function') {
    throw new Error('ESU_DIRECT_REFRESHER_DEPENDENCIES_INVALID');
  }
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error('ESU_DIRECT_REFRESHER_INTERVAL_INVALID');

  async function recordCheckpointSafely(entry) {
    try { await recordCheckpoint(entry); } catch { /* observability write only; never overrides the result already computed. */ }
  }

  return Object.freeze({
    async runOnce() {
      const nowMs = toEpochMs(now());
      if (!Number.isFinite(nowMs)) {
        return { status: 'unavailable', source: ESU_DIRECT_REFRESH_SOURCE, reason: 'invalid_time' };
      }
      const nowIso = new Date(nowMs).toISOString();

      let checkpoint;
      try {
        checkpoint = await readLastCheckpoint();
      } catch (error) {
        return { status: 'unavailable', source: ESU_DIRECT_REFRESH_SOURCE, reason: error?.message || 'checkpoint_read_failed' };
      }
      // Boundary is inclusive: a refresh exactly `intervalMs` after the last checkpoint is due
      // (>=), not skipped. No checkpoint yet always means due (age treated as Infinity).
      const lastRunAtMs = toEpochMs(checkpoint?.run_at);
      const age = Number.isFinite(lastRunAtMs) ? nowMs - lastRunAtMs : Infinity;
      if (age < intervalMs) {
        return { status: 'skipped_fresh', source: ESU_DIRECT_REFRESH_SOURCE, last_run_at: checkpoint?.run_at || null };
      }

      let processes;
      try {
        processes = await fetchDirectProcesses();
        if (!Array.isArray(processes)) throw new Error('fetchDirectProcesses did not return an array');
      } catch (error) {
        const reason = error?.message || 'fetch_failed';
        await recordCheckpointSafely({ run_at: nowIso, status: 'unavailable', count_fetched: 0, count_upserted: 0, error: reason });
        return { status: 'unavailable', source: ESU_DIRECT_REFRESH_SOURCE, reason, rows: 0 };
      }

      if (!processes.length) {
        await recordCheckpointSafely({ run_at: nowIso, status: 'success_empty', count_fetched: 0, count_upserted: 0 });
        return { status: 'success_empty', source: ESU_DIRECT_REFRESH_SOURCE, count_fetched: 0, count_upserted: 0, rows: 0 };
      }

      try {
        await upsertTenders(processes);
      } catch (error) {
        const reason = error?.message || 'upsert_failed';
        await recordCheckpointSafely({ run_at: nowIso, status: 'unavailable', count_fetched: processes.length, count_upserted: 0, error: reason });
        return { status: 'unavailable', source: ESU_DIRECT_REFRESH_SOURCE, reason, rows: 0 };
      }

      await recordCheckpointSafely({ run_at: nowIso, status: 'success', count_fetched: processes.length, count_upserted: processes.length });
      return { status: 'success', source: ESU_DIRECT_REFRESH_SOURCE, count_fetched: processes.length, count_upserted: processes.length, rows: processes.length };
    },
  });
}

const TENDER_PERSISTENCE_SECTIONS = new Set(['hacer', 'revisar', 'prioridad_baja']);
// Mirrors normalizeTenderPersistenceSection in server/index.js (same default-to-lowest-priority
// rule for the general radar sync); duplicated here, not imported, so this module never pulls in
// server/index.js's Express/Supabase import-time side effects.
function normalizeEsuTenderSection(section) {
  return TENDER_PERSISTENCE_SECTIONS.has(section) ? section : 'prioridad_baja';
}

// Maps a crawled ESU process onto exactly the technical source fields persistTenderRadar writes
// for psi_public_tenders (server/index.js). Deliberately excludes the crawler's own `id` (the
// DB primary key is a UUID psi_public_tenders assigns, not the crawler's stable-key-derived id)
// and every human/business field (internal_status, converted_opportunity_id, reviewed_*,
// tracking_*, owner, interactions, opportunities, ...): this refresh only ever touches
// source-truth columns, never sales/tracking state.
function toEsuTenderSourceRow(process, nowIso) {
  return {
    stable_key: process.stable_key,
    source: process.source,
    section: normalizeEsuTenderSection(process.section),
    entity: process.entity,
    dept: process.dept || null,
    city: process.city || null,
    ref: process.ref || null,
    process_id: process.process_id || null,
    title: process.title,
    description: process.desc || null,
    value: Number(process.value || 0),
    status: process.status || null,
    category: process.category || null,
    published_at: process.published || null,
    deadline_at: process.deadline || null,
    score: Number(process.score || 0),
    reasons: process.reasons || [],
    risks: process.risks || [],
    url: process.url || null,
    raw: process.raw || null,
    last_seen_at: nowIso,
  };
}

// Composes the generic, storage-agnostic refresher above with Supabase-backed adapters: cadence
// checkpointing and psi_public_tenders upserts, both scoped to exactly the ESU direct-refresh
// concerns described on esu-direct-refresh.js's module docstring.
export function createSupabaseEsuDirectRefresher({ database, now, fetchDirectProcesses, intervalMs } = {}) {
  if (!database || typeof database.from !== 'function') throw new Error('ESU_DIRECT_REFRESHER_DATABASE_INVALID');

  async function readLastCheckpoint() {
    // The latest checkpoint counts regardless of status: an `unavailable` attempt still means the
    // ESU source was touched recently, so it must impose the same retry floor as a successful run
    // rather than let a flapping/offline source get hammered every cycle.
    const response = await database
      .from('psi_esu_direct_refresh_runs')
      .select('run_at,status')
      .order('run_at', { ascending: false })
      .limit(1);
    if (response?.error) throw response.error;
    return (response?.data || [])[0] || null;
  }

  async function upsertTenders(processes) {
    const stableKeys = [...new Set(processes.map(p => p?.stable_key).filter(Boolean))];
    const existingByStableKey = new Map();
    if (stableKeys.length) {
      const response = await database
        .from('psi_public_tenders')
        .select('stable_key,deadline_at,status')
        .in('stable_key', stableKeys);
      if (response?.error) throw response.error;
      for (const row of response?.data || []) existingByStableKey.set(row.stable_key, row);
    }
    const nowIso = now();
    const rows = processes.map(process => {
      const mapped = toEsuTenderSourceRow(process, nowIso);
      const existing = existingByStableKey.get(mapped.stable_key) || null;
      // Only the two authoritative-preservation fields are ever carried over from the existing
      // row; every other column comes exclusively from the freshly mapped, technical-only row so
      // the existing row's human/business fields never reach the upsert payload.
      const authoritative = mergeAuthoritativeEsuTender(existing || {}, mapped);
      return { ...mapped, deadline_at: authoritative.deadline_at, status: authoritative.status };
    });
    const response = await database.from('psi_public_tenders').upsert(rows, { onConflict: 'stable_key', defaultToNull: false });
    if (response?.error) throw response.error;
  }

  async function recordCheckpoint(entry) {
    const response = await database.from('psi_esu_direct_refresh_runs').insert({
      run_at: entry.run_at,
      status: entry.status,
      count_fetched: entry.count_fetched,
      count_upserted: entry.count_upserted,
      error: entry.error || null,
    });
    if (response?.error) throw response.error;
  }

  return createEsuDirectRefresher({ now, readLastCheckpoint, fetchDirectProcesses, upsertTenders, recordCheckpoint, intervalMs });
}
