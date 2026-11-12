-- 215 — «Lo que nos inhabilita» (Juan, 2026-11-12): la pestaña «Requisitos» muestra sólo los HECHOS que nos faltan y
-- exigen un trámite (sede o sucursal, códigos del RUP, telecomunicaciones nacional, registro de importador o
-- comercializador, sede canina, indicadores financieros, certificaciones, horas extras), para que Katherine decida si se
-- inicia el trámite. Los papeles que se renuevan salen: garantía de seriedad, certificados y personal ya no son grupos.
-- Estados: por decidir, iniciar trámite, en trámite, resuelto, no por ahora. Las claves son las de REQUIREMENT_FOCUS en
-- verticales/licitaciones/requirement-catalog.js.
begin;

alter table public.psi_tender_requirement_focus drop constraint if exists psi_tender_requirement_focus_focus_key_check;
alter table public.psi_tender_requirement_focus drop constraint if exists psi_tender_requirement_focus_status_check;
delete from public.psi_tender_requirement_focus where focus_key in ('seriedad', 'certificados', 'licencias_especiales', 'personal_local');
update public.psi_tender_requirement_focus set status = case status when 'pendiente' then 'por_decidir' when 'en_tramite' then 'en_tramite' else 'resuelto' end
  where status not in ('por_decidir', 'iniciar', 'en_tramite', 'resuelto', 'no_por_ahora');
alter table public.psi_tender_requirement_focus alter column status set default 'por_decidir';
alter table public.psi_tender_requirement_focus add constraint psi_tender_requirement_focus_focus_key_check
  check (focus_key in ('presencia', 'codigos', 'comunicaciones', 'importador', 'canino', 'financiero', 'certificaciones', 'horas_extras'));
alter table public.psi_tender_requirement_focus add constraint psi_tender_requirement_focus_status_check
  check (status in ('por_decidir', 'iniciar', 'en_tramite', 'resuelto', 'no_por_ahora'));

insert into public.psi_tender_requirement_focus (focus_key, owner) values
  ('comunicaciones', 'Katherine'), ('importador', 'Katherine'), ('canino', 'Katherine'), ('certificaciones', 'Katherine'), ('horas_extras', 'Katherine')
on conflict (focus_key) do nothing;

commit;
