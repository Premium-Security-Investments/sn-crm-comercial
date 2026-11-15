-- 223 — Aliados: las empresas que aparecen en nuestros procesos entran solas a la base.
--
-- Juan Botero, 2026-11-15: «la idea es que ese listado se mantenga actualizado con todas las empresas que cada semana
-- aparecen interesadas en los procesos que vamos a seguir analizando», sólo empresas individuales, «100 % identificadas
-- y con datos de contacto». Un trabajo del servidor (paso semanal de la cadena del Radar) lee en los datos abiertos de
-- SECOP los proponentes de los procesos del CRM y su contacto en el registro de proveedores, y llama a esta función.
--
-- Las funciones de la 196 exigen una persona con permiso de Licitaciones; ésta es del servidor (sólo `service_role`) y
-- hace lo mínimo: crea la empresa si no está —con NIT, nombre y al menos teléfono o correo, y `listing_source` que dice
-- de dónde salió— y agrega la participación si no estaba. Nunca toca rol, contacto ni notas, ni una empresa existente.

begin;

create or replace function public.psi_register_process_participant(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_nit text := nullif(btrim(coalesce(p_payload ->> 'nit', '')), '');
  v_name text := nullif(btrim(coalesce(p_payload ->> 'name', '')), '');
  v_phone text := nullif(btrim(coalesce(p_payload ->> 'phone', '')), '');
  v_email text := nullif(btrim(coalesce(p_payload ->> 'email', '')), '');
  v_kind text := coalesce(p_payload ->> 'kind', 'oferto');
  v_process text := nullif(btrim(coalesce(p_payload ->> 'process_ref', '')), '');
  v_created boolean := false;
begin
  if v_nit is null or v_nit !~ '^[0-9]{6,12}$' then return jsonb_build_object('status', 'sin_nit'); end if;
  if v_process is null then return jsonb_build_object('status', 'sin_proceso'); end if;
  if not exists (select 1 from public.psi_vigilance_companies where nit = v_nit) then
    if v_name is null or (v_phone is null and v_email is null) then return jsonb_build_object('status', 'sin_contacto'); end if;
    insert into public.psi_vigilance_companies (nit, name, representative, phone, email, listing_source, listing_loaded_at)
    values (v_nit, v_name, nullif(btrim(coalesce(p_payload ->> 'representative', '')), ''), v_phone, v_email,
      coalesce(nullif(btrim(coalesce(p_payload ->> 'listing_source', '')), ''), 'SECOP II, proveedores registrados'), now());
    v_created := true;
  end if;
  if exists (select 1 from public.psi_vigilance_participations where nit = v_nit and process_ref = v_process and kind = v_kind) then
    return jsonb_build_object('status', case when v_created then 'empresa_nueva' else 'ya_estaba' end, 'company_created', v_created);
  end if;
  insert into public.psi_vigilance_participations (nit, company_label, entity, process_ref, opportunity_id, kind, detail, source, occurred_on)
  values (v_nit, coalesce(v_name, (select name from public.psi_vigilance_companies where nit = v_nit)),
    nullif(btrim(coalesce(p_payload ->> 'entity', '')), ''), v_process, nullif(p_payload ->> 'opportunity_id', '')::uuid, v_kind,
    nullif(btrim(coalesce(p_payload ->> 'detail', '')), ''), nullif(btrim(coalesce(p_payload ->> 'source', '')), ''),
    nullif(p_payload ->> 'occurred_on', '')::date);
  return jsonb_build_object('status', case when v_created then 'empresa_nueva' else 'participacion_nueva' end, 'company_created', v_created);
end;
$$;
revoke all on function public.psi_register_process_participant(jsonb) from public, anon, authenticated;
grant execute on function public.psi_register_process_participant(jsonb) to service_role;

commit;
