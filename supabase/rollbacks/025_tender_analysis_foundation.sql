-- Rollback operativo de 025_tender_analysis_foundation.
-- Orden seguro: primero redeploy de código compatible con pre-025; luego ejecute este rollback autorizado.
-- Conserva evidencia: no elimina snapshots, runs ni analysis_run_id; sólo retira ejecución de las RPC nuevas.
begin;

-- Fallar antes de cambiar funciones si el esquema heredado no puede sostener la RPC 022.
do $$
begin
  if to_regclass('public.psi_tender_go_no_go_decisions') is null
     or to_regclass('public.psi_sales_opportunities') is null
     or to_regclass('public.psi_public_tenders') is null
     or to_regclass('public.psi_sales_interactions') is null
     or to_regclass('public.psi_sales_profiles') is null
     or to_regclass('public.psi_profile_permissions') is null
     or to_regclass('public.psi_access_permissions') is null then
    raise exception 'Rollback 025 requiere las relaciones de decisión GO/NO GO de 022.';
  end if;
  if to_regclass('public.psi_tender_document_snapshots') is null
     or to_regclass('public.psi_tender_analysis_runs') is null then
    raise exception 'Rollback 025 requiere conservar las tablas de auditoría de snapshots y runs.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'psi_tender_go_no_go_decisions'
      and column_name = 'analysis_interaction_id'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'psi_tender_go_no_go_decisions'
      and column_name = 'analysis_run_id'
  ) then
    raise exception 'Rollback 025 requiere conservar analysis_interaction_id y analysis_run_id para compatibilidad y auditoría.';
  end if;
  if to_regprocedure('public.psi_safe_jsonb(text)') is null then
    raise exception 'Rollback 025 requiere public.psi_safe_jsonb(text).';
  end if;
end;
$$;

-- Las tablas y analysis_run_id permanecen para auditoría, pero el código pre-025 no puede crear nuevas evidencias 025.
revoke all on function public.psi_record_tender_document_snapshot(uuid, uuid, text, text, jsonb, jsonb, uuid) from public;
revoke all on function public.psi_record_tender_document_snapshot(uuid, uuid, text, text, jsonb, jsonb, uuid) from authenticated;
revoke all on function public.psi_record_tender_document_snapshot(uuid, uuid, text, text, jsonb, jsonb, uuid) from service_role;
revoke all on function public.psi_record_tender_analysis_run(uuid, uuid, uuid, text, text, text, jsonb, integer, text, text, text, text, jsonb) from public;
revoke all on function public.psi_record_tender_analysis_run(uuid, uuid, uuid, text, text, text, jsonb, integer, text, text, text, text, jsonb) from authenticated;
revoke all on function public.psi_record_tender_analysis_run(uuid, uuid, uuid, text, text, text, jsonb, integer, text, text, text, text, jsonb) from service_role;
revoke all on function public.psi_tender_analysis_foundation_ready() from public;
revoke all on function public.psi_tender_analysis_foundation_ready() from authenticated;
revoke all on function public.psi_tender_analysis_foundation_ready() from service_role;

-- PostgreSQL identifies this function by types rather than parameter names. Dropping
-- only the overload is required to restore the 022 public parameter name safely.
drop function if exists public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb);

create or replace function public.psi_record_tender_go_no_go(
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_actor_id uuid,
  p_decision text,
  p_analysis_interaction_id uuid,
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
  if p_analysis_interaction_id is not null and not exists (
    select 1 from public.psi_sales_interactions i
    where i.id = p_analysis_interaction_id and i.opportunity_id = p_opportunity_id
      and i.interaction_type = 'documento'
      and public.psi_safe_jsonb(i.notes)->>'kind' = 'tender_document_analysis'
  ) then
    raise exception 'El análisis debe ser un análisis de licitación de la oportunidad indicada.' using errcode = '22023';
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
  insert into public.psi_tender_go_no_go_decisions (opportunity_id, tender_id, decision, analysis_interaction_id, justification, decided_by, decided_at, supersedes_decision_id)
  values (p_opportunity_id, p_tender_id, p_decision, p_analysis_interaction_id, nullif(btrim(p_justification), ''), p_actor_id, v_now, v_previous_id)
  returning id into v_decision_id;

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

commit;
