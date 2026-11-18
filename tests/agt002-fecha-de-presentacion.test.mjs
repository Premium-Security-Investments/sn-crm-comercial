import assert from 'node:assert/strict';
import test from 'node:test';
import AdmZip from 'adm-zip';

import { agt002LineaCiudadFecha, agt002PonerFechaDePresentacion } from '../verticales/licitaciones/agt002-fecha-de-presentacion.js';
import { createAgt002DraftDocumentProducer } from '../verticales/licitaciones/agt002-workbench-document.js';

// Mejora 6 (encargo desde Terminal): en TT-SPO-07 la fecha de presentación se puso a mano en diez anexos y la carta
// quedó sin ella. La línea «Ciudad, fecha» la pone el servidor: sede principal y día del cierre en Colombia.

test('caso Fiscalía: un cierre de sólo fecha (medianoche UTC en el CRM) no se corre al día anterior', () => {
  assert.equal(agt002LineaCiudadFecha({ ciudad: 'Pereira', cierre: '2026-11-12' }), 'Pereira, 12 de noviembre de 2026');
  assert.equal(agt002LineaCiudadFecha({ ciudad: 'Pereira', cierre: '2026-11-12T00:00:00+00:00' }), 'Pereira, 12 de noviembre de 2026');
});

test('un cierre con hora real se lleva al día de Colombia, aunque en UTC ya sea el día siguiente', () => {
  assert.equal(agt002LineaCiudadFecha({ ciudad: 'Pereira', cierre: '2026-11-04T15:00:00Z' }), 'Pereira, 4 de noviembre de 2026');
  assert.equal(agt002LineaCiudadFecha({ ciudad: 'Pereira', cierre: '2026-11-13T02:00:00Z' }), 'Pereira, 12 de noviembre de 2026', 'cierre el 12 a las 9 p. m.');
  assert.equal(agt002LineaCiudadFecha({ ciudad: '', cierre: '2026-11-04T15:00:00Z' }), null);
  assert.equal(agt002LineaCiudadFecha({ ciudad: 'Pereira', cierre: null }), null);
});

test('la línea reemplaza lo que haya escrito el modelo; sin datos queda en amarillo y se dice', () => {
  assert.equal(agt002PonerFechaDePresentacion({ city_date: 'Bogotá, 5 de noviembre de 2026', blocks: [] }, 'Pereira, 4 de noviembre de 2026').document.city_date, 'Pereira, 4 de noviembre de 2026');
  const sinDatos = agt002PonerFechaDePresentacion({ city_date: 'Pereira, [[fecha]]', blocks: [] }, null);
  assert.equal(sinDatos.document.city_date, '[[Ciudad y fecha de presentación]]');
  assert.match(sinDatos.aviso, /fecha de presentación quedó en amarillo/);
});

function wordMinimo() {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>'));
  zip.addFile('_rels/.rels', Buffer.from('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="t" Target="word/document.xml"/></Relationships>'));
  zip.addFile('word/document.xml', Buffer.from('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>'));
  return zip.toBuffer();
}

function baseDeMentira({ ciudad = 'Pereira', cierre = '2026-11-04T15:00:00Z', sedes = null, proceso = {} } = {}) {
  const filas = { psi_company_sites: sedes || (ciudad ? [{ city: ciudad, is_main: true }] : []), psi_public_tenders: cierre ? { deadline_at: cierre, raw: {}, ...proceso } : null };
  const consulta = tabla => {
    const q = { select: () => q, eq: () => q, limit: () => q, maybeSingle: async () => ({ data: filas[tabla], error: null }),
      then: (resolve, reject) => Promise.resolve({ data: filas[tabla], error: null }).then(resolve, reject) };
    return q;
  };
  return { from: consulta, storage: { from: () => ({ upload: async () => ({ error: null }) }) } };
}
const input = { opportunity_id: '11111111-1111-4111-8111-111111111111', job_id: '22222222-2222-4222-8222-222222222222', tender_id: '33333333-3333-4333-8333-333333333333' };

test('caso Terminal: la carta sale con «Pereira, 4 de noviembre de 2026» puesta por el servidor', async () => {
  let enviado;
  const producir = createAgt002DraftDocumentProducer({ database: baseDeMentira(), bridgeClient: { renderDocument: async ({ document }) => { enviado = document; return { bytes: wordMinimo(), sha256: 'x' }; } } });
  const metadata = await producir({ input, document: { title: 'Anexo 1 — Carta de presentación', city_date: 'Pereira, [[DÍA]] de noviembre de 2026', blocks: [{ kind: 'paragraph', text: 'a los [[DÍA]] del mes de [[MES]]' }] } });
  assert.equal(enviado.city_date, 'Pereira, 4 de noviembre de 2026');
  assert.equal(enviado.blocks[0].text, 'a los [[DÍA]] del mes de [[MES]]', 'el cuerpo no se toca');
  assert.equal(metadata.avisos, undefined);
});

test('sin cierre registrado, la fecha queda en amarillo y el aviso llega a lo que falta', async () => {
  const producir = createAgt002DraftDocumentProducer({ database: baseDeMentira({ cierre: null }), bridgeClient: { renderDocument: async () => ({ bytes: wordMinimo(), sha256: 'x' }) } });
  const metadata = await producir({ input, document: { title: 'Carta', blocks: [{ kind: 'paragraph', text: 'x' }] } });
  assert.match(metadata.avisos[0], /fecha de presentación quedó en amarillo/);
  assert.match(metadata.falta[0], /fecha de presentación quedó en amarillo/);
});

// Katherine (17-nov): la ciudad de la carta es la de radicación si allí tenemos sede o agencia; si no, Pereira.
test('ciudad de radicación: Terminal en Bogotá sale «Bogotá D.C.» porque allí tenemos agencia; sin agencia, Pereira', async () => {
  const { agt002CiudadDeRadicacion } = await import('../verticales/licitaciones/agt002-fecha-de-presentacion.js');
  const sedes = [
    { city: 'Pereira', is_main: true },
    { city: 'Bogotá', is_main: false, supervigilancia_authorization: 'Agencia autorizada por Resolución SVSP 2020-0049297' },
    { city: 'Manizales', is_main: false, supervigilancia_authorization: 'Agencia autorizada' },
    { city: 'Armenia', is_main: false, supervigilancia_authorization: 'Pendiente de resolución de la SVSP' },
  ];
  assert.equal(agt002CiudadDeRadicacion({ sedes, ciudadProceso: 'Bogotá' }), 'Bogotá D.C.');
  assert.equal(agt002CiudadDeRadicacion({ sedes, ciudadProceso: 'No Definido', departamentoProceso: 'No Definido', entidad: 'Rama Judicial Dirección Seccional de Administración Judicial de Manizales' }), 'Manizales');
  assert.equal(agt002CiudadDeRadicacion({ sedes, ciudadProceso: 'Armenia' }), 'Pereira', 'una agencia pendiente no cuenta');
  assert.equal(agt002CiudadDeRadicacion({ sedes, ciudadProceso: 'Barranquilla' }), 'Pereira');
  let enviado;
  const producir = createAgt002DraftDocumentProducer({ database: baseDeMentira({ sedes, proceso: { city: 'Bogotá', dept: 'Distrito Capital de Bogotá', entity: 'TERMINAL DE TRANSPORTE S.A' } }), bridgeClient: { renderDocument: async ({ document }) => { enviado = document; return { bytes: wordMinimo(), sha256: 'x' }; } } });
  await producir({ input, document: { title: 'Anexo 1', blocks: [{ kind: 'paragraph', text: 'x' }] } });
  assert.equal(enviado.city_date, 'Bogotá D.C., 4 de noviembre de 2026');
});
