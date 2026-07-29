-- Rollback fail-closed de la identidad técnica Vig-IA.
begin;

do $$
declare
  v_id constant uuid := 'a0020000-0000-4000-8000-000000000002';
  v_existing public.psi_sales_profiles%rowtype;
begin
  select * into v_existing from public.psi_sales_profiles where id=v_id for update;
  if not found then
    return;
  end if;

  if lower(v_existing.microsoft_email)<>'agt002.vig-ia@agents.invalid'
    or v_existing.full_name<>'Vig-IA'
    or v_existing.role<>'comercial'
    or v_existing.active is distinct from true
    or v_existing.identity_type<>'agent'
    or v_existing.auth_user_id is not null
    or v_existing.commercial_area is not null
    or v_existing.can_edit_customer_segment is distinct from false then
    raise exception 'La identidad Vig-IA cambió; rollback rechazado.' using errcode='55000';
  end if;

  if exists(select 1 from public.psi_agt002_workbench_messages where author_id=v_id)
    or exists(select 1 from public.psi_tender_dossier_artifact_versions where author_id=v_id)
    or exists(select 1 from public.psi_profile_permissions where profile_id=v_id)
    or exists(select 1 from public.psi_profile_area_assignments where profile_id=v_id) then
    raise exception 'No se puede retirar Vig-IA: existen evidencias, permisos o áreas vinculadas.' using errcode='55000';
  end if;

  delete from public.psi_sales_profiles where id=v_id;

  if not found then
    raise exception 'La identidad Vig-IA cambió; rollback rechazado.' using errcode='55000';
  end if;
end $$;

commit;
