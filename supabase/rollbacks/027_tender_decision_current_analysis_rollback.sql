-- Rollback operativo de 027_tender_decision_current_analysis.
-- Orden seguro: ejecute este rollback ANTES que el de 026 (LIFO) y sólo
-- después de desplegar código compatible con el estado posterior a 025.
-- Conserva evidencia: no elimina psi_tender_document_state, snapshots, runs
-- ni decisiones; sólo retira la superficie RPC nueva de 027 y restaura las
-- firmas de 025 para que el código anterior siga funcionando.
begin;

do $$
begin
  if to_regclass('public.psi_tender_document_snapshots') is null
     or to_regclass('public.psi_tender_analysis_runs') is null
     or to_regclass('public.psi_tender_go_no_go_decisions') is null
     or to_regclass('public.psi_sales_opportunities') is null
     or to_regclass('public.psi_public_tenders') is null
     or to_regclass('public.psi_sales_interactions') is null
     or to_regclass('public.psi_sales_profiles') is null
     or to_regclass('public.psi_profile_permissions') is null
     or to_regclass('public.psi_access_permissions') is null then
    raise exception 'Rollback 027 requiere conservar las relaciones de 022/025.';
  end if;
  if to_regclass('public.psi_tender_document_versions') is null then
    raise exception 'Rollback 027 requiere que 026 siga presente (falta public.psi_tender_document_versions).';
  end if;
  if to_regclass('public.psi_tender_document_state') is null then
    raise exception 'Rollback 027 requiere que 027 esté aplicada (falta public.psi_tender_document_state).';
  end if;
  if to_regprocedure('public.psi_record_tender_document_snapshot(uuid,uuid,text,text,jsonb,jsonb,uuid,uuid)') is null then
    raise exception 'Rollback 027 requiere la firma vigente de 8 argumentos de psi_record_tender_document_snapshot.';
  end if;
  if to_regprocedure('public.psi_record_tender_go_no_go(uuid,uuid,uuid,text,uuid,text,jsonb,text)') is null then
    raise exception 'Rollback 027 requiere la firma vigente de 8 argumentos de psi_record_tender_go_no_go.';
  end if;
end;
$$;

-- La tabla puntero y los triggers de invalidación permanecen: son estructura
-- de auditoría/compatibilidad hacia adelante, no capacidad expuesta a la
-- aplicación. El código anterior a 027 nunca los lee ni los invoca.
revoke all on function public.psi_begin_tender_document_refresh(uuid, uuid) from service_role;

-- Restaura la firma de snapshot de 025 (7 argumentos, sin token de refresh).
drop function if exists public.psi_record_tender_document_snapshot(uuid, uuid, text, text, jsonb, jsonb, uuid, uuid);

create or replace function public.psi_record_tender_document_snapshot(
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_document_hash text,
  p_profile_hash text,
  p_document_manifest jsonb,
  p_profile_snapshot jsonb,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot public.psi_tender_document_snapshots%rowtype;
begin
  if p_document_hash is null or p_document_hash !~ '^[0-9a-f]{64}$'
     or p_profile_hash is null or p_profile_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Los hashes documentales y de perfil deben ser SHA-256 hexadecimal en minúscula.' using errcode = '22023';
  end if;
  if p_document_manifest is null or jsonb_typeof(p_document_manifest) <> 'object'
     or p_profile_snapshot is null or jsonb_typeof(p_profile_snapshot) <> 'object' then
    raise exception 'El manifiesto documental y el perfil deben ser objetos estructurados.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.psi_sales_opportunities where id = p_opportunity_id) then
    raise exception 'La oportunidad no existe.' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.psi_public_tenders
    where id = p_tender_id and converted_opportunity_id = p_opportunity_id
  ) then
    raise exception 'La licitación no está vinculada a la oportunidad indicada.' using errcode = '22023';
  end if;

  insert into public.psi_tender_document_snapshots (
    opportunity_id, tender_id, document_hash, profile_hash, document_manifest, profile_snapshot, actor_id
  ) values (
    p_opportunity_id, p_tender_id, p_document_hash, p_profile_hash, p_document_manifest, p_profile_snapshot, p_actor_id
  ) on conflict (opportunity_id, document_hash, profile_hash) do nothing;

  select * into v_snapshot
  from public.psi_tender_document_snapshots
  where opportunity_id = p_opportunity_id and document_hash = p_document_hash and profile_hash = p_profile_hash
  for share;
  if not found then
    raise exception 'No fue posible recuperar el snapshot documental.' using errcode = 'P0002';
  end if;
  if v_snapshot.tender_id is distinct from p_tender_id then
    raise exception 'El snapshot documental existente pertenece a otra licitación.' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'id', v_snapshot.id, 'opportunity_id', v_snapshot.opportunity_id, 'tender_id', v_snapshot.tender_id,
    'document_hash', v_snapshot.document_hash, 'profile_hash', v_snapshot.profile_hash,
    'created_at', v_snapshot.created_at
  );
end;
$$;

revoke all on function public.psi_record_tender_document_snapshot(uuid, uuid, text, text, jsonb, jsonb, uuid) from public;
revoke all on function public.psi_record_tender_document_snapshot(uuid, uuid, text, text, jsonb, jsonb, uuid) from authenticated;
revoke all on function public.psi_record_tender_document_snapshot(uuid, uuid, text, text, jsonb, jsonb, uuid) from service_role;
grant execute on function public.psi_record_tender_document_snapshot(uuid, uuid, text, text, jsonb, jsonb, uuid) to service_role;

-- Restaura la firma de decisión GO/NO GO de 025 (7 argumentos, sin hash documental).
drop function if exists public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text);

create or replace function public.psi_record_tender_go_no_go(
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_actor_id uuid,
  p_decision text,
  p_analysis_run_id uuid,
  p_justification text,
  p_preparation jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_opportunity public.psi_sales_opportunities%rowtype;
  v_tender public.psi_public_tenders%rowtype;
  v_analysis public.psi_tender_analysis_runs%rowtype;
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
    select r.* into v_analysis
    from public.psi_tender_analysis_runs r
    where r.id = p_analysis_run_id and r.opportunity_id = p_opportunity_id and r.tender_id = p_tender_id
    for share;
    if not found then
      raise exception 'El análisis indicado no pertenece a esta oportunidad y licitación.' using errcode = '22023';
    end if;
  end if;

  select d.id into v_previous_id
    from public.psi_tender_go_no_go_decisions d
    where d.opportunity_id = p_opportunity_id
      and d.tender_id = p_tender_id
      and not exists (
        select 1 from public.psi_tender_go_no_go_decisions child
        where child.supersedes_decision_id = d.id
      )
    order by d.decided_at desc, d.id desc
    limit 1;
  insert into public.psi_tender_go_no_go_decisions (
    opportunity_id, tender_id, decision, analysis_interaction_id, analysis_run_id,
    justification, decided_by, decided_at, supersedes_decision_id
  ) values (
    p_opportunity_id, p_tender_id, p_decision, null, p_analysis_run_id,
    nullif(btrim(p_justification), ''), p_actor_id, v_now, v_previous_id
  ) returning id into v_decision_id;

  if p_decision = 'go' then
    select i.id into v_preparation_id
      from public.psi_sales_interactions i
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
  return jsonb_build_object('decision_id', v_decision_id, 'supersedes_decision_id', v_previous_id, 'decision', p_decision, 'preparation_id', v_preparation_id, 'preparation_created', v_preparation_created, 'tender_offer_status', v_status);
end;
$$;

revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb) from public;
revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb) from authenticated;
revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb) from service_role;
grant execute on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb) to service_role;

-- Restaura el readiness de 025 (sin dependencias de 026/027).
create or replace function public.psi_tender_analysis_foundation_ready()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    to_regclass('public.psi_tender_document_snapshots') is not null
    and to_regclass('public.psi_tender_analysis_runs') is not null
    and to_regprocedure('public.psi_record_tender_document_snapshot(uuid,uuid,text,text,jsonb,jsonb,uuid)') is not null
    and to_regprocedure('public.psi_record_tender_analysis_run(uuid,uuid,uuid,text,text,text,jsonb,integer,text,text,text,text,jsonb)') is not null
    and to_regprocedure('public.psi_record_tender_go_no_go(uuid,uuid,uuid,text,uuid,text,jsonb)') is not null
    and has_function_privilege('service_role', 'public.psi_record_tender_document_snapshot(uuid,uuid,text,text,jsonb,jsonb,uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.psi_record_tender_analysis_run(uuid,uuid,uuid,text,text,text,jsonb,integer,text,text,text,text,jsonb)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.psi_record_tender_go_no_go(uuid,uuid,uuid,text,uuid,text,jsonb)', 'EXECUTE');
$$;

revoke all on function public.psi_tender_analysis_foundation_ready() from public;
revoke all on function public.psi_tender_analysis_foundation_ready() from authenticated;
revoke all on function public.psi_tender_analysis_foundation_ready() from service_role;
grant execute on function public.psi_tender_analysis_foundation_ready() to service_role;

commit;
