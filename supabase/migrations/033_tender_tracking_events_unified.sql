begin;

alter table public.psi_tender_tracking_events
  add column if not exists actor_kind text not null default 'human',
  add column if not exists source_ref_type text,
  add column if not exists source_ref_id uuid,
  add column if not exists metadata jsonb,
  add column if not exists visibility text not null default 'internal';

alter table public.psi_tender_tracking_events drop constraint if exists psi_tender_tracking_events_event_type_check;
alter table public.psi_tender_tracking_events add constraint psi_tender_tracking_events_event_type_check
  check (event_type in (
    'entered_tracking','tracking_updated','assigned','blocked','unblocked','returned_to_radar','converted','discarded',
    'detected','pipeline_queued',
    'document_discovery_started','document_import_progress','document_import_completed','document_import_partial','document_import_failed',
    'snapshot_published',
    'analysis_queued','analysis_started','analysis_completed','analysis_failed','analysis_rules_fallback_shown',
    'requirement_pending','information_requested','addendum_reviewed','observation_recorded','internal_meeting','case_note',
    'go_decided','no_go_decided','offer_preparation_started','offer_submitted','awarded','not_awarded','cancelled','deserted'));

alter table public.psi_tender_tracking_events add constraint psi_tender_tracking_events_actor_kind_check
  check (actor_kind in ('human','agent','system'));
alter table public.psi_tender_tracking_events add constraint psi_tender_tracking_events_visibility_check
  check (visibility in ('internal'));
alter table public.psi_tender_tracking_events add constraint psi_tender_tracking_events_metadata_object_check
  check (metadata is null or jsonb_typeof(metadata) = 'object');

create index if not exists psi_tender_tracking_events_tender_cursor_idx
  on public.psi_tender_tracking_events (tender_id, created_at desc, id desc);

create or replace function public.psi_tender_tracking_events_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'psi_tender_tracking_events es append-only: % no permitido', tg_op;
end $$;
drop trigger if exists psi_tender_tracking_events_immutable on public.psi_tender_tracking_events;
create trigger psi_tender_tracking_events_immutable
  before update or delete on public.psi_tender_tracking_events
  for each row execute function public.psi_tender_tracking_events_append_only();

commit;
