-- AGT-003 Vig-IA Comercial — frente a quién se pierde un negocio (F5; Juan, 2026-10-22).
--
-- El motivo de pérdida ya era obligatorio (lo exige `cleanOpportunity` desde antes) y su catálogo existe con 7
-- motivos activos, usados en 11 oportunidades. Lo que faltaba es el competidor: sin eso no se puede responder
-- "contra quién perdemos", que es media respuesta del análisis de oportunidades perdidas.
--
-- Catálogo propio, con opción de crear al registrar la pérdida: el nombre se normaliza y un índice único por
-- nombre en minúsculas evita que "Atlas" y "atlas " queden como dos competidores distintos.
--
-- La tabla la lee y escribe sólo el servidor (service_role), como las demás del frente comercial desde la 112.
-- Aditiva: ninguna oportunidad existente cambia. El competidor es opcional, como pide la especificación.
begin;

create table if not exists public.psi_sales_competitors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  active boolean not null default true,
  created_by uuid references public.psi_sales_profiles(id),
  created_at timestamptz not null default now()
);

create unique index if not exists psi_sales_competitors_name_unique
  on public.psi_sales_competitors (lower(btrim(name)));

alter table public.psi_sales_competitors enable row level security;
revoke all on table public.psi_sales_competitors from public, anon, authenticated;
grant select, insert, update on table public.psi_sales_competitors to service_role;

comment on table public.psi_sales_competitors is
  'Competidores frente a los que se pierde un negocio. Lo alimenta el registro de la pérdida; no se siembra con datos inventados.';

alter table public.psi_sales_opportunities
  add column if not exists competitor_id uuid references public.psi_sales_competitors(id) on delete set null;

create index if not exists psi_sales_opportunities_competitor on public.psi_sales_opportunities (competitor_id) where competitor_id is not null;

comment on column public.psi_sales_opportunities.competitor_id is
  'Competidor que ganó el negocio, cuando se sabe. Opcional, y sólo tiene sentido en oportunidades perdidas.';

-- La vista que lee el servidor: se agregan el competidor y su nombre al final de lo que dejó la 145.
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
    st.staleness_days,
    o.competitor_id,
    comp.name AS competitor_name
   FROM psi_sales_opportunities o
     LEFT JOIN psi_sales_profiles p ON p.id = o.owner_id
     LEFT JOIN psi_sales_pipeline_stages st ON st.code = o.stage_code
     LEFT JOIN psi_sales_service_types sv ON sv.code = o.service_type_code
     LEFT JOIN psi_sales_loss_reasons lr ON lr.code = o.loss_reason_code
     LEFT JOIN psi_sales_competitors comp ON comp.id = o.competitor_id
  WHERE o.deleted_at IS NULL;

-- Como en la 145: `create or replace` conserva lo que cerró la 112 y se declara de nuevo para que quede explícito.
alter view public.v_psi_sales_opportunity_enriched set (security_invoker = true);
revoke all on public.v_psi_sales_opportunity_enriched from anon, authenticated, public;
grant select on public.v_psi_sales_opportunity_enriched to service_role;

commit;
