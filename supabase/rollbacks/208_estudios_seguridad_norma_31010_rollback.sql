-- Rollback de 208: se pierden la probabilidad sugerida, la justificación, la confianza y los supuestos de cada riesgo.
begin;

alter table public.psi_security_study_risks
  drop column if exists assumptions,
  drop column if exists confidence,
  drop column if exists probability_basis,
  drop column if exists suggested_probability;

commit;
