-- Reversa de la 218: quita los bloqueos anotados y los cuatro grupos nuevos (se pierde lo escrito en ellos).
begin;
drop table if exists public.psi_tender_requirement_blocks;
delete from public.psi_tender_requirement_focus where focus_key in ('experiencia', 'personal', 'armas', 'red_apoyo');
alter table public.psi_tender_requirement_focus drop constraint if exists psi_tender_requirement_focus_focus_key_check;
alter table public.psi_tender_requirement_focus add constraint psi_tender_requirement_focus_focus_key_check
  check (focus_key in ('presencia', 'codigos', 'comunicaciones', 'importador', 'canino', 'financiero', 'certificaciones', 'horas_extras'));
commit;
