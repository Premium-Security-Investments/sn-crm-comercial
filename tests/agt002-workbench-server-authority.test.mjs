import assert from 'node:assert/strict';
import { getAgt002WorkbenchApi, postAgt002MessageApi } from '../agt002-workbench-api.js';
import { AGT002_WORKBENCH_CAPABILITIES } from '../agt002-workbench-contract.js';

// Autoridad del servidor sobre la referencia canónica de cada mensaje de la Mesa, y
// proyección honesta del estado de trabajo a partir del último evento del trabajo.
// El body cerrado sigue aceptando `snapshot_id` y `context_links` por compatibilidad,
// pero el servidor los DESCARTA: deriva la referencia con el mismo cargador/constructor
// del GET y persiste (y hashea) sólo lo derivado.
const ids = Object.freeze({
  actor: '20000000-0000-4000-8000-000000000001',
  opportunity: '20000000-0000-4000-8000-000000000004',
  otherOpportunity: '20000000-0000-4000-8000-0000000000a4',
  tender: '20000000-0000-4000-8000-000000000010',
  thread: '20000000-0000-4000-8000-000000000005',
  message: '20000000-0000-4000-8000-000000000006',
  snapshot: '20000000-0000-4000-8000-000000000007',
  newerSnapshot: '20000000-0000-4000-8000-000000000017',
  run: '20000000-0000-4000-8000-000000000020',
  newerRun: '20000000-0000-4000-8000-000000000030',
  foreignSnapshot: '20000000-0000-4000-8000-0000000000f7',
  foreignRun: '20000000-0000-4000-8000-0000000000f0',
  job: '20000000-0000-4000-8000-000000000008',
});
const operator = { id: ids.actor, active: true, identity_type: 'human', role: 'comercial', permissions: ['licitaciones'] };
const enabled = Object.freeze({ enabled: true });

function canonicalRun(overrides = {}) {
  return {
    id: ids.run,
    opportunity_id: ids.opportunity,
    tender_id: ids.tender,
    snapshot_id: ids.snapshot,
    producer: 'AGT-002',
    method: 'agent_ai',
    status: 'completed',
    canonical: true,
    context_version_id: null,
    legal_corpus_version_id: null,
    result: { questions: [] },
    created_at: '2026-08-20T10:00:00.000Z',
    ...overrides,
  };
}

function fakeDb({ runs = [canonicalRun()], workbench = null, ignoreRunFilters = false } = {}) {
  const db = {
    calls: [],
    reads: [],
    async rpc(name, args) {
      db.calls.push({ name, args });
      if (name === 'psi_get_or_create_agt002_workbench_thread') return { data: { id: ids.thread }, error: null };
      if (name === 'psi_get_agt002_workbench') return { data: workbench, error: null };
      if (name === 'psi_append_agt002_workbench_message') return { data: { status: 'queued', job_id: ids.job }, error: null };
      throw new Error(`RPC inesperada: ${name}`);
    },
    from(table) {
      const filters = {};
      const builder = {
        select() { return builder; },
        eq(column, value) { filters[column] = value; return builder; },
        order() { return builder; },
        limit(count) {
          db.reads.push({ table, filters: { ...filters } });
          const rows = ignoreRunFilters
            ? runs
            : runs.filter(row => Object.entries(filters).every(([column, value]) => row[column] === value));
          return Promise.resolve({ data: rows.slice(0, count), error: null });
        },
      };
      return builder;
    },
  };
  return db;
}

function body(overrides = {}) {
  return {
    opportunity_id: ids.opportunity,
    thread_id: ids.thread,
    client_message_id: ids.message,
    content: 'Liste los faltantes del expediente.',
    context_links: [],
    capability_id: AGT002_WORKBENCH_CAPABILITIES.reply,
    snapshot_id: ids.snapshot,
    base_version_id: null,
  };
}

const forgedLink = Object.freeze({
  kind: 'source',
  id: ids.foreignRun,
  label: 'Análisis de otro expediente',
  source_ref: `psi_tender_analysis_runs:${ids.foreignRun}`,
});

// ---------------------------------------------------------------------------
// 1. El body malicioso no puede alterar snapshot, vínculos ni idempotencia.
// ---------------------------------------------------------------------------
{
  const honestDb = fakeDb();
  await postAgt002MessageApi(honestDb, body(), operator, enabled);
  const honest = honestDb.calls.find(call => call.name === 'psi_append_agt002_workbench_message').args;

  const maliciousDb = fakeDb();
  await postAgt002MessageApi(maliciousDb, {
    ...body(),
    snapshot_id: ids.foreignSnapshot,
    context_links: [forgedLink],
  }, operator, enabled);
  const malicious = maliciousDb.calls.find(call => call.name === 'psi_append_agt002_workbench_message').args;

  assert.equal(malicious.p_snapshot_id, ids.snapshot, 'el snapshot persistido debe ser el canónico del servidor');
  assert.notEqual(malicious.p_snapshot_id, ids.foreignSnapshot);
  assert.deepEqual(
    malicious.p_context_links.map(link => link.id),
    [ids.snapshot, ids.run],
    'los vínculos persistidos deben ser exactamente los que derivó el servidor',
  );
  assert.ok(
    !JSON.stringify(malicious.p_context_links).includes(ids.foreignRun),
    'ningún vínculo del body puede filtrarse a la provenance persistida',
  );
  assert.equal(
    malicious.p_idempotency_key, honest.p_idempotency_key,
    'la idempotencia se hashea sobre la referencia derivada: el body no puede bifurcarla',
  );
  for (const link of malicious.p_context_links) {
    assert.deepEqual(Object.keys(link).sort(), ['id', 'kind', 'label', 'source_ref']);
  }
  // El actor y la oportunidad siguen siendo los autenticados/validados.
  assert.equal(malicious.p_actor_id, ids.actor);
  assert.equal(malicious.p_opportunity_id, ids.opportunity);
}

// ---------------------------------------------------------------------------
// 2. La referencia se deriva con el mismo cargador y constructor que el GET.
// ---------------------------------------------------------------------------
{
  const db = fakeDb();
  await postAgt002MessageApi(db, body(), operator, enabled);
  const [read] = db.reads;
  assert.equal(read.table, 'psi_tender_analysis_runs');
  assert.deepEqual(read.filters, {
    opportunity_id: ids.opportunity, producer: 'AGT-002', method: 'agent_ai', status: 'completed', canonical: true,
  }, 'el POST debe usar el mismo cargador canónico cerrado que el GET');

  const getDb = fakeDb({ workbench: { thread_id: ids.thread, messages: [], jobs: [] } });
  const workbench = await getAgt002WorkbenchApi(getDb, ids.opportunity, operator, enabled);
  const postDb = fakeDb();
  await postAgt002MessageApi(postDb, body(), operator, enabled);
  const persisted = postDb.calls.find(call => call.name === 'psi_append_agt002_workbench_message').args;
  assert.deepEqual(
    persisted.p_context_links, workbench.reference.context_links,
    'GET y POST deben construir exactamente la misma referencia',
  );
  assert.equal(persisted.p_snapshot_id, workbench.reference.snapshot_id);
}

// ---------------------------------------------------------------------------
// 3. Body malformado: se rechaza antes de tocar la base, aunque el valor se descarte.
// ---------------------------------------------------------------------------
for (const [label, overrides] of [
  ['snapshot_id no UUID', { snapshot_id: 'no-es-uuid' }],
  ['snapshot_id nulo', { snapshot_id: null }],
  ['context_links no es arreglo', { context_links: { kind: 'source' } }],
  ['context_links ausente como objeto', { context_links: null }],
  ['contenido vacío', { content: '   ' }],
  ['thread_id no UUID', { thread_id: 'no-es-uuid' }],
]) {
  const db = fakeDb();
  await assert.rejects(
    () => postAgt002MessageApi(db, { ...body(), ...overrides }, operator, enabled),
    error => error.status === 400 && error.code === 'AGT002_WORKBENCH_BAD_REQUEST',
    `${label} debe rechazarse como body malformado`,
  );
  assert.equal(db.calls.length, 0, `${label} no debe alcanzar la base`);
  assert.equal(db.reads.length, 0, `${label} no debe leer el análisis canónico`);
}

// Una clave extra (incluida la suplantación de actor) sigue siendo body cerrado.
{
  const db = fakeDb();
  await assert.rejects(
    () => postAgt002MessageApi(db, { ...body(), actor_id: ids.actor }, operator, enabled),
    error => error.status === 400 && error.code === 'AGT002_WORKBENCH_BAD_REQUEST',
  );
  assert.equal(db.calls.length, 0);
}

// ---------------------------------------------------------------------------
// 4. Sin análisis canónico no hay mensaje: nada se encola con referencia inventada.
// ---------------------------------------------------------------------------
for (const runs of [[], [canonicalRun({ canonical: false })], [canonicalRun({ status: 'failed' })], [canonicalRun({ snapshot_id: 'no-es-uuid' })]]) {
  const db = fakeDb({ runs });
  await assert.rejects(
    () => postAgt002MessageApi(db, body(), operator, enabled),
    error => error.code === 'AGT002_WORKBENCH_NO_CANONICAL_ANALYSIS' && error.status === 409,
  );
  assert.equal(
    db.calls.filter(call => call.name === 'psi_append_agt002_workbench_message').length, 0,
    'un fallo cerrado nunca puede encolar trabajo',
  );
}

// ---------------------------------------------------------------------------
// 5. Si la referencia canónica cambió entre el GET y el POST, el POST usa UNA
//    referencia actual internamente coherente: snapshot, corrida y vínculos del mismo run.
// ---------------------------------------------------------------------------
{
  const stale = fakeDb({ workbench: { thread_id: ids.thread, messages: [], jobs: [] } });
  const seen = await getAgt002WorkbenchApi(stale, ids.opportunity, operator, enabled);
  assert.equal(seen.reference.snapshot_id, ids.snapshot);

  const promoted = canonicalRun({
    id: ids.newerRun, snapshot_id: ids.newerSnapshot, created_at: '2026-08-21T10:00:00.000Z',
  });
  const db = fakeDb({ runs: [promoted] });
  // El cliente reenvía la referencia que vio en el GET; el servidor la ignora.
  await postAgt002MessageApi(db, {
    ...body(), snapshot_id: seen.reference.snapshot_id, context_links: seen.reference.context_links,
  }, operator, enabled);
  const persisted = db.calls.find(call => call.name === 'psi_append_agt002_workbench_message').args;
  assert.equal(persisted.p_snapshot_id, ids.newerSnapshot, 'el POST debe congelar el snapshot canónico vigente');
  assert.deepEqual(
    persisted.p_context_links.map(link => link.id), [ids.newerSnapshot, ids.newerRun],
    'los vínculos deben pertenecer a la MISMA corrida canónica que el snapshot persistido',
  );
  assert.ok(
    !JSON.stringify(persisted.p_context_links).includes(ids.run),
    'no puede mezclarse la corrida vieja con el snapshot nuevo',
  );
}

// ---------------------------------------------------------------------------
// 6. Sin provenance cruzada: una corrida de otro expediente nunca siembra el mensaje.
// ---------------------------------------------------------------------------
{
  const db = fakeDb({
    runs: [canonicalRun({ id: ids.foreignRun, opportunity_id: ids.otherOpportunity, snapshot_id: ids.foreignSnapshot })],
    ignoreRunFilters: true,
  });
  await assert.rejects(
    () => postAgt002MessageApi(db, body(), operator, enabled),
    error => error.code === 'AGT002_WORKBENCH_NO_CANONICAL_ANALYSIS' && error.status === 409,
    'una corrida de otra oportunidad debe fallar cerrado, nunca sembrar provenance cruzada',
  );
  assert.equal(db.calls.filter(call => call.name === 'psi_append_agt002_workbench_message').length, 0);

  const getDb = fakeDb({
    runs: [canonicalRun({ id: ids.foreignRun, opportunity_id: ids.otherOpportunity, snapshot_id: ids.foreignSnapshot })],
    ignoreRunFilters: true,
    workbench: { thread_id: ids.thread, messages: [], jobs: [] },
  });
  await assert.rejects(
    () => getAgt002WorkbenchApi(getDb, ids.opportunity, operator, enabled),
    error => error.code === 'AGT002_WORKBENCH_NO_CANONICAL_ANALYSIS' && error.status === 409,
  );
}

// ---------------------------------------------------------------------------
// 7. Proyección del estado de trabajo desde el último evento (migración 070).
// ---------------------------------------------------------------------------
{
  const job = (id, latestEventType) => ({
    id, snapshot_id: ids.snapshot, message: 'Liste faltantes.', context_links: [],
    created_at: '2026-08-21T10:00:00.000Z',
    ...(latestEventType === undefined ? {} : { latest_event_type: latestEventType, latest_event_at: '2026-08-21T11:00:00.000Z' }),
  });
  const cases = [
    ['20000000-0000-4000-8000-000000000101', 'queued', 'queued'],
    ['20000000-0000-4000-8000-000000000102', 'released', 'queued'],
    ['20000000-0000-4000-8000-000000000103', 'claimed', 'in_progress'],
    ['20000000-0000-4000-8000-000000000104', 'completed', 'completed'],
    ['20000000-0000-4000-8000-000000000105', 'failed', 'failed'],
    // `stale` es terminal por obsolescencia documental, no un fallo reintentable: el trabajo
    // quedó congelado sobre una versión superada y repetirlo volvería a quedar obsoleto.
    ['20000000-0000-4000-8000-000000000106', 'stale', 'obsolete'],
  ];
  const unknown = [
    ['20000000-0000-4000-8000-000000000107', 'inventado'],
    ['20000000-0000-4000-8000-000000000108', null],
    ['20000000-0000-4000-8000-000000000109', undefined],
    ['20000000-0000-4000-8000-00000000010a', 'COMPLETED'],
    ['20000000-0000-4000-8000-00000000010b', 42],
    ['20000000-0000-4000-8000-00000000010c', 'constructor'],
  ];
  const db = fakeDb({
    workbench: {
      thread_id: ids.thread,
      messages: [],
      jobs: [
        ...cases.map(([id, event]) => job(id, event)),
        ...unknown.map(([id, event]) => job(id, event)),
      ],
    },
  });
  const workbench = await getAgt002WorkbenchApi(db, ids.opportunity, operator, enabled);
  const byId = new Map(workbench.jobs.map(entry => [entry.id, entry]));
  for (const [id, event, expected] of cases) {
    assert.equal(byId.get(id).status, expected, `el evento ${event} debe proyectarse como ${expected}`);
  }
  for (const [id, event] of unknown) {
    const status = byId.get(id).status;
    assert.notEqual(status, 'completed', `un evento desconocido (${String(event)}) jamás puede afirmarse completado`);
    assert.notEqual(status, 'failed', `un evento desconocido (${String(event)}) jamás puede ofrecerse como reintentable`);
    assert.equal(status, 'in_progress', 'lo desconocido se proyecta conservadoramente como en curso');
  }
  // Sólo `failed` habilita reintentar: ningún otro estado puede ofrecerlo.
  assert.deepEqual(
    workbench.jobs.filter(job => job.status === 'failed').map(job => job.latest_event_type), ['failed'],
    'sólo el evento failed puede proyectarse como reintentable',
  );
  // Los campos previos del trabajo se conservan intactos junto al estado proyectado.
  const [first] = workbench.jobs;
  assert.equal(first.snapshot_id, ids.snapshot);
  assert.equal(first.message, 'Liste faltantes.');
  assert.equal(first.created_at, '2026-08-21T10:00:00.000Z');
  // El contrato servido es el mismo con o sin 070: nunca `undefined`.
  const orphan = byId.get('20000000-0000-4000-8000-000000000109');
  assert.equal(orphan.latest_event_type, null);
  assert.equal(orphan.latest_event_at, null);
}

// Un payload sin trabajos (o con `jobs` corrupto) nunca revienta la lectura.
{
  const db = fakeDb({ workbench: { thread_id: ids.thread, messages: [], jobs: null } });
  const workbench = await getAgt002WorkbenchApi(db, ids.opportunity, operator, enabled);
  assert.deepEqual(workbench.jobs, []);
}

console.log('AGT-002 workbench server authority (referencia derivada + estado por evento) passed');
