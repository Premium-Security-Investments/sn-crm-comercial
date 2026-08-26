import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { projectAgt002RadarLearningObservations } from '../agt002-radar-learning-projection.js';
import { runAgt002RadarLearningSignalsReport } from '../scripts/agt002-radar-learning-signals-report.mjs';
import { runAgt002RadarPreanalysisDryRun } from '../scripts/agt002-radar-preanalysis-dryrun.mjs';

// Producción no expone la relación autorreferente `psi_tender_go_no_go_decisions_supersedes_fkey`:
// cualquier embed que la nombre responde HTTP 400 PGRST200. Los dobles de abajo reproducen esa forma
// —columnas planas reales, sin resolución de FK autorreferente— para que la regresión falle aquí
// antes de volver a fallar en el reporte y el dry-run de sólo lectura.
const SELF_REFERENTIAL_EMBED = /superseded_by:|_fkey|!left\(/;

function tenderRow(id, overrides = {}) {
  return {
    id,
    stable_key: `stable-${id}`,
    title: 'Servicio de vigilancia armada',
    description: 'Guardas de seguridad',
    entity: 'Entidad Pública',
    entity_nit: '900123456',
    city: 'Bogotá',
    dept: 'Cundinamarca',
    source: 'SECOP II',
    category: 'Licitación pública',
    status: 'convocado',
    deadline_at: '2026-12-31',
    last_seen_at: '2026-08-25T00:00:00Z',
    internal_status: null,
    ...overrides,
  };
}

function decisionRow(id, tenderId, decision, decidedAt, supersedesDecisionId = null) {
  return {
    id,
    opportunity_id: null,
    tender_id: tenderId,
    decision,
    analysis_interaction_id: null,
    justification: 'Registro humano',
    decided_by: 'humano',
    decided_at: decidedAt,
    supersedes_decision_id: supersedesDecisionId,
    created_at: decidedAt,
    analysis_run_id: null,
  };
}

function compare(rows, order) {
  return rows.slice().sort((left, right) => {
    for (const [column, ascending] of order) {
      const a = String(left[column] ?? '');
      const b = String(right[column] ?? '');
      if (a !== b) return (a < b ? -1 : 1) * (ascending ? 1 : -1);
    }
    return 0;
  });
}

function project(rows, fields, tables) {
  const embedded = /psi_public_tenders\(([^)]*)\)/.exec(fields);
  const flat = fields.replace(/psi_public_tenders\([^)]*\)/, '').split(',').map(part => part.trim()).filter(Boolean);
  const tenders = new Map((tables.psi_public_tenders || []).map(row => [String(row.id), row]));
  return rows.map(row => {
    const projected = Object.fromEntries(flat.map(column => [column, row[column] ?? null]));
    if (embedded) {
      const tender = tenders.get(String(row.tender_id ?? ''));
      const columns = embedded[1].split(',').map(part => part.trim()).filter(Boolean);
      projected.psi_public_tenders = tender ? Object.fromEntries(columns.map(column => [column, tender[column] ?? null])) : null;
    }
    return projected;
  });
}

// Doble del cliente supabase-js: sólo filtros planos, sin catálogo de relaciones.
function createFlatDatabase(tables) {
  const queries = [];
  return {
    queries,
    from(table) {
      const state = { table, fields: '*', eq: [], in: [], is: [], order: [] };
      const query = {
        select(fields) { state.fields = fields; return query; },
        eq(column, value) { state.eq.push([column, value]); return query; },
        in(column, values) { state.in.push([column, [...values]]); return query; },
        is(column, value) { state.is.push([column, value]); return query; },
        order(column, { ascending = true } = {}) { state.order.push([column, ascending]); return query; },
        limit(value) {
          state.limit = value;
          queries.push(state);
          if (SELF_REFERENTIAL_EMBED.test(state.fields) || state.is.some(([column]) => SELF_REFERENTIAL_EMBED.test(column) || column === 'superseded_by')) {
            const error = new Error("Could not find a relationship between 'psi_tender_go_no_go_decisions' and 'psi_tender_go_no_go_decisions' in the schema cache");
            error.code = 'PGRST200';
            return Promise.resolve({ data: null, error });
          }
          let rows = (tables[table] || []).slice();
          for (const [column, value] of state.eq) rows = rows.filter(row => String(row[column] ?? '') === String(value));
          for (const [column, values] of state.in) {
            const wanted = new Set(values.map(String));
            rows = rows.filter(row => wanted.has(String(row[column] ?? '')));
          }
          rows = compare(rows, state.order).slice(0, state.limit);
          return Promise.resolve({ data: project(rows, state.fields, tables), error: null });
        },
      };
      return query;
    },
  };
}

function decisionQueries(database) {
  return database.queries.filter(query => query.table === 'psi_tender_go_no_go_decisions');
}

function humanDecisionIds(projected) {
  return projected.precedents
    .filter(item => item.observation_id.startsWith('human_decision:'))
    .map(item => item.observation_id.slice('human_decision:'.length));
}

// 1. El doble es fiel: la consulta que rompió producción sigue fallando contra él.
{
  const database = createFlatDatabase({ psi_tender_go_no_go_decisions: [] });
  const legacy = await database.from('psi_tender_go_no_go_decisions')
    .select(`id,tender_id,decision,decided_at,superseded_by:psi_tender_go_no_go_decisions!psi_tender_go_no_go_decisions_supersedes_fkey!left(id)`)
    .limit(10);
  assert.equal(legacy.error?.code, 'PGRST200', 'el doble reproduce el fallo de esquema de producción');
  assert.equal(legacy.data, null);
}

// 2. Cadenas de supersesión dentro del lote: sólo sobrevive la hoja.
{
  const tables = {
    psi_public_tenders: [tenderRow('t-chain')],
    psi_tender_go_no_go_decisions: [
      decisionRow('d-1', 't-chain', 'go', '2026-08-01T00:00:00Z', null),
      decisionRow('d-2', 't-chain', 'no_go', '2026-08-02T00:00:00Z', 'd-1'),
      decisionRow('d-3', 't-chain', 'go', '2026-08-03T00:00:00Z', 'd-2'),
    ],
  };
  const database = createFlatDatabase(tables);
  const projected = await projectAgt002RadarLearningObservations(database, { limit: 1000 });
  assert.deepEqual(humanDecisionIds(projected), ['d-3'], 'la cadena A←B←C colapsa a su hoja');
  const leaf = projected.precedents.find(item => item.observation_id === 'human_decision:d-3');
  assert.equal(leaf.signal_polarity, 'favorable');
  assert.equal(leaf.tender_id, 't-chain');
  assert.equal(leaf.decided_at, '2026-08-03T00:00:00.000Z');
  assert.deepEqual(leaf.evidence, [{ record_id: 'd-3', evidence_type: 'human_decision' }], 'la evidencia sigue citando el registro humano');
  assert.equal(database.queries.every(query => !SELF_REFERENTIAL_EMBED.test(query.fields)), true);
}

// 3. El sucesor quedó fuera del lote (corrección retrofechada): el predecesor NO puede quedar vigente.
{
  const tables = {
    psi_public_tenders: [tenderRow('t-a'), tenderRow('t-b')],
    psi_tender_go_no_go_decisions: [
      decisionRow('d-a', 't-a', 'go', '2026-08-09T00:00:00Z', null),
      decisionRow('d-b', 't-b', 'go', '2026-08-08T00:00:00Z', null),
      decisionRow('d-c', 't-b', 'no_go', '2026-08-01T00:00:00Z', 'd-b'),
    ],
  };
  const database = createFlatDatabase(tables);
  const projected = await projectAgt002RadarLearningObservations(database, { limit: 2 });

  const batch = decisionQueries(database)[0];
  assert.deepEqual(batch.order, [['decided_at', false], ['id', false]], 'el lote principal ordena antes de limitar');
  assert.equal(batch.limit, 2);
  assert.ok(batch.fields.includes('supersedes_decision_id'), 'la columna plana viaja en el select');

  const lookup = decisionQueries(database).slice(1);
  assert.equal(lookup.length, 1, 'una sola consulta acotada resuelve la arista inversa del lote');
  assert.deepEqual(lookup[0].in, [['supersedes_decision_id', ['d-a', 'd-b']]], 'la búsqueda se acota a los candidatos, no a la tabla completa');
  assert.deepEqual(humanDecisionIds(projected), ['d-a'], 'd-b está supersedido por una fila fuera del lote y no se proyecta');
}

// 4. Varias hojas vigentes para el mismo tender: se conserva la más reciente, con desempate por id.
{
  const tables = {
    psi_public_tenders: [tenderRow('t-leaves')],
    psi_tender_go_no_go_decisions: [
      decisionRow('d-old', 't-leaves', 'no_go', '2026-08-01T00:00:00Z', null),
      decisionRow('d-new-a', 't-leaves', 'go', '2026-08-05T00:00:00Z', null),
      decisionRow('d-new-b', 't-leaves', 'no_go', '2026-08-05T00:00:00Z', null),
    ],
  };
  const projected = await projectAgt002RadarLearningObservations(createFlatDatabase(tables), { limit: 1000 });
  assert.deepEqual(humanDecisionIds(projected), ['d-new-b'], 'gana la decisión más reciente y el id mayor desempata');
  assert.equal(projected.precedents.find(item => item.observation_id === 'human_decision:d-new-b').signal_polarity, 'desfavorable');
}

// 5. Determinismo: el orden del arreglo de entrada no cambia la proyección.
{
  const rows = [
    decisionRow('d-x', 't-x', 'go', '2026-08-04T00:00:00Z', null),
    decisionRow('d-y', 't-y', 'no_go', '2026-08-03T00:00:00Z', null),
    decisionRow('d-z', 't-y', 'go', '2026-08-06T00:00:00Z', 'd-y'),
  ];
  const tenders = [tenderRow('t-x'), tenderRow('t-y')];
  const first = await projectAgt002RadarLearningObservations(
    createFlatDatabase({ psi_public_tenders: tenders, psi_tender_go_no_go_decisions: rows }), { limit: 1000 });
  const second = await projectAgt002RadarLearningObservations(
    createFlatDatabase({ psi_public_tenders: tenders.slice().reverse(), psi_tender_go_no_go_decisions: rows.slice().reverse() }), { limit: 1000 });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(humanDecisionIds(first), ['d-x', 'd-z']);
}

// 6. Un único `limit` no basta para la arista inversa: un lote saturado por un predecesor muy sucedido
//    debe subdividirse hasta que ningún identificador quede escondido detrás del truncamiento.
{
  const tenders = [];
  const decisions = [];
  for (let index = 0; index < 120; index += 1) {
    const suffix = String(index).padStart(3, '0');
    tenders.push(tenderRow(`t-${suffix}`));
    decisions.push(decisionRow(`d-${suffix}`, `t-${suffix}`, 'go', '2026-08-20T00:00:00Z', null));
  }
  for (let index = 0; index < 500; index += 1) {
    decisions.push(decisionRow(`s-${String(index).padStart(3, '0')}`, 't-000', 'no_go', '2026-08-01T00:00:00Z', 'd-000'));
  }
  decisions.push(decisionRow('s-tail', 't-119', 'no_go', '2026-08-01T00:00:00Z', 'd-119'));

  const database = createFlatDatabase({ psi_public_tenders: tenders, psi_tender_go_no_go_decisions: decisions });
  const projected = await projectAgt002RadarLearningObservations(database, { limit: 120 });
  const current = humanDecisionIds(projected);

  assert.equal(decisionQueries(database)[0].limit, 120);
  assert.ok(decisionQueries(database).length > 3, 'el lote saturado se subdividió en lugar de perder identificadores');
  assert.equal(current.includes('d-000'), false, '500 sucesores no pueden esconder al predecesor saturando el lote');
  assert.equal(current.includes('d-119'), false, 'el trozo vecino resuelve su propia arista inversa');
  assert.equal(current.length, 118);
  assert.deepEqual(current.slice(0, 2), ['d-001', 'd-002']);
  assert.equal(new Set(current).size, current.length, 'sin observaciones duplicadas');
}

// 7. Sin decisiones candidatas no se emite ninguna consulta extra.
{
  const database = createFlatDatabase({ psi_public_tenders: [tenderRow('t-empty')], psi_tender_go_no_go_decisions: [] });
  const projected = await projectAgt002RadarLearningObservations(database, { limit: 50 });
  assert.deepEqual(humanDecisionIds(projected), []);
  assert.equal(decisionQueries(database).length, 1, 'la arista inversa no se consulta si no hay candidatos');
}

// --- Reporte y dry-run de sólo lectura contra un PostgREST emulado ---

function jsonResponse(status, body) {
  return { ok: status < 400, status, json: async () => body };
}

function createPostgrestFetch(tables) {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    const table = decodeURIComponent(parsed.pathname.split('/rest/v1/')[1] || '');
    const fields = parsed.searchParams.get('select') || '*';
    requests.push({ table, fields, method: init.method || 'GET', search: parsed.search });
    if (SELF_REFERENTIAL_EMBED.test(fields)) {
      return jsonResponse(400, { code: 'PGRST200', message: "Could not find a relationship in the schema cache", details: null, hint: null });
    }
    let rows = (tables[table] || []).slice();
    for (const [key, value] of parsed.searchParams) {
      if (['select', 'limit', 'order', 'offset'].includes(key)) continue;
      if (value.startsWith('eq.')) rows = rows.filter(row => String(row[key] ?? '') === value.slice(3));
      else if (value.startsWith('in.(')) {
        const wanted = new Set(value.slice(4, -1).split(',').filter(Boolean));
        rows = rows.filter(row => wanted.has(String(row[key] ?? '')));
      } else if (value === 'is.null') rows = rows.filter(row => row[key] === null || row[key] === undefined);
      else return jsonResponse(400, { code: 'PGRST100', message: `unsupported filter ${key}=${value}` });
    }
    const order = parsed.searchParams.get('order');
    const parsedOrder = order ? order.split(',').map(part => { const [column, direction] = part.split('.'); return [column, direction !== 'desc']; }) : [];
    rows = compare(rows, parsedOrder).slice(0, Number(parsed.searchParams.get('limit') || rows.length));
    return jsonResponse(200, fields === '*' ? rows : project(rows, fields, tables));
  };
  return { requests, fetchImpl };
}

const restTables = {
  psi_public_tenders: [
    tenderRow('t-rest-1'),
    tenderRow('t-rest-2', { title: 'Servicio de vigilancia con CCTV', internal_status: 'convertida_oportunidad', updated_at: '2026-08-10T00:00:00Z' }),
  ],
  psi_tender_analysis_runs: [],
  psi_tender_offer_status_transitions: [],
  psi_tender_go_no_go_decisions: [
    decisionRow('rest-d-1', 't-rest-2', 'go', '2026-08-02T00:00:00Z', null),
    decisionRow('rest-d-2', 't-rest-2', 'no_go', '2026-08-06T00:00:00Z', 'rest-d-1'),
  ],
};

// 8. El emulador REST reproduce el 400 PGRST200 de producción para el embed autorreferente.
{
  const { fetchImpl } = createPostgrestFetch(restTables);
  const broken = await fetchImpl(`https://example.supabase.co/rest/v1/psi_tender_go_no_go_decisions?select=${encodeURIComponent('id,superseded_by:psi_tender_go_no_go_decisions!psi_tender_go_no_go_decisions_supersedes_fkey!left(id)')}&limit=1`);
  assert.equal(broken.ok, false);
  assert.equal(broken.status, 400);
  assert.equal((await broken.json()).code, 'PGRST200');
}

// 9. El reporte de señales ya no falla por esa consulta y sigue siendo un reporte no persistido.
{
  const { requests, fetchImpl } = createPostgrestFetch(restTables);
  const report = await runAgt002RadarLearningSignalsReport({
    baseUrl: 'https://example.supabase.co',
    serviceKey: 'service-role-key',
    limit: 100,
    candidateLimit: 5,
    maxSignals: 3,
    generatedAt: '2026-08-26T12:00:00Z',
    fetchImpl,
  });
  assert.equal(report.mode, 'read_only_report');
  assert.equal(report.persisted, false);
  assert.ok(report.observation_count >= 1);
  assert.equal(report.candidate_signals.length, 2);
  assert.ok(requests.some(request => request.table === 'psi_tender_go_no_go_decisions' && request.fields.includes('supersedes_decision_id')));
  assert.equal(requests.every(request => request.method === 'GET'), true, 'el reporte sólo emite lecturas');
  assert.equal(requests.some(request => SELF_REFERENTIAL_EMBED.test(request.fields)), false);
  assert.equal(report.governance_proposal.status, 'DRAFT');
  assert.equal(report.governance_proposal.human_approval_required, true);
  assert.ok(report.governance_proposal.evidence_record_ids.includes('rest-d-2'), 'la decisión vigente conserva su procedencia citable');
  assert.equal(report.governance_proposal.evidence_record_ids.includes('rest-d-1'), false, 'la decisión supersedida no aporta evidencia');
}

// 10. El dry-run de preanálisis tampoco falla por la proyección y no persiste nada.
{
  const { requests, fetchImpl } = createPostgrestFetch(restTables);
  const calls = [];
  const dryRun = await runAgt002RadarPreanalysisDryRun({
    tenderId: 't-rest-1',
    baseUrl: 'https://example.supabase.co',
    serviceKey: 'service-role-key',
    environment: {},
    nowIso: '2026-08-26T12:00:00Z',
    fetchImpl,
    createRuntime: () => ({
      async runOnce(input) { calls.push(input); return { visibility_verdict: 'mostrar_en_radar', evidence: [] }; },
    }),
  });
  assert.equal(dryRun.mode, 'read_only_dry_run');
  assert.equal(dryRun.persisted, false);
  assert.equal(dryRun.tender_id, 't-rest-1');
  assert.equal(calls.length, 1);
  assert.equal(requests.every(request => request.method === 'GET'), true, 'el dry-run sólo emite lecturas');
  assert.equal(requests.some(request => SELF_REFERENTIAL_EMBED.test(request.fields)), false);
  assert.ok(requests.some(request => request.table === 'psi_tender_go_no_go_decisions' && request.search.includes('supersedes_decision_id=in.')));
}

// 11. La proyección sigue siendo estrictamente de sólo lectura.
{
  const source = readFileSync(new URL('../agt002-radar-learning-projection.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\.(insert|update|upsert|delete)\s*\(/);
  assert.doesNotMatch(source, /\.rpc\s*\(/);
  assert.doesNotMatch(source, /method:\s*'(POST|PATCH|PUT|DELETE)'/);
  assert.doesNotMatch(source, SELF_REFERENTIAL_EMBED);
}

console.log('AGT-002 radar learning projection supersession without self-referential FK passed');
