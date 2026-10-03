// AGT-002 governed document workset — pure model contract
// (.hermes/plans/2026-09-17-agt002-governed-document-worksets.md, Phase 4). Pure functions only:
// no DB, no network, no React. Bundled with esbuild the same way tests/agt002-reanalysis-ui.test.mjs
// bundles src/tenders/agt002ReanalysisPolling.ts, so this exercises the real TS module.
import { strict as assert } from 'node:assert';
import { buildSync } from 'esbuild';

const modulePath = new URL('../src/tenders/governedWorksetSelection.ts', import.meta.url).pathname;
const bundled = buildSync({ entryPoints: [modulePath], bundle: true, platform: 'node', format: 'esm', write: false });
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`;
const {
  AGT002_GOVERNED_WORKSET_SOURCE_CLASSIFICATIONS,
  AGT002_GOVERNED_WORKSET_MIN_MEMBERS,
  AGT002_GOVERNED_WORKSET_MAX_MEMBERS,
  AGT002_GOVERNED_WORKSET_FREEZE_CONFIRMATION_COPY,
  isAgt002GovernedWorksetSourceClassification,
  tenderDocumentExtractionEligibility,
  currentAgt002GovernedWorksetDocuments,
  agt002GovernedWorksetSelectionErrors,
  buildAgt002GovernedWorksetMembers,
  agt002GovernedWorksetSelectionCountLabel,
} = await import(moduleUrl);

// --- Closed classification vocabulary. ----------------------------------------------------------
assert.deepEqual(AGT002_GOVERNED_WORKSET_SOURCE_CLASSIFICATIONS, ['official', 'corporate', 'draft']);
assert.equal(AGT002_GOVERNED_WORKSET_MIN_MEMBERS, 1);
assert.equal(AGT002_GOVERNED_WORKSET_MAX_MEMBERS, 12);
assert.equal(isAgt002GovernedWorksetSourceClassification('official'), true);
assert.equal(isAgt002GovernedWorksetSourceClassification('corporate'), true);
assert.equal(isAgt002GovernedWorksetSourceClassification('draft'), true);
for (const invented of ['internal', 'third_party', 'recommended', 'user_added', '', null, undefined, 42]) {
  assert.equal(isAgt002GovernedWorksetSourceClassification(invented), false, `${invented} must not be accepted`);
}

// --- Confirmation copy states the freeze + new-run consequence explicitly. ----------------------
assert.match(AGT002_GOVERNED_WORKSET_FREEZE_CONFIRMATION_COPY, /congelad/i);
assert.match(AGT002_GOVERNED_WORKSET_FREEZE_CONFIRMATION_COPY, /nueva corrida/i);

// --- Extraction eligibility must mirror the backend's exact contract (agt002-governed-document-
// worksets.js lines 115-120: `evidence.extraction_status !== 'ok'` rejects the whole package). Only
// 'ok' is eligible; 'gap', 'legacy', absent and any other status are all ineligible. -------------
assert.deepEqual(tenderDocumentExtractionEligibility({ extraction_status: 'ok', extraction_gap_reason: null }), { eligible: true, reason: null });
assert.equal(tenderDocumentExtractionEligibility({ extraction_status: 'legacy', extraction_gap_reason: null }).eligible, false, 'legacy must not be selectable: the backend only accepts extraction_status === \'ok\'');
assert.equal(tenderDocumentExtractionEligibility({}).eligible, false, 'a document with no extraction_status must fail closed');
assert.deepEqual(
  tenderDocumentExtractionEligibility({ extraction_status: 'gap', extraction_gap_reason: 'Archivo dañado.' }),
  { eligible: false, reason: 'Archivo dañado.' },
);
assert.equal(tenderDocumentExtractionEligibility({ extraction_status: 'gap', extraction_gap_reason: null }).eligible, false);
assert.match(tenderDocumentExtractionEligibility({ extraction_status: 'gap', extraction_gap_reason: null }).reason, /texto extraído/i);
assert.match(tenderDocumentExtractionEligibility({ extraction_status: 'legacy', extraction_gap_reason: null }).reason, /["']ok["']/, 'the ineligibility reason for a non-ok status must explain the exact backend requirement');

// --- Only current documents are ever candidates. -------------------------------------------------
const DOCS = [
  { id: 'doc-current', current: true },
  { id: 'doc-historical', current: false },
  { id: 'doc-default', current: true },
];
assert.deepEqual(currentAgt002GovernedWorksetDocuments(DOCS).map(d => d.id), ['doc-current', 'doc-default']);

// --- Selection bounds: 1..12, closed classification, nonblank reason, explicit confirmation. -----
function entry(overrides = {}) {
  return { document_version_id: '11111111-1111-4111-8111-111111111111', source_classification: 'official', inclusion_reason: 'Pliego vigente.', ...overrides };
}
assert.deepEqual(agt002GovernedWorksetSelectionErrors([], true), ['Seleccione al menos 1 documento para el paquete gobernado.']);
assert.equal(agt002GovernedWorksetSelectionErrors([entry()], true).length, 0, 'one valid, confirmed entry must be valid');
assert.equal(agt002GovernedWorksetSelectionErrors([entry()], false).length, 1, 'unconfirmed must block even with a valid entry');
assert.match(agt002GovernedWorksetSelectionErrors([entry()], false)[0], /confirmar/i);

const thirteen = Array.from({ length: 13 }, (_, i) => entry({ document_version_id: `doc-${i}` }));
assert.ok(agt002GovernedWorksetSelectionErrors(thirteen, true).some(msg => /máximo 12/.test(msg)));
const twelve = Array.from({ length: 12 }, (_, i) => entry({ document_version_id: `doc-${i}` }));
assert.equal(agt002GovernedWorksetSelectionErrors(twelve, true).length, 0, 'exactly 12 must be valid');

assert.ok(agt002GovernedWorksetSelectionErrors([entry({ source_classification: '' })], true).some(msg => /clasificación/i.test(msg)));
assert.ok(agt002GovernedWorksetSelectionErrors([entry({ source_classification: 'internal' })], true).some(msg => /clasificación/i.test(msg)), 'a classification outside the closed UI set must fail even if the backend would otherwise accept it');
assert.ok(agt002GovernedWorksetSelectionErrors([entry({ inclusion_reason: '' })], true).some(msg => /motivo/i.test(msg)));
assert.ok(agt002GovernedWorksetSelectionErrors([entry({ inclusion_reason: '   ' })], true).some(msg => /motivo/i.test(msg)), 'whitespace-only reason must not count as filled');

// --- buildAgt002GovernedWorksetMembers: exact closed shape, trimmed reason, throws on invalid. ---
const built = buildAgt002GovernedWorksetMembers([entry({ inclusion_reason: '  Pliego vigente.  ' })]);
assert.deepEqual(built, [{ document_version_id: '11111111-1111-4111-8111-111111111111', source_classification: 'official', inclusion_reason: 'Pliego vigente.' }]);
assert.deepEqual(Object.keys(built[0]).sort(), ['document_version_id', 'inclusion_reason', 'source_classification']);
assert.throws(() => buildAgt002GovernedWorksetMembers([entry({ source_classification: '' })]), /clasificación/i);
assert.throws(() => buildAgt002GovernedWorksetMembers([entry({ inclusion_reason: '  ' })]), /motivo/i);

// --- Count label explains the 1..12 bound in plain language. -------------------------------------
assert.equal(agt002GovernedWorksetSelectionCountLabel(0), '0 de 12 documentos seleccionados (mínimo 1).');
assert.equal(agt002GovernedWorksetSelectionCountLabel(3), '3 de 12 documentos seleccionados (mínimo 1).');

console.log('AGT-002 governed document workset pure model contract passed');
