import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/018_tender_tracking_rpc.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollbacks/017_018_tender_tracking_rollback.sql', import.meta.url), 'utf8');
const ids = {
  actor: '11111111-1111-4111-8111-111111111111',
  owner: '22222222-2222-4222-8222-222222222222',
  tender: '33333333-3333-4333-8333-333333333333',
  tenderTwo: '44444444-4444-4444-8444-444444444444',
  opportunity: '55555555-5555-4555-8555-555555555555',
};

const scalar = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated;
    create role service_role;
    create table public.psi_sales_profiles (
      id uuid primary key, active boolean not null default true, role text not null,
      microsoft_email text not null
    );
    create table public.psi_sales_opportunities (
      id uuid primary key default gen_random_uuid(), company_name text not null, owner_id uuid,
      stage_code text not null, service_type_code text not null, offer_value numeric,
      expected_close_date date, quote_city text, regional_nombre text, sede text,
      economic_sector text, tipo_producto_original text, observaciones text, external_source text,
      loss_notes text, next_action_at timestamptz
    );
    create table public.psi_public_tenders (
      id uuid primary key, stable_key text not null unique, internal_status text,
      converted_opportunity_id uuid, tracking_owner_id uuid, tracking_status text,
      tracking_next_action text, tracking_due_at timestamptz, tracking_blocker text,
      tracking_last_note text, tracking_started_at timestamptz, tracking_updated_at timestamptz,
      reviewed_by uuid, reviewed_at timestamptz
    );
    create table public.psi_sales_interactions (
      id uuid primary key default gen_random_uuid(), opportunity_id uuid not null,
      interaction_type text not null, created_by uuid not null, occurred_at timestamptz not null,
      notes text not null
    );
    create table public.psi_tender_tracking_events (
      id uuid primary key default gen_random_uuid(), tender_id uuid not null, event_type text not null,
      note text, from_status text, to_status text, assigned_to uuid, next_action text,
      due_at timestamptz, blocker text, created_by uuid not null, created_at timestamptz not null default now()
    );
    insert into public.psi_sales_profiles (id, active, role, microsoft_email) values
      ('${ids.actor}', true, 'admin', 'admin@example.com'),
      ('${ids.owner}', true, 'comercial', 'owner@example.com');
    create or replace function public.fail_selected_tender_event() returns trigger language plpgsql as $$
    begin
      if current_setting('test.fail_event', true) = new.event_type then
        raise exception 'forced % event failure', new.event_type;
      end if;
      return new;
    end $$;
    create trigger fail_selected_tender_event before insert on public.psi_tender_tracking_events
      for each row execute function public.fail_selected_tender_event();
  `);
  await db.exec(migration);
  return db;
}

async function count(db, table) {
  return Number((await scalar(db, `select count(*)::int as count from public.${table}`)).count);
}

async function discard(db, opportunityId, expectedTrackingUpdatedAt = '2026-07-14T12:00:00.000Z') {
  return scalar(db, `select public.psi_discard_tender_opportunity(
    '${opportunityId}'::uuid, '${ids.actor}'::uuid, 'No cumple el margen mínimo', ${expectedTrackingUpdatedAt ? `'${expectedTrackingUpdatedAt}'::timestamptz` : 'null'}
  ) as result`);
}

async function convert(db, tenderId, source = 'secop_radar:SECOP II:one') {
  return scalar(db, `select public.psi_convert_tender_to_opportunity(
    '${tenderId}'::uuid, '${ids.actor}'::uuid, '${source}', 'Entidad pública', '${ids.owner}'::uuid,
    'prospecto', 'licitacion_publica', 500000, '2026-08-01'::date, 'Bogotá', 'Cundinamarca', 'SECOP-1',
    'Sector público', 'Licitación Pública', 'Origen Radar', null
  ) as result`);
}

await (async function rejectsDuplicateTenderLinks() {
  const db = await createDatabase();
  await db.exec(`insert into public.psi_sales_opportunities (id, company_name, stage_code, service_type_code, external_source)
    values ('${ids.opportunity}', 'Entidad', 'prospecto', 'licitacion_publica', 'manual:one');
    insert into public.psi_public_tenders (id, stable_key, internal_status, converted_opportunity_id)
    values ('${ids.tender}', 'one', 'convertida_oportunidad', '${ids.opportunity}');`);
  await assert.rejects(
    db.exec(`insert into public.psi_public_tenders (id, stable_key, internal_status, converted_opportunity_id)
      values ('${ids.tenderTwo}', 'two', 'convertida_oportunidad', '${ids.opportunity}');`),
    /duplicate key|unique/i,
  );
  await db.close();
})();

await (async function rollsBackDiscardWhenImmutableEventFails() {
  const db = await createDatabase();
  await db.exec(`insert into public.psi_sales_opportunities (id, company_name, owner_id, stage_code, service_type_code, external_source, next_action_at)
    values ('${ids.opportunity}', 'Entidad', '${ids.actor}', 'calificada', 'licitacion_publica', 'secop_radar:discard', now());
    insert into public.psi_public_tenders (id, stable_key, internal_status, converted_opportunity_id, tracking_updated_at)
    values ('${ids.tender}', 'discard', 'convertida_oportunidad', '${ids.opportunity}', '2026-07-14T12:00:00.000Z');
    select set_config('test.fail_event', 'discarded', false);`);
  await assert.rejects(() => discard(db, ids.opportunity), /forced discarded event failure/);
  const opportunity = await scalar(db, `select stage_code, next_action_at is not null as has_next_action from public.psi_sales_opportunities where id = '${ids.opportunity}'`);
  const tender = await scalar(db, `select internal_status, converted_opportunity_id from public.psi_public_tenders where id = '${ids.tender}'`);
  assert.deepEqual(opportunity, { stage_code: 'calificada', has_next_action: true });
  assert.deepEqual(tender, { internal_status: 'convertida_oportunidad', converted_opportunity_id: ids.opportunity });
  assert.equal(await count(db, 'psi_sales_interactions'), 0);
  assert.equal(await count(db, 'psi_tender_tracking_events'), 0);
  await db.close();
})();

await (async function discardsOnceAndRetriesWithoutDuplicateNoteOrEvent() {
  const db = await createDatabase();
  await db.exec(`insert into public.psi_sales_opportunities (id, company_name, owner_id, stage_code, service_type_code, external_source)
    values ('${ids.opportunity}', 'Entidad', '${ids.actor}', 'calificada', 'licitacion_publica', 'secop_radar:discard');
    insert into public.psi_public_tenders (id, stable_key, internal_status, converted_opportunity_id, tracking_updated_at)
    values ('${ids.tender}', 'discard', 'convertida_oportunidad', '${ids.opportunity}', '2026-07-14T12:00:00.000Z');`);
  const first = (await discard(db, ids.opportunity)).result;
  const retry = (await discard(db, ids.opportunity, null)).result;
  assert.equal(first.linked_tender_status, 'discarded');
  assert.equal(retry.linked_tender_status, 'already_discarded');
  assert.equal(await count(db, 'psi_sales_interactions'), 1);
  assert.equal(await count(db, 'psi_tender_tracking_events'), 1);
  await db.close();
})();

await (async function reconcilesLegacyDiscardedOpportunityWithStaleTenderWithoutNewOpportunityNote() {
  const db = await createDatabase();
  await db.exec(`insert into public.psi_sales_opportunities (id, company_name, owner_id, stage_code, service_type_code, external_source)
    values ('${ids.opportunity}', 'Entidad', '${ids.actor}', 'descartado', 'licitacion_publica', 'secop_radar:legacy');
    insert into public.psi_public_tenders (id, stable_key, internal_status, converted_opportunity_id, tracking_updated_at)
    values ('${ids.tender}', 'legacy', 'convertida_oportunidad', '${ids.opportunity}', '2026-07-14T12:00:00.000Z');`);
  const result = (await discard(db, ids.opportunity)).result;
  assert.equal(result.linked_tender_status, 'reconciled');
  assert.equal(await count(db, 'psi_sales_interactions'), 0);
  assert.equal(await count(db, 'psi_tender_tracking_events'), 1);
  await db.close();
})();

await (async function rollsBackConversionWhenConvertedEventFails() {
  const db = await createDatabase();
  await db.exec(`insert into public.psi_public_tenders (id, stable_key, internal_status)
    values ('${ids.tender}', 'convert', 'nueva');
    select set_config('test.fail_event', 'converted', false);`);
  await assert.rejects(() => convert(db, ids.tender), /forced converted event failure/);
  assert.equal(await count(db, 'psi_sales_opportunities'), 0);
  const tender = await scalar(db, `select internal_status, converted_opportunity_id from public.psi_public_tenders where id = '${ids.tender}'`);
  assert.deepEqual(tender, { internal_status: 'nueva', converted_opportunity_id: null });
  assert.equal(await count(db, 'psi_tender_tracking_events'), 0);
  await db.close();
})();

await (async function rejectsGenericDiscardOfConvertedTenderUntilCombinedOpportunityDiscard() {
  const db = await createDatabase();
  await db.exec(`insert into public.psi_sales_opportunities (id, company_name, stage_code, service_type_code, external_source)
    values ('${ids.opportunity}', 'Entidad existente', 'calificada', 'licitacion_publica', 'secop_radar:generic-transition');
    insert into public.psi_public_tenders (id, stable_key, internal_status, converted_opportunity_id, tracking_updated_at)
    values ('${ids.tender}', 'generic-conversion', 'convertida_oportunidad', '${ids.opportunity}', '2026-07-14T12:00:00.000Z');`);
  await assert.rejects(
    () => db.query(`select public.psi_transition_tender_tracking(
      '${ids.tender}'::uuid, '${ids.actor}'::uuid, 'descartada', null, 'No debe descartar por transición genérica', '2026-07-14T12:00:00.000Z'::timestamptz
    )`),
    /sacar de oportunidad/i,
  );
  assert.equal(await count(db, 'psi_sales_opportunities'), 1);
  assert.deepEqual(
    await scalar(db, `select stage_code from public.psi_sales_opportunities where id = '${ids.opportunity}'`),
    { stage_code: 'calificada' },
  );
  assert.deepEqual(
    await scalar(db, `select internal_status, converted_opportunity_id from public.psi_public_tenders where id = '${ids.tender}'`),
    { internal_status: 'convertida_oportunidad', converted_opportunity_id: ids.opportunity },
  );
  assert.equal(await count(db, 'psi_sales_interactions'), 0);
  assert.equal(await count(db, 'psi_tender_tracking_events'), 0);
  const combined = (await discard(db, ids.opportunity)).result;
  assert.equal(combined.linked_tender_status, 'discarded');
  assert.deepEqual(
    await scalar(db, `select stage_code from public.psi_sales_opportunities where id = '${ids.opportunity}'`),
    { stage_code: 'descartado' },
  );
  assert.deepEqual(
    await scalar(db, `select internal_status, converted_opportunity_id from public.psi_public_tenders where id = '${ids.tender}'`),
    { internal_status: 'descartada', converted_opportunity_id: null },
  );
  assert.equal(await count(db, 'psi_sales_interactions'), 1);
  assert.equal(await count(db, 'psi_tender_tracking_events'), 1);
  await db.close();
})();

await (async function permitsGenericNuevaDiscardWithNullVersionToken() {
  const db = await createDatabase();
  await db.exec(`insert into public.psi_public_tenders (id, stable_key, internal_status)
    values ('${ids.tender}', 'generic-nueva-discard', 'nueva');`);
  await db.query(`select public.psi_transition_tender_tracking(
    '${ids.tender}'::uuid, '${ids.actor}'::uuid, 'descartada', null, 'Descartada desde Radar', null
  )`);
  assert.deepEqual(
    await scalar(db, `select internal_status, converted_opportunity_id from public.psi_public_tenders where id = '${ids.tender}'`),
    { internal_status: 'descartada', converted_opportunity_id: null },
  );
  assert.equal(await count(db, 'psi_tender_tracking_events'), 1);
  await db.close();
})();

await (async function permitsGenericEnRevisionReturnAndDiscardWithMatchingVersionToken() {
  const db = await createDatabase();
  await db.exec(`insert into public.psi_public_tenders (id, stable_key, internal_status, tracking_updated_at)
    values ('${ids.tender}', 'generic-en-revision-return', 'en_revision', '2026-07-14T12:00:00.000Z');`);
  await db.query(`select public.psi_transition_tender_tracking(
    '${ids.tender}'::uuid, '${ids.actor}'::uuid, 'nueva', null, 'Devolver al Radar', '2026-07-14T12:00:00.000Z'::timestamptz
  )`);
  assert.deepEqual(
    await scalar(db, `select internal_status, converted_opportunity_id from public.psi_public_tenders where id = '${ids.tender}'`),
    { internal_status: 'nueva', converted_opportunity_id: null },
  );
  await db.exec(`update public.psi_public_tenders
    set internal_status = 'en_revision', tracking_updated_at = '2026-07-14T13:00:00.000Z'
    where id = '${ids.tender}';`);
  await db.query(`select public.psi_transition_tender_tracking(
    '${ids.tender}'::uuid, '${ids.actor}'::uuid, 'descartada', null, 'Descartar tras revisión', '2026-07-14T13:00:00.000Z'::timestamptz
  )`);
  assert.deepEqual(
    await scalar(db, `select internal_status, converted_opportunity_id from public.psi_public_tenders where id = '${ids.tender}'`),
    { internal_status: 'descartada', converted_opportunity_id: null },
  );
  assert.equal(await count(db, 'psi_tender_tracking_events'), 2);
  await db.close();
})();

await (async function convertsAndRetriesIdempotently() {
  const db = await createDatabase();
  await db.exec(`insert into public.psi_public_tenders (id, stable_key, internal_status)
    values ('${ids.tender}', 'convert', 'nueva');`);
  const first = (await convert(db, ids.tender)).result;
  const second = (await convert(db, ids.tender)).result;
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(first.opportunity_id, second.opportunity_id);
  assert.equal(await count(db, 'psi_sales_opportunities'), 1);
  assert.equal(await count(db, 'psi_tender_tracking_events'), 1);
  await db.close();
})();

await (async function restoresPreTrackingSchemaOnEmergencyRollback() {
  const db = await createDatabase();
  await db.exec(`
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
  `);
  await db.exec(rollback);
  const shape = await scalar(db, `select
    to_regclass('public.psi_tender_tracking_events') is null as events_removed,
    (select count(*)::int from information_schema.columns where table_schema='public' and table_name='psi_public_tenders' and column_name like 'tracking_%') as tracking_columns,
    (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'psi_%tender%tracking%') as tracking_functions,
    (select count(*)::int from information_schema.role_table_grants where table_schema='public' and table_name='psi_public_tenders' and grantee='authenticated' and privilege_type in ('INSERT','UPDATE','DELETE')) as restored_write_grants,
    (select count(*)::int from pg_policies where schemaname='public' and tablename='psi_public_tenders' and policyname='psi_public_tenders_modify') as restored_policy`);
  assert.deepEqual(shape, {
    events_removed: true,
    tracking_columns: 0,
    tracking_functions: 0,
    restored_write_grants: 3,
    restored_policy: 1,
  });
  await db.close();
})();

console.log('PGlite tender tracking migration integration passed');
