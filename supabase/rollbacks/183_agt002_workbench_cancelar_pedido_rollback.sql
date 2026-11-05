-- Reversa de la 183: quita la cancelación. Los eventos de cancelados que ya existan se conservan (son historia).
begin;
drop function if exists public.psi_cancel_agt002_workbench_job(uuid,uuid,uuid,text);
commit;
