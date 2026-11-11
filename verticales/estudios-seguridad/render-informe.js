// Estudios de Seguridad Física, tramo 6 — el generador del informe al nivel del real de HADA (Juan, 2026-11-05).
//
// Usa la MISMA plantilla con membrete y el mismo tratamiento del texto que la herramienta de Licitaciones
// (verticales/licitaciones/agt002-document-render.js), pero sin tocarla: aquel generador es de AGT-002 y no acepta
// imágenes. Este agrega lo que el informe del cliente necesita —portada, saltos de página, fotos y mapas embebidos,
// celdas de color para los mapas de calor— con la misma regla de seguridad: el documento entra como DATOS (bloques
// con texto, tablas e imágenes ya verificadas), nunca como XML; todo texto se escapa y la plantilla y el conversor
// son fijos.

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { AGT002_DOCUMENT_TEMPLATE_PATH, agt002InlineSpans } from '../licitaciones/agt002-document-render.js';

export const REPORT_LIMITS = Object.freeze({ blocks: 1500, text: 6000, rows: 120, columns: 10, imageBytes: 4 * 1024 * 1024 });
// Los cuatro niveles de la v1 y los tres de la guía (aceptable verde, tolerable amarillo, inaceptable rojo).
export const LEVEL_COLORS = Object.freeze({ bajo: '#8fd16a', moderado: '#ffe066', alto: '#f6a644', critico: '#e5534b', aceptable: '#8fd16a', tolerable: '#ffe066', inaceptable: '#e5534b' });
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

const paragraph = (style, value, base = 'T5') => `<text:p text:style-name="${style}">${agt002InlineSpans(value, base)}</text:p>`;

// Estilos propios del informe. Se insertan en el punto de estilos de la plantilla, igual que los de AGT-002.
const LEVEL_CELL_STYLES = Object.entries(LEVEL_COLORS).map(([level, color]) => `
  <style:style style:name="EsCelda_${level}" style:family="table-cell">
   <style:table-cell-properties fo:padding="0.03in" fo:border="0.5pt solid #5f6b7a" fo:background-color="${color}" style:vertical-align="middle"/>
  </style:style>`).join('');
const STYLES = `
  <style:style style:name="EsLista" style:family="paragraph" style:parent-style-name="Standard">
   <style:paragraph-properties fo:margin-left="0.25in" fo:margin-top="0in" fo:margin-bottom="0.04in" fo:text-indent="-0.18in" fo:text-align="justify"/>
  </style:style>
  <style:style style:name="EsTitulo1" style:family="paragraph" style:parent-style-name="Standard">
   <style:paragraph-properties fo:margin-top="0.18in" fo:margin-bottom="0.08in" fo:keep-with-next="always"/>
   <style:text-properties fo:font-size="13pt" fo:font-weight="bold" fo:color="#1f3864"/>
  </style:style>
  <style:style style:name="EsTitulo2" style:family="paragraph" style:parent-style-name="Standard">
   <style:paragraph-properties fo:margin-top="0.12in" fo:margin-bottom="0.06in" fo:keep-with-next="always"/>
   <style:text-properties fo:font-weight="bold"/>
  </style:style>
  <style:style style:name="EsCuerpo" style:family="paragraph" style:parent-style-name="Standard">
   <style:paragraph-properties fo:margin-top="0in" fo:margin-bottom="0.08in" fo:line-height="115%" fo:text-align="justify"/>
  </style:style>
  <style:style style:name="EsFirma" style:family="paragraph" style:parent-style-name="Standard">
   <style:paragraph-properties fo:margin-top="0in" fo:margin-bottom="0.06in" fo:text-align="start" fo:keep-with-next="always"/>
  </style:style>
  <style:style style:name="EsCentro" style:family="paragraph" style:parent-style-name="Standard">
   <style:paragraph-properties fo:margin-top="0.04in" fo:margin-bottom="0.04in" fo:text-align="center"/>
  </style:style>
  <style:style style:name="EsPie" style:family="paragraph" style:parent-style-name="Standard">
   <style:paragraph-properties fo:margin-top="0in" fo:margin-bottom="0.1in" fo:text-align="center"/>
   <style:text-properties fo:font-size="8.5pt" fo:font-style="italic" fo:color="#4b5563"/>
  </style:style>
  <style:style style:name="EsSalto" style:family="paragraph" style:parent-style-name="Standard">
   <style:paragraph-properties fo:break-before="page" fo:margin-top="0in" fo:margin-bottom="0in"/>
  </style:style>
  <style:style style:name="EsPortadaTitulo" style:family="paragraph" style:parent-style-name="Standard">
   <style:paragraph-properties fo:margin-top="0.3in" fo:margin-bottom="0.1in" fo:text-align="center"/>
   <style:text-properties fo:font-size="20pt" fo:font-weight="bold" fo:color="#1f3864"/>
  </style:style>
  <style:style style:name="EsPortadaTexto" style:family="paragraph" style:parent-style-name="Standard">
   <style:paragraph-properties fo:margin-top="0.06in" fo:margin-bottom="0.06in" fo:text-align="center"/>
   <style:text-properties fo:font-size="12pt"/>
  </style:style>
  <style:style style:name="EsCeldaTexto" style:family="paragraph" style:parent-style-name="Standard">
   <style:paragraph-properties fo:margin-top="0in" fo:margin-bottom="0in"/>
  </style:style>
  <style:style style:name="EsCeldaCentro" style:family="paragraph" style:parent-style-name="Standard">
   <style:paragraph-properties fo:margin-top="0in" fo:margin-bottom="0in" fo:text-align="center"/>
  </style:style>
  <style:style style:name="EsTabla" style:family="table">
   <style:table-properties style:width="6.7in" table:align="margins" fo:margin-top="0.04in" fo:margin-bottom="0.1in"/>
  </style:style>
  <style:style style:name="EsMapa" style:family="table">
   <style:table-properties style:width="5.5in" table:align="center" fo:margin-top="0.04in" fo:margin-bottom="0.06in"/>
  </style:style>
  <style:style style:name="EsColEje" style:family="table-column"><style:table-column-properties style:column-width="1.25in"/></style:style>
  <style:style style:name="EsColMapa" style:family="table-column"><style:table-column-properties style:column-width="0.85in"/></style:style>
  <style:style style:name="EsCelda" style:family="table-cell">
   <style:table-cell-properties fo:padding="0.04in" fo:border="0.5pt solid #7f8fa6"/>
  </style:style>
  <style:style style:name="EsCeldaEncabezado" style:family="table-cell">
   <style:table-cell-properties fo:padding="0.04in" fo:border="0.5pt solid #7f8fa6" fo:background-color="#dbe5f3"/>
  </style:style>
  <style:style style:name="EsCeldaEje" style:family="table-cell">
   <style:table-cell-properties fo:padding="0.03in" fo:border="0.5pt solid #5f6b7a" fo:background-color="#6b7a90" style:vertical-align="middle"/>
  </style:style>${LEVEL_CELL_STYLES}
  <style:style style:name="EsImagen" style:family="graphic" style:parent-style-name="Graphics">
   <style:graphic-properties style:vertical-pos="top" style:vertical-rel="baseline" fo:border="none" fo:padding="0in"/>
  </style:style>
  <style:style style:name="EsTxtCelda" style:family="text"><style:text-properties fo:font-size="9pt" style:font-size-asian="9pt"/></style:style>
  <style:style style:name="EsTxtCeldaNegrilla" style:family="text"><style:text-properties fo:font-size="9pt" fo:font-weight="bold"/></style:style>
  <style:style style:name="EsTxtEje" style:family="text"><style:text-properties fo:font-size="8pt" fo:font-weight="bold" fo:color="#ffffff"/></style:style>`;

const CELL_STYLE = new Set(['EsCelda', 'EsCeldaEncabezado', 'EsCeldaEje', ...Object.keys(LEVEL_COLORS).map(level => `EsCelda_${level}`)]);

// Una celda es texto, o { text, level?, bold?, axis?, center? }.
function cell(value, header, where) {
  const spec = value !== null && typeof value === 'object' ? value : { text: value };
  const style = spec.axis ? 'EsCeldaEje' : spec.level ? `EsCelda_${spec.level}` : header ? 'EsCeldaEncabezado' : 'EsCelda';
  if (!CELL_STYLE.has(style)) fail(`${where}: nivel de color inválido.`);
  const textStyle = spec.axis ? 'EsTxtEje' : spec.bold || header ? 'EsTxtCeldaNegrilla' : 'EsTxtCelda';
  const content = text(String(spec.text ?? ''), where, { optional: true });
  return `<table:table-cell table:style-name="${style}" office:value-type="string">${paragraph(spec.center || spec.axis || spec.level ? 'EsCeldaCentro' : 'EsCeldaTexto', content, textStyle)}</table:table-cell>`;
}

function table(entry, index) {
  const header = Array.isArray(entry.header) ? entry.header : [];
  const rows = Array.isArray(entry.rows) ? entry.rows : [];
  const columns = header.length || rows[0]?.length || 0;
  if (!columns || columns > REPORT_LIMITS.columns || rows.length > REPORT_LIMITS.rows) fail(`bloque ${index}: tabla vacía o demasiado grande.`);
  const row = (values, isHeader, at) => {
    if (!Array.isArray(values) || values.length !== columns) fail(`bloque ${index} fila ${at}: no tiene ${columns} columnas.`);
    return `<table:table-row>${values.map((value, column) => cell(value, isHeader, `bloque ${index} celda ${at}.${column}`)).join('')}</table:table-row>`;
  };
  // El mapa de calor lleva columnas iguales (eje + cinco niveles de impacto); las demás tablas se reparten solas.
  const columnsXml = entry.compact
    ? `<table:table-column table:style-name="EsColEje"/><table:table-column table:style-name="EsColMapa" table:number-columns-repeated="${columns - 1}"/>`
    : `<table:table-column table:number-columns-repeated="${columns}"/>`;
  return `<table:table table:name="Tabla${index + 1}" table:style-name="${entry.compact ? 'EsMapa' : 'EsTabla'}">${columnsXml}`
    + (header.length ? `<table:table-header-rows>${row(header, true, 'encabezado')}</table:table-header-rows>` : '')
    + rows.map((values, at) => row(values, false, at)).join('')
    + '</table:table>';
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
  return frame + (caption ? paragraph('EsPie', caption, 'T5') : '');
}

function block(entry, index) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(`bloque ${index} no es válido.`);
  switch (entry.kind) {
    case 'h1': return paragraph('EsTitulo1', text(entry.text, `bloque ${index}`), 'T7');
    case 'h2': return paragraph('EsTitulo2', text(entry.text, `bloque ${index}`), 'T7');
    case 'paragraph': return paragraph('EsCuerpo', text(entry.text, `bloque ${index}`));
    case 'signature': return paragraph('EsFirma', text(entry.text, `bloque ${index}`));
    case 'center': return paragraph(entry.large ? 'EsPortadaTitulo' : entry.cover ? 'EsPortadaTexto' : 'EsCentro', text(entry.text, `bloque ${index}`), entry.bold ? 'T7' : 'T5');
    case 'list':
      if (!Array.isArray(entry.items) || !entry.items.length || entry.items.length > REPORT_LIMITS.rows) fail(`bloque ${index}: lista inválida.`);
      return entry.items.map((item, at) => paragraph('EsLista', `•  ${text(item, `bloque ${index}.${at}`)}`)).join('');
    case 'table': return table(entry, index);
    case 'image': return image(entry, index);
    case 'page_break': return '<text:p text:style-name="EsSalto"/>';
    case 'spacer': return '<text:p text:style-name="EsCuerpo"/>';
    default: return fail(`bloque ${index}: tipo "${entry.kind}" no admitido.`);
  }
}

/** Valida el informe y lo arma sobre la plantilla corporativa. Puro: no toca disco ni red. */
export function buildStudyReportFodt(skeleton, report) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.blocks)) fail('El informe no es válido.');
  if (!skeleton.includes('<!--AGT002_CUERPO-->') || !skeleton.includes('<!--AGT002_ESTILOS-->')) fail('La plantilla no trae los puntos de inserción.');
  if (!report.blocks.length || report.blocks.length > REPORT_LIMITS.blocks) fail('El informe no tiene contenido o tiene demasiados bloques.');
  return skeleton.replace('<!--AGT002_ESTILOS-->', STYLES).replace('<!--AGT002_CUERPO-->', report.blocks.map(block).join('\n'));
}

/** Arma el .docx con LibreOffice, con un perfil propio por conversión. Argumentos fijos; sólo cambia el contenido. */
export async function renderStudyReportDocx(report, {
  templatePath = AGT002_DOCUMENT_TEMPLATE_PATH, soffice = '/usr/bin/soffice', timeoutMs = 180_000, run = promisify(execFile),
} = {}) {
  const fodt = buildStudyReportFodt(await readFile(templatePath, 'utf8'), report);
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
