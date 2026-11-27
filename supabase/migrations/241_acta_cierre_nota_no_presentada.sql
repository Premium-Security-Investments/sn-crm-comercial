-- 241 — Acta de cierre: la nota de una licitación «no presentada» (Juan, 2026-11-26: «quiero que valide si se están
-- haciendo las actas de cierre y que todo esté bien»).
--
-- `psi_tender_closure_note` buscaba la nota de la transición de estado sólo en «adjudicada» y «no adjudicada». La
-- licitación que se cierra como «no presentada» también deja su nota en la transición (SIC 23 de 2026, 26-oct-2026),
-- pero la función devolvía null y el barrido semanal (`psi_list_tender_closure_acta_pending`, que exige nota) la saltaba:
-- SIC 23 quedó sin acta. Se agrega «no_presentada» a la lista; nada más cambia.
begin;

create or replace function public.psi_tender_closure_note(p_opportunity_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_opportunity public.psi_sales_opportunities%rowtype;
  v_note text;
begin
  select * into v_opportunity from public.psi_sales_opportunities where id = p_opportunity_id;
  if not found then return null; end if;

  v_note := nullif(btrim(coalesce(v_opportunity.archive_note, '')), '');
  if v_note is not null then return jsonb_build_object('note', v_note, 'source', 'archive_note'); end if;

  select nullif(btrim(coalesce(t.note, '')), '') into v_note
  from public.psi_tender_offer_status_transitions t
  where t.opportunity_id = p_opportunity_id and t.to_status in ('adjudicada', 'no_adjudicada', 'no_presentada') and nullif(btrim(coalesce(t.note, '')), '') is not null
  order by t.changed_at desc, t.id desc limit 1;
  if v_note is not null then return jsonb_build_object('note', v_note, 'source', 'status_transition'); end if;

  select nullif(btrim(coalesce(d.justification, '')), '') into v_note
  from public.psi_tender_go_no_go_decisions d
  where d.opportunity_id = p_opportunity_id and d.decision = 'no_go' and nullif(btrim(coalesce(d.justification, '')), '') is not null
    and not exists (select 1 from public.psi_tender_go_no_go_decisions child where child.supersedes_decision_id = d.id)
  order by d.decided_at desc, d.id desc limit 1;
  if v_note is not null then return jsonb_build_object('note', v_note, 'source', 'no_go_justification'); end if;

  return null;
end;
$function$;

-- Misma firma: conserva los permisos de la 134; se reafirman por claridad.
revoke all on function public.psi_tender_closure_note(uuid) from public, anon, authenticated, service_role;
grant execute on function public.psi_tender_closure_note(uuid) to service_role;

commit;
