import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/044_agt003_copilot_pilot_permission.sql', import.meta.url), 'utf8');

async function database({ includeJuan = true } = {}) {
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
    create table public.psi_access_permissions (
      code text primary key,
      name text not null,
      description text,
      active boolean not null default true
    );
    create table public.psi_profile_permissions (
      profile_id uuid not null references public.psi_sales_profiles(id),
      permission_code text not null references public.psi_access_permissions(code),
      created_at timestamptz not null default now(),
      created_by uuid references public.psi_sales_profiles(id),
      primary key(profile_id, permission_code)
    );
    ${includeJuan ? "insert into public.psi_sales_profiles values ('11111111-1111-4111-8111-111111111111','Juan Botero','juanbotero@premiumsecurity.ai','admin',true,'human');" : ''}
    insert into public.psi_sales_profiles values ('22222222-2222-4222-8222-222222222222','Other User','other@example.com','admin',true,'human');
  `);
  return db;
}

const db = await database();
await db.exec(migration);
await db.exec(migration);
const holders = (await db.query(`
  select p.microsoft_email
  from public.psi_profile_permissions pp
  join public.psi_sales_profiles p on p.id=pp.profile_id
  where pp.permission_code='vigia_copilot_pilot'
`)).rows;
assert.deepEqual(holders, [{ microsoft_email: 'juanbotero@premiumsecurity.ai' }]);
assert.equal((await db.query("select active from public.psi_access_permissions where code='vigia_copilot_pilot'")).rows[0].active, true);
await db.close();

const missing = await database({ includeJuan: false });
await assert.rejects(() => missing.exec(migration), /exactamente a una identidad PSI/i);
await missing.exec('rollback');
assert.equal((await missing.query("select count(*)::int as count from public.psi_access_permissions where code='vigia_copilot_pilot'")).rows[0].count, 0, 'failed transaction rolls back catalog insert');
await missing.close();

console.log('AGT-003 pilot permission migration passed');
