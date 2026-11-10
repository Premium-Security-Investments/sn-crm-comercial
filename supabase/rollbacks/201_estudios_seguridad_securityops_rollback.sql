-- Rollback de 201: el estudio deja de vincularse a SecurityOps.
--
-- Los riesgos que salieron de una alerta de SecurityOps se conservan como 'manual' (pierden la referencia a la alerta);
-- se borra lo traído de SecurityOps y el directorio de puestos, que se vuelven a traer si se reaplica.
begin;

alter table public.psi_security_study_risks drop constraint if exists psi_security_study_risks_source_consistency;
update public.psi_security_study_risks set origin = 'manual' where origin = 'securityops';
alter table public.psi_security_study_risks drop column if exists source_ref;
alter table public.psi_security_study_risks drop constraint if exists psi_security_study_risks_origin_check;
alter table public.psi_security_study_risks add constraint psi_security_study_risks_origin_check
  check (origin in ('manual', 'agente'));

drop table if exists public.psi_security_study_securityops;
alter table public.psi_security_studies
  drop column if exists securityops_requested_at,
  drop column if exists securityops_puesto_id;
drop table if exists public.psi_securityops_puestos;

commit;
