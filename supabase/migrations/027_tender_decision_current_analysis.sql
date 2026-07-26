-- Authoritative current-document pointer and analysis anchoring at decision time.
begin;

create table if not exists public.psi_tender_document_state (
  opportunity_id uuid primary key references public.psi_sales_opportunities(id) on delete restrict,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  current_snapshot_id uuid references public.psi_tender_document_snapshots(id) on delete restrict,
  refresh_in_progress boolean not null default false,
  active_refresh_token uuid,
  refresh_started_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((refresh_in_progress and active_refresh_token is not null and refresh_started_at is not null)
      or (not refresh_in_progress and active_refresh_token is null and refresh_started_at is null))
);

alter table public.psi_tender_document_state enable row level security;
revoke all on table public.psi_tender_document_state from public;
revoke all on table public.psi_tender_document_state from authenticated;
revoke all on table public.psi_tender_document_state from service_role;
grant select on table public.psi_tender_document_state to service_role;

-- Any caller capable of mutating the live document set must invalidate the
-- authoritative pointer in the same transaction. Governed refreshes later
-- close their token by registering the new immutable snapshot.
create or replace function public.psi_invalidate_tender_state_from_legacy_upload()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_upload boolean := false;
  v_new_upload boolean := false;
begin
  if tg_op <> 'INSERT' then
    v_old_upload := old.interaction_type = 'documento'
      and public.psi_safe_jsonb(old.notes)->>'kind' = 'tender_document_upload';
  end if;
  if tg_op <> 'DELETE' then
    v_new_upload := new.interaction_type = 'documento'
      and public.psi_safe_jsonb(new.notes)->>'kind' = 'tender_document_upload';
  end if;
  if v_old_upload then
    update public.psi_tender_document_state
      set current_snapshot_id = null,
          refresh_in_progress = false,
          active_refresh_token = null,
          refresh_started_at = null,
          updated_at = now()
      where opportunity_id = old.opportunity_id;
  end if;
  if v_new_upload and (not v_old_upload or new.opportunity_id is distinct from old.opportunity_id) then
    update public.psi_tender_document_state
      set current_snapshot_id = null,
          refresh_in_progress = false,
          active_refresh_token = null,
          refresh_started_at = null,
          updated_at = now()
      where opportunity_id = new.opportunity_id;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.psi_invalidate_tender_state_from_legacy_upload() from public;
revoke all on function public.psi_invalidate_tender_state_from_legacy_upload() from authenticated;
revoke all on function public.psi_invalidate_tender_state_from_legacy_upload() from service_role;
drop trigger if exists psi_invalidate_tender_state_from_legacy_upload on public.psi_sales_interactions;
create trigger psi_invalidate_tender_state_from_legacy_upload
after insert or update or delete on public.psi_sales_interactions
for each row execute function public.psi_invalidate_tender_state_from_legacy_upload();

create or replace function public.psi_invalidate_tender_state_from_typed_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_current boolean := false;
  v_new_current boolean := false;
begin
  if tg_op <> 'INSERT' then v_old_current := old.current; end if;
  if tg_op <> 'DELETE' then v_new_current := new.current; end if;
  if v_old_current then
    update public.psi_tender_document_state
      set current_snapshot_id = null,
          refresh_in_progress = false,
          active_refresh_token = null,
          refresh_started_at = null,
          updated_at = now()
      where opportunity_id = old.opportunity_id;
  end if;
  if v_new_current and (not v_old_current or new.opportunity_id is distinct from old.opportunity_id) then
    update public.psi_tender_document_state
      set current_snapshot_id = null,
          refresh_in_progress = false,
          active_refresh_token = null,
          refresh_started_at = null,
          updated_at = now()
      where opportunity_id = new.opportunity_id;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.psi_invalidate_tender_state_from_typed_version() from public;
revoke all on function public.psi_invalidate_tender_state_from_typed_version() from authenticated;
revoke all on function public.psi_invalidate_tender_state_from_typed_version() from service_role;
drop trigger if exists psi_invalidate_tender_state_from_typed_version on public.psi_tender_document_versions;
create trigger psi_invalidate_tender_state_from_typed_version
after insert or update or delete on public.psi_tender_document_versions
for each row execute function public.psi_invalidate_tender_state_from_typed_version();

create or replace function public.psi_begin_tender_document_refresh(
  p_opportunity_id uuid,
  p_tender_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state public.psi_tender_document_state%rowtype;
  v_token uuid := gen_random_uuid();
begin
  perform 1 from public.psi_sales_opportunities where id = p_opportunity_id for update;
  if not found then raise exception 'La oportunidad no existe.' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.psi_public_tenders where id = p_tender_id and converted_opportunity_id = p_opportunity_id) then
    raise exception 'La licitación no está vinculada a la oportunidad indicada.' using errcode = '22023';
  end if;

  select * into v_state from public.psi_tender_document_state where opportunity_id = p_opportunity_id for update;
  if found and v_state.refresh_in_progress and v_state.refresh_started_at > now() - interval '15 minutes' then
    raise exception 'Ya existe una actualización documental en curso.' using errcode = '55000';
  end if;

  insert into public.psi_tender_document_state (
    opportunity_id, tender_id, current_snapshot_id, refresh_in_progress, active_refresh_token, refresh_started_at, updated_at
  ) values (
    p_opportunity_id, p_tender_id, v_state.current_snapshot_id, true, v_token, now(), now()
  ) on conflict (opportunity_id) do update set
    tender_id = excluded.tender_id,
    refresh_in_progress = true,
    active_refresh_token = excluded.active_refresh_token,
    refresh_started_at = excluded.refresh_started_at,
    updated_at = now();
  return v_token;
end;
$$;

revoke all on function public.psi_begin_tender_document_refresh(uuid, uuid) from public;
revoke all on function public.psi_begin_tender_document_refresh(uuid, uuid) from authenticated;
revoke all on function public.psi_begin_tender_document_refresh(uuid, uuid) from service_role;
grant execute on function public.psi_begin_tender_document_refresh(uuid, uuid) to service_role;

-- Replace the old snapshot overload so every observation moves the explicit current pointer.
revoke all on function public.psi_record_tender_document_snapshot(uuid, uuid, text, text, jsonb, jsonb, uuid) from public;
revoke all on function public.psi_record_tender_document_snapshot(uuid, uuid, text, text, jsonb, jsonb, uuid) from authenticated;
revoke all on function public.psi_record_tender_document_snapshot(uuid, uuid, text, text, jsonb, jsonb, uuid) from service_role;
drop function public.psi_record_tender_document_snapshot(uuid, uuid, text, text, jsonb, jsonb, uuid);

create function public.psi_record_tender_document_snapshot(
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_document_hash text,
  p_profile_hash text,
  p_document_manifest jsonb,
  p_profile_snapshot jsonb,
  p_actor_id uuid default null,
  p_refresh_token uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot public.psi_tender_document_snapshots%rowtype;
  v_state public.psi_tender_document_state%rowtype;
begin
  if p_document_hash is null or p_document_hash !~ '^[0-9a-f]{64}$'
     or p_profile_hash is null or p_profile_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Los hashes documentales y de perfil deben ser SHA-256 hexadecimal en minúscula.' using errcode = '22023';
  end if;
  if p_document_manifest is null or jsonb_typeof(p_document_manifest) <> 'object'
     or p_profile_snapshot is null or jsonb_typeof(p_profile_snapshot) <> 'object' then
    raise exception 'El manifiesto documental y el perfil deben ser objetos estructurados.' using errcode = '22023';
  end if;

  perform 1 from public.psi_sales_opportunities where id = p_opportunity_id for update;
  if not found then raise exception 'La oportunidad no existe.' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.psi_public_tenders where id = p_tender_id and converted_opportunity_id = p_opportunity_id) then
    raise exception 'La licitación no está vinculada a la oportunidad indicada.' using errcode = '22023';
  end if;

  select * into v_state from public.psi_tender_document_state where opportunity_id = p_opportunity_id for update;
  if p_refresh_token is null then
    raise exception 'El token de actualización documental es obligatorio para publicar el snapshot.' using errcode = '22023';
  end if;
  if not found or not v_state.refresh_in_progress or v_state.active_refresh_token is distinct from p_refresh_token then
    raise exception 'El token de actualización documental no está vigente.' using errcode = '55000';
  end if;

  insert into public.psi_tender_document_snapshots (
    opportunity_id, tender_id, document_hash, profile_hash, document_manifest, profile_snapshot, actor_id
  ) values (
    p_opportunity_id, p_tender_id, p_document_hash, p_profile_hash, p_document_manifest, p_profile_snapshot, p_actor_id
  ) on conflict (opportunity_id, document_hash, profile_hash) do nothing;

  select * into v_snapshot from public.psi_tender_document_snapshots
  where opportunity_id = p_opportunity_id and document_hash = p_document_hash and profile_hash = p_profile_hash
  for share;
  if not found then raise exception 'No fue posible recuperar el snapshot documental.' using errcode = 'P0002'; end if;
  if v_snapshot.tender_id is distinct from p_tender_id then
    raise exception 'El snapshot documental existente pertenece a otra licitación.' using errcode = '22023';
  end if;

  insert into public.psi_tender_document_state (
    opportunity_id, tender_id, current_snapshot_id, refresh_in_progress, active_refresh_token, refresh_started_at, updated_at
  ) values (
    p_opportunity_id, p_tender_id, v_snapshot.id, false, null, null, now()
  ) on conflict (opportunity_id) do update set
    tender_id = excluded.tender_id,
    current_snapshot_id = excluded.current_snapshot_id,
    refresh_in_progress = false,
    active_refresh_token = null,
    refresh_started_at = null,
    updated_at = now();

  return jsonb_build_object(
    'id', v_snapshot.id, 'opportunity_id', v_snapshot.opportunity_id, 'tender_id', v_snapshot.tender_id,
    'document_hash', v_snapshot.document_hash, 'profile_hash', v_snapshot.profile_hash,
    'created_at', v_snapshot.created_at
  );
end;
$$;

revoke all on function public.psi_record_tender_document_snapshot(uuid, uuid, text, text, jsonb, jsonb, uuid, uuid) from public;
revoke all on function public.psi_record_tender_document_snapshot(uuid, uuid, text, text, jsonb, jsonb, uuid, uuid) from authenticated;
revoke all on function public.psi_record_tender_document_snapshot(uuid, uuid, text, text, jsonb, jsonb, uuid, uuid) from service_role;
grant execute on function public.psi_record_tender_document_snapshot(uuid, uuid, text, text, jsonb, jsonb, uuid, uuid) to service_role;

-- Remove the seven-argument decision overload so document-hash validation cannot be bypassed.
revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb) from public;
revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb) from authenticated;
revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb) from service_role;
drop function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb);

create function public.psi_record_tender_go_no_go(
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_actor_id uuid,
  p_decision text,
  p_analysis_run_id uuid,
  p_justification text,
  p_preparation jsonb,
  p_document_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_opportunity public.psi_sales_opportunities%rowtype;
  v_tender public.psi_public_tenders%rowtype;
  v_analysis public.psi_tender_analysis_runs%rowtype;
  v_analysis_snapshot public.psi_tender_document_snapshots%rowtype;
  v_state public.psi_tender_document_state%rowtype;
  v_previous_id uuid;
  v_decision_id uuid;
  v_preparation_id uuid;
  v_preparation_created boolean := false;
  v_status text;
  v_now timestamptz := now();
begin
  if p_decision is null or p_decision not in ('go', 'no_go') then
    raise exception 'La decisión debe ser go o no_go.' using errcode = '22023';
  end if;
  if p_document_hash is null or p_document_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'El hash documental vigente es obligatorio.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.psi_sales_profiles p
    join public.psi_profile_permissions pp on pp.profile_id = p.id and pp.permission_code = 'licitaciones'
    join public.psi_access_permissions ap on ap.code = pp.permission_code and ap.active = true
    where p.id = p_actor_id and p.active = true and coalesce(p.identity_type, 'human') = 'human' and p.role in ('admin', 'gerencia', 'director')
  ) then
    raise exception 'No tiene permisos para registrar una decisión de licitación.' using errcode = '42501';
  end if;

  select * into v_opportunity from public.psi_sales_opportunities where id = p_opportunity_id for update;
  if not found then raise exception 'La oportunidad no existe.' using errcode = 'P0002'; end if;
  select * into v_tender from public.psi_public_tenders where id = p_tender_id for update;
  if not found then raise exception 'La licitación no existe.' using errcode = 'P0002'; end if;
  if v_tender.converted_opportunity_id is distinct from p_opportunity_id then
    raise exception 'La licitación no está vinculada a la oportunidad indicada.' using errcode = '22023';
  end if;
  if v_opportunity.tipo_producto_original is distinct from 'Licitación Pública' and coalesce(v_opportunity.external_source, '') not like 'secop_radar:%' then
    raise exception 'La oportunidad no tiene origen de licitación pública.' using errcode = '22023';
  end if;

  if p_analysis_run_id is not null then
    select * into v_state from public.psi_tender_document_state where opportunity_id = p_opportunity_id for share;
    if not found or v_state.refresh_in_progress or v_state.current_snapshot_id is null then
      raise exception 'No hay un conjunto documental estable para anclar el análisis.' using errcode = '55000';
    end if;
    select * into v_analysis from public.psi_tender_analysis_runs
      where id = p_analysis_run_id and opportunity_id = p_opportunity_id and tender_id = p_tender_id for share;
    if not found then raise exception 'El análisis indicado no pertenece a esta oportunidad y licitación.' using errcode = '22023'; end if;
    if v_analysis.status is distinct from 'completed' then raise exception 'Sólo puede anclarse un análisis completado.' using errcode = '22023'; end if;
    if v_state.current_snapshot_id is distinct from v_analysis.snapshot_id then raise exception 'El análisis no corresponde al conjunto documental vigente.' using errcode = '22023'; end if;
    select * into v_analysis_snapshot from public.psi_tender_document_snapshots where id = v_analysis.snapshot_id for share;
    if not found or v_analysis_snapshot.document_hash is distinct from p_document_hash then
      raise exception 'El hash del análisis no coincide con el conjunto documental vigente.' using errcode = '22023';
    end if;
  end if;

  select d.id into v_previous_id
    from public.psi_tender_go_no_go_decisions d
    where d.opportunity_id = p_opportunity_id and d.tender_id = p_tender_id
      and not exists (select 1 from public.psi_tender_go_no_go_decisions child where child.supersedes_decision_id = d.id)
    order by d.decided_at desc, d.id desc limit 1;
  insert into public.psi_tender_go_no_go_decisions (
    opportunity_id, tender_id, decision, analysis_interaction_id, analysis_run_id,
    justification, decided_by, decided_at, supersedes_decision_id
  ) values (
    p_opportunity_id, p_tender_id, p_decision, null, p_analysis_run_id,
    nullif(btrim(p_justification), ''), p_actor_id, v_now, v_previous_id
  ) returning id into v_decision_id;

  if p_decision = 'go' then
    select i.id into v_preparation_id from public.psi_sales_interactions i
      where i.opportunity_id = p_opportunity_id and i.interaction_type = 'documento'
        and public.psi_safe_jsonb(i.notes)->>'kind' = 'tender_offer_preparation'
      order by i.occurred_at desc, i.id desc limit 1;
    if v_preparation_id is null then
      if p_preparation is null or jsonb_typeof(p_preparation) <> 'object' or p_preparation->>'kind' is distinct from 'tender_offer_preparation' then
        raise exception 'GO requiere una preparación de oferta JSON con kind tender_offer_preparation.' using errcode = '22023';
      end if;
      insert into public.psi_sales_interactions (opportunity_id, interaction_type, created_by, occurred_at, notes)
      values (p_opportunity_id, 'documento', p_actor_id, v_now, p_preparation::text)
      returning id into v_preparation_id;
      v_preparation_created := true;
    end if;
    v_status := 'en_preparacion';
  else
    v_status := 'cerrada_no_go';
  end if;

  update public.psi_sales_opportunities set tender_offer_status = v_status where id = p_opportunity_id;
  return jsonb_build_object('decision_id', v_decision_id, 'supersedes_decision_id', v_previous_id, 'decision', p_decision, 'preparation_id', v_preparation_id, 'preparation_created', v_preparation_created, 'tender_offer_status', v_status, 'analysis_run_id', p_analysis_run_id);
end;
$$;

revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text) from public;
revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text) from authenticated;
revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text) from service_role;
grant execute on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text) to service_role;

create or replace function public.psi_tender_analysis_foundation_ready()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select
    to_regclass('public.psi_tender_document_snapshots') is not null
    and to_regclass('public.psi_tender_document_versions') is not null
    and to_regclass('public.psi_tender_document_state') is not null
    and to_regclass('public.psi_tender_analysis_runs') is not null
    and to_regprocedure('public.psi_begin_tender_document_refresh(uuid,uuid)') is not null
    and to_regprocedure('public.psi_record_tender_document_snapshot(uuid,uuid,text,text,jsonb,jsonb,uuid,uuid)') is not null
    and to_regprocedure('public.psi_record_tender_analysis_run(uuid,uuid,uuid,text,text,text,jsonb,integer,text,text,text,text,jsonb)') is not null
    and to_regprocedure('public.psi_record_tender_go_no_go(uuid,uuid,uuid,text,uuid,text,jsonb,text)') is not null
    and exists (
      select 1 from pg_trigger
      where tgname = 'psi_invalidate_tender_state_from_legacy_upload'
        and tgrelid = 'public.psi_sales_interactions'::regclass
        and not tgisinternal
    )
    and exists (
      select 1 from pg_trigger
      where tgname = 'psi_invalidate_tender_state_from_typed_version'
        and tgrelid = 'public.psi_tender_document_versions'::regclass
        and not tgisinternal
    );
$$;

revoke all on function public.psi_tender_analysis_foundation_ready() from public;
revoke all on function public.psi_tender_analysis_foundation_ready() from authenticated;
revoke all on function public.psi_tender_analysis_foundation_ready() from service_role;
grant execute on function public.psi_tender_analysis_foundation_ready() to service_role;

commit;
