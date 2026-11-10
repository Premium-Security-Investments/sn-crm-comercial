-- Reversa de la 202: quita las lecturas del pliego para uniones temporales (se vuelven a hacer solas al aplicarla).
begin;
drop table if exists public.psi_tender_plural_readings;
commit;
