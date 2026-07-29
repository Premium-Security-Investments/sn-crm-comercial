-- Mesa de trabajo post-GO de Vig-IA (AGT-002), Cortes A/B.
-- Dominio conversacional propio, durable y append-only. No activa bridge ni modelo.
begin;

create table if not exists public.psi_agt002_workbench_threads (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  created_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index if not exists psi_agt002_workbench_threads_one_active
  on public.psi_agt002_workbench_threads(opportunity_id) where closed_at is null;

create table if not exists public.psi_agt002_workbench_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.psi_agt002_workbench_threads(id) on delete restrict,
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  author_id uuid not null references public.psi_sales_profiles(id) on delete restrict,
  author_kind text not null check (author_kind in ('human','agent')),
  visible_agent_name text check (
    (author_kind = 'human' and visible_agent_name is null)
    or (author_kind = 'agent' and visible_agent_name = 'Vig-IA')
  ),
  content text not null check (nullif(btrim(content), '') is not null and length(content) <= 12000),
  idempotency_key text check (idempotency_key is null or idempotency_key ~ '^[a-f0-9]{64}$'),
  origin_job_id uuid,
  created_at timestamptz not null default now(),
  unique(thread_id, idempotency_key)
);

create table if not exists public.psi_agt002_workbench_message_links (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.psi_agt002_workbench_messages(id) on delete restrict,
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  link_kind text not null check (link_kind in ('artifact','source','requirement','action','message','snapshot')),
  resource_id uuid not null,
  label text not null check (nullif(btrim(label), '') is not null and length(label) <= 300),
  source_ref text not null check (nullif(btrim(source_ref), '') is not null and length(source_ref) <= 1000),
  created_at timestamptz not null default now(),
  unique(message_id, link_kind, resource_id)
);

create table if not exists public.psi_agt002_workbench_jobs (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.psi_agt002_workbench_threads(id) on delete restrict,
  origin_message_id uuid not null references public.psi_agt002_workbench_messages(id) on delete restrict,
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  snapshot_id uuid not null,
  base_version_id uuid references public.psi_tender_dossier_artifact_versions(id) on delete restrict,
  capability_id text not null check (capability_id in (
    'agt002.dossier-workbench.reply.v1',
    'agt002.dossier-workbench.draft.v1',
    'agt002.dossier-workbench.learning-proposal.v1'
  )),
  contract_version text not null check (contract_version = 'agt002.dossier-workbench.v1'),
  policy_version text not null check (policy_version = 'agt002.dossier-workbench.policy.v1'),
  context_links jsonb not null default '[]'::jsonb check (jsonb_typeof(context_links) = 'array'),
  message text not null check (nullif(btrim(message), '') is not null and length(message) <= 12000),
  requested_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
  idempotency_key text not null unique check (idempotency_key ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);
create index if not exists psi_agt002_workbench_jobs_queue_idx
  on public.psi_agt002_workbench_jobs(created_at, id);

alter table public.psi_agt002_workbench_messages
  drop constraint if exists psi_agt002_workbench_messages_origin_job_fkey;
alter table public.psi_agt002_workbench_messages
  add constraint psi_agt002_workbench_messages_origin_job_fkey
  foreign key(origin_job_id) references public.psi_agt002_workbench_jobs(id) on delete restrict;

create table if not exists public.psi_agt002_workbench_job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.psi_agt002_workbench_jobs(id) on delete restrict,
  event_type text not null check (event_type in ('queued','claimed','released','completed','failed','stale')),
  claim_id uuid,
  worker_id text check (worker_id is null or (nullif(btrim(worker_id), '') is not null and length(worker_id) <= 200)),
  lease_expires_at timestamptz,
  event_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(event_metadata) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  check ((event_type = 'claimed' and claim_id is not null and worker_id is not null and lease_expires_at > created_at)
    or event_type <> 'claimed')
);
create index if not exists psi_agt002_workbench_job_events_cursor_idx
  on public.psi_agt002_workbench_job_events(job_id, created_at desc, id desc);

create table if not exists public.psi_agt002_workbench_required_actions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.psi_agt002_workbench_jobs(id) on delete restrict,
  message_id uuid not null references public.psi_agt002_workbench_messages(id) on delete restrict,
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  action_text text not null check (nullif(btrim(action_text), '') is not null and length(action_text) <= 2000),
  created_at timestamptz not null default now()
);

create table if not exists public.psi_agt002_learning_proposals (
  id uuid primary key,
  job_id uuid not null references public.psi_agt002_workbench_jobs(id) on delete restrict,
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  source_message_id uuid not null references public.psi_agt002_workbench_messages(id) on delete restrict,
  proposal_type text not null check (proposal_type in ('pattern','preference','rule','source')),
  proposed_rule text not null check (nullif(btrim(proposed_rule), '') is not null and length(proposed_rule) <= 4000),
  requested_scope text not null check (requested_scope in ('tender','entity','modality_sector','psi_rule')),
  valid_from timestamptz not null,
  valid_until timestamptz,
  source_links jsonb not null default '[]'::jsonb check (jsonb_typeof(source_links) = 'array'),
  created_at timestamptz not null default now(),
  check (valid_until is null or valid_until > valid_from)
);

create table if not exists public.psi_agt002_learning_decisions (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.psi_agt002_learning_proposals(id) on delete restrict,
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  decision text not null check (decision in ('approved','rejected')),
  approved_scope text check (approved_scope is null or approved_scope in ('tender','entity','modality_sector','psi_rule')),
  comment text check (comment is null or length(comment) <= 5000),
  reviewer_id uuid not null references public.psi_sales_profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.psi_tender_dossier_artifact_versions
  add column if not exists author_kind text not null default 'human',
  add column if not exists origin_agent_job_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.psi_tender_dossier_artifact_versions'::regclass and conname='psi_tender_dossier_artifact_versions_author_kind_check') then
    alter table public.psi_tender_dossier_artifact_versions
      add constraint psi_tender_dossier_artifact_versions_author_kind_check
      check (author_kind in ('human','agent'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.psi_tender_dossier_artifact_versions'::regclass and conname='psi_tender_dossier_artifact_versions_agent_origin_check') then
    alter table public.psi_tender_dossier_artifact_versions
      add constraint psi_tender_dossier_artifact_versions_agent_origin_check
      check ((author_kind='human' and origin_agent_job_id is null) or (author_kind='agent' and origin_agent_job_id is not null));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.psi_tender_dossier_artifact_versions'::regclass and conname='psi_tender_dossier_artifact_versions_agent_job_fkey') then
    alter table public.psi_tender_dossier_artifact_versions
      add constraint psi_tender_dossier_artifact_versions_agent_job_fkey
      foreign key(origin_agent_job_id) references public.psi_agt002_workbench_jobs(id) on delete restrict;
  end if;
end $$;
create unique index if not exists psi_tender_dossier_artifact_versions_agent_job_unique
  on public.psi_tender_dossier_artifact_versions(origin_agent_job_id) where origin_agent_job_id is not null;

create or replace function public.psi_reject_agt002_workbench_mutation()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'AGT-002 workbench stream is append-only: UPDATE and DELETE are prohibited' using errcode='55000';
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'psi_agt002_workbench_threads','psi_agt002_workbench_messages','psi_agt002_workbench_message_links',
    'psi_agt002_workbench_jobs','psi_agt002_workbench_job_events','psi_agt002_workbench_required_actions',
    'psi_agt002_learning_proposals','psi_agt002_learning_decisions'
  ] loop
    execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_append_only', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.psi_reject_agt002_workbench_mutation()', 'trg_' || t || '_append_only', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('revoke all on table public.%I from service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_service_role_rw', t);
    execute format('create policy %I on public.%I for all to service_role using (true) with check (true)', t || '_service_role_rw', t);
    execute format('grant select, update, delete on table public.%I to service_role', t);
  end loop;
end $$;

create or replace function public.psi_assert_agt002_workbench_actor(p_actor_id uuid, p_custody boolean default false)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not exists (
    select 1 from public.psi_sales_profiles p
    join public.psi_profile_permissions base on base.profile_id=p.id and base.permission_code='licitaciones'
    join public.psi_access_permissions basep on basep.code=base.permission_code and basep.active=true
    where p.id=p_actor_id and p.active=true and coalesce(p.identity_type,'human')='human'
      and p.role in ('admin','gerencia','director','comercial')
      and (not p_custody or exists (
        select 1 from public.psi_profile_permissions cp
        join public.psi_access_permissions cap on cap.code=cp.permission_code and cap.active=true
        where cp.profile_id=p.id and cp.permission_code='licitaciones_custodia'
      ))
  ) then
    raise exception 'No tiene permisos para operar la Mesa de trabajo.' using errcode='42501';
  end if;
end;
$$;

create or replace function public.psi_assert_agt002_workbench_agent(p_agent_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not exists (select 1 from public.psi_sales_profiles where id=p_agent_id and active=true and identity_type='agent') then
    raise exception 'La identidad AGT-002 no es un agente activo.' using errcode='42501';
  end if;
end;
$$;

create or replace function public.psi_get_or_create_agt002_workbench_thread(p_opportunity_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_tender_id uuid; v_thread public.psi_agt002_workbench_threads%rowtype;
begin
  perform public.psi_assert_agt002_workbench_actor(p_actor_id,false);
  v_tender_id := public.psi_assert_tender_dossier_go(p_opportunity_id);
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
  perform public.psi_assert_tender_dossier_go(p_opportunity_id);
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

create or replace function public.psi_get_agt002_workbench(p_opportunity_id uuid,p_actor_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_thread_id uuid;
begin
  perform public.psi_assert_agt002_workbench_actor(p_actor_id,false);
  perform public.psi_assert_tender_dossier_go(p_opportunity_id);
  select id into v_thread_id from public.psi_agt002_workbench_threads where opportunity_id=p_opportunity_id and closed_at is null;
  return jsonb_build_object(
    'thread_id',v_thread_id,
    'messages',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at,m.id) from public.psi_agt002_workbench_messages m where m.thread_id=v_thread_id),'[]'::jsonb),
    'jobs',coalesce((select jsonb_agg(to_jsonb(j) order by j.created_at,j.id) from public.psi_agt002_workbench_jobs j where j.thread_id=v_thread_id),'[]'::jsonb),
    'required_actions',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at,a.id) from public.psi_agt002_workbench_required_actions a where a.opportunity_id=p_opportunity_id),'[]'::jsonb),
    'learning_proposals',coalesce((select jsonb_agg(
      to_jsonb(p) || jsonb_build_object(
        'review_status',coalesce((select d.decision from public.psi_agt002_learning_decisions d where d.proposal_id=p.id order by d.created_at desc,d.id desc limit 1),'pendiente'),
        'approved_scope',(select d.approved_scope from public.psi_agt002_learning_decisions d where d.proposal_id=p.id order by d.created_at desc,d.id desc limit 1))
      order by p.created_at,p.id) from public.psi_agt002_learning_proposals p where p.opportunity_id=p_opportunity_id),'[]'::jsonb),
    -- Sólo un aprendizaje con decisión aprobada se proyecta como política activa.
    'active_learning_policies',coalesce((select jsonb_agg(jsonb_build_object(
        'proposal_id',p.id,'scope',d.approved_scope,'proposed_rule',p.proposed_rule,
        'valid_from',p.valid_from,'valid_until',p.valid_until,'decided_at',d.created_at)
      order by d.created_at,p.id)
      from public.psi_agt002_learning_proposals p
      join public.psi_agt002_learning_decisions d on d.proposal_id=p.id
      where p.opportunity_id=p_opportunity_id and d.decision='approved'),'[]'::jsonb)
  );
end;
$$;

create or replace function public.psi_retry_agt002_workbench_job(p_opportunity_id uuid,p_actor_id uuid,p_job_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_latest text; v_id uuid;
begin
  perform public.psi_assert_agt002_workbench_actor(p_actor_id,false);
  if not exists(select 1 from public.psi_agt002_workbench_jobs where id=p_job_id and opportunity_id=p_opportunity_id) then
    raise exception 'El trabajo no pertenece al expediente.' using errcode='23514';
  end if;
  select event_type into v_latest from public.psi_agt002_workbench_job_events
    where job_id=p_job_id order by created_at desc,id desc limit 1;
  if v_latest<>'failed' then raise exception 'Sólo un trabajo fallido puede reintentarse.' using errcode='23514'; end if;
  insert into public.psi_agt002_workbench_job_events(job_id,event_type,event_metadata)
  values(p_job_id,'released',jsonb_build_object('requested_by',p_actor_id)) returning id into v_id;
  return jsonb_build_object('status','released','event_id',v_id);
end;
$$;

create or replace function public.psi_review_agt002_learning_proposal(
  p_opportunity_id uuid,p_actor_id uuid,p_proposal_id uuid,p_decision text,p_scope text,p_comment text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_proposal public.psi_agt002_learning_proposals%rowtype; v_id uuid;
begin
  perform public.psi_assert_agt002_workbench_actor(p_actor_id,true);
  select * into v_proposal from public.psi_agt002_learning_proposals where id=p_proposal_id for share;
  if not found or v_proposal.opportunity_id<>p_opportunity_id then raise exception 'La propuesta no pertenece al expediente.' using errcode='23514'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Decisión de aprendizaje inválida.' using errcode='22023'; end if;
  if p_decision='approved' and p_scope not in ('tender','entity','modality_sector','psi_rule') then raise exception 'La aprobación requiere alcance válido.' using errcode='22023'; end if;
  -- Límites inmutables: las categorías exclusivamente humanas (firma, presentación,
  -- radicación, envío, garantías/pólizas, certificación de terceros, propuesta económica
  -- definitiva, aprobación final) no pueden promoverse mediante aprendizaje aprobado.
  if p_decision='approved' and v_proposal.proposed_rule ~* '(firmar|firma automat|radicar|radicac|presentar|presentac|garant|poliza|póliza|propuesta economica definitiva|propuesta económica definitiva|certificacion de terceros|certificación de terceros|aprobacion final|aprobación final|enviar|envio automat|envío automat)' then
    raise exception 'No se puede aprobar un aprendizaje que promueve una categoría exclusivamente humana e inmutable.' using errcode='42501';
  end if;
  if exists(select 1 from public.psi_agt002_learning_decisions where proposal_id=p_proposal_id) then raise exception 'La propuesta ya fue revisada.' using errcode='23505'; end if;
  insert into public.psi_agt002_learning_decisions(proposal_id,opportunity_id,decision,approved_scope,comment,reviewer_id)
  values(p_proposal_id,p_opportunity_id,p_decision,case when p_decision='approved' then p_scope else null end,nullif(btrim(p_comment),''),p_actor_id)
  returning id into v_id;
  return jsonb_build_object('decision_id',v_id,'decision',p_decision,'approved_scope',case when p_decision='approved' then p_scope else null end);
end;
$$;

create or replace function public.psi_claim_agt002_workbench_job(
  p_worker_id text,p_daily_max_jobs integer,p_max_concurrent integer,p_lease_seconds integer
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_now timestamptz:=clock_timestamp(); v_job public.psi_agt002_workbench_jobs%rowtype; v_claim uuid:=gen_random_uuid(); v_active integer; v_daily integer;
begin
  if nullif(btrim(p_worker_id),'') is null or p_daily_max_jobs<=0 or p_max_concurrent<=0 or p_lease_seconds<=0 or p_lease_seconds>600 then
    raise exception 'Los límites de worker AGT-002 no son válidos.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('agt002-workbench-claims:v1',0));
  select count(*)::integer into v_active from public.psi_agt002_workbench_job_events e
    where e.event_type='claimed' and e.lease_expires_at>v_now and not exists(
      select 1 from public.psi_agt002_workbench_job_events x where x.job_id=e.job_id and x.created_at>e.created_at and x.event_type in ('released','completed','failed','stale'));
  if v_active>=p_max_concurrent then return jsonb_build_object('status','saturated'); end if;
  select count(*)::integer into v_daily from public.psi_agt002_workbench_job_events where event_type='claimed' and created_at>=date_trunc('day',v_now at time zone 'UTC') at time zone 'UTC';
  if v_daily>=p_daily_max_jobs then return jsonb_build_object('status','quota'); end if;
  select j.* into v_job from public.psi_agt002_workbench_jobs j
    where coalesce((select e.event_type from public.psi_agt002_workbench_job_events e where e.job_id=j.id order by e.created_at desc,e.id desc limit 1),'queued') in ('queued','released')
    order by j.created_at,j.id limit 1 for update skip locked;
  if not found then return jsonb_build_object('status','empty'); end if;
  insert into public.psi_agt002_workbench_job_events(job_id,event_type,claim_id,worker_id,lease_expires_at)
  values(v_job.id,'claimed',v_claim,btrim(p_worker_id),v_now+make_interval(secs=>p_lease_seconds));
  return jsonb_build_object('status','claimed','claim_id',v_claim,'job',to_jsonb(v_job));
end;
$$;

create or replace function public.psi_assert_agt002_workbench_claim(p_job_id uuid,p_claim_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not exists(select 1 from public.psi_agt002_workbench_job_events e where e.job_id=p_job_id and e.claim_id=p_claim_id and e.event_type='claimed' and e.lease_expires_at>clock_timestamp()
    and not exists(select 1 from public.psi_agt002_workbench_job_events x where x.job_id=e.job_id and x.created_at>e.created_at and x.event_type in ('released','completed','failed','stale'))) then
    raise exception 'El claim AGT-002 no existe, expiró o terminó.' using errcode='55000';
  end if;
end;
$$;

create or replace function public.psi_append_agt002_workbench_job_event(
  p_job_id uuid,p_claim_id uuid,p_event_type text,p_metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  perform public.psi_assert_agt002_workbench_claim(p_job_id,p_claim_id);
  if p_event_type not in ('released','completed','failed','stale') or p_metadata is null or jsonb_typeof(p_metadata)<>'object' then
    raise exception 'Evento AGT-002 inválido.' using errcode='22023';
  end if;
  insert into public.psi_agt002_workbench_job_events(job_id,event_type,claim_id,event_metadata)
  values(p_job_id,p_event_type,p_claim_id,p_metadata) returning id into v_id;
  return jsonb_build_object('event_id',v_id,'status',p_event_type);
end;
$$;

create or replace function public.psi_append_agt002_agent_result(
  p_job_id uuid,p_claim_id uuid,p_agent_id uuid,p_result jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.psi_agt002_workbench_jobs%rowtype; v_message_id uuid; v_action jsonb; v_id uuid;
begin
  perform public.psi_assert_agt002_workbench_agent(p_agent_id);
  perform public.psi_assert_agt002_workbench_claim(p_job_id,p_claim_id);
  select * into v_job from public.psi_agt002_workbench_jobs where id=p_job_id for share;
  if p_result is null or jsonb_typeof(p_result)<>'object' or p_result->>'visible_agent_name'<>'Vig-IA' or (p_result->>'human_review_required')::boolean is distinct from true
    or (p_result->>'snapshot_id')::uuid<>v_job.snapshot_id then raise exception 'Resultado AGT-002 inválido.' using errcode='22023'; end if;
  if exists(select 1 from public.psi_agt002_workbench_messages where origin_job_id=p_job_id) then
    select id into v_message_id from public.psi_agt002_workbench_messages where origin_job_id=p_job_id;
    return jsonb_build_object('status','existing','message_id',v_message_id);
  end if;
  insert into public.psi_agt002_workbench_messages(thread_id,opportunity_id,author_id,author_kind,visible_agent_name,content,origin_job_id)
  values(v_job.thread_id,v_job.opportunity_id,p_agent_id,'agent','Vig-IA',coalesce(nullif(btrim(p_result->>'content_text'),''),'Propuesta de aprendizaje pendiente de revisión humana.'),p_job_id)
  returning id into v_message_id;
  if jsonb_typeof(p_result->'required_actions')='array' then
    for v_action in select value from jsonb_array_elements(p_result->'required_actions') loop
      insert into public.psi_agt002_workbench_required_actions(job_id,message_id,opportunity_id,action_text)
      values(p_job_id,v_message_id,v_job.opportunity_id,btrim(v_action#>>'{}'));
    end loop;
  end if;
  if p_result->>'kind'='learning_proposal' then
    insert into public.psi_agt002_learning_proposals(id,job_id,opportunity_id,source_message_id,proposal_type,proposed_rule,requested_scope,valid_from,valid_until,source_links)
    values((p_result->>'proposal_id')::uuid,p_job_id,v_job.opportunity_id,v_job.origin_message_id,p_result->>'proposal_type',p_result->>'proposed_rule',p_result->>'scope',
      (p_result->>'valid_from')::timestamptz,nullif(p_result->>'valid_until','')::timestamptz,coalesce(p_result->'source_links','[]'::jsonb));
  end if;
  insert into public.psi_agt002_workbench_job_events(job_id,event_type,claim_id,event_metadata)
  values(p_job_id,'completed',p_claim_id,jsonb_build_object('message_id',v_message_id)) returning id into v_id;
  return jsonb_build_object('status','completed','message_id',v_message_id,'event_id',v_id);
end;
$$;

create or replace function public.psi_append_agt002_agent_artifact_version(
  p_job_id uuid,p_claim_id uuid,p_agent_id uuid,p_artifact_id uuid,p_base_version_id uuid,
  p_content_kind text,p_content_text text,p_content_metadata jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.psi_agt002_workbench_jobs%rowtype; v_artifact public.psi_tender_dossier_artifacts%rowtype; v_current uuid; v_number integer; v_id uuid;
begin
  perform public.psi_assert_agt002_workbench_agent(p_agent_id);
  perform public.psi_assert_agt002_workbench_claim(p_job_id,p_claim_id);
  select * into v_job from public.psi_agt002_workbench_jobs where id=p_job_id for share;
  select * into v_artifact from public.psi_tender_dossier_artifacts where id=p_artifact_id for share;
  if not found or v_artifact.opportunity_id<>v_job.opportunity_id then raise exception 'El artefacto cruza de expediente.' using errcode='23514'; end if;
  if v_job.base_version_id is distinct from p_base_version_id then raise exception 'base_version_id no coincide con el trabajo congelado.' using errcode='23514'; end if;
  select id,version into v_current,v_number from public.psi_tender_dossier_artifact_versions where artifact_id=p_artifact_id order by version desc,id desc limit 1;
  if v_current is distinct from p_base_version_id then
    insert into public.psi_agt002_workbench_job_events(job_id,event_type,claim_id,event_metadata)
    values(p_job_id,'stale',p_claim_id,jsonb_build_object('expected_base_version_id',p_base_version_id,'current_version_id',v_current));
    return jsonb_build_object('status','stale','current_version_id',v_current);
  end if;
  if p_content_kind not in ('markdown','texto','metadata') then raise exception 'Tipo de contenido inválido.' using errcode='22023'; end if;
  insert into public.psi_tender_dossier_artifact_versions(
    artifact_id,opportunity_id,version,supersedes_version_id,content_kind,content_text,content_metadata,author_id,author_kind,origin_agent_job_id
  ) values(
    p_artifact_id,v_job.opportunity_id,coalesce(v_number,0)+1,v_current,p_content_kind,p_content_text,p_content_metadata,p_agent_id,'agent',p_job_id
  ) returning id into v_id;
  return jsonb_build_object('status','saved','version_id',v_id,'version',coalesce(v_number,0)+1);
end;
$$;

-- RPC terminal transaccional: persiste el resultado agente completo (mensaje, acciones
-- requeridas, propuesta de aprendizaje y/o versión documental) y el evento `completed`
-- en una única transacción PL/pgSQL. Revalida claim vigente, oportunidad/hilo/job,
-- contrato/policy/snapshot y base congelada antes de cualquier insert. Ante error no
-- queda mensaje, acción, propuesta ni versión parcial; replay retorna `existing`.
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
    or v_job.policy_version<>'agt002.dossier-workbench.policy.v1'
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

-- Actualiza la proyección del artefacto para exponer procedencia sin crear revisión.
create or replace function public.psi_project_tender_dossier_artifact(p_artifact_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  with a as (select * from public.psi_tender_dossier_artifacts where id=p_artifact_id),
  cur as (select * from public.psi_tender_dossier_artifact_versions where artifact_id=p_artifact_id order by version desc,id desc limit 1),
  cur_review as (select decision from public.psi_tender_dossier_artifact_reviews where version_id=(select id from cur) order by created_at desc,id desc limit 1)
  select jsonb_build_object(
    'id',a.id,'artifact_key',a.artifact_key,'title',a.title,'required',a.required,'origin',a.origin,
    'current_version',(select case when cur.id is null then null else jsonb_build_object(
      'id',cur.id,'version',cur.version,'content_kind',cur.content_kind,'content_text',cur.content_text,
      'content_metadata',cur.content_metadata,'author_id',cur.author_id,'author_kind',cur.author_kind,
      'origin_agent_job_id',cur.origin_agent_job_id,'created_at',cur.created_at) end from cur),
    'review_status',coalesce((select decision from cur_review),'pendiente'),
    'has_approved_version',coalesce((select decision from cur_review),'pendiente')='aprobado',
    'version_count',(select count(*) from public.psi_tender_dossier_artifact_versions where artifact_id=p_artifact_id)
  ) from a;
$$;

-- Revisión de versiones documentales por custodia (spec §7.2): además del rol gestor de
-- Lote 2, la encargada con `licitaciones_custodia` puede aprobar/rechazar versiones —en
-- particular las versiones agente— sin adquirir autoridad GO/NO-GO. Se conserva la
-- semántica del gate (`has_approved_version` sólo por decisión aprobada de la vigente).
create or replace function public.psi_record_tender_dossier_artifact_review(
  p_version_id uuid, p_actor_id uuid, p_decision text, p_comment text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_version public.psi_tender_dossier_artifact_versions%rowtype;
begin
  if not exists (
    select 1 from public.psi_sales_profiles p
    join public.psi_profile_permissions pp on pp.profile_id=p.id and pp.permission_code='licitaciones'
    join public.psi_access_permissions ap on ap.code=pp.permission_code and ap.active=true
    where p.id=p_actor_id and p.active=true and coalesce(p.identity_type,'human')='human'
      and (p.role in ('admin','gerencia','director')
        or exists(select 1 from public.psi_profile_permissions cp
          join public.psi_access_permissions cap on cap.code=cp.permission_code and cap.active=true
          where cp.profile_id=p.id and cp.permission_code='licitaciones_custodia'))
  ) then
    raise exception 'Aprobar o rechazar una versión requiere autoridad de gestión o custodia documental.' using errcode='42501';
  end if;
  select * into v_version from public.psi_tender_dossier_artifact_versions where id=p_version_id;
  if not found then raise exception 'La versión no existe.' using errcode='P0002'; end if;
  perform public.psi_assert_tender_dossier_go(v_version.opportunity_id);
  if p_decision not in ('aprobado','rechazado') then raise exception 'Decisión de revisión inválida.' using errcode='22023'; end if;
  if p_decision='rechazado' and nullif(btrim(p_comment),'') is null then
    raise exception 'Rechazar requiere un comentario.' using errcode='22023';
  end if;
  insert into public.psi_tender_dossier_artifact_reviews(version_id,artifact_id,opportunity_id,decision,comment,reviewer_id)
  values(p_version_id,v_version.artifact_id,v_version.opportunity_id,p_decision,nullif(btrim(p_comment),''),p_actor_id);
  return jsonb_build_object('artifact',public.psi_project_tender_dossier_artifact(v_version.artifact_id));
end;
$$;

-- Los RPC terminales legacy se conservan para compatibilidad de migración y pruebas,
-- pero no forman parte de la interfaz ejecutable: sólo el RPC atómico puede completar jobs.
revoke all on function public.psi_append_agt002_agent_result(uuid,uuid,uuid,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.psi_append_agt002_agent_artifact_version(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)
  from public, anon, authenticated, service_role;

-- Endurecimiento de ACL: psi_project_tender_dossier_artifact heredaba de la migración 040
-- su ACL por defecto (proacl NULL => EXECUTE implícito de PUBLIC). Se corrige aquí para
-- que sólo service_role pueda ejecutarla; las llamadas internas (security definer) siguen
-- ejecutándose como owner y no dependen del grant.
revoke all on function public.psi_project_tender_dossier_artifact(uuid) from public, anon, authenticated;
grant execute on function public.psi_project_tender_dossier_artifact(uuid) to service_role;

-- Helpers SECURITY DEFINER internos de la Mesa: nadie los invoca directamente salvo, por
-- consistencia, service_role. Se revoca a PUBLIC/anon/authenticated/service_role y luego se
-- concede execute sólo a service_role. Las invocaciones internas se ejecutan como owner, así
-- que revocar EXECUTE de PUBLIC no rompe la cadena security definer.
revoke all on function public.psi_assert_agt002_workbench_actor(uuid,boolean) from public, anon, authenticated, service_role;
grant execute on function public.psi_assert_agt002_workbench_actor(uuid,boolean) to service_role;
revoke all on function public.psi_assert_agt002_workbench_agent(uuid) from public, anon, authenticated, service_role;
grant execute on function public.psi_assert_agt002_workbench_agent(uuid) to service_role;
revoke all on function public.psi_assert_agt002_workbench_claim(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.psi_assert_agt002_workbench_claim(uuid,uuid) to service_role;

-- Funciones públicas sólo para service_role.
do $$
declare sig text;
begin
  foreach sig in array array[
    'psi_get_or_create_agt002_workbench_thread(uuid,uuid)',
    'psi_append_agt002_workbench_message(uuid,uuid,uuid,uuid,text,jsonb,text,text,text,text,uuid,uuid)',
    'psi_get_agt002_workbench(uuid,uuid)',
    'psi_retry_agt002_workbench_job(uuid,uuid,uuid)',
    'psi_review_agt002_learning_proposal(uuid,uuid,uuid,text,text,text)',
    'psi_claim_agt002_workbench_job(text,integer,integer,integer)',
    'psi_append_agt002_workbench_job_event(uuid,uuid,text,jsonb)',
    'psi_complete_agt002_workbench_job(uuid,uuid,uuid,jsonb)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role',sig);
    execute format('grant execute on function public.%s to service_role',sig);
  end loop;
end $$;

commit;
