-- Rollback de 212: los estudios dejan de apuntar a su estudio anterior (las versiones aprobadas conservan la comparación
-- que congelaron).
begin;

alter table public.psi_security_studies drop constraint if exists psi_security_studies_previous_not_self;
alter table public.psi_security_studies drop column if exists previous_study_id;

commit;
