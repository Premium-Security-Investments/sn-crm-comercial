-- Identidad técnica mínima y no autenticable de Vig-IA para el runtime AGT-002.
-- No concede permisos, áreas, login ni autoridad humana.
begin;

do $$
declare
  v_id constant uuid := 'a0020000-0000-4000-8000-000000000002';
  v_email constant text := 'agt002.vig-ia@agents.invalid';
  v_existing public.psi_sales_profiles%rowtype;
begin
  select * into v_existing
  from public.psi_sales_profiles
  where id = v_id
  for update;

  if exists(
    select 1 from public.psi_sales_profiles
    where lower(microsoft_email)=v_email and id<>v_id
  ) then
    raise exception 'El correo técnico Vig-IA ya pertenece a otra identidad.' using errcode='23514';
  end if;

  if found then
    if v_existing.id <> v_id
      or lower(v_existing.microsoft_email) <> v_email
      or v_existing.full_name <> 'Vig-IA'
      or v_existing.role <> 'comercial'
      or v_existing.active is distinct from true
      or v_existing.identity_type <> 'agent'
      or v_existing.auth_user_id is not null
      or v_existing.commercial_area is not null
      or v_existing.can_edit_customer_segment is distinct from false then
      raise exception 'La identidad técnica Vig-IA existente no coincide con el contrato AGT-002.' using errcode='23514';
    end if;
  else
    insert into public.psi_sales_profiles(
      id,microsoft_email,full_name,role,active,commercial_area,
      can_edit_customer_segment,auth_user_id,identity_type
    ) values (
      v_id,v_email,'Vig-IA','comercial',true,null,false,null,'agent'
    );
  end if;

  if exists(select 1 from public.psi_profile_permissions where profile_id=v_id)
    or exists(select 1 from public.psi_profile_area_assignments where profile_id=v_id) then
    raise exception 'La identidad técnica Vig-IA no puede tener permisos ni áreas humanas.' using errcode='23514';
  end if;
end $$;

commit;
