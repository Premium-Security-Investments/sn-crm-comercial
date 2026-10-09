// AGT-002 — automatic INITIAL after a conversion (owner decision 2026-10-06). Pins the guards: conversions since the
// activation only, prospecto opportunities only, never a second INITIAL, the daily cap (Bogotá day), the kill switches,
// the converting person as actor, a deterministic authorization window, and the shared document selection rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agt002BogotaDayStart, filterAgt002ActiveProcessingJobs, runAgt002AutoInitialAdmissions, AGT002_AUTO_INITIAL_POLICY_VERSION,
} from '../agt002-auto-initial.js';

const SINCE = '2026-10-06T17:00:00.000Z';
const NOW = new Date('2026-10-06T20:00:00.000Z');
const ON = { AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED: 'true', AGT002_MODEL_CALLS_ENABLED: 'true' };

function fakeDb(tables) {
  return {
    from(name) {
      const filters = [];
      let limit = Infinity;
      const chain = {
        select() { return chain; },
        eq(column, value) { filters.push(row => row[column] === value); return chain; },
        gte(column, value) { filters.push(row => String(row[column]) >= String(value)); return chain; },
        like(column, pattern) { const needle = String(pattern).replace(/^%|%$/g, ''); filters.push(row => String(row[column] ?? '').includes(needle)); return chain; },
        order() { return chain; },
        limit(n) { limit = n; return chain; },
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        then(resolve) { resolve({ data: run(), error: null }); },
      };
      const run = () => (tables[name] || []).filter(row => filters.every(filter => filter(row))).slice(0, limit);
      return chain;
    },
  };
}

function world(overrides = {}) {
  return {
    psi_tender_processing_jobs: [
      { id: 'pj-new', opportunity_id: 'opp-new', tender_id: 't-new', requested_by: 'juan', status: 'awaiting_analysis_authorization', created_at: '2026-10-06T17:34:00.000Z' },
      { id: 'pj-old', opportunity_id: 'opp-old', tender_id: 't-old', requested_by: 'juan', status: 'awaiting_analysis_authorization', created_at: '2026-09-28T14:51:00.000Z' },
      { id: 'pj-dl', opportunity_id: 'opp-dl', tender_id: 't-dl', requested_by: 'juan', status: 'importing_documents', created_at: '2026-10-06T18:00:00.000Z' },
    ],
    psi_sales_opportunities: [
      { id: 'opp-new', stage_code: 'prospecto', service_type_code: 'licitacion_publica' },
      { id: 'opp-old', stage_code: 'prospecto', service_type_code: 'licitacion_publica' },
      { id: 'opp-dl', stage_code: 'prospecto', service_type_code: 'licitacion_publica' },
    ],
    psi_agt002_initial_analysis_jobs: [],
    psi_tender_document_versions: [
      { id: 'dv-pliego', opportunity_id: 'opp-new', current: true, name: 'Proyecto de Pliego.pdf', tender_id: 't-new' },
      { id: 'dv-bp', opportunity_id: 'opp-new', current: true, name: 'BP-26005486_EBI.pdf', tender_id: 't-new' },
    ],
    psi_tender_document_extractions: [
      { opportunity_id: 'opp-new', document_version_id: 'dv-pliego', status: 'ok', char_count: 1000, created_at: '2026-10-06T18:00:00Z' },
      { opportunity_id: 'opp-new', document_version_id: 'dv-bp', status: 'ok', char_count: 500, created_at: '2026-10-06T18:00:00Z' },
    ],
    ...overrides,
  };
}

const freezeProfile = async (_db, { actorProfileId }) => ({ profileSnapshotId: 'snap-1', profileSnapshotHash: 'a'.repeat(64), actor: actorProfileId });

test('Bogotá day starts at 05:00 UTC', () => {
  assert.equal(agt002BogotaDayStart(new Date('2026-10-06T20:00:00Z')).toISOString(), '2026-10-06T05:00:00.000Z');
  assert.equal(agt002BogotaDayStart(new Date('2026-10-07T03:00:00Z')).toISOString(), '2026-10-06T05:00:00.000Z');
});

test('admits only a ready conversion since the activation, as the converting person, with the rule and the profile', async () => {
  const calls = [];
  const admit = async (_db, input) => { calls.push(input); return { admissionStatus: 'admitted', jobId: 'ij-1' }; };
  const events = await runAgt002AutoInitialAdmissions(fakeDb(world()), { since: SINCE, now: NOW, environment: ON, admit, freezeProfile });
  assert.equal(calls.length, 1, 'the September conversion and the still-downloading one are not admitted');
  const [input] = calls;
  assert.equal(input.opportunityId, 'opp-new');
  assert.equal(input.actorProfileId, 'juan');
  assert.equal(input.scope, 'A_PLUS_B');
  assert.equal(input.profileSnapshotId, 'snap-1');
  assert.equal(input.policyVersion, AGT002_AUTO_INITIAL_POLICY_VERSION);
  assert.equal(input.expiresAt, '2026-10-08T17:34:00.000Z', 'the window comes from the conversion, so a retry replays the same grant');
  assert.deepEqual(input.requestedMembers.map(member => member.document_version_id), ['dv-pliego'], 'the BP/EBI file is excluded by the rule');
  assert.equal(events[0].event, 'agt002_auto_initial_admitted');
});

test('kill switches off: nothing is read or admitted', async () => {
  let admitted = 0;
  const events = await runAgt002AutoInitialAdmissions(fakeDb(world()), { since: SINCE, now: NOW, environment: {}, admit: async () => { admitted += 1; }, freezeProfile });
  assert.equal(admitted, 0);
  assert.deepEqual(events, [{ event: 'agt002_auto_initial_disabled', reason: 'kill_switch_off' }]);
});

test('never a second INITIAL, never a non-prospecto opportunity', async () => {
  let admitted = 0;
  const admit = async () => { admitted += 1; return { admissionStatus: 'admitted' }; };
  await runAgt002AutoInitialAdmissions(fakeDb(world({ psi_agt002_initial_analysis_jobs: [{ id: 'x', opportunity_id: 'opp-new', analysis_kind: 'INITIAL', created_at: '2026-10-01T00:00:00Z' }] })), { since: SINCE, now: NOW, environment: ON, admit, freezeProfile });
  const discarded = world();
  discarded.psi_sales_opportunities[0].stage_code = 'descartado';
  await runAgt002AutoInitialAdmissions(fakeDb(discarded), { since: SINCE, now: NOW, environment: ON, admit, freezeProfile });
  assert.equal(admitted, 0);
});

test('the daily cap defers the rest until tomorrow (Bogotá day), counting analyses already admitted today', async () => {
  const today = Array.from({ length: 5 }, (_, index) => ({ id: `j${index}`, opportunity_id: `other-${index}`, analysis_kind: 'INITIAL', created_at: '2026-10-06T15:00:00.000Z' }));
  let admitted = 0;
  const events = await runAgt002AutoInitialAdmissions(fakeDb(world({ psi_agt002_initial_analysis_jobs: today })), {
    since: SINCE, now: NOW, environment: ON, admit: async () => { admitted += 1; return { admissionStatus: 'admitted' }; }, freezeProfile,
  });
  assert.equal(admitted, 0);
  assert.equal(events[0].event, 'agt002_auto_initial_deferred');
  assert.equal(events[0].reason, 'daily_cap');
  const yesterday = today.map(job => ({ ...job, created_at: '2026-10-06T04:59:00.000Z' }));
  await runAgt002AutoInitialAdmissions(fakeDb(world({ psi_agt002_initial_analysis_jobs: yesterday })), {
    since: SINCE, now: NOW, environment: ON, admit: async () => { admitted += 1; return { admissionStatus: 'admitted' }; }, freezeProfile,
  });
  assert.equal(admitted, 1, 'analyses from the previous Bogotá day do not count');
});

test('no readable document or an elapsed window is skipped; an admission error is reported, never thrown', async () => {
  const unreadable = world({ psi_tender_document_extractions: [] });
  const skipped = await runAgt002AutoInitialAdmissions(fakeDb(unreadable), { since: SINCE, now: NOW, environment: ON, admit: async () => assert.fail('no admission'), freezeProfile });
  assert.equal(skipped[0].reason, 'no_readable_documents');
  const late = await runAgt002AutoInitialAdmissions(fakeDb(world()), { since: SINCE, now: new Date('2026-10-09T00:00:00Z'), environment: ON, admit: async () => assert.fail('no admission'), freezeProfile });
  assert.equal(late[0].reason, 'authorization_window_elapsed');
  const failing = await runAgt002AutoInitialAdmissions(fakeDb(world()), {
    since: SINCE, now: NOW, environment: ON, freezeProfile,
    admit: async () => { const error = new Error('x'); error.code = '55000'; throw error; },
  });
  assert.deepEqual(failing[0], { event: 'agt002_auto_initial_failed', code: '55000', opportunityId: 'opp-new', processingJobId: 'pj-new' });
});

test('decisión del dueño 2026-10-09: una oportunidad no activa (NO GO vigente, estado de oferta terminal) nunca se analiza', async () => {
  const calls = [];
  const admit = async (_db, input) => { calls.push(input.opportunityId); return { admissionStatus: 'admitted', jobId: 'ij' }; };
  const noGo = world({ psi_tender_go_no_go_decisions: [{ id: 'd1', opportunity_id: 'opp-new', tender_id: 't-new', decision: 'no_go', decided_at: '2026-10-06T19:00:00Z' }] });
  assert.deepEqual(await runAgt002AutoInitialAdmissions(fakeDb(noGo), { since: SINCE, now: NOW, environment: ON, admit, freezeProfile }), []);
  const closed = world();
  closed.psi_sales_opportunities[0].tender_offer_status = 'cerrada_no_go';
  assert.deepEqual(await runAgt002AutoInitialAdmissions(fakeDb(closed), { since: SINCE, now: NOW, environment: ON, admit, freezeProfile }), []);
  assert.deepEqual(calls, []);
  const go = world({ psi_tender_go_no_go_decisions: [{ id: 'd1', opportunity_id: 'opp-new', tender_id: 't-new', decision: 'go', decided_at: '2026-10-06T19:00:00Z' }] });
  await runAgt002AutoInitialAdmissions(fakeDb(go), { since: SINCE, now: NOW, environment: ON, admit, freezeProfile });
  assert.deepEqual(calls, ['opp-new'], 'En curso (GO) sí se analiza');
});

test('decisión del dueño 2026-10-09: el host sólo impulsa la descarga de documentos de oportunidades activas', async () => {
  const tables = world({ psi_tender_go_no_go_decisions: [{ id: 'd1', opportunity_id: 'opp-dl', decision: 'no_go', decided_at: '2026-10-06T19:00:00Z' }] });
  tables.psi_sales_opportunities[1].stage_code = 'perdido';
  const jobs = tables.psi_tender_processing_jobs;
  assert.deepEqual((await filterAgt002ActiveProcessingJobs(fakeDb(tables), jobs)).map(job => job.id), ['pj-new']);
  const { readFileSync } = await import('node:fs');
  const runner = readFileSync(new URL('../ops/agt002-auto-initial/run-agt002-auto-initial.mjs', import.meta.url), 'utf8');
  assert.match(runner.match(/async function claimableJobs[\s\S]*?\n\}/)[0], /filterAgt002ActiveProcessingJobs\(database, data \|\| \[\]\)/);
});

test('an activation date is required', async () => {
  await assert.rejects(runAgt002AutoInitialAdmissions(fakeDb(world()), { environment: ON }), /AGT002_AUTO_INITIAL_SINCE/);
});
