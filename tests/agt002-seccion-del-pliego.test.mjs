import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { agt002NumeralCitado, agt002SeccionDelPedido, agt002SeccionPorNumeral } from '../verticales/licitaciones/agt002-seccion-del-pliego.js';
import { puedeLeer, resolverSeccionDelPliego } from '../catalogo-fuentes.js';
import { AGT002_MESA_FUENTES } from '../verticales/licitaciones/agt002-workbench-runtime.js';
import { AGT002_WORKBENCH_POLICY } from '../verticales/licitaciones/agt002-workbench-responder.js';

// F1/F2 de la auditoría del piloto Fiscalía. Réplica de la estructura del pliego de FGN-REC-IPSE-0058-2026 leída con
// `select` el 2026-11-05: índice con puntos; cuerpo «5.3.2. REQUISITO TÉCNICO HABILITANTE ADICIONAL  » con espacios al
// final; ítems «1. Licencia de funcionamiento» adentro; el párrafo de uniones temporales ~3.000 caracteres después del
// título (la Mesa recibía 1.000); y «5.3.3. Especificaciones técnicas» después.
const relleno = n => 'El oferente deberá anexar a su propuesta la licencia vigente expedida por la Superintendencia. '.repeat(n);
const PLIEGO = [
  'TABLA DE CONTENIDO',
  '5.3.1. Experiencia ................................................... 30',
  '5.3.2. REQUISITO TÉCNICO HABILITANTE ADICIONAL ....................... 31',
  '5.3.3. Especificaciones técnicas ..................................... 34',
  '1. GENERALIDADES',
  'Cronograma del proceso: observaciones hasta el 5 de noviembre.',
  '5.3.1. Experiencia',
  'Contratos ejecutados en vigilancia.',
  '5.3.2. REQUISITO TÉCNICO HABILITANTE ADICIONAL  ',
  ' ',
  '1. Licencia de funcionamiento  ',
  relleno(30),
  'Se entenderá por la Entidad que la licencia se encuentra vigente cuando…',
  '2. Infraestructura física',
  'El oferente y posterior contratista debe contar y mantener la infraestructura física en Pereira, Manizales, Armenia y Quibdó.',
  'En el caso de consorcios y uniones temporales, cada integrante podrá acreditar la presencia en alguna de las ciudades.',
  '5.3.3. Especificaciones técnicas',
  'Las del Anexo técnico.',
  '5.4. GARANTÍAS',
  'Póliza de seriedad.',
].join('\n');
const documentos = [{ id: 'p', name: 'COMPLEMENTO PLIEGO DEFINITIVO FGN-REC-IPSE-0058-2026.pdf', document_type: 'pliego', created_at: '2026-11-02T00:00:00Z', extracted_text: PLIEGO }];

test('el numeral citado se reconoce; un valor como 1.500 o una fecha no', () => {
  assert.equal(agt002NumeralCitado('El requisito está en el pliego definitivo, numeral 5.3.2 «Requisito técnico habilitante adicional», punto 1'), '5.3.2');
  assert.equal(agt002NumeralCitado('lo dice el 4.1.1 del pliego'), '4.1.1');
  assert.equal(agt002NumeralCitado('una póliza de 1.500 SMMLV'), null);
});

test('caso Fiscalía (F1): la sección 5.3.2 llega completa, con el párrafo de uniones temporales, y termina en 5.3.3', () => {
  const seccion = agt002SeccionPorNumeral({ documents: documentos, numeral: '5.3.2' });
  assert.equal(seccion.numeral, '5.3.2');
  assert.match(seccion.titulo, /REQUISITO TÉCNICO HABILITANTE ADICIONAL/);
  assert.ok(seccion.texto.indexOf('uniones temporales') > 1000, 'el párrafo está más allá de los 1.000 caracteres de un fragmento');
  assert.match(seccion.texto, /consorcios y uniones temporales, cada integrante podrá acreditar/);
  assert.match(seccion.texto, /1\. Licencia de funcionamiento[\s\S]*2\. Infraestructura física/, 'los ítems de adentro no la cortan');
  assert.doesNotMatch(seccion.texto, /Especificaciones técnicas|GARANTÍAS|\.{5,}/, 'ni índice ni la sección siguiente');
  assert.equal(seccion.recortado, false);
});

test('caso Fiscalía (F2): sin numeral, la pregunta con las palabras del pliego trae la sección 5.3.2, no el cronograma', () => {
  const pregunta = 'Busca en el pliego definitivo el requisito de infraestructura física en Pereira, Manizales, Armenia y Quibdó: dime el texto literal de lo que dice para consorcios y uniones temporales.';
  const seccion = agt002SeccionDelPedido({ documents: documentos, message: pregunta });
  assert.equal(seccion?.numeral, '5.3.2');
  assert.equal(seccion.origen, 'frase');
  assert.equal(agt002SeccionDelPedido({ documents: documentos, message: '¿Qué opinas del proceso?' }), null, 'sin coincidencia clara no se manda nada');
});

test('el catálogo la sirve a la Mesa, también antes del GO, y la política dice que se cite de ahí', async () => {
  assert.ok(AGT002_MESA_FUENTES.includes('proceso.seccion_del_pliego'));
  assert.equal(puedeLeer('proceso.seccion_del_pliego', 'agt002.mesa'), true);
  const q = { select: () => q, eq: () => q, then: (ok, ko) => Promise.resolve({ data: documentos, error: null }).then(ok, ko) };
  const fuente = await resolverSeccionDelPliego({ from: () => q }, { tenderId: 't', pregunta: 'Dame el numeral 5.3.2 completo' });
  assert.equal(fuente.valor.numeral, '5.3.2');
  assert.match(fuente.valor.texto, /uniones temporales/);
  assert.match(AGT002_WORKBENCH_POLICY, /proceso\.seccion_del_pliego, ése es el texto completo del numeral/);
  const runtime = readFileSync(new URL('../verticales/licitaciones/agt002-workbench-runtime.js', import.meta.url), 'utf8');
  assert.match(runtime, /nombre !== 'proceso\.formato_oficial' && nombre !== 'proceso\.formatos_del_pliego'\)/, 'la sección no se filtra en las respuestas');
});
