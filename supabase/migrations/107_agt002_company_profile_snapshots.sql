-- AGT-002 INITIAL scope A_PLUS_B: an immutable, hash-identified snapshot of the company procurement profile
-- (psi_company_procurement_profile + current company documents + evidence registry, as built by
-- agt002-company-dossier.js). A workflow instance with scope A_PLUS_B references it through
-- profile_snapshot_id / profile_snapshot_hash, so the analysis evaluates the company against exactly the
-- profile that was authorized, never a later edit of it.
--
-- One service-role-only, permanently append-only table and one freeze RPC. The snapshot hash is computed by
-- the caller over the canonical JSON; the RPC is idempotent by hash and never rewrites an existing snapshot.
begin;

create table if not exists public.psi_agt002_company_profile_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (snapshot_hash)
);

create or replace function public.psi_agt002_company_profile_snapshot_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception '%: las fotos del perfil de empresa AGT-002 son append-only: UPDATE y DELETE están prohibidos', tg_table_name using errcode = '55000';
end;
$$;

drop trigger if exists psi_agt002_company_profile_snapshots_immutable on public.psi_agt002_company_profile_snapshots;
create trigger psi_agt002_company_profile_snapshots_immutable
  before update or delete on public.psi_agt002_company_profile_snapshots
  for each row execute function public.psi_agt002_company_profile_snapshot_prevent_mutation();

alter table public.psi_agt002_company_profile_snapshots enable row level security;
revoke all on table public.psi_agt002_company_profile_snapshots from public, authenticated, anon, service_role;
grant select on table public.psi_agt002_company_profile_snapshots to service_role;

create or replace function public.psi_freeze_agt002_company_profile_snapshot(
  p_snapshot jsonb,
  p_snapshot_hash text,
  p_actor_profile_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.psi_agt002_company_profile_snapshots%rowtype;
  v_id uuid;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' or p_actor_profile_id is null
     or nullif(btrim(coalesce(p_snapshot_hash, '')), '') is null then
    raise exception 'La foto del perfil de empresa, su huella y el actor son obligatorios.' using errcode = '22023';
  end if;
  if p_snapshot_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'La huella de la foto del perfil de empresa no es válida.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('agt002-company-profile-snapshot:' || p_snapshot_hash, 0));
  select * into v_existing from public.psi_agt002_company_profile_snapshots where snapshot_hash = p_snapshot_hash;
  if found then
    if v_existing.snapshot is distinct from p_snapshot then
      raise exception 'Ya existe una foto del perfil de empresa con esa huella y contenido distinto.' using errcode = '23505';
    end if;
    return jsonb_build_object('status', 'existing', 'profile_snapshot_id', v_existing.id, 'profile_snapshot_hash', v_existing.snapshot_hash);
  end if;

  insert into public.psi_agt002_company_profile_snapshots (snapshot, snapshot_hash, created_by)
  values (p_snapshot, p_snapshot_hash, p_actor_profile_id)
  returning id into v_id;
  return jsonb_build_object('status', 'created', 'profile_snapshot_id', v_id, 'profile_snapshot_hash', p_snapshot_hash);
end;
$$;

revoke all on function public.psi_freeze_agt002_company_profile_snapshot(jsonb, text, uuid) from public, authenticated, anon, service_role;
grant execute on function public.psi_freeze_agt002_company_profile_snapshot(jsonb, text, uuid) to service_role;

commit;
