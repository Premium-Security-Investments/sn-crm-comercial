-- Estudios de Seguridad Física: estudios incorporados de una matriz anterior (Juan, 2026-11-17: "vamos adelante").
--
-- Un estudio que ya existía en Excel (p. ej. PCP, febrero de 2025) se carga, una persona lo revisa y lo aprueba en la
-- plataforma, y desde ahí se renueva. Su vigencia no se cuenta desde esa aprobación sino desde la fecha del estudio
-- original: PCP vence en febrero de 2027, no dos años después de aprobarlo aquí.
--   original_study_date   la fecha del estudio original; vacío = estudio hecho en la plataforma.
begin;

alter table public.psi_security_studies
  add column if not exists original_study_date date;

comment on column public.psi_security_studies.original_study_date is
  'Fecha del estudio original cuando el estudio se incorporó de una matriz anterior; la vigencia se cuenta desde aquí.';

commit;
