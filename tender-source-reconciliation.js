// Reconciles a durable SECOP II `psi_public_tenders` row (see
// supabase/migrations/005_public_tenders_radar.sql) against the live datos.gov.co Socrata record
// for the same `id_del_proceso` (see the `tenderSources['SECOP II']` config in server/index.js:
// dateField `fecha_de_recepcion_de`, status candidates `estado_resumen` / `fase` /
// `estado_del_procedimiento`).
//
// Hard invariant: this is a technical refresh only. It may ever patch `deadline_at`, `status`,
// `raw` and `last_seen_at` -- never identity, never human/business fields, never conversion
// fields.
//
// Decisión del dueño (2026-10-09): esta conciliación es un paso de la cadena diaria del Radar y,
// como el resto del Radar diario (#334), nunca escribe en una licitación convertida en oportunidad
// (`internal_status = 'convertida_oportunidad'`). Las no activas no se tocan nunca; las activas las
// mantiene al día sólo la revisión programada (agt002-phase-change-review → enlace, proceso,
// estado, cierre y fases conocidas).

import { isConvertedTenderRow } from './tender-opportunity-stage.js';

const SECOP_II_RESOURCE = 'https://www.datos.gov.co/resource/p6dx-8zbt.json';
const SECOP_II_SELECT = 'id_del_proceso,entidad,fase,estado_del_procedimiento,estado_resumen,fecha_de_recepcion_de,fecha_de_ultima_publicaci,modalidad_de_contratacion,nombre_del_proveedor,adjudicado';
const STATUS_FIELD_PRECEDENCE = ['estado_resumen', 'fase', 'estado_del_procedimiento'];

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

// Strict calendar YYYY-MM-DD: a prefix match alone would accept `2026-13-40`, so the extracted
// digits are round-tripped through Date.UTC to reject out-of-range months/days.
function parseCalendarDate(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [dateStr, y, m, d] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const asDate = new Date(Date.UTC(year, month - 1, day));
  if (asDate.getUTCFullYear() !== year || asDate.getUTCMonth() !== month - 1 || asDate.getUTCDate() !== day) return null;
  return dateStr;
}

function resolveStatus(sourceRow) {
  for (const field of STATUS_FIELD_PRECEDENCE) {
    const value = sourceRow?.[field];
    if (!isBlank(value)) return value;
  }
  return null;
}

// Deadlines are compared and deduplicated as parsed instants, not raw strings, so that legacy
// `.000Z` and canonical `+00:00` representations of the same moment are recognized as equal
// instead of one lexicographically out-ranking the other.
function toInstant(value) {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export function reconcileTenderSource(existingTender, sourceRow, { now } = {}) {
  const existing = existingTender && typeof existingTender === 'object' ? existingTender : {};
  const existingRaw = existing.raw && typeof existing.raw === 'object' ? existing.raw : {};
  const source = sourceRow && typeof sourceRow === 'object' ? sourceRow : {};

  const date = parseCalendarDate(source.fecha_de_recepcion_de);
  const sourceDeadlineAt = date ? `${date}T00:00:00+00:00` : null;
  const sourceInstant = sourceDeadlineAt ? toInstant(sourceDeadlineAt) : null;
  const currentDeadlineAt = existing.deadline_at || null;
  const currentInstant = toInstant(currentDeadlineAt);

  const patch = {};
  const conflicts = Array.isArray(existingRaw.deadline_conflicts) ? existingRaw.deadline_conflicts.slice() : [];
  const history = Array.isArray(existingRaw.deadline_history) ? existingRaw.deadline_history.slice() : [];

  // Defaults to the source's own calendar date (correct when the source is applied, or when it
  // merely ties the current persisted date). Only the earlier-source branch below overrides this.
  let rawDeadline = date;

  if (sourceDeadlineAt) {
    if (currentInstant === null || sourceInstant > currentInstant) {
      patch.deadline_at = sourceDeadlineAt;
    } else if (sourceInstant < currentInstant) {
      // Earlier source deadlines never move the row backwards; they're recorded as a
      // deterministic, deduplicated conflict so a flapping source can't spam the audit trail on
      // every daily run.
      const alreadyPresent = conflicts.some(c => toInstant(c.source_deadline) === sourceInstant && toInstant(c.current_deadline) === currentInstant);
      if (!alreadyPresent) {
        conflicts.push({ source_deadline: sourceDeadlineAt, current_deadline: currentDeadlineAt, detected_at: now });
      }
      // The display-facing raw.deadline must never regress to the earlier, rejected source date:
      // keep the existing raw.deadline when it already represents the persisted calendar date,
      // otherwise safely derive that calendar date from deadline_at itself.
      const currentCalendarDate = parseCalendarDate(currentDeadlineAt);
      rawDeadline = parseCalendarDate(existingRaw.deadline) === currentCalendarDate ? existingRaw.deadline : currentCalendarDate;
    }
    if (patch.deadline_at) {
      const alreadyRecorded = history.some(entry => toInstant(entry?.deadline_at) === sourceInstant);
      if (!alreadyRecorded) {
        history.push({ deadline_at: patch.deadline_at, source: 'SECOP II', recorded_at: now });
      }
    }
  }

  const resolvedStatus = resolveStatus(source);
  if (!isBlank(resolvedStatus) && resolvedStatus !== existing.status) {
    patch.status = resolvedStatus;
  }

  const PRESERVE_RAW_IF_SOURCE_BLANK = ['modalidad_de_contratacion', 'nombre_del_proveedor', 'adjudicado'];
  const mergedSource = { ...source };
  for (const key of PRESERVE_RAW_IF_SOURCE_BLANK) {
    if (isBlank(source[key]) && !isBlank(existingRaw[key])) {
      mergedSource[key] = existingRaw[key];
    }
  }

  patch.raw = {
    ...existingRaw,
    ...mergedSource,
    deadline: rawDeadline,
    deadline_conflicts: conflicts,
    deadline_history: history,
  };
  patch.last_seen_at = now;

  return { patch };
}

function publicationInstant(row) {
  const instant = toInstant(row?.fecha_de_ultima_publicaci);
  return instant === null ? Number.NEGATIVE_INFINITY : instant;
}

// Socrata can return more than one row for the same id_del_proceso (a correction, a republish).
// Among duplicates, the row with the latest fecha_de_ultima_publicaci is authoritative. A tie on
// that latest publication date is only safe to resolve arbitrarily when the tied rows actually
// agree on the facts this module acts on; if they disagree on resolved status or on
// fecha_de_recepcion_de, Socrata is self-contradictory for this id and guessing would silently
// pick a side -- so this throws instead, and the caller must leave that process unpatched.
export function selectAuthoritativeSocrataRecord(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error('selectAuthoritativeSocrataRecord requires a non-empty row list');
  }
  if (rows.length === 1) return rows[0];

  const maxInstant = Math.max(...rows.map(publicationInstant));
  const winners = rows.filter(row => publicationInstant(row) === maxInstant);
  if (winners.length === 1) return winners[0];

  const statuses = new Set(winners.map(resolveStatus));
  const dates = new Set(winners.map(row => parseCalendarDate(row?.fecha_de_recepcion_de)));
  if (statuses.size > 1 || dates.size > 1) {
    const processId = winners[0]?.id_del_proceso;
    throw new Error(`selectAuthoritativeSocrataRecord: process_id ${processId} has ${winners.length} rows tied on the latest fecha_de_ultima_publicaci that conflict on resolved status or fecha_de_recepcion_de`);
  }
  return winners[0];
}

export function socrataWhereForProcessIds(ids, { field = 'id_del_proceso' } = {}) {
  if (!Array.isArray(ids) || !ids.length) {
    throw new Error('socrataWhereForProcessIds requires a non-empty process_id list');
  }
  const escaped = ids.map(id => `'${String(id).replaceAll("'", "''")}'`).join(',');
  return `${field} in (${escaped})`;
}

function chunkArray(list, size) {
  const chunks = [];
  for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size));
  return chunks;
}

async function defaultHttpFetch(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'SN-CRM-Tender-Source-Reconciliation/1.0', 'Accept': 'application/json' },
    // A stalled Socrata request must not hang the caller indefinitely -- 30s is generous for a
    // chunked IN-clause lookup and well under systemd's TimeoutStartSec for the oneshot unit.
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`SECOP II Socrata respondió ${response.status}`);
  return response.json();
}

async function fetchFromSocrata(where, httpFetch, limit) {
  // Ordering by the latest publication first means a duplicate-heavy id's extra rows are the
  // first ones dropped if $limit is ever hit, not an arbitrary id elsewhere in the chunk.
  const params = new URLSearchParams({
    '$select': SECOP_II_SELECT,
    '$where': where,
    '$order': 'fecha_de_ultima_publicaci DESC',
    '$limit': String(limit),
  });
  const data = await httpFetch(`${SECOP_II_RESOURCE}?${params.toString()}`);
  if (!Array.isArray(data)) throw new Error('SECOP II Socrata respondió un cuerpo no-array; fallo de adquisición');
  return data;
}

export function createTenderSourceReconciliation({
  database,
  fetchSource,
  fetchImpl,
  now = () => new Date().toISOString(),
  pageSize = 500,
  chunkSize = 50,
} = {}) {
  if (!database || typeof database.from !== 'function') {
    throw new Error('createTenderSourceReconciliation requires a database with a from() method');
  }

  const fetchFn = typeof fetchSource === 'function'
    ? fetchSource
    // chunkSize * 20 so a single duplicate-heavy id (many Socrata rows for one process_id) cannot
    // consume the whole $limit and starve the other ids requested in the same chunk.
    : where => fetchFromSocrata(where, typeof fetchImpl === 'function' ? fetchImpl : defaultHttpFetch, chunkSize * 20);

  // Keyset pagination over every durable SECOP II row with a non-null process_id. Converted rows
  // are counted and dropped by runOnce (never patched, never even looked up in Socrata).
  async function fetchDurableRows() {
    const rows = [];
    let cursor = null;
    for (;;) {
      let query = database
        .from('psi_public_tenders')
        .select('*')
        .eq('source', 'SECOP II')
        .not('process_id', 'is', null)
        .order('id');
      if (cursor !== null) query = query.gt('id', cursor);
      query = query.limit(pageSize);
      const { data, error } = await query;
      if (error) throw error;
      const page = Array.isArray(data) ? data : [];
      rows.push(...page);
      if (page.length < pageSize) break;
      cursor = page[page.length - 1].id;
    }
    return rows;
  }

  // Constrains the deadline_at write to the exact value observed on the durable row at read
  // time (a null-safe compare-and-swap via `is()` when there was no current deadline). If a
  // concurrent writer already moved deadline_at, this predicate matches zero rows -- the
  // readback below then fails verification and the row is counted as failed, never overwritten
  // with a stale recompute.
  function applyPatch(row, patch) {
    let query = database.from('psi_public_tenders').update(patch).eq('id', row.id);
    if (Object.hasOwn(patch, 'deadline_at')) {
      const observedDeadlineAt = row.deadline_at ?? null;
      query = observedDeadlineAt === null
        ? query.is('deadline_at', null)
        : query.eq('deadline_at', observedDeadlineAt);
    }
    return query.select('id');
  }

  async function runOnce() {
    const nowValue = typeof now === 'function' ? now() : now;

    const durableRows = await fetchDurableRows();
    // Convertidas (activas o no): fuera de la cadena diaria, sin consulta ni escritura.
    const skippedConverted = durableRows.filter(isConvertedTenderRow).length;
    // Defensive: the durable read is already scoped to a non-null process_id, but a blank string
    // would pass that filter and must never reach a SoQL IN clause.
    const strippedRows = durableRows.filter(row => !isConvertedTenderRow(row) && !isBlank(row?.process_id));
    const scanned = strippedRows.length;

    const uniqueIds = [...new Set(strippedRows.map(row => row.process_id))];
    const sourceByProcessId = new Map();
    const errors = [];

    for (const chunk of chunkArray(uniqueIds, chunkSize)) {
      if (!chunk.length) continue;
      const where = socrataWhereForProcessIds(chunk);
      const sourceRows = await fetchFn(where);
      if (!Array.isArray(sourceRows)) {
        throw new Error('fetchSource devolvió una respuesta no-array; fallo de adquisición');
      }
      const groupedById = new Map();
      for (const sourceRow of sourceRows) {
        const id = sourceRow?.id_del_proceso;
        // A malformed Socrata record with no usable identifier can't be correlated back to a
        // durable row; it is simply dropped here, which surfaces as a `missing` count below.
        if (isBlank(id)) continue;
        if (!groupedById.has(id)) groupedById.set(id, []);
        groupedById.get(id).push(sourceRow);
      }
      for (const [id, group] of groupedById) {
        try {
          sourceByProcessId.set(id, selectAuthoritativeSocrataRecord(group));
        } catch (error) {
          // A self-contradictory duplicate set for this id is left out of the map entirely,
          // which surfaces as `missing` below and fails runOnce closed -- never an arbitrary
          // guess at which duplicate row to trust.
          errors.push({ process_id: id, message: error.message });
        }
      }
    }

    let matched = 0, patched = 0, missing = 0, conflicts = 0, failed = 0;

    for (const row of strippedRows) {
      const sourceRow = sourceByProcessId.get(row.process_id);
      if (!sourceRow) { missing += 1; continue; }
      matched += 1;

      const previousConflicts = Array.isArray(row?.raw?.deadline_conflicts) ? row.raw.deadline_conflicts.length : 0;
      const { patch } = reconcileTenderSource(row, sourceRow, { now: nowValue });
      const nextConflicts = Array.isArray(patch.raw?.deadline_conflicts) ? patch.raw.deadline_conflicts.length : 0;
      if (nextConflicts > previousConflicts) conflicts += 1;

      try {
        const { data, error } = await applyPatch(row, patch);
        const verified = !error && Array.isArray(data) && data.length === 1 && data[0]?.id === row.id;
        if (!verified) {
          failed += 1;
          errors.push({ id: row.id, process_id: row.process_id, message: error?.message || 'unexpected PATCH readback' });
          continue;
        }
        patched += 1;
      } catch (error) {
        failed += 1;
        errors.push({ id: row.id, process_id: row.process_id, message: error?.message || String(error) });
      }
    }

    return {
      // An unmatched durable process_id (missing > 0) is just as much an unexpected acquisition
      // gap as a failed patch -- it must never report `success`, or a silent drop of a durable
      // row's source lookup would look like a good day forever.
      status: (failed || missing) ? 'partial' : 'success',
      checked: scanned,
      scanned,
      matched,
      patched,
      updated: patched,
      conflicts,
      missing,
      errors,
      failed,
      skipped_converted: skippedConverted,
    };
  }

  return Object.freeze({ runOnce });
}
