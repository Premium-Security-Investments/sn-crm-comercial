// Estudios de Seguridad Física — la plantilla propia del informe (Juan, 2026-11-18): se ve como el reporte preliminar
// que genera SecurityOps (portada azul con franja amarilla, encabezado en banda, marca de agua de los 50 años, títulos
// centrados con su línea amarilla, tablas numeradas), pero la estructura técnica es la del SIIO. Ya no usa el membrete
// de Licitaciones: eran dos documentos distintos y aquel puede cambiar sin avisar.
//
// Igual que antes, el documento entra como DATOS: este módulo sólo arma el esqueleto (estilos, páginas maestras,
// imágenes fijas del repositorio) y deja dos puntos de inserción; render-informe.js pone el cuerpo ya escapado.
import { readFileSync } from 'node:fs';

const asset = name => readFileSync(new URL(`./plantillas/${name}`, import.meta.url)).toString('base64');
const ASSETS = Object.freeze({
  logo: asset('logo-blanco.png'),
  sello: asset('sello-50.png'),
  marca: asset('marca-agua.png'),
  barra: asset('barra-amarilla.png'),
});

export const PALETA = Object.freeze({ azul: '#0e2140', amarillo: '#facc15', texto: '#1f2937', gris: '#6b7280', linea: '#d1d5db' });
export const ESTUDIO_ESTILOS = '<!--ES_ESTILOS-->';
export const ESTUDIO_CUERPO = '<!--ES_CUERPO-->';

const escapeXml = value => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

const image = (name, mime, base64, w, h, anchor = 'as-char') => `<draw:frame draw:style-name="EsGrafico" draw:name="${name}" text:anchor-type="${anchor}" svg:width="${w}in" svg:height="${h}in" draw:z-index="2"><draw:image draw:mime-type="${mime}"><office:binary-data>${base64}</office:binary-data></draw:image></draw:frame>`;

/** La barra amarilla bajo cada título, como imagen en línea: no depende de bordes que Word dibuja distinto. */
export const barraAmarilla = () => `<text:p text:style-name="EsBarra">${image('Barra', 'image/png', ASSETS.barra, 0.55, 0.035)}</text:p>`;

// La marca de agua de los 50 años: una figura anclada a la página, detrás del texto (como la pone Word).
const marcaAgua = () => `<draw:frame draw:style-name="EsMarcaFrame" draw:name="MarcaAgua" text:anchor-type="paragraph" svg:x="1.6in" svg:y="3.1in" svg:width="5.3in" svg:height="6.18in" draw:z-index="0"><draw:image draw:mime-type="image/png"><office:binary-data>${ASSETS.marca}</office:binary-data></draw:image></draw:frame>`;

/** La portada: banda azul con logo, sello, título y nombre del puesto. `filas`: [[etiqueta, valor]] ya escapadas. */
export function portadaXml({ titulo, subtitulo, norma, filas }) {
  const fila = ([etiqueta, valor]) => `<table:table-row><table:table-cell table:style-name="EsPortadaFichaCelda" office:value-type="string"><text:p text:style-name="EsPortadaEtiqueta">${etiqueta}</text:p></table:table-cell><table:table-cell table:style-name="EsPortadaFichaCelda" office:value-type="string"><text:p text:style-name="EsPortadaValor">${valor}</text:p></table:table-cell></table:table-row>`;
  return `<text:p text:style-name="EsPortadaLogo"><draw:rect draw:style-name="EsBandaRect" draw:name="BandaPortada" text:anchor-type="paragraph" svg:x="0in" svg:y="0in" svg:width="8.5in" svg:height="3.55in" draw:z-index="0"/>${marcaAgua()}`
    + `<draw:frame draw:style-name="EsSelloFrame" draw:name="Sello" text:anchor-type="paragraph" svg:x="6.55in" svg:y="0.42in" svg:width="0.95in" svg:height="1.03in" draw:z-index="2"><draw:image draw:mime-type="image/png"><office:binary-data>${ASSETS.sello}</office:binary-data></draw:image></draw:frame>`
    + `${image('Logo', 'image/png', ASSETS.logo, 1.45, 0.515)}</text:p>`
    + `<text:p text:style-name="EsPortadaRaya">${image('Raya', 'image/png', ASSETS.barra, 1.1, 0.07)}</text:p>`
    + `<text:p text:style-name="EsPortadaTitulo">${titulo}</text:p><text:p text:style-name="EsPortadaSubtitulo">${subtitulo}</text:p>`
    + `<text:p text:style-name="EsPortadaNorma">${norma}</text:p>`
    + `<table:table table:name="FichaPortada" table:style-name="EsPortadaFicha"><table:table-column table:style-name="EsPortadaFichaCol1"/><table:table-column table:style-name="EsPortadaFichaCol2"/>${filas.map(fila).join('')}</table:table>`;
}

const STYLES = `
  <style:style style:name="EsGrafico" style:family="graphic">
   <style:graphic-properties style:vertical-pos="middle" style:vertical-rel="text" fo:border="none" fo:padding="0in" style:wrap="none"/>
  </style:style>
  <style:style style:name="EsBarra" style:family="paragraph" style:parent-style-name="Standard">
   <style:paragraph-properties fo:text-align="center" fo:margin-top="0in" fo:margin-bottom="0.14in" fo:line-height="100%" fo:keep-with-next="always"/>
   <style:text-properties fo:font-size="4pt"/>
  </style:style>
  <style:style style:name="EsPortadaLogo" style:family="paragraph" style:parent-style-name="Standard" style:master-page-name="EsPortada"><style:paragraph-properties fo:margin-left="1in" fo:margin-top="0.5in" fo:margin-bottom="0.55in"/></style:style>
  <style:style style:name="EsPortadaRaya" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-left="1in" fo:margin-top="0in" fo:margin-bottom="0.12in"/></style:style>
  <style:style style:name="EsPortadaTitulo" style:family="paragraph" style:parent-style-name="Standard">
   <style:paragraph-properties fo:margin-left="1in" fo:margin-right="1in" fo:margin-top="0in" fo:margin-bottom="0.08in"/><style:text-properties fo:font-size="22pt" fo:font-weight="bold" fo:color="#ffffff"/>
  </style:style>
  <style:style style:name="EsPortadaSubtitulo" style:family="paragraph" style:parent-style-name="Standard">
   <style:paragraph-properties fo:margin-left="1in" fo:margin-right="1in" fo:margin-top="0in" fo:margin-bottom="0.45in"/><style:text-properties fo:font-size="14pt" fo:font-weight="bold" fo:color="${PALETA.amarillo}"/>
  </style:style>
  <style:style style:name="EsPortadaNorma" style:family="paragraph" style:parent-style-name="Standard">
   <style:paragraph-properties fo:margin-left="1in" fo:margin-right="1in" fo:margin-top="0in" fo:margin-bottom="0.75in"/><style:text-properties fo:font-size="8.5pt" fo:color="#d1d5db"/>
  </style:style>
  <style:style style:name="EsPortadaFicha" style:family="table">
   <style:table-properties style:width="6.5in" table:align="left" fo:margin-left="1in" fo:margin-top="0in" fo:margin-bottom="0in"/>
  </style:style>
  <style:style style:name="EsPortadaFichaCol1" style:family="table-column"><style:table-column-properties style:column-width="2.1in"/></style:style>
  <style:style style:name="EsPortadaFichaCol2" style:family="table-column"><style:table-column-properties style:column-width="4.4in"/></style:style>
  <style:style style:name="EsPortadaFichaCelda" style:family="table-cell"><style:table-cell-properties fo:border="none" fo:padding-top="0.06in" fo:padding-bottom="0.06in" fo:padding-left="0in"/></style:style>
  <style:style style:name="EsPortadaEtiqueta" style:family="paragraph" style:parent-style-name="Standard"><style:text-properties fo:font-size="10.5pt" fo:color="${PALETA.gris}"/></style:style>
  <style:style style:name="EsPortadaValor" style:family="paragraph" style:parent-style-name="Standard"><style:text-properties fo:font-size="10.5pt" fo:font-weight="bold" fo:color="${PALETA.texto}"/></style:style>
  <style:style style:name="EsInicioCuerpo" style:family="paragraph" style:parent-style-name="Standard" style:master-page-name="Standard">
   <style:paragraph-properties fo:break-before="page" fo:margin-top="0in" fo:margin-bottom="0in"/><style:text-properties fo:font-size="2pt"/>
  </style:style>
  <style:style style:name="EsEncabezado" style:family="paragraph" style:parent-style-name="Standard">
   <style:paragraph-properties fo:margin-top="0in" fo:margin-bottom="0in" fo:line-height="100%">
    <style:tab-stops><style:tab-stop style:position="6.7in" style:type="right"/></style:tab-stops>
   </style:paragraph-properties>
   <style:text-properties fo:font-size="7.5pt" fo:color="#ffffff"/>
  </style:style>
  <style:style style:name="EsPagina" style:family="text"><style:text-properties fo:font-weight="bold" fo:color="${PALETA.amarillo}"/></style:style>
  <style:style style:name="EsPiePagina" style:family="paragraph" style:parent-style-name="Standard">
   <style:paragraph-properties fo:text-align="center" fo:margin="0in"/><style:text-properties fo:font-size="7.5pt" fo:color="${PALETA.gris}"/>
  </style:style>
  <style:style style:name="EsPiePortada" style:family="paragraph" style:parent-style-name="Standard">
   <style:paragraph-properties fo:margin-left="1in" fo:margin-right="1in" fo:padding-top="0.08in" fo:border-top="0.5pt solid ${PALETA.linea}"/>
   <style:text-properties fo:font-size="8pt" fo:color="${PALETA.gris}"/>
  </style:style>
  <style:style style:name="EsBandaRect" style:family="graphic">
   <style:graphic-properties draw:stroke="none" draw:fill="solid" draw:fill-color="${PALETA.azul}" style:wrap="run-through" style:run-through="background" style:vertical-pos="from-top" style:vertical-rel="page" style:horizontal-pos="from-left" style:horizontal-rel="page"/>
  </style:style>
  <style:style style:name="EsMarcaFrame" style:family="graphic">
   <style:graphic-properties fo:border="none" fo:padding="0in" style:wrap="run-through" style:run-through="background" style:vertical-pos="from-top" style:vertical-rel="page" style:horizontal-pos="from-left" style:horizontal-rel="page"/>
  </style:style>
  <style:style style:name="EsSelloFrame" style:family="graphic">
   <style:graphic-properties fo:border="none" fo:padding="0in" style:wrap="run-through" style:run-through="foreground" style:vertical-pos="from-top" style:vertical-rel="page" style:horizontal-pos="from-left" style:horizontal-rel="page"/>
  </style:style>
  <style:style style:name="EsBandaRaya" style:family="graphic">
   <style:graphic-properties draw:stroke="none" draw:fill="solid" draw:fill-color="${PALETA.amarillo}" style:wrap="run-through" style:run-through="background" style:vertical-pos="from-top" style:vertical-rel="page" style:horizontal-pos="from-left" style:horizontal-rel="page"/>
  </style:style>`;

/** El esqueleto del documento. `encabezado`: texto plano (se escapa aquí) para la banda de las páginas interiores. */
export function studyReportSkeleton({ encabezado = 'Estudio de seguridad' } = {}) {
  const header = `<text:p text:style-name="EsEncabezado"><draw:rect draw:style-name="EsBandaRect" draw:name="Banda" text:anchor-type="paragraph" svg:x="0in" svg:y="0in" svg:width="8.5in" svg:height="0.42in" draw:z-index="0"/><draw:rect draw:style-name="EsBandaRaya" draw:name="Raya" text:anchor-type="paragraph" svg:x="0in" svg:y="0.42in" svg:width="8.5in" svg:height="0.03in" draw:z-index="1"/>${marcaAgua()}${image('LogoBanda', 'image/png', ASSETS.logo, 0.62, 0.22)}<text:s text:c="3"/>${escapeXml(encabezado)}<text:tab/><text:span text:style-name="EsPagina"><text:page-number text:select-page="current">1</text:page-number></text:span></text:p>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:loext="urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0" office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.text">
 <office:font-face-decls>
  <style:font-face style:name="Liberation Sans" svg:font-family="'Liberation Sans'" style:font-family-generic="swiss" style:font-pitch="variable"/>
 </office:font-face-decls>
 <office:styles>
  <style:default-style style:family="paragraph">
   <style:paragraph-properties fo:hyphenation-ladder-count="no-limit" style:writing-mode="lr-tb"/>
   <style:text-properties style:font-name="Liberation Sans" fo:font-size="10.5pt" fo:color="${PALETA.texto}" fo:language="es" fo:country="CO" fo:hyphenate="false"/>
  </style:default-style>
  <style:default-style style:family="table"><style:table-properties table:border-model="collapsing"/></style:default-style>
  <style:style style:name="Standard" style:family="paragraph" style:class="text"/>
  <style:style style:name="Header" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"/>
  <style:style style:name="Footer" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"/>
  <style:style style:name="Graphics" style:family="graphic"/>
 </office:styles>
 <office:automatic-styles>
  <style:page-layout style:name="pmPortada">
   <style:page-layout-properties fo:page-width="8.5in" fo:page-height="11in" style:print-orientation="portrait" fo:margin-top="0in" fo:margin-bottom="0.35in" fo:margin-left="0in" fo:margin-right="0in" style:writing-mode="lr-tb"/>
   <style:footer-style><style:header-footer-properties fo:min-height="0.3in" fo:margin-top="0.15in"/></style:footer-style>
  </style:page-layout>
  <style:page-layout style:name="pmNormal">
   <style:page-layout-properties fo:page-width="8.5in" fo:page-height="11in" style:print-orientation="portrait" fo:margin-top="0.13in" fo:margin-bottom="0.35in" fo:margin-left="0.9in" fo:margin-right="0.9in" style:writing-mode="lr-tb"/>
   <style:header-style><style:header-footer-properties fo:min-height="0.25in" fo:margin-bottom="0.35in"/></style:header-style>
   <style:footer-style><style:header-footer-properties fo:min-height="0.25in" fo:margin-top="0.15in"/></style:footer-style>
  </style:page-layout>${STYLES}
  ${ESTUDIO_ESTILOS}
 </office:automatic-styles>
 <office:master-styles>
  <style:master-page style:name="EsPortada" style:page-layout-name="pmPortada">
   <style:footer><text:p text:style-name="EsPiePortada">Documento confidencial: uso exclusivo del cliente y de Seguridad Nacional Ltda.</text:p></style:footer>
  </style:master-page>
  <style:master-page style:name="Standard" style:page-layout-name="pmNormal">
   <style:header>${header}</style:header>
   <style:footer><text:p text:style-name="EsPiePagina">Documento confidencial · Seguridad Nacional Ltda.</text:p></style:footer>
  </style:master-page>
 </office:master-styles>
 <office:body>
  <office:text>
${ESTUDIO_CUERPO}
  </office:text>
 </office:body>
</office:document>
`;
}
