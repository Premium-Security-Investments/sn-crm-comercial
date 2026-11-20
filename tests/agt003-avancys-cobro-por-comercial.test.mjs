// AGT-003 — el cobro de lo facturado, por comercial, desde Avancys (comisiones; Juan, 2026-11-10).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crearLectorAvancys } from '../avancys-odoo-lectura.js';

const ENTORNO = Object.freeze({
  AVANCYS_ODOO_URL: 'https://avancys.ejemplo.test', AVANCYS_ODOO_DATABASE: 'base', AVANCYS_ODOO_USERNAME: 'lectura',
  AVANCYS_ODOO_API_KEY: 'clave-de-mentira', AVANCYS_ODOO_COMPANY_ID: '1',
});

function odoo(facturas, clientes = {}) {
  const pedidos = [];
  const fetchImpl = async (_url, opciones) => {
    const cuerpo = JSON.parse(opciones.body);
    const { service, args } = cuerpo.params;
    let result;
    if (service === 'common') result = 7;
    else {
      const [, , , modelo, metodo, posicional, nombrado] = args;
      pedidos.push({ modelo, metodo, campos: nombrado.fields });
      if (modelo === 'res.partner') {
        const ids = (posicional[0].find(hoja => hoja[0] === 'id') || [])[2] || [];
        result = ids.map(id => ({ id, user_id: clientes[id] ?? false }));
      } else if (metodo === 'read_group') {
        // Desde el 2026-11-20 el lector agrupa las facturas por cliente, estado de pago y tipo (antes, una por una).
        const grupos = new Map();
        for (const fila of facturas) {
          const clave = `${fila.partner_id[0]}|${fila.payment_state}|${fila.move_type}`;
          const g = grupos.get(clave) || { partner_id: fila.partner_id, payment_state: fila.payment_state, move_type: fila.move_type, amount_untaxed: 0, amount_total: 0, amount_residual: 0, write_date: fila.write_date, __count: 0 };
          g.amount_untaxed += fila.amount_untaxed; g.amount_total += fila.amount_total; g.amount_residual += fila.amount_residual; g.__count += 1;
          grupos.set(clave, g);
        }
        result = [...grupos.values()];
      } else {
        // Los grupos mezclados se leen con su cliente, estado y tipo.
        const igual = campo => (posicional[0].find(hoja => Array.isArray(hoja) && hoja[0] === campo && hoja[1] === '=') || [])[2];
        const [cliente, estado, tipo] = ['partner_id', 'payment_state', 'move_type'].map(igual);
        const filtradas = facturas.filter(fila => (cliente === undefined || fila.partner_id[0] === cliente) && (estado === undefined || fila.payment_state === estado) && (tipo === undefined || fila.move_type === tipo));
        const desde = nombrado.offset || 0;
        result = filtradas.slice(desde, desde + nombrado.limit);
      }
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: '2.0', id: cuerpo.id, result }) };
  };
  return { fetchImpl, pedidos };
}

// `cliente` es el id del cliente; el comercial que cuenta es el asignado al cliente, no el que hizo la factura.
const f = (id, cliente, untaxed, total, residual, state, type = 'out_invoice') => ({
  id, partner_id: [cliente, `Cliente ${cliente}`], invoice_user_id: [99, 'Marisol (facturación)'], amount_untaxed: untaxed, amount_total: total,
  amount_residual: residual, payment_state: state, move_type: type, invoice_date: '2026-10-15', write_date: '2026-10-20 10:00:00',
});

test('pagado, parcial, pendiente y nota crédito, por comercial y por estado', async () => {
  const { fetchImpl, pedidos } = odoo([
    f(1, 10, 1000, 1019, 0, 'paid'),
    f(2, 10, 2000, 2038, 1019, 'partial'),
    f(3, 11, 500, 509.5, 509.5, 'not_paid'),
    f(4, 10, 100, 101.9, 0, 'paid', 'out_refund'),
    f(5, 12, 300, 305.7, 0, 'in_payment'),
  ], { 10: [5, 'Lina Cardenas'], 11: [6, 'Jhon Bermudez'], 12: false });
  const lector = crearLectorAvancys({ entorno: ENTORNO, fetchImpl });
  const r = await lector.cobroPorComercial({ mes: '2026-10' });
  assert.equal(r.facturas, 5);
  const lina = r.comerciales.find(c => c.nombre === 'Lina Cardenas');
  assert.deepEqual({ facturado: lina.facturado, pagado: lina.pagado, pendiente: lina.pendiente }, { facturado: 2900, pagado: 1900, pendiente: 1000 });
  const jhon = r.comerciales.find(c => c.nombre === 'Jhon Bermudez');
  assert.deepEqual({ pagado: jhon.pagado, pendiente: jhon.pendiente }, { pagado: 0, pendiente: 500 });
  assert.equal(r.comerciales.find(c => c.avancys_user_id === null).pagado, 300, 'sin comercial también se cuenta');
  assert.deepEqual(r.estados.map(e => e.estado).sort(), ['in_payment', 'not_paid', 'paid', 'partial']);
  assert.ok(!r.comerciales.some(c => c.nombre === 'Marisol (facturación)'), 'quien hace la factura no es el comercial');
  assert.ok(pedidos.some(p => p.modelo === 'res.partner'), 'lee el comercial asignado al cliente');
  // Agrupadas: las pagadas y las sin pagar no se leen una por una; sólo el grupo con el pago parcial.
  assert.ok(pedidos.some(p => p.modelo === 'account.move' && p.metodo === 'read_group'));
  const lecturas = pedidos.filter(p => p.modelo === 'account.move' && p.metodo === 'search_read');
  assert.equal(lecturas.length, 1, 'sólo se lee aparte el grupo pagado en parte');
  assert.ok(lecturas[0].campos.includes('payment_state') && lecturas[0].campos.includes('amount_residual'));
});

test('la Torre no cambia: la facturación por cliente sigue pidiendo sólo sus campos', async () => {
  const { fetchImpl, pedidos } = odoo([]);
  const lector = crearLectorAvancys({ entorno: ENTORNO, fetchImpl });
  await lector.facturacionPorCliente({ mes: '2026-10' });
  assert.deepEqual(pedidos[0].campos, ['id', 'partner_id', 'amount_untaxed', 'move_type', 'invoice_date', 'write_date']);
});

test('el servidor lo expone sólo a quien ve el tablero comercial, y el tablero lo pide al abrirlo', () => {
  for (const file of ['../server/index.js', '../api/[...path].js']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    const h = src.slice(src.indexOf("app.get('/api/agt003/avancys/cobro-por-comercial'"));
    const handler = h.slice(0, h.indexOf('\n});'));
    assert.match(handler, /requireCommercialBehaviorAccess\(currentProfile\);/);
    assert.match(handler, /const leido = \{ \.\.\.\(await lector\.cobroPorComercial\(\{ mes \}\)\), motivo: null/);
    // Desde el 2026-11-20 se guarda cada cálculo y el panel pide primero lo guardado.
    assert.match(handler, /leerGuardado\(requireDb\(\), `cobro:\$\{mes\}`\)/);
    assert.match(handler, /motivo: `Avancys no respondio: \$\{error\.codigo\}`/, 'si Avancys no entrega el estado de pago, se dice');
  }
  const ui = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(ui, /<AvancysCollectionPanel \/>/);
});
