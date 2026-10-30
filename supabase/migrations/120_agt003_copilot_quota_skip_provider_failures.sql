-- AGT-003 — Puerta única de modelos, Paso 3: una falla del proveedor NO consume cupo del "Siguiente paso (copiloto)"
-- (Juan Botero, 2026-10-09: si Claude no responde, la función se pausa y avisa).
--
-- Antes (043 y 117) el cupo del copiloto contaba las ejecuciones registradas completadas O FALLIDAS. Una falla del
-- puente o del modelo (sesión vencida, puente caído, límite de la suscripción, otro error) descontaba un uso aunque la
-- persona no recibiera nada. Desde esta migración la reserva v2 cuenta sólo las ejecuciones completadas más las
-- reservas vivas, igual que el análisis profundo (114/118, donde los fallidos ya no cuentan).
--
-- Qué NO cambia: firma, parámetros, permisos, advisory lock, idempotencia ("existing" sigue viendo también las
-- fallidas, que habilitan la clave de reintento), "en curso", saturación y respuesta {status, scope, used, max}.
-- Los reintentos siguen acotados por la cadena de reintentos del CRM (4 por contexto). La reserva original (043) no se
-- toca: si el servidor tuviera que caer a ella, seguiría contando las fallidas (comportamiento anterior).
-- No es destructiva: sólo reemplaza el cuerpo de una función. Reversa: supabase/rollbacks/120_..._rollback.sql.
begin;

create or replace function public.psi_claim_agt003_copilot_run_v2(
  p_idempotency_key text,
  p_actor_id uuid,
  p_team_max integer,
  p_team_period_start timestamptz,
  p_actor_max integer,
  p_actor_period_start timestamptz,
  p_max_concurrent integer,
  p_lease_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_claim public.psi_agt003_copilot_claims%rowtype;
  v_active integer;
  v_team_used integer;
  v_actor_used integer;
begin
  if p_idempotency_key is null or p_idempotency_key !~ '^[a-f0-9]{64}$' then
    raise exception 'La clave de idempotencia AGT-003 no es válida.' using errcode = '22023';
  end if;
  if p_actor_id is null then
    raise exception 'La persona que pide AGT-003 no es válida.' using errcode = '22023';
  end if;
  if p_team_max is null or p_team_max < 0 or p_team_max > 100000
    or p_max_concurrent is null or p_max_concurrent <= 0
    or p_lease_seconds is null or p_lease_seconds <= 0 or p_lease_seconds > 600 then
    raise exception 'Los límites de reserva AGT-003 no son válidos.' using errcode = '22023';
  end if;
  -- Inicio de periodo razonable: no en el futuro y a lo sumo un mes calendario (+1 día) atrás.
  if p_team_period_start is null or p_team_period_start > v_now or p_team_period_start < v_now - interval '32 days' then
    raise exception 'El inicio del periodo del cupo AGT-003 no es válido.' using errcode = '22023';
  end if;
  if p_actor_max is not null and (
       p_actor_max < 0 or p_actor_max > 100000
       or p_actor_period_start is null or p_actor_period_start > v_now or p_actor_period_start < v_now - interval '32 days') then
    raise exception 'El cupo por persona AGT-003 no es válido.' using errcode = '22023';
  end if;

  -- Mismo lock que la reserva original: v1 y v2 se serializan entre sí.
  perform pg_advisory_xact_lock(hashtextextended('psi_agt003_copilot_claims:v1', 0));

  if exists (select 1 from public.psi_agt003_copilot_runs where idempotency_key = p_idempotency_key) then
    return jsonb_build_object('status', 'existing');
  end if;

  delete from public.psi_agt003_copilot_claims where lease_expires_at <= v_now;
  select * into v_claim from public.psi_agt003_copilot_claims where idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('status', 'in_progress'); end if;

  select count(*)::integer into v_active
  from public.psi_agt003_copilot_claims
  where lease_expires_at > v_now;
  if v_active >= p_max_concurrent then return jsonb_build_object('status', 'saturated'); end if;

  -- Cupo del equipo (desde 120): ejecuciones COMPLETADAS + reservas vivas desde el inicio del periodo. Las fallidas
  -- (sesión vencida, puente caído, límite de la suscripción u otro error del modelo) no consumen cupo.
  select
    (select count(*) from public.psi_agt003_copilot_runs run
      where run.status = 'completed' and run.created_at >= p_team_period_start)
    +
    (select count(*) from public.psi_agt003_copilot_claims claim
      where claim.claimed_at >= p_team_period_start and claim.lease_expires_at > v_now)
  into v_team_used;
  if v_team_used >= p_team_max then
    return jsonb_build_object('status', 'quota', 'scope', 'team', 'used', v_team_used, 'max', p_team_max);
  end if;

  -- Cupo por persona (si aplica): lo mismo (sólo completadas + reservas vivas), sólo de quien pide.
  if p_actor_max is not null then
    select
      (select count(*) from public.psi_agt003_copilot_runs run
        where run.status = 'completed' and run.actor_id = p_actor_id and run.created_at >= p_actor_period_start)
      +
      (select count(*) from public.psi_agt003_copilot_claims claim
        where claim.actor_id = p_actor_id and claim.claimed_at >= p_actor_period_start and claim.lease_expires_at > v_now)
    into v_actor_used;
    if v_actor_used >= p_actor_max then
      return jsonb_build_object('status', 'quota', 'scope', 'actor', 'used', v_actor_used, 'max', p_actor_max);
    end if;
  end if;

  insert into public.psi_agt003_copilot_claims(idempotency_key, lease_expires_at, actor_id)
  values (p_idempotency_key, v_now + make_interval(secs => p_lease_seconds), p_actor_id)
  returning * into v_claim;
  return jsonb_build_object('status', 'claimed', 'claim_id', v_claim.claim_id);
end;
$$;

revoke all on function public.psi_claim_agt003_copilot_run_v2(text, uuid, integer, timestamptz, integer, timestamptz, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.psi_claim_agt003_copilot_run_v2(text, uuid, integer, timestamptz, integer, timestamptz, integer, integer) to service_role;

revoke all on function public.psi_claim_agt003_copilot_run_v2(text, uuid, integer, timestamptz, integer, timestamptz, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.psi_claim_agt003_copilot_run_v2(text, uuid, integer, timestamptz, integer, timestamptz, integer, integer) to service_role;

commit;
