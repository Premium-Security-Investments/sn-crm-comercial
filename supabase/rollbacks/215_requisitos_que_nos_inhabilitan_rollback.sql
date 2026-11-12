-- Reversa de la 215: vuelve a los siete focos de la 210 (se pierde lo escrito en los grupos nuevos).
begin;
alter table public.psi_tender_requirement_focus drop constraint if exists psi_tender_requirement_focus_focus_key_check;
alter table public.psi_tender_requirement_focus drop constraint if exists psi_tender_requirement_focus_status_check;
delete from public.psi_tender_requirement_focus where focus_key in ('comunicaciones', 'importador', 'canino', 'certificaciones', 'horas_extras');
update public.psi_tender_requirement_focus set status = case status when 'por_decidir' then 'pendiente' when 'iniciar' then 'pendiente' when 'no_por_ahora' then 'pendiente' else status end;
alter table public.psi_tender_requirement_focus alter column status set default 'pendiente';
alter table public.psi_tender_requirement_focus add constraint psi_tender_requirement_focus_focus_key_check check (focus_key in ('presencia', 'financiero', 'codigos', 'seriedad', 'certificados', 'licencias_especiales', 'personal_local'));
alter table public.psi_tender_requirement_focus add constraint psi_tender_requirement_focus_status_check check (status in ('pendiente', 'en_tramite', 'resuelto'));
commit;
