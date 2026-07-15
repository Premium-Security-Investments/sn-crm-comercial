-- Emergency rollback for migrations 017 and 018.
-- WARNING: dropping tracking columns/events destroys workflow data created after rollout.
-- Use only for an immediate failed deployment, before operators begin managing tenders.

begin;

drop function if exists public.psi_update_tender_tracking(uuid, uuid, uuid, text, text, timestamptz, text, text, timestamptz);
drop function if exists public.psi_transition_tender_tracking(uuid, uuid, text, uuid, text, timestamptz);
drop function if exists public.psi_convert_tender_to_opportunity(uuid, uuid, text, text, uuid, text, text, numeric, date, text, text, text, text, text, text, timestamptz);
drop function if exists public.psi_discard_tender_opportunity(uuid, uuid, text, timestamptz);

drop index if exists public.psi_public_tenders_converted_opportunity_id_unique;
drop index if exists public.psi_sales_opportunities_secop_radar_external_source_unique;
drop index if exists public.idx_public_tenders_tracking_queue;

drop table if exists public.psi_tender_tracking_events;

alter table public.psi_public_tenders
  drop column if exists tracking_owner_id,
  drop column if exists tracking_status,
  drop column if exists tracking_next_action,
  drop column if exists tracking_due_at,
  drop column if exists tracking_blocker,
  drop column if exists tracking_last_note,
  drop column if exists tracking_started_at,
  drop column if exists tracking_updated_at;

-- Restore the pre-018 authenticated write contract. RLS remains the authority.
grant insert, update, delete on public.psi_public_tenders to authenticated;

drop policy if exists psi_public_tenders_modify on public.psi_public_tenders;
create policy psi_public_tenders_modify on public.psi_public_tenders
for all to authenticated
using (
  exists (
    select 1 from public.psi_sales_profiles p
    where lower(p.microsoft_email) = lower(auth.jwt() ->> 'email')
      and p.active = true
      and (p.role in ('admin','director','gerencia') or lower(p.microsoft_email) = 'directora.licitaciones@seguridadnacional.co')
  )
)
with check (
  exists (
    select 1 from public.psi_sales_profiles p
    where lower(p.microsoft_email) = lower(auth.jwt() ->> 'email')
      and p.active = true
      and (p.role in ('admin','director','gerencia') or lower(p.microsoft_email) = 'directora.licitaciones@seguridadnacional.co')
  )
);

commit;
