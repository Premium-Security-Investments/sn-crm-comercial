-- Rollback operativo de 026_tender_document_versions.
-- Orden seguro: ejecute DESPUÉS del rollback de 027 (LIFO) y sólo tras
-- desplegar código que no dependa de las RPC de documentos versionados.
-- Conserva evidencia: no elimina psi_company_procurement_documents ni
-- psi_tender_document_versions; sólo retira la capacidad de escritura de
-- las RPC nuevas. psi_is_public_https_url permanece intocada porque una
-- restricción CHECK de psi_tender_document_versions depende de ella.
begin;

do $$
begin
  if to_regclass('public.psi_sales_profiles') is null
     or to_regclass('public.psi_sales_opportunities') is null
     or to_regclass('public.psi_public_tenders') is null then
    raise exception 'Rollback 026 requiere las relaciones base de licitaciones y perfiles.';
  end if;
  if to_regclass('public.psi_company_procurement_documents') is null
     or to_regclass('public.psi_tender_document_versions') is null then
    raise exception 'Rollback 026 requiere que 026 esté aplicada.';
  end if;
  -- psi_tender_document_state and its triggers are never dropped (027's
  -- rollback keeps them for audit/compatibility), so LIFO order cannot be
  -- checked via their presence. The 8-argument overloads 027 introduces are
  -- unconditionally dropped by 027's rollback, so their absence is the
  -- reliable signal that 027 was reverted first.
  if to_regprocedure('public.psi_record_tender_document_snapshot(uuid,uuid,text,text,jsonb,jsonb,uuid,uuid)') is not null
     or to_regprocedure('public.psi_record_tender_go_no_go(uuid,uuid,uuid,text,uuid,text,jsonb,text)') is not null then
    raise exception 'Rollback 026 requiere ejecutar primero el rollback de 027 (persisten firmas RPC de 027).';
  end if;
end;
$$;

revoke all on function public.psi_record_company_procurement_document(text, text, date, date, text, text, text, bigint, uuid, uuid) from service_role;
revoke all on function public.psi_record_tender_document_version(uuid, uuid, text, text, text, text, text, text, bigint, text, text, text, uuid) from service_role;

commit;
