import assert from 'node:assert/strict';
import test from 'node:test';
import { medirAccesoAvancys, mirarInformeRentabilidad, mirarLineasAnaliticas, MODELOS_EN_USO, MODELOS_PEDIDOS } from '../avancys-acceso.js';

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
  const lectura = new Set(['fields_get', 'search_count', 'read_group', 'search_read']);
  assert.equal([...metodos].every(metodo => lectura.has(metodo)), true, [...metodos].join(', '));
});

// Un informe de rentabilidad de mentira, con la forma del de Odoo 14.
function informe({ conCostos = true, grupoVacioFalla = false } = {}) {
  const campos = {
    id: { string: 'ID', type: 'integer' },
    project_id: { string: 'Proyecto', type: 'many2one', relation: 'project.project' },
    partner_id: { string: 'Cliente', type: 'many2one', relation: 'res.partner' },
    line_date: { string: 'Fecha', type: 'date' },
    amount_untaxed_invoiced: { string: 'Facturado', type: 'monetary' },
    timesheet_cost: { string: 'Costo de partes de horas', type: 'monetary' },
    campo_calculado: { string: 'No almacenado', type: 'float', store: false },
  };
  const sumas = { amount_untaxed_invoiced: 13_852_000_000, timesheet_cost: conCostos ? -9_100_000_000 : 0 };
  const conValor = { amount_untaxed_invoiced: 2900, timesheet_cost: conCostos ? 2400 : 0, partner_id: 2965, project_id: 2965 };
  const llamadas = [];
  const ejecutar = async (modelo, metodo, args, kwargs) => {
    llamadas.push(metodo);
    if (metodo === 'fields_get') return campos;
    if (metodo === 'search_count') {
      const filtro = args[0][0];
      return filtro ? conValor[filtro[0]] ?? 0 : 2965;
    }
    if (metodo === 'read_group') {
      const [, [campoSuma], agrupar] = args;
      if (grupoVacioFalla && agrupar.length === 0) throw new Error('ValueError: groupby vacío');
      const campo = campoSuma.split(':')[0];
      return agrupar.length ? [{ [campo]: sumas[campo] / 2 }, { [campo]: sumas[campo] / 2 }] : [{ [campo]: sumas[campo] }];
    }
    if (metodo === 'search_read') return [{ line_date: kwargs.order.endsWith('asc') ? '2024-01-01' : '2026-11-10' }];
    return null;
  };
  return { ejecutar, llamadas };
}

test('mira adentro del informe: columnas, sumas, filas con valor, vínculos y fechas', async () => {
  const { ejecutar } = informe();
  const r = await mirarInformeRentabilidad(ejecutar);
  assert.equal(r.legible, true);
  assert.equal(r.filas, 2965);
  assert.deepEqual(r.numericos.map(c => c.campo), ['amount_untaxed_invoiced', 'timesheet_cost'], 'el id y lo no almacenado no cuentan');
  assert.equal(r.numericos[1].filas_con_valor, 2400);
  assert.equal(r.trae_costos, true);
  assert.deepEqual(r.columnas_de_costo, ['timesheet_cost']);
  assert.deepEqual(r.vinculos.map(v => [v.campo, v.filas_con_valor]), [['partner_id', 2965], ['project_id', 2965]]);
  assert.deepEqual(r.fechas, { campo: 'line_date', desde: '2024-01-01', hasta: '2026-11-10' });
});

test('si el costo viene en cero en todas las filas, no se dice que trae costos', async () => {
  const r = await mirarInformeRentabilidad(informe({ conCostos: false }).ejecutar);
  assert.equal(r.trae_costos, false);
  assert.deepEqual(r.columnas_de_costo, []);
});

test('si Odoo no acepta sumar sin agrupar, agrupa por compañía y suma igual', async () => {
  const r = await mirarInformeRentabilidad(informe({ grupoVacioFalla: true }).ejecutar);
  assert.equal(r.numericos.find(c => c.campo === 'amount_untaxed_invoiced').total, 13_852_000_000);
});

test('un fallo adentro del informe no tumba la medición: lo dice y sigue', async () => {
  const r = await mirarInformeRentabilidad(async () => { throw new Error('AccessError: no\nmás'); });
  assert.equal(r.legible, false);
  assert.match(r.motivo, /AccessError/);
});

// Líneas analíticas de mentira: un mes de ingresos y costos, con nómina en la 7205.
function lineas({ conNomina = true } = {}) {
  const dominios = [];
  const ejecutar = async (modelo, metodo, args) => {
    assert.equal(modelo, 'account.analytic.line');
    if (metodo === 'search_count') { dominios.push(args[0]); return args[0].length > 1 ? 2900 : args[0].length ? 3000 : 40000; }
    if (metodo === 'search_read') return [{ date: '2026-08-01' }];
    if (metodo === 'read_group') {
      const [filtro, , [agrupar]] = args;
      const lado = filtro.at(-1);
      if (agrupar === 'date:month') {
        return lado[1] === '>' ? [{ 'date:month': 'agosto 2026', amount: 13_900_000_000, __count: 300 }]
          : [{ 'date:month': 'agosto 2026', amount: -12_000_000_000, __count: 2000 }];
      }
      return [
        { general_account_id: [1, '41559501 Servicio de vigilancia'], amount: 13_900_000_000, __count: 300 },
        { general_account_id: [2, conNomina ? '72050601 Sueldos' : '72950101 Dotación'], amount: -9_000_000_000, __count: 1500 },
        { general_account_id: [3, conNomina ? '72051501 Horas extras' : '72950201 Armas'], amount: -2_000_000_000, __count: 400 },
        { general_account_id: false, amount: -1_000_000_000, __count: 100 },
      ];
    }
    return null;
  };
  return { ejecutar, dominios };
}

test('líneas analíticas: suma por mes y agrupa por cuenta del PUC a cuatro dígitos', async () => {
  const { ejecutar, dominios } = lineas();
  const r = await mirarLineasAnaliticas(ejecutar, { ahora: () => new Date('2026-11-12T12:00:00Z') });
  assert.equal(r.legible, true);
  assert.equal(r.desde, '2025-11-01');
  assert.deepEqual(dominios[1], [['date', '>=', '2025-11-01']]);
  assert.deepEqual(r.por_mes, [{ mes: 'agosto 2026', ingresos: 13_900_000_000, costos: -12_000_000_000, filas: 2300 }]);
  assert.deepEqual(r.por_cuenta.map(c => [c.codigo, c.monto, c.personal]), [
    ['4155', 13_900_000_000, false], ['7205', -11_000_000_000, true], ['sin cuenta', -1_000_000_000, false],
  ]);
  assert.equal(r.costo_de_personal, -11_000_000_000);
  assert.equal(r.trae_nomina, true);
  assert.equal(r.con_cliente, 2900);
});

test('líneas analíticas sin cuentas de personal: no dice que trae nómina', async () => {
  const r = await mirarLineasAnaliticas(lineas({ conNomina: false }).ejecutar);
  assert.equal(r.trae_nomina, false);
  assert.equal(r.costo_de_personal, 0);
});

test('líneas analíticas denegadas: lo dice sin tumbar la medición', async () => {
  const r = await mirarLineasAnaliticas(async () => { throw new Error('AccessError: no puede leer\nmás'); });
  assert.deepEqual(r, { legible: false, motivo: 'AccessError: no puede leer' });
});
