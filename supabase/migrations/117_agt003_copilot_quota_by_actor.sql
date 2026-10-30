-- AGT-003 — Puerta única de modelos, Paso 2 (parte 3): el cupo del "Siguiente paso (copiloto)" lo gobierna la
-- configuración APROBADA en la Plataforma de Agentes (Juan Botero, 2026-10-09).
--
-- Nueva reserva psi_claim_agt003_copilot_run_v2: igual que psi_claim_agt003_copilot_run (migración 043) — mismo advisory
-- lock, misma idempotencia, misma saturación y la misma definición de "uso" (ejecuciones registradas, completadas o
-- fallidas, más reservas vivas) — pero:
--   · el cupo del equipo llega como parámetro (p_team_max, 0..100000) con su inicio de periodo (p_team_period_start),
--     que el servidor calcula en hora de Bogotá (medianoche de Bogotá del día o del día 1 del mes);
--   · cuenta además por persona (actor_id) cuando llega p_actor_max (cupo por persona del perfil de uso de IA, techo
--     de seguridad o excepción vigente), desde p_actor_period_start;
--   · responde {status:'quota', scope:'team'|'actor', used, max} para distinguir el mensaje al usuario.
-- La reserva original queda intacta (compatibilidad y retroceso). Sólo service_role ejecuta.
begin;

-- Las reservas vivas recuerdan quién pidió, para contarlas también en el cupo por persona. Nullable: las reservas
-- creadas por la RPC original no lo traen (duran a lo sumo unos minutos).
alter table public.psi_agt003_copilot_claims add column if not exists actor_id uuid;

create index if not exists psi_agt003_copilot_runs_actor_idx
  on public.psi_agt003_copilot_runs(actor_id, created_at desc);
create index if not exists psi_agt003_copilot_claims_actor_idx
  on public.psi_agt003_copilot_claims(actor_id, claimed_at);

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

  -- Cupo del equipo: ejecuciones registradas (completadas o fallidas) + reservas vivas desde el inicio del periodo.
  select
    (select count(*) from public.psi_agt003_copilot_runs run where run.created_at >= p_team_period_start)
    +
    (select count(*) from public.psi_agt003_copilot_claims claim
      where claim.claimed_at >= p_team_period_start and claim.lease_expires_at > v_now)
  into v_team_used;
  if v_team_used >= p_team_max then
    return jsonb_build_object('status', 'quota', 'scope', 'team', 'used', v_team_used, 'max', p_team_max);
  end if;

  -- Cupo por persona (si aplica): lo mismo, sólo de quien pide.
  if p_actor_max is not null then
    select
      (select count(*) from public.psi_agt003_copilot_runs run
        where run.actor_id = p_actor_id and run.created_at >= p_actor_period_start)
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

commit;
