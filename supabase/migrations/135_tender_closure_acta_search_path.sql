-- Corrección de la 134: dos funciones quedaron con search_path mutable y el
-- advisor de Supabase las marcó (function_search_path_mutable). Con search_path
-- mutable, quien pueda crear objetos en un esquema del search_path del llamador
-- podría suplantar una función o un operador dentro del cuerpo. Las demás
-- funciones del acta ya lo fijaban.
begin;

create or replace function public.psi_tender_closure_kind(p_opportunity public.psi_sales_opportunities)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case
    when p_opportunity.archived_at is not null then 'archivada'
    when coalesce(p_opportunity.tender_offer_status, 'pendiente_decision') in ('cerrada_no_go', 'adjudicada', 'no_adjudicada') then p_opportunity.tender_offer_status
    else null
  end;
$$;

create or replace function public.psi_tender_closure_acta_events_prevent_mutation()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'El historial del acta de cierre es inmutable.';
end;
$$;

commit;
