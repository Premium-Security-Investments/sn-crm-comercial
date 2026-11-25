// AGT-003 — comisiones por pagos recibidos (Juan, 2026-11-25): «se les paga por lo que ya haya pagado el cliente; si
// paga parcial se le paga parcial». El valor mensual del contrato es lo que Avancys le factura al cliente por Servicios
// en el mes de la factura, antes de IVA.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calcularComisiones, facturasNombradas, lineaDeNegocio, porcentajeVigilancia } from '../src/vigia/comisiones.js';
import { crearLectorAvancys } from '../avancys-odoo-lectura.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const SMLMV = 1_000_000;
const factura = (extra = {}) => ({ cliente_id: 10, cliente: 'Cliente Diez', comercial_id: 5, comercial: 'Comercial Cinco', sin_iva: 1_000_000, total: 1_019_000, tipo: 'out_invoice', fecha: '2026-10-05', diario: '1 - FACTURA ELECTRONICA DE VENTA SERVICIOS', ...extra });

test('tabla plana por salarios mínimos: un solo porcentaje según el tramo', () => {
  assert.equal(porcentajeVigilancia(10), 0.007);
  assert.equal(porcentajeVigilancia(60), 0.007);
  assert.equal(porcentajeVigilancia(60.1), 0.0056);
  assert.equal(porcentajeVigilancia(120), 0.0056);
  assert.equal(porcentajeVigilancia(200), 0.0042);
  assert.equal(porcentajeVigilancia(201), 0.0028);
  assert.equal(porcentajeVigilancia(0), null);
  assert.equal(lineaDeNegocio('1 - FACTURA ELECTRONICA DE VENTA SERVICIOS'), 'servicios');
  assert.equal(lineaDeNegocio('2 - FACTURA ELECTRONICA DE VENTA MONITOREO'), 'monitoreo');
  assert.equal(lineaDeNegocio('3 - FACTURA ELECTRONICA DE VENTA COMERCIALIZACION'), 'comercializacion');
  assert.deepEqual(facturasNombradas('AV04134 - SN385199', new Set(['SN385199'])), ['SN385199']);
});

test('pago total y pago parcial: cuenta la parte pagada, antes de IVA, con el porcentaje del cliente', () => {
  const r = calcularComisiones({
    recaudos: [
      { id: 1, fecha: '2026-11-03', valor: 1_019_000, texto: 'AV1 - SN100001' },
      { id: 2, fecha: '2026-11-10', valor: 509_500, texto: 'AV2 - SN100002' }, // la mitad de la otra factura
    ],
    facturas: { SN100001: factura(), SN100002: factura({ fecha: '2026-10-20' }) },
    servicioMensual: { '10|2026-10': 2_000_000 }, // 2 salarios mínimos: tramo de 0,70 %
    salarioMinimoDe: () => SMLMV,
  });
  assert.equal(r.comerciales.length, 1);
  const c = r.comerciales[0];
  assert.equal(c.nombre, 'Comercial Cinco');
  assert.equal(c.pagos.length, 2);
  assert.equal(c.base, 1_500_000, 'un millón de la total y medio millón de la parcial');
  assert.equal(c.comision, Math.round(1_500_000 * 0.007));
  assert.equal(c.pagos[1].porcentaje, 0.007);
  assert.equal(c.pagos[1].salarios_minimos, 2);
});

test('el porcentaje sale de lo facturado al cliente en el mes de la factura', () => {
  const r = calcularComisiones({
    recaudos: [{ id: 1, fecha: '2026-11-03', valor: 1_019_000, texto: 'SN100001' }],
    facturas: { SN100001: factura() },
    servicioMensual: { '10|2026-10': 150_000_000 }, // 150 salarios: 0,42 %
    salarioMinimoDe: () => SMLMV,
  });
  assert.equal(r.comerciales[0].pagos[0].porcentaje, 0.0042);
});

test('monitoreo y comercialización sin comisión; saldos viejos aparte; lo dudoso a revisar con cartera', () => {
  const r = calcularComisiones({
    recaudos: [
      { id: 1, fecha: '2026-11-03', valor: 119_000, texto: 'SN200001' },
      { id: 2, fecha: '2026-11-03', valor: 119_000, texto: 'SN200002' },
      { id: 3, fecha: '2026-11-04', valor: 50_000, texto: 'AV9 - SBI/2026/07/0004' },
      { id: 4, fecha: '2026-11-05', valor: 70_000, texto: 'pago sin referencia' },
      { id: 5, fecha: '2026-11-05', valor: 70_000, texto: 'SN100001 SN100002' },
      { id: 6, fecha: '2026-11-06', valor: 9_000_000, texto: 'SN100001' },
    ],
    facturas: {
      SN200001: factura({ sin_iva: 100_000, total: 119_000, diario: '2 - FACTURA ELECTRONICA DE VENTA MONITOREO' }),
      SN200002: factura({ sin_iva: 100_000, total: 119_000, diario: '3 - FACTURA ELECTRONICA DE VENTA COMERCIALIZACION' }),
      SN100001: factura(), SN100002: factura(),
    },
    servicioMensual: { '10|2026-10': 2_000_000 },
    salarioMinimoDe: () => SMLMV,
  });
  assert.equal(r.comerciales.length, 0);
  assert.deepEqual(r.sin_regla, { monitoreo: 100_000, comercializacion: 100_000, otra: 0 });
  assert.equal(r.saldos_anteriores, 50_000);
  assert.deepEqual(r.revisar.map(x => x.motivo), ['No nombra una factura conocida.', 'Nombra varias facturas: no se sabe cuánto va a cada una.', 'El abono es mayor que la factura SN100001.']);
});

test('lector: abonos a cartera por código de cuenta y diarios de banco, caja y cruces; el comercial es el del cliente', async () => {
  const pedidos = [];
  const fetchImpl = async (_url, opciones) => {
    const cuerpo = JSON.parse(opciones.body);
    const { service, args } = cuerpo.params;
    let result = [];
    if (service === 'common') result = 7;
    else {
      const [, , , modelo, , posicional, nombrado] = args;
      pedidos.push({ modelo, dominio: posicional[0] });
      const tiene = campo => posicional[0].some(h => Array.isArray(h) && h[0] === campo);
      if (modelo === 'account.move.line') result = (nombrado.offset || 0) ? [] : [{ id: 1, date: '2026-11-03', name: 'AV1 - SN100001', ref: false, credit: 1019000, journal_id: [5, 'RECAUDO BANCO'], write_date: '2026-11-03 10:00:00' }];
      else if (modelo === 'res.partner') result = [{ id: 10, user_id: [5, 'Comercial Cinco'] }];
      else if (modelo === 'account.move' && tiene('name')) result = (nombrado.offset || 0) ? [] : [{ id: 9, name: 'SN100001', partner_id: [10, '[900] Cliente Diez'], amount_untaxed: 1000000, amount_total: 1019000, move_type: 'out_invoice', invoice_date: '2026-10-05', journal_id: [1, '1 - FACTURA ELECTRONICA DE VENTA SERVICIOS'], write_date: '2026-10-05 08:00:00' }];
      else if (modelo === 'account.move') result = (nombrado.offset || 0) ? [] : [{ id: 9, name: 'SN100001', partner_id: [10, 'Cliente Diez'], amount_untaxed: 1000000, amount_total: 1019000, move_type: 'out_invoice', invoice_date: '2026-10-05', journal_id: [1, 'SERVICIOS'], write_date: '2026-10-05 08:00:00' }];
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: '2.0', id: cuerpo.id, result }) };
  };
  const lector = crearLectorAvancys({ entorno: { AVANCYS_ODOO_URL: 'https://avancys.ejemplo.test', AVANCYS_ODOO_DATABASE: 'b', AVANCYS_ODOO_USERNAME: 'u', AVANCYS_ODOO_API_KEY: 'k' }, fetchImpl });
  const leido = await lector.pagosDelMes({ mes: '2026-11' });
  const recaudo = pedidos.find(p => p.modelo === 'account.move.line').dominio;
  assert.deepEqual(recaudo.find(h => h[0] === 'account_id.code'), ['account_id.code', '=like', '1305%']);
  assert.deepEqual(recaudo.find(h => h[0] === 'journal_id.type'), ['journal_id.type', 'in', ['bank', 'cash', 'general']]);
  assert.equal(leido.facturas.SN100001.comercial, 'Comercial Cinco');
  assert.equal(leido.facturas.SN100001.cliente, 'Cliente Diez', 'sin el NIT pegado');
  assert.equal(leido.servicioMensual['10|2026-10'], 1000000);
  await assert.rejects(() => lector.pagosDelMes({ mes: 'noviembre' }), /AVANCYS_MES_INVALIDO/);
});

test('servidor y pantalla: misma protección que el cobro, guardado para mostrar al instante', () => {
  for (const file of ['../server/index.js', '../api/[...path].js']) {
    const src = read(file);
    assert.ok(src.includes("'GET /api/agt003/avancys/comisiones': ['vigia', ACTIONS.MODULE_DASHBOARD_VIEW],"));
    const handler = src.slice(src.indexOf("app.get('/api/agt003/avancys/comisiones'"), src.indexOf('\n});', src.indexOf("app.get('/api/agt003/avancys/comisiones'")));
    assert.match(handler, /requireCommercialBehaviorAccess\(currentProfile\);/);
    assert.match(handler, /leerGuardado\(database, `comisiones:\$\{mes\}`\)/);
    assert.match(handler, /calcularComisiones\(/);
  }
  assert.match(read('../src/main.tsx'), /<AvancysCollectionPanel \/>\n      <AvancysCommissionsPanel \/>/);
  assert.match(read('../src/vigia/AvancysCommissionsPanel.tsx'), /Revisar con cartera/);
});
