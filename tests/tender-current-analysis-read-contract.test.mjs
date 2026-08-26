// Contrato de lectura del análisis vigente (getCurrentTenderAnalysis).
//
// Regresión del fallo E2E autenticado de AGT-002: la lectura del run vigente se cancelaba con
// `canceling statement due to statement timeout` cuando el detalle de oportunidad pedía
// /api/tender-documents y /api/tender-go-no-go-decision a la vez. Dos hechos lo causaban y
// ninguna prueba los cubría:
//
//   1. La consulta filtraba por (opportunity_id, snapshot_id) y ordenaba por
//      (created_at desc, id desc) sin que exista un índice cuya CLAVE tenga esa pareja, y la
//      rama canónica filtraba `canonical` sin declarar `status = 'completed'`, así que los dos
//      índices parciales canónicos (050 y 063, ambos `where canonical and status='completed'`)
//      eran inutilizables para el planificador.
//   2. Las dos rutas leían, concurrentemente y para la misma oportunidad, el JSONB `result`
//      completo del run — el único valor ancho de la tabla (TOAST) — aunque la superficie
//      humana sólo renderiza el de /api/tender-documents.
//
// Estas pruebas fijan el contrato indexable de la consulta, la proyección sin `result` del lado
// lectura de GO/NO-GO y la existencia idempotente del índice 073.

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { getCurrentTenderAnalysis, buildTenderSnapshotInput } from '../tender-analysis-foundation.js';
import { callTenderGoNoGoDecision, getTenderGoNoGoDecision } from '../tender-go-no-go-rpc.js';

const OPPORTUNITY_ID = '11111111-1111-4111-8111-111111111111';
const TENDER_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = '66666666-6666-4666-8666-666666666666';
const STALE_SNAPSHOT_ID = '66666666-6666-4666-8666-66666666666a';
const RUN_ID = '33333333-3333-4333-8333-33333333333a';
const ACTOR_ID = '44444444-4444-4444-8444-444444444444';
const CURRENT_DOCUMENTS = [{ id: 'doc-1', name: 'Pliego.pdf', current: true, document_type: 'pliego' }];
const CURRENT_DOCUMENT_HASH = buildTenderSnapshotInput(CURRENT_DOCUMENTS, {}).document_hash;
const RESULT = Object.freeze({ recommendation: 'GO', summary: 'Análisis vigente' });

const directorProfile = {
  id: ACTOR_ID,
  active: true,
  identity_type: 'human',
  role: 'director',
  permissions: ['licitaciones'],
  areas: [{ area_code: 'licitaciones', subarea_code: null }],
  full_name: 'Directora de Licitaciones',
};

function comparable(value) {
  return value == null ? '' : String(value);
}

/** Cliente falso que registra columnas, filtros, orden y límite de cada statement emitido. */
function recordingQuery(table, rows, statements) {
  const statement = { table, columns: null, filters: [], orders: [], limit: null };
  const materialize = () => {
    let result = rows.filter(row => statement.filters.every(([key, value]) => row?.[key] === value));
    for (const [key, options] of [...statement.orders].reverse()) {
      const direction = options?.ascending === false ? -1 : 1;
      result = [...result].sort((left, right) => comparable(left?.[key]).localeCompare(comparable(right?.[key])) * direction);
    }
    if (statement.limit != null) result = result.slice(0, statement.limit);
    // Proyección real de PostgREST: sólo las columnas pedidas viajan de vuelta.
    if (!statement.columns || statement.columns === '*') return result;
    const requested = statement.columns.split(',').map(column => column.trim());
    return result.map(row => Object.fromEntries(requested.filter(column => column in row).map(column => [column, row[column]])));
  };
  const settle = () => { statements.push(statement); return Promise.resolve({ data: materialize(), error: null }); };
  const chain = {
    select(columns) { statement.columns = columns ?? null; return chain; },
    eq(key, value) { statement.filters.push([key, value]); return chain; },
    order(key, options) { statement.orders.push([key, options]); return chain; },
    limit(value) { statement.limit = value; return settle(); },
    maybeSingle() { return settle().then(({ data }) => ({ data: data[0] || null, error: null })); },
    single() { return settle().then(({ data }) => ({ data: data[0] || null, error: null })); },
    then(resolve, reject) { return settle().then(resolve, reject); },
  };
  return chain;
}

function analysisDatabase({ runs, currentSnapshotId = SNAPSHOT_ID, refreshInProgress = false } = {}) {
  const statements = [];
  const tables = {
    psi_tender_document_state: [{ opportunity_id: OPPORTUNITY_ID, current_snapshot_id: currentSnapshotId, refresh_in_progress: refreshInProgress }],
    psi_tender_document_snapshots: [
      { id: SNAPSHOT_ID, opportunity_id: OPPORTUNITY_ID, document_hash: CURRENT_DOCUMENT_HASH },
      { id: STALE_SNAPSHOT_ID, opportunity_id: OPPORTUNITY_ID, document_hash: '0'.repeat(64) },
    ],
    psi_tender_analysis_runs: runs,
  };
  return {
    statements,
    from(table) {
      if (!(table in tables)) throw new Error(`unexpected table ${table}`);
      return recordingQuery(table, tables[table], statements);
    },
  };
}

const CANONICAL_RUN = {
  id: RUN_ID, opportunity_id: OPPORTUNITY_ID, snapshot_id: SNAPSHOT_ID,
  producer: 'AGT-002', method: 'agent_ai', status: 'completed', canonical: true,
  result: RESULT, critical_open_count: 2,
  created_at: '2026-08-25T10:00:00.000Z', completed_at: '2026-08-25T10:05:00.000Z',
};
const RULES_RUN = {
  id: '33333333-3333-4333-8333-33333333333b', opportunity_id: OPPORTUNITY_ID, snapshot_id: SNAPSHOT_ID,
  producer: 'siio_rules_v1', method: 'rules', status: 'completed', canonical: false,
  result: { recommendation: 'rules' }, critical_open_count: 0,
  created_at: '2026-08-24T10:00:00.000Z', completed_at: '2026-08-24T10:01:00.000Z',
};

const runStatement = statements => statements.find(statement => statement.table === 'psi_tender_analysis_runs');
const runStatements = statements => statements.filter(statement => statement.table === 'psi_tender_analysis_runs');
const columnsOf = statement => statement.columns.split(',').map(column => column.trim());

// 1. La lectura no canónica declara exactamente las igualdades que un índice puede servir.
{
  const database = analysisDatabase({ runs: [RULES_RUN] });
  const current = await getCurrentTenderAnalysis(database, OPPORTUNITY_ID);
  const statement = runStatement(database.statements);
  assert.deepEqual(statement.filters, [['opportunity_id', OPPORTUNITY_ID], ['snapshot_id', SNAPSHOT_ID]]);
  assert.deepEqual(statement.orders, [['created_at', { ascending: false }], ['id', { ascending: false }]]);
  assert.equal(statement.limit, 1, 'la lectura del run vigente nunca puede traer más de una fila');
  assert.equal(current.run_id, RULES_RUN.id);
  assert.deepEqual(current.result, RULES_RUN.result);
}

// 2. Sin run para el snapshot vigente, el respaldo añade exactamente un statement acotado por
//    opportunity_id — nunca una consulta sin filtro.
{
  const database = analysisDatabase({ runs: [{ ...RULES_RUN, snapshot_id: STALE_SNAPSHOT_ID }] });
  const current = await getCurrentTenderAnalysis(database, OPPORTUNITY_ID);
  const statements = runStatements(database.statements);
  assert.equal(statements.length, 2, 'el respaldo es un único statement adicional');
  assert.deepEqual(statements[1].filters, [['opportunity_id', OPPORTUNITY_ID]]);
  assert.deepEqual(statements[1].orders, [['created_at', { ascending: false }], ['id', { ascending: false }]]);
  assert.equal(statements[1].limit, 1);
  assert.equal(current.current, false, 'un run de snapshot histórico sigue visible pero nunca vigente');
}

// 3. La rama canónica declara `status = 'completed'` junto a `canonical`. No restringe nada
//    (050 psi_tender_analysis_runs_canonical_agt002_check ya lo garantiza) pero es lo único que
//    hace usables los índices parciales canónicos de 050 y 063.
{
  const database = analysisDatabase({ runs: [RULES_RUN, CANONICAL_RUN] });
  const current = await getCurrentTenderAnalysis(database, OPPORTUNITY_ID, null, { canonicalOnly: true });
  const statements = runStatements(database.statements);
  assert.equal(statements.length, 1, 'la lectura canónica nunca cae a un respaldo sin filtro canónico');
  assert.deepEqual(statements[0].filters, [
    ['opportunity_id', OPPORTUNITY_ID],
    ['canonical', true],
    ['status', 'completed'],
    ['snapshot_id', SNAPSHOT_ID],
  ]);
  assert.equal(current.run_id, RUN_ID, 'la corrida canónica gana sobre un run de reglas más nuevo');
  assert.equal(current.canonical, true);
}

// 4. `includeResult: false` no pide la columna ancha y devuelve la MISMA procedencia tipada.
{
  const full = analysisDatabase({ runs: [CANONICAL_RUN] });
  const projected = analysisDatabase({ runs: [CANONICAL_RUN] });
  const withResult = await getCurrentTenderAnalysis(full, OPPORTUNITY_ID, CURRENT_DOCUMENTS, { canonicalOnly: true });
  const withoutResult = await getCurrentTenderAnalysis(projected, OPPORTUNITY_ID, CURRENT_DOCUMENTS, { canonicalOnly: true, includeResult: false });

  assert.ok(columnsOf(runStatement(full.statements)).includes('result'), 'por defecto la lectura sigue trayendo el resultado completo');
  assert.equal(columnsOf(runStatement(projected.statements)).includes('result'), false, 'la lectura proyectada nunca pide el JSONB ancho');
  assert.ok(columnsOf(runStatement(projected.statements)).includes('canonical'), 'la proyección conserva la marca canónica tipada');

  assert.deepEqual(withResult.result, RESULT);
  assert.equal(withoutResult.result, null, 'sin resultado pedido, el resultado presentado es null, nunca un objeto parcial');
  for (const key of ['run_id', 'opportunity_id', 'snapshot_id', 'producer', 'method', 'status', 'canonical', 'current', 'critical_open_count', 'created_at', 'completed_at']) {
    assert.deepEqual(withoutResult[key], withResult[key], `la proyección debe conservar ${key} intacto`);
  }
  assert.equal(withoutResult.current, true, 'la vigencia se sigue calculando contra el hash documental real');
}

// 5. Un refresco documental en curso sigue marcando no vigente también en la proyección.
{
  const database = analysisDatabase({ runs: [CANONICAL_RUN], refreshInProgress: true });
  const current = await getCurrentTenderAnalysis(database, OPPORTUNITY_ID, null, { canonicalOnly: true, includeResult: false });
  assert.equal(current.current, false, 'la proyección no puede relajar el gate de refresco en curso');
}

// ---------------------------------------------------------------------------------------------
// Lado GO/NO-GO: la lectura no duplica el JSONB ancho; la decisión sí lo conserva.
// ---------------------------------------------------------------------------------------------

function goNoGoDatabase() {
  const statements = [];
  const rpc = [];
  const tables = {
    v_psi_sales_opportunity_enriched: [{ id: OPPORTUNITY_ID, company_name: 'Entidad pública', service_type_code: 'licitacion_publica', expected_close_date: '2026-09-01', offer_value: 1000 }],
    psi_public_tenders: [{ id: TENDER_ID, converted_opportunity_id: OPPORTUNITY_ID }],
    psi_sales_interactions: [{
      id: '55555555-5555-4555-8555-555555555555',
      opportunity_id: OPPORTUNITY_ID,
      interaction_type: 'documento',
      notes: JSON.stringify({ kind: 'tender_document_upload', documents: CURRENT_DOCUMENTS }),
      created_at: '2026-08-01T00:00:00.000Z',
      occurred_at: '2026-08-01T00:00:00.000Z',
    }],
    psi_tender_document_versions: [],
    psi_tender_go_no_go_decisions: [],
    psi_tender_document_state: [{ opportunity_id: OPPORTUNITY_ID, current_snapshot_id: SNAPSHOT_ID, refresh_in_progress: false }],
    psi_tender_document_snapshots: [{ id: SNAPSHOT_ID, opportunity_id: OPPORTUNITY_ID, document_hash: CURRENT_DOCUMENT_HASH }],
    psi_tender_analysis_runs: [{ ...CANONICAL_RUN, producer: 'siio_rules_v1', method: 'rules', canonical: false }],
  };
  const database = {
    from(table) {
      if (!(table in tables)) throw new Error(`unexpected table ${table}`);
      return recordingQuery(table, tables[table], statements);
    },
    async rpc(name, args) {
      rpc.push({ name, args });
      return { data: { decision_id: '77777777-7777-4777-8777-777777777777', decision: args.p_decision, preparation_id: '77777777-7777-4777-8777-777777777778', preparation_created: true, tender_offer_status: 'en_preparacion' }, error: null };
    },
  };
  return { database, statements, rpc };
}

// 6. GET /api/tender-go-no-go-decision conserva la procedencia tipada del análisis y deja de
//    duplicar la lectura del resultado completo que sólo renderiza /api/tender-documents.
{
  const { database, statements } = goNoGoDatabase();
  const payload = await getTenderGoNoGoDecision(database, OPPORTUNITY_ID, directorProfile);
  const statement = runStatement(statements);
  assert.ok(statement, 'la lectura formal sigue resolviendo el análisis vigente');
  assert.equal(columnsOf(statement).includes('result'), false, 'el lado lectura de GO/NO-GO nunca pide el JSONB ancho del run');
  assert.equal(payload.analysis.run_id, RUN_ID, 'la procedencia tipada del análisis sigue disponible');
  assert.equal(payload.analysis.current, true);
  assert.equal(payload.analysis.result, null);
}

// 7. POST /api/tender-go-no-go-decision sigue leyendo el resultado completo: la preparación de
//    oferta se construye a partir de él y ningún gate puede perder información.
{
  const { database, statements, rpc } = goNoGoDatabase();
  await callTenderGoNoGoDecision(database, {
    opportunity_id: OPPORTUNITY_ID,
    decision: 'go',
    analysis_run_id: RUN_ID,
    justification: 'Capacidad y margen aprobados',
  }, directorProfile);
  const statement = runStatement(statements);
  assert.ok(columnsOf(statement).includes('result'), 'la decisión humana sigue viendo el resultado completo del run vigente');
  assert.equal(rpc.length, 1);
  assert.equal(rpc[0].args.p_analysis_run_id, RUN_ID, 'la decisión sigue anclando el run vigente');
  assert.ok(rpc[0].args.p_preparation, 'GO sigue construyendo la preparación desde el análisis vigente');
}

// ---------------------------------------------------------------------------------------------
// Contrato de esquema: cada igualdad de la lectura debe poder servirse por un índice real.
// ---------------------------------------------------------------------------------------------

const migrationsDirectory = new URL('../supabase/migrations/', import.meta.url);
const INDEX_PATTERN = /create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?(\w+)\s+on\s+public\.psi_tender_analysis_runs\s*\(([^)]*)\)\s*(?:where\s+([^;]+?))?\s*;/gi;

const runIndexes = readdirSync(migrationsDirectory).filter(name => name.endsWith('.sql')).sort().flatMap(name => {
  const sql = readFileSync(new URL(name, migrationsDirectory), 'utf8');
  return [...sql.matchAll(INDEX_PATTERN)].map(match => ({
    migration: name,
    name: match[1],
    columns: match[2].split(',').map(column => column.trim().replace(/\s+/g, ' ').toLowerCase()),
    predicate: (match[3] || '').trim().replace(/\s+/g, ' ').toLowerCase() || null,
  }));
});

/** Un índice sirve la forma si su predicado parcial es implicado por las igualdades declaradas y
 *  su clave empieza exactamente por esas igualdades seguidas del desempate del ORDER BY. */
function servesShape({ equalityColumns, impliedPredicates }) {
  return runIndexes.some(index => {
    const predicateTerms = index.predicate ? index.predicate.split(' and ').map(term => term.trim()) : [];
    if (!predicateTerms.every(term => impliedPredicates.has(term))) return false;
    const prefix = index.columns.slice(0, equalityColumns.length).join(',');
    if (prefix !== equalityColumns.join(',')) return false;
    return index.columns.slice(equalityColumns.length, equalityColumns.length + 2).join(',') === 'created_at desc,id desc';
  });
}

assert.ok(
  servesShape({ equalityColumns: ['opportunity_id', 'snapshot_id'], impliedPredicates: new Set() }),
  'la lectura por (opportunity_id, snapshot_id) exige un índice cuya clave sea exactamente esa pareja más (created_at desc, id desc) — sin él el planificador recheck-ea fila por fila y el statement agota statement_timeout',
);
assert.ok(
  servesShape({ equalityColumns: ['opportunity_id'], impliedPredicates: new Set() }),
  'el respaldo por opportunity_id exige su propio índice ordenado',
);
assert.ok(
  servesShape({ equalityColumns: ['opportunity_id'], impliedPredicates: new Set(['canonical', "status = 'completed'"]) }),
  'la rama canónica exige un índice parcial cuyo predicado quede implicado por las igualdades declaradas',
);

// El índice de 073 es idempotente y su rollback lo suelta sin tocar filas.
{
  const migration = readFileSync(new URL('073_agt002_current_analysis_read_index.sql', migrationsDirectory), 'utf8');
  assert.match(migration, /create index if not exists psi_tender_analysis_runs_opportunity_snapshot_current_idx/i, '073 debe ser idempotente');
  assert.doesNotMatch(migration, /\b(drop|alter|update|delete|insert|truncate)\b/i, '073 es estrictamente aditiva: nunca altera ni toca datos');
  const rollback = readFileSync(new URL('../rollbacks/073_agt002_current_analysis_read_index_rollback.sql', migrationsDirectory), 'utf8');
  assert.match(rollback, /drop index if exists public\.psi_tender_analysis_runs_opportunity_snapshot_current_idx/i, 'el rollback de 073 debe ser idempotente');
}

// La fuente conserva las dos igualdades canónicas juntas: separarlas vuelve a inutilizar 050/063.
{
  const source = readFileSync(new URL('../tender-analysis-foundation.js', import.meta.url), 'utf8');
  assert.match(source, /if \(canonicalOnly\) query = query\.eq\('canonical', true\)\.eq\('status', 'completed'\)/, 'la rama canónica debe declarar canonical y status juntos');
  assert.doesNotMatch(source, /\.select\(`id,snapshot_id,producer,method,status,result/, 'la lista de columnas no puede volver a pedir `result` incondicionalmente');
}

// El lado lectura de GO/NO-GO no puede volver a pedir el resultado completo.
{
  const source = readFileSync(new URL('../tender-go-no-go-rpc.js', import.meta.url), 'utf8');
  const read = source.match(/export async function getTenderGoNoGoDecision[\s\S]*?\n}/)[0];
  assert.match(read, /getCurrentTenderAnalysis\(database, id, records\.documents, \{ includeResult: false \}\)/, 'el GET formal debe proyectar la lectura sin el JSONB ancho');
  const decide = source.match(/export async function callTenderGoNoGoDecision[\s\S]*?\n}/)[0];
  assert.doesNotMatch(decide, /includeResult: false/, 'la decisión humana nunca puede perder el resultado del análisis vigente');
}

console.log('tender current analysis read contract passed');
