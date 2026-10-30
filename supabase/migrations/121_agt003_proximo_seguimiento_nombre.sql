-- Nombre visible del permiso de Vig-IA Comercial "Próximo seguimiento" (Juan Botero, 2026-10-09): se retira el
-- apellido "copiloto" de todo lo que ve una persona. Sólo cambia nombre y descripción; el código del permiso
-- (vigia_copilot_pilot) y quién lo tiene no cambian.
begin;
update public.psi_access_permissions
   set name = 'Vig-IA Comercial · Próximo seguimiento',
       description = 'Permite usar Próximo seguimiento de Vig-IA Comercial en la ficha de la oportunidad: propone el siguiente contacto y un borrador para revisar.'
 where code = 'vigia_copilot_pilot';

commit;
