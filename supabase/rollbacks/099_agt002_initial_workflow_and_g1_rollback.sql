-- Rollback for 099_agt002_initial_workflow_and_g1.sql. Fails closed while any workflow
-- instance, event, or G1 authorization history exists — dropping these tables would silently
-- destroy an append-only audit trail. Never touches any preexisting AGT-002 object from 098.
begin;

do $$
begin
  if exists (select 1 from public.psi_agt002_workflow_instances)
     or exists (select 1 from public.psi_agt002_workflow_events)
     or exists (select 1 from public.psi_agt002_analysis_authorizations) then
    raise exception 'No se puede revertir 099 mientras exista historial de flujos de trabajo, eventos o autorizaciones AGT-002.' using errcode = '55000';
  end if;
end;
$$;

drop function if exists public.psi_consume_agt002_analysis_authorization(uuid, uuid, uuid, uuid, uuid, text, text, uuid);
drop function if exists public.psi_grant_agt002_g1_analysis_authorization(uuid, uuid, text, timestamptz, text, uuid);
drop function if exists public.psi_create_agt002_workflow_instance(uuid, uuid, text, text, uuid, text, text, uuid);
drop function if exists public.psi_append_agt002_workflow_event(uuid, text, uuid, text, text, text, text, jsonb, jsonb, timestamptz, uuid, text);

drop table if exists public.psi_agt002_analysis_authorizations;
drop table if exists public.psi_agt002_workflow_events;
drop table if exists public.psi_agt002_workflow_instances;

drop function if exists public.psi_agt002_workflow_prevent_mutation();

commit;
