import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const strip = source => source.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const migration = strip(readFileSync(new URL('../supabase/migrations/054_tender_documents_chunked_event.sql', import.meta.url), 'utf8'));
const rollback = strip(readFileSync(new URL('../supabase/rollbacks/054_tender_documents_chunked_event_rollback.sql', import.meta.url), 'utf8'));

const tender = '33333333-3333-4333-8333-333333333333';
const pre054EventTypes = [
  'entered_tracking', 'tracking_updated', 'assigned', 'blocked', 'unblocked', 'returned_to_radar', 'converted', 'discarded',
  'detected', 'pipeline_queued',
  'document_discovery_started', 'document_import_progress', 'document_import_completed', 'document_import_partial', 'document_import_failed',
  'snapshot_published',
  'analysis_queued', 'analysis_started', 'analysis_completed', 'analysis_failed', 'analysis_rules_fallback_shown',
  'requirement_pending', 'information_requested', 'addendum_reviewed', 'observation_recorded', 'internal_meeting', 'case_note',
  'go_decided', 'no_go_decided', 'offer_preparation_started', 'offer_submitted', 'awarded', 'not_awarded', 'cancelled', 'deserted',
  'dossier_seeded', 'dossier_artifact_approved', 'offer_ready_for_submission',
];

async function db() {
  const pg = new PGlite();
  const quotedTypes = pre054EventTypes.map(value => `'${value}'`).join(',');
  await pg.exec(`
    create table public.psi_public_tenders (id uuid primary key);
    create table public.psi_tender_tracking_events (
      id uuid primary key default gen_random_uuid(),
      tender_id uuid not null references public.psi_public_tenders(id),
      event_type text not null,
      actor_kind text not null default 'human',
      visibility text not null default 'internal',
      constraint psi_tender_tracking_events_event_type_check check (event_type in (${quotedTypes}))
    );
    insert into public.psi_public_tenders (id) values ('${tender}');
  `);
  return pg;
}

async function insertEvent(pg, eventType) {
  await pg.exec(`insert into public.psi_tender_tracking_events (tender_id,event_type,actor_kind,visibility)
    values ('${tender}','${eventType}','system','internal')`);
}

async function run() {
  assert.match(migration, /documents_chunked/i);
  assert.match(rollback, /Rollback 054 bloqueado/i);

  const pg = await db();
  await assert.rejects(insertEvent(pg, 'documents_chunked'), /event_type/i);
  await pg.exec(migration);
  await insertEvent(pg, 'entered_tracking');
  await insertEvent(pg, 'dossier_artifact_approved');
  await insertEvent(pg, 'documents_chunked');
  await assert.rejects(insertEvent(pg, 'not_a_type'), /event_type/i);
  await assert.rejects(pg.exec(rollback), /Rollback 054 bloqueado/i);

  const pgClean = await db();
  await pgClean.exec(migration);
  await pgClean.exec(rollback);
  await assert.rejects(insertEvent(pgClean, 'documents_chunked'), /event_type/i);
  await insertEvent(pgClean, 'snapshot_published');

  console.log('tender documents_chunked event constraint pglite integration passed');
}

run();
