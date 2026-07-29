-- Hotfix idempotente de ACL para bases de datos PRE-045 (en vivo).
--
-- Contexto: la migración 040 creó public.psi_project_tender_dossier_artifact(uuid) sin
-- endurecer su ACL, dejándola con la ACL por defecto de PostgreSQL (proacl NULL => EXECUTE
-- implícito de PUBLIC). La migración 045 corrige el defecto, pero una base PRE-045 sigue
-- expuesta hasta aplicarla. Este remedio cierra ÚNICAMENTE ese hueco, sin tocar nada más.
--
-- Alcance mínimo: sólo psi_project_tender_dossier_artifact(uuid). No crea/borra objetos,
-- no toca tablas, ni AGT-002/AGT-003, ni kill switches, ni el bridge/modelo.
-- Idempotente: revoke/grant pueden reejecutarse sin efecto adicional.
-- Falla cerrado: aborta si la función objetivo no existe (no crea una ACL sobre la nada).
begin;

do $$
begin
  if to_regprocedure('public.psi_project_tender_dossier_artifact(uuid)') is null then
    raise exception using errcode='42883',
      message = 'Hotfix abortado (fail closed): public.psi_project_tender_dossier_artifact(uuid) no existe en esta base.';
  end if;
end $$;

revoke all on function public.psi_project_tender_dossier_artifact(uuid) from public, anon, authenticated;
grant execute on function public.psi_project_tender_dossier_artifact(uuid) to service_role;

commit;
