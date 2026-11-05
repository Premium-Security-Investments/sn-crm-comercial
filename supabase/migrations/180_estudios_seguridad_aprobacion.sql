-- Estudios de Seguridad Física, tramo 3: revisión, aprobación y versión congelada (Juan, 2026-11-05).
--
-- Flujo pedido por Juan: el preparador captura y envía; un revisor técnico valida metodología, valoración y
-- controles, y devuelve con observaciones o lo da por revisado; un aprobador aprueba la versión. Lo aprobado no se
-- edita: reabrir lo devuelve a borrador y la siguiente aprobación es la versión N+1.
--
--   borrador ─enviar→ en_revision ─marcar_revisado→ revisado ─aprobar→ aprobado ─reabrir→ borrador
--   devuelto ─enviar→ en_revision      en_revision | revisado ─devolver→ devuelto
--
-- Dos permisos de capacidad nuevos, que se marcan dentro de la pestaña "Estudios de seguridad":
-- `estudios_seguridad_revisar` y `estudios_seguridad_aprobar`. Quién puede pedir cada paso lo decide el servidor;
-- esta función lo vuelve a comprobar en lo que no se puede saltar (estado de partida y que quien revisa o aprueba no
-- sea quien preparó) y hace el cambio de estado, la bitácora y la versión en una sola transacción.
--
-- La versión guarda una foto completa del estudio (JSON) armada por el servidor, con su sha256: es lo que el informe
-- y el archivo en SharePoint (tramo 4) van a usar, y no cambia aunque el estudio se reabra.
begin;

insert into public.psi_access_permissions(code, name, description, active) values
  ('estudios_seguridad_revisar', 'Revisa estudios de seguridad', 'Revisor técnico: devuelve con observaciones o da por revisado un estudio de seguridad que no preparó.', true),
  ('estudios_seguridad_aprobar', 'Aprueba estudios de seguridad', 'Aprueba la versión de un estudio de seguridad que no preparó, y puede reabrirlo.', true)
on conflict (code) do update set name = excluded.name, description = excluded.description, active = true;

create table if not exists public.psi_security_study_events (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.psi_security_studies(id) on delete cascade,
  action text not null check (action in ('enviar', 'devolver', 'marcar_revisado', 'aprobar', 'reabrir')),
  from_status text not null,
  to_status text not null,
  note text check (note is null or length(btrim(note)) <= 4000),
  version integer,
  actor_id uuid not null references public.psi_sales_profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists psi_security_study_events_study_idx on public.psi_security_study_events(study_id, created_at);

create table if not exists public.psi_security_study_versions (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.psi_security_studies(id) on delete cascade,
  version integer not null check (version > 0),
  methodology_id text not null,
  snapshot jsonb not null,
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  approved_by uuid not null references public.psi_sales_profiles(id),
  approved_at timestamptz not null default now(),
  constraint psi_security_study_versions_unique unique (study_id, version)
);

alter table public.psi_security_study_events enable row level security;
alter table public.psi_security_study_versions enable row level security;
revoke all on public.psi_security_study_events, public.psi_security_study_versions from public, anon, authenticated;
-- Bitácora y versiones: sólo se agregan. Ni siquiera el servidor las edita o borra (se van solas si se borra el estudio).
revoke update, delete, truncate on public.psi_security_study_events, public.psi_security_study_versions from service_role;
grant select, insert on public.psi_security_study_events, public.psi_security_study_versions to service_role;

create or replace function public.psi_security_study_transition(
  p_study_id uuid,
  p_action text,
  p_actor_id uuid,
  p_note text default null,
  p_snapshot jsonb default null,
  p_snapshot_sha256 text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_study public.psi_security_studies%rowtype;
  v_to text;
  v_version integer := null;
begin
  select * into v_study from public.psi_security_studies where id = p_study_id for update;
  if not found then
    raise exception 'ESTUDIO_NO_ENCONTRADO' using errcode = 'P0002';
  end if;

  v_to := case
    when p_action = 'enviar' and v_study.status in ('borrador', 'devuelto') then 'en_revision'
    when p_action = 'marcar_revisado' and v_study.status = 'en_revision' then 'revisado'
    when p_action = 'devolver' and v_study.status in ('en_revision', 'revisado') then 'devuelto'
    when p_action = 'aprobar' and v_study.status = 'revisado' then 'aprobado'
    when p_action = 'reabrir' and v_study.status = 'aprobado' then 'borrador'
    else null
  end;
  if v_to is null then
    raise exception 'TRANSICION_INVALIDA: % desde %', p_action, v_study.status using errcode = 'P0001';
  end if;

  if p_action in ('marcar_revisado', 'devolver', 'aprobar') and p_actor_id = v_study.prepared_by then
    raise exception 'PREPARADOR_NO_PUEDE: % ', p_action using errcode = 'P0001';
  end if;
  if p_action = 'devolver' and (p_note is null or length(btrim(p_note)) < 3) then
    raise exception 'DEVOLVER_SIN_OBSERVACION' using errcode = 'P0001';
  end if;

  if p_action = 'aprobar' then
    if p_snapshot is null or p_snapshot_sha256 is null then
      raise exception 'APROBAR_SIN_VERSION' using errcode = 'P0001';
    end if;
    select coalesce(max(version), 0) + 1 into v_version from public.psi_security_study_versions where study_id = p_study_id;
    insert into public.psi_security_study_versions(study_id, version, methodology_id, snapshot, snapshot_sha256, approved_by)
    values (p_study_id, v_version, v_study.methodology_id, p_snapshot, p_snapshot_sha256, p_actor_id);
  end if;

  update public.psi_security_studies set status = v_to, updated_at = now() where id = p_study_id;
  insert into public.psi_security_study_events(study_id, action, from_status, to_status, note, version, actor_id)
  values (p_study_id, p_action, v_study.status, v_to, nullif(btrim(coalesce(p_note, '')), ''), v_version, p_actor_id);

  return jsonb_build_object('status', v_to, 'version', v_version);
end;
$fn$;

revoke all on function public.psi_security_study_transition(uuid, text, uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.psi_security_study_transition(uuid, text, uuid, text, jsonb, text) to service_role;

commit;
