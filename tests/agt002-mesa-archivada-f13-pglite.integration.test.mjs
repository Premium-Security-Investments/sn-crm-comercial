// Migración 193 — F13 (auditoría del piloto Fiscalía): una licitación archivada cierra la Mesa aunque tenga GO. Antes
// el GO se miraba primero y la Mesa quedaba abierta (caso Supersalud, archivada el 4-nov con GO).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = name => readFileSync(new URL(`../supabase/${name}`, import.meta.url), 'utf8');
const m140 = read('migrations/140_agt002_workbench_before_go.sql');
const assert140 = m140.slice(m140.indexOf('create or replace function public.psi_assert_agt002_workbench_open'), m140.indexOf('create or replace function public.psi_get_or_create_agt002_workbench_thread'));
const O = '10000000-0000-4000-8000-000000000001';
const T = '20000000-0000-4000-8000-000000000001';

async function db({ con193 = true, archived = true, stage = 'en_preparacion', decision = 'go' } = {}) {
  const pg = new PGlite();
  await pg.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.psi_sales_opportunities (id uuid primary key, stage_code text, archived_at timestamptz);
    create table public.psi_public_tenders (id uuid primary key, converted_opportunity_id uuid);
    create table public.psi_tender_go_no_go_decisions (id uuid primary key default gen_random_uuid(), opportunity_id uuid, tender_id uuid, decision text, decided_at timestamptz default now(), supersedes_decision_id uuid);
    insert into psi_sales_opportunities values ('${O}', '${stage}', ${archived ? 'now()' : 'null'});
    insert into psi_public_tenders values ('${T}', '${O}');
    ${decision ? `insert into psi_tender_go_no_go_decisions (opportunity_id, tender_id, decision) values ('${O}', '${T}', '${decision}');` : ''}
  `);
  await pg.exec(assert140);
  if (con193) await pg.exec(read('migrations/193_agt002_mesa_cerrada_en_archivadas.sql'));
  return pg;
}
const open = pg => pg.query(`select public.psi_assert_agt002_workbench_open('${O}') as t`);

test('caso Supersalud: archivada con GO cierra la Mesa', async () => {
  const pg = await db();
  await assert.rejects(open(pg), /sólo está disponible para licitaciones activas/);
  await pg.close();
});

test('sin la 193 (como hoy) la misma licitación deja la Mesa abierta', async () => {
  const pg = await db({ con193: false });
  assert.equal((await open(pg)).rows[0].t, T);
  await pg.close();
});

test('lo demás no cambia: GO sin archivar abre, por decidir abre, NO GO cierra', async () => {
  for (const [options, expected] of [[{ archived: false }, T], [{ archived: false, stage: 'prospecto', decision: null }, T]]) {
    const pg = await db(options);
    assert.equal((await open(pg)).rows[0].t, expected);
    await pg.close();
  }
  const noGo = await db({ archived: false, decision: 'no_go' });
  await assert.rejects(open(noGo), /NO GO vigente/);
  await noGo.close();
});

test('la reversa vuelve a la 140', async () => {
  const pg = await db();
  await pg.exec(read('rollbacks/193_agt002_mesa_cerrada_en_archivadas_rollback.sql'));
  assert.equal((await open(pg)).rows[0].t, T);
  await pg.close();
});
