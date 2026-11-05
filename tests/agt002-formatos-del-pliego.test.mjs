import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { agt002ListarFormatos } from '../verticales/licitaciones/agt002-formato-oficial.js';
import { datoDeclarado, puedeLeer, resolverFormatosDelPliego } from '../catalogo-fuentes.js';
import { AGT002_MESA_FUENTES } from '../verticales/licitaciones/agt002-workbench-runtime.js';
import { AGT002_DRAFT_DOCUMENT_SCHEMA } from '../verticales/licitaciones/agt002-workbench-responder.js';

// Mejora 6 (encargo desde Terminal): la «relación de anexos que se presentan» de la carta se arma con lo que el proceso
// pide. El pliego de Supersalud (definitivo) tiene, en este orden: índice con puntos, frases que citan formatos
// («Formato No. 1 establecido en el pliego…», «Formato 9 – Participación…»), y los títulos «FORMATO No. 1.» a
// «FORMATO No. 18», «ANEXO 2», «Anexo No. 3». Así lo devolvió el `select` del 2026-11-05.
const PLIEGO = [
  'CONTENIDO',
  'FORMATO No. 1 CARTA DE PRESENTACIÓN ........................ 158',
  'El proponente diligenciará el',
  'Formato No. 1 establecido en el pliego de condiciones definitivo.',
  'Formato 9 – Participación mayoritaria de mujeres cabeza de familia y/o mujeres víctimas',
  'ANEXO 2',
  'MATRIZ DE RIESGOS',
  'FORMATO No. 1.',
  'CARTA DE PRESENTACIÓN DE LA OFERTA',
  'Señores Superintendencia…',
  'FORMATO No. 2',
  'DECLARACIÓN DE MULTAS Y SANCIONES',
  'FORMATO No.9',
  'PARTICIPACIÓN MAYORITARIA DE MUJERES',
  'FORMATO No. 10',
  'AUTORIZACIÓN DE DATOS PERSONALES',
].join('\n');
const documentos = [
  { id: 'p', name: 'pliego de condiciones definitivo.pdf', document_type: 'pliego', created_at: '2026-10-30T19:00:41Z', extracted_text: PLIEGO },
  { id: 'r', name: 'Respuestas a observaciones al pliego definitivo.pdf', document_type: 'pliego', created_at: '2026-10-31T00:00:00Z', extracted_text: 'FORMATO No. 99\nNO ES EL PLIEGO' },
  { id: 'f', name: 'Formato No. 8 - Jefe de Seguridad.xlsx', document_type: 'formatos', created_at: '2026-10-14T13:34:26Z', extracted_text: 'Hoja de vida' },
];

test('caso Supersalud: sólo títulos, sin índice ni citas, del pliego vigente y los archivos propios, en orden', () => {
  const formatos = agt002ListarFormatos(documentos);
  assert.deepEqual(formatos.map(formato => `${formato.palabra} ${formato.numero} ${formato.origen}`), [
    'anexo 2 pliego', 'formato 1 pliego', 'formato 2 pliego', 'formato 8 archivo', 'formato 9 pliego', 'formato 10 pliego',
  ]);
  assert.equal(formatos.find(formato => formato.numero === '1').titulo, 'FORMATO No. 1. — CARTA DE PRESENTACIÓN DE LA OFERTA');
  assert.ok(!formatos.some(formato => formato.numero === '99'), 'las respuestas a observaciones no son el pliego vigente');
});

function base(filas) {
  const q = { select: () => q, eq: () => q, then: (ok, ko) => Promise.resolve({ data: filas, error: null }).then(ok, ko) };
  return { from: () => q };
}

test('el catálogo declara el dato para la Mesa y lo resuelve sólo cuando hay un documento que escribir', async () => {
  assert.ok(datoDeclarado('proceso.formatos_del_pliego'));
  assert.equal(puedeLeer('proceso.formatos_del_pliego', 'agt002.mesa'), true);
  const sinDocumento = await resolverFormatosDelPliego(base(documentos), { tenderId: 't', documento: null });
  assert.equal(sinDocumento.valor, null);
  const conDocumento = await resolverFormatosDelPliego(base(documentos), { tenderId: 't', documento: 'Carta de presentación' });
  assert.equal(conDocumento.valor.formatos.length, 6);
  assert.equal(conDocumento.valor.formatos[1].titulo, 'FORMATO No. 1. — CARTA DE PRESENTACIÓN DE LA OFERTA');
});

test('la Mesa lo pide al redactar un documento y la regla dice cómo armar la relación', () => {
  assert.ok(AGT002_MESA_FUENTES.includes('proceso.formatos_del_pliego'));
  const runtime = readFileSync(new URL('../verticales/licitaciones/agt002-workbench-runtime.js', import.meta.url), 'utf8');
  assert.match(runtime, /nombre !== 'proceso\.formato_oficial' && nombre !== 'proceso\.formatos_del_pliego'/);
  assert.match(AGT002_DRAFT_DOCUMENT_SCHEMA.description, /relación de anexos.*proceso\.formatos_del_pliego.*\[\[ \]\].*no agregues formatos que no estén en esa lista/);
});
