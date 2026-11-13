import assert from 'node:assert/strict';
import test from 'node:test';
import { calcularTorre, marcarMeses, mesDeEtiqueta, olvidarTorre, resultadoPorMes, torreAvancys } from '../avancys-torre.js';

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
  ], '2026-11');
  assert.deepEqual(meses.map(fila => [fila.mes, fila.estado]), [
    ['2026-08', 'cerrado'], ['2026-09', 'cerrado'], ['2026-10', 'parcial'], ['2026-11', 'parcial'],
  ]);
  assert.match(meses[2].motivo, /nómina/);
  assert.equal(meses[3].motivo, 'Mes en curso');
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
      }).map(([etiqueta, cuenta, monto], i) => ({ 'date:month': etiqueta, general_account_id: [i + 1, cuenta], amount: monto, __count: 1 }));
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
