begin;

alter table public.psi_public_tenders drop constraint if exists psi_public_tenders_section_check;
update public.psi_public_tenders
set section = 'descartar'
where section = 'prioridad_baja';
alter table public.psi_public_tenders
  add constraint psi_public_tenders_section_check
  check (section in ('hacer', 'revisar', 'descartar'));

update public.psi_tender_search_profiles
set section_filter = 'descartar', updated_at = now()
where section_filter = 'prioridad_baja';

alter table public.psi_tender_radar_runs
  drop column if exists count_prioridad_baja;

commit;
