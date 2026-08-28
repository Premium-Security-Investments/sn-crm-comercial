// TDD (RED) — contrato de extraccion REAL por entrada para paquetes ZIP oficiales.
//
// Hoy `extractTenderDocumentText` trata un ZIP como un "manifiesto de formatos":
// solo lee de verdad las entradas .txt/.csv/.xml/.html y, para TODAS las demas
// (PDF, DOCX, XLSX, imagenes, archivos anidados), escribe la frase fija
// "Archivo incluido en ZIP para checklist de formatos." dentro del texto
// extraido y devuelve `status: 'ok'`. Consecuencias reales en produccion:
//
//   1. El contenido de un pliego/anexo/formato entregado DENTRO de un ZIP nunca
//      llega al expediente: se persiste texto fabricado como si fuera contenido
//      del documento.
//   2. Ese texto fabricado hace que la cobertura se vea COMPLETA. Una entrada
//      corrupta, no soportada o anidada no produce ningun gap tipado, asi que
//      la maquinaria de fail-closed (inventario -> manifiesto semantico ->
//      decision_ready) nunca se entera de que falta contenido.
//   3. La preflight de seguridad de archivo (`enforceArchiveSafety`) se aplica
//      SOLO a las entradas que casan con el patron de texto, de modo que una
//      bomba de expansion escondida bajo una extension .pdf no se controla.
//   4. Un nombre de entrada con traversal (`../`) o ruta absoluta se procesa
//      como cualquier otro (zip-slip).
//
// Este archivo fija el contrato que cierra esos cuatro huecos. Ejecutar:
//   node tests/tender-zip-entry-extraction-coverage.test.mjs

import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import {
  extractTenderDocumentText,
  TENDER_DOCUMENT_TEXT_EXTRACTOR_VERSION,
  TENDER_DOCUMENT_ARCHIVE_SAFETY_POLICY,
  TENDER_DOCUMENT_MAX_ERROR_MESSAGE_LENGTH,
} from '../tender-document-text-extraction.js';
import {
  ARCHIVE_CSV_CONTENT,
  ARCHIVE_DOCX_MARKER,
  ARCHIVE_PDF_MARKER,
  ARCHIVE_TXT_CONTENT,
  ARCHIVE_XLSX_CELL_VALUE,
  ARCHIVE_XLSX_SHEET_NAME,
  MIXED_ARCHIVE_ENTRY_NAMES,
  SUPPORTED_ARCHIVE_ENTRY_NAMES,
  buildAbsolutePathEntryArchive,
  buildExpansionBombArchive,
  buildMixedEntriesArchive,
  buildSupportedEntriesArchive,
  buildTraversalEntryArchive,
} from './fixtures/tender-document-archive-fixtures.mjs';

const ZIP_MIME = 'application/zip';
const FABRICATED_PLACEHOLDER = 'Archivo incluido en ZIP para checklist de formatos.';

// Claves exactas de un registro de procedencia por entrada. Cerrado a proposito:
// una entrada del expediente no puede quedar descrita "mas o menos".
const ENTRY_KEYS = [
  'char_count', 'compressed_size_bytes', 'declared_size_bytes', 'entry_name',
  'gap_reason', 'kind', 'parser', 'status', 'text_hash',
];

const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
const entryByName = (result, name) => result.metadata.entries.find(entry => entry.entry_name === name);

async function run() {
  // =========================================================================
  // 1) Formato y orden deterministas del texto agregado.
  //    Las entradas se emiten ordenadas por nombre, no en el orden en que
  //    fueron escritas en el ZIP, para que el mismo paquete produzca siempre
  //    el mismo texto y el mismo text_hash.
  // =========================================================================
  {
    const zip = new AdmZip();
    zip.addFile('b.txt', Buffer.from('Beta', 'utf8'));
    zip.addFile('a.txt', Buffer.from('Alfa', 'utf8'));
    const result = await extractTenderDocumentText(zip.toBuffer(), 'formatos.zip', ZIP_MIME);
    assert.equal(result.status, 'ok');
    assert.equal(
      result.text,
      '--- a.txt ---\nAlfa\n\n--- b.txt ---\nBeta',
      'el texto del paquete debe emitirse en orden ascendente de nombre de entrada, no en orden de escritura',
    );
    assert.equal(result.text_hash, sha256(result.text));
  }

  // =========================================================================
  // 2) Extraccion REAL de cada entrada interna soportada (TXT/CSV/PDF/DOCX/XLSX).
  //    Ninguna entrada soportada puede resolverse con texto fabricado.
  // =========================================================================
  const supported = await extractTenderDocumentText(buildSupportedEntriesArchive(), 'FORMATOS OFICIALES.zip', ZIP_MIME);
  {
    assert.equal(supported.status, 'ok', 'un ZIP cuyas entradas se extraen todas debe resolver ok');
    assert.equal(supported.parser, 'zip-archive', 'el parser deja de ser un "manifiesto" y pasa a ser extraccion real del paquete');
    assert.equal(
      supported.text.includes(FABRICATED_PLACEHOLDER),
      false,
      'ninguna entrada soportada puede resolverse con la frase fija de checklist en lugar de su texto real',
    );

    // Texto real de cada entrada, por parser.
    assert.ok(supported.text.includes(ARCHIVE_TXT_CONTENT), 'el TXT interno debe aportar su texto literal');
    assert.ok(supported.text.includes(ARCHIVE_CSV_CONTENT), 'el CSV interno debe aportar su texto literal');
    assert.ok(supported.text.includes(ARCHIVE_PDF_MARKER), 'el PDF interno debe extraerse con pdf-parse, no describirse');
    assert.ok(supported.text.includes(ARCHIVE_DOCX_MARKER), 'el DOCX interno debe extraerse con mammoth, no describirse');
    assert.ok(supported.text.includes(`--- Hoja: ${ARCHIVE_XLSX_SHEET_NAME} ---`), 'el XLSX interno debe extraerse hoja por hoja');
    assert.ok(supported.text.includes(`A1: ${ARCHIVE_XLSX_CELL_VALUE}`), 'el XLSX interno debe aportar sus celdas pobladas');

    // Encabezado de procedencia por entrada, en orden ascendente.
    for (const name of SUPPORTED_ARCHIVE_ENTRY_NAMES) {
      assert.ok(supported.text.includes(`--- ${name} ---`), `el texto debe declarar la procedencia de la entrada ${name}`);
    }
    const positions = SUPPORTED_ARCHIVE_ENTRY_NAMES.map(name => supported.text.indexOf(`--- ${name} ---`));
    assert.deepEqual(
      positions,
      [...positions].sort((left, right) => left - right),
      'las secciones del texto deben aparecer en orden ascendente de nombre de entrada',
    );

    // Metadatos del paquete: claves exactas, sin gaps internos.
    assert.deepEqual(
      Object.keys(supported.metadata).sort(),
      ['entries', 'entry_count', 'internal_gaps'],
      'un paquete ok expone conteo, procedencia por entrada y la lista (vacia) de gaps internos',
    );
    assert.equal(supported.metadata.entry_count, SUPPORTED_ARCHIVE_ENTRY_NAMES.length);
    assert.deepEqual(supported.metadata.internal_gaps, [], 'sin entradas problematicas no hay gaps internos');
    assert.deepEqual(
      supported.metadata.entries.map(entry => entry.entry_name),
      SUPPORTED_ARCHIVE_ENTRY_NAMES,
      'la procedencia por entrada se emite ordenada por nombre',
    );

    for (const entry of supported.metadata.entries) {
      assert.deepEqual(Object.keys(entry).sort(), ENTRY_KEYS, `claves exactas de procedencia para ${entry.entry_name}`);
      assert.equal(entry.status, 'ok');
      assert.equal(entry.gap_reason, null);
      assert.ok(entry.char_count > 0, `${entry.entry_name} debe aportar caracteres reales`);
      assert.match(entry.text_hash, /^[0-9a-f]{64}$/);
      assert.ok(Number.isInteger(entry.declared_size_bytes) && entry.declared_size_bytes > 0);
      assert.ok(Number.isInteger(entry.compressed_size_bytes) && entry.compressed_size_bytes >= 0);
    }

    assert.deepEqual(
      supported.metadata.entries.map(entry => [entry.entry_name, entry.kind, entry.parser]),
      [
        ['anexo-tecnico.docx', 'docx', 'mammoth-docx'],
        ['condiciones.txt', 'txt', 'plain-text'],
        ['formato-financiero.xlsx', 'xlsx', 'xlsx-ooxml'],
        ['matriz.csv', 'txt', 'plain-text'],
        ['pliego.pdf', 'pdf', 'pdf-parse'],
      ],
      'cada entrada declara el tipo detectado y el parser real que la leyo',
    );

    // Procedencia exacta y verificable para la entrada de texto plano.
    const txtEntry = entryByName(supported, 'condiciones.txt');
    assert.equal(txtEntry.char_count, ARCHIVE_TXT_CONTENT.length);
    assert.equal(txtEntry.text_hash, sha256(ARCHIVE_TXT_CONTENT));
    assert.equal(txtEntry.declared_size_bytes, Buffer.byteLength(ARCHIVE_TXT_CONTENT, 'utf8'));

    const csvEntry = entryByName(supported, 'matriz.csv');
    assert.equal(csvEntry.char_count, ARCHIVE_CSV_CONTENT.length);
    assert.equal(csvEntry.text_hash, sha256(ARCHIVE_CSV_CONTENT));
  }

  // =========================================================================
  // 3) Determinismo: los mismos bytes producen exactamente el mismo texto,
  //    el mismo hash y la misma procedencia por entrada.
  // =========================================================================
  {
    const rerun = await extractTenderDocumentText(buildSupportedEntriesArchive(), 'FORMATOS OFICIALES.zip', ZIP_MIME);
    assert.equal(rerun.text, supported.text);
    assert.equal(rerun.text_hash, supported.text_hash);
    assert.deepEqual(rerun.metadata.entries, supported.metadata.entries);
  }

  // =========================================================================
  // 4) Gaps internos EXPLICITOS: corrupta, no soportada y anidadas.
  //    Un paquete con cualquier gap interno NO puede resolver 'ok': se
  //    convierte en un gap tipado del documento, que es lo unico que la
  //    maquinaria de cobertura sabe leer para fallar cerrado.
  // =========================================================================
  const mixed = await extractTenderDocumentText(buildMixedEntriesArchive(), 'FORMATOS MIXTOS.zip', ZIP_MIME);
  {
    assert.equal(mixed.status, 'gap', 'un paquete con entradas ilegibles nunca es una extraccion exitosa');
    assert.equal(mixed.metadata.gap_reason, 'archive_incomplete_extraction');
    assert.equal(mixed.text, '', 'un gap tipado no persiste texto parcial como si fuera el documento');
    assert.equal(mixed.char_count, 0);
    assert.equal(mixed.text_hash, sha256(''));

    assert.deepEqual(
      Object.keys(mixed.metadata).sort(),
      ['entries', 'entry_count', 'error', 'gap_reason', 'internal_gaps'],
      'un paquete con gaps internos conserva la procedencia completa junto al motivo del gap',
    );
    assert.equal(mixed.metadata.error, null, 'un gap de cobertura interna no es un error de parser del paquete');
    assert.equal(mixed.metadata.entry_count, MIXED_ARCHIVE_ENTRY_NAMES.length);
    assert.deepEqual(
      mixed.metadata.entries.map(entry => entry.entry_name),
      MIXED_ARCHIVE_ENTRY_NAMES,
      'la procedencia cubre TODAS las entradas del paquete, tambien las que fallaron',
    );

    // Los gaps internos se enumeran uno por uno, nunca se resumen ni se omiten.
    assert.deepEqual(
      mixed.metadata.internal_gaps,
      [
        { entry_name: 'corrupto.pdf', gap_reason: 'extraction_error' },
        { entry_name: 'paquete-anidado.zip', gap_reason: 'nested_archive_not_supported' },
        { entry_name: 'plano.png', gap_reason: 'unsupported_type' },
        { entry_name: 'respaldo.rar', gap_reason: 'nested_archive_not_supported' },
      ],
      'cada entrada no resuelta se enumera explicitamente con su motivo cerrado',
    );

    // Un archivo anidado se RECHAZA, nunca se recorre: su contenido interno no
    // puede aparecer en la procedencia del paquete externo.
    assert.equal(
      mixed.metadata.entries.some(entry => entry.entry_name.includes('interno.txt')),
      false,
      'un ZIP anidado no se descomprime recursivamente',
    );
    assert.equal(mixed.text.includes('CONTENIDO ANIDADO'), false, 'el contenido de un ZIP anidado nunca se extrae');

    // Aun con gaps, las entradas legibles conservan su procedencia real: el
    // paquete no se abandona a la primera entrada mala.
    for (const name of SUPPORTED_ARCHIVE_ENTRY_NAMES) {
      const entry = entryByName(mixed, name);
      assert.equal(entry.status, 'ok', `${name} sigue extrayendose aunque otra entrada falle`);
      assert.ok(entry.char_count > 0);
    }
    for (const entry of mixed.metadata.entries) {
      assert.deepEqual(Object.keys(entry).sort(), ENTRY_KEYS, `claves exactas de procedencia para ${entry.entry_name}`);
      if (entry.status === 'gap') {
        assert.equal(entry.char_count, 0);
        assert.equal(entry.text_hash, sha256(''));
        assert.ok(typeof entry.parser === 'string' && entry.parser.length > 0, 'una entrada en gap declara con que se intento leerla');
        assert.ok(typeof entry.gap_reason === 'string' && entry.gap_reason.length > 0);
      }
    }
    assert.equal(
      mixed.metadata.entries.filter(entry => entry.status === 'gap').length,
      mixed.metadata.internal_gaps.length,
      'internal_gaps y las entradas en gap deben ser la misma lista, sin omisiones',
    );
    assert.equal(entryByName(mixed, 'plano.png').kind, 'unsupported');

    // Determinismo tambien con gaps.
    const rerun = await extractTenderDocumentText(buildMixedEntriesArchive(), 'FORMATOS MIXTOS.zip', ZIP_MIME);
    assert.deepEqual(rerun.metadata.entries, mixed.metadata.entries);
    assert.deepEqual(rerun.metadata.internal_gaps, mixed.metadata.internal_gaps);
  }

  // =========================================================================
  // 5) Zip-slip: una entrada que escapa del paquete invalida el paquete entero.
  //    (Si adm-zip llegara a normalizar el nombre al leer, la deteccion debe
  //    hacerse sobre el nombre crudo del directorio central: el contrato es que
  //    NUNCA se emita contenido de un paquete con rutas inseguras.)
  // =========================================================================
  {
    for (const [label, buffer] of [
      ['traversal ../', buildTraversalEntryArchive()],
      ['ruta absoluta', buildAbsolutePathEntryArchive()],
    ]) {
      const result = await extractTenderDocumentText(buffer, 'formatos.zip', ZIP_MIME);
      assert.equal(result.status, 'gap', `${label}: un paquete con rutas inseguras nunca produce texto`);
      assert.equal(result.metadata.gap_reason, 'unsafe_entry_path', `${label}: el motivo del gap debe ser explicito`);
      assert.equal(result.text, '', `${label}: ni siquiera las entradas legitimas se emiten`);
      assert.equal(result.text.includes('contenido legitimo'), false);
    }
  }

  // =========================================================================
  // 6) Limites de recursos / bomba de expansion sobre entradas NO textuales.
  //    La preflight debe cubrir toda entrada que se vaya a descomprimir, no
  //    solo las que casan con el patron de texto.
  // =========================================================================
  {
    const result = await extractTenderDocumentText(buildExpansionBombArchive(), 'formatos.zip', ZIP_MIME);
    assert.equal(result.status, 'gap', 'una entrada .pdf que declara 26 MiB expandidos debe frenar el paquete');
    assert.equal(
      result.metadata.gap_reason,
      'expanded_size_exceeded',
      'la preflight de expansion debe aplicarse a TODAS las entradas soportadas, no solo a las de texto',
    );
    assert.equal(result.text, '');
  }

  // El limite de numero de entradas sigue vigente y se evalua antes que nada.
  {
    const zip = new AdmZip();
    for (let i = 0; i < TENDER_DOCUMENT_ARCHIVE_SAFETY_POLICY.maxEntryCount + 5; i += 1) {
      zip.addFile(`formato-${i}.txt`, Buffer.from('ok', 'utf8'));
    }
    const result = await extractTenderDocumentText(zip.toBuffer(), 'formatos.zip', ZIP_MIME);
    assert.equal(result.status, 'gap');
    assert.equal(result.metadata.gap_reason, 'too_many_entries');
  }

  // =========================================================================
  // 7) La procedencia por entrada no puede convertirse en un canal de fuga:
  //    ni bytes, ni texto crudo, ni rutas de almacenamiento, ni mensajes de
  //    error sin sanear.
  // =========================================================================
  {
    for (const entry of mixed.metadata.entries) {
      assert.equal(Object.hasOwn(entry, 'text'), false, 'la procedencia por entrada nunca lleva el texto crudo');
      assert.equal(Object.hasOwn(entry, 'data'), false, 'la procedencia por entrada nunca lleva bytes');
      assert.equal(Object.hasOwn(entry, 'storage_path'), false, 'la procedencia por entrada nunca lleva rutas de almacenamiento');
    }
    const serialized = JSON.stringify(mixed.metadata);
    assert.equal(serialized.includes(ARCHIVE_TXT_CONTENT), false, 'los metadatos no pueden replicar el contenido del documento');
    assert.ok(
      serialized.length <= 20_000,
      'los metadatos del paquete son un indice acotado de procedencia, no una copia del expediente',
    );

    // Un ZIP corrupto a nivel de paquete sigue siendo un gap tipado con error
    // saneado y acotado (una sola linea), nunca una excepcion sin manejar.
    const brokenZip = await extractTenderDocumentText(Buffer.from('no-zip-bytes'), 'roto.zip', ZIP_MIME);
    assert.equal(brokenZip.status, 'gap');
    assert.equal(brokenZip.metadata.gap_reason, 'extraction_error');
    assert.ok(brokenZip.metadata.error, 'un paquete ilegible debe reportar el error capturado');
    assert.ok(brokenZip.metadata.error.length <= TENDER_DOCUMENT_MAX_ERROR_MESSAGE_LENGTH);
    assert.equal(brokenZip.metadata.error.includes('\n'), false);
  }

  // =========================================================================
  // 8) La forma del texto y de los metadatos cambio para una misma entrada, asi
  //    que la version del extractor debe subir: es la unica senal que tiene la
  //    persistencia para saber que extracciones hay que reprocesar.
  // =========================================================================
  assert.equal(
    TENDER_DOCUMENT_TEXT_EXTRACTOR_VERSION,
    'tender-document-text-extraction@3',
    'la extraccion real por entrada cambia texto y metadatos: la version del extractor debe bumpearse',
  );

  console.log('tender-zip-entry-extraction-coverage.test.mjs OK');
}

run();
