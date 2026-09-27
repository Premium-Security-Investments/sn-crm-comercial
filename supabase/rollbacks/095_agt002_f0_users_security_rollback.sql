-- CERO APPLY. Repo-only evidence. Do NOT `supabase db push`. Do NOT `psql`
-- against prod/staging. Do NOT run this remotely. This file exists so the
-- TDD suite can prove, against a local isolated PGlite instance, that
-- migration 095 is reversible to the pre-095 public.usuarios / registrar_uso_ia
-- catalog state.
--
-- Does not touch public.ia_usage: that ledger already existed before 095 and
-- 095 never changes its grants or schema, so there is no pre-095 ia_usage
-- grant state to restore here.

alter table public.usuarios disable row level security;

revoke all on table public.usuarios from public;
revoke all on table public.usuarios from anon;
revoke all on table public.usuarios from authenticated;
revoke all on table public.usuarios from service_role;

grant all on table public.usuarios to anon;
grant all on table public.usuarios to authenticated;
grant all on table public.usuarios to service_role;

create or replace function public.registrar_uso_ia(
  p_usuario_id uuid,
  p_tokens_input integer,
  p_tokens_output integer,
  p_modelo text default 'haiku'
)
returns json
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_rol text;
  v_limite_diario integer;
  v_consultas_hoy integer;
  v_costo_input float := 0.0000008;
  v_costo_output float := 0.000004;
  v_costo_total float;
  v_permitido boolean;
begin
  select rol into v_rol
  from usuarios
  where id = p_usuario_id;

  v_limite_diario := case v_rol
    when 'admin' then 10
    when 'directivo' then 10
    when 'coordinador' then 5
    when 'supervisor' then 5
    when 'cliente' then 5
    when 'guarda' then 0
    else 0
  end;

  select coalesce(consultas_count, 0) into v_consultas_hoy
  from ia_usage
  where usuario_id = p_usuario_id
    and fecha = current_date;

  v_permitido := v_consultas_hoy < v_limite_diario;

  v_costo_total := p_tokens_input * v_costo_input + p_tokens_output * v_costo_output;

  if v_permitido then
    insert into ia_usage (
      usuario_id, fecha, consultas_count, tokens_input, tokens_output, costo_estimado
    ) values (
      p_usuario_id, current_date, 1, p_tokens_input, p_tokens_output, v_costo_total
    )
    on conflict (usuario_id, fecha) do update
      set consultas_count = ia_usage.consultas_count + 1,
          tokens_input = ia_usage.tokens_input + p_tokens_input,
          tokens_output = ia_usage.tokens_output + p_tokens_output,
          costo_estimado = ia_usage.costo_estimado + v_costo_total,
          updated_at = now();
  end if;

  return json_build_object(
    'permitido', v_permitido,
    'consultas_hoy', v_consultas_hoy + case when v_permitido then 1 else 0 end,
    'limite', v_limite_diario,
    'rol', v_rol,
    'costo', v_costo_total
  );
end;
$function$;

revoke all on function public.registrar_uso_ia(uuid, integer, integer, text) from public;
revoke all on function public.registrar_uso_ia(uuid, integer, integer, text) from anon;
revoke all on function public.registrar_uso_ia(uuid, integer, integer, text) from authenticated;
revoke all on function public.registrar_uso_ia(uuid, integer, integer, text) from service_role;

grant execute on function public.registrar_uso_ia(uuid, integer, integer, text) to authenticated;
grant execute on function public.registrar_uso_ia(uuid, integer, integer, text) to service_role;
