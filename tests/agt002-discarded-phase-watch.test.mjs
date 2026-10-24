// Vigilancia de lo descartado (pedido de Juan, 2026-10-22): si un proceso que descartamos publica una fase nueva con
// un cierre posterior, avisarlo una vez. El caso base es el real de Pereira: SME-LP-163-2026 se descartó contra el
// cierre del 8-sep y el 7-sep Pereira publicó la fase de oferta con cierre el 22-sep.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agt002DiscardedPhaseWatchNotice,
  agt002WatchDeadlineDay,
  agt002WatchNoticeUid,
  runAgt002DiscardedPhaseWatch,
} from '../agt002-discarded-phase-watch.js';

// El 8-sep a media mañana en Bogotá: el día que se creía que cerraba, con la fase de oferta ya publicada.
const CUANDO_IMPORTABA = new Date('2026-09-08T15:00:00Z');
// Hoy: la fase de oferta ya cerró y el proceso se adjudicó.
const HOY = new Date('2026-10-23T02:00:00Z');

const DESCARTADA = Object.freeze({
  id: 't-sme-163', stable_key: 'secop2:CO1.NTC.10648604', source: 'SECOP II',
  entity: 'MUNICIPIO DE PEREIRA- OFICIAL', ref: 'SME-LP-163-2026', process_id: 'CO1.REQ.10620001',
  published_at: '2026-08-04T00:00:00+00', deadline_at: '2026-09-08 00:00:00+00',
  status: 'Presentación de observaciones',
  url: 'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.10648604',
  internal_status: 'nueva', converted_opportunity_id: 'opp-sme-163',
});
const FASE_DE_OFERTA = Object.freeze({
  id: 't-sme-163-oferta', stable_key: 'secop2:CO1.NTC.10850776', source: 'SECOP II',
  entity: 'MUNICIPIO DE PEREIRA- OFICIAL', ref: 'SME-LP-163-2026 (Presentación de oferta)', process_id: 'CO1.REQ.10820555',
  published_at: '2026-09-07T00:00:00+00', deadline_at: '2026-09-22 00:00:00+00',
  status: 'Presentación de oferta',
  url: 'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.10850776',
  internal_status: 'nueva', converted_opportunity_id: null,
});

test('el caso real de Pereira: el 8-sep el aviso dice las dos fechas y el enlace nuevo', () => {
  const notice = agt002DiscardedPhaseWatchNotice({
    discarded: DESCARTADA, candidates: [DESCARTADA, FASE_DE_OFERTA], now: CUANDO_IMPORTABA,
  });
  assert.ok(notice, 'con la fase de oferta publicada y un cierre posterior hay aviso');
  assert.equal(notice.code, 'descartado_con_fase_nueva');
  assert.equal(notice.severity, 'alta');
  assert.equal(notice.noticeUid, 'CO1.NTC.10850776');
  assert.equal(notice.deadline, '2026-09-22 00:00:00+00');
  assert.equal(notice.previousDeadline, '2026-09-08 00:00:00+00');
  assert.match(notice.text, /se descartó con el cierre del 8 de septiembre/, 'el cierre viejo, tal como lo anunció SECOP');
  assert.match(notice.text, /con cierre el 22 de septiembre/, 'y el nuevo, igual');
  assert.match(notice.text, /mirarlo otra vez/);
  assert.match(notice.text, /noticeUID=CO1\.NTC\.10850776/);
});

test('hoy el mismo caso NO avisa: ese cierre ya pasó y el proceso se adjudicó', () => {
  const adjudicado = { ...FASE_DE_OFERTA, status: 'Adjudicado' };
  assert.equal(agt002DiscardedPhaseWatchNotice({ discarded: DESCARTADA, candidates: [DESCARTADA, adjudicado], now: HOY }), null);
  // Y tampoco por el cierre pasado, aunque la fase todavía no diga "Adjudicado": no hay nada que mirar otra vez.
  assert.equal(agt002DiscardedPhaseWatchNotice({ discarded: DESCARTADA, candidates: [DESCARTADA, FASE_DE_OFERTA], now: HOY }), null);
});

test('no avisa de lo que ya sigue alguien, ni de una fase terminal', () => {
  const yaConvertida = { ...FASE_DE_OFERTA, internal_status: 'convertida_oportunidad', converted_opportunity_id: 'opp-otra' };
  assert.equal(agt002DiscardedPhaseWatchNotice({ discarded: DESCARTADA, candidates: [DESCARTADA, yaConvertida], now: CUANDO_IMPORTABA }), null,
    'si tiene oportunidad propia, alguien ya la está trabajando');
  for (const status of ['Adjudicado', 'Desierto', 'Cancelado', 'Terminado']) {
    assert.equal(agt002DiscardedPhaseWatchNotice({ discarded: DESCARTADA, candidates: [DESCARTADA, { ...FASE_DE_OFERTA, status }], now: CUANDO_IMPORTABA }), null, status);
  }
});

test('un cierre que no es posterior al que se usó para decidir no cambia nada', () => {
  for (const deadline of ['2026-09-08 00:00:00+00', '2026-09-30 00:00:00+00']) {
    const mismoOAnterior = { ...FASE_DE_OFERTA, deadline_at: deadline };
    const notice = agt002DiscardedPhaseWatchNotice({ discarded: { ...DESCARTADA, deadline_at: '2026-09-30 00:00:00+00' }, candidates: [mismoOAnterior], now: CUANDO_IMPORTABA });
    assert.equal(notice, null, `cierre ${deadline} contra una decisión tomada con el 30-sep`);
  }
});

test('sin cierre viejo no se afirma que la fecha cambió, y sin familia no se agrupa', () => {
  assert.equal(agt002DiscardedPhaseWatchNotice({ discarded: { ...DESCARTADA, deadline_at: null }, candidates: [FASE_DE_OFERTA], now: CUANDO_IMPORTABA }), null);
  // Otra fuente: sólo SECOP II tiene familias de proceso.
  assert.equal(agt002DiscardedPhaseWatchNotice({ discarded: { ...DESCARTADA, source: 'SECOP I' }, candidates: [FASE_DE_OFERTA], now: CUANDO_IMPORTABA }), null);
  // Otra entidad con la misma referencia no es el mismo proceso.
  const otraEntidad = { ...FASE_DE_OFERTA, entity: 'MUNICIPIO DE DOSQUEBRADAS' };
  assert.equal(agt002DiscardedPhaseWatchNotice({ discarded: DESCARTADA, candidates: [otraEntidad], now: CUANDO_IMPORTABA }), null);
  // Y otra referencia de la misma entidad tampoco.
  const otroProceso = { ...FASE_DE_OFERTA, ref: 'SMGA-LP-220-2026 (Presentación de oferta)', stable_key: 'secop2:CO1.NTC.11011774' };
  assert.equal(agt002DiscardedPhaseWatchNotice({ discarded: DESCARTADA, candidates: [otroProceso], now: CUANDO_IMPORTABA }), null);
  assert.equal(agt002DiscardedPhaseWatchNotice({}), null);
});

test('con varias fases nuevas se avisa de la del cierre más lejano', () => {
  const intermedia = { ...FASE_DE_OFERTA, stable_key: 'secop2:CO1.NTC.10800001', deadline_at: '2026-09-15 00:00:00+00', url: 'https://x/Index?noticeUID=CO1.NTC.10800001' };
  const notice = agt002DiscardedPhaseWatchNotice({ discarded: DESCARTADA, candidates: [intermedia, FASE_DE_OFERTA], now: CUANDO_IMPORTABA });
  assert.equal(notice.noticeUid, 'CO1.NTC.10850776');
  assert.equal(notice.deadline, '2026-09-22 00:00:00+00');
});

test('un cierre guardado como medianoche UTC es una fecha, no un instante', () => {
  // El defecto que destapó la corrida en seco contra las filas reales del Radar: el cierre del 8-sep se guarda como
  // '2026-09-08 00:00:00+00', y leerlo en hora de Bogotá lo corría al 7 de septiembre.
  assert.equal(agt002WatchDeadlineDay('2026-09-08 00:00:00+00'), '8 de septiembre');
  assert.equal(agt002WatchDeadlineDay('2026-09-22 00:00:00+00'), '22 de septiembre');
  // Una hora de verdad sí se traduce: 14:00 UTC son las 9:00 a. m. del 13 en Bogotá.
  assert.equal(agt002WatchDeadlineDay('2026-10-13 14:00:00+00'), '13 de octubre');
  // Y una que cae de madrugada en UTC sigue siendo el día anterior en Bogotá.
  assert.equal(agt002WatchDeadlineDay('2026-10-14 03:00:00+00'), '13 de octubre');
  assert.equal(agt002WatchDeadlineDay(null), 'sin fecha');
});

test('el enlace se lee del aviso, y sin aviso legible queda nulo', () => {
  assert.equal(agt002WatchNoticeUid(FASE_DE_OFERTA.url), 'CO1.NTC.10850776');
  assert.equal(agt002WatchNoticeUid('https://community.secop.gov.co/STS/Users/Login/Index'), null);
  assert.equal(agt002WatchNoticeUid(null), null);
});

/** Base de prueba: cadenas thenables con `eq`/`in`/`limit`, como las demás pruebas de AGT-002. */
function fakeDatabase({ opportunities, tenders, candidates, breakOn }) {
  return {
    from(table) {
      const chain = {
        filters: {},
        select() { return chain; },
        eq(column, value) { chain.filters[column] = value; return chain; },
        in(column, values) { chain.filters[column] = values; return chain; },
        limit() { return chain; },
        then(resolve) {
          if (table === 'psi_sales_opportunities') return resolve({ data: opportunities, error: null });
          if (table === 'psi_public_tenders') {
            if (chain.filters.converted_opportunity_id) return resolve({ data: tenders, error: null });
            if (breakOn === 'family') return resolve({ data: null, error: { message: 'no se pudo leer la familia' } });
            return resolve({ data: candidates, error: null });
          }
          return resolve({ data: [], error: null });
        },
      };
      return chain;
    },
  };
}

test('la revisión programada: sólo descartadas, un aviso por licitación y una que falle no corta las demás', async () => {
  const appended = [];
  const events = await runAgt002DiscardedPhaseWatch(fakeDatabase({
    opportunities: [{ id: 'opp-sme-163', stage_code: 'descartado' }, { id: 'opp-rota', stage_code: 'descartado' }],
    tenders: [DESCARTADA, { ...DESCARTADA, id: 't-rota', stable_key: 'secop2:roto', converted_opportunity_id: 'opp-rota' }],
    candidates: [DESCARTADA, FASE_DE_OFERTA],
  }), {
    now: CUANDO_IMPORTABA,
    appendLine: async (_db, opportunityId, line) => {
      if (opportunityId === 'opp-rota') throw new Error('no se pudo escribir el aviso');
      appended.push([opportunityId, line]);
    },
  });
  assert.deepEqual(appended.map(([opportunityId]) => opportunityId), ['opp-sme-163'], 'una línea, en la oportunidad descartada');
  assert.match(appended[0][1], /^Vig-IA: este proceso se descartó con el cierre del 8 de septiembre/);
  assert.deepEqual(events.filter(event => event.event === 'agt002_discarded_phase_watch_notice').map(event => event.opportunityId), ['opp-sme-163']);
  assert.deepEqual(events.filter(event => event.event === 'agt002_discarded_phase_watch_failed').map(event => event.opportunityId), ['opp-rota'],
    'la que falla queda registrada y no corta');
});

test('la revisión no escribe nada cuando no hay descartadas, y una falla de lectura no lanza', async () => {
  const sinDescartadas = await runAgt002DiscardedPhaseWatch(fakeDatabase({ opportunities: [], tenders: [], candidates: [] }), { now: HOY });
  assert.deepEqual(sinDescartadas, []);
  const logs = [];
  const familiaIlegible = await runAgt002DiscardedPhaseWatch(fakeDatabase({
    opportunities: [{ id: 'opp-sme-163', stage_code: 'descartado' }], tenders: [DESCARTADA], candidates: [], breakOn: 'family',
  }), { now: CUANDO_IMPORTABA, log: event => logs.push(event) });
  assert.deepEqual(familiaIlegible, []);
  assert.deepEqual(logs.map(event => event.event), ['agt002_discarded_phase_watch_family_unavailable']);
});

test('sin fase nueva la licitación queda en orden, sin escribir nada', async () => {
  const appended = [];
  const events = await runAgt002DiscardedPhaseWatch(fakeDatabase({
    opportunities: [{ id: 'opp-sme-163', stage_code: 'descartado' }],
    tenders: [DESCARTADA], candidates: [DESCARTADA],
  }), { now: CUANDO_IMPORTABA, appendLine: async (_db, id, line) => appended.push([id, line]) });
  assert.deepEqual(appended, []);
  assert.deepEqual(events.map(event => event.event), ['agt002_discarded_phase_watch_ok']);
});

test('la revisión de fases la llama, le pasa el aviso atómico y sigue aunque falle', async () => {
  const { runAgt002PhaseChangeReview } = await import('../agt002-phase-change-review.js');
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
    api, environment: {}, now: HOY, stateDir: '/x', fsImpl: memoryFs(), log: event => logs.push(event),
    freshnessReview: async () => [],
    discardedWatch: async (_db, options) => { calls.push(options); return []; },
  });
  assert.equal(calls.length, 1, 'la revisión la llama una vez');
  assert.equal(typeof calls[0].appendLine, 'function', 'le pasa cómo dejar el aviso');
  assert.equal(calls[0].now, HOY);

  logs.length = 0;
  await runAgt002PhaseChangeReview(database, {
    api, environment: {}, now: HOY, stateDir: '/x', fsImpl: memoryFs(), log: event => logs.push(event),
    freshnessReview: async () => [],
    discardedWatch: async () => { throw new Error('la vigilancia falló'); },
  });
  assert.deepEqual(logs.filter(event => event.event === 'agt002_phase_change_review_discarded_watch_failed').map(event => event.message), ['la vigilancia falló']);
  assert.ok(logs.some(event => event.event === 'agt002_licitaciones_alerts_nothing_new'), 'la revisión termina normalmente');
});

test('el aviso llega al correo de Hermes una sola vez y dice que la oportunidad sigue descartada', async () => {
  const { agt002AlertItems, buildAgt002AlertsOutbox, agt002AlertsOutboxSummary } = await import('../agt002-licitaciones-alerts.js');
  const { agt002ReviewFacts } = await import('../agt002-phase-change-review.js');
  const reopenEvents = [{
    event: 'agt002_discarded_phase_watch_notice', opportunityId: 'opp-sme-163', ref: 'SME-LP-163-2026 (Presentación de oferta)',
    code: 'descartado_con_fase_nueva', severity: 'alta', noticeUid: 'CO1.NTC.10850776', url: FASE_DE_OFERTA.url,
    phase: 'Presentación de oferta', deadline: FASE_DE_OFERTA.deadline_at, previousDeadline: DESCARTADA.deadline_at,
    deadlineLabel: '22 de septiembre', previousDeadlineLabel: '8 de septiembre',
  }, { event: 'agt002_discarded_phase_watch_ok', opportunityId: 'opp-otra' }];
  const facts = agt002ReviewFacts({ reopenEvents });
  assert.equal(facts.reopens.length, 1, 'sólo los avisos, no los "ok"');
  const items = agt002AlertItems(facts, { day: '2026-09-08' });
  assert.deepEqual(items.map(item => item.key), ['reopen:opp-sme-163:CO1.NTC.10850776'],
    'la clave lleva el aviso nuevo, así que la revisión siguiente no lo reinforma');
  const outbox = buildAgt002AlertsOutbox({
    runId: 'r1', generatedAt: '2026-09-08T15:00:00Z', slot: '10:00', items,
    opportunities: new Map([['opp-sme-163', { entity: 'MUNICIPIO DE PEREIRA- OFICIAL', value: 6262904080, title: 'LICITACIÓN PÚBLICA VIGILANCIA' }]]),
  });
  const texto = agt002AlertsOutboxSummary(outbox);
  assert.match(texto, /se descartó con el cierre del 8 de septiembre/);
  assert.match(texto, /con cierre el 22 de septiembre/);
  assert.match(texto, /sigue descartada; nada se reanalizó/);
});
