begin;

-- Tracking events are append-only. Once the new event type has been used, restoring
-- the narrower pre-054 CHECK would invalidate durable evidence and cleanup is not
-- permitted; fail with an explicit operational reason instead.
do $$
begin
  if exists (
    select 1
    from public.psi_tender_tracking_events
    where event_type = 'documents_chunked'
  ) then
    raise exception 'Rollback 054 bloqueado: existen eventos append-only documents_chunked.';
  end if;
end
$$;

alter table public.psi_tender_tracking_events
  drop constraint if exists psi_tender_tracking_events_event_type_check;

alter table public.psi_tender_tracking_events
  add constraint psi_tender_tracking_events_event_type_check
  check (event_type in (
    'entered_tracking','tracking_updated','assigned','blocked','unblocked','returned_to_radar','converted','discarded',
    'detected','pipeline_queued',
    'document_discovery_started','document_import_progress','document_import_completed','document_import_partial','document_import_failed',
    'snapshot_published',
    'analysis_queued','analysis_started','analysis_completed','analysis_failed','analysis_rules_fallback_shown',
    'requirement_pending','information_requested','addendum_reviewed','observation_recorded','internal_meeting','case_note',
    'go_decided','no_go_decided','offer_preparation_started','offer_submitted','awarded','not_awarded','cancelled','deserted',
    'dossier_seeded','dossier_artifact_approved','offer_ready_for_submission'
  ));

commit;
