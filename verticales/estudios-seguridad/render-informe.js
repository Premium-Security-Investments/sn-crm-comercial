// Estudios de Seguridad Física, tramo 6 — el generador del informe al nivel del real de HADA (Juan, 2026-11-05).
//
// Desde el 2026-11-18 usa su plantilla propia (plantilla-informe.js), con el formato visual del reporte preliminar de
// SecurityOps que Juan escogió: portada azul, encabezado en banda, marca de agua, títulos centrados con su línea
// amarilla, tablas numeradas a la manera APA, fichas de dos columnas con la banda del nivel y tarjetas de cifras. La
// regla de seguridad no cambia: el documento entra como DATOS (bloques con texto, tablas e imágenes ya verificadas),
// nunca como XML; todo texto se escapa y la plantilla y el conversor son fijos.

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { ESTUDIO_CUERPO, ESTUDIO_ESTILOS, PALETA, barraAmarilla, portadaXml, studyReportSkeleton } from './plantilla-informe.js';

export const REPORT_LIMITS = Object.freeze({ blocks: 1500, text: 6000, rows: 120, columns: 10, imageBytes: 4 * 1024 * 1024 });
// Los cuatro niveles de la v1 y los tres de la guía, en tonos suaves para que el texto se lea encima.
// En el mapa de calor el color manda (no hay texto largo encima): tonos más fuertes, como en el preliminar.
export const HEATMAP_COLORS = Object.freeze({ bajo: '#9fd8b0', moderado: '#fbd773', alto: '#f5a46a', critico: '#d9474f', aceptable: '#9fd8b0', tolerable: '#fbd773', inaceptable: '#d9474f' });
export const LEVEL_COLORS = Object.freeze({ bajo: '#d6efdf', moderado: '#fde9b6', alto: '#fbd2a6', critico: '#f4b4b8', aceptable: '#d6efdf', tolerable: '#fde9b6', inaceptable: '#f4b4b8' });
// El texto de la banda de cada ficha, en el tono fuerte del mismo nivel.
const LEVEL_INK = Object.freeze({ bajo: '#166534', moderado: '#92400e', alto: '#9a3412', critico: '#991b1b', aceptable: '#166534', tolerable: '#92400e', inaceptable: '#991b1b' });
const DOCX_FILTER = 'docx:MS Word 2007 XML';

export class StudyReportError extends Error {
  constructor(message) { super(message); this.code = 'ESTUDIOS_INFORME_INVALIDO'; }
}
const fail = message => { throw new StudyReportError(message); };

const escapeXml = value => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

function text(value, label, { optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return '';
    fail(`${label} es obligatorio.`);
  }
  if (typeof value !== 'string') fail(`${label} debe ser texto.`);
  if (value.length > REPORT_LIMITS.text) fail(`${label} pasa de ${REPORT_LIMITS.text} caracteres.`);
  return value;
}

/** Texto con **negrilla**; un salto de línea es un salto de línea. Todo se escapa. */
export function inlineSpans(value, base = 'EsT') {
  const out = [];
  const plain = (chunk, style) => chunk.split('\n').forEach((part, index, parts) => {
    if (part) out.push(`<text:span text:style-name="${style}">${escapeXml(part)}</text:span>`);
    if (index < parts.length - 1) out.push('<text:line-break/>');
  });
  const pattern = /\*\*([\s\S]+?)\*\*/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(value))) {
    plain(value.slice(last, match.index), base);
    plain(match[1], `${base}Neg`);
    last = pattern.lastIndex;
  }
  plain(value.slice(last), base);
  return out.join('');
}

const paragraph = (style, value, base = 'EsT') => `<text:p text:style-name="${style}">${inlineSpans(value, base)}</text:p>`;

const textStyle = (name, props) => `<style:style style:name="${name}" style:family="text"><style:text-properties ${props}/></style:style>`;
const TEXT_STYLES = [
  ['EsT', ''], ['EsTNeg', 'fo:font-weight="bold"'],
  ['EsTCelda', 'fo:font-size="9pt"'], ['EsTCeldaNeg', 'fo:font-size="9pt" fo:font-weight="bold"'],
  ['EsTEtiqueta', `fo:font-size="9pt" fo:font-weight="bold" fo:color="${PALETA.gris}"`], ['EsTEtiquetaNeg', `fo:font-size="9pt" fo:font-weight="bold" fo:color="${PALETA.gris}"`],
  ['EsTEje', 'fo:font-size="8pt" fo:font-weight="bold" fo:color="#ffffff"'], ['EsTEjeNeg', 'fo:font-size="8pt" fo:font-weight="bold" fo:color="#ffffff"'],
  ['EsTNota', `fo:font-size="9pt" fo:color="${PALETA.gris}"`], ['EsTNotaNeg', `fo:font-size="9pt" fo:font-style="italic" fo:color="${PALETA.gris}"`],
  ['EsTTarjetaEtiqueta', `fo:font-size="7.5pt" fo:font-weight="bold" fo:color="${PALETA.gris}" fo:letter-spacing="0.01in"`], ['EsTTarjetaEtiquetaNeg', `fo:font-size="7.5pt" fo:font-weight="bold" fo:color="${PALETA.gris}"`],
  ['EsTTarjetaValor', `fo:font-size="15pt" fo:font-weight="bold" fo:color="${PALETA.azul}"`], ['EsTTarjetaValorNeg', `fo:font-size="15pt" fo:font-weight="bold" fo:color="${PALETA.azul}"`],
  ['EsTTarjetaDetalle', `fo:font-size="7.5pt" fo:color="${PALETA.gris}"`], ['EsTTarjetaDetalleNeg', `fo:font-size="7.5pt" fo:font-weight="bold" fo:color="${PALETA.gris}"`],
  ...Object.entries(LEVEL_INK).flatMap(([level, ink]) => [[`EsTBanda_${level}`, `fo:font-size="10pt" fo:font-weight="bold" fo:color="${ink}"`], [`EsTBanda_${level}Neg`, `fo:font-size="10pt" fo:font-weight="bold" fo:color="${ink}"`]]),
  ['EsTBanda', `fo:font-size="10pt" fo:font-weight="bold" fo:color="${PALETA.azul}"`], ['EsTBandaNeg', `fo:font-size="10pt" fo:font-weight="bold" fo:color="${PALETA.azul}"`],
].map(([name, props]) => textStyle(name, props)).join('');

const cellStyle = (name, props) => `<style:style style:name="${name}" style:family="table-cell"><style:table-cell-properties ${props}/></style:style>`;
const rule = (width, color) => `${width} solid ${color}`;
const CELL_STYLES = [
  // Tablas a la manera APA: sin líneas verticales; raya fuerte arriba y abajo, fina entre filas.
  ['EsCeldaEncabezado', `fo:padding="0.05in" fo:border-top="${rule('1.2pt', PALETA.azul)}" fo:border-bottom="${rule('0.75pt', PALETA.azul)}" fo:border-left="none" fo:border-right="none"`],
  ['EsCelda', `fo:padding="0.05in" fo:border-top="none" fo:border-bottom="${rule('0.5pt', PALETA.linea)}" fo:border-left="none" fo:border-right="none"`],
  ['EsCeldaUltima', `fo:padding="0.05in" fo:border-top="none" fo:border-bottom="${rule('1.2pt', PALETA.azul)}" fo:border-left="none" fo:border-right="none"`],
  ['EsCeldaEje', `fo:padding="0.04in" fo:border="${rule('0.75pt', '#ffffff')}" fo:background-color="${PALETA.azul}" style:vertical-align="middle"`],
  ['EsCeldaBanda', `fo:padding="0.06in" fo:border-top="none" fo:border-left="none" fo:border-right="none" fo:border-bottom="none" fo:background-color="#e8edf5"`],
  ['EsCeldaTarjeta', `fo:padding="0.09in" fo:border="${rule('0.75pt', PALETA.linea)}"`],
  ['EsCeldaHueco', 'fo:padding="0in" fo:border="none"'],
  ...Object.entries(LEVEL_COLORS).flatMap(([level, color]) => [
    [`EsCelda_${level}`, `fo:padding="0.04in" fo:border="${rule('0.75pt', '#ffffff')}" fo:background-color="${color}" style:vertical-align="middle"`],
    [`EsCeldaBanda_${level}`, `fo:padding="0.06in" fo:border="none" fo:background-color="${color}"`],
    [`EsCeldaMapa_${level}`, `fo:padding="0.05in" fo:border="${rule('0.75pt', '#ffffff')}" fo:background-color="${HEATMAP_COLORS[level]}" style:vertical-align="middle"`],
  ]),
].map(([name, props]) => cellStyle(name, props)).join('');

const paraStyle = (name, paragraphProps, textProps = '') => `<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties ${paragraphProps}/>${textProps ? `<style:text-properties ${textProps}/>` : ''}</style:style>`;
const PARAGRAPH_STYLES = [
  ['EsTitulo1', 'fo:margin-top="0.22in" fo:margin-bottom="0.05in" fo:text-align="center" fo:keep-with-next="always"', `fo:font-size="15pt" fo:font-weight="bold" fo:color="${PALETA.azul}"`],
  ['EsTitulo2', 'fo:margin-top="0.16in" fo:margin-bottom="0.06in" fo:keep-with-next="always"', `fo:font-size="11.5pt" fo:font-weight="bold" fo:color="${PALETA.azul}"`],
  ['EsCuerpo', 'fo:margin-top="0in" fo:margin-bottom="0.08in" fo:line-height="130%" fo:text-align="justify"'],
  ['EsLista', 'fo:margin-left="0.28in" fo:margin-top="0in" fo:margin-bottom="0.05in" fo:text-indent="-0.18in" fo:line-height="125%" fo:text-align="justify"'],
  ['EsFirma', 'fo:margin-top="0in" fo:margin-bottom="0.06in" fo:text-align="start" fo:keep-with-next="always"'],
  ['EsCentro', 'fo:margin-top="0.04in" fo:margin-bottom="0.08in" fo:text-align="center"'],
  ['EsPie', 'fo:margin-top="0.02in" fo:margin-bottom="0.12in" fo:text-align="center"', `fo:font-size="8.5pt" fo:font-style="italic" fo:color="${PALETA.gris}"`],
  ['EsNota', 'fo:margin-top="0.02in" fo:margin-bottom="0.12in" fo:text-align="justify"', `fo:font-size="9pt" fo:color="${PALETA.gris}"`],
  ['EsTablaNumero', 'fo:margin-top="0.12in" fo:margin-bottom="0in" fo:keep-with-next="always"', 'fo:font-size="10pt" fo:font-weight="bold"'],
  ['EsTablaTitulo', 'fo:margin-top="0.02in" fo:margin-bottom="0.05in" fo:keep-with-next="always"', 'fo:font-size="10pt" fo:font-style="italic"'],
  ['EsSalto', 'fo:break-before="page" fo:margin-top="0in" fo:margin-bottom="0in"', 'fo:font-size="2pt"'],
  ['EsCeldaTexto', 'fo:margin-top="0in" fo:margin-bottom="0in" fo:line-height="115%"'],
  ['EsCeldaCentro', 'fo:margin-top="0in" fo:margin-bottom="0in" fo:text-align="center"'],
  ['EsTarjetaTexto', 'fo:margin-top="0in" fo:margin-bottom="0.02in"'],
  ['EsPortadaIndiceTitulo', 'fo:margin-left="1in" fo:margin-right="1in" fo:margin-top="0.35in" fo:margin-bottom="0.1in" fo:padding-top="0.12in" fo:border-top="0.75pt solid #d1d5db"', `fo:font-size="12pt" fo:font-weight="bold" fo:color="${PALETA.azul}"`],
  ['EsPortadaIndice', 'fo:margin-left="1in" fo:margin-right="1in" fo:margin-top="0in" fo:margin-bottom="0.05in"', 'fo:font-size="10pt" fo:color="#374151"'],
  ['EsIndice', 'fo:margin-left="0.9in" fo:margin-top="0in" fo:margin-bottom="0.07in" fo:padding-bottom="0.04in" fo:border-bottom="0.5pt dotted #d1d5db"', 'fo:font-size="10.5pt" fo:font-weight="bold"'],
].map(([name, props, textProps]) => paraStyle(name, props, textProps)).join('');

const STYLES = `${PARAGRAPH_STYLES}${TEXT_STYLES}${CELL_STYLES}
  <style:style style:name="EsTabla" style:family="table"><style:table-properties style:width="6.7in" table:align="margins" fo:margin-top="0.02in" fo:margin-bottom="0.06in"/></style:style>
  <style:style style:name="EsMapa" style:family="table"><style:table-properties style:width="5.6in" table:align="center" fo:margin-top="0.04in" fo:margin-bottom="0.04in"/></style:style>
  <style:style style:name="EsTarjetas" style:family="table"><style:table-properties style:width="6.7in" table:align="margins" fo:margin-top="0.06in" fo:margin-bottom="0.12in"/></style:style>
  <style:style style:name="EsColEje" style:family="table-column"><style:table-column-properties style:column-width="1.25in"/></style:style>
  <style:style style:name="EsColMapa" style:family="table-column"><style:table-column-properties style:column-width="0.87in"/></style:style>
  <style:style style:name="EsColTarjeta" style:family="table-column"><style:table-column-properties style:column-width="2.1in"/></style:style>
  <style:style style:name="EsColHueco" style:family="table-column"><style:table-column-properties style:column-width="0.2in"/></style:style>
  <style:style style:name="EsFila" style:family="table-row"><style:table-row-properties fo:keep-together="always"/></style:style>
  <style:style style:name="EsImagen" style:family="graphic" style:parent-style-name="Graphics">
   <style:graphic-properties style:vertical-pos="top" style:vertical-rel="baseline" fo:border="none" fo:padding="0in"/>
  </style:style>`;

const CELL_STYLE = new Set(['EsCelda', 'EsCeldaUltima', 'EsCeldaEncabezado', 'EsCeldaEje', ...Object.keys(LEVEL_COLORS).flatMap(level => [`EsCelda_${level}`, `EsCeldaMapa_${level}`])]);

// Una celda es texto, o { text, level?, bold?, axis?, center? }.
function cell(value, { header, last, label, map }, where) {
  const spec = value !== null && typeof value === 'object' ? value : { text: value };
  const style = spec.axis ? 'EsCeldaEje' : spec.level ? `${map ? 'EsCeldaMapa' : 'EsCelda'}_${spec.level}` : header ? 'EsCeldaEncabezado' : last ? 'EsCeldaUltima' : 'EsCelda';
  if (!CELL_STYLE.has(style)) fail(`${where}: nivel de color inválido.`);
  const base = spec.axis ? 'EsTEje' : spec.bold || header ? 'EsTCeldaNeg' : label ? 'EsTEtiqueta' : 'EsTCelda';
  const content = text(String(spec.text ?? ''), where, { optional: true });
  // Un salto de línea en la celda es otro párrafo (el corbatín pone un control por renglón).
  const paragraphs = content.split('\n').map(line => paragraph(spec.center || spec.axis || spec.level ? 'EsCeldaCentro' : 'EsCeldaTexto', line, base)).join('');
  return `<table:table-cell table:style-name="${style}" office:value-type="string">${paragraphs}</table:table-cell>`;
}

// La numeración de las tablas con título (Tabla 1, Tabla 2…) es del documento, no de quien arma los bloques.
function table(entry, index, counter) {
  const header = Array.isArray(entry.header) ? entry.header : [];
  const rows = Array.isArray(entry.rows) ? entry.rows : [];
  const columns = header.length || rows[0]?.length || 0;
  if (!columns || columns > REPORT_LIMITS.columns || rows.length > REPORT_LIMITS.rows) fail(`bloque ${index}: tabla vacía o demasiado grande.`);
  const widths = Array.isArray(entry.widths) && entry.widths.length === columns && entry.widths.every(w => Number(w) > 0) ? entry.widths.map(Number) : null;
  const total = widths ? widths.reduce((a, b) => a + b, 0) : 0;
  const ficha = Boolean(entry.ficha);
  const row = (values, isHeader, at) => {
    if (!Array.isArray(values) || values.length !== columns) fail(`bloque ${index} fila ${at}: no tiene ${columns} columnas.`);
    const last = !isHeader && at === rows.length - 1;
    return `<table:table-row table:style-name="EsFila">${values.map((value, column) => cell(value, { header: isHeader, last, label: ficha && column === 0, map: Boolean(entry.compact) }, `bloque ${index} celda ${at}.${column}`)).join('')}</table:table-row>`;
  };
  // La banda de la ficha: el nombre del riesgo sobre el color de su nivel, a todo el ancho.
  let band = '';
  if (entry.band) {
    const bandText = text(entry.band.text, `bloque ${index}.band`);
    const level = entry.band.level && LEVEL_COLORS[entry.band.level] ? entry.band.level : null;
    if (entry.band.level && !level) fail(`bloque ${index}: nivel de color inválido.`);
    band = `<table:table-row table:style-name="EsFila"><table:table-cell table:style-name="${level ? `EsCeldaBanda_${level}` : 'EsCeldaBanda'}" table:number-columns-spanned="${columns}" office:value-type="string">${paragraph('EsCeldaTexto', bandText, level ? `EsTBanda_${level}` : 'EsTBanda')}</table:table-cell>${'<table:covered-table-cell/>'.repeat(columns - 1)}</table:table-row>`;
  }
  const columnsXml = entry.compact
    ? `<table:table-column table:style-name="EsColEje"/><table:table-column table:style-name="EsColMapa" table:number-columns-repeated="${columns - 1}"/>`
    : widths ? widths.map((width, at) => `<table:table-column table:style-name="EsCol${index}_${at}"/>`).join('') : `<table:table-column table:number-columns-repeated="${columns}"/>`;
  const columnStyles = widths ? widths.map((width, at) => `<style:style style:name="EsCol${index}_${at}" style:family="table-column"><style:table-column-properties style:column-width="${(width / total * 6.7).toFixed(3)}in"/></style:style>`).join('') : '';
  let caption = '';
  if (entry.title) {
    counter.tablas += 1;
    caption = paragraph('EsTablaNumero', `Tabla ${counter.tablas}`) + paragraph('EsTablaTitulo', text(entry.title, `bloque ${index}.title`));
  }
  const note = entry.note ? paragraph('EsNota', `Nota. ${text(entry.note, `bloque ${index}.note`)}`, 'EsTNota') : '';
  return {
    styles: columnStyles,
    xml: caption + `<table:table table:name="Tabla${index + 1}" table:style-name="${entry.compact ? 'EsMapa' : 'EsTabla'}">${columnsXml}`
      + band
      + (header.length ? `<table:table-header-rows>${row(header, true, 'encabezado')}</table:table-header-rows>` : '')
      + rows.map((values, at) => row(values, false, at)).join('')
      + '</table:table>' + note,
  };
}

// Tarjetas de cifras: [{ label, value, detail }], hasta tres por fila.
function cards(entry, index) {
  const items = Array.isArray(entry.items) ? entry.items : [];
  if (!items.length || items.length > 3) fail(`bloque ${index}: las tarjetas van de una a tres.`);
  const card = (item, at) => `<table:table-cell table:style-name="EsCeldaTarjeta" office:value-type="string">`
    + paragraph('EsTarjetaTexto', text(String(item.label ?? ''), `bloque ${index}.${at}.label`).toUpperCase(), 'EsTTarjetaEtiqueta')
    + paragraph('EsTarjetaTexto', text(String(item.value ?? ''), `bloque ${index}.${at}.value`), 'EsTTarjetaValor')
    + (item.detail ? paragraph('EsTarjetaTexto', text(String(item.detail), `bloque ${index}.${at}.detail`), 'EsTTarjetaDetalle') : '')
    + '</table:table-cell>';
  const gap = '<table:table-cell table:style-name="EsCeldaHueco" office:value-type="string"><text:p text:style-name="EsCeldaTexto"/></table:table-cell>';
  const cols = items.map((_, at) => `${at ? '<table:table-column table:style-name="EsColHueco"/>' : ''}<table:table-column table:style-name="EsColTarjeta"/>`).join('');
  return `<table:table table:name="Tarjetas${index + 1}" table:style-name="EsTarjetas">${cols}<table:table-row table:style-name="EsFila">${items.map((item, at) => (at ? gap : '') + card(item, at)).join('')}</table:table-row></table:table>`;
}

// Una imagen ya verificada por el servidor: { kind: 'image', base64, mime, width, height (px), maxWidthIn, maxHeightIn, caption }.
function image(entry, index) {
  if (!['image/jpeg', 'image/png'].includes(entry.mime)) fail(`bloque ${index}: la imagen debe ser JPG o PNG.`);
  if (typeof entry.base64 !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(entry.base64)) fail(`bloque ${index}: imagen inválida.`);
  if (entry.base64.length * 0.75 > REPORT_LIMITS.imageBytes) fail(`bloque ${index}: imagen demasiado grande.`);
  const width = Number(entry.width);
  const height = Number(entry.height);
  if (!(width > 0 && height > 0)) fail(`bloque ${index}: imagen sin tamaño.`);
  const maxWidth = Math.min(Number(entry.maxWidthIn) || 6.2, 6.7);
  const maxHeight = Math.min(Number(entry.maxHeightIn) || 4.2, 8.5);
  const scale = Math.min(maxWidth / width, maxHeight / height);
  const w = (width * scale).toFixed(3);
  const h = (height * scale).toFixed(3);
  const frame = `<text:p text:style-name="EsCentro"><draw:frame draw:style-name="EsImagen" draw:name="Imagen${index + 1}" text:anchor-type="as-char" svg:width="${w}in" svg:height="${h}in" draw:z-index="1"><draw:image draw:mime-type="${entry.mime}"><office:binary-data>${entry.base64}</office:binary-data></draw:image></draw:frame></text:p>`;
  const caption = text(entry.caption, `bloque ${index}.caption`, { optional: true });
  return frame + (caption ? paragraph('EsPie', caption, 'EsT') : '');
}

// La portada: { kind: 'cover', title, subtitle, norm, rows: [[etiqueta, valor]] }. Sólo puede ser el primer bloque.
function cover(entry, index) {
  if (index !== 0) fail('La portada debe ser el primer bloque.');
  const rows = Array.isArray(entry.rows) ? entry.rows.slice(0, 12) : [];
  return portadaXml({
    titulo: escapeXml(text(entry.title, 'portada.title')),
    subtitulo: escapeXml(text(entry.subtitle, 'portada.subtitle', { optional: true })),
    norma: escapeXml(text(entry.norm, 'portada.norm', { optional: true })),
    filas: rows.map((row, at) => {
      if (!Array.isArray(row) || row.length !== 2) fail(`portada fila ${at}: debe tener etiqueta y valor.`);
      return [escapeXml(text(String(row[0]), `portada ${at}`)), escapeXml(text(String(row[1] ?? '—'), `portada ${at}`, { optional: true }) || '—')];
    }),
  }) + (entry.logo ? image({ ...entry.logo, caption: '' }, index) : '')
    + (Array.isArray(entry.contents) && entry.contents.length ? paragraph('EsPortadaIndiceTitulo', 'Contenido') + entry.contents.slice(0, 30).map((item, at) => paragraph('EsPortadaIndice', text(item, `portada.contents.${at}`))).join('') : '')
    + '<text:p text:style-name="EsInicioCuerpo"/>';
}

function block(entry, index, counter) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(`bloque ${index} no es válido.`);
  switch (entry.kind) {
    case 'cover': return { xml: cover(entry, index) };
    case 'h1': return { xml: paragraph('EsTitulo1', text(entry.text, `bloque ${index}`), 'EsT') + barraAmarilla() };
    case 'h2': return { xml: paragraph('EsTitulo2', text(entry.text, `bloque ${index}`), 'EsT') };
    case 'paragraph': return { xml: paragraph('EsCuerpo', text(entry.text, `bloque ${index}`)) };
    case 'note': return { xml: paragraph('EsNota', `Nota. ${text(entry.text, `bloque ${index}`)}`, 'EsTNota') };
    case 'signature': return { xml: paragraph('EsFirma', text(entry.text, `bloque ${index}`)) };
    case 'center': return { xml: paragraph(entry.caption ? 'EsPie' : 'EsCentro', text(entry.text, `bloque ${index}`), entry.bold ? 'EsTNeg' : 'EsT') };
    case 'list':
      if (!Array.isArray(entry.items) || !entry.items.length || entry.items.length > REPORT_LIMITS.rows) fail(`bloque ${index}: lista inválida.`);
      return { xml: entry.items.map((item, at) => paragraph(entry.plain ? 'EsIndice' : 'EsLista', `${entry.plain ? '' : `${entry.numbered ? `${at + 1}.` : '•'}  `}${text(item, `bloque ${index}.${at}`)}`)).join('') };
    case 'table': return table(entry, index, counter);
    case 'cards': return { xml: cards(entry, index) };
    case 'image': return { xml: image(entry, index) };
    case 'page_break': return { xml: '<text:p text:style-name="EsSalto"/>' };
    case 'spacer': return { xml: '<text:p text:style-name="EsCuerpo"/>' };
    default: return fail(`bloque ${index}: tipo "${entry.kind}" no admitido.`);
  }
}

/** Valida el informe y lo arma sobre la plantilla del estudio. Puro: no toca disco ni red. */
export function buildStudyReportFodt(skeleton, report) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.blocks)) fail('El informe no es válido.');
  if (!skeleton.includes(ESTUDIO_CUERPO) || !skeleton.includes(ESTUDIO_ESTILOS)) fail('La plantilla no trae los puntos de inserción.');
  if (!report.blocks.length || report.blocks.length > REPORT_LIMITS.blocks) fail('El informe no tiene contenido o tiene demasiados bloques.');
  const counter = { tablas: 0 };
  const parts = report.blocks.map((entry, index) => block(entry, index, counter));
  return skeleton.replace(ESTUDIO_ESTILOS, STYLES + parts.map(part => part.styles || '').join(''))
    .replace(ESTUDIO_CUERPO, parts.map(part => part.xml).join('\n'));
}

/** El esqueleto para este informe: la banda de las páginas interiores lleva su título. */
export const skeletonFor = report => studyReportSkeleton({ encabezado: typeof report?.header === 'string' ? report.header.slice(0, 120) : 'Estudio de seguridad' });

/** Arma el .docx con LibreOffice, con un perfil propio por conversión. Argumentos fijos; sólo cambia el contenido. */
export async function renderStudyReportDocx(report, {
  soffice = '/usr/bin/soffice', timeoutMs = 180_000, run = promisify(execFile),
} = {}) {
  const fodt = buildStudyReportFodt(skeletonFor(report), report);
  const dir = await mkdtemp(path.join(tmpdir(), 'estudios-informe-'));
  try {
    const source = path.join(dir, 'informe.fodt');
    await writeFile(source, fodt, 'utf8');
    await run(soffice, [`-env:UserInstallation=file://${path.join(dir, 'perfil')}`, '--headless', '--norestore', '--convert-to', DOCX_FILTER, '--outdir', dir, source], { timeout: timeoutMs, maxBuffer: 1024 * 1024 });
    const bytes = await readFile(path.join(dir, 'informe.docx')).catch(() => null);
    if (!bytes || bytes.length < 1000 || bytes.subarray(0, 2).toString('latin1') !== 'PK') throw new StudyReportError('LibreOffice no produjo el Word.');
    return bytes;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Ancho y alto en píxeles de un PNG o JPG, leídos de su cabecera. null si no se reconoce. */
export function imageSize(bytes) {
  const b = bytes;
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let at = 2;
    while (at + 9 < b.length) {
      if (b[at] !== 0xff) { at += 1; continue; }
      const marker = b[at + 1];
      const length = b.readUInt16BE(at + 2);
      // SOF0..SOF15 salvo DHT (C4), JPG (C8) y DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: b.readUInt16BE(at + 5), width: b.readUInt16BE(at + 7) };
      }
      at += 2 + length;
    }
  }
  return null;
}
