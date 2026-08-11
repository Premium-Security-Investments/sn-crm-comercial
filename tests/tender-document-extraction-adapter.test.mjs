import { strict as assert } from 'node:assert';
import {
  resolveLegacyExtractedText,
  TenderDocumentExtractionGapError,
} from '../tender-document-text-extraction.js';

function okResult(text) {
  return { status: 'ok', text, metadata: {} };
}

function gapResult(gapReason, error = null) {
  return { status: 'gap', text: '', metadata: { gap_reason: gapReason, error } };
}

// Every gap reason the extractor can return, other than the two legacy
// informational placeholders, must fail closed (throw) instead of returning
// prose that a caller could persist/parse as if it were real document content.
const THROWING_GAP_REASONS = [
  'extraction_error',
  'too_many_entries',
  'expanded_size_exceeded',
  'compression_ratio_exceeded',
  'extracted_text_size_exceeded',
  'empty_extraction',
];

function run() {
  // ok: returns the extracted text unchanged.
  {
    const result = resolveLegacyExtractedText(okResult('Contenido real del pliego.'), 'pliego.pdf');
    assert.equal(result, 'Contenido real del pliego.');
  }

  // unsupported_type / empty_input: legacy informational strings preserved unchanged.
  {
    const unsupported = resolveLegacyExtractedText(gapResult('unsupported_type'), 'imagen.png');
    assert.equal(unsupported, 'Archivo imagen.png cargado. Tipo no soportado para extracción profunda automática.');

    const empty = resolveLegacyExtractedText(gapResult('empty_input'), 'vacio.pdf');
    assert.equal(empty, 'Archivo vacio.pdf está vacío; no hay texto para extraer.');
  }

  // Every other gap reason throws a bounded, stable-coded error instead of
  // returning prose — this is what lets existing route/versioning error
  // handling catch the failure instead of silently persisting fabricated text.
  for (const gapReason of THROWING_GAP_REASONS) {
    const rawParserSecret = 'RAW_PARSER_SECRET /home/user/private/path.xlsx';
    assert.throws(
      () => resolveLegacyExtractedText(gapResult(gapReason, rawParserSecret), 'documento.xlsx'),
      error => {
        assert.ok(error instanceof TenderDocumentExtractionGapError, `esperaba TenderDocumentExtractionGapError para ${gapReason}`);
        assert.equal(error.code, 'TENDER_DOC_EXTRACTION_GAP');
        assert.equal(error.gap_reason, gapReason);
        assert.equal(error.status, 422);
        assert.equal(error.message.includes(rawParserSecret), false, 'no debe filtrar el mensaje crudo del parser');
        assert.ok(error.message.includes('documento.xlsx'));
        return true;
      },
    );
  }

  console.log('tender-document-extraction-adapter.test.mjs OK');
}

run();
