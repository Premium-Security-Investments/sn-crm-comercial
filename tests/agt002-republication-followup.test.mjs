// AGT-002 — seguimiento automático de un proceso SECOP II republicado (decisiones del dueño, 2026-10-08): documentos del
// aviso nuevo sólo con un conjunto estable, marca después del snapshot, y un único reanálisis automático (o INITIAL)
// dentro del cupo diario de admisiones automáticas. Estado en interacciones JSON; avisos con append atómico.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGT002_VIGIA_AGENT_PROFILE_ID,
  isRepublicationDocumentSetTooSmall,
  planAgt002RepublicationAnalysis,
  recordAgt002RepublicationDetected,
  republicationDocumentSetHash,
  runAgt002RepublicationAnalysisAdmissions,
  runAgt002RepublicationDocumentRefresh,
} from '../agt002-republication-followup.js';
import { countAgt002AutomaticAnalysesToday } from '../agt002-auto-initial.js';

const NEW_URL = 'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.11032172&isFromPublicArea=True&isModal=False';
const OLD_URL = 'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.10911657';
const NOTICE = 'CO1.NTC.11032172';
const NOW = new Date('2026-10-09T15:00:00.000Z');
const ON = { AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED: 'true', AGT002_MODEL_CALLS_ENABLED: 'true' };

function fakeDb(tables) {
  let clock = 0;
  const db = {
    tables,
    appended: [],
    rpc: async (name, args) => {
      assert.equal(name, 'psi_append_opportunity_observation_line', 'el seguimiento sólo agrega avisos con el RPC atómico');
      const opportunity = tables.psi_sales_opportunities.find(row => row.id === args.p_opportunity_id);
      const lines = String(opportunity.observaciones || '').split('\n');
      if (!lines.includes(args.p_line)) { opportunity.observaciones = opportunity.observaciones ? `${opportunity.observaciones}\n${args.p_line}` : args.p_line; db.appended.push(args.p_line); }
      return { data: true, error: null };
    },
    from(name) {
      const filters = [];
      let limit = Infinity;
      const run = () => (tables[name] || []).filter(row => filters.every(filter => filter(row))).slice(0, limit);
      const chain = {
        select() { return chain; },
        eq(column, value) { filters.push(row => row[column] === value); return chain; },
        gte(column, value) { filters.push(row => String(row[column]) >= String(value)); return chain; },
        like(column, pattern) { const needle = String(pattern).replace(/^%|%$/g, ''); filters.push(row => String(row[column] ?? '').includes(needle)); return chain; },
        order() { return chain; },
        limit(n) { limit = n; return chain; },
        update() { throw new Error('el seguimiento nunca reescribe filas completas'); },
        insert(row) {
          clock += 1;
          tables[name] = tables[name] || [];
          tables[name].push({ id: `ins-${clock}`, created_at: new Date(NOW.getTime() + clock).toISOString(), ...row });
          return { then(resolve) { resolve({ data: null, error: null }); } };
        },
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        then(resolve) { resolve({ data: run(), error: null }); },
      };
      return chain;
    },
  };
  return db;
}

const state = (kind, payload, createdAt) => ({
  id: `${kind}-${createdAt}`, opportunity_id: 'opp-ftic', interaction_type: 'documento', created_at: createdAt,
  notes: JSON.stringify({ kind, notice_uid: NOTICE, ...payload }),
});
const DETECTED = state('tender_republication_detected', { url: NEW_URL, ref: 'FTIC-LP-003-2026.' }, '2026-10-08T11:00:00.000Z');
const IMPORTED = state('tender_republication_documents_imported', { snapshot_id: 'snap-new', started_at: '2026-10-09T09:59:00.000Z', document_count: 4, retired_count: 2 }, '2026-10-09T10:00:00.000Z');

function world(overrides = {}) {
  return {
    psi_public_tenders: [
      { id: 't-ftic', ref: 'FTIC-LP-003-2026', url: NEW_URL, converted_opportunity_id: 'opp-ftic', internal_status: 'convertida_oportunidad', reviewed_by: 'juan' },
      { id: 't-plain', ref: 'LP-010-2026', url: OLD_URL, converted_opportunity_id: 'opp-plain', internal_status: 'convertida_oportunidad', reviewed_by: 'juan' },
    ],
    psi_sales_opportunities: [
      { id: 'opp-ftic', observaciones: `Link fuente: ${NEW_URL}`, service_type_code: 'licitacion_publica' },
      { id: 'opp-plain', observaciones: `Link fuente: ${OLD_URL}`, service_type_code: 'licitacion_publica' },
    ],
    psi_sales_interactions: [DETECTED],
    psi_tender_processing_jobs: [{ opportunity_id: 'opp-ftic', requested_by: 'juan', created_at: '2026-09-26T12:00:00.000Z' }],
    psi_agt002_initial_analysis_jobs: [
      { id: 'initial-1', opportunity_id: 'opp-ftic', status: 'COMPLETED', analysis_kind: 'INITIAL', created_at: '2026-09-26T14:00:00.000Z' },
    ],
    psi_tender_analysis_runs: [{ id: 'run-1', opportunity_id: 'opp-ftic', canonical: true, status: 'completed', analysis_kind: 'INITIAL' }],
    psi_tender_document_state: [{ opportunity_id: 'opp-ftic', current_snapshot_id: 'snap-new' }],
    psi_tender_document_snapshots: [],
    psi_tender_document_versions: [{ id: 'v-new', name: 'Pliego definitivo.pdf', opportunity_id: 'opp-ftic', current: true }],
    psi_tender_document_extractions: [{ document_version_id: 'v-new', opportunity_id: 'opp-ftic', status: 'ok', char_count: 5000, created_at: '2026-10-09T10:00:00.000Z' }],
    ...overrides,
  };
}

const kinds = tables => tables.psi_sales_interactions.map(row => JSON.parse(row.notes)).map(notes => notes.kind);

test('la detección se registra una sola vez por aviso nuevo, con la identidad técnica', async () => {
  const tables = world({ psi_sales_interactions: [] });
  const db = fakeDb(tables);
  assert.equal(await recordAgt002RepublicationDetected(db, 'opp-ftic', { url: NEW_URL, ref: 'FTIC-LP-003-2026.' }), true);
  assert.equal(await recordAgt002RepublicationDetected(db, 'opp-ftic', { url: NEW_URL, ref: 'FTIC-LP-003-2026.' }), false);
  assert.equal(tables.psi_sales_interactions.length, 1);
  assert.equal(tables.psi_sales_interactions[0].created_by, AGT002_VIGIA_AGENT_PROFILE_ID);
});

test('documentos: espera datos.gov.co, exige el mismo conjunto en dos corridas y no importa un conjunto mucho menor', async () => {
  const tables = world();
  const db = fakeDb(tables);
  const imports = [];
  const importDocuments = async (opportunityId, options) => {
    imports.push({ opportunityId, ...options });
    tables.psi_sales_interactions.push(IMPORTED);
    return { retired_count: 2 };
  };
  // Día 1: datos.gov.co aún no tiene el proceso.
  const day1 = await runAgt002RepublicationDocumentRefresh(db, { probeDocuments: async () => { throw new Error('No se encontró proceso SECOP por urlproceso exacto'); }, importDocuments });
  assert.deepEqual(day1.map(e => e.event), ['agt002_republication_documents_pending'], 'sólo la oportunidad republicada; la convertida sin republicación no entra');
  // Día 2: aparece un conjunto parcial → se observa, no se importa.
  const partial = { document_set_hash: republicationDocumentSetHash(['Aviso.pdf']), document_count: 1, current_official_count: 6 };
  const day2 = await runAgt002RepublicationDocumentRefresh(db, { probeDocuments: async () => partial, importDocuments });
  assert.deepEqual(day2.map(e => e.event), ['agt002_republication_documents_waiting_stability']);
  // Día 3: mismo conjunto parcial, pero mucho menor que el vigente → sigue esperando.
  const day3 = await runAgt002RepublicationDocumentRefresh(db, { probeDocuments: async () => partial, importDocuments });
  assert.deepEqual(day3.map(e => e.event), ['agt002_republication_documents_waiting_smaller_set']);
  // Día 4: el conjunto completo cambia → se vuelve a observar; día 5: estable → importa una vez.
  const full = { document_set_hash: republicationDocumentSetHash(['Aviso.pdf', 'Pliego.pdf', 'Anexo 1.pdf', 'Anexo 2.pdf']), document_count: 4, current_official_count: 6 };
  assert.deepEqual((await runAgt002RepublicationDocumentRefresh(db, { probeDocuments: async () => full, importDocuments })).map(e => e.event), ['agt002_republication_documents_waiting_stability']);
  assert.equal(imports.length, 0);
  const day5 = await runAgt002RepublicationDocumentRefresh(db, { probeDocuments: async () => full, importDocuments });
  assert.deepEqual(day5.map(e => e.event), ['agt002_republication_documents_imported']);
  assert.deepEqual(imports, [{ opportunityId: 'opp-ftic', noticeUid: NOTICE, actorProfileId: AGT002_VIGIA_AGENT_PROFILE_ID, expectedDocumentSetHash: full.document_set_hash }]);
  assert.match(tables.psi_sales_opportunities[0].observaciones, /Documentos oficiales de la versión nueva de SECOP importados \(CO1\.NTC\.11032172\): 4 vigentes; 2 del aviso anterior quedan como historial\./);
  // Día 6: ya importado → no repite.
  const day6 = await runAgt002RepublicationDocumentRefresh(db, { probeDocuments: async () => { throw new Error('no debe llamarse'); }, importDocuments });
  assert.deepEqual(day6.map(e => e.event), ['agt002_republication_documents_already_imported']);
  assert.equal(imports.length, 1);
  assert.equal(isRepublicationDocumentSetTooSmall({ documentCount: 3, currentOfficialCount: 6 }), false);
  assert.equal(isRepublicationDocumentSetTooSmall({ documentCount: 2, currentOfficialCount: 6 }), true);
});

test('documentos: un conjunto estable pero incompleto avisa para revisión humana tras ~3 corridas, una vez', async () => {
  const partial = { document_set_hash: 'p', document_count: 1, current_official_count: 6 };
  const tables = world({ psi_sales_interactions: [DETECTED, state('tender_republication_documents_observed', partial, '2026-10-06T12:00:00.000Z')] });
  const db = fakeDb(tables);
  const importDocuments = async () => { throw new Error('no debe importar'); };
  await runAgt002RepublicationDocumentRefresh(db, { probeDocuments: async () => partial, importDocuments, now: new Date('2026-10-07T12:00:00.000Z') });
  assert.deepEqual(db.appended, [], 'el primer día de espera no avisa');
  const events = await runAgt002RepublicationDocumentRefresh(db, { probeDocuments: async () => partial, importDocuments, now: new Date('2026-10-09T12:00:00.000Z') });
  assert.deepEqual(events.map(e => e.event), ['agt002_republication_documents_waiting_smaller_set']);
  assert.deepEqual(db.appended, ['Hay una versión nueva en SECOP (CO1.NTC.11032172) pero sus documentos están incompletos; revisar e importar a mano.']);
  await runAgt002RepublicationDocumentRefresh(db, { probeDocuments: async () => partial, importDocuments, now: new Date('2026-10-10T12:00:00.000Z') });
  assert.equal(db.appended.length, 1, 'el aviso no se repite');
});

test('cupo: la intención se registra antes de admitir, así el cupo cuenta aunque falle el registro del resultado', async () => {
  const tables = world({ psi_sales_interactions: [DETECTED, IMPORTED] });
  const db = fakeDb(tables);
  const { admit, freezeProfile } = admitSpy();
  const order = [];
  const tracingAdmit = async (...args) => { order.push(kinds(tables).at(-1)); return admit(...args); };
  await runAgt002RepublicationAnalysisAdmissions(db, { now: NOW, environment: ON, admit: tracingAdmit, freezeProfile });
  assert.deepEqual(order, ['tender_republication_analysis'], 'el último registro antes de admitir es la intención');
  const intents = tables.psi_sales_interactions.map(row => JSON.parse(row.notes)).filter(notes => notes.outcome === 'admitting');
  assert.equal(intents.length, 1);
  // Aunque se perdiera el registro "launched", la intención sigue contando.
  tables.psi_sales_interactions = tables.psi_sales_interactions.filter(row => JSON.parse(row.notes).outcome !== 'launched');
  assert.equal(await countAgt002AutomaticAnalysesToday(db, NOW), 1);
});

test('documentos: si la importación falla (p. ej. antes del snapshot) no queda marca y se reintenta', async () => {
  const stable = { document_set_hash: 'h', document_count: 4, current_official_count: 4 };
  const tables = world({ psi_sales_interactions: [DETECTED, state('tender_republication_documents_observed', stable, '2026-10-08T12:00:00.000Z')] });
  const db = fakeDb(tables);
  const events = await runAgt002RepublicationDocumentRefresh(db, { probeDocuments: async () => stable, importDocuments: async () => { throw new Error('No fue posible iniciar la actualización documental gobernada.'); } });
  assert.deepEqual(events.map(e => e.event), ['agt002_republication_documents_pending']);
  assert.ok(!kinds(tables).includes('tender_republication_documents_imported'));
  assert.deepEqual(db.appended, []);
});

function admitSpy(status = 'admitted') {
  const calls = [];
  const admit = async (_db, args) => { calls.push(args); return { jobId: status === 'admitted' || status === 'existing' ? `job-${calls.length}` : null, admissionStatus: status }; };
  const freezeProfile = async () => ({ profileSnapshotId: 'ps-1', profileSnapshotHash: 'a'.repeat(64) });
  return { calls, admit, freezeProfile };
}

test('análisis: espera la marca de importación y un snapshot vigente posterior', async () => {
  const { calls, admit, freezeProfile } = admitSpy();
  const noDocs = await runAgt002RepublicationAnalysisAdmissions(fakeDb(world()), { now: NOW, environment: ON, admit, freezeProfile });
  assert.deepEqual(noDocs.map(e => e.event), ['agt002_republication_analysis_waiting_documents']);
  const staleSnapshot = world({ psi_sales_interactions: [DETECTED, IMPORTED], psi_tender_document_state: [{ opportunity_id: 'opp-ftic', current_snapshot_id: null }] });
  const waiting = await runAgt002RepublicationAnalysisAdmissions(fakeDb(staleSnapshot), { now: NOW, environment: ON, admit, freezeProfile });
  assert.deepEqual(waiting.map(e => e.reason), ['snapshot_not_current']);
  const older = world({ psi_sales_interactions: [DETECTED, IMPORTED], psi_tender_document_state: [{ opportunity_id: 'opp-ftic', current_snapshot_id: 'snap-old' }], psi_tender_document_snapshots: [{ id: 'snap-old', created_at: '2026-09-27T00:00:00.000Z' }] });
  assert.deepEqual((await runAgt002RepublicationAnalysisAdmissions(fakeDb(older), { now: NOW, environment: ON, admit, freezeProfile })).map(e => e.reason), ['snapshot_not_current']);
  assert.equal(calls.length, 0);
});

test('análisis: admite UN reanálisis sucesor del canónico, autorizado por quien convirtió, y no lo repite', async () => {
  const tables = world({ psi_sales_interactions: [DETECTED, IMPORTED] });
  const db = fakeDb(tables);
  const { calls, admit, freezeProfile } = admitSpy();
  const events = await runAgt002RepublicationAnalysisAdmissions(db, { now: NOW, environment: ON, admit, freezeProfile });
  assert.deepEqual(events.map(e => e.event), ['agt002_republication_analysis_admitted']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].analysisKind, 'REANALYSIS');
  assert.equal(calls[0].sourceAnalysisRunId, 'run-1');
  assert.equal(calls[0].actorProfileId, 'juan', 'convertir = autorización: el actor es quien convirtió');
  assert.equal(calls[0].attempt, `secop-republication:${NOTICE}`);
  assert.equal(calls[0].expiresAt, '2026-10-11T10:00:00.000Z', 'ventana G1 determinista desde la importación');
  assert.match(tables.psi_sales_opportunities[0].observaciones, /SECOP publicó una versión nueva \(CO1\.NTC\.11032172\); se lanzó el reanálisis automático\./);
  // Cuenta contra el cupo automático.
  assert.equal(await countAgt002AutomaticAnalysesToday(db, NOW), 1);
  // Siguiente pasada: ya resuelto, sin otra admisión.
  const again = await runAgt002RepublicationAnalysisAdmissions(db, { now: new Date('2026-10-10T16:00:00.000Z'), environment: ON, admit, freezeProfile });
  assert.deepEqual(again.map(e => e.event), ['agt002_republication_analysis_already_resolved']);
  assert.equal(calls.length, 1, 'nunca en bucle');
});

test('análisis: INITIAL cuando la oportunidad aún no tiene análisis completado', async () => {
  const { calls, admit, freezeProfile } = admitSpy();
  const tables = world({ psi_sales_interactions: [DETECTED, IMPORTED], psi_agt002_initial_analysis_jobs: [], psi_tender_analysis_runs: [] });
  await runAgt002RepublicationAnalysisAdmissions(fakeDb(tables), { now: NOW, environment: ON, admit, freezeProfile });
  assert.equal(calls[0].analysisKind, 'INITIAL');
  assert.equal(calls[0].sourceAnalysisRunId, null);
  assert.match(tables.psi_sales_opportunities[0].observaciones, /se lanzó el análisis inicial automático\./);
});

test('análisis: un resultado no admitido no dice "se lanzó" y no se reintenta hasta mañana', async () => {
  const { calls, admit, freezeProfile } = admitSpy('empty');
  const tables = world({ psi_sales_interactions: [DETECTED, IMPORTED] });
  const db = fakeDb(tables);
  const first = await runAgt002RepublicationAnalysisAdmissions(db, { now: NOW, environment: ON, admit, freezeProfile });
  assert.deepEqual(first.map(e => e.event), ['agt002_republication_analysis_not_admitted']);
  assert.doesNotMatch(tables.psi_sales_opportunities[0].observaciones, /se lanzó/);
  assert.match(tables.psi_sales_opportunities[0].observaciones, /no se pudo lanzar \(empty\); se reintenta mañana\./);
  const sameDay = await runAgt002RepublicationAnalysisAdmissions(db, { now: new Date(NOW.getTime() + 600_000), environment: ON, admit, freezeProfile });
  assert.deepEqual(sameDay.map(e => e.reason), ['retry_tomorrow']);
  assert.equal(calls.length, 1, 'sin repetir la admisión en cada tick');
  assert.equal(await countAgt002AutomaticAnalysesToday(db, NOW), 1, 'la intención registrada antes de admitir cuenta (conservador: nunca se subcuenta el cupo)');
});

test('cupo: sólo cuentan las admisiones automáticas; un reanálisis manual no lo consume', async () => {
  const manualReanalyses = Array.from({ length: 5 }, (_, index) => ({ id: `m${index}`, opportunity_id: `other-${index}`, status: 'COMPLETED', analysis_kind: 'REANALYSIS', created_at: '2026-10-09T13:00:00.000Z' }));
  const tables = world({ psi_sales_interactions: [DETECTED, IMPORTED] });
  tables.psi_agt002_initial_analysis_jobs.push(...manualReanalyses);
  const { calls, admit, freezeProfile } = admitSpy();
  await runAgt002RepublicationAnalysisAdmissions(fakeDb(tables), { now: NOW, dailyCap: 5, environment: ON, admit, freezeProfile });
  assert.equal(calls.length, 1, 'cinco reanálisis manuales hoy no bloquean el automático');
});

test('cupo: con el cupo automático lleno queda pendiente con aviso, una vez, y no supera el cupo', async () => {
  const autoInitials = Array.from({ length: 5 }, (_, index) => ({ id: `j${index}`, opportunity_id: `other-${index}`, status: 'COMPLETED', analysis_kind: 'INITIAL', created_at: '2026-10-09T13:00:00.000Z' }));
  const tables = world({ psi_sales_interactions: [DETECTED, IMPORTED] });
  tables.psi_agt002_initial_analysis_jobs.push(...autoInitials);
  const db = fakeDb(tables);
  const { calls, admit, freezeProfile } = admitSpy();
  const events = await runAgt002RepublicationAnalysisAdmissions(db, { now: NOW, dailyCap: 5, environment: ON, admit, freezeProfile });
  assert.deepEqual(events.map(e => [e.event, e.reason]), [['agt002_republication_analysis_deferred', 'daily_cap']]);
  assert.equal(calls.length, 0);
  assert.match(tables.psi_sales_opportunities[0].observaciones, /reanálisis automático pendiente por cupo diario\./);
  const again = await runAgt002RepublicationAnalysisAdmissions(db, { now: new Date(NOW.getTime() + 600_000), dailyCap: 5, environment: ON, admit, freezeProfile });
  assert.deepEqual(again.map(e => e.reason), ['retry_tomorrow']);
  assert.equal(db.appended.filter(line => /cupo diario/.test(line)).length, 1);
});

test('un job atascado en NEEDS_ATTENTION no deja la republicación esperando para siempre (ventana de 48 h)', async () => {
  const { calls, admit, freezeProfile } = admitSpy();
  const tables = world({ psi_sales_interactions: [DETECTED, IMPORTED] });
  tables.psi_agt002_initial_analysis_jobs[0] = { ...tables.psi_agt002_initial_analysis_jobs[0], status: 'NEEDS_ATTENTION' };
  const within = await runAgt002RepublicationAnalysisAdmissions(fakeDb(tables), { now: NOW, environment: ON, admit, freezeProfile });
  assert.deepEqual(within.map(e => e.reason), ['analysis_in_progress']);
  const later = await runAgt002RepublicationAnalysisAdmissions(fakeDb(tables), { now: new Date('2026-10-12T15:00:00.000Z'), environment: ON, admit, freezeProfile });
  assert.deepEqual(later.map(e => e.reason), ['authorization_window_elapsed']);
  assert.match(tables.psi_sales_opportunities[0].observaciones, /requiere lanzarse manualmente/);
  const off = await runAgt002RepublicationAnalysisAdmissions(fakeDb(tables), { now: NOW, environment: {}, admit, freezeProfile });
  assert.deepEqual(off.map(e => e.event), ['agt002_republication_analysis_disabled']);
  assert.equal(calls.length, 0);
});

test('plan puro de análisis', () => {
  const imported = { created_at: '2026-10-09T10:00:00.000Z', payload: {} };
  const rec = (outcome, at) => ({ created_at: at, payload: { outcome } });
  assert.equal(planAgt002RepublicationAnalysis({ imported, now: NOW, analysisRecords: [rec('launched', '2026-10-09T11:00:00.000Z')] }).action, 'done');
  assert.equal(planAgt002RepublicationAnalysis({ imported, now: NOW, jobs: [{ status: 'QUEUED', created_at: '2026-10-09T11:00:00.000Z' }] }).action, 'done', 'un análisis manual posterior también resuelve');
  assert.equal(planAgt002RepublicationAnalysis({ imported, now: new Date('2026-10-10T15:00:00.000Z'), analysisRecords: [rec('daily_cap', '2026-10-09T11:00:00.000Z')], canonical: { id: 'r', analysis_kind: 'INITIAL' } }).action, 'admit', 'al día siguiente se reintenta');
  assert.equal(planAgt002RepublicationAnalysis({ imported, now: NOW, canonical: { id: 'legacy', analysis_kind: null } }).analysisKind, 'INITIAL');
});
