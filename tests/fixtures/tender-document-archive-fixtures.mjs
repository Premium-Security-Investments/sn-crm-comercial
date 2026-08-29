// Fixtures deterministas de paquetes ZIP oficiales para el contrato de extraccion
// por entrada (tender-document-text-extraction.js).
//
// Todo se construye en memoria con las MISMAS dependencias de produccion
// (adm-zip) y sin binarios versionados, de modo que el texto extraido y los
// hashes por entrada sean reproducibles byte a byte en cualquier maquina.
// Ninguna de estas funciones usa reloj ni aleatoriedad.

import AdmZip from 'adm-zip';

// --- Contenidos fuente (ASCII puro: pdf-parse con Helvetica/Type1 no garantiza
// acentos, y queremos aserciones exactas sobre el texto extraido). -----------

export const ARCHIVE_TXT_CONTENT = 'CONDICIONES GENERALES TXT\nEl proponente debera acreditar experiencia.';
export const ARCHIVE_CSV_CONTENT = 'riesgo,probabilidad\nMATRIZ CSV,alta';
export const ARCHIVE_PDF_MARKER = 'MARCADOR PLIEGO PDF 0123456789';
export const ARCHIVE_DOCX_MARKER = 'CLAUSULA TECNICA DOCX turno 24x7.';
export const ARCHIVE_XLSX_SHEET_NAME = 'Formato';
export const ARCHIVE_XLSX_CELL_VALUE = 'VALOR XLSX';

// --- Constructores de documentos internos -----------------------------------

/** PDF minimo valido, con una linea de texto por cada entrada de `lines`. */
export function buildPdfBuffer(lines) {
  const streamLines = lines.map((line, i) => `BT /F1 10 Tf 10 ${750 - (i % 700)} Td (${line}) Tj ET`);
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

/** DOCX OOXML minimo valido con un parrafo por cada entrada de `paragraphs`. */
export function buildDocxBuffer(paragraphs) {
  const bodyXml = paragraphs
    .map(text => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`)
    .join('');
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

/** XLSX OOXML minimo valido con una hoja y celdas inlineStr. */
export function buildXlsxBuffer({ sheetName, cellsXml }) {
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${sheetName}" sheetId="1" r:id="rSheet1"/>
  </sheets>
</workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rSheet1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rSharedStrings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;

  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="0" uniqueCount="0"></sst>`;

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${cellsXml}
  </sheetData>
</worksheet>`;

  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(contentTypesXml, 'utf8'));
  zip.addFile('_rels/.rels', Buffer.from(rootRelsXml, 'utf8'));
  zip.addFile('xl/workbook.xml', Buffer.from(workbookXml, 'utf8'));
  zip.addFile('xl/_rels/workbook.xml.rels', Buffer.from(workbookRelsXml, 'utf8'));
  zip.addFile('xl/sharedStrings.xml', Buffer.from(sharedStringsXml, 'utf8'));
  zip.addFile('xl/worksheets/sheet1.xml', Buffer.from(sheetXml, 'utf8'));
  return zip.toBuffer();
}

// --- Entradas internas reutilizables ----------------------------------------

export const ARCHIVE_ENTRY_BUFFERS = Object.freeze({
  'condiciones.txt': Buffer.from(ARCHIVE_TXT_CONTENT, 'utf8'),
  'matriz.csv': Buffer.from(ARCHIVE_CSV_CONTENT, 'utf8'),
  'pliego.pdf': buildPdfBuffer([`${ARCHIVE_PDF_MARKER} `]),
  'anexo-tecnico.docx': buildDocxBuffer([ARCHIVE_DOCX_MARKER]),
  'formato-financiero.xlsx': buildXlsxBuffer({
    sheetName: ARCHIVE_XLSX_SHEET_NAME,
    cellsXml: `<row r="1"><c r="A1" t="inlineStr"><is><t>${ARCHIVE_XLSX_CELL_VALUE}</t></is></c></row>`,
  }),
});

/** Nombres de las entradas soportadas, en el orden ascendente esperado en la salida. */
export const SUPPORTED_ARCHIVE_ENTRY_NAMES = Object.freeze([
  'anexo-tecnico.docx',
  'condiciones.txt',
  'formato-financiero.xlsx',
  'matriz.csv',
  'pliego.pdf',
]);

// --- Paquetes ZIP oficiales --------------------------------------------------

/**
 * ZIP con SOLO entradas internas soportadas (TXT/CSV/PDF/DOCX/XLSX).
 * Se agregan en orden desordenado a proposito, para que el orden de salida
 * pruebe una ordenacion deterministica y no el orden del archivo.
 */
export function buildSupportedEntriesArchive() {
  const zip = new AdmZip();
  zip.addFile('pliego.pdf', ARCHIVE_ENTRY_BUFFERS['pliego.pdf']);
  zip.addFile('matriz.csv', ARCHIVE_ENTRY_BUFFERS['matriz.csv']);
  zip.addFile('condiciones.txt', ARCHIVE_ENTRY_BUFFERS['condiciones.txt']);
  zip.addFile('formato-financiero.xlsx', ARCHIVE_ENTRY_BUFFERS['formato-financiero.xlsx']);
  zip.addFile('anexo-tecnico.docx', ARCHIVE_ENTRY_BUFFERS['anexo-tecnico.docx']);
  return zip.toBuffer();
}

/**
 * MISMO contenido logico que buildSupportedEntriesArchive(), reempaquetado: las
 * entradas se escriben en otro orden y el paquete lleva un comentario de archivo.
 * Ambas cosas son metadata mutable del envoltorio ZIP, no contenido documental,
 * asi que los bytes del paquete cambian mientras cada entrada interna sigue
 * siendo byte a byte la misma. Es el caso real de una entidad que regenera su
 * paquete de formatos sin tocar un solo documento.
 */
export function buildRepackagedSupportedEntriesArchive() {
  const zip = new AdmZip();
  zip.addFile('anexo-tecnico.docx', ARCHIVE_ENTRY_BUFFERS['anexo-tecnico.docx']);
  zip.addFile('formato-financiero.xlsx', ARCHIVE_ENTRY_BUFFERS['formato-financiero.xlsx']);
  zip.addFile('condiciones.txt', ARCHIVE_ENTRY_BUFFERS['condiciones.txt']);
  zip.addFile('pliego.pdf', ARCHIVE_ENTRY_BUFFERS['pliego.pdf']);
  zip.addFile('matriz.csv', ARCHIVE_ENTRY_BUFFERS['matriz.csv']);
  zip.addZipComment('Paquete regenerado por la entidad el 2026-08-28.');
  return zip.toBuffer();
}

/**
 * Mismas entradas que buildSupportedEntriesArchive() salvo `condiciones.txt`,
 * cuyo TEXTO cambia de verdad: es una adenda real dentro del paquete.
 */
export const ARCHIVE_TXT_AMENDED_CONTENT = 'CONDICIONES GENERALES TXT\nEl proponente debera acreditar experiencia y poliza de cumplimiento.';

export function buildAmendedSupportedEntriesArchive() {
  const zip = new AdmZip();
  zip.addFile('pliego.pdf', ARCHIVE_ENTRY_BUFFERS['pliego.pdf']);
  zip.addFile('matriz.csv', ARCHIVE_ENTRY_BUFFERS['matriz.csv']);
  zip.addFile('condiciones.txt', Buffer.from(ARCHIVE_TXT_AMENDED_CONTENT, 'utf8'));
  zip.addFile('formato-financiero.xlsx', ARCHIVE_ENTRY_BUFFERS['formato-financiero.xlsx']);
  zip.addFile('anexo-tecnico.docx', ARCHIVE_ENTRY_BUFFERS['anexo-tecnico.docx']);
  return zip.toBuffer();
}

/** ZIP interno (para probar el rechazo de archivos anidados sin recursion). */
export function buildNestedInnerArchive() {
  const zip = new AdmZip();
  zip.addFile('interno.txt', Buffer.from('CONTENIDO ANIDADO', 'utf8'));
  return zip.toBuffer();
}

/**
 * ZIP mixto: las 5 entradas soportadas + una corrupta + una no soportada +
 * dos archivos anidados (.zip y .rar).
 */
export function buildMixedEntriesArchive() {
  const zip = new AdmZip();
  zip.addFile('pliego.pdf', ARCHIVE_ENTRY_BUFFERS['pliego.pdf']);
  zip.addFile('matriz.csv', ARCHIVE_ENTRY_BUFFERS['matriz.csv']);
  zip.addFile('condiciones.txt', ARCHIVE_ENTRY_BUFFERS['condiciones.txt']);
  zip.addFile('formato-financiero.xlsx', ARCHIVE_ENTRY_BUFFERS['formato-financiero.xlsx']);
  zip.addFile('anexo-tecnico.docx', ARCHIVE_ENTRY_BUFFERS['anexo-tecnico.docx']);
  zip.addFile('corrupto.pdf', Buffer.from('%PDF-1.4 esto no es un PDF valido', 'utf8'));
  zip.addFile('plano.png', Buffer.from('\x89PNG\r\n\x1a\n no-es-texto', 'binary'));
  zip.addFile('paquete-anidado.zip', buildNestedInnerArchive());
  zip.addFile('respaldo.rar', Buffer.from('Rar!\x1a\x07\x00 contenido', 'binary'));
  return zip.toBuffer();
}

export const MIXED_ARCHIVE_ENTRY_NAMES = Object.freeze([
  'anexo-tecnico.docx',
  'condiciones.txt',
  'corrupto.pdf',
  'formato-financiero.xlsx',
  'matriz.csv',
  'paquete-anidado.zip',
  'plano.png',
  'pliego.pdf',
  'respaldo.rar',
]);

/**
 * Sustituye, in situ, un nombre de entrada por otro EXACTAMENTE de la misma
 * longitud en bytes (cabecera local + directorio central). Al conservar la
 * longitud no se mueve ningun offset del ZIP, asi que adm-zip sigue leyendo el
 * paquete y ve el nombre malicioso tal cual. Es la unica forma fiable de crear
 * una entrada zip-slip sin depender de que el escritor no sanee el nombre.
 */
export function replaceEqualLengthEntryName(buffer, from, to) {
  const fromBytes = Buffer.from(from, 'utf8');
  const toBytes = Buffer.from(to, 'utf8');
  if (fromBytes.length !== toBytes.length) {
    throw new Error(`replaceEqualLengthEntryName requiere nombres de igual longitud: "${from}" (${fromBytes.length}) vs "${to}" (${toBytes.length}).`);
  }
  const copy = Buffer.from(buffer);
  let index = copy.indexOf(fromBytes);
  let replacements = 0;
  while (index !== -1) {
    toBytes.copy(copy, index);
    replacements += 1;
    index = copy.indexOf(fromBytes, index + toBytes.length);
  }
  if (replacements < 2) {
    throw new Error(`replaceEqualLengthEntryName esperaba al menos 2 apariciones de "${from}" (cabecera local + directorio central), encontro ${replacements}.`);
  }
  return copy;
}

/** ZIP con una entrada cuyo nombre escapa del directorio del paquete (`../`). */
export function buildTraversalEntryArchive() {
  const zip = new AdmZip();
  // 'aa/evil.txt' y '../evil.txt' miden ambos 11 bytes.
  zip.addFile('aa/evil.txt', Buffer.from('carga util', 'utf8'));
  zip.addFile('lectura.txt', Buffer.from('contenido legitimo', 'utf8'));
  return replaceEqualLengthEntryName(zip.toBuffer(), 'aa/evil.txt', '../evil.txt');
}

/** ZIP con una entrada de ruta absoluta. */
export function buildAbsolutePathEntryArchive() {
  const zip = new AdmZip();
  // 'ab/passwd.txt' y '/etc/pass.txt' miden ambos 13 bytes.
  zip.addFile('ab/passwd.txt', Buffer.from('carga util', 'utf8'));
  zip.addFile('lectura.txt', Buffer.from('contenido legitimo', 'utf8'));
  return replaceEqualLengthEntryName(zip.toBuffer(), 'ab/passwd.txt', '/etc/pass.txt');
}

/**
 * ZIP cuya entrada NO textual (extension .pdf) declara una expansion por encima
 * de TENDER_DOCUMENT_ARCHIVE_SAFETY_POLICY.maxEntryExpandedBytes (25 MiB).
 * Hoy la preflight solo cubre las entradas que casan con el patron de texto, asi
 * que esta bomba pasa sin control.
 */
export function buildExpansionBombArchive() {
  const zip = new AdmZip();
  zip.addFile('anexo-enorme.pdf', Buffer.alloc(26 * 1024 * 1024, 0x41));
  zip.addFile('lectura.txt', Buffer.from('ok', 'utf8'));
  return zip.toBuffer();
}
