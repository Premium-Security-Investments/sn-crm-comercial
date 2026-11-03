-- AGT-003 — las oportunidades de Cliente Actual que ya existían, clasificadas en renovación o servicio nuevo
-- (pedido por Juan, 2026-11-03). Sólo con lo que dice cada registro; lo dudoso queda sin clasificar.
--
-- Criterio, en este orden:
--   1. Renovación: la observación lo dice ("renovación de contrato", "logró ... que continuara con nosotros").
--   2. Servicio nuevo, proyectos: servicio `proyecto` (CCTV, alarmas, control de acceso, equipos) vendido a un cliente
--      que ya tenemos. Es una solución adicional, no la renovación de un contrato de vigilancia.
--   3. Servicio nuevo, vigilancia: la observación habla de adición de un puesto, servicio especial o evento, o sede
--      nueva.
--   Quedan SIN clasificar las que no dicen nada claro: "puesto 24 horas", "24 horas con arma", observación vacía en
--   vigilancia, y las sedes del Comité de Estudios Médicos (pueden ser sedes nuevas o renovaciones; no se sabe).
--
-- Cada fila exige que siga siendo Cliente Actual y sin clasificar: lo que alguien ya clasificó a mano no se toca.
-- No cambia fechas: ninguna renovación de estas trae fecha de vencimiento del contrato.
begin;

with clasificacion(id, deal) as (values
  -- 1. Renovaciones
  ('eb6c8582-8c05-40c1-a507-e0879819030f'::uuid, 'renovacion'),      -- CONJUNTO LINO (abierta)
  ('413ea47c-2795-4e39-914b-09b874b88359'::uuid, 'renovacion'),      -- CONJUNTO GUADUALES DE MALABAR
  ('096b9ea3-4d14-40b4-a924-78860433cfdd'::uuid, 'renovacion'),      -- CONJUNTO SAN JOSE DEL PALMAR
  ('4887cddb-d74c-40a5-8a22-ce23fd19606a'::uuid, 'renovacion'),      -- EDIFICIO PINAMAR
  ('b215c4ee-c7bd-4e2f-a32b-b682ecf50fdb'::uuid, 'renovacion'),      -- EDIFICIO PINAR DEL ESTE
  ('0f7d8066-8cdf-4695-9788-817d1a3b4ec6'::uuid, 'renovacion'),      -- Constructora Inco (continuó con nosotros)
  -- 3. Servicio nuevo en vigilancia
  ('c6c37e9e-436b-4d77-8631-1a5a1357d0ba'::uuid, 'servicio_nuevo'),  -- Hitachi Energy, sede nueva Dosquebradas (abierta)
  ('16085ecb-4b42-405d-b039-5097e86e958b'::uuid, 'servicio_nuevo'),  -- Torneos Colombia, puesto Bogotá (abierta)
  ('e87e0a1d-037d-4f67-8dca-b845f353f096'::uuid, 'servicio_nuevo'),  -- Torneos Colombia, evento Cali
  ('e32721f7-ab90-48cb-924d-2777afb786b6'::uuid, 'servicio_nuevo'),  -- Torneos Colombia SA, servicio especial Cali
  ('63d07964-037c-40d8-b02b-0f72a20652de'::uuid, 'servicio_nuevo'),  -- Torneos Colombia SA, eventos estadio
  ('b1dde2d3-dc8b-4dff-aa9b-9de956c72a43'::uuid, 'servicio_nuevo'),  -- CONJUNTO MONTEVEDRA, adiciona un puesto
  ('1454276d-0c3f-40e5-93f7-68c32e45eeca'::uuid, 'servicio_nuevo'),  -- ORIGEN SENNIOR, adición de servicio
  ('f76b4094-0f72-405a-9040-d4110e31ef33'::uuid, 'servicio_nuevo'),  -- Constructora Inco, servicio especial
  ('5f210e62-f64f-4fd3-9044-9e588a97cbdd'::uuid, 'servicio_nuevo'),  -- Constructora Inco, servicio especial + acuerdo
  ('29cbeabf-2e71-4c94-92e9-695ff64729e3'::uuid, 'servicio_nuevo')   -- ZONA FRANCA MAGNETRON, portería 24 h
), marcadas as (
  select c.id, c.deal from clasificacion c
  union all
  -- 2. Proyectos de tecnología a un cliente actual
  select o.id, 'servicio_nuevo' from public.psi_sales_opportunities o
   where o.customer_segment = 'cliente_actual' and o.service_type_code = 'proyecto'
     and o.deleted_at is null and o.id not in (select id from clasificacion)
), aplicadas as (
  update public.psi_sales_opportunities o
     set client_deal_type = m.deal
    from marcadas m
   where o.id = m.id
     and o.customer_segment = 'cliente_actual'
     and o.client_deal_type is null
     and o.deleted_at is null
  returning o.id, o.client_deal_type
)
insert into public.psi_sales_opportunity_audit_logs (opportunity_id, changed_by, field_name, old_value, new_value, notes)
select id, null, 'client_deal_type', null, client_deal_type,
       'Migración 174: clasificación inferida de la observación y el servicio de la oportunidad'
  from aplicadas;

commit;
