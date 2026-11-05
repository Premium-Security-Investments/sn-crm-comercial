-- F16 (auditoría del piloto Fiscalía, 2026-11-05). Juan, 2026-11-04 21:40 COT: «cuando el proceso está en por decidir no
-- tenemos una sección donde se suben documentos para descargar como en los en curso después del GO… debemos
-- solucionar esto para el futuro». Esa noche la carta de observaciones de Fiscalía hubo que armarla fuera del CRM.
--
-- Crear un documento de la oferta y subirle versiones deja de exigir el GO: basta que la licitación esté abierta para
-- la Mesa (`psi_assert_agt002_workbench_open`: con GO, o por decidir, activa y sin archivar; un NO GO vigente la
-- cierra). Es la misma tabla del expediente, así que lo creado antes del GO ya está ahí cuando el GO se registra; la
-- siembra del GO no lo pisa (`on conflict do nothing`).
--
-- Lo que sigue exigiendo el GO: la revisión/aprobación de una versión, la lista de chequeo y la preparación. Sólo cambia
-- la guarda; el resto de las dos funciones queda igual que en la 040.
begin;

create or replace function public.psi_create_tender_dossier_artifact(p_opportunity_id uuid, p_actor_id uuid, p_artifact_key text, p_title text, p_required boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tender_id uuid; v_artifact_id uuid;
begin
  perform public.psi_assert_tender_dossier_actor(p_actor_id, false);
  v_tender_id := public.psi_assert_agt002_workbench_open(p_opportunity_id);
  if nullif(btrim(p_title), '') is null then raise exception 'El artefacto requiere un título.' using errcode = '22023'; end if;
  insert into public.psi_tender_dossier_artifacts (opportunity_id, tender_id, artifact_key, title, required, origin, created_by)
  values (p_opportunity_id, v_tender_id, btrim(p_artifact_key), btrim(p_title), coalesce(p_required, false), 'human', p_actor_id)
  on conflict (opportunity_id, artifact_key) do nothing
  returning id into v_artifact_id;
  if v_artifact_id is null then
    select id into v_artifact_id from public.psi_tender_dossier_artifacts where opportunity_id = p_opportunity_id and artifact_key = btrim(p_artifact_key);
  end if;
  return jsonb_build_object('artifact', public.psi_project_tender_dossier_artifact(v_artifact_id));
end;
$$;

create or replace function public.psi_add_tender_dossier_artifact_version(p_opportunity_id uuid, p_artifact_id uuid, p_actor_id uuid, p_content_kind text, p_content_text text, p_content_metadata jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_artifact public.psi_tender_dossier_artifacts%rowtype; v_prev uuid; v_version integer; v_id uuid;
begin
  perform public.psi_assert_tender_dossier_actor(p_actor_id, false);
  perform public.psi_assert_agt002_workbench_open(p_opportunity_id);
  perform pg_advisory_xact_lock(hashtextextended('psi_dossier_artifact:' || p_artifact_id::text, 0));
  select * into v_artifact from public.psi_tender_dossier_artifacts where id = p_artifact_id;
  if not found or v_artifact.opportunity_id <> p_opportunity_id then
    raise exception 'El artefacto no pertenece a la oportunidad.' using errcode = 'P0002';
  end if;
  if p_content_kind not in ('markdown','texto','metadata') then raise exception 'Tipo de contenido inválido.' using errcode = '22023'; end if;
  select id, version into v_prev, v_version from public.psi_tender_dossier_artifact_versions
    where artifact_id = p_artifact_id order by version desc, id desc limit 1;
  insert into public.psi_tender_dossier_artifact_versions (
    artifact_id, opportunity_id, version, supersedes_version_id, content_kind, content_text, content_metadata, author_id
  ) values (
    p_artifact_id, p_opportunity_id, coalesce(v_version, 0) + 1, v_prev, p_content_kind,
    nullif(btrim(p_content_text), ''), p_content_metadata, p_actor_id
  ) returning id into v_id;
  return jsonb_build_object('artifact', public.psi_project_tender_dossier_artifact(p_artifact_id), 'version_id', v_id);
end;
$$;

revoke all on function public.psi_create_tender_dossier_artifact(uuid,uuid,text,text,boolean) from public, anon, authenticated, service_role;
grant execute on function public.psi_create_tender_dossier_artifact(uuid,uuid,text,text,boolean) to service_role;
revoke all on function public.psi_add_tender_dossier_artifact_version(uuid,uuid,uuid,text,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.psi_add_tender_dossier_artifact_version(uuid,uuid,uuid,text,text,jsonb) to service_role;

commit;
