// AGT-002 Radar — persistencia idempotente del snapshot de corrida (Corte 3, mitad backend).
//
// RED deliberado: `../agt002-radar-run-delta-persistence.js` todavía NO EXISTE. Este archivo entero
// debe fallar al importar (ERR_MODULE_NOT_FOUND) hasta que se cree el adaptador de persistencia que
// envuelve `buildAgt002RadarRunSnapshot`/`computeAgt002RadarRunDelta` (dominio puro, ya implementado
// y probado en agt002-radar-run-delta.js) con lectura/escritura real contra `psi_tender_radar_runs`,
// reutilizando exactamente el mismo mecanismo de recibo del Corte 2 (misma tabla, mismo patrón
// upsert onConflict:'id' por run_id, sin migración).
//
// Fija el contrato esperado:
//   - `recordAgt002RadarRunSnapshot(database, snapshot)` persiste el snapshot de forma idempotente
//     por run_id, anidado junto al recibo de corrida existente (si lo hay) en la misma fila/columna
//     `errors` jsonb, sin borrar ninguno de los dos.
//   - `readAgt002RadarRunDeltaPair(database)` lee exclusivamente las DOS corridas persistidas más
//     recientes que traigan un snapshot válido (`{ latest, previous }`), ignorando filas ajenas sin
//     snapshot (otros escritores/modos) y corridas más viejas que esas dos.
//   - Un snapshot corrupto/con campos fuera del allowlist se rechaza fail-closed, sin persistir nada.
import assert from 'node:assert/strict';
import {
  Agt002RadarRunDeltaValidationError,
  buildAgt002RadarRunSnapshot,
  computeAgt002RadarRunDelta,
} from '../agt002-radar-run-delta.js';
import { buildAgt002RadarRunReceipt, recordAgt002RadarRunReceipt } from '../agt002-radar-run-receipt.js';
import {
  AGT002_RADAR_RUN_DELTA_SNAPSHOT_SCHEMA_VERSION,
  readAgt002RadarRunDeltaPair,
  recordAgt002RadarRunSnapshot,
} from '../agt002-radar-run-delta-persistence.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const STARTED = '2026-09-30T13:00:00.000Z';
const FINISHED = '2026-09-30T13:00:05.000Z';

// 0. Superficie cerrada / constantes.
assert.equal(AGT002_RADAR_RUN_DELTA_SNAPSHOT_SCHEMA_VERSION, 'agt002-radar-run-delta-v1');

const candidate = (overrides = {}) => ({
  stable_key: 'k-1', source: 'SECOP II', title: 'Vigilancia armada', entity: 'Alcaldía de Manizales',
  deadline: '2026-10-15', fit_band: 'alto', fit_reasons: ['coincide objeto'], known_phases: ['radar'],
  ...overrides,
});
const src = (source, status, candidates = []) => ({ source, status, candidates: status === 'success' ? candidates : undefined });
const rawReceipt = (runId, finishedAt, sources) => ({ run_id: runId, finished_at: finishedAt, sources });
const snap = (runId, finishedAt, sources) => buildAgt002RadarRunSnapshot(rawReceipt(runId, finishedAt, sources));

// Replica el soporte real de PostgREST para `->>` en el nombre de columna (igual que en
// tests/agt002-radar-run-receipt.test.mjs), y para `eq` por columna plana (p.ej. `id`).
function readJsonArrowPath(row, column) {
  if (!column.includes('->>')) return row[column];
  const [base, ...path] = column.split('->>');
  let value = row[base];
  for (const key of path) value = value == null ? undefined : value[key];
  return value;
}

function createFakeTenderRadarRunsTable(initialRows = []) {
  const rows = [...initialRows];
  const calls = { upsert: [], select: [] };
  const database = {
    from(table) {
      assert.equal(table, 'psi_tender_radar_runs');
      return {
        async upsert(row, options) {
          calls.upsert.push({ row, options });
          const index = rows.findIndex(existing => existing.id === row.id);
          if (index === -1) rows.push({ ...row });
          else rows[index] = { ...rows[index], ...row };
          return { data: null, error: null };
        },
        select(columns) {
          calls.select.push(columns);
          let filtered = [...rows];
          let ordered = null;
          let lim = rows.length;
          const api = {
            eq(column, value) { filtered = filtered.filter(row => readJsonArrowPath(row, column) === value); return api; },
            order(_column, { ascending } = {}) { ordered = filtered.slice().sort((a, b) => ascending ? a.run_at.localeCompare(b.run_at) : b.run_at.localeCompare(a.run_at)); return api; },
            limit(value) { lim = value; return api; },
            async maybeSingle() { return { data: (ordered || filtered).slice(0, lim)[0] || null, error: null }; },
            then(resolve) { resolve({ data: (ordered || filtered).slice(0, lim), error: null }); },
          };
          return api;
        },
      };
    },
  };
  return { database, rows, calls };
}

// 1. Requiere un cliente con `.from`.
await assert.rejects(
  () => recordAgt002RadarRunSnapshot({}, snap(RUN_ID, FINISHED, [src('SECOP II', 'success', [candidate()])])),
  /DATABASE_REQUIRED/,
);
await assert.rejects(() => readAgt002RadarRunDeltaPair(null), /DATABASE_REQUIRED/);

// 2. Idempotencia por run_id: dos escrituras con el mismo run_id -> una sola fila.
{
  const { database, rows } = createFakeTenderRadarRunsTable();
  const snapshot = snap(RUN_ID, FINISHED, [src('SECOP II', 'success', [candidate()])]);
  await recordAgt002RadarRunSnapshot(database, snapshot);
  await recordAgt002RadarRunSnapshot(database, snapshot);
  assert.equal(rows.length, 1, 'el mismo run_id nunca produce una segunda fila');
  assert.equal(rows[0].id, RUN_ID);
  assert.deepEqual(rows[0].errors.radar_run_snapshot, snapshot);
}

// 3. El snapshot debe compartir fila con el recibo del Corte 2 ya escrito para el mismo run_id, sin
//    borrarlo (orden real de producción: recibo primero, snapshot después, misma corrida).
{
  const { database, rows } = createFakeTenderRadarRunsTable();
  const receipt = buildAgt002RadarRunReceipt({
    runId: RUN_ID, startedAt: STARTED, finishedAt: FINISHED,
    sources: [{ name: 'SECOP II', attempted: true, succeeded: true, pages_read: 1, records_read: 1, candidates_found: 1 }],
  });
  await recordAgt002RadarRunReceipt(database, receipt, { mode: 'manual' });
  const snapshot = snap(RUN_ID, FINISHED, [src('SECOP II', 'success', [candidate()])]);
  await recordAgt002RadarRunSnapshot(database, snapshot);
  assert.equal(rows.length, 1, 'el snapshot debe compartir la misma fila que el recibo, no crear una fila aparte');
  assert.equal(rows[0].errors.status, 'complete', 'el recibo del Corte 2 no debe perderse al grabar el snapshot del Corte 3');
  assert.deepEqual(rows[0].errors.radar_run_snapshot, snapshot, 'el snapshot debe quedar anidado junto al recibo, sin migración de columna');
}

// 4. Rotación latest+previous: sólo las dos corridas persistidas más recientes cuentan, pase lo que
//    pase con corridas más viejas.
{
  const { database } = createFakeTenderRadarRunsTable();
  const s1 = snap('run-1', '2026-09-28T08:00:00.000Z', [src('SECOP II', 'success', [candidate({ stable_key: 'k-old' })])]);
  const s2 = snap('run-2', '2026-09-29T08:00:00.000Z', [src('SECOP II', 'success', [candidate({ stable_key: 'k-mid' })])]);
  const s3 = snap('run-3', '2026-09-30T08:00:00.000Z', [src('SECOP II', 'success', [candidate({ stable_key: 'k-new' })])]);
  for (const snapshot of [s1, s2, s3]) await recordAgt002RadarRunSnapshot(database, snapshot);
  const pair = await readAgt002RadarRunDeltaPair(database);
  assert.equal(pair.latest.run_id, 'run-3');
  assert.equal(pair.previous.run_id, 'run-2', 'nunca debe compararse contra run-1, aunque exista en el historial');
}

// 5. Una fila ajena sin snapshot (otro escritor/modo, p.ej. `mode:'company_profile'`) con `run_at`
//    más reciente no debe esconder la última corrida real ni colarse como `previous`.
{
  const { database, rows } = createFakeTenderRadarRunsTable();
  const s1 = snap('run-1', '2026-09-29T08:00:00.000Z', [src('SECOP II', 'success', [candidate({ stable_key: 'k-a' })])]);
  await recordAgt002RadarRunSnapshot(database, s1);
  rows.push({ id: 'company-profile-update', run_at: '2026-09-30T23:00:00.000Z', mode: 'company_profile', errors: null });
  const pair = await readAgt002RadarRunDeltaPair(database);
  assert.equal(pair.latest.run_id, 'run-1', 'una fila ajena más reciente sin snapshot no debe esconder la última corrida real');
  assert.equal(pair.previous, null);
}

// 6. Sin ninguna corrida con snapshot -> { latest: null, previous: null }, nunca un error.
{
  const { database } = createFakeTenderRadarRunsTable();
  const pair = await readAgt002RadarRunDeltaPair(database);
  assert.deepEqual(pair, { latest: null, previous: null });
}

// 7. Reintentar la MISMA corrida más reciente (mismo run_id, p.ej. reintento de request) no debe
//    desplazar a `previous`: la idempotencia por run_id también rige la rotación.
{
  const { database } = createFakeTenderRadarRunsTable();
  const s1 = snap('run-1', '2026-09-29T08:00:00.000Z', [src('SECOP II', 'success', [candidate({ stable_key: 'k-a' })])]);
  const s2 = snap('run-2', '2026-09-30T08:00:00.000Z', [src('SECOP II', 'success', [candidate({ stable_key: 'k-a' })])]);
  await recordAgt002RadarRunSnapshot(database, s1);
  await recordAgt002RadarRunSnapshot(database, s2);
  await recordAgt002RadarRunSnapshot(database, s2);
  const pair = await readAgt002RadarRunDeltaPair(database);
  assert.equal(pair.latest.run_id, 'run-2');
  assert.equal(pair.previous.run_id, 'run-1', 'reintentar la misma corrida no debe desplazar la corrida anterior real');
}

// 8. El par leído debe alimentar directamente `computeAgt002RadarRunDelta` sin transformación
//    adicional (forma cerrada intacta).
{
  const { database } = createFakeTenderRadarRunsTable();
  const s1 = snap('run-1', '2026-09-29T08:00:00.000Z', [src('SECOP II', 'success', [candidate({ stable_key: 'k-a', deadline: '2026-10-15' })])]);
  const s2 = snap('run-2', '2026-09-30T08:00:00.000Z', [src('SECOP II', 'success', [
    candidate({ stable_key: 'k-a', deadline: '2026-10-25' }),
    candidate({ stable_key: 'k-b', title: 'Nueva' }),
  ])]);
  await recordAgt002RadarRunSnapshot(database, s1);
  await recordAgt002RadarRunSnapshot(database, s2);
  const pair = await readAgt002RadarRunDeltaPair(database);
  const delta = computeAgt002RadarRunDelta(pair.previous, pair.latest);
  assert.equal(delta.counts.deadline_changed, 1);
  assert.equal(delta.counts.new, 1);
}

// 9. Seguridad/no fuga: un snapshot con un campo fuera del allowlist (colado a mano, p.ej. `raw` con
//    un secreto) se rechaza fail-closed y NUNCA se persiste, ni siquiera parcialmente.
{
  const { database, rows } = createFakeTenderRadarRunsTable();
  const clean = snap('run-1', FINISHED, [src('SECOP II', 'success', [candidate()])]);
  const polluted = { ...clean, candidates: [{ ...clean.candidates[0], raw: { api_key: 'sk-topsecret' } }] };
  await assert.rejects(() => recordAgt002RadarRunSnapshot(database, polluted), Agt002RadarRunDeltaValidationError);
  assert.equal(rows.length, 0, 'un snapshot inválido nunca debe llegar a escribirse, ni parcialmente');
}

console.log('AGT-002 Radar run delta persistence (Corte 3, fake database, no network) — expected to fail until agt002-radar-run-delta-persistence.js exists');
