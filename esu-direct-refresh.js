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

      let upsertResult;
      try {
        upsertResult = await upsertTenders(processes);
      } catch (error) {
        const reason = error?.message || 'upsert_failed';
        await recordCheckpointSafely({ run_at: nowIso, status: 'unavailable', count_fetched: processes.length, count_upserted: 0, error: reason });
        return { status: 'unavailable', source: ESU_DIRECT_REFRESH_SOURCE, reason, rows: 0 };
      }
      // upsertTenders is named for its original upsert-based adapter; a reconcile-existing-only
      // adapter returns the actual number of rows it safely matched and updated instead, which is
      // almost always lower than count_fetched. Adapters that don't return a count (older/simpler
      // upsertTenders implementations, e.g. in tests) keep the prior processes.length fallback.
      const countUpserted = Number.isInteger(upsertResult) && upsertResult >= 0 ? upsertResult : processes.length;

      await recordCheckpointSafely({ run_at: nowIso, status: 'success', count_fetched: processes.length, count_upserted: countUpserted });
      return { status: 'success', source: ESU_DIRECT_REFRESH_SOURCE, count_fetched: processes.length, count_upserted: countUpserted, rows: countUpserted };
    },
  });
}

// Extracts the last "20xx-<sequence>" reference key embedded in an ESU ref string, tolerant of
// human prefixes/glyphs and stray spacing around the dash ("SPVA N° 2026-27", "Oferta N° 2026 -
// 27"). Refs with no such key (e.g. "VARIOS SIN NUMERO") can never be safely correlated and
// return null; there is no fuzzy/string fallback beyond this key.
function canonicalEsuRefKey(ref) {
  if (typeof ref !== 'string') return null;
  const matches = [...ref.matchAll(/(20\d{2})\s*-\s*(\d+)/g)];
  if (!matches.length) return null;
  const [, year, sequence] = matches[matches.length - 1];
  return `${year}-${Number(sequence)}`;
}

function groupByKey(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (key === null || key === undefined) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

// Correlates one freshly crawled direct process to at most one existing psi_public_tenders row,
// never guessing: an exact stable_key match must itself resolve to exactly one existing row, and
// the canonical-ref fallback only fires when both the existing-row group and the direct-process
// group for that canonical key are singletons (a 1:many group on either side is left alone).
function findSafeExistingEsuMatch(process, existingByStableKey, existingByCanonicalRef, directByCanonicalRef) {
  const byStableKey = existingByStableKey.get(process.stable_key);
  if (byStableKey && byStableKey.length === 1) return byStableKey[0];
  const canonicalKey = canonicalEsuRefKey(process.ref);
  if (!canonicalKey) return null;
  const dbGroup = existingByCanonicalRef.get(canonicalKey);
  const directGroup = directByCanonicalRef.get(canonicalKey);
  if (dbGroup && dbGroup.length === 1 && directGroup && directGroup.length === 1) return dbGroup[0];
  return null;
}

// Some existing rows are SECOP-backed by URL/stable key but are still labeled with the
// 'ESU Contratación' source, so the exact `.eq('source', ...)` scope below is a mandatory first
// boundary, not a sufficient one: it is followed by exact-stable_key / unique-canonical-ref
// matching, never a fuzzy source or title match, and every write is an id-targeted update. This
// never upserts or inserts: it only ever updates a row that already exists, by id.
async function reconcileExistingEsuTenders(database, processes) {
  const response = await database
    .from('psi_public_tenders')
    .select('id,stable_key,ref,title,deadline_at,status')
    .eq('source', 'ESU Contratación');
  if (response?.error) throw response.error;
  const existingRows = response?.data || [];

  const existingByStableKey = groupByKey(existingRows, row => row.stable_key || null);
  const existingByCanonicalRef = groupByKey(existingRows, row => canonicalEsuRefKey(row.ref));
  const directByCanonicalRef = groupByKey(processes, process => canonicalEsuRefKey(process.ref));

  let updated = 0;
  for (const process of processes) {
    const existingRow = findSafeExistingEsuMatch(process, existingByStableKey, existingByCanonicalRef, directByCanonicalRef);
    if (!existingRow) continue;
    // Narrow, technical-only patch: only the authoritative deadline/status travel from the direct
    // crawl, with mergeAuthoritativeEsuTender preserving the persisted value when the direct read
    // came back blank. Title/ref/entity/stable_key and every human/business field are untouched.
    const authoritative = mergeAuthoritativeEsuTender(existingRow, { deadline_at: process.deadline || null, status: process.status || null });
    const patch = { deadline_at: authoritative.deadline_at, status: authoritative.status };
    const updateResponse = await database.from('psi_public_tenders').update(patch).eq('id', existingRow.id);
    if (updateResponse?.error) throw updateResponse.error;
    updated += 1;
  }
  return updated;
}

// Composes the generic, storage-agnostic refresher above with Supabase-backed adapters: cadence
// checkpointing and reconcile-existing-only psi_public_tenders updates, both scoped to exactly
// the ESU direct-refresh concerns described on esu-direct-refresh.js's module docstring.
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
    return reconcileExistingEsuTenders(database, processes);
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
