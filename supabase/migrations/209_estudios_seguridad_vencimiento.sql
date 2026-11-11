-- Estudios de Seguridad Física: vencimiento y revaloración (Juan, 2026-11-11: "vamos adelante").
--
-- Héctor Martínez (reunión del 2026-11-11): los estudios se renuevan como mínimo cada 6 meses y como máximo cada 3 años
-- (normativo BASC/OEA: cada 6 meses o cada año; por procedimiento: cada 2 años; puestos no críticos: cada 3), y antes si
-- cambian las instalaciones o hay un siniestro. Cada estudio guarda su frecuencia; la fecha de vencimiento se calcula
-- con la aprobación de la última versión. La revaloración la puede pedir una persona (cambio de instalaciones) o la
-- señalan las novedades graves de SecurityOps posteriores a la aprobación (verticales/estudios-seguridad/vigencia.js).
begin;

alter table public.psi_security_studies
  add column if not exists renewal_months smallint not null default 24 check (renewal_months in (6, 12, 24, 36)),
  add column if not exists revaluation_requested_at timestamptz,
  add column if not exists revaluation_note text check (revaluation_note is null or length(revaluation_note) between 3 and 1000);

commit;
