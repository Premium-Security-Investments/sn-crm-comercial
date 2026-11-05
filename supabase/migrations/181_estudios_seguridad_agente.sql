-- Estudios de Seguridad Física — la nota de campo con Vig-IA (AGT-003), decisión de Juan del 2026-11-05.
--
-- El inspector escribe o dicta lo que vio ("en la bodega 3 la malla está rota y no hay cámara") y Vig-IA propone
-- zonas, riesgos y controles del catálogo. Nada se guarda sin que la persona confirme, y la calificación (probabilidad
-- e impactos) la pone ella: el agente propone texto, no números. Juan decidió que sea una función más de Vig-IA
-- Comercial (AGT-003) porque "al final esto es casi un tema comercial".
--
-- Igual que la 149: esta tabla existe sólo para el cupo. La nota y la propuesta no se guardan; lo que la persona
-- confirma entra a las tablas del estudio con origen 'agente'. Sólo el servidor lee y escribe. Aditiva.
begin;

create table if not exists public.psi_security_study_agent_runs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.psi_sales_profiles(id) on delete cascade,
  study_id uuid not null references public.psi_security_studies(id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  failure_code text check (failure_code is null or failure_code ~ '^[A-Z0-9_]{1,96}$'),
  model text check (model is null or length(model) <= 128),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists psi_security_study_agent_runs_recent on public.psi_security_study_agent_runs (created_at desc);
create index if not exists psi_security_study_agent_runs_actor_recent on public.psi_security_study_agent_runs (actor_id, created_at desc);

alter table public.psi_security_study_agent_runs enable row level security;
revoke all on table public.psi_security_study_agent_runs from public, anon, authenticated, service_role;
grant select, insert, update on table public.psi_security_study_agent_runs to service_role;

comment on table public.psi_security_study_agent_runs is
  'Ejecuciones de la nota de campo de Estudios de Seguridad (AGT-003). Sólo el rastro, para contar el cupo: la nota y la propuesta no se guardan aquí.';

-- Reserva atómica, copiada de la 149 (brief de reunión): cuentan las completadas y las que llevan menos de dos
-- minutos corriendo; las fallidas no gastan cupo. Una persona no pide dos propuestas a la vez.
create or replace function public.psi_claim_security_study_agent_run(
  p_actor_id uuid,
  p_study_id uuid,
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
  v_team_used integer;
  v_actor_used integer;
  v_id uuid;
begin
  if p_actor_id is null or p_study_id is null then
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

  perform pg_advisory_xact_lock(hashtextextended('agt003-estudios-nota-campo', 0));

  if exists (select 1 from public.psi_security_study_agent_runs
              where actor_id = p_actor_id and status = 'running' and created_at > now() - interval '2 minutes') then
    return jsonb_build_object('status', 'in_progress');
  end if;

  select count(*)::int into v_team_used from public.psi_security_study_agent_runs
   where created_at >= p_team_period_start
     and (status = 'completed' or (status = 'running' and created_at > now() - interval '2 minutes'));
  if v_team_used >= p_team_max then
    return jsonb_build_object('status', 'quota', 'scope', 'team', 'used', v_team_used, 'max', p_team_max);
  end if;

  if p_actor_max is not null then
    select count(*)::int into v_actor_used from public.psi_security_study_agent_runs
     where actor_id = p_actor_id and created_at >= p_actor_period_start
       and (status = 'completed' or (status = 'running' and created_at > now() - interval '2 minutes'));
    if v_actor_used >= p_actor_max then
      return jsonb_build_object('status', 'quota', 'scope', 'actor', 'used', v_actor_used, 'max', p_actor_max);
    end if;
  end if;

  insert into public.psi_security_study_agent_runs (actor_id, study_id, status)
  values (p_actor_id, p_study_id, 'running')
  returning id into v_id;
  return jsonb_build_object('status', 'claimed', 'id', v_id, 'used', v_team_used + 1, 'max', p_team_max);
end;
$$;

revoke all on function public.psi_claim_security_study_agent_run(uuid, uuid, integer, timestamptz, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.psi_claim_security_study_agent_run(uuid, uuid, integer, timestamptz, integer, timestamptz) to service_role;

commit;
