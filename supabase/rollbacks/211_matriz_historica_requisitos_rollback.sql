-- Reversa de la 211: quita la copia de la matriz histórica. El Excel de SharePoint no se toca.
begin;
drop table if exists public.psi_tender_requirement_history;
commit;
