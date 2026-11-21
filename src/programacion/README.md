# Programación de turnos (dentro del SIIO)

Desde el 2026-11-21 Programación es una sección del SIIO (`#/programacion`), no una aplicación aparte.
Viene del repositorio `programacion-personal` (rama `main`, `d5077f4`), que se publicaba en AWS Amplify (cuenta
Fresh Canvas). Ese repositorio queda como histórico.

- `app/`: pantallas. Usa el cliente y la sesión del SIIO (`src/supabaseBrowser.ts`); el acceso por rol y ciudad sigue
  saliendo de `programacion.mi_acceso()`. Los estilos viven anidados bajo `.programacion-app`.
- `motor/` e `integracion/`: cálculo y conector de Avancys, sin cambios. Sus pruebas: `pnpm run test:programacion`.
- La función `supabase/functions/avancys-sync` usa copias idénticas de `integracion/odoo.ts` y `normalizar.ts`.
- `supabase/programacion-migrations/`: historial de migraciones del esquema `programacion` (ya aplicadas), para las
  pruebas y como referencia. Las migraciones nuevas van en `supabase/migrations` del SIIO.
