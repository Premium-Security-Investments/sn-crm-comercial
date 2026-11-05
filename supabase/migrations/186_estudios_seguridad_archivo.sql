-- Estudios de Seguridad Física, tramo 4: el informe y el archivo en SharePoint (Juan, 2026-11-05).
--
-- Decisión de Juan: al aprobar una versión, el informe se genera solo y queda en cola para subir a SharePoint. La
-- subida va a nombre de Juan Botero —la única sesión de Microsoft que tiene el SIIO— y su regla del 2026-11-04 es que
-- nada suba a su nombre sin que una persona lo pida: aquí el pedido es la aprobación misma, que hace una persona con
-- su permiso. Por eso el pedido nace DENTRO de psi_security_study_transition, en la misma transacción que congela la
-- versión: no hay versión aprobada sin pedido de archivo, ni pedido sin versión.
--
-- Lo sube un trabajo del servidor de tareas (ops/estudios-seguridad/), cada minuto y sólo si hay pedidos, con las
-- guardas del puente CRM → SharePoint: nunca sobrescribe, relee después de escribir y escribe sólo en
-- 99_Del_CRM/Estudios_de_Seguridad/. Un pedido colgado más de 10 minutos se retoma; a los 3 intentos queda fallido.
begin;

create table if not exists public.psi_security_study_archives (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.psi_security_studies(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null default 'pendiente' check (status in ('pendiente', 'procesando', 'archivado', 'fallido')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  requested_by uuid not null references public.psi_sales_profiles(id),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  folder_path text check (folder_path is null or length(folder_path) <= 400),
  report_url text check (report_url is null or report_url ~ '^https://'),
  -- [{nombre, tipo, sha256, bytes, url, readback}] de lo que quedó en SharePoint.
  files jsonb not null default '[]'::jsonb,
  error text check (error is null or length(error) <= 300),
  constraint psi_security_study_archives_unique unique (study_id, version)
);
create index if not exists psi_security_study_archives_pending_idx on public.psi_security_study_archives(status, requested_at);

alter table public.psi_security_study_archives enable row level security;
revoke all on public.psi_security_study_archives from public, anon, authenticated, service_role;
grant select on public.psi_security_study_archives to service_role;

-- El trabajo toma hasta p_limit pedidos: pendientes, o "procesando" colgados más de 10 minutos, con menos de 3 intentos.
create or replace function public.psi_claim_security_study_archives(p_limit integer default 3)
returns setof public.psi_security_study_archives
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  -- Lo que ya gastó sus 3 intentos queda fallido, con motivo, en vez de quedar "procesando" para siempre.
  update public.psi_security_study_archives
     set status = 'fallido', finished_at = now(), error = coalesce(error, 'no se pudo archivar después de 3 intentos')
   where status = 'procesando' and started_at < now() - interval '10 minutes' and attempts >= 3;

  return query
  with picked as (
    select id from public.psi_security_study_archives
     where (status = 'pendiente' or (status = 'procesando' and started_at < now() - interval '10 minutes'))
       and attempts < 3
     order by requested_at
     limit greatest(1, least(coalesce(p_limit, 3), 10))
     for update skip locked
  )
  update public.psi_security_study_archives a
     set status = 'procesando', started_at = now(), attempts = a.attempts + 1, error = null
    from picked
   where a.id = picked.id
  returning a.*;
end;
$fn$;

create or replace function public.psi_finish_security_study_archive(
  p_id uuid, p_ok boolean, p_folder_path text, p_report_url text, p_files jsonb, p_error text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  update public.psi_security_study_archives
     set status = case when p_ok then 'archivado' when attempts >= 3 then 'fallido' else 'pendiente' end,
         finished_at = now(),
         folder_path = coalesce(p_folder_path, folder_path),
         report_url = case when p_report_url ~ '^https://' then p_report_url else report_url end,
         files = case when jsonb_typeof(p_files) = 'array' then p_files else files end,
         error = case when p_ok then null else left(coalesce(p_error, 'error técnico al archivar'), 300) end
   where id = p_id and status = 'procesando';
end;
$fn$;

-- La aprobación deja el pedido de archivo en la misma transacción. Misma firma que la 180: conserva sus permisos.
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
    insert into public.psi_security_study_archives(study_id, version, requested_by)
    values (p_study_id, v_version, p_actor_id);
  end if;

  update public.psi_security_studies set status = v_to, updated_at = now() where id = p_study_id;
  insert into public.psi_security_study_events(study_id, action, from_status, to_status, note, version, actor_id)
  values (p_study_id, p_action, v_study.status, v_to, nullif(btrim(coalesce(p_note, '')), ''), v_version, p_actor_id);

  return jsonb_build_object('status', v_to, 'version', v_version);
end;
$fn$;

revoke all on function public.psi_claim_security_study_archives(integer) from public, anon, authenticated;
grant execute on function public.psi_claim_security_study_archives(integer) to service_role;
revoke all on function public.psi_finish_security_study_archive(uuid, boolean, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.psi_finish_security_study_archive(uuid, boolean, text, text, jsonb, text) to service_role;
-- La de transición ya tenía estos permisos (180); se repiten para que la migración se sostenga sola.
revoke all on function public.psi_security_study_transition(uuid, text, uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.psi_security_study_transition(uuid, text, uuid, text, jsonb, text) to service_role;

commit;
