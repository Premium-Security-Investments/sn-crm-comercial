import assert from 'node:assert/strict';
import test from 'node:test';
import { calcularTorre, carteraVencida, creditosAvancys, marcarMeses, mesDeEtiqueta, olvidarTorre, resultadoPorMes, torreAvancys } from '../avancys-torre.js';

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
  // Si la consulta de turnos no devuelve un número, la Torre no afirma nada sobre la programación.
  assert.equal(r.programaciones_avancys, null);
});

test('turnos programados en Avancys: se cuentan las programaciones del módulo de turnos', async () => {
  const { ejecutar: base } = odoo();
  const ejecutar = async (modelo, metodo, ...resto) => (modelo === 'hr.roster.programacion' && metodo === 'search_count' ? 0 : base(modelo, metodo, ...resto));
  const r = await calcularTorre(ejecutar, { ahora: () => new Date('2026-11-13T12:00:00Z') });
  assert.equal(r.programaciones_avancys, 0);
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

// Evalúa un dominio de Odoo (notación polaca con '|' y '&') sobre una partida de mentira.
function cumple(dominio, fila) {
  let i = 0;
  const hoja = ([campo, op, valor]) => {
    const v = fila[campo];
    if (op === '=') return valor === false ? v === false || v === undefined || v === null : v === valor;
    if (op === '!=') return valor === false ? !(v === false || v === undefined || v === null) : v !== valor;
    if (op === '<') return v !== false && v < valor;
    if (op === '>=') return v !== false && v >= valor;
    if (op === '=like') return String(v).startsWith(valor.replace('%', ''));
    throw new Error(`operador ${op}`);
  };
  const expr = () => {
    const t = dominio[i++];
    if (t === '|') { const a = expr(); const b = expr(); return a || b; }
    if (t === '&') { const a = expr(); const b = expr(); return a && b; }
    return hoja(t);
  };
  let todo = true;
  while (i < dominio.length) todo = expr() && todo;
  return todo;
}

test('cartera: sale de la contabilidad (incluye lo que vino de Yeminus), por antigüedad del vencimiento, por NIT y con las consignaciones sin identificar', async () => {
  // Partidas abiertas de mentira; las de julio son saldos iniciales de Yeminus con su vencimiento original.
  const base = { parent_state: 'posted', reconciled: false, 'account_id.internal_type': 'receivable' };
  const PARTIDAS = [
    { ...base, 'account_id.code': '13050500', date: '2026-11-05', date_maturity: '2026-12-01', amount_residual: 50, partner_id: [1, 'A'] },
    { ...base, 'account_id.code': '13050500', date: '2026-10-01', date_maturity: '2026-11-01', amount_residual: 30, partner_id: [1, 'A'] },
    { ...base, 'account_id.code': '13051000', date: '2026-09-01', date_maturity: '2026-10-01', amount_residual: 20, partner_id: [2, '[SEDE NORTE] [900111222] B'] },
    { ...base, 'account_id.code': '13050500', date: '2026-08-10', date_maturity: '2026-09-01', amount_residual: 10, partner_id: [3, '[900111222] B'] },
    { ...base, 'account_id.code': '13050500', date: '2026-07-31', date_maturity: '2025-01-15', amount_residual: 400, partner_id: [4, '[UND 1] [800333444] C'] },
    { ...base, 'account_id.code': '13050500', date: '2026-07-31', date_maturity: false, amount_residual: -8, partner_id: [4, '[UND 1] [800333444] C'] },
    { ...base, 'account_id.code': '13051500', date: '2026-10-20', date_maturity: false, amount_residual: -77, partner_id: false },
  ];
  const llamadas = [];
  const ejecutar = async (modelo, metodo, args, kwargs) => {
    llamadas.push({ modelo });
    const filas = PARTIDAS.filter(fila => cumple(args[0], fila));
    if (!args[2].length) return [{ amount_residual: filas.reduce((suma, f) => suma + f.amount_residual, 0), __count: filas.length }];
    const por = new Map();
    for (const f of filas) {
      const g = por.get(f.partner_id[0]) || { partner_id: f.partner_id, amount_residual: 0, __count: 0 };
      g.amount_residual += f.amount_residual; g.__count += 1; por.set(f.partner_id[0], g);
    }
    return [...por.values()];
  };
  const r = await carteraVencida(ejecutar, { hoy: '2026-11-13' });
  assert.deepEqual(r.total, { saldo: 502, facturas: 6 });
  // La nota sin vencimiento de julio cuenta desde su fecha contable: está vencida, más de 90 días.
  assert.deepEqual(r.vencido, { saldo: 452, facturas: 5 });
  assert.deepEqual(r.tramos.map(t => [t.tramo, t.saldo]), [['1 a 30 días', 30], ['31 a 60 días', 20], ['61 a 90 días', 10], ['Más de 90 días', 392]]);
  assert.deepEqual(r.heredado_yeminus, { saldo: 392, facturas: 2 });
  assert.deepEqual(r.consignaciones_sin_identificar, { saldo: 77, partidas: 1 });
  // Las sedes de un mismo NIT se suman: B debe 30 entre sus dos sedes.
  assert.deepEqual(r.deudores.map(d => [d.cliente, d.vencido]), [['[UND 1] [800333444] C', 392], ['A', 30], ['[SEDE NORTE] [900111222] B', 30]]);
  assert.ok(llamadas.every(l => l.modelo === 'account.move.line'));
});

test('créditos: los registrados salen de Avancys con tasa, cuota y vencimiento; la deuda contable sin obligación se dice', async () => {
  const llamadas = [];
  const ejecutar = async (modelo, metodo, args) => {
    llamadas.push({ modelo, metodo, dominio: args[0] });
    if (modelo === 'account.loan') return [{ id: 7, loan_no: 'OB-1', partner_id: [3, '[900111222] BANCO DEMO'], balance: 1200e6, balance_debt: 1000e6, intrest_per_period: 1, period_no: 1, periods_to_pay: 12, remain_period: 10, payment_date: '2026-08-01' }];
    if (modelo === 'loan.move.line') return [
      { loan_id: [7, 'OB-1'], date: '2026-10-01', total_payment: 110 },
      { loan_id: [7, 'OB-1'], date: '2026-12-01', total_payment: 105 },
      { loan_id: [7, 'OB-1'], date: '2027-07-01', total_payment: 101 },
    ];
    if (modelo === 'account.move.line') return [
      { partner_id: [3, '[900111222] BANCO DEMO'], balance: -1000.5e6 },
      { partner_id: [4, '[900333444] OTRO BANCO'], balance: -300e6 },
      { partner_id: [5, '[900555666] CASI NADA'], balance: -0.5e6 },
    ];
    return [];
  };
  const r = await creditosAvancys(ejecutar, { hoy: '2026-11-14' });
  assert.deepEqual(llamadas[0].dominio, [['state', '=', 'in_progress'], ['loan_type', '=', 'por_pagar']]);
  assert.deepEqual(llamadas[2].dominio, [['account_id.code', '=like', '21%'], ['parent_state', '=', 'posted']]);
  const [ob] = r.registradas;
  assert.equal(ob.banco, 'BANCO DEMO');
  assert.equal(ob.tasa_ea, 12.68, '1 % mensual compuesto doce veces');
  assert.deepEqual(ob.proxima_cuota, { fecha: '2026-12-01', valor: 105 });
  assert.equal(ob.fecha_final, '2027-07-01');
  // La obligación registrada cubre su banco (por NIT) hasta un millón de diferencia; lo demás se dice, y los saldos menores no.
  assert.deepEqual(r.sin_registrar.map(fila => [fila.tercero, fila.diferencia]), [['OTRO BANCO', 300e6]]);
  assert.equal(r.saldo_registrado, 1000e6);
  assert.equal(r.deuda_contable, 1301e6);
});
