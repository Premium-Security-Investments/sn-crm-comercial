-- Rollback de 134_tender_closure_acta.sql.
-- Atención: borra las actas de cierre y su historial inmutable.
begin;

drop function if exists public.psi_reopen_tender_closure_acta(uuid, uuid, timestamptz);
drop function if exists public.psi_confirm_tender_closure_acta(uuid, uuid, timestamptz);
drop function if exists public.psi_upsert_tender_closure_acta(uuid, uuid, jsonb, timestamptz);
drop function if exists public.psi_get_tender_closure_acta(uuid);
drop function if exists public.psi_tender_closure_acta_snapshot(uuid);
drop function if exists public.psi_tender_closure_note(uuid);
drop function if exists public.psi_tender_closure_kind(public.psi_sales_opportunities);

drop trigger if exists psi_tender_closure_acta_events_immutable on public.psi_tender_closure_acta_events;
drop table if exists public.psi_tender_closure_acta_events;
drop function if exists public.psi_tender_closure_acta_events_prevent_mutation();
drop table if exists public.psi_tender_closure_acta_reason;
drop table if exists public.psi_tender_closure_acta;

commit;
