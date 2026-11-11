-- Estudios de Seguridad Física: calificación según IEC 31010 (Juan, 2026-11-11: "vamos a regirnos por la norma").
--
-- La norma pide que cada probabilidad tenga un significado definido y un respaldo, que se declaren la incertidumbre y
-- los supuestos, y que el juicio experto se contraste con datos. Cada riesgo guarda:
--   suggested_probability   la probabilidad que sugerían los datos al guardar (estadística de la zona y SecurityOps);
--                           null = no había datos ("juicio sin dato").
--   probability_basis       por qué el analista escogió esa probabilidad; obligatoria si se aparta de la sugerida.
--   confidence              alta, media o baja: qué tan seguro está el analista de la calificación.
--   assumptions             los supuestos de la calificación (p. ej. "el CCTV graba 30 días").
begin;

alter table public.psi_security_study_risks
  add column if not exists suggested_probability smallint check (suggested_probability is null or suggested_probability between 1 and 5),
  add column if not exists probability_basis text check (probability_basis is null or length(probability_basis) <= 1000),
  add column if not exists confidence text check (confidence is null or confidence in ('alta', 'media', 'baja')),
  add column if not exists assumptions text check (assumptions is null or length(assumptions) <= 2000);

commit;
