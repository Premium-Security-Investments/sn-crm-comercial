// AGT-002 V7 multi-batch canary — fully local, sanitized, mechanical.
//
// Runs the real, unmodified production V7 discovery pipeline
// (buildTenderRequirementInventory + discoverTenderSemanticManifest, tender-requirement-inventory.js
// / tender-semantic-discovery.js) against a deterministic, entirely SYNTHETIC expediente shaped like
// the sanitized Procuraduria canary metadata (13 documents, 2335 source units, public process ref
// CO1.REQ.10873217 only — no internal opportunity UUID, no real document names/paths/URLs/content).
// The provider is a local in-process fake client: no network call, no credential, no persistence.
//
// This is a MECHANICAL canary only. It proves the multi-batch plumbing (batching, idempotency keys,
// ledger hashes, coverage completion, fail-closed zero-requirement boundary) behaves deterministically
// end to end over a production-scale corpus. It says nothing about analysis QUALITY, and it never
// produces a GO/NO-GO or any readiness claim for a real reanalysis.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildTenderRequirementInventory } from '../tender-requirement-inventory.js';
import {
  discoverTenderSemanticManifest,
  TENDER_SEMANTIC_DISCOVERY_MAX_SOURCE_CHARS,
  TENDER_SEMANTIC_DISCOVERY_NO_REQUIREMENTS_CODE,
} from '../tender-semantic-discovery.js';

const DEFAULT_FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'agt002', 'canary', 'agt002-v7-procuraduria-multibatch.json',
);

const CANARY_MODEL = 'agt002-v7-procuraduria-canary-local-fake-model';
const CANARY_IDEMPOTENCY_KEY = 'agt002-v7-procuraduria-canary';
const CANARY_NEGATIVE_IDEMPOTENCY_KEY = 'agt002-v7-procuraduria-canary-negative';
const CANARY_TIMEOUT_MS = 30_000;
const CANARY_NEGATIVE_SNAPSHOT_ID = '00000000-0000-4000-8000-000000000002';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** Loads and mechanically validates the sanitized fixture: exactly 13 documents, unit_count summing
 * to exactly the declared total. No document content lives in the fixture — only specs. */
export function readCanaryFixture(fixturePath = DEFAULT_FIXTURE_PATH) {
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  if (!Array.isArray(fixture.documents) || fixture.documents.length !== fixture.expected_document_count) {
    throw new Error('El fixture del canario AGT-002 V7 no declara el número esperado de documentos.');
  }
  const totalUnits = fixture.documents.reduce((sum, doc) => sum + doc.unit_count, 0);
  if (totalUnits !== fixture.expected_source_unit_count) {
    throw new Error('El fixture del canario AGT-002 V7 no suma el total esperado de unidades fuente.');
  }
  return fixture;
}

// Generic, closed bank of Spanish procurement-domain WORDS (never a real clause, never copied from
// any expediente) used only to give each synthetic paragraph's body enough per-slot entropy that no
// word-window candidate tender-semantic-label-catalog.js derives from one paragraph can ever
// literally collide with another paragraph's — see the determinism note on `pseudoCanaryWord` below.
const CANARY_WORD_BANK = Object.freeze([
  'obligación', 'proponente', 'entidad', 'contratante', 'documento', 'plazo', 'entrega', 'condición',
  'criterio', 'evaluación', 'requisito', 'garantía', 'técnico', 'financiero', 'jurídico', 'cumplimiento',
  'proceso', 'contratación', 'pública', 'vigencia', 'alcance', 'servicio', 'propuesta', 'oferta', 'anexo',
  'cronograma', 'actividad', 'indicador', 'meta', 'resultado', 'calidad', 'seguridad', 'personal', 'equipo',
  'recurso', 'presupuesto', 'informe', 'reporte', 'supervisión', 'control', 'verificación', 'acreditación',
  'experiencia', 'certificación', 'licencia', 'permiso', 'autorización', 'responsable', 'ejecución', 'etapa',
  'fase', 'entregable', 'riesgo', 'mitigación', 'protocolo', 'procedimiento', 'normativa', 'reglamento',
  'disposición', 'cláusula', 'expediente', 'sintético', 'canario', 'local', 'prueba', 'genérico', 'muestra',
  'consecutivo', 'numeral', 'sección', 'capítulo', 'formato', 'plantilla', 'modelo', 'referencia',
  'parámetro', 'insumo', 'producto', 'componente', 'módulo', 'sistema', 'plataforma', 'infraestructura',
  'logística', 'operación', 'gestión', 'administración', 'coordinación', 'planificación', 'organización',
]);
const CANARY_WORDS_PER_PARAGRAPH = 14;

/** Deterministic pseudo-random bank word for one (paragraph, slot) pair: a pure sha256-derived
 * index, never Math.random/Date.now, so the same globalIndex+slot always yields the same word on
 * every run. Independently reseeded per slot so two DIFFERENT synthetic paragraphs never share an
 * identical run of consecutive words by construction. */
function pseudoCanaryWord(globalIndex, slot) {
  const digest = createHash('sha256').update(`agt002-v7-canary:${globalIndex}:${slot}`).digest();
  return CANARY_WORD_BANK[digest.readUInt32BE(0) % CANARY_WORD_BANK.length];
}

/**
 * Deterministic, unique, generic Spanish synthetic paragraph for one source unit. Never derived
 * from or resembling any real expediente content — only the fixture's own positional indices and
 * the closed word bank above.
 *
 * The globalIndex appears both in the fixed header (`Cláusula sintética N ...`) and again at the
 * very end, and the body between them is 14 independently-seeded bank words: no fixed run of
 * consecutive words is ever shared with another paragraph, so no literal-excerpt candidate
 * `tender-semantic-label-catalog.js` derives from this text (whole-unit, clause, or 8/16-word
 * window) can ever be identical to a candidate derived from a DIFFERENT source unit — which is what
 * keeps a discovered citation scoped to the one unit that actually owns it, instead of an incidental
 * shared phrase silently pulling in units this canary means to leave visibly unresolved.
 */
export function syntheticCanaryParagraph({ globalIndex, documentIndex, unitIndex }) {
  const words = [];
  for (let slot = 0; slot < CANARY_WORDS_PER_PARAGRAPH; slot += 1) {
    words.push(pseudoCanaryWord(globalIndex, slot));
  }
  return `Cláusula sintética ${globalIndex} del documento ${documentIndex}, unidad ${unitIndex}: `
    + `${words.join(' ')}, identificador sintético ${globalIndex}.`;
}

/** Expands the fixture's specs into deterministic synthetic documents: one unique paragraph per
 * declared unit, joined so buildTenderRequirementInventory segments exactly unit_count source units
 * per document. content_hash is a real sha256 of the generated text (never a placeholder). */
export function buildCanaryDocuments(fixture) {
  let globalIndex = 0;
  return fixture.documents.map((spec, position) => {
    const documentIndex = position + 1;
    const paragraphs = [];
    for (let unitIndex = 1; unitIndex <= spec.unit_count; unitIndex += 1) {
      globalIndex += 1;
      paragraphs.push(syntheticCanaryParagraph({ globalIndex, documentIndex, unitIndex }));
    }
    const extractedText = paragraphs.join('\n\n');
    return {
      document_id: spec.document_id,
      document_version_id: spec.document_version_id,
      content_hash: sha256(extractedText),
      extracted_text: extractedText,
    };
  });
}

/** Builds and mechanically re-checks the real inventory: exactly the fixture's declared total of
 * ANALYZABLE source units, with no document gap and no unverifiable content_hash. */
export function buildCanaryInventory(fixture, documents) {
  const inventory = buildTenderRequirementInventory({ snapshotId: fixture.snapshot_id, documents, documentGaps: [] });
  const analyzable = inventory.source_units.filter(unit => unit.disposition === 'analyzable');
  if (inventory.source_units.length !== fixture.expected_source_unit_count
    || analyzable.length !== fixture.expected_source_unit_count) {
    throw new Error('El inventario generado del canario no produjo el total esperado de source_units analizables.');
  }
  const totalChars = documents.reduce((sum, document) => sum + document.extracted_text.length, 0);
  if (totalChars <= fixture.semantic_source_budget_chars) {
    throw new Error('El expediente sintético del canario no supera el presupuesto de caracteres por lote: no forzaría múltiples lotes.');
  }
  return inventory;
}

/** In-process fake provider client. Makes no network call. For every batch it receives, returns a
 * locally schema-valid proposal anchored to THAT batch's own literal label enum (one requirement,
 * the enum's first member), and deliberately leaves every other visible unit of the batch unlisted
 * so the real v4 coverage completion in tender-semantic-discovery.js disposes it as `unresolved`.
 * Usage is fixed and deterministic; cost is always reported as exactly 0. */
export function makeCanarySemanticClient() {
  const requests = [];
  return {
    requests,
    run: async request => {
      requests.push(request);
      const enumLabels = request.outputSchema.properties.requirements.items.properties.label.enum;
      const proposal = enumLabels.length
        ? { requirements: [{ kind: 'obligation', label: enumLabels[0], front: 'technical', category: 'technical' }], excluded: [], unresolved: [] }
        : { requirements: [], excluded: [], unresolved: [] };
      return {
        content: JSON.stringify(proposal),
        usage: { input_tokens: request.input.source_units.length, output_tokens: 1, cost_usd: 0 },
      };
    },
  };
}

/** Same shape of fake client, but NEVER proposes a requirement for any batch, no matter its catalog.
 * Used only by the negative check below. */
function makeZeroRequirementsClient() {
  const requests = [];
  return {
    requests,
    run: async request => {
      requests.push(request);
      return {
        content: JSON.stringify({ requirements: [], excluded: [], unresolved: [] }),
        usage: { input_tokens: request.input.source_units.length, output_tokens: 1, cost_usd: 0 },
      };
    },
  };
}

export async function runCanaryDiscoveryOnce({ documents, inventory, idempotencyKey = CANARY_IDEMPOTENCY_KEY } = {}) {
  const client = makeCanarySemanticClient();
  const result = await discoverTenderSemanticManifest({
    client,
    model: CANARY_MODEL,
    timeoutMs: CANARY_TIMEOUT_MS,
    idempotencyKey,
    inventory,
    documents,
    maxSourceChars: TENDER_SEMANTIC_DISCOVERY_MAX_SOURCE_CHARS,
  });
  return { client, result };
}

/**
 * Negative, fail-closed check (not the main canary corpus): a tiny independent synthetic expediente
 * whose fake client NEVER proposes a requirement for any batch. Proves that a zero/empty semantic
 * result is REJECTED by the existing discovery boundary rather than silently becoming decision-ready
 * — this canary records that rejection as a safe fail-closed negative result; it never weakens or
 * bypasses the check to make the run "succeed".
 */
export async function runZeroRequirementsNegativeCheck() {
  const paragraphs = [
    'Cláusula sintética de control: el interventor deberá verificar el cumplimiento de la condición genérica de este ejercicio de canario local.',
    'Cláusula sintética de control: el contratista deberá reportar el estado genérico de avance de este ejercicio de canario local.',
  ];
  const extractedText = paragraphs.join('\n\n');
  const documents = [{
    document_id: 'agt002-canary-negative-doc-01',
    document_version_id: 'agt002-canary-negative-doc-01-v1',
    content_hash: sha256(extractedText),
    extracted_text: extractedText,
  }];
  const inventory = buildTenderRequirementInventory({ snapshotId: CANARY_NEGATIVE_SNAPSHOT_ID, documents, documentGaps: [] });
  const client = makeZeroRequirementsClient();
  try {
    await discoverTenderSemanticManifest({
      client,
      model: CANARY_MODEL,
      timeoutMs: CANARY_TIMEOUT_MS,
      idempotencyKey: CANARY_NEGATIVE_IDEMPOTENCY_KEY,
      inventory,
      documents,
      maxSourceChars: TENDER_SEMANTIC_DISCOVERY_MAX_SOURCE_CHARS,
    });
    return { rejected: false, code: null, stage: null };
  } catch (error) {
    return { rejected: true, code: error.code ?? null, stage: error.stage ?? null };
  }
}

function providerCoverage({ fixture, inventory, requests }) {
  const sentDocumentIds = new Set();
  const sentUnitIds = [];
  for (const request of requests) {
    for (const unit of request.input.source_units) {
      sentDocumentIds.add(unit.document_id);
      sentUnitIds.push(unit.source_unit_id);
    }
  }
  const analyzableUnitIds = inventory.source_units
    .filter(unit => unit.disposition === 'analyzable')
    .map(unit => unit.source_unit_id)
    .sort();
  const sentUnitIdsSorted = [...sentUnitIds].sort();
  const expectedDocumentIds = fixture.documents.map(document => document.document_id).sort();
  return {
    documentsRepresented: sentDocumentIds.size,
    documentIdsMatchFixture: JSON.stringify([...sentDocumentIds].sort()) === JSON.stringify(expectedDocumentIds),
    sourceUnitsSent: sentUnitIds.length,
    sourceUnitsDuplicateSent: sentUnitIds.length - new Set(sentUnitIds).size,
    sourceUnitsMatchInventory: JSON.stringify(sentUnitIdsSorted) === JSON.stringify(analyzableUnitIds),
  };
}

function invalidCitationCount(semanticManifest, inventory) {
  const unitsById = new Map(inventory.source_units.map(unit => [unit.source_unit_id, unit]));
  let invalid = 0;
  for (const requirement of semanticManifest.requirements) {
    for (const citation of [requirement.front_evidence, ...requirement.citations]) {
      const unit = unitsById.get(citation.source_unit_id);
      if (!unit || unit.disposition !== 'analyzable' || unit.unit_hash !== citation.unit_hash) invalid += 1;
    }
  }
  return invalid;
}

function requestsFingerprint(client) {
  return client.requests.map(request => ({ idempotencyKey: request.idempotencyKey, input: request.input }));
}

function ledgerBatchHashes(discoveryLedger) {
  return discoveryLedger.batches.map(batch => batch.batch_hash);
}

/** Safe, closed projection: counts, versions, hashes, batch metrics, usage and booleans only. Never
 * expanded paragraphs, model prose, requirement labels, document ids inside batch entries, paths,
 * URLs or raw source text. */
function buildSanitizedReport({ fixture, firstInventory, first, negative, repeatRunIdentical }) {
  const coverage = providerCoverage({ fixture, inventory: firstInventory, requests: first.client.requests });
  const manifest = first.result.semanticManifest;
  const ledger = first.result.discoveryLedger;
  return {
    fixture_version: fixture.fixture_version,
    target_label: fixture.target_label,
    public_process_ref: fixture.public_process_ref,
    documents_expected: fixture.expected_document_count,
    documents_represented: coverage.documentsRepresented,
    documents_match_fixture: coverage.documentIdsMatchFixture,
    source_units_expected: fixture.expected_source_unit_count,
    source_units_sent: coverage.sourceUnitsSent,
    source_units_duplicate_sent: coverage.sourceUnitsDuplicateSent,
    source_units_match_inventory: coverage.sourceUnitsMatchInventory,
    inventory_version: firstInventory.inventory_version,
    snapshot_hash: firstInventory.snapshot_hash,
    inventory_hash: firstInventory.inventory_hash,
    semantic_manifest_version: manifest.semantic_manifest_version,
    semantic_manifest_hash: manifest.semantic_manifest_hash,
    requirements_count: manifest.requirements.length,
    excluded_count: manifest.excluded.length,
    unresolved_count: manifest.unresolved.length,
    invalid_citation_count: invalidCitationCount(manifest, firstInventory),
    decision_ready: manifest.decision_ready,
    discovery_coverage_status: manifest.discovery_coverage.status,
    analyzed_coverage_status: manifest.analyzed_coverage.status,
    discovery_ledger: {
      planner_version: ledger.planner_version,
      policy_version: ledger.policy_version,
      status: ledger.status,
      decision_ready: ledger.decision_ready,
      batch_count: ledger.batch_count,
      total_source_units: ledger.total_source_units,
      assigned_source_units: ledger.assigned_source_units,
      failed_source_units_count: ledger.failed_source_units.length,
      completed_batches: ledger.batches.filter(batch => batch.status === 'completed').length,
      batches: ledger.batches.map(batch => ({
        batch_index: batch.batch_index,
        status: batch.status,
        batch_hash: batch.batch_hash,
        char_count: batch.char_count,
        oversized_singleton: batch.oversized_singleton,
        source_unit_count: batch.source_unit_ids.length,
        usage: batch.usage ?? null,
      })),
    },
    usage: first.result.usage,
    repeat_run_identical: repeatRunIdentical,
    negative_zero_requirements_check: {
      rejected: negative.rejected,
      code: negative.code,
      stage: negative.stage,
      proves_fail_closed: negative.rejected === true,
    },
    no_real_provider_calls: true,
    no_persistence_writes: true,
  };
}

/** Throws a single descriptive error (never partial-passes silently) if any acceptance condition of
 * the AGT-002 V7 multi-batch canary contract fails. Never claims analysis quality or a GO/NO-GO —
 * only mechanical plumbing facts. */
function assertCanaryAcceptance({ fixture, firstInventory, secondInventory, first, negative, report }) {
  const violations = [];
  const coverage = providerCoverage({ fixture, inventory: firstInventory, requests: first.client.requests });

  if (report.documents_expected !== 13) violations.push('el fixture no declara 13 documentos');
  if (coverage.documentsRepresented !== 13 || !coverage.documentIdsMatchFixture) {
    violations.push('no todos los 13 documentos quedaron representados en las solicitudes vistas por el proveedor');
  }
  if (coverage.sourceUnitsSent !== 2335 || !coverage.sourceUnitsMatchInventory) {
    violations.push('las source_units enviadas al proveedor no cubren exactamente las 2335 unidades del inventario');
  }
  if (coverage.sourceUnitsDuplicateSent !== 0) violations.push('alguna source_unit se envió más de una vez');

  const ledger = first.result.discoveryLedger;
  if (!(ledger.batch_count > 1)) violations.push('el plan de lotes no produjo más de un lote (batch_count <= 1)');
  if (!ledger.batches.every(batch => batch.status === 'completed')) violations.push('algún lote del ledger no quedó completed');
  if (ledger.failed_source_units.length !== 0) violations.push('el ledger reporta failed_source_units no vacío');
  if (ledger.batches.some(batch => batch.status === 'failed')) violations.push('el ledger reporta al menos un lote failed');

  if (report.invalid_citation_count !== 0) violations.push('alguna cita del manifiesto no referencia un source_unit_id permitido con unit_hash coincidente');

  const manifest = first.result.semanticManifest;
  if (manifest.decision_ready !== false) violations.push('el manifiesto fusionado quedó decision_ready=true de forma indebida');
  if (manifest.discovery_coverage.status === 'complete') violations.push('la cobertura de descubrimiento quedó completa de forma indebida (certeza falsa sobre evidencia dispersa)');

  if (!report.repeat_run_identical) violations.push('la segunda corrida del mismo canario no produjo solicitudes/lotes/hashes idénticos a la primera');
  if (firstInventory.inventory_hash !== secondInventory.inventory_hash || firstInventory.snapshot_hash !== secondInventory.snapshot_hash) {
    violations.push('las dos corridas del canario no produjeron el mismo inventory_hash/snapshot_hash');
  }

  if (!negative.rejected || negative.code !== TENDER_SEMANTIC_DISCOVERY_NO_REQUIREMENTS_CODE) {
    violations.push('la comprobación negativa de cero requisitos no fue rechazada de forma cerrada (fail-closed) por el descubrimiento real');
  }

  if (violations.length) {
    throw new Error(`AGT002_V7_CANARY_ACCEPTANCE_FAILED: ${violations.join('; ')}`);
  }
}

/**
 * Runs the whole local, sanitized AGT-002 V7 multi-batch canary twice from the fixture alone (each
 * run rebuilds its own synthetic documents and inventory independently, so the comparison proves
 * full-pipeline determinism, not merely discovery-call determinism), runs the zero-requirements
 * negative check, verifies every acceptance condition, and returns the sanitized report.
 */
export async function runAgt002V7ProcuraduriaCanary({ fixturePath = DEFAULT_FIXTURE_PATH } = {}) {
  const fixture = readCanaryFixture(fixturePath);

  const firstDocuments = buildCanaryDocuments(fixture);
  const firstInventory = buildCanaryInventory(fixture, firstDocuments);
  const first = await runCanaryDiscoveryOnce({ documents: firstDocuments, inventory: firstInventory });

  const secondDocuments = buildCanaryDocuments(fixture);
  const secondInventory = buildCanaryInventory(fixture, secondDocuments);
  const second = await runCanaryDiscoveryOnce({ documents: secondDocuments, inventory: secondInventory });

  const negative = await runZeroRequirementsNegativeCheck();

  const repeatRunIdentical = JSON.stringify(requestsFingerprint(first.client)) === JSON.stringify(requestsFingerprint(second.client))
    && JSON.stringify(ledgerBatchHashes(first.result.discoveryLedger)) === JSON.stringify(ledgerBatchHashes(second.result.discoveryLedger))
    && first.result.semanticManifest.semantic_manifest_hash === second.result.semanticManifest.semantic_manifest_hash;

  const report = buildSanitizedReport({ fixture, firstInventory, first, negative, repeatRunIdentical });
  assertCanaryAcceptance({ fixture, firstInventory, secondInventory, first, second, negative, report });

  return {
    fixture, firstDocuments, firstInventory, first, secondDocuments, secondInventory, second, negative, report,
  };
}

async function main() {
  try {
    const { report } = await runAgt002V7ProcuraduriaCanary();
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: String((error && error.message) || error) }, null, 2));
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
