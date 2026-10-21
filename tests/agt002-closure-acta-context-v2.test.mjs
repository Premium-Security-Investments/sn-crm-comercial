// 2026-10-21, acta de Cali: el acta se redactó sólo con la nota de cierre ("el contexto no trae el numeral exacto")
// porque el contexto sólo entendía el formato viejo del análisis (analysis_units). Fija: con el análisis vigente
// (pre_go_analysis.v2) el acta recibe el veredicto de participación, la recomendación, los hallazgos y los requisitos
// no cumplidos o pendientes, cada uno con su numeral; lo que bloquea va primero; el formato viejo sigue funcionando.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closureActaContextFromAnalysis } from '../agt002-closure-acta-draft.js';

const V2 = {
  claims: [
    { claim_id: 'CLM-PARTICIPACION', display_text: 'Solo en unión temporal: sede principal en Pereira.', inference_basis: 'perfil: sedes', source_refs: [{ document_id: 'd1', locator: 'Numeral 3.1.15' }] },
    { claim_id: 'CLM-DOM', display_text: 'Domicilio principal en Cali con 5 años.', source_refs: [{ document_id: 'd1', locator: 'Numeral 3.1.15, pág. 43' }] },
    { claim_id: 'CLM-FIN', display_text: 'Liquidez 1,40 o más.', source_refs: [{ document_id: 'd1', locator: 'Numeral 3.3' }] },
  ],
  findings: [
    { finding_id: 'F-FIN', title: 'Indicadores superan lo exigido', impact: 'Cumple con margen.', severity: 'INFO', blocker: false, claim_ids: ['CLM-FIN'] },
    { finding_id: 'F-DOM', title: 'Presencia en Cali sin confirmar', impact: 'El pliego exige domicilio principal en Cali.', severity: 'CRITICAL', blocker: true, claim_ids: ['CLM-DOM'] },
  ],
  requirements: [
    { requirement_id: 'REQ-DOM', text_claim_id: 'CLM-DOM', company_evaluation: 'BLOCKER', required_action: 'Aliado con domicilio en Cali.' },
    { requirement_id: 'REQ-FIN', text_claim_id: 'CLM-FIN', company_evaluation: 'VERIFIED', required_action: null },
  ],
  recommendation: { kind: 'NO_GO_RECOMMENDED', label: 'No puede presentarse: domicilio principal en Cali.', basis_claim_ids: ['CLM-DOM'] },
};

test('el análisis vigente llega al acta con numerales, y lo que bloquea va primero', () => {
  const context = closureActaContextFromAnalysis(V2);
  assert.ok(context.length >= 4);
  assert.equal(context[0].label, 'Participación según el análisis');
  assert.equal(context[0].source_ref, 'Numeral 3.1.15');
  const domicilio = context.find(entry => entry.label === 'Presencia en Cali sin confirmar');
  assert.equal(domicilio.source_ref, 'Numeral 3.1.15, pág. 43');
  const requisito = context.find(entry => entry.text.includes('La empresa no cumple.'));
  assert.match(requisito.text, /Domicilio principal en Cali con 5 años\. La empresa no cumple\. Aliado con domicilio en Cali\./);
  assert.ok(!context.some(entry => entry.text.startsWith('Liquidez')), 'un requisito verificado no es motivo de cierre');
  const firstNonBlocking = context.findIndex(entry => entry.label === 'Recomendación del análisis');
  const lastBlocking = context.map(entry => entry.label).lastIndexOf('Presencia en Cali sin confirmar');
  assert.ok(lastBlocking < firstNonBlocking, 'lo que bloquea va antes');
  for (const entry of context) assert.deepEqual(Object.keys(entry).sort(), ['label', 'source_ref', 'text']);
});

test('el formato viejo (analysis_units) sigue funcionando y un análisis vacío no rompe', () => {
  const legacy = closureActaContextFromAnalysis({ analysis_units: [{ title: 'Experiencia', conclusion: { summary: 'No cumple.', status: 'no_cumple' }, evidence_refs: [{ ref: 'num. 4.2' }] }] });
  assert.deepEqual(legacy, [{ label: 'Experiencia', source_ref: 'num. 4.2', text: 'No cumple.' }]);
  assert.deepEqual(closureActaContextFromAnalysis(null), []);
  assert.deepEqual(closureActaContextFromAnalysis({}), []);
});
