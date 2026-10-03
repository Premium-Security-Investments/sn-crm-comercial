-- Rollback for supabase/migrations/098_agt002_evidence_packages.sql.
--
-- Fails closed while ANY evidence package, frozen version, member or batch row still exists:
-- a frozen evidence package is the custody record a Licitaciones-authorized actor signed off
-- on, and rollback must never silently strand or destroy that history. The four tables are
-- permanently append-only (no UPDATE/DELETE survives their triggers), so there is no
-- "clean up the rows first" path by design — this rollback is only for an installation that
-- has never frozen a package.
--
-- Strictly the inverse of 098 and nothing more: every preexisting document/AGT-002 object
-- (psi_tender_document_versions, psi_tender_document_extractions,
-- psi_agt002_governed_document_worksets, psi_agt002_analysis_worksets,
-- psi_record_tender_document_version, psi_record_tender_document_extraction,
-- psi_resolve_agt002_governed_document_candidate, psi_freeze_agt002_governed_document_workset,
-- psi_get_or_create_agt002_analysis_workset, psi_finalize_agt002_durable_batched_analysis) is
-- left exactly as 098 found it.
begin;

do $$
begin
  if to_regclass('public.psi_agt002_evidence_package_batches') is not null
     and exists (select 1 from public.psi_agt002_evidence_package_batches limit 1) then
    raise exception 'Rollback 098 bloqueado: existen lotes de paquetes de evidencia AGT-002; el rollback se bloquea para no extraviar evidencia bajo custodia.';
  end if;

  if to_regclass('public.psi_agt002_evidence_package_members') is not null
     and exists (select 1 from public.psi_agt002_evidence_package_members limit 1) then
    raise exception 'Rollback 098 bloqueado: existen documentos congelados en paquetes de evidencia AGT-002; el rollback se bloquea para no extraviar evidencia bajo custodia.';
  end if;

  if to_regclass('public.psi_agt002_evidence_package_versions') is not null
     and exists (select 1 from public.psi_agt002_evidence_package_versions limit 1) then
    raise exception 'Rollback 098 bloqueado: existen versiones congeladas de paquetes de evidencia AGT-002; el rollback se bloquea para no extraviar la custodia documental.';
  end if;

  if to_regclass('public.psi_agt002_evidence_packages') is not null
     and exists (select 1 from public.psi_agt002_evidence_packages limit 1) then
    raise exception 'Rollback 098 bloqueado: existen paquetes de evidencia AGT-002 (historial); el rollback se bloquea para no extraviar la custodia documental.';
  end if;
end $$;

revoke all on function public.psi_freeze_agt002_evidence_package(uuid, uuid, text, jsonb, text, text, text, uuid) from public, authenticated, anon, service_role;
drop function if exists public.psi_freeze_agt002_evidence_package(uuid, uuid, text, jsonb, text, text, text, uuid);

revoke all on function public.psi_resolve_agt002_evidence_package_candidate(uuid, uuid, uuid) from public, authenticated, anon, service_role;
drop function if exists public.psi_resolve_agt002_evidence_package_candidate(uuid, uuid, uuid);

drop trigger if exists psi_agt002_evidence_package_batches_immutable on public.psi_agt002_evidence_package_batches;
drop trigger if exists psi_agt002_evidence_package_members_immutable on public.psi_agt002_evidence_package_members;
drop trigger if exists psi_agt002_evidence_package_versions_immutable on public.psi_agt002_evidence_package_versions;
drop trigger if exists psi_agt002_evidence_packages_immutable on public.psi_agt002_evidence_packages;
drop function if exists public.psi_agt002_evidence_package_prevent_mutation();

-- Members and batches both reference the version row, which references the package header:
-- drop in dependency order so a partial rollback never leaves an orphaned child table behind.
drop table if exists public.psi_agt002_evidence_package_members;
drop table if exists public.psi_agt002_evidence_package_batches;
drop table if exists public.psi_agt002_evidence_package_versions;
drop table if exists public.psi_agt002_evidence_packages;

commit;
