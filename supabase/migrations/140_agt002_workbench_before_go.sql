-- AGT-002 — la Mesa con Vig-IA también antes del GO (Juan, 2026-10-20: "tenemos que poder tener con Vig-IA este tipo de
-- interacción para que se resuelvan dudas y se aclaren cosas"). Hasta ahora el hilo y los mensajes exigían un GO vigente
-- (psi_assert_tender_dossier_go, 040/045), así que en la etapa de decidir, que es cuando más se necesita, no había dónde
-- preguntar ni aclarar.
--
-- psi_assert_agt002_workbench_open admite la Mesa con un GO vigente (como antes) o con la oportunidad todavía por decidir
-- (sin decisión vigente, sin archivar y en etapa prospecto). Un NO GO vigente o una oportunidad archivada o cerrada la
-- cierran. Las dos funciones de la 045 se redefinen idénticas salvo esa validación. El expediente de preparación
-- (tareas, artefactos) sigue exigiendo el GO: no cambia.
begin;

create or replace function public.psi_assert_agt002_workbench_open(p_opportunity_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tender_id uuid; v_decision text; v_opportunity public.psi_sales_opportunities%rowtype;
begin
  select t.id into v_tender_id
    from public.psi_public_tenders t
    where t.converted_opportunity_id = p_opportunity_id
    order by t.id limit 1;
  if v_tender_id is null then
    raise exception 'No existe una licitación vinculada a la oportunidad.' using errcode = 'P0002';
  end if;
  select d.decision into v_decision
    from public.psi_tender_go_no_go_decisions d
    where d.opportunity_id = p_opportunity_id and d.tender_id = v_tender_id
      and not exists (select 1 from public.psi_tender_go_no_go_decisions c where c.supersedes_decision_id = d.id)
    order by d.decided_at desc, d.id desc limit 1;
  if v_decision = 'go' then
    return v_tender_id;
  end if;
  if v_decision is not null then
    raise exception 'La Mesa no está disponible: la licitación tiene una decisión NO GO vigente.' using errcode = '23514';
  end if;
  select * into v_opportunity from public.psi_sales_opportunities where id = p_opportunity_id;
  if not found or v_opportunity.archived_at is not null or v_opportunity.stage_code is distinct from 'prospecto' then
    raise exception 'La Mesa sólo está disponible para licitaciones activas (por decidir o con GO).' using errcode = '23514';
  end if;
  return v_tender_id;
end;
$$;
revoke all on function public.psi_assert_agt002_workbench_open(uuid) from public, anon, authenticated;
grant execute on function public.psi_assert_agt002_workbench_open(uuid) to service_role;

create or replace function public.psi_get_or_create_agt002_workbench_thread(p_opportunity_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_tender_id uuid; v_thread public.psi_agt002_workbench_threads%rowtype;
begin
  perform public.psi_assert_agt002_workbench_actor(p_actor_id,false);
  v_tender_id := public.psi_assert_agt002_workbench_open(p_opportunity_id);
  perform pg_advisory_xact_lock(hashtextextended('agt002-thread:' || p_opportunity_id::text,0));
  select * into v_thread from public.psi_agt002_workbench_threads where opportunity_id=p_opportunity_id and closed_at is null;
  if not found then
    insert into public.psi_agt002_workbench_threads(opportunity_id,tender_id,created_by)
    values(p_opportunity_id,v_tender_id,p_actor_id) returning * into v_thread;
  end if;
  return to_jsonb(v_thread);
end;
$$;

create or replace function public.psi_append_agt002_workbench_message(
  p_opportunity_id uuid,p_actor_id uuid,p_thread_id uuid,p_message_id uuid,p_content text,p_context_links jsonb,
  p_idempotency_key text,p_contract_version text,p_policy_version text,p_capability_id text,
  p_snapshot_id uuid,p_base_version_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_thread public.psi_agt002_workbench_threads%rowtype; v_message_id uuid; v_job_id uuid; v_link jsonb; v_existing uuid;
begin
  perform public.psi_assert_agt002_workbench_actor(p_actor_id,false);
  perform public.psi_assert_agt002_workbench_open(p_opportunity_id);
  if p_idempotency_key !~ '^[a-f0-9]{64}$' or nullif(btrim(p_content),'') is null
    or p_contract_version <> 'agt002.dossier-workbench.v1'
    or p_policy_version <> 'agt002.dossier-workbench.policy.v1'
    or p_capability_id not in ('agt002.dossier-workbench.reply.v1','agt002.dossier-workbench.draft.v1','agt002.dossier-workbench.learning-proposal.v1')
    or p_message_id is null or p_snapshot_id is null or p_context_links is null or jsonb_typeof(p_context_links)<>'array'
    or jsonb_array_length(p_context_links)>20 then
    raise exception 'El mensaje de la Mesa no es válido.' using errcode='22023';
  end if;
  select * into v_thread from public.psi_agt002_workbench_threads where id=p_thread_id for share;
  if not found or v_thread.opportunity_id<>p_opportunity_id then
    raise exception 'El hilo no pertenece a la oportunidad.' using errcode='23514';
  end if;
  select id into v_existing from public.psi_agt002_workbench_jobs where idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('status','existing','job_id',v_existing); end if;

  insert into public.psi_agt002_workbench_messages(id,thread_id,opportunity_id,author_id,author_kind,content,idempotency_key)
  values(p_message_id,p_thread_id,p_opportunity_id,p_actor_id,'human',btrim(p_content),p_idempotency_key)
  returning id into v_message_id;

  for v_link in select value from jsonb_array_elements(p_context_links) loop
    if jsonb_typeof(v_link)<>'object' or not (v_link ?& array['kind','id','label','source_ref'])
      or (select count(*) from jsonb_object_keys(v_link))<>4 then
      raise exception 'Un vínculo de contexto no es cerrado.' using errcode='22023';
    end if;
    if (v_link->>'kind') not in ('artifact','source','requirement','action','message','snapshot') then
      raise exception 'Tipo de vínculo inválido.' using errcode='22023';
    end if;
    if (v_link->>'kind')='artifact' and not exists (
      select 1 from public.psi_tender_dossier_artifacts where id=(v_link->>'id')::uuid and opportunity_id=p_opportunity_id
    ) then raise exception 'El artefacto vinculado cruza de expediente.' using errcode='23514'; end if;
    if (v_link->>'kind')='message' and not exists (
      select 1 from public.psi_agt002_workbench_messages where id=(v_link->>'id')::uuid and opportunity_id=p_opportunity_id
    ) then raise exception 'El mensaje vinculado cruza de expediente.' using errcode='23514'; end if;
    insert into public.psi_agt002_workbench_message_links(message_id,opportunity_id,link_kind,resource_id,label,source_ref)
    values(v_message_id,p_opportunity_id,v_link->>'kind',(v_link->>'id')::uuid,btrim(v_link->>'label'),btrim(v_link->>'source_ref'));
  end loop;

  insert into public.psi_agt002_workbench_jobs(
    thread_id,origin_message_id,opportunity_id,tender_id,snapshot_id,base_version_id,capability_id,
    contract_version,policy_version,context_links,message,requested_by,idempotency_key
  ) values(
    p_thread_id,v_message_id,p_opportunity_id,v_thread.tender_id,p_snapshot_id,p_base_version_id,p_capability_id,
    p_contract_version,p_policy_version,p_context_links,btrim(p_content),p_actor_id,p_idempotency_key
  ) returning id into v_job_id;
  insert into public.psi_agt002_workbench_job_events(job_id,event_type) values(v_job_id,'queued');
  return jsonb_build_object('status','queued','message_id',v_message_id,'job_id',v_job_id);
end;
$$;

revoke all on function public.psi_get_or_create_agt002_workbench_thread(uuid, uuid) from public, anon, authenticated;
grant execute on function public.psi_get_or_create_agt002_workbench_thread(uuid, uuid) to service_role;
revoke all on function public.psi_append_agt002_workbench_message(uuid, uuid, uuid, uuid, text, jsonb, text, text, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.psi_append_agt002_workbench_message(uuid, uuid, uuid, uuid, text, jsonb, text, text, text, text, uuid, uuid) to service_role;

commit;
