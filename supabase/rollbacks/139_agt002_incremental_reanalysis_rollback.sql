-- Rollback de 139: quita la admisión del reanálisis incremental. Los jobs ya admitidos terminan con el cierre de la 108.
begin;
drop function if exists public.psi_admit_authorized_agt002_incremental_reanalysis_job(uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb, uuid, uuid);
alter table public.psi_agt002_manual_reanalysis_requests drop column if exists mode;
commit;
