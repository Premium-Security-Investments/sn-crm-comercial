// Indicadores de ofertas (encargo AGT-002 del 2026-11-07): por mes y en lo que va del año, en hora de Colombia, contra
// la meta anual; y el aviso de cierres con GO sin registro.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTenderOfferIndicators, currentGoDecisions, pendingSubmissionReminders, parseTenderOfferResult, parseTenderOfferSubmission } from '../verticales/licitaciones/tender-offer-records.js';

test('indicadores por mes y acumulado, con el valor concursado del presupuesto oficial y el avance de la meta', () => {
  const out = buildTenderOfferIndicators({
    year: 2027, now: new Date('2027-03-15T12:00:00Z'),
    opportunities: [{ created_at: '2027-01-10T15:00:00Z' }, { created_at: '2027-02-01T03:00:00Z' }, { created_at: '2026-12-31T23:00:00Z' }],
    goDecisions: [{ opportunity_id: 'a', decided_at: '2027-02-10T15:00:00Z' }],
    submissions: [
      { opportunity_id: 'a', kind: 'presentada', submitted_at: '2027-02-20T14:00:00Z' },
      { opportunity_id: 'b', kind: 'no_presentada', submitted_at: null },
      { opportunity_id: 'c', kind: 'presentada', submitted_at: '2027-03-01T04:00:00Z' },
    ],
    results: [{ opportunity_id: 'a', result: 'ganada', awarded_value: 5000000000, created_at: '2027-03-05T15:00:00Z' }, { opportunity_id: 'c', result: 'perdida', created_at: '2027-03-06T15:00:00Z' }],
    tenderValues: { a: 8000000000, b: 1, c: 7000000000 },
    goals: [{ year: 2027, target_value: 150000000000, created_at: '2026-11-07T00:00:00Z' }],
  });
  assert.equal(out.months.length, 3, 'hasta el mes en curso');
  // 2027-02-01T03:00Z es 31-ene en Colombia; 2026-12-31 no es de este año.
  assert.deepEqual(out.months.map(m => m.calificadas), [2, 0, 0]);
  // 2027-03-01T04:00Z es 28-feb en Colombia.
  assert.deepEqual(out.months.map(m => m.presentadas), [0, 2, 0]);
  assert.equal(out.ytd.valor_concursado, 15000000000);
  assert.equal(out.ytd.adjudicadas, 1);
  assert.equal(out.ytd.valor_adjudicado, 5000000000);
  assert.equal(out.ytd.go, 1);
  assert.deepEqual(out.goal, { target_value: 150000000000, progress: 10 });
});

test('GO vigente: una decisión reemplazada no cuenta', () => {
  const go = currentGoDecisions([
    { id: '1', opportunity_id: 'a', decision: 'go', decided_at: '2027-01-01' },
    { id: '2', opportunity_id: 'a', decision: 'no_go', decided_at: '2027-01-02', supersedes_decision_id: '1' },
    { id: '3', opportunity_id: 'b', decision: 'go', decided_at: '2027-01-03' },
  ]);
  assert.deepEqual(go.map(row => row.opportunity_id), ['b']);
});

test('aviso: cierre pasado, GO vigente, sin registro y sin archivar', () => {
  const rows = pendingSubmissionReminders({
    today: '2026-11-08',
    goOpportunityIds: new Set(['terminal', 'manizales', 'archivada', 'registrada']),
    submittedOpportunityIds: new Set(['registrada']),
    processes: [
      { opportunity_id: 'terminal', entity: 'Terminal', close_date: '2026-11-04', offer_status: 'en_preparacion' },
      { opportunity_id: 'manizales', entity: 'Manizales', close_date: '2026-11-25', offer_status: 'en_preparacion' },
      { opportunity_id: 'archivada', entity: 'Supersalud', close_date: '2026-11-05', offer_status: 'en_preparacion', archived: true },
      { opportunity_id: 'registrada', entity: 'X', close_date: '2026-11-01', offer_status: 'en_preparacion' },
      { opportunity_id: 'sin-go', entity: 'Y', close_date: '2026-11-01', offer_status: 'en_preparacion' },
    ],
  });
  assert.deepEqual(rows.map(row => row.opportunity_id), ['terminal']);
});

test('los formularios piden lo que exige el encargo', () => {
  assert.throws(() => parseTenderOfferSubmission({ kind: 'presentada', filing_reference: 'RPL 1', submitted_at: '2026-11-04T09:00:00-05:00', evidence_url: 'http://inseguro' }), /https/);
  assert.equal(parseTenderOfferSubmission({ kind: 'presentada', filing_reference: ' RPL 6017126 ', submitted_at: '2026-11-04T09:12:00-05:00', evidence_url: 'https://x.co/r.pdf' }).filing_reference, 'RPL 6017126');
  assert.equal(parseTenderOfferResult({ result: 'ganada', source_kind: 'acto_adjudicacion', source_note: 'Resolución 123', awarded_value: '$ 8.440.291.324' }).awarded_value, 8440291324);
  assert.throws(() => parseTenderOfferResult({ result: 'perdida', source_kind: 'informe_evaluacion' }), /fuente/);
});
