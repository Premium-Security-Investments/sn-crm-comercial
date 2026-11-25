-- 234 — «No se presentó» cierra el proceso (Juan, 2026-11-25).
--
-- Problema: registrar «No se presentó» (191) guardaba el motivo pero dejaba la oferta «en preparación»: SIC 23 de 2026
-- seguía en curso, en «Todas» y en Mi día después del cierre. «Presentada» sí movía el estado; «no presentada» no.
-- Decisión de Juan: que pase sola a Cerradas (no archivada: se queda a la vista con su motivo, para lecciones y para
-- contar lo que dejamos pasar), con un estado propio, distinto del NO GO.
--
-- Qué hace: estado de oferta `no_presentada` (terminal), el borde en preparación/lista → no_presentada en la bitácora,
-- la función de registro lo aplica, el listado y el acta de cierre lo tratan como cerrada, y se corrige lo ya
-- registrado (SIC) sin pedir que se repita.
begin;

alter table public.psi_sales_opportunities drop constraint if exists psi_sales_opportunities_tender_offer_status_check;
alter table public.psi_sales_opportunities add constraint psi_sales_opportunities_tender_offer_status_check
  check (tender_offer_status is null or tender_offer_status in ('pendiente_decision', 'en_preparacion', 'lista_para_presentar',
    'presentada', 'adjudicada', 'no_adjudicada', 'cerrada_no_go', 'no_presentada'));

alter table public.psi_tender_offer_status_transitions drop constraint if exists psi_tender_offer_status_transitions_to_status_check;
alter table public.psi_tender_offer_status_transitions add constraint psi_tender_offer_status_transitions_to_status_check
  check (to_status in ('lista_para_presentar', 'presentada', 'adjudicada', 'no_adjudicada', 'no_presentada'));
alter table public.psi_tender_offer_status_transitions drop constraint if exists psi_tender_offer_status_transitions_valid_edge;
alter table public.psi_tender_offer_status_transitions add constraint psi_tender_offer_status_transitions_valid_edge
  check ((from_status = 'en_preparacion' and to_status in ('lista_para_presentar', 'presentada', 'no_presentada'))
    or (from_status = 'lista_para_presentar' and to_status in ('presentada', 'no_presentada'))
    or (from_status = 'presentada' and to_status in ('adjudicada', 'no_adjudicada')));

alter table public.psi_tender_closure_acta drop constraint if exists psi_tender_closure_acta_closure_kind_check;
alter table public.psi_tender_closure_acta add constraint psi_tender_closure_acta_closure_kind_check
  check (closure_kind in ('adjudicada', 'no_adjudicada', 'cerrada_no_go', 'no_presentada', 'archivada'));

create or replace function public.psi_tender_closure_kind(p_opportunity psi_sales_opportunities)
 returns text
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
  select case
    when p_opportunity.archived_at is not null then 'archivada'
    when coalesce(p_opportunity.tender_offer_status, 'pendiente_decision') in ('cerrada_no_go', 'adjudicada', 'no_adjudicada', 'no_presentada') then p_opportunity.tender_offer_status
    else null
  end;
$function$;

create or replace function public.psi_list_tender_opportunity_page(p_filter text, p_limit integer, p_offset integer)
 returns table(tender jsonb, opportunity jsonb, latest_decision jsonb)
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if p_filter is null or p_filter not in ('all', 'por_decidir', 'en_curso', 'cerradas', 'archivadas', 'pending_decision', 'go_authorized', 'in_preparation', 'submitted', 'closed') then raise exception 'El filtro de oportunidades no es válido.' using errcode = '22023'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then raise exception 'El límite debe estar entre 1 y 50.' using errcode = '22023'; end if;
  if p_offset is null or p_offset < 0 or p_offset > 10000 then raise exception 'El desplazamiento debe estar entre 0 y 10000.' using errcode = '22023'; end if;
  return query
  select to_jsonb(t), to_jsonb(o), case when d.id is null then null else jsonb_build_object('id', d.id, 'opportunity_id', d.opportunity_id, 'tender_id', d.tender_id, 'decision', d.decision, 'decided_at', d.decided_at, 'psi_sales_profiles', case when actor.id is null then null else jsonb_build_object('full_name', actor.full_name) end) end
  from public.psi_public_tenders t
  join public.psi_sales_opportunities o on o.id = t.converted_opportunity_id
  left join lateral (select d.* from public.psi_tender_go_no_go_decisions d where d.opportunity_id = o.id and d.tender_id = t.id and not exists (select 1 from public.psi_tender_go_no_go_decisions child where child.supersedes_decision_id = d.id) order by d.decided_at desc, d.id desc limit 1) d on true
  left join public.psi_sales_profiles actor on actor.id = d.decided_by
  left join lateral (select case when coalesce(d.decision, '') = 'no_go' or coalesce(o.tender_offer_status, 'pendiente_decision') in ('cerrada_no_go', 'adjudicada', 'no_adjudicada', 'no_presentada') then 'cerradas' when coalesce(d.decision, '') <> 'go' then 'por_decidir' else 'en_curso' end as stage) st on true
  where t.internal_status = 'convertida_oportunidad'
    and ((p_filter = 'archivadas' and o.archived_at is not null) or (p_filter <> 'archivadas' and o.archived_at is null and (p_filter = 'all' or p_filter = st.stage or (p_filter = 'pending_decision' and coalesce(o.tender_offer_status, 'pendiente_decision') = 'pendiente_decision' and d.id is null) or (p_filter = 'go_authorized' and d.decision = 'go' and coalesce(o.tender_offer_status, 'pendiente_decision') in ('en_preparacion', 'lista_para_presentar', 'presentada')) or (p_filter = 'in_preparation' and coalesce(o.tender_offer_status, 'pendiente_decision') in ('en_preparacion', 'lista_para_presentar')) or (p_filter = 'submitted' and coalesce(o.tender_offer_status, 'pendiente_decision') = 'presentada') or (p_filter = 'closed' and coalesce(o.tender_offer_status, 'pendiente_decision') in ('cerrada_no_go', 'adjudicada', 'no_adjudicada', 'no_presentada')))))
  order by o.expected_close_date asc nulls last, t.id asc
  limit p_limit offset p_offset;
end;
$function$;

create or replace function public.psi_register_tender_offer_submission(p_opportunity_id uuid, p_actor_id uuid, p_payload jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_tender_id uuid; v_status text; v_kind text; v_readiness jsonb := '{}'::jsonb; v_incomplete boolean := false;
  v_row public.psi_tender_offer_submissions%rowtype; v_ref text; v_url text; v_at timestamptz; v_reason text;
begin
  perform public.psi_assert_tender_offer_record_actor(p_actor_id);
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Faltan los datos del registro.' using errcode = '22023'; end if;
  v_kind := p_payload ->> 'kind';
  if v_kind not in ('presentada', 'no_presentada') then raise exception 'Indique si la oferta se presentó o no.' using errcode = '22023'; end if;
  v_ref := nullif(btrim(coalesce(p_payload ->> 'filing_reference', '')), '');
  v_url := nullif(btrim(coalesce(p_payload ->> 'evidence_url', '')), '');
  v_reason := nullif(btrim(coalesce(p_payload ->> 'reason', '')), '');
  begin v_at := nullif(p_payload ->> 'submitted_at', '')::timestamptz;
  exception when others then raise exception 'La fecha y hora de radicación no es válida.' using errcode = '22023'; end;
  if v_kind = 'presentada' then
    if v_ref is null then raise exception 'Falta el número de radicado o RPL.' using errcode = '22023'; end if;
    if v_at is null then raise exception 'Falta la fecha y hora de radicación.' using errcode = '22023'; end if;
    if v_at > now() + interval '1 hour' then raise exception 'La fecha de radicación no puede ser futura.' using errcode = '22023'; end if;
    if v_url is null or v_url !~* '^https://' then raise exception 'Falta el enlace (https) al PDF o a lo radicado.' using errcode = '22023'; end if;
  elsif v_reason is null then
    raise exception 'Diga por qué no se presentó.' using errcode = '22023';
  end if;

  v_tender_id := public.psi_lock_tender_offer_with_go(p_opportunity_id);
  if exists (select 1 from public.psi_tender_offer_submissions where opportunity_id = p_opportunity_id) then
    raise exception 'Esta licitación ya tiene registrado si se presentó.' using errcode = '23505';
  end if;
  select coalesce(tender_offer_status, 'pendiente_decision') into v_status from public.psi_sales_opportunities where id = p_opportunity_id;
  if v_status not in ('en_preparacion', 'lista_para_presentar') then
    raise exception 'La oferta está %, no se puede registrar como presentada.', v_status using errcode = '23514';
  end if;

  -- Lo que faltaba en el expediente, tal como lo dice la compuerta: se guarda, no se aprueba nada.
  if v_kind = 'presentada' and v_status = 'en_preparacion'
     and to_regprocedure('public.psi_evaluate_tender_dossier_readiness(uuid)') is not null then
    v_readiness := coalesce(public.psi_evaluate_tender_dossier_readiness(p_opportunity_id), '{}'::jsonb);
    v_incomplete := coalesce((v_readiness ->> 'ready')::boolean, false) is not true;
  end if;

  insert into public.psi_tender_offer_submissions (opportunity_id, tender_id, kind, filing_reference, submitted_at, evidence_url,
    reason, dossier_incomplete, missing_at_submission, actor_id)
  values (p_opportunity_id, v_tender_id, v_kind, v_ref, v_at, v_url, v_reason, v_incomplete,
    case when v_incomplete then v_readiness else '{}'::jsonb end, p_actor_id)
  returning * into v_row;

  -- Presentada o no, el estado de la oferta lo dice; «no presentada» cierra el proceso (234, Juan 2026-11-25).
  update public.psi_sales_opportunities set tender_offer_status = v_kind where id = p_opportunity_id;
  insert into public.psi_tender_offer_status_transitions (opportunity_id, tender_id, actor_id, from_status, to_status, note)
  values (p_opportunity_id, v_tender_id, p_actor_id, v_status, v_kind,
    left(case when v_kind = 'presentada'
      then 'Radicada: ' || v_ref || case when v_incomplete then ' (expediente incompleto en el CRM)' else '' end
      else 'No se presentó: ' || v_reason end, 2000));
  return to_jsonb(v_row);
end;
$function$;

-- Lo ya registrado como «no presentada» que sigue abierto (SIC 23 de 2026): se cierra con la misma constancia.
insert into public.psi_tender_offer_status_transitions (opportunity_id, tender_id, actor_id, from_status, to_status, note)
select s.opportunity_id, s.tender_id, s.actor_id, o.tender_offer_status, 'no_presentada', left('No se presentó: ' || s.reason, 2000)
from public.psi_tender_offer_submissions s
join public.psi_sales_opportunities o on o.id = s.opportunity_id
where s.kind = 'no_presentada' and o.tender_offer_status in ('en_preparacion', 'lista_para_presentar');

update public.psi_sales_opportunities o set tender_offer_status = 'no_presentada'
from public.psi_tender_offer_submissions s
where s.opportunity_id = o.id and s.kind = 'no_presentada' and o.tender_offer_status in ('en_preparacion', 'lista_para_presentar');

commit;
