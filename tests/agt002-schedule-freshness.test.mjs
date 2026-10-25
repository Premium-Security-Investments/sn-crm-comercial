// Verificación de frescura (pendiente de Juan, 2026-10-21): avisar cuando una fecha clave del cronograma pasó y
// SECOP no se movió. El caso base es el real de la Fiscalía FGN-NC-IPSE-0054-2026.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agt002FreshnessDay,
  agt002IsOfficialDocumentSource,
  agt002ScheduleFreshnessNotices,
  runAgt002ScheduleFreshnessReview,
} from '../verticales/licitaciones/agt002-schedule-freshness.js';

const NOW = new Date('2026-10-21T22:00:00Z'); // 21-oct 5:00 p. m. Bogotá
// Cronograma real de la Fiscalía, recortado a lo que importa.
const FISCALIA = [
  { kind: 'PUBLICATION', label: 'Publicación del aviso de convocatoria, proyecto de pliegos y demás documentos', value: '2026-09-28T00:00:00-05:00' },
  { kind: 'PROJECT_OBSERVATIONS', label: 'Plazo para la presentación de observaciones al pliego de condiciones', value: '2026-10-06T23:59:00-05:00' },
  { kind: 'PUBLICATION', label: 'Publicación del acto administrativo de apertura y pliego de condiciones definitivo', value: '2026-10-16T23:59:00-05:00' },
  { kind: 'OBSERVATION_RESPONSES', label: 'Respuesta a las observaciones presentadas al pliego de condiciones definitivo', value: '2026-10-21T00:00:00-05:00' },
  { kind: 'SUBMISSION', label: 'Cierre del proceso (presentación de ofertas)', value: '2026-10-23T10:00:00-05:00' },
  { kind: 'AWARD', label: 'Expedición del acto administrativo de adjudicación', value: '2026-11-13T00:00:00-05:00' },
];
const TENDER = {
  ref: 'FGN-NC-IPSE-0054-2026', status: 'Presentación de observaciones',
  published_at: '2026-09-28T00:00:00+00', updated_at: '2026-10-08T00:00:00+00', last_seen_at: '2026-10-21T13:07:56+00',
};
const ULTIMO_DOCUMENTO = '2026-10-06T22:25:56+00';

test('el caso de la Fiscalía: el cierre encima sin pliego definitivo va primero y es grave', () => {
  const notices = agt002ScheduleFreshnessNotices({ deadlines: FISCALIA, tender: TENDER, lastDocumentAt: ULTIMO_DOCUMENTO, now: NOW });
  assert.equal(notices[0].code, 'cierre_sin_pliego_definitivo');
  assert.equal(notices[0].severity, 'alta');
  assert.match(notices[0].text, /el cierre es el 23 de octubre/);
  assert.match(notices[0].text, /pliego definitivo, previsto para el 16 de octubre, no aparece/);
  // Y además el detalle de lo que la entidad no publicó: el definitivo y la respuesta a observaciones.
  assert.deepEqual(notices.slice(1).map(notice => notice.code), ['entidad_sin_publicar', 'entidad_sin_publicar']);
  assert.match(notices[1].text, /16 de octubre/);
  assert.match(notices[1].text, /sigue en «Presentación de observaciones»/);
  assert.match(notices[2].text, /21 de octubre/);
  // Lo que no es de la entidad no se cuenta: el plazo de observaciones de los oferentes no genera aviso.
  assert.equal(notices.some(notice => /presentación de observaciones al pliego de condiciones»/i.test(notice.text)), false);
});

test('si llegó algo después de la fecha, no hay aviso', () => {
  const conDocumentoNuevo = agt002ScheduleFreshnessNotices({ deadlines: FISCALIA, tender: TENDER, lastDocumentAt: '2026-10-21T18:00:00+00', now: NOW });
  assert.deepEqual(conDocumentoNuevo, [], 'un documento posterior a la última fecha vencida cierra el silencio');
  // Uno del 20-oct cubre el pliego definitivo del 16, pero no la respuesta que estaba para hoy.
  const parcial = agt002ScheduleFreshnessNotices({ deadlines: FISCALIA, tender: TENDER, lastDocumentAt: '2026-10-20T12:00:00+00', now: NOW });
  assert.deepEqual(parcial.map(notice => notice.deadlineValue), ['2026-10-21T00:00:00-05:00']);
  const conAvisoNuevo = agt002ScheduleFreshnessNotices({
    deadlines: FISCALIA, tender: { ...TENDER, published_at: '2026-10-21T12:00:00+00' }, lastDocumentAt: ULTIMO_DOCUMENTO, now: NOW,
  });
  assert.deepEqual(conAvisoNuevo, [], 'si la entidad publicó un aviso después, SECOP sí se movió');
  // `updated_at` NO cuenta: el Radar reescribe la fila cada día y taparía todos los avisos.
  const conFilaReescrita = agt002ScheduleFreshnessNotices({
    deadlines: FISCALIA, tender: { ...TENDER, updated_at: '2026-10-21T13:08:57+00' }, lastDocumentAt: ULTIMO_DOCUMENTO, now: NOW,
  });
  assert.equal(conFilaReescrita[0].code, 'cierre_sin_pliego_definitivo', 'una pasada del Radar no es una publicación de la entidad');
});

test('salvaguarda: sin mirada reciente del Radar no se afirma nada', () => {
  for (const lastSeen of [null, '2026-10-15T13:00:00+00']) {
    const notices = agt002ScheduleFreshnessNotices({ deadlines: FISCALIA, tender: { ...TENDER, last_seen_at: lastSeen }, lastDocumentAt: ULTIMO_DOCUMENTO, now: NOW });
    assert.deepEqual(notices.map(notice => notice.code), ['radar_sin_mirar']);
    assert.match(notices[0].text, /no se puede concluir/);
  }
});

test('un cronograma al día no genera avisos, y sin cronograma tampoco', () => {
  const alDia = agt002ScheduleFreshnessNotices({
    deadlines: [{ kind: 'PUBLICATION', label: 'Pliego definitivo', value: '2026-10-30T00:00:00-05:00' }, { kind: 'SUBMISSION', label: 'Cierre', value: '2026-11-05T10:00:00-05:00' }],
    tender: TENDER, lastDocumentAt: ULTIMO_DOCUMENTO, now: NOW,
  });
  assert.deepEqual(alDia, []);
  assert.deepEqual(agt002ScheduleFreshnessNotices({ deadlines: [], tender: TENDER, now: NOW }), []);
  assert.deepEqual(agt002ScheduleFreshnessNotices({}), []);
});

test('el cierre lejano deja el aviso de la publicación pero sin la alarma del cierre', () => {
  const lejano = agt002ScheduleFreshnessNotices({
    deadlines: [
      { kind: 'PUBLICATION', label: 'Publicación del pliego de condiciones definitivo', value: '2026-10-16T23:59:00-05:00' },
      { kind: 'SUBMISSION', label: 'Cierre del proceso', value: '2026-11-20T10:00:00-05:00' },
    ],
    tender: TENDER, lastDocumentAt: ULTIMO_DOCUMENTO, now: NOW,
  });
  assert.deepEqual(lejano.map(notice => notice.code), ['entidad_sin_publicar']);
});

test('la fecha se dice en palabras y en hora de Bogotá', () => {
  assert.equal(agt002FreshnessDay('2026-10-16T23:59:00-05:00'), '16 de octubre');
  assert.equal(agt002FreshnessDay('2026-10-17T03:00:00Z'), '16 de octubre', 'medianoche UTC sigue siendo el día anterior en Bogotá');
  assert.equal(agt002FreshnessDay('no es fecha'), 'sin fecha');
});

test('la revisión programada: sólo lee, agrega el aviso por licitación y una que falle no corta las demás', async () => {
  const appended = [];
  const tenders = [
    { id: 't-fiscalia', ref: 'FGN-NC-IPSE-0054-2026', status: 'Presentación de observaciones', updated_at: TENDER.updated_at, published_at: TENDER.published_at, last_seen_at: TENDER.last_seen_at, converted_opportunity_id: 'opp-fiscalia', internal_status: 'convertida_oportunidad' },
    { id: 't-cerrada', ref: 'LP-999', status: 'Publicado', updated_at: TENDER.updated_at, published_at: TENDER.published_at, last_seen_at: TENDER.last_seen_at, converted_opportunity_id: 'opp-cerrada', internal_status: 'convertida_oportunidad' },
    { id: 't-sin-analisis', ref: 'LP-888', status: 'Publicado', updated_at: TENDER.updated_at, published_at: TENDER.published_at, last_seen_at: TENDER.last_seen_at, converted_opportunity_id: 'opp-sin-analisis', internal_status: 'convertida_oportunidad' },
    { id: 't-rota', ref: 'LP-777', status: 'Publicado', updated_at: TENDER.updated_at, published_at: TENDER.published_at, last_seen_at: TENDER.last_seen_at, converted_opportunity_id: 'opp-rota', internal_status: 'convertida_oportunidad' },
  ];
  const database = {
    from(table) {
      const chain = {
        filters: {},
        select() { return chain; },
        eq(column, value) { chain.filters[column] = value; return chain; },
        order() { return chain; },
        limit() { return chain; },
        then(resolve) {
          if (table === 'psi_public_tenders') return resolve({ data: tenders, error: null });
          if (table === 'psi_tender_analysis_runs') {
            if (chain.filters.opportunity_id === 'opp-rota') throw new Error('no se pudo leer el análisis');
            if (chain.filters.opportunity_id === 'opp-sin-analisis') return resolve({ data: [], error: null });
            return resolve({ data: [{ id: 'run', result: { meta: { process_deadlines: FISCALIA } } }], error: null });
          }
          if (table === 'psi_tender_document_versions') return resolve({ data: [{ created_at: ULTIMO_DOCUMENTO, source: 'secop ii' }], error: null });
          return resolve({ data: [], error: null });
        },
      };
      return chain;
    },
  };
  const events = await runAgt002ScheduleFreshnessReview(database, {
    now: NOW,
    inactiveReason: async (_db, opportunityId) => (opportunityId === 'opp-cerrada' ? 'opportunity_closed' : null),
    appendLine: async (_db, opportunityId, line) => { appended.push([opportunityId, line]); },
  });
  assert.deepEqual(appended.map(([opportunityId]) => opportunityId), ['opp-fiscalia', 'opp-fiscalia', 'opp-fiscalia'], 'la cerrada no recibe nada');
  assert.match(appended[0][1], /^Vig-IA, frescura: el cierre es el 23 de octubre/);
  assert.deepEqual(events.filter(event => event.event === 'agt002_schedule_freshness_notice').map(event => event.code), ['cierre_sin_pliego_definitivo', 'entidad_sin_publicar', 'entidad_sin_publicar']);
  assert.deepEqual(events.filter(event => event.event === 'agt002_schedule_freshness_no_schedule').map(event => event.opportunityId), ['opp-sin-analisis']);
  assert.deepEqual(events.filter(event => event.event === 'agt002_schedule_freshness_failed').map(event => event.opportunityId), ['opp-rota'], 'la que falla queda registrada y no corta');
});

test('la revisión de fases llama la frescura, le pasa el aviso atómico y sigue aunque falle', async () => {
  const { runAgt002PhaseChangeReview } = await import('../verticales/licitaciones/agt002-phase-change-review.js');
  const calls = [];
  const logs = [];
  const api = {
    syncConvertedTenderPhaseLinks: async () => ({ active: 0, changed: 0, other_sources: [] }),
    probePhaseChangeTenderDocumentSet: async () => { throw new Error('no'); },
    importPhaseChangeTenderDocuments: async () => { throw new Error('no'); },
  };
  const database = { from: () => ({ select: () => ({ eq: () => ({ like: () => ({ then: resolve => resolve({ data: [], error: null }) }), limit: () => ({ then: resolve => resolve({ data: [], error: null }) }), order: () => ({ limit: () => ({ then: resolve => resolve({ data: [], error: null }) }) }), then: resolve => resolve({ data: [], error: null }) }), then: resolve => resolve({ data: [], error: null }) }) }) };
  const memoryFs = () => {
    const files = new Map();
    return {
      mkdirSync: () => {}, readdirSync: () => [],
      readFileSync: path => { if (!files.has(path)) { const error = new Error('no existe'); error.code = 'ENOENT'; throw error; } return files.get(path); },
      writeFileSync: (path, content) => files.set(path, content), renameSync: (from, to) => { files.set(to, files.get(from)); files.delete(from); },
    };
  };
  await runAgt002PhaseChangeReview(database, {
    api, environment: {}, now: NOW, stateDir: '/x', fsImpl: memoryFs(), log: event => logs.push(event),
    freshnessReview: async (_db, options) => { calls.push(options); return []; },
  });
  assert.equal(calls.length, 1, 'la revisión llama la frescura una vez');
  assert.equal(typeof calls[0].appendLine, 'function', 'le pasa cómo dejar el aviso');
  assert.equal(typeof calls[0].inactiveReason, 'function', 'y cómo saber si la oportunidad está activa');
  assert.equal(calls[0].now, NOW);

  logs.length = 0;
  await runAgt002PhaseChangeReview(database, {
    api, environment: {}, now: NOW, stateDir: '/x', fsImpl: memoryFs(), log: event => logs.push(event),
    freshnessReview: async () => { throw new Error('la frescura falló'); },
  });
  assert.deepEqual(logs.filter(event => event.event === 'agt002_phase_change_review_freshness_failed').map(event => event.message), ['la frescura falló']);
  assert.ok(logs.some(event => event.event === 'agt002_licitaciones_alerts_nothing_new'), 'la revisión termina normalmente');
});

test('una carga nuestra no rompe el silencio de la entidad', () => {
  // Caso real: las seis cartas que cargó Juan en la Fiscalía el 21-oct son posteriores al 16-oct, pero no las
  // publicó la entidad. La primera corrida en producción taponó los avisos por esto.
  assert.equal(agt002IsOfficialDocumentSource('secop ii'), true);
  assert.equal(agt002IsOfficialDocumentSource('esu contratación'), true);
  assert.equal(agt002IsOfficialDocumentSource('carga manual'), false);
  assert.equal(agt002IsOfficialDocumentSource('manual_upload'), false);
  assert.equal(agt002IsOfficialDocumentSource('legacy_upload'), false);
  assert.equal(agt002IsOfficialDocumentSource(''), false, 'sin origen conocido no se da por oficial');
});

test('la revisión programada mira el último documento OFICIAL, no el último cargado', async () => {
  const appended = [];
  const documents = [
    { created_at: '2026-10-21T19:18:59+00', source: 'carga manual' },
    { created_at: '2026-10-06T22:25:56+00', source: 'secop ii' },
  ];
  const database = {
    from(table) {
      const chain = {
        filters: {},
        select() { return chain; },
        eq(column, value) { chain.filters[column] = value; return chain; },
        order() { return chain; },
        limit() { return chain; },
        then(resolve) {
          if (table === 'psi_public_tenders') return resolve({ data: [{ id: 't-fiscalia', ref: 'FGN-NC-IPSE-0054-2026', status: 'Presentación de observaciones', published_at: TENDER.published_at, last_seen_at: TENDER.last_seen_at, converted_opportunity_id: 'opp-fiscalia', internal_status: 'convertida_oportunidad' }], error: null });
          if (table === 'psi_tender_analysis_runs') return resolve({ data: [{ id: 'run', result: { meta: { process_deadlines: FISCALIA } } }], error: null });
          if (table === 'psi_tender_document_versions') return resolve({ data: documents, error: null });
          return resolve({ data: [], error: null });
        },
      };
      return chain;
    },
  };
  const events = await runAgt002ScheduleFreshnessReview(database, {
    now: NOW, appendLine: async (_db, opportunityId, line) => { appended.push(line); },
  });
  assert.ok(appended.length >= 3, 'la carga manual del 21-oct no debe tapar los avisos del 16-oct');
  assert.ok(appended.some(line => /16 de octubre/.test(line)));
  assert.deepEqual(events.filter(event => event.event === 'agt002_schedule_freshness_notice').map(event => event.code)[0], 'cierre_sin_pliego_definitivo');
});
