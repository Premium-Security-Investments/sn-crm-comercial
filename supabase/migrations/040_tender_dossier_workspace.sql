-- Expediente operativo post-GO de Licitaciones (Lote 2), 100% humano/determinístico.
-- Streams append-only; el estado de ítems/artefactos se proyecta, no se materializa.
-- No usa LLM ni activa AGT-002. Additive: no cambia GO/NO GO ni la transición de oferta.
begin;

-- 1. Identidad estable de ítems del checklist.
create table if not exists public.psi_tender_dossier_items (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  item_key text not null check (nullif(btrim(item_key), '') is not null and length(item_key) <= 200),
  title text not null check (nullif(btrim(title), '') is not null and length(title) <= 400),
  item_type text not null check (item_type in ('documento', 'pendiente_humano', 'general')),
  required boolean not null default false,
  origin text not null default 'human' check (origin in ('seed_go', 'human')),
  created_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (opportunity_id, item_key)
);
create index if not exists psi_tender_dossier_items_opportunity_idx
  on public.psi_tender_dossier_items (opportunity_id, created_at, id);

-- 2. Stream append-only de acciones humanas por ítem (fuente de verdad del estado).
create table if not exists public.psi_tender_dossier_item_actions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.psi_tender_dossier_items(id) on delete restrict,
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  action_type text not null check (action_type in
    ('created','status_changed','assigned','evidence_attached','marked_not_applicable','requirement_changed','reopened')),
  to_status text check (to_status is null or to_status in ('pendiente','en_progreso','listo','bloqueado')),
  applicability text check (applicability is null or applicability in ('requerido','no_aplica')),
  assignee_id uuid references public.psi_sales_profiles(id) on delete restrict,
  target_date date,
  evidence_kind text check (evidence_kind is null or evidence_kind in ('texto','url')),
  evidence_text text check (evidence_text is null or length(evidence_text) <= 5000),
  evidence_url text check (evidence_url is null or (evidence_url ~* '^https://' and length(evidence_url) <= 2000 and evidence_url !~* '\s')),
  justification text check (justification is null or length(justification) <= 2000),
  note text check (note is null or length(note) <= 2000),
  actor_id uuid not null references public.psi_sales_profiles(id) on delete restrict,
  actor_kind text not null default 'human' check (actor_kind = 'human'),
  created_at timestamptz not null default now()
);
create index if not exists psi_tender_dossier_item_actions_cursor_idx
  on public.psi_tender_dossier_item_actions (item_id, created_at desc, id desc);

create or replace function public.psi_tender_dossier_item_actions_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'psi_tender_dossier_item_actions is append-only: UPDATE and DELETE are prohibited';
end;
$$;
drop trigger if exists psi_tender_dossier_item_actions_immutable on public.psi_tender_dossier_item_actions;
create trigger psi_tender_dossier_item_actions_immutable
  before update or delete on public.psi_tender_dossier_item_actions
  for each row execute function public.psi_tender_dossier_item_actions_prevent_mutation();

-- 3. Identidad estable de artefactos/documentos del expediente.
create table if not exists public.psi_tender_dossier_artifacts (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  artifact_key text not null check (nullif(btrim(artifact_key), '') is not null and length(artifact_key) <= 200),
  title text not null check (nullif(btrim(title), '') is not null and length(title) <= 400),
  required boolean not null default false,
  origin text not null default 'human' check (origin in ('seed_go', 'human')),
  created_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (opportunity_id, artifact_key)
);

-- 4. Versiones append-only del artefacto (nueva versión = editar). La vigente se proyecta por mayor version.
create table if not exists public.psi_tender_dossier_artifact_versions (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.psi_tender_dossier_artifacts(id) on delete restrict,
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  version integer not null check (version > 0),
  supersedes_version_id uuid references public.psi_tender_dossier_artifact_versions(id) on delete restrict,
  content_kind text not null check (content_kind in ('markdown','texto','metadata')),
  content_text text check (content_text is null or length(content_text) <= 100000),
  content_metadata jsonb check (content_metadata is null or jsonb_typeof(content_metadata) = 'object'),
  author_id uuid not null references public.psi_sales_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint psi_tender_dossier_artifact_versions_has_content check (
    (content_kind in ('markdown','texto') and nullif(btrim(content_text), '') is not null)
    or (content_kind = 'metadata' and content_metadata is not null)
  ),
  unique (artifact_id, version)
);
create index if not exists psi_tender_dossier_artifact_versions_latest_idx
  on public.psi_tender_dossier_artifact_versions (artifact_id, version desc, id desc);

-- 5. Revisiones append-only por versión (estado de revisión proyectado = última).
create table if not exists public.psi_tender_dossier_artifact_reviews (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.psi_tender_dossier_artifact_versions(id) on delete restrict,
  artifact_id uuid not null references public.psi_tender_dossier_artifacts(id) on delete restrict,
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  decision text not null check (decision in ('aprobado','rechazado')),
  comment text check (comment is null or length(comment) <= 5000),
  reviewer_id uuid not null references public.psi_sales_profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists psi_tender_dossier_artifact_reviews_cursor_idx
  on public.psi_tender_dossier_artifact_reviews (version_id, created_at desc, id desc);

create or replace function public.psi_tender_dossier_artifact_reviews_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'psi_tender_dossier_artifact_reviews is append-only: UPDATE and DELETE are prohibited';
end;
$$;
drop trigger if exists psi_tender_dossier_artifact_reviews_immutable on public.psi_tender_dossier_artifact_reviews;
create trigger psi_tender_dossier_artifact_reviews_immutable
  before update or delete on public.psi_tender_dossier_artifact_reviews
  for each row execute function public.psi_tender_dossier_artifact_reviews_prevent_mutation();

-- Corrección vinculante (plan §1.1): las CINCO tablas son inmutables, incluidas
-- psi_tender_dossier_items y psi_tender_dossier_artifacts (identidad estable).
create or replace function public.psi_tender_dossier_items_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'psi_tender_dossier_items is append-only: UPDATE and DELETE are prohibited';
end;
$$;
drop trigger if exists psi_tender_dossier_items_immutable on public.psi_tender_dossier_items;
create trigger psi_tender_dossier_items_immutable
  before update or delete on public.psi_tender_dossier_items
  for each row execute function public.psi_tender_dossier_items_prevent_mutation();

create or replace function public.psi_tender_dossier_artifacts_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'psi_tender_dossier_artifacts is append-only: UPDATE and DELETE are prohibited';
end;
$$;
drop trigger if exists psi_tender_dossier_artifacts_immutable on public.psi_tender_dossier_artifacts;
create trigger psi_tender_dossier_artifacts_immutable
  before update or delete on public.psi_tender_dossier_artifacts
  for each row execute function public.psi_tender_dossier_artifacts_prevent_mutation();

create or replace function public.psi_tender_dossier_artifact_versions_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'psi_tender_dossier_artifact_versions is append-only: UPDATE and DELETE are prohibited';
end;
$$;
drop trigger if exists psi_tender_dossier_artifact_versions_immutable on public.psi_tender_dossier_artifact_versions;
create trigger psi_tender_dossier_artifact_versions_immutable
  before update or delete on public.psi_tender_dossier_artifact_versions
  for each row execute function public.psi_tender_dossier_artifact_versions_prevent_mutation();

-- Grants: RLS + service_role solo lee y (para topar con el trigger de inmutabilidad
-- como defensa en profundidad) puede intentar update/delete directo, que el trigger
-- rechaza igualmente. Toda creación de filas pasa por RPC security definer: INSERT
-- directo queda sin conceder.
do $$
declare t text;
begin
  foreach t in array array[
    'psi_tender_dossier_items','psi_tender_dossier_item_actions','psi_tender_dossier_artifacts',
    'psi_tender_dossier_artifact_versions','psi_tender_dossier_artifact_reviews'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('revoke all on table public.%I from authenticated', t);
    -- RLS por sí sola oculta todas las filas sin policy; service_role necesita visibilidad
    -- para que un intento directo de UPDATE/DELETE llegue al trigger de inmutabilidad
    -- (la policy no habilita INSERT: ese privilegio no se concede a nivel de tabla).
    execute format('drop policy if exists %I on public.%I', t || '_service_role_rw', t);
    execute format(
      'create policy %I on public.%I for all to service_role using (true) with check (true)',
      t || '_service_role_rw', t
    );
  end loop;
end;
$$;

revoke all on table public.psi_tender_dossier_items from service_role;
grant select on table public.psi_tender_dossier_items to service_role;
grant update, delete on table public.psi_tender_dossier_items to service_role;
revoke all on table public.psi_tender_dossier_item_actions from service_role;
grant select on table public.psi_tender_dossier_item_actions to service_role;
grant update, delete on table public.psi_tender_dossier_item_actions to service_role;
revoke all on table public.psi_tender_dossier_artifacts from service_role;
grant select on table public.psi_tender_dossier_artifacts to service_role;
grant update, delete on table public.psi_tender_dossier_artifacts to service_role;
revoke all on table public.psi_tender_dossier_artifact_versions from service_role;
grant select on table public.psi_tender_dossier_artifact_versions to service_role;
grant update, delete on table public.psi_tender_dossier_artifact_versions to service_role;
revoke all on table public.psi_tender_dossier_artifact_reviews from service_role;
grant select on table public.psi_tender_dossier_artifact_reviews to service_role;
grant update, delete on table public.psi_tender_dossier_artifact_reviews to service_role;

-- Autorización compartida: humano activo con permiso licitaciones y rol dentro del techo.
create or replace function public.psi_assert_tender_dossier_actor(p_actor_id uuid, p_manager_only boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (
    select 1
    from public.psi_sales_profiles p
    join public.psi_profile_permissions pp on pp.profile_id = p.id and pp.permission_code = 'licitaciones'
    join public.psi_access_permissions ap on ap.code = pp.permission_code and ap.active = true
    where p.id = p_actor_id
      and p.active = true
      and coalesce(p.identity_type, 'human') = 'human'
      and p.role in ('admin','gerencia','director','comercial')
      and (not p_manager_only or p.role in ('admin','gerencia','director'))
  ) then
    raise exception 'No tiene permisos para operar el expediente de oferta.' using errcode = '42501';
  end if;
end;
$$;

-- Exige decisión GO vigente (no superada) para la oportunidad.
create or replace function public.psi_assert_tender_dossier_go(p_opportunity_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tender_id uuid; v_decision text;
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
  if v_decision is distinct from 'go' then
    raise exception 'El expediente requiere una decisión GO vigente.' using errcode = '23514';
  end if;
  return v_tender_id;
end;
$$;

-- Proyección del estado actual de un ítem (una fila jsonb).
create or replace function public.psi_project_tender_dossier_item(p_item_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with i as (select * from public.psi_tender_dossier_items where id = p_item_id),
  st as (
    select to_status from public.psi_tender_dossier_item_actions
    where item_id = p_item_id and to_status is not null order by created_at desc, id desc limit 1),
  ap as (
    select applicability from public.psi_tender_dossier_item_actions
    where item_id = p_item_id and applicability is not null order by created_at desc, id desc limit 1),
  asg as (
    select a.assignee_id, pr.full_name from public.psi_tender_dossier_item_actions a
    left join public.psi_sales_profiles pr on pr.id = a.assignee_id
    where a.item_id = p_item_id and a.action_type = 'assigned' order by a.created_at desc, a.id desc limit 1),
  td as (
    select target_date from public.psi_tender_dossier_item_actions
    where item_id = p_item_id and target_date is not null order by created_at desc, id desc limit 1),
  ev as (
    select evidence_kind, evidence_text, evidence_url, created_at from public.psi_tender_dossier_item_actions
    where item_id = p_item_id and action_type = 'evidence_attached' order by created_at desc, id desc limit 1)
  select jsonb_build_object(
    'id', i.id, 'item_key', i.item_key, 'title', i.title, 'item_type', i.item_type,
    'required', i.required, 'origin', i.origin,
    'status', coalesce((select to_status from st), 'pendiente'),
    'applicability', coalesce((select applicability from ap), 'requerido'),
    'assignee_id', (select assignee_id from asg), 'assignee_name', (select full_name from asg),
    'target_date', (select target_date from td),
    'latest_evidence', (select case when ev.evidence_kind is null then null else jsonb_build_object(
      'kind', ev.evidence_kind, 'text', ev.evidence_text, 'url', ev.evidence_url, 'at', ev.created_at) end from ev)
  ) from i;
$$;

create or replace function public.psi_create_tender_dossier_item(
  p_opportunity_id uuid, p_actor_id uuid, p_item_key text, p_title text, p_item_type text, p_required boolean
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tender_id uuid; v_item_id uuid;
begin
  perform public.psi_assert_tender_dossier_actor(p_actor_id, false);
  v_tender_id := public.psi_assert_tender_dossier_go(p_opportunity_id);
  if p_item_type is null or p_item_type not in ('documento','pendiente_humano','general') then
    raise exception 'Tipo de ítem inválido.' using errcode = '22023';
  end if;
  if nullif(btrim(p_title), '') is null then
    raise exception 'El ítem requiere un título.' using errcode = '22023';
  end if;
  insert into public.psi_tender_dossier_items (opportunity_id, tender_id, item_key, title, item_type, required, origin, created_by)
  values (p_opportunity_id, v_tender_id, btrim(p_item_key), btrim(p_title), p_item_type, coalesce(p_required, false), 'human', p_actor_id)
  on conflict (opportunity_id, item_key) do nothing
  returning id into v_item_id;
  if v_item_id is null then
    select id into v_item_id from public.psi_tender_dossier_items where opportunity_id = p_opportunity_id and item_key = btrim(p_item_key);
  else
    insert into public.psi_tender_dossier_item_actions (item_id, opportunity_id, action_type, to_status, applicability, actor_id)
    values (v_item_id, p_opportunity_id, 'created', 'pendiente', 'requerido', p_actor_id);
  end if;
  return jsonb_build_object('item', public.psi_project_tender_dossier_item(v_item_id));
end;
$$;

revoke all on function public.psi_create_tender_dossier_item(uuid,uuid,text,text,text,boolean) from public;
revoke all on function public.psi_create_tender_dossier_item(uuid,uuid,text,text,text,boolean) from anon;
revoke all on function public.psi_create_tender_dossier_item(uuid,uuid,text,text,text,boolean) from authenticated;
grant execute on function public.psi_create_tender_dossier_item(uuid,uuid,text,text,text,boolean) to service_role;

create or replace function public.psi_append_tender_dossier_item_action(
  p_opportunity_id uuid, p_item_id uuid, p_actor_id uuid, p_action_type text,
  p_to_status text default null, p_assignee_id uuid default null, p_target_date date default null,
  p_evidence_kind text default null, p_evidence_text text default null, p_evidence_url text default null,
  p_justification text default null, p_note text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_item public.psi_tender_dossier_items%rowtype; v_applicability text; v_manager boolean;
begin
  -- marcar no_aplica de un ítem requerido es decisión de manager.
  v_manager := (p_action_type = 'marked_not_applicable');
  perform public.psi_assert_tender_dossier_actor(p_actor_id, v_manager);
  perform public.psi_assert_tender_dossier_go(p_opportunity_id);

  select * into v_item from public.psi_tender_dossier_items where id = p_item_id for share;
  if not found or v_item.opportunity_id <> p_opportunity_id then
    raise exception 'El ítem no pertenece a la oportunidad.' using errcode = 'P0002';
  end if;
  if p_action_type not in ('status_changed','assigned','evidence_attached','marked_not_applicable','requirement_changed','reopened') then
    raise exception 'Acción de ítem inválida.' using errcode = '22023';
  end if;

  v_applicability := null;
  if p_action_type = 'status_changed' then
    if p_to_status is null or p_to_status not in ('pendiente','en_progreso','listo','bloqueado') then
      raise exception 'Estado de ítem inválido.' using errcode = '22023';
    end if;
  elsif p_action_type = 'assigned' then
    if p_assignee_id is not null and not exists (
      select 1 from public.psi_sales_profiles where id = p_assignee_id and active = true and coalesce(identity_type,'human')='human'
    ) then
      raise exception 'El responsable debe ser una persona activa.' using errcode = '22023';
    end if;
  elsif p_action_type = 'evidence_attached' then
    if p_evidence_kind not in ('texto','url')
       or (p_evidence_kind = 'texto' and nullif(btrim(p_evidence_text), '') is null)
       or (p_evidence_kind = 'url' and (p_evidence_url is null or p_evidence_url !~* '^https://')) then
      raise exception 'La evidencia requiere texto o una URL https válida.' using errcode = '22023';
    end if;
  elsif p_action_type = 'marked_not_applicable' then
    if nullif(btrim(p_justification), '') is null then
      raise exception 'Marcar no aplica requiere justificación.' using errcode = '22023';
    end if;
    v_applicability := 'no_aplica';
  elsif p_action_type = 'reopened' then
    v_applicability := 'requerido';
  end if;

  insert into public.psi_tender_dossier_item_actions (
    item_id, opportunity_id, action_type, to_status, applicability, assignee_id, target_date,
    evidence_kind, evidence_text, evidence_url, justification, note, actor_id
  ) values (
    p_item_id, p_opportunity_id, p_action_type,
    case when p_action_type = 'status_changed' then p_to_status else null end,
    v_applicability,
    case when p_action_type = 'assigned' then p_assignee_id else null end,
    p_target_date,
    case when p_action_type = 'evidence_attached' then p_evidence_kind else null end,
    case when p_action_type = 'evidence_attached' then nullif(btrim(p_evidence_text), '') else null end,
    case when p_action_type = 'evidence_attached' then p_evidence_url else null end,
    nullif(btrim(p_justification), ''), nullif(btrim(p_note), ''), p_actor_id
  );
  return jsonb_build_object('item', public.psi_project_tender_dossier_item(p_item_id));
end;
$$;

revoke all on function public.psi_append_tender_dossier_item_action(uuid,uuid,uuid,text,text,uuid,date,text,text,text,text,text) from public;
revoke all on function public.psi_append_tender_dossier_item_action(uuid,uuid,uuid,text,text,uuid,date,text,text,text,text,text) from anon;
revoke all on function public.psi_append_tender_dossier_item_action(uuid,uuid,uuid,text,text,uuid,date,text,text,text,text,text) from authenticated;
grant execute on function public.psi_append_tender_dossier_item_action(uuid,uuid,uuid,text,text,uuid,date,text,text,text,text,text) to service_role;

-- Proyección de un artefacto con su última versión append-only y estado de revisión.
create or replace function public.psi_project_tender_dossier_artifact(p_artifact_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with a as (select * from public.psi_tender_dossier_artifacts where id = p_artifact_id),
  cur as (select * from public.psi_tender_dossier_artifact_versions where artifact_id = p_artifact_id order by version desc, id desc limit 1),
  cur_review as (
    select decision from public.psi_tender_dossier_artifact_reviews
    where version_id = (select id from cur) order by created_at desc, id desc limit 1),
  approved as (
    select 1 where coalesce((select decision from cur_review), 'pendiente') = 'aprobado')
  select jsonb_build_object(
    'id', a.id, 'artifact_key', a.artifact_key, 'title', a.title, 'required', a.required, 'origin', a.origin,
    'current_version', (select case when cur.id is null then null else jsonb_build_object(
      'id', cur.id, 'version', cur.version, 'content_kind', cur.content_kind,
      'content_text', cur.content_text, 'content_metadata', cur.content_metadata,
      'author_id', cur.author_id, 'created_at', cur.created_at) end from cur),
    'review_status', coalesce((select decision from cur_review), 'pendiente'),
    'has_approved_version', exists (select 1 from approved),
    'version_count', (select count(*) from public.psi_tender_dossier_artifact_versions where artifact_id = p_artifact_id)
  ) from a;
$$;

create or replace function public.psi_create_tender_dossier_artifact(
  p_opportunity_id uuid, p_actor_id uuid, p_artifact_key text, p_title text, p_required boolean
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tender_id uuid; v_artifact_id uuid;
begin
  perform public.psi_assert_tender_dossier_actor(p_actor_id, false);
  v_tender_id := public.psi_assert_tender_dossier_go(p_opportunity_id);
  if nullif(btrim(p_title), '') is null then raise exception 'El artefacto requiere un título.' using errcode = '22023'; end if;
  insert into public.psi_tender_dossier_artifacts (opportunity_id, tender_id, artifact_key, title, required, origin, created_by)
  values (p_opportunity_id, v_tender_id, btrim(p_artifact_key), btrim(p_title), coalesce(p_required, false), 'human', p_actor_id)
  on conflict (opportunity_id, artifact_key) do nothing
  returning id into v_artifact_id;
  if v_artifact_id is null then
    select id into v_artifact_id from public.psi_tender_dossier_artifacts where opportunity_id = p_opportunity_id and artifact_key = btrim(p_artifact_key);
  end if;
  return jsonb_build_object('artifact', public.psi_project_tender_dossier_artifact(v_artifact_id));
end;
$$;

create or replace function public.psi_add_tender_dossier_artifact_version(
  p_opportunity_id uuid, p_artifact_id uuid, p_actor_id uuid,
  p_content_kind text, p_content_text text, p_content_metadata jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_artifact public.psi_tender_dossier_artifacts%rowtype; v_prev uuid; v_version integer; v_id uuid;
begin
  perform public.psi_assert_tender_dossier_actor(p_actor_id, false);
  perform public.psi_assert_tender_dossier_go(p_opportunity_id);
  perform pg_advisory_xact_lock(hashtextextended('psi_dossier_artifact:' || p_artifact_id::text, 0));
  select * into v_artifact from public.psi_tender_dossier_artifacts where id = p_artifact_id;
  if not found or v_artifact.opportunity_id <> p_opportunity_id then
    raise exception 'El artefacto no pertenece a la oportunidad.' using errcode = 'P0002';
  end if;
  if p_content_kind not in ('markdown','texto','metadata') then raise exception 'Tipo de contenido inválido.' using errcode = '22023'; end if;
  select id, version into v_prev, v_version from public.psi_tender_dossier_artifact_versions
    where artifact_id = p_artifact_id order by version desc, id desc limit 1;
  insert into public.psi_tender_dossier_artifact_versions (
    artifact_id, opportunity_id, version, supersedes_version_id, content_kind, content_text, content_metadata, author_id
  ) values (
    p_artifact_id, p_opportunity_id, coalesce(v_version, 0) + 1, v_prev, p_content_kind,
    nullif(btrim(p_content_text), ''), p_content_metadata, p_actor_id
  ) returning id into v_id;
  return jsonb_build_object('artifact', public.psi_project_tender_dossier_artifact(p_artifact_id), 'version_id', v_id);
end;
$$;

create or replace function public.psi_record_tender_dossier_artifact_review(
  p_version_id uuid, p_actor_id uuid, p_decision text, p_comment text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_version public.psi_tender_dossier_artifact_versions%rowtype;
begin
  -- Aprobar/rechazar afecta el gate: decisión de manager.
  perform public.psi_assert_tender_dossier_actor(p_actor_id, true);
  select * into v_version from public.psi_tender_dossier_artifact_versions where id = p_version_id;
  if not found then raise exception 'La versión no existe.' using errcode = 'P0002'; end if;
  perform public.psi_assert_tender_dossier_go(v_version.opportunity_id);
  if p_decision not in ('aprobado','rechazado') then raise exception 'Decisión de revisión inválida.' using errcode = '22023'; end if;
  if p_decision = 'rechazado' and nullif(btrim(p_comment), '') is null then
    raise exception 'Rechazar requiere un comentario.' using errcode = '22023';
  end if;
  insert into public.psi_tender_dossier_artifact_reviews (version_id, artifact_id, opportunity_id, decision, comment, reviewer_id)
  values (p_version_id, v_version.artifact_id, v_version.opportunity_id, p_decision, nullif(btrim(p_comment), ''), p_actor_id);
  return jsonb_build_object('artifact', public.psi_project_tender_dossier_artifact(v_version.artifact_id));
end;
$$;

revoke all on function public.psi_create_tender_dossier_artifact(uuid,uuid,text,text,boolean) from public;
revoke all on function public.psi_create_tender_dossier_artifact(uuid,uuid,text,text,boolean) from anon;
revoke all on function public.psi_create_tender_dossier_artifact(uuid,uuid,text,text,boolean) from authenticated;
grant execute on function public.psi_create_tender_dossier_artifact(uuid,uuid,text,text,boolean) to service_role;
revoke all on function public.psi_add_tender_dossier_artifact_version(uuid,uuid,uuid,text,text,jsonb) from public;
revoke all on function public.psi_add_tender_dossier_artifact_version(uuid,uuid,uuid,text,text,jsonb) from anon;
revoke all on function public.psi_add_tender_dossier_artifact_version(uuid,uuid,uuid,text,text,jsonb) from authenticated;
grant execute on function public.psi_add_tender_dossier_artifact_version(uuid,uuid,uuid,text,text,jsonb) to service_role;
revoke all on function public.psi_record_tender_dossier_artifact_review(uuid,uuid,text,text) from public;
revoke all on function public.psi_record_tender_dossier_artifact_review(uuid,uuid,text,text) from anon;
revoke all on function public.psi_record_tender_dossier_artifact_review(uuid,uuid,text,text) from authenticated;
grant execute on function public.psi_record_tender_dossier_artifact_review(uuid,uuid,text,text) to service_role;

-- Ampliar el catálogo de event_type con hitos comerciales del expediente (Lote 2).
-- El CHECK no es acumulativo: se re-declara con la lista completa.
-- `if exists` en la tabla: los tests PGlite que ejercitan 040 de forma aislada no
-- montan psi_tender_tracking_events (tabla de la migración 033); en producción siempre existe.
alter table if exists public.psi_tender_tracking_events drop constraint if exists psi_tender_tracking_events_event_type_check;
alter table if exists public.psi_tender_tracking_events add constraint psi_tender_tracking_events_event_type_check
  check (event_type in (
    'entered_tracking','tracking_updated','assigned','blocked','unblocked','returned_to_radar','converted','discarded',
    'detected','pipeline_queued',
    'document_discovery_started','document_import_progress','document_import_completed','document_import_partial','document_import_failed',
    'snapshot_published',
    'analysis_queued','analysis_started','analysis_completed','analysis_failed','analysis_rules_fallback_shown',
    'requirement_pending','information_requested','addendum_reviewed','observation_recorded','internal_meeting','case_note',
    'go_decided','no_go_decided','offer_preparation_started','offer_submitted','awarded','not_awarded','cancelled','deserted',
    'dossier_seeded','dossier_artifact_approved','offer_ready_for_submission'));

-- Stub de readiness (definición completa en migración 042). Permite que 040 sea autoconsistente.
create or replace function public.psi_evaluate_tender_dossier_readiness(p_opportunity_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('ready', false, 'pending_required_items', '[]'::jsonb,
    'blocking_items', '[]'::jsonb, 'unapproved_artifacts', '[]'::jsonb, 'active_blockers', '[]'::jsonb);
$$;
revoke all on function public.psi_evaluate_tender_dossier_readiness(uuid) from public;
revoke all on function public.psi_evaluate_tender_dossier_readiness(uuid) from anon;
revoke all on function public.psi_evaluate_tender_dossier_readiness(uuid) from authenticated;
grant execute on function public.psi_evaluate_tender_dossier_readiness(uuid) to service_role;

-- Lectura canónica del expediente: checklist proyectado, artefactos, readiness.
-- El timeline comercial se compone en el adapter; esta RPC entrega checklist/artefactos/readiness.
create or replace function public.psi_get_tender_dossier_workspace(p_opportunity_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with items as (
    select public.psi_project_tender_dossier_item(i.id) as it
    from public.psi_tender_dossier_items i where i.opportunity_id = p_opportunity_id
    order by i.created_at, i.id),
  artifacts as (
    select public.psi_project_tender_dossier_artifact(a.id) as ar
    from public.psi_tender_dossier_artifacts a where a.opportunity_id = p_opportunity_id
    order by a.created_at, a.id)
  select jsonb_build_object(
    'opportunity_id', p_opportunity_id,
    'checklist', coalesce((select jsonb_agg(it) from items), '[]'::jsonb),
    'artifacts', coalesce((select jsonb_agg(ar) from artifacts), '[]'::jsonb),
    'readiness', public.psi_evaluate_tender_dossier_readiness(p_opportunity_id)
  );
$$;

revoke all on function public.psi_get_tender_dossier_workspace(uuid) from public;
revoke all on function public.psi_get_tender_dossier_workspace(uuid) from anon;
revoke all on function public.psi_get_tender_dossier_workspace(uuid) from authenticated;
grant execute on function public.psi_get_tender_dossier_workspace(uuid) to service_role;

commit;
