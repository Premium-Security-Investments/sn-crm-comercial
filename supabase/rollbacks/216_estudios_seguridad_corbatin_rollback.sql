-- Rollback de 216: se pierden los datos de cada control y el dueño de cada riesgo.
begin;

alter table public.psi_security_study_risks
  drop column if exists risk_owner,
  drop column if exists control_details;

commit;
