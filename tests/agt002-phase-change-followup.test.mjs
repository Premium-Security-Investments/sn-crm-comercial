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
  reconcileAgt002PendingPhaseChanges,
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
          tables[name].push({ id: `ins-${clock}`, created_at: new Date((row.occurred_at ? Date.parse(row.occurred_at) : NOW.getTime()) + clock).toISOString(), ...row });
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
const IMPORTED = state('tender_phase_change_documents_imported', { new_set_hash: 'set-1', snapshot_id: 'snap-new', started_at: '2026-10-09T09:59:00.000Z', document_count: 24, new_document_count: 4, retired_count: 0 }, '2026-10-09T10:00:00.000Z');
const HEAD = 'SECOP publicó el pliego definitivo (fase de oferta) (CO1.NTC.11032172)';

function world(overrides = {}) {
  return {
    psi_public_tenders: [
      { id: 't-ftic', ref: 'FTIC-LP-003-2026', url: NEW_URL, status: 'Publicado', deadline_at: '2026-10-19T00:00:00+00:00', converted_opportunity_id: 'opp-ftic', internal_status: 'convertida_oportunidad', reviewed_by: 'juan' },
      { id: 't-plain', ref: 'LP-010-2026', url: OLD_URL, status: 'Publicado', deadline_at: '2026-10-30T00:00:00+00:00', converted_opportunity_id: 'opp-plain', internal_status: 'convertida_oportunidad', reviewed_by: 'juan' },
    ],
    psi_sales_opportunities: [
      { id: 'opp-ftic', observaciones: `Nota escrita por Juan\nLink fuente: ${NEW_URL}`, service_type_code: 'licitacion_publica', stage_code: 'prospecto' },
      { id: 'opp-plain', observaciones: `Link fuente: ${OLD_URL}`, service_type_code: 'licitacion_publica', stage_code: 'prospecto' },
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

  test(`documentos (${label}): portafolio compartido → uno por nombre (el más reciente), nuevos primero, frente a la línea base`, () => {
    const doc = (id, name, size, at) => ({ id_documento: id, nombre_archivo: name, tamanno_archivo: String(size), fecha_carga: at, url_descarga_documento: { url: `https://community.secop.gov.co/Public/Archive/RetrieveFile/Index?DocumentId=${id}` } });
    const docs = [
      doc('842575433', 'ESTUDIO PREVIO.pdf', 1000, '2026-08-17T00:00:00.000'),
      doc('854439419', 'ESTUDIO PREVIO.pdf', 1000, '2026-08-17T00:00:00.000'),
      doc('842575440', 'PROYECTO DE PLIEGO.pdf', 2000, '2026-08-17T00:00:00.000'),
      doc('857255784', 'ADENDA No. 1.pdf', 300, '2026-09-13T00:00:00.000'),
      doc('856000001', 'PLIEGO DE CONDICIONES.pdf', 2500, '2026-09-07T00:00:00.000'),
      // Cali Contratación: mismo nombre que un documento del borrador, otro contenido, cargado después.
      doc('843000001', '4. Matriz de Riesgos Vigilancia II.pdf', 326760, '2026-08-27T00:00:00.000'),
      doc('858000001', '4. Matriz de Riesgos Vigilancia II.pdf', 207113, '2026-09-10T00:00:00.000'),
    ];
    const baseline = [
      { source_document_id: '842575433', name: 'ESTUDIO PREVIO.pdf', size_bytes: 1000 },
      { source_document_id: '999', name: 'PROYECTO DE PLIEGO.pdf', size_bytes: 2000 },
      { source_document_id: '843000001', name: '4. Matriz de Riesgos Vigilancia II.pdf', size_bytes: 326760 },
    ];
    const ordered = server.orderSecopPhaseChangeDocuments(docs, baseline);
    assert.deepEqual(ordered.documents.map(item => item.id_documento), ['857255784', '858000001', '856000001', '842575433', '842575440']);
    assert.equal(ordered.newCount, 3, 'adenda, matriz nueva y pliego definitivo; el duplicado y lo ya conocido (id o nombre+tamaño) no');
    assert.ok(!ordered.documents.some(item => item.id_documento === '843000001'), 'la versión vieja del mismo nombre nunca se procesa: no puede volver a quedar vigente');
    assert.deepEqual([...ordered.newIds].sort(), ['856000001', '857255784', '858000001']);
    assert.equal(server.orderSecopPhaseChangeDocuments(docs, baseline).newSetHash, ordered.newSetHash, 'huella determinista');
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Paso 1: documentos.
// ---------------------------------------------------------------------------------------------------------------

const probeOf = (newSetHash, newCount, { documents = 24, current = 20 } = {}) => async () => ({ new_set_hash: newSetHash, new_document_count: newCount, document_count: documents, current_official_count: current });
const at = iso => new Date(iso);

test('documentos: espera a datos.gov.co y a documentos nuevos, exige el mismo conjunto ≥12 h, importa una vez', async () => {
  const tables = world();
  const db = fakeDb(tables);
  const imports = [];
  const importDocuments = async (opportunityId, options) => {
    imports.push({ opportunityId, ...options });
    tables.psi_sales_interactions.push(state('tender_phase_change_documents_imported', { new_set_hash: options.expectedNewSetHash, snapshot_id: 'snap-new', new_document_count: 4, retired_count: 0 }, '2026-10-10T10:00:00.000Z'));
    return { retired_count: 0 };
  };
  const run = (probeDocuments, now) => runAgt002PhaseChangeDocumentRefresh(db, { probeDocuments, importDocuments, now: at(now) });
  assert.deepEqual((await run(async () => { throw new Error('No se encontró proceso SECOP por urlproceso exacto'); }, '2026-10-08T14:00:00Z')).map(e => e.event), ['agt002_phase_change_documents_pending'], 'sólo la oportunidad con cambio detectado entra');
  assert.deepEqual((await run(probeOf('none', 0), '2026-10-08T15:00:00Z')).map(e => e.event), ['agt002_phase_change_documents_waiting_new_documents']);
  assert.deepEqual((await run(probeOf('full', 4), '2026-10-08T20:00:00Z')).map(e => e.event), ['agt002_phase_change_documents_waiting_stability']);
  assert.deepEqual((await run(probeOf('full', 4), '2026-10-09T02:00:00Z')).map(e => e.event), ['agt002_phase_change_documents_waiting_stability'], 'menos de 12 h: aún no');
  assert.equal(imports.length, 0);
  assert.deepEqual((await run(probeOf('full', 4), '2026-10-09T09:00:00Z')).map(e => e.event), ['agt002_phase_change_documents_imported']);
  assert.deepEqual(imports, [{ opportunityId: 'opp-ftic', noticeUid: NOTICE, actorProfileId: AGT002_VIGIA_AGENT_PROFILE_ID, expectedNewSetHash: 'full', baselineAt: '2026-10-08T11:00:00.000Z' }]);
  assert.match(tables.psi_sales_opportunities[0].observaciones, /^Nota escrita por Juan\n/, 'el texto escrito por personas no se toca');
  assert.ok(tables.psi_sales_opportunities[0].observaciones.endsWith(`${HEAD}; el 9-oct se bajaron 4 documento(s) nuevo(s); los anteriores quedan como historial.`));
  assert.deepEqual((await run(probeOf('full', 4), '2026-10-09T10:00:00Z')).map(e => e.event), ['agt002_phase_change_documents_already_imported']);
  assert.equal(imports.length, 1);
  assert.equal(isPhaseChangeDocumentSetTooSmall({ documentCount: 3, currentOfficialCount: 6 }), false);
  assert.equal(isPhaseChangeDocumentSetTooSmall({ documentCount: 2, currentOfficialCount: 6 }), true);
});

test('B1 (revisión): una descarga fallida o la migración 116 sin aplicar no traban el seguimiento; se retoma y reanaliza', async () => {
  // Línea base: lo que la oportunidad tenía ANTES de la marca. Lo bajado después (importación a medias o "Actualizar
  // documentos" a mano) sigue contando como nuevo: el conjunto nuevo no desaparece.
  const server = servers[0][1];
  const draft = Array.from({ length: 19 }, (_, i) => ({ id_documento: String(800 + i), nombre_archivo: `borrador-${i}.pdf`, tamanno_archivo: String(1000 + i), fecha_carga: '2026-09-25T00:00:00.000', url_descarga_documento: { url: 'https://x' } }));
  const versions = draft.map(d => ({ source_document_id: d.id_documento, name: d.nombre_archivo, size_bytes: Number(d.tamanno_archivo), current: true, created_at: '2026-09-26T12:00:00.000Z' }));
  const portfolio = [...draft, { id_documento: '900', nombre_archivo: 'PLIEGO DEFINITIVO.pdf', tamanno_archivo: '5000', fecha_carga: '2026-10-08T00:00:00.000', url_descarga_documento: { url: 'https://x' } }];
  const probe = async (_opportunityId, { baselineAt }) => {
    const ordered = server.orderSecopPhaseChangeDocuments(portfolio, versions.filter(v => Date.parse(v.created_at) < Date.parse(baselineAt)));
    return { new_set_hash: ordered.newSetHash, document_count: ordered.documents.length, new_document_count: ordered.newCount, current_official_count: versions.length };
  };
  const tables = world({ psi_sales_interactions: [DETECTED] });
  const db = fakeDb(tables);
  let attempts = 0;
  const importDocuments = async (_id, options) => {
    attempts += 1;
    // La descarga del pliego quedó grabada antes de fallar (o fue un "Actualizar documentos" a mano).
    versions.push({ source_document_id: '900', name: 'PLIEGO DEFINITIVO.pdf', size_bytes: 5000, current: true, created_at: new Date().toISOString() });
    if (attempts < 3) throw new Error(attempts === 1 ? 'Fase nueva: 1 documento(s) nuevo(s) aún no se pudieron descargar' : 'retiro de documentos anteriores: function not found (¿migración 116 aplicada?)');
    tables.psi_sales_interactions.push(state('tender_phase_change_documents_imported', { new_set_hash: options.expectedNewSetHash, snapshot_id: 'snap-new', new_document_count: 1 }, '2026-10-10T08:05:00.000Z'));
    return { retired_count: 0 };
  };
  const log = [];
  for (const when of ['2026-10-08T13:05:00Z', '2026-10-09T13:05:00Z', '2026-10-09T14:05:00Z', '2026-10-09T17:05:00Z', '2026-10-09T19:05:00Z', '2026-10-10T08:05:00Z', '2026-10-10T09:05:00Z']) {
    const events = await runAgt002PhaseChangeDocumentRefresh(db, { probeDocuments: probe, importDocuments, now: at(when) });
    log.push(events.map(e => e.event.replace('agt002_phase_change_documents_', '') + (e.reason ? `(${e.reason})` : '')).join(','));
  }
  assert.deepEqual(log, [
    'waiting_stability',
    'pending(import_failed)',
    'deferred(retry_after_failure)',
    'pending(import_failed)',
    'deferred(retry_after_failure)',
    'imported',
    'already_imported',
  ]);
  assert.ok(!db.appended.some(line => /aún no publica/.test(line)), 'sin aviso engañoso de "documentos que no llegan"');
  const { calls, admit, freezeProfile } = admitSpy();
  tables.psi_tender_document_state[0].current_snapshot_id = 'snap-new';
  await runAgt002PhaseChangeAnalysisAdmissions(db, { now: at('2026-10-10T09:10:00Z'), environment: ON, admit, freezeProfile });
  assert.equal(calls.length, 1, 'el reanálisis se lanza');
});

test('documentos: si datos.gov.co no los publica en ~3 días, aviso visible para revisión humana (una vez) y sigue intentando', async () => {
  const tables = world();
  const db = fakeDb(tables);
  const importDocuments = async () => { throw new Error('no debe importar'); };
  const missing = async () => { throw new Error('No se encontró proceso SECOP por urlproceso exacto (CO1.NTC.11032172).'); };
  await runAgt002PhaseChangeDocumentRefresh(db, { probeDocuments: missing, importDocuments, now: at('2026-10-10T12:00:00.000Z') });
  assert.deepEqual(db.appended, [], 'el segundo día aún no avisa');
  await runAgt002PhaseChangeDocumentRefresh(db, { probeDocuments: missing, importDocuments, now: at('2026-10-11T12:00:00.000Z') });
  assert.deepEqual(db.appended, [`${HEAD}, pero datos.gov.co aún no publica sus documentos nuevos; revisar e importar a mano.`]);
  await runAgt002PhaseChangeDocumentRefresh(db, { probeDocuments: probeOf('none', 0), importDocuments, now: at('2026-10-12T12:00:00.000Z') });
  assert.equal(db.appended.length, 1, 'el aviso no se repite');
});

test('I5: un conjunto que no se estabiliza en ~3 días deja aviso visible (una vez)', async () => {
  const tables = world();
  const db = fakeDb(tables);
  const importDocuments = async () => { throw new Error('no debe importar'); };
  let n = 0;
  for (const when of ['2026-10-08T13:00:00Z', '2026-10-09T09:00:00Z', '2026-10-10T09:00:00Z', '2026-10-11T09:00:00Z', '2026-10-11T19:00:00Z']) {
    n += 1;
    await runAgt002PhaseChangeDocumentRefresh(db, { probeDocuments: probeOf(`set-${n}`, n), importDocuments, now: at(when) });
  }
  assert.deepEqual(db.appended, [`${HEAD}, pero sus documentos en datos.gov.co siguen cambiando desde hace 3 días; revisar e importar a mano.`]);
});

test('documentos: un conjunto estable pero mucho menor que el vigente avisa tras ~3 días, una vez', async () => {
  const tables = world({ psi_sales_interactions: [DETECTED, state('tender_phase_change_documents_observed', { new_set_hash: 'p' }, '2026-10-06T12:00:00.000Z')] });
  const db = fakeDb(tables);
  const importDocuments = async () => { throw new Error('no debe importar'); };
  const partial = probeOf('p', 2, { documents: 2, current: 20 });
  await runAgt002PhaseChangeDocumentRefresh(db, { probeDocuments: partial, importDocuments, now: at('2026-10-07T12:00:00.000Z') });
  assert.deepEqual(db.appended, []);
  const events = await runAgt002PhaseChangeDocumentRefresh(db, { probeDocuments: partial, importDocuments, now: at('2026-10-09T12:00:00.000Z') });
  assert.deepEqual(events.map(e => e.event), ['agt002_phase_change_documents_waiting_smaller_set']);
  assert.ok(db.appended.includes(`${HEAD}, pero sus documentos en datos.gov.co están incompletos; revisar e importar a mano.`));
});

test('I3: documentos que llegan en dos tandas → dos importaciones y un reanálisis por conjunto, nunca dos por el mismo', async () => {
  const tables = world({ psi_sales_interactions: [DETECTED] });
  const db = fakeDb(tables);
  const importDocuments = async (_id, options) => {
    tables.psi_sales_interactions.push(state('tender_phase_change_documents_imported', { new_set_hash: options.expectedNewSetHash, snapshot_id: `snap-${options.expectedNewSetHash}`, new_document_count: options.expectedNewSetHash === 'a' ? 1 : 3 }, new Date(clockNow.getTime() + 1000).toISOString()));
    tables.psi_tender_document_state[0].current_snapshot_id = `snap-${options.expectedNewSetHash}`;
    return { retired_count: 0 };
  };
  const { calls, admit, freezeProfile } = admitSpy();
  let clockNow;
  const day = async (when, probe) => {
    clockNow = at(when);
    const docs = await runAgt002PhaseChangeDocumentRefresh(db, { probeDocuments: probe, importDocuments, now: clockNow });
    const analysis = await runAgt002PhaseChangeAnalysisAdmissions(db, { now: new Date(clockNow.getTime() + 60_000), environment: ON, admit, freezeProfile });
    return [...docs, ...analysis].map(e => e.event.replace('agt002_phase_change_', ''));
  };
  await day('2026-10-08T13:00:00Z', probeOf('a', 1)); // sólo la resolución de apertura
  assert.deepEqual(await day('2026-10-09T13:00:00Z', probeOf('a', 1)), ['documents_imported', 'analysis_admitted']);
  tables.psi_agt002_initial_analysis_jobs.push({ id: 'job-a', opportunity_id: 'opp-ftic', status: 'COMPLETED', analysis_kind: 'REANALYSIS', created_at: '2026-10-09T13:01:30.000Z' });
  assert.deepEqual(await day('2026-10-10T13:00:00Z', probeOf('b', 3)), ['documents_waiting_stability', 'analysis_already_resolved']);
  assert.deepEqual(await day('2026-10-11T13:00:00Z', probeOf('b', 3)), ['documents_imported', 'analysis_admitted']);
  assert.deepEqual(await day('2026-10-12T13:00:00Z', probeOf('b', 3)), ['documents_already_imported', 'analysis_already_resolved']);
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].attempt, calls[1].attempt, 'una instancia de flujo por conjunto');
  assert.ok(calls.every(call => call.attempt.startsWith(`secop-phase-change:${NOTICE}:`)));
});

test('I4: presupuesto de tiempo — lo que no alcanza queda para la siguiente pasada, sin fallar', async () => {
  const tables = world({ psi_sales_interactions: [DETECTED, { ...DETECTED, id: 'd2', opportunity_id: 'opp-plain', notes: JSON.stringify({ kind: 'tender_phase_change_detected', notice_uid: 'CO1.NTC.10911657', url: OLD_URL, detected_at: '2026-10-08T11:00:00.000Z' }) }] });
  let fake = 0;
  const events = await runAgt002PhaseChangeDocumentRefresh(fakeDb(tables), {
    probeDocuments: async () => { fake += 700_000; return { new_set_hash: 'x', new_document_count: 1, document_count: 20, current_official_count: 20 }; },
    importDocuments: async () => { throw new Error('no'); }, now: NOW, budgetMs: 600_000, clock: () => fake,
  });
  assert.deepEqual(events.map(e => [e.event, e.reason]), [['agt002_phase_change_documents_waiting_stability', undefined], ['agt002_phase_change_documents_deferred', 'time_budget']]);
});

test('I2: sólo oportunidades activas (Por decidir / En curso); proceso terminal, NO GO, terminal de oferta o perdida no bajan nada', async () => {
  const closedProcess = world();
  closedProcess.psi_public_tenders[0].status = 'Adjudicado';
  const lost = world();
  lost.psi_sales_opportunities[0].stage_code = 'perdido';
  // Etapa derivada de la bandeja (classifyOpportunityStage): NO GO humano vigente o estado de oferta terminal = Cerradas.
  const noGo = world({ psi_tender_go_no_go_decisions: [
    { id: 'g1', opportunity_id: 'opp-ftic', tender_id: 't-ftic', decision: 'go', decided_at: '2026-10-01T00:00:00Z' },
    { id: 'g2', opportunity_id: 'opp-ftic', tender_id: 't-ftic', decision: 'no_go', decided_at: '2026-10-05T00:00:00Z', supersedes_decision_id: 'g1' },
  ] });
  const awarded = world();
  awarded.psi_sales_opportunities[0].tender_offer_status = 'no_adjudicada';
  for (const [tables, reason] of [[closedProcess, 'terminal_status'], [lost, 'opportunity_closed'], [noGo, 'opportunity_closed'], [awarded, 'opportunity_closed']]) {
    const events = await runAgt002PhaseChangeDocumentRefresh(fakeDb(tables), { probeDocuments: async () => { throw new Error('no debe llamarse'); }, importDocuments: async () => { throw new Error('no'); } });
    assert.deepEqual(events.map(e => [e.event, e.reason]), [['agt002_phase_change_documents_skipped', reason]]);
  }
  const goInPreparation = world({ psi_tender_go_no_go_decisions: [{ id: 'g1', opportunity_id: 'opp-ftic', tender_id: 't-ftic', decision: 'go', decided_at: '2026-10-01T00:00:00Z' }] });
  goInPreparation.psi_sales_opportunities[0].tender_offer_status = 'en_preparacion';
  const events = await runAgt002PhaseChangeDocumentRefresh(fakeDb(goInPreparation), { probeDocuments: probeOf('none', 0), importDocuments: async () => { throw new Error('no'); } });
  assert.deepEqual(events.map(e => e.event), ['agt002_phase_change_documents_waiting_new_documents'], 'En curso (GO, en preparación) sí se sigue');
});

test('I1: conciliación — enlace vigente distinto del aviso del que vienen los documentos → cambio pendiente (sólo si sigue vivo)', async () => {
  const refresh = (opportunityId, noticeUid, createdAt) => ({ id: `r-${opportunityId}-${createdAt}`, opportunity_id: opportunityId, interaction_type: 'documento', created_at: createdAt, notes: JSON.stringify({ kind: 'tender_document_refresh', source: 'SECOP II', notice_uid: noticeUid }) });
  const tables = world({ psi_sales_interactions: [refresh('opp-ftic', 'CO1.NTC.10911657', '2026-09-26T12:00:00.000Z'), refresh('opp-plain', 'CO1.NTC.10911657', '2026-09-26T12:00:00.000Z')] });
  tables.psi_public_tenders.push({ id: 't-closed', ref: 'LP-004-2026', url: secopUrl('10860499'), status: 'Abierto', deadline_at: '2026-09-18T00:00:00+00:00', converted_opportunity_id: 'opp-closed', internal_status: 'convertida_oportunidad', source: 'SECOP II' });
  tables.psi_sales_opportunities.push({ id: 'opp-closed', stage_code: 'prospecto', observaciones: '' });
  tables.psi_sales_interactions.push(refresh('opp-closed', 'CO1.NTC.10729711', '2026-08-20T12:00:00.000Z'));
  const db = fakeDb(tables);
  const events = await reconcileAgt002PendingPhaseChanges(db, { now: NOW });
  assert.deepEqual(events.map(e => [e.opportunityId, e.event.replace('agt002_phase_change_', ''), e.reason || null]), [
    ['opp-ftic', 'reconciled', null],
    ['opp-closed', 'reconcile_skipped', 'deadline_passed'],
  ], 'opp-plain sigue en el aviso del que vienen sus documentos');
  assert.deepEqual((await reconcileAgt002PendingPhaseChanges(db, { now: NOW })).map(e => e.opportunityId), ['opp-closed'], 'idempotente');
  const marks = tables.psi_sales_interactions.map(row => JSON.parse(row.notes)).filter(n => n.kind === 'tender_phase_change_detected');
  assert.deepEqual(marks.map(n => [n.notice_uid, n.origin]), [[NOTICE, 'reconciliation']]);
});

test('cierre en hora Bogotá: la fecha sin zona de datos.gov.co es medianoche de Colombia', () => {
  assert.equal(tenderSourceChangeFollowUpBlocker({ status: 'Publicado', deadline: '2026-10-19T00:00:00.000' }, at('2026-10-19T04:30:00Z')), null, '18-oct 23:30 Bogotá: sigue abierto');
  assert.equal(tenderSourceChangeFollowUpBlocker({ status: 'Publicado', deadline: '2026-10-19T00:00:00+00:00' }, at('2026-10-19T05:00:00Z')), 'deadline_passed');
  assert.equal(tenderSourceChangeFollowUpBlocker({ status: 'Publicado', deadline: '2026-10-19T09:00:00' }, at('2026-10-19T13:59:00Z')), null, '8:59 Bogotá');
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

const ANALYSIS_HEAD = `${HEAD}; documentos del 9-oct: `;

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
  assert.equal(calls[0].attempt, `secop-phase-change:${NOTICE}:set-1`, 'una instancia por conjunto importado');
  assert.equal(calls[0].expiresAt, '2026-10-11T10:00:00.000Z', 'ventana G1 determinista desde la importación');
  assert.ok(tables.psi_sales_opportunities[0].observaciones.endsWith(`${ANALYSIS_HEAD}se lanzó el reanálisis automático.`));
  assert.equal(await countAgt002AutomaticAnalysesToday(db, NOW), 1, 'cuenta contra el cupo automático');
  const again = await runAgt002PhaseChangeAnalysisAdmissions(db, { now: at('2026-10-10T16:00:00.000Z'), environment: ON, admit, freezeProfile });
  assert.deepEqual(again.map(e => e.event), ['agt002_phase_change_analysis_already_resolved']);
  assert.equal(calls.length, 1, 'nunca en bucle');
});

test('análisis: INITIAL sin análisis completado; REANALYSIS si el canónico es de un motor anterior (sin tipo)', async () => {
  const { calls, admit, freezeProfile } = admitSpy();
  const tables = world({ psi_sales_interactions: [DETECTED, IMPORTED], psi_agt002_initial_analysis_jobs: [], psi_tender_analysis_runs: [] });
  await runAgt002PhaseChangeAnalysisAdmissions(fakeDb(tables), { now: NOW, environment: ON, admit, freezeProfile });
  assert.equal(calls[0].analysisKind, 'INITIAL');
  assert.equal(calls[0].sourceAnalysisRunId, null);
  assert.match(tables.psi_sales_opportunities[0].observaciones, /se lanzó el análisis inicial automático\./);
  const legacy = world({ psi_sales_interactions: [DETECTED, IMPORTED], psi_agt002_initial_analysis_jobs: [], psi_tender_analysis_runs: [{ id: 'legacy', opportunity_id: 'opp-ftic', canonical: true, status: 'completed', analysis_kind: null }] });
  await runAgt002PhaseChangeAnalysisAdmissions(fakeDb(legacy), { now: NOW, environment: ON, admit, freezeProfile });
  assert.deepEqual([calls[1].analysisKind, calls[1].sourceAnalysisRunId], ['REANALYSIS', 'legacy']);
});

test('análisis: si el proceso cerró (o la oportunidad se cerró) antes del reanálisis, no se lanza y queda el aviso (una vez)', async () => {
  const { calls, admit, freezeProfile } = admitSpy();
  const tables = world({ psi_sales_interactions: [DETECTED, IMPORTED] });
  tables.psi_public_tenders[0].deadline_at = '2026-10-09T00:00:00+00:00';
  const db = fakeDb(tables);
  const events = await runAgt002PhaseChangeAnalysisAdmissions(db, { now: NOW, environment: ON, admit, freezeProfile });
  assert.deepEqual(events.map(e => [e.event, e.reason]), [['agt002_phase_change_analysis_skipped', 'deadline_passed']]);
  assert.ok(db.appended.includes(`${ANALYSIS_HEAD}el proceso ya cerró o terminó en SECOP, o la oportunidad se cerró; no se reanaliza.`));
  assert.deepEqual((await runAgt002PhaseChangeAnalysisAdmissions(db, { now: at('2026-10-10T16:00:00.000Z'), environment: ON, admit, freezeProfile })).map(e => e.event), ['agt002_phase_change_analysis_already_resolved']);
  const discarded = world({ psi_sales_interactions: [DETECTED, IMPORTED] });
  discarded.psi_sales_opportunities[0].stage_code = 'descartado';
  assert.deepEqual((await runAgt002PhaseChangeAnalysisAdmissions(fakeDb(discarded), { now: NOW, environment: ON, admit, freezeProfile })).map(e => e.reason), ['opportunity_closed']);
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
  assert.ok(db.appended.includes(`${ANALYSIS_HEAD}reanálisis automático pendiente por cupo diario; se intenta mañana.`));
  const again = await runAgt002PhaseChangeAnalysisAdmissions(db, { now: new Date(NOW.getTime() + 600_000), dailyCap: 5, environment: ON, admit, freezeProfile });
  assert.deepEqual(again.map(e => e.reason), ['retry_tomorrow']);
  assert.equal(db.appended.filter(line => /cupo diario/.test(line)).length, 1);
  const tomorrow = await runAgt002PhaseChangeAnalysisAdmissions(db, { now: at('2026-10-10T14:00:00.000Z'), dailyCap: 5, environment: ON, admit, freezeProfile });
  assert.deepEqual(tomorrow.map(e => e.event), ['agt002_phase_change_analysis_admitted']);
  assert.equal(calls.length, 1);
});

test('un job atascado en NEEDS_ATTENTION no deja el cambio esperando para siempre (ventana de 48 h); interruptores apagados', async () => {
  const { calls, admit, freezeProfile } = admitSpy();
  const tables = world({ psi_sales_interactions: [DETECTED, IMPORTED] });
  tables.psi_agt002_initial_analysis_jobs[0] = { ...tables.psi_agt002_initial_analysis_jobs[0], status: 'NEEDS_ATTENTION' };
  const within = await runAgt002PhaseChangeAnalysisAdmissions(fakeDb(tables), { now: NOW, environment: ON, admit, freezeProfile });
  assert.deepEqual(within.map(e => e.reason), ['analysis_in_progress']);
  const later = await runAgt002PhaseChangeAnalysisAdmissions(fakeDb(tables), { now: at('2026-10-11T15:00:00.000Z'), environment: ON, admit, freezeProfile });
  assert.deepEqual(later.map(e => e.reason), ['authorization_window_elapsed']);
  assert.match(tables.psi_sales_opportunities[0].observaciones, /requiere lanzarse manualmente/);
  const off = await runAgt002PhaseChangeAnalysisAdmissions(fakeDb(tables), { now: NOW, environment: {}, admit, freezeProfile });
  assert.deepEqual(off.map(e => e.event), ['agt002_phase_change_analysis_disabled']);
  assert.equal(calls.length, 0);
});

test('plan puro de análisis', () => {
  const imported = { created_at: '2026-10-09T10:00:00.000Z', payload: {} };
  const rec = (outcome, when) => ({ created_at: when, payload: { outcome } });
  assert.equal(planAgt002PhaseChangeAnalysis({ imported, now: NOW, analysisRecords: [rec('launched', '2026-10-09T11:00:00.000Z')] }).action, 'done');
  assert.equal(planAgt002PhaseChangeAnalysis({ imported, now: NOW, analysisRecords: [rec('process_closed', '2026-10-09T11:00:00.000Z')] }).action, 'done');
  assert.equal(planAgt002PhaseChangeAnalysis({ imported, now: NOW, jobs: [{ status: 'QUEUED', created_at: '2026-10-09T11:00:00.000Z' }] }).action, 'done', 'un análisis manual posterior también resuelve');
  assert.equal(planAgt002PhaseChangeAnalysis({ imported, now: NOW, blocker: 'terminal_status' }).action, 'process_closed');
  assert.equal(planAgt002PhaseChangeAnalysis({ imported, now: at('2026-10-10T15:00:00.000Z'), analysisRecords: [rec('daily_cap', '2026-10-09T11:00:00.000Z')], canonical: { id: 'r', analysis_kind: 'INITIAL' } }).action, 'admit', 'al día siguiente se reintenta');
  assert.deepEqual(planAgt002PhaseChangeAnalysis({ imported, now: NOW, canonical: { id: 'legacy', analysis_kind: null } }), { action: 'admit', analysisKind: 'REANALYSIS', sourceAnalysisRunId: 'legacy' });
});

test('I4: los documentos tienen servicio propio cada hora, con presupuesto; la cadena diaria sólo marca', async () => {
  const { readFileSync } = await import('node:fs');
  const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
  const runner = read('../ops/agt002-radar-daily/run-agt002-radar-import.mjs');
  const daily = runner.match(/async function runDaily\(\) \{[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(daily, /PhaseChange/, 'la cadena diaria (escaneo, conciliación, Top 5) no espera descargas');
  assert.match(runner, /if \(mode === '--phase-change-documents'\) await runPhaseChangeDocuments\(\);/);
  assert.match(runner, /reconcileAgt002PendingPhaseChanges/);
  const service = read('../ops/agt002-radar-daily/agt002-phase-change-documents.service');
  assert.match(service, /--phase-change-documents/);
  assert.match(service, /AGT002_PHASE_CHANGE_DOCUMENTS_BUDGET_MS=600000/);
  assert.match(service, /TimeoutStartSec=20min/);
  assert.match(read('../ops/agt002-radar-daily/agt002-phase-change-documents.timer'), /OnUnitInactiveSec=1h/);
});
