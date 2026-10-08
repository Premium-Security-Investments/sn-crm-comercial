// AGT-002 — seguimiento automático cuando SECOP II publica una fase nueva (o una republicación) de un proceso ya
// convertido (decisiones del dueño, 2026-10-08): el disparador sólo nace en la corrida que cambia el enlace y sólo para
// procesos vivos; documentos del aviso nuevo con un conjunto estable que traiga documentos nuevos; un único reanálisis
// automático (o INITIAL) dentro del cupo diario compartido. Estado en interacciones JSON; avisos con append atómico.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGT002_VIGIA_AGENT_PROFILE_ID,
  isPhaseChangeDocumentSetTooSmall,
  phaseChangeDetectedLine,
  planAgt002PhaseChangeAnalysis,
  recordAgt002PhaseChangeDetected,
  runAgt002PhaseChangeAnalysisAdmissions,
  runAgt002PhaseChangeDocumentRefresh,
} from '../agt002-phase-change-followup.js';
import { countAgt002AutomaticAnalysesToday } from '../agt002-auto-initial.js';
import { planRadarPhaseIdentitySync, tenderSourceChangeFollowUpBlocker } from '../tender-phase-identity.js';

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';
process.env.VERCEL = '1';
const servers = [['server', await import('../server/index.js')], ['api', await import('../api/[...path].js')]];

const secopUrl = id => `https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.${id}`;
const OLD_URL = secopUrl('10911657');
const NEW_URL = secopUrl('11032172');
const NOTICE = 'CO1.NTC.11032172';
const NOW = new Date('2026-10-09T15:00:00.000Z');
const ON = { AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED: 'true', AGT002_MODEL_CALLS_ENABLED: 'true' };
const FTIC_ENTITY = 'FONDO UNICO DE TECNOLOGÍAS DE LA INFORMACIÓN Y LAS COMUNICACIONES';

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
          if (db.failInserts) return { then(resolve) { resolve({ data: null, error: { message: 'sin conexión' } }); } };
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
const DETECTED = state('tender_phase_change_detected', { change: 'phase', url: NEW_URL, ref: 'FTIC-LP-003-2026 (Presentación de oferta)', new_phase: 'Publicado', detected_at: '2026-10-08T11:00:00.000Z' }, '2026-10-08T11:00:00.000Z');
const IMPORTED = state('tender_phase_change_documents_imported', { snapshot_id: 'snap-new', started_at: '2026-10-09T09:59:00.000Z', document_count: 24, changed_count: 4, retired_count: 0 }, '2026-10-09T10:00:00.000Z');
const HEAD = 'SECOP publicó el pliego definitivo (fase de oferta) (CO1.NTC.11032172)';

function world(overrides = {}) {
  return {
    psi_public_tenders: [
      { id: 't-ftic', ref: 'FTIC-LP-003-2026', url: NEW_URL, status: 'Publicado', deadline_at: '2026-10-19T00:00:00+00:00', converted_opportunity_id: 'opp-ftic', internal_status: 'convertida_oportunidad', reviewed_by: 'juan' },
      { id: 't-plain', ref: 'LP-010-2026', url: OLD_URL, status: 'Publicado', deadline_at: '2026-10-30T00:00:00+00:00', converted_opportunity_id: 'opp-plain', internal_status: 'convertida_oportunidad', reviewed_by: 'juan' },
    ],
    psi_sales_opportunities: [
      { id: 'opp-ftic', observaciones: `Nota escrita por Juan\nLink fuente: ${NEW_URL}`, service_type_code: 'licitacion_publica' },
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

// ---------------------------------------------------------------------------------------------------------------
// Disparador: sólo la corrida que cambia el enlace, hacia una fase posterior viva.
// ---------------------------------------------------------------------------------------------------------------

const draftConverted = (overrides = {}) => ({
  stable_key: 'ftic-conv', source: 'SECOP II', entity: FTIC_ENTITY, ref: 'FTIC-LP-003-2026', process_id: 'CO1.REQ.11038226', title: 'Vigilancia',
  url: OLD_URL, status: 'Presentación de observaciones', deadline_at: '2026-10-20T00:00:00+00:00', internal_status: 'convertida_oportunidad',
  converted_opportunity_id: 'opp-ftic', ...overrides,
});
const offerRow = (overrides = {}) => ({
  stable_key: 'ftic-offer', source: 'SECOP II', entity: FTIC_ENTITY, ref: 'FTIC-LP-003-2026 (Presentación de oferta)', process_id: 'CO1.REQ.11160001',
  title: 'Vigilancia', url: NEW_URL, status: 'Publicado', deadline: '2026-10-19T00:00:00.000', ...overrides,
});
const draftRow = () => ({ stable_key: 'ftic-draft', source: 'SECOP II', entity: FTIC_ENTITY, ref: 'FTIC-LP-003-2026', process_id: 'CO1.REQ.11038226', title: 'Vigilancia', url: OLD_URL, status: 'Evaluación', deadline: '2026-10-20T00:00:00.000' });

test('disparador: Fondo Único pasa al pliego definitivo → un cambio de fase seguible, sólo en la corrida que cambia el enlace', () => {
  const plan = planRadarPhaseIdentitySync({ fetched: [draftRow(), offerRow()], existing: [draftConverted()], now: '2026-10-10T11:00:00.000Z' });
  const change = plan.opportunityPatches[0].sourceChange;
  assert.equal(change.change, 'phase');
  assert.equal(change.url, NEW_URL);
  assert.equal(change.previousUrl, OLD_URL);
  assert.equal(change.blocker, null, 'proceso vivo y cierre futuro: se sigue');
  assert.equal(phaseChangeDetectedLine({ change: change.change, newPhase: change.newPhase, ref: change.ref, noticeUid: NOTICE }),
    `${HEAD}; el enlace de la oportunidad se actualizó y Vig-IA bajará sus documentos y lanzará el reanálisis.`);
  // Corrida siguiente: el enlace ya cambió (histórico) → nada que seguir, aunque la fila siga llegando.
  const next = planRadarPhaseIdentitySync({ fetched: [draftRow(), offerRow()], existing: [draftConverted({ url: NEW_URL, status: 'Publicado', process_id: 'CO1.REQ.11160001' })], now: '2026-10-11T11:00:00.000Z' });
  assert.ok(next.opportunityPatches.every(patch => !patch.sourceChange), 'un cambio ya aplicado nunca vuelve a disparar');
});

test('disparador: procesos terminales, con cierre pasado o sin cierre quedan bloqueados (primera corrida tras instalar)', () => {
  const cases = [
    ['Cali Contratación (Seleccionado)', offerRow({ status: 'Seleccionado', deadline: '2026-09-18T00:00:00.000' }), 'terminal_status'],
    ['Procuraduría (Abierto, cierre 18-sep)', offerRow({ status: 'Abierto', deadline: '2026-09-18T00:00:00.000' }), 'deadline_passed'],
    ['sin fecha de cierre', offerRow({ deadline: null }), 'no_deadline'],
    ['Cancelado', offerRow({ status: 'Cancelado' }), 'terminal_status'],
  ];
  for (const [label, row, blocker] of cases) {
    const plan = planRadarPhaseIdentitySync({ fetched: [row], existing: [draftConverted()], now: '2026-10-10T11:00:00.000Z' });
    assert.equal(plan.opportunityPatches[0].officialUrl, NEW_URL, `${label}: el enlace sí se actualiza (PR #331)`);
    assert.equal(plan.opportunityPatches[0].sourceChange.blocker, blocker, label);
  }
  for (const status of ['Adjudicado', 'Seleccionado', 'Celebrado', 'Cancelado', 'Desierto', 'Revocado', 'Terminado anormalmente', 'Liquidado', 'Suspendido', 'Cerrado', 'Abierto-adjudicado', 'Anulado']) {
    assert.equal(tenderSourceChangeFollowUpBlocker({ status, deadline: '2027-01-01T00:00:00Z' }, NOW), 'terminal_status', status);
  }
  assert.equal(tenderSourceChangeFollowUpBlocker({ status: 'Publicado', deadline: '2026-10-19T00:00:00Z' }, NOW), null);
});

test('disparador: nunca hacia una fase anterior, nunca porque "vuelva" el enlace, nunca sin cambio de enlace', () => {
  // La convertida ya está en la fase de oferta; llega sólo el borrador → no se mueve.
  const atOffer = draftConverted({ url: NEW_URL, ref: 'FTIC-LP-003-2026', status: 'Presentación de oferta' });
  const back = planRadarPhaseIdentitySync({ fetched: [draftRow()], existing: [atOffer], now: '2026-10-10T11:00:00.000Z' });
  assert.ok(back.opportunityPatches.every(patch => !patch.sourceChange));
  assert.equal(back.convertedOverrides[0].url, NEW_URL);
  // Sólo cambia el estado (misma URL): "Fase detectada" de siempre, sin seguimiento.
  const sameUrl = planRadarPhaseIdentitySync({ fetched: [{ ...draftRow(), status: 'Adjudicado' }], existing: [draftConverted()], now: '2026-10-10T11:00:00.000Z' });
  assert.equal(sameUrl.opportunityPatches[0]?.sourceChange ?? null, null);
});

test('disparador: la marca "detectado" es única por aviso, con la identidad técnica, y nunca para un cambio bloqueado', async () => {
  const tables = world({ psi_sales_interactions: [] });
  const db = fakeDb(tables);
  const change = { change: 'phase', url: NEW_URL, ref: 'FTIC-LP-003-2026 (Presentación de oferta)', newPhase: 'Publicado', blocker: null };
  assert.equal(await recordAgt002PhaseChangeDetected(db, 'opp-ftic', change), true);
  assert.equal(await recordAgt002PhaseChangeDetected(db, 'opp-ftic', change), false, 'idempotente entre corridas y reintentos');
  assert.equal(await recordAgt002PhaseChangeDetected(db, 'opp-plain', { ...change, blocker: 'deadline_passed' }), false);
  assert.equal(tables.psi_sales_interactions.length, 1);
  assert.equal(tables.psi_sales_interactions[0].created_by, AGT002_VIGIA_AGENT_PROFILE_ID);
});

for (const [label, server] of servers) {
  test(`importación del Radar (${label}): la marca va antes del enlace; si falla, el enlace espera a la siguiente corrida`, async () => {
    const patches = [
      { converted_opportunity_id: 'opp-ftic', sourceChange: { change: 'phase', url: NEW_URL, blocker: null } },
      { converted_opportunity_id: 'opp-closed', sourceChange: { change: 'phase', url: secopUrl('10860499'), blocker: 'deadline_passed' } },
      { converted_opportunity_id: 'opp-plain', sourceChange: null },
    ];
    const ok = fakeDb(world({ psi_sales_interactions: [] }));
    assert.deepEqual([...await server.recordAgt002RadarPhaseChanges(ok, patches)], []);
    assert.deepEqual(kinds(ok.tables), ['tender_phase_change_detected'], 'sólo el cambio vivo deja marca');
    const failing = fakeDb(world({ psi_sales_interactions: [] }));
    failing.failInserts = true;
    assert.deepEqual([...await server.recordAgt002RadarPhaseChanges(failing, patches)], ['opp-ftic'], 'sin marca, el enlace no se cambia en esta corrida');
  });

  test(`documentos (${label}): portafolio compartido entre fases → uno por nombre+tamaño y los nuevos primero`, () => {
    const doc = (id, name, size, at) => ({ id_documento: id, nombre_archivo: name, tamanno_archivo: String(size), fecha_carga: at, url_descarga_documento: { url: `https://community.secop.gov.co/Public/Archive/RetrieveFile/Index?DocumentId=${id}` } });
    const docs = [
      doc('842575433', 'ESTUDIO PREVIO.pdf', 1000, '2026-08-17T00:00:00.000'),
      doc('854439419', 'ESTUDIO PREVIO.pdf', 1000, '2026-08-17T00:00:00.000'),
      doc('842575440', 'PROYECTO DE PLIEGO.pdf', 2000, '2026-08-17T00:00:00.000'),
      doc('857255784', 'ADENDA No. 1.pdf', 300, '2026-09-13T00:00:00.000'),
      doc('856000001', 'PLIEGO DE CONDICIONES.pdf', 2500, '2026-09-07T00:00:00.000'),
    ];
    const versions = [
      { source_document_id: '842575433', name: 'ESTUDIO PREVIO.pdf', size_bytes: 1000, current: true },
      { source_document_id: '999', name: 'PROYECTO DE PLIEGO.pdf', size_bytes: 2000, current: true },
    ];
    const ordered = server.orderSecopPhaseChangeDocuments(docs, versions);
    assert.deepEqual(ordered.documents.map(item => item.id_documento), ['857255784', '856000001', '842575433', '842575440']);
    assert.equal(ordered.newCount, 2, 'el pliego definitivo y la adenda; el duplicado y lo ya importado (por id o nombre+tamaño) no');
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Paso 1: documentos.
// ---------------------------------------------------------------------------------------------------------------

test('documentos: espera a datos.gov.co y a documentos nuevos, exige el mismo conjunto en dos corridas, importa una vez', async () => {
  const tables = world();
  const db = fakeDb(tables);
  const imports = [];
  const importDocuments = async (opportunityId, options) => {
    imports.push({ opportunityId, ...options });
    tables.psi_sales_interactions.push(IMPORTED);
    return { new_count: 3, updated_count: 1, retired_count: 0 };
  };
  const run = (probeDocuments, now = NOW) => runAgt002PhaseChangeDocumentRefresh(db, { probeDocuments, importDocuments, now });
  // Día 1: datos.gov.co aún no tiene el proceso nuevo (va 1–2 días atrás).
  assert.deepEqual((await run(async () => { throw new Error('No se encontró proceso SECOP por urlproceso exacto'); })).map(e => e.event), ['agt002_phase_change_documents_pending'], 'sólo la oportunidad con cambio detectado entra');
  // Día 2: el proceso ya está, pero el portafolio sólo trae los documentos del borrador.
  const onlyDraft = { document_set_hash: 'draft', document_count: 20, new_document_count: 0, current_official_count: 20 };
  assert.deepEqual((await run(async () => onlyDraft)).map(e => e.event), ['agt002_phase_change_documents_waiting_new_documents']);
  // Día 3: aparecen los nuevos → se observa; día 4: mismo conjunto → importa.
  const full = { document_set_hash: 'full', document_count: 24, new_document_count: 4, current_official_count: 20 };
  assert.deepEqual((await run(async () => full)).map(e => e.event), ['agt002_phase_change_documents_waiting_stability']);
  assert.equal(imports.length, 0);
  assert.deepEqual((await run(async () => full)).map(e => e.event), ['agt002_phase_change_documents_imported']);
  assert.deepEqual(imports, [{ opportunityId: 'opp-ftic', noticeUid: NOTICE, actorProfileId: AGT002_VIGIA_AGENT_PROFILE_ID, expectedDocumentSetHash: 'full' }]);
  assert.match(tables.psi_sales_opportunities[0].observaciones, /^Nota escrita por Juan\n/, 'el texto escrito por personas no se toca');
  assert.ok(tables.psi_sales_opportunities[0].observaciones.endsWith(`${HEAD}; se bajaron 4 documento(s) nuevo(s) o actualizado(s); los anteriores quedan como historial.`));
  // Día 5: ya importado → no repite.
  assert.deepEqual((await run(async () => { throw new Error('no debe llamarse'); })).map(e => e.event), ['agt002_phase_change_documents_already_imported']);
  assert.equal(imports.length, 1);
  assert.equal(isPhaseChangeDocumentSetTooSmall({ documentCount: 3, currentOfficialCount: 6 }), false);
  assert.equal(isPhaseChangeDocumentSetTooSmall({ documentCount: 2, currentOfficialCount: 6 }), true);
});

test('documentos: si datos.gov.co no los publica en ~3 días, aviso visible para revisión humana (una vez) y sigue intentando', async () => {
  const tables = world();
  const db = fakeDb(tables);
  const importDocuments = async () => { throw new Error('no debe importar'); };
  const missing = async () => { throw new Error('No se encontró proceso SECOP por urlproceso exacto (CO1.NTC.11032172).'); };
  await runAgt002PhaseChangeDocumentRefresh(db, { probeDocuments: missing, importDocuments, now: new Date('2026-10-10T12:00:00.000Z') });
  assert.deepEqual(db.appended, [], 'el segundo día aún no avisa');
  await runAgt002PhaseChangeDocumentRefresh(db, { probeDocuments: missing, importDocuments, now: new Date('2026-10-11T12:00:00.000Z') });
  assert.deepEqual(db.appended, [`${HEAD}, pero datos.gov.co aún no publica sus documentos nuevos; revisar e importar a mano.`]);
  const noNew = async () => ({ document_set_hash: 'draft', document_count: 20, new_document_count: 0, current_official_count: 20 });
  await runAgt002PhaseChangeDocumentRefresh(db, { probeDocuments: noNew, importDocuments, now: new Date('2026-10-12T12:00:00.000Z') });
  assert.equal(db.appended.length, 1, 'el aviso no se repite');
});

test('documentos: un conjunto estable pero mucho menor que el vigente avisa tras ~3 corridas, una vez', async () => {
  const partial = { document_set_hash: 'p', document_count: 2, new_document_count: 2, current_official_count: 20 };
  const tables = world({ psi_sales_interactions: [DETECTED, state('tender_phase_change_documents_observed', partial, '2026-10-06T12:00:00.000Z')] });
  const db = fakeDb(tables);
  const importDocuments = async () => { throw new Error('no debe importar'); };
  await runAgt002PhaseChangeDocumentRefresh(db, { probeDocuments: async () => partial, importDocuments, now: new Date('2026-10-07T12:00:00.000Z') });
  assert.deepEqual(db.appended, []);
  const events = await runAgt002PhaseChangeDocumentRefresh(db, { probeDocuments: async () => partial, importDocuments, now: new Date('2026-10-09T12:00:00.000Z') });
  assert.deepEqual(events.map(e => e.event), ['agt002_phase_change_documents_waiting_smaller_set']);
  assert.ok(db.appended.includes(`${HEAD}, pero sus documentos en datos.gov.co están incompletos; revisar e importar a mano.`));
});

test('documentos: una importación que no trajo nada nuevo no cuenta, no se repite con el mismo conjunto y no habilita el reanálisis', async () => {
  const stable = { document_set_hash: 'h', document_count: 20, new_document_count: 1, current_official_count: 20 };
  const tables = world({ psi_sales_interactions: [DETECTED, state('tender_phase_change_documents_observed', stable, '2026-10-08T12:00:00.000Z')] });
  const db = fakeDb(tables);
  let imports = 0;
  const importDocuments = async () => {
    imports += 1;
    tables.psi_sales_interactions.push(state('tender_phase_change_documents_imported', { document_set_hash: 'h', snapshot_id: 'snap-x', changed_count: 0 }, '2026-10-09T10:00:00.000Z'));
    return { new_count: 0, updated_count: 0 };
  };
  assert.deepEqual((await runAgt002PhaseChangeDocumentRefresh(db, { probeDocuments: async () => stable, importDocuments })).map(e => e.event), ['agt002_phase_change_documents_without_changes']);
  assert.deepEqual((await runAgt002PhaseChangeDocumentRefresh(db, { probeDocuments: async () => stable, importDocuments })).map(e => e.reason), ['same_set_already_imported_without_changes']);
  assert.equal(imports, 1);
  const { calls, admit, freezeProfile } = admitSpy();
  assert.deepEqual((await runAgt002PhaseChangeAnalysisAdmissions(db, { now: NOW, environment: ON, admit, freezeProfile })).map(e => e.event), ['agt002_phase_change_analysis_waiting_documents']);
  assert.equal(calls.length, 0);
});

test('documentos: si la importación falla (p. ej. antes del snapshot) no queda marca y se reintenta', async () => {
  const stable = { document_set_hash: 'h', document_count: 24, new_document_count: 4, current_official_count: 20 };
  const tables = world({ psi_sales_interactions: [DETECTED, state('tender_phase_change_documents_observed', stable, '2026-10-08T12:00:00.000Z')] });
  const db = fakeDb(tables);
  const events = await runAgt002PhaseChangeDocumentRefresh(db, { probeDocuments: async () => stable, importDocuments: async () => { throw new Error('No fue posible iniciar la actualización documental gobernada.'); } });
  assert.deepEqual(events.map(e => e.event), ['agt002_phase_change_documents_pending']);
  assert.ok(!kinds(tables).includes('tender_phase_change_documents_imported'));
  assert.deepEqual(db.appended, []);
});

test('documentos: si el proceso cerró o terminó antes de que lleguen, no se bajan', async () => {
  const tables = world();
  tables.psi_public_tenders[0].status = 'Adjudicado';
  const events = await runAgt002PhaseChangeDocumentRefresh(fakeDb(tables), { probeDocuments: async () => { throw new Error('no debe llamarse'); }, importDocuments: async () => { throw new Error('no'); } });
  assert.deepEqual(events.map(e => [e.event, e.reason]), [['agt002_phase_change_documents_skipped', 'terminal_status']]);
});

// ---------------------------------------------------------------------------------------------------------------
// Paso 2: análisis.
// ---------------------------------------------------------------------------------------------------------------

function admitSpy(status = 'admitted') {
  const calls = [];
  const admit = async (_db, args) => { calls.push(args); return { jobId: status === 'admitted' || status === 'existing' ? `job-${calls.length}` : null, admissionStatus: status }; };
  const freezeProfile = async () => ({ profileSnapshotId: 'ps-1', profileSnapshotHash: 'a'.repeat(64) });
  return { calls, admit, freezeProfile };
}

test('cupo: la intención se registra antes de admitir, así el cupo cuenta aunque falle el registro del resultado', async () => {
  const tables = world({ psi_sales_interactions: [DETECTED, IMPORTED] });
  const db = fakeDb(tables);
  const { admit, freezeProfile } = admitSpy();
  const order = [];
  const tracingAdmit = async (...args) => { order.push(JSON.parse(tables.psi_sales_interactions.at(-1).notes).outcome); return admit(...args); };
  await runAgt002PhaseChangeAnalysisAdmissions(db, { now: NOW, environment: ON, admit: tracingAdmit, freezeProfile });
  assert.deepEqual(order, ['admitting'], 'el último registro antes de admitir es la intención');
  tables.psi_sales_interactions = tables.psi_sales_interactions.filter(row => JSON.parse(row.notes).outcome !== 'launched');
  assert.equal(await countAgt002AutomaticAnalysesToday(db, NOW), 1);
});

test('análisis: espera la marca de importación y un snapshot vigente posterior', async () => {
  const { calls, admit, freezeProfile } = admitSpy();
  const noDocs = await runAgt002PhaseChangeAnalysisAdmissions(fakeDb(world()), { now: NOW, environment: ON, admit, freezeProfile });
  assert.deepEqual(noDocs.map(e => e.event), ['agt002_phase_change_analysis_waiting_documents']);
  const staleSnapshot = world({ psi_sales_interactions: [DETECTED, IMPORTED], psi_tender_document_state: [{ opportunity_id: 'opp-ftic', current_snapshot_id: null }] });
  assert.deepEqual((await runAgt002PhaseChangeAnalysisAdmissions(fakeDb(staleSnapshot), { now: NOW, environment: ON, admit, freezeProfile })).map(e => e.reason), ['snapshot_not_current']);
  const older = world({ psi_sales_interactions: [DETECTED, IMPORTED], psi_tender_document_state: [{ opportunity_id: 'opp-ftic', current_snapshot_id: 'snap-old' }], psi_tender_document_snapshots: [{ id: 'snap-old', created_at: '2026-09-27T00:00:00.000Z' }] });
  assert.deepEqual((await runAgt002PhaseChangeAnalysisAdmissions(fakeDb(older), { now: NOW, environment: ON, admit, freezeProfile })).map(e => e.reason), ['snapshot_not_current']);
  assert.equal(calls.length, 0);
});

test('análisis: admite UN reanálisis sucesor del canónico, autorizado por quien convirtió, y no lo repite', async () => {
  const tables = world({ psi_sales_interactions: [DETECTED, IMPORTED] });
  const db = fakeDb(tables);
  const { calls, admit, freezeProfile } = admitSpy();
  const events = await runAgt002PhaseChangeAnalysisAdmissions(db, { now: NOW, environment: ON, admit, freezeProfile });
  assert.deepEqual(events.map(e => e.event), ['agt002_phase_change_analysis_admitted']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].analysisKind, 'REANALYSIS');
  assert.equal(calls[0].sourceAnalysisRunId, 'run-1');
  assert.equal(calls[0].actorProfileId, 'juan', 'convertir = autorización: el actor es quien convirtió');
  assert.equal(calls[0].attempt, `secop-phase-change:${NOTICE}`, 'una instancia por cambio de fase');
  assert.equal(calls[0].expiresAt, '2026-10-11T10:00:00.000Z', 'ventana G1 determinista desde la importación');
  assert.ok(tables.psi_sales_opportunities[0].observaciones.endsWith(`${HEAD}; se lanzó el reanálisis automático.`));
  assert.equal(await countAgt002AutomaticAnalysesToday(db, NOW), 1, 'cuenta contra el cupo automático');
  const again = await runAgt002PhaseChangeAnalysisAdmissions(db, { now: new Date('2026-10-10T16:00:00.000Z'), environment: ON, admit, freezeProfile });
  assert.deepEqual(again.map(e => e.event), ['agt002_phase_change_analysis_already_resolved']);
  assert.equal(calls.length, 1, 'nunca en bucle');
});

test('análisis: INITIAL cuando la oportunidad aún no tiene análisis completado', async () => {
  const { calls, admit, freezeProfile } = admitSpy();
  const tables = world({ psi_sales_interactions: [DETECTED, IMPORTED], psi_agt002_initial_analysis_jobs: [], psi_tender_analysis_runs: [] });
  await runAgt002PhaseChangeAnalysisAdmissions(fakeDb(tables), { now: NOW, environment: ON, admit, freezeProfile });
  assert.equal(calls[0].analysisKind, 'INITIAL');
  assert.equal(calls[0].sourceAnalysisRunId, null);
  assert.match(tables.psi_sales_opportunities[0].observaciones, /se lanzó el análisis inicial automático\./);
});

test('análisis: si el proceso cerró antes del reanálisis, no se lanza y queda el aviso (una vez)', async () => {
  const { calls, admit, freezeProfile } = admitSpy();
  const tables = world({ psi_sales_interactions: [DETECTED, IMPORTED] });
  tables.psi_public_tenders[0].deadline_at = '2026-10-09T00:00:00+00:00';
  const db = fakeDb(tables);
  const events = await runAgt002PhaseChangeAnalysisAdmissions(db, { now: NOW, environment: ON, admit, freezeProfile });
  assert.deepEqual(events.map(e => [e.event, e.reason]), [['agt002_phase_change_analysis_skipped', 'deadline_passed']]);
  assert.ok(db.appended.includes(`${HEAD}; el proceso ya cerró o terminó en SECOP; no se reanaliza.`));
  assert.deepEqual((await runAgt002PhaseChangeAnalysisAdmissions(db, { now: new Date('2026-10-10T16:00:00.000Z'), environment: ON, admit, freezeProfile })).map(e => e.event), ['agt002_phase_change_analysis_already_resolved']);
  assert.equal(calls.length, 0);
});

test('análisis: un resultado no admitido no dice "se lanzó" y no se reintenta hasta mañana', async () => {
  const { calls, admit, freezeProfile } = admitSpy('empty');
  const tables = world({ psi_sales_interactions: [DETECTED, IMPORTED] });
  const db = fakeDb(tables);
  const first = await runAgt002PhaseChangeAnalysisAdmissions(db, { now: NOW, environment: ON, admit, freezeProfile });
  assert.deepEqual(first.map(e => e.event), ['agt002_phase_change_analysis_not_admitted']);
  assert.doesNotMatch(tables.psi_sales_opportunities[0].observaciones, /se lanzó/);
  assert.match(tables.psi_sales_opportunities[0].observaciones, /no se pudo lanzar \(empty\); se reintenta mañana\./);
  const sameDay = await runAgt002PhaseChangeAnalysisAdmissions(db, { now: new Date(NOW.getTime() + 600_000), environment: ON, admit, freezeProfile });
  assert.deepEqual(sameDay.map(e => e.reason), ['retry_tomorrow']);
  assert.equal(calls.length, 1, 'sin repetir la admisión en cada tick');
  assert.equal(await countAgt002AutomaticAnalysesToday(db, NOW), 1, 'la intención registrada antes de admitir cuenta (nunca se subcuenta el cupo)');
});

test('cupo: sólo cuentan las admisiones automáticas; un reanálisis manual no lo consume', async () => {
  const manualReanalyses = Array.from({ length: 5 }, (_, index) => ({ id: `m${index}`, opportunity_id: `other-${index}`, status: 'COMPLETED', analysis_kind: 'REANALYSIS', created_at: '2026-10-09T13:00:00.000Z' }));
  const tables = world({ psi_sales_interactions: [DETECTED, IMPORTED] });
  tables.psi_agt002_initial_analysis_jobs.push(...manualReanalyses);
  const { calls, admit, freezeProfile } = admitSpy();
  await runAgt002PhaseChangeAnalysisAdmissions(fakeDb(tables), { now: NOW, dailyCap: 5, environment: ON, admit, freezeProfile });
  assert.equal(calls.length, 1, 'cinco reanálisis manuales hoy no bloquean el automático');
});

test('cupo: compartido con el análisis al convertir; lleno → pendiente con aviso, una vez, y al día siguiente se lanza', async () => {
  const autoInitials = Array.from({ length: 5 }, (_, index) => ({ id: `j${index}`, opportunity_id: `other-${index}`, status: 'COMPLETED', analysis_kind: 'INITIAL', created_at: '2026-10-09T13:00:00.000Z' }));
  const tables = world({ psi_sales_interactions: [DETECTED, IMPORTED] });
  tables.psi_agt002_initial_analysis_jobs.push(...autoInitials);
  const db = fakeDb(tables);
  const { calls, admit, freezeProfile } = admitSpy();
  const events = await runAgt002PhaseChangeAnalysisAdmissions(db, { now: NOW, dailyCap: 5, environment: ON, admit, freezeProfile });
  assert.deepEqual(events.map(e => [e.event, e.reason]), [['agt002_phase_change_analysis_deferred', 'daily_cap']]);
  assert.equal(calls.length, 0);
  assert.ok(db.appended.includes(`${HEAD}; reanálisis automático pendiente por cupo diario; se intenta mañana.`));
  const again = await runAgt002PhaseChangeAnalysisAdmissions(db, { now: new Date(NOW.getTime() + 600_000), dailyCap: 5, environment: ON, admit, freezeProfile });
  assert.deepEqual(again.map(e => e.reason), ['retry_tomorrow']);
  assert.equal(db.appended.filter(line => /cupo diario/.test(line)).length, 1);
  const tomorrow = await runAgt002PhaseChangeAnalysisAdmissions(db, { now: new Date('2026-10-10T14:00:00.000Z'), dailyCap: 5, environment: ON, admit, freezeProfile });
  assert.deepEqual(tomorrow.map(e => e.event), ['agt002_phase_change_analysis_admitted']);
  assert.equal(calls.length, 1);
});

test('un job atascado en NEEDS_ATTENTION no deja el cambio esperando para siempre (ventana de 48 h); interruptores apagados', async () => {
  const { calls, admit, freezeProfile } = admitSpy();
  const tables = world({ psi_sales_interactions: [DETECTED, IMPORTED] });
  tables.psi_agt002_initial_analysis_jobs[0] = { ...tables.psi_agt002_initial_analysis_jobs[0], status: 'NEEDS_ATTENTION' };
  const within = await runAgt002PhaseChangeAnalysisAdmissions(fakeDb(tables), { now: NOW, environment: ON, admit, freezeProfile });
  assert.deepEqual(within.map(e => e.reason), ['analysis_in_progress']);
  const later = await runAgt002PhaseChangeAnalysisAdmissions(fakeDb(tables), { now: new Date('2026-10-12T15:00:00.000Z'), environment: ON, admit, freezeProfile });
  assert.deepEqual(later.map(e => e.reason), ['authorization_window_elapsed']);
  assert.match(tables.psi_sales_opportunities[0].observaciones, /requiere lanzarse manualmente/);
  const off = await runAgt002PhaseChangeAnalysisAdmissions(fakeDb(tables), { now: NOW, environment: {}, admit, freezeProfile });
  assert.deepEqual(off.map(e => e.event), ['agt002_phase_change_analysis_disabled']);
  assert.equal(calls.length, 0);
});

test('plan puro de análisis', () => {
  const imported = { created_at: '2026-10-09T10:00:00.000Z', payload: {} };
  const rec = (outcome, at) => ({ created_at: at, payload: { outcome } });
  assert.equal(planAgt002PhaseChangeAnalysis({ imported, now: NOW, analysisRecords: [rec('launched', '2026-10-09T11:00:00.000Z')] }).action, 'done');
  assert.equal(planAgt002PhaseChangeAnalysis({ imported, now: NOW, analysisRecords: [rec('process_closed', '2026-10-09T11:00:00.000Z')] }).action, 'done');
  assert.equal(planAgt002PhaseChangeAnalysis({ imported, now: NOW, jobs: [{ status: 'QUEUED', created_at: '2026-10-09T11:00:00.000Z' }] }).action, 'done', 'un análisis manual posterior también resuelve');
  assert.equal(planAgt002PhaseChangeAnalysis({ imported, now: NOW, blocker: 'terminal_status' }).action, 'process_closed');
  assert.equal(planAgt002PhaseChangeAnalysis({ imported, now: new Date('2026-10-10T15:00:00.000Z'), analysisRecords: [rec('daily_cap', '2026-10-09T11:00:00.000Z')], canonical: { id: 'r', analysis_kind: 'INITIAL' } }).action, 'admit', 'al día siguiente se reintenta');
  assert.equal(planAgt002PhaseChangeAnalysis({ imported, now: NOW, canonical: { id: 'legacy', analysis_kind: null } }).analysisKind, 'INITIAL');
});
