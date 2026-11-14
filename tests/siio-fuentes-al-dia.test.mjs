import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

async function loadModule(relativePath) {
  const result = await build({ entryPoints: [new URL(relativePath, import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const { diasDesdeFinDeMes, fuentesAlDia } = await loadModule('../src/siio/fuentesAlDia.ts');
const hoy = new Date('2026-11-14T15:00:00Z');
const mes = (m, estado = 'cerrado', motivo = null, impuestos = 0) => ({ mes: m, estado, motivo, totales: { impuestos } });
const torre = {
  meses: [{ mes: '2026-08' }, { mes: '2026-09' }, { mes: '2026-10' }, { mes: '2026-11' }],
  bloqueo_contable: null,
  pyg: [mes('2026-08'), mes('2026-09'), mes('2026-10', 'parcial', 'Contabilidad todavía está registrando el mes'), mes('2026-11', 'parcial', 'Mes en curso')],
  programaciones_avancys: 0,
  cartera: { consignaciones_sin_identificar: { saldo: 12e6, partidas: 7 } },
};

test('cada atraso con su responsable y sus días; lo más viejo y grave primero', () => {
  const filas = fuentesAlDia({ hoy, torre, excelHasta: '2026-08', forecast: { abiertas: 20, sin_gestion: 14, dias: 30 }, historico: { falta: 'septiembre–diciembre de 2025', hasta: '2026-08' } });
  assert.deepEqual(filas.map(fila => fila.clave), ['bloqueo', 'forecast', 'renta', 'consignaciones', 'programacion', 'historico']);
  const [bloqueo, forecast] = filas;
  // Agosto lo cerró Finanzas con su Excel; septiembre y octubre son de Avancys y nadie los bloqueó.
  assert.deepEqual(bloqueo.ficha, { valor: '45 días', unidad: 'sin cierre' });
  assert.equal(bloqueo.prioridad, 'alta');
  assert.equal(bloqueo.detalle, 'ningún mes está bloqueado: septiembre lleva 45 días; octubre, 14');
  assert.equal(bloqueo.responsable, 'Contabilidad');
  assert.deepEqual(forecast.ficha, { valor: '70 %', unidad: 'sin gestión' });
  assert.equal(forecast.prioridad, 'alta');
  assert.deepEqual(filas.find(fila => fila.clave === 'historico').ficha, { valor: '4 meses', unidad: 'por cargar' });
  assert.deepEqual(filas.find(fila => fila.clave === 'consignaciones').ficha, { valor: '$12 M', unidad: 'sin aplicar' });
});

test('lo que está al día no aparece, y lo que no se pudo leer no se afirma', () => {
  const alDia = {
    ...torre,
    bloqueo_contable: '2026-10-31',
    pyg: [mes('2026-08', 'cerrado', null, -5e6), mes('2026-09', 'cerrado', null, -5e6)],
    programaciones_avancys: null,
    cartera: null,
  };
  assert.deepEqual(fuentesAlDia({ hoy, torre: alDia, excelHasta: '2026-08', forecast: { abiertas: 10, sin_gestion: 0, dias: 30 }, historico: { falta: null } }), []);
  assert.deepEqual(fuentesAlDia({ hoy, torre: null, excelHasta: null, forecast: null, historico: null }), []);
});

test('la nómina incompleta de un mes pasado es un atraso de Nómina con días', () => {
  const conNomina = { ...torre, pyg: [mes('2026-09'), mes('2026-10', 'parcial', 'La nómina del mes no está completa en la contabilidad')], programaciones_avancys: null, cartera: null };
  const nomina = fuentesAlDia({ hoy, torre: conNomina, excelHasta: '2026-08', forecast: null, historico: null }).find(fila => fila.clave === 'nomina:2026-10');
  assert.equal(nomina.responsable, 'Nómina');
  assert.deepEqual(nomina.ficha, { valor: '14 días', unidad: 'incompleta' });
  assert.equal(nomina.que, 'Nómina de octubre');
});

test('con bloqueo parcial se dice hasta dónde está bloqueado', () => {
  const parcial = fuentesAlDia({ hoy, torre: { ...torre, bloqueo_contable: '2026-09-30' }, excelHasta: '2026-08', forecast: null, historico: null }).find(fila => fila.clave === 'bloqueo');
  assert.equal(parcial.detalle, 'bloqueado hasta el 2026-09-30; octubre lleva 14 días');
  assert.equal(parcial.prioridad, 'media');
});

test('un solo conteo de días para la Portada, Resultados y Fuentes', async () => {
  const { readFileSync } = await import('node:fs');
  assert.equal(diasDesdeFinDeMes('2026-09', hoy), 45);
  assert.equal(diasDesdeFinDeMes('2026-10', hoy), 14);
  const torre = readFileSync(new URL('../src/siio/SiioTorreAvancys.tsx', import.meta.url), 'utf8');
  assert.equal((torre.match(/diasDesdeFinDeMes\(/g) || []).length, 2, 'la alerta de bloqueo y la nota de Resultados usan el mismo conteo');
  assert.doesNotMatch(torre, /finDeMes = /);
});
