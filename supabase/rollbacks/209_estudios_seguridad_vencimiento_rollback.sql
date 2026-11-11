-- Rollback de 209: se pierden la frecuencia de renovación y los pedidos de revaloración de cada estudio.
begin;

alter table public.psi_security_studies
  drop column if exists revaluation_note,
  drop column if exists revaluation_requested_at,
  drop column if exists renewal_months;

commit;
