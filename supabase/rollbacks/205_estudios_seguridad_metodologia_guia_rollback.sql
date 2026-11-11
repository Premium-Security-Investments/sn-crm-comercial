-- Rollback de 205: los estudios nuevos vuelven a nacer con instalaciones-fisicas-v1 y se pierde la probabilidad residual
-- escogida (un estudio con la metodología de la guía muestra entonces el residual igual al actual).
begin;

alter table public.psi_security_studies alter column methodology_id set default 'instalaciones-fisicas-v1';
alter table public.psi_security_study_risks drop column if exists residual_probability;

-- La transición vuelve a la de la 188: pasan a Seguimiento todas las acciones con responsable y fecha.
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
  v_followups integer := 0;
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
    insert into public.siio_followups(title, owner_label, due_date, origin_type, origin_ref, origin_label, created_by, created_role)
    select case when length(btrim(a.description)) > 300 then left(btrim(a.description), 299) || '…' else btrim(a.description) end,
           btrim(a.owner_label),
           a.due_date,
           'estudio_seguridad',
           a.id::text,
           left(v_study.code || ' · ' || v_study.client_name || ' · ' || v_study.site_name || ' · R' || r.number || ' ' || r.title, 300),
           p_actor_id,
           'sistema'
      from public.psi_security_study_actions a
      join public.psi_security_study_risks r on r.id = a.risk_id
     where a.study_id = p_study_id
       and a.owner_label is not null and a.due_date is not null
       and a.status in ('pendiente', 'en_curso')
     order by r.number, a.created_at
    on conflict (origin_ref) where origin_type = 'estudio_seguridad' do nothing;
    get diagnostics v_followups = row_count;
  end if;

  update public.psi_security_studies set status = v_to, updated_at = now() where id = p_study_id;
  insert into public.psi_security_study_events(study_id, action, from_status, to_status, note, version, actor_id)
  values (p_study_id, p_action, v_study.status, v_to, nullif(btrim(coalesce(p_note, '')), ''), v_version, p_actor_id);

  return jsonb_build_object('status', v_to, 'version', v_version, 'followups', v_followups);
end;
$fn$;

revoke all on function public.psi_security_study_transition(uuid, text, uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.psi_security_study_transition(uuid, text, uuid, text, jsonb, text) to service_role;
alter table public.psi_security_study_actions drop column if exists responsible_party;

commit;
