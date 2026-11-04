-- Rollback de 176: quita la función. Los avisos ya publicados se quedan: son mensajes del hilo y el hilo es append-only.
begin;
drop function if exists public.psi_post_agt002_workbench_failure_notice(uuid, uuid, text);
commit;
