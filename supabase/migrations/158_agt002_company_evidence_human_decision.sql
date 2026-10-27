-- 158 — La manija de la puerta humana del registro de evidencia empresarial.
--
-- La migración 061 creó `psi_agt002_company_evidence_registry` con tres dimensiones de
-- estado separadas a propósito y dejó dicho en su encabezado: "no RPC is added here —
-- this hotfix only ingests the 17 currently active entries, it does not build a write
-- path for future revisions". Por eso, desde el 2026-08-29, las 17 fichas vigentes siguen
-- en `pending_human_review` con `decision_humana` nulo: la puerta existe y no tiene por
-- dónde abrirse. Esta migración completa esa decisión de diseño; no la revierte.
--
-- Qué se conserva de 061:
--   * `service_role` sigue SIN escritura sobre la fila completa. El grant de abajo es por
--     columna y cubre sólo las de la decisión humana.
--   * Los CHECK de 061 siguen mandando: `existence_status = 'verified'`, o cualquier
--     `human_review_status` distinto de `pending_human_review`, siguen exigiendo
--     `decision_humana` y `decision_humana_fecha`.
--   * No se habilita escritura de `applicability_status`: la aplicabilidad a un caso es
--     por proceso, no un hecho de empresa, y 061 la separó para que nadie las confunda.
--   * `vigente_para_habilitacion` tampoco se abre: lo fija el manifiesto, no la revisión.
--
-- Qué agrega: `decision_humana_por`. 061 dejó `created_by` y la fecha de la decisión, pero
-- no un autor de la decisión, así que el "quién decidió" no tenía dónde vivir.

alter table public.psi_agt002_company_evidence_registry
  add column if not exists decision_humana_por uuid references public.psi_sales_profiles(id) on delete restrict;

comment on column public.psi_agt002_company_evidence_registry.decision_humana_por is
  'Persona que registró la decisión humana sobre la ficha. Nulo mientras siga en pending_human_review.';

-- Una decisión registrada nombra a quien la tomó. Las 34 filas existentes (17 vigentes y
-- 17 superadas) tienen `decision_humana` nulo, así que la restricción entra sin reparar nada.
alter table public.psi_agt002_company_evidence_registry
  drop constraint if exists psi_agt002_company_evidence_registry_decision_autor_chk;
alter table public.psi_agt002_company_evidence_registry
  add constraint psi_agt002_company_evidence_registry_decision_autor_chk
  check (decision_humana is null or decision_humana_por is not null);

-- La manija: escritura por columna, no por fila. Leer sigue siendo lo único que
-- `service_role` puede hacer con el resto del registro.
grant update (
  existence_status,
  human_review_status,
  decision_humana,
  decision_humana_fecha,
  estado_posterior_decision,
  decision_humana_por
) on table public.psi_agt002_company_evidence_registry to service_role;
