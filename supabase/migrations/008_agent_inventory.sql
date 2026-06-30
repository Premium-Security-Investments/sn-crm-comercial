-- Agent architecture inventory for Juan/Hermes control plane.
-- No secrets/tokens are stored here; only references and operational metadata.

create extension if not exists pgcrypto;

create table if not exists public.agent_inventory_systems (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  context text,
  owner_label text,
  system_type text not null default 'system',
  status text not null default 'active' check (status in ('active','planned','paused','deprecated','unknown')),
  criticality text not null default 'medium' check (criticality in ('low','medium','high','critical')),
  description text,
  canonical_url text,
  canonical_path text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_inventory_services (
  id uuid primary key default gen_random_uuid(),
  system_id uuid references public.agent_inventory_systems(id) on delete cascade,
  slug text not null unique,
  service_name text not null,
  service_type text not null,
  host text,
  runtime text,
  status text not null default 'active' check (status in ('active','planned','paused','deprecated','unknown')),
  restart_command text,
  health_check text,
  logs_command text,
  canonical_path text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_inventory_integrations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  source_system_id uuid references public.agent_inventory_systems(id) on delete set null,
  target_system_id uuid references public.agent_inventory_systems(id) on delete set null,
  integration_type text not null,
  status text not null default 'active' check (status in ('active','planned','paused','deprecated','unknown')),
  auth_type text,
  credential_ref text,
  risk_level text not null default 'medium' check (risk_level in ('low','medium','high','critical')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_inventory_discord_bots (
  id uuid primary key default gen_random_uuid(),
  system_id uuid references public.agent_inventory_systems(id) on delete set null,
  bot_name text not null,
  bot_id text unique,
  guild_id text,
  allowed_channels text[] default '{}',
  free_response_channels text[] default '{}',
  mention_required boolean not null default true,
  role_label text,
  status text not null default 'active' check (status in ('active','planned','paused','deprecated','unknown')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_inventory_risks (
  id uuid primary key default gen_random_uuid(),
  system_id uuid references public.agent_inventory_systems(id) on delete set null,
  risk_title text not null,
  risk_level text not null default 'medium' check (risk_level in ('low','medium','high','critical')),
  status text not null default 'open' check (status in ('open','in_progress','accepted','resolved','cancelled')),
  owner_label text,
  recommended_action text,
  due_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_inventory_checks (
  id uuid primary key default gen_random_uuid(),
  system_id uuid references public.agent_inventory_systems(id) on delete set null,
  service_id uuid references public.agent_inventory_services(id) on delete set null,
  check_name text not null,
  check_type text not null default 'manual',
  status text not null default 'unknown' check (status in ('passing','failing','warning','unknown')),
  last_checked_at timestamptz,
  evidence text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.agent_inventory_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'agent_inventory_systems',
    'agent_inventory_services',
    'agent_inventory_integrations',
    'agent_inventory_discord_bots',
    'agent_inventory_risks',
    'agent_inventory_checks'
  ] loop
    execute format('drop trigger if exists trg_%I_updated_at on public.%I', t, t);
    execute format('create trigger trg_%I_updated_at before update on public.%I for each row execute function public.agent_inventory_set_updated_at()', t, t);
  end loop;
end $$;

alter table public.agent_inventory_systems enable row level security;
alter table public.agent_inventory_services enable row level security;
alter table public.agent_inventory_integrations enable row level security;
alter table public.agent_inventory_discord_bots enable row level security;
alter table public.agent_inventory_risks enable row level security;
alter table public.agent_inventory_checks enable row level security;

-- Service role bypasses RLS. For authenticated users, keep this inventory readable and editable only by admin/director/gerencia profiles.
do $$ begin
  create policy agent_inventory_systems_read on public.agent_inventory_systems for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy agent_inventory_services_read on public.agent_inventory_services for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy agent_inventory_integrations_read on public.agent_inventory_integrations for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy agent_inventory_discord_bots_read on public.agent_inventory_discord_bots for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy agent_inventory_risks_read on public.agent_inventory_risks for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy agent_inventory_checks_read on public.agent_inventory_checks for select to authenticated using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy agent_inventory_systems_admin on public.agent_inventory_systems for all to authenticated
  using (public.psi_sales_current_profile_role() in ('director','gerencia','admin'))
  with check (public.psi_sales_current_profile_role() in ('director','gerencia','admin'));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy agent_inventory_services_admin on public.agent_inventory_services for all to authenticated
  using (public.psi_sales_current_profile_role() in ('director','gerencia','admin'))
  with check (public.psi_sales_current_profile_role() in ('director','gerencia','admin'));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy agent_inventory_integrations_admin on public.agent_inventory_integrations for all to authenticated
  using (public.psi_sales_current_profile_role() in ('director','gerencia','admin'))
  with check (public.psi_sales_current_profile_role() in ('director','gerencia','admin'));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy agent_inventory_discord_bots_admin on public.agent_inventory_discord_bots for all to authenticated
  using (public.psi_sales_current_profile_role() in ('director','gerencia','admin'))
  with check (public.psi_sales_current_profile_role() in ('director','gerencia','admin'));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy agent_inventory_risks_admin on public.agent_inventory_risks for all to authenticated
  using (public.psi_sales_current_profile_role() in ('director','gerencia','admin'))
  with check (public.psi_sales_current_profile_role() in ('director','gerencia','admin'));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy agent_inventory_checks_admin on public.agent_inventory_checks for all to authenticated
  using (public.psi_sales_current_profile_role() in ('director','gerencia','admin'))
  with check (public.psi_sales_current_profile_role() in ('director','gerencia','admin'));
exception when duplicate_object then null; end $$;

grant select on public.agent_inventory_systems, public.agent_inventory_services, public.agent_inventory_integrations, public.agent_inventory_discord_bots, public.agent_inventory_risks, public.agent_inventory_checks to authenticated;
grant insert, update, delete on public.agent_inventory_systems, public.agent_inventory_services, public.agent_inventory_integrations, public.agent_inventory_discord_bots, public.agent_inventory_risks, public.agent_inventory_checks to authenticated;

-- Seed core systems.
insert into public.agent_inventory_systems (slug, name, context, owner_label, system_type, status, criticality, description, canonical_url, canonical_path, notes) values
('hermes-gateway', 'Hermes Gateway', 'Arquitectura agentes / Juan Bot', 'Juan Botero', 'agent_orchestrator', 'active', 'critical', 'Gateway Hermes multi-plataforma y orquestador técnico principal de Juan.', null, '/usr/local/lib/hermes-agent', 'Discord require_mention=true global; free-response solo Home.'),
('claudesdk-discord-agent', 'ClaudeSDK Discord Agent', 'Servidor Discord Claude SDK', 'Juan Botero', 'agent', 'active', 'high', 'Agente independiente usando Claude Agent SDK; no es otro Hermes.', null, '/root/claude-discord-agent', 'Corre en Hetzner como systemd service.'),
('sn-crm', 'SN CRM', 'Seguridad Nacional / PSI', 'Juan Botero / SN', 'application', 'active', 'high', 'CRM comercial Seguridad Nacional con radar SECOP.', 'https://seguridad-nacional-crm.vercel.app/', '/root/psi-comercial/plataforma-ventas/app', 'Repo jmb-max/seguridad-nacional-crm.'),
('supabase-sn-psi', 'Supabase SN/PSI', 'Seguridad Nacional / PSI', 'Juan Botero / SN', 'database', 'active', 'critical', 'Proyecto Supabase operativo-comercial: CRM, radar SECOP, operación/NoxGuard.', 'https://tyfzjqzcpgwcjnxozaaf.supabase.co', null, 'Project ref tyfzjqzcpgwcjnxozaaf; no guardar secretos aquí.'),
('vercel-sn-crm', 'Vercel SN CRM', 'Seguridad Nacional / PSI', 'jmb-maxs-projects', 'deployment_platform', 'active', 'high', 'Proyecto Vercel que despliega SN CRM.', 'https://seguridad-nacional-crm.vercel.app/', null, 'Project ID prj_hkYsEhUANH7v4NAvxnDYZfWLjLNc.'),
('hetzner-funnelly-agent-1', 'Hetzner funnelly-agent-1', 'Infra Hermes', 'Juan Botero', 'server', 'active', 'critical', 'Servidor Hetzner que ejecuta Hermes gateway y ClaudeSDK agent.', null, null, 'Ubuntu 24.04.3; IPv4 5.78.140.24; IPv6 2a01:4ff:1f0:ef98::1.'),
('google-drive-agentes-ia', 'Google Drive Agentes IA', 'Arquitectura agentes', 'jmb@valienta.com', 'documentation_store', 'active', 'high', 'Drive/Docs canónico para manual narrativo de arquitectura de agentes.', 'https://drive.google.com/drive/folders/17BhtI2AczgKYg3IAUKKf1K72v7pf2EN1', null, 'Google API/OAuth project arquitectura-agentes-ia.')
on conflict (slug) do update set
  name=excluded.name, context=excluded.context, owner_label=excluded.owner_label, system_type=excluded.system_type,
  status=excluded.status, criticality=excluded.criticality, description=excluded.description,
  canonical_url=excluded.canonical_url, canonical_path=excluded.canonical_path, notes=excluded.notes, updated_at=now();

-- Seed services.
insert into public.agent_inventory_services (system_id, slug, service_name, service_type, host, runtime, status, restart_command, health_check, logs_command, canonical_path, notes)
select s.id, v.slug, v.service_name, v.service_type, v.host, v.runtime, v.status, v.restart_command, v.health_check, v.logs_command, v.canonical_path, v.notes
from (values
  ('hermes-gateway','hermes-gateway-service','hermes-gateway.service','systemd','funnelly-agent-1','Python / Hermes Agent','active','systemctl restart hermes-gateway','systemctl is-active hermes-gateway','journalctl -u hermes-gateway -n 80 --no-pager','/usr/local/lib/hermes-agent','Gateway multi-plataforma.'),
  ('claudesdk-discord-agent','claude-discord-agent-service','claude-discord-agent.service','systemd','funnelly-agent-1','Node.js / npm / Claude Agent SDK','active','systemctl restart claude-discord-agent.service','systemctl is-active claude-discord-agent.service','journalctl -u claude-discord-agent.service -n 80 --no-pager','/root/claude-discord-agent','Bot ClaudeSDK conectado a Discord.'),
  ('sn-crm','sn-crm-vercel-production','seguridad-nacional-crm production deploy','vercel','Vercel','Vite / React / Express serverless','active','vercel --prod','vercel inspect seguridad-nacional-crm.vercel.app','vercel logs seguridad-nacional-crm.vercel.app','/root/psi-comercial/plataforma-ventas/app','Deployment dpl_6yQ7hKgXLcCz6FEHqJ9Ubzio9KS1 Ready.')
) as v(system_slug, slug, service_name, service_type, host, runtime, status, restart_command, health_check, logs_command, canonical_path, notes)
join public.agent_inventory_systems s on s.slug=v.system_slug
on conflict (slug) do update set
  system_id=excluded.system_id, service_name=excluded.service_name, service_type=excluded.service_type, host=excluded.host,
  runtime=excluded.runtime, status=excluded.status, restart_command=excluded.restart_command,
  health_check=excluded.health_check, logs_command=excluded.logs_command, canonical_path=excluded.canonical_path, notes=excluded.notes, updated_at=now();

-- Seed integrations.
insert into public.agent_inventory_integrations (slug, source_system_id, target_system_id, integration_type, status, auth_type, credential_ref, risk_level, notes)
select v.slug, src.id, tgt.id, v.integration_type, v.status, v.auth_type, v.credential_ref, v.risk_level, v.notes
from (values
  ('hermes-to-discord','hermes-gateway',null,'discord_gateway','active','bot_token','/root/.hermes/.env DISCORD_TOKEN','high','Hermes responde libremente solo en Home; por mención en Claude SDK server.'),
  ('claudesdk-to-discord','claudesdk-discord-agent',null,'discord_bot','active','bot_token','/root/claude-discord-agent/.env DISCORD_TOKEN','high','Token debe rotarse por haber sido compartido durante setup.'),
  ('claudesdk-to-claude-oauth','claudesdk-discord-agent',null,'claude_agent_sdk','active','oauth','Claude OAuth/Claude Max local credentials','medium','No usa API key Anthropic directa.'),
  ('sn-crm-to-supabase','sn-crm','supabase-sn-psi','database','active','supabase_anon_service_role','Vercel env + local .env.local','critical','Service role solo server-side.'),
  ('sn-crm-to-vercel','sn-crm','vercel-sn-crm','deployment','active','vercel_auth','Vercel CLI/auth local','medium','Project seguridad-nacional-crm.'),
  ('hermes-to-google-drive-agentes-ia','hermes-gateway','google-drive-agentes-ia','google_drive_docs','active','oauth','/root/.hermes/profiles/juan-general/google_token.json','medium','Documentación canónica Agentes IA.')
) as v(slug, source_slug, target_slug, integration_type, status, auth_type, credential_ref, risk_level, notes)
left join public.agent_inventory_systems src on src.slug=v.source_slug
left join public.agent_inventory_systems tgt on tgt.slug=v.target_slug
on conflict (slug) do update set
  source_system_id=excluded.source_system_id, target_system_id=excluded.target_system_id, integration_type=excluded.integration_type,
  status=excluded.status, auth_type=excluded.auth_type, credential_ref=excluded.credential_ref,
  risk_level=excluded.risk_level, notes=excluded.notes, updated_at=now();

-- Seed Discord bots.
insert into public.agent_inventory_discord_bots (system_id, bot_name, bot_id, guild_id, allowed_channels, free_response_channels, mention_required, role_label, status, notes)
select s.id, v.bot_name, v.bot_id, v.guild_id, v.allowed_channels, v.free_response_channels, v.mention_required, v.role_label, v.status, v.notes
from (values
  ('claudesdk-discord-agent','ClaudeSDK','1521525614627000430','1521509145696538724',array['1521509146137198707','1521535674568933427'],array['1521509146137198707','1521535674568933427'],false,'Agente principal del servidor Claude SDK','active','Responde en #general y #optimizaciones.'),
  ('hermes-gateway','Hermes',null,null,array[]::text[],array['1500633796712726670'],true,'Orquestador técnico / soporte por mención','active','En servidor Claude SDK no debe competir; solo responder por mención.')
) as v(system_slug, bot_name, bot_id, guild_id, allowed_channels, free_response_channels, mention_required, role_label, status, notes)
join public.agent_inventory_systems s on s.slug=v.system_slug
on conflict (bot_id) do update set
  system_id=excluded.system_id, bot_name=excluded.bot_name, guild_id=excluded.guild_id,
  allowed_channels=excluded.allowed_channels, free_response_channels=excluded.free_response_channels,
  mention_required=excluded.mention_required, role_label=excluded.role_label, status=excluded.status, notes=excluded.notes, updated_at=now();

-- Seed risks.
insert into public.agent_inventory_risks (system_id, risk_title, risk_level, status, owner_label, recommended_action, notes)
select s.id, v.risk_title, v.risk_level, v.status, v.owner_label, v.recommended_action, v.notes
from (values
  ('claudesdk-discord-agent','Rotar token Discord ClaudeSDK','high','open','Juan/Hermes','Reset token en Discord Developer Portal y actualizar /root/claude-discord-agent/.env','Token fue compartido durante setup.'),
  ('hetzner-funnelly-agent-1','Documentar backups/snapshots Hetzner','high','open','Juan/Hermes','Confirmar política de snapshots/backups y procedimiento de restore','Pendiente inventario formal.'),
  ('supabase-sn-psi','Confirmar buckets Supabase','medium','open','Juan/Hermes','Verificar storage.buckets desde dashboard/SQL y documentar si existen','No se encontró migración local de buckets.'),
  ('supabase-sn-psi','Auditar policy agent/audit logs amplia','medium','open','Juan/Hermes','Revisar policy de psi_sales_opportunity_audit_logs y endurecer si aplica','Migración local usa using true / with check true.'),
  ('claudesdk-discord-agent','Definir memoria/sesiones por canal ClaudeSDK','medium','open','Juan/Hermes','Diseñar persistencia y prompts diferenciados por canal','Actualmente opera como bot SDK básico.')
) as v(system_slug, risk_title, risk_level, status, owner_label, recommended_action, notes)
join public.agent_inventory_systems s on s.slug=v.system_slug
where not exists (
  select 1 from public.agent_inventory_risks r where r.system_id=s.id and r.risk_title=v.risk_title
);

-- Seed health checks from latest verification.
insert into public.agent_inventory_checks (system_id, service_id, check_name, check_type, status, last_checked_at, evidence, notes)
select s.id, svc.id, v.check_name, v.check_type, v.status, now(), v.evidence, v.notes
from (values
  ('hermes-gateway','hermes-gateway-service','systemd active','systemd','passing','systemctl is-active hermes-gateway => active','Verificado 2026-06-30'),
  ('claudesdk-discord-agent','claude-discord-agent-service','systemd active','systemd','passing','systemctl is-active claude-discord-agent.service => active','Verificado 2026-06-30'),
  ('sn-crm','sn-crm-vercel-production','Vercel production ready','vercel','passing','vercel inspect seguridad-nacional-crm.vercel.app => Ready','Deployment dpl_6yQ7hKgXLcCz6FEHqJ9Ubzio9KS1'),
  ('supabase-sn-psi',null,'Supabase REST OpenAPI reachable','http','passing','/rest/v1 OpenAPI => 37 objects','Project ref tyfzjqzcpgwcjnxozaaf')
) as v(system_slug, service_slug, check_name, check_type, status, evidence, notes)
join public.agent_inventory_systems s on s.slug=v.system_slug
left join public.agent_inventory_services svc on svc.slug=v.service_slug
where not exists (
  select 1 from public.agent_inventory_checks c where c.system_id=s.id and c.check_name=v.check_name
);
