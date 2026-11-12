-- Rollback de 214: se pierden las respuestas del recorrido guiado (las versiones aprobadas conservan las que congelaron).
begin;

drop table if exists public.psi_security_study_answers;

commit;
