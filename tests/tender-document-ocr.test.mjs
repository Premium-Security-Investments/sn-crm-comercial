// OCR de PDF escaneados (Juan, 2026-11-08): corre dentro del trabajo que arranca los análisis, antes de admitirlos; el
// texto se guarda como extracción nueva que gana sobre el «gap»; si no sale texto, un «gap» del OCR evita reintentos.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { TENDER_DOCUMENT_OCR_EXTRACTOR_VERSION, ocrPdfBuffer, runTenderDocumentOcrPass, selectOcrCandidates } from '../verticales/licitaciones/tender-document-ocr.js';
import { mergeCanonicalExtractionIntoDocument, selectCanonicalExtractionsByDocumentVersion } from '../verticales/licitaciones/tender-document-extraction-persistence.js';

const V = (id, extra = {}) => ({ id, opportunity_id: 'o1', tender_id: 't1', name: `${id}.pdf`, mime_type: 'application/pdf', storage_path: `manual-uploads/o1/${id}.pdf`, current: true, extracted_text: '', actor_id: 'k', created_at: '2026-11-08T10:00:00Z', origin: 'propio', ...extra });
const GAP = id => ({ id: `e-${id}`, document_version_id: id, extractor_version: 'tender-document-text-extraction@3', status: 'gap', created_at: '2026-11-08T10:00:01Z' });

test('candidatos: PDF vigentes con «gap» o sin texto, que el OCR no haya intentado', () => {
  const versions = [V('scan'), V('texto', { extracted_text: 'x'.repeat(500) }), V('word', { mime_type: 'application/vnd.openxmlformats', name: 'a.docx' }), V('intentado'), V('viejo', { current: false })];
  const extractions = [GAP('scan'), GAP('intentado'), { id: 'o', document_version_id: 'intentado', extractor_version: TENDER_DOCUMENT_OCR_EXTRACTOR_VERSION, status: 'gap', created_at: '2026-11-08T11:00:00Z' }];
  assert.deepEqual(selectOcrCandidates(versions, extractions).map(v => v.id), ['scan']);
});

test('la extracción del OCR gana sobre el «gap» del extractor de texto en la lectura canónica', () => {
  const text = 'Valor asegurado: 400 SMMLV';
  const ocr = { id: 'o', document_version_id: 'scan', extractor_version: TENDER_DOCUMENT_OCR_EXTRACTOR_VERSION, status: 'ok', extracted_text: text, text_hash: createHash('sha256').update(text).digest('hex'), char_count: [...text].length, created_at: '2026-11-08T11:00:00Z' };
  const canonical = selectCanonicalExtractionsByDocumentVersion([GAP('scan'), ocr]);
  assert.equal(canonical.get('scan').id, 'o');
  assert.equal(mergeCanonicalExtractionIntoDocument({ id: 'scan' }, canonical.get('scan'), '').extracted_text, text);
});

function fakeDb({ versions, extractions = [] }) {
  const calls = [];
  const table = rows => ({ select() { return this; }, eq() { return this; }, is() { return this; }, in() { return Promise.resolve({ data: rows, error: null }); } });
  return {
    calls,
    from(name) {
      if (name === 'psi_sales_opportunities') return { select() { return this; }, eq() { return this; }, is: () => Promise.resolve({ data: [{ id: 'o1' }], error: null }) };
      if (name === 'psi_tender_document_versions') return table(versions);
      return table(extractions);
    },
    storage: { from: () => ({ download: async () => ({ data: new Blob([Buffer.from('%PDF')]), error: null }) }) },
    rpc: async (name, args) => { calls.push({ name, args }); return { data: {}, error: null }; },
  };
}

test('un pase guarda el texto como extracción «ok» con su huella, y avisa al dueño del documento propio', async () => {
  const text = '--- página 1 ---\nPÓLIZA DE RESPONSABILIDAD CIVIL. Valor asegurado: 400 SMMLV. Vigencia hasta 01/01/2027. Tomador Seguridad Nacional.';
  const db = fakeDb({ versions: [V('scan')], extractions: [GAP('scan')] });
  const seen = [];
  const events = await runTenderDocumentOcrPass(db, { ocr: async () => ({ text, pages: 1 }), onText: async (version, value) => seen.push([version.id, value]) });
  assert.equal(events[0].status, 'ok');
  const args = db.calls[0].args;
  assert.equal(args.p_extractor_version, TENDER_DOCUMENT_OCR_EXTRACTOR_VERSION);
  assert.equal(args.p_text_hash, createHash('sha256').update(text, 'utf8').digest('hex'));
  assert.equal(args.p_char_count, [...text].length);
  assert.deepEqual(seen, [['scan', text]]);
});

test('sin texto útil queda un «gap» del OCR (no se reintenta) y una falla no corta el pase', async () => {
  const db = fakeDb({ versions: [V('blanco'), V('roto', { created_at: '2026-11-08T09:00:00Z' })], extractions: [GAP('blanco'), GAP('roto')] });
  let n = 0;
  const events = await runTenderDocumentOcrPass(db, { ocr: async () => { n += 1; if (n === 2) throw new Error('pdftoppm'); return { text: '--- página 1 ---\n  ', pages: 1 }; } });
  assert.deepEqual(events.map(e => e.event), ['tender_ocr_recorded', 'tender_ocr_failed']);
  assert.equal(db.calls[0].args.p_status, 'gap');
  assert.equal(db.calls[0].args.p_gap_reason, 'ocr_sin_texto');
});

test('va dentro del trabajo que arranca los análisis, antes de admitirlos', () => {
  const runner = readFileSync(new URL('../ops/agt002-auto-initial/run-agt002-auto-initial.mjs', import.meta.url), 'utf8');
  assert.ok(runner.indexOf('runTenderDocumentOcrPass(') < runner.indexOf('runAgt002AutoInitialAdmissions('));
  assert.ok(runner.indexOf('runTenderDocumentOcrPass(') < runner.indexOf('runAgt002ManualReanalysisRequests('));
});

let hasTesseract = true;
try { execFileSync('tesseract', ['--version'], { stdio: 'ignore' }); execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' }); } catch { hasTesseract = false; }
test('OCR real de una página escaneada (sólo donde hay tesseract)', { skip: !hasTesseract && 'sin tesseract en este equipo' }, async () => {
  // PDF mínimo con una imagen de texto no se puede armar sin dependencias; basta con que un PDF vacío no rompa.
  const blank = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n164\n%%EOF');
  const result = await ocrPdfBuffer(blank, { maxPages: 1 });
  assert.equal(result.pages, 1);
});
