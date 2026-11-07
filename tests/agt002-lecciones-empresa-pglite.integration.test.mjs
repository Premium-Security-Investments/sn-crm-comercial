// Migración 189 — Lecciones de la empresa (encargo AGT-002 del 2026-11-06, PR a). La tabla es append-only, proponer
// pide Licitaciones, aprobar y retirar piden el permiso nuevo `licitaciones_lecciones`, que la migración da sólo a Juan
// y a Katherine (decisión de Juan, 2026-11-07); la custodia sola no alcanza.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { decideAgt002Lesson, listAgt002Lessons, proposeAgt002Lesson } from '../verticales/licitaciones/agt002-company-lessons.js';

const read = name => readFileSync(new URL(`../supabase/${name}`, import.meta.url), 'utf8');
const m189 = read('migrations/189_agt002_lecciones_empresa.sql');
const r189 = read('rollbacks/189_agt002_lecciones_empresa_rollback.sql');

const JUAN = '60b26173-1226-476b-a958-cf2917661432';
const KATHERINE = '8c172493-12aa-4be1-893a-2e5e93f7fba2';
const LUIS = '56db0b00-4dab-4f34-a20d-54c22d76c942';
const COMERCIAL = '44444444-4444-4444-8444-444444444444';

async function db({ con189 = true } = {}) {
  const pg = new PGlite();
  await pg.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true, identity_type text default 'human', role text not null, full_name text);
    create table public.psi_access_permissions (code text primary key, name text not null default '', description text, active boolean not null default true);
    create table public.psi_profile_permissions (profile_id uuid not null, permission_code text not null, created_at timestamptz not null default now(), created_by uuid, primary key(profile_id, permission_code));
    create table public.psi_sales_opportunities (id uuid primary key);
    insert into public.psi_access_permissions(code) values ('licitaciones'),('licitaciones_custodia');
    insert into public.psi_sales_profiles(id,role,full_name) values
      ('${JUAN}','admin','Juan Botero'), ('${KATHERINE}','comercial','Katherine Valencia Buitrago'),
      ('${LUIS}','gerencia','Luis Fernando Lopez'), ('${COMERCIAL}','comercial','Otra persona');
    insert into public.psi_profile_permissions(profile_id,permission_code) values
      ('${JUAN}','licitaciones'),('${JUAN}','licitaciones_custodia'),
      ('${KATHERINE}','licitaciones'),('${KATHERINE}','licitaciones_custodia'),
      ('${LUIS}','licitaciones'),('${LUIS}','licitaciones_custodia');
  `);
  if (con189) await pg.exec(m189);
  return pg;
}

// Adaptador mínimo de supabase-js sobre PGlite para ejercitar el módulo JS de punta a punta.
function client(pg) {
  return {
    async rpc(name, args) {
      const keys = Object.keys(args);
      const sql = `select public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(', ')}) as r`;
      try {
        const values = keys.map(key => (args[key] !== null && typeof args[key] === 'object' ? JSON.stringify(args[key]) : args[key]));
        return { data: (await pg.query(sql, values)).rows[0].r, error: null };
      } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
    },
    from(table) {
      const state = { statuses: null };
      const run = async () => {
        try {
          const rows = (await pg.query(`select * from public.${table} where status = any($1) order by code`, [state.statuses])).rows;
          return { data: rows, error: null };
        } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
      };
      const chain = {
        select() { return chain; },
        in(_column, values) { state.statuses = values; return chain; },
        order() { return run(); },
      };
      return chain;
    },
  };
}

const LECCION = { statement: 'Agencia no es sucursal.', rationale: 'DEAJ LP-07-2026 pide sede principal o sucursal.', how_to_apply: 'Si piden sucursal, marcar inhabilitante.', category: 'sede_agencia', source_kind: 'carga_inicial', source_ref: 'lecciones-semilla #1' };

test('el permiso nuevo queda sólo en Juan y Katherine, no en quien sólo tiene custodia', async () => {
  const pg = await db();
  const rows = (await pg.query(`select profile_id from psi_profile_permissions where permission_code = 'licitaciones_lecciones' order by profile_id`)).rows;
  assert.deepEqual(rows.map(row => row.profile_id), [JUAN, KATHERINE]);
  await pg.close();
});

test('proponer, aprobar y retirar: cada paso es una versión nueva con el mismo código', async () => {
  const pg = await db();
  const database = client(pg);
  const propuesta = await proposeAgt002Lesson(database, { actorId: KATHERINE, body: LECCION });
  assert.equal(propuesta.code, 'L-01');
  assert.equal(propuesta.status, 'propuesta');
  const otra = await proposeAgt002Lesson(database, { actorId: JUAN, body: { ...LECCION, statement: 'Liquidez 2,37.' }, proposedByModel: true });
  assert.equal(otra.code, 'L-02');
  assert.equal(otra.proposed_by_model, true);

  const activa = await decideAgt002Lesson(database, { actorId: JUAN, code: 'L-01', expectedVersion: 1, status: 'activa' });
  assert.equal(activa.version, 2);
  assert.equal(activa.statement, LECCION.statement);
  assert.deepEqual((await listAgt002Lessons(database, { statuses: ['activa'] })).map(row => row.code), ['L-01']);

  await assert.rejects(decideAgt002Lesson(database, { actorId: KATHERINE, code: 'L-01', expectedVersion: 2, status: 'retirada' }), /por qué se retira/);
  const retirada = await decideAgt002Lesson(database, { actorId: KATHERINE, code: 'L-01', expectedVersion: 2, status: 'retirada', reason: 'La póliza cambió.' });
  assert.equal(retirada.version, 3);
  assert.equal((await listAgt002Lessons(database, { statuses: ['activa'] })).length, 0);
  const vigentes = await listAgt002Lessons(database);
  assert.deepEqual(vigentes.map(row => [row.code, row.status, row.proposed_by]), [['L-01', 'retirada', KATHERINE], ['L-02', 'propuesta', JUAN]]);
  await pg.close();
});

test('la custodia sola no aprueba, y un comercial sin Licitaciones no propone', async () => {
  const pg = await db();
  const database = client(pg);
  await proposeAgt002Lesson(database, { actorId: KATHERINE, body: LECCION });
  await assert.rejects(decideAgt002Lesson(database, { actorId: LUIS, code: 'L-01', expectedVersion: 1, status: 'activa' }),
    error => error.status === 403);
  await assert.rejects(proposeAgt002Lesson(database, { actorId: COMERCIAL, body: LECCION }), error => error.status === 403);
  await pg.close();
});

test('aprobar sobre una versión vieja o aprobar dos veces se rechaza', async () => {
  const pg = await db();
  const database = client(pg);
  await proposeAgt002Lesson(database, { actorId: KATHERINE, body: LECCION });
  await decideAgt002Lesson(database, { actorId: JUAN, code: 'L-01', expectedVersion: 1, status: 'activa' });
  await assert.rejects(decideAgt002Lesson(database, { actorId: KATHERINE, code: 'L-01', expectedVersion: 1, status: 'activa' }), error => error.status === 409);
  await assert.rejects(decideAgt002Lesson(database, { actorId: KATHERINE, code: 'L-01', expectedVersion: 2, status: 'activa' }), /ya está activa/);
  await pg.close();
});

test('la tabla rechaza UPDATE y DELETE', async () => {
  const pg = await db();
  await proposeAgt002Lesson(client(pg), { actorId: KATHERINE, body: LECCION });
  await assert.rejects(pg.exec(`update psi_tender_lessons set status = 'activa'`), /no se editan ni se borran/);
  await assert.rejects(pg.exec(`delete from psi_tender_lessons`), /no se editan ni se borran/);
  await pg.close();
});

test('sin la 189 la lista sale vacía y proponer responde 503', async () => {
  const pg = await db({ con189: false });
  const database = client(pg);
  assert.deepEqual(await listAgt002Lessons(database), []);
  await assert.rejects(proposeAgt002Lesson(database, { actorId: KATHERINE, body: LECCION }), error => error.status === 503);
  await pg.close();
});

test('funciones y tabla sólo para service_role; la reversa lo quita todo', async () => {
  const pg = await db();
  for (const fn of ['psi_propose_tender_lesson(uuid,jsonb,boolean)', 'psi_decide_tender_lesson(uuid,text,integer,text,text)', 'psi_profile_can_approve_tender_lessons(uuid)']) {
    const r = (await pg.query(`select has_function_privilege('authenticated', $1, 'execute') a, has_function_privilege('anon', $1, 'execute') b, has_function_privilege('service_role', $1, 'execute') s`, [`public.${fn}`])).rows[0];
    assert.deepEqual([r.a, r.b, r.s], [false, false, true], fn);
  }
  const t = (await pg.query(`select has_table_privilege('authenticated','public.psi_tender_lessons','select') a, has_table_privilege('service_role','public.psi_tender_lessons','insert') i`)).rows[0];
  assert.deepEqual([t.a, t.i], [false, false]);
  await pg.exec(r189);
  assert.equal((await pg.query(`select to_regclass('public.psi_tender_lessons') r`)).rows[0].r, null);
  assert.equal((await pg.query(`select count(*)::int n from psi_profile_permissions where permission_code = 'licitaciones_lecciones'`)).rows[0].n, 0);
  await pg.close();
});

test('lo inválido se rechaza antes de llegar a la base', async () => {
  const database = { rpc: () => { throw new Error('no debía llamarse'); } };
  await assert.rejects(proposeAgt002Lesson(database, { actorId: KATHERINE, body: { statement: '  ' } }), /Escriba la lección/);
  await assert.rejects(proposeAgt002Lesson(database, { actorId: KATHERINE, body: { statement: 'x', category: 'inventada' } }), /categoría/);
  await assert.rejects(decideAgt002Lesson(database, { actorId: KATHERINE, code: 'X', expectedVersion: 1, status: 'activa' }), /no es válida/);
});

test('una propuesta se descarta sin motivo; una activa no se descarta, se retira', async () => {
  const pg = await db();
  const database = client(pg);
  await proposeAgt002Lesson(database, { actorId: KATHERINE, body: LECCION });
  await proposeAgt002Lesson(database, { actorId: KATHERINE, body: { ...LECCION, statement: 'Liquidez 2,37.' } });
  const descartada = await decideAgt002Lesson(database, { actorId: KATHERINE, code: 'L-01', expectedVersion: 1, status: 'descartada' });
  assert.equal(descartada.status, 'descartada');
  await assert.rejects(decideAgt002Lesson(database, { actorId: JUAN, code: 'L-01', expectedVersion: 2, status: 'activa' }), /ya está descartada/);
  await assert.rejects(decideAgt002Lesson(database, { actorId: JUAN, code: 'L-02', expectedVersion: 1, status: 'retirada', reason: 'x' }), /se descarta/);
  await decideAgt002Lesson(database, { actorId: JUAN, code: 'L-02', expectedVersion: 1, status: 'activa' });
  await assert.rejects(decideAgt002Lesson(database, { actorId: JUAN, code: 'L-02', expectedVersion: 2, status: 'descartada' }), /se retira con motivo/);
  await pg.close();
});
