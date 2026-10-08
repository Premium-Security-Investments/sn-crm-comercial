-- AGT-002 · Documentos de la fase nueva (o republicación) de un proceso SECOP II ya convertido
-- (agt002-phase-change-followup.js). El nombre del archivo viene del primer alcance (republicaciones).
--
-- Cuando SECOP publica una versión nueva de un proceso ya convertido en oportunidad (proceso
-- modificado = proceso nuevo con la misma referencia), el seguimiento automático importa los
-- documentos del aviso nuevo. Los documentos con el mismo nombre ya quedan versionados por
-- psi_record_tender_document_version (identidad lógica por nombre, migración 057); los que sólo
-- existían en el aviso anterior seguirían "vigentes" sin esta función.
--
-- psi_retire_tender_document_versions marca current = false (nunca borra: quedan como historial)
-- las versiones vigentes de una fuente oficial cuya identidad lógica (nombre normalizado) no está en
-- el conjunto nuevo. Rechaza un conjunto vacío para no dejar nunca el expediente sin documentos.
-- Sólo service_role (job del host); el actor queda validado como perfil humano o agente activo.
--
-- psi_append_opportunity_observation_line agrega una línea visible a las observaciones de una
-- oportunidad en una sola sentencia (sin leer y reescribir el campo completo desde la aplicación,
-- para no pisar ediciones humanas) y sólo si esa línea exacta aún no está.
begin;

create or replace function public.psi_retire_tender_document_versions(
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_source text,
  p_keep_names text[],
  p_actor_id uuid
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source text := lower(btrim(p_source));
  v_keep text[];
  v_count integer := 0;
begin
  if p_opportunity_id is null or p_tender_id is null or nullif(v_source, '') is null then
    raise exception 'La oportunidad, la licitación y la fuente son obligatorias.' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct public.psi_normalize_tender_document_name(keep_name)), '{}')
    into v_keep
  from unnest(coalesce(p_keep_names, '{}')) as keep_name
  where nullif(btrim(keep_name), '') is not null;
  if coalesce(array_length(v_keep, 1), 0) = 0 then
    raise exception 'El conjunto vigente nuevo no puede estar vacío.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.psi_public_tenders t
    where t.id = p_tender_id and t.converted_opportunity_id = p_opportunity_id
  ) then
    raise exception 'La licitación no corresponde a la oportunidad.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.psi_sales_profiles p
    where p.id = p_actor_id
      and p.active = true
      and coalesce(p.identity_type, 'human') in ('human', 'agent')
  ) then
    raise exception 'El actor debe ser un perfil humano o agente activo.' using errcode = '42501';
  end if;

  update public.psi_tender_document_versions
     set current = false
   where opportunity_id = p_opportunity_id
     and source = v_source
     and current
     and not (public.psi_normalize_tender_document_name(name) = any (v_keep));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.psi_retire_tender_document_versions(uuid, uuid, text, text[], uuid) from public;
revoke all on function public.psi_retire_tender_document_versions(uuid, uuid, text, text[], uuid) from authenticated;
revoke all on function public.psi_retire_tender_document_versions(uuid, uuid, text, text[], uuid) from anon;
grant execute on function public.psi_retire_tender_document_versions(uuid, uuid, text, text[], uuid) to service_role;

create or replace function public.psi_append_opportunity_observation_line(
  p_opportunity_id uuid,
  p_line text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_line text := btrim(p_line);
  v_count integer := 0;
begin
  if p_opportunity_id is null or nullif(v_line, '') is null or position(E'\n' in v_line) > 0 then
    raise exception 'La oportunidad y una línea no vacía (sin saltos) son obligatorias.' using errcode = '22023';
  end if;
  update public.psi_sales_opportunities
     set observaciones = case
       when nullif(btrim(coalesce(observaciones, '')), '') is null then v_line
       else observaciones || E'\n' || v_line
     end
   where id = p_opportunity_id
     and not (v_line = any (string_to_array(coalesce(observaciones, ''), E'\n')));
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke all on function public.psi_append_opportunity_observation_line(uuid, text) from public;
revoke all on function public.psi_append_opportunity_observation_line(uuid, text) from authenticated;
revoke all on function public.psi_append_opportunity_observation_line(uuid, text) from anon;
grant execute on function public.psi_append_opportunity_observation_line(uuid, text) to service_role;

commit;
