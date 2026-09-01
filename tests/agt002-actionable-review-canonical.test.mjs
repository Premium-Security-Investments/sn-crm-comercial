// AGT-002 actionable review — canonicalization/hash module (design §6.4).
// RED: `agt002-actionable-review-canonical.js` does not exist yet, so this
// import fails at module resolution (MODULE_NOT_FOUND) before any assertion
// runs. That import failure IS the missing-behavior proof for this file: no
// canonical JSON / SHA-256 module exists for the actionable-review contract.
import assert from 'node:assert/strict';
import {
  ACTIONABLE_REVIEW_INTEGRAL_UNIT_PROJECTION_KEYS,
  buildActionableReviewIntegralUnitSource,
  canonicalizeActionableReviewJson,
  hashActionableReviewJson,
} from '../agt002-actionable-review-canonical.js';

const HASH_CONTRACT = 'agt002-actionable-review-json-v1';

// --- Normative vectors from the approved design (§6.4) — must hold in Node
// and, once ported, identically in both backend routes. -----------------------
await (async function normativeVectorPassesBasicKeyOrderingAndNfc() {
  const value = { b: 1, a: 'café' }; // 'e' + combining acute -> NFC 'café'
  assert.equal(canonicalizeActionableReviewJson(value), '{"a":"café","b":1}');
  assert.equal(
    hashActionableReviewJson(value),
    'd54b12e4d04fc4825c9cf655ea7fc9646e75eaf3e0e1bb726eead37376c313fd',
  );
})();

await (async function normativeVectorPassesNullArrayAndNegativeZero() {
  const value = { items: [null, { z: -0, a: true }], at: '2026-08-31' };
  assert.equal(canonicalizeActionableReviewJson(value), '{"at":"2026-08-31","items":[null,{"a":true,"z":0}]}');
  assert.equal(
    hashActionableReviewJson(value),
    'ce97d52c53eef7d6285e68d5fb2bf3c57c5341a18e1bd379292926b1f71488d3',
  );
})();

// --- Only plain JSON values are accepted; everything else is rejected -------
await (async function rejectsNonJsonValues() {
  const rejected = [
    ['undefined', undefined],
    ['function', () => {}],
    ['symbol', Symbol('x')],
    ['bigint', 10n],
    ['NaN inside object', { n: NaN }],
    ['Infinity inside object', { n: Infinity }],
    ['-Infinity inside object', { n: -Infinity }],
    ['Date instance', { d: new Date('2026-08-31T00:00:00.000Z') }],
    ['sparse array hole', [1, , 3]],
    ['non-plain prototype', Object.create({ inherited: true })],
    ['class instance', new (class Foo { constructor() { this.x = 1; } })()],
  ];
  for (const [label, value] of rejected) {
    assert.throws(() => canonicalizeActionableReviewJson(value), `must reject ${label}`);
    assert.throws(() => hashActionableReviewJson(value), `hash must reject ${label}`);
  }
})();

// --- NFC normalization of keys; a post-NFC key collision is a hard error ----
await (async function rejectsKeyCollisionAfterNfc() {
  const nfcKey = String.fromCodePoint(0x00e1); // precomposed 'a with acute' (U+00E1)
  const nfdKey = 'á'; // 'a' + combining acute accent (U+0301) — two code points, same grapheme
  assert.notEqual(nfcKey, nfdKey, 'the two key encodings must be distinct before normalization (marker A)');
  assert.equal(nfcKey.normalize('NFC'), nfdKey.normalize('NFC'), 'both must converge to the same NFC form');
  const colliding = { [nfcKey]: 1, [nfdKey]: 2 };
  assert.throws(() => canonicalizeActionableReviewJson(colliding), /nfc|colisi/i);
})();

// --- Recursive key ordering by UTF-16 code unit; arrays preserve order/length/null
await (async function ordersKeysRecursivelyAndPreservesArrayShape() {
  const value = { z: 1, a: { z: 1, a: 1 }, m: [3, null, 1, null] };
  assert.equal(canonicalizeActionableReviewJson(value), '{"a":{"a":1,"z":1},"m":[3,null,1,null],"z":1}');
})();

// --- Output is compact (no spaces), UTF-8, no BOM ----------------------------
await (async function outputIsCompactUtf8NoWhitespace() {
  const value = { a: 1, b: [1, 2] };
  const canonical = canonicalizeActionableReviewJson(value);
  assert.doesNotMatch(canonical, /\s/);
  assert.equal(Buffer.from(canonical, 'utf8').includes(Buffer.from([0xef, 0xbb, 0xbf])), false);
})();

// --- Hash is SHA-256 hex over the exact canonical UTF-8 bytes, lowercase -----
await (async function hashIsLowercaseHexSha256OfCanonicalBytes() {
  const { createHash } = await import('node:crypto');
  const value = { requirement_id: 'req-1', title: 'Pendiente estructural' };
  const canonical = canonicalizeActionableReviewJson(value);
  const expected = createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex');
  assert.equal(hashActionableReviewJson(value), expected);
  assert.match(hashActionableReviewJson(value), /^[0-9a-f]{64}$/);
})();

// --- Same logical value canonicalizes identically regardless of key order ---
await (async function sameLogicalValueIsStable() {
  const first = { a: 1, b: { c: 2, d: 3 } };
  const second = { b: { d: 3, c: 2 }, a: 1 };
  assert.equal(canonicalizeActionableReviewJson(first), canonicalizeActionableReviewJson(second));
  assert.equal(hashActionableReviewJson(first), hashActionableReviewJson(second));
})();

// --- The persisted hash contract constant, referenced by every table/RPC in
// the design (§9, §11), must be a single exported source of truth. ----------
await (async function exposesHashContractConstant() {
  const module = await import('../agt002-actionable-review-canonical.js');
  assert.equal(module.HASH_CONTRACT, HASH_CONTRACT);
})();

// --- §6.4 constructor cerrado de `integral_unit` (GREEN 5C1) ----------------
// La proyección persistida es exactamente las 19 claves de unidad del contrato
// V3 más `source_kind`, tomadas del valor validado tal como vive en el
// resultado canónico, sin campos derivados de UI.
function v3Unit(overrides = {}) {
  return {
    unit_id: 'unit-dyn-01',
    unit_kind: 'tender_requirement',
    requirement_id: 'req-dyn-experiencia',
    category: 'habilitating',
    sequence: 1,
    title: 'Experiencia acreditada en contratos similares',
    assessment_mode: 'assessed',
    conclusion: { status: 'supported_with_evidence', summary: 'La experiencia aportada cubre el objeto exigido.', confidence: 'high' },
    blocking: { effect: 'non_blocking', curability: 'not_applicable', reason: 'No bloquea la presentación de la oferta.' },
    evidence_state: { presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable', compliance: 'supported_pending_human_review' },
    evidence_refs: [{ ref: 'evidence:chunk:doc-pliego:0142', source_type: 'tender_document', purpose: 'requirement_basis' }],
    missing_evidence: [],
    commercial_impact: { level: 'high', summary: 'Habilita la participación en el proceso.', dimension: 'elegibilidad' },
    legal_assessment: { status: 'supported', basis_refs: ['corpus:ley-80:art-6'], summary: 'Sustento admisible.', human_legal_review_required: false },
    actions: [{ action_id: 'act-dyn-01', action_type: 'verify_validity', summary: 'Confirmar vigencia al cierre.', basis_unit_id: 'unit-dyn-01', suggested_role: 'tender_lead', priority: 'medium', external_side_effect: false }],
    milestone: { status: 'verified', type: 'submission_deadline', at: '2026-09-15', source_ref: 'evidence:chunk:doc-pliego:0009', summary: 'Cierre del proceso.' },
    escalation: { required: false, level: 'none', reason: 'Sin condición crítica.' },
    closure: { status: 'human_confirmation_required', condition: 'Persona autorizada valida la vigencia.', evidence_required: [] },
    human_validation: { required: true, status: 'pending', reason: 'Validación humana pendiente.' },
    ...overrides,
  };
}

await (async function integralUnitProjectionIsExactlyTheClosedKeySet() {
  const { projection, sourceKind, sourceId, requirementId, sourceHash } = buildActionableReviewIntegralUnitSource(v3Unit());
  assert.deepEqual(
    Object.keys(projection).sort(),
    ['source_kind', ...ACTIONABLE_REVIEW_INTEGRAL_UNIT_PROJECTION_KEYS].sort(),
    'the projection contains exactly source_kind plus the 19 closed V3 unit keys',
  );
  assert.equal(sourceKind, 'integral_unit');
  assert.equal(sourceId, 'unit-dyn-01');
  assert.equal(requirementId, 'req-dyn-experiencia');
  assert.equal(sourceHash, hashActionableReviewJson(projection), 'the source hash is the canonical hash of that exact projection');
  assert.match(sourceHash, /^[0-9a-f]{64}$/);
})();

await (async function integralUnitHashIsStableAcrossKeyOrderAndSensitiveToContent() {
  const unit = v3Unit();
  const shuffled = Object.fromEntries(Object.entries(unit).reverse());
  assert.equal(
    buildActionableReviewIntegralUnitSource(shuffled).sourceHash,
    buildActionableReviewIntegralUnitSource(unit).sourceHash,
    'key order in the run payload must never change the identity hash',
  );
  assert.notEqual(
    buildActionableReviewIntegralUnitSource(v3Unit({ title: 'Otro título' })).sourceHash,
    buildActionableReviewIntegralUnitSource(unit).sourceHash,
    'a changed unit field must change the identity hash',
  );
})();

await (async function integralUnitProjectionNeverCarriesUiOrClientDerivedFields() {
  const { projection } = buildActionableReviewIntegralUnitSource(v3Unit());
  for (const forbidden of ['position', 'index', 'badge_label', 'created_at', 'executed_at', 'source_hash', 'tender_id', 'opportunity_id', 'analysis_run_id']) {
    assert.equal(Object.hasOwn(projection, forbidden), false, `projection must never carry ${forbidden}`);
  }
})();

await (async function integralUnitConstructorFailsClosedOnMalformedOrIdentityLessUnits() {
  const withoutClosure = v3Unit();
  delete withoutClosure.closure;
  const rejected = [
    ['a non-object unit', 'unit-dyn-01'],
    ['a null unit', null],
    ['an array unit', []],
    ['a unit missing a closed key', withoutClosure],
    ['a unit with an extra UI-derived key', v3Unit({ badge_label: 'Riesgo confirmado' })],
    ['a unit with no structural id', v3Unit({ unit_id: '' })],
    ['a unit with a non-string id', v3Unit({ unit_id: 7 })],
    ['a unit with a blank requirement_id', v3Unit({ requirement_id: '  ' })],
    ['a unit carrying a non-JSON value', v3Unit({ milestone: { status: 'verified', type: 'submission_deadline', at: new Date('2026-09-15T00:00:00.000Z'), source_ref: null, summary: 'x' } })],
  ];
  for (const [label, unit] of rejected) {
    assert.throws(() => buildActionableReviewIntegralUnitSource(unit), `must fail closed for ${label}`);
  }
})();

await (async function integralUnitAcceptsNullRequirementIdForStrategicConsiderations() {
  const { requirementId } = buildActionableReviewIntegralUnitSource(v3Unit({ unit_kind: 'strategic_consideration', requirement_id: null }));
  assert.equal(requirementId, null, 'a strategic consideration keeps a null requirement_id instead of a fabricated text identity');
})();

console.log('AGT-002 actionable review canonicalization module contract passed');
