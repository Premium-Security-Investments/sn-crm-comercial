-- Estudios de Seguridad Física: comparación con el estudio anterior (Juan, 2026-11-12: "vamos adelante").
--
-- Héctor Martínez (reunión del 2026-11-11): quien revisa "hace un comparativo con el estudio anterior: qué riesgos y
-- cómo se movieron". Cada estudio puede apuntar al estudio anterior de la misma sede; al crearlo se toma solo el último
-- aprobado del mismo cliente y sede. La comparación se calcula en verticales/estudios-seguridad/comparacion.js.
begin;

alter table public.psi_security_studies
  add column if not exists previous_study_id uuid references public.psi_security_studies(id) on delete set null;
alter table public.psi_security_studies drop constraint if exists psi_security_studies_previous_not_self;
alter table public.psi_security_studies add constraint psi_security_studies_previous_not_self check (previous_study_id is null or previous_study_id <> id);

commit;
