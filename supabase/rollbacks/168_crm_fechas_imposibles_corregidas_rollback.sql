-- Rollback de 168: devuelve las tres fechas imposibles tal como estaban.
--
-- Volver atrás reintroduce el defecto a propósito: la oportunidad abierta vuelve a quedar invisible para Mi día, con
-- su próxima gestión en octubre de 2027. Sólo tiene sentido si la corrección resultó equivocada.
--
-- El vencimiento del contrato del cliente NO se borra: es un dato útil que antes no estaba en ninguna parte, y
-- quitarlo no devuelve nada, sólo pierde información.
--
-- La nota de la oportunidad descartada con fecha en 2030 la corrigió la 169, no esta: su rollback vive allá.
begin;

update public.psi_sales_interactions set occurred_at = timestamptz '2027-11-15 18:14:00+00'
 where id = 'ecb78f58-5458-470c-a7f1-b5037f9601fc';

update public.psi_sales_interactions set occurred_at = timestamptz '2027-07-15 18:15:00+00'
 where id = '8a019527-44b1-4edc-8010-5c666d5baf82';

update public.psi_sales_opportunities set last_interaction_at = timestamptz '2027-11-15 18:14:00+00', next_action_at = timestamptz '2027-10-02 15:39:00+00'
 where id = 'f1577f6c-bac1-45f4-897c-be4c0924d6f5';

update public.psi_sales_opportunities set last_interaction_at = timestamptz '2027-07-15 18:15:00+00'
 where id = '8062de3a-9623-4464-afab-23fcfbb662ed';

update public.psi_sales_opportunities set next_action_at = timestamptz '2030-02-02 14:39:00+00'
 where id = 'dc33e210-f194-4ec6-bc4d-f7380de1e522';

commit;
