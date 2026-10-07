-- Rollback de 110: retira las funciones de decisión y el permiso de eliminar, y la vista vuelve a mostrar todas las
-- filas (incluidas las eliminadas lógicamente). Las columnas nuevas se conservan: la vista depende de ellas y no
-- alteran ninguna lectura previa. Los seguimientos y la auditoría ya creados se conservan (historia comercial).
begin;
delete from public.psi_profile_permissions where permission_code = 'crm_eliminar_oportunidades';
delete from public.psi_access_permissions where code = 'crm_eliminar_oportunidades';
drop function if exists public.psi_resolve_opportunity_delete_request(uuid, uuid, boolean, text);
drop function if exists public.psi_record_opportunity_decision(uuid, uuid, text, text, text, timestamptz, text, numeric, integer, text);
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
    o.delete_requested_by
   FROM psi_sales_opportunities o
     LEFT JOIN psi_sales_profiles p ON p.id = o.owner_id
     LEFT JOIN psi_sales_pipeline_stages st ON st.code = o.stage_code
     LEFT JOIN psi_sales_service_types sv ON sv.code = o.service_type_code
     LEFT JOIN psi_sales_loss_reasons lr ON lr.code = o.loss_reason_code;


commit;
