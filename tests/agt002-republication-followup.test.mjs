// AGT-002 — seguimiento automático de un proceso SECOP II republicado (decisión del dueño, 2026-10-08): documentos del
// aviso nuevo sin intervención humana (con reintento mientras datos.gov.co no los publica) y, ya vigentes, un único
// reanálisis automático (o INITIAL) dentro del mismo cupo diario de auto-initial.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGT002_VIGIA_AGENT_PROFILE_ID,
  planAgt002RepublicationAnalysis,
  republicationNoticeUids,
  runAgt002RepublicationAnalysisAdmissions,
  runAgt002RepublicationDocumentRefresh,
} from '../agt002-republication-followup.js';

const NEW_URL = 'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.11032172&isFromPublicArea=True&isModal=False';
const OLD_URL = 'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.10911657';
const NOTICE = 'CO1.NTC.11032172';
const NOW = new Date('2026-10-09T15:00:00.000Z');
const ON = { AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED: 'true', AGT002_MODEL_CALLS_ENABLED: 'true' };
const OBSERVATIONS = [
  'Origen: SECOP II / Radar Licitaciones',
  `Link fuente: ${NEW_URL}`,
  `Link fuente histórico: ${OLD_URL}`,
  `SECOP publicó una versión nueva del proceso (FTIC-LP-003-2026.): ${NEW_URL}`,
].join('\n');

function fakeDb(tables) {
  return {
    tables,
    from(name) {
      const filters = [];
      let limit = Infinity;
      let patch = null;
      const run = () => (tables[name] || []).filter(row => filters.every(filter => filter(row))).slice(0, limit);
      const chain = {
        select() { return chain; },
        eq(column, value) { filters.push(row => row[column] === value); return chain; },
        gte(column, value) { filters.push(row => String(row[column]) >= String(value)); return chain; },
        order() { return chain; },
        limit(n) { limit = n; return chain; },
        update(values) { patch = values; return chain; },
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        then(resolve) {
          if (patch) { for (const row of run()) Object.assign(row, patch); resolve({ data: null, error: null }); return; }
          resolve({ data: run(), error: null });
        },
      };
      return chain;
    },
  };
}

function world(overrides = {}) {
  return {
    psi_public_tenders: [
      { id: 't-ftic', ref: 'FTIC-LP-003-2026', url: NEW_URL, converted_opportunity_id: 'opp-ftic', internal_status: 'convertida_oportunidad', reviewed_by: 'juan' },
      // Convertida sin republicación: nunca entra al seguimiento.
      { id: 't-plain', ref: 'LP-010-2026', url: OLD_URL, converted_opportunity_id: 'opp-plain', internal_status: 'convertida_oportunidad', reviewed_by: 'juan' },
    ],
    psi_sales_opportunities: [
      { id: 'opp-ftic', observaciones: OBSERVATIONS, service_type_code: 'licitacion_publica' },
      { id: 'opp-plain', observaciones: `Link fuente: ${OLD_URL}`, service_type_code: 'licitacion_publica' },
    ],
    psi_sales_interactions: [],
    psi_tender_processing_jobs: [{ opportunity_id: 'opp-ftic', requested_by: 'juan', created_at: '2026-09-26T12:00:00.000Z' }],
    psi_agt002_initial_analysis_jobs: [
      { id: 'initial-1', opportunity_id: 'opp-ftic', status: 'COMPLETED', analysis_kind: 'INITIAL', created_at: '2026-09-26T14:00:00.000Z' },
    ],
    psi_tender_analysis_runs: [{ id: 'run-1', opportunity_id: 'opp-ftic', canonical: true, status: 'completed', analysis_kind: 'INITIAL' }],
    psi_tender_document_versions: [{ id: 'v-new', name: 'Pliego definitivo.pdf', opportunity_id: 'opp-ftic', current: true }],
    psi_tender_document_extractions: [{ document_version_id: 'v-new', opportunity_id: 'opp-ftic', status: 'ok', char_count: 5000, created_at: '2026-10-09T10:00:00.000Z' }],
    ...overrides,
  };
}

const importedInteraction = (createdAt = '2026-10-09T10:00:00.000Z') => ({
  id: 'i-1', opportunity_id: 'opp-ftic', interaction_type: 'documento', created_at: createdAt,
  notes: JSON.stringify({ kind: 'tender_document_refresh', republication_notice_uid: NOTICE, new_count: 3, retired_count: 2 }),
});

test('las observaciones anuncian el aviso nuevo por su noticeUID', () => {
  assert.deepEqual([...republicationNoticeUids(OBSERVATIONS)], [NOTICE]);
  assert.deepEqual([...republicationNoticeUids(`Link fuente: ${NEW_URL}`)], []);
});

test('documentos: si datos.gov.co aún no tiene el aviso nuevo, queda pendiente y se reintenta sin fallar', async () => {
  const tables = world();
  const db = fakeDb(tables);
  const calls = [];
  const failing = async (opportunityId, options) => { calls.push({ opportunityId, ...options }); throw new Error('No se encontró proceso SECOP por urlproceso exacto (CO1.NTC.11032172).'); };
  const events = await runAgt002RepublicationDocumentRefresh(db, { importDocuments: failing });
  assert.deepEqual(events.map(e => e.event), ['agt002_republication_documents_pending']);
  assert.deepEqual(calls, [{ opportunityId: 'opp-ftic', noticeUid: NOTICE, actorProfileId: AGT002_VIGIA_AGENT_PROFILE_ID }], 'sólo la oportunidad republicada, con la identidad técnica Vig-IA');
  assert.equal(tables.psi_sales_opportunities[0].observaciones, OBSERVATIONS, 'nada se anuncia hasta que los documentos existan');

  // Día siguiente: datos.gov.co ya publicó → importa una vez, deja aviso visible, y no repite.
  const ok = async () => {
    tables.psi_sales_interactions.push(importedInteraction());
    return { new_count: 3, updated_count: 1, unchanged_count: 0, failed_count: 0, retired_count: 2 };
  };
  const second = await runAgt002RepublicationDocumentRefresh(db, { importDocuments: ok });
  assert.deepEqual(second.map(e => e.event), ['agt002_republication_documents_imported']);
  assert.match(tables.psi_sales_opportunities[0].observaciones, /Documentos oficiales de la versión nueva de SECOP importados \(CO1\.NTC\.11032172\): 4 vigentes; 2 del aviso anterior quedan como historial\./);
  const third = await runAgt002RepublicationDocumentRefresh(db, { importDocuments: async () => { throw new Error('no debe llamarse'); } });
  assert.deepEqual(third.map(e => e.event), ['agt002_republication_documents_already_imported']);
});

function admitSpy() {
  const calls = [];
  const admit = async (_db, args) => { calls.push(args); return { jobId: `job-${calls.length}`, admissionStatus: 'admitted' }; };
  const freezeProfile = async () => ({ profileSnapshotId: 'ps-1', profileSnapshotHash: 'a'.repeat(64) });
  return { calls, admit, freezeProfile };
}

test('análisis: espera a que los documentos nuevos estén importados', async () => {
  const { calls, admit, freezeProfile } = admitSpy();
  const events = await runAgt002RepublicationAnalysisAdmissions(fakeDb(world()), { now: NOW, environment: ON, admit, freezeProfile });
  assert.deepEqual(events.map(e => e.event), ['agt002_republication_analysis_waiting_documents']);
  assert.equal(calls.length, 0);
});

test('análisis: admite UN reanálisis sucesor del canónico, autorizado por quien convirtió, y no lo repite', async () => {
  const tables = world({ psi_sales_interactions: [importedInteraction()] });
  const db = fakeDb(tables);
  const { calls, admit, freezeProfile } = admitSpy();
  const events = await runAgt002RepublicationAnalysisAdmissions(db, { now: NOW, environment: ON, admit, freezeProfile });
  assert.deepEqual(events.map(e => e.event), ['agt002_republication_analysis_admitted']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].analysisKind, 'REANALYSIS');
  assert.equal(calls[0].sourceAnalysisRunId, 'run-1');
  assert.equal(calls[0].actorProfileId, 'juan', 'convertir = autorización: el actor es quien convirtió');
  assert.equal(calls[0].tenderId, 't-ftic');
  assert.equal(calls[0].attempt, `secop-republication:${NOTICE}`);
  assert.equal(calls[0].expiresAt, '2026-10-11T10:00:00.000Z', 'ventana G1 determinista desde la importación documental');
  assert.deepEqual(calls[0].requestedMembers.length > 0, true);
  assert.match(tables.psi_sales_opportunities[0].observaciones, /SECOP publicó una versión nueva \(CO1\.NTC\.11032172\); se lanzó el reanálisis automático\./);

  // El job quedó creado después de la importación: la siguiente pasada no admite otro.
  tables.psi_agt002_initial_analysis_jobs.push({ id: 'job-1', opportunity_id: 'opp-ftic', status: 'QUEUED', analysis_kind: 'REANALYSIS', created_at: '2026-10-09T15:00:01.000Z' });
  const again = await runAgt002RepublicationAnalysisAdmissions(db, { now: new Date('2026-10-09T16:00:00.000Z'), environment: ON, admit, freezeProfile });
  assert.deepEqual(again.map(e => e.event), ['agt002_republication_analysis_already_admitted']);
  assert.equal(calls.length, 1, 'nunca en bucle');
});

test('análisis: INITIAL cuando la oportunidad aún no tiene análisis completado', async () => {
  const { calls, admit, freezeProfile } = admitSpy();
  const tables = world({ psi_sales_interactions: [importedInteraction()], psi_agt002_initial_analysis_jobs: [], psi_tender_analysis_runs: [] });
  await runAgt002RepublicationAnalysisAdmissions(fakeDb(tables), { now: NOW, environment: ON, admit, freezeProfile });
  assert.equal(calls[0].analysisKind, 'INITIAL');
  assert.equal(calls[0].sourceAnalysisRunId, null);
  assert.match(tables.psi_sales_opportunities[0].observaciones, /se lanzó el análisis inicial automático\./);
});

test('análisis: respeta el cupo diario compartido con auto-initial y queda pendiente con aviso', async () => {
  const today = Array.from({ length: 5 }, (_, index) => ({ id: `j${index}`, opportunity_id: `other-${index}`, status: 'COMPLETED', analysis_kind: index % 2 ? 'REANALYSIS' : 'INITIAL', created_at: '2026-10-09T13:00:00.000Z' }));
  const tables = world({ psi_sales_interactions: [importedInteraction()] });
  tables.psi_agt002_initial_analysis_jobs.push(...today);
  const { calls, admit, freezeProfile } = admitSpy();
  const events = await runAgt002RepublicationAnalysisAdmissions(fakeDb(tables), { now: NOW, dailyCap: 5, environment: ON, admit, freezeProfile });
  assert.deepEqual(events.map(e => [e.event, e.reason]), [['agt002_republication_analysis_deferred', 'daily_cap']]);
  assert.equal(calls.length, 0, 'nunca supera el cupo');
  assert.match(tables.psi_sales_opportunities[0].observaciones, /reanálisis automático pendiente por cupo diario\./);
  const before = tables.psi_sales_opportunities[0].observaciones;
  await runAgt002RepublicationAnalysisAdmissions(fakeDb(tables), { now: NOW, dailyCap: 5, environment: ON, admit, freezeProfile });
  assert.equal(tables.psi_sales_opportunities[0].observaciones, before, 'el aviso de cupo no se duplica');
});

test('análisis: espera si hay un análisis en curso y no corre con los interruptores apagados', async () => {
  const { calls, admit, freezeProfile } = admitSpy();
  const tables = world({ psi_sales_interactions: [importedInteraction()] });
  tables.psi_agt002_initial_analysis_jobs[0] = { ...tables.psi_agt002_initial_analysis_jobs[0], status: 'RUNNING' };
  const events = await runAgt002RepublicationAnalysisAdmissions(fakeDb(tables), { now: NOW, environment: ON, admit, freezeProfile });
  assert.deepEqual(events.map(e => e.reason), ['analysis_in_progress']);
  const off = await runAgt002RepublicationAnalysisAdmissions(fakeDb(tables), { now: NOW, environment: {}, admit, freezeProfile });
  assert.deepEqual(off.map(e => e.event), ['agt002_republication_analysis_disabled']);
  assert.equal(calls.length, 0);
});

test('plan puro de análisis', () => {
  const at = '2026-10-09T10:00:00.000Z';
  assert.deepEqual(planAgt002RepublicationAnalysis({ documentsImportedAt: at, jobs: [{ status: 'COMPLETED', created_at: '2026-10-09T11:00:00.000Z' }] }), { action: 'done' });
  assert.equal(planAgt002RepublicationAnalysis({ documentsImportedAt: at, jobs: [{ status: 'NEEDS_ATTENTION', created_at: '2026-10-01T00:00:00.000Z' }] }).action, 'wait');
  assert.deepEqual(planAgt002RepublicationAnalysis({ documentsImportedAt: at, canonical: { id: 'r', analysis_kind: 'REANALYSIS' } }), { action: 'admit', analysisKind: 'REANALYSIS', sourceAnalysisRunId: 'r' });
  assert.equal(planAgt002RepublicationAnalysis({ documentsImportedAt: at, canonical: { id: 'legacy', analysis_kind: null } }).analysisKind, 'INITIAL');
});
