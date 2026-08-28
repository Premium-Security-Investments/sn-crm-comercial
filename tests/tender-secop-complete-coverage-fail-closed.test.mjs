// TDD (RED) — cualquier hueco de cobertura (documento oficial omitido o entrada
// de ZIP no extraida) debe impedir declarar cobertura integral y decision_ready.
//
// La maquinaria de fail-closed ya existe y funciona: un gap del expediente entra
// al inventario (`tender-requirement-inventory.js`) como `unresolved_visible`,
// el manifiesto semantico lo conserva verbatim con `origin: 'inventory'`, la
// cobertura de descubrimiento baja a 'partial' y `decision_ready` se queda en
// false aunque V3 haya dispuesto todo.
//
// El problema NO es la maquinaria: es que hoy los dos huecos reales nunca
// PRODUCEN un gap.
//
//   * Un documento oficial que no casa con el catalogo de palabras clave
//     desaparece antes de existir: no hay item, no hay version, no hay gap.
//   * Una entrada interna de un ZIP que no se puede leer (PDF/DOCX/XLSX,
//     corrupta, no soportada o anidada) se resuelve con texto fabricado y
//     `status: 'ok'`, asi que tampoco hay gap.
//
// En ambos casos el expediente se presenta COMPLETO con contenido faltante.
// Este archivo cierra el circuito de punta a punta y, al mismo tiempo, fija que
// cerrarlo no afloje nada: el GO sigue siendo humano, la identidad del snapshot
// sigue siendo append-only/idempotente, y ni el texto del documento ni las
// rutas de almacenamiento se filtran por la traza de cobertura.
//
// Ejecutar: node tests/tender-secop-complete-coverage-fail-closed.test.mjs

import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildTenderRequirementInventory } from '../tender-requirement-inventory.js';
import {
  buildTenderSemanticManifest,
  resolveTenderSemanticDecisionFrontier,
  resolveTenderSemanticFrontier,
} from '../tender-semantic-manifest.js';
import { extractTenderDocumentText } from '../tender-document-text-extraction.js';
import {
  ARCHIVE_TXT_CONTENT,
  buildMixedEntriesArchive,
} from './fixtures/tender-document-archive-fixtures.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');

const SNAPSHOT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const PLIEGO_TEXT = [
  'REQUISITOS FINANCIEROS',
  'Nivel de apalancamiento: el proponente deberá acreditar un nivel de apalancamiento entre el 51% y el 60%.',
  'REQUISITOS TÉCNICOS',
  'Capacitación en accesibilidad: el contratista deberá certificar capacitación en accesibilidad para todo el personal operativo.',
  'El presente capítulo describe el objeto contractual y su alcance general.',
].join('\n');

const ANEXO_TEXT = [
  'REQUISITOS TÉCNICOS',
  'Residencia de datos: los datos deberán permanecer almacenados en centros de datos ubicados en territorio colombiano.',
].join('\n');

const documentOf = ({ id, version, text }) => ({
  document_id: id,
  document_version_id: version,
  content_hash: hash(text),
  extracted_text: text,
  document_type: 'pliego',
  name: `${id}.pdf`,
  current: true,
});

const DOCUMENTS = [
  documentOf({ id: 'secop-pliego', version: 'secop-pliego-v1', text: PLIEGO_TEXT }),
  documentOf({ id: 'secop-anexo', version: 'secop-anexo-v1', text: ANEXO_TEXT }),
];

/** Inventario + manifiesto + frontera finalizada CON analisis V3 completo. */
function analyzeSnapshot(documentGaps) {
  const inventory = buildTenderRequirementInventory({ snapshotId: SNAPSHOT_ID, documents: DOCUMENTS, documentGaps });
  const manifest = buildTenderSemanticManifest({ inventory, documents: DOCUMENTS });
  // Se le entrega a V3 el mejor caso posible: TODO requisito y TODA unidad
  // analizados. Si aun asi queda listo para decidir con un hueco, el fallo es
  // del contrato, no del analisis.
  const finalized = resolveTenderSemanticDecisionFrontier({
    semanticManifest: manifest,
    inventory,
    documents: DOCUMENTS,
    analyzedRequirementIds: manifest.requirements.map(requirement => requirement.requirement_id),
    analyzedSourceUnitIds: inventory.source_units.map(unit => unit.source_unit_id),
  });
  const frontier = resolveTenderSemanticFrontier({
    semanticManifest: manifest,
    inventory,
    documents: DOCUMENTS,
    analyzedCoverage: {
      analyzed_requirement_ids: manifest.requirements.map(requirement => requirement.requirement_id),
      dispositioned_source_unit_ids: inventory.source_units.map(unit => unit.source_unit_id),
    },
  });
  return { inventory, manifest, finalized, frontier };
}

// ===========================================================================
// 0. Control discriminante: SIN huecos, el expediente completo SI llega a
//    "listo para revision humana". Sin este control, todo lo demas seria
//    trivialmente cierto.
// ===========================================================================
const healthy = analyzeSnapshot([]);
{
  assert.equal(healthy.inventory.expedient_coverage.status, 'complete');
  assert.equal(healthy.manifest.discovery_coverage.status, 'complete');
  assert.deepEqual(healthy.manifest.unresolved, []);
  assert.equal(healthy.finalized.analyzed_coverage.status, 'complete');
  assert.equal(healthy.finalized.decision_ready, true, 'un expediente integral y analizado SI alcanza la disposicion');
  assert.equal(healthy.finalized.recommendation, 'ready_for_human_review');
  assert.equal(healthy.frontier.decision_ready, true);
  // Y aun asi jamas autoriza: el GO sigue siendo exclusivamente humano.
  assert.equal(healthy.finalized.human_review_required, true);
  assert.equal(healthy.frontier.human_review_required, true);
  assert.notEqual(healthy.finalized.recommendation, 'go');
}

// ===========================================================================
// 1. Hueco por ENTRADA DE ZIP: el paquete oficial con entradas ilegibles debe
//    producir un gap tipado, y ese gap debe impedir la disposicion.
// ===========================================================================
const zipExtraction = await extractTenderDocumentText(buildMixedEntriesArchive(), 'FORMATOS OFICIALES.zip', 'application/zip');
{
  assert.equal(
    zipExtraction.status,
    'gap',
    'un ZIP oficial con entradas internas no extraidas nunca puede resolver como extraccion completa',
  );
  assert.equal(zipExtraction.metadata.gap_reason, 'archive_incomplete_extraction');
  assert.ok(zipExtraction.metadata.internal_gaps.length > 0, 'los huecos internos se enumeran uno por uno');

  // El gap del documento se deriva del resultado tipado, tal como ya hace la
  // persistencia de extracciones: no hay traduccion ad hoc en ningun sitio.
  const zipGap = { document_id: 'secop-formatos-zip', reason: zipExtraction.metadata.gap_reason };
  const gapped = analyzeSnapshot([zipGap]);

  assert.equal(gapped.inventory.expedient_coverage.status, 'partial', 'una entrada de ZIP sin extraer rompe la cobertura del expediente');
  assert.equal(gapped.inventory.coverage_ledger.unresolved_visible_count, 1);
  assert.equal(gapped.manifest.discovery_coverage.status, 'partial');
  assert.equal(gapped.manifest.unresolved.length, 1);
  assert.deepEqual(
    gapped.manifest.unresolved.map(entry => [entry.origin, entry.reason]),
    [['inventory', 'archive_incomplete_extraction']],
    'el motivo del hueco viaja verbatim: un ZIP incompleto no se re-etiqueta como fallo semantico',
  );
  assert.equal(gapped.finalized.decision_ready, false, 'con una entrada de ZIP sin leer no hay disposicion, por completo que sea el analisis');
  assert.equal(gapped.finalized.recommendation, 'pause');
  assert.equal(gapped.finalized.analyzed_coverage.status, 'partial');
  assert.equal(gapped.frontier.decision_ready, false);
  assert.equal(gapped.finalized.human_review_required, true);

  // Exposicion: ni el texto de la entrada ni la ruta interna del paquete
  // pueden viajar dentro del expediente por la via del gap.
  const serialized = JSON.stringify(gapped.inventory);
  assert.equal(serialized.includes(ARCHIVE_TXT_CONTENT), false, 'el gap no arrastra el texto de las entradas del paquete');
  assert.equal(serialized.includes('tender-documents/'), false, 'el gap no arrastra rutas de almacenamiento');
}

// ===========================================================================
// 2. Hueco por DOCUMENTO OFICIAL OMITIDO: lo que la seleccion deje fuera debe
//    llegar al inventario como gap y bloquear la disposicion igual.
// ===========================================================================
{
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/secop-ii-process-official-documents.json', import.meta.url), 'utf8'));
  const {
    selectTenderOfficialDocuments,
    tenderOfficialCoverageGaps,
    TENDER_OFFICIAL_DOCUMENT_OMITTED_REASON,
  } = await import('../tender-official-document-coverage.js');

  // Los 7 documentos publicados entran completos: la cobertura es integral.
  const full = selectTenderOfficialDocuments(fixture.documents, {
    nameGetter: doc => doc.nombre_archivo,
    idGetter: doc => doc.id_documento,
  });
  assert.equal(full.coverage.status, 'complete');
  assert.deepEqual(tenderOfficialCoverageGaps(full.coverage), []);
  assert.equal(analyzeSnapshot(tenderOfficialCoverageGaps(full.coverage)).finalized.decision_ready, true);

  // Con el tope excedido, cada omitido es un gap explicito y la disposicion cae.
  const capped = selectTenderOfficialDocuments(fixture.documents, {
    nameGetter: doc => doc.nombre_archivo,
    idGetter: doc => doc.id_documento,
    cap: 6,
  });
  assert.equal(capped.coverage.status, 'partial');
  assert.equal(capped.coverage.omitted_count, 1);

  const coverageGaps = tenderOfficialCoverageGaps(capped.coverage);
  assert.deepEqual(coverageGaps, [{ document_id: 'SECOP-DOC-0007', reason: TENDER_OFFICIAL_DOCUMENT_OMITTED_REASON }]);

  const omitted = analyzeSnapshot(coverageGaps);
  assert.equal(omitted.inventory.expedient_coverage.status, 'partial');
  assert.deepEqual(
    omitted.manifest.unresolved.map(entry => [entry.origin, entry.reason]),
    [['inventory', TENDER_OFFICIAL_DOCUMENT_OMITTED_REASON]],
  );
  assert.equal(omitted.finalized.decision_ready, false, 'un documento oficial omitido impide la disposicion aunque todo lo importado se haya analizado');
  assert.equal(omitted.finalized.recommendation, 'pause');
  assert.equal(omitted.frontier.decision_ready, false);
  assert.equal(omitted.finalized.human_review_required, true);

  // Los dos huecos a la vez siguen enumerandose por separado, sin colapsarse.
  const both = analyzeSnapshot([
    ...coverageGaps,
    { document_id: 'secop-formatos-zip', reason: 'archive_incomplete_extraction' },
  ]);
  assert.equal(both.manifest.unresolved.length, 2);
  assert.deepEqual(
    both.manifest.unresolved.map(entry => entry.reason).sort(),
    ['archive_incomplete_extraction', TENDER_OFFICIAL_DOCUMENT_OMITTED_REASON].sort(),
  );
  assert.equal(both.finalized.decision_ready, false);

  // --- Identidad append-only / idempotente ------------------------------
  // Mismo snapshot y mismos huecos => misma identidad (reejecutar no duplica).
  const repeat = analyzeSnapshot(coverageGaps);
  assert.equal(repeat.inventory.inventory_hash, omitted.inventory.inventory_hash);
  assert.equal(repeat.inventory.snapshot_hash, omitted.inventory.snapshot_hash);
  assert.equal(repeat.finalized.semantic_manifest_hash, omitted.finalized.semantic_manifest_hash);
  // Un expediente degradado NO puede reutilizar la identidad del sano.
  assert.notEqual(omitted.inventory.snapshot_hash, healthy.inventory.snapshot_hash);
  assert.notEqual(omitted.finalized.semantic_manifest_hash, healthy.finalized.semantic_manifest_hash);

  // --- El GO sigue siendo humano en TODOS los caminos --------------------
  for (const manifest of [healthy.finalized, omitted.finalized, both.finalized]) {
    assert.equal(manifest.human_review_required, true);
    assert.ok(['pause', 'ready_for_human_review'].includes(manifest.recommendation));
    assert.notEqual(manifest.recommendation, 'go');
  }

  // --- La cobertura no filtra endpoints firmados -------------------------
  const serialized = JSON.stringify({ coverage: capped.coverage, gaps: coverageGaps });
  assert.equal(serialized.includes('token='), false);
  assert.equal(serialized.includes('community.secop.gov.co'), false);
}

console.log('tender-secop-complete-coverage-fail-closed.test.mjs OK');
