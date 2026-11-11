import assert from 'node:assert/strict';
import test from 'node:test';

import { agt002ReglasParaPlurales, pluralReadingOf } from '../verticales/licitaciones/agt002-reglas-plurales.js';
import { agt002UbicacionEnTexto } from '../verticales/licitaciones/agt002-seccion-del-pliego.js';
import { puedeLeer, resolverReglasParaPlurales } from '../catalogo-fuentes.js';
import { AGT002_MESA_FUENTES } from '../verticales/licitaciones/agt002-workbench-runtime.js';
import { AGT002_WORKBENCH_POLICY } from '../verticales/licitaciones/agt002-workbench-responder.js';

// Piloto Fiscalía, 2026-11-11: «¿qué debe cumplir cada integrante por separado y qué se suma? Cita el numeral» no traía
// numeral, así que la sección del pliego no llegaba, y las frases de «cada uno de los integrantes» se perdían. Réplica
// recortada del complemento del pliego definitivo de FGN-REC-IPSE-0058-2026 (texto extraído, con sus saltos de línea).
const PLIEGO = [
  '5.2.1 Indicadores de capacidad financiera',
  'NOTA 1: En caso de presentarse oferentes plurales, el indicador de Capital de Trabajo se calculará mediante la sumatoria simple del resultado de cada uno de sus integrantes.',
  'NOTA 2: En caso de presentarse oferentes plurales, los índices de Liquidez, Endeudamiento y Razón de Cobertura de Intereses se calcularán sumando los indicadores financieros de sus integrantes, ponderados de acuerdo con el porcentaje de participación de cada uno de sus integrantes.',
  '5.3.1. Experiencia',
  'Nota 3: La experiencia del oferente plural (unión temporal, consorcio y promesa de sociedad futura) corresponde a la suma de la experiencia que acredite cada uno de los integrantes del proponente plural a través de sumatoria simple.',
  '5.3.2. REQUISITO TÉCNICO HABILITANTE ADICIONAL',
  '1. Licencia de funcionamiento',
  'En cuanto a los consorcios o uniones temporales, si uno de los integrantes cumple con el requisito de tener domicilio principal, sucursal o agencia en la ciudad capital de cada seccional que conforma la regional, se entenderá cumplido el requisito.',
  '3. CERTIFICACIÓN DE VINCULACIÓN A LA RED DE APOYO',
  'NOTA 2: En caso de consorcios o uniones temporales, cada uno de sus miembros deberá cumplir con el requisito.',
  '4. LICENCIA PARA DESARROLLAR ACTIVIDAD DE TELECOMUNICACIONES',
  'Para el caso de las uniones temporales o consorcios que deseen participar en el proceso, uno de sus integrantes podrá acreditar el cubrimiento a nivel nacional, los otros, deberán acreditar el cubrimiento en las seccionales que integran la regional del proceso contractual.',
  '8. CERTIFICADO DEL DEPARTAMENTO DE REGISTRO Y CONTROL DE ARMAS',
  'En el caso de los consorcios o uniones temporales, este certificado debe ser presentado por cada uno de los integrantes del consorcio o de la unión temporal.',
  '9. CERTIFICACIÓN EXPEDIDA POR LA SUPERINTENDENCIA',
  'En el caso de los consorcios o uniones temporales, este certificado debe ser presentado por cada uno de los integrantes del consorcio o de la unión temporal.',
  '5.3.3. Especificaciones técnicas',
].join('\n');
const DOCS = [{ id: 'complemento', name: 'COMPLEMENTO PLIEGO DEFINITIVO FGN-REC-IPSE-0058-2026.pdf', created_at: '2026-11-02T19:01:17Z', extracted_text: PLIEGO }];
const porNumeral = reglas => Object.fromEntries(reglas.map(regla => [regla.numeral, regla.lectura]));

test('cada regla llega con su numeral y su lectura; «cada uno de sus miembros» no es «basta con uno»', () => {
  const reglas = agt002ReglasParaPlurales(DOCS, { max: 30 });
  const lecturas = porNumeral(reglas);
  assert.equal(lecturas['5.3.2, punto 1'], 'basta_uno');
  assert.equal(lecturas['5.3.2, punto 3'], 'cada_uno');
  assert.equal(lecturas['5.3.2, punto 4'], 'cada_uno', 'uno nacional y «los otros deberán»: no se pierde');
  assert.equal(lecturas['5.3.2, punto 8'], 'cada_uno');
  assert.equal(lecturas['5.3.2, punto 9'], 'cada_uno', 'la misma frase en otro punto es otra regla');
  assert.equal(lecturas['5.3.1'], 'se_suma');
  assert.ok(reglas.some(regla => regla.numeral === '5.2.1' && regla.lectura === 'pondera'));
  assert.ok(reglas.some(regla => regla.numeral === '5.2.1' && regla.lectura === 'se_suma'));
  assert.equal(pluralReadingOf('En caso de consorcios o uniones temporales, cada uno de sus miembros deberá cumplir con el requisito.'), 'cada_uno');
});

test('la ubicación: el título de dos niveles y, si hay, el ítem de un nivel; un «0.» no es un punto', () => {
  assert.equal(agt002UbicacionEnTexto(PLIEGO, PLIEGO.indexOf('este certificado')), '5.3.2, punto 8');
  assert.equal(agt002UbicacionEnTexto(PLIEGO, PLIEGO.indexOf('Nota 3')), '5.3.1');
  assert.equal(agt002UbicacionEnTexto('Sin títulos aquí.', 5), null);
  assert.equal(agt002UbicacionEnTexto('5.2.1 Indicadores\n0. Valor\nTexto', 30), '5.2.1');
});

test('la Mesa las recibe cuando la pregunta es de unión temporal, y no cuando no lo es', async () => {
  assert.ok(AGT002_MESA_FUENTES.includes('proceso.reglas_para_plurales'));
  assert.equal(puedeLeer('proceso.reglas_para_plurales', 'agt002.mesa'), true);
  const q = { select: () => q, eq: () => q, then: (ok, ko) => Promise.resolve({ data: DOCS, error: null }).then(ok, ko) };
  const database = { from: () => q };
  const pregunta = 'Si armamos una unión temporal con Sepecol o con Vigilancia Acosta, ¿qué requisitos habilitantes debe cumplir cada integrante por separado y cuáles se suman? Cita el numeral.';
  const fuente = await resolverReglasParaPlurales(database, { tenderId: 't', pregunta });
  assert.equal(fuente.estado, 'vigente');
  assert.ok(fuente.valor.some(regla => regla.numeral === '5.3.2, punto 8' && regla.lectura === 'cada_uno'));
  assert.ok(fuente.valor.every(regla => typeof regla.frase === 'string' && regla.frase.length > 20));
  const otra = await resolverReglasParaPlurales(database, { tenderId: 't', pregunta: '¿Cuándo cierra el proceso?' });
  assert.equal(otra.valor, null);
  assert.match(AGT002_WORKBENCH_POLICY, /proceso\.reglas_para_plurales/);
  assert.match(AGT002_WORKBENCH_POLICY, /«cada_uno» \(cada integrante lo cumple por separado\)/);
});

test('el pliego definitivo va primero: con muchos documentos, las reglas del 5.3.2 no se quedan por fuera (11-nov)', async () => {
  // Fiscalía tiene 15 documentos que hablan de uniones temporales; el estudio previo y los formatos llenaban el cupo.
  const relleno = Array.from({ length: 60 }, (_, index) => `En caso de consorcio o unión temporal, se sumará el aporte número ${index} de los integrantes.`).join('\n');
  const muchos = [
    { id: 'ep', name: 'Estudio Previo Eje Cafetero final - con texto.pdf', document_type: 'estudios_previos', created_at: '2026-11-04T23:02:38Z', extracted_text: `6.1.4 Requisitos\n${relleno}` },
    { id: 'proy', name: 'COMPLEMENTO PROYECTO PLIEGO FGN-REC-IPSE-0058-2026.pdf', document_type: 'pliego', created_at: '2026-10-29T13:24:21Z', extracted_text: PLIEGO },
    { id: 'pdf', name: 'COMPLEMENTO PLIEGO DEFINITIVO FGN-REC-IPSE-0058-2026.pdf', document_type: 'pliego', created_at: '2026-11-02T19:01:17Z', extracted_text: PLIEGO },
    { id: 'docx', name: 'COMPLEMENTO PLIEGO DEFINITIVO FGN-REC-IPSE-0058-2026.docx', document_type: 'pliego', created_at: '2026-11-02T19:01:21Z', extracted_text: PLIEGO.replace(/\n/g, ' ') },
  ];
  const q = { select: () => q, eq: () => q, then: (ok, ko) => Promise.resolve({ data: muchos, error: null }).then(ok, ko) };
  const fuente = await resolverReglasParaPlurales({ from: () => q }, { tenderId: 't', pregunta: '¿Qué cumple cada integrante de la unión temporal?' });
  const del53 = fuente.valor.filter(regla => /^5\.3\.2, punto/.test(regla.numeral || '')).map(regla => regla.numeral).sort();
  assert.deepEqual(del53, ['5.3.2, punto 1', '5.3.2, punto 3', '5.3.2, punto 4', '5.3.2, punto 8', '5.3.2, punto 9'], 'llegan todas las del 5.3.2, del PDF');
  assert.ok(fuente.valor.every(regla => !/PROYECTO/.test(regla.documento)), 'un proyecto no cuenta');
  const frases = fuente.valor.filter(regla => /cada uno de sus miembros deberá cumplir/.test(regla.frase));
  assert.equal(frases.length, 1, 'la copia en .docx del mismo pliego no se repite');
  assert.ok(fuente.valor.length <= 40);
  assert.ok(fuente.valor.every(regla => regla.frase.length <= 401));
});
