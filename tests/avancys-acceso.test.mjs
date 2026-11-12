import assert from 'node:assert/strict';
import test from 'node:test';
import { claseDeCuenta, fraccionDeSemana, horasDelTurno, horasPorDiaDelProducto, rentabilidadAproximada, medirAccesoAvancys, mesCerradoAnterior, mirarInformeRentabilidad, mirarLineasAnaliticas, pygPorCliente, MODELOS_EN_USO, MODELOS_PEDIDOS } from '../avancys-acceso.js';

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
  assert.deepEqual(r.turnos.map(f => f.modelo), ['hr.roster.programacion', 'hr.roster.programacion.line']);
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

// Líneas analíticas de mentira, con la forma medida el 2026-11-12: ingresos en la 4155, nómina en
// 7201/7202 y en 7301 (sueldos supervisores, que no empieza por 72), y cuentas de balance
// repartidas también (1305, 2505) que no deben contar.
const CUENTAS = [
  { id: 1, nombre: '41559501 AIU SERVICIO VIGILANCIA', monto: 13_900_000_000, filas: 300 },
  { id: 2, nombre: '72010101 SUELDO VIGILANTES', monto: -6_000_000_000, filas: 1500 },
  { id: 3, nombre: '72020101 CESANTIAS', monto: -1_000_000_000, filas: 400 },
  { id: 4, nombre: '73010101 SUELDOS SUPERVISORES / ESCOLTAS', monto: -500_000_000, filas: 100 },
  { id: 5, nombre: '73250101 DOTACION', monto: -800_000_000, filas: 100 },
  { id: 6, nombre: '13050501 CLIENTES VIGILANCIA', monto: -4_000_000_000, filas: 90 },
  { id: 7, nombre: '25050101 NOMINAS', monto: 2_000_000_000, filas: 80 },
];
function lineas() {
  const llamadas = [];
  const ejecutar = async (modelo, metodo, args, kwargs) => {
    llamadas.push({ modelo, metodo, args, kwargs });
    if (modelo === 'account.analytic.account') {
      return args[0][0][2].map(id => ({ id, code: `CC${id}`, name: `Centro ${id}`, group_id: id === 12 ? [1, 'ADMINISTRACION'] : false, partner_id: id === 10 ? [500, 'JERONIMO MARTINS COLOMBIA'] : id === 11 ? [600, 'OTRO CLIENTE'] : false }));
    }
    assert.equal(modelo, 'account.analytic.line');
    if (metodo === 'search_count') return args[0].length ? 3000 : 40000;
    if (metodo === 'search_read') return [{ date: '2026-07-31' }];
    if (metodo === 'read_group') {
      const [filtro, , [agrupar]] = args;
      const ultimo = filtro.at(-1);
      if (agrupar === 'general_account_id') return CUENTAS.map(c => ({ general_account_id: [c.id, c.nombre], amount: c.monto, __count: c.filas }));
      const ids = ultimo[0] === 'general_account_id' ? ultimo[2] : [];
      const cuentas = CUENTAS.filter(c => ids.includes(c.id));
      const monto = cuentas.reduce((s, c) => s + c.monto, 0);
      const filas = cuentas.reduce((s, c) => s + c.filas, 0);
      if (agrupar === 'date:month') return [{ 'date:month': 'agosto 2026', amount: monto, __count: filas }];
      if (agrupar === 'account_id') {
        // La cuenta 10 es de Jerónimo Martins y lleva el 70 %; la 11 de otro cliente; la 12 sin cliente.
        return [
          { account_id: [10, 'CC-ARA'], amount: monto * 0.7, __count: 1 },
          { account_id: [11, 'CC-OTRO'], amount: monto * 0.2, __count: 1 },
          { account_id: [12, 'CC-ADMIN'], amount: monto * 0.1, __count: 1 },
        ];
      }
    }
    return null;
  };
  return { ejecutar, llamadas };
}

test('clase de cuenta: 4 es ingreso, 72 y los sueldos de la 73 son personal, el balance no cuenta', () => {
  assert.equal(claseDeCuenta({ codigo: '4155', nombre: 'AIU SERVICIO VIGILANCIA' }), 'ingreso');
  assert.equal(claseDeCuenta({ codigo: '7203', nombre: 'APORTES A RIESGOS' }), 'personal');
  assert.equal(claseDeCuenta({ codigo: '7301', nombre: 'SUELDOS SUPERVISORES / ESCOLTAS' }), 'personal');
  assert.equal(claseDeCuenta({ codigo: '5105', nombre: 'SALARIO INTEGRAL' }), 'personal');
  assert.equal(claseDeCuenta({ codigo: '7325', nombre: 'DOTACION' }), 'otro_costo');
  assert.equal(claseDeCuenta({ codigo: '2505', nombre: 'NOMINAS' }), 'balance');
  assert.equal(claseDeCuenta({ codigo: '9999', nombre: 'CUENTA PUENTE INGRESOS' }), 'balance');
});

test('líneas analíticas: solo resultados, por mes con margen, y la nómina incluye la 7301', async () => {
  const r = await mirarLineasAnaliticas(lineas().ejecutar, { ahora: () => new Date('2026-11-12T12:00:00Z') });
  assert.equal(r.legible, true);
  assert.equal(r.desde, '2025-11-01');
  assert.equal(r.cuentas_de_balance, 2);
  assert.equal(r.costo_de_personal, -7_500_000_000);
  assert.equal(r.trae_nomina, true);
  assert.deepEqual(r.por_mes, [{ mes: 'agosto 2026', ingresos: 13_900_000_000, personal: -7_500_000_000, otros_costos: -800_000_000, filas: 2400, margen: 5_600_000_000 }]);
  assert.equal(r.por_cuenta.some(c => c.codigo === '1305' || c.codigo === '2505'), false);
});

test('resultado por cliente: el cliente sale de la cuenta analítica y lo demás queda sin cliente', async () => {
  const { ejecutar, llamadas } = lineas();
  const r = await pygPorCliente(ejecutar, { mes: '2026-08' });
  assert.equal(r.legible, true);
  assert.deepEqual(llamadas[0].args[0].slice(0, 2), [['date', '>=', '2026-08-01'], ['date', '<', '2026-09-01']]);
  assert.equal(r.clientes_con_movimiento, 2);
  assert.equal(r.clientes[0].cliente, 'JERONIMO MARTINS COLOMBIA');
  assert.ok(Math.abs(r.clientes[0].ingresos - 13_900_000_000 * 0.7) < 1);
  assert.ok(Math.abs(r.clientes[0].margen - 5_600_000_000 * 0.7) < 1);
  assert.equal(r.sin_cliente.sin_cliente, true);
  assert.ok(Math.abs(r.totales.margen - 5_600_000_000) < 1);
  assert.equal(r.cuentas_con_costo, 3);
  assert.deepEqual(r.cuentas_de_costo.map(c => [c.codigo, c.grupo, c.cliente]), [
    ['CC10', null, 'JERONIMO MARTINS COLOMBIA'], ['CC11', null, 'OTRO CLIENTE'], ['CC12', 'ADMINISTRACION', null],
  ]);
});

test('resultado por cliente: diciembre cruza de año y un mes mal escrito no consulta', async () => {
  const { ejecutar, llamadas } = lineas();
  await pygPorCliente(ejecutar, { mes: '2026-12' });
  assert.deepEqual(llamadas[0].args[0].slice(0, 2), [['date', '>=', '2026-12-01'], ['date', '<', '2027-01-01']]);
  const malo = await pygPorCliente(async () => { throw new Error('no debía llamar'); }, { mes: '2026-13' });
  assert.equal(malo.legible, false);
  assert.equal(mesCerradoAnterior(new Date('2026-01-15T00:00:00Z')), '2025-12');
});

test('líneas analíticas denegadas: lo dice sin tumbar la medición', async () => {
  const r = await mirarLineasAnaliticas(async () => { throw new Error('AccessError: no puede leer\nmás'); });
  assert.deepEqual(r, { legible: false, motivo: 'AccessError: no puede leer' });
});

test('horas del producto: lee 24 HORAS, 12 H y los días hábiles; lo que no dice horas queda sin horas', () => {
  assert.equal(horasPorDiaDelProducto('VIGILANCIA 24 HORAS CON ARMA'), 24);
  assert.equal(horasPorDiaDelProducto('VIGILANCIA 12HRS'), 12);
  assert.ok(Math.abs(horasPorDiaDelProducto('SERVICIO 12 H LUNES A VIERNES') - 12 * 5 / 7) < 1e-9);
  assert.ok(Math.abs(horasPorDiaDelProducto('VIGILANCIA 8 HORAS L-S') - 8 * 6 / 7) < 1e-9);
  assert.equal(horasPorDiaDelProducto('MONITOREO DE ALARMAS'), null);
  assert.equal(horasPorDiaDelProducto('PLAN 48 HORAS'), null);
});

// Un mes de mentira: dos clientes con ingreso en su cuenta, el costo en centros de la empresa
// (uno de vigilantes y uno administrativo) y órdenes de servicio con horas en el producto.
function mesAproximado() {
  const CUENTAS_PYG = [
    { id: 1, nombre: '41559501 AIU SERVICIO VIGILANCIA' },
    { id: 2, nombre: '72010101 SUELDO VIGILANTES' },
    { id: 3, nombre: '51050101 SALARIO INTEGRAL' },
  ];
  const POR_CUENTA = {
    1: [{ account_id: [10, 'CC ARA'], amount: 3000 }, { account_id: [11, 'CC OTRO'], amount: 1000 }],
    2: [{ account_id: [20, 'VFPEVI'], amount: -2400 }],
    3: [{ account_id: [21, 'VFPEGG'], amount: -400 }],
  };
  const ANALITICAS = {
    10: { id: 10, name: 'ARA PEREIRA', partner_id: [500, 'JERONIMO MARTINS'] },
    11: { id: 11, name: 'CONJUNTO', partner_id: [600, 'OTRO CLIENTE'] },
    20: { id: 20, name: 'SEGURIDAD NACIONAL LTDA--PEREIRA---VIGILANCIA FISICA VIGILANTES', partner_id: [1, '[891408256] SEGURIDAD NACIONAL LTDA'] },
    21: { id: 21, name: 'SEGURIDAD NACIONAL LTDA-01 - RISARALDA-PEREIRA---VIGILANCIA FISICA GERENCIA GENERAL', partner_id: [1, '[891408256] SEGURIDAD NACIONAL LTDA'] },
  };
  const llamadas = [];
  const ejecutar = async (modelo, metodo, args, kwargs) => {
    llamadas.push({ modelo, metodo, args, kwargs });
    if (modelo === 'account.analytic.account') return args[0][0][2].map(id => ANALITICAS[id]);
    if (modelo === 'project.service.order.line') {
      if (metodo === 'fields_get') return { partner_id: {}, product_id: {}, time_in: {}, time_out: {}, weekdays: {} };
      return [
        { partner_id: [500, 'JERONIMO MARTINS'], product_id: [1, '[VI002] VIGILANCIA FISICA SIN ARMA'], time_in: 6, time_out: 6, weekdays: false },
        { partner_id: [500, 'JERONIMO MARTINS'], product_id: [1, '[VI002] VIGILANCIA FISICA SIN ARMA'], time_in: 18, time_out: 6, weekdays: false },
        { partner_id: [500, 'JERONIMO MARTINS'], product_id: [1, '[VI002] VIGILANCIA FISICA SIN ARMA'], time_in: 0, time_out: 0, weekdays: false },
        { partner_id: [600, 'OTRO CLIENTE'], product_id: [2, '[VI001] VIGILANCIA FISICA CON ARMA'], time_in: 6, time_out: 18, weekdays: '1,2,3,4,5' },
        { partner_id: [600, 'OTRO CLIENTE'], product_id: [3, '[MO005] MONITOREO TELEMATICO (GPRS)'], time_in: 0, time_out: 0, weekdays: false },
      ];
    }
    const [filtro, , [agrupar]] = args;
    if (agrupar === 'general_account_id') return CUENTAS_PYG.map(c => ({ general_account_id: [c.id, c.nombre], amount: 1, __count: 1 }));
    const ids = filtro.at(-1)[2];
    return ids.flatMap(id => POR_CUENTA[id] || []).map(g => ({ ...g, __count: 1 }));
  };
  return { ejecutar, llamadas };
}

test('horario del turno: cruza la medianoche, igual es 24 h, cero es sin dato; días de la semana', () => {
  assert.equal(horasDelTurno(6, 18), 12);
  assert.equal(horasDelTurno(18, 6), 12);
  assert.equal(horasDelTurno(6, 6), 24);
  assert.equal(horasDelTurno(0, 0), null);
  assert.equal(horasDelTurno(false, 18), null);
  assert.ok(Math.abs(fraccionDeSemana('1,2,3,4,5') - 5 / 7) < 1e-9);
  assert.ok(Math.abs(fraccionDeSemana(6) - 6 / 7) < 1e-9);
  assert.equal(fraccionDeSemana(false), 1);
});

test('rentabilidad aproximada: horas del horario de la orden, promedio a la que no tiene, monitoreo fuera', async () => {
  const { ejecutar, llamadas } = mesAproximado();
  const r = await rentabilidadAproximada(ejecutar, { mes: '2026-09' });
  assert.equal(r.legible, true);
  assert.equal(r.aproximado, true);
  // Con dato: 24, 12 y 12 × 5/7 h/día. La tercera de ARA recibe el promedio.
  const promedio = (24 + 12 + 12 * 5 / 7) / 3;
  assert.ok(Math.abs(r.horas_por_dia.promedio - promedio) < 1e-9);
  assert.deepEqual(r.fuentes_de_horas, { horario: 3, duracion: 0, nombre: 0, promedio: 1 });
  assert.deepEqual(r.excluidas, [{ producto: '[MO005] MONITOREO TELEMATICO (GPRS)', lineas: 1 }]);
  const horasAra = (24 + 12 + promedio) * 30;
  const horasOtro = 12 * 5 / 7 * 30;
  assert.ok(Math.abs(r.horas - (horasAra + horasOtro)) < 1e-6);
  const [ara, otro] = r.clientes;
  assert.equal(ara.cliente, 'JERONIMO MARTINS');
  assert.equal(ara.lineas_sin_horas, 1);
  assert.ok(Math.abs(ara.costo_vigilantes - (-2400 * horasAra / r.horas)) < 1e-6);
  assert.ok(Math.abs(ara.costo_indirecto - (-400 * 3000 / 4000)) < 1e-6);
  assert.ok(Math.abs(otro.costo_vigilantes - (-2400 * horasOtro / r.horas)) < 1e-6);
  const lectura = llamadas.find(l => l.modelo === 'project.service.order.line' && l.metodo === 'search_read');
  assert.deepEqual(lectura.args[0], [['state', '=', 'active']]);
  assert.deepEqual(lectura.kwargs.fields, ['partner_id', 'product_id', 'time_in', 'time_out', 'weekdays']);
});

test('rentabilidad aproximada: mes mal escrito no consulta', async () => {
  const r = await rentabilidadAproximada(async () => { throw new Error('no debía llamar'); }, { mes: 'septiembre' });
  assert.equal(r.legible, false);
});
