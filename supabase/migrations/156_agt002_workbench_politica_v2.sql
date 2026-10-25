-- Política de la Mesa v2 (2026-10-24): la base acepta la vigente y la anterior.
--
-- La versión de política no vivía solo en el código: está escrita en tres sitios dentro de
-- Postgres —la restricción de la columna y dos funciones—, que es lo correcto, porque así la
-- base no depende de que el servidor se porte bien. El problema era que estaba fijada a UNA
-- versión, de modo que subirla habría rechazado los trabajos ya encolados: la pregunta de una
-- persona perdida por un cambio que no tiene nada que ver con ella.
--
-- Aquí se aplica la misma regla que en el código: para LEER lo encolado se aceptan la vigente y
-- la anterior; para ESTAMPAR lo nuevo, el servidor usa siempre la vigente. Una versión sale de
-- estas listas cuando ya no pueda quedar nada suyo en la cola.
--
-- Las dos funciones se reemplazan con su cuerpo vigente íntegro —extraído de 140 y de 045— y un
-- solo cambio: la comparación de política pasa de `<>` a `not in`.
begin;

alter table public.psi_agt002_workbench_jobs
  drop constraint if exists psi_agt002_workbench_jobs_policy_version_check;
alter table public.psi_agt002_workbench_jobs
  add constraint psi_agt002_workbench_jobs_policy_version_check
  check (policy_version in ('agt002.dossier-workbench.policy.v2','agt002.dossier-workbench.policy.v1'));

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
    or p_policy_version not in ('agt002.dossier-workbench.policy.v2','agt002.dossier-workbench.policy.v1')
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

create or replace function public.psi_complete_agt002_workbench_job(
  p_job_id uuid, p_claim_id uuid, p_agent_id uuid, p_result jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_job public.psi_agt002_workbench_jobs%rowtype;
  v_kind text; v_message_id uuid; v_action jsonb; v_event_id uuid;
  v_artifact public.psi_tender_dossier_artifacts%rowtype;
  v_current uuid; v_number integer; v_version_id uuid;
begin
  perform public.psi_assert_agt002_workbench_agent(p_agent_id);
  -- Bloqueo del job: serializa cualquier intento concurrente de completar el mismo trabajo.
  select * into v_job from public.psi_agt002_workbench_jobs where id=p_job_id for update;
  if not found then raise exception 'El trabajo AGT-002 no existe.' using errcode='23514'; end if;

  -- Idempotencia terminal ANTES de exigir claim vigente: un replay del mismo trabajo ya
  -- completado (cuyo claim terminó con el propio evento completed) retorna existing sin
  -- duplicar mensaje, acción, propuesta ni versión, y sin evento terminal duplicado.
  if exists(select 1 from public.psi_agt002_workbench_messages where origin_job_id=p_job_id) then
    select id into v_message_id from public.psi_agt002_workbench_messages where origin_job_id=p_job_id;
    return jsonb_build_object('status','existing','message_id',v_message_id);
  end if;

  perform public.psi_assert_agt002_workbench_claim(p_job_id,p_claim_id);

  if p_result is null or jsonb_typeof(p_result)<>'object'
    or p_result->>'visible_agent_name'<>'Vig-IA'
    or (p_result->>'human_review_required')::boolean is distinct from true
    or (p_result->>'snapshot_id')::uuid<>v_job.snapshot_id
    or v_job.base_version_id is distinct from nullif(p_result->>'base_version_id','')::uuid then
    raise exception 'Resultado AGT-002 inválido o desalineado con el trabajo congelado.' using errcode='22023';
  end if;

  v_kind := p_result->>'kind';
  if (v_kind='reply' and v_job.capability_id<>'agt002.dossier-workbench.reply.v1')
    or (v_kind='draft' and v_job.capability_id<>'agt002.dossier-workbench.draft.v1')
    or (v_kind='learning_proposal' and v_job.capability_id<>'agt002.dossier-workbench.learning-proposal.v1')
    or v_kind not in ('reply','draft','learning_proposal') then
    raise exception 'El tipo de resultado no coincide con la capacidad del trabajo.' using errcode='22023';
  end if;

  if v_job.contract_version<>'agt002.dossier-workbench.v1'
    or v_job.policy_version not in ('agt002.dossier-workbench.policy.v2','agt002.dossier-workbench.policy.v1')
    or not exists(select 1 from public.psi_agt002_workbench_threads t
      where t.id=v_job.thread_id and t.opportunity_id=v_job.opportunity_id
        and t.tender_id=v_job.tender_id and t.closed_at is null)
    or not exists(select 1 from public.psi_agt002_workbench_messages m
      where m.id=v_job.origin_message_id and m.thread_id=v_job.thread_id
        and m.opportunity_id=v_job.opportunity_id) then
    raise exception 'El trabajo no coincide con su hilo, origen o política congelada.' using errcode='23514';
  end if;

  if jsonb_typeof(p_result->'source_links') is distinct from 'array'
    or exists(
      select 1 from jsonb_array_elements_text(p_result->'source_links') source_id
      where not exists(
        select 1 from jsonb_array_elements(v_job.context_links) context_link
        where context_link->>'id'=source_id
      )
    ) then
    raise exception 'El resultado cita una fuente que no pertenece al contexto autorizado.' using errcode='23514';
  end if;

  -- Obsolescencia documental: revalida la versión vigente ANTES de cualquier insert.
  if v_kind='draft' then
    select * into v_artifact from public.psi_tender_dossier_artifacts where id=(p_result->>'artifact_id')::uuid for share;
    if not found or v_artifact.opportunity_id<>v_job.opportunity_id then
      raise exception 'El artefacto cruza de expediente.' using errcode='23514';
    end if;
    select id,version into v_current,v_number from public.psi_tender_dossier_artifact_versions
      where artifact_id=v_artifact.id order by version desc,id desc limit 1;
    if v_current is distinct from v_job.base_version_id then
      insert into public.psi_agt002_workbench_job_events(job_id,event_type,claim_id,event_metadata)
      values(p_job_id,'stale',p_claim_id,jsonb_build_object('expected_base_version_id',v_job.base_version_id,'current_version_id',v_current));
      return jsonb_build_object('status','stale','current_version_id',v_current);
    end if;
    if (p_result->>'content_kind') not in ('markdown','texto','metadata') then
      raise exception 'Tipo de contenido inválido.' using errcode='22023';
    end if;
  end if;

  -- Mensaje agente terminal.
  insert into public.psi_agt002_workbench_messages(thread_id,opportunity_id,author_id,author_kind,visible_agent_name,content,origin_job_id)
  values(v_job.thread_id,v_job.opportunity_id,p_agent_id,'agent','Vig-IA',
    coalesce(nullif(btrim(p_result->>'content_text'),''),'Propuesta de aprendizaje pendiente de revisión humana.'),p_job_id)
  returning id into v_message_id;

  -- Acciones requeridas.
  if jsonb_typeof(p_result->'required_actions')='array' then
    for v_action in select value from jsonb_array_elements(p_result->'required_actions') loop
      insert into public.psi_agt002_workbench_required_actions(job_id,message_id,opportunity_id,action_text)
      values(p_job_id,v_message_id,v_job.opportunity_id,btrim(v_action#>>'{}'));
    end loop;
  end if;

  -- Propuesta de aprendizaje (nace pendiente; no política activa).
  if v_kind='learning_proposal' then
    insert into public.psi_agt002_learning_proposals(id,job_id,opportunity_id,source_message_id,proposal_type,proposed_rule,requested_scope,valid_from,valid_until,source_links)
    values((p_result->>'proposal_id')::uuid,p_job_id,v_job.opportunity_id,v_job.origin_message_id,p_result->>'proposal_type',p_result->>'proposed_rule',p_result->>'scope',
      (p_result->>'valid_from')::timestamptz,nullif(p_result->>'valid_until','')::timestamptz,coalesce(p_result->'source_links','[]'::jsonb));
  end if;

  -- Versión documental agente (pendiente de revisión; nunca hereda aprobación).
  if v_kind='draft' then
    insert into public.psi_tender_dossier_artifact_versions(
      artifact_id,opportunity_id,version,supersedes_version_id,content_kind,content_text,content_metadata,author_id,author_kind,origin_agent_job_id
    ) values(
      v_artifact.id,v_job.opportunity_id,coalesce(v_number,0)+1,v_current,p_result->>'content_kind',p_result->>'content_text',p_result->'content_metadata',p_agent_id,'agent',p_job_id
    ) returning id into v_version_id;
  end if;

  -- El evento completed se inserta al final de la misma transacción.
  insert into public.psi_agt002_workbench_job_events(job_id,event_type,claim_id,event_metadata)
  values(p_job_id,'completed',p_claim_id,jsonb_build_object('message_id',v_message_id,'version_id',v_version_id))
  returning id into v_event_id;
  return jsonb_build_object('status','completed','message_id',v_message_id,'version_id',v_version_id,'event_id',v_event_id);
end;
$$;
commit;
