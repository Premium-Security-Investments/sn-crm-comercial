import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { agregarPresupuesto, presupuestoContraEjecucion } from '../verticales/gerencial/siio-presupuesto.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Cifras inventadas: ingresos en positivo, costos en negativo, como salen de la contabilidad.
const meses = {
  '2026-09': {
    estado: 'cerrado',
    ajuste_ingresos: 100,
    cuentas: { '4155A': 900, '4155T': 200, '7201A': -500, '7202A': -250, '7250T': -150, '9999X': -7 },
  },
};
const mapeo = [
  { cuenta: '4155A', rubro: 0 }, { cuenta: '4155T', rubro: 20 }, { cuenta: '7201A', rubro: 1 }, { cuenta: '7202A', rubro: 2 }, { cuenta: '7250T', rubro: 21 },
];
const presupuestos = { 2026: { vigilancia: { salarios: 45, prestaciones: 25 }, tecnologia: { personal_monitoreo: 60 } } };

test('cada rubro es el % del ingreso de su unidad, con la provisión, contra el presupuesto del año', () => {
  const fila = presupuestoContraEjecucion({ meses, mapeo, presupuestos })['2026-09'];
  assert.equal(fila.vigilancia.ingresos, 1000);
  const salarios = fila.vigilancia.rubros.find(rubro => rubro.clave === 'salarios');
  assert.deepEqual([salarios.ejecutado, salarios.pct, salarios.presupuesto, salarios.diferencia], [500, 50, 45, 5]);
  const prestaciones = fila.vigilancia.rubros.find(rubro => rubro.clave === 'prestaciones');
  assert.deepEqual([prestaciones.pct, prestaciones.diferencia], [25, 0]);
  assert.equal(fila.vigilancia.rentabilidad, 25);
  // Faltan rubros con presupuesto pero sin gasto: el presupuesto alcanza para la rentabilidad presupuestada.
  assert.equal(fila.vigilancia.rentabilidad_presupuesto, 30);
  assert.deepEqual([fila.tecnologia.ingresos, fila.tecnologia.costos, fila.tecnologia.rentabilidad, fila.tecnologia.rentabilidad_presupuesto], [200, 150, 25, 40]);
  const monitoreo = fila.tecnologia.rubros.find(rubro => rubro.clave === 'personal_monitoreo');
  assert.deepEqual([monitoreo.pct, monitoreo.presupuesto, monitoreo.diferencia], [75, 60, 15]);
  assert.equal(fila.tecnologia.rubros.length, 20);
  assert.deepEqual(fila.sin_mapeo, [{ cuenta: '9999X', valor: -7 }]);
  assert.equal(fila.vigilancia.rubros.length, 18);
});

test('sin presupuesto del año, se muestra lo ejecutado sin comparar', () => {
  const fila = presupuestoContraEjecucion({ meses, mapeo, presupuestos: {} })['2026-09'];
  assert.equal(fila.presupuesto_anio, null);
  assert.equal(fila.vigilancia.rentabilidad_presupuesto, null);
  assert.ok(fila.vigilancia.rubros.every(rubro => rubro.diferencia === null));
});

test('la respuesta de la Torre no lleva los saldos por cuenta y sale aunque falte el mapeo o la tabla', async () => {
  const filas = [{ clave: 'mapeo_cuentas', periodo: '', valor: mapeo, estado: 'sin_confirmar' }, { clave: 'presupuesto_rubros', periodo: '2026', valor: presupuestos[2026], estado: 'confirmado' }];
  const db = resultado => ({ from: () => ({ select: () => ({ in: () => ({ is: () => Promise.resolve(resultado) }) }) }) });
  const con = await agregarPresupuesto(db({ data: filas, error: null }), { pyg: [], saldos_cuentas: meses });
  assert.equal(con.saldos_cuentas, undefined);
  assert.equal(con.presupuesto.disponible, true);
  assert.deepEqual(con.presupuesto.sin_confirmar, ['mapeo_cuentas']);
  assert.equal(con.presupuesto.meses['2026-09'].vigilancia.rentabilidad, 25);
  const sinMapeo = await agregarPresupuesto(db({ data: [], error: null }), { saldos_cuentas: meses });
  assert.equal(sinMapeo.presupuesto.disponible, false);
  const sinTabla = await agregarPresupuesto(db({ data: null, error: { message: 'relation does not exist' } }), { saldos_cuentas: meses });
  assert.equal(sinTabla.presupuesto.disponible, false);
  assert.equal(sinTabla.saldos_cuentas, undefined);
  // Si Avancys no está configurado, la respuesta pasa tal cual.
  assert.deepEqual(await agregarPresupuesto(db({ data: filas, error: null }), { configurado: false }), { configurado: false });
});

test('la Torre entra al mes en vivo y juzga a los clientes con el último mes cerrado', () => {
  const torre = read('src/siio/SiioTorreAvancys.tsx');
  assert.match(torre, /const mes = mesElegido \|\| enVivo \|\|/);
  assert.match(torre, /const k = t\.torre\?\.clientes;/);
  assert.match(read('server/index.js'), /agregarPresupuesto\(requireDb\(\), await torreAvancys\(/);
});

test('acepta el presupuesto sembrado con la forma anterior', () => {
  const fila = presupuestoContraEjecucion({ meses, mapeo, presupuestos: { 2026: { salarios: { vigilancia: 45 } } } })['2026-09'];
  assert.equal(fila.vigilancia.rubros.find(rubro => rubro.clave === 'salarios').presupuesto, 45);
});
