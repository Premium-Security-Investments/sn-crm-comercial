// BLOCKER 3 — la lectura vigente que sustenta el analisis debe elegir la
// extraccion canonica MAS RECIENTE Y PROCESABLE, nunca una stale o superficial.
//
// `TENDER_DOCUMENT_TEXT_EXTRACTOR_VERSION` existe justamente para esto: se sube
// "whenever parsing behavior changes text/metadata shape for a given input, so
// Phase 1.2 persistence can tell which extractions need reprocessing". Con la
// reextraccion real por entrada la version subio a @3.
//
// Pero `selectCanonicalExtractionsByDocumentVersion` IGNORA extractor_version y
// ordena solo por status (ok > gap) y created_at. Consecuencia real: el ZIP
// oficial que @2 resolvio como `ok` con texto de relleno ("Archivo incluido en
// ZIP para checklist de formatos.") gana para siempre sobre la fila @3 que ya
// descubrio que el paquete tiene entradas ilegibles. El reproceso corre, escribe
// la fila correcta... y la seleccion sigue sirviendo la superficial. AGT-002
// analiza texto fabricado y el expediente vuelve a presentarse 7/7.
//
// Contrato: la generacion del extractor manda primero. Dentro de una MISMA
// generacion se conserva exactamente la semantica actual (un ok vence a un gap,
// que es lo correcto para un reintento tras un fallo transitorio).
//
// Ejecutar: node tests/tender-snapshot-canonical-extraction-selection.test.mjs

import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  mergeCanonicalExtractionIntoDocument,
  deriveTenderDocumentExtractionGaps,
  selectCanonicalExtractionsByDocumentVersion,
} from '../tender-document-extraction-persistence.js';
import { buildTenderRequirementInventory } from '../tender-requirement-inventory.js';

const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');
const VERSION_ID = '66666666-6666-4666-8666-666666666666';
const SNAPSHOT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const PLACEHOLDER = 'Archivo incluido en ZIP para checklist de formatos.';

const okRow = ({ id, extractorVersion, text, createdAt }) => ({
  id,
  document_version_id: VERSION_ID,
  extractor_version: extractorVersion,
  status: 'ok',
  parser: 'zip-archive',
  extracted_text: text,
  text_hash: hash(text),
  char_count: text.length,
  created_at: createdAt,
});

const gapRow = ({ id, extractorVersion, gapReason, createdAt }) => ({
  id,
  document_version_id: VERSION_ID,
  extractor_version: extractorVersion,
  status: 'gap',
  parser: 'zip-archive',
  extracted_text: null,
  text_hash: null,
  char_count: 0,
  gap_reason: gapReason,
  created_at: createdAt,
});

// ===========================================================================
// 1. EL BLOQUEO: la generacion nueva del extractor manda, aunque su veredicto
//    sea un gap y el veredicto viejo fuera un ok.
// ===========================================================================
{
  const rows = [
    okRow({ id: 'stale-ok', extractorVersion: 'tender-document-text-extraction@2', text: PLACEHOLDER, createdAt: '2026-01-01T00:00:00Z' }),
    gapRow({ id: 'fresh-gap', extractorVersion: 'tender-document-text-extraction@3', gapReason: 'archive_incomplete_extraction', createdAt: '2026-03-01T00:00:00Z' }),
  ];
  const canonical = selectCanonicalExtractionsByDocumentVersion(rows).get(VERSION_ID);
  assert.equal(
    canonical.id,
    'fresh-gap',
    'una extraccion superficial de un extractor viejo no puede seguir ganandole al veredicto del extractor vigente',
  );
  assert.equal(canonical.gap_reason, 'archive_incomplete_extraction');

  // Y el orden en que la base devuelva las filas es irrelevante.
  assert.equal(selectCanonicalExtractionsByDocumentVersion([...rows].reverse()).get(VERSION_ID).id, 'fresh-gap');
}

// ===========================================================================
// 2. Dentro de la MISMA generacion la semantica actual se conserva intacta.
// ===========================================================================
{
  // Un gap posterior no tumba un ok de la misma generacion (fallo transitorio).
  const sameGeneration = selectCanonicalExtractionsByDocumentVersion([
    okRow({ id: 'ok', extractorVersion: 'tender-document-text-extraction@3', text: 'texto real', createdAt: '2026-01-01T00:00:00Z' }),
    gapRow({ id: 'gap', extractorVersion: 'tender-document-text-extraction@3', gapReason: 'extraction_error', createdAt: '2026-03-01T00:00:00Z' }),
  ]);
  assert.equal(sameGeneration.get(VERSION_ID).id, 'ok');

  // Y el ok mas reciente gana al ok anterior.
  const twoOk = selectCanonicalExtractionsByDocumentVersion([
    okRow({ id: 'viejo', extractorVersion: 'tender-document-text-extraction@3', text: 'v1', createdAt: '2026-01-01T00:00:00Z' }),
    okRow({ id: 'nuevo', extractorVersion: 'tender-document-text-extraction@3', text: 'v2', createdAt: '2026-02-01T00:00:00Z' }),
  ]);
  assert.equal(twoOk.get(VERSION_ID).id, 'nuevo');
}

// ===========================================================================
// 3. Un ok del extractor NUEVO tambien vence a un gap del viejo: la generacion
//    manda en las dos direcciones, no solo cuando degrada.
// ===========================================================================
{
  const canonical = selectCanonicalExtractionsByDocumentVersion([
    gapRow({ id: 'gap-viejo', extractorVersion: 'tender-document-text-extraction@2', gapReason: 'extraction_error', createdAt: '2026-01-01T00:00:00Z' }),
    okRow({ id: 'ok-nuevo', extractorVersion: 'tender-document-text-extraction@3', text: 'contenido real del paquete', createdAt: '2026-03-01T00:00:00Z' }),
  ]).get(VERSION_ID);
  assert.equal(canonical.id, 'ok-nuevo');
  assert.equal(canonical.extracted_text, 'contenido real del paquete');
}

// ===========================================================================
// 4. Defensivo: versiones de extractor ausentes, deformes o legadas nunca pueden
//    ganarle a una version bien formada, ni hacer estallar la seleccion.
// ===========================================================================
{
  // Filas historicas sin extractor_version: se comportan EXACTAMENTE como antes.
  const legacyOnly = selectCanonicalExtractionsByDocumentVersion([
    { id: 'old-ok', document_version_id: VERSION_ID, status: 'ok', extracted_text: 'v1', text_hash: hash('v1'), char_count: 2, created_at: '2026-01-01T00:00:00Z' },
    { id: 'new-gap', document_version_id: VERSION_ID, status: 'gap', extracted_text: null, text_hash: null, char_count: 0, gap_reason: 'extraction_error', created_at: '2026-03-01T00:00:00Z' },
  ]);
  assert.equal(legacyOnly.get(VERSION_ID).id, 'old-ok', 'sin extractor_version se conserva la semantica historica');

  // Una fila con version legible le gana a una sin version legible.
  for (const deformed of [null, '', 'sin-generacion', 'tender-document-text-extraction@', 'tender-document-text-extraction@abc', 42, {}]) {
    const canonical = selectCanonicalExtractionsByDocumentVersion([
      okRow({ id: 'deforme', extractorVersion: deformed, text: PLACEHOLDER, createdAt: '2026-06-01T00:00:00Z' }),
      gapRow({ id: 'bien-formada', extractorVersion: 'tender-document-text-extraction@3', gapReason: 'archive_incomplete_extraction', createdAt: '2026-01-01T00:00:00Z' }),
    ]).get(VERSION_ID);
    assert.equal(canonical.id, 'bien-formada', `una extractor_version deforme (${JSON.stringify(deformed)}) no puede ganar`);
  }

  // Una fila 'ok' malformada sigue descartandose antes que nada, por nueva que sea.
  const malformed = selectCanonicalExtractionsByDocumentVersion([
    { id: 'malformada', document_version_id: VERSION_ID, extractor_version: 'tender-document-text-extraction@9', status: 'ok', extracted_text: 'x', text_hash: hash('otro'), char_count: 1, created_at: '2026-06-01T00:00:00Z' },
    okRow({ id: 'buena', extractorVersion: 'tender-document-text-extraction@2', text: 'y', createdAt: '2025-01-01T00:00:00Z' }),
  ]);
  assert.equal(malformed.get(VERSION_ID).id, 'buena', 'una fila ok no verificable se descarta aunque venga del extractor mas nuevo');
}

// ===========================================================================
// 5. Cadena completa: la seleccion correcta es lo que impide declarar 7/7.
//    Con la fila stale el expediente se presenta integro; con la canonica el
//    hueco llega al inventario y la cobertura cae a 'partial'.
// ===========================================================================
{
  const documentRow = {
    id: VERSION_ID,
    source_document_id: 'SECOP-DOC-0007',
    name: 'FORMATOS OFICIALES.zip',
    document_type: 'anexo',
    content_hash: hash('bytes del paquete'),
    current: true,
    version: 2,
  };
  const rows = [
    okRow({ id: 'stale-ok', extractorVersion: 'tender-document-text-extraction@2', text: PLACEHOLDER, createdAt: '2026-01-01T00:00:00Z' }),
    gapRow({ id: 'fresh-gap', extractorVersion: 'tender-document-text-extraction@3', gapReason: 'archive_incomplete_extraction', createdAt: '2026-03-01T00:00:00Z' }),
  ];

  const canonical = selectCanonicalExtractionsByDocumentVersion(rows).get(VERSION_ID);
  const merged = mergeCanonicalExtractionIntoDocument(documentRow, canonical, null);

  assert.equal(merged.extraction_status, 'gap', 'el documento vigente hereda el veredicto del extractor vigente');
  assert.equal(merged.extracted_text, '', 'un gap nunca fabrica texto');
  assert.equal(
    merged.extracted_text.includes(PLACEHOLDER),
    false,
    'el texto de relleno del extractor viejo no puede llegar al analisis',
  );

  // El hueco viaja al snapshot inmutable con su motivo cerrado y su identidad.
  const gaps = deriveTenderDocumentExtractionGaps([merged]);
  assert.deepEqual(gaps, [{
    document_id: 'SECOP-DOC-0007',
    document_type: 'anexo',
    name: 'FORMATOS OFICIALES.zip',
    reason: 'archive_incomplete_extraction',
  }]);

  // Y AGT-002 no puede declarar cobertura integral con ese hueco dentro.
  const inventory = buildTenderRequirementInventory({
    snapshotId: SNAPSHOT_ID,
    documents: [{ ...merged, document_id: merged.source_document_id, document_version_id: merged.id }],
    documentGaps: gaps,
  });
  assert.equal(inventory.expedient_coverage.status, 'partial', 'un ZIP sin extraer nunca puede declararse cobertura completa');
  assert.ok(inventory.coverage_ledger.unresolved_visible_count >= 1);
  assert.ok(
    inventory.source_units.some(unit => unit.disposition === 'unresolved_visible' && unit.reason === 'archive_incomplete_extraction'),
    'el motivo del hueco viaja verbatim hasta las unidades de origen',
  );

  // Trazabilidad: la version documental que sustento el analisis queda ligada.
  assert.ok(
    inventory.source_units.every(unit => unit.document_version_id === VERSION_ID || unit.document_version_id === 'gap'),
    'cada unidad declara de que version documental salio',
  );

  // Ni el texto de relleno ni rutas internas viajan por el inventario.
  const serialized = JSON.stringify(inventory);
  assert.equal(serialized.includes(PLACEHOLDER), false);
  assert.equal(serialized.includes('tender-documents/'), false);

  // Control discriminante: con la fila stale ganando, el expediente se habria
  // presentado COMPLETO. Es exactamente la regresion que este archivo cierra.
  const staleMerged = mergeCanonicalExtractionIntoDocument(documentRow, rows[0], null);
  const staleInventory = buildTenderRequirementInventory({
    snapshotId: SNAPSHOT_ID,
    documents: [{ ...staleMerged, document_id: staleMerged.source_document_id, document_version_id: staleMerged.id }],
    documentGaps: deriveTenderDocumentExtractionGaps([staleMerged]),
  });
  assert.equal(staleInventory.expedient_coverage.status, 'complete');
  assert.notEqual(
    inventory.snapshot_hash,
    staleInventory.snapshot_hash,
    'un expediente con hueco no puede reutilizar la identidad del que se creia integro',
  );
}

console.log('tender-snapshot-canonical-extraction-selection.test.mjs OK');
