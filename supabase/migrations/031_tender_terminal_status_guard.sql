begin;

create or replace function public.psi_is_tender_terminal_status(p_status text, p_raw jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select lower(concat_ws(' ',
    coalesce(p_status, ''),
    coalesce(p_raw ->> 'estado_del_procedimiento', ''),
    coalesce(p_raw ->> 'estado_del_proceso', ''),
    coalesce(p_raw ->> 'fase', ''),
    coalesce(p_raw ->> 'estado', ''),
    coalesce(p_raw ->> 'descripcion_estado', ''),
    coalesce(p_raw ->> 'estado_resumen', ''),
    coalesce(p_raw ->> 'resultado', ''),
    coalesce(p_raw ->> 'comentario_entidad_estatal', '')
  )) ~ '(cancelad[oa]|revocad[oa]|declarad[oa][[:space:]]+desiert[oa]|desiert[oa]|request[[:space:]]+cancel(l)?ed)';
$$;

revoke all on function public.psi_is_tender_terminal_status(text, jsonb) from public;
revoke all on function public.psi_is_tender_terminal_status(text, jsonb) from anon;
revoke all on function public.psi_is_tender_terminal_status(text, jsonb) from authenticated;
grant execute on function public.psi_is_tender_terminal_status(text, jsonb) to service_role;

-- Patch the installed conversion RPC instead of copying its business body. This
-- preserves the custody hardening introduced after migration 018 and fails on
-- any unexpected definition drift.
do $$
declare
  v_proc regprocedure := to_regprocedure('public.psi_convert_tender_to_opportunity(uuid,uuid,text,text,uuid,text,text,numeric,date,text,text,text,text,text,text,timestamptz)');
  v_definition text;
  v_anchor text := E'\n  if v_tender.internal_status = ''nueva'' then';
  v_guard text := E'\n  if public.psi_is_tender_terminal_status(v_tender.status, v_tender.raw) then\n    raise exception ''No se puede convertir una licitación cancelada, revocada o declarada desierta.'' using errcode = ''P0001'';\n  end if;\n';
begin
  if v_proc is null then
    raise exception 'Falta psi_convert_tender_to_opportunity; aplica primero 018, 020 y 029.';
  end if;
  v_definition := pg_get_functiondef(v_proc);
  if position('public.psi_profile_has_tender_custody(p.id)' in v_definition) = 0 then
    raise exception 'La autorización esperada de custodia cambió; revisión manual requerida.';
  end if;
  if position('public.psi_is_tender_terminal_status(v_tender.status, v_tender.raw)' in v_definition) = 0 then
    if position(v_anchor in v_definition) = 0 then
      raise exception 'El punto de inserción del guard terminal cambió; revisión manual requerida.';
    end if;
    v_definition := replace(v_definition, v_anchor, v_guard || v_anchor);
    execute v_definition;
  end if;
  execute format('revoke all on function %s from public', v_proc);
  execute format('revoke all on function %s from anon', v_proc);
  execute format('revoke all on function %s from authenticated', v_proc);
  execute format('grant execute on function %s to service_role', v_proc);
end;
$$;

commit;
