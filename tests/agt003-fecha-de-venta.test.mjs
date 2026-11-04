// AGT-003 — la fecha de una venta deja de moverse sola (migración 175; Juan, 2026-11-04).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const strip = sql => sql.replace(/^\s*begin;\s*$/gim, '').replace(/^\s*commit;\s*$/gim, '');

async function freshDb() {
  const pg = new PGlite();
  await pg.exec(`
    create role anon; create role authenticated;
    create table public.psi_sales_opportunities (id text primary key, stage_code text, approved_at timestamptz, created_at timestamptz, updated_at timestamptz default now(), deleted_at timestamptz);
    create table public.psi_sales_opportunity_audit_logs (id bigserial primary key, opportunity_id text, changed_by uuid, field_name text, old_value text, new_value text, notes text);
    insert into public.psi_sales_opportunities (id, stage_code, approved_at, created_at, updated_at) values
      ('ganada-sin-fecha', 'aprobado', null, '2026-05-01T05:00:00Z', '2026-11-03T02:00:00Z'),
      ('ganada-con-fecha', 'aprobado', '2026-09-15T15:00:00Z', '2026-09-01T05:00:00Z', '2026-11-03T02:00:00Z'),
      ('abierta', 'prospecto', null, '2026-10-01T05:00:00Z', '2026-11-03T02:00:00Z');
  `);
  await pg.exec(strip(read('../supabase/migrations/175_crm_fecha_de_venta.sql')));
  return pg;
}
const approvedAt = async (pg, id) => (await pg.query(`select approved_at::text a from public.psi_sales_opportunities where id = $1`, [id])).rows[0].a;

test('las ganadas sin fecha toman su fecha de registro, con auditoría; las demás no se tocan', async () => {
  const pg = await freshDb();
  assert.match(await approvedAt(pg, 'ganada-sin-fecha'), /^2026-05-01/);
  assert.match(await approvedAt(pg, 'ganada-con-fecha'), /^2026-09-15/);
  assert.equal(await approvedAt(pg, 'abierta'), null);
  const audit = (await pg.query(`select opportunity_id from public.psi_sales_opportunity_audit_logs where field_name = 'approved_at'`)).rows;
  assert.deepEqual(audit.map(r => r.opportunity_id), ['ganada-sin-fecha']);
});

test('desde ahora, pasar a ganada por cualquier camino guarda la fecha, y tocarla después no la mueve', async () => {
  const pg = await freshDb();
  await pg.exec(`update public.psi_sales_opportunities set stage_code = 'aprobado' where id = 'abierta'`);
  const first = await approvedAt(pg, 'abierta');
  assert.ok(first, 'la edición de la ficha también deja fecha');
  await pg.exec(`update public.psi_sales_opportunities set stage_code = 'aprobado', updated_at = now() + interval '1 day' where id = 'abierta'`);
  assert.equal(await approvedAt(pg, 'abierta'), first);
  await pg.exec(`insert into public.psi_sales_opportunities (id, stage_code, created_at) values ('nace-ganada', 'aprobado', now())`);
  assert.ok(await approvedAt(pg, 'nace-ganada'));
});

test('el rollback quita la regla y sólo las fechas que puso la 175', async () => {
  const pg = await freshDb();
  await pg.exec(strip(read('../supabase/rollbacks/175_crm_fecha_de_venta_rollback.sql')));
  assert.equal(await approvedAt(pg, 'ganada-sin-fecha'), null);
  assert.match(await approvedAt(pg, 'ganada-con-fecha'), /^2026-09-15/);
  assert.equal((await pg.query(`select count(*)::int n from pg_trigger where tgname = 'psi_sales_opportunity_approved_at_trg'`)).rows[0].n, 0);
});

test('el código fecha la venta por aprobación y, si falta, por registro; nunca por la última modificación', () => {
  for (const [file, pattern] of [
    ['../src/main.tsx', /const day = String\(o\.approved_at \|\| o\.created_at \|\| ''\)\.slice\(0, 10\);/],
    ['../src/vigia/deal-mix.js', /String\(o\.approved_at \|\| o\.created_at \|\| ''\)\.slice\(0, 4\)/],
    ['../src/vigia/commercial-behavior.js', /bogotaDay\(o\.approved_at \|\| o\.created_at \|\| ''\)/],
  ]) assert.match(read(file), pattern, file);
});
