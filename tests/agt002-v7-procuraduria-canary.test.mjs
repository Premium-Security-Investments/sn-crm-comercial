import assert from 'node:assert/strict';
import {
  readCanaryFixture,
  buildCanaryDocuments,
  buildCanaryInventory,
  runZeroRequirementsNegativeCheck,
  runAgt002V7ProcuraduriaCanary,
} from '../scripts/agt002-v7-procuraduria-canary.mjs';
import {
  TENDER_SEMANTIC_DISCOVERY_NO_REQUIREMENTS_CODE,
  TENDER_SEMANTIC_DISCOVERY_MAX_SOURCE_CHARS,
} from '../tender-semantic-discovery.js';
import { AGT002_OUTPUT_REJECTION_STAGES } from '../agt002-analysis-observability.js';

// AGT-002 V7 multi-batch canary — fully local, sanitized, MECHANICAL integration test.
//
// Exercises the real, unmodified production V7 discovery pipeline
// (buildTenderRequirementInventory + discoverTenderSemanticManifest) against a deterministic,
// entirely synthetic expediente shaped like the sanitized Procuraduria canary metadata: 13
// documents, 2335 source units, public process ref CO1.REQ.10873217 only (no internal opportunity
// UUID, no real document content). The provider is a local in-process fake client — no network call,
// no credential, no persistence, no reanalysis of any real expediente.
//
// This test proves multi-batch PLUMBING is deterministic end to end over a production-scale corpus.
// It makes no claim about analysis quality and produces no GO/NO-GO signal.

// ---------------------------------------------------------------------------------------------
// 1. Fixture contract: exactly 13 synthetic documents, unit counts summing to exactly 2335, only
// the sanitized metadata this canary is allowed to carry.
// ---------------------------------------------------------------------------------------------
const fixture = readCanaryFixture();
assert.equal(fixture.documents.length, 13, 'el fixture debe declarar exactamente 13 documentos sintéticos');
assert.equal(
  fixture.documents.reduce((sum, doc) => sum + doc.unit_count, 0),
  2335,
  'los unit_count del fixture deben sumar exactamente 2335',
);
assert.equal(fixture.expected_document_count, 13);
assert.equal(fixture.expected_source_unit_count, 2335);
assert.equal(fixture.semantic_source_budget_chars, TENDER_SEMANTIC_DISCOVERY_MAX_SOURCE_CHARS);
assert.equal(fixture.public_process_ref, 'CO1.REQ.10873217');
assert.equal(fixture.target_label, 'Procuraduria canary');
// No internal opportunity UUID: the synthetic snapshot id is an obviously-fake, all-zero UUID.
assert.match(fixture.snapshot_id, /^[0-9a-f]{8}-0000-4000-8000-0{11}[0-9a-f]$/i);
for (const doc of fixture.documents) {
  for (const forbiddenKey of ['content', 'extracted_text', 'url', 'path', 'filename']) {
    assert.ok(!(forbiddenKey in doc), `el fixture no debe declarar la clave ${forbiddenKey} en un documento`);
  }
}

// ---------------------------------------------------------------------------------------------
// 2. Deterministic expansion: unique generic Spanish synthetic paragraphs, one per declared unit,
// and the REAL production inventory builder segments exactly 2335 analyzable source units from
// them, with aggregate text exceeding the real per-batch budget (forcing multiple batches).
// ---------------------------------------------------------------------------------------------
const documents = buildCanaryDocuments(fixture);
assert.equal(documents.length, 13);
documents.forEach((doc, index) => {
  const paragraphCount = doc.extracted_text.split('\n\n').length;
  assert.equal(
    paragraphCount, fixture.documents[index].unit_count,
    `documento ${doc.document_id} debe expandir exactamente su unit_count declarado`,
  );
});
const allParagraphs = documents.flatMap(doc => doc.extracted_text.split('\n\n'));
assert.equal(allParagraphs.length, 2335);
assert.equal(new Set(allParagraphs).size, 2335, 'cada párrafo sintético generado debe ser único en todo el corpus');

const inventory = buildCanaryInventory(fixture, documents);
assert.equal(inventory.source_units.length, 2335);
assert.equal(inventory.source_units.filter(unit => unit.disposition === 'analyzable').length, 2335);

const totalChars = documents.reduce((sum, doc) => sum + doc.extracted_text.length, 0);
assert.ok(
  totalChars > TENDER_SEMANTIC_DISCOVERY_MAX_SOURCE_CHARS,
  `el texto sintético agregado debe superar el presupuesto de ${TENDER_SEMANTIC_DISCOVERY_MAX_SOURCE_CHARS} caracteres por lote`,
);

// ---------------------------------------------------------------------------------------------
// 3. Full canary: real V7 planner/discovery + in-process fake client, executed twice.
// runAgt002V7ProcuraduriaCanary already throws on any acceptance failure; the assertions below
// independently re-check the same contract so a regression in the runner's own checks cannot hide
// a real acceptance failure from this test.
// ---------------------------------------------------------------------------------------------
const canary = await runAgt002V7ProcuraduriaCanary();
const { report, first, second, firstInventory, secondInventory, negative } = canary;

assert.equal(report.documents_expected, 13);
assert.equal(report.documents_represented, 13);
assert.ok(report.documents_match_fixture, '13/13 documentos deben estar representados en las solicitudes vistas por el proveedor');
assert.equal(report.source_units_expected, 2335);
assert.equal(report.source_units_sent, 2335);
assert.equal(report.source_units_duplicate_sent, 0);
assert.ok(report.source_units_match_inventory, '2335/2335 source_units deben asignarse y enviarse exactamente una vez');

assert.ok(report.discovery_ledger.batch_count > 1, 'debe producirse más de un lote (batch_count > 1)');
assert.equal(report.discovery_ledger.completed_batches, report.discovery_ledger.batch_count, 'todo lote del ledger debe quedar completed');
assert.equal(report.discovery_ledger.failed_source_units_count, 0, 'failed_source_units debe quedar vacío');
assert.ok(report.discovery_ledger.batches.every(batch => batch.status === 'completed'));
assert.equal(report.discovery_ledger.batches.filter(batch => batch.status === 'failed').length, 0, 'cero lotes fallidos');

assert.equal(report.invalid_citation_count, 0, 'toda cita generada debe referenciar un source_unit_id permitido con unit_hash coincidente');

assert.equal(report.decision_ready, false, 'el manifiesto fusionado debe permanecer decision_ready=false');
assert.notEqual(report.discovery_coverage_status, 'complete', 'la cobertura de descubrimiento no debe declararse completa');
assert.ok(
  report.unresolved_count > report.requirements_count,
  'la respuesta simulada debe dejar deliberadamente más unidades sin resolver que requisitos propuestos',
);
assert.ok(
  report.unresolved_count / report.source_units_expected > 0.9,
  'la mayoría (>90%) de las unidades debe permanecer visiblemente sin resolver: sin certeza falsa sobre evidencia dispersa',
);

assert.equal(report.usage.cost_usd, 0, 'el costo simulado determinista debe ser exactamente 0');
assert.ok(Number.isInteger(report.usage.input_tokens) && report.usage.input_tokens > 0);
assert.ok(Number.isInteger(report.usage.output_tokens) && report.usage.output_tokens > 0);

// ---------------------------------------------------------------------------------------------
// 4. Repeat-run determinism: identical request inputs, per-batch idempotency keys, ledger batch
// hashes and final safe hashes across two independent local executions of the same canary (each
// rebuilding its own synthetic documents and inventory from the fixture, not merely re-reading the
// same in-memory objects).
// ---------------------------------------------------------------------------------------------
assert.ok(report.repeat_run_identical);
assert.deepEqual(
  first.client.requests.map(request => ({ idempotencyKey: request.idempotencyKey, input: request.input })),
  second.client.requests.map(request => ({ idempotencyKey: request.idempotencyKey, input: request.input })),
  'las solicitudes (input + idempotencyKey) deben ser idénticas entre las dos corridas',
);
assert.deepEqual(
  first.result.discoveryLedger.batches.map(batch => batch.batch_hash),
  second.result.discoveryLedger.batches.map(batch => batch.batch_hash),
  'los batch_hash del ledger deben ser idénticos entre las dos corridas',
);
assert.equal(
  first.result.semanticManifest.semantic_manifest_hash,
  second.result.semanticManifest.semantic_manifest_hash,
  'el semantic_manifest_hash final debe ser idéntico entre las dos corridas',
);
assert.equal(firstInventory.inventory_hash, secondInventory.inventory_hash);
assert.equal(firstInventory.snapshot_hash, secondInventory.snapshot_hash);

// ---------------------------------------------------------------------------------------------
// 5. Citation allowlist re-checked independently (not merely trusting report.invalid_citation_count):
// every requirement citation and front_evidence must resolve to an analyzable source_unit_id of this
// same inventory with a matching unit_hash.
// ---------------------------------------------------------------------------------------------
{
  const unitsById = new Map(firstInventory.source_units.map(unit => [unit.source_unit_id, unit]));
  let invalid = 0;
  for (const requirement of first.result.semanticManifest.requirements) {
    for (const citation of [requirement.front_evidence, ...requirement.citations]) {
      const unit = unitsById.get(citation.source_unit_id);
      if (!unit || unit.disposition !== 'analyzable' || unit.unit_hash !== citation.unit_hash) invalid += 1;
    }
  }
  assert.equal(invalid, 0);
}

// ---------------------------------------------------------------------------------------------
// 6. The sanitized report never carries expanded paragraphs, model prose, requirement labels,
// document content, paths or URLs — only counts, versions, hashes, batch metrics, usage and
// booleans.
// ---------------------------------------------------------------------------------------------
{
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes('Cláusula sintética'), 'el reporte no debe contener texto de párrafos sintéticos expandidos');
  assert.ok(!serialized.includes('identificador sintético'), 'el reporte no debe contener texto de párrafos sintéticos expandidos');
  for (const bankWord of ['obligación', 'proponente', 'contratante', 'jurídico']) {
    assert.ok(!serialized.includes(bankWord), `el reporte no debe contener palabras del banco léxico sintético ("${bankWord}")`);
  }
  const reportKeys = new Set(Object.keys(report));
  for (const forbiddenKey of ['label', 'labels', 'source_text', 'extracted_text', 'paragraphs', 'documents', 'source_unit_ids']) {
    assert.ok(!reportKeys.has(forbiddenKey), `el reporte no debe exponer la clave ${forbiddenKey}`);
  }
  for (const batchEntry of report.discovery_ledger.batches) {
    assert.equal(new Set(Object.keys(batchEntry)).has('source_unit_ids'), false, 'las entradas de lote del reporte no deben exponer listas de source_unit_ids');
  }
}

// ---------------------------------------------------------------------------------------------
// 7. Negative, fail-closed assertion: a fully zero/empty semantic result — every batch proposes no
// requirement at all — is REJECTED by the real, unmodified production discovery boundary
// (v5_discovery_no_requirements), never silently accepted as decision-ready. This is a safe
// fail-closed check, not a weakened one: the negative fixture is independent of the main 2335-unit
// corpus and re-run separately to confirm it is not a one-off fluke of shared state.
// ---------------------------------------------------------------------------------------------
assert.equal(report.negative_zero_requirements_check.rejected, true);
assert.equal(report.negative_zero_requirements_check.code, TENDER_SEMANTIC_DISCOVERY_NO_REQUIREMENTS_CODE);
assert.equal(report.negative_zero_requirements_check.stage, AGT002_OUTPUT_REJECTION_STAGES.SEMANTIC_VALIDATION);
assert.equal(negative.rejected, true);
assert.equal(negative.code, TENDER_SEMANTIC_DISCOVERY_NO_REQUIREMENTS_CODE);

const negativeAgain = await runZeroRequirementsNegativeCheck();
assert.equal(negativeAgain.rejected, true, 'la comprobación negativa debe seguir rechazando de forma cerrada en una segunda ejecución independiente');
assert.equal(negativeAgain.code, TENDER_SEMANTIC_DISCOVERY_NO_REQUIREMENTS_CODE);

// ---------------------------------------------------------------------------------------------
// 8. Importing the runner module must never execute its CLI (no network call, no stdout report, no
// process.exitCode side effect) — every assertion above already ran purely from named exports.
// ---------------------------------------------------------------------------------------------
assert.equal(process.exitCode, undefined, 'importar el runner no debe ejecutar su CLI ni fijar un código de salida');

console.log('tests/agt002-v7-procuraduria-canary.test.mjs OK', {
  batch_count: report.discovery_ledger.batch_count,
  documents_represented: report.documents_represented,
  source_units_sent: report.source_units_sent,
  requirements_count: report.requirements_count,
  unresolved_count: report.unresolved_count,
  repeat_run_identical: report.repeat_run_identical,
  negative_check_rejected: report.negative_zero_requirements_check.rejected,
});
