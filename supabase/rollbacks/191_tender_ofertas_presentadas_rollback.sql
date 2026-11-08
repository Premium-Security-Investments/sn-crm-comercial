-- Reversa de la 191. Respaldar antes lo registrado (select * de las tres tablas): se pierde. Las licitaciones que
-- quedaron «presentada», «adjudicada» o «no adjudicada» conservan su estado y su bitácora; si alguna pasó directo de
-- «en preparación» a «presentada», la restricción vieja no se puede volver a poner y la reversa lo dice.
begin;
drop function if exists public.psi_set_tender_offer_goal(uuid, integer, numeric);
drop function if exists public.psi_register_tender_offer_result(uuid, uuid, jsonb);
drop function if exists public.psi_register_tender_offer_submission(uuid, uuid, jsonb);
drop function if exists public.psi_lock_tender_offer_with_go(uuid);
drop function if exists public.psi_assert_tender_offer_record_actor(uuid);
drop table if exists public.psi_tender_offer_goals;
drop table if exists public.psi_tender_offer_results;
drop table if exists public.psi_tender_offer_submissions;
drop function if exists public.psi_tender_offer_records_append_only();
alter table public.psi_tender_offer_status_transitions drop constraint if exists psi_tender_offer_status_transitions_valid_edge;
alter table public.psi_tender_offer_status_transitions add constraint psi_tender_offer_status_transitions_valid_edge check (
  (from_status = 'en_preparacion' and to_status = 'lista_para_presentar')
  or (from_status = 'lista_para_presentar' and to_status = 'presentada')
  or (from_status = 'presentada' and to_status in ('adjudicada', 'no_adjudicada'))
);
commit;
