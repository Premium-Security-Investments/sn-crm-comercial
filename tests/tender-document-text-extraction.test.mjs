import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import mammoth from 'mammoth';
import {
  extractTenderDocumentText,
  TENDER_DOCUMENT_TEXT_EXTRACTOR_VERSION,
  TENDER_DOCUMENT_ARCHIVE_SAFETY_POLICY,
  TENDER_DOCUMENT_MAX_EXTRACTED_TEXT_BYTES,
  TENDER_DOCUMENT_MAX_ERROR_MESSAGE_LENGTH,
  evaluateArchiveEntryCount,
  evaluateSelectedEntriesExpansion,
  sanitizeExtractionErrorMessage,
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

function docxZipFromBody(bodyXml) {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyXml}<w:sectPr/></w:body>
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

async function buildLongDocxBuffer(targetChars) {
  // mammoth only needs a minimal valid docx; build one with many paragraphs
  // via a tiny in-memory zip rather than depending on a fixture binary.
  const paragraphLine = 'Requisito tecnico ANS turno 24x7 disponibilidad total. ';
  const repeats = Math.ceil(targetChars / paragraphLine.length);
  const paragraphs = [];
  for (let i = 0; i < repeats; i += 1) {
    paragraphs.push(`<w:p><w:r><w:t xml:space="preserve">${paragraphLine}</w:t></w:r></w:p>`);
  }
  return docxZipFromBody(paragraphs.join(''));
}

function buildXlsxBuffer({ sheetNames, sharedStrings, sheetCellsXmlBySheet, sheetStates = [], relOverrides = null }) {
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
    ${sheetNames.map((name, i) => `<sheet name="${name}" sheetId="${i + 1}" ${sheetStates[i] ? `state="${sheetStates[i]}"` : ''} r:id="rSheet${i + 1}"/>`).join('\n')}
  </sheets>
</workbook>`;

  const workbookRelsXml = relOverrides !== null ? relOverrides : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
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

  // 1b) PDF pequeño (< 4 KiB) se extrae igual que uno grande.
  //     Node sirve todo Buffer de menos de 4 KiB desde su pool compartido, con
  //     byteOffset distinto de cero, y `Stream.makeSubStream` de pdf.js 1.10.100
  //     resuelve los offsets del xref contra el ArrayBuffer completo ignorando ese
  //     byteOffset. Sin anclar los bytes en offset 0, un pliego corto y válido
  //     fallaba como `extraction_error`. Los PDF reales de una o dos páginas caen
  //     justo en ese rango, así que el contrato se fija aquí y no sólo vía ZIP.
  {
    const pdfBuffer = buildLongPdfBuffer(20);
    assert.ok(pdfBuffer.length < 4096, `el fixture debe caer en el rango agrupado, obtuvo ${pdfBuffer.length} bytes`);
    const result = await extractTenderDocumentText(pdfBuffer, 'pliego-corto.pdf', 'application/pdf');
    assert.equal(result.status, 'ok');
    assert.equal(result.parser, 'pdf-parse');
    assert.ok(result.text.includes('Requisito habilitante XYZ 0123456789'), `esperado el marcador real del PDF, obtuvo ${JSON.stringify(result.text)}`);
    assert.equal(result.char_count, result.text.length);
    assert.equal(result.text_hash, sha256(result.text));
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
      { name: 'Presupuesto', hidden: false, cell_count: 5, formula_count: 1 },
      { name: 'Notas', hidden: false, cell_count: 1, formula_count: 0 },
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
    assert.ok(result.metadata.error.length <= TENDER_DOCUMENT_MAX_ERROR_MESSAGE_LENGTH, 'el mensaje de error debe estar acotado');
    assert.equal(result.metadata.error.includes('\n'), false, 'el mensaje de error debe ser una sola línea');
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

  // 9) TXT vacío/solo espacios produce gap tipado `empty_extraction`, distinto de `empty_input`.
  {
    const result = await extractTenderDocumentText(Buffer.from('   \n\t  ', 'utf8'), 'vacio.txt', 'text/plain');
    assert.equal(result.status, 'gap');
    assert.equal(result.text, '');
    assert.equal(result.metadata.gap_reason, 'empty_extraction');
  }

  // 10) XLSX con hojas pero sin celdas pobladas produce gap tipado `empty_extraction`, no éxito ficticio.
  {
    const emptyXlsxBuffer = buildXlsxBuffer({
      sheetNames: ['Vacia'],
      sharedStrings: [],
      sheetCellsXmlBySheet: [''],
    });
    const result = await extractTenderDocumentText(emptyXlsxBuffer, 'vacio.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.equal(result.status, 'gap');
    assert.equal(result.metadata.gap_reason, 'empty_extraction');
  }

  // 11) DOCX válido pero sin texto (sólo párrafo vacío) produce gap tipado `empty_extraction`.
  {
    const emptyDocxBuffer = docxZipFromBody('<w:p/>');
    const result = await extractTenderDocumentText(emptyDocxBuffer, 'vacio.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.equal(result.status, 'gap');
    assert.equal(result.metadata.gap_reason, 'empty_extraction');
  }

  // 12) Texto final extraído más allá del límite seguro de persistencia produce gap
  // tipado `extracted_text_size_exceeded`, sin truncar en silencio (text === '').
  {
    const oversizedTxt = Buffer.from('A'.repeat(TENDER_DOCUMENT_MAX_EXTRACTED_TEXT_BYTES + 1024), 'utf8');
    const result = await extractTenderDocumentText(oversizedTxt, 'condiciones-enormes.txt', 'text/plain');
    assert.equal(result.status, 'gap');
    assert.equal(result.text, '');
    assert.equal(result.char_count, 0);
    assert.equal(result.metadata.gap_reason, 'extracted_text_size_exceeded');
  }

  // 13) ZIP con más entradas que el límite de la política produce gap tipado `too_many_entries`,
  // usando la política de producción real (sin inyectar límites).
  {
    const manyEntriesZip = new AdmZip();
    const tooMany = TENDER_DOCUMENT_ARCHIVE_SAFETY_POLICY.maxEntryCount + 5;
    for (let i = 0; i < tooMany; i += 1) {
      manyEntriesZip.addFile(`formato-${i}.txt`, Buffer.from('ok', 'utf8'));
    }
    const result = await extractTenderDocumentText(manyEntriesZip.toBuffer(), 'formatos.zip', 'application/zip');
    assert.equal(result.status, 'gap');
    assert.equal(result.metadata.gap_reason, 'too_many_entries');
  }

  // 14) Evaluadores puros de seguridad de archivo (política inyectada, sin fixtures de tamaño OOM):
  // cuenta de entradas, tamaño expandido por entrada, ratio de compresión y total expandido.
  {
    assert.equal(evaluateArchiveEntryCount(5, { maxEntryCount: 10 }), null);
    assert.equal(evaluateArchiveEntryCount(11, { maxEntryCount: 10 }), 'too_many_entries');

    const tinyPolicy = { maxEntryExpandedBytes: 1000, maxTotalExpandedBytes: 1000, maxCompressionRatio: 10 };
    assert.equal(evaluateSelectedEntriesExpansion([{ declaredSize: 500, compressedSize: 400 }], tinyPolicy), null);
    assert.equal(evaluateSelectedEntriesExpansion([{ declaredSize: 2000, compressedSize: 1900 }], tinyPolicy), 'expanded_size_exceeded');
    assert.equal(evaluateSelectedEntriesExpansion([{ declaredSize: 500, compressedSize: 4 }], tinyPolicy), 'compression_ratio_exceeded');
    // Sum across several individually-safe entries exceeds the aggregate budget.
    assert.equal(evaluateSelectedEntriesExpansion([
      { declaredSize: 400, compressedSize: 390 },
      { declaredSize: 400, compressedSize: 390 },
      { declaredSize: 400, compressedSize: 390 },
    ], tinyPolicy), 'expanded_size_exceeded');

    // Real (tiny) AdmZip metadata integration: a genuinely highly-compressible
    // entry read from an actual archive, evaluated against an injected small
    // policy — proves the boundary without an OOM-scale fixture.
    const compressibleZip = new AdmZip();
    compressibleZip.addFile('entrada.txt', Buffer.from('A'.repeat(5000), 'utf8'));
    const realEntries = compressibleZip.getEntries().map(entry => ({ declaredSize: entry.header.size, compressedSize: entry.header.compressedSize }));
    assert.equal(evaluateSelectedEntriesExpansion(realEntries, { maxEntryExpandedBytes: 1e9, maxTotalExpandedBytes: 1e9, maxCompressionRatio: 5 }), 'compression_ratio_exceeded');
  }

  // 15) XML mal formado (entidad indefinida) dentro de un ZIP válido produce gap tipado,
  // usando el errorHandler correcto de xmldom 0.8, y sin ninguna salida por consola.
  {
    const malformedXlsxBuffer = buildXlsxBuffer({
      sheetNames: ['Hoja1'],
      sharedStrings: [],
      sheetCellsXmlBySheet: ['<row r="1"><c r="A1" t="inlineStr"><is><t>Valor &undefined_entity; roto</t></is></c></row>'],
    });
    const originalWarn = console.warn;
    const originalError = console.error;
    let consoleCalls = 0;
    console.warn = () => { consoleCalls += 1; };
    console.error = () => { consoleCalls += 1; };
    let result;
    try {
      result = await extractTenderDocumentText(malformedXlsxBuffer, 'roto-entidad.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } finally {
      console.warn = originalWarn;
      console.error = originalError;
    }
    assert.equal(result.status, 'gap');
    assert.equal(consoleCalls, 0, 'xmldom no debe escribir en consola con el errorHandler correcto');
  }

  // 16) Relación de hoja ausente o insegura en XLSX produce gap tipado, nunca una hoja vacía silenciosa.
  {
    const brokenRelsXlsx = buildXlsxBuffer({
      sheetNames: ['Hoja1'],
      sharedStrings: [],
      sheetCellsXmlBySheet: ['<row r="1"><c r="A1"><v>1</v></c></row>'],
      relOverrides: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rSharedStrings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`,
    });
    const result = await extractTenderDocumentText(brokenRelsXlsx, 'relacion-rota.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.equal(result.status, 'gap');
    assert.notEqual(result.status, 'ok');
  }

  {
    const traversalRelsXlsx = buildXlsxBuffer({
      sheetNames: ['Hoja1'],
      sharedStrings: [],
      sheetCellsXmlBySheet: ['<row r="1"><c r="A1"><v>1</v></c></row>'],
      relOverrides: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rSheet1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="../../../etc/passwd"/>
  <Relationship Id="rSharedStrings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`,
    });
    const result = await extractTenderDocumentText(traversalRelsXlsx, 'relacion-traversal.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.equal(result.status, 'gap');
  }

  // 17) Fidelidad OOXML: booleanos explícitos, hojas ocultas marcadas, fórmula
  // compartida en celda seguidora sin inventar expansión, y serial crudo con
  // estilo marcado explícitamente (no normalizado como fecha).
  {
    const fidelityXlsx = buildXlsxBuffer({
      sheetNames: ['Datos', 'Confidencial'],
      sharedStrings: [],
      sheetStates: [undefined, 'hidden'],
      sheetCellsXmlBySheet: [
        `<row r="1">
           <c r="A1" t="b"><v>1</v></c>
           <c r="B1" t="b"><v>0</v></c>
           <c r="C1" s="3"><v>44197</v></c>
         </row>
         <row r="2">
           <c r="A2"><f t="shared" ref="A2:A3" si="0">10*2</f><v>20</v></c>
           <c r="B2"><f t="shared" si="0"/><v>40</v></c>
         </row>`,
        `<row r="1"><c r="A1"><v>1</v></c></row>`,
      ],
    });
    const result = await extractTenderDocumentText(fidelityXlsx, 'fidelidad.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.equal(result.status, 'ok');
    assert.ok(result.text.includes('A1: VERDADERO'), 'booleano verdadero debe mostrarse como VERDADERO, no 1');
    assert.ok(result.text.includes('B1: FALSO'), 'booleano falso debe mostrarse como FALSO, no 0');
    assert.ok(result.text.includes('C1: 44197 [serial estilo s=3]'), 'serial crudo con estilo debe quedar explícito, no normalizado como fecha');
    assert.ok(result.text.includes('B2 (fórmula: fórmula compartida (si=0, valor en caché)): 40'), 'celda seguidora de fórmula compartida no debe inventar la fórmula expandida');
    assert.ok(!result.text.includes('B2 (fórmula: 10*2)'), 'no debe inventarse la expansión de la fórmula compartida para la celda seguidora');
    assert.ok(result.text.includes('--- Hoja: Confidencial (oculta) ---'), 'hoja oculta debe quedar marcada en el texto, no indistinguible');
    assert.deepEqual(
      result.metadata.sheets.find(sheet => sheet.name === 'Confidencial'),
      { name: 'Confidencial', hidden: true, cell_count: 1, formula_count: 0 },
    );
  }

  // 18) Saneamiento de mensajes de error: acotado, en una línea, sin rutas/correos/ids/secretos de query.
  {
    assert.equal(sanitizeExtractionErrorMessage(new Error('')), null);
    assert.equal(
      sanitizeExtractionErrorMessage(new Error('fallo leyendo /home/user/secretos/archivo.xlsx')),
      'fallo leyendo [ruta]',
    );
    assert.equal(
      sanitizeExtractionErrorMessage(new Error('contacto de soporte: usuario@ejemplo.com')),
      'contacto de soporte: [correo]',
    );
    assert.equal(
      sanitizeExtractionErrorMessage(new Error('registro 550e8400-e29b-41d4-a716-446655440000 inválido')),
      'registro [id] inválido',
    );
    assert.equal(
      sanitizeExtractionErrorMessage(new Error('token de acceso a563f21e9c8b4d0f7a1e2b3c4d5e6f70')),
      'token de acceso [id]',
    );
    assert.equal(
      sanitizeExtractionErrorMessage(new Error('descarga fallida en https://ejemplo.com/x?token=abcdef123456&sig=xyz')),
      'descarga fallida en https://ejemplo.com/x?token=[secreto]&sig=[secreto]',
    );
    const overlong = sanitizeExtractionErrorMessage(new Error('E'.repeat(500)));
    assert.ok(overlong.length <= TENDER_DOCUMENT_MAX_ERROR_MESSAGE_LENGTH);
    const withStack = new Error('fallo de prueba');
    const sanitizedWithStack = sanitizeExtractionErrorMessage(withStack);
    assert.equal(sanitizedWithStack, 'fallo de prueba');
    assert.equal(sanitizedWithStack.includes('.js:'), false, 'no debe filtrar rastro de pila (stack)');
    const multiline = sanitizeExtractionErrorMessage(new Error('linea uno\nlinea dos'));
    assert.equal(multiline.includes('\n'), false);
  }

  console.log('tender-document-text-extraction.test.mjs OK');
}

run();
