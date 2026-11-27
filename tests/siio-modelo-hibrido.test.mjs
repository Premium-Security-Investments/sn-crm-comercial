// Cotizador de modelos de servicio (Gerencia). Datos inventados: los del cliente viven en la base, nunca aquí.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularModelo, resumirZonas, unidadesDeTurno } from '../src/siio/modelo-hibrido.js';

const tienda = (zona, nivel, puestos, valor, merma = 1) => ({ zona, nivel, puestos, valor, merma });
const tiendas = [
  ...Array.from({ length: 4 }, () => tienda('Norte', 'A', 1, 8)),
  tienda('Norte', 'A', 0, 0),
  ...Array.from({ length: 10 }, () => tienda('Norte', 'B', 1, 7)),
  ...Array.from({ length: 10 }, () => tienda('Norte', 'C', 1, 6)),
  ...Array.from({ length: 6 }, () => tienda('Sur', 'C', 1, 5, 2)),
];
const supuestos = {
  zonas: { Norte: { enModelo: true, margen: 0.2, supervisoresHoy: 1 }, Sur: { enModelo: false, margen: 0.25, supervisoresHoy: 0.5 } },
  precioUnidad: 15, analitica: 2,
  proporciones: { A: { dia: 10, noche: 10 }, B: { dia: 5, noche: 10 }, C: { dia: 10, noche: 20 } },
  personasPorTurno: 2, costoPersona: 6, costoAnalitica: 0.5, valorGuardaNuevo: 7, reduccionMerma: 0.1,
  opcionE: { analitica: 1, parteMerma: 0.5 },
  opciones: [{ codigo: 'A', analitica: 2 }, { codigo: 'D', analitica: 1 }, { codigo: 'E' }],
};

test('resume las tiendas por zona, con las A sin guarda aparte', () => {
  const [norte, sur] = resumirZonas(tiendas);
  assert.equal(norte.tiendas, 25);
  assert.deepEqual([norte.A, norte.B, norte.C], [5, 10, 10]);
  assert.equal(norte.puestos, 24);
  assert.equal(norte.tiendasASinGuarda, 1);
  assert.equal(norte.valorA, 32);
  assert.equal(sur.tiendas, 6);
});

test('las unidades de un turno suman las fracciones de cada nivel y redondean hacia arriba', () => {
  // Día: 5/10 + 10/5 + 10/10 = 3,5 → 4. Noche: 5/10 + 10/10 + 10/20 = 2.
  assert.equal(unidadesDeTurno({ A: 5, B: 10, C: 10 }, supuestos.proporciones, 'dia'), 4);
  assert.equal(unidadesDeTurno({ A: 5, B: 10, C: 10 }, supuestos.proporciones, 'noche'), 2);
  // 15 tiendas C a 1 cada 5 da exacto 3, no 4.
  assert.equal(unidadesDeTurno({ C: 15 }, { C: { dia: 5 } }, 'dia'), 3);
  // Una proporción en cero no se puede usar.
  assert.equal(unidadesDeTurno({ B: 3 }, { B: { dia: 0 } }, 'dia'), null);
});

test('la zona del modelo conserva las A, suma unidades y analítica; la que no entra queda igual', () => {
  const r = calcularModelo(tiendas, supuestos);
  const norte = r.zonas.find(z => z.zona === 'Norte');
  const sur = r.zonas.find(z => z.zona === 'Sur');
  assert.equal(norte.valor, 32 + 70 + 60);
  assert.equal(norte.guardasModelo, 5);             // 4 puestos A + 1 tienda A que pasa a tener guarda
  assert.equal(norte.valorGuardasModelo, 32 + 7);
  assert.equal(norte.unidades, 6);
  assert.equal(norte.valorUnidades, 90);
  assert.equal(norte.valorAnalitica, 50);
  assert.equal(norte.totalModelo, 39 + 90 + 50);
  assert.equal(norte.frenteAHoy, 179 - 162);
  assert.equal(sur.totalModelo, sur.valor);
  assert.equal(sur.frenteAHoy, 0);
  // El total solo suma las zonas que entran al modelo.
  assert.equal(r.total.tiendas, 25);
  assert.equal(r.total.valor, 162);
});

test('nuestro lado: hoy los supervisores salen del margen; con el modelo se cobran', () => {
  const r = calcularModelo(tiendas, supuestos);
  const norte = r.zonas.find(z => z.zona === 'Norte');
  assert.equal(norte.margenHoy, 162 * 0.2 - 6);
  assert.equal(norte.personasUnidades, 12);
  assert.ok(Math.abs(norte.costoModelo - (39 * 0.8 + 12 * 6 + 25 * 0.5)) < 1e-9);
  assert.equal(r.unidad.costo, 12);
  assert.ok(Math.abs(r.unidad.margenPct - 0.2) < 1e-9);
  assert.equal(r.unidad.pierde, false);
  assert.equal(calcularModelo(tiendas, { ...supuestos, precioUnidad: 12 }).unidad.pierde, true);
});

test('las opciones cambian solo la analítica; la E suma la parte de la merma evitada', () => {
  const r = calcularModelo(tiendas, supuestos);
  const [a, d, e] = r.opciones;
  assert.equal(a.paga, 129 + 50);
  assert.equal(d.paga, 129 + 25);
  assert.equal(e.parteMerma, 25 * 0.1 * 0.5);
  assert.equal(e.paga, 129 + 25 + 1.25);
  assert.equal(r.escenariosMerma[1].beneficio, 2.5 - 17);
});

test('una zona fuera del modelo no pide proporciones ni suma unidades', () => {
  const r = calcularModelo(tiendas, { ...supuestos, zonas: { Norte: { enModelo: false }, Sur: { enModelo: false } } });
  assert.equal(r.total.tiendas, 0);
  assert.ok(r.zonas.every(z => z.unidades === 0 && !z.proporcionInvalida));
});

test('la central de monitoreo: menos puestos baja nuestro costo y sube el margen, sin tocar lo que paga el cliente', () => {
  const sin = calcularModelo(tiendas, supuestos);
  const con = calcularModelo(tiendas, { ...supuestos, central: { puestosHoy: 15, puestosModelo: 10, personasPorPuesto: 3, costoPersona: 4 } });
  assert.equal(con.total.centralPersonasHoy, 45);
  assert.equal(con.total.centralPersonasModelo, 30);
  assert.equal(con.total.ahorroCentral, 60);
  assert.equal(con.total.totalModelo, sin.total.totalModelo);
  assert.ok(Math.abs(con.total.margenModelo - (sin.total.margenModelo + 60)) < 1e-9);
  assert.ok(Math.abs(con.opciones[0].margen - (sin.opciones[0].margen + 60)) < 1e-9);
  // Sin datos de central no cambia nada.
  assert.equal(sin.total.ahorroCentral, 0);
});

test('conserva guarda con analítica: mantiene todos los guardas, suma analítica y entra al total', () => {
  const r = calcularModelo(tiendas, { ...supuestos, zonas: { ...supuestos.zonas, Sur: { modo: 'guarda_analitica', margen: 0.25, supervisoresHoy: 0.5 } } });
  const sur = r.zonas.find(z => z.zona === 'Sur');
  assert.equal(sur.modo, 'guarda_analitica');
  assert.equal(sur.unidades, 0);
  assert.equal(sur.guardasModelo, sur.puestos);
  assert.equal(sur.valorGuardasModelo, sur.valor);
  assert.equal(sur.valorAnalitica, 6 * 2);
  assert.equal(sur.frenteAHoy, 12);
  assert.equal(r.total.tiendas, 25 + 6);
  assert.ok(Math.abs(sur.margenModelo - (sur.margenHoy + 6 * (2 - 0.5))) < 1e-9);
});

test('los escenarios viejos con enModelo siguen funcionando', () => {
  const r = calcularModelo(tiendas, supuestos);
  assert.equal(r.zonas.find(z => z.zona === 'Norte').modo, 'modelo');
  assert.equal(r.zonas.find(z => z.zona === 'Sur').modo, 'fuera');
});
