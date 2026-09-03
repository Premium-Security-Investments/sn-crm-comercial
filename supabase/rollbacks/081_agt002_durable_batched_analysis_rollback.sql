begin;

-- Fails closed while ANY workset row is not explicitly archived, or while any
-- durable_batched_v1 job is still active (queued/running): a workset is durable history of
-- governed work (possibly with immutable, append-only checkpoints hanging off it via FK
-- restrict), and rollback must never silently strand or destroy resumable/un-governed
-- history. Governed teardown requires BOTH: every workset explicitly archived via
-- psi_archive_agt002_analysis_workset (archived_at is not null), AND no active job remains
-- for any durable-batched canonical identity. Once both hold, the DROP TABLE statements
-- below intentionally remove checkpoint history too, as the explicit governed archival
-- teardown this rollback exists to perform — but no DELETE is ever issued against a
-- checkpoint row (append-only stays honored right up to the table's removal).
do $$
begin
  if to_regclass('public.psi_agt002_analysis_worksets') is not null
     and exists (select 1 from public.psi_agt002_analysis_worksets where archived_at is null limit 1) then
    raise exception 'Rollback 081 bloqueado: existen worksets AGT-002 sin archivar explícitamente (historial); el rollback se bloquea para no extraviar trabajo recuperable.';
  end if;

  if to_regclass('public.psi_agt002_reanalysis_jobs') is not null
     and exists (
       select 1 from public.psi_agt002_reanalysis_jobs
       where execution_mode = 'durable_batched_v1' and status in ('queued', 'running')
       limit 1
     ) then
    raise exception 'Rollback 081 bloqueado: existe un trabajo AGT-002 durable_batched_v1 activo (queued/running); el rollback se bloquea hasta que ese trabajo termine.';
  end if;
end $$;

revoke all on function public.psi_archive_agt002_analysis_workset(uuid, uuid) from public, authenticated, anon, service_role;
drop function if exists public.psi_archive_agt002_analysis_workset(uuid, uuid);

revoke all on function public.psi_finalize_agt002_durable_batched_analysis(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, integer, text, text, text, text, jsonb, uuid, uuid) from public, authenticated, anon, service_role;
drop function if exists public.psi_finalize_agt002_durable_batched_analysis(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, integer, text, text, text, text, jsonb, uuid, uuid);

revoke all on function public.psi_mark_agt002_analysis_workset_published(uuid, uuid, uuid, uuid) from public, authenticated, anon, service_role;
drop function if exists public.psi_mark_agt002_analysis_workset_published(uuid, uuid, uuid, uuid);

revoke all on function public.psi_record_agt002_analysis_checkpoint(uuid, uuid, uuid, text, integer, text, text, jsonb, text, jsonb, text) from public, authenticated, anon, service_role;
drop function if exists public.psi_record_agt002_analysis_checkpoint(uuid, uuid, uuid, text, integer, text, text, jsonb, text, jsonb, text);

revoke all on function public.psi_list_agt002_analysis_checkpoints(uuid) from public, authenticated, anon, service_role;
drop function if exists public.psi_list_agt002_analysis_checkpoints(uuid);

revoke all on function public.psi_get_agt002_analysis_workset(text) from public, authenticated, anon, service_role;
drop function if exists public.psi_get_agt002_analysis_workset(text);

revoke all on function public.psi_get_or_create_agt002_analysis_workset(uuid, uuid, uuid, uuid, text, jsonb) from public, authenticated, anon, service_role;
drop function if exists public.psi_get_or_create_agt002_analysis_workset(uuid, uuid, uuid, uuid, text, jsonb);

drop trigger if exists psi_agt002_analysis_checkpoints_immutable on public.psi_agt002_analysis_checkpoints;
drop function if exists public.psi_agt002_analysis_checkpoints_prevent_mutation();

drop trigger if exists psi_agt002_analysis_worksets_publication_guard on public.psi_agt002_analysis_worksets;
drop function if exists public.psi_agt002_analysis_worksets_guard_publication();

-- Checkpoints reference worksets: drop in dependency order so a partial rollback never
-- leaves an orphaned checkpoint table.
drop table if exists public.psi_agt002_analysis_checkpoints;
drop table if exists public.psi_agt002_analysis_worksets;

commit;
