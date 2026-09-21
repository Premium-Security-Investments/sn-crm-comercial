import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/086_juan_commercial_participation.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollbacks/086_juan_commercial_participation_rollback.sql', import.meta.url), 'utf8');

async function database({ includeJuan = true, duplicateJuan = false } = {}) {
  const db = new PGlite();
  await db.exec(`
    create table public.psi_sales_profiles (
      id uuid primary key,
      full_name text not null,
      microsoft_email text not null,
      role text not null,
      active boolean not null default true,
      identity_type text
    );
    ${includeJuan ? "insert into public.psi_sales_profiles values ('11111111-1111-4111-8111-111111111111','Juan Botero','juanbotero@premiumsecurity.ai','admin',true,'human');" : ''}
    ${duplicateJuan ? "insert into public.psi_sales_profiles values ('33333333-3333-4333-8333-333333333333','Juan Duplicate',' JUANBOTERO@PREMIUMSECURITY.AI ','admin',true,'human');" : ''}
    insert into public.psi_sales_profiles values ('22222222-2222-4222-8222-222222222222','Other User','other@example.com','comercial',true,'human');
  `);
  return db;
}

const db = await database();
await db.exec(migration);
await db.exec(migration);
const profiles = (await db.query(`
  select microsoft_email, role, active, identity_type, can_own_opportunities
  from public.psi_sales_profiles
  order by microsoft_email
`)).rows;
assert.deepEqual(profiles, [
  { microsoft_email: 'juanbotero@premiumsecurity.ai', role: 'admin', active: true, identity_type: 'human', can_own_opportunities: true },
  { microsoft_email: 'other@example.com', role: 'comercial', active: true, identity_type: 'human', can_own_opportunities: false },
]);
await db.exec(rollback);
await db.exec(rollback);
const rolledBackColumns = (await db.query(`
  select count(*)::int as count
  from information_schema.columns
  where table_schema='public' and table_name='psi_sales_profiles' and column_name='can_own_opportunities'
`)).rows[0].count;
assert.equal(rolledBackColumns, 0, 'el rollback versionado elimina la capacidad y es idempotente');
await db.close();

const unapplied = await database();
await unapplied.exec(rollback);
await unapplied.exec(rollback);
assert.equal((await unapplied.query('select count(*)::int as count from public.psi_sales_profiles')).rows[0].count, 2, 'el rollback no aplicado es seguro e idempotente');
await unapplied.close();

for (const options of [{ includeJuan: false }, { duplicateJuan: true }]) {
  const invalid = await database(options);
  await assert.rejects(() => invalid.exec(migration), /exactamente un perfil humano activo de Juan Botero/i);
  await invalid.exec('rollback');
  const columns = (await invalid.query(`
    select count(*)::int as count
    from information_schema.columns
    where table_schema='public' and table_name='psi_sales_profiles' and column_name='can_own_opportunities'
  `)).rows[0].count;
  assert.equal(columns, 0, 'la transacción fallida revierte también la columna');
  await invalid.close();
}

console.log('Juan commercial participation migration passed');
