begin;
drop function if exists public.psi_archive_tender_opportunity(uuid, uuid, text, text);
drop table if exists public.psi_tender_opportunity_archive_events;
alter table public.psi_sales_opportunities drop column if exists archive_note, drop column if exists archived_by, drop column if exists archived_at;
commit;
