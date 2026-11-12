-- Estudios de Seguridad Física: recorrido guiado (Juan, 2026-11-12: "puede definir un listado de preguntas que al ser
-- respondidas permiten generar un estudio muy completo").
--
-- Las preguntas viven en verticales/estudios-seguridad/preguntas.js (lista de verificación y "¿qué pasaría si…?" de la
-- IEC 31010). Aquí sólo se guardan las respuestas de cada estudio: sí, no o no aplica en las de verificación; el
-- análisis escrito en los escenarios. Con ellas la plataforma propone riesgos; no califica.
begin;

create table if not exists public.psi_security_study_answers (
  study_id uuid not null references public.psi_security_studies(id) on delete cascade,
  question_code text not null check (question_code ~ '^[A-Z]{3}-[0-9]{2}$'),
  value text check (value is null or value in ('si', 'no', 'na')),
  note text check (note is null or length(note) <= 2000),
  answered_by uuid not null references public.psi_sales_profiles(id),
  answered_at timestamptz not null default now(),
  primary key (study_id, question_code),
  constraint psi_security_study_answers_not_empty check (value is not null or (note is not null and length(btrim(note)) >= 3))
);

alter table public.psi_security_study_answers enable row level security;
revoke all on public.psi_security_study_answers from public, anon, authenticated;
grant select, insert, update, delete on public.psi_security_study_answers to service_role;

commit;
