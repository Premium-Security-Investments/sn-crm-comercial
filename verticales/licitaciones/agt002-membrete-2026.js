// AGT-002 — el membrete «SN 2026» (50 años) en los Word que arma Vig-IA (Katherine, correo del 17-nov).
//
// El membrete nuevo es una imagen de página completa detrás del texto, anclada en el encabezado, con el pie vacío y
// márgenes propios (ejemplo de Katherine: ANEXO_01_Carta_de_presentacion_TT-SPO-07-2026.docx). La plantilla ODF de
// `agt002-document-render.js` trae el membrete anterior (logo arriba, sello abajo). En vez de rehacer esa plantilla,
// que define los estilos del cuerpo, al Word ya convertido se le cambian el encabezado, su imagen y el pie por los
// del ejemplo, y los márgenes de la página por los suyos. El cuerpo no se toca.
//
// `plantillas/membrete-sn-2026.docx` es el ejemplo de Katherine con el cuerpo vacío: de él sólo se leen el encabezado,
// el pie, la imagen y los márgenes.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

export const AGT002_MEMBRETE_2026_PATH = fileURLToPath(new URL('./plantillas/membrete-sn-2026.docx', import.meta.url));
const IMAGE_PREFIX = 'membrete2026_';
const EMPTY_RELS = Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>', 'utf8');

/** Lo que se toma del membrete: encabezado, sus relaciones, la imagen, el pie y los márgenes. Puro. */
export function agt002LeerMembrete2026(membreteBytes) {
  const zip = new AdmZip(membreteBytes);
  const read = name => zip.getEntry(name)?.getData() || null;
  const header = read('word/header1.xml');
  const headerRels = read('word/_rels/header1.xml.rels');
  const footer = read('word/footer1.xml');
  const documentXml = read('word/document.xml')?.toString('utf8') || '';
  if (!header || !headerRels || !footer) throw new Error('El membrete 2026 no trae encabezado y pie.');
  const target = /Target="media\/([^"]+)"/.exec(headerRels.toString('utf8'))?.[1];
  const image = target ? read(`word/media/${target}`) : null;
  if (!image) throw new Error('El membrete 2026 no trae la imagen.');
  const pgMar = /<w:pgMar [^>]*\/>/.exec(documentXml)?.[0] || null;
  const pgSz = /<w:pgSz [^>]*\/>/.exec(documentXml)?.[0] || null;
  return {
    header,
    headerRels: Buffer.from(headerRels.toString('utf8').replace(`media/${target}`, `media/${IMAGE_PREFIX}${target}`), 'utf8'),
    footer,
    imageName: `${IMAGE_PREFIX}${target}`,
    image,
    pgMar,
    pgSz,
  };
}

/** Aplica el membrete a un .docx (Buffer) y devuelve el .docx nuevo. El cuerpo no cambia. Puro. */
export function agt002AplicarMembrete2026(docxBytes, membrete) {
  const zip = new AdmZip(docxBytes);
  const docRels = zip.getEntry('word/_rels/document.xml.rels')?.getData().toString('utf8') || '';
  const headers = [...docRels.matchAll(/Target="(header\d+\.xml)"/g)].map(match => match[1]);
  const footers = [...docRels.matchAll(/Target="(footer\d+\.xml)"/g)].map(match => match[1]);
  if (!headers.length) throw new Error('El documento no tiene encabezado: no se puede aplicar el membrete.');
  for (const name of headers) {
    zip.deleteFile(`word/${name}`);
    zip.addFile(`word/${name}`, membrete.header);
    zip.deleteFile(`word/_rels/${name}.rels`);
    zip.addFile(`word/_rels/${name}.rels`, membrete.headerRels);
  }
  for (const name of footers) {
    zip.deleteFile(`word/${name}`);
    zip.addFile(`word/${name}`, membrete.footer);
    // El pie del membrete no tiene relaciones; se deja el archivo vacío (borrarlo deja colgada su entrada de tipos).
    if (zip.getEntry(`word/_rels/${name}.rels`)) zip.updateFile(`word/_rels/${name}.rels`, EMPTY_RELS);
  }
  zip.addFile(`word/media/${membrete.imageName}`, membrete.image);
  const ext = membrete.imageName.split('.').pop().toLowerCase();
  const types = zip.getEntry('[Content_Types].xml').getData().toString('utf8');
  if (!new RegExp(`Extension="${ext}"`, 'i').test(types)) {
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
    zip.updateFile('[Content_Types].xml', Buffer.from(types.replace('<Default ', `<Default Extension="${ext}" ContentType="${mime}"/><Default `), 'utf8'));
  }
  let documentXml = zip.getEntry('word/document.xml').getData().toString('utf8');
  if (membrete.pgMar) documentXml = documentXml.replace(/<w:pgMar [^>]*\/>/g, membrete.pgMar);
  if (membrete.pgSz) documentXml = documentXml.replace(/<w:pgSz [^>]*\/>/g, membrete.pgSz);
  zip.updateFile('word/document.xml', Buffer.from(documentXml, 'utf8'));
  return zip.toBuffer();
}

let cached = null;
/** El membrete desde el archivo del repositorio, leído una vez. */
export async function agt002Membrete2026({ path = AGT002_MEMBRETE_2026_PATH } = {}) {
  if (!cached || cached.path !== path) cached = { path, membrete: agt002LeerMembrete2026(await readFile(path)) };
  return cached.membrete;
}
