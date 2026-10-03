-- Rollback for supabase/migrations/084_agt002_governed_document_worksets.sql.
--
-- Fails closed while ANY governed document workset, frozen member or enqueued run row still
-- exists: a frozen package is the custody record a Licitaciones-authorized human signed off
-- on, and rollback must never silently strand or destroy that history. The three tables are
-- permanently append-only (no UPDATE/DELETE survives their triggers), so there is no
-- "clean up the rows first" path by design — this rollback is only for an installation that
-- has never frozen a package.
--
-- Strictly the inverse of 084 and nothing more: every preexisting document/AGT-002 object
-- (psi_tender_document_versions, psi_tender_document_extractions, psi_agt002_analysis_worksets,
-- psi_record_tender_document_version, psi_record_tender_document_extraction,
-- psi_get_or_create_agt002_analysis_workset, psi_finalize_agt002_durable_batched_analysis)
-- is left exactly as 084 found it. In particular the durable reanalysis queue (068/081) is
-- untouched: dropping the run table only removes 084's foreign-key binding to
-- psi_agt002_reanalysis_jobs, never a job row — and the guard below forbids even that while
-- any run still exists.
begin;

do $$
begin
  if to_regclass('public.psi_agt002_governed_document_workset_members') is not null
     and exists (select 1 from public.psi_agt002_governed_document_workset_members limit 1) then
    raise exception 'Rollback 084 bloqueado: existen documentos congelados en paquetes gobernados AGT-002; el rollback se bloquea para no extraviar evidencia bajo custodia.';
  end if;

  if to_regclass('public.psi_agt002_governed_document_workset_runs') is not null
     and exists (select 1 from public.psi_agt002_governed_document_workset_runs limit 1) then
    raise exception 'Rollback 084 bloqueado: existen ejecuciones encoladas para paquetes documentales gobernados AGT-002; el rollback se bloquea hasta que ese historial se archive por una vía gobernada.';
  end if;

  if to_regclass('public.psi_agt002_governed_document_worksets') is not null
     and exists (select 1 from public.psi_agt002_governed_document_worksets limit 1) then
    raise exception 'Rollback 084 bloqueado: existen paquetes documentales gobernados AGT-002 congelados (historial); el rollback se bloquea para no extraviar la custodia documental.';
  end if;
end $$;

revoke all on function public.psi_freeze_agt002_governed_document_workset(uuid, uuid, uuid, uuid, text, jsonb, jsonb, uuid) from public, authenticated, anon, service_role;
drop function if exists public.psi_freeze_agt002_governed_document_workset(uuid, uuid, uuid, uuid, text, jsonb, jsonb, uuid);

revoke all on function public.psi_resolve_agt002_governed_document_candidate(uuid, uuid, uuid) from public, authenticated, anon, service_role;
drop function if exists public.psi_resolve_agt002_governed_document_candidate(uuid, uuid, uuid);

drop trigger if exists psi_agt002_governed_document_workset_runs_immutable on public.psi_agt002_governed_document_workset_runs;
drop trigger if exists psi_agt002_governed_document_workset_members_immutable on public.psi_agt002_governed_document_workset_members;
drop trigger if exists psi_agt002_governed_document_worksets_immutable on public.psi_agt002_governed_document_worksets;
drop function if exists public.psi_agt002_governed_document_prevent_mutation();

-- Members and runs both reference the workset header: drop in dependency order so a partial
-- rollback never leaves an orphaned child table behind.
drop table if exists public.psi_agt002_governed_document_workset_members;
drop table if exists public.psi_agt002_governed_document_workset_runs;
drop table if exists public.psi_agt002_governed_document_worksets;

commit;
