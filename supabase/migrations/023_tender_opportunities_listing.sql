-- Bounded, deterministic tender-opportunity listing for the Task 8 lifecycle views.
-- This is read-only and additive; it intentionally leaves the 022 status contract authoritative.
begin;

alter table if exists public.psi_tender_go_no_go_decisions
  add column if not exists supersedes_decision_id uuid;

create or replace function public.psi_list_tender_opportunity_page(p_filter text, p_limit int, p_offset int)
returns table (tender jsonb, opportunity jsonb, latest_decision jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_filter is null or p_filter not in ('all', 'pending_decision', 'go_authorized', 'in_preparation', 'submitted', 'closed') then
    raise exception 'El filtro de oportunidades no es válido.' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'El límite debe estar entre 1 y 50.' using errcode = '22023';
  end if;
  if p_offset is null or p_offset < 0 or p_offset > 10000 then
    raise exception 'El desplazamiento debe estar entre 0 y 10000.' using errcode = '22023';
  end if;

  return query
  select
    to_jsonb(t) as tender,
    to_jsonb(o) as opportunity,
    case when d.id is null then null else jsonb_build_object(
      'id', d.id,
      'opportunity_id', d.opportunity_id,
      'tender_id', d.tender_id,
      'decision', d.decision,
      'decided_at', d.decided_at,
      'psi_sales_profiles', case when actor.id is null then null else jsonb_build_object('full_name', actor.full_name) end
    ) end as latest_decision
  from public.psi_public_tenders t
  join public.psi_sales_opportunities o on o.id = t.converted_opportunity_id
  left join lateral (
    select d.*
    from public.psi_tender_go_no_go_decisions d
    where d.opportunity_id = o.id and d.tender_id = t.id
      and not exists (
        select 1 from public.psi_tender_go_no_go_decisions child
        where child.supersedes_decision_id = d.id
      )
    order by d.decided_at desc, d.id desc
    limit 1
  ) d on true
  left join public.psi_sales_profiles actor on actor.id = d.decided_by
  where
    p_filter = 'all'
    or (p_filter = 'pending_decision' and coalesce(o.tender_offer_status, 'pendiente_decision') = 'pendiente_decision' and d.id is null)
    or (p_filter = 'go_authorized' and d.decision = 'go' and coalesce(o.tender_offer_status, 'pendiente_decision') in ('en_preparacion', 'lista_para_presentar', 'presentada'))
    or (p_filter = 'in_preparation' and coalesce(o.tender_offer_status, 'pendiente_decision') in ('en_preparacion', 'lista_para_presentar'))
    or (p_filter = 'submitted' and coalesce(o.tender_offer_status, 'pendiente_decision') = 'presentada')
    or (p_filter = 'closed' and coalesce(o.tender_offer_status, 'pendiente_decision') in ('cerrada_no_go', 'adjudicada', 'no_adjudicada'))
  order by t.tracking_updated_at desc nulls last, t.id asc
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.psi_list_tender_opportunity_page(text, int, int) from public;
revoke all on function public.psi_list_tender_opportunity_page(text, int, int) from authenticated;
revoke all on function public.psi_list_tender_opportunity_page(text, int, int) from service_role;
grant execute on function public.psi_list_tender_opportunity_page(text, int, int) to service_role;

commit;
