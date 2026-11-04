-- 177 — Copia de trabajo de un borrador en SharePoint, pedida con un botón (mejora 5; decisión de Juan, 2026-11-04).
--
-- El Word que arma Vig-IA queda en el CRM (el original, que no se modifica). La copia de trabajo —la que se corrige y
-- se firma— va a la carpeta del proceso en SharePoint, pero SÓLO cuando una persona lo pide con el botón "Subir a
-- SharePoint": nada llega a SharePoint a nombre de Juan sin que alguien lo decida. La sesión de Microsoft vive sólo en
-- el servidor de tareas, así que el CRM anota el pedido aquí y el servidor lo atiende.
--
-- Va en tabla propia porque las versiones del expediente son inmutables (trigger de la 040): el enlace de SharePoint
-- no se puede escribir en la versión.
--
-- Cada función nueva nace sin permisos para PUBLIC y sólo la ejecuta service_role (memoria firma-nueva-nace-sin-permisos).

begin;

create table if not exists public.psi_tender_dossier_sharepoint_copies (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  artifact_version_id uuid not null unique references public.psi_tender_dossier_artifact_versions(id) on delete restrict,
  requested_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
  requested_at timestamptz not null default now(),
  status text not null default 'pendiente' check (status in ('pendiente', 'subiendo', 'subido', 'fallido')),
  attempts integer not null default 0,
  claimed_at timestamptz,
  sharepoint_url text check (sharepoint_url is null or sharepoint_url ~ '^https://'),
  sharepoint_path text,
  uploaded_at timestamptz,
  error_text text check (error_text is null or length(error_text) <= 300),
  updated_at timestamptz not null default now()
);
create index if not exists psi_tender_dossier_sharepoint_copies_pending_idx
  on public.psi_tender_dossier_sharepoint_copies (requested_at) where status in ('pendiente', 'subiendo');

alter table public.psi_tender_dossier_sharepoint_copies enable row level security;
revoke all on table public.psi_tender_dossier_sharepoint_copies from public, anon, authenticated;
grant select on table public.psi_tender_dossier_sharepoint_copies to service_role;

-- Pedir la copia. Sólo para una versión que tenga Word en el CRM y sea de ESA oportunidad. Repetir el pedido no duplica:
-- si ya está pendiente, subiendo o subida, devuelve la fila; si falló, la vuelve a poner en cola.
create or replace function public.psi_request_tender_draft_sharepoint_copy(
  p_opportunity_id uuid, p_version_id uuid, p_actor_id uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.psi_tender_dossier_sharepoint_copies%rowtype;
begin
  perform public.psi_assert_tender_dossier_actor(p_actor_id, false);
  if not exists (
    select 1 from public.psi_tender_dossier_artifact_versions v
      join public.psi_tender_dossier_artifacts a on a.id = v.artifact_id
     where v.id = p_version_id and a.opportunity_id = p_opportunity_id
       and jsonb_typeof(v.content_metadata -> 'archivo') = 'object'
       and coalesce(v.content_metadata -> 'archivo' ->> 'storage_path', '') <> ''
  ) then
    raise exception 'Esa versión no tiene un Word del CRM en este expediente.' using errcode = 'P0002';
  end if;
  insert into public.psi_tender_dossier_sharepoint_copies (opportunity_id, artifact_version_id, requested_by)
  values (p_opportunity_id, p_version_id, p_actor_id)
  on conflict (artifact_version_id) do update
     set status = 'pendiente', requested_by = excluded.requested_by, requested_at = now(), error_text = null, updated_at = now()
   where public.psi_tender_dossier_sharepoint_copies.status = 'fallido'
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.psi_tender_dossier_sharepoint_copies where artifact_version_id = p_version_id;
  end if;
  return to_jsonb(v_row);
end;
$$;

-- Lo que ve la pantalla: el estado de cada copia del expediente.
create or replace function public.psi_list_tender_draft_sharepoint_copies(p_opportunity_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'artifact_version_id', c.artifact_version_id, 'status', c.status, 'sharepoint_url', c.sharepoint_url,
    'requested_at', c.requested_at, 'uploaded_at', c.uploaded_at, 'error_text', c.error_text
  ) order by c.requested_at), '[]'::jsonb)
  from public.psi_tender_dossier_sharepoint_copies c where c.opportunity_id = p_opportunity_id;
$$;

-- El servidor toma los pedidos. Un pedido que quedó "subiendo" más de 10 minutos (el trabajo se cayó a mitad) vuelve a
-- tomarse; después de 3 intentos queda fallido.
create or replace function public.psi_claim_tender_draft_sharepoint_copies(p_limit integer default 5)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_rows jsonb;
begin
  update public.psi_tender_dossier_sharepoint_copies
     set status = 'fallido', error_text = 'Se intentó 3 veces y no se pudo subir.', updated_at = now()
   where status = 'subiendo' and claimed_at < now() - interval '10 minutes' and attempts >= 3;
  with picked as (
    select id from public.psi_tender_dossier_sharepoint_copies
     where status = 'pendiente' or (status = 'subiendo' and claimed_at < now() - interval '10 minutes')
     order by requested_at limit greatest(1, least(coalesce(p_limit, 5), 20))
     for update skip locked
  ), claimed as (
    update public.psi_tender_dossier_sharepoint_copies c
       set status = 'subiendo', claimed_at = now(), attempts = c.attempts + 1, updated_at = now()
      from picked where c.id = picked.id
    returning c.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', claimed.id, 'opportunity_id', claimed.opportunity_id, 'artifact_version_id', claimed.artifact_version_id,
    'version', v.version, 'artifact_title', a.title, 'tender_id', a.tender_id,
    'storage_path', v.content_metadata -> 'archivo' ->> 'storage_path',
    'file_name', v.content_metadata -> 'archivo' ->> 'nombre'
  )), '[]'::jsonb) into v_rows
  from claimed
  join public.psi_tender_dossier_artifact_versions v on v.id = claimed.artifact_version_id
  join public.psi_tender_dossier_artifacts a on a.id = v.artifact_id;
  return v_rows;
end;
$$;

-- El servidor cierra el pedido: subido con su enlace, o fallido con un motivo corto (sin rutas ni contenido).
create or replace function public.psi_finish_tender_draft_sharepoint_copy(
  p_id uuid, p_ok boolean, p_url text, p_path text, p_error text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.psi_tender_dossier_sharepoint_copies%rowtype;
begin
  update public.psi_tender_dossier_sharepoint_copies
     set status = case when p_ok then 'subido' else 'fallido' end,
         sharepoint_url = case when p_ok then nullif(btrim(p_url), '') else sharepoint_url end,
         sharepoint_path = case when p_ok then nullif(btrim(p_path), '') else sharepoint_path end,
         uploaded_at = case when p_ok then now() else uploaded_at end,
         error_text = case when p_ok then null else left(coalesce(nullif(btrim(p_error), ''), 'No se pudo subir.'), 300) end,
         updated_at = now()
   where id = p_id and status = 'subiendo'
  returning * into v_row;
  if v_row.id is null then raise exception 'El pedido no está en curso.' using errcode = 'P0002'; end if;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.psi_request_tender_draft_sharepoint_copy(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.psi_list_tender_draft_sharepoint_copies(uuid) from public, anon, authenticated;
revoke all on function public.psi_claim_tender_draft_sharepoint_copies(integer) from public, anon, authenticated;
revoke all on function public.psi_finish_tender_draft_sharepoint_copy(uuid, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.psi_request_tender_draft_sharepoint_copy(uuid, uuid, uuid) to service_role;
grant execute on function public.psi_list_tender_draft_sharepoint_copies(uuid) to service_role;
grant execute on function public.psi_claim_tender_draft_sharepoint_copies(integer) to service_role;
grant execute on function public.psi_finish_tender_draft_sharepoint_copy(uuid, boolean, text, text, text) to service_role;

commit;
