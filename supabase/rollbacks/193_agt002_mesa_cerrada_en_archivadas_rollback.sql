-- Reversa de la 193: vuelve la guardia de la 140 (el GO se mira antes que el archivo).
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
commit;
