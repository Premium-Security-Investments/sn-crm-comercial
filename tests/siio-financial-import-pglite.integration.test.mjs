import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/122_siio_financial_imports.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollbacks/122_siio_financial_imports_rollback.sql', import.meta.url), 'utf8');
const ACTOR = '11111111-1111-4111-8111-111111111111';

async function database() {
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
  await db.exec(migration);
  return db;
}

const payload = {
  file_name: 'PYG_ABRIL_2026_V6.xlsm',
  file_sha256: 'a'.repeat(64),
  file_size_bytes: 1000,
  storage_path: 'financial-imports/actor/2026-04-01/file.xlsm',
  version_label: 'V6',
  period_month: '2026-04-01',
  cutoff_date: '2026-04-30',
  import_type: 'cierre_mensual',
  status: 'validado',
  parser_version: 'test@1',
  structure_signature: 'b'.repeat(64),
  structure: { sheets: [{ name: 'Comparat' }] },
  structure_diff: { baseline: false, changed: false },
  summary: { balance_lines: 1, metrics: 1 },
  balance_lines: [{ year: 2026, month: 4, account: '1', account_name: 'Activo', level: 1, account_class: 1, previous_balance: 0, debits: 100, credits: 0, final_balance: 100, has_manual_adjustment: false, original_formula: null, source_sheet: '4 26', source_row: 2 }],
  metrics: [{ category: 'ingresos', concept: 'INGRESOS', value_current: 100, value_comparison: 80, variation_abs: 20, variation_pct: 0.25, source_sheet: 'Comparat', source_cell: 'C2' }],
  validations: [{ rule: 'V1_BALANCE_CUADRA', severity: 'bloqueante', ok: true, expected: '0', obtained: '0', difference: 0, detail: 'ok' }],
};

test('la migración registra una sola versión atómica y sólo la publica con un segundo paso', async () => {
  const db = await database();
  const first = await db.query('select public.siio_import_financial_workbook($1::jsonb,$2::uuid) as result', [JSON.stringify(payload), ACTOR]);
  assert.equal(first.rows[0].result.status, 'validado');
  assert.equal(first.rows[0].result.duplicate, false);
  const repeated = await db.query('select public.siio_import_financial_workbook($1::jsonb,$2::uuid) as result', [JSON.stringify(payload), ACTOR]);
  assert.equal(repeated.rows[0].result.duplicate, true);
  assert.equal((await db.query('select count(*)::int as count from public.siio_financial_imports')).rows[0].count, 1);
  assert.equal((await db.query('select count(*)::int as count from public.siio_financial_balance_lines')).rows[0].count, 1);
  assert.equal(Number((await db.query("select value_current from public.siio_financial_metrics_current where concept='INGRESOS'" )).rows[0].value_current), 90);

  const id = first.rows[0].result.id;
  const published = await db.query('select public.siio_publish_financial_import($1::uuid,$2::uuid) as result', [id, ACTOR]);
  assert.equal(published.rows[0].result.status, 'publicado');
  assert.equal(Number((await db.query("select value_current from public.siio_financial_metrics_current where concept='INGRESOS'" )).rows[0].value_current), 100);
  await db.close();
});

test('la publicación falla cerrada cuando existe una validación bloqueante', async () => {
  const db = await database();
  const blockedPayload = { ...payload, file_sha256: 'c'.repeat(64), structure_signature: 'd'.repeat(64), validations: [{ ...payload.validations[0], ok: false }] };
  const inserted = await db.query('select public.siio_import_financial_workbook($1::jsonb,$2::uuid) as result', [JSON.stringify(blockedPayload), ACTOR]);
  await assert.rejects(() => db.query('select public.siio_publish_financial_import($1::uuid,$2::uuid)', [inserted.rows[0].result.id, ACTOR]), /financial_import_has_blockers/);
  await db.close();
});

test('la reversa restaura el esquema anterior cuando todavía no hay cargues', async () => {
  const db = await database();
  await db.exec(rollback);
  assert.equal((await db.query("select to_regclass('public.siio_financial_imports') as relation")).rows[0].relation, null);
  assert.equal((await db.query("select to_regclass('public.siio_financial_metrics_current') as relation")).rows[0].relation, null);
  assert.equal(
    (await db.query("select count(*)::int as count from information_schema.columns where table_schema='public' and table_name='siio_financial_metrics' and column_name='import_id'")).rows[0].count,
    0,
  );
  assert.notEqual((await db.query("select to_regclass('public.uq_siio_financial_metric_period_concept_source') as relation")).rows[0].relation, null);
  assert.equal(Number((await db.query("select value_current from public.siio_financial_metrics where concept='INGRESOS'")).rows[0].value_current), 90);
  await db.close();
});

test('la reversa se niega a borrar un cargue existente', async () => {
  const db = await database();
  await db.query('select public.siio_import_financial_workbook($1::jsonb,$2::uuid)', [JSON.stringify(payload), ACTOR]);
  await assert.rejects(() => db.exec(rollback), /rollback_122_refuses_existing_financial_imports/);
  await db.close();
});
