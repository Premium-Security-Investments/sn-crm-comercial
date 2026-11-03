-- AGT-003 — las ocho oportunidades parqueadas, dichas como congeladas (autorizado por Juan, 2026-11-03).
--
-- Medido el 2026-11-02 y de nuevo el 2026-11-03: ocho oportunidades abiertas, todas en Prospecto y de un mismo
-- comercial, tenían la próxima gestión entre 116 y 606 días adelante. Eran prospectos cuyo contrato con el proveedor
-- actual vence lejos: la próxima gestión hacía de recordatorio porque el congelamiento no llegaba más allá de 90 días.
-- Mientras tanto Mi día, los pendientes y el estancamiento las daban por al día.
--
-- Con la 170 el congelamiento acepta una fecha (hasta 2 años). Esta migración las congela hasta EXACTAMENTE el día que
-- el comercial ya había puesto: no se cambia ninguna fecha, sólo se dice lo que de verdad son. La próxima gestión no se
-- toca, así que ese día vuelven a pedir decisión igual que antes.
--
-- Efecto visible: salen de las cifras activas del comercial (es lo que hace un congelamiento) y se ven como
-- "congelada hasta <fecha>". `frozen_by` queda en nulo porque no lo decidió una persona desde el CRM; el motivo y la
-- auditoría lo dicen.
--
-- Cada fila exige el valor viejo en el `where` (la próxima gestión exacta y que no esté congelada ni cerrada): si
-- alguien ya la movió a mano, no se toca.
begin;

with parked(id, old_next, until) as (values
  ('a6433fc2-007e-4bf1-a670-26211b51e0c0'::uuid, timestamptz '2027-02-26 14:19:00+00', date '2027-02-26'),  -- CC Unicentro
  ('15df63ec-e689-493e-8f7d-f3f87c55cfed'::uuid, timestamptz '2027-05-06 13:18:00+00', date '2027-05-06'),  -- Minera el roble
  ('8fcd1454-ef9c-4494-a015-fb5e5dd115bc'::uuid, timestamptz '2027-06-15 08:38:00+00', date '2027-06-15'),  -- Universidad de Medellin
  ('fb2e4555-d3f5-4134-9c1a-0cd4db08f45f'::uuid, timestamptz '2027-11-15 10:02:00+00', date '2027-11-15'),  -- CC vizcaya
  ('bcf1c70d-cc2a-4922-8b71-b0b02e99053d'::uuid, timestamptz '2027-11-30 22:28:00+00', date '2027-11-30'),  -- Club Campestre
  ('ea45d2d9-127e-4caf-875f-080377d21b4f'::uuid, timestamptz '2028-02-03 22:25:00+00', date '2028-02-03'),  -- Zona franca rionegro
  ('993e1c8a-1d41-411e-a42d-42be251cf5a0'::uuid, timestamptz '2028-02-08 12:49:00+00', date '2028-02-08'),  -- San fernando plaza
  ('7b0301db-eab5-4478-8186-d63c2301cdb8'::uuid, timestamptz '2028-06-30 21:39:00+00', date '2028-06-30')  -- Coomeva
), frozen as (
  update public.psi_sales_opportunities o
     set frozen_until = p.until,
         frozen_reason = 'El comercial la había dejado con la próxima gestión el ' || to_char(p.until, 'DD/MM/YYYY')
           || ' como recordatorio; queda congelada hasta ese día (AGT-003, 2026-11-03).',
         frozen_at = now(),
         frozen_by = null
    from parked p
   where o.id = p.id
     and o.next_action_at = p.old_next
     and o.frozen_until is null
     and o.deleted_at is null
     and o.stage_code not in ('aprobado', 'descartado', 'perdido')
  returning o.id, o.stage_code, o.frozen_until
)
insert into public.psi_sales_opportunity_audit_logs (opportunity_id, changed_by, field_name, old_value, new_value, notes)
select id, null, 'frozen_until', null, frozen_until::text,
       'Migración 172: próxima gestión lejana convertida en congelamiento hasta esa misma fecha'
  from frozen;

commit;
