-- AGT-003 Vig-IA Comercial — desde cuándo cada oportunidad está en su etapa (decisión de Juan, 2026-10-22).
--
-- El CRM no guardaba esto. `psi_sales_opportunity_audit_logs` sólo registra `customer_segment` y `decision`, así que
-- nadie podía responder "¿cuánto lleva este negocio en Envío de Oferta?" ni medir el embudo real. De las 206
-- oportunidades abiertas al corte, 154 están en Prospecto y 43 en Envío de Oferta: justo donde un negocio se enfría.
--
-- Tres piezas:
--   1. `stage_entered_at` + `stage_entered_at_measured` en la oportunidad.
--   2. Un disparador que pone la fecha en CUALQUIER camino que cambie la etapa (pantalla, API, RPC de licitaciones,
--      importaciones). Por eso es disparador y no código de servidor: hay varios caminos y no se pueden olvidar.
--   3. `staleness_days` por etapa, para cambiar el umbral sin desplegar código.
--
-- Siembra honesta de lo existente: se usa la última modificación de cada fila y queda marcada como NO medida.
-- `updated_at` es igual o posterior a la entrada a la etapa, así que los días calculados con ella son una COTA
-- INFERIOR: la pantalla dice "lleva al menos N días", que es verdad comprobable, en vez de un número exacto falso.
--
-- Aditiva e idempotente. No borra ni reescribe ningún dato de negocio: las 403 oportunidades y las 631 interacciones
-- quedan intactas. La vista se reemplaza conservando sus columnas, su `security_invoker` y sus permisos.
begin;

alter table public.psi_sales_opportunities
  add column if not exists stage_entered_at timestamptz,
  add column if not exists stage_entered_at_measured boolean not null default false;

comment on column public.psi_sales_opportunities.stage_entered_at is
  'Cuándo entró la oportunidad a su etapa actual. Lo mantiene el disparador psi_sales_opportunity_stage_entered.';
comment on column public.psi_sales_opportunities.stage_entered_at_measured is
  'true: la fecha la midió el sistema al cambiar la etapa. false: sembrada con updated_at, sólo sirve como cota inferior.';

update public.psi_sales_opportunities
   set stage_entered_at = coalesce(updated_at, created_at)
 where stage_entered_at is null;

-- Umbral de estancamiento por etapa. Las etapas terminales no se vigilan: un negocio aprobado o perdido no se enfría.
alter table public.psi_sales_pipeline_stages
  add column if not exists staleness_days integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'psi_sales_pipeline_stages_staleness_days_range') then
    alter table public.psi_sales_pipeline_stages
      add constraint psi_sales_pipeline_stages_staleness_days_range
      check (staleness_days is null or (staleness_days between 1 and 365));
  end if;
end $$;

comment on column public.psi_sales_pipeline_stages.staleness_days is
  'Días en la etapa a partir de los cuales la oportunidad se considera estancada. Null = no se vigila esta etapa. Valor inicial 14, lo ajusta el negocio con un update.';

update public.psi_sales_pipeline_stages
   set staleness_days = 14
 where staleness_days is null and is_terminal = false;

-- Disparador: la etapa cambia por muchos caminos; la fecha se pone en el único lugar por el que todos pasan.
create or replace function public.psi_sales_opportunity_stage_entered()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    -- Una fila que llega con fecha explícita (migraciones, cargues) la conserva; el resto nace midiendo.
    if new.stage_entered_at is null then
      new.stage_entered_at := coalesce(new.created_at, now());
      new.stage_entered_at_measured := true;
    end if;
    return new;
  end if;
  if new.stage_code is distinct from old.stage_code then
    new.stage_entered_at := now();
    new.stage_entered_at_measured := true;
  end if;
  return new;
end;
$$;

drop trigger if exists psi_sales_opportunity_stage_entered_trg on public.psi_sales_opportunities;
create trigger psi_sales_opportunity_stage_entered_trg
before insert or update of stage_code on public.psi_sales_opportunities
for each row execute function public.psi_sales_opportunity_stage_entered();

-- La vista que lee el servidor: se agregan las tres columnas al final y se conserva todo lo demás tal cual
-- (mismo orden, mismos nombres). `create or replace` preserva `security_invoker = true` y el grant a service_role
-- de la migración 112: no se usa `drop view`, que los perdería.
create or replace view public.v_psi_sales_opportunity_enriched as
 SELECT o.id,
    o.owner_id,
    o.company_name,
    o.economic_sector,
    o.decision_maker_name,
    o.decision_maker_email,
    o.decision_maker_phone,
    o.quote_city,
    o.quote_date,
    o.offer_value,
    o.service_type_code,
    o.stage_code,
    o.loss_reason_code,
    o.loss_notes,
    o.last_interaction_at,
    o.next_action_at,
    o.expected_close_date,
    o.commission_rate,
    o.approved_at,
    o.discarded_at,
    o.lost_at,
    o.created_at,
    o.updated_at,
    o.legacy_excel_id,
    o.excel_hoja_origen,
    o.tipo_oportunidad,
    o.item_origen,
    o.cliente_clave_normalizada,
    o.sede,
    o.mes_origen,
    o.anio_origen,
    o.regional_nombre,
    o.estado_pipeline_original,
    o.tipo_producto_original,
    o.unidad,
    o.valor_servicio,
    o.valor_proyecto,
    o.tipo_seguimiento_migrado,
    o.fecha_cierre_estimada_original,
    o.fecha_estimada_es_aproximada,
    o.observaciones,
    o.external_source,
    o.requiere_revision,
    p.full_name AS owner_name,
    p.microsoft_email AS owner_email,
    st.name AS stage_name,
    st.stage_order,
    st.close_probability,
    st.is_terminal,
    st.counts_as_sale,
    sv.name AS service_type_name,
    lr.name AS loss_reason_name,
    (o.offer_value * st.close_probability)::numeric(14,2) AS weighted_pipeline_value,
        CASE
            WHEN o.stage_code = 'aprobado'::text THEN (o.offer_value * o.commission_rate)::numeric(14,2)
            ELSE 0::numeric(14,2)
        END AS earned_commission,
        CASE
            WHEN st.is_terminal = false THEN (o.offer_value * st.close_probability * o.commission_rate)::numeric(14,2)
            ELSE 0::numeric(14,2)
        END AS projected_commission,
    COALESCE(o.last_interaction_at, o.updated_at, o.created_at) AS prioritization_date,
    o.frozen_until,
    o.frozen_reason,
    o.delete_requested_at,
    o.delete_request_reason,
    o.delete_requested_by,
    o.stage_entered_at,
    o.stage_entered_at_measured,
    st.staleness_days
   FROM psi_sales_opportunities o
     LEFT JOIN psi_sales_profiles p ON p.id = o.owner_id
     LEFT JOIN psi_sales_pipeline_stages st ON st.code = o.stage_code
     LEFT JOIN psi_sales_service_types sv ON sv.code = o.service_type_code
     LEFT JOIN psi_sales_loss_reasons lr ON lr.code = o.loss_reason_code
  WHERE o.deleted_at IS NULL;

-- La migración 112 cerró estas vistas: corren con los permisos de quien consulta y sólo las lee el servidor.
-- `create or replace` lo conserva, y se declara de nuevo para que quede explícito y el chequeo de CI lo verifique.
alter view public.v_psi_sales_opportunity_enriched set (security_invoker = true);
revoke all on public.v_psi_sales_opportunity_enriched from anon, authenticated, public;
grant select on public.v_psi_sales_opportunity_enriched to service_role;

commit;
