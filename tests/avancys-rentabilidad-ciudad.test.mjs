import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarCiudad, ciudadDeCuentaAnalitica, festivosDeColombia, recargoDominical, fraccionNocturna, fraccionDominical,
  factorDeRecargos, bolsaDeCuenta, repartirPorCiudad, rentabilidadAproximada,
} from '../avancys-acceso.js';

// Rentabilidad por cliente con costo por ciudad y recargos (Juan, 2026-11-19: «todo lo que pueda mejorar el dato»).

test('la ciudad sale de la línea o del nombre de la cuenta analítica, sin tildes ni «D.C.»', () => {
  assert.equal(normalizarCiudad('Bogota D.C'), 'BOGOTA');
  assert.equal(normalizarCiudad('Tuluá'), 'TULUA');
  assert.equal(ciudadDeCuentaAnalitica('SEGURIDAD NACIONAL LTDA--PEREIRA---VIGILANCIA FISICA VIGILANTES'), 'PEREIRA');
  assert.equal(ciudadDeCuentaAnalitica('SEGURIDAD NACIONAL LTDA-CUNDINAMARCA-BOGOTA D.C---VIGILANCIA FISICA VIGILANTES'), 'BOGOTA');
  assert.equal(ciudadDeCuentaAnalitica('JERONIMO MARTINS COLOMBIA S.A.S-02 - VALLE DEL CAUCA-CALI-VIGILANCIA FISICA-T1713 TIENDA ARA DECEPAZ- - JERONIMO MARTINS COLOMBIA S.A.S'), 'CALI');
  assert.equal(ciudadDeCuentaAnalitica('FEDERACION NACIONAL DE CAFETEROS DE COLOMBIA--MANIZALES-VIGILANCIA FISICA-RECINTO'), 'MANIZALES');
  assert.equal(ciudadDeCuentaAnalitica('SEGURIDAD NACIONAL LTDA--BALBOA-COMERCIALIZACION--AREA COMERCIAL'), 'BALBOA');
  assert.equal(ciudadDeCuentaAnalitica('CONJUNTO'), null);
});

test('festivos de Colombia 2026 con la Ley Emiliani y la Pascua', () => {
  const f = festivosDeColombia(2026);
  for (const dia of ['2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03', '2026-05-01', '2026-05-18', '2026-06-08',
    '2026-06-15', '2026-06-29', '2026-07-20', '2026-08-07', '2026-08-17', '2026-10-12', '2026-11-02', '2026-11-16', '2026-12-08', '2026-12-25']) {
    assert.ok(f.has(dia), `falta ${dia}`);
  }
  assert.equal(f.size, 18);
});

test('recargos de ley: dominical por tramos (Ley 2466) y nocturno desde las 7 p. m.', () => {
  assert.equal(recargoDominical('2026-06'), 0.8);
  assert.equal(recargoDominical('2026-09'), 0.9);
  assert.equal(recargoDominical('2027-07'), 1);
  // 6 p. m. a 6 a. m.: 11 de 12 horas nocturnas desde dic-2025; antes la noche empezaba a las 9.
  assert.equal(fraccionNocturna({ entrada: '18:00:00', salida: '06:00:00', mes: '2026-09' }), 11 / 12);
  assert.equal(fraccionNocturna({ entrada: '18:00:00', salida: '06:00:00', mes: '2025-10' }), 9 / 12);
  assert.equal(fraccionNocturna({ entrada: '06:00:00', salida: '18:00:00', mes: '2026-09' }), 0);
  assert.equal(fraccionNocturna({ entrada: '06:00:00', salida: '06:00:00', mes: '2026-09' }), 11 / 24);
  // Turno partido de la modalidad: 09-13 y 17-21 → 2 de 8 horas de noche.
  assert.equal(fraccionNocturna({ modalidad: 'JMC 5X1 08 HORAS LUN-DOM 09-13/17-21', mes: '2026-09' }), 2 / 8);
  assert.equal(fraccionNocturna({ entrada: false, salida: false }), null);
});

test('qué parte de los días del puesto es domingo o festivo', () => {
  // Septiembre de 2026: 4 domingos, sin festivos, 30 días.
  assert.equal(fraccionDominical({ dias: [1, 2, 3, 4, 5, 6, 7], mes: '2026-09' }), 4 / 30);
  assert.equal(fraccionDominical({ dias: [1, 2, 3, 4, 5], mes: '2026-09' }), 0);
  // Noviembre de 2026: 5 domingos y dos festivos lunes (2 y 16); de lunes a viernes sin festivos no hay recargo.
  assert.equal(fraccionDominical({ dias: [], mes: '2026-11' }), 7 / 30);
  assert.equal(fraccionDominical({ dias: [1, 2, 3, 4, 5], festivos: false, mes: '2026-11' }), 0);
  assert.equal(fraccionDominical({ dias: [1, 2, 3, 4, 5, 8], mes: '2026-11' }), 2 / 21);
  assert.ok(Math.abs(factorDeRecargos({ nocturna: 0.5, dominical: 0.1, mes: '2026-09' }) - (1 + 0.175 + 0.09)) < 1e-12);
});

test('cada costo va a su bolsa por la cuenta contable, no por el nombre del centro', () => {
  const centro = 'SEGURIDAD NACIONAL LTDA-03 - ANTIOQUIA-MEDELLIN---VIGILANCIA FISICA OPERACIONES';
  assert.equal(bolsaDeCuenta({ codigo: '72010600', nombre: 'SUELDO VIGILANTES', centro }), 'vigilantes');
  assert.equal(bolsaDeCuenta({ codigo: '51103500', nombre: 'COMISION ESU', centro }), 'administracion');
  assert.equal(bolsaDeCuenta({ codigo: '73010100', nombre: 'SUELDOS SUPERVISORES / ESCOLTAS', centro }), 'operacion');
  assert.equal(bolsaDeCuenta({ codigo: '73050100', nombre: 'DOTACION UNIFORMES', centro }), 'operacion');
  assert.equal(bolsaDeCuenta({ codigo: '72500100', nombre: 'SUELDO TECNICOS', centro }), 'tecnologia');
  assert.equal(bolsaDeCuenta({ codigo: '73050100', nombre: 'DOTACION UNIFORMES', centro: 'SEGURIDAD NACIONAL LTDA--PEREIRA---VIGILANCIA FISICA VIGILANTES' }), 'vigilantes');
  assert.equal(bolsaDeCuenta({ codigo: '53050500', nombre: 'INTERESES', centro }), 'no_se_reparte');
  assert.equal(bolsaDeCuenta({ codigo: '54050500', nombre: 'IMPUESTO DE RENTA', centro }), 'no_se_reparte');
});

test('el reparto por ciudad conserva el total y cobra a cada ciudad su propio costo por hora', () => {
  const bolsas = new Map([['PEREIRA', -1000], ['BOGOTA', -3000], ['NACIONAL', -100]]);
  const lineas = [
    { id: 'pereira', ciudad: 'PEREIRA', horas: 100 },
    { id: 'bogota', ciudad: 'BOGOTA', horas: 100 },
    { id: 'sin', ciudad: null, horas: 50 },
  ];
  const r = repartirPorCiudad(bolsas, lineas, { peso: l => l.horas, centroDe: l => l.ciudad });
  const total = [...r.asignado.values()].reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(total - -4100) < 1e-9, 'lo repartido suma lo que dice Avancys');
  const [p, b, s] = lineas.map(l => r.asignado.get(l));
  assert.ok(Math.abs(b / p - 3) < 1e-9, 'Bogotá cuesta el triple por hora que Pereira');
  assert.ok(s < 0 && Math.abs(s / 50 - (-4100 / 250) * r.ajuste) < 1e-9, 'la línea sin ciudad va al promedio nacional');
  assert.equal(r.cubierto, 200 / 250);
});

// Un mes con dos ciudades: Pereira barata y Cali cara; un cliente en cada una con las mismas horas.
function mesConCiudades() {
  const CUENTAS = [
    { id: 1, nombre: '41559501 AIU SERVICIO VIGILANCIA' },
    { id: 2, nombre: '72010600 SUELDO VIGILANTES' },
    { id: 3, nombre: '51050101 SALARIO INTEGRAL' },
    { id: 4, nombre: '54050500 IMPUESTO DE RENTA' },
  ];
  const ANALITICAS = {
    10: { id: 10, name: 'CLIENTE P-01 - RISARALDA-PEREIRA-VIGILANCIA FISICA-PORTERIA', partner_id: [500, 'CLIENTE PEREIRA'] },
    11: { id: 11, name: 'CLIENTE C-02 - VALLE DEL CAUCA-CALI-VIGILANCIA FISICA-PORTERIA', partner_id: [600, 'CLIENTE CALI'] },
    20: { id: 20, name: 'SEGURIDAD NACIONAL LTDA--PEREIRA---VIGILANCIA FISICA VIGILANTES', partner_id: [1, 'SEGURIDAD NACIONAL LTDA'] },
    21: { id: 21, name: 'SEGURIDAD NACIONAL LTDA-VALLE DEL CAUCA-CALI---VIGILANCIA FISICA VIGILANTES', partner_id: [1, 'SEGURIDAD NACIONAL LTDA'] },
    22: { id: 22, name: 'SEGURIDAD NACIONAL LTDA-01 - RISARALDA-PEREIRA---VIGILANCIA FISICA GERENCIA GENERAL', partner_id: [1, 'SEGURIDAD NACIONAL LTDA'] },
  };
  // [cuenta analítica, cuenta contable, monto]
  const MOVIMIENTOS = [[10, 1, 2000], [11, 1, 2000], [20, 2, -1000], [21, 2, -1500], [22, 3, -400], [22, 4, -300]];
  const ejecutar = async (modelo, metodo, args, kwargs = {}) => {
    if (modelo === 'account.analytic.account') return args[0][0][2].map(id => ANALITICAS[id]);
    if (modelo === 'project.project') return [];
    if (modelo === 'hr.contract') return [{ work_city_id: [1, 'Palmira'], analytic_distribution_ids: [9] }];
    if (modelo === 'hr.contract.analytic.distribution') return [{ id: 9, analytic_account_id: [21, '[VFCLVI] SEGURIDAD NACIONAL LTDA-VALLE DEL CAUCA-CALI---VIGILANCIA FISICA VIGILANTES - SEGURIDAD NACIONAL LTDA'] }];
    if (modelo === 'project.service.order.line') {
      if (metodo === 'fields_get') return { partner_id: {}, product_id: {}, time_in: {}, time_out: {}, duration: {}, dias_facturables: {}, city_id: {}, weekdays: {} };
      return [
        { partner_id: [500, 'CLIENTE PEREIRA'], product_id: [1, '[VI002] VIGILANCIA'], duration: 24, time_in: '06:00:00', time_out: '06:00:00', dias_facturables: 30, city_id: [1, 'Pereira'], weekdays: [] },
        // Palmira no tiene centro: sus guardas los paga Cali (lo dice el contrato).
        { partner_id: [600, 'CLIENTE CALI'], product_id: [1, '[VI002] VIGILANCIA'], duration: 24, time_in: '06:00:00', time_out: '06:00:00', dias_facturables: 30, city_id: [2, 'Palmira'], weekdays: [] },
      ];
    }
    // read_group sobre las líneas analíticas.
    const [filtro, , agrupar] = args;
    const condicion = campo => filtro.find(c => Array.isArray(c) && c[0] === campo)?.[2];
    const cuentas = condicion('general_account_id');
    const analiticas = condicion('account_id');
    const filas = MOVIMIENTOS.filter(([a, g]) => (!cuentas || cuentas.includes(g)) && (!analiticas || analiticas.includes(a)));
    const nombre = g => [g, CUENTAS.find(c => c.id === g).nombre];
    if (agrupar.length === 1 && agrupar[0] === 'general_account_id') return CUENTAS.map(c => ({ general_account_id: [c.id, c.nombre], amount: 1, __count: 1 }));
    if (agrupar.length === 2) return filas.map(([a, g, m]) => ({ account_id: [a, ANALITICAS[a].name], general_account_id: nombre(g), amount: m, __count: 1 }));
    const porCuenta = new Map();
    for (const [a, , m] of filas) porCuenta.set(a, (porCuenta.get(a) || 0) + m);
    return [...porCuenta].map(([a, m]) => ({ account_id: [a, ANALITICAS[a].name], amount: m, __count: 1 }));
  };
  return ejecutar;
}

test('rentabilidad: cada cliente paga los guardas de su ciudad y la renta no se reparte', async () => {
  const r = await rentabilidadAproximada(mesConCiudades(), { mes: '2026-09' });
  assert.equal(r.legible, true, r.motivo);
  assert.equal(r.metodo, 'ciudad-y-recargos');
  const pereira = r.clientes.find(c => c.cliente === 'CLIENTE PEREIRA');
  const cali = r.clientes.find(c => c.cliente === 'CLIENTE CALI');
  assert.ok(Math.abs(pereira.costo_vigilantes - -1000) < 1e-6, 'Pereira paga la nómina de Pereira');
  assert.ok(Math.abs(cali.costo_vigilantes - -1500) < 1e-6, 'Palmira paga la nómina de Cali');
  assert.ok(Math.abs(pereira.costo_administracion - -200) < 1e-6, 'la administración por facturación, mitad y mitad');
  assert.equal(r.fondo.no_se_reparte, -300);
  assert.ok(Math.abs(pereira.margen - (2000 - 1000 - 200)) < 1e-6);
  assert.equal(r.reparto.ciudades_mapeadas, 1);
  assert.ok(pereira.costo_hora < 0 && Math.abs(pereira.costo_hora - -1000 / 720) < 1e-9);
});
