import assert from 'node:assert/strict';
import test from 'node:test';
import { estadoDeResultados, lineaDeCuenta, LINEAS, totales } from '../avancys-pyg.js';

test('cada cuenta va a la línea del PYG de Finanzas', () => {
  assert.equal(lineaDeCuenta('41559501', 'AIU SERVICIO VIGILANCIA'), 'ing_vigilancia');
  assert.equal(lineaDeCuenta('41556300', 'AIU SERVICIO MONITOREO'), 'ing_monitoreo');
  assert.equal(lineaDeCuenta('41750001', 'DEV SERVICIO DE VALOR AGREGADO Y TELEMATICO'), 'ing_monitoreo');
  assert.equal(lineaDeCuenta('41350501', 'VENTA DE PRODUCTOS'), 'ing_comercializacion');
  assert.equal(lineaDeCuenta('41750501', 'DEVOLUCIONES COMERCIALIZACION'), 'ing_comercializacion');
  assert.equal(lineaDeCuenta('72010101', 'SUELDO VIGILANTES'), 'mod_vigilancia');
  assert.equal(lineaDeCuenta('73040101', 'APORTES PARAFISCALES'), 'moi_vigilancia');
  assert.equal(lineaDeCuenta('72500101', 'SUELDOS TECNICOS'), 'mod_tecnicos');
  assert.equal(lineaDeCuenta('73203501', 'ARRENDAMIENTOS'), 'cif_mt');
  assert.equal(lineaDeCuenta('73503501', 'SERVICIOS'), 'cif_mt');
  assert.equal(lineaDeCuenta('73050101', 'DOTACION'), 'cif_vigilancia');
  assert.equal(lineaDeCuenta('71010101', 'EQUIPOS'), 'equipos');
  assert.equal(lineaDeCuenta('51050101', 'SALARIO INTEGRAL'), 'personal_vigilancia');
  assert.equal(lineaDeCuenta('51950101', 'LIBROS'), 'generales_vigilancia');
  assert.equal(lineaDeCuenta('52050101', 'SUELDOS'), 'personal_mt');
  assert.equal(lineaDeCuenta('53050101', 'GASTOS BANCARIOS'), 'financieros');
  assert.equal(lineaDeCuenta('53150101', 'EXTRAORDINARIOS'), 'otros_gastos');
  assert.equal(lineaDeCuenta('42100101', 'FINANCIEROS'), 'otros_ingresos');
  assert.equal(lineaDeCuenta('54050101', 'RENTA'), 'renta');
  assert.equal(lineaDeCuenta('13050501', 'CLIENTES'), null);
  assert.equal(lineaDeCuenta('61000001', 'COSTO DE VENTAS'), null);
});

test('totales como los presenta Finanzas', () => {
  const lineas = Object.fromEntries(LINEAS.map(l => [l.clave, 0]));
  Object.assign(lineas, { ing_vigilancia: 1000, ing_monitoreo: 50, mod_vigilancia: -700, cif_vigilancia: -50, personal_vigilancia: -60, generales_vigilancia: -40, otros_ingresos: 5, financieros: -15, renta: -20 });
  const t = totales(lineas);
  assert.deepEqual(
    [t.ingresos, t.costos, t.margen_bruto, t.gastos, t.utilidad_ordinaria, t.no_operacional, t.antes_de_impuestos, t.utilidad_neta, t.personal],
    [1050, -750, 300, -100, 200, -10, 190, 170, -760],
  );
});

test('provisión de ingresos mes vencido: suma la del mes y resta la del anterior; lo no clasificado se reporta', async () => {
  const ejecutar = async (modelo, metodo, args) => {
    assert.equal(modelo, 'account.move.line');
    assert.deepEqual(args[0][2], ['parent_state', '=', 'posted']);
    return [
      { 'date:month': 'agosto 2026', account_id: [1, '41559501 AIU SERVICIO VIGILANCIA'], balance: -1000 },
      { 'date:month': 'agosto 2026', account_id: [2, '72010101 SUELDO VIGILANTES'], balance: 800 },
      { 'date:month': 'agosto 2026', account_id: [3, '61000001 COSTO DE VENTAS'], balance: 5 },
      { 'date:month': 'agosto 2026', account_id: [4, '13050501 CLIENTES'], balance: 999 },
      { 'date:month': 'septiembre 2026', account_id: [1, '41559501 AIU SERVICIO VIGILANCIA'], balance: -1100 },
    ];
  };
  const devengado = async mes => ({ '2026-07': { total: 300, clientes: [] }, '2026-08': { total: 400, clientes: [{ nombre: 'ESU', devengado: 400 }] }, '2026-09': { total: 350, clientes: [] } }[mes]);
  const [ago, sep] = await estadoDeResultados(ejecutar, { desde: '2026-08', hasta: '2026-10', devengado });
  assert.equal(ago.facturado_vigilancia, 1000);
  assert.equal(ago.provision.ajuste, 100);
  assert.equal(ago.lineas.ing_vigilancia, 1100);
  assert.equal(ago.totales.antes_de_impuestos, 300);
  assert.deepEqual(ago.provision.clientes, [{ nombre: 'ESU', identificacion: undefined, devengado: 400 }]);
  assert.deepEqual(ago.sin_clasificar, [{ cuenta: '61000001 COSTO DE VENTAS', valor: -5 }]);
  assert.equal(sep.provision.ajuste, -50);
  assert.equal(sep.lineas.ing_vigilancia, 1050);
});

test('si la provisión falla, el estado de resultados sale sin ella y lo dice', async () => {
  const ejecutar = async () => [{ 'date:month': 'agosto 2026', account_id: [1, '41559501 AIU'], balance: -1000 }];
  const [ago] = await estadoDeResultados(ejecutar, { desde: '2026-08', hasta: '2026-09', devengado: async () => { throw new Error('AVANCYS_TIEMPO\nmás'); } });
  assert.equal(ago.lineas.ing_vigilancia, 1000);
  assert.equal(ago.provision.error, 'AVANCYS_TIEMPO');
});

test('proyección: cada costo toma lo registrado o lo del mes cerrado, lo mayor; el mes en curso, ingresos por lo contratado', async () => {
  const { proyectarMes } = await import('../avancys-pyg.js');
  const vacio = () => Object.fromEntries(LINEAS.map(l => [l.clave, 0]));
  const base = { mes: '2026-09', lineas: { ...vacio(), ing_vigilancia: 900, ing_monitoreo: 100, mod_vigilancia: -700, generales_vigilancia: -50 } };
  const octubre = { mes: '2026-10', lineas: { ...vacio(), ing_vigilancia: 950, ing_monitoreo: 100, mod_vigilancia: -400, generales_vigilancia: -60 } };
  const p = proyectarMes(octubre, base);
  assert.equal(p.lineas.mod_vigilancia, -700);
  assert.equal(p.lineas.generales_vigilancia, -60);
  assert.equal(p.lineas.ing_vigilancia, 950);
  assert.deepEqual(p.estimadas, ['mod_vigilancia']);
  assert.equal(p.totales.antes_de_impuestos, 950 + 100 - 700 - 60);
  const noviembre = { mes: '2026-11', lineas: { ...vacio(), ing_vigilancia: 300 } };
  const q = proyectarMes(noviembre, base, { ingresosOrdenes: 2000 });
  assert.equal(q.lineas.ing_vigilancia, 1800);
  assert.equal(q.lineas.ing_monitoreo, 200);
  assert.equal(q.ingresos_ordenes, 2000);
  assert.ok(q.estimadas.includes('ing_vigilancia') && q.estimadas.includes('mod_vigilancia'));
});

test('ingresos contratados: órdenes aprobadas vigentes en el mes', async () => {
  const { ingresosContratados } = await import('../avancys-pyg.js');
  let dominio;
  const total = await ingresosContratados(async (modelo, metodo, args) => {
    assert.equal(modelo, 'project.service.order.line.invoice');
    dominio = args[0];
    return [{ valor_mensual: 1234, __count: 3 }];
  }, '2026-11');
  assert.equal(total, 1234);
  assert.deepEqual(dominio, [['state', '=', 'aprobado'], ['fact_start_date', '<=', '2026-11-30'], ['fact_end_date', '>=', '2026-11-01']]);
});
