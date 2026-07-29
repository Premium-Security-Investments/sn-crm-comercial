-- Rollback de la Mesa de trabajo post-GO de Vig-IA (AGT-002, migración 045).
-- Revierte 045 en orden de dependencia exacto y restaura las definiciones de la
-- migración 040 para las funciones que 045 reemplazó (proyección/revisión de
-- artefactos). No toca la migración 044 (piloto AGT-003), ni kill switches, ni
-- el bridge/modelo.
--
-- FALLA CERRADO ANTES DE CUALQUIER DDL DESTRUCTIVO: si existe cualquier fila en
-- las tablas de Mesa/aprendizaje AGT-002, o cualquier versión de artefacto con
-- author_kind='agent' u origin_agent_job_id no nulo, aborta sin destruir nada.
-- La evidencia de auditoría nunca se destruye en silencio.
begin;

-- 0. Anti-TOCTOU: inmediatamente tras BEGIN, antes de contar evidencia o ejecutar DDL
--    destructivo, se toman ACCESS EXCLUSIVE sobre las 8 tablas AGT-002 y SHARE sobre
--    psi_tender_dossier_artifact_versions. Así ninguna transacción concurrente puede
--    insertar evidencia entre la verificación de datos-cero y el borrado.
lock table
  public.psi_agt002_workbench_threads,
  public.psi_agt002_workbench_messages,
  public.psi_agt002_workbench_message_links,
  public.psi_agt002_workbench_jobs,
  public.psi_agt002_workbench_job_events,
  public.psi_agt002_workbench_required_actions,
  public.psi_agt002_learning_proposals,
  public.psi_agt002_learning_decisions
  in access exclusive mode;
lock table public.psi_tender_dossier_artifact_versions in share mode;

-- 1. Guarda de evidencia (tras los locks, antes de todo DDL destructivo).
do $$
declare
  v_total bigint := 0;
  v_cnt bigint;
  v_agent bigint := 0;
  t text;
begin
  foreach t in array array[
    'psi_agt002_workbench_threads','psi_agt002_workbench_messages','psi_agt002_workbench_message_links',
    'psi_agt002_workbench_jobs','psi_agt002_workbench_job_events','psi_agt002_workbench_required_actions',
    'psi_agt002_learning_proposals','psi_agt002_learning_decisions'
  ] loop
    if to_regclass('public.'||t) is not null then
      execute format('select count(*) from public.%I', t) into v_cnt;
      v_total := v_total + coalesce(v_cnt, 0);
    end if;
  end loop;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='psi_tender_dossier_artifact_versions'
      and column_name in ('author_kind','origin_agent_job_id')
  ) then
    select count(*) into v_agent from public.psi_tender_dossier_artifact_versions
      where author_kind='agent' or origin_agent_job_id is not null;
  end if;

  if v_total > 0 or v_agent > 0 then
    raise exception using errcode='55000',
      message = format(
        'AGT-002 rollback abortado (fail closed): existe evidencia (%s filas en tablas Mesa/aprendizaje, %s versiones de artefacto de origen agente). La evidencia de auditoría no puede destruirse.',
        v_total, v_agent);
  end if;
end $$;

-- 2. Triggers append-only sobre las 8 tablas (se eliminan explícitamente; el drop de
--    las tablas también los retiraría, pero se declara para dejar la reversión explícita).
drop trigger if exists trg_psi_agt002_workbench_threads_append_only on public.psi_agt002_workbench_threads;
drop trigger if exists trg_psi_agt002_workbench_messages_append_only on public.psi_agt002_workbench_messages;
drop trigger if exists trg_psi_agt002_workbench_message_links_append_only on public.psi_agt002_workbench_message_links;
drop trigger if exists trg_psi_agt002_workbench_jobs_append_only on public.psi_agt002_workbench_jobs;
drop trigger if exists trg_psi_agt002_workbench_job_events_append_only on public.psi_agt002_workbench_job_events;
drop trigger if exists trg_psi_agt002_workbench_required_actions_append_only on public.psi_agt002_workbench_required_actions;
drop trigger if exists trg_psi_agt002_learning_proposals_append_only on public.psi_agt002_learning_proposals;
drop trigger if exists trg_psi_agt002_learning_decisions_append_only on public.psi_agt002_learning_decisions;

-- 3. Funciones nuevas de 045 (RPC públicos, asertores y RPC terminales legacy). El drop
--    retira también sus grants. Se eliminan antes de restaurar/limpiar dependencias.
drop function if exists public.psi_complete_agt002_workbench_job(uuid,uuid,uuid,jsonb);
drop function if exists public.psi_append_agt002_agent_artifact_version(uuid,uuid,uuid,uuid,uuid,text,text,jsonb);
drop function if exists public.psi_append_agt002_agent_result(uuid,uuid,uuid,jsonb);
drop function if exists public.psi_append_agt002_workbench_job_event(uuid,uuid,text,jsonb);
drop function if exists public.psi_assert_agt002_workbench_claim(uuid,uuid);
drop function if exists public.psi_claim_agt002_workbench_job(text,integer,integer,integer);
drop function if exists public.psi_review_agt002_learning_proposal(uuid,uuid,uuid,text,text,text);
drop function if exists public.psi_retry_agt002_workbench_job(uuid,uuid,uuid);
drop function if exists public.psi_get_agt002_workbench(uuid,uuid);
drop function if exists public.psi_append_agt002_workbench_message(uuid,uuid,uuid,uuid,text,jsonb,text,text,text,text,uuid,uuid);
drop function if exists public.psi_get_or_create_agt002_workbench_thread(uuid,uuid);
drop function if exists public.psi_assert_agt002_workbench_agent(uuid);
drop function if exists public.psi_assert_agt002_workbench_actor(uuid,boolean);

-- 4. Restauración de las definiciones de la migración 040 para las funciones que 045
--    reemplazó (create or replace preserva las dependencias existentes).
--    ACL: psi_record_tender_dossier_artifact_review se restaura tal cual 040 (que ya
--    concedía sólo a service_role). En cambio psi_project_tender_dossier_artifact NO se
--    restaura byte-a-byte: la migración 040 la dejó con ACL por defecto (EXECUTE implícito
--    de PUBLIC) — un defecto. Aquí se endurece intencionalmente igual que en 045 (revoke
--    de PUBLIC/anon/authenticated + grant sólo a service_role) para no reintroducir el hueco.
create or replace function public.psi_project_tender_dossier_artifact(p_artifact_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with a as (select * from public.psi_tender_dossier_artifacts where id = p_artifact_id),
  cur as (select * from public.psi_tender_dossier_artifact_versions where artifact_id = p_artifact_id order by version desc, id desc limit 1),
  cur_review as (
    select decision from public.psi_tender_dossier_artifact_reviews
    where version_id = (select id from cur) order by created_at desc, id desc limit 1),
  approved as (
    select 1 where coalesce((select decision from cur_review), 'pendiente') = 'aprobado')
  select jsonb_build_object(
    'id', a.id, 'artifact_key', a.artifact_key, 'title', a.title, 'required', a.required, 'origin', a.origin,
    'current_version', (select case when cur.id is null then null else jsonb_build_object(
      'id', cur.id, 'version', cur.version, 'content_kind', cur.content_kind,
      'content_text', cur.content_text, 'content_metadata', cur.content_metadata,
      'author_id', cur.author_id, 'created_at', cur.created_at) end from cur),
    'review_status', coalesce((select decision from cur_review), 'pendiente'),
    'has_approved_version', exists (select 1 from approved),
    'version_count', (select count(*) from public.psi_tender_dossier_artifact_versions where artifact_id = p_artifact_id)
  ) from a;
$$;

create or replace function public.psi_record_tender_dossier_artifact_review(
  p_version_id uuid, p_actor_id uuid, p_decision text, p_comment text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_version public.psi_tender_dossier_artifact_versions%rowtype;
begin
  -- Aprobar/rechazar afecta el gate: decisión de manager.
  perform public.psi_assert_tender_dossier_actor(p_actor_id, true);
  select * into v_version from public.psi_tender_dossier_artifact_versions where id = p_version_id;
  if not found then raise exception 'La versión no existe.' using errcode = 'P0002'; end if;
  perform public.psi_assert_tender_dossier_go(v_version.opportunity_id);
  if p_decision not in ('aprobado','rechazado') then raise exception 'Decisión de revisión inválida.' using errcode = '22023'; end if;
  if p_decision = 'rechazado' and nullif(btrim(p_comment), '') is null then
    raise exception 'Rechazar requiere un comentario.' using errcode = '22023';
  end if;
  insert into public.psi_tender_dossier_artifact_reviews (version_id, artifact_id, opportunity_id, decision, comment, reviewer_id)
  values (p_version_id, v_version.artifact_id, v_version.opportunity_id, p_decision, nullif(btrim(p_comment), ''), p_actor_id);
  return jsonb_build_object('artifact', public.psi_project_tender_dossier_artifact(v_version.artifact_id));
end;
$$;

revoke all on function public.psi_project_tender_dossier_artifact(uuid) from public, anon, authenticated;
grant execute on function public.psi_project_tender_dossier_artifact(uuid) to service_role;
revoke all on function public.psi_record_tender_dossier_artifact_review(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.psi_record_tender_dossier_artifact_review(uuid,uuid,text,text) to service_role;

-- 5. Retiro de las adiciones de 045 sobre psi_tender_dossier_artifact_versions. El índice
--    parcial y la FK hacia jobs se retiran antes de eliminar la tabla jobs. Sólo se
--    eliminan las columnas que 045 añadió; la tabla 040 se conserva intacta.
drop index if exists public.psi_tender_dossier_artifact_versions_agent_job_unique;
alter table public.psi_tender_dossier_artifact_versions
  drop constraint if exists psi_tender_dossier_artifact_versions_agent_job_fkey;
alter table public.psi_tender_dossier_artifact_versions
  drop constraint if exists psi_tender_dossier_artifact_versions_agent_origin_check;
alter table public.psi_tender_dossier_artifact_versions
  drop constraint if exists psi_tender_dossier_artifact_versions_author_kind_check;
alter table public.psi_tender_dossier_artifact_versions
  drop column if exists origin_agent_job_id;
alter table public.psi_tender_dossier_artifact_versions
  drop column if exists author_kind;

-- 6. FK cíclica messages<->jobs: se retira para poder eliminar las tablas en orden.
alter table if exists public.psi_agt002_workbench_messages
  drop constraint if exists psi_agt002_workbench_messages_origin_job_fkey;

-- 7. Tablas AGT-002 en orden de dependencia exacto (hijas -> padres). Los índices de
--    cada tabla se eliminan con ella.
drop table if exists public.psi_agt002_learning_decisions;
drop table if exists public.psi_agt002_learning_proposals;
drop table if exists public.psi_agt002_workbench_required_actions;
drop table if exists public.psi_agt002_workbench_job_events;
drop table if exists public.psi_agt002_workbench_message_links;
drop table if exists public.psi_agt002_workbench_jobs;
drop table if exists public.psi_agt002_workbench_messages;
drop table if exists public.psi_agt002_workbench_threads;

-- 8. Función de trigger append-only (una vez que ningún trigger la referencia).
drop function if exists public.psi_reject_agt002_workbench_mutation();

commit;
