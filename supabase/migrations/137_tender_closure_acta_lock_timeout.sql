-- Diagnóstico: guardar o confirmar un acta se cuelga más de 20 s y la pasarela
-- corta sin dejar rastro ni en el log de la función ni en el de Postgres. El panel
-- de la base no muestra consultas bloqueadas, así que no se sabe si es un candado
-- o una consulta lenta.
--
-- Esto no adivina la causa: hace que Postgres la nombre. Con `lock_timeout` un
-- candado que no se consigue sale como 55P03 en vez de esperar indefinidamente, y
-- con `statement_timeout` una consulta lenta sale como 57014. Ambos abortan la
-- transacción entera, así que nunca dejan un acta a medio escribir.
--
-- Se aplica sólo a las tres funciones que escriben; la lectura no toma candados.
begin;

create or replace function public.psi_upsert_tender_closure_acta(p_opportunity_id uuid, p_actor_id uuid, p_payload jsonb, p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_opportunity public.psi_sales_opportunities%rowtype;
  v_tender_id uuid;
  v_closure_kind text;
  v_acta public.psi_tender_closure_acta%rowtype;
  v_actor public.psi_sales_profiles%rowtype;
  v_reasons jsonb;
  v_closing jsonb;
  v_now timestamptz := now();
  v_action text;
begin
  -- Un candado que no se consigue en 5 s sale como 55P03; una consulta que pasa de
  -- 15 s sale como 57014. Nunca una espera indefinida detrás de la pasarela.
  perform set_config('lock_timeout', '5s', true);
  perform set_config('statement_timeout', '15s', true);

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'El acta no trae contenido.' using errcode = '22023'; end if;

  select * into v_actor from public.psi_sales_profiles where id = p_actor_id and active = true;
  if not found then raise exception 'El autor del acta no es un perfil activo.' using errcode = '42501'; end if;
  if coalesce(v_actor.identity_type, 'human') = 'human' and v_actor.role not in ('admin', 'gerencia', 'director') then
    raise exception 'No tiene permisos para redactar el acta de cierre.' using errcode = '42501';
  end if;

  -- Sólo se lee la oportunidad para saber cómo se cerró: `for key share` basta y no
  -- compite con quien la archive o le cambie el estado al mismo tiempo.
  select * into v_opportunity from public.psi_sales_opportunities where id = p_opportunity_id for key share;
  if not found then raise exception 'La oportunidad no existe.' using errcode = 'P0002'; end if;

  v_closure_kind := public.psi_tender_closure_kind(v_opportunity);
  if v_closure_kind is null then raise exception 'El acta de cierre sólo se abre cuando la licitación está cerrada.' using errcode = '23514'; end if;

  select t.id into v_tender_id from public.psi_public_tenders t where t.converted_opportunity_id = p_opportunity_id limit 1;
  if v_tender_id is null then raise exception 'No existe una licitación vinculada.' using errcode = 'P0002'; end if;

  v_reasons := coalesce(nullif(p_payload -> 'reasons', 'null'::jsonb), '[]'::jsonb);
  if jsonb_typeof(v_reasons) <> 'array' then raise exception 'Los motivos deben venir en una lista.' using errcode = '22023'; end if;

  select * into v_acta from public.psi_tender_closure_acta where opportunity_id = p_opportunity_id for update;
  if found then
    if v_acta.status = 'confirmada' then raise exception 'El acta ya está confirmada; debe reabrirla para cambiarla.' using errcode = '23505'; end if;
    if p_expected_updated_at is null or v_acta.updated_at is distinct from p_expected_updated_at then raise exception 'El acta cambió mientras la editaba; recárguela.' using errcode = '40001'; end if;
    v_action := 'editada';
    update public.psi_tender_closure_acta set
      closure_kind = v_closure_kind,
      closing_note = coalesce(nullif(btrim(coalesce(p_payload ->> 'closing_note', '')), ''), v_acta.closing_note),
      closing_note_source = case when nullif(btrim(coalesce(p_payload ->> 'closing_note', '')), '') is null then v_acta.closing_note_source
        when nullif(btrim(coalesce(p_payload ->> 'closing_note', '')), '') is distinct from v_acta.closing_note then 'manual'
        else v_acta.closing_note_source end,
      decision_summary = nullif(btrim(coalesce(p_payload ->> 'decision_summary', '')), ''),
      decision_quote = nullif(btrim(coalesce(p_payload ->> 'decision_quote', '')), ''),
      requirements_unmet = coalesce(nullif(p_payload -> 'requirements_unmet', 'null'::jsonb), '[]'::jsonb),
      factors_against = coalesce(nullif(p_payload -> 'factors_against', 'null'::jsonb), '[]'::jsonb),
      gaps_to_compete = coalesce(nullif(p_payload -> 'gaps_to_compete', 'null'::jsonb), '[]'::jsonb),
      recommendation = nullif(btrim(coalesce(p_payload ->> 'recommendation', '')), ''),
      system_lesson = nullif(btrim(coalesce(p_payload ->> 'system_lesson', '')), ''),
      updated_at = v_now
    where id = v_acta.id;
  else
    if p_expected_updated_at is not null then raise exception 'El acta no existe todavía.' using errcode = '40001'; end if;
    v_closing := public.psi_tender_closure_note(p_opportunity_id);
    v_action := 'propuesta';
    insert into public.psi_tender_closure_acta (
      opportunity_id, tender_id, closure_kind, closing_note, closing_note_source,
      decision_summary, decision_quote, requirements_unmet, factors_against, gaps_to_compete,
      recommendation, system_lesson, proposed_by, proposed_at, updated_at
    ) values (
      p_opportunity_id, v_tender_id, v_closure_kind,
      coalesce(nullif(btrim(coalesce(p_payload ->> 'closing_note', '')), ''), v_closing ->> 'note'),
      case when nullif(btrim(coalesce(p_payload ->> 'closing_note', '')), '') is not null then 'manual' else v_closing ->> 'source' end,
      nullif(btrim(coalesce(p_payload ->> 'decision_summary', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'decision_quote', '')), ''),
      coalesce(nullif(p_payload -> 'requirements_unmet', 'null'::jsonb), '[]'::jsonb),
      coalesce(nullif(p_payload -> 'factors_against', 'null'::jsonb), '[]'::jsonb),
      coalesce(nullif(p_payload -> 'gaps_to_compete', 'null'::jsonb), '[]'::jsonb),
      nullif(btrim(coalesce(p_payload ->> 'recommendation', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'system_lesson', '')), ''),
      p_actor_id, v_now, v_now
    ) returning * into v_acta;
  end if;

  delete from public.psi_tender_closure_acta_reason where acta_id = v_acta.id;
  insert into public.psi_tender_closure_acta_reason (acta_id, label, sort_order)
  select v_acta.id, btrim(entry.label), entry.ord
  from jsonb_array_elements_text(v_reasons) with ordinality as entry(label, ord)
  where nullif(btrim(entry.label), '') is not null
  on conflict (acta_id, label) do nothing;

  insert into public.psi_tender_closure_acta_events (acta_id, action, actor_id, snapshot, created_at)
  values (v_acta.id, v_action, p_actor_id, public.psi_tender_closure_acta_snapshot(v_acta.id), v_now);

  return public.psi_get_tender_closure_acta(p_opportunity_id);
end;
$$;
revoke all on function public.psi_upsert_tender_closure_acta(uuid, uuid, jsonb, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.psi_upsert_tender_closure_acta(uuid, uuid, jsonb, timestamptz) to service_role;

create or replace function public.psi_confirm_tender_closure_acta(p_opportunity_id uuid, p_actor_id uuid, p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_acta public.psi_tender_closure_acta%rowtype;
  v_now timestamptz := now();
begin
  perform set_config('lock_timeout', '5s', true);
  perform set_config('statement_timeout', '15s', true);

  if not exists (select 1 from public.psi_sales_profiles p where p.id = p_actor_id and p.active = true and coalesce(p.identity_type, 'human') = 'human' and p.role in ('admin', 'gerencia', 'director')) then
    raise exception 'Sólo una persona autorizada puede confirmar el acta de cierre.' using errcode = '42501';
  end if;
  select * into v_acta from public.psi_tender_closure_acta where opportunity_id = p_opportunity_id for update;
  if not found then raise exception 'El acta de cierre no existe.' using errcode = 'P0002'; end if;
  if v_acta.status = 'confirmada' then raise exception 'El acta ya está confirmada.' using errcode = '23505'; end if;
  if p_expected_updated_at is null or v_acta.updated_at is distinct from p_expected_updated_at then raise exception 'El acta cambió mientras la revisaba; recárguela.' using errcode = '40001'; end if;
  if nullif(btrim(coalesce(v_acta.decision_summary, '')), '') is null then raise exception 'El acta necesita la decisión y su razón principal.' using errcode = '23514'; end if;
  if not exists (select 1 from public.psi_tender_closure_acta_reason r where r.acta_id = v_acta.id) then raise exception 'El acta necesita al menos un motivo para el conteo.' using errcode = '23514'; end if;

  update public.psi_tender_closure_acta set status = 'confirmada', confirmed_by = p_actor_id, confirmed_at = v_now, updated_at = v_now where id = v_acta.id;
  insert into public.psi_tender_closure_acta_events (acta_id, action, actor_id, snapshot, created_at)
  values (v_acta.id, 'confirmada', p_actor_id, public.psi_tender_closure_acta_snapshot(v_acta.id), v_now);
  return public.psi_get_tender_closure_acta(p_opportunity_id);
end;
$$;
revoke all on function public.psi_confirm_tender_closure_acta(uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.psi_confirm_tender_closure_acta(uuid, uuid, timestamptz) to service_role;

create or replace function public.psi_reopen_tender_closure_acta(p_opportunity_id uuid, p_actor_id uuid, p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_acta public.psi_tender_closure_acta%rowtype;
  v_now timestamptz := now();
begin
  perform set_config('lock_timeout', '5s', true);
  perform set_config('statement_timeout', '15s', true);

  if not exists (select 1 from public.psi_sales_profiles p where p.id = p_actor_id and p.active = true and coalesce(p.identity_type, 'human') = 'human' and p.role in ('admin', 'gerencia', 'director')) then
    raise exception 'Sólo una persona autorizada puede reabrir el acta de cierre.' using errcode = '42501';
  end if;
  select * into v_acta from public.psi_tender_closure_acta where opportunity_id = p_opportunity_id for update;
  if not found then raise exception 'El acta de cierre no existe.' using errcode = 'P0002'; end if;
  if v_acta.status <> 'confirmada' then raise exception 'El acta ya está en borrador.' using errcode = '23505'; end if;
  if p_expected_updated_at is null or v_acta.updated_at is distinct from p_expected_updated_at then raise exception 'El acta cambió mientras la revisaba; recárguela.' using errcode = '40001'; end if;

  update public.psi_tender_closure_acta set status = 'borrador', confirmed_by = null, confirmed_at = null, updated_at = v_now where id = v_acta.id;
  insert into public.psi_tender_closure_acta_events (acta_id, action, actor_id, snapshot, created_at)
  values (v_acta.id, 'reabierta', p_actor_id, public.psi_tender_closure_acta_snapshot(v_acta.id), v_now);
  return public.psi_get_tender_closure_acta(p_opportunity_id);
end;
$$;
revoke all on function public.psi_reopen_tender_closure_acta(uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.psi_reopen_tender_closure_acta(uuid, uuid, timestamptz) to service_role;

commit;
