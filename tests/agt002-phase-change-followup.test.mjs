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
import { countAgt002AutomaticAnalysesToday, listAgt002PhaseChangeAdmissionsToday } from '../agt002-auto-initial.js';
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
const HEAD = 'SECOP publicó el pliego definitivo (fase de oferta) (visto el 8-oct)';

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
  const line = phaseChangeDetectedLine({ change: change.change, newPhase: change.newPhase, ref: change.ref, url: change.url, detectedAt: change.detectedAt, noticeUid: NOTICE });
  assert.equal(line, `SECOP publicó el pliego definitivo (fase de oferta) (visto el 10-oct); el enlace de la oportunidad se actualizó (${NEW_URL}) y Vig-IA bajará sus documentos y lanzará el reanálisis.`);
  assert.doesNotMatch(line.replace(NEW_URL, ''), /CO1\./, 'el aviso no muestra códigos internos; sólo el enlace');
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

test('documentos: espera a datos.gov.co y a documentos nuevos, la revisión siguiente confirma la misma lista e importa una vez', async () => {
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
  assert.deepEqual((await run(probeOf('full', 4), '2026-10-08T20:10:00Z')).map(e => e.event), ['agt002_phase_change_documents_waiting_stability'], 'una repetición inmediata (minutos) no cuenta como la revisión siguiente');
  assert.equal(imports.length, 0);
  assert.deepEqual((await run(probeOf('full', 4), '2026-10-08T21:00:00Z')).map(e => e.event), ['agt002_phase_change_documents_imported'], 'la revisión siguiente con la misma lista importa');
  assert.deepEqual(imports, [{ opportunityId: 'opp-ftic', noticeUid: NOTICE, actorProfileId: AGT002_VIGIA_AGENT_PROFILE_ID, expectedNewSetHash: 'full', baselineAt: '2026-10-08T11:00:00.000Z' }]);
  assert.match(tables.psi_sales_opportunities[0].observaciones, /^Nota escrita por Juan\n/, 'el texto escrito por personas no se toca');
  assert.ok(tables.psi_sales_opportunities[0].observaciones.endsWith(`${HEAD}; el 8-oct se bajaron 4 documento(s) nuevo(s).`));
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
  assert.equal((await listAgt002PhaseChangeAdmissionsToday(db, NOW)).length, 1, 'la intención cuenta para la red de seguridad');
  assert.equal(await countAgt002AutomaticAnalysesToday(db, NOW), 0, 'no consume el cupo del análisis al convertir');
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
  assert.equal(await countAgt002AutomaticAnalysesToday(db, NOW), 0, 'fuera del cupo de 5 del análisis al convertir (decisión del dueño)');
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
  assert.equal((await listAgt002PhaseChangeAdmissionsToday(db, NOW)).length, 1, 'la intención registrada antes de admitir cuenta para la red de seguridad');
});

test('un reanálisis manual no cuenta para la red de seguridad', async () => {
  const manualReanalyses = Array.from({ length: 5 }, (_, index) => ({ id: `m${index}`, opportunity_id: `other-${index}`, status: 'COMPLETED', analysis_kind: 'REANALYSIS', created_at: '2026-10-09T13:00:00.000Z' }));
  const tables = world({ psi_sales_interactions: [DETECTED, IMPORTED] });
  tables.psi_agt002_initial_analysis_jobs.push(...manualReanalyses);
  const { calls, admit, freezeProfile } = admitSpy();
  await runAgt002PhaseChangeAnalysisAdmissions(fakeDb(tables), { now: NOW, dailyCap: 5, environment: ON, admit, freezeProfile });
  assert.equal(calls.length, 1, 'cinco reanálisis manuales hoy no bloquean el automático');
});

test('decisión del dueño: con el cupo de 5 del análisis al convertir lleno, el reanálisis por fase nueva igual se lanza', async () => {
  const autoInitials = Array.from({ length: 5 }, (_, index) => ({ id: `j${index}`, opportunity_id: `other-${index}`, status: 'COMPLETED', analysis_kind: 'INITIAL', created_at: '2026-10-09T13:00:00.000Z' }));
  const tables = world({ psi_sales_interactions: [DETECTED, IMPORTED] });
  tables.psi_agt002_initial_analysis_jobs.push(...autoInitials);
  const { calls, admit, freezeProfile } = admitSpy();
  const events = await runAgt002PhaseChangeAnalysisAdmissions(fakeDb(tables), { now: NOW, environment: ON, admit, freezeProfile });
  assert.deepEqual(events.map(e => e.event), ['agt002_phase_change_analysis_admitted']);
  assert.equal(calls.length, 1);
});

test('una fase nueva que lanza el INITIAL (sin análisis previo) no le quita cupo al análisis al convertir', async () => {
  const tables = world({ psi_sales_interactions: [DETECTED, IMPORTED], psi_agt002_initial_analysis_jobs: [], psi_tender_analysis_runs: [] });
  const db = fakeDb(tables);
  const { admit, freezeProfile } = admitSpy();
  await runAgt002PhaseChangeAnalysisAdmissions(db, { now: NOW, environment: ON, admit: async (...args) => { tables.psi_agt002_initial_analysis_jobs.push({ id: 'pc', opportunity_id: 'opp-ftic', status: 'QUEUED', analysis_kind: 'INITIAL', created_at: NOW.toISOString() }); return admit(...args); }, freezeProfile });
  assert.equal(await countAgt002AutomaticAnalysesToday(db, NOW), 0);
});

test('red de seguridad técnica: 3 por proceso y 20 en total por día; si se alcanza, aviso visible y se intenta mañana', async () => {
  const intents = (opportunityId, n) => Array.from({ length: n }, (_, index) => ({ id: `i-${opportunityId}-${index}`, opportunity_id: opportunityId, interaction_type: 'documento', created_at: '2026-10-09T13:00:00.000Z', notes: JSON.stringify({ kind: 'tender_phase_change_analysis', notice_uid: 'x', new_set_hash: `old-${index}`, outcome: 'admitting', analysis_kind: 'REANALYSIS' }) }));
  const perProcess = world({ psi_sales_interactions: [DETECTED, IMPORTED, ...intents('opp-ftic', 3)] });
  const db = fakeDb(perProcess);
  const { calls, admit, freezeProfile } = admitSpy();
  const events = await runAgt002PhaseChangeAnalysisAdmissions(db, { now: NOW, environment: ON, admit, freezeProfile });
  assert.deepEqual(events.map(e => [e.event, e.reason]), [['agt002_phase_change_analysis_deferred', 'safety_limit']]);
  assert.ok(db.appended.includes(`${ANALYSIS_HEAD}reanálisis automático pendiente: se alcanzó el límite técnico de seguridad del día; se intenta mañana (revisar si hay un error).`));
  assert.deepEqual((await runAgt002PhaseChangeAnalysisAdmissions(db, { now: new Date(NOW.getTime() + 600_000), environment: ON, admit, freezeProfile })).map(e => e.reason), ['retry_tomorrow']);
  assert.deepEqual((await runAgt002PhaseChangeAnalysisAdmissions(db, { now: at('2026-10-10T14:00:00.000Z'), environment: ON, admit, freezeProfile })).map(e => e.event), ['agt002_phase_change_analysis_admitted'], 'al día siguiente se lanza');
  const total = world({ psi_sales_interactions: [DETECTED, IMPORTED, ...Array.from({ length: 20 }, (_, i) => intents(`otra-${i}`, 1)[0])] });
  assert.deepEqual((await runAgt002PhaseChangeAnalysisAdmissions(fakeDb(total), { now: NOW, environment: ON, admit, freezeProfile })).map(e => e.reason), ['safety_limit']);
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

test('horario: un servicio propio lun–vie 9/14/19 h y sáb–dom 14 h (Bogotá); la cadena diaria y auto-initial no lo ejecutan', async () => {
  const { readFileSync } = await import('node:fs');
  const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
  const runner = read('../ops/agt002-radar-daily/run-agt002-radar-import.mjs');
  const daily = runner.match(/async function runDaily\(\) \{[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(daily, /PhaseChange/, 'la cadena diaria (escaneo, conciliación, Top 5) no espera descargas');
  assert.match(runner, /if \(mode === '--phase-change-review'\) await runPhaseChangeReview\(\);/);
  assert.doesNotMatch(read('../ops/agt002-auto-initial/run-agt002-auto-initial.mjs'), /PhaseChange/, 'el reanálisis por fase nueva lo lanza la revisión, no auto-initial');
  const service = read('../ops/agt002-radar-daily/agt002-phase-change-review.service');
  assert.match(service, /--phase-change-review/);
  assert.match(service, /StateDirectory=agt002-licitaciones-alerts/);
  assert.match(service, /EnvironmentFile=\/etc\/psi-agt002-initial-analysis\/env/);
  const timer = read('../ops/agt002-radar-daily/agt002-phase-change-review.timer');
  assert.match(timer, /^OnCalendar=Mon\.\.Fri \*-\*-\* 09,14,19:00:00 America\/Bogota$/m);
  assert.match(timer, /^OnCalendar=Sat,Sun \*-\*-\* 14:00:00 America\/Bogota$/m);
});

function writableDb(tables) {
  const db = fakeDb(tables);
  const base = db.from.bind(db);
  db.updates = [];
  db.from = name => {
    const chain = base(name);
    chain.update = values => {
      const filters = [];
      const exec = () => { for (const row of (tables[name] || []).filter(r => filters.every(f => f(r)))) { Object.assign(row, values); db.updates.push({ table: name, id: row.id, values }); } return { data: null, error: null }; };
      const upd = { eq(c, v) { filters.push(r => r[c] === v); return upd; }, then(resolve) { resolve(exec()); } };
      return upd;
    };
    chain.in = (column, values) => chain.then ? Object.assign(chain, { then(resolve) { resolve({ data: (tables[name] || []).filter(r => values.includes(r[column])), error: null }); } }) : chain;
    return chain;
  };
  return db;
}

for (const [label, server] of servers) {
  test(`detección horaria (${label}): sólo convertidas activas, idempotente, sin licitaciones nuevas`, async () => {
    const tables = world({ psi_sales_interactions: [] });
    tables.psi_public_tenders = [
      { ...draftConverted(), id: 't-ftic', stable_key: 'ftic-conv' },
      { ...draftConverted({ stable_key: 'nogo', converted_opportunity_id: 'opp-nogo', entity: 'OTRA', ref: 'LP-9-2026' }), id: 't-nogo' },
    ];
    tables.psi_sales_opportunities.push({ id: 'opp-nogo', stage_code: 'prospecto', tender_offer_status: 'cerrada_no_go', observaciones: '' });
    const db = writableDb(tables);
    const seen = [];
    const fetchFamilies = async rows => { seen.push(...rows.map(r => r.stable_key)); return [draftRow(), offerRow()]; };
    const isActive = row => row.converted_opportunity_id !== 'opp-nogo';
    const first = await server.syncConvertedTenderPhaseLinks(db, { isActive, fetchFamilies, now: '2026-10-10T16:00:00.000Z' });
    assert.deepEqual(seen, ['ftic-conv'], 'sólo se consulta la familia de las activas');
    assert.equal(first.changed, 1);
    assert.equal(tables.psi_public_tenders[0].url, NEW_URL);
    assert.equal(tables.psi_public_tenders.length, 2, 'nunca escribe licitaciones nuevas');
    assert.deepEqual(kinds(tables), ['tender_phase_change_detected']);
    assert.match(tables.psi_sales_opportunities[0].observaciones, /Link fuente: .*11032172/);
    const second = await server.syncConvertedTenderPhaseLinks(db, { isActive, fetchFamilies, now: '2026-10-10T17:00:00.000Z' });
    assert.equal(second.changed, 0, 'idempotente: la hora siguiente (o la cadena diaria) no vuelve a cambiar nada');
    assert.deepEqual(kinds(tables), ['tender_phase_change_detected']);
  });
}

test('(e) fase nueva: sin 116 no se descarga nada; lo anterior pasa a historial sólo después de bajar bien el conjunto nuevo', async () => {
  const { readFileSync } = await import('node:fs');
  for (const path of ['../server/index.js', '../api/[...path].js']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    const body = source.match(/async function importOfficialTenderDocuments\([\s\S]*?\n}\n/)[0];
    const preflight = body.indexOf('requireTenderDocumentRetirement(database)');
    const downloads = body.indexOf('refreshTenderDocumentBatch(');
    const failedCheck = body.indexOf('AGT002_PHASE_CHANGE_DOWNLOAD_FAILED');
    const retire = body.indexOf('retireSupersededOfficialTenderDocuments(');
    assert.ok(preflight > -1 && preflight < downloads, `${path}: comprobación de la 116 antes de descargar`);
    assert.ok(downloads < failedCheck && failedCheck < retire, `${path}: el retiro va después de una descarga completa`);
    assert.ok(retire < body.indexOf('psi_begin_tender_document_refresh'), `${path}: y antes de fijar el snapshot`);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Archivado de obsoletos, correo (outbox para Hermes) y revisión completa.
// ---------------------------------------------------------------------------------------------------------------

const { planObsoleteTenderDocuments } = await import('../tender-document-obsolescence.js');
const alerts = await import('../agt002-licitaciones-alerts.js');
const { runAgt002PhaseChangeReview } = await import('../agt002-phase-change-review.js');

test('archivado (Fondo Único, nombres reales del borrador): proyecto de pliego, anexo técnico y anexos editables; nada protegido', () => {
  const draft = ['CAPACIDAD FINANCIERA SEG. PRIVADA.pdf', 'COTIZACIONES.zip', 'OFERTA ECONOMICA VIGILANCIA.xlsx', '1. Estudios_Previos_Vigilancia 2026 (1).pdf',
    'Concepto - Proceso Vigilancia 2026 ajustado VF.pdf', 'Registro_2-2026-064809 aprobacion Hacienda (2).pdf', '2. ANALISIS DEL SECTOR VIGILANCIA 2026 VF (1).pdf',
    'Aviso del articulo 30 de la Ley 80 de 1993 .pdf', '4. MEMORIA DE CALCULO VGILANCIA VF.xlsx', '3. ANEXO TECNICO VIGILANCIA 2026 (1).pdf',
    'Solicitud Vigencia futura.pdf', 'CDP-188326-ADICION VIGILANCIA-SUB ADMTVA-FUTIC.pdf', 'ANEXOS EDITABLES FTIC-LP-003-2026.docx', 'PROYECTO PLIEGO DE CONDICIONES.pdf'];
  const plan = planObsoleteTenderDocuments({ currentNames: draft, incomingNames: ['PLIEGO DE CONDICIONES DEFINITIVO FTIC-LP-003-2026.pdf', '3. ANEXO TECNICO DEFINITIVO VIGILANCIA 2026.pdf', 'ANEXOS EDITABLES DEFINITIVOS FTIC-LP-003-2026.docx', 'RESOLUCION DE APERTURA FTIC-LP-003-2026.pdf'] });
  assert.deepEqual(plan.archive.map(item => [item.name, item.reason]).sort(), [
    ['3. ANEXO TECNICO VIGILANCIA 2026 (1).pdf', 'anexo_tecnico_del_borrador'],
    ['ANEXOS EDITABLES FTIC-LP-003-2026.docx', 'formato_con_version_nueva'],
    ['PROYECTO PLIEGO DE CONDICIONES.pdf', 'proyecto_de_pliego'],
  ]);
  assert.deepEqual(plan.doubts, []);
  const onlyResolution = planObsoleteTenderDocuments({ currentNames: draft, incomingNames: ['RESOLUCION DE APERTURA FTIC-LP-003-2026.pdf'] });
  assert.deepEqual(onlyResolution.archive, [], 'sin pliego definitivo, el proyecto sigue vigente');
});

test('archivado (DANE LP-001-2026, nombres reales): por tanda; adendas, estudios previos y CDP nunca; dudas avisadas', () => {
  const base = ['Aviso Convocatoria LP-001-2026 (Rev).pdf', 'Anexo N°. 1 Especificaciones Tecnicas.pdf', 'Anexo N°. 3 Matriz de Riesgos.xlsx', 'Anexo N° 4. Oferta Económica.xlsx',
    'Formatos LP-001-2026 Vigilancia VF.zip', 'Proyecto Pliego Condiciones LP-001-2026  Vigilancia V25-08-2026.pdf', 'Anexo N° 6. CDP 96426.pdf',
    'Estudios Previos Vigilancia 2026_VF En limpio (Firmado).pdf', 'Anexo N°. 2 Análisis del Sector Vigilancia 2026.pdf', 'Anexo N° 5. Consolidado_Costos_Vigilancia 2026-2029.xlsx'];
  const sep20 = ['Resolución Apertura LP-001-2026 (Suscrita).pdf', 'Pliego de Condiciones Definitivo LP-001-2026 Vigilancia (21-09-2026).pdf', 'Estudios Previos Vigilancia 2026_VF  Definitivo.pdf', 'Formatos Definitivos LP-001-2026.zip', 'Anexos al Estudio Previo LP-001-2026 Definitivos.zip'];
  const first = planObsoleteTenderDocuments({ currentNames: base, incomingNames: sep20 });
  assert.deepEqual(first.archive.map(item => item.name).sort(), ['Formatos LP-001-2026 Vigilancia VF.zip', 'Proyecto Pliego Condiciones LP-001-2026  Vigilancia V25-08-2026.pdf']);
  const current = [...base.filter(name => !first.archive.some(item => item.name === name)), ...sep20];
  const sep29 = ['Anexo N°. 1 Especificaciones Tecnicas Consolidado Adenda 03.pdf', 'Solicitud Adenda N° 03 Componente Tecnico.pdf', 'Anexo N°. 5 Consolidado_Costos_Vigilancia 2026-2029 Adenda 03.xlsx',
    'Anexo N°. 4 Oferta Economica Consolidado Adenda 03.xlsx', 'Adenda N° 03 LP-001-2026.pdf', 'Formato N° 4 Apoyo a la Industria Nacional Discapacidad Mujeres Consolidado Adenda 03.docx',
    'Estudios Previos Vigilancia 2026 Consolidado Adenda 03.pdf', 'Anexo N°. 3 Matriz de Riesgos Consolidado Adenda 03.xlsx', 'Solicitud Adenda N° 03 Componente Juridico.pdf',
    'Pliego de Condiciones Definitivo LP-001-2026 Consolidado Adenda 03.pdf'];
  const third = planObsoleteTenderDocuments({ currentNames: [...current, 'Adenda N° 01 LP-001-2026 (Suscrita).pdf'], incomingNames: sep29 });
  assert.deepEqual(third.archive.map(item => item.name).sort(), ['Anexo N° 4. Oferta Económica.xlsx', 'Anexo N° 5. Consolidado_Costos_Vigilancia 2026-2029.xlsx', 'Anexo N°. 1 Especificaciones Tecnicas.pdf', 'Anexo N°. 3 Matriz de Riesgos.xlsx']);
  assert.ok(third.doubts.some(item => item.name.startsWith('Pliego de Condiciones Definitivo LP-001-2026 Vigilancia')), 'un pliego definitivo reemplazado por el consolidado es duda: no se archiva');
  const protectedNames = [...third.archive, ...first.archive].map(item => item.name).filter(name => /estudio|cdp|adenda n° 01|aviso|an[aá]lisis del sector/i.test(name));
  assert.deepEqual(protectedNames, []);
});

test('correo: un outbox por revisión, destinatarios fijos, licitación por entidad y valor, id estable', () => {
  const items = alerts.agt002AlertItems({
    detections: [{ opportunityId: 'opp-ftic', noticeUid: NOTICE, url: NEW_URL, change: { change: 'phase', ref: 'FTIC-LP-003-2026 (Presentación de oferta)' } }],
    documents: [{ opportunityId: 'opp-ftic', setHash: 'set-1', newDocuments: 2, incomingNames: ['PLIEGO DEFINITIVO.pdf', 'RESOLUCION.pdf'], archived: [{ name: 'PROYECTO PLIEGO DE CONDICIONES.pdf', replacedBy: 'PLIEGO DEFINITIVO.pdf' }], doubts: [] }],
    analyses: [{ opportunityId: 'opp-ftic', setHash: 'set-1', outcome: 'launched' }],
  }, { day: '2026-10-13' });
  const opportunities = new Map([['opp-ftic', { entity: 'FONDO UNICO DE TECNOLOGÍAS DE LA INFORMACIÓN Y LAS COMUNICACIONES', value: 4250000000, title: 'Vigilancia' }]]);
  const outbox = alerts.buildAgt002AlertsOutbox({ runId: 'r1', generatedAt: '2026-10-13T14:00:03.000Z', slot: '09:00', items, opportunities });
  const [message] = outbox.messages;
  assert.equal(outbox.contract, 'agt002-licitaciones-alerts-v1');
  assert.deepEqual(message.to, ['juanbotero@premiumsecurity.ai', 'directora.licitaciones@seguridadnacional.co']);
  assert.deepEqual(message.cc, []);
  assert.match(message.subject, /^Vig-IA Licitaciones: novedades en SECOP — FONDO UNICO .* — \$4\.250\.000\.000$/);
  assert.match(message.text, /SECOP publicó el pliego definitivo/);
  assert.match(message.text, /Pasaron a historial \(ya no entran al análisis\): PROYECTO PLIEGO DE CONDICIONES\.pdf \(lo reemplaza PLIEGO DEFINITIVO\.pdf\)/);
  assert.match(message.text, /Se lanzó el reanálisis automático/);
  assert.match(message.text, /Ver en el CRM: https:\/\/seguridad-nacional-crm\.vercel\.app\/#\/detail\/opp-ftic/);
  assert.doesNotMatch(message.subject, /CO1\.|LP-003|opp-/, 'el asunto no usa códigos internos');
  assert.match(message.id, /^[0-9a-f]{64}$/);
  assert.equal(alerts.buildAgt002AlertsOutbox({ runId: 'r2', generatedAt: '2026-10-13T15:00:00.000Z', slot: '10:00', items, opportunities }).messages[0].id, message.id, 'mismas novedades → mismo id');
  assert.equal(alerts.buildAgt002AlertsOutbox({ runId: 'r3', generatedAt: '2026-10-13T15:00:00.000Z', items: [] }), null);
});

function memoryFs() {
  const files = new Map();
  return {
    files,
    mkdirSync() {},
    readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return files.get(path); },
    writeFileSync(path, content) { files.set(path, String(content)); },
    renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); },
  };
}

test('revisión completa: detecta, confirma, baja, archiva, reanaliza, informa el resultado después y no repite correos', async () => {
  const tables = world({ psi_sales_interactions: [DETECTED], psi_agt002_initial_analysis_jobs: [], psi_tender_analysis_runs: [{ id: 'run-1', opportunity_id: 'opp-ftic', canonical: true, status: 'completed', analysis_kind: 'INITIAL', result: {} }] });
  tables.psi_public_tenders[0] = { ...tables.psi_public_tenders[0], entity: 'FONDO UNICO DE TECNOLOGÍAS DE LA INFORMACIÓN Y LAS COMUNICACIONES', value: 4250000000, title: 'Vigilancia' };
  const db = fakeDb(tables);
  const fs = memoryFs();
  fs.files.set('/alerts/reported-keys.json', JSON.stringify({ keys: {} }));
  const api = {
    syncConvertedTenderPhaseLinks: async () => ({ active: 1, changed: 0 }),
    probePhaseChangeTenderDocumentSet: async () => ({ new_set_hash: 'set-a', new_document_count: 2, document_count: 21, current_official_count: 19 }),
    importPhaseChangeTenderDocuments: async (_database, opportunityId, options) => {
      tables.psi_sales_interactions.push(state('tender_phase_change_documents_imported', { new_set_hash: options.expectedNewSetHash, snapshot_id: 'snap-a', new_document_count: 2, incoming_names: ['PLIEGO DE CONDICIONES DEFINITIVO.pdf', 'RESOLUCION DE APERTURA.pdf'], archived: [{ name: 'PROYECTO PLIEGO DE CONDICIONES.pdf', replacedBy: 'PLIEGO DE CONDICIONES DEFINITIVO.pdf' }] }, new Date(Date.parse(options.now || '2026-10-13T19:00:01Z')).toISOString()));
      tables.psi_tender_document_state[0].current_snapshot_id = 'snap-a';
      return { retired_count: 1, incoming_names: ['PLIEGO DE CONDICIONES DEFINITIVO.pdf', 'RESOLUCION DE APERTURA.pdf'], archived: [{ name: 'PROYECTO PLIEGO DE CONDICIONES.pdf', replacedBy: 'PLIEGO DE CONDICIONES DEFINITIVO.pdf' }], archive_doubts: [] };
    },
  };
  const { admit, freezeProfile, calls } = admitSpy();
  const logs = [];
  const review = when => runAgt002PhaseChangeReview(db, { api, environment: ON, now: at(when), stateDir: '/alerts', fsImpl: fs, admit, freezeProfile, log: event => logs.push(event) });
  const r1 = await review('2026-10-13T14:00:00Z'); // 9:00: detectado (cadena diaria) + documentos observados
  assert.deepEqual(r1.items.map(item => item.type), ['link']);
  const r2 = await review('2026-10-13T19:00:00Z'); // 14:00: la misma lista → baja, archiva y lanza
  assert.deepEqual(r2.items.map(item => item.type).sort(), ['analysis', 'documents'], JSON.stringify(logs.filter(e => /analysis/.test(e.event))));
  assert.equal(calls.length, 1);
  assert.match(r2.outbox.messages[0].text, /PROYECTO PLIEGO DE CONDICIONES\.pdf/);
  tables.psi_agt002_initial_analysis_jobs.push({ id: 'job-1', opportunity_id: 'opp-ftic', status: 'COMPLETED', analysis_kind: 'REANALYSIS', analysis_run_id: 'run-2', created_at: '2026-10-13T19:00:30.000Z' });
  tables.psi_tender_analysis_runs.push({ id: 'run-2', opportunity_id: 'opp-ftic', canonical: false, status: 'completed', result: { recommendation: { label: 'Conviene presentarse', confidence: 'MEDIA' } } });
  const r3 = await review('2026-10-14T00:00:00Z'); // 19:00: resultado del reanálisis
  assert.deepEqual(r3.items.map(item => item.type), ['result']);
  assert.match(r3.outbox.messages[0].text, /Terminó el reanálisis: Conviene presentarse \(confianza media\)/);
  assert.ok(tables.psi_sales_opportunities[0].observaciones.includes('el reanálisis terminó — Conviene presentarse (confianza media)'));
  const r4 = await review('2026-10-14T14:00:00Z');
  assert.equal(r4.outbox, null, 'sin novedad no hay correo');
  assert.ok(fs.files.has('/alerts/outbox-latest.json'));
  assert.equal([...fs.files.keys()].filter(path => /\/outbox-2026.*\.json$/.test(path)).length, 3);
  assert.equal(calls.length, 1, 'un solo reanálisis por tanda');
});

// ---------------------------------------------------------------------------------------------------------------
// Correcciones de la revisión independiente de 3aecfa2.
// ---------------------------------------------------------------------------------------------------------------

test('I-A: una importación sin documentos nuevos o actualizados por contenido no reanaliza ni avisa, aunque cambie la huella', async () => {
  const tables = world({ psi_sales_interactions: [DETECTED, IMPORTED, state('tender_phase_change_analysis', { new_set_hash: 'set-1', outcome: 'launched', job_id: 'j1' }, '2026-10-09T10:05:00.000Z'),
    state('tender_phase_change_documents_observed', { new_set_hash: 'set-2' }, '2026-10-09T11:00:00.000Z')] });
  const db = fakeDb(tables);
  const importDocuments = async (_id, options) => {
    tables.psi_sales_interactions.push(state('tender_phase_change_documents_imported', { new_set_hash: options.expectedNewSetHash, snapshot_id: 'snap-2', new_document_count: 4, changed_count: 0 }, '2026-10-09T15:00:01.000Z'));
    return { changed_count: 0, retired_count: 0, incoming_names: ['pliego vigilancia RH1.pdf'], archived: [], archive_doubts: [] };
  };
  const events = await runAgt002PhaseChangeDocumentRefresh(db, { probeDocuments: probeOf('set-2', 4), importDocuments, now: NOW });
  assert.deepEqual(events.map(e => e.event), ['agt002_phase_change_documents_imported_without_changes']);
  assert.deepEqual(db.appended, [], 'sin aviso de documentos');
  const { calls, admit, freezeProfile } = admitSpy();
  const analysis = await runAgt002PhaseChangeAnalysisAdmissions(db, { now: new Date(NOW.getTime() + 60_000), environment: ON, admit, freezeProfile });
  assert.deepEqual(analysis.map(e => e.event), ['agt002_phase_change_analysis_already_resolved'], 'se queda con la importación anterior, ya reanalizada');
  assert.equal(calls.length, 0);
  assert.deepEqual((await runAgt002PhaseChangeDocumentRefresh(db, { probeDocuments: probeOf('set-2', 4), importDocuments: async () => { throw new Error('no debe reimportar'); }, now: new Date(NOW.getTime() + 3600_000) })).map(e => e.event), ['agt002_phase_change_documents_already_imported']);
  assert.deepEqual(db.appended, []);
});

for (const [label, server] of servers) {
  test(`I-A (${label}): una fila repetida del mismo archivo con otro id no cambia la huella del conjunto nuevo (dup.mjs)`, () => {
    const base = [{ id_documento: '800', nombre_archivo: 'ESTUDIOS PREVIOS.pdf', tamanno_archivo: '10', fecha_carga: '2026-09-13T00:00:00.000', url_descarga_documento: { url: 'https://x' } }];
    const versions = [{ source_document_id: '800', name: 'ESTUDIOS PREVIOS.pdf', size_bytes: 10 }];
    const pliego = { id_documento: '870211922', nombre_archivo: 'pliego vigilancia RH1.pdf', tamanno_archivo: '1365278', fecha_carga: '2026-10-07T00:00:00.000', url_descarga_documento: { url: 'https://x' } };
    const a = server.orderSecopPhaseChangeDocuments([...base, pliego], versions);
    const b = server.orderSecopPhaseChangeDocuments([...base, pliego, { ...pliego, id_documento: '871000000' }], versions);
    assert.equal(b.newSetHash, a.newSetHash);
    assert.equal(b.newCount, 1);
  });

  test(`I-B (${label}): la detección diaria no marca ni avisa a una oportunidad NO GO`, async () => {
    const tables = world({ psi_sales_interactions: [], psi_tender_go_no_go_decisions: [{ id: 'g', opportunity_id: 'opp-ftic', tender_id: 't-ftic', decision: 'no_go', decided_at: '2026-10-01T00:00:00Z' }] });
    tables.psi_sales_opportunities.push({ id: 'opp-active', stage_code: 'prospecto', observaciones: '' });
    const patches = [
      { converted_opportunity_id: 'opp-ftic', sourceChange: { change: 'phase', url: NEW_URL, blocker: null } },
      { converted_opportunity_id: 'opp-active', sourceChange: { change: 'phase', url: secopUrl('5'), blocker: null } },
    ];
    const db = fakeDb(tables);
    await server.recordAgt002RadarPhaseChanges(db, patches);
    assert.deepEqual(tables.psi_sales_interactions.map(row => row.opportunity_id), ['opp-active'], 'sólo la activa');
    assert.equal(patches[0].sourceChange.blocker, 'opportunity_closed', 'tampoco recibe el aviso visible');
  });
}

test('I-B: el correo nunca informa una marca de una oportunidad que ya no está activa', async () => {
  const { listRecentAgt002PhaseChangeDetections } = await import('../agt002-phase-change-review.js');
  const tables = world({ psi_sales_interactions: [{ ...DETECTED, created_at: '2026-10-09T10:00:00.000Z' }] });
  assert.equal((await listRecentAgt002PhaseChangeDetections(fakeDb(tables), { now: NOW })).length, 1);
  tables.psi_sales_opportunities[0].tender_offer_status = 'cerrada_no_go';
  assert.deepEqual(await listRecentAgt002PhaseChangeDetections(fakeDb(tables), { now: NOW }), []);
});

test('menor 1: los protegidos se evalúan primero (respuestas, avisos y estudios previos que mencionan el proyecto de pliego)', () => {
  const current = ['PROYECTO PLIEGO DE CONDICIONES.pdf', 'Respuesta a observaciones al proyecto de pliego.pdf', 'Aviso de convocatoria y proyecto de pliego.pdf', 'Estudio previo y proyecto de pliego.pdf', 'Informe de respuestas observaciones proyecto de pliego de condiciones.pdf'];
  const plan = planObsoleteTenderDocuments({ currentNames: current, incomingNames: ['PLIEGO DE CONDICIONES DEFINITIVO.pdf'] });
  assert.deepEqual(plan.archive.map(item => item.name), ['PROYECTO PLIEGO DE CONDICIONES.pdf']);
  const fromProtected = planObsoleteTenderDocuments({ currentNames: ['PROYECTO PLIEGO DE CONDICIONES.pdf'], incomingNames: ['Respuesta a observaciones al proyecto de pliego.pdf'] });
  assert.deepEqual(fromProtected.archive, [], 'una respuesta a observaciones no es un pliego definitivo');
});

test('menor 2: sin reported-keys.json no se reinforman marcas viejas; se reconstruye desde los outbox; una falla del outbox no deja la novedad perdida', async () => {
  const tables = world({ psi_sales_interactions: [DETECTED] });
  const api = { syncConvertedTenderPhaseLinks: async () => ({}), probePhaseChangeTenderDocumentSet: async () => { throw new Error('aún no'); }, importPhaseChangeTenderDocuments: async () => { throw new Error('no'); } };
  const fs1 = memoryFs();
  const stale = await runAgt002PhaseChangeReview(fakeDb(tables), { api, environment: {}, now: at('2026-10-10T14:00:00Z'), stateDir: '/a', fsImpl: fs1 });
  assert.equal(stale.outbox, null, 'una marca de hace días no se reinforma si el estado se perdió');
  const fresh = await runAgt002PhaseChangeReview(fakeDb(tables), { api, environment: {}, now: at('2026-10-08T14:00:00Z'), stateDir: '/a', fsImpl: memoryFs() });
  assert.deepEqual(fresh.items.map(item => item.type), ['link'], 'una marca de las últimas horas sí');
  // Reconstrucción desde un outbox existente.
  const fs2 = memoryFs();
  fs2.readdirSync = () => ['outbox-x.json', 'outbox-latest.json'];
  fs2.files.set('/b/outbox-x.json', JSON.stringify({ run_id: 'x', generated_at: '2026-10-08T14:00:00Z', item_keys: [`link:opp-ftic:${NOTICE}`] }));
  assert.equal((await runAgt002PhaseChangeReview(fakeDb(tables), { api, environment: {}, now: at('2026-10-08T15:00:00Z'), stateDir: '/b', fsImpl: fs2 })).outbox, null);
  // Falla al escribir el outbox: se restaura lo informado y la novedad sale en la revisión siguiente, con el mismo id.
  const fs3 = memoryFs();
  fs3.files.set('/c/reported-keys.json', JSON.stringify({ keys: {} }));
  const write = fs3.writeFileSync;
  let failOutbox = true;
  fs3.writeFileSync = (path, content) => { if (failOutbox && /outbox/.test(path)) throw new Error('disco lleno'); return write(path, content); };
  await assert.rejects(runAgt002PhaseChangeReview(fakeDb(tables), { api, environment: {}, now: at('2026-10-08T14:00:00Z'), stateDir: '/c', fsImpl: fs3 }), /disco lleno/);
  assert.deepEqual(JSON.parse(fs3.files.get('/c/reported-keys.json')).keys, {});
  failOutbox = false;
  const retry = await runAgt002PhaseChangeReview(fakeDb(tables), { api, environment: {}, now: at('2026-10-08T19:00:00Z'), stateDir: '/c', fsImpl: fs3 });
  assert.deepEqual(retry.items.map(item => item.type), ['link']);
});

test('menor 4: un reanálisis en NEEDS_ATTENTION se informa una vez y su resultado final, otra vez', async () => {
  const { collectAgt002PhaseChangeAnalysisResults } = await import('../agt002-phase-change-followup.js');
  const tables = world({ psi_sales_interactions: [DETECTED, IMPORTED, state('tender_phase_change_analysis', { new_set_hash: 'set-1', outcome: 'launched', job_id: 'job-9', analysis_kind: 'REANALYSIS' }, '2026-10-09T10:05:00.000Z')],
    psi_agt002_initial_analysis_jobs: [{ id: 'job-9', opportunity_id: 'opp-ftic', status: 'NEEDS_ATTENTION', analysis_kind: 'REANALYSIS', created_at: '2026-10-09T10:05:00.000Z' }] });
  const db = fakeDb(tables);
  assert.deepEqual((await collectAgt002PhaseChangeAnalysisResults(db, { now: NOW })).map(r => r.status), ['NEEDS_ATTENTION']);
  assert.deepEqual(await collectAgt002PhaseChangeAnalysisResults(db, { now: NOW }), [], 'no se repite mientras siga igual');
  Object.assign(tables.psi_agt002_initial_analysis_jobs[0], { status: 'COMPLETED', analysis_run_id: 'run-9' });
  tables.psi_tender_analysis_runs.push({ id: 'run-9', result: { recommendation: { label: 'No conviene presentarse', confidence: 'ALTA' } } });
  const final = await collectAgt002PhaseChangeAnalysisResults(db, { now: NOW });
  assert.deepEqual(final.map(r => [r.status, r.verdict]), [['COMPLETED', 'No conviene presentarse (confianza alta)']]);
  assert.deepEqual(await collectAgt002PhaseChangeAnalysisResults(db, { now: NOW }), []);
  const keys = alerts.agt002AlertItems({ results: [{ opportunityId: 'opp-ftic', jobId: 'job-9', status: 'NEEDS_ATTENTION' }, { opportunityId: 'opp-ftic', jobId: 'job-9', status: 'COMPLETED' }] }, { day: '2026-10-09' }).map(item => item.key);
  assert.equal(new Set(keys).size, 2, 'dos novedades distintas para el correo');
});

// ---------------------------------------------------------------------------------------------------------------
// Decisión del dueño (2026-10-09): una oportunidad convertida NO activa es, para todo proceso automático, como si no
// existiera: ninguna escritura (marcas, avisos, análisis, resultados, correo) y ningún seguimiento.
// ---------------------------------------------------------------------------------------------------------------

const NO_GO = [{ id: 'ng', opportunity_id: 'opp-ftic', tender_id: 't-ftic', decision: 'no_go', decided_at: '2026-10-09T08:00:00Z' }];
const LAUNCHED = state('tender_phase_change_analysis', { new_set_hash: 'set-1', outcome: 'launched', job_id: 'job-9', analysis_kind: 'REANALYSIS' }, '2026-10-09T10:05:00.000Z');

test('no activa: el paso de análisis no registra, no avisa ni deja correo (ni siquiera "no se reanaliza")', async () => {
  const { agt002ReviewFacts } = await import('../agt002-phase-change-review.js');
  for (const close of [
    tables => { tables.psi_tender_go_no_go_decisions = NO_GO; },
    tables => { tables.psi_sales_opportunities[0].tender_offer_status = 'no_adjudicada'; },
    tables => { tables.psi_sales_opportunities[0].stage_code = 'perdido'; },
  ]) {
    const tables = world({ psi_sales_interactions: [DETECTED, IMPORTED] });
    close(tables);
    const before = tables.psi_sales_interactions.length;
    const db = fakeDb(tables);
    const { calls, admit, freezeProfile } = admitSpy();
    const events = await runAgt002PhaseChangeAnalysisAdmissions(db, { now: NOW, environment: ON, admit, freezeProfile });
    assert.deepEqual(events.map(e => [e.event, e.reason]), [['agt002_phase_change_analysis_ignored_inactive_opportunity', 'opportunity_closed']]);
    assert.equal(tables.psi_sales_interactions.length, before, 'ningún registro de estado');
    assert.deepEqual(db.appended, [], 'ningún aviso en la oportunidad');
    assert.equal(calls.length, 0);
    assert.deepEqual(agt002ReviewFacts({ analysisEvents: events }).analyses, [], 'nada para el correo');
  }
});

test('no activa: el resultado de un reanálisis lanzado antes de cerrarla no se registra ni se avisa', async () => {
  const { collectAgt002PhaseChangeAnalysisResults } = await import('../agt002-phase-change-followup.js');
  const tables = world({ psi_sales_interactions: [DETECTED, IMPORTED, LAUNCHED], psi_tender_go_no_go_decisions: NO_GO,
    psi_agt002_initial_analysis_jobs: [{ id: 'job-9', opportunity_id: 'opp-ftic', status: 'COMPLETED', analysis_kind: 'REANALYSIS', created_at: '2026-10-09T10:05:00.000Z' }] });
  const db = fakeDb(tables);
  assert.deepEqual(await collectAgt002PhaseChangeAnalysisResults(db, { now: NOW }), []);
  assert.equal(tables.psi_sales_interactions.length, 3);
  assert.deepEqual(db.appended, []);
});

test('no activa: la conciliación de cambios sin marca ni siquiera la mira', async () => {
  const refresh = { id: 'r', opportunity_id: 'opp-ftic', interaction_type: 'documento', created_at: '2026-09-26T12:00:00.000Z', notes: JSON.stringify({ kind: 'tender_document_refresh', source: 'SECOP II', notice_uid: 'CO1.NTC.10911657' }) };
  const tables = world({ psi_sales_interactions: [refresh], psi_tender_go_no_go_decisions: NO_GO });
  tables.psi_public_tenders = [tables.psi_public_tenders[0]];
  assert.deepEqual(await reconcileAgt002PendingPhaseChanges(fakeDb(tables), { now: NOW }), [], 'ni marca ni evento');
  assert.equal(tables.psi_sales_interactions.length, 1);
});

test('no activa: la revisión programada completa no escribe nada ni deja correo', async () => {
  const tables = world({ psi_sales_interactions: [{ ...DETECTED, created_at: '2026-10-09T13:00:00.000Z' }, IMPORTED, LAUNCHED], psi_tender_go_no_go_decisions: NO_GO,
    psi_agt002_initial_analysis_jobs: [{ id: 'job-9', opportunity_id: 'opp-ftic', status: 'COMPLETED', analysis_kind: 'REANALYSIS', created_at: '2026-10-09T10:05:00.000Z' }] });
  tables.psi_public_tenders = [tables.psi_public_tenders[0]];
  const before = JSON.stringify(tables);
  const db = fakeDb(tables);
  const fs = memoryFs();
  fs.files.set('/z/reported-keys.json', JSON.stringify({ keys: {} }));
  const api = {
    syncConvertedTenderPhaseLinks: async (_db, { isActive }) => { assert.equal(await isActive(tables.psi_public_tenders[0]), false); return { active: 0, changed: 0 }; },
    probePhaseChangeTenderDocumentSet: async () => { throw new Error('no debe mirar documentos de una no activa'); },
    importPhaseChangeTenderDocuments: async () => { throw new Error('no debe importar'); },
  };
  const { calls, admit, freezeProfile } = admitSpy();
  const result = await runAgt002PhaseChangeReview(db, { api, environment: ON, now: NOW, stateDir: '/z', fsImpl: fs, admit, freezeProfile });
  assert.equal(result.outbox, null);
  assert.equal(JSON.stringify(tables), before, 'ninguna escritura en la base');
  assert.deepEqual(db.appended, []);
  assert.equal(calls.length, 0);
  assert.equal(fs.files.has('/z/outbox-latest.json'), false);
});

for (const [label, server] of servers) {
  test(`revisión (${label}): mantiene al día las fases conocidas de la activa (idempotente) y deja explícitas las activas fuera de SECOP II`, async () => {
    const tables = world({ psi_sales_interactions: [] });
    tables.psi_public_tenders = [
      { ...draftConverted(), id: 't-ftic', stable_key: 'ftic-conv', raw: { keep: 1 } },
      { ...draftConverted({ stable_key: 'esu-conv', source: 'ESU Contratación', converted_opportunity_id: 'opp-esu', ref: 'ESU-1' }), id: 't-esu' },
    ];
    tables.psi_sales_opportunities.push({ id: 'opp-esu', stage_code: 'prospecto', observaciones: '' });
    const db = writableDb(tables);
    const seen = [];
    const fetchFamilies = async rows => { seen.push(...rows.map(r => r.stable_key)); return [draftRow(), offerRow()]; };
    const first = await server.syncConvertedTenderPhaseLinks(db, { isActive: () => true, fetchFamilies, now: '2026-10-10T16:00:00.000Z' });
    assert.deepEqual(seen, ['ftic-conv'], 'sólo SECOP II tiene seguimiento');
    assert.deepEqual(first.other_sources, [{ opportunity_id: 'opp-esu', source: 'ESU Contratación' }]);
    const phases = tables.psi_public_tenders[0].raw.phase_continuity.known_phases;
    assert.deepEqual([...phases].sort(), ['Evaluación', 'Presentación de observaciones', 'Publicado'].sort());
    assert.equal(tables.psi_public_tenders[0].raw.keep, 1, 'el resto de raw se conserva');
    assert.equal(tables.psi_public_tenders[1].raw, undefined, 'la de otra fuente no se toca');
    const second = await server.syncConvertedTenderPhaseLinks(db, { isActive: () => true, fetchFamilies, now: '2026-10-10T17:00:00.000Z' });
    assert.equal(second.changed, 0, 'las fases ya registradas no se reescriben');
    assert.deepEqual(tables.psi_public_tenders[0].raw.phase_continuity.known_phases, phases);
  });
}

test('revisión: una activa fuera de SECOP II queda en el log como no seguida (limitación conocida)', async () => {
  const logs = [];
  const api = { syncConvertedTenderPhaseLinks: async () => ({ active: 0, changed: 0, other_sources: [{ opportunity_id: 'opp-esu', source: 'ESU Contratación' }] }), probePhaseChangeTenderDocumentSet: async () => { throw new Error('no'); }, importPhaseChangeTenderDocuments: async () => { throw new Error('no'); } };
  await runAgt002PhaseChangeReview(fakeDb(world({ psi_sales_interactions: [] })), { api, environment: {}, now: NOW, stateDir: '/y', fsImpl: memoryFs(), log: event => logs.push(event) });
  assert.deepEqual(logs.filter(e => e.event === 'agt002_phase_change_review_source_not_followed'), [{ event: 'agt002_phase_change_review_source_not_followed', opportunityId: 'opp-esu', source: 'ESU Contratación' }]);
});
