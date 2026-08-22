import assert from 'node:assert/strict';
import { getAgt002WorkbenchApi } from '../agt002-workbench-api.js';
import { buildAgt002WorkbenchInitialReference } from '../agt002-workbench-context.js';
import {
  getLatestCanonicalAgt002AnalysisRun,
  getOrCreateAgt002WorkbenchThread,
} from '../agt002-workbench-persistence.js';

// Arranque de la Mesa post-GO: un GET habilitado debe crear/obtener el hilo de forma
// idempotente y derivar en el servidor la referencia canónica inicial, de modo que un
// expediente recién abierto (jobs=[]) pueda enviar su primer mensaje sin bloqueo.
const ids = Object.freeze({
  actor: '10000000-0000-4000-8000-000000000001',
  outsider: '10000000-0000-4000-8000-000000000002',
  opportunity: '10000000-0000-4000-8000-000000000004',
  tender: '10000000-0000-4000-8000-000000000010',
  thread: '10000000-0000-4000-8000-000000000005',
  forgedThread: '10000000-0000-4000-8000-0000000000ff',
  snapshot: '10000000-0000-4000-8000-000000000007',
  forgedSnapshot: '10000000-0000-4000-8000-0000000000fe',
  run: '10000000-0000-4000-8000-000000000020',
  contextVersion: '10000000-0000-4000-8000-000000000021',
  legalCorpus: '10000000-0000-4000-8000-000000000022',
  job: '10000000-0000-4000-8000-000000000008',
  agentMessage: '10000000-0000-4000-8000-000000000030',
});
const operator = { id: ids.actor, active: true, identity_type: 'human', role: 'comercial', permissions: ['licitaciones'] };
const outsider = { id: ids.outsider, active: true, identity_type: 'human', role: 'colaborador', permissions: [] };
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

const richResult = Object.freeze({
  questions: [
    { id: 'Q1', text: '¿Falta la póliza de cumplimiento?', critical: true, evidence_refs: ['doc:1#3'] },
    { id: 'Q2', text: '¿Se requiere experiencia adicional?', critical: false, evidence_refs: ['doc:2#7'] },
  ],
  evidence_coverage: {
    snapshot_id: ids.snapshot,
    material_omissions: true,
    omitted_chunks: [{ evidence_ref: 'doc:3#1' }, { evidence_ref: 'doc:3#2' }],
    selected_chunks: [],
    citation_allowlist: [],
    budget: {},
    coverage_manifest: {},
  },
});

/**
 * Doble de base de datos con las dos superficies que usa el arranque: `.rpc` para los
 * RPC gobernados y `.from(...)` para la lectura del análisis canónico. Registra cada
 * llamada para poder afirmar el orden y la ausencia de duplicados.
 */
function fakeDb({ rpc: rpcHandler = () => ({}), runs = [], runsError = null } = {}) {
  const db = {
    calls: [],
    reads: [],
    async rpc(name, args) {
      db.calls.push({ name, args });
      const outcome = rpcHandler(name, args);
      if (outcome instanceof Error) return { data: null, error: outcome };
      return { data: outcome, error: null };
    },
    from(table) {
      const filters = {};
      const builder = {
        columns: null,
        select(columns) { builder.columns = columns; return builder; },
        eq(column, value) { filters[column] = value; return builder; },
        order() { return builder; },
        limit(count) {
          db.reads.push({ table, columns: builder.columns, filters: { ...filters }, limit: count });
          if (runsError) return Promise.resolve({ data: null, error: runsError });
          const data = runs
            .filter(row => Object.entries(filters).every(([column, value]) => row[column] === value))
            .slice(0, count);
          return Promise.resolve({ data, error: null });
        },
      };
      return builder;
    },
  };
  return db;
}

function workbenchPayload(overrides = {}) {
  return {
    thread_id: null,
    messages: [],
    jobs: [],
    required_actions: [],
    learning_proposals: [],
    active_learning_policies: [],
    ...overrides,
  };
}

function bootstrapDb({ workbench = workbenchPayload(), runs = [canonicalRun()], thread = { id: ids.thread } } = {}) {
  return fakeDb({
    runs,
    rpc: (name) => {
      if (name === 'psi_get_or_create_agt002_workbench_thread') return thread;
      if (name === 'psi_get_agt002_workbench') return workbench;
      throw new Error(`RPC inesperada: ${name}`);
    },
  });
}

// ---------------------------------------------------------------------------
// Adaptadores de persistencia con argumentos cerrados.
// ---------------------------------------------------------------------------
{
  const db = bootstrapDb();
  const thread = await getOrCreateAgt002WorkbenchThread(db, { opportunityId: ids.opportunity, actorId: ids.actor });
  assert.equal(thread.id, ids.thread);
  assert.deepEqual(db.calls[0], {
    name: 'psi_get_or_create_agt002_workbench_thread',
    args: { p_opportunity_id: ids.opportunity, p_actor_id: ids.actor },
  });
  assert.throws(
    () => getOrCreateAgt002WorkbenchThread(db, { opportunityId: ids.opportunity, actorId: ids.actor, extra: 1 }),
    /cerrado/,
    'el adaptador del hilo debe rechazar claves fuera del contrato',
  );
  assert.throws(
    () => getOrCreateAgt002WorkbenchThread(db, { opportunityId: ids.opportunity }),
    /cerrado/,
    'el adaptador del hilo debe exigir actorId',
  );
}

{
  const db = bootstrapDb({ runs: [canonicalRun()] });
  const run = await getLatestCanonicalAgt002AnalysisRun(db, { opportunityId: ids.opportunity });
  assert.equal(run.id, ids.run);
  const [read] = db.reads;
  assert.equal(read.table, 'psi_tender_analysis_runs');
  assert.deepEqual(read.filters, {
    opportunity_id: ids.opportunity, producer: 'AGT-002', method: 'agent_ai', status: 'completed', canonical: true,
  }, 'sólo una corrida canónica AGT-002 completada puede sembrar la Mesa');
  assert.equal(read.limit, 1);
  await assert.rejects(
    () => getLatestCanonicalAgt002AnalysisRun(db, { opportunityId: ids.opportunity, snapshotId: ids.snapshot }),
    /cerrad/,
    'el adaptador canónico debe tener argumentos cerrados',
  );
  assert.equal(
    await getLatestCanonicalAgt002AnalysisRun(bootstrapDb({ runs: [] }), { opportunityId: ids.opportunity }),
    null,
    'sin corrida canónica el adaptador devuelve null, nunca un placeholder',
  );
}

// ---------------------------------------------------------------------------
// Referencia canónica inicial derivada del servidor.
// ---------------------------------------------------------------------------
{
  const minimal = buildAgt002WorkbenchInitialReference(canonicalRun());
  assert.equal(minimal.snapshot_id, ids.snapshot);
  assert.equal(minimal.canonical_run_id, ids.run);
  assert.equal(minimal.context_version_id, null);
  assert.equal(minimal.legal_corpus_version_id, null);
  assert.deepEqual(minimal.context_links.map(link => link.kind), ['snapshot', 'source']);
  assert.deepEqual(minimal.context_links.map(link => link.id), [ids.snapshot, ids.run]);
  for (const link of minimal.context_links) {
    assert.deepEqual(Object.keys(link).sort(), ['id', 'kind', 'label', 'source_ref'], 'los vínculos deben ser cerrados de 4 claves');
  }
  assert.match(minimal.context_links[0].source_ref, /^psi_tender_document_snapshots:/);
  assert.match(minimal.context_links[1].source_ref, /^psi_tender_analysis_runs:/);

  const rich = buildAgt002WorkbenchInitialReference(canonicalRun({
    result: richResult, context_version_id: ids.contextVersion, legal_corpus_version_id: ids.legalCorpus,
  }));
  assert.equal(rich.context_version_id, ids.contextVersion);
  assert.equal(rich.legal_corpus_version_id, ids.legalCorpus);
  assert.deepEqual(rich.evidence_coverage, { material_omissions: true, omitted_count: 2 });
  assert.deepEqual(rich.open_questions.map(question => question.id), ['Q1', 'Q2']);
  assert.deepEqual(rich.context_links.map(link => link.id), [ids.snapshot, ids.run, ids.contextVersion, ids.legalCorpus]);

  for (const invalid of [
    canonicalRun({ canonical: false }),
    canonicalRun({ status: 'failed' }),
    canonicalRun({ producer: 'siio_rules_v1' }),
    canonicalRun({ method: 'rules' }),
    canonicalRun({ snapshot_id: null }),
    canonicalRun({ snapshot_id: 'not-a-uuid' }),
    canonicalRun({ id: null }),
  ]) {
    assert.throws(() => buildAgt002WorkbenchInitialReference(invalid), Error,
      'una corrida no canónica/completada nunca debe producir referencia');
  }
}

// ---------------------------------------------------------------------------
// GET: hilo idempotente + referencia canónica, sin bloqueo con jobs vacíos.
// ---------------------------------------------------------------------------
{
  const db = bootstrapDb();
  const first = await getAgt002WorkbenchApi(db, ids.opportunity, operator, enabled);
  assert.equal(first.enabled, true);
  assert.equal(first.thread_id, ids.thread, 'el hilo debe venir del RPC get-or-create, no del payload');
  assert.deepEqual(first.jobs, []);
  assert.equal(first.reference.snapshot_id, ids.snapshot);
  assert.equal(first.reference.canonical_run_id, ids.run);
  assert.ok(first.reference.context_links.length >= 2, 'la referencia debe traer vínculos seguros de snapshot y corrida');

  assert.equal(db.calls[0].name, 'psi_get_or_create_agt002_workbench_thread', 'el hilo debe crearse/obtenerse antes de leer la Mesa');
  assert.equal(db.calls[0].args.p_actor_id, ids.actor, 'el actor autenticado nunca puede venir del cliente');
  assert.equal(db.calls[1].name, 'psi_get_agt002_workbench');
  assert.equal(db.calls.filter(call => call.name === 'psi_get_or_create_agt002_workbench_thread').length, 1);

  // Un segundo GET vuelve a llamar al mismo RPC idempotente y obtiene el mismo hilo:
  // nunca aparece un segundo hilo ni una ruta alterna de creación.
  const second = await getAgt002WorkbenchApi(db, ids.opportunity, operator, enabled);
  assert.equal(second.thread_id, first.thread_id);
  assert.deepEqual(
    db.calls.map(call => call.name),
    ['psi_get_or_create_agt002_workbench_thread', 'psi_get_agt002_workbench',
      'psi_get_or_create_agt002_workbench_thread', 'psi_get_agt002_workbench'],
    'el arranque sólo usa el RPC idempotente existente y la lectura de la Mesa',
  );
}

// El payload de la BD/cliente jamás puede sobrescribir hilo, habilitación ni referencia.
{
  const db = bootstrapDb({
    workbench: workbenchPayload({
      thread_id: ids.forgedThread,
      enabled: false,
      reference: { snapshot_id: ids.forgedSnapshot, canonical_run_id: ids.forgedSnapshot, context_links: [] },
    }),
  });
  const workbench = await getAgt002WorkbenchApi(db, ids.opportunity, operator, enabled);
  assert.equal(workbench.enabled, true);
  assert.equal(workbench.thread_id, ids.thread);
  assert.equal(workbench.reference.snapshot_id, ids.snapshot);
  assert.equal(workbench.reference.canonical_run_id, ids.run);
  assert.ok(
    !JSON.stringify(workbench.reference).includes(ids.forgedSnapshot),
    'ningún identificador del payload puede filtrarse a la referencia servida',
  );
}

// Fail-closed sin corrida canónica válida: error mapeado y ningún UUID inventado.
for (const runs of [[], [canonicalRun({ canonical: false })], [canonicalRun({ status: 'failed' })]]) {
  const db = bootstrapDb({ runs });
  await assert.rejects(
    () => getAgt002WorkbenchApi(db, ids.opportunity, operator, enabled),
    error => {
      assert.equal(error.code, 'AGT002_WORKBENCH_NO_CANONICAL_ANALYSIS');
      assert.equal(error.status, 409);
      assert.match(error.message, /análisis canónico/i);
      assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(error.message), 'el error no debe inventar ni filtrar UUIDs');
      return true;
    },
  );
}

// Fail-closed cuando la corrida existe pero su referencia no es construible.
{
  const db = bootstrapDb({ runs: [canonicalRun({ snapshot_id: 'not-a-uuid' })] });
  await assert.rejects(
    () => getAgt002WorkbenchApi(db, ids.opportunity, operator, enabled),
    error => error.code === 'AGT002_WORKBENCH_NO_CANONICAL_ANALYSIS' && error.status === 409,
  );
}

// El gate de la Mesa y el permiso del actor siguen siendo lo primero.
{
  const disabledDb = bootstrapDb();
  await assert.rejects(
    () => getAgt002WorkbenchApi(disabledDb, ids.opportunity, operator),
    error => error.status === 503 && error.code === 'AGT002_WORKBENCH_DISABLED',
  );
  assert.equal(disabledDb.calls.length, 0);
  assert.equal(disabledDb.reads.length, 0, 'la Mesa apagada no debe leer análisis canónicos');

  const forbiddenDb = bootstrapDb();
  await assert.rejects(
    () => getAgt002WorkbenchApi(forbiddenDb, ids.opportunity, outsider, enabled),
    error => error.status === 403 && error.code === 'AGT002_WORKBENCH_FORBIDDEN',
  );
  assert.equal(forbiddenDb.calls.length, 0);
  assert.equal(forbiddenDb.reads.length, 0);
}

// La aserción GO y los permisos siguen viviendo en la BD: si el RPC del hilo los rechaza,
// la Mesa nunca se lee ni se deriva referencia alguna.
for (const [dbError, expected] of [
  [Object.assign(new Error('No hay decisión GO.'), { code: 'P0002' }), ['AGT002_WORKBENCH_NOT_FOUND', 404]],
  [Object.assign(new Error('Actor no autorizado.'), { code: '42501' }), ['AGT002_WORKBENCH_FORBIDDEN', 403]],
]) {
  const db = fakeDb({
    runs: [canonicalRun()],
    rpc: name => (name === 'psi_get_or_create_agt002_workbench_thread' ? dbError : workbenchPayload()),
  });
  await assert.rejects(
    () => getAgt002WorkbenchApi(db, ids.opportunity, operator, enabled),
    error => error.code === expected[0] && error.status === expected[1],
  );
  assert.deepEqual(db.calls.map(call => call.name), ['psi_get_or_create_agt002_workbench_thread'],
    'un expediente pre-GO no debe llegar a leer la Mesa');
}

// ---------------------------------------------------------------------------
// Proyección de estado de trabajo (I4): la verdad es el último evento del trabajo, que la
// migración 070 expone en la lectura. El mensaje agente ya no es la señal: era la única
// observable antes de 070 y no permitía distinguir un fallo terminal de un trabajo vivo.
// ---------------------------------------------------------------------------
{
  const runningJob = { id: ids.job, snapshot_id: ids.snapshot, message: 'Liste faltantes.', context_links: [], created_at: '2026-08-21T10:00:00.000Z', latest_event_type: 'claimed', latest_event_at: '2026-08-21T10:05:00.000Z' };
  const doneJob = { ...runningJob, id: ids.run, message: 'Redacte la carta.', latest_event_type: 'completed' };
  const db = bootstrapDb({
    workbench: workbenchPayload({
      thread_id: ids.thread,
      jobs: [runningJob, doneJob],
      messages: [{ id: ids.agentMessage, author_kind: 'agent', origin_job_id: doneJob.id, content: 'Listo.' }],
    }),
  });
  const workbench = await getAgt002WorkbenchApi(db, ids.opportunity, operator, enabled);
  assert.deepEqual(
    workbench.jobs.map(job => [job.id, job.status]),
    [[runningJob.id, 'in_progress'], [doneJob.id, 'completed']],
    'el estado sale del último evento del trabajo, no del mensaje agente',
  );
}

// Una lectura ANTERIOR a 070 (sin último evento) degrada conservadoramente: nunca afirma
// completado por la mera presencia del mensaje agente, ni fallo que no puede observar.
{
  const legacyJob = { id: ids.job, snapshot_id: ids.snapshot, message: 'Liste faltantes.', context_links: [], created_at: '2026-08-21T10:00:00.000Z' };
  const db = bootstrapDb({
    workbench: workbenchPayload({
      thread_id: ids.thread,
      jobs: [legacyJob],
      messages: [{ id: ids.agentMessage, author_kind: 'agent', origin_job_id: legacyJob.id, content: 'Listo.' }],
    }),
  });
  const workbench = await getAgt002WorkbenchApi(db, ids.opportunity, operator, enabled);
  assert.equal(workbench.jobs[0].status, 'in_progress');
  assert.equal(workbench.jobs[0].latest_event_type, null);
  assert.equal(workbench.jobs[0].latest_event_at, null);
}

// El estado lo asigna el servidor: una columna `status` almacenada nunca puede imponerse.
{
  const db = bootstrapDb({
    workbench: workbenchPayload({
      thread_id: ids.thread,
      jobs: [{ id: ids.job, status: 'completed', latest_event_type: 'failed', message: 'Liste faltantes.', context_links: [], created_at: '2026-08-21T10:00:00.000Z' }],
    }),
  });
  const workbench = await getAgt002WorkbenchApi(db, ids.opportunity, operator, enabled);
  assert.equal(workbench.jobs[0].status, 'failed', 'el estado proyectado se asigna después del spread');
}

console.log('AGT-002 workbench bootstrap (thread + canonical reference + job status) passed');
