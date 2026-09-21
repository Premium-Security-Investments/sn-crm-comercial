// AGT-002 / Vig-IA — server-owned document relevance suggestion, pure model contract.
// (.hermes/plans/2026-09-21-vigia-document-preselection.md)
//
// suggestAgt002DocumentRelevance(document) is a PURE, synchronous, deterministic function. It
// never decides for Licitaciones: it only produces a conservative suggestion from
// { document_type, name, extracted_text } signals — never exclusion, never a universal filename
// rule, never a reproduction of the document's own text in its output.
import { strict as assert } from 'node:assert';
import { suggestAgt002DocumentRelevance } from '../agt002-document-relevance-suggestion.js';

const OWN_KEYS = ['confidence', 'policy_version', 'reason', 'reason_code', 'recommended'];

function assertClosedShape(result) {
  assert.deepEqual(Object.keys(result).sort(), OWN_KEYS);
  assert.equal(typeof result.recommended, 'boolean');
  assert.ok(['high', 'medium', 'low'].includes(result.confidence), `confidence must be high|medium|low, got ${result.confidence}`);
  assert.equal(typeof result.reason_code, 'string');
  assert.ok(result.reason_code.length > 0);
  assert.equal(typeof result.reason, 'string');
  assert.ok(result.reason.length > 0);
  assert.equal(result.policy_version, 'agt002-document-relevance-v1');
}

// --- Case 1: pliego identified by document_type + filename => recommended, high confidence. -----
const pliego = suggestAgt002DocumentRelevance({
  document_type: 'pliego_definitivo',
  name: 'Pliego de condiciones definitivo.pdf',
  extracted_text: '',
});
assertClosedShape(pliego);
assert.equal(pliego.recommended, true);
assert.equal(pliego.confidence, 'high');

// --- Case 2: generic filename, but extracted text carries >=2 strong headings => medium. --------
const strongHeadings = suggestAgt002DocumentRelevance({
  document_type: 'anexo',
  name: 'documento_123.pdf',
  extracted_text: [
    'ANEXO TÉCNICO No. 3',
    '1. REQUISITOS HABILITANTES',
    'El proponente debe acreditar experiencia mínima de cinco (5) años...',
    '2. ESPECIFICACIONES TÉCNICAS',
    'El bien o servicio ofertado debe cumplir con las siguientes condiciones técnicas...',
  ].join('\n'),
});
assertClosedShape(strongHeadings);
assert.equal(strongHeadings.recommended, true);
assert.equal(strongHeadings.confidence, 'medium');

// --- Case 3: unknown generic document, no signals at all => not recommended, low, neutral. ------
const unknownGeneric = suggestAgt002DocumentRelevance({
  document_type: 'otro',
  name: 'documento_456.pdf',
  extracted_text: 'Texto genérico sin relación aparente con ningún tipo documental conocido.',
});
assertClosedShape(unknownGeneric);
assert.equal(unknownGeneric.recommended, false);
assert.equal(unknownGeneric.confidence, 'low');
assert.match(unknownGeneric.reason, /Licitaciones/i, 'a rejection reason must still name Licitaciones as the one who may include it');
assert.match(unknownGeneric.reason, /incluir/i);
assert.doesNotMatch(unknownGeneric.reason, /irrelevante/i, 'a document must never be called irrelevant, only "no signals detected"');
assert.doesNotMatch(unknownGeneric.reason, /no aplica|descart/i, 'wording must not read as a rejection/discard verdict');

// --- Case 4: photo/certificate filename, no positive signal => not recommended, low. ------------
const photo = suggestAgt002DocumentRelevance({
  document_type: 'certificado',
  name: 'foto_camara_comercio.jpg',
  extracted_text: '',
});
assertClosedShape(photo);
assert.equal(photo.recommended, false);
assert.equal(photo.confidence, 'low');
assert.doesNotMatch(photo.reason, /irrelevante/i);

// --- Case 5: the document's own text content is never echoed back in reason or JSON output. -----
const marker = 'MARCADOR_UNICO_NO_DEBE_APARECER_9f3a1c4e';
const withMarker = suggestAgt002DocumentRelevance({
  document_type: 'anexo',
  name: 'documento_789.pdf',
  extracted_text: `Cláusula confidencial: ${marker} — información sensible del proceso.`,
});
assertClosedShape(withMarker);
const serialized = JSON.stringify(withMarker);
assert.ok(!serialized.includes(marker), 'the raw extracted_text content must never be echoed into the suggestion output');
assert.ok(!withMarker.reason.includes(marker));

// --- Case 6: prototype-ish / malformed inputs never throw (fail closed, not fail loud). ----------
const nullProtoDoc = Object.create(null);
nullProtoDoc.document_type = 'pliego';
nullProtoDoc.name = 'pliego.pdf';
nullProtoDoc.extracted_text = '';
assert.doesNotThrow(() => suggestAgt002DocumentRelevance(nullProtoDoc));

assert.doesNotThrow(() => suggestAgt002DocumentRelevance({}));
assert.doesNotThrow(() => suggestAgt002DocumentRelevance({ document_type: null, name: undefined, extracted_text: null }));
assert.doesNotThrow(() => suggestAgt002DocumentRelevance({ document_type: 123, name: 456, extracted_text: {} }));
assert.doesNotThrow(() => suggestAgt002DocumentRelevance({ document_type: 'pliego', name: 'pliego.pdf', extracted_text: 'x'.repeat(500000) }));

for (const malformed of [{}, { document_type: null, name: undefined, extracted_text: null }, { document_type: 123, name: 456, extracted_text: {} }]) {
  assertClosedShape(suggestAgt002DocumentRelevance(malformed));
}

// --- Exact own-key output contract (no extra keys, ever). ----------------------------------------
assert.deepEqual(Object.keys(pliego).sort(), OWN_KEYS);
assert.deepEqual(Object.keys(unknownGeneric).sort(), OWN_KEYS);

console.log('AGT-002 Vig-IA document relevance suggestion pure model contract passed');
