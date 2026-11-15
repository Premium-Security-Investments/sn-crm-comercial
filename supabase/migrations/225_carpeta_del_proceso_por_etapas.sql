-- 225 — La carpeta del proceso en SharePoint, por etapas (Juan, 2026-11-15: «las carpetas se van a tener que crear antes
-- de pasar a GO, pues algunas cosas las hacemos en pasos previos, por ejemplo en prepliego»).
--
-- La carpeta de radicación (203) se creaba entera con el GO. Ahora en dos momentos:
--   - al entrar el proceso al CRM (origen 'ingreso', etapa 'observaciones'): sólo 01_Observaciones/Proyecto y /Definitivo;
--   - con el GO (o el botón), la misma fila pasa a etapa 'completa': Borradores, PARA_RADICAR, Radicado y Competidores.
-- Las filas que ya existían eran la carpeta completa: por eso el valor por defecto.

begin;

alter table public.psi_tender_filing_folders
  add column if not exists etapa text not null default 'completa';
alter table public.psi_tender_filing_folders drop constraint if exists psi_tender_filing_folders_etapa_check;
alter table public.psi_tender_filing_folders
  add constraint psi_tender_filing_folders_etapa_check check (etapa in ('observaciones', 'completa'));
alter table public.psi_tender_filing_folders drop constraint if exists psi_tender_filing_folders_origin_check;
alter table public.psi_tender_filing_folders
  add constraint psi_tender_filing_folders_origin_check check (origin in ('go', 'boton', 'ingreso'));

commit;
