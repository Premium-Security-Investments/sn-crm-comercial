// AGT-003 — catálogo de Avancys en el cotizador (entrega 5a; Juan, 2026-11-26: «si ya está en Avancys, ¿por qué no se
// trae todo y ya?»).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buscarEnCatalogo, catalogoParaCotizar, lineaDesdeProducto, tipoDeLinea } from '../src/vigia/catalogo-avancys.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('tipo de línea por categoría; herramientas, gastos y operaciones no se cotizan', () => {
  assert.equal(tipoDeLinea({ categoria: 'CCTV / CAMARAS' }), 'equipo');
  assert.equal(tipoDeLinea({ categoria: 'ACCESORIOS / TUBERIAS' }), 'insumo');
  assert.equal(tipoDeLinea({ categoria: 'CABLES / UTP' }), 'insumo');
  assert.equal(tipoDeLinea({ categoria: 'SERVICIOS', tipo: 'service' }), 'mano_de_obra');
  assert.equal(tipoDeLinea({ categoria: 'HERRAMIENTAS / VARIAS' }), null);
});

test('todo el catálogo con costo, buscable por palabras sin tildes; la línea lleva el código y el costo', () => {
  const cat = catalogoParaCotizar([
    { codigo: '0501286', nombre: 'CAMARA DOMO IP 4MP DH-HDBW2449', categoria: 'CCTV / CAMARAS', costo: 300000 },
    { codigo: '0401015', nombre: 'CABLE UTP CAT 5 - INTERIOR 100', categoria: 'CABLES / UTP', costo: 1500 },
    { codigo: 'ESMO01', nombre: 'MANO DE OBRA', categoria: 'SERVICIOS', tipo: 'service', costo: 0 },
    { codigo: 'H1', nombre: 'TALADRO', categoria: 'HERRAMIENTAS', costo: 90000 },
  ]);
  assert.deepEqual(cat.map(p => p.codigo), ['0401015', '0501286'], 'sin costo o herramienta no sale');
  assert.equal(buscarEnCatalogo(cat, 'cámara 4mp').length, 1);
  assert.equal(buscarEnCatalogo(cat, 'utp interior')[0].codigo, '0401015');
  assert.deepEqual(lineaDesdeProducto(cat[1]), { description: '[0501286] CAMARA DOMO IP 4MP DH-HDBW2449', category: 'equipo', quantity: 1, unitCost: 300000 });
});

test('servidor y pantalla: ruta para quien cotiza, guardado si Avancys no responde, buscador en tecnología', () => {
  for (const file of ['../server/index.js', '../api/[...path].js']) {
    const src = read(file);
    assert.ok(src.includes("'GET /api/agt003/catalogo': ['opportunities', ACTIONS.CRM_OPPORTUNITY_EDIT],"));
    const h = src.slice(src.indexOf("app.get('/api/agt003/catalogo'"), src.indexOf('\n});', src.indexOf("app.get('/api/agt003/catalogo'")));
    assert.match(h, /requireQuoteWriter\(currentProfile\)/);
    assert.match(h, /catalogoParaCotizar\(leido\.productos\)/);
    assert.match(h, /leerGuardado\(database, 'catalogo-avancys'\)/);
  }
  const lector = read('../avancys-odoo-lectura.js');
  assert.match(lector, /leer\('producto', \[\['sale_ok', '=', true\], \['active', '=', true\]\]/);
  const ui = read('../src/vigia/QuotesSection.tsx');
  assert.match(ui, /<CatalogSearch onAdd=/);
  assert.match(ui, /Buscar en el catálogo de Avancys/);
});
