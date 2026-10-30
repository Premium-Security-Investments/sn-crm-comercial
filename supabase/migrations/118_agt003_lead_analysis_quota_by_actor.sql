-- AGT-003 — Puerta única de modelos, Paso 2 (parte 3): el cupo del "Análisis profundo" lo gobierna la configuración
-- APROBADA en la Plataforma de Agentes (Juan Botero, 2026-10-09).
--
-- Nueva reserva psi_claim_agt003_lead_analysis_v2: igual que psi_claim_agt003_lead_analysis (migración 114) — mismo
-- advisory lock, mismo "ya existe" por oportunidad y perfil, mismo "en curso" y la misma definición de uso (completados
-- + reservas 'running' de menos de 5 minutos; los fallidos no consumen cupo) — pero:
--   · cupo del equipo por parámetro (p_team_max, 0..100000) desde p_team_period_start (día o mes en hora de Bogotá,
--     calculado por el servidor);
--   · cupo por persona opcional (p_actor_max desde p_actor_period_start), contado por actor_id;
--   · responde {status:'quota', scope:'team'|'actor', used, max}.
-- La reserva original queda intacta (compatibilidad y retroceso). Sólo service_role ejecuta.
begin;

create or replace function public.psi_claim_agt003_lead_analysis_v2(
  p_opportunity_id uuid,
  p_actor_id uuid,
  p_profile_hash text,
  p_contract_version text,
  p_team_max integer,
  p_team_period_start timestamptz,
  p_actor_max integer,
  p_actor_period_start timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing uuid;
  v_team_used integer;
  v_actor_used integer;
  v_id uuid;
begin
  if p_actor_id is null or p_opportunity_id is null then
    raise exception 'Parámetros de reserva inválidos' using errcode = '22023';
  end if;
  if p_team_max is null or p_team_max < 0 or p_team_max > 100000
     or p_team_period_start is null or p_team_period_start > now() or p_team_period_start < now() - interval '32 days' then
    raise exception 'Parámetros de cupo inválidos' using errcode = '22023';
  end if;
  if p_actor_max is not null and (
       p_actor_max < 0 or p_actor_max > 100000
       or p_actor_period_start is null or p_actor_period_start > now() or p_actor_period_start < now() - interval '32 days') then
    raise exception 'Parámetros de cupo por persona inválidos' using errcode = '22023';
  end if;

  -- Mismo lock que la reserva original: v1 y v2 se serializan entre sí.
  perform pg_advisory_xact_lock(hashtextextended('agt003-lead-analysis', 0));

  select id into v_existing from public.psi_agt003_lead_analyses
   where opportunity_id = p_opportunity_id and profile_hash = p_profile_hash and status = 'completed'
   order by created_at desc limit 1;
  if v_existing is not null then
    return jsonb_build_object('status', 'existing', 'id', v_existing);
  end if;

  if exists (select 1 from public.psi_agt003_lead_analyses
              where opportunity_id = p_opportunity_id and status = 'running' and created_at > now() - interval '5 minutes') then
    return jsonb_build_object('status', 'in_progress');
  end if;

  select count(*)::int into v_team_used from public.psi_agt003_lead_analyses
   where created_at >= p_team_period_start
     and (status = 'completed' or (status = 'running' and created_at > now() - interval '5 minutes'));
  if v_team_used >= p_team_max then
    return jsonb_build_object('status', 'quota', 'scope', 'team', 'used', v_team_used, 'max', p_team_max);
  end if;

  if p_actor_max is not null then
    select count(*)::int into v_actor_used from public.psi_agt003_lead_analyses
     where actor_id = p_actor_id and created_at >= p_actor_period_start
       and (status = 'completed' or (status = 'running' and created_at > now() - interval '5 minutes'));
    if v_actor_used >= p_actor_max then
      return jsonb_build_object('status', 'quota', 'scope', 'actor', 'used', v_actor_used, 'max', p_actor_max);
    end if;
  end if;

  insert into public.psi_agt003_lead_analyses (opportunity_id, actor_id, contract_version, profile_hash, status)
  values (p_opportunity_id, p_actor_id, p_contract_version, p_profile_hash, 'running')
  returning id into v_id;
  return jsonb_build_object('status', 'claimed', 'id', v_id, 'used', v_team_used + 1, 'max', p_team_max);
end;
$$;

revoke all on function public.psi_claim_agt003_lead_analysis_v2(uuid, uuid, text, text, integer, timestamptz, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.psi_claim_agt003_lead_analysis_v2(uuid, uuid, text, text, integer, timestamptz, integer, timestamptz) to service_role;

commit;
