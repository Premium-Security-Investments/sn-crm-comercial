import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration=readFileSync(new URL('../supabase/migrations/047_agt002_workbench_agent_identity.sql',import.meta.url),'utf8');
const rollback=readFileSync(new URL('../supabase/rollbacks/047_agt002_workbench_agent_identity_rollback.sql',import.meta.url),'utf8');
const id='a0020000-0000-4000-8000-000000000002';

async function db(){
  const d=new PGlite();
  await d.exec(`
    create table public.psi_sales_profiles(
      id uuid primary key default gen_random_uuid(), microsoft_email text not null unique,
      full_name text not null, role text not null default 'comercial', active boolean not null default true,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      commercial_area text, can_edit_customer_segment boolean not null default false,
      auth_user_id uuid, identity_type text default 'human' check(identity_type is null or identity_type in ('human','agent')),
      check(role in ('admin','gerencia','director','comercial','colaborador','junta'))
    );
    create table public.psi_profile_permissions(profile_id uuid,permission_code text);
    create table public.psi_profile_area_assignments(profile_id uuid,area_code text);
    create table public.psi_agt002_workbench_messages(id uuid primary key default gen_random_uuid(),author_id uuid references public.psi_sales_profiles(id));
    create table public.psi_tender_dossier_artifact_versions(id uuid primary key default gen_random_uuid(),author_id uuid references public.psi_sales_profiles(id));
  `);
  return d;
}

{
  const d=await db();
  await d.exec(migration);
  await d.exec(migration);
  const rows=(await d.query(`select * from public.psi_sales_profiles where id=$1`,[id])).rows;
  assert.equal(rows.length,1);
  assert.equal(rows[0].full_name,'Vig-IA');
  assert.equal(rows[0].microsoft_email,'agt002.vig-ia@agents.invalid');
  assert.equal(rows[0].role,'comercial');
  assert.equal(rows[0].active,true);
  assert.equal(rows[0].identity_type,'agent');
  assert.equal(rows[0].auth_user_id,null);
  assert.equal(rows[0].commercial_area,null);
  assert.equal(rows[0].can_edit_customer_segment,false);
  assert.equal((await d.query(`select count(*)::int n from public.psi_profile_permissions where profile_id=$1`,[id])).rows[0].n,0);
  assert.equal((await d.query(`select count(*)::int n from public.psi_profile_area_assignments where profile_id=$1`,[id])).rows[0].n,0);
  await d.exec(rollback);
  assert.equal((await d.query(`select count(*)::int n from public.psi_sales_profiles where id=$1`,[id])).rows[0].n,0);
  await d.close();
}

{
  const d=await db();
  await d.exec(migration);
  await d.query(`insert into public.psi_agt002_workbench_messages(author_id) values($1)`,[id]);
  await assert.rejects(()=>d.exec(rollback),/evidencias|55000/i);
  await d.exec('rollback');
  assert.equal((await d.query(`select count(*)::int n from public.psi_sales_profiles where id=$1`,[id])).rows[0].n,1);
  await d.close();
}

{
  const d=await db();
  await d.exec(`insert into public.psi_sales_profiles(id,microsoft_email,full_name,role,active,identity_type) values('11111111-1111-4111-8111-111111111111','agt002.vig-ia@agents.invalid','Otra','comercial',true,'agent')`);
  await assert.rejects(()=>d.exec(migration),/no coincide|otra identidad|23514/i);
  await d.close();
}

{
  const d=await db();
  await d.exec(`insert into public.psi_sales_profiles(id,microsoft_email,full_name,role,active,identity_type) values
    ('${id}','other@agents.invalid','Vig-IA','comercial',true,'agent'),
    ('11111111-1111-4111-8111-111111111111','agt002.vig-ia@agents.invalid','Otra','comercial',true,'agent')`);
  await assert.rejects(()=>d.exec(migration),/otra identidad|23514/i);
  await d.close();
}

console.log('AGT-002 047 identity: idempotency, no-login/no-permissions, collisions and fail-closed rollback passed');
