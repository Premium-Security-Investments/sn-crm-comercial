import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  runTenderOfficialValuesReview,
  tenderBudgetFigures,
  tenderBudgetOf,
  tenderClosingDayFromDeadlines,
  tenderDocumentWeight,
  tenderOfficialBudget,
  tenderOfficialValuesPlan,
} from '../verticales/licitaciones/tender-official-values.js';

// Manizales LP-01-2026 (Juan, 2026-11-11): el pliego definitivo del 10-nov bajó el presupuesto a la mitad y el CRM siguió
// con el viejo. Frases literales del proyecto, del definitivo y del pliego de Fiscalía FGN-REC-IPSE-0058-2026.
const PROYECTO = '1.3. VALOR DEL PRESUPUESTO OFICIAL ESTIMADO:\nEl presupuesto oficial estimado para el presente proceso licitatorio corresponde a la suma de DIECISEIS MIL TRESCIENTOS CINCUENTA Y CINCO MILLONES OCHOCIENTOS SETENTA Y UN MIL TRESCIENTOS CUARENTA Y DOS PESOS MCTE ($16.355.871.342), INCLUIDO IVA.';
const DEFINITIVO = '1.3. VALOR DEL PRESUPUESTO OFICIAL ESTIMADO:\nEl presupuesto oficial estimado para el presente proceso licitatorio corresponde a la suma de OCHO MIL CUATROCIENTOS OCHENTA Y UN MILLONES OCHOCIENTOS CINCUENTA Y SEIS MIL SETENTA Y CUATRO PESOS MCTE. ($8.481.856.074), INCLUIDO IVA.\nCapital de trabajo mayor o igual al 30% del presupuesto oficial estimado.';
const FISCALIA = 'PRESUPUESTO OFICIAL:\n\nEl presupuesto oficial es por la suma de VEINTISÉIS MIL DOSCIENTOS TREINTA Y OCHO MILLONES CIENTO TREINTA Y SEIS MIL CUATROCIENTOS OCHENTA Y SIETE PESOS\nM/CTE ($26.238.136.487=), incluido IVA, AIU, AYS.';
const doc = (name, extracted_text, created_at = '2026-11-11T14:52:01Z', document_type = 'pliego') => ({ name, extracted_text, created_at, document_type });

test('la cifra entre paréntesis después de «presupuesto oficial», también con «=)»', () => {
  assert.deepEqual([...new Set(tenderBudgetFigures(PROYECTO))], [16355871342], 'dos menciones, la misma cifra');
  assert.equal(tenderBudgetOf(DEFINITIVO), 8481856074, 'una mención sin cifra no estorba');
  assert.equal(tenderBudgetOf(FISCALIA), 26238136487);
  assert.equal(tenderBudgetOf('Sin presupuesto aquí ($1.000.000).'), null);
  assert.equal(tenderBudgetOf(`${PROYECTO}\n${DEFINITIVO}`), null, 'dos cifras distintas en un documento: no se decide');
});

test('manda el documento más fuerte: adenda, definitivo, apertura; un proyecto nunca', () => {
  assert.equal(tenderDocumentWeight({ name: '10. Proyecto Pliego de Condiciones LP-01-2026.pdf' }), -1);
  assert.equal(tenderDocumentWeight({ name: 'ADENDA No. 1.pdf' }), 4);
  assert.equal(tenderDocumentWeight({ name: '16. Pliego de Condiciones Definitivo LP-01-2026.pdf' }), 3);
  assert.equal(tenderDocumentWeight({ name: '2. Estudios Previos Definitivo.pdf' }), 0, '«definitivo» sin ser pliego no gana');
  // El aviso viejo se volvió a bajar después (10-nov 19:01Z) y sigue con la cifra vieja: no gana por ser reciente.
  const budget = tenderOfficialBudget([
    doc('16. Pliego de Condiciones Definitivo LP-01-2026.pdf', DEFINITIVO, '2026-11-11T14:52:01Z'),
    doc('9. Aviso de Licitación Pública LP-01-2026.pdf', PROYECTO, '2026-11-12T19:01:43Z', 'otro'),
    doc('10. Proyecto Pliego de Condiciones LP-01-2026.pdf', PROYECTO, '2026-11-10T19:01:56Z'),
  ]);
  assert.equal(budget.value, 8481856074);
  assert.equal(budget.document.name, '16. Pliego de Condiciones Definitivo LP-01-2026.pdf');
  assert.deepEqual(budget.official.sort(), [16355871342, 8481856074].sort());
});

test('el plan: cambia una copia oficial, respeta un valor puesto a mano y una oferta presentada', () => {
  const documents = [doc('16. Pliego de Condiciones Definitivo LP-01-2026.pdf', DEFINITIVO), doc('9. Aviso.pdf', PROYECTO, '2026-11-04T22:19:33Z', 'otro')];
  const deadlines = [{ kind: 'SUBMISSION', label: 'Presentación de Ofertas', value: '2026-11-25T14:00:00-05:00', certainty: 'CONFIRMED' }];
  const manizales = tenderOfficialValuesPlan({ opportunity: { offer_value: 16355871342, expected_close_date: '2026-11-25', tender_offer_status: 'en_preparacion' }, secopValue: 16355871342, documents, deadlines });
  assert.deepEqual(manizales.updates, { offer_value: 8481856074 });
  assert.match(manizales.lines[0], /pasó de \$16\.355\.871\.342 a \$8\.481\.856\.074, el presupuesto oficial de «16\. Pliego de Condiciones Definitivo LP-01-2026\.pdf»/);
  const aMano = tenderOfficialValuesPlan({ opportunity: { offer_value: 7000000000, tender_offer_status: 'en_preparacion' }, secopValue: 16355871342, documents, deadlines: [] });
  assert.deepEqual(aMano.updates, {});
  assert.match(aMano.lines[0], /no es una cifra oficial, así que no se cambió/);
  const presentada = tenderOfficialValuesPlan({ opportunity: { offer_value: 16355871342, tender_offer_status: 'presentada' }, secopValue: 16355871342, documents, deadlines });
  assert.deepEqual(presentada.updates, {});
  assert.equal(presentada.skipped, 'oferta_presentada_o_cerrada');
  const alDia = tenderOfficialValuesPlan({ opportunity: { offer_value: 8481856074, expected_close_date: '2026-11-25', tender_offer_status: 'en_preparacion' }, secopValue: 16355871342, documents, deadlines });
  assert.deepEqual(alDia, { updates: {}, lines: [] }, 'al día: ni cambios ni constancias');
});

test('el cierre sale del cronograma confirmado, en hora de Bogotá; uno por confirmar no cuenta', () => {
  assert.equal(tenderClosingDayFromDeadlines([{ kind: 'SUBMISSION', value: '2026-11-25T14:00:00-05:00', certainty: 'CONFIRMED' }]), '2026-11-25');
  assert.equal(tenderClosingDayFromDeadlines([{ kind: 'SUBMISSION', value: '2026-11-26T03:30:00Z', certainty: 'CONFIRMED' }]), '2026-11-25');
  assert.equal(tenderClosingDayFromDeadlines([{ kind: 'SUBMISSION', value: '2026-11-25T14:00:00-05:00', certainty: 'PROBABLE' }]), null);
  assert.equal(tenderClosingDayFromDeadlines([{ kind: 'SUBMISSION', value: '2026-10-20T00:00:00Z', certainty: 'CONFIRMED' }]), '2026-10-20', 'medianoche UTC es una fecha: no se corre al día anterior');
  const plan = tenderOfficialValuesPlan({ opportunity: { offer_value: 0, expected_close_date: '2026-11-24', tender_offer_status: 'pendiente_decision' }, documents: [], deadlines: [{ kind: 'SUBMISSION', value: '2026-11-25T14:00:00-05:00', certainty: 'CONFIRMED' }] });
  assert.deepEqual(plan.updates, { expected_close_date: '2026-11-25' });
});

test('la revisión escribe sólo la oportunidad y deja la constancia; sólo documentos de la entidad', async () => {
  const writes = [];
  const lines = [];
  const rows = {
    psi_public_tenders: [{ id: 't1', ref: 'LP-01-2026', value: '16355871342', converted_opportunity_id: 'o1', internal_status: 'convertida_oportunidad' }],
    psi_sales_opportunities: { id: 'o1', offer_value: 16355871342, expected_close_date: '2026-11-25', tender_offer_status: 'en_preparacion' },
    psi_tender_document_versions: [
      { ...doc('16. Pliego de Condiciones Definitivo LP-01-2026.pdf', DEFINITIVO), origin: 'entidad' },
      { ...doc('Nuestro cálculo con presupuesto.xlsx', 'Presupuesto oficial ($9.999.999.999)', '2026-11-13T00:00:00Z'), origin: 'propio' },
    ],
    psi_tender_analysis_runs: [{ result: { meta: { process_deadlines: [] } } }],
  };
  const database = {
    from(table) {
      const query = {
        select: () => query, eq: () => query, limit: () => query,
        maybeSingle: async () => ({ data: rows[table], error: null }),
        update(values) { writes.push({ table, values }); return { eq: async () => ({ error: null }) }; },
        then: (ok, ko) => Promise.resolve({ data: rows[table], error: null }).then(ok, ko),
      };
      return query;
    },
  };
  const events = await runTenderOfficialValuesReview(database, {
    appendLine: async (_db, opportunityId, line) => lines.push({ opportunityId, line }),
    isEntityDocument: document => document.origin === 'entidad',
  });
  assert.deepEqual(writes, [{ table: 'psi_sales_opportunities', values: { offer_value: 8481856074 } }]);
  assert.equal(lines.length, 1);
  assert.equal(events[0].event, 'tender_official_values_updated');
});

test('la revisión programada corre el paso, con los documentos de la entidad', () => {
  const review = readFileSync(new URL('../verticales/licitaciones/agt002-phase-change-review.js', import.meta.url), 'utf8');
  assert.match(review, /officialValuesReview = runTenderOfficialValuesReview/);
  assert.match(review, /step\('official_values'/);
  assert.match(review, /isEntityDocument: document => tenderDocumentBreaksEntitySilence\(document, agt002IsOfficialDocumentSource\)/);
});
