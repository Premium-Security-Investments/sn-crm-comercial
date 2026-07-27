begin;

-- AGT-002 Charter: the automated score may prioritize, never decide that a
-- process is discarded.  Human discard remains represented by internal_status.
alter table public.psi_public_tenders drop constraint if exists psi_public_tenders_section_check;
update public.psi_public_tenders
set section = 'prioridad_baja'
where section = 'descartar';
alter table public.psi_public_tenders
  add constraint psi_public_tenders_section_check
  check (section in ('hacer', 'revisar', 'prioridad_baja'));

update public.psi_tender_search_profiles
set section_filter = 'prioridad_baja', updated_at = now()
where section_filter = 'descartar';

alter table public.psi_tender_radar_runs
  add column if not exists count_prioridad_baja int not null default 0;

commit;
