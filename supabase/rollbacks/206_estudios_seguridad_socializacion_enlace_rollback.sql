-- Rollback de 206: se pierden las socializaciones registradas y todos los enlaces para clientes dejan de funcionar.
begin;

drop table if exists public.psi_security_study_share_views;
drop table if exists public.psi_security_study_shares;
drop table if exists public.psi_security_study_deliveries;

commit;
