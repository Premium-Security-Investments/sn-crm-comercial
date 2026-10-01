import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AGT002_RADAR_RUN_RECEIPT_ABSENCE_NOTICE,
  AGT002_RADAR_RUN_RECEIPT_HISTORY_MAX,
  AGT002_RADAR_RUN_RECEIPT_SCHEMA_VERSION,
  AGT002_RADAR_RUN_RECEIPT_STATUSES,
  buildAgt002RadarRunReceipt,
  readAgt002RadarRunReceiptHistory,
  readLatestAgt002RadarRunReceipt,
  recordAgt002RadarRunReceipt,
  sanitizeAgt002RadarRunReceiptErrorMessage,
} from '../agt002-radar-run-receipt.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const STARTED = '2026-09-30T13:00:00.000Z';
const FINISHED = '2026-09-30T13:00:05.000Z';

// 0. Superficie cerrada / constantes.
assert.deepEqual(AGT002_RADAR_RUN_RECEIPT_STATUSES, ['complete', 'partial', 'failed']);
assert.equal(AGT002_RADAR_RUN_RECEIPT_HISTORY_MAX, 10);
assert.equal(AGT002_RADAR_RUN_RECEIPT_SCHEMA_VERSION, 'agt002-radar-run-receipt-v1');

// 1. Todas las fuentes intentadas terminan -> 'complete'. Sin absence_notice.
{
  const receipt = buildAgt002RadarRunReceipt({
    runId: RUN_ID, startedAt: STARTED, finishedAt: FINISHED,
    sources: [
      { name: 'SECOP II', attempted: true, succeeded: true, pages_read: 1, records_read: 40, candidates_found: 6 },
      { name: 'TVEC', attempted: true, succeeded: true, pages_read: 1, records_read: 10, candidates_found: 2 },
    ],
  });
  assert.equal(receipt.schema_version, AGT002_RADAR_RUN_RECEIPT_SCHEMA_VERSION);
  assert.equal(receipt.run_id, RUN_ID);
  assert.equal(receipt.started_at, STARTED);
  assert.equal(receipt.finished_at, FINISHED);
  assert.equal(receipt.status, 'complete');
  assert.deepEqual(receipt.sources_attempted, ['SECOP II', 'TVEC']);
  assert.deepEqual(receipt.sources_succeeded, ['SECOP II', 'TVEC']);
  assert.deepEqual(receipt.sources_failed, []);
  assert.deepEqual(receipt.totals, { pages_read: 2, records_read: 50, candidates_found: 8 });
  assert.equal(receipt.fatal_error, null);
  assert.equal(receipt.absence_notice, null);
  assert.ok(Object.isFrozen(receipt));
  assert.ok(Object.isFrozen(receipt.sources));
  assert.ok(Object.isFrozen(receipt.sources[0]));
}

// 2. Alguna falla, alguna termina -> 'partial', con absence_notice explícito y error por fuente.
{
  const receipt = buildAgt002RadarRunReceipt({
    runId: RUN_ID, startedAt: STARTED, finishedAt: FINISHED,
    sources: [
      { name: 'SECOP II', attempted: true, succeeded: true, pages_read: 1, records_read: 40, candidates_found: 6 },
      { name: 'TVEC', attempted: true, succeeded: false, pages_read: 1, error: 'TVEC respondió 503 ?token=abc123' },
    ],
  });
  assert.equal(receipt.status, 'partial');
  assert.deepEqual(receipt.sources_attempted, ['SECOP II', 'TVEC']);
  assert.deepEqual(receipt.sources_succeeded, ['SECOP II']);
  assert.deepEqual(receipt.sources_failed, ['TVEC']);
  assert.equal(receipt.absence_notice, AGT002_RADAR_RUN_RECEIPT_ABSENCE_NOTICE);
  const tvec = receipt.sources.find(source => source.name === 'TVEC');
  assert.equal(tvec.error, 'TVEC respondió 503 ?[REDACTED]');
  // Una fuente fallida nunca aporta records_read/candidates_found, aunque el llamador los pase.
  assert.equal(tvec.records_read, 0);
  assert.equal(tvec.candidates_found, 0);
}

// 3. Todas las intentadas fallan -> 'failed'.
{
  const receipt = buildAgt002RadarRunReceipt({
    runId: RUN_ID, startedAt: STARTED, finishedAt: FINISHED,
    sources: [
      { name: 'SECOP II', attempted: true, succeeded: false, pages_read: 1, error: 'down' },
      { name: 'TVEC', attempted: true, succeeded: false, pages_read: 1, error: 'down' },
    ],
  });
  assert.equal(receipt.status, 'failed');
  assert.deepEqual(receipt.sources_succeeded, []);
  assert.deepEqual(receipt.sources_failed, ['SECOP II', 'TVEC']);
  assert.equal(receipt.absence_notice, AGT002_RADAR_RUN_RECEIPT_ABSENCE_NOTICE);
}

// 4. Ninguna fuente intentada -> 'failed' (fail-closed), no 'complete' vacío.
{
  const receipt = buildAgt002RadarRunReceipt({ runId: RUN_ID, startedAt: STARTED, finishedAt: FINISHED, sources: [] });
  assert.equal(receipt.status, 'failed');
  assert.deepEqual(receipt.sources_attempted, []);
  assert.equal(receipt.absence_notice, AGT002_RADAR_RUN_RECEIPT_ABSENCE_NOTICE);
}

// 5. Corrida fatal: aunque hubiera fuentes exitosas registradas antes del fallo, el recibo entero
//    queda 'failed' y expone fatal_error saneado (sin query string/secreto).
{
  const receipt = buildAgt002RadarRunReceipt({
    runId: RUN_ID, startedAt: STARTED, finishedAt: FINISHED,
    sources: [
      { name: 'SECOP II', attempted: true, succeeded: true, pages_read: 1, records_read: 40, candidates_found: 6 },
      { name: 'TVEC', attempted: true, succeeded: true, pages_read: 1, records_read: 10, candidates_found: 2 },
    ],
    fatalError: new Error('upsert failed: apikey=sk-live-999 at https://db.example/rest?apikey=sk-live-999'),
  });
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.absence_notice, AGT002_RADAR_RUN_RECEIPT_ABSENCE_NOTICE);
  assert.ok(!receipt.fatal_error.includes('sk-live-999'));
  assert.match(receipt.fatal_error, /apikey=\[REDACTED\]/);
}

// 6. Fuentes con attempted:false quedan fuera de los conteos y de los totales.
{
  const receipt = buildAgt002RadarRunReceipt({
    runId: RUN_ID, startedAt: STARTED, finishedAt: FINISHED,
    sources: [
      { name: 'SECOP II', attempted: true, succeeded: true, pages_read: 1, records_read: 40, candidates_found: 6 },
      { name: 'TVEC', attempted: false },
    ],
  });
  assert.equal(receipt.status, 'complete');
  assert.deepEqual(receipt.sources_attempted, ['SECOP II']);
  assert.deepEqual(receipt.totals, { pages_read: 1, records_read: 40, candidates_found: 6 });
  const tvec = receipt.sources.find(source => source.name === 'TVEC');
  assert.equal(tvec.attempted, false);
  assert.equal(tvec.pages_read, 0);
}

// 7. Validación de entradas.
assert.throws(() => buildAgt002RadarRunReceipt({ startedAt: STARTED, finishedAt: FINISHED, sources: [] }), /RUN_ID_REQUIRED/);
assert.throws(() => buildAgt002RadarRunReceipt({ runId: RUN_ID, startedAt: 'not-a-date', finishedAt: FINISHED, sources: [] }), /STARTED_AT_INVALID/);
assert.throws(() => buildAgt002RadarRunReceipt({ runId: RUN_ID, startedAt: STARTED, finishedAt: 'not-a-date', sources: [] }), /FINISHED_AT_INVALID/);
assert.throws(() => buildAgt002RadarRunReceipt({ runId: RUN_ID, startedAt: FINISHED, finishedAt: STARTED, sources: [] }), /FINISHED_BEFORE_STARTED/);
assert.throws(() => buildAgt002RadarRunReceipt({ runId: RUN_ID, startedAt: STARTED, finishedAt: FINISHED, sources: 'not-an-array' }), /SOURCES_INVALID/);
assert.throws(() => buildAgt002RadarRunReceipt({ runId: RUN_ID, startedAt: STARTED, finishedAt: FINISHED, sources: [{ attempted: true, succeeded: true }] }), /SOURCE_NAME_REQUIRED/);

// 8. Determinismo/pureza: mismo input -> mismo output; el módulo nunca llama Date.now()/new Date().
{
  const input = {
    runId: RUN_ID, startedAt: STARTED, finishedAt: FINISHED,
    sources: [{ name: 'SECOP II', attempted: true, succeeded: true, pages_read: 1, records_read: 1, candidates_found: 1 }],
  };
  assert.deepEqual(buildAgt002RadarRunReceipt(input), buildAgt002RadarRunReceipt(input));
  const source = readFileSync(new URL('../agt002-radar-run-receipt.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Date\.now\(\)|new Date\(\)/);
}

// --- Saneamiento de errores ---

assert.equal(sanitizeAgt002RadarRunReceiptErrorMessage(''), null);
assert.equal(sanitizeAgt002RadarRunReceiptErrorMessage(null), null);
assert.equal(sanitizeAgt002RadarRunReceiptErrorMessage(undefined), null);
assert.equal(sanitizeAgt002RadarRunReceiptErrorMessage(42), null);
assert.equal(
  sanitizeAgt002RadarRunReceiptErrorMessage('fetch https://api.example.com/secop?token=abc123&user=juan respondió 500'),
  'fetch https://api.example.com/secop?[REDACTED] respondió 500',
);
assert.equal(
  sanitizeAgt002RadarRunReceiptErrorMessage('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.secret.sig failed'),
  'Authorization: Bearer [REDACTED] failed',
);
assert.equal(
  sanitizeAgt002RadarRunReceiptErrorMessage('apikey: sk-live-999 rejected'),
  'apikey=[REDACTED] rejected',
);
assert.equal(sanitizeAgt002RadarRunReceiptErrorMessage(new Error('plain failure')), 'plain failure');
{
  const long = sanitizeAgt002RadarRunReceiptErrorMessage('x'.repeat(1000));
  assert.ok(long.length <= 501);
  assert.ok(long.endsWith('…'));
}

console.log('AGT-002 Radar run receipt domain contract (pure, no I/O) passed');

// --- Persistencia idempotente con base de datos falsa (sin red/sin DB real) ---

// Replica el soporte real de PostgREST para filtrar columnas jsonb con `->>` en el nombre de
// columna (p.ej. 'errors->>schema_version'), que es exactamente lo que agt002-radar-run-receipt.js
// usa contra Supabase real.
function readJsonArrowPath(row, column) {
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
          // El filtro se aplica ANTES de ordenar/limitar, igual que en PostgREST real: el `limit`
          // nunca ve filas que no pasaron el `eq`.
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

// 9. Idempotencia por run_id: dos escrituras con el mismo run_id -> una sola fila, upsert con
//    onConflict:'id'.
{
  const { database, rows, calls } = createFakeTenderRadarRunsTable();
  const receipt = buildAgt002RadarRunReceipt({
    runId: RUN_ID, startedAt: STARTED, finishedAt: FINISHED,
    sources: [{ name: 'SECOP II', attempted: true, succeeded: true, pages_read: 1, records_read: 1, candidates_found: 1 }],
  });
  await recordAgt002RadarRunReceipt(database, receipt, { mode: 'manual' });
  await recordAgt002RadarRunReceipt(database, receipt, { mode: 'manual' });
  assert.equal(rows.length, 1, 'el mismo run_id nunca produce una segunda fila');
  assert.equal(rows[0].id, RUN_ID);
  assert.equal(rows[0].errors.status, 'complete');
  assert.equal(calls.upsert.length, 2);
  assert.deepEqual(calls.upsert[0].options, { onConflict: 'id' });
  assert.deepEqual(calls.upsert[1].options, { onConflict: 'id' });
}

// 9b. `run_at` por defecto debe ordenar por finalización (`finished_at`), no por inicio
//     (`started_at`): así latest/history ordenan por finalización también en corridas fatales,
//     donde `finished_at` puede ser bastante posterior a `started_at`.
{
  const { database, calls } = createFakeTenderRadarRunsTable();
  const receipt = buildAgt002RadarRunReceipt({
    runId: RUN_ID, startedAt: STARTED, finishedAt: FINISHED,
    sources: [{ name: 'SECOP II', attempted: true, succeeded: true, pages_read: 1, records_read: 1, candidates_found: 1 }],
  });
  await recordAgt002RadarRunReceipt(database, receipt);
  assert.equal(calls.upsert[0].row.run_at, FINISHED);
  assert.notEqual(calls.upsert[0].row.run_at, STARTED);
}

// 9c. Si el recibo no trajera `finished_at` (defensivo), cae a `started_at` en vez de escribir
//     `run_at` indefinido.
{
  const { database, calls } = createFakeTenderRadarRunsTable();
  const receiptWithoutFinishedAt = { run_id: RUN_ID, started_at: STARTED };
  await recordAgt002RadarRunReceipt(database, receiptWithoutFinishedAt);
  assert.equal(calls.upsert[0].row.run_at, STARTED);
}

// 9d. `extraRow.run_at` explícito sigue teniendo prioridad sobre el recibo.
{
  const { database, calls } = createFakeTenderRadarRunsTable();
  const receipt = buildAgt002RadarRunReceipt({
    runId: RUN_ID, startedAt: STARTED, finishedAt: FINISHED,
    sources: [{ name: 'SECOP II', attempted: true, succeeded: true, pages_read: 1, records_read: 1, candidates_found: 1 }],
  });
  const explicitRunAt = '2026-09-30T14:00:00.000Z';
  await recordAgt002RadarRunReceipt(database, receipt, { run_at: explicitRunAt });
  assert.equal(calls.upsert[0].row.run_at, explicitRunAt);
}

// 10. Lectura de última corrida: fila más reciente con recibo válido.
{
  const { database } = createFakeTenderRadarRunsTable([
    { id: 'old', run_at: '2026-09-29T00:00:00.000Z', errors: null },
    { id: RUN_ID, run_at: STARTED, errors: buildAgt002RadarRunReceipt({ runId: RUN_ID, startedAt: STARTED, finishedAt: FINISHED, sources: [{ name: 'SECOP II', attempted: true, succeeded: true, pages_read: 1, records_read: 1, candidates_found: 1 }] }) },
  ]);
  const latest = await readLatestAgt002RadarRunReceipt(database);
  assert.equal(latest.run_id, RUN_ID);
}

// 10b. Si NINGUNA fila trae recibo válido (todas legado/otros modos), devuelve null.
{
  const { database } = createFakeTenderRadarRunsTable([
    { id: 'legacy', run_at: '2026-09-29T00:00:00.000Z', errors: null },
  ]);
  assert.equal(await readLatestAgt002RadarRunReceipt(database), null);
}

// 10c. Sin filas -> null.
{
  const { database } = createFakeTenderRadarRunsTable([]);
  assert.equal(await readLatestAgt002RadarRunReceipt(database), null);
}

// 10d. `psi_tender_radar_runs` es compartida con otros escritores ajenos al recibo (p.ej.
//      `mode:'company_profile'` en `getTenderCompanyProfile`, server/index.js), que pueden insertar
//      una fila SIN recibo con `run_at` más reciente que la última corrida real del Radar. Esa fila
//      ajena nunca debe esconder el recibo real: `readLatest` sigue devolviendo la corrida real, no
//      null.
{
  const { database } = createFakeTenderRadarRunsTable([
    { id: RUN_ID, run_at: STARTED, errors: buildAgt002RadarRunReceipt({ runId: RUN_ID, startedAt: STARTED, finishedAt: FINISHED, sources: [{ name: 'SECOP II', attempted: true, succeeded: true, pages_read: 1, records_read: 1, candidates_found: 1 }] }) },
    { id: 'company-profile-update', run_at: '2026-09-30T23:00:00.000Z', mode: 'company_profile', errors: null },
  ]);
  const latest = await readLatestAgt002RadarRunReceipt(database);
  assert.ok(latest, 'una fila ajena más reciente sin recibo no debe producir null');
  assert.equal(latest.run_id, RUN_ID);
}

// 11. Historial: tope duro de 10 sin importar cuánto pida el llamador. El filtro por
//     schema_version se aplica en la base ANTES del límite, así que el resultado nunca queda por
//     debajo de 10 recibos reales disponibles sólo porque filas de otro modo/origen sin recibo
//     (p.ej. mode:'company_profile') se hayan colado, estén donde estén en la cronología.
{
  // índices 0..14, run_at creciente (14 = más reciente); múltiplos de 3 son filas ajenas sin
  // recibo válido (otro escritor/modo), intercaladas entre las 10 corridas reales.
  const manyRows = Array.from({ length: 15 }, (_, index) => ({
    id: `row-${index}`,
    run_at: new Date(Date.UTC(2026, 8, 1, index)).toISOString(),
    errors: index % 3 === 0 ? null : buildAgt002RadarRunReceipt({
      runId: `row-${index}`, startedAt: STARTED, finishedAt: FINISHED,
      sources: [{ name: 'SECOP II', attempted: true, succeeded: true, pages_read: 1, records_read: 1, candidates_found: 1 }],
    }),
  }));
  const { database } = createFakeTenderRadarRunsTable(manyRows);
  const history = await readAgt002RadarRunReceiptHistory(database, { limit: 1000 });
  for (const entry of history) assert.equal(entry.schema_version, AGT002_RADAR_RUN_RECEIPT_SCHEMA_VERSION);
  // Las 15 filas tienen exactamente 10 recibos reales (se excluyen los 5 múltiplos de 3): el
  // historial debe devolver esos 10 completos, no un subconjunto recortado por ventana cronológica.
  assert.deepEqual(history.map(entry => entry.run_id), ['row-14', 'row-13', 'row-11', 'row-10', 'row-8', 'row-7', 'row-5', 'row-4', 'row-2', 'row-1']);
}

// 11a. Tope duro de 10 cuando sobran recibos reales (más de 10 filas, todas con recibo válido):
//      nunca se devuelven más de 10.
{
  const rows = Array.from({ length: 13 }, (_, index) => ({
    id: `cap-${index}`,
    run_at: new Date(Date.UTC(2026, 8, 2, index)).toISOString(),
    errors: buildAgt002RadarRunReceipt({
      runId: `cap-${index}`, startedAt: STARTED, finishedAt: FINISHED,
      sources: [{ name: 'SECOP II', attempted: true, succeeded: true, pages_read: 1, records_read: 1, candidates_found: 1 }],
    }),
  }));
  const { database } = createFakeTenderRadarRunsTable(rows);
  const history = await readAgt002RadarRunReceiptHistory(database, { limit: 1000 });
  assert.equal(history.length, 10);
  assert.deepEqual(history.map(entry => entry.run_id), ['cap-12', 'cap-11', 'cap-10', 'cap-9', 'cap-8', 'cap-7', 'cap-6', 'cap-5', 'cap-4', 'cap-3']);
}

// 11b. Pedir menos de 10 se respeta (no se infla al tope).
{
  const rows = Array.from({ length: 5 }, (_, index) => ({
    id: `row-${index}`,
    run_at: new Date(Date.UTC(2026, 8, 1, index)).toISOString(),
    errors: buildAgt002RadarRunReceipt({
      runId: `row-${index}`, startedAt: STARTED, finishedAt: FINISHED,
      sources: [{ name: 'SECOP II', attempted: true, succeeded: true, pages_read: 1, records_read: 1, candidates_found: 1 }],
    }),
  }));
  const { database } = createFakeTenderRadarRunsTable(rows);
  const history = await readAgt002RadarRunReceiptHistory(database, { limit: 2 });
  assert.equal(history.length, 2);
  assert.deepEqual(history.map(entry => entry.run_id), ['row-4', 'row-3']);
}

// 12. Requiere un cliente con `.from`.
await assert.rejects(() => recordAgt002RadarRunReceipt({}, { run_id: RUN_ID }), /DATABASE_REQUIRED/);
await assert.rejects(() => readLatestAgt002RadarRunReceipt(null), /DATABASE_REQUIRED/);
await assert.rejects(() => readAgt002RadarRunReceiptHistory(undefined), /DATABASE_REQUIRED/);
await assert.rejects(() => recordAgt002RadarRunReceipt({ from: () => ({}) }, {}), /RECEIPT.*INVALID|INVALID/);

console.log('AGT-002 Radar run receipt idempotent persistence (fake database, no network) passed');
