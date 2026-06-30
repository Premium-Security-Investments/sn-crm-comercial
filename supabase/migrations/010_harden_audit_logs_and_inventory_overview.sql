-- Harden opportunity audit log exposure and add agent inventory overview view.
-- Backend writes audit logs with SUPABASE_SERVICE_ROLE_KEY, so anon/authenticated do not need broad write access.

-- Remove overly broad policy created in 006.
drop policy if exists "psi_sales_opportunity_audit_logs_service_all" on public.psi_sales_opportunity_audit_logs;

-- Revoke broad grants from API roles. service_role keeps explicit access; postgres remains owner-level.
revoke all on table public.psi_sales_opportunity_audit_logs from anon;
revoke all on table public.psi_sales_opportunity_audit_logs from authenticated;
grant select, insert, update, delete on table public.psi_sales_opportunity_audit_logs to service_role;

-- Authenticated users may read audit logs only when they can see the related opportunity.
grant select on table public.psi_sales_opportunity_audit_logs to authenticated;

do $$ begin
  create policy "psi_sales_opportunity_audit_logs_select_scoped"
    on public.psi_sales_opportunity_audit_logs
    for select
    to authenticated
    using (
      exists (
        select 1
        from public.psi_sales_opportunities o
        where o.id = psi_sales_opportunity_audit_logs.opportunity_id
          and (
            o.owner_id = public.psi_sales_current_profile_id()
            or public.psi_sales_current_profile_role() = any (array['director','gerencia','admin'])
          )
      )
    );
exception when duplicate_object then null;
end $$;

-- No direct authenticated insert/update/delete policy: writes happen server-side with service_role.

-- Useful single view for quick inventory overview in Supabase/CRM dashboards.
create or replace view public.v_agent_inventory_overview as
select
  s.id as system_id,
  s.slug as system_slug,
  s.name as system_name,
  s.context,
  s.system_type,
  s.status as system_status,
  s.criticality,
  s.canonical_url,
  s.canonical_path,
  count(distinct svc.id) as services_count,
  count(distinct i.id) filter (where i.status = 'active') as active_integrations_count,
  count(distinct b.id) as discord_bots_count,
  count(distinct r.id) filter (where r.status in ('open','in_progress')) as open_risks_count,
  count(distinct c.id) filter (where c.status = 'passing') as passing_checks_count,
  count(distinct c.id) filter (where c.status in ('failing','warning')) as failing_or_warning_checks_count,
  s.updated_at
from public.agent_inventory_systems s
left join public.agent_inventory_services svc on svc.system_id = s.id
left join public.agent_inventory_integrations i on i.source_system_id = s.id or i.target_system_id = s.id
left join public.agent_inventory_discord_bots b on b.system_id = s.id
left join public.agent_inventory_risks r on r.system_id = s.id
left join public.agent_inventory_checks c on c.system_id = s.id
group by s.id;

grant select on public.v_agent_inventory_overview to authenticated;

-- Update risk records.
update public.agent_inventory_risks r
set status='resolved',
    notes=coalesce(r.notes,'') || ' Policy amplia removida; anon/authenticated broad grants revocados; select autenticado quedó acotado por oportunidad/rol; writes vía service_role.',
    updated_at=now()
from public.agent_inventory_systems s
where r.system_id=s.id
  and s.slug='supabase-sn-psi'
  and r.risk_title='Auditar policy agent/audit logs amplia';

insert into public.agent_inventory_checks (system_id, check_name, check_type, status, last_checked_at, evidence, notes)
select s.id, 'audit logs policy hardened', 'sql_security', 'passing', now(), 'psi_sales_opportunity_audit_logs_service_all dropped; scoped select policy created; anon grants revoked', 'Migration 010'
from public.agent_inventory_systems s
where s.slug='supabase-sn-psi'
  and not exists (
    select 1 from public.agent_inventory_checks c where c.system_id=s.id and c.check_name='audit logs policy hardened'
  );
