import assert from 'node:assert/strict';
import test from 'node:test';
import { calcularTorre, carteraVencida, marcarMeses, mesDeEtiqueta, olvidarTorre, resultadoPorMes, torreAvancys } from '../avancys-torre.js';

test('etiqueta de mes de Odoo: en español o en inglés; lo demás no es un mes', () => {
  assert.equal(mesDeEtiqueta('agosto 2026'), '2026-08');
  assert.equal(mesDeEtiqueta('October 2026'), '2026-10');
  assert.equal(mesDeEtiqueta('sin fecha'), null);
  assert.equal(mesDeEtiqueta(false), null);
});

test('estado del mes: en curso es parcial; un mes con la nómina a medias también ', () => {
  const meses = marcarMeses([
    { mes: '2026-08', personal: -1200 },
    { mes: '2026-09', personal: -1100 },
    { mes: '2026-10', personal: -500 },
    { mes: '2026-11', personal: -2 },
  ], '2026-11', { hoy: '2026-12-15' });
  assert.deepEqual(meses.map(fila => [fila.mes, fila.estado]), [
    ['2026-08', 'cerrado'], ['2026-09', 'cerrado'], ['2026-10', 'parcial'], ['2026-11', 'parcial'],
  ]);
  assert.match(meses[2].motivo, /nómina/);
  assert.equal(meses[3].motivo, 'Mes en curso');
});

test('un mes con la nómina casi completa no se da por cerrado antes de 30 días, salvo que Contabilidad lo bloquee', () => {
  const filas = [{ mes: '2026-08', personal: -1200 }, { mes: '2026-09', personal: -1100 }, { mes: '2026-10', personal: -1000 }, { mes: '2026-11', personal: -2 }];
  const hoy = '2026-11-13';
  assert.deepEqual(marcarMeses(filas, '2026-11', { hoy }).map(fila => fila.estado), ['cerrado', 'cerrado', 'parcial', 'parcial']);
  assert.match(marcarMeses(filas, '2026-11', { hoy })[2].motivo, /Contabilidad/);
  assert.deepEqual(marcarMeses(filas, '2026-11', { hoy, bloqueo: '2026-10-31' }).map(fila => fila.estado), ['cerrado', 'cerrado', 'cerrado', 'parcial']);
});

// Una contabilidad de mentira: cuentas de resultados y de balance, agrupadas por cuenta y mes.
function odoo({ primera = '2026-07-31' } = {}) {
  const llamadas = [];
  const GRUPOS = [
    ['julio 2026', '41559501 AIU SERVICIO VIGILANCIA', 9000], ['julio 2026', '72010101 SUELDO VIGILANTES', -7000],
    ['agosto 2026', '41559501 AIU SERVICIO VIGILANCIA', 1400], ['agosto 2026', '72010101 SUELDO VIGILANTES', -1200], ['agosto 2026', '51950101 LIBROS', -80],
    ['agosto 2026', '13050501 CLIENTES VIGILANCIA', -500],
    ['septiembre 2026', '41559501 AIU SERVICIO VIGILANCIA', 1300], ['septiembre 2026', '72010101 SUELDO VIGILANTES', -1100], ['septiembre 2026', '51950101 LIBROS', -90],
    ['octubre 2026', '41559501 AIU SERVICIO VIGILANCIA', 1450], ['octubre 2026', '72010101 SUELDO VIGILANTES', -500],
    ['noviembre 2026', '41559501 AIU SERVICIO VIGILANCIA', 600], ['noviembre 2026', '72010101 SUELDO VIGILANTES', -2],
  ];
  const ejecutar = async (modelo, metodo, args, kwargs) => {
    llamadas.push({ modelo, metodo, args, kwargs });
    if (metodo === 'search_read' && modelo === 'account.analytic.line') return [{ date: primera }];
    if (metodo === 'read_group' && args[2]?.length === 2) {
      const desde = args[0][0][2];
      const hasta = args[0][1][2];
      return GRUPOS.filter(([etiqueta]) => {
        const mes = mesDeEtiqueta(etiqueta);
        return `${mes}-01` >= desde && `${mes}-01` < hasta;
      }).map(([etiqueta, cuenta, monto], i) => (modelo === 'account.move.line'
        ? { 'date:month': etiqueta, account_id: [i + 1, cuenta], balance: -monto, __count: 1 }
        : { 'date:month': etiqueta, general_account_id: [i + 1, cuenta], amount: monto, __count: 1 }));
    }
    // La rentabilidad por cliente se prueba en avancys-acceso.test.mjs: aquí basta con que no falle.
    if (metodo === 'fields_get') return {};
    return [];
  };
  return { ejecutar, llamadas };
}

test('resultado por mes con una sola consulta: solo cuentas de resultados, con margen', async () => {
  const { ejecutar, llamadas } = odoo();
  const meses = await resultadoPorMes(ejecutar, { desde: '2026-08', hasta: '2026-10' });
  assert.deepEqual(meses, [
    { mes: '2026-08', ingresos: 1400, personal: -1200, otros_costos: -80, margen: 120 },
    { mes: '2026-09', ingresos: 1300, personal: -1100, otros_costos: -90, margen: 110 },
  ]);
  assert.equal(llamadas.length, 1);
  assert.deepEqual(llamadas[0].args[2], ['general_account_id', 'date:month']);
});

test('la Torre salta el mes de la carga inicial y toma el último mes con la nómina completa', async () => {
  const { ejecutar } = odoo();
  const r = await calcularTorre(ejecutar, { ahora: () => new Date('2026-11-13T12:00:00Z') });
  assert.deepEqual(r.meses.map(fila => fila.mes), ['2026-08', '2026-09', '2026-10', '2026-11']);
  assert.equal(r.mes_cerrado, '2026-09');
  assert.equal(r.mes_anterior, '2026-08');
  assert.equal(r.clientes.mes, '2026-09');
  assert.equal(r.pyg.length, 4);
  assert.equal(r.pyg[1].totales.antes_de_impuestos, 110);
  assert.ok(r.lineas_pyg.length > 10);
});

test('lo calculado se guarda 30 minutos y "refrescar" lo vuelve a pedir', async () => {
  olvidarTorre();
  let logins = 0;
  const { ejecutar } = odoo();
  const fetchImpl = async (_url, { body }) => {
    const { params } = JSON.parse(body);
    if (params.service === 'common') { logins += 1; return { ok: true, json: async () => ({ result: 7 }) }; }
    const [, , , modelo, metodo, args, kwargs] = params.args;
    return { ok: true, json: async () => ({ result: await ejecutar(modelo, metodo, args, kwargs) }) };
  };
  const config = { origen: 'https://odoo.prueba', database: 'db', username: 'u', clave: 'k', companyId: null };
  let reloj = Date.parse('2026-11-13T12:00:00Z');
  const ahora = () => new Date(reloj);
  const primera = await torreAvancys({ config, fetchImpl, ahora });
  assert.equal(primera.desde_memoria, false);
  reloj += 10 * 60 * 1000;
  assert.equal((await torreAvancys({ config, fetchImpl, ahora })).desde_memoria, true);
  assert.equal(logins, 1);
  assert.equal((await torreAvancys({ config, fetchImpl, ahora, refrescar: true })).desde_memoria, false);
  reloj += 31 * 60 * 1000;
  assert.equal((await torreAvancys({ config, fetchImpl, ahora })).desde_memoria, false);
  assert.equal(logins, 3);
  olvidarTorre();
});

test('cartera: saldo, vencido, tramos por antigüedad del vencimiento y quién debe más', async () => {
  // Facturas de mentira: [vence, saldo, cliente].
  const FACTURAS = [
    ['2026-12-01', 50, [1, 'A']], ['2026-11-01', 30, [1, 'A']], ['2026-10-01', 20, [2, '[900] B']],
    ['2026-09-01', 10, [2, '[900] B']], ['2026-07-01', 5, [3, 'C']],
  ];
  const llamadas = [];
  const ejecutar = async (modelo, metodo, args, kwargs) => {
    llamadas.push({ modelo, args, kwargs });
    const filtro = args[0];
    const pasa = ([vence]) => filtro.every(([campo, op, valor]) => campo !== 'invoice_date_due' || (op === '<' ? vence < valor : vence >= valor));
    const filas = FACTURAS.filter(pasa);
    if (!args[2].length) return [{ amount_residual: filas.reduce((s, f) => s + f[1], 0), __count: filas.length }];
    const por = new Map();
    for (const [, saldo, cliente] of filas) {
      const g = por.get(cliente[0]) || { partner_id: cliente, amount_residual: 0, __count: 0 };
      g.amount_residual += saldo; g.__count += 1; por.set(cliente[0], g);
    }
    return [...por.values()].sort((a, b) => b.amount_residual - a.amount_residual);
  };
  const r = await carteraVencida(ejecutar, { hoy: '2026-11-13' });
  assert.deepEqual(r.total, { saldo: 115, facturas: 5 });
  assert.deepEqual(r.vencido, { saldo: 65, facturas: 4 });
  assert.deepEqual(r.tramos.map(t => [t.tramo, t.saldo]), [['1 a 30 días', 30], ['31 a 60 días', 20], ['61 a 90 días', 10], ['Más de 90 días', 5]]);
  assert.deepEqual(r.deudores.map(d => [d.cliente, d.vencido]), [['A', 30], ['[900] B', 30], ['C', 5]]);
  assert.ok(llamadas.every(l => l.modelo === 'account.move' && l.args[0][0][2] === 'out_invoice'));
});
