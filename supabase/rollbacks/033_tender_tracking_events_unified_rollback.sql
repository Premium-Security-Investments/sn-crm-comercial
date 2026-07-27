do $$
begin
  if exists (
    select 1 from public.psi_tender_tracking_events
    where actor_kind <> 'human'
       or source_ref_type is not null
       or source_ref_id is not null
       or metadata is not null
       or visibility <> 'internal'
       or event_type not in ('entered_tracking','tracking_updated','assigned','blocked','unblocked','returned_to_radar','converted','discarded')
  ) then
    raise exception 'Rollback 033 bloqueado: existen eventos append-only que ya usan columnas o tipos nuevos.';
  end if;
end $$;
drop trigger if exists psi_tender_tracking_events_immutable on public.psi_tender_tracking_events;
drop function if exists public.psi_tender_tracking_events_append_only();
drop index if exists public.psi_tender_tracking_events_tender_cursor_idx;
alter table public.psi_tender_tracking_events drop constraint if exists psi_tender_tracking_events_metadata_object_check;
alter table public.psi_tender_tracking_events drop constraint if exists psi_tender_tracking_events_visibility_check;
alter table public.psi_tender_tracking_events drop constraint if exists psi_tender_tracking_events_actor_kind_check;
alter table public.psi_tender_tracking_events drop constraint if exists psi_tender_tracking_events_event_type_check;
alter table public.psi_tender_tracking_events add constraint psi_tender_tracking_events_event_type_check
  check (event_type in ('entered_tracking','tracking_updated','assigned','blocked','unblocked','returned_to_radar','converted','discarded'));
alter table public.psi_tender_tracking_events
  drop column if exists actor_kind,
  drop column if exists source_ref_type,
  drop column if exists source_ref_id,
  drop column if exists metadata,
  drop column if exists visibility;
