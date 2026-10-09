// AGT-002 — prueba de COMPORTAMIENTO del Radar diario (--daily = persistTenderRadar con { deep: true }) contra una base
// falsa que registra cada escritura (decisiones del dueño 2026-10-08 y 2026-10-09): el Radar diario sólo descubre
// licitaciones nuevas. Nunca escribe en una licitación convertida en oportunidad, activa o no (ni en su oportunidad, ni
// marcas, ni avisos), aunque SECOP devuelva su proceso o una versión nueva; sí sigue guardando las filas normales.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';
process.env.VERCEL = '1';
const servers = [['server', await import('../server/index.js')], ['api', await import('../api/[...path].js')]];

const NOW_MS = Date.now();
const day = offset => new Date(NOW_MS + offset * 86_400_000).toISOString().slice(0, 10);
const notice = id => `https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.${id}`;

function secopRow({ id, ref, entity, phase = 'Presentación de oferta', notice: noticeId }) {
  return {
    entidad: entity, departamento_entidad: 'Caldas', ciudad_entidad: 'Manizales', id_del_proceso: id, referencia_del_proceso: ref,
    nombre_del_procedimiento: 'Prestación del servicio de vigilancia y seguridad privada', descripci_n_del_procedimiento: 'Servicio de vigilancia y seguridad privada con armas y medios tecnológicos',
    fase: phase, estado_del_procedimiento: 'Publicado', fecha_de_publicacion_del: `${day(-2)}T00:00:00.000`, fecha_de_recepcion_de: `${day(20)}T00:00:00.000`,
    precio_base: '1500000000', codigo_principal_de_categoria: 'V1.92121500', urlproceso: { url: notice(noticeId) },
    modalidad_de_contratacion: 'Licitación pública', fecha_de_ultima_publicaci: `${day(-2)}T00:00:00.000`,
  };
}

// SECOP devuelve: una licitación nueva normal, el proceso de la convertida ACTIVA (y su fase de oferta) y el de la NO GO.
const SECOP_ROWS = [
  secopRow({ id: 'CO1.REQ.100', ref: 'LP-100-2026', entity: 'ALCALDIA DE PRUEBA NUEVA', notice: '100' }),
  secopRow({ id: 'CO1.REQ.200', ref: 'LP-200-2026', entity: 'ALCALDIA ACTIVA', notice: '200', phase: 'Presentación de observaciones' }),
  secopRow({ id: 'CO1.REQ.201', ref: 'LP-200-2026 (Presentación de oferta)', entity: 'ALCALDIA ACTIVA', notice: '201' }),
  secopRow({ id: 'CO1.REQ.300', ref: 'LP-300-2026', entity: 'ALCALDIA NO GO', notice: '300', phase: 'Presentación de observaciones' }),
  secopRow({ id: 'CO1.REQ.301', ref: 'LP-300-2026 (Presentación de oferta)', entity: 'ALCALDIA NO GO', notice: '301' }),
];

function convertedRow({ id, key, processId, ref, entity, noticeId, opportunityId }) {
  return {
    id, stable_key: key, source: 'SECOP II', entity, ref, process_id: processId, title: 'Vigilancia', url: notice(noticeId),
    status: 'Presentación de observaciones', deadline_at: `${day(10)}T00:00:00+00:00`, internal_status: 'convertida_oportunidad',
    converted_opportunity_id: opportunityId, section: 'hacer', raw: { original: true },
  };
}

function recordingDb(tables) {
  const writes = [];
  const db = {
    writes,
    rpc: async (name, args) => { writes.push({ table: `rpc:${name}`, op: 'rpc', args }); return { data: null, error: null }; },
    from(table) {
      const filters = [];
      let write = null;
      const rows = () => (tables[table] || []).filter(row => filters.every(filter => filter(row)));
      const chain = {
        select() { return chain; },
        eq(column, value) { filters.push(row => row[column] === value); if (write) write.filters.push(['eq', column, value]); return chain; },
        neq(column, value) { filters.push(row => row[column] !== value); if (write) write.filters.push(['neq', column, value]); return chain; },
        in(column, values) { filters.push(row => values.includes(row[column])); return chain; },
        is(column, value) { filters.push(row => (row[column] ?? null) === value); return chain; },
        gte() { return chain; }, lte() { return chain; }, gt() { return chain; }, lt() { return chain; }, not() { return chain; }, or() { return chain; },
        order() { return chain; }, limit() { return chain; }, range() { return chain; },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        single: async () => ({ data: rows()[0] ?? null, error: null }),
        update(values) { write = { table, op: 'update', values, filters: [] }; writes.push(write); return chain; },
        upsert(values) { write = { table, op: 'upsert', values, filters: [] }; writes.push(write); return chain; },
        insert(values) { write = { table, op: 'insert', values, filters: [] }; writes.push(write); return chain; },
        delete() { write = { table, op: 'delete', filters: [] }; writes.push(write); return chain; },
        then(resolve, reject) { return Promise.resolve({ data: write ? null : rows(), error: null }).then(resolve, reject); },
      };
      return chain;
    },
  };
  return db;
}

function stubFetch() {
  const original = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input?.url || input);
    const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/resource/p6dx-8zbt.json')) return json(SECOP_ROWS);
    if (url.includes('datos.gov.co/resource/')) return json([]);
    return new Response('no disponible', { status: 503 });
  };
  return () => { globalThis.fetch = original; };
}

for (const [label, server] of servers) {
  test(`Radar diario (${label}): cero escrituras en convertidas (activa y NO GO) y en sus oportunidades; sí guarda la fila normal`, async () => {
    const active = convertedRow({ id: 't-act', key: 'secop-ii-act', processId: 'CO1.REQ.200', ref: 'LP-200-2026', entity: 'ALCALDIA ACTIVA', noticeId: '200', opportunityId: 'opp-act' });
    const noGo = convertedRow({ id: 't-nogo', key: 'secop-ii-nogo', processId: 'CO1.REQ.300', ref: 'LP-300-2026', entity: 'ALCALDIA NO GO', noticeId: '300', opportunityId: 'opp-nogo' });
    const tables = {
      psi_public_tenders: [active, noGo],
      psi_sales_opportunities: [
        { id: 'opp-act', stage_code: 'prospecto', tender_offer_status: 'pendiente_decision', observaciones: `Link fuente: ${notice('200')}` },
        { id: 'opp-nogo', stage_code: 'prospecto', tender_offer_status: 'cerrada_no_go', observaciones: `Link fuente: ${notice('300')}` },
      ],
      psi_tender_go_no_go_decisions: [{ id: 'd', opportunity_id: 'opp-nogo', tender_id: 't-nogo', decision: 'no_go', decided_at: '2026-10-01T00:00:00Z' }],
      psi_sales_interactions: [],
    };
    const before = JSON.stringify([active, noGo, tables.psi_sales_opportunities]);
    const db = recordingDb(tables);
    const restore = stubFetch();
    try {
      await server.persistTenderRadar(db, null, 'cron', { deep: true });
    } finally {
      restore();
    }
    const convertedKeys = new Set([active.stable_key, noGo.stable_key]);
    const convertedIds = new Set([active.id, noGo.id]);
    const upserted = db.writes.filter(w => w.table === 'psi_public_tenders' && w.op === 'upsert').flatMap(w => w.values);
    assert.ok(upserted.some(row => row.process_id === 'CO1.REQ.100'), 'la licitación nueva normal sí se guarda');
    assert.equal(upserted.filter(row => convertedKeys.has(row.stable_key)).length, 0, 'ninguna convertida se reescribe');
    assert.equal(upserted.filter(row => ['CO1.REQ.200', 'CO1.REQ.201', 'CO1.REQ.300', 'CO1.REQ.301'].includes(row.process_id)).length, 0,
      'las versiones de un proceso ya convertido no reaparecen como licitación nueva');
    for (const write of db.writes.filter(w => w.table === 'psi_public_tenders' && w.op === 'update')) {
      const target = write.filters.find(([op, column]) => op === 'eq' && (column === 'stable_key' || column === 'id'));
      assert.ok(target && !convertedKeys.has(target[2]) && !convertedIds.has(target[2]), `update sobre una convertida: ${JSON.stringify(write)}`);
      assert.ok(write.filters.some(([op, column, value]) => (op === 'neq' && column === 'internal_status' && value === 'convertida_oportunidad') || (op === 'eq' && column === 'internal_status' && value === 'nueva')),
        `todo update del Radar excluye convertidas en el propio filtro: ${JSON.stringify(write)}`);
    }
    assert.deepEqual(db.writes.filter(w => ['psi_sales_opportunities', 'psi_sales_interactions', 'psi_tender_go_no_go_decisions'].includes(w.table) || w.table.startsWith('rpc:psi_append')), [],
      'ni la oportunidad ni sus interacciones (marcas, avisos)');
    assert.equal(JSON.stringify([active, noGo, tables.psi_sales_opportunities]), before, 'las filas convertidas y sus oportunidades quedan idénticas');
  });
}

test('el trabajador de documentos (Vercel) usa la misma regla de oportunidad activa antes de descargar nada', async () => {
  const { readFileSync } = await import('node:fs');
  for (const path of ['../server/index.js', '../api/[...path].js']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    const deps = source.match(/function buildTenderProcessingWorkerDeps\(database\) \{[\s\S]*?\n\}\n/)[0];
    assert.match(deps, /readOpportunityInactiveReason: \(\{ opportunityId, tenderId \}\) => agt002PhaseChangeOpportunityBlocker\(database, opportunityId, tenderId\)/, path);
  }
});
