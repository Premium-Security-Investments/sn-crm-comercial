import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// AGT-001: la 142 guarda la provisión de ingresos por tercero y completa los cargues que ya
// estaban en la base sin esas líneas (agosto de 2026 se cargó antes de que existiera la tabla).
const base = readFileSync(new URL('../supabase/migrations/122_siio_financial_imports.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/142_siio_financial_revenue_lines.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollbacks/142_siio_financial_revenue_lines_rollback.sql', import.meta.url), 'utf8');
const ACTOR = '11111111-1111-4111-8111-111111111111';

async function database({ withRevenueMigration = true } = {}) {

  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.psi_sales_profiles (
      id uuid primary key,
      active boolean not null,
      role text not null
    );
    create table public.siio_sources (
      id text primary key,
      name text not null,
      source_type text not null,
      related_fronts text[] not null default '{}',
      owner text,
      responsible_area text,
      trust_level text not null,
      status text not null,
      permissions text not null default '',
      allowed_agent_use text not null default '',
      restrictions text not null default '',
      update_frequency text not null default '',
      last_reviewed_at date,
      updated_at timestamptz not null default now()
    );
    create table public.siio_financial_metrics (
      id uuid primary key default gen_random_uuid(),
      period_month date not null,
      category text not null,
      concept text not null,
      value_current numeric,
      value_comparison numeric,
      variation_abs numeric,
      variation_pct numeric,
      source_id text references public.siio_sources(id),
      validated_by text,
      notes text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create unique index uq_siio_financial_metric_period_concept_source on public.siio_financial_metrics(period_month, concept, source_id);
    insert into public.psi_sales_profiles values ('${ACTOR}', true, 'gerencia');
    insert into public.siio_sources (id,name,source_type,trust_level,status) values ('LEGACY','Semilla','Archivo','oficial_requiere_validacion','activa');
    insert into public.siio_financial_metrics (period_month,category,concept,value_current,source_id) values ('2026-04-01','ingresos','INGRESOS',90,'LEGACY');
  `);
  await db.exec(base);
  if (withRevenueMigration) await db.exec(migration);
  return db;
}

const REVENUE_LINES = [
  { line_type: 'servicio', client_label: 'EMPRESA PARA LA SEGURIDAD Y SOLUCIONES URBANAS - ESU', service_month: 'ABRIL', amount: 600, excluded_from_total: false, source_sheet: 'Ingresos', source_row: 5 },
  { line_type: 'servicio', client_label: 'EDIFICIO TERMINAL MARIANO OSPINA PEREZ PH', service_month: 'ABRIL', amount: 50, excluded_from_total: true, source_sheet: 'Ingresos', source_row: 7 },
  { line_type: 'ajuste', client_label: 'INGENIO MARZO', service_month: null, amount: 75, excluded_from_total: false, source_sheet: 'Ingresos', source_row: 11 },
];

const payload = {
  file_name: 'PYG_ABRIL_2026_V6.xlsm',
  file_sha256: 'a'.repeat(64),
  file_size_bytes: 1000,
  storage_path: 'financial-imports/actor/2026-04-01/file.xlsm',
  version_label: 'V6',
  period_month: '2026-04-01',
  cutoff_date: '2026-04-30',
  import_type: 'cierre_mensual',
  parser_version: 'test@1',
  structure_signature: 'b'.repeat(64),
  structure: { sheets: [{ name: 'Ingresos' }] },
  structure_diff: { baseline: false, changed: false },
  summary: { balance_lines: 1, metrics: 1, revenue_lines: 3 },
  balance_lines: [{ year: 2026, month: 4, account: '1', account_name: 'Activo', level: 1, account_class: 1, previous_balance: 0, debits: 100, credits: 0, final_balance: 100, has_manual_adjustment: false, original_formula: null, source_sheet: '4 26', source_row: 2 }],
  metrics: [{ category: 'ingresos', concept: 'INGRESOS', value_current: 100, value_comparison: 80, variation_abs: 20, variation_pct: 0.25, source_sheet: 'Comparat', source_cell: 'C2' }],
  revenue_lines: REVENUE_LINES,
  validations: [{ rule: 'V1_BALANCE_CUADRA', severity: 'bloqueante', ok: true, expected: '0', obtained: '0', difference: 0, detail: 'ok' }],
};

const call = (db, body) => db.query('select public.siio_import_financial_workbook($1::jsonb,$2::uuid) as result', [JSON.stringify(body), ACTOR]);
const count = async (db, sql, params = []) => Number((await db.query(sql, params)).rows[0].count);

test('guarda la provisión por tercero y la muestra en la vista sólo cuando el cargue está publicado', async () => {
  const db = await database();
  const inserted = await call(db, payload);
  const id = inserted.rows[0].result.id;
  assert.equal(await count(db, 'select count(*)::int as count from public.siio_financial_revenue_lines'), 3);
  assert.equal(await count(db, 'select count(*)::int as count from public.siio_financial_revenue_lines_current'), 0);

  await db.query('select public.siio_validate_financial_import($1::uuid,$2::uuid)', [id, ACTOR]);
  await db.query('select public.siio_publish_financial_import($1::uuid,$2::uuid)', [id, ACTOR]);
  const rows = (await db.query("select client_label, line_type, amount, excluded_from_total, to_char(period_month, 'YYYY-MM-DD') as period_month from public.siio_financial_revenue_lines_current order by source_row")).rows;
  assert.equal(rows.length, 3);
  assert.equal(rows[0].line_type, 'servicio');
  assert.equal(Number(rows[0].amount), 600);
  assert.equal(rows[1].excluded_from_total, true);
  assert.equal(rows[2].line_type, 'ajuste');
  assert.equal(rows[0].period_month, '2026-04-01');
  await db.close();
});

test('un cargue viejo sin líneas de ingresos se completa al volver a subir el mismo archivo', async () => {
  const db = await database({ withRevenueMigration: false });
  const first = await call(db, payload);
  const id = first.rows[0].result.id;
  await db.query('select public.siio_validate_financial_import($1::uuid,$2::uuid)', [id, ACTOR]);
  await db.query('select public.siio_publish_financial_import($1::uuid,$2::uuid)', [id, ACTOR]);
  await db.exec(migration);
  assert.equal(await count(db, 'select count(*)::int as count from public.siio_financial_revenue_lines'), 0);

  const again = await call(db, payload);
  assert.equal(again.rows[0].result.duplicate, true);
  assert.equal(again.rows[0].result.id, id);
  assert.equal(again.rows[0].result.revenue_lines_added, 3);
  assert.equal(await count(db, 'select count(*)::int as count from public.siio_financial_imports'), 1);
  assert.equal(await count(db, 'select count(*)::int as count from public.siio_financial_revenue_lines_current'), 3);

  // Un tercer intento no duplica ni vuelve a insertar.
  const third = await call(db, payload);
  assert.equal(third.rows[0].result.revenue_lines_added, 0);
  assert.equal(await count(db, 'select count(*)::int as count from public.siio_financial_revenue_lines'), 3);
  await db.close();
});

test('un libro sin hoja de ingresos se carga igual y no deja líneas', async () => {
  const db = await database();
  const { revenue_lines, ...withoutRevenue } = payload;
  const inserted = await call(db, { ...withoutRevenue, file_sha256: 'c'.repeat(64), structure_signature: 'd'.repeat(64), storage_path: 'financial-imports/actor/2026-04-01/sin-ingresos.xlsm' });
  assert.equal(inserted.rows[0].result.duplicate, false);
  assert.equal(await count(db, 'select count(*)::int as count from public.siio_financial_revenue_lines'), 0);
  await db.close();
});

test('la reversa borra la tabla y la vista, y deja la carga contable funcionando', async () => {
  const db = await database();
  await call(db, payload);
  await db.exec(rollback);
  assert.equal((await db.query("select to_regclass('public.siio_financial_revenue_lines') as relation")).rows[0].relation, null);
  assert.equal((await db.query("select to_regclass('public.siio_financial_revenue_lines_current') as relation")).rows[0].relation, null);
  const again = await call(db, { ...payload, file_sha256: 'e'.repeat(64), structure_signature: 'f'.repeat(64), storage_path: 'financial-imports/actor/2026-04-01/otro.xlsm' });
  assert.equal(again.rows[0].result.duplicate, false);
  assert.equal(await count(db, 'select count(*)::int as count from public.siio_financial_imports'), 2);
  await db.close();
});
