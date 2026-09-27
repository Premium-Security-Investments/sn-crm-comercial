-- AGT-002 F0 (migration 095): public.usuarios RLS + registrar_uso_ia hardening.
-- Repo-only until a separate apply receipt. Do not supabase db push. Do not
-- psql prod/staging as part of this slice.
--
-- Independent-review dictamen (live pre-095 evidence, rollback fidelity, and
-- forward-change rationale) is documented in:
--   docs/evidence/2026-09-27-agt002-f0-users-security-dictamen.md
--
-- Scope:
--   1. Enable (not force) row level security on public.usuarios. No policies
--      are added/altered/dropped and no rows are touched here: RLS default-
--      denies everyone except the table owner and service_role (bypassrls),
--      closing the direct anon/authenticated table exposure without yet
--      designing per-row access policies. Any existing policies on
--      public.usuarios are preserved untouched.
--   2. Lock table privileges on public.usuarios down to service_role only.
--      The `GRANT ALL ... TO service_role` below is a preservation of
--      service_role's exact pre-095 table ACL (it already held full table
--      privileges live), not a new expansion of its access: it exists so
--      unenumerated internal/service_role-mediated management paths keep
--      working, while anon and authenticated lose every direct table
--      privilege they previously held. See the dictamen for the captured
--      pre-095 relacl.
--   3. Replace public.registrar_uso_ia(uuid, integer, integer, text) with a
--      validated, concurrency-safe implementation. Callers must be an
--      existing, active public.usuarios row; token counts and model name are
--      bounds-checked; the per-role daily limit and the per-token cost
--      formula are unchanged from the prior behavior. The daily counter is
--      incremented against the pre-existing public.ia_usage ledger (not
--      created here) via a single atomic INSERT .. ON CONFLICT DO UPDATE ..
--      WHERE consultas_count < v_limite .. RETURNING statement so two
--      concurrent calls cannot both slip past the limit (the previous
--      read-count-then-upsert shape was a TOCTOU race). The WHERE guard must
--      stay the literal per-role v_limite, not a hardcoded constant; see
--      scripts/agt002-check-grants-static.mjs and the dictamen.
--   4. Lock EXECUTE on registrar_uso_ia down to service_role only (previously
--      authenticated also held EXECUTE); any client-facing invocation must
--      now go through a service_role-mediated path.

alter table public.usuarios enable row level security;

revoke all on table public.usuarios from public;
revoke all on table public.usuarios from anon;
revoke all on table public.usuarios from authenticated;
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
  v_activo boolean;
  v_limite integer;
  v_modelo text;
  v_costo numeric;
  v_fecha date := current_date;
  v_consultas_hoy integer;
begin
  if p_usuario_id is null then
    return json_build_object(
      'permitido', false,
      'consultas_hoy', null,
      'limite', null,
      'rol', null,
      'costo', null,
      'error', 'usuario_requerido'
    );
  end if;

  if p_tokens_input is null or p_tokens_input < 0 or p_tokens_input > 1000000
     or p_tokens_output is null or p_tokens_output < 0 or p_tokens_output > 1000000 then
    return json_build_object(
      'permitido', false,
      'consultas_hoy', null,
      'limite', null,
      'rol', null,
      'costo', null,
      'error', 'tokens_invalidos'
    );
  end if;

  v_modelo := btrim(p_modelo);
  if v_modelo is null or v_modelo = '' or length(v_modelo) > 100 then
    return json_build_object(
      'permitido', false,
      'consultas_hoy', null,
      'limite', null,
      'rol', null,
      'costo', null,
      'error', 'modelo_invalido'
    );
  end if;

  select rol, activo into v_rol, v_activo
  from public.usuarios
  where id = p_usuario_id;

  if v_rol is null or v_activo is not true then
    return json_build_object(
      'permitido', false,
      'consultas_hoy', null,
      'limite', null,
      'rol', null,
      'costo', null
    );
  end if;

  v_limite := case
    when v_rol in ('admin', 'directivo') then 10
    when v_rol in ('coordinador', 'supervisor', 'cliente') then 5
    else 0
  end;

  if v_limite <= 0 then
    return json_build_object(
      'permitido', false,
      'consultas_hoy', 0,
      'limite', v_limite,
      'rol', v_rol,
      'costo', null
    );
  end if;

  v_costo := p_tokens_input * 0.0000008 + p_tokens_output * 0.000004;

  insert into public.ia_usage as u (
    usuario_id, fecha, consultas_count, tokens_input, tokens_output, costo_estimado, updated_at
  ) values (
    p_usuario_id, v_fecha, 1, p_tokens_input, p_tokens_output, v_costo, now()
  )
  on conflict (usuario_id, fecha) do update
    set consultas_count = u.consultas_count + 1,
        tokens_input = u.tokens_input + excluded.tokens_input,
        tokens_output = u.tokens_output + excluded.tokens_output,
        costo_estimado = u.costo_estimado + excluded.costo_estimado,
        updated_at = now()
  where u.consultas_count < v_limite
  returning u.consultas_count into v_consultas_hoy;

  if v_consultas_hoy is null then
    select consultas_count into v_consultas_hoy
    from public.ia_usage
    where usuario_id = p_usuario_id
      and fecha = v_fecha;

    return json_build_object(
      'permitido', false,
      'consultas_hoy', v_consultas_hoy,
      'limite', v_limite,
      'rol', v_rol,
      'costo', null
    );
  end if;

  return json_build_object(
    'permitido', true,
    'consultas_hoy', v_consultas_hoy,
    'limite', v_limite,
    'rol', v_rol,
    'costo', v_costo
  );
end;
$function$;

revoke all on function public.registrar_uso_ia(uuid, integer, integer, text) from public;
revoke all on function public.registrar_uso_ia(uuid, integer, integer, text) from anon;
revoke all on function public.registrar_uso_ia(uuid, integer, integer, text) from authenticated;
grant execute on function public.registrar_uso_ia(uuid, integer, integer, text) to service_role;
