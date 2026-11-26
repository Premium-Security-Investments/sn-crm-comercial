-- AGT-003 — Desde cuándo cuenta la actividad de un comercial (Juan, 2026-11-25).
--
-- Un perfil se le puede reasignar a otra persona: Angie Soto recibió el perfil de Viviana Rosas el 2026-11-20, con
-- sus oportunidades. La tabla «¿Quién necesita ayuda?» le mostraba «último seguimiento hace 181 días», que era historia
-- de Viviana. `activity_since` dice desde qué día los seguimientos y decisiones son de quien tiene el perfil hoy.
-- Vacío: cuenta todo. Lo pone administración al reasignar un perfil. El código tolera que la columna no exista.
begin;
alter table public.psi_sales_profiles add column if not exists activity_since date;
commit;
