import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { build } from 'esbuild';

const migration = readFileSync(new URL('../supabase/migrations/143_siio_programacion_horas_cliente.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollbacks/143_siio_programacion_horas_cliente_rollback.sql', import.meta.url), 'utf8');

async function loadModule(relativePath) {
  const result = await build({ entryPoints: [new URL(relativePath, import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const { deriveHorasPorCliente, pickPeriodo } = await loadModule('../src/siio/horasPorCliente.ts');

// Esquema mínimo de Programación, con los campos que lee la vista.
const PROGRAMACION = `
  create schema programacion;
  create table programacion.ciudades (id bigserial primary key, nombre text not null);
  create table programacion.clientes (id bigserial primary key, nit text, razon_social text not null);
  create table programacion.puestos (id bigserial primary key, ciudad_id bigint, cliente_id bigint, nombre text);
  create table programacion.periodos (id bigserial primary key, ciudad_id bigint, inicio date, fin date, estado text, tipo text);
  create table programacion.turnos (id bigserial primary key, empleado_id bigint, puesto_id bigint, inicio timestamptz, fin timestamptz, turno_programado_id bigint);
  create table programacion.turnos_programados (id bigserial primary key, empleado_id bigint, puesto_id bigint, periodo_id bigint, inicio timestamptz, fin timestamptz);
  insert into programacion.ciudades (id, nombre) values (1, 'Pereira');
  insert into programacion.clientes (id, nit, razon_social) values
    (1, '800231235', 'HOSPITAL SAN JORGE'), (2, '891401705', 'INGENIO RISARALDA'), (3, '900480569', 'SIN SERVICIO');
  insert into programacion.puestos (id, ciudad_id, cliente_id, nombre) values
    (1, 1, 1, 'Urgencias'), (2, 1, 1, 'Portería'), (3, 1, 2, 'Báscula'), (4, 1, null, 'Sin cliente');
  insert into programacion.periodos (id, ciudad_id, inicio, fin, estado, tipo) values
    (1, 1, '2026-07-24', '2026-08-23', 'cerrado', 'mensual'),
    (2, 1, '2026-10-24', '2026-11-23', 'abierto', 'mensual');
`;

async function database({ conProgramacion = true } = {}) {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role;');
  if (conProgramacion) await db.exec(PROGRAMACION);
  await db.exec(migration);
  return db;
}

test('la vista suma horas por cliente del periodo y deja fuera los puestos sin cliente', async () => {
  const db = await database();
  await db.exec(`
    -- Programado: San Jorge 2 turnos de 12 h en dos puestos; Ingenio 1 de 8 h.
    insert into programacion.turnos_programados (empleado_id, puesto_id, periodo_id, inicio, fin) values
      (10, 1, 1, '2026-07-25T06:00Z', '2026-07-25T18:00Z'),
      (11, 2, 1, '2026-07-25T06:00Z', '2026-07-25T18:00Z'),
      (12, 3, 1, '2026-07-26T06:00Z', '2026-07-26T14:00Z'),
      (13, 4, 1, '2026-07-26T06:00Z', '2026-07-26T14:00Z');
    -- Realizado: San Jorge solo cubrió uno de los dos; Ingenio cubrió el suyo completo.
    insert into programacion.turnos (empleado_id, puesto_id, inicio, fin, turno_programado_id) values
      (10, 1, '2026-07-25T06:00Z', '2026-07-25T18:00Z', 1),
      (12, 3, '2026-07-26T06:00Z', '2026-07-26T14:00Z', null),
      (10, 1, '2026-11-02T06:00Z', '2026-11-02T18:00Z', null);
  `);
  const rows = (await db.query('select * from public.siio_programacion_horas_cliente order by periodo_id, cliente')).rows;
  const cerrado = rows.filter(row => row.periodo_id === 1);
  assert.deepEqual(cerrado.map(row => row.cliente), ['HOSPITAL SAN JORGE', 'INGENIO RISARALDA']);
  const sanJorge = cerrado[0];
  assert.equal(Number(sanJorge.horas_programadas), 24);
  assert.equal(Number(sanJorge.horas_realizadas), 12);
  assert.equal(Number(sanJorge.puestos), 2);
  assert.equal(sanJorge.nit, '800231235');
  assert.equal(sanJorge.periodo_estado, 'cerrado');
  assert.equal(Number(cerrado[1].horas_programadas), 8);
  assert.equal(Number(cerrado[1].horas_realizadas), 8);
  // Calidad del cargue: el turno del Ingenio quedó sin plan asociado; el de San Jorge, enlazado.
  assert.equal(Number(sanJorge.turnos_sin_programado), 0);
  assert.equal(Number(cerrado[1].turnos_sin_programado), 1);
  // El puesto sin cliente no aparece, y el cliente sin servicio tampoco.
  assert.equal(rows.some(row => row.cliente === 'SIN SERVICIO'), false);
  // El turno de noviembre cae en el periodo abierto, por fecha, no por columna.
  const abierto = rows.filter(row => row.periodo_id === 2);
  assert.equal(abierto.length, 1);
  assert.equal(Number(abierto[0].horas_realizadas), 12);
  assert.equal(Number(abierto[0].horas_programadas), 0);
  await db.close();
});

test('la vista no expone ninguna columna de personas', async () => {
  const db = await database();
  const cols = (await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='siio_programacion_horas_cliente'")).rows.map(r => r.column_name);
  assert.equal(cols.some(name => /empleado|documento|cedula|nombre_guarda|salario/i.test(name)), false);
  assert.deepEqual(cols.includes('guardas'), true);
  await db.close();
});

test('sin el esquema de Programación la vista existe vacía y la Torre no se cae', async () => {
  const db = await database({ conProgramacion: false });
  const rows = (await db.query('select * from public.siio_programacion_horas_cliente')).rows;
  assert.deepEqual(rows, []);
  await db.exec(rollback);
  assert.equal((await db.query("select to_regclass('public.siio_programacion_horas_cliente') as relation")).rows[0].relation, null);
  await db.close();
});

const fila = (overrides = {}) => ({
  periodo_id: 1, ciudad: 'Pereira', periodo_inicio: '2026-07-24', periodo_fin: '2026-08-23', periodo_estado: 'cerrado',
  cliente_id: 1, cliente: 'HOSPITAL SAN JORGE', nit: '800231235', puestos: 2, guardas: 4,
  horas_programadas: 1000, horas_realizadas: 900, turnos_programados: 80, turnos_realizados: 72,
  turnos_sin_programado: 12, ...overrides,
});

test('la Torre elige el último periodo cerrado y ordena los clientes por horas realizadas', () => {
  const rows = [
    fila(),
    fila({ cliente_id: 2, cliente: 'INGENIO RISARALDA', nit: '891401705', horas_realizadas: 2000, horas_programadas: 1500, puestos: 3 }),
    fila({ periodo_id: 2, periodo_estado: 'abierto', periodo_inicio: '2026-10-24', periodo_fin: '2026-11-23', horas_realizadas: 10, horas_programadas: 100 }),
  ];
  const summary = deriveHorasPorCliente(rows);
  assert.equal(summary.periodoId, 1);
  assert.equal(summary.abierto, false);
  assert.deepEqual(summary.clientes.map(row => row.cliente), ['INGENIO RISARALDA', 'HOSPITAL SAN JORGE']);
  assert.equal(summary.totalRealizadas, 2900);
  assert.equal(summary.totalProgramadas, 2500);
  assert.equal(summary.totalPuestos, 5);
  assert.equal(summary.clientes[1].relacion, 0.9);
  assert.equal(Math.round(summary.clientes[0].share * 100), 69);
  assert.equal(summary.periodos.length, 2);
  assert.match(summary.readings[0], /INGENIO RISARALDA concentra el 69 %/);
  assert.equal(summary.readings.some(text => /no tiene un turno programado asociado/.test(text)), true);
  assert.equal(summary.readings.some(text => /separados más de 10 %/.test(text)), true);
});

test('si no hay periodo cerrado usa el más reciente y avisa que está abierto', () => {
  const abierto = [fila({ periodo_id: 2, periodo_estado: 'abierto', periodo_inicio: '2026-10-24' })];
  const summary = deriveHorasPorCliente(abierto);
  assert.equal(summary.periodoId, 2);
  assert.equal(summary.abierto, true);
  assert.equal(summary.readings.some(text => /periodo está abierto/.test(text)), true);
  assert.equal(deriveHorasPorCliente([]), null);
  assert.equal(pickPeriodo([]), null);
});

test('un cliente sin nada programado no inventa una relación', () => {
  const summary = deriveHorasPorCliente([fila({ horas_programadas: 0, horas_realizadas: 50 })]);
  assert.equal(summary.clientes[0].relacion, null);
  assert.equal(summary.relacion, null);
});

test('más horas realizadas que programadas no se presenta como cumplimiento', () => {
  // Caso real de ARA en el periodo cerrado: 23.107 programadas y 41.298 realizadas.
  const summary = deriveHorasPorCliente([fila({ cliente: 'JERONIMO MARTINS', horas_programadas: 23107, horas_realizadas: 41298, turnos_realizados: 3000, turnos_sin_programado: 1200 })]);
  assert.equal(Math.round(summary.clientes[0].relacion * 100), 179);
  assert.equal(summary.readings.some(text => /dato incompleto, no incumplimiento/.test(text)), true);
  assert.equal(summary.readings.some(text => /cumplimiento del servicio/.test(text)), false);
});
