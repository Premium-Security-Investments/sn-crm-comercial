-- Rollback de 187: quita la caracterización de la sede y los campos nuevos del riesgo.
--
-- PIERDE DATOS: contexto, estadística, contactos, dispositivo, proceso del cliente, factor de riesgo y el propósito
-- de los adjuntos (los mapas y logos quedan como evidencias generales). Las versiones ya aprobadas no cambian: su foto
-- JSON conserva lo que tenían.
begin;

drop table if exists public.psi_security_study_posts;
drop table if exists public.psi_security_study_contacts;
drop table if exists public.psi_security_study_crime_stats;
alter table public.psi_security_study_evidence drop column if exists purpose;
alter table public.psi_security_studies
  drop column if exists client_description, drop column if exists location_description, drop column if exists latitude,
  drop column if exists longitude, drop column if exists external_context, drop column if exists criminal_groups,
  drop column if exists internal_context, drop column if exists context_sources;
alter table public.psi_security_study_risks drop column if exists client_process, drop column if exists risk_factor;

commit;
