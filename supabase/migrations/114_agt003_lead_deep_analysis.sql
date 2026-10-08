-- AGT-003 — Premio "análisis profundo" del cliente (decisión de Juan, 2026-10-08).
-- Cuando la ficha llega a perfil completo, el comercial pide un análisis de IA del cliente. Cada ejecución queda
-- registrada (quién, cuándo, con qué perfil, resultado, uso). Tope mensual aparte del tope diario de Vig-IA.
-- Sólo el servidor (service_role) lee y escribe; sin acceso para anon/authenticated.
begin;

create table if not exists public.psi_agt003_lead_analyses (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.psi_sales_opportunities(id),
  actor_id uuid not null references public.psi_sales_profiles(id),
  capability_id text not null default 'agt003.lead-deep-analysis' check (capability_id = 'agt003.lead-deep-analysis'),
  contract_version text not null,
  profile_hash text not null check (profile_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('running', 'completed', 'failed')),
  model text,
  website_url text,
  website_status text,
  output jsonb,
  usage jsonb,
  failure_code text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint psi_agt003_lead_analyses_terminal_shape check (
    (status = 'running' and finished_at is null and output is null)
    or (status = 'completed' and finished_at is not null and output is not null and failure_code is null)
    or (status = 'failed' and finished_at is not null and output is null and failure_code is not null)
  )
);

create index if not exists idx_psi_agt003_lead_analyses_opportunity on public.psi_agt003_lead_analyses (opportunity_id, created_at desc);
create index if not exists idx_psi_agt003_lead_analyses_created on public.psi_agt003_lead_analyses (created_at);
create index if not exists idx_psi_agt003_lead_analyses_actor on public.psi_agt003_lead_analyses (actor_id, created_at desc);

alter table public.psi_agt003_lead_analyses enable row level security;
revoke all on table public.psi_agt003_lead_analyses from public, anon, authenticated;

-- Registro inmutable: no se borra; una ejecución sólo pasa de 'running' a 'completed' o 'failed', una vez.
create or replace function public.psi_agt003_lead_analyses_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'psi_agt003_lead_analyses es de solo inserción' using errcode = '42501';
  end if;
  if old.status <> 'running' or new.status = 'running'
     or new.id <> old.id or new.opportunity_id <> old.opportunity_id or new.actor_id <> old.actor_id
     or new.profile_hash <> old.profile_hash or new.created_at <> old.created_at or new.contract_version <> old.contract_version then
    raise exception 'Transición no permitida en psi_agt003_lead_analyses' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists psi_agt003_lead_analyses_guard on public.psi_agt003_lead_analyses;
create trigger psi_agt003_lead_analyses_guard
  before update or delete on public.psi_agt003_lead_analyses
  for each row execute function public.psi_agt003_lead_analyses_guard();

-- Reserva atómica: un análisis completado por oportunidad y perfil; uno en curso a la vez; tope mensual del equipo.
-- Los fallidos no consumen cupo. Una reserva 'running' de más de 5 minutos se considera abandonada.
create or replace function public.psi_claim_agt003_lead_analysis(
  p_opportunity_id uuid,
  p_actor_id uuid,
  p_profile_hash text,
  p_contract_version text,
  p_monthly_max integer,
  p_month_start timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing uuid;
  v_used integer;
  v_id uuid;
begin
  if p_monthly_max is null or p_monthly_max < 1 or p_month_start is null then
    raise exception 'Parámetros de cupo inválidos' using errcode = '22023';
  end if;
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

  select count(*)::int into v_used from public.psi_agt003_lead_analyses
   where created_at >= p_month_start
     and (status = 'completed' or (status = 'running' and created_at > now() - interval '5 minutes'));
  if v_used >= p_monthly_max then
    return jsonb_build_object('status', 'quota', 'used', v_used, 'max', p_monthly_max);
  end if;

  insert into public.psi_agt003_lead_analyses (opportunity_id, actor_id, contract_version, profile_hash, status)
  values (p_opportunity_id, p_actor_id, p_contract_version, p_profile_hash, 'running')
  returning id into v_id;
  return jsonb_build_object('status', 'claimed', 'id', v_id, 'used', v_used + 1, 'max', p_monthly_max);
end;
$$;

create or replace function public.psi_finish_agt003_lead_analysis(
  p_id uuid,
  p_status text,
  p_model text,
  p_website_url text,
  p_website_status text,
  p_output jsonb,
  p_usage jsonb,
  p_failure_code text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_status not in ('completed', 'failed') then
    raise exception 'Estado final inválido' using errcode = '22023';
  end if;
  update public.psi_agt003_lead_analyses
     set status = p_status, model = p_model, website_url = p_website_url, website_status = p_website_status,
         output = case when p_status = 'completed' then p_output else null end,
         usage = p_usage,
         failure_code = case when p_status = 'failed' then coalesce(p_failure_code, 'AGT003_LEAD_ANALYSIS_FAILED') else null end,
         finished_at = now()
   where id = p_id and status = 'running';
  if not found then
    raise exception 'Análisis no encontrado o ya finalizado' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.psi_claim_agt003_lead_analysis(uuid, uuid, text, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.psi_finish_agt003_lead_analysis(uuid, text, text, text, text, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.psi_claim_agt003_lead_analysis(uuid, uuid, text, text, integer, timestamptz) to service_role;
grant execute on function public.psi_finish_agt003_lead_analysis(uuid, text, text, text, text, jsonb, jsonb, text) to service_role;
grant select, insert, update on table public.psi_agt003_lead_analyses to service_role;

commit;
