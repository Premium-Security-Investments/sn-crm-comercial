begin;

-- Runtime contract for the document chunking stage introduced with migration 052.
-- The tracking event CHECK is cumulative, so preserve every event type admitted by
-- migration 040 and add only the new append-only coverage event.
alter table public.psi_tender_tracking_events
  drop constraint if exists psi_tender_tracking_events_event_type_check;

alter table public.psi_tender_tracking_events
  add constraint psi_tender_tracking_events_event_type_check
  check (event_type in (
    'entered_tracking','tracking_updated','assigned','blocked','unblocked','returned_to_radar','converted','discarded',
    'detected','pipeline_queued',
    'document_discovery_started','document_import_progress','document_import_completed','document_import_partial','document_import_failed',
    'snapshot_published','documents_chunked',
    'analysis_queued','analysis_started','analysis_completed','analysis_failed','analysis_rules_fallback_shown',
    'requirement_pending','information_requested','addendum_reviewed','observation_recorded','internal_meeting','case_note',
    'go_decided','no_go_decided','offer_preparation_started','offer_submitted','awarded','not_awarded','cancelled','deserted',
    'dossier_seeded','dossier_artifact_approved','offer_ready_for_submission'
  ));

commit;
