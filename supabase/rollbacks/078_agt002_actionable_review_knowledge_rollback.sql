begin;
-- Rollback de 078 (GREEN sub-block 2A + 2B + 2C + 2D): revierte lo que el
-- sub-block 2A creó — las diez tablas de hecho de §9, sus
-- índices/FK/checks/uniques, el guard append-only, el guard dedicado de
-- upload_tickets y los dos triggers de constraint diferidos de §9.3/§9.8 —,
-- lo que 2B añadió sobre esa base: las cuatro RPC del ciclo de vida de la
-- revisión (psi_ensure_tender_actionable_review_item,
-- psi_record_tender_actionable_review_comment,
-- psi_record_tender_actionable_review_outcome,
-- psi_reopen_tender_actionable_review) y su RLS/grants en
-- psi_tender_actionable_review_items/events, lo que 2C añadió: las dos RPC
-- de ticket de carga/adjunto (psi_issue_tender_actionable_review_upload_ticket,
-- psi_complete_tender_actionable_review_attachment), sus dos funciones
-- auxiliares (psi_agt002_attachment_extension_mime_matches,
-- psi_reject_agt002_review_attachment_ticket) y el RLS/grants en
-- psi_tender_actionable_review_upload_tickets/attachments/resolution_supports,
-- y lo que 2D añadió: las seis RPC del ciclo de vida de conocimiento
-- (psi_create_tender_knowledge_candidate, psi_add_tender_knowledge_version,
-- psi_submit_tender_knowledge_version, psi_approve_tender_knowledge_version,
-- psi_reject_tender_knowledge_version,
-- psi_record_tender_knowledge_publication), sus dos funciones auxiliares
-- (psi_agt002_knowledge_version_status, psi_agt002_review_resolution_is_vigente)
-- y el RLS/grants en psi_tender_knowledge_items/versions/version_sources/
-- events/publications, y lo que 2E añadió: la única RPC de sólo lectura de
-- §16.3 (psi_select_tender_knowledge_assets). Válido sólo antes de uso productivo: falla cerrado si
-- existe cualquier fila en cualquiera de las diez tablas o si catálogo alguno
-- muestra una clave foránea externa al manifiesto de 078 apuntando a ellas
-- (§23).

do $agt002_078_preflight$
declare
  v_tables text[] := array[
    'psi_tender_actionable_review_items',
    'psi_tender_actionable_review_upload_tickets',
    'psi_tender_actionable_review_attachments',
    'psi_tender_actionable_review_events',
    'psi_tender_actionable_review_resolution_supports',
    'psi_tender_knowledge_items',
    'psi_tender_knowledge_versions',
    'psi_tender_knowledge_version_sources',
    'psi_tender_knowledge_events',
    'psi_tender_knowledge_publications'
  ];
  t text;
  v_total bigint := 0;
  v_cnt bigint;
  v_foreign_count integer;
begin
  -- 0. Anti-TOCTOU: ACCESS EXCLUSIVE sobre cada tabla de 078 que exista, antes
  --    de contar filas, así ninguna transacción concurrente puede insertar
  --    evidencia entre la verificación de datos-cero y el DDL destructivo.
  foreach t in array v_tables loop
    if to_regclass('public.' || t) is not null then
      execute format('lock table public.%I in access exclusive mode', t);
    end if;
  end loop;

  -- 1. Guarda de evidencia (tras los locks, antes de todo DDL destructivo):
  --    items, eventos, adjuntos, tickets (consumidos o no), resolution
  --    supports y las cinco tablas de conocimiento cuentan como evidencia.
  foreach t in array v_tables loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into v_cnt;
      v_total := v_total + coalesce(v_cnt, 0);
    end if;
  end loop;

  if v_total > 0 then
    raise exception using errcode = '55000', message = format(
      'Rollback de 078 abortado (fail closed): existen %s filas en las tablas de revisión accionable/conocimiento AGT-002. La evidencia de auditoría no puede destruirse.',
      v_total
    );
  end if;

  -- 2. Ninguna clave foránea externa al manifiesto de 078 puede apuntar a sus
  --    tablas — de existir, algo fuera de este sub-block ya depende de ellas.
  select count(*) into v_foreign_count
  from pg_constraint c
  where c.contype = 'f'
    and c.confrelid::regclass::text = any (
      select 'public.' || unnest(v_tables)
    )
    and c.conrelid::regclass::text <> all (
      select 'public.' || unnest(v_tables)
    );

  if v_foreign_count > 0 then
    raise exception using errcode = '55000', message =
      'Rollback de 078 abortado (fail closed): existe una clave foránea externa al manifiesto de 078 apuntando a sus tablas.';
  end if;
end
$agt002_078_preflight$;

-- 2e. RPC de sólo lectura de §16.3 (sub-block 2E), creada después de todo lo
--     anterior; se retira primero. Su grant/EXECUTE se retira junto con la
--     función.
drop function if exists public.psi_select_tender_knowledge_assets(timestamptz);

-- 2d. RPC del ciclo de vida de conocimiento (sub-block 2D) y sus dos
--     funciones auxiliares, en orden inverso de creación. Sus grants/EXECUTE
--     se retiran junto con la función.
drop function if exists public.psi_record_tender_knowledge_publication(uuid, text, text, text, text, text, text, text, text, text, uuid, uuid, text);
drop function if exists public.psi_reject_tender_knowledge_version(uuid, uuid, text, uuid, text);
drop function if exists public.psi_approve_tender_knowledge_version(uuid, uuid, uuid, text);
drop function if exists public.psi_submit_tender_knowledge_version(uuid, uuid, uuid, text);
drop function if exists public.psi_add_tender_knowledge_version(uuid, uuid, uuid, text, date, date, date, text[], text, boolean, uuid, text, uuid, text);
drop function if exists public.psi_create_tender_knowledge_candidate(uuid, uuid, uuid, text, text, text, date, date, date, text[], text, boolean, uuid, text, uuid, text);
drop function if exists public.psi_agt002_review_resolution_is_vigente(uuid, uuid);
drop function if exists public.psi_agt002_knowledge_version_status(uuid);

-- 2c. RPC de ticket de carga/adjunto (sub-block 2C) y sus dos funciones
--     auxiliares, en orden inverso de creación. Sus grants/EXECUTE se
--     retiran junto con la función.
drop function if exists public.psi_complete_tender_actionable_review_attachment(uuid, text, uuid, text, bigint, text, text, uuid, text);
drop function if exists public.psi_issue_tender_actionable_review_upload_ticket(uuid, uuid, uuid, uuid, integer, text, text, text, bigint, text, text, uuid, text, text);
drop function if exists public.psi_reject_agt002_review_attachment_ticket();
drop function if exists public.psi_agt002_attachment_extension_mime_matches(text, text);

-- 2b. RPC del ciclo de vida de la revisión (sub-block 2B), en orden inverso
--     de creación. Sus grants/EXECUTE se retiran junto con la función.
drop function if exists public.psi_reopen_tender_actionable_review(uuid, uuid, text, uuid, text, bigint);
drop function if exists public.psi_record_tender_actionable_review_outcome(uuid, uuid, text, text, boolean, uuid, text, bigint);
drop function if exists public.psi_record_tender_actionable_review_comment(uuid, uuid, text, uuid, text, bigint);
drop function if exists public.psi_ensure_tender_actionable_review_item(uuid, uuid, uuid, text, text, text, text, uuid);

-- 3. Triggers explícitos (cada uno fue instalado como "... for each row execute function ...";
--    se retiran aquí de forma explícita aunque el DROP TABLE que sigue también los eliminaría).
drop trigger if exists ctrg_psi_tender_knowledge_version_sources_sources on public.psi_tender_knowledge_version_sources;
drop trigger if exists ctrg_psi_tender_knowledge_versions_sources on public.psi_tender_knowledge_versions;
drop trigger if exists ctrg_psi_tender_actionable_review_events_bijection on public.psi_tender_actionable_review_events;
drop trigger if exists ctrg_psi_tender_actionable_review_attachments_bijection on public.psi_tender_actionable_review_attachments;
drop trigger if exists trg_psi_tender_actionable_review_upload_tickets_guard on public.psi_tender_actionable_review_upload_tickets;
drop trigger if exists trg_psi_tender_knowledge_publications_append_only on public.psi_tender_knowledge_publications;
drop trigger if exists trg_psi_tender_knowledge_events_append_only on public.psi_tender_knowledge_events;
drop trigger if exists trg_psi_tender_knowledge_version_sources_append_only on public.psi_tender_knowledge_version_sources;
drop trigger if exists trg_psi_tender_knowledge_versions_append_only on public.psi_tender_knowledge_versions;
drop trigger if exists trg_psi_tender_knowledge_items_append_only on public.psi_tender_knowledge_items;
drop trigger if exists trg_psi_tender_actionable_review_resolution_supports_append_only on public.psi_tender_actionable_review_resolution_supports;
drop trigger if exists trg_psi_tender_actionable_review_attachments_append_only on public.psi_tender_actionable_review_attachments;
drop trigger if exists trg_psi_tender_actionable_review_events_append_only on public.psi_tender_actionable_review_events;
drop trigger if exists trg_psi_tender_actionable_review_items_append_only on public.psi_tender_actionable_review_items;

-- 4. Tablas de 078 en orden de dependencia exacto (hijas -> padres). Cada
--    DROP TABLE retira también sus propios índices, checks, uniques y FKs.
drop table if exists public.psi_tender_knowledge_publications;
drop table if exists public.psi_tender_knowledge_events;
drop table if exists public.psi_tender_knowledge_version_sources;
drop table if exists public.psi_tender_knowledge_versions;
drop table if exists public.psi_tender_knowledge_items;
drop table if exists public.psi_tender_actionable_review_resolution_supports;
drop table if exists public.psi_tender_actionable_review_events;
drop table if exists public.psi_tender_actionable_review_attachments;
drop table if exists public.psi_tender_actionable_review_upload_tickets;
drop table if exists public.psi_tender_actionable_review_items;

-- 5. Funciones de 078 (una vez que ningún trigger ni tabla las referencia).
drop function if exists public.psi_check_agt002_knowledge_version_sources();
drop function if exists public.psi_check_agt002_review_attachment_bijection();
drop function if exists public.psi_guard_agt002_review_upload_ticket_mutation();
drop function if exists public.psi_block_agt002_actionable_review_mutation();
drop function if exists public.psi_agt002_knowledge_tags_are_valid(text[]);

-- 6. Verificación de catálogo antes de commit (§23.6): cero tablas y cero
--    funciones con los nombres de 078 deben permanecer; cualquier resto hace
--    fallar la propia transacción de rollback en vez de dejar estado parcial.
do $agt002_078_postcheck$
declare
  v_tables text[] := array[
    'psi_tender_actionable_review_items',
    'psi_tender_actionable_review_upload_tickets',
    'psi_tender_actionable_review_attachments',
    'psi_tender_actionable_review_events',
    'psi_tender_actionable_review_resolution_supports',
    'psi_tender_knowledge_items',
    'psi_tender_knowledge_versions',
    'psi_tender_knowledge_version_sources',
    'psi_tender_knowledge_events',
    'psi_tender_knowledge_publications'
  ];
  t text;
  v_leftover_tables integer := 0;
begin
  foreach t in array v_tables loop
    if to_regclass('public.' || t) is not null then
      v_leftover_tables := v_leftover_tables + 1;
    end if;
  end loop;

  if v_leftover_tables > 0 then
    raise exception using errcode = '55000', message =
      'Rollback de 078 no eliminó todas sus tablas; abortando para no dejar un estado parcial.';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'psi_block_agt002_actionable_review_mutation',
      'psi_guard_agt002_review_upload_ticket_mutation',
      'psi_check_agt002_review_attachment_bijection',
      'psi_check_agt002_knowledge_version_sources',
      'psi_agt002_knowledge_tags_are_valid',
      'psi_ensure_tender_actionable_review_item',
      'psi_record_tender_actionable_review_comment',
      'psi_record_tender_actionable_review_outcome',
      'psi_reopen_tender_actionable_review',
      'psi_issue_tender_actionable_review_upload_ticket',
      'psi_complete_tender_actionable_review_attachment',
      'psi_reject_agt002_review_attachment_ticket',
      'psi_agt002_attachment_extension_mime_matches',
      'psi_create_tender_knowledge_candidate',
      'psi_add_tender_knowledge_version',
      'psi_submit_tender_knowledge_version',
      'psi_approve_tender_knowledge_version',
      'psi_reject_tender_knowledge_version',
      'psi_record_tender_knowledge_publication',
      'psi_agt002_knowledge_version_status',
      'psi_agt002_review_resolution_is_vigente',
      'psi_select_tender_knowledge_assets'
    )
  ) then
    raise exception using errcode = '55000', message =
      'Rollback de 078 no eliminó todas sus funciones; abortando para no dejar un estado parcial.';
  end if;
end
$agt002_078_postcheck$;

commit;
