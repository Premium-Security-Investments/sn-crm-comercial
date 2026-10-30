-- 165 — Licitaciones: crear a mano un proceso que no está en SECOP.
--
-- Decisión del dueño (Juan Botero, 2026-10-29): "hay procesos que no están en SECOP y aparecen en otras plataformas;
-- hay que poder crearlos a mano y darles el mismo seguimiento: expediente, análisis, documentos cargados a mano,
-- relojes y cierre".
--
-- El nudo era este: todo el seguimiento cuelga de una fila de `psi_public_tenders` ligada a la oportunidad por
-- `converted_opportunity_id` (el expediente, la Mesa con Vig-IA, el botón de analizar, la carga manual de documentos
-- y el acta de cierre leen de ahí), y esa fila sólo la producía el Radar al convertir una licitación de SECOP. Así que
-- un proceso de otra plataforma no tenía dónde existir.
--
-- Esta función crea la MISMA pareja licitación + oportunidad que produce la conversión del Radar, con los datos que
-- declara una persona en vez de los de una fuente oficial. Nada más cambia: la oportunidad nace `prospecto`,
-- `licitacion_publica` y `Licitación Pública`, que es lo que los guardias de las migraciones 022/025/027 exigen, y la
-- licitación nace `convertida_oportunidad`, que es lo que la bandeja de Oportunidades (023) lista.
--
-- Dos espacios de nombres propios, para que el Radar y lo manual no se pisen nunca:
--   * `stable_key` con prefijo `manual-`: una corrida del Radar no puede alcanzar esa llave (las suyas son el sha1 de
--     la fuente oficial), así que no reclasifica ni reescribe la fila;
--   * `external_source` `licitacion_manual:<llave>`: el índice único parcial de la 018 reserva `secop_radar:%`, de
--     modo que lo manual necesita su propio índice único. Registrar dos veces el mismo proceso choca con él.
--
-- No crea trabajo de procesamiento de documentos: no hay fuente oficial de la cual importar. Los documentos entran por
-- la carga manual y el primer análisis lo pide el botón "Volver a analizar" (migración 138 + 2026-10-29), que ya sabe
-- lanzar el PRIMER análisis cuando no hay ninguno y sólo necesita la licitación ligada y documentos vigentes.

begin;

alter table public.psi_public_tenders
  add column if not exists manual_entry_by uuid references public.psi_sales_profiles(id) on delete set null,
  add column if not exists manual_entry_at timestamptz;

comment on column public.psi_public_tenders.manual_entry_by is
  'Quién registró el proceso a mano en el CRM. Nulo en las filas que vienen del Radar.';
comment on column public.psi_public_tenders.manual_entry_at is
  'Cuándo se registró el proceso a mano. Nulo en las filas que vienen del Radar.';

create unique index if not exists psi_sales_opportunities_manual_tender_external_source_unique
  on public.psi_sales_opportunities(external_source)
  where external_source like 'licitacion_manual:%';

create or replace function public.psi_create_manual_tender_opportunity(
  p_actor_id uuid,
  p_owner_id uuid,
  p_stable_key text,
  p_source text,
  p_section text,
  p_entity text,
  p_title text,
  p_description text,
  p_ref text,
  p_url text,
  p_city text,
  p_dept text,
  p_value numeric,
  p_deadline_at timestamptz,
  p_expected_close_date date,
  p_external_source text,
  p_observaciones text,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_opportunity public.psi_sales_opportunities%rowtype;
  v_tender public.psi_public_tenders%rowtype;
begin
  if p_stable_key is null or p_stable_key not like 'manual-%' then
    raise exception 'La llave del proceso manual no es válida.' using errcode = '22023';
  end if;
  if p_external_source is null or p_external_source not like 'licitacion_manual:%' then
    raise exception 'El origen externo del proceso manual no es válido.' using errcode = '22023';
  end if;
  if coalesce(btrim(p_source), '') = '' or coalesce(btrim(p_entity), '') = '' or coalesce(btrim(p_title), '') = '' then
    raise exception 'La plataforma, la entidad y el objeto son obligatorios.' using errcode = '22023';
  end if;
  if p_section is null or p_section not in ('hacer', 'revisar', 'prioridad_baja') then
    raise exception 'La sección del proceso no es válida.' using errcode = '22023';
  end if;
  if coalesce(p_value, 0) < 0 then
    raise exception 'El valor del proceso no puede ser negativo.' using errcode = '22023';
  end if;

  -- Segunda puerta, detrás de la del HTTP: humano activo con el permiso de Licitaciones. La custodia la exige la
  -- capa HTTP (`LICITACIONES_CONVERT`), igual que en la conversión del Radar.
  if not exists (
    select 1
    from public.psi_sales_profiles pr
    join public.psi_profile_permissions pp on pp.profile_id = pr.id
    where pr.id = p_actor_id
      and pr.active = true
      and coalesce(pr.identity_type, 'human') = 'human'
      and pp.permission_code = 'licitaciones'
  ) then
    raise exception 'No tiene permisos para crear procesos de licitación.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.psi_sales_profiles pr where pr.id = p_owner_id and pr.active = true) then
    raise exception 'El responsable del proceso no existe o está inactivo.' using errcode = '22023';
  end if;

  -- Mismo mensaje para los dos choques posibles (la licitación por `stable_key`, la oportunidad por
  -- `external_source`): para quien registra, los dos significan "ese proceso ya está en el CRM".
  if exists (select 1 from public.psi_public_tenders t where t.stable_key = p_stable_key) then
    raise exception 'Ese proceso ya está registrado en el CRM (misma plataforma, entidad, referencia y objeto).'
      using errcode = '23505';
  end if;

  -- Orden de bloqueo: oportunidad antes que licitación, igual que `psi_convert_tender_to_opportunity` (058).
  insert into public.psi_sales_opportunities (
    company_name, owner_id, stage_code, service_type_code, offer_value, expected_close_date,
    quote_city, regional_nombre, sede, economic_sector, tipo_producto_original, observaciones, external_source
  ) values (
    btrim(p_entity), p_owner_id, 'prospecto', 'licitacion_publica', coalesce(p_value, 0), p_expected_close_date,
    p_city, p_dept, p_ref, 'Sector público', 'Licitación Pública', p_observaciones, p_external_source
  ) returning * into v_opportunity;

  insert into public.psi_public_tenders (
    stable_key, source, section, entity, dept, city, ref, title, description, value,
    deadline_at, url, raw, internal_status, converted_opportunity_id,
    reviewed_by, reviewed_at, detected_at, last_seen_at,
    tracking_last_note, tracking_updated_at, manual_entry_by, manual_entry_at
  ) values (
    p_stable_key, btrim(p_source), p_section, btrim(p_entity), p_dept, p_city, p_ref, btrim(p_title), p_description,
    coalesce(p_value, 0), p_deadline_at, p_url, p_raw, 'convertida_oportunidad', v_opportunity.id,
    p_actor_id, v_now, v_now, v_now,
    'Proceso creado a mano en el CRM.', v_now, p_actor_id, v_now
  ) returning * into v_tender;

  insert into public.psi_tender_tracking_events (
    tender_id, event_type, note, from_status, to_status, created_by, metadata
  ) values (
    v_tender.id, 'converted', 'Proceso creado a mano en el CRM.', null, 'convertida_oportunidad', p_actor_id,
    jsonb_build_object('origen', 'manual', 'plataforma', btrim(p_source))
  );

  return jsonb_build_object(
    'opportunity_id', v_opportunity.id,
    'tender_id', v_tender.id,
    'stable_key', v_tender.stable_key
  );
end;
$$;

revoke all on function public.psi_create_manual_tender_opportunity(uuid, uuid, text, text, text, text, text, text, text, text, text, text, numeric, timestamptz, date, text, text, jsonb) from public;
revoke all on function public.psi_create_manual_tender_opportunity(uuid, uuid, text, text, text, text, text, text, text, text, text, text, numeric, timestamptz, date, text, text, jsonb) from anon;
revoke all on function public.psi_create_manual_tender_opportunity(uuid, uuid, text, text, text, text, text, text, text, text, text, text, numeric, timestamptz, date, text, text, jsonb) from authenticated;
grant execute on function public.psi_create_manual_tender_opportunity(uuid, uuid, text, text, text, text, text, text, text, text, text, text, numeric, timestamptz, date, text, text, jsonb) to service_role;

commit;
