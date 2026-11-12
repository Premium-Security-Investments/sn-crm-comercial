import assert from 'node:assert/strict';
import test from 'node:test';
import { medirAccesoAvancys, MODELOS_EN_USO, MODELOS_PEDIDOS } from '../avancys-acceso.js';

const config = Object.freeze({ origen: 'https://odoo.prueba', database: 'db', username: 'u', clave: 'k', companyId: null });

// Un Odoo de mentira: niega lo que se le diga y cuenta lo demás.
function odoo({ denegados = new Set(), campoVisible = false, login = 7 } = {}) {
  const llamadas = [];
  const fetchImpl = async (_url, { body }) => {
    const { params } = JSON.parse(body);
    llamadas.push(params);
    const responder = result => ({ ok: true, json: async () => ({ jsonrpc: '2.0', result }) });
    const negar = () => ({ ok: true, json: async () => ({ jsonrpc: '2.0', error: { message: 'Odoo Server Error', data: { name: 'odoo.exceptions.AccessError', message: 'No tiene permiso para leer\nmás detalle' } } }) });
    if (params.service === 'common') return responder(login);
    const [, , , modelo, metodo, args] = params.args;
    if (denegados.has(modelo)) return negar();
    if (metodo === 'fields_get') return responder(campoVisible ? { analytic_distribution: { string: 'Distribución', type: 'json' } } : {});
    if (metodo === 'search_count') return responder(args[0].length ? 3118 : 3141);
    return responder(null);
  };
  return { fetchImpl, llamadas };
}

test('sin credenciales lo dice, no falla', async () => {
  const r = await medirAccesoAvancys({ config: null });
  assert.equal(r.configurado, false);
  assert.match(r.motivo, /no está configurado/);
});

test('si Odoo rechaza el usuario, no sigue preguntando', async () => {
  const { fetchImpl, llamadas } = odoo({ login: false });
  const r = await medirAccesoAvancys({ config, fetchImpl });
  assert.equal(r.autenticado, false);
  assert.equal(llamadas.length, 1);
});

test('separa lo permitido de lo denegado, con el motivo que da Odoo en una sola línea', async () => {
  const { fetchImpl } = odoo({ denegados: new Set(['hr.tarifario', 'hr.contract.risk']) });
  const r = await medirAccesoAvancys({ config, fetchImpl });
  assert.equal(r.en_uso.length, MODELOS_EN_USO.length);
  assert.equal(r.en_uso.every(f => f.permitido), true);
  const tarifario = r.pedidos.find(f => f.modelo === 'hr.tarifario');
  assert.equal(tarifario.permitido, false);
  assert.match(tarifario.motivo, /AccessError: No tiene permiso para leer$/);
  assert.equal(r.pedidos.filter(f => f.permitido).length, MODELOS_PEDIDOS.length - 2);
});

test('el campo oculto deja la rentabilidad bloqueada y dice qué grupo la abre', async () => {
  const { fetchImpl } = odoo({ campoVisible: false });
  const r = await medirAccesoAvancys({ config, fetchImpl });
  assert.equal(r.rentabilidad_por_cliente, 'bloqueada');
  assert.equal(r.campo_clave.permitido, false);
  assert.match(r.campo_clave.motivo, /Jefe de Nómina/);
});

test('el campo visible desbloquea la rentabilidad y dice cuántos contratos lo tienen', async () => {
  const { fetchImpl } = odoo({ campoVisible: true });
  const r = await medirAccesoAvancys({ config, fetchImpl });
  assert.equal(r.rentabilidad_por_cliente, 'desbloqueada');
  assert.equal(r.campo_clave.diligenciados, 3118);
  assert.equal(r.campo_clave.total, 3141);
});

test('solo lee: nunca llama un método que escriba', async () => {
  const { fetchImpl, llamadas } = odoo({ campoVisible: true });
  await medirAccesoAvancys({ config, fetchImpl });
  const metodos = new Set(llamadas.filter(p => p.service === 'object').map(p => p.args[4]));
  assert.deepEqual([...metodos].sort(), ['fields_get', 'search_count']);
});
