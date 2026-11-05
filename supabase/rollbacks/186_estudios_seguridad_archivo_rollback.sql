-- Rollback de 186: quita la cola de archivo en SharePoint y deja la transición como en la 180.
--
-- Pierde el registro de qué se archivó y dónde; los archivos que ya están en SharePoint NO se borran.
begin;

create or replace function public.psi_security_study_transition(
  p_study_id uuid, p_action text, p_actor_id uuid, p_note text default null, p_snapshot jsonb default null, p_snapshot_sha256 text default null
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
  if not found then raise exception 'ESTUDIO_NO_ENCONTRADO' using errcode = 'P0002'; end if;
  v_to := case
    when p_action = 'enviar' and v_study.status in ('borrador', 'devuelto') then 'en_revision'
    when p_action = 'marcar_revisado' and v_study.status = 'en_revision' then 'revisado'
    when p_action = 'devolver' and v_study.status in ('en_revision', 'revisado') then 'devuelto'
    when p_action = 'aprobar' and v_study.status = 'revisado' then 'aprobado'
    when p_action = 'reabrir' and v_study.status = 'aprobado' then 'borrador'
    else null end;
  if v_to is null then raise exception 'TRANSICION_INVALIDA: % desde %', p_action, v_study.status using errcode = 'P0001'; end if;
  if p_action in ('marcar_revisado', 'devolver', 'aprobar') and p_actor_id = v_study.prepared_by then
    raise exception 'PREPARADOR_NO_PUEDE: % ', p_action using errcode = 'P0001';
  end if;
  if p_action = 'devolver' and (p_note is null or length(btrim(p_note)) < 3) then raise exception 'DEVOLVER_SIN_OBSERVACION' using errcode = 'P0001'; end if;
  if p_action = 'aprobar' then
    if p_snapshot is null or p_snapshot_sha256 is null then raise exception 'APROBAR_SIN_VERSION' using errcode = 'P0001'; end if;
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

drop function if exists public.psi_finish_security_study_archive(uuid, boolean, text, text, jsonb, text);
drop function if exists public.psi_claim_security_study_archives(integer);
drop table if exists public.psi_security_study_archives;

commit;
