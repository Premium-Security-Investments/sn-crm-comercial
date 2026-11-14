import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/143_siio_programacion_horas_cliente.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollbacks/143_siio_programacion_horas_cliente_rollback.sql', import.meta.url), 'utf8');


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
