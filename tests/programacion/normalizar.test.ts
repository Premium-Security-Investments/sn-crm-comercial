import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectarColumnas, mapearFilas, normalizarEstado, normalizarFecha, texto } from '../../src/programacion/integracion/normalizar.ts';

test('reconoce encabezados comunes de un listado de empleados', () => {
  const m = detectarColumnas(['No.', 'CÉDULA', 'Apellidos y Nombres', 'Cargo', 'Fecha de Ingreso', 'Fecha Retiro', 'Celular'], 'empleados');
  assert.equal(m.documento, 'CÉDULA');
  assert.equal(m.nombre, 'Apellidos y Nombres');
  assert.equal(m.fecha_ingreso, 'Fecha de Ingreso');
  assert.equal(m.fecha_retiro, 'Fecha Retiro');
  assert.equal(m.telefono, 'Celular');
});

test('reconoce los campos de Odoo', () => {
  const m = detectarColumnas(['identification_id', 'name', 'job_id', 'mobile_phone', 'active'], 'empleados');
  assert.deepEqual([m.documento, m.nombre, m.cargo, m.telefono, m.estado], ['identification_id', 'name', 'job_id', 'mobile_phone', 'active']);
});

test('fechas: serie de Excel, día/mes/año y año-mes-día', () => {
  assert.equal(normalizarFecha(45716), '2025-02-28');
  assert.equal(normalizarFecha('5/3/2026'), '2026-03-05');
  assert.equal(normalizarFecha('2026-03-05 00:00:00'), '2026-03-05');
  assert.equal(normalizarFecha(''), null);
  assert.equal(normalizarFecha(false), null);
});

test('estados y valores de Odoo', () => {
  assert.equal(normalizarEstado(true), 'activo');
  assert.equal(normalizarEstado('Retirado'), 'retirado');
  assert.equal(normalizarEstado('desconocido'), null);
  assert.equal(texto([7, 'Vigilante']), 'Vigilante');
  assert.equal(texto(false), null);
});

test('mapea filas, conserva el documento numérico sin decimales y descarta filas vacías', () => {
  const filas = mapearFilas([
    { CC: 1088123456, NOMBRE: 'PÉREZ JUAN', INGRESO: 45716 },
    { CC: '', NOMBRE: '', INGRESO: '' },
  ], { documento: 'CC', nombre: 'NOMBRE', fecha_ingreso: 'INGRESO' }, 'empleados');
  assert.equal(filas.length, 1);
  assert.equal(filas[0].documento, '1088123456');
  assert.equal(filas[0].fecha_ingreso, '2025-02-28');
});

test('lee un Excel real de punta a punta: salta títulos del reporte y reconoce columnas', async () => {
  const XLSX = await import('xlsx');
  const { filasDesdeMatriz } = await import('../../src/programacion/integracion/normalizar.ts');
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([
    ['SEGURIDAD NACIONAL LTDA'], ['Listado de empleados activos'], [],
    ['Identificación', 'Apellidos y Nombres', 'Cargo', 'Fecha Ingreso', 'Celular'],
    [1088000001, 'GUARDA UNO', 'VIGILANTE', new Date(Date.UTC(2025, 1, 28)), '3001112233'],
    ['1.088.000.002', 'GUARDA DOS', 'SUPERVISOR', '05/03/2026', null],
  ]), 'Hoja1');
  const buf = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
  const leido = XLSX.read(buf, { cellDates: true });
  const matriz = XLSX.utils.sheet_to_json<unknown[]>(leido.Sheets[leido.SheetNames[0]], { header: 1, raw: true, defval: null });
  const { encabezados, filas } = filasDesdeMatriz(matriz, 'empleados');
  const m = detectarColumnas(encabezados, 'empleados');
  const out = mapearFilas(filas, m, 'empleados');
  assert.equal(out.length, 2);
  assert.equal(out[0].documento, '1088000001');
  assert.equal(out[0].fecha_ingreso, '2025-02-28');
  assert.equal(out[1].documento, '1.088.000.002'); // la base lo normaliza a solo dígitos
  assert.equal(out[1].fecha_ingreso, '2026-03-05');
  assert.equal(out[1].cargo, 'SUPERVISOR');
});
