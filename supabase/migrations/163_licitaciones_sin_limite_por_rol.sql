-- 163 — Licitaciones: el permiso manda, no el rol.
--
-- Decisión del dueño (Juan Botero, 2026-10-29): "a katherine déjela como comercial pero como tiene acceso a
-- licitaciones debe poder hacer todo lo de licitaciones sin limitaciones pues ella es la encargada".
--
-- Hasta hoy, aprobar el GO / NO GO, mover el estado de oferta, archivar una oportunidad de licitación y redactar,
-- confirmar o reabrir el acta de cierre exigían rol `admin`, `gerencia` o `director`, tanto en `access-control.js`
-- como dentro de las funciones de la base. La encargada de Licitaciones es `comercial`, así que el CRM le mostraba
-- las pantallas y la base le respondía 42501. El permiso `licitaciones` pasa a ser la llave: quien lo tiene opera
-- Licitaciones completo.
--
-- Qué NO cambia:
--   * el rol de solo consulta (`consulta`) sigue sin operar nada: no entra en la lista de roles;
--   * las identidades que no son humanas siguen fuera (el guardia de `identity_type` no se toca);
--   * la custodia documental sigue siendo un permiso aparte (`licitaciones_custodia`), con sus propias funciones;
--   * `psi_record_tender_dossier_artifact_review` no se toca: ya aceptaba custodia documental además del rol.
--
-- Cómo: se reescribe cada función desde su propia definición viva (`pg_get_functiondef`), cambiando sólo la lista de
-- roles, con el mismo patrón guardado de la migración 029. Si la autorización esperada no está, o está más de una
-- vez, la migración falla en vez de debilitar un guardia desconocido en silencio.

do $$
declare
  v_targets jsonb := jsonb_build_array(
    -- La decisión GO / NO GO.
    jsonb_build_object(
      'sig', 'public.psi_record_tender_go_no_go_core_039(uuid,uuid,uuid,text,uuid,text,jsonb,text)',
      'find', 'p.role in (''admin'', ''gerencia'', ''director'')',
      'repl', 'p.role in (''admin'', ''gerencia'', ''director'', ''comercial'')'
    ),
    -- El estado de oferta (en preparación, presentada, cerrada…).
    jsonb_build_object(
      'sig', 'public.psi_transition_tender_offer_status_core_042(uuid,uuid,text,text,text)',
      'find', 'p.role in (''admin'', ''gerencia'', ''director'')',
      'repl', 'p.role in (''admin'', ''gerencia'', ''director'', ''comercial'')'
    ),
    -- Archivar una oportunidad de licitación.
    jsonb_build_object(
      'sig', 'public.psi_archive_tender_opportunity(uuid,uuid,text,text)',
      'find', 'p.role in (''admin'', ''gerencia'', ''director'')',
      'repl', 'p.role in (''admin'', ''gerencia'', ''director'', ''comercial'')'
    ),
    -- Acta de cierre: redactar, confirmar y reabrir.
    jsonb_build_object(
      'sig', 'public.psi_upsert_tender_closure_acta(uuid,uuid,jsonb,timestamptz)',
      'find', 'v_actor.role not in (''admin'', ''gerencia'', ''director'')',
      'repl', 'v_actor.role not in (''admin'', ''gerencia'', ''director'', ''comercial'')'
    ),
    jsonb_build_object(
      'sig', 'public.psi_confirm_tender_closure_acta(uuid,uuid,timestamptz)',
      'find', 'p.role in (''admin'', ''gerencia'', ''director'')',
      'repl', 'p.role in (''admin'', ''gerencia'', ''director'', ''comercial'')'
    ),
    jsonb_build_object(
      'sig', 'public.psi_reopen_tender_closure_acta(uuid,uuid,timestamptz)',
      'find', 'p.role in (''admin'', ''gerencia'', ''director'')',
      'repl', 'p.role in (''admin'', ''gerencia'', ''director'', ''comercial'')'
    ),
    -- Expediente de oferta: sembrar el expediente, sembrar sus requisitos y sincronizar la lista posterior al GO
    -- piden autoridad de gestión a través de este guardia.
    jsonb_build_object(
      'sig', 'public.psi_assert_tender_dossier_actor(uuid,boolean)',
      'find', '(not p_manager_only or p.role in (''admin'',''gerencia'',''director''))',
      'repl', '(not p_manager_only or p.role in (''admin'',''gerencia'',''director'',''comercial''))'
    ),
    -- Hoy ninguna función la llama con p_manager_only => true; se alinea para que la próxima que lo haga no vuelva a
    -- dejar afuera a la encargada.
    jsonb_build_object(
      'sig', 'public.psi_profile_has_tender_permission(uuid,boolean)',
      'find', '(not p_manager_only or p.role in (''admin'', ''gerencia'', ''director''))',
      'repl', '(not p_manager_only or p.role in (''admin'', ''gerencia'', ''director'', ''comercial''))'
    )
  );
  v_target jsonb;
  v_proc regprocedure;
  v_definition text;
  v_find text;
  v_repl text;
  v_hits integer;
begin
  for v_target in select value from jsonb_array_elements(v_targets) as t(value) loop
    v_proc := to_regprocedure(v_target->>'sig');
    if v_proc is null then
      raise exception 'Falta %; aplique primero las migraciones previas.', v_target->>'sig';
    end if;
    v_definition := pg_get_functiondef(v_proc);
    v_find := v_target->>'find';
    v_repl := v_target->>'repl';
    v_hits := (length(v_definition) - length(replace(v_definition, v_find, ''))) / length(v_find);
    if v_hits <> 1 then
      raise exception 'La autorización esperada de % aparece % veces (se esperaba 1); revisión manual requerida.',
        v_target->>'sig', v_hits;
    end if;
    -- Idempotente: si ya quedó aplicada, el texto viejo ya no aparece y la migración falla arriba con el conteo 0.
    execute replace(v_definition, v_find, v_repl);
    execute format('revoke all on function %s from public', v_proc);
    execute format('revoke all on function %s from anon', v_proc);
    execute format('revoke all on function %s from authenticated', v_proc);
    execute format('grant execute on function %s to service_role', v_proc);
  end loop;
end;
$$;

-- Comprobación: ninguna de las ocho funciones puede quedar con la lista vieja.
do $$
declare
  v_pending text;
begin
  select string_agg(p.oid::regprocedure::text, ', ')
    into v_pending
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.oid::regprocedure::text in (
      'psi_record_tender_go_no_go_core_039(uuid,uuid,uuid,text,uuid,text,jsonb,text)',
      'psi_transition_tender_offer_status_core_042(uuid,uuid,text,text,text)',
      'psi_archive_tender_opportunity(uuid,uuid,text,text)',
      'psi_upsert_tender_closure_acta(uuid,uuid,jsonb,timestamp with time zone)',
      'psi_confirm_tender_closure_acta(uuid,uuid,timestamp with time zone)',
      'psi_reopen_tender_closure_acta(uuid,uuid,timestamp with time zone)',
      'psi_assert_tender_dossier_actor(uuid,boolean)',
      'psi_profile_has_tender_permission(uuid,boolean)'
    )
    and (
      pg_get_functiondef(p.oid) like '%in (''admin'', ''gerencia'', ''director'')%'
      or pg_get_functiondef(p.oid) like '%in (''admin'',''gerencia'',''director'')%'
    );
  if v_pending is not null then
    raise exception 'Quedaron funciones de Licitaciones limitadas por rol: %', v_pending;
  end if;
end;
$$;
