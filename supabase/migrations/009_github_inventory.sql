-- GitHub repository inventory for agent architecture.
-- No tokens or secrets are stored here.

create table if not exists public.agent_inventory_github_repos (
  id uuid primary key default gen_random_uuid(),
  full_name text not null unique,
  html_url text,
  default_branch text,
  is_private boolean,
  archived boolean,
  disabled boolean,
  pushed_at timestamptz,
  updated_at_github timestamptz,
  branches_sample text,
  branches_count_returned int,
  workflows_count int,
  api_error text,
  workflows_sample jsonb,
  inventory_status text not null default 'partial' check (inventory_status in ('complete','partial','blocked','unknown')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.agent_inventory_github_repos enable row level security;

do $$ begin
  create policy agent_inventory_github_repos_read on public.agent_inventory_github_repos for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy agent_inventory_github_repos_admin on public.agent_inventory_github_repos for all to authenticated
  using (public.psi_sales_current_profile_role() in ('director','gerencia','admin'))
  with check (public.psi_sales_current_profile_role() in ('director','gerencia','admin'));
exception when duplicate_object then null; end $$;

grant select on public.agent_inventory_github_repos to authenticated;
grant insert, update, delete on public.agent_inventory_github_repos to authenticated;

insert into public.agent_inventory_systems (slug, name, context, owner_label, system_type, status, criticality, description, canonical_url, notes)
values ('github-repos', 'GitHub repos', 'Arquitectura agentes / código', 'Juan Botero / GitHub owners', 'code_hosting', 'active', 'high', 'Inventario de repos GitHub relevantes para agentes, SN CRM, Lelion, Unlocked y skills.', 'https://github.com/', 'Inventario parcial por API sin gh CLI instalado.')
on conflict (slug) do update set name=excluded.name, context=excluded.context, owner_label=excluded.owner_label, system_type=excluded.system_type, status=excluded.status, criticality=excluded.criticality, description=excluded.description, canonical_url=excluded.canonical_url, notes=excluded.notes, updated_at=now();

insert into public.agent_inventory_github_repos (full_name, html_url, default_branch, is_private, archived, disabled, pushed_at, updated_at_github, branches_sample, branches_count_returned, workflows_count, api_error, workflows_sample, inventory_status, notes)
values
('jmb-max/seguridad-nacional-crm', 'https://github.com/jmb-max/seguridad-nacional-crm', 'main', true, false, false, '2026-06-25T01:03:44Z', '2026-06-25T01:03:49Z', 'feature/alerts-banner-filter-tabs,feature/clickable-dashboard-kpis,feature/compact-alerts-hero,feature/compact-dashboard-hero,feature/compact-tenders-hero,feature/design-integration-v2,feature/design-tokens-safe,feature/manager-banner-kpi-highlight,feature/readable-crm-tables,feature/remove-duplicate-alert-filters,main,rollback/pre-visual-v2-2026-06-11', '12', '0', null, '[]', 'partial', 'Inventario API parcial 2026-06-30; gh CLI no instalado.'),
('jmb-max/psi-comercial', null, null, null, null, null, null, null, 'main', '1', '1', '401', '[{"name": "pages-build-deployment", "state": "active", "path": "dynamic/pages/pages-build-deployment"}]', 'blocked', 'Inventario API parcial 2026-06-30; gh CLI no instalado.'),
('jmb-max/juan-skills-hub', 'https://github.com/jmb-max/juan-skills-hub', 'main', true, false, false, '2026-05-27T16:51:37Z', '2026-05-27T16:51:58Z', 'main', '1', '0', null, '[]', 'partial', 'Inventario API parcial 2026-06-30; gh CLI no instalado.'),
('jmb-max/lelion-ai-platform', 'https://github.com/jmb-max/lelion-ai-platform', 'main', true, false, false, '2026-06-03T02:24:43Z', '2026-06-03T02:24:47Z', 'main', '1', '0', null, '[]', 'partial', 'Inventario API parcial 2026-06-30; gh CLI no instalado.'),
('jmb-max/juanbot-memory-fabric', 'https://github.com/jmb-max/juanbot-memory-fabric', 'main', true, false, false, '2026-06-08T17:08:23Z', '2026-06-08T17:08:28Z', 'main', '1', null, '401', '[]', 'blocked', 'Inventario API parcial 2026-06-30; gh CLI no instalado.'),
('josenaicipa/torre-de-control', null, null, null, null, null, null, null, 'feat/operaciones-catalog-ui,feat/operaciones-catalogo-discoverable,feat/operaciones-enrollment-sale-api,feat/operaciones-product-catalog-api,feat/operaciones-student-create-product-flow,feat/operaciones-student-products-ui,feature/cartera-import-ui,feature/cartera-por-estudiante-redesign,feature/import-cartera-legacy,feature/integrate-sidebar,feature/operaciones-avances,feature/operaciones-closer-and-installments,feature/operaciones-edit-payments-schedule,feature/operaciones-iframe-embed,feature/operaciones-integration,feature/operaciones-metricas,feature/operaciones-module,feature/operaciones-pagos,feature/operaciones-sprint-1,feature/operaciones-student-products-base', '36', '6', '401', '[{"name": "Deploy Torre de Control (ECS/Fargate)", "state": "active", "path": ".github/workflows/deploy-ecs.yml"}, {"name": "Import Torre dashboard payload", "state": "active", "path": ".github/workflows/import-dashboard-payload.yml"}, {"name": "Query June 8 closer agendas", "state": "active", "path": ".github/workflows/query-june8-closers.yml"}, {"name": "Reset Comunidad Dropi data (DESTRUCTIVE, manual)", "state": "active", "path": ".github/workflows/reset-comunidad-dropi-data.yml"}, {"name": "Torre v2 Verify", "state": "active", "path": ".github/workflows/torre-v2-verify.yml"}, {"name": "Verify Torre dashboard data", "state": "active", "path": ".github/workflows/verify-dashboard-data.yml"}]', 'blocked', 'Inventario API parcial 2026-06-30; gh CLI no instalado.'),
('jmb-max/noxguard-control', 'https://github.com/jmb-max/noxguard-control', 'main', false, false, false, '2026-05-30T23:57:58Z', '2026-05-30T23:58:02Z', 'main', '1', '0', null, '[]', 'partial', 'Inventario API parcial 2026-06-30; gh CLI no instalado.')
on conflict (full_name) do update set
  html_url=excluded.html_url,
  default_branch=excluded.default_branch,
  is_private=excluded.is_private,
  archived=excluded.archived,
  disabled=excluded.disabled,
  pushed_at=excluded.pushed_at,
  updated_at_github=excluded.updated_at_github,
  branches_sample=excluded.branches_sample,
  branches_count_returned=excluded.branches_count_returned,
  workflows_count=excluded.workflows_count,
  api_error=excluded.api_error,
  workflows_sample=excluded.workflows_sample,
  inventory_status=excluded.inventory_status,
  notes=excluded.notes,
  updated_at=now();

insert into public.agent_inventory_risks (system_id, risk_title, risk_level, status, owner_label, recommended_action, notes)
select s.id, v.risk_title, v.risk_level, v.status, v.owner_label, v.recommended_action, v.notes
from (values
  ('github-repos','Instalar/autenticar gh CLI para inventario GitHub completo','medium','open','Juan/Hermes','Instalar gh o proveer token con scopes repo/workflow/read:org para inventario de permissions, secrets, Actions, PRs e issues','Actualmente hay git credential store pero gh no está instalado; algunas APIs retornaron 401.'),
  ('github-repos','Rotar token GitHub encontrado embebido en remote histórico','high','open','Juan/Hermes','Rotar el token GitHub que estaba embebido en /root/lelion-whatsapp-agent origin y limpiar credenciales antiguas','Remote local ya fue limpiado, pero el token pudo quedar expuesto en logs/historial.')
) as v(system_slug, risk_title, risk_level, status, owner_label, recommended_action, notes)
join public.agent_inventory_systems s on s.slug=v.system_slug
where not exists (select 1 from public.agent_inventory_risks r where r.system_id=s.id and r.risk_title=v.risk_title);

update public.agent_inventory_risks r
set status='resolved', notes=coalesce(r.notes,'') || ' Confirmado bucket tender-documents privado, 20MB.', updated_at=now()
from public.agent_inventory_systems s
where r.system_id=s.id and s.slug='supabase-sn-psi' and r.risk_title='Confirmar buckets Supabase';
