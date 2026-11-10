// AGT-003 — el cobro de lo facturado, por comercial, desde Avancys (comisiones; Juan, 2026-11-10).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crearLectorAvancys } from '../avancys-odoo-lectura.js';

const ENTORNO = Object.freeze({
  AVANCYS_ODOO_URL: 'https://avancys.ejemplo.test', AVANCYS_ODOO_DATABASE: 'base', AVANCYS_ODOO_USERNAME: 'lectura',
  AVANCYS_ODOO_API_KEY: 'clave-de-mentira', AVANCYS_ODOO_COMPANY_ID: '1',
});

function odoo(facturas) {
  const pedidos = [];
  const fetchImpl = async (_url, opciones) => {
    const cuerpo = JSON.parse(opciones.body);
    const { service, args } = cuerpo.params;
    let result;
    if (service === 'common') result = 7;
    else {
      const [, , , modelo, metodo, , nombrado] = args;
      pedidos.push({ modelo, metodo, campos: nombrado.fields });
      const desde = nombrado.offset || 0;
      result = facturas.slice(desde, desde + nombrado.limit);
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: '2.0', id: cuerpo.id, result }) };
  };
  return { fetchImpl, pedidos };
}

const f = (id, user, untaxed, total, residual, state, type = 'out_invoice') => ({
  id, partner_id: [1, 'Cliente'], invoice_user_id: user, amount_untaxed: untaxed, amount_total: total,
  amount_residual: residual, payment_state: state, move_type: type, invoice_date: '2026-10-15', write_date: '2026-10-20 10:00:00',
});

test('pagado, parcial, pendiente y nota crédito, por comercial y por estado', async () => {
  const { fetchImpl, pedidos } = odoo([
    f(1, [5, 'Lina Cardenas'], 1000, 1019, 0, 'paid'),
    f(2, [5, 'Lina Cardenas'], 2000, 2038, 1019, 'partial'),
    f(3, [6, 'Jhon Bermudez'], 500, 509.5, 509.5, 'not_paid'),
    f(4, [5, 'Lina Cardenas'], 100, 101.9, 0, 'paid', 'out_refund'),
    f(5, false, 300, 305.7, 0, 'in_payment'),
  ]);
  const lector = crearLectorAvancys({ entorno: ENTORNO, fetchImpl });
  const r = await lector.cobroPorComercial({ mes: '2026-10' });
  assert.equal(r.facturas, 5);
  const lina = r.comerciales.find(c => c.nombre === 'Lina Cardenas');
  assert.deepEqual({ facturado: lina.facturado, pagado: lina.pagado, pendiente: lina.pendiente }, { facturado: 2900, pagado: 1900, pendiente: 1000 });
  const jhon = r.comerciales.find(c => c.nombre === 'Jhon Bermudez');
  assert.deepEqual({ pagado: jhon.pagado, pendiente: jhon.pendiente }, { pagado: 0, pendiente: 500 });
  assert.equal(r.comerciales.find(c => c.avancys_user_id === null).pagado, 300, 'sin comercial también se cuenta');
  assert.deepEqual(r.estados.map(e => e.estado).sort(), ['in_payment', 'not_paid', 'paid', 'partial']);
  const lectura = pedidos.find(p => p.modelo === 'account.move');
  assert.ok(lectura.campos.includes('payment_state') && lectura.campos.includes('amount_residual'));
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
    assert.match(handler, /const leido = await lector\.cobroPorComercial\(\{ mes \}\);/);
    assert.match(handler, /motivo: `Avancys no respondio: \$\{error\.codigo\}`/, 'si Avancys no entrega el estado de pago, se dice');
  }
  const ui = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(ui, /<AvancysCollectionPanel \/>/);
});
