-- AGT-003 Vig-IA Comercial — corregir las fechas que el chat guardó corridas un día (Juan las vio en pantalla, 2026-10-22).
--
-- Causa: el chat escribía el día tal cual ("2026-10-26") y la base lo tomaba como medianoche UTC, que en Bogotá es el
-- día anterior. El código ya quedó corregido (`chatDayToIso`: mediodía de Bogotá, igual que el formulario de la ficha).
-- Esto arregla las tres filas que alcanzaron a quedar mal, las únicas: el chat se usó por primera vez hoy.
--
-- Cada update exige el valor viejo exacto, así que si algo ya se corrigió a mano no se vuelve a mover.
-- Sólo datos: no cambia estructura ni permisos.
begin;

-- Frontier: la próxima gestión quedó el domingo 25 a las 19:00 (Bogotá) en vez del lunes 26.
update public.psi_sales_opportunities
   set next_action_at = timestamptz '2026-10-26 17:00:00+00'
 where id = '670a4f03-7179-45f8-9a02-89bc8166a69d'
   and next_action_at = timestamptz '2026-10-26 00:00:00+00';

-- Frontier: la nota del contacto de hoy quedó fechada el 21 a las 19:00 (Bogotá), y con ella el último seguimiento.
update public.psi_sales_interactions
   set occurred_at = timestamptz '2026-10-22 17:00:00+00'
 where id = 'b70f4620-b84a-4489-8b30-0af2331e478b'
   and occurred_at = timestamptz '2026-10-22 00:00:00+00';

update public.psi_sales_opportunities
   set last_interaction_at = timestamptz '2026-10-22 17:00:00+00'
 where id = '670a4f03-7179-45f8-9a02-89bc8166a69d'
   and last_interaction_at = timestamptz '2026-10-22 00:00:00+00';

-- Agroindustria La Margarita: misma nota con el mismo día corrido. Su último seguimiento ya quedó bien, porque
-- después se registró una llamada desde la ficha (12:42Z), y esa fecha no se toca.
update public.psi_sales_interactions
   set occurred_at = timestamptz '2026-10-22 17:00:00+00'
 where id = '3fffcf45-4f33-4123-acc6-9489a2a2b5d3'
   and occurred_at = timestamptz '2026-10-22 00:00:00+00';

commit;
