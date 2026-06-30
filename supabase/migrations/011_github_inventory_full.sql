-- Complete GitHub inventory after gh CLI auth.
alter table public.agent_inventory_github_repos add column if not exists visibility text;
alter table public.agent_inventory_github_repos add column if not exists language text;
alter table public.agent_inventory_github_repos add column if not exists default_branch_protected boolean;
alter table public.agent_inventory_github_repos add column if not exists secrets_count int;
alter table public.agent_inventory_github_repos add column if not exists secrets_names_sample text;
alter table public.agent_inventory_github_repos add column if not exists open_prs_count int;
alter table public.agent_inventory_github_repos add column if not exists open_issues_count int;
alter table public.agent_inventory_github_repos add column if not exists collaborators_count_returned int;
alter table public.agent_inventory_github_repos add column if not exists collaborators_sample jsonb;

insert into public.agent_inventory_github_repos (
  full_name, html_url, default_branch, is_private, archived, disabled, pushed_at, updated_at_github,
  branches_sample, branches_count_returned, workflows_count, api_error, workflows_sample, inventory_status, notes,
  visibility, language, default_branch_protected, secrets_count, secrets_names_sample, open_prs_count, open_issues_count,
  collaborators_count_returned, collaborators_sample
)
values
('jmb-max/seguridad-nacional-crm', 'https://github.com/jmb-max/seguridad-nacional-crm', 'main', true, false, false, '2026-06-25T01:03:44Z', '2026-06-25T01:03:49Z', 'feature/alerts-banner-filter-tabs,feature/clickable-dashboard-kpis,feature/compact-alerts-hero,feature/compact-dashboard-hero,feature/compact-tenders-hero,feature/design-integration-v2,feature/design-tokens-safe,feature/manager-banner-kpi-highlight,feature/readable-crm-tables,feature/remove-duplicate-alert-filters,main,rollback/pre-visual-v2-2026-06-11', '12', '0', null, '[]', 'complete', 'Inventario completo vía gh 2026-06-30', 'private', 'TypeScript', false, '0', '', '0', '0', '1', '[{"login": "jmb-max", "role_name": "admin"}]'),
('jmb-max/psi-comercial', 'https://github.com/jmb-max/psi-comercial', 'main', false, false, false, '2026-05-06T21:15:59Z', '2026-05-06T21:16:03Z', 'main', '1', '1', null, '[{"name": "pages-build-deployment", "state": "active", "path": "dynamic/pages/pages-build-deployment"}]', 'complete', 'Inventario completo vía gh 2026-06-30', 'public', 'HTML', false, '0', '', '0', '0', '1', '[{"login": "jmb-max", "role_name": "admin"}]'),
('jmb-max/juan-skills-hub', 'https://github.com/jmb-max/juan-skills-hub', 'main', true, false, false, '2026-05-27T16:51:37Z', '2026-05-27T16:51:58Z', 'main', '1', '0', null, '[]', 'complete', 'Inventario completo vía gh 2026-06-30', 'private', 'Python', false, '0', '', '0', '0', '1', '[{"login": "jmb-max", "role_name": "admin"}]'),
('jmb-max/lelion-ai-platform', 'https://github.com/jmb-max/lelion-ai-platform', 'main', true, false, false, '2026-06-03T02:24:43Z', '2026-06-03T02:24:47Z', 'main', '1', '0', null, '[]', 'complete', 'Inventario completo vía gh 2026-06-30', 'private', 'Python', false, '0', '', '0', '0', '1', '[{"login": "jmb-max", "role_name": "admin"}]'),
('jmb-max/juanbot-memory-fabric', 'https://github.com/jmb-max/juanbot-memory-fabric', 'main', true, false, false, '2026-06-08T17:08:23Z', '2026-06-08T17:08:28Z', 'main', '1', '1', null, '[{"name": "CI", "state": "active", "path": ".github/workflows/ci.yml"}]', 'complete', 'Inventario completo vía gh 2026-06-30', 'private', 'Python', false, '0', '', '0', '0', '1', '[{"login": "jmb-max", "role_name": "admin"}]'),
('josenaicipa/torre-de-control', 'https://github.com/josenaicipa/torre-de-control', 'main', false, false, false, '2026-06-30T19:49:51Z', '2026-06-30T19:49:55Z', 'feat/operaciones-catalog-ui,feat/operaciones-catalogo-discoverable,feat/operaciones-enrollment-sale-api,feat/operaciones-product-catalog-api,feat/operaciones-student-create-product-flow,feat/operaciones-student-products-ui,feature/cartera-import-ui,feature/cartera-por-estudiante-redesign,feature/import-cartera-legacy,feature/integrate-sidebar,feature/operaciones-avances,feature/operaciones-closer-and-installments,feature/operaciones-edit-payments-schedule,feature/operaciones-iframe-embed,feature/operaciones-integration,feature/operaciones-metricas,feature/operaciones-module,feature/operaciones-pagos,feature/operaciones-sprint-1,feature/operaciones-student-products-base,fix/cartera-action-button-contrast,fix/cartera-contrast-soft-colors,fix/cookie-samesite-iframe,fix/ecs-deploy-on-main-push,fix/operaciones-auto-product-slug,fix/operaciones-catalogo-sidebar,fix/operaciones-controlled-payment-accounts,fix/operaciones-product-migration,fix/operaciones-spanish-copy,fix/operaciones-tailwind,fix/payment-totals-include-standalone,fix/post-login-redirect-and-collector,fix/sidebar-visual-match,main,refactor/mentor-as-user,refactor/remove-program-table', '36', '6', null, '[{"name": "Deploy Torre de Control (ECS/Fargate)", "state": "active", "path": ".github/workflows/deploy-ecs.yml"}, {"name": "Import Torre dashboard payload", "state": "active", "path": ".github/workflows/import-dashboard-payload.yml"}, {"name": "Query June 8 closer agendas", "state": "active", "path": ".github/workflows/query-june8-closers.yml"}, {"name": "Reset Comunidad Dropi data (DESTRUCTIVE, manual)", "state": "active", "path": ".github/workflows/reset-comunidad-dropi-data.yml"}, {"name": "Torre v2 Verify", "state": "active", "path": ".github/workflows/torre-v2-verify.yml"}, {"name": "Verify Torre dashboard data", "state": "active", "path": ".github/workflows/verify-dashboard-data.yml"}]', 'complete', 'Inventario completo vía gh 2026-06-30', 'public', 'TypeScript', false, '8', 'AWS_ACCESS_KEY_ID,AWS_SECRET_ACCESS_KEY,LW_ACCESS_TOKEN,LW_BASE_URL,LW_CLIENT_ID,N8N_TORRE_CONTRACT_DRIVE_WEBHOOK_URL,N8N_TORRE_LW_ACCESS_WEBHOOK_URL,N8N_TORRE_WEBHOOK_SECRET', '0', '0', '3', '[{"login": "josenaicipa", "role_name": "admin"}, {"login": "jmb-max", "role_name": "admin"}, {"login": "christian-naicipa", "role_name": "write"}]'),
('jmb-max/noxguard-control', 'https://github.com/jmb-max/noxguard-control', 'main', false, false, false, '2026-05-30T23:57:58Z', '2026-05-30T23:58:02Z', 'main', '1', '0', null, '[]', 'complete', 'Inventario completo vía gh 2026-06-30', 'public', 'TypeScript', false, '0', '', '0', '0', '1', '[{"login": "jmb-max", "role_name": "admin"}]')
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
  visibility=excluded.visibility,
  language=excluded.language,
  default_branch_protected=excluded.default_branch_protected,
  secrets_count=excluded.secrets_count,
  secrets_names_sample=excluded.secrets_names_sample,
  open_prs_count=excluded.open_prs_count,
  open_issues_count=excluded.open_issues_count,
  collaborators_count_returned=excluded.collaborators_count_returned,
  collaborators_sample=excluded.collaborators_sample,
  updated_at=now();

update public.agent_inventory_risks r
set status='resolved', notes=coalesce(r.notes,'') || ' gh CLI instalado y autenticado; inventario GitHub completado vía API para repos conocidos.', updated_at=now()
from public.agent_inventory_systems s
where r.system_id=s.id and s.slug='github-repos' and r.risk_title='Instalar/autenticar gh CLI para inventario GitHub completo';

insert into public.agent_inventory_checks (system_id, check_name, check_type, status, last_checked_at, evidence, notes)
select s.id, 'github gh inventory completed', 'github_api', 'passing', now(), 'gh authenticated with repo/workflow/read:org; 7 repos inventoried', 'Migration 011'
from public.agent_inventory_systems s
where s.slug='github-repos'
  and not exists (select 1 from public.agent_inventory_checks c where c.system_id=s.id and c.check_name='github gh inventory completed');
