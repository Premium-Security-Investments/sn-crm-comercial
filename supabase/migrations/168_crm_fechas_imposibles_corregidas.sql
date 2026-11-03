-- AGT-003 — las tres fechas imposibles que dejaron una oportunidad invisible (autorizado por Juan, 2026-11-02).
--
-- Antes de la regla de la 489 (`next-action-rule.js`), el formulario de la ficha aceptaba un seguimiento con fecha
-- futura y una próxima gestión sin tope. Por ahí entraron tres notas fechadas en 2027 y 2030: un comercial las usaba
-- como recordatorio del vencimiento del contrato que el cliente tiene con su proveedor actual, porque el CRM no da
-- ese recordatorio.
--
-- El daño no era cosmético. Una oportunidad ABIERTA quedó con su próxima gestión en octubre de 2027 y su último
-- seguimiento en noviembre de 2027: Mi día, los pendientes por decidir y el estancamiento miran si hay compromiso
-- vigente, así que los tres la daban por al día. Nadie la iba a volver a mirar en un año.
--
-- Qué hace esta migración, por fila y con el valor viejo exigido en el `where` (si alguien ya lo corrigió a mano, no
-- se vuelve a tocar):
--   1. devuelve cada seguimiento a su fecha REAL de registro (`created_at`), que es cuando ocurrió de verdad;
--   2. recalcula el último seguimiento de cada oportunidad con el máximo que no esté en el futuro;
--   3. deja en nulo las próximas gestiones imposibles: en la oportunidad abierta eso la devuelve a "pendiente por
--      decidir", que es la verdad, y en las descartadas es lo que la decisión deja de todos modos;
--   4. registra el vencimiento del contrato del cliente donde corresponde —`current_contract_end_date`— en los dos
--      casos donde la nota lo dice. **Son fechas inferidas de lo que escribió el comercial y hay que confirmarlas
--      con quien las escribió.** En la tercera nota el texto es un punto: no hay con qué inferir, y se deja vacío.
--
-- No borra ninguna fila: ninguna nota desaparece, sólo vuelve a su fecha.
begin;

-- 1. Los seguimientos, a su fecha real de registro.
update public.psi_sales_interactions
   set occurred_at = created_at
 where id = 'ecb78f58-5458-470c-a7f1-b5037f9601fc'
   and occurred_at = timestamptz '2027-11-15 18:14:00+00';

update public.psi_sales_interactions
   set occurred_at = created_at
 where id = '6524632e-bcf2-4c6d-98d7-17a49d310859'
   and occurred_at = timestamptz '2030-05-22 00:00:00+00';

update public.psi_sales_interactions
   set occurred_at = created_at
 where id = '8a019527-44b1-4edc-8010-5c666d5baf82'
   and occurred_at = timestamptz '2027-07-15 18:15:00+00';

-- 2. El último seguimiento, recalculado con lo que de verdad ya pasó.
update public.psi_sales_opportunities o
   set last_interaction_at = (
         select max(i.occurred_at) from public.psi_sales_interactions i
          where i.opportunity_id = o.id and i.occurred_at <= now())
 where o.id in ('f1577f6c-bac1-45f4-897c-be4c0924d6f5', '8062de3a-9623-4464-afab-23fcfbb662ed')
   and o.last_interaction_at > now();

-- 3. Las próximas gestiones imposibles, a nulo.
update public.psi_sales_opportunities
   set next_action_at = null
 where id = 'f1577f6c-bac1-45f4-897c-be4c0924d6f5'
   and next_action_at = timestamptz '2027-10-02 15:39:00+00';

update public.psi_sales_opportunities
   set next_action_at = null
 where id = 'dc33e210-f194-4ec6-bc4d-f7380de1e522'
   and next_action_at = timestamptz '2030-02-02 14:39:00+00';

-- 4. El vencimiento del contrato del cliente, donde corresponde. INFERIDO de las notas: confirmar.
update public.psi_sales_opportunities
   set current_contract_end_date = date '2027-11-15'
 where id = 'f1577f6c-bac1-45f4-897c-be4c0924d6f5'
   and current_contract_end_date is null;

update public.psi_sales_opportunities
   set current_contract_end_date = date '2030-05-22'
 where id = 'dc33e210-f194-4ec6-bc4d-f7380de1e522'
   and current_contract_end_date is null;

commit;
