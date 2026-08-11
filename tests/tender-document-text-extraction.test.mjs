import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import mammoth from 'mammoth';
import {
  extractTenderDocumentText,
  TENDER_DOCUMENT_TEXT_EXTRACTOR_VERSION,
} from '../tender-document-text-extraction.js';

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function buildLongPdfBuffer(targetChars) {
  // A PDF with one content stream repeating a marker line until the visible
  // text exceeds targetChars once parsed. pdf-parse extracts text runs from
  // the Tj/TJ operators, so we emit enough of them.
  const line = 'Requisito habilitante XYZ 0123456789 ';
  const repeats = Math.ceil(targetChars / line.length);
  const streamLines = [];
  for (let i = 0; i < repeats; i += 1) {
    streamLines.push(`BT /F1 10 Tf 10 ${750 - (i % 700)} Td (${line}) Tj ET`);
  }
  const content = streamLines.join('\n');
  const objects = [];
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  objects.push('3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n');
  objects.push(`4 0 obj\n<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream\nendobj\n`);
  objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }
  const xrefStart = Buffer.byteLength(pdf, 'utf8');
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += xref;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

async function buildLongDocxBuffer(targetChars) {
  // mammoth only needs a minimal valid docx; build one with many paragraphs
  // via a tiny in-memory zip rather than depending on a fixture binary.
  const paragraphLine = 'Requisito tecnico ANS turno 24x7 disponibilidad total. ';
  const repeats = Math.ceil(targetChars / paragraphLine.length);
  const paragraphs = [];
  for (let i = 0; i < repeats; i += 1) {
    paragraphs.push(`<w:p><w:r><w:t xml:space="preserve">${paragraphLine}</w:t></w:r></w:p>`);
  }
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${paragraphs.join('')}<w:sectPr/></w:body>
</w:document>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(contentTypesXml, 'utf8'));
  zip.addFile('_rels/.rels', Buffer.from(rootRelsXml, 'utf8'));
  zip.addFile('word/document.xml', Buffer.from(documentXml, 'utf8'));
  return zip.toBuffer();
}

function buildXlsxBuffer({ sheetNames, sharedStrings, sheetCellsXmlBySheet }) {
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  ${sheetNames.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${sheetNames.map((name, i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="rSheet${i + 1}"/>`).join('\n')}
  </sheets>
</workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheetNames.map((_, i) => `<Relationship Id="rSheet${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
  <Relationship Id="rSharedStrings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;

  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">
  ${sharedStrings.map(text => `<si><t>${text}</t></si>`).join('\n')}
</sst>`;

  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(contentTypesXml, 'utf8'));
  zip.addFile('_rels/.rels', Buffer.from(rootRelsXml, 'utf8'));
  zip.addFile('xl/workbook.xml', Buffer.from(workbookXml, 'utf8'));
  zip.addFile('xl/_rels/workbook.xml.rels', Buffer.from(workbookRelsXml, 'utf8'));
  zip.addFile('xl/sharedStrings.xml', Buffer.from(sharedStringsXml, 'utf8'));
  sheetNames.forEach((_, i) => {
    const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${sheetCellsXmlBySheet[i]}
  </sheetData>
</worksheet>`;
    zip.addFile(`xl/worksheets/sheet${i + 1}.xml`, Buffer.from(sheetXml, 'utf8'));
  });
  return zip.toBuffer();
}

async function run() {
  // 1) PDF de más de 90.000 caracteres no se trunca.
  {
    const pdfBuffer = buildLongPdfBuffer(95000);
    const result = await extractTenderDocumentText(pdfBuffer, 'pliego-largo.pdf', 'application/pdf');
    assert.equal(result.status, 'ok');
    assert.equal(result.parser, 'pdf-parse');
    assert.ok(result.text.length > 90000, `esperado más de 90000 caracteres, obtuvo ${result.text.length}`);
    assert.equal(result.char_count, result.text.length);
    assert.equal(result.text_hash, sha256(result.text));
    assert.equal(result.extractor_version, TENDER_DOCUMENT_TEXT_EXTRACTOR_VERSION);
  }

  // 2) DOCX de más de 90.000 caracteres no se trunca.
  {
    const docxBuffer = await buildLongDocxBuffer(95000);
    const result = await extractTenderDocumentText(docxBuffer, 'anexo-tecnico-largo.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.equal(result.status, 'ok');
    assert.equal(result.parser, 'mammoth-docx');
    assert.ok(result.text.length > 90000, `esperado más de 90000 caracteres, obtuvo ${result.text.length}`);
    assert.equal(result.text_hash, sha256(result.text));
    // Cross-check against mammoth directly so the test does not just assert our own slicing.
    const direct = await mammoth.extractRawText({ buffer: docxBuffer });
    assert.equal(result.text, direct.value);
  }

  // 3) TXT de más de 90.000 caracteres no se trunca.
  {
    const txtBuffer = Buffer.from('X'.repeat(95000), 'utf8');
    const result = await extractTenderDocumentText(txtBuffer, 'condiciones-largas.txt', 'text/plain');
    assert.equal(result.status, 'ok');
    assert.equal(result.parser, 'plain-text');
    assert.equal(result.text.length, 95000);
    assert.equal(result.char_count, 95000);
    assert.equal(result.text_hash, sha256(result.text));
  }

  // 4) XLSX preserva hojas, celdas pobladas, valores y fórmulas de forma determinista.
  {
    const xlsxBuffer = buildXlsxBuffer({
      sheetNames: ['Presupuesto', 'Notas'],
      sharedStrings: ['Producto', 'Precio unitario', 'Widget de seguridad'],
      sheetCellsXmlBySheet: [
        `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
         <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1500</v></c><c r="C2"><f>B2*1.19</f><v>1785</v></c></row>`,
        `<row r="1"><c r="A1" t="inlineStr"><is><t>Nota interna</t></is></c></row>`,
      ],
    });
    const result = await extractTenderDocumentText(xlsxBuffer, 'presupuesto.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.equal(result.status, 'ok');
    assert.equal(result.parser, 'xlsx-ooxml');
    assert.deepEqual(result.metadata.sheets, [
      { name: 'Presupuesto', cell_count: 5, formula_count: 1 },
      { name: 'Notas', cell_count: 1, formula_count: 0 },
    ]);
    assert.ok(result.text.includes('--- Hoja: Presupuesto ---'));
    assert.ok(result.text.includes('A1: Producto'));
    assert.ok(result.text.includes('B1: Precio unitario'));
    assert.ok(result.text.includes('A2: Widget de seguridad'));
    assert.ok(result.text.includes('B2: 1500'));
    assert.ok(result.text.includes('C2 (fórmula: B2*1.19): 1785'));
    assert.ok(result.text.includes('--- Hoja: Notas ---'));
    assert.ok(result.text.includes('A1: Nota interna'));
    assert.equal(result.text_hash, sha256(result.text));
    // Determinism: parsing the same bytes twice yields byte-identical text/hash.
    const rerun = await extractTenderDocumentText(xlsxBuffer, 'presupuesto.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.equal(rerun.text, result.text);
    assert.equal(rerun.text_hash, result.text_hash);
  }

  // 5) Archivo de tipo no soportado produce un gap tipado, nunca texto de éxito ficticio.
  {
    const result = await extractTenderDocumentText(Buffer.from('binary-ish content', 'utf8'), 'imagen.png', 'image/png');
    assert.equal(result.status, 'gap');
    assert.equal(result.text, '');
    assert.equal(result.char_count, 0);
    assert.equal(result.metadata.gap_reason, 'unsupported_type');
    assert.equal(result.text_hash, sha256(''));
  }

  // 6) Archivo ilegible/corrupto produce un gap tipado con el error capturado, no una excepción sin manejar.
  {
    const corruptPdf = Buffer.from('%PDF-1.4 esto no es un PDF valido', 'utf8');
    const result = await extractTenderDocumentText(corruptPdf, 'roto.pdf', 'application/pdf');
    assert.equal(result.status, 'gap');
    assert.equal(result.text, '');
    assert.equal(result.metadata.gap_reason, 'extraction_error');
    assert.ok(result.metadata.error, 'debe incluir el mensaje de error capturado');
  }

  // 7) XLSX corrupto (zip inválido) produce gap tipado, no una excepción sin manejar.
  {
    const result = await extractTenderDocumentText(Buffer.from('no-zip-bytes'), 'roto.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.equal(result.status, 'gap');
    assert.equal(result.metadata.gap_reason, 'extraction_error');
  }

  // 8) Entrada vacía produce gap tipado sin invocar ningún parser.
  {
    const result = await extractTenderDocumentText(Buffer.alloc(0), 'vacio.pdf', 'application/pdf');
    assert.equal(result.status, 'gap');
    assert.equal(result.metadata.gap_reason, 'empty_input');
  }

  console.log('tender-document-text-extraction.test.mjs OK');
}

run();
