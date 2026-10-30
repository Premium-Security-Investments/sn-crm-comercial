-- AGT-003 Vig-IA Comercial — chat de registro en Mi día (agt003.chat-registro). Decisiones de Juan Botero, 2026-10-15:
--   · el comercial cuenta lo que hizo y Vig-IA propone los cambios (seguimiento, próxima fecha, datos del perfil,
--     cliente nuevo); NADA se guarda hasta que el comercial pulsa "Confirmar";
--   · chat general en Mi día (Vig-IA reconoce el cliente); después WhatsApp con la misma lógica;
--   · cupo propio de 100 mensajes al día para todo el equipo (aparte de Próximo seguimiento).
--
-- Un turno = un mensaje del comercial + la respuesta de Vig-IA + su propuesta. Aditiva. Solo service_role: la
-- interfaz lee y escribe a través del CRM.
begin;

create table if not exists public.psi_agt003_chat_turns (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.psi_sales_profiles(id) on delete cascade,
  user_text text not null check (length(btrim(user_text)) between 1 and 4000),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  reply_text text check (reply_text is null or length(reply_text) <= 2000),
  proposal jsonb check (proposal is null or jsonb_typeof(proposal) = 'object'),
  proposal_status text check (proposal_status is null or proposal_status in ('pendiente', 'aplicando', 'confirmada', 'descartada')),
  applied jsonb check (applied is null or jsonb_typeof(applied) = 'array'),
  decided_at timestamptz,
  model text check (model is null or length(model) <= 128),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  failure_code text check (failure_code is null or failure_code ~ '^[A-Z0-9_]{1,96}$'),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists psi_agt003_chat_turns_actor_recent on public.psi_agt003_chat_turns (actor_id, created_at desc);
create index if not exists psi_agt003_chat_turns_recent on public.psi_agt003_chat_turns (created_at desc);

alter table public.psi_agt003_chat_turns enable row level security;
revoke all on table public.psi_agt003_chat_turns from public, anon, authenticated, service_role;
grant select, insert, update on table public.psi_agt003_chat_turns to service_role;

-- Reserva atómica de un turno. Cuenta como uso los completados y los 'running' de menos de 3 minutos (los fallidos no
-- consumen cupo). Una persona no puede tener dos mensajes en curso a la vez.
-- Responde {status:'claimed', id, used, max} | {status:'in_progress'} | {status:'quota', scope:'team'|'actor', used, max}.
create or replace function public.psi_claim_agt003_chat_turn(
  p_actor_id uuid,
  p_user_text text,
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
  if p_actor_id is null or p_user_text is null or length(btrim(p_user_text)) = 0 then
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

  perform pg_advisory_xact_lock(hashtextextended('agt003-chat-registro', 0));

  if exists (select 1 from public.psi_agt003_chat_turns
              where actor_id = p_actor_id and status = 'running' and created_at > now() - interval '3 minutes') then
    return jsonb_build_object('status', 'in_progress');
  end if;

  select count(*)::int into v_team_used from public.psi_agt003_chat_turns
   where created_at >= p_team_period_start
     and (status = 'completed' or (status = 'running' and created_at > now() - interval '3 minutes'));
  if v_team_used >= p_team_max then
    return jsonb_build_object('status', 'quota', 'scope', 'team', 'used', v_team_used, 'max', p_team_max);
  end if;

  if p_actor_max is not null then
    select count(*)::int into v_actor_used from public.psi_agt003_chat_turns
     where actor_id = p_actor_id and created_at >= p_actor_period_start
       and (status = 'completed' or (status = 'running' and created_at > now() - interval '3 minutes'));
    if v_actor_used >= p_actor_max then
      return jsonb_build_object('status', 'quota', 'scope', 'actor', 'used', v_actor_used, 'max', p_actor_max);
    end if;
  end if;

  insert into public.psi_agt003_chat_turns (actor_id, user_text, status)
  values (p_actor_id, btrim(p_user_text), 'running')
  returning id into v_id;
  return jsonb_build_object('status', 'claimed', 'id', v_id, 'used', v_team_used + 1, 'max', p_team_max);
end;
$$;

revoke all on function public.psi_claim_agt003_chat_turn(uuid, text, integer, timestamptz, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.psi_claim_agt003_chat_turn(uuid, text, integer, timestamptz, integer, timestamptz) to service_role;

commit;
