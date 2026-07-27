begin;

drop function if exists public.psi_upsert_company_procurement_profile(uuid, jsonb);

-- Restore the pre-029 authorization hooks.  This rollback removes any explicit
-- custody assignments because the permission catalog row cannot be removed
-- while referenced.
do $$
declare
  v_proc regprocedure := to_regprocedure('public.psi_convert_tender_to_opportunity(uuid,uuid,text,text,uuid,text,text,numeric,date,text,text,text,text,text,text,timestamptz)');
  v_definition text;
begin
  if v_proc is not null then
    v_definition := pg_get_functiondef(v_proc);
    if position('public.psi_profile_has_tender_custody(p.id)' in v_definition) > 0 then
      v_definition := replace(
        v_definition,
        'public.psi_profile_has_tender_custody(p.id)',
        'public.psi_profile_has_tender_permission(p.id, true)'
      );
      execute v_definition;
      execute format('revoke all on function %s from public', v_proc);
      execute format('revoke all on function %s from anon', v_proc);
      execute format('revoke all on function %s from authenticated', v_proc);
      execute format('grant execute on function %s to service_role', v_proc);
    end if;
  end if;
end;
$$;

do $$
declare
  v_proc regprocedure := to_regprocedure('public.psi_record_company_procurement_document(text,text,date,date,text,text,text,bigint,uuid,uuid)');
  v_definition text;
  v_custody_predicate text := E'\n      and public.psi_profile_has_tender_custody(p.id)';
begin
  if v_proc is not null then
    v_definition := pg_get_functiondef(v_proc);
    if position(v_custody_predicate in v_definition) > 0 then
      v_definition := replace(v_definition, v_custody_predicate, '');
      execute v_definition;
      execute format('revoke all on function %s from public', v_proc);
      execute format('revoke all on function %s from authenticated', v_proc);
      execute format('revoke all on function %s from anon', v_proc);
      execute format('grant execute on function %s to service_role', v_proc);
    end if;
  end if;
end;
$$;

delete from public.psi_profile_permissions where permission_code = 'licitaciones_custodia';
delete from public.psi_access_permissions where code = 'licitaciones_custodia';
drop function if exists public.psi_profile_has_tender_custody(uuid);

commit;
