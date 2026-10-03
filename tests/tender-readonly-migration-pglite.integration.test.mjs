import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../supabase/migrations/070_tender_readonly_permission.sql', import.meta.url), 'utf8');
const rollback = await readFile(new URL('../supabase/rollbacks/070_tender_readonly_permission_rollback.sql', import.meta.url), 'utf8');

async function database() {
  const db = new PGlite();
  await db.exec(`
    create table public.psi_access_permissions (
      code text primary key,
      name text not null,
      description text,
      active boolean not null default true
    );
    create table public.psi_profile_permissions (
      profile_id uuid not null,
      permission_code text not null references public.psi_access_permissions(code),
      primary key(profile_id, permission_code)
    );
  `);
  return db;
}

test('070 crea la capability activa y es idempotente', async () => {
  const db = await database();
  await db.exec(migration);
  await db.exec(migration);
  const result = await db.query("select code, name, active from public.psi_access_permissions where code = 'licitaciones_lectura'");
  assert.deepEqual(result.rows, [{ code: 'licitaciones_lectura', name: 'Licitaciones — solo lectura', active: true }]);
  await db.close();
});

test('070 falla cerrado si el permiso fue desactivado deliberadamente', async () => {
  const db = await database();
  await db.exec(migration);
  await db.exec("update public.psi_access_permissions set active = false where code = 'licitaciones_lectura'");
  await assert.rejects(db.exec(migration), /inactivo|reactivarlo/i);
  await db.exec('rollback');
  const result = await db.query("select active from public.psi_access_permissions where code = 'licitaciones_lectura'");
  assert.equal(result.rows[0].active, false);
  await db.close();
});

test('rollback rehúsa borrar una capability asignada y permite retirarla cuando queda libre', async () => {
  const db = await database();
  await db.exec(migration);
  await db.exec("insert into public.psi_profile_permissions(profile_id, permission_code) values ('00000000-0000-4000-8000-000000000070', 'licitaciones_lectura')");
  await assert.rejects(db.exec(rollback), /perfiles|asignaciones/i);
  await db.exec('rollback');
  await db.exec("delete from public.psi_profile_permissions where permission_code = 'licitaciones_lectura'");
  await db.exec(rollback);
  const result = await db.query("select count(*)::int as count from public.psi_access_permissions where code = 'licitaciones_lectura'");
  assert.equal(result.rows[0].count, 0);
  await db.close();
});
