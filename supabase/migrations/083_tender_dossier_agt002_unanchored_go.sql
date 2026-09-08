-- Traspaso AGT-002 -> expediente post-GO: decisión GO vigente SIN `analysis_run_id` (issue #187,
-- caso REAL de Cali). 082 exige igualdad exacta entre `decision.analysis_run_id` y
-- `p_analysis_run_id`; cuando el GO se registró sin anclaje ese `is distinct from` es
-- inevitablemente verdadero contra cualquier corrida, así que ese expediente no podía traspasarse
-- jamás — ni por la vía atómica ni por el recovery.
--
-- 083 NO edita 082: se aplica después y reemplaza (CREATE OR REPLACE) únicamente
-- `psi_sync_agt002_post_go_checklist`, preservando ÍNTEGRAMENTE la lógica de 082 (autorización,
-- lock TOCTOU sobre la oportunidad, resolución de la decisión GO vigente por la cadena de
-- supersesión, corrida canónica/completada, snapshot vigente sin refresco en curso, sobre V3
-- estructurado, validación cerrada del lote en dos pasadas, derivación de `source_payload` desde la
-- corrida leída por esta misma transacción, idempotencia por (dossier_item_id, analysis_run_id,
-- source_id), evento `requirement_changed` por payload verificado y no-adopción de ítems ajenos) y
-- sus grants/revokes. El resto de 082 (tabla de proveniencia, proyección, overloads del GO,
-- espacio de claves reservado) queda intacto y no se redeclara aquí.
--
-- Lo único que cambia es la puerta de anclaje:
--   * `decision.analysis_run_id` NO nulo  -> igualdad exacta con `p_analysis_run_id`, como hoy.
--   * `decision.analysis_run_id` NULO     -> se admite `p_analysis_run_id` SÓLO si la corrida es de
--     la misma oportunidad/licitación, `status = 'completed'`, `canonical = true`, su snapshot es el
--     vigente sin refresco en curso, `producer = 'AGT-002'` y `method = 'agent_ai'`, trae el
--     análisis integral V3 estructurado y NO tiene la propiedad propia `evidence_coverage` en
--     `result` (`not (v_run.result ? 'evidence_coverage')`). Si la propiedad existe —aunque su valor
--     sea JSON null, {}, false, 0 o un string— hay una lectura de cobertura y el caso deja de ser el
--     legado del issue #187: se rechaza.
--
-- Nunca muta la fila de la decisión: 083 no la actualiza, no la reinserta y no le escribe el run.
-- La proveniencia append-only sigue anclando decision_id + run_id, de modo que el expediente
-- registra exactamente contra qué decisión y contra qué corrida se sembró cada pendiente.
begin;

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
  v_unanchored_decision boolean := false;
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

  -- Cierre de la ventana TOCTOU (082): TODA la resolución posterior (decisión GO vigente, cadena de
  -- supersesión, corrida anclada o —caso legado— la corrida canónica vigente, snapshot documental)
  -- se lee bajo un row lock sobre la oportunidad. Sin él, otra transacción puede registrar un NO-GO
  -- —o un GO anclado a otra corrida— entre la validación y la escritura, y este lote se sembraría
  -- contra un estado que ya dejó de ser cierto. Se toma ANTES de resolver nada, no después.
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

  -- Puerta de anclaje. Con anclaje presente, la igualdad exacta de 082 se conserva sin cambios: el
  -- lote sólo puede sembrarse contra la corrida que la decisión ancló. Sin anclaje (issue #187) no
  -- hay igualdad posible, así que se marca el caso legado y la corrida indicada tendrá que superar
  -- TODAS las condiciones adicionales de más abajo. Nunca se escribe el run en la decisión.
  if v_decision.analysis_run_id is not null then
    if v_decision.analysis_run_id is distinct from p_analysis_run_id then
      raise exception 'El análisis indicado no es el análisis anclado a la decisión GO vigente.' using errcode = '22023';
    end if;
  else
    v_unanchored_decision := true;
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

  -- Condiciones ADICIONALES del caso legado sin anclaje. Se aplican después de todo lo anterior, de
  -- modo que una decisión sin anclaje nunca es más permisiva que una anclada: sólo sustituye la
  -- igualdad exacta (imposible) por una identidad server-owned igual de estrecha.
  if v_unanchored_decision then
    -- Identidad del productor: 050 ya garantiza canonical => AGT-002/agent_ai, pero aquí es un
    -- hecho verificado, nunca uno asumido a partir de otro invariante.
    if v_run.producer is distinct from 'AGT-002' or v_run.method is distinct from 'agent_ai' then
      raise exception 'La decisión GO vigente no tiene análisis anclado: sólo una corrida AGT-002 (agent_ai) vigente puede sustentar el traspaso legado.'
        using errcode = '22023';
    end if;
    -- Ausencia ESTRICTA de cobertura: la propiedad propia `evidence_coverage` NO existe en `result`
    -- —esto es, `not (v_run.result ? 'evidence_coverage')`—. Si existe, aunque su valor sea JSON
    -- null, hay una lectura de cobertura y la corrida no es de las anteriores a ese bloque, así que
    -- el atajo no aplica. El coalesce mantiene el fail-closed si `result` fuera NULL (imposible tras
    -- la verificación V3 anterior, pero nunca se asume).
    if coalesce(v_run.result ? 'evidence_coverage', true) then
      raise exception 'La decisión GO vigente no tiene análisis anclado y la corrida indicada declara evidence_coverage: el traspaso sin anclaje sólo cubre el caso legado (issue #187).'
        using errcode = '22023';
    end if;
  end if;

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

-- Grants/revokes idénticos a 082 (CREATE OR REPLACE conserva los privilegios existentes; se
-- redeclaran igualmente para que 083 sea reejecutable y autosuficiente sobre una base que aún no
-- los tuviera).
revoke all on function public.psi_sync_agt002_post_go_checklist(uuid, uuid, uuid, uuid, jsonb) from public;
revoke all on function public.psi_sync_agt002_post_go_checklist(uuid, uuid, uuid, uuid, jsonb) from anon;
revoke all on function public.psi_sync_agt002_post_go_checklist(uuid, uuid, uuid, uuid, jsonb) from authenticated;
grant execute on function public.psi_sync_agt002_post_go_checklist(uuid, uuid, uuid, uuid, jsonb) to service_role;

commit;
