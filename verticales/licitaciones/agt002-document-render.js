// AGT-002 — la herramienta que convierte un borrador en Word (mejora 5, Juan 2026-11-03: "que Vig-IA produzca los
// documentos, pedidos desde la Mesa").
//
// Es a propósito una herramienta estrecha. Vig-IA lee pliegos que escriben terceros, así que no se le da acceso al
// servidor ni a la sesión de Microsoft: se le da esto y nada más. Recibe un documento como DATOS —título,
// destinatario, párrafos, listas, tablas, firma— y devuelve un .docx con el membrete de la empresa. No acepta XML,
// rutas, comandos ni nombres de plantilla: todo texto se escapa, la única plantilla es la corporativa y el conversor
// es fijo. Lo peor que puede salir de un pliego malicioso es un borrador con un texto raro.
//
// Marcas que entiende en el texto, y sólo esas:
//   [[...]]  lo que requiere decisión o falta diligenciar: sale en amarillo (estilo "Resalte" de la plantilla).
//   **...**  negrilla.
//
// Cómo se arma: la plantilla corporativa (PLANTILLA_MEMBRETE_SEGURIDAD_NACIONAL_V1_20261030.docx de la biblioteca
// corporativa) se guardó como ODF plano con el cuerpo vacío; aquí se llena el cuerpo y `soffice --headless` la
// convierte a Word. Así el encabezado y el pie son los reales, no una imitación.

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const AGT002_DOCUMENT_TEMPLATE_PATH = fileURLToPath(new URL('./plantillas/membrete-seguridad-nacional.fodt', import.meta.url));
export const AGT002_DOCUMENT_LIMITS = Object.freeze({ blocks: 200, text: 4000, items: 60, rows: 80, columns: 8, lines: 8 });
const DOCX_FILTER = 'docx:MS Word 2007 XML';

export class Agt002DocumentError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = message => { throw new Agt002DocumentError('AGT002_DOCUMENT_INVALID', message); };

const escapeXml = value => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // Caracteres de control que XML 1.0 no admite.
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

function text(value, label, { optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return null;
    fail(`${label} es obligatorio.`);
  }
  if (typeof value !== 'string') fail(`${label} debe ser texto.`);
  if (value.length > AGT002_DOCUMENT_LIMITS.text) fail(`${label} pasa de ${AGT002_DOCUMENT_LIMITS.text} caracteres.`);
  return value;
}

function lines(value, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > AGT002_DOCUMENT_LIMITS.lines) fail(`${label} debe ser una lista corta de líneas.`);
  return value.map((line, index) => text(line, `${label}[${index}]`));
}

/** Texto con marcas → spans de la plantilla: T5 normal, T6 resaltado (decisión), T7 negrilla. */
export function agt002InlineSpans(value, base = 'T5') {
  const out = [];
  const pattern = /\[\[([\s\S]+?)\]\]|\*\*([\s\S]+?)\*\*/g;
  let last = 0;
  let match;
  const plain = chunk => {
    // Un salto de línea dentro de un párrafo es un salto de línea, no un párrafo nuevo.
    const parts = chunk.split('\n');
    parts.forEach((part, index) => {
      if (part) out.push(`<text:span text:style-name="${base}">${escapeXml(part)}</text:span>`);
      if (index < parts.length - 1) out.push('<text:line-break/>');
    });
  };
  while ((match = pattern.exec(value))) {
    plain(value.slice(last, match.index));
    if (match[1] !== undefined) out.push(`<text:span text:style-name="T6">${escapeXml(match[1])}</text:span>`);
    // Negrilla que encierra algo por decidir ("**[[nombre]]**"): lo por decidir manda, porque es lo que hay que ver.
    else out.push(agt002InlineSpans(match[2], 'T7'));
    last = pattern.lastIndex;
  }
  plain(value.slice(last));
  return out.join('');
}

const paragraph = (style, value, base) => `<text:p text:style-name="${style}">${agt002InlineSpans(value, base)}</text:p>`;
const blank = '<text:p text:style-name="P10"/>';

// Estilos que la plantilla no trae: listas y tablas con borde, para anexos con cuadros.
const EXTRA_STYLES = `
  <style:style style:name="AgtLista" style:family="paragraph" style:parent-style-name="Standard">
   <style:paragraph-properties fo:margin-left="0.25in" fo:margin-top="0in" fo:margin-bottom="0.04in" fo:text-indent="-0.18in" fo:text-align="justify"/>
  </style:style>
  <style:style style:name="AgtSubtitulo" style:family="paragraph" style:parent-style-name="Standard">
   <style:paragraph-properties fo:margin-top="0.12in" fo:margin-bottom="0.06in" fo:keep-with-next="always"/>
  </style:style>
  <style:style style:name="AgtFirma" style:family="paragraph" style:parent-style-name="Standard">
   <style:paragraph-properties fo:margin-top="0in" fo:margin-bottom="0in" fo:keep-with-next="always"/>
  </style:style>
  <style:style style:name="AgtCuerpoFin" style:family="paragraph" style:parent-style-name="Standard">
   <style:paragraph-properties fo:margin-top="0in" fo:margin-bottom="0.0866in" fo:line-height="115%" fo:text-align="justify" fo:keep-with-next="always"/>
  </style:style>
  <style:style style:name="AgtFirmaFin" style:family="paragraph" style:parent-style-name="Standard">
   <style:paragraph-properties fo:margin-top="0in" fo:margin-bottom="0in"/>
  </style:style>
  <style:style style:name="AgtCelda" style:family="paragraph" style:parent-style-name="Standard">
   <style:paragraph-properties fo:margin-top="0in" fo:margin-bottom="0in"/>
  </style:style>
  <style:style style:name="AgtTabla" style:family="table">
   <style:table-properties style:width="6.7in" table:align="margins" fo:margin-top="0.04in" fo:margin-bottom="0.1in"/>
  </style:style>
  <style:style style:name="AgtTablaCelda" style:family="table-cell">
   <style:table-cell-properties fo:padding="0.04in" fo:border="0.5pt solid #7f8fa6"/>
  </style:style>
  <style:style style:name="AgtTablaEncabezado" style:family="table-cell">
   <style:table-cell-properties fo:padding="0.04in" fo:border="0.5pt solid #7f8fa6" fo:background-color="#e8eef7"/>
  </style:style>
  <style:style style:name="TCelda" style:family="text"><style:text-properties fo:font-size="9.5pt" style:font-size-asian="9.5pt"/></style:style>`;

function block(entry, index) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(`blocks[${index}] no es válido.`);
  if (entry.kind === 'paragraph') return paragraph('P11', text(entry.text, `blocks[${index}].text`));
  if (entry.kind === 'heading') return paragraph('AgtSubtitulo', text(entry.text, `blocks[${index}].text`), 'T7');
  if (entry.kind === 'list') {
    if (!Array.isArray(entry.items) || !entry.items.length || entry.items.length > AGT002_DOCUMENT_LIMITS.items) fail(`blocks[${index}].items no es válido.`);
    return entry.items.map((item, at) => paragraph('AgtLista', `•  ${text(item, `blocks[${index}].items[${at}]`)}`)).join('');
  }
  if (entry.kind === 'table') {
    const header = Array.isArray(entry.header) ? entry.header : [];
    const rows = Array.isArray(entry.rows) ? entry.rows : [];
    const columns = header.length || rows[0]?.length || 0;
    if (!columns || columns > AGT002_DOCUMENT_LIMITS.columns || rows.length > AGT002_DOCUMENT_LIMITS.rows) fail(`blocks[${index}] es una tabla vacía o demasiado grande.`);
    const cell = (value, style, at) => `<table:table-cell table:style-name="${style}" office:value-type="string">${paragraph('AgtCelda', text(String(value ?? ''), `blocks[${index}] celda ${at}`, { optional: true }) || '', 'TCelda')}</table:table-cell>`;
    const row = (values, style, at) => {
      if (!Array.isArray(values) || values.length !== columns) fail(`blocks[${index}] fila ${at} no tiene ${columns} columnas.`);
      return `<table:table-row>${values.map((value, column) => cell(value, style, `${at}.${column}`)).join('')}</table:table-row>`;
    };
    return `<table:table table:name="Tabla${index + 1}" table:style-name="AgtTabla"><table:table-column table:number-columns-repeated="${columns}"/>`
      + (header.length ? `<table:table-header-rows>${row(header, 'AgtTablaEncabezado', 'encabezado')}</table:table-header-rows>` : '')
      + rows.map((values, at) => row(values, 'AgtTablaCelda', at)).join('')
      + '</table:table>';
  }
  return fail(`blocks[${index}].kind debe ser paragraph, heading, list o table.`);
}

/** Valida el documento y arma el ODF plano sobre la plantilla corporativa. Puro: no toca disco ni red. */
export function buildAgt002DocumentFodt(skeleton, document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) fail('El documento no es válido.');
  if (!skeleton.includes('<!--AGT002_CUERPO-->') || !skeleton.includes('<!--AGT002_ESTILOS-->')) {
    throw new Agt002DocumentError('AGT002_DOCUMENT_TEMPLATE_INVALID', 'La plantilla no trae los puntos de inserción.');
  }
  const blocks = Array.isArray(document.blocks) ? document.blocks : fail('blocks debe ser una lista.');
  if (!blocks.length || blocks.length > AGT002_DOCUMENT_LIMITS.blocks) fail('El documento no tiene contenido o tiene demasiados bloques.');
  const parts = [paragraph('P6', text(document.title, 'title'), 'T4')];
  const cityDate = text(document.city_date, 'city_date', { optional: true });
  if (cityDate) parts.push(paragraph('P9', cityDate), blank);
  const recipient = lines(document.recipient, 'recipient');
  if (recipient.length) parts.push(paragraph('P9', recipient.join('\n')), blank);
  const subject = text(document.subject, 'subject', { optional: true });
  if (subject) parts.push(`<text:p text:style-name="P9"><text:span text:style-name="T7">Asunto:</text:span><text:span text:style-name="T5"> </text:span>${agt002InlineSpans(subject)}</text:p>`, blank);
  parts.push(...blocks.map(block));
  const closing = text(document.closing, 'closing', { optional: true });
  const signature = lines(document.signature, 'signature');
  // El cierre y la firma van juntos: cada línea queda pegada a la siguiente, así que si no caben, pasan los dos a la
  // página nueva y la firma nunca queda sola (la carta de Supersalud del 2026-11-04 dejó la firma sola en la página 2).
  // El último párrafo del cuerpo también se pega al cierre, para que la página nueva no empiece con "Atentamente".
  const tail = [];
  if (closing) tail.push(['AgtFirma', closing, 'T5'], ['AgtFirma', '', 'T5'], ['AgtFirma', '', 'T5']);
  if (signature.length) {
    tail.push(['AgtFirma', '______________________________________', 'T5']);
    signature.forEach((line, index) => tail.push(['AgtFirma', line, index === 0 ? 'T7' : 'T5']));
  }
  if (tail.length) {
    tail[tail.length - 1][0] = 'AgtFirmaFin';
    const last = parts.length - 1;
    if (last > 0 && parts[last].startsWith('<text:p text:style-name="P11"')) parts[last] = parts[last].replace('<text:p text:style-name="P11"', '<text:p text:style-name="AgtCuerpoFin"');
    parts.push('<text:p text:style-name="AgtFirma"/>');
    for (const [style, value, base] of tail) parts.push(value ? paragraph(style, value, base) : `<text:p text:style-name="${style}"/>`);
  }
  return skeleton
    .replace('<!--AGT002_ESTILOS-->', EXTRA_STYLES)
    .replace('<!--AGT002_CUERPO-->', parts.join('\n'));
}

/** Nombre de archivo seguro: sin rutas, sin caracteres raros, siempre .docx. */
export function agt002DocumentFileName(value) {
  const base = String(value || 'Borrador').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\.docx$/i, '').replace(/[^A-Za-z0-9._ -]+/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^[._-]+/, '').slice(0, 120);
  return `${base || 'Borrador'}.docx`;
}

/**
 * Arma el .docx. El conversor y sus argumentos son fijos; lo único variable es el contenido, que ya pasó por
 * `buildAgt002DocumentFodt`. Cada conversión usa un perfil de LibreOffice propio en un directorio temporal que se
 * borra al terminar, para que dos pedidos simultáneos no se pisen.
 */
export async function renderAgt002Docx(document, {
  templatePath = AGT002_DOCUMENT_TEMPLATE_PATH, soffice = '/usr/bin/soffice', timeoutMs = 90_000, run = promisify(execFile),
} = {}) {
  const fodt = buildAgt002DocumentFodt(await readFile(templatePath, 'utf8'), document);
  const dir = await mkdtemp(path.join(tmpdir(), 'agt002-doc-'));
  try {
    const source = path.join(dir, 'borrador.fodt');
    await writeFile(source, fodt, 'utf8');
    await run(soffice, [`-env:UserInstallation=file://${path.join(dir, 'perfil')}`, '--headless', '--norestore', '--convert-to', DOCX_FILTER, '--outdir', dir, source], { timeout: timeoutMs, maxBuffer: 1024 * 1024 });
    const bytes = await readFile(path.join(dir, 'borrador.docx')).catch(() => null);
    if (!bytes || bytes.length < 1000 || bytes.subarray(0, 2).toString('latin1') !== 'PK') {
      throw new Agt002DocumentError('AGT002_DOCUMENT_CONVERSION_FAILED', 'LibreOffice no produjo el Word.');
    }
    return bytes;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
