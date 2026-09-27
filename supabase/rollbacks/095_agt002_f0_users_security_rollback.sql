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
DECLARE
  v_rol text;
  v_limite_diario integer;
  v_consultas_hoy integer;
  v_costo_input  float := 0.0000008;
  v_costo_output float := 0.000004;
  v_costo_total  float;
  v_permitido    boolean;
BEGIN
  SELECT rol INTO v_rol FROM usuarios WHERE id = p_usuario_id;

  v_limite_diario := CASE v_rol
    WHEN 'admin'       THEN 10
    WHEN 'directivo'   THEN 10
    WHEN 'coordinador' THEN 5
    WHEN 'supervisor'  THEN 5
    WHEN 'cliente'     THEN 5
    WHEN 'guarda'      THEN 0
    ELSE 0
  END;

  SELECT COALESCE(consultas_count, 0) INTO v_consultas_hoy
  FROM ia_usage
  WHERE usuario_id = p_usuario_id AND fecha = current_date;

  v_permitido   := v_consultas_hoy < v_limite_diario;
  v_costo_total := (p_tokens_input * v_costo_input) + (p_tokens_output * v_costo_output);

  IF v_permitido THEN
    INSERT INTO ia_usage (usuario_id, fecha, consultas_count, tokens_input, tokens_output, costo_estimado)
    VALUES (p_usuario_id, current_date, 1, p_tokens_input, p_tokens_output, v_costo_total)
    ON CONFLICT (usuario_id, fecha) DO UPDATE SET
      consultas_count = ia_usage.consultas_count + 1,
      tokens_input    = ia_usage.tokens_input    + p_tokens_input,
      tokens_output   = ia_usage.tokens_output   + p_tokens_output,
      costo_estimado  = ia_usage.costo_estimado  + v_costo_total,
      updated_at      = now();
  END IF;

  RETURN json_build_object(
    'permitido',     v_permitido,
    'consultas_hoy', v_consultas_hoy + CASE WHEN v_permitido THEN 1 ELSE 0 END,
    'limite',        v_limite_diario,
    'rol',           v_rol,
    'costo',         v_costo_total
  );
END;
$function$;

revoke all on function public.registrar_uso_ia(uuid, integer, integer, text) from public;
revoke all on function public.registrar_uso_ia(uuid, integer, integer, text) from anon;
revoke all on function public.registrar_uso_ia(uuid, integer, integer, text) from authenticated;
revoke all on function public.registrar_uso_ia(uuid, integer, integer, text) from service_role;

grant execute on function public.registrar_uso_ia(uuid, integer, integer, text) to authenticated;
grant execute on function public.registrar_uso_ia(uuid, integer, integer, text) to service_role;
