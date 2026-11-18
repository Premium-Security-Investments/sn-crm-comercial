// Membrete «SN 2026» en los Word que arma Vig-IA (Katherine, correo del 17-nov).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { AGT002_MEMBRETE_2026_PATH, agt002AplicarMembrete2026, agt002LeerMembrete2026 } from '../verticales/licitaciones/agt002-membrete-2026.js';
import { agt002ValidarDocx } from '../verticales/licitaciones/agt002-docx-validation.js';

function cartaConMembreteViejo() {
  // Un Word como el que produce LibreOffice: encabezado con logo, pie con sello (relación propia) y márgenes viejos.
  const zip = new AdmZip(readFileSync(AGT002_MEMBRETE_2026_PATH));
  zip.updateFile('word/header1.xml', Buffer.from('<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>LOGO VIEJO</w:t></w:r></w:p></w:hdr>'));
  zip.updateFile('word/footer1.xml', Buffer.from('<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>SELLO VIEJO</w:t></w:r></w:p></w:ftr>'));
  zip.addFile('word/_rels/footer1.xml.rels', Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'));
  const doc = zip.getEntry('word/document.xml').getData().toString('utf8')
    .replace(/<w:pgMar [^>]*\/>/, '<w:pgMar w:top="510" w:right="1247" w:bottom="510" w:left="1247" w:header="0" w:footer="0" w:gutter="0"/>')
    .replace('<w:body>', '<w:body><w:p><w:r><w:t>CUERPO DE LA CARTA</w:t></w:r></w:p>');
  zip.updateFile('word/document.xml', Buffer.from(doc));
  return zip.toBuffer();
}

test('el membrete 2026 reemplaza encabezado, pie y márgenes, y el cuerpo queda igual', () => {
  const membrete = agt002LeerMembrete2026(readFileSync(AGT002_MEMBRETE_2026_PATH));
  assert.match(membrete.pgMar, /w:top="2116"/);
  const salida = agt002AplicarMembrete2026(cartaConMembreteViejo(), membrete);
  const zip = new AdmZip(salida);
  const header = zip.getEntry('word/header1.xml').getData().toString('utf8');
  assert.doesNotMatch(header, /LOGO VIEJO/);
  assert.match(header, /behindDoc="1"/, 'la imagen va detrás del texto');
  assert.doesNotMatch(zip.getEntry('word/footer1.xml').getData().toString('utf8'), /SELLO VIEJO/);
  assert.match(zip.getEntry('word/_rels/header1.xml.rels').getData().toString('utf8'), new RegExp(`media/${membrete.imageName}`));
  assert.ok(zip.getEntry(`word/media/${membrete.imageName}`));
  const documentXml = zip.getEntry('word/document.xml').getData().toString('utf8');
  assert.match(documentXml, /CUERPO DE LA CARTA/);
  assert.match(documentXml, /<w:pgMar w:top="2116" w:right="1247" w:bottom="1989" w:left="1247" w:header="510" w:footer="510"/);
  assert.deepEqual(agt002ValidarDocx(salida), { ok: true, problemas: [] });
});

test('un documento sin encabezado no se toca a ciegas: falla con un mensaje claro', () => {
  const zip = new AdmZip(cartaConMembreteViejo());
  zip.updateFile('word/_rels/document.xml.rels', Buffer.from(zip.getEntry('word/_rels/document.xml.rels').getData().toString('utf8').replace(/<Relationship [^>]*header1\.xml"\/>/, '')));
  assert.throws(() => agt002AplicarMembrete2026(zip.toBuffer(), agt002LeerMembrete2026(readFileSync(AGT002_MEMBRETE_2026_PATH))), /no tiene encabezado/);
});
