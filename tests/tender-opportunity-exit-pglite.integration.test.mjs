import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const trackingMigration = readFileSync(new URL('../supabase/migrations/018_tender_tracking_rpc.sql', import.meta.url), 'utf8');
const listingMigration = readFileSync(new URL('../supabase/migrations/023_tender_opportunities_listing.sql', import.meta.url), 'utf8');
const exitMigration = readFileSync(new URL('../supabase/migrations/058_tender_opportunity_exit_destinations.sql', import.meta.url), 'utf8');
const exitRollback = readFileSync(new URL('../supabase/rollbacks/058_tender_opportunity_exit_destinations_rollback.sql', import.meta.url), 'utf8');

const ids = {
  actor: '11111111-1111-4111-8111-111111111111',
  owner: '22222222-2222-4222-8222-222222222222',
  radarTender: '33333333-3333-4333-8333-333333333333',
  radarOpportunity: '44444444-4444-4444-8444-444444444444',
  trackingTender: '55555555-5555-4555-8555-555555555555',
  trackingOpportunity: '66666666-6666-4666-8666-666666666666',
  legacyTender: '77777777-7777-4777-8777-777777777777',
  legacyOpportunity: '88888888-8888-4888-8888-888888888888',
  staleTender: '99999999-9999-4999-8999-999999999999',
  staleOpportunity: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  rollbackTender: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  rollbackOpportunity: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  reconvertRollbackTender: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  reconvertRollbackOpportunity: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
};
const token = '2026-08-04T12:00:00.123456Z';
const scalar = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const count = async (db, table) => Number((await scalar(db, `select count(*)::int as count from public.${table}`)).count);

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.psi_sales_profiles (
      id uuid primary key, active boolean not null default true, role text not null,
      microsoft_email text not null, full_name text
    );
    create table public.psi_sales_opportunities (
      id uuid primary key default gen_random_uuid(), company_name text not null, owner_id uuid,
      stage_code text not null, service_type_code text not null, offer_value numeric,
      expected_close_date date, quote_city text, regional_nombre text, sede text,
      economic_sector text, tipo_producto_original text, observaciones text, external_source text,
      loss_notes text, next_action_at timestamptz, tender_offer_status text
    );
    create table public.psi_public_tenders (
      id uuid primary key, stable_key text not null unique, internal_status text,
      converted_opportunity_id uuid, tracking_owner_id uuid, tracking_status text,
      tracking_next_action text, tracking_due_at timestamptz, tracking_blocker text,
      tracking_last_note text, tracking_started_at timestamptz, tracking_updated_at timestamptz,
      reviewed_by uuid, reviewed_at timestamptz, created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table public.psi_sales_interactions (
      id uuid primary key default gen_random_uuid(), opportunity_id uuid not null,
      interaction_type text not null, created_by uuid not null, occurred_at timestamptz not null,
      notes text not null
    );
    create table public.psi_tender_tracking_events (
      id uuid primary key default gen_random_uuid(), tender_id uuid not null, event_type text not null,
      note text, from_status text, to_status text, assigned_to uuid, next_action text,
      due_at timestamptz, blocker text, created_by uuid not null, created_at timestamptz not null default now(),
      constraint psi_tender_tracking_events_event_type_check check (event_type in (
        'entered_tracking','tracking_updated','assigned','blocked','unblocked','returned_to_radar','converted','discarded',
        'detected','pipeline_queued','document_discovery_started','document_import_progress','document_import_completed',
        'document_import_partial','document_import_failed','snapshot_published','documents_chunked','analysis_queued',
        'analysis_started','analysis_completed','analysis_failed','analysis_rules_fallback_shown','requirement_pending',
        'information_requested','addendum_reviewed','observation_recorded','internal_meeting','case_note','go_decided',
        'no_go_decided','offer_preparation_started','offer_submitted','awarded','not_awarded','cancelled','deserted',
        'dossier_seeded','dossier_artifact_approved','offer_ready_for_submission'
      ))
    );
    create table public.psi_tender_go_no_go_decisions (
      id uuid primary key, opportunity_id uuid not null, tender_id uuid not null, decision text not null,
      decided_by uuid, decided_at timestamptz not null
    );
    insert into public.psi_sales_profiles values
      ('${ids.actor}', true, 'admin', 'admin@example.com', 'Admin'),
      ('${ids.owner}', true, 'comercial', 'owner@example.com', 'Owner');
    create function public.fail_selected_tender_event() returns trigger language plpgsql as $$
    begin
      if current_setting('test.fail_event', true) = new.event_type then
        raise exception 'forced % event failure', new.event_type;
      end if;
      return new;
    end $$;
    create trigger fail_selected_tender_event before insert on public.psi_tender_tracking_events
      for each row execute function public.fail_selected_tender_event();
  `);
  await db.exec(trackingMigration);
  await db.exec(listingMigration);
  return db;
}

async function seedConverted(db, tenderId, opportunityId, stableKey, trackingToken = token) {
  await db.exec(`
    insert into public.psi_sales_opportunities
      (id, company_name, owner_id, stage_code, service_type_code, external_source, next_action_at)
    values ('${opportunityId}', 'Entidad ${stableKey}', '${ids.owner}', 'calificada', 'licitacion_publica',
      'secop_radar:SECOP II:${stableKey}', now());
    insert into public.psi_public_tenders
      (id, stable_key, internal_status, converted_opportunity_id, tracking_updated_at, reviewed_at)
    values ('${tenderId}', '${stableKey}', 'convertida_oportunidad', '${opportunityId}',
      ${trackingToken ? `'${trackingToken}'::timestamptz` : 'null'}, '2026-08-01T00:00:00Z');
  `);
}

async function exit(db, opportunityId, destination, expectedToken = token) {
  return scalar(db, `select public.psi_exit_tender_opportunity(
    '${opportunityId}'::uuid, '${ids.actor}'::uuid, '${destination}', 'Razón operativa',
    ${expectedToken ? `'${expectedToken}'::timestamptz` : 'null'}
  ) as result`);
}

const db = await setup();
await seedConverted(db, ids.radarTender, ids.radarOpportunity, 'radar');
await seedConverted(db, ids.trackingTender, ids.trackingOpportunity, 'tracking');
await seedConverted(db, ids.legacyTender, ids.legacyOpportunity, 'legacy', null);
await seedConverted(db, ids.staleTender, ids.staleOpportunity, 'stale');
await seedConverted(db, ids.rollbackTender, ids.rollbackOpportunity, 'rollback');

await db.exec(exitMigration);
await db.exec(exitMigration);

const legacy = await scalar(db, `select tracking_updated_at is not null as repaired from public.psi_public_tenders where id='${ids.legacyTender}'`);
assert.equal(legacy.repaired, true, 'migration backfills unversioned converted tenders');

const radar = (await exit(db, ids.radarOpportunity, 'radar')).result;
assert.equal(radar.internal_status, 'nueva');
assert.equal(radar.tender.converted_opportunity_id, ids.radarOpportunity);
assert.equal((await scalar(db, `select stage_code from public.psi_sales_opportunities where id='${ids.radarOpportunity}'`)).stage_code, 'descartado');
assert.equal((await scalar(db, `select event_type from public.psi_tender_tracking_events where tender_id='${ids.radarTender}'`)).event_type, 'returned_to_radar');
assert.equal((await db.query(`select * from public.psi_list_tender_opportunity_page('all', 50, 0)`)).rows.some(row => row.opportunity.id === ids.radarOpportunity), false);

const radarRetry = (await exit(db, ids.radarOpportunity, 'radar', null)).result;
assert.equal(radarRetry.linked_tender_status, 'already_radar');
assert.equal(await count(db, 'psi_sales_interactions'), 1);
assert.equal((await scalar(db, `select count(*)::int as count from public.psi_tender_tracking_events where tender_id='${ids.radarTender}'`)).count, 1);
await assert.rejects(() => exit(db, ids.radarOpportunity, 'seguimiento', null), /Radar|destino/i);

const tracking = (await exit(db, ids.trackingOpportunity, 'seguimiento')).result;
assert.equal(tracking.internal_status, 'en_revision');
assert.equal(tracking.tender.tracking_status, 'pendiente_revision');
assert.equal(tracking.tender.tracking_owner_id, ids.actor);
assert.equal(tracking.tender.converted_opportunity_id, ids.trackingOpportunity);
assert.equal((await scalar(db, `select event_type from public.psi_tender_tracking_events where tender_id='${ids.trackingTender}'`)).event_type, 'returned_to_tracking');
assert.equal((await db.query(`select * from public.psi_list_tender_opportunity_page('all', 50, 0)`)).rows.some(row => row.opportunity.id === ids.trackingOpportunity), false);

await assert.rejects(() => exit(db, ids.staleOpportunity, 'radar', '2026-08-04T12:00:00.123455Z'), /Seguimiento desactualizado/i);
assert.deepEqual(await scalar(db, `select stage_code from public.psi_sales_opportunities where id='${ids.staleOpportunity}'`), { stage_code: 'calificada' });
assert.deepEqual(await scalar(db, `select internal_status from public.psi_public_tenders where id='${ids.staleTender}'`), { internal_status: 'convertida_oportunidad' });

await db.exec(`select set_config('test.fail_event', 'returned_to_radar', false)`);
await assert.rejects(() => exit(db, ids.rollbackOpportunity, 'radar'), /forced returned_to_radar event failure/);
assert.deepEqual(await scalar(db, `select stage_code from public.psi_sales_opportunities where id='${ids.rollbackOpportunity}'`), { stage_code: 'calificada' });
assert.deepEqual(await scalar(db, `select internal_status from public.psi_public_tenders where id='${ids.rollbackTender}'`), { internal_status: 'convertida_oportunidad' });
await db.exec(`select set_config('test.fail_event', '', false)`);

const radarVersion = (await scalar(db, `select tracking_updated_at::text as token from public.psi_public_tenders where id='${ids.radarTender}'`)).token;
const reconverted = (await scalar(db, `select public.psi_convert_tender_to_opportunity(
  '${ids.radarTender}'::uuid, '${ids.actor}'::uuid, 'secop_radar:SECOP II:radar', 'Entidad radar reactivada',
  '${ids.owner}'::uuid, 'prospecto', 'licitacion_publica', 700000, '2026-09-01'::date, 'Bogotá',
  'Cundinamarca', 'SECOP-R', 'Sector público', 'Licitación Pública', 'Reconvertida', '${radarVersion}'::timestamptz
) as result`)).result;
assert.equal(reconverted.opportunity_id, ids.radarOpportunity);
assert.equal(reconverted.duplicate, true);
assert.deepEqual(await scalar(db, `select stage_code, loss_notes from public.psi_sales_opportunities where id='${ids.radarOpportunity}'`), { stage_code: 'prospecto', loss_notes: null });
assert.deepEqual(await scalar(db, `select internal_status, converted_opportunity_id from public.psi_public_tenders where id='${ids.radarTender}'`), { internal_status: 'convertida_oportunidad', converted_opportunity_id: ids.radarOpportunity });

assert.equal((await db.query(`select * from public.psi_list_tender_opportunity_page('all', 50, 0)`)).rows.some(row => row.opportunity.id === ids.radarOpportunity), true);

const radarVersionAfterReconversion = (await scalar(db, `select tracking_updated_at::text as token from public.psi_public_tenders where id='${ids.radarTender}'`)).token;
const radarRetryAfterReconversion = (await exit(db, ids.radarOpportunity, 'radar', radarVersionAfterReconversion)).result;
assert.equal(radarRetryAfterReconversion.internal_status, 'nueva');
assert.equal(radarRetryAfterReconversion.linked_tender_status, 'returned_to_radar');
assert.deepEqual(
  await scalar(db, `select stage_code from public.psi_sales_opportunities where id='${ids.radarOpportunity}'`),
  { stage_code: 'descartado' },
  'a fresh exit cycle after reconversion must actually re-discard the opportunity, not idempotently no-op',
);
assert.equal(
  (await scalar(db, `select count(*)::int as count from public.psi_tender_tracking_events where tender_id='${ids.radarTender}' and event_type='returned_to_radar'`)).count,
  2,
  'reconversion followed by a new exit must record its own event, not reuse the pre-reconversion one',
);
assert.equal((await db.query(`select * from public.psi_list_tender_opportunity_page('all', 50, 0)`)).rows.some(row => row.opportunity.id === ids.radarOpportunity), false);

const activeListingRows = (await db.query(`select * from public.psi_list_tender_opportunity_page('all', 50, 0)`)).rows;
assert.ok(activeListingRows.length > 0, 'sanity: at least the tracking opportunity remains active');
assert.ok(
  activeListingRows.every(row => row.tender.internal_status === 'convertida_oportunidad'),
  'the opportunities listing must depend on internal_status, not merely on converted_opportunity_id linkage',
);

await db.close();

const radarRollbackDb = await setup();
await seedConverted(radarRollbackDb, ids.rollbackTender, ids.rollbackOpportunity, 'radar-rollback');
await radarRollbackDb.exec(exitMigration);
await exit(radarRollbackDb, ids.rollbackOpportunity, 'radar');
const radarRollbackToken = (await scalar(radarRollbackDb, `select tracking_updated_at::text as token from public.psi_public_tenders where id='${ids.rollbackTender}'`)).token;
assert.notEqual(radarRollbackToken, null, 'exit-to-radar must leave a non-null concurrency token on the Radar row');
await radarRollbackDb.exec(exitRollback);
const trackingAfterRollback = await scalar(radarRollbackDb, `select public.psi_update_tender_tracking(
  '${ids.rollbackTender}'::uuid, '${ids.actor}'::uuid, '${ids.owner}'::uuid, 'pendiente_revision', null, null, null,
  'Retomando seguimiento', '${radarRollbackToken}'::timestamptz
) as result`);
assert.equal(
  trackingAfterRollback.result.internal_status,
  'en_revision',
  'after rollback, a Radar row with a non-null token left by the exit RPC must still be able to move to Seguimiento',
);
await radarRollbackDb.close();

const reconvertRollbackDb = await setup();
await seedConverted(reconvertRollbackDb, ids.reconvertRollbackTender, ids.reconvertRollbackOpportunity, 'reconvert-rollback');
await reconvertRollbackDb.exec(exitMigration);
await exit(reconvertRollbackDb, ids.reconvertRollbackOpportunity, 'radar');
const reconvertRollbackToken = (await scalar(reconvertRollbackDb, `select tracking_updated_at::text as token from public.psi_public_tenders where id='${ids.reconvertRollbackTender}'`)).token;
assert.notEqual(reconvertRollbackToken, null, 'exit-to-radar must leave a non-null concurrency token on the Radar row');
await reconvertRollbackDb.exec(exitRollback);
const opportunityCountBeforeReconversion = await count(reconvertRollbackDb, 'psi_sales_opportunities');
const reconvertedAfterRollback = (await scalar(reconvertRollbackDb, `select public.psi_convert_tender_to_opportunity(
  '${ids.reconvertRollbackTender}'::uuid, '${ids.actor}'::uuid, 'secop_radar:SECOP II:reconvert-rollback', 'Entidad reconvertida tras rollback',
  '${ids.owner}'::uuid, 'prospecto', 'licitacion_publica', 500000, '2026-09-15'::date, 'Bogotá',
  'Cundinamarca', 'SECOP-R', 'Sector público', 'Licitación Pública', 'Reconvertida tras rollback', '${reconvertRollbackToken}'::timestamptz
) as result`)).result;
assert.equal(
  reconvertedAfterRollback.opportunity_id,
  ids.reconvertRollbackOpportunity,
  'after rollback, reconverting a Radar row with its non-null CAS token must reuse the existing opportunity',
);
assert.equal(
  reconvertedAfterRollback.duplicate,
  true,
  'after rollback, reconverting a Radar row with its non-null CAS token must be recognized as a duplicate, not a fresh insert',
);
assert.equal(
  await count(reconvertRollbackDb, 'psi_sales_opportunities'),
  opportunityCountBeforeReconversion,
  'after rollback, reconversion must not create a second opportunity row for the same external_source',
);
assert.deepEqual(
  await scalar(reconvertRollbackDb, `select internal_status, converted_opportunity_id from public.psi_public_tenders where id='${ids.reconvertRollbackTender}'`),
  { internal_status: 'convertida_oportunidad', converted_opportunity_id: ids.reconvertRollbackOpportunity },
);
await reconvertRollbackDb.close();

const rollbackDb = await setup();
await seedConverted(rollbackDb, ids.legacyTender, ids.legacyOpportunity, 'rollback-legacy', null);
await rollbackDb.exec(exitMigration);
await rollbackDb.exec(`insert into public.psi_tender_tracking_events
  (tender_id, event_type, created_by) values ('${ids.legacyTender}', 'returned_to_tracking', '${ids.actor}')`);
const repairedBeforeRollback = await scalar(rollbackDb, `select tracking_updated_at from public.psi_public_tenders where id='${ids.legacyTender}'`);
await rollbackDb.exec(exitRollback);
const rollbackShape = await scalar(rollbackDb, `select
  to_regprocedure('public.psi_exit_tender_opportunity(uuid,uuid,text,text,timestamp with time zone)') is null as exit_removed,
  to_regprocedure('public.psi_discard_tender_opportunity(uuid,uuid,text,timestamp with time zone)') is not null as discard_restored`);
assert.deepEqual(rollbackShape, { exit_removed: true, discard_restored: true });
assert.deepEqual(
  await scalar(rollbackDb, `select tracking_updated_at from public.psi_public_tenders where id='${ids.legacyTender}'`),
  repairedBeforeRollback,
  'rollback preserves repaired lifecycle data',
);
await rollbackDb.close();

console.log('tender opportunity exit PGlite integration passed');
