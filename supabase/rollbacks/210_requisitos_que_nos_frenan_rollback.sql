-- Reversa de la 210: quita el estado de «lo que nos frena». El catálogo no tiene tabla y no se toca.
begin;
drop table if exists public.psi_tender_requirement_focus;
commit;
