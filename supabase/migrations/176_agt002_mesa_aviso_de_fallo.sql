-- 176 — Un trabajo fallido de la Mesa responde en el chat (Juan, 2026-11-04).
--
-- El pedido del 2026-11-04 20:35Z (`9c85e245…`) falló con AGT002_INVALID_JOB_INPUT y la persona no vio nada durante
-- 16 minutos: el fallo quedaba sólo en `psi_agt002_workbench_job_events`. Desde aquí, cualquier `failed` deja además
-- un mensaje de Vig-IA en el hilo, en lenguaje simple. El código técnico sigue sólo en el registro de eventos.
--
-- El mensaje NO lleva `origin_job_id`, a propósito: `psi_complete_agt002_workbench_job` usa esa columna para decidir
-- que un trabajo ya terminó ("existing"), así que marcarla con el aviso haría que un reintento exitoso se tragara su
-- resultado. La relación con el trabajo va en `idempotency_key`, derivada del evento de fallo: un aviso por fallo,
-- aunque el trabajador lo pida dos veces.
--
-- Una sola firma nueva; se le quitan los permisos por omisión en la misma migración (memoria firma-nueva-nace-sin-permisos).

begin;

create or replace function public.psi_post_agt002_workbench_failure_notice(
  p_job_id uuid, p_agent_id uuid, p_content text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_job public.psi_agt002_workbench_jobs%rowtype;
  v_event uuid; v_key text; v_message uuid;
begin
  perform public.psi_assert_agt002_workbench_agent(p_agent_id);
  if p_content is null or nullif(btrim(p_content), '') is null or length(p_content) > 2000 then
    raise exception 'El aviso de fallo requiere un texto corto.' using errcode = '22023';
  end if;
  select * into v_job from public.psi_agt002_workbench_jobs where id = p_job_id;
  if not found then raise exception 'El trabajo AGT-002 no existe.' using errcode = '23514'; end if;
  -- Sólo después de un fallo: el último evento del trabajo tiene que ser `failed`.
  select id into v_event from public.psi_agt002_workbench_job_events
   where job_id = p_job_id order by created_at desc, id desc limit 1;
  if not exists (select 1 from public.psi_agt002_workbench_job_events where id = v_event and event_type = 'failed') then
    raise exception 'El trabajo AGT-002 no está fallido.' using errcode = '22023';
  end if;
  v_key := encode(sha256(convert_to('agt002-failure-notice:' || p_job_id::text || ':' || v_event::text, 'UTF8')), 'hex');
  select id into v_message from public.psi_agt002_workbench_messages where thread_id = v_job.thread_id and idempotency_key = v_key;
  if v_message is not null then
    return jsonb_build_object('status', 'existing', 'message_id', v_message);
  end if;
  insert into public.psi_agt002_workbench_messages(thread_id, opportunity_id, author_id, author_kind, visible_agent_name, content, idempotency_key)
  values (v_job.thread_id, v_job.opportunity_id, p_agent_id, 'agent', 'Vig-IA', btrim(p_content), v_key)
  returning id into v_message;
  return jsonb_build_object('status', 'posted', 'message_id', v_message);
end;
$$;

revoke all on function public.psi_post_agt002_workbench_failure_notice(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.psi_post_agt002_workbench_failure_notice(uuid, uuid, text) to service_role;

commit;
