import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import {
  preflight, apply, verify, verifyAbsent, rollback, detectState,
  readRollbackSql, checkZeroData,
} from '../scripts/agt002-workbench-migration.mjs';

const dossierMigration = readFileSync(new URL('../supabase/migrations/040_tender_dossier_workspace.sql', import.meta.url), 'utf8');
const pilotMigration = readFileSync(new URL('../supabase/migrations/044_agt003_copilot_pilot_permission.sql', import.meta.url), 'utf8');

const ids = Object.freeze({
  operator: '11111111-1111-4111-8111-111111111111',
  custodian: '11111111-1111-4111-8111-111111111112',
  agent: '11111111-1111-4111-8111-111111111113',
  juan: '11111111-1111-4111-8111-11111111111a',
  opportunity: '22222222-2222-4222-8222-222222222222',
  tender: '33333333-3333-4333-8333-333333333333',
});

// exec_sql inyectable sobre PGlite: lecturas (select/with) por query; DDL en su propia
// transacción (begin/commit), reproduciendo la semántica atómica del RPC exec_sql real.
function pgliteExecSql(db) {
  return async (sql) => {
    const trimmed = sql.trim();
    if (/^(select|with)\b/i.test(trimmed)) {
      const res = await db.query(trimmed.replace(/;\s*$/, ''));
      return res.rows ?? [];
    }
    // DDL en su propia transacción; ante error se hace rollback para no dejar la
    // sesión con una transacción abortada (equivale al fallo atómico de exec_sql).
    try {
      await db.exec(`begin;\n${sql}\ncommit;`);
    } catch (error) {
      await db.exec('rollback;').catch(() => {});
      throw error;
    }
    return [];
  };
}

async function freshDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.psi_sales_profiles (
      id uuid primary key, active boolean not null default true,
      identity_type text default 'human', role text not null, full_name text, microsoft_email text
    );
    create table public.psi_access_permissions (
      code text primary key, name text not null default '', description text, active boolean not null default true
    );
    create table public.psi_profile_permissions (
      profile_id uuid not null, permission_code text not null,
      created_at timestamptz not null default now(), created_by uuid,
      primary key(profile_id, permission_code)
    );
    create table public.psi_sales_opportunities (id uuid primary key, tender_offer_status text);
    create table public.psi_public_tenders (id uuid primary key, converted_opportunity_id uuid);
    create table public.psi_tender_go_no_go_decisions (
      id uuid primary key default gen_random_uuid(), opportunity_id uuid, tender_id uuid,
      decision text, decided_at timestamptz default now(), supersedes_decision_id uuid);
    insert into public.psi_access_permissions(code) values ('licitaciones'),('licitaciones_custodia');
    insert into public.psi_sales_profiles(id,identity_type,role,full_name,microsoft_email) values
      ('${ids.operator}','human','comercial','Operador',null),
      ('${ids.custodian}','human','comercial','Encargada',null),
      ('${ids.agent}','agent','comercial','AGT-002',null),
      ('${ids.juan}','human','admin','Juan Botero','juanbotero@premiumsecurity.ai');
    insert into public.psi_profile_permissions(profile_id,permission_code) values
      ('${ids.operator}','licitaciones'),
      ('${ids.custodian}','licitaciones'),
      ('${ids.custodian}','licitaciones_custodia');
    insert into public.psi_sales_opportunities(id,tender_offer_status) values ('${ids.opportunity}','en_preparacion');
    insert into public.psi_public_tenders(id,converted_opportunity_id) values ('${ids.tender}','${ids.opportunity}');
    insert into public.psi_tender_go_no_go_decisions(opportunity_id,tender_id,decision)
      values ('${ids.opportunity}','${ids.tender}','go');
  `);
  await db.exec(dossierMigration); // migración 040
  await db.exec(pilotMigration);   // migración 044 (AGT-003, independiente)
  return db;
}

const db = await freshDb();
const execSql = pgliteExecSql(db);

// --- preflight: estado inicial absent, prerrequisitos 040 y AGT-003 044 presentes ---
{
  const { state } = await preflight(execSql);
  assert.equal(state, 'absent');
}

// --- apply: instala 045 y verifica la superficie completa ---
{
  const res = await apply(execSql);
  assert.equal(res.ok, true, JSON.stringify(res.row));
  assert.equal(await detectState(execSql), 'applied');
}

// --- apply idempotente: no-op, sigue verificando ---
{
  const res = await apply(execSql);
  assert.equal(res.ok, true);
  assert.equal(await detectState(execSql), 'applied');
}

// --- verify explícito ---
assert.equal((await verify(execSql)).ok, true);

// AGT-003 044 sigue presente e inalterado tras aplicar AGT-002.
{
  const holders = (await db.query(`select count(*)::int as n from public.psi_profile_permissions where permission_code='vigia_copilot_pilot'`)).rows[0].n;
  assert.equal(holders, 1);
}

// --- PUBLIC (grantee OID 0) probado por catálogo/ACL: un privilegio a PUBLIC rompe verify ---
{
  // EXECUTE de PUBLIC en un RPC de servicio: verify falla; al revocar, vuelve a pasar.
  await db.exec(`grant execute on function public.psi_get_agt002_workbench(uuid,uuid) to public`);
  const withPublicExec = await verify(execSql);
  assert.equal(withPublicExec.ok, false);
  assert.ok(Number(withPublicExec.row.service_public_exec) >= 1, 'service_public_exec detecta a PUBLIC por ACL');
  await db.exec(`revoke execute on function public.psi_get_agt002_workbench(uuid,uuid) from public`);
  assert.equal((await verify(execSql)).ok, true);

  // EXECUTE de PUBLIC en un RPC terminal legacy: verify falla; al revocar, vuelve a pasar.
  await db.exec(`grant execute on function public.psi_append_agt002_agent_result(uuid,uuid,uuid,jsonb) to public`);
  const withLegacyPublic = await verify(execSql);
  assert.equal(withLegacyPublic.ok, false);
  assert.ok(Number(withLegacyPublic.row.legacy_public_exec) >= 1, 'legacy_public_exec detecta a PUBLIC por ACL');
  await db.exec(`revoke execute on function public.psi_append_agt002_agent_result(uuid,uuid,uuid,jsonb) from public`);
  assert.equal((await verify(execSql)).ok, true);

  // Privilegio de tabla a PUBLIC: verify falla; al revocar, vuelve a pasar.
  await db.exec(`grant select on table public.psi_agt002_workbench_threads to public`);
  const withPublicTable = await verify(execSql);
  assert.equal(withPublicTable.ok, false);
  assert.ok(Number(withPublicTable.row.table_public_grants) >= 1, 'table_public_grants detecta a PUBLIC por relacl');
  await db.exec(`revoke select on table public.psi_agt002_workbench_threads from public`);
  assert.equal((await verify(execSql)).ok, true);

  // Un helper SECURITY DEFINER nunca puede recuperar EXECUTE de PUBLIC.
  await db.exec(`grant execute on function public.psi_assert_agt002_workbench_actor(uuid,boolean) to public`);
  const withHelperPublic = await verify(execSql);
  assert.equal(withHelperPublic.ok, false);
  assert.ok(Number(withHelperPublic.row.idef_public_exec) >= 1, 'idef_public_exec detecta helper expuesto a PUBLIC');
  await db.exec(`revoke execute on function public.psi_assert_agt002_workbench_actor(uuid,boolean) from public`);
  assert.equal((await verify(execSql)).ok, true);

  // El proyector no puede ser ejecutable por anon/authenticated.
  await db.exec(`grant execute on function public.psi_project_tender_dossier_artifact(uuid) to anon`);
  const withProjectAnon = await verify(execSql);
  assert.equal(withProjectAnon.ok, false);
  assert.ok(Number(withProjectAnon.row.idef_role_exec) >= 1, 'idef_role_exec detecta proyector expuesto a anon');
  await db.exec(`revoke execute on function public.psi_project_tender_dossier_artifact(uuid) from anon`);
  assert.equal((await verify(execSql)).ok, true);

  // El proyector debe conservar EXECUTE para service_role.
  await db.exec(`revoke execute on function public.psi_project_tender_dossier_artifact(uuid) from service_role`);
  const withoutProjectService = await verify(execSql);
  assert.equal(withoutProjectService.ok, false);
  assert.equal(Number(withoutProjectService.row.idef_service_exec), 3, 'falta exactamente el proyector en service_role');
  await db.exec(`grant execute on function public.psi_project_tender_dossier_artifact(uuid) to service_role`);
  assert.equal((await verify(execSql)).ok, true);
}

// --- rollback con datos cero: revierte y verifica ausencia + AGT-003 presente ---
{
  const res = await rollback(execSql);
  assert.equal(res.ok, true, JSON.stringify(res.row));
  assert.equal(await detectState(execSql), 'absent');
  assert.equal((await verifyAbsent(execSql)).ok, true);
  // Las funciones de 040 quedaron restauradas y siguen ejecutables.
  const projectExists = (await db.query(`select to_regprocedure('public.psi_project_tender_dossier_artifact(uuid)') is not null as ok`)).rows[0].ok;
  assert.equal(projectExists, true);
}

// --- reapply: vuelve a instalar desde absent ---
{
  const res = await apply(execSql);
  assert.equal(res.ok, true);
  assert.equal(await detectState(execSql), 'applied');
}

// --- rollback refusal con evidencia sembrada en la Mesa ---
{
  // Sembrar un hilo real por el RPC crea una fila de evidencia en workbench_threads.
  await db.query(`select public.psi_get_or_create_agt002_workbench_thread($1,$2)`, [ids.opportunity, ids.operator]);
  const zero = await checkZeroData(execSql);
  assert.equal(zero.ok, false);
  assert.equal(zero.workbenchRows, 1);

  // El runner rechaza antes de enviar cualquier DDL destructivo.
  await assert.rejects(rollback(execSql), /evidencia/i);

  // Defensa en profundidad: el SQL de rollback falla cerrado por sí mismo.
  await assert.rejects(execSql(readRollbackSql()), /auditor|evidencia/i);

  // Nada se destruyó: la Mesa sigue aplicada y la evidencia intacta.
  assert.equal(await detectState(execSql), 'applied');
  assert.equal((await verify(execSql)).ok, true);
  assert.equal((await db.query(`select count(*)::int as n from public.psi_agt002_workbench_threads`)).rows[0].n, 1);
}

await db.close();
console.log('PGlite AGT-002 workbench migration runner lifecycle passed');
