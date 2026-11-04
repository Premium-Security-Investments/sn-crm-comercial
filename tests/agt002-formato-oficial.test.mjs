// Regla de Juan del 2026-11-04: cuando se pide un formato o anexo, la Mesa localiza su texto completo —un archivo
// propio con ese nombre o, si no hay, la sección del pliego vigente— antes de decir que "no está en las fuentes".
// Caso real: el Formato No. 1 de Supersalud vive dentro del pliego definitivo, desde el carácter 427.173.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { agt002CleanExtractedText, agt002FormatoReference, agt002LocateFormato } from '../verticales/licitaciones/agt002-formato-oficial.js';

const FORMATO_1 = readFileSync(new URL('./fixtures/agt002-supersalud-formato-1.txt', import.meta.url), 'utf8');
const PIE = 'DOCUMENTO COMPLEMENTARIO DEL PLIEGO DE CONDICIONES DEFINITIVO \nELECTRÓNICO PROCESO DE LICITACIÓN PÚBLICA No. SNS-LP-2-2026 \nPágina 3 de 199 \nCarrera 68 A N.º 24 B - 10, Torre 3 - Pisos 4, 9 y 10 | PBX +57 601 744 2000 • Bogotá D.C. \nwww.supersalud.gov.co \nE3-FT-1 \nEstamos \ncertificados \n';
// El índice nombra los formatos con puntos guía; el cuerpo de 150 páginas va en medio; después, los formatos.
const PLIEGO = [
  'CONTENIDO\nFORMATO No. 1. ............................................................ 158\nCARTA DE PRESENTACIÓN DE LA OFERTA\nFORMATO No. 2 ............................................................. 163\n',
  ...Array.from({ length: 40 }, (_, page) => `Numeral ${page}. Texto del pliego. Se adjunta la carta de presentación establecida en el Formato No. 1.\n${PIE}`),
  FORMATO_1,
  // Una frase que empieza con el nombre del formato DESPUÉS del cuerpo no le gana al título.
  'FORMATO No. 2 \n1. Resumen de cuentas de Balance General y Estado de Resultados al corte\n',
  'FORMATO No. 3 \nFORMATO CERTIFICADO DE ACREDITACIÓN DE EXPERIENCIA DEL PROPONENTE\n',
  'Formato No. 1 establecido en el pliego de condiciones definitivo. En esta Carta de Presentación, el oferente manifiesta que acepta.\n',
].join('\n');
const documents = [
  { id: 'proyecto', name: 'Proyecto de pliego de condiciones.pdf', document_type: 'pliego', created_at: '2026-10-01', extracted_text: PLIEGO.replace('Supersalud', 'X') },
  { id: 'definitivo', name: 'pliego de condiciones definitivo.pdf', document_type: 'pliego', created_at: '2026-10-30', extracted_text: PLIEGO },
  { id: 'respuestas', name: 'Respuestas a observaciones al pliego definitivo.pdf', document_type: 'pliego', created_at: '2026-10-31', extracted_text: 'RESPUESTA 2. El Formato No. 1 se mantiene.' },
  { id: 'f8', name: 'Formato No. 8 - Jefe de Seguridad.xlsx', document_type: 'formatos', created_at: '2026-10-25', extracted_text: 'Hoja1\nNombre del Jefe de Seguridad\tCédula\tExperiencia (años)' },
];

test('sin número en el pedido: "la carta de presentación" encuentra el Formato No. 1 en el cuerpo del pliego, no en el índice', () => {
  const found = agt002LocateFormato({ documents, message: 'Necesito la carta de presentacion', title: 'Carta de presentación' });
  assert.equal(found.origen, 'pliego');
  assert.equal(found.document_id, 'definitivo', 'el pliego vigente, no el proyecto ni las respuestas');
  assert.match(found.titulo, /^FORMATO No\. 1\. — CARTA DE PRESENTACIÓN DE LA OFERTA/);
  assert.match(found.texto, /El suscrito_+, obrando en su calidad de/);
  assert.match(found.texto, /SOCIOS o ACCIONISTAS IDENTIFICACION/);
  assert.match(found.texto, /m\) Que de conformidad con el artículo 35 de la Ley 2069 de 2020/);
  assert.match(found.texto, /\(\*\*\) NOTA: La carta de presentación deberá ser firmada/);
  assert.equal(found.texto.includes('Resumen de cuentas'), false, 'termina donde empieza el Formato No. 2');
});

test('quita encabezados y pies de página, pero no lo que el formato repite pocas veces', () => {
  const found = agt002LocateFormato({ documents, message: 'hazme el formato 1', title: 'Carta de presentación' });
  for (const pie of ['www.supersalud.gov.co', 'E3-FT-1', 'Página 159 de 199', 'Estamos', 'DOCUMENTO COMPLEMENTARIO DEL PLIEGO']) {
    assert.equal(found.texto.includes(pie), false, pie);
  }
  assert.match(found.texto, /Señores\nSUPERINTENDENCIA NACIONAL DE SALUD/);
  assert.match(found.texto, /Carrera 68A N\.º 24B – 10/, 'la dirección de la entidad dentro de la carta se queda');
});

test('con número, primero el archivo propio: el Formato No. 8 es su propio Excel', () => {
  const found = agt002LocateFormato({ documents, message: 'ármame el formato No. 8 del jefe de seguridad', title: 'Formato 8' });
  assert.equal(found.origen, 'archivo');
  assert.equal(found.document_id, 'f8');
  assert.match(found.texto, /Nombre del Jefe de Seguridad/);
});

test('si el pliego no trae lo pedido, null: la Mesa lo dice en vez de inventarlo', () => {
  assert.equal(agt002LocateFormato({ documents, message: 'necesito el anexo 14', title: 'Anexo 14' }), null);
  assert.equal(agt002LocateFormato({ documents, message: 'necesito el resumen para gerencia', title: 'Resumen para gerencia' }), null);
  assert.equal(agt002LocateFormato({ documents: [], message: 'formato 1', title: 'Carta' }), null);
});

test('referencias y limpieza', () => {
  assert.deepEqual(agt002FormatoReference('Redacta el Anexo No. 7A'), { word: 'anexo', number: '7A' });
  assert.deepEqual(agt002FormatoReference('FORMATO No.10 AUTORIZACIÓN'), { word: 'formato', number: '10' });
  assert.equal(agt002FormatoReference('la carta de presentación'), null);
  assert.equal(agt002CleanExtractedText('a  b\n\n\n c'), 'a b\n\nc');
});
