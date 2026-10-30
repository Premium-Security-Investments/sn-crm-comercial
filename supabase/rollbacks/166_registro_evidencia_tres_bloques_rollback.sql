-- Revierte 166. Cierra los tres bloques; no borra nada.
--
-- La reversa del registro es **desactivar**, no eliminar: la propia fila lo declara con
-- `rollback_can_deactivate = true` y `rollback_scope = 'entry_id'`, y la 061 dejó el registro sin DELETE para la
-- aplicación justo para que un bloque no desaparezca sin rastro. Con `integration_active = false` la pantalla de
-- Empresa deja de ofrecer el bloque (`loadCompanyBase` filtra por `current` e `integration_active`), y la fila
-- conserva su historia y cualquier decisión humana que se haya registrado.
--
-- Los documentos cargados en esos bloques NO se tocan: viven en `psi_company_procurement_documents` y siguen ahí, con
-- su tipo, su versión y su hash. Lo único que se pierde es la posibilidad de cargar más en ellos.
begin;
update public.psi_agt002_company_evidence_registry
set integration_active = false
where entry_id in ('quality_certifications', 'agency_authorizations', 'chamber_of_commerce');
commit;
