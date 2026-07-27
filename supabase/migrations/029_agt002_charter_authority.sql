begin;

-- AGT-002 Charter: custody is an explicit, assignable capability.  It is never
-- inferred from role or email and this migration intentionally assigns it to no
-- profile; Admin must designate the current Tender Custodian explicitly.
insert into public.psi_access_permissions (code, name, description, active)
values (
  'licitaciones_custodia',
  'Custodia de Licitaciones',
  'Autoridad exclusiva para convertir detecciones y aprobar perfiles, reglas y fuentes corporativas de Licitaciones.',
  true
)
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    active = true;

create or replace function public.psi_profile_has_tender_custody(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.psi_sales_profiles p
    where p.id = p_profile_id
      and p.active = true
      and coalesce(p.identity_type, 'human') = 'human'
      and exists (
        select 1
        from public.psi_profile_permissions pp
        join public.psi_access_permissions ap
          on ap.code = pp.permission_code and ap.active = true
        where pp.profile_id = p.id
          and pp.permission_code = 'licitaciones'
      )
      and exists (
        select 1
        from public.psi_profile_permissions pp
        join public.psi_access_permissions ap
          on ap.code = pp.permission_code and ap.active = true
        where pp.profile_id = p.id
          and pp.permission_code = 'licitaciones_custodia'
      )
  );
$$;

revoke all on function public.psi_profile_has_tender_custody(uuid) from public;
revoke all on function public.psi_profile_has_tender_custody(uuid) from anon;
revoke all on function public.psi_profile_has_tender_custody(uuid) from authenticated;
grant execute on function public.psi_profile_has_tender_custody(uuid) to service_role;

create or replace function public.psi_upsert_company_procurement_profile(
  p_actor_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not public.psi_profile_has_tender_custody(p_actor_id) then
    raise exception 'Licitation custody permission required.' using errcode = '42501';
  end if;

  insert into public.psi_company_procurement_profile (
    singleton_key, legal_name, nit, rup_status, rup_updated_at,
    rup_unspsc_codes, authorized_services, supervigilancia_license,
    financial_capacity, organizational_capacity, experience_summary,
    certifications, recurring_documents, disqualifications_notes,
    useful_company_info, source_document_name, rup_import_notes, updated_by
  ) values (
    'seguridad_nacional', nullif(p_payload ->> 'legal_name', ''), nullif(p_payload ->> 'nit', ''),
    nullif(p_payload ->> 'rup_status', ''), nullif(p_payload ->> 'rup_updated_at', '')::date,
    nullif(p_payload ->> 'rup_unspsc_codes', ''), nullif(p_payload ->> 'authorized_services', ''),
    nullif(p_payload ->> 'supervigilancia_license', ''), nullif(p_payload ->> 'financial_capacity', ''),
    nullif(p_payload ->> 'organizational_capacity', ''), nullif(p_payload ->> 'experience_summary', ''),
    nullif(p_payload ->> 'certifications', ''), nullif(p_payload ->> 'recurring_documents', ''),
    nullif(p_payload ->> 'disqualifications_notes', ''), nullif(p_payload ->> 'useful_company_info', ''),
    nullif(p_payload ->> 'source_document_name', ''), nullif(p_payload ->> 'rup_import_notes', ''), p_actor_id
  )
  on conflict (singleton_key) do update set
    legal_name = excluded.legal_name,
    nit = excluded.nit,
    rup_status = excluded.rup_status,
    rup_updated_at = excluded.rup_updated_at,
    rup_unspsc_codes = excluded.rup_unspsc_codes,
    authorized_services = excluded.authorized_services,
    supervigilancia_license = excluded.supervigilancia_license,
    financial_capacity = excluded.financial_capacity,
    organizational_capacity = excluded.organizational_capacity,
    experience_summary = excluded.experience_summary,
    certifications = excluded.certifications,
    recurring_documents = excluded.recurring_documents,
    disqualifications_notes = excluded.disqualifications_notes,
    useful_company_info = excluded.useful_company_info,
    source_document_name = excluded.source_document_name,
    rup_import_notes = excluded.rup_import_notes,
    updated_by = excluded.updated_by
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.psi_upsert_company_procurement_profile(uuid, jsonb) from public;
revoke all on function public.psi_upsert_company_procurement_profile(uuid, jsonb) from anon;
revoke all on function public.psi_upsert_company_procurement_profile(uuid, jsonb) from authenticated;
grant execute on function public.psi_upsert_company_procurement_profile(uuid, jsonb) to service_role;

-- Converge the already-installed transactional conversion RPC without copying
-- its large business body.  Fail migration if the expected authorization hook
-- is absent so an unknown definition can never be weakened silently.
do $$
declare
  v_proc regprocedure := to_regprocedure('public.psi_convert_tender_to_opportunity(uuid,uuid,text,text,uuid,text,text,numeric,date,text,text,text,text,text,text,timestamptz)');
  v_definition text;
begin
  if v_proc is null then
    raise exception 'Falta psi_convert_tender_to_opportunity; aplica primero 018 y 020.';
  end if;
  v_definition := pg_get_functiondef(v_proc);
  if position('public.psi_profile_has_tender_permission(p.id, true)' in v_definition) = 0 then
    raise exception 'La autorización esperada de conversión cambió; revisión manual requerida.';
  end if;
  v_definition := replace(
    v_definition,
    'public.psi_profile_has_tender_permission(p.id, true)',
    'public.psi_profile_has_tender_custody(p.id)'
  );
  execute v_definition;
  execute format('revoke all on function %s from public', v_proc);
  execute format('revoke all on function %s from anon', v_proc);
  execute format('revoke all on function %s from authenticated', v_proc);
  execute format('grant execute on function %s to service_role', v_proc);
end;
$$;

-- Corporate evidence registration also enforces custody inside the RPC, not
-- only in Express.  The replacement is guarded and aborts on schema drift.
do $$
declare
  v_proc regprocedure := to_regprocedure('public.psi_record_company_procurement_document(text,text,date,date,text,text,text,bigint,uuid,uuid)');
  v_definition text;
  v_actor_predicate text := 'and coalesce(p.identity_type, ''human'') = ''human''';
begin
  if v_proc is null then
    raise exception 'Falta psi_record_company_procurement_document; aplica primero 026.';
  end if;
  v_definition := pg_get_functiondef(v_proc);
  if position(v_actor_predicate in v_definition) = 0 then
    raise exception 'La autorización esperada de documentos corporativos cambió; revisión manual requerida.';
  end if;
  v_definition := replace(
    v_definition,
    v_actor_predicate,
    v_actor_predicate || E'\n      and public.psi_profile_has_tender_custody(p.id)'
  );
  execute v_definition;
  execute format('revoke all on function %s from public', v_proc);
  execute format('revoke all on function %s from anon', v_proc);
  execute format('revoke all on function %s from authenticated', v_proc);
  execute format('grant execute on function %s to service_role', v_proc);
end;
$$;

commit;
