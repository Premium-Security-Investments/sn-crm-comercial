-- AGT-002 "Análisis para decidir" -> traspaso al expediente operativo post-GO, fase 2 SQL.
-- Consume el lote puro de server/agt002-dossier-handoff.js (deriveAgt002DossierHandoff) y lo
-- proyecta hacia psi_tender_dossier_items (040) mediante una RPC service-role-only. Additive:
-- no cambia el contrato de 040/041/042 (seed_go/human siguen intactos), no reclasifica
-- materialidad ni recalcula ningún hash (esos son responsabilidad exclusiva de
-- deriveAgt002DossierHandoff / buildActionableReviewIntegralUnitSource en JS: §6.4 del
-- contrato agt002-actionable-review-json-v1), y no introduce ningún wrapper de GO ni backfill.
--
-- Tampoco CONFÍA en ese hash para nada que no sea auditoría: la idempotencia de proveniencia y el
-- evento requirement_changed se deciden exclusivamente con `source_payload`, la unidad V3 exacta
-- que esta misma transacción lee de la corrida anclada. Ver §2.
begin;

-- 1. Origin ampliado (no acumulativo: se re-declara con la lista completa, patrón 040 §event_type).
alter table public.psi_tender_dossier_items
  drop constraint if exists psi_tender_dossier_items_origin_check;
alter table public.psi_tender_dossier_items
  add constraint psi_tender_dossier_items_origin_check
  check (origin in ('seed_go', 'human', 'seed_agt002_post_go'));

-- 2. Proveniencia append-only: qué unidad V3 exacta, de qué corrida/decisión, sustenta cada
-- pendiente humano sembrado por AGT-002. Nunca se actualiza ni se borra: una nueva corrida que
-- reconfirma o cambia el requisito añade una fila nueva, nunca reescribe la anterior.
--
-- `source_payload` es la ÚNICA base de comportamiento: la unidad V3 exacta leída por esta misma
-- transacción desde `psi_tender_analysis_runs.result` (jamás nada suministrado por el llamador).
-- `source_hash` se conserva como dato auditivo suministrado por Node (§6.4 del contrato
-- agt002-actionable-review-json-v1) pero NO gobierna ni la idempotencia ni el evento
-- requirement_changed: un hash arbitrario sobre una unidad idéntica no puede fabricar un cambio,
-- y un hash distinto sobre una repetición exacta no puede duplicar proveniencia.
create table if not exists public.psi_tender_dossier_agt002_sources (
  id uuid primary key default gen_random_uuid(),
  dossier_item_id uuid not null references public.psi_tender_dossier_items(id) on delete restrict,
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  decision_id uuid not null references public.psi_tender_go_no_go_decisions(id) on delete restrict,
  analysis_run_id uuid not null references public.psi_tender_analysis_runs(id) on delete restrict,
  source_kind text not null check (source_kind = 'integral_unit'),
  source_id text not null check (nullif(btrim(source_id), '') is not null),
  requirement_id text not null check (nullif(btrim(requirement_id), '') is not null),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  source_payload jsonb not null check (jsonb_typeof(source_payload) = 'object'),
  actor_id uuid not null references public.psi_sales_profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
-- Reejecutable: si la tabla ya existía sin la columna, añadirla NOT NULL sólo puede tener éxito
-- mientras esté vacía. Eso es deliberado: no existe forma honesta de reconstruir a posteriori la
-- unidad V3 exacta que sustentó una fila histórica, y un default sintético sería justamente el
-- "valor no verificado que gobierna comportamiento" que esta columna elimina.
alter table public.psi_tender_dossier_agt002_sources
  add column if not exists source_payload jsonb not null;

-- Identidad de repetición: (dossier_item_id, analysis_run_id, source_id). El hash NO participa,
-- así que repetir la MISMA unidad de la MISMA corrida es siempre un no-op, incluso si el llamador
-- envía un source_hash distinto. Declarada fuera de CREATE TABLE para que la migración siga siendo
-- reejecutable sobre una tabla que ya llevara la clave anterior de cuatro columnas.
alter table public.psi_tender_dossier_agt002_sources
  drop constraint if exists psi_tender_dossier_agt002_sources_identity_key;
alter table public.psi_tender_dossier_agt002_sources
  add constraint psi_tender_dossier_agt002_sources_identity_key
  unique (dossier_item_id, analysis_run_id, source_id);
create index if not exists psi_tender_dossier_agt002_sources_opportunity_requirement_idx
  on public.psi_tender_dossier_agt002_sources (opportunity_id, requirement_id, created_at desc);
create index if not exists psi_tender_dossier_agt002_sources_item_idx
  on public.psi_tender_dossier_agt002_sources (dossier_item_id, created_at desc, id desc);

create or replace function public.psi_tender_dossier_agt002_sources_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'psi_tender_dossier_agt002_sources is append-only: UPDATE and DELETE are prohibited';
end;
$$;
drop trigger if exists psi_tender_dossier_agt002_sources_immutable on public.psi_tender_dossier_agt002_sources;
create trigger psi_tender_dossier_agt002_sources_immutable
  before update or delete on public.psi_tender_dossier_agt002_sources
  for each row execute function public.psi_tender_dossier_agt002_sources_prevent_mutation();

-- RLS + grants: mismo patrón que 040 (defensa en profundidad: service_role conserva
-- visibilidad para que un UPDATE/DELETE directo llegue al trigger de inmutabilidad; el INSERT
-- de fila nunca se concede a nivel de tabla, sólo a través de la RPC security definer).
alter table public.psi_tender_dossier_agt002_sources enable row level security;
revoke all on table public.psi_tender_dossier_agt002_sources from public;
revoke all on table public.psi_tender_dossier_agt002_sources from anon;
revoke all on table public.psi_tender_dossier_agt002_sources from authenticated;
drop policy if exists psi_tender_dossier_agt002_sources_service_role_rw on public.psi_tender_dossier_agt002_sources;
create policy psi_tender_dossier_agt002_sources_service_role_rw on public.psi_tender_dossier_agt002_sources
  for all to service_role using (true) with check (true);
revoke all on table public.psi_tender_dossier_agt002_sources from service_role;
grant select on table public.psi_tender_dossier_agt002_sources to service_role;
grant update, delete on table public.psi_tender_dossier_agt002_sources to service_role;

-- 3. RPC de sincronización. Recibe el lote ya derivado (puro, en JS) de
-- deriveAgt002DossierHandoff y lo proyecta de forma idempotente. Nunca decide materialidad ni
-- recalcula source_hash: sólo revalida que cada candidato une exactamente a una unidad V3
-- tender_requirement elegible (mismo requirement_id, closure.status presente y distinto de
-- evidence_satisfied) DENTRO del analysis_units del run indicado, y que ese run es exactamente
-- el análisis vigente anclado a la decisión GO vigente de la oportunidad.
create or replace function public.psi_sync_agt002_post_go_checklist(
  p_opportunity_id uuid,
  p_actor_id uuid,
  p_decision_id uuid,
  p_analysis_run_id uuid,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tender_id uuid;
  v_decision public.psi_tender_go_no_go_decisions%rowtype;
  v_run public.psi_tender_analysis_runs%rowtype;
  v_state public.psi_tender_document_state%rowtype;
  v_units jsonb;
  v_item jsonb;
  v_seen_keys text[] := array[]::text[];
  v_key text;
  v_requirement_id text;
  v_match_count integer;
  v_results jsonb := '[]'::jsonb;
  v_dossier_item_id uuid;
  v_new_item_id uuid;
  v_existing_item public.psi_tender_dossier_items%rowtype;
  v_new_source_id uuid;
  v_source_id text;
  v_source_hash text;
  v_source_payload jsonb;
  v_title text;
  v_instruction text;
  v_status text;
  v_item_created boolean;
  v_source_inserted boolean;
  v_requirement_changed boolean;
  v_previous_payload jsonb;
  v_current_status text;
begin
  -- Autorización: humano activo con permiso licitaciones dentro del techo (helper de 040).
  perform public.psi_assert_tender_dossier_actor(p_actor_id, false);

  -- Cierre de la ventana TOCTOU: TODA la resolución posterior (decisión GO vigente, cadena de
  -- supersesión, corrida anclada, snapshot documental vigente) se lee bajo un row lock sobre la
  -- oportunidad. Sin él, otra transacción puede registrar un NO-GO —o un GO anclado a otra
  -- corrida— entre la validación y la escritura, y este lote se sembraría contra un estado que
  -- ya dejó de ser cierto. Se toma ANTES de resolver nada, no después.
  perform 1 from public.psi_sales_opportunities where id = p_opportunity_id for update;

  -- Decisión GO vigente (no superada) de la oportunidad (helper de 040).
  v_tender_id := public.psi_assert_tender_dossier_go(p_opportunity_id);

  select * into v_decision
    from public.psi_tender_go_no_go_decisions d
    where d.opportunity_id = p_opportunity_id and d.tender_id = v_tender_id
      and not exists (select 1 from public.psi_tender_go_no_go_decisions c where c.supersedes_decision_id = d.id)
    order by d.decided_at desc, d.id desc limit 1;
  if not found or v_decision.id is distinct from p_decision_id or v_decision.decision is distinct from 'go' then
    raise exception 'La decisión indicada no es la decisión GO vigente de la oportunidad.' using errcode = '22023';
  end if;
  if v_decision.analysis_run_id is distinct from p_analysis_run_id then
    raise exception 'El análisis indicado no es el análisis anclado a la decisión GO vigente.' using errcode = '22023';
  end if;

  select * into v_run from public.psi_tender_analysis_runs
    where id = p_analysis_run_id and opportunity_id = p_opportunity_id and tender_id = v_tender_id;
  if not found or v_run.status is distinct from 'completed' or v_run.canonical is not true then
    raise exception 'El análisis indicado debe ser una corrida canónica AGT-002 completada.' using errcode = '22023';
  end if;

  -- "Vigente" según el esquema: el snapshot de la corrida es el snapshot actual de la
  -- oportunidad y no hay una actualización documental en curso (mismo criterio de anclaje que
  -- psi_record_tender_go_no_go usa al decidir, migración 027).
  select * into v_state from public.psi_tender_document_state where opportunity_id = p_opportunity_id;
  if not found or v_state.refresh_in_progress or v_state.current_snapshot_id is distinct from v_run.snapshot_id then
    raise exception 'El análisis indicado ya no es el análisis vigente del conjunto documental de la oportunidad.' using errcode = '55000';
  end if;

  if jsonb_typeof(v_run.result -> 'integral_analysis' -> 'analysis_units') is distinct from 'array' then
    raise exception 'La corrida indicada no tiene un análisis integral V3 estructurado.' using errcode = '22023';
  end if;
  v_units := v_run.result -> 'integral_analysis' -> 'analysis_units';

  -- p_items no tiene valor por defecto: todo llamador lo pasa explícitamente. NULL es un error
  -- del llamador; un arreglo vacío explícito es un no-op legítimo (ninguna mutación, resultado
  -- items:[]), nunca un error.
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items debe ser un arreglo JSON.' using errcode = '22023';
  end if;

  -- Pasada 1: valida el lote COMPLETO antes de mutar ninguna fila (all-or-nothing). Cada
  -- elemento debe exponer exactamente las claves cerradas siguientes.
  for v_item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Cada elemento de p_items debe ser un objeto JSON.' using errcode = '22023';
    end if;
    if array(select jsonb_object_keys(v_item) order by 1) <> array[
      'instruction','item_key','required','requirement_id','source_hash','source_id','source_kind','status','title'
    ]::text[] then
      raise exception 'Cada elemento de p_items debe tener exactamente las claves cerradas exigidas.' using errcode = '22023';
    end if;

    v_requirement_id := v_item->>'requirement_id';
    if nullif(btrim(coalesce(v_requirement_id, '')), '') is null then
      raise exception 'requirement_id es obligatorio en cada elemento de p_items.' using errcode = '22023';
    end if;

    v_key := v_item->>'item_key';
    if v_key is distinct from ('agt002_post_go:' || v_requirement_id) then
      raise exception 'item_key debe ser exactamente agt002_post_go:<requirement_id>.' using errcode = '22023';
    end if;
    if length(v_key) > 200 then
      raise exception 'item_key resultante excede 200 caracteres: %.', v_key using errcode = '22023';
    end if;
    if v_key = any(v_seen_keys) then
      raise exception 'item_key duplicado dentro del mismo lote: %.', v_key using errcode = '22023';
    end if;
    v_seen_keys := array_append(v_seen_keys, v_key);

    if jsonb_typeof(v_item->'required') is distinct from 'boolean' or (v_item->>'required') is distinct from 'true' then
      raise exception 'required debe ser true en cada elemento de p_items.' using errcode = '22023';
    end if;
    if (v_item->>'status') not in ('pendiente', 'bloqueado') then
      raise exception 'status debe ser pendiente o bloqueado.' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(v_item->>'title', '')), '') is null or length(v_item->>'title') > 400 then
      raise exception 'title es obligatorio (máx. 400 caracteres).' using errcode = '22023';
    end if;
    if jsonb_typeof(v_item->'instruction') not in ('null', 'string') then
      raise exception 'instruction debe ser texto o null.' using errcode = '22023';
    end if;
    if jsonb_typeof(v_item->'instruction') = 'string'
       and (nullif(btrim(v_item->>'instruction'), '') is null or length(v_item->>'instruction') > 2000) then
      raise exception 'instruction, si es texto, debe ser no vacío (máx. 2000 caracteres).' using errcode = '22023';
    end if;
    if (v_item->>'source_kind') is distinct from 'integral_unit' then
      raise exception 'source_kind debe ser integral_unit.' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(v_item->>'source_id', '')), '') is null then
      raise exception 'source_id es obligatorio.' using errcode = '22023';
    end if;
    if (v_item->>'source_hash') !~ '^[0-9a-f]{64}$' then
      raise exception 'source_hash debe ser SHA-256 hexadecimal en minúscula.' using errcode = '22023';
    end if;

    -- Revalidación estructural fail-closed contra la proyección canónica del run: exactamente
    -- una unidad V3 tender_requirement con el mismo requirement_id y closure.status presente
    -- distinto de evidence_satisfied. Nunca recalcula source_hash: eso es exclusivo de
    -- buildActionableReviewIntegralUnitSource en JS (§6.4).
    select count(*) into v_match_count
      from jsonb_array_elements(v_units) as u
      where u->>'unit_id' = v_item->>'source_id'
        and u->>'requirement_id' = v_requirement_id
        and u->>'unit_kind' = 'tender_requirement'
        and jsonb_typeof(u->'closure') = 'object'
        and nullif(btrim(u->'closure'->>'status'), '') is not null
        and (u->'closure'->>'status') is distinct from 'evidence_satisfied';
    if v_match_count <> 1 then
      raise exception 'requirement_id % / source_id % no corresponde a exactamente una unidad V3 tender_requirement elegible de la corrida indicada.',
        v_requirement_id, v_item->>'source_id' using errcode = '22023';
    end if;
  end loop;

  -- Pasada 2: toda validación anterior ya pasó para el lote completo; muta.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_key := v_item->>'item_key';
    v_requirement_id := v_item->>'requirement_id';
    v_title := v_item->>'title';
    v_instruction := case when jsonb_typeof(v_item->'instruction') = 'string' then nullif(btrim(v_item->>'instruction'), '') else null end;
    v_status := v_item->>'status';
    v_source_id := v_item->>'source_id';
    v_source_hash := v_item->>'source_hash';
    v_item_created := false;
    v_new_item_id := null;
    v_new_source_id := null;

    -- Payload de proveniencia: la unidad V3 EXACTA de v_run.result que la pasada 1 ya probó única
    -- y elegible. Se deriva aquí, en SQL, desde la corrida leída por esta misma transacción —
    -- nunca desde nada que traiga p_items. Es el único valor que gobierna comportamiento.
    select jsonb_build_object('source_kind', 'integral_unit') || u into v_source_payload
      from jsonb_array_elements(v_units) as u
      where u->>'unit_id' = v_source_id
        and u->>'requirement_id' = v_requirement_id
        and u->>'unit_kind' = 'tender_requirement'
        and jsonb_typeof(u->'closure') = 'object'
        and nullif(btrim(u->'closure'->>'status'), '') is not null
        and (u->'closure'->>'status') is distinct from 'evidence_satisfied';
    if v_source_payload is null then
      raise exception 'No se pudo derivar la unidad V3 de origen para requirement_id % / source_id %.',
        v_requirement_id, v_source_id using errcode = '55000';
    end if;

    select id into v_dossier_item_id from public.psi_tender_dossier_items
      where opportunity_id = p_opportunity_id and item_key = v_key;

    if v_dossier_item_id is null then
      insert into public.psi_tender_dossier_items (
        opportunity_id, tender_id, item_key, title, item_type, required, origin, created_by
      ) values (
        p_opportunity_id, v_tender_id, v_key, v_title, 'pendiente_humano', true, 'seed_agt002_post_go', p_actor_id
      )
      on conflict (opportunity_id, item_key) do nothing
      returning id into v_new_item_id;

      if v_new_item_id is not null then
        v_dossier_item_id := v_new_item_id;
        insert into public.psi_tender_dossier_item_actions (
          item_id, opportunity_id, action_type, to_status, applicability, note, actor_id
        ) values (
          v_dossier_item_id, p_opportunity_id, 'created', v_status, 'requerido', v_instruction, p_actor_id
        );
        v_item_created := true;
      end if;
    end if;

    if not v_item_created then
      -- Fila preexistente, o perdida por ON CONFLICT frente a una transacción concurrente. En
      -- ambos casos el traspaso NUNCA adopta una fila ajena: la bloquea y exige que sea
      -- exactamente una fila sembrada por este mismo traspaso, de esta oportunidad/licitación.
      -- Cualquier otra cosa (un ítem humano que ocupó la clave, otro tipo, otro alcance) aborta
      -- el lote completo y revierte la transacción. El lock es lo que impide que un squatter
      -- creado entre la lectura y la escritura se cuele sin revalidar.
      select * into v_existing_item from public.psi_tender_dossier_items
        where opportunity_id = p_opportunity_id and item_key = v_key for update;
      if not found then
        raise exception 'El ítem % dejó de existir durante la sincronización.', v_key using errcode = '55000';
      end if;
      if v_existing_item.origin is distinct from 'seed_agt002_post_go'
         or v_existing_item.item_type is distinct from 'pendiente_humano'
         or v_existing_item.required is distinct from true
         or v_existing_item.opportunity_id is distinct from p_opportunity_id
         or v_existing_item.tender_id is distinct from v_tender_id then
        raise exception 'El item_key % ya pertenece a un ítem que no fue sembrado por el traspaso AGT-002: el traspaso no adopta ítems ajenos.',
          v_key using errcode = '23505';
      end if;
      v_dossier_item_id := v_existing_item.id;
    end if;

    -- Repetición exacta no duplica item/source/action: si el ítem ya existía, ni su
    -- título/status/required ni sus estados humanos se tocan aquí.
    select source_payload into v_previous_payload from public.psi_tender_dossier_agt002_sources
      where dossier_item_id = v_dossier_item_id
      order by created_at desc, id desc limit 1;

    insert into public.psi_tender_dossier_agt002_sources (
      dossier_item_id, opportunity_id, tender_id, decision_id, analysis_run_id,
      source_kind, source_id, requirement_id, source_hash, source_payload, actor_id
    ) values (
      v_dossier_item_id, p_opportunity_id, v_tender_id, p_decision_id, p_analysis_run_id,
      'integral_unit', v_source_id, v_requirement_id, v_source_hash, v_source_payload, p_actor_id
    )
    on conflict (dossier_item_id, analysis_run_id, source_id) do nothing
    returning id into v_new_source_id;
    v_source_inserted := v_new_source_id is not null;

    -- El cambio de requisito se decide comparando la unidad V3 anterior con la actual (jsonb, por
    -- valor y estable frente al orden de claves), nunca el source_hash suministrado por Node.
    v_requirement_changed := false;
    if v_source_inserted and not v_item_created and v_previous_payload is not null and v_previous_payload is distinct from v_source_payload then
      select (public.psi_project_tender_dossier_item(v_dossier_item_id)->>'status') into v_current_status;
      insert into public.psi_tender_dossier_item_actions (
        item_id, opportunity_id, action_type, to_status, note, actor_id
      ) values (
        v_dossier_item_id, p_opportunity_id, 'requirement_changed', v_current_status,
        'El análisis AGT-002 produjo una nueva versión de este requisito; el estado humano se conserva.', p_actor_id
      );
      v_requirement_changed := true;
    end if;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'item_key', v_key, 'item_id', v_dossier_item_id, 'item_created', v_item_created,
      'source_recorded', v_source_inserted, 'requirement_changed', v_requirement_changed
    ));
  end loop;

  return jsonb_build_object(
    'opportunity_id', p_opportunity_id, 'decision_id', p_decision_id, 'analysis_run_id', p_analysis_run_id,
    'items', v_results
  );
end;
$$;

revoke all on function public.psi_sync_agt002_post_go_checklist(uuid, uuid, uuid, uuid, jsonb) from public;
revoke all on function public.psi_sync_agt002_post_go_checklist(uuid, uuid, uuid, uuid, jsonb) from anon;
revoke all on function public.psi_sync_agt002_post_go_checklist(uuid, uuid, uuid, uuid, jsonb) from authenticated;
grant execute on function public.psi_sync_agt002_post_go_checklist(uuid, uuid, uuid, uuid, jsonb) to service_role;

-- 5. Proyección extendida (create or replace: preserva TODOS los campos de 040/042 y añade
-- instruction/analysis_source). Readiness (042) sigue leyendo únicamente status/applicability
-- de esta proyección, así que queda intacta.
create or replace function public.psi_project_tender_dossier_item(p_item_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with i as (select * from public.psi_tender_dossier_items where id = p_item_id),
  st as (
    select to_status from public.psi_tender_dossier_item_actions
    where item_id = p_item_id and to_status is not null order by created_at desc, id desc limit 1),
  ap as (
    select applicability from public.psi_tender_dossier_item_actions
    where item_id = p_item_id and applicability is not null order by created_at desc, id desc limit 1),
  asg as (
    select a.assignee_id, pr.full_name from public.psi_tender_dossier_item_actions a
    left join public.psi_sales_profiles pr on pr.id = a.assignee_id
    where a.item_id = p_item_id and a.action_type = 'assigned' order by a.created_at desc, a.id desc limit 1),
  td as (
    select target_date from public.psi_tender_dossier_item_actions
    where item_id = p_item_id and target_date is not null order by created_at desc, id desc limit 1),
  ev as (
    select evidence_kind, evidence_text, evidence_url, created_at from public.psi_tender_dossier_item_actions
    where item_id = p_item_id and action_type = 'evidence_attached' order by created_at desc, id desc limit 1),
  first_created as (
    select note from public.psi_tender_dossier_item_actions
    where item_id = p_item_id and action_type = 'created' order by created_at asc, id asc limit 1),
  src as (
    select decision_id, analysis_run_id, source_id, requirement_id
    from public.psi_tender_dossier_agt002_sources
    where dossier_item_id = p_item_id order by created_at desc, id desc limit 1)
  select jsonb_build_object(
    'id', i.id, 'item_key', i.item_key, 'title', i.title, 'item_type', i.item_type,
    'required', i.required, 'origin', i.origin,
    'status', coalesce((select to_status from st), 'pendiente'),
    'applicability', coalesce((select applicability from ap), 'requerido'),
    'assignee_id', (select assignee_id from asg), 'assignee_name', (select full_name from asg),
    'target_date', (select target_date from td),
    'latest_evidence', (select case when ev.evidence_kind is null then null else jsonb_build_object(
      'kind', ev.evidence_kind, 'text', ev.evidence_text, 'url', ev.evidence_url, 'at', ev.created_at) end from ev),
    'instruction', (select note from first_created),
    'analysis_source', (select jsonb_build_object(
      'decision_id', s.decision_id, 'analysis_run_id', s.analysis_run_id,
      'source_id', s.source_id, 'requirement_id', s.requirement_id) from src s)
  ) from i;
$$;

-- 040 definió esta proyección sin grants explícitos, de modo que heredaba el EXECUTE por defecto
-- de PUBLIC: siendo SECURITY DEFINER, cualquier rol (anon incluido) podía leer el estado completo
-- de cualquier ítem del expediente conociendo su uuid, saltándose RLS. 082 la cierra al mismo
-- patrón del resto del expediente. Todos sus llamadores (psi_get_tender_dossier_workspace y
-- psi_evaluate_tender_dossier_readiness en 040/042, y esta migración) son SECURITY DEFINER del
-- mismo dueño, así que ninguno depende del privilegio del rol invocante.
revoke all on function public.psi_project_tender_dossier_item(uuid) from public;
revoke all on function public.psi_project_tender_dossier_item(uuid) from anon;
revoke all on function public.psi_project_tender_dossier_item(uuid) from authenticated;
grant execute on function public.psi_project_tender_dossier_item(uuid) to service_role;

-- 5 bis. Espacio de claves reservado (anti item-key squatting). Misma lógica que 040, más un
-- único rechazo fail-closed: la creación manual de ítems no puede ocupar una clave
-- `agt002_post_go:*`. Sin esto, un humano autorizado podía crear de antemano un ítem con la clave
-- exacta que el traspaso iba a sembrar (origin 'human', item_type/required a su gusto) y hacer que
-- la sincronización lo adoptara, colgando proveniencia AGT-002 de una fila que AGT-002 nunca
-- sembró. La segunda mitad de la defensa vive en psi_sync_agt002_post_go_checklist, que revalida
-- bajo lock la fila que encuentra en vez de adoptarla.
create or replace function public.psi_create_tender_dossier_item(
  p_opportunity_id uuid, p_actor_id uuid, p_item_key text, p_title text, p_item_type text, p_required boolean
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tender_id uuid; v_item_id uuid;
begin
  perform public.psi_assert_tender_dossier_actor(p_actor_id, false);
  v_tender_id := public.psi_assert_tender_dossier_go(p_opportunity_id);
  if p_item_type is null or p_item_type not in ('documento','pendiente_humano','general') then
    raise exception 'Tipo de ítem inválido.' using errcode = '22023';
  end if;
  if nullif(btrim(p_title), '') is null then
    raise exception 'El ítem requiere un título.' using errcode = '22023';
  end if;
  if left(btrim(coalesce(p_item_key, '')), 15) = 'agt002_post_go:' then
    raise exception 'El prefijo agt002_post_go: está reservado al traspaso del análisis AGT-002 y no puede crearse a mano.'
      using errcode = '42501';
  end if;
  insert into public.psi_tender_dossier_items (opportunity_id, tender_id, item_key, title, item_type, required, origin, created_by)
  values (p_opportunity_id, v_tender_id, btrim(p_item_key), btrim(p_title), p_item_type, coalesce(p_required, false), 'human', p_actor_id)
  on conflict (opportunity_id, item_key) do nothing
  returning id into v_item_id;
  if v_item_id is null then
    select id into v_item_id from public.psi_tender_dossier_items where opportunity_id = p_opportunity_id and item_key = btrim(p_item_key);
  else
    insert into public.psi_tender_dossier_item_actions (item_id, opportunity_id, action_type, to_status, applicability, actor_id)
    values (v_item_id, p_opportunity_id, 'created', 'pendiente', 'requerido', p_actor_id);
  end if;
  return jsonb_build_object('item', public.psi_project_tender_dossier_item(v_item_id));
end;
$$;

revoke all on function public.psi_create_tender_dossier_item(uuid,uuid,text,text,text,boolean) from public;
revoke all on function public.psi_create_tender_dossier_item(uuid,uuid,text,text,text,boolean) from anon;
revoke all on function public.psi_create_tender_dossier_item(uuid,uuid,text,text,text,boolean) from authenticated;
grant execute on function public.psi_create_tender_dossier_item(uuid,uuid,text,text,text,boolean) to service_role;

-- 6. Cableado atómico del GO (fase 3A). Overload de nueve argumentos: ejecuta el wrapper vigente
-- de ocho argumentos (siembra 041 incluida) y, EN LA MISMA transacción, si la decisión es GO y
-- p_agt002_items no es null, sincroniza ese lote ya derivado (puro, en JS, por
-- deriveAgt002DossierHandoff) contra la decisión GO recién registrada por este mismo llamado. No
-- hay reconsulta de la cadena de supersesión: la decisión GO vigente es, de forma segura,
-- v_result->>'decision_id' — la que este mismo llamado acaba de insertar, nunca una leída aparte
-- que pudiera haber avanzado bajo concurrencia. NO-GO nunca sincroniza, sin importar lo que traiga
-- p_agt002_items. Cualquier fallo de psi_sync_agt002_post_go_checklist propaga su excepción sin
-- capturarla: al ser una única función PL/pgSQL sin manejo de excepción propio, eso revierte
-- también la decisión y la siembra 041 de este mismo llamado (atomicidad). La DEFINICIÓN del
-- overload de ocho argumentos queda intacta (041 sigue siendo su única dueña); lo único que cambia
-- es su grant, que §7 retira a service_role una vez este overload existe.
create or replace function public.psi_record_tender_go_no_go(
  p_opportunity_id uuid, p_tender_id uuid, p_actor_id uuid, p_decision text,
  p_analysis_run_id uuid, p_justification text, p_preparation jsonb, p_document_hash text,
  p_agt002_items jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_result jsonb;
  v_decision_id uuid;
  v_sync_result jsonb;
begin
  v_result := public.psi_record_tender_go_no_go(
    p_opportunity_id, p_tender_id, p_actor_id, p_decision,
    p_analysis_run_id, p_justification, p_preparation, p_document_hash);

  if p_decision = 'go' and p_agt002_items is not null then
    v_decision_id := (v_result->>'decision_id')::uuid;
    v_sync_result := public.psi_sync_agt002_post_go_checklist(
      p_opportunity_id, p_actor_id, v_decision_id, p_analysis_run_id, p_agt002_items);
    v_result := v_result || jsonb_build_object('agt002_handoff', jsonb_build_object(
      'synced', true,
      'items_synced', jsonb_array_length(coalesce(v_sync_result -> 'items', '[]'::jsonb))
    ));
  else
    v_result := v_result || jsonb_build_object('agt002_handoff', jsonb_build_object('synced', false));
  end if;

  return v_result;
end;
$$;

revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text, jsonb) from public;
revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text, jsonb) from anon;
revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text, jsonb) from authenticated;
grant execute on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text, jsonb) to service_role;

-- 7. Cierre del overload legado de ocho argumentos. La definición de 041 queda intacta (082 no la
-- redeclara ni la renombra) y el overload de nueve argumentos la sigue invocando sin problema: al
-- ser SECURITY DEFINER, esa llamada interna corre con los privilegios del dueño, no con los del
-- rol invocante. Lo que se retira es la única vía por la que el backend podía —hoy ya no lo hace,
-- envía siempre p_agt002_items— registrar un GO SIN el traspaso AGT-002 en la misma transacción.
-- Mientras esa puerta siguiera abierta, un llamador service_role podía saltarse la fase 3A entera
-- pasando ocho argumentos. Este revoke debe ir DESPUÉS de crear el overload de nueve argumentos:
-- de otro modo la migración dejaría, entre ambas sentencias, un intervalo sin ninguna firma
-- ejecutable por service_role.
revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text) from public;
revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text) from anon;
revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text) from authenticated;
revoke execute on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text) from service_role;

commit;
