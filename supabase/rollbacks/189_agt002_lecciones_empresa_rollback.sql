-- Reversa de la 189: quita las funciones, la vista, la tabla de lecciones y el permiso para aprobarlas. Las lecciones
-- registradas se pierden; respaldarlas antes (select * from psi_tender_lessons) si hay alguna.
begin;
drop function if exists public.psi_decide_tender_lesson(uuid, text, integer, text, text);
drop function if exists public.psi_propose_tender_lesson(uuid, jsonb, boolean);
drop view if exists public.psi_tender_lessons_current;
drop table if exists public.psi_tender_lessons;
drop function if exists public.psi_tender_lessons_append_only();
drop function if exists public.psi_profile_can_approve_tender_lessons(uuid);
delete from public.psi_profile_permissions where permission_code = 'licitaciones_lecciones';
delete from public.psi_access_permissions where code = 'licitaciones_lecciones';
commit;
