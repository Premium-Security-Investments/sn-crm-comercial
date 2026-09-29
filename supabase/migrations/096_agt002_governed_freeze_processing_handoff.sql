-- AGT-002 governed freeze -> tender processing job handoff.
--
-- Since 087, public.psi_create_tender_processing_job creates every new
-- public.psi_tender_processing_jobs (032) row 'queued' and unauthorized: only the governed
-- document workset freeze (084, public.psi_freeze_agt002_governed_document_workset) may take a
-- job from 'awaiting_analysis_authorization' onward, by freezing the exact document package a
-- human reviewed. That freeze RPC already enqueues the canonical AGT-002 reanalysis job through
-- the untouched, byte-for-byte psi_create_agt002_reanalysis_job (068/081) — this migration never
-- touches that queue or that RPC. What is still missing is the other half: the legacy processing
-- job the pipeline parked in 'awaiting_analysis_authorization' while waiting for exactly this
-- human decision is never told the decision was made, and sits there forever.
--
-- This migration closes that gap with a narrowly scoped AFTER INSERT trigger on
-- public.psi_agt002_governed_document_worksets (084): whenever a governed workset header is
-- actually inserted — i.e. only on a genuinely NEW freeze, never on a replay of an existing
-- selection identity, since a replay never re-inserts that row — it hands off the one exact
-- matching processing job (same opportunity_id, tender_id, snapshot_id, and status still exactly
-- 'awaiting_analysis_authorization') into 'completed', clearing its lease. It never touches the
-- 087-retired analysis_authorized_by/analysis_authorized_at columns, never calls
-- psi_authorize_tender_analysis (revoked by 087), and never enqueues any model work itself: the
-- freeze RPC's own call to psi_create_agt002_reanalysis_job is the only enqueue that ever happens
-- for this freeze. Any unrelated snapshot, unrelated opportunity/tender, or job already past
-- 'awaiting_analysis_authorization' is left exactly as it was.
--
-- A one-time backfill below applies the identical exact-match/status predicate against every
-- governed workset that already existed before this migration, reconciling processing jobs the
-- pipeline froze under 084 before this trigger existed — without touching the governed
-- reanalysis queue those worksets already enqueued into.
begin;

create or replace function public.psi_agt002_governed_workset_handoff_processing_job()
returns trigger
language plpgsql
as $$
begin
  update public.psi_tender_processing_jobs
  set status = 'completed',
      current_step = 'analysis_handed_off_to_governed_workset',
      completed_at = coalesce(completed_at, now()),
      lease_id = null,
      lease_expires_at = null
  where opportunity_id = new.opportunity_id
    and tender_id = new.tender_id
    and snapshot_id = new.snapshot_id
    and status = 'awaiting_analysis_authorization';

  return new;
end;
$$;

revoke all on function public.psi_agt002_governed_workset_handoff_processing_job() from public, anon, authenticated, service_role;

drop trigger if exists psi_agt002_governed_workset_processing_handoff on public.psi_agt002_governed_document_worksets;
create trigger psi_agt002_governed_workset_processing_handoff
  after insert on public.psi_agt002_governed_document_worksets
  for each row execute function public.psi_agt002_governed_workset_handoff_processing_job();

-- One-time backfill: reconcile every governed workset frozen before this migration existed
-- against its exact matching, still-awaiting processing job, with the identical predicate the
-- trigger above uses. Idempotent by construction — the status = 'awaiting_analysis_authorization'
-- predicate never matches a job this backfill (or the trigger) already moved to 'completed'.
update public.psi_tender_processing_jobs job
set status = 'completed',
    current_step = 'analysis_handed_off_to_governed_workset',
    completed_at = coalesce(job.completed_at, now()),
    lease_id = null,
    lease_expires_at = null
from public.psi_agt002_governed_document_worksets w
where job.opportunity_id = w.opportunity_id
  and job.tender_id = w.tender_id
  and job.snapshot_id = w.snapshot_id
  and job.status = 'awaiting_analysis_authorization';

commit;
