import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

async function loadModule(relativePath) {
  const result = await build({ entryPoints: [new URL(relativePath, import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const { deriveCalidadFuentes, cadenciaEnDias, resumenCalidad, ETIQUETAS_ESTADO } = await loadModule('../src/siio/fuentesCalidad.ts');

const HOY = new Date('2026-10-21T12:00:00Z');
const fuente = (id, fields) => ({ id, name: `Fuente ${id}`, source_type: 'Archivo', trust_level: 'oficial', status: 'activa', update_frequency: 'mensual', last_reviewed_at: null, next_review_at: null, ...fields });
const porId = filas => new Map(filas.map(fila => [fila.id, fila]));

test('la frecuencia escrita en texto libre se traduce a días, y lo que no se entiende no inventa cadencia', () => {
  assert.equal(cadenciaEnDias('mensual'), 31);
  assert.equal(cadenciaEnDias('diaria'), 1);
  assert.equal(cadenciaEnDias('bajo demanda'), null);
  assert.equal(cadenciaEnDias('bajo demanda (diaria cuando exista cuenta de servicio)'), null);
  assert.equal(cadenciaEnDias(null), null);
  assert.equal(cadenciaEnDias('cuando toque'), null);
});

test('una fuente mensual con el corte del mes pasado está al día; con dos meses, atrasada', () => {
  const filas = porId(deriveCalidadFuentes({
    // Tipos distintos: cada una se juzga sola. Dos cortes del MISMO tipo es otro caso, más abajo.
    sources: [fuente('A', { source_type: 'Libro contable' }), fuente('B', { source_type: 'Nómina' })],
    financialMetrics: [
      { source_id: 'A', period_month: '2026-09-01', concept: 'INGRESOS' },
      { source_id: 'B', period_month: '2026-08-01', concept: 'INGRESOS' },
    ],
  }, HOY));
  assert.equal(filas.get('A').estado, 'al_dia');
  assert.match(filas.get('A').lectura, /dentro de lo que promete/);
  assert.equal(filas.get('B').estado, 'atrasada');
  assert.match(filas.get('B').lectura, /se esperaba hace/);
});

test('sin frecuencia comprometida no se juzga el atraso', () => {
  const [fila] = deriveCalidadFuentes({
    sources: [fuente('A', { update_frequency: 'bajo demanda' })],
    financialMetrics: [{ source_id: 'A', period_month: '2025-01-01', concept: 'INGRESOS' }],
  }, HOY);
  assert.equal(fila.estado, 'sin_cadencia');
  assert.match(fila.lectura, /no se juzga su atraso/);
});

test('la versión reemplazada del mismo tipo de fuente queda como antecedente, no como activa', () => {
  const filas = porId(deriveCalidadFuentes({
    sources: [fuente('FIN-NUEVA'), fuente('FIN-VIEJA'), fuente('OTRA', { source_type: 'Correo' })],
    financialMetrics: [{ source_id: 'FIN-NUEVA', period_month: '2026-09-01', concept: 'INGRESOS' }],
  }, HOY));
  assert.equal(filas.get('FIN-NUEVA').estado, 'al_dia');
  assert.equal(filas.get('FIN-VIEJA').estado, 'antecedente');
  assert.match(filas.get('FIN-VIEJA').lectura, /otra versión de la misma fuente la reemplazó/);
  // Una fuente de otro tipo sin dato no es un antecedente: simplemente no alimenta nada.
  assert.equal(filas.get('OTRA').estado, 'sin_dato');
});

// Caso real: cada archivo contable cargado crea su propia entrada. El libro de abril nunca va a
// traer mayo, así que llamarlo "atrasado" sería mentir; es el corte de abril y sigue siendo válido.
test('el corte viejo de un mismo tipo es histórico, no una fuente atrasada', () => {
  const filas = porId(deriveCalidadFuentes({
    sources: [fuente('FIN-ABRIL'), fuente('FIN-AGOSTO')],
    financialMetrics: [
      { source_id: 'FIN-ABRIL', period_month: '2026-04-01', concept: 'INGRESOS' },
      { source_id: 'FIN-AGOSTO', period_month: '2026-08-01', concept: 'INGRESOS' },
    ],
  }, HOY));
  assert.equal(filas.get('FIN-ABRIL').estado, 'historica');
  assert.match(filas.get('FIN-ABRIL').lectura, /sigue siendo válido para ese periodo/);
  assert.match(filas.get('FIN-ABRIL').lectura, /la de 31 de agosto de 2026/);
  // La vigente del tipo sí se juzga: agosto, a 51 días, con promesa mensual.
  assert.equal(filas.get('FIN-AGOSTO').estado, 'atrasada');
});

test('un periodo abierto de Programación no cuenta como corte terminado', () => {
  const [fila] = deriveCalidadFuentes({
    sources: [fuente('SRC-PROG-PROGRAMACION', { source_type: 'Aplicación SIIO' })],
    programacionHoras: [
      { periodo_fin: '2026-08-23', periodo_estado: 'cerrado' },
      { periodo_fin: '2026-11-23', periodo_estado: 'abierto' },
    ],
  }, HOY);
  assert.equal(fila.ultimoDato, '2026-08-23');
  assert.equal(fila.estado, 'atrasada');
});

test('operaciones y programación se fechan con su propio corte', () => {
  const filas = porId(deriveCalidadFuentes({
    sources: [
      fuente('SRC-OPS-SECURITYOPS', { update_frequency: 'diaria', source_type: 'Sistema' }),
      fuente('SRC-PROG-PROGRAMACION', { update_frequency: 'mensual', source_type: 'Aplicación SIIO' }),
    ],
    operationsMetrics: [{ extracted_at: '2026-10-14T02:28:01+00:00' }, { extracted_at: '2026-10-10T00:00:00+00:00' }],
    programacionHoras: [{ periodo_fin: '2026-08-23', periodo_estado: 'cerrado' }, { periodo_fin: '2026-11-23', periodo_estado: 'cerrado' }],
  }, HOY));
  // SecurityOps se declara diaria y su última extracción es del 14-oct: atrasada.
  assert.equal(filas.get('SRC-OPS-SECURITYOPS').estado, 'atrasada');
  assert.equal(filas.get('SRC-OPS-SECURITYOPS').antiguedadDias, 7);
  // Programación toma el corte más reciente que puso en la Torre.
  assert.equal(filas.get('SRC-PROG-PROGRAMACION').ultimoDato, '2026-11-23');
});

test('se marca cuál alimenta las cifras mostradas y el orden pone primero lo atrasado', () => {
  const filas = deriveCalidadFuentes({
    sources: [fuente('SIN', { source_type: 'Correo' }), fuente('ATRASADA', { source_type: 'Libro contable' }), fuente('ALDIA', { source_type: 'Nómina' })],
    financialMetrics: [
      { source_id: 'ATRASADA', period_month: '2026-07-01', concept: 'INGRESOS' },
      { source_id: 'ALDIA', period_month: '2026-09-01', concept: 'INGRESOS' },
    ],
    evidenceSourceIds: ['ALDIA'],
  }, HOY);
  assert.deepEqual(filas.map(fila => fila.estado), ['atrasada', 'al_dia', 'sin_dato']);
  assert.equal(filas.find(fila => fila.id === 'ALDIA').alimentaLoMostrado, true);
  assert.equal(filas.find(fila => fila.id === 'ATRASADA').alimentaLoMostrado, false);
  const conteo = resumenCalidad(filas);
  assert.deepEqual([conteo.total, conteo.atrasadas, conteo.alDia], [3, 1, 1]);
  assert.equal(ETIQUETAS_ESTADO.atrasada, 'Atrasada');
});

test('una fuente sin ningún dato no finge una fecha', () => {
  const [fila] = deriveCalidadFuentes({ sources: [fuente('A', { source_type: 'Correo' })] }, HOY);
  assert.equal(fila.ultimoDato, null);
  assert.equal(fila.antiguedadDias, null);
  assert.equal(fila.estado, 'sin_dato');
});
