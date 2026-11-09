// F12 reabierto (Fiscalía FGN-REC-IPSE-0058-2026, reanálisis 856a12ae del 9-nov): el requisito de sedes estaba como
// BLOCKER con «no se sabe si el pliego permite sumar la presencia» y no se releyó, y precio y experiencia gastaban el
// cupo de 4 numerales antes que los habilitantes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { AGT002_SECCIONES_PENDIENTES_MAX, agt002NumeralesPendientes } from '../verticales/licitaciones/agt002-secciones-pendientes.js';

const claim = (id, locator, text = '') => ({ claim_id: id, display_text: text, source_refs: [{ document_id: 'pliego', locator }] });
const req = (id, category, evaluation, claimId) => ({ requirement_id: id, category, company_evaluation: evaluation, text_claim_id: claimId });

const PRIOR = {
  claims: [
    claim('C-PRECIO', 'Num. 6.1'), claim('C-PRECIO2', 'Num. 6.2'), claim('C-EXP', 'Num. 4.3'), claim('C-EXP2', 'Num. 4.4'),
    claim('C-FIN', 'Num. 5.2.1'), claim('C-POL', 'Num. 7.1'), claim('C-PERS', 'Num. 5.3.4'),
    claim('C-SEDES', 'Num. 5.3.2 punto 1 (pág. 38)', 'No se sabe si el pliego permite sumar la presencia territorial entre integrantes.'),
    claim('C-TIC', 'Num. 5.3.3', 'Licencia de comunicaciones: no está claro si cubre Quibdó.'),
  ],
  requirements: [
    req('REQ-PRECIO', 'ECONOMIC', 'PENDING', 'C-PRECIO'), req('REQ-PRECIO2', 'ECONOMIC', 'PENDING', 'C-PRECIO2'),
    req('REQ-EXP', 'EXPERIENCE', 'PENDING', 'C-EXP'), req('REQ-EXP2', 'EXPERIENCE', 'PENDING', 'C-EXP2'),
    req('REQ-FIN', 'FINANCIAL', 'PENDING', 'C-FIN'), req('REQ-POL', 'INSURANCE', 'PENDING', 'C-POL'), req('REQ-PERS', 'PERSONNEL', 'PENDING', 'C-PERS'),
    req('REQ-SEDES-CUATRO-CIUDADES', 'LEGAL', 'BLOCKER', 'C-SEDES'),
    req('REQ-LICENCIA-TIC', 'LICENSE', 'AVAILABLE', 'C-TIC'),
    req('REQ-OK', 'LICENSE', 'VERIFIED', 'C-OK'),
  ],
};

test('caso Fiscalía: el bloqueo de sedes va primero y entra su numeral 5.3.2', () => {
  const out = agt002NumeralesPendientes(PRIOR);
  assert.deepEqual(out[0], { document_id: 'pliego', numeral: '5.3.2', requirement_id: 'REQ-SEDES-CUATRO-CIUDADES' });
});

test('un requisito «disponible» con duda escrita también se relee, antes que los pendientes', () => {
  const out = agt002NumeralesPendientes(PRIOR);
  assert.equal(out[1].requirement_id, 'REQ-LICENCIA-TIC');
});

test('los habilitantes van antes que experiencia y precio; el tope deja afuera el precio', () => {
  const ids = agt002NumeralesPendientes(PRIOR).map(item => item.requirement_id);
  assert.equal(ids.length, AGT002_SECCIONES_PENDIENTES_MAX);
  assert.deepEqual(ids.slice(2), ['REQ-PERS', 'REQ-FIN', 'REQ-POL', 'REQ-EXP']);
  assert.ok(!ids.includes('REQ-PRECIO'));
  assert.ok(!ids.includes('REQ-OK'), 'lo verificado no se relee');
});
