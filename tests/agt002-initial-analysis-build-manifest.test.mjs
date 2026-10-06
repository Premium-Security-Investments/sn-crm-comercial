import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyAgt002InitialDocument } from '../scripts/agt002-initial-analysis-build-manifest.mjs';

const doc = (name, hasText = true, gapReason = null) => classifyAgt002InitialDocument({ name, hasText, gapReason });

test('the selection rule keeps everything that defines requirements and conditions', () => {
  for (const name of ['PROYECTO PLIEGO DE CONDICIONES.pdf', '1. Estudios_Previos_Vigilancia 2026 _1_.pdf', 'ANEXO - ESPECIFICACIONES TECNICAS v1.pdf',
    'PROYECTO SIES DERIS ESP TECNICAS.pdf', 'MATRIZ DE RIESGOS _2_.xlsx', 'AVISO DE CONVOCATORIA SECOP II.pdf', 'FORMATO OFERTA ECONOMICA.xlsx',
    'CDP .pdf', 'Solicitud Vigencia futura.pdf', 'Registro_2-2026-064809 aprobacion Hacienda _2_.pdf', 'Adenda N° 02 LP-001-2026.pdf']) {
    assert.equal(doc(name).include, true, name);
  }
});

test('the rule leaves out only what does not define requirements, and says why', () => {
  for (const name of ['COTIZACIONES.zip', 'BP-26005339_002.xlsx', 'Detallado BP-26005339_002.xlsx', 'FICHA_EBI_BP-26005339.pdf',
    'DESIGNACION EQUIPO ESTRUCTURADOR.pdf', 'Radicado 262147991.pdf', '262151069.pdf']) {
    const result = doc(name);
    assert.equal(result.include, false, name);
    assert.ok(result.reason.length > 10);
  }
});

test('a document without extracted text is excluded and its gap is reported, never silently dropped', () => {
  const result = doc('MATRIZ N_ 1 RIESGOS .xls', false, 'unsupported_type');
  assert.equal(result.include, false);
  assert.match(result.reason, /sin texto extraído \(unsupported_type\)/);
});

test('decision documents are ordered first: amendments and the pliego before annexes and budget papers', () => {
  assert.ok(doc('Adenda 1.pdf').rank < doc('PROYECTO PLIEGO.pdf').rank);
  assert.ok(doc('PROYECTO PLIEGO.pdf').rank < doc('ANEXOS.docx').rank);
  assert.ok(doc('ESTUDIOS PREVIOS.pdf').rank < doc('CDP.pdf').rank);
});
