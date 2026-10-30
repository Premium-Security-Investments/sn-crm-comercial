-- Rollback de 135: devuelve las dos funciones a la definición de la 134, sin
-- search_path fijo. Sólo tiene sentido si se revierte también la 134.
begin;

create or replace function public.psi_tender_closure_kind(p_opportunity public.psi_sales_opportunities)
returns text language sql immutable as $$
  select case
    when p_opportunity.archived_at is not null then 'archivada'
    when coalesce(p_opportunity.tender_offer_status, 'pendiente_decision') in ('cerrada_no_go', 'adjudicada', 'no_adjudicada') then p_opportunity.tender_offer_status
    else null
  end;
$$;

create or replace function public.psi_tender_closure_acta_events_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'El historial del acta de cierre es inmutable.';
end;
$$;

commit;
