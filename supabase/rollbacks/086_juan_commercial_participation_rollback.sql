begin;

-- Existing opportunities remain assigned; this rollback only removes the explicit
-- owner capability and therefore hides non-comercial owners from new assignments.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'psi_sales_profiles'
      and column_name = 'can_own_opportunities'
  ) then
    execute $sql$
      update public.psi_sales_profiles
      set can_own_opportunities = false
      where lower(btrim(microsoft_email)) = 'juanbotero@premiumsecurity.ai'
        and active = true
        and coalesce(identity_type, 'human') = 'human'
    $sql$;
  end if;
end
$$;

alter table public.psi_sales_profiles
  drop column if exists can_own_opportunities;

commit;
