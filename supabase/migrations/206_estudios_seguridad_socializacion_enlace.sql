-- Estudios de Seguridad Física: socialización con el cliente y enlace en línea (Juan, 2026-11-11).
--
-- Héctor Martínez (reunión del 2026-11-11): un estudio no está entregado hasta que se socializa con el cliente; lo
-- presentan el analista y el coordinador. Juan: además del PDF, un enlace donde el cliente vea su estudio en línea, "de
-- una vez" en el plan.
--
--   psi_security_study_deliveries     la socialización de una versión aprobada: fecha, medio, quién presentó, quiénes
--                                     asistieron y el soporte. Con ella la versión cuenta como entregada.
--   psi_security_study_shares         enlaces para el cliente: se guarda SÓLO la huella del token (el token se muestra una
--                                     vez), vencen y se pueden anular.
--   psi_security_study_share_views    cada vez que alguien abre un enlace: sólo la hora (ni IP ni navegador).
begin;

create table if not exists public.psi_security_study_deliveries (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.psi_security_studies(id) on delete cascade,
  version integer not null check (version > 0),
  delivered_on date not null,
  medium text not null check (medium in ('presencial', 'virtual', 'correo')),
  presented_by text not null check (length(btrim(presented_by)) between 2 and 300),
  attendees text not null check (length(btrim(attendees)) between 2 and 1000),
  support text check (support is null or length(support) <= 1000),
  notes text check (notes is null or length(notes) <= 2000),
  recorded_by uuid not null references public.psi_sales_profiles(id),
  recorded_at timestamptz not null default now(),
  constraint psi_security_study_deliveries_unique unique (study_id, version)
);

create table if not exists public.psi_security_study_shares (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.psi_security_studies(id) on delete cascade,
  version integer not null check (version > 0),
  token_sha256 text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
  label text check (label is null or length(label) <= 160),
  created_by uuid not null references public.psi_sales_profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references public.psi_sales_profiles(id),
  constraint psi_security_study_shares_expiry check (expires_at > created_at and expires_at <= created_at + interval '400 days')
);
create index if not exists psi_security_study_shares_study_idx on public.psi_security_study_shares (study_id, created_at desc);

create table if not exists public.psi_security_study_share_views (
  id bigserial primary key,
  share_id uuid not null references public.psi_security_study_shares(id) on delete cascade,
  viewed_at timestamptz not null default now()
);
create index if not exists psi_security_study_share_views_share_idx on public.psi_security_study_share_views (share_id, viewed_at desc);

alter table public.psi_security_study_deliveries enable row level security;
alter table public.psi_security_study_shares enable row level security;
alter table public.psi_security_study_share_views enable row level security;
revoke all on public.psi_security_study_deliveries, public.psi_security_study_shares, public.psi_security_study_share_views from public, anon, authenticated;
grant select, insert, update, delete on public.psi_security_study_deliveries, public.psi_security_study_shares, public.psi_security_study_share_views to service_role;
grant usage, select on sequence public.psi_security_study_share_views_id_seq to service_role;

commit;
