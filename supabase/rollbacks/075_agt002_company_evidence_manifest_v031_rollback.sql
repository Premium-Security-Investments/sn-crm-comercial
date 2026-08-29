begin;

-- Rollback for 075: deactivates the 17 current v0.3.1-approved-20260829 rows and
-- restores the 17 v0.2-provisional-20260801 rows to current=true. Append-only,
-- mirroring 075 and 061's own discipline: no row is ever deleted or rewritten, only
-- the `current` flag moves, so the v0.3.1 rows this migration produced remain in the
-- table (inactive) for a safe reapply. Fail-closed: if any of the 17 entries' current
-- row belongs to neither v0.2-provisional-20260801 nor v0.3.1-approved-20260829, this
-- refuses to touch anything, so a foreign/future manifest version promoted after 075
-- is never silently time-traveled over by blindly restoring v0.2.
do $$
declare
  v_entry_ids constant text[] := array[
    'supervigilancia_operating_license', 'rup', 'rut', 'communications_license',
    'uniforms_resolution', 'no_fines_sanctions_certificate', 'authorized_weapons_list',
    'rce_policy', 'collective_life_policy', 'accredited_experience',
    'financial_and_tax_pack', 'bank_certificate', 'overtime_authorization',
    'corporate_background_checks', 'legal_representative_vault',
    'personnel_credentials_vault', 'differential_scoring_support'
  ];
  v_bad_count integer;
begin
  select count(*) into v_bad_count
  from public.psi_agt002_company_evidence_registry
  where current
    and entry_id = any(v_entry_ids)
    and source_manifest_version not in ('v0.2-provisional-20260801', 'v0.3.1-approved-20260829');

  if v_bad_count > 0 then
    raise exception 'psi_agt002_company_evidence_registry: % current row(s) for the AGT-002 17-class manifest carry an unexpected source_manifest_version — refusing to roll back 075 to avoid time-traveling over an unknown/foreign/future manifest version.', v_bad_count;
  end if;

  update public.psi_agt002_company_evidence_registry
  set current = false
  where current
    and version = 2
    and source_manifest_version = 'v0.3.1-approved-20260829'
    and entry_id = any(v_entry_ids);

  update public.psi_agt002_company_evidence_registry
  set current = true
  where current = false
    and version = 1
    and source_manifest_version = 'v0.2-provisional-20260801'
    and entry_id = any(v_entry_ids);
end $$;

commit;
