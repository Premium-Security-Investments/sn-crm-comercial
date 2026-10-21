-- Rollback de 143: quita la vista de horas por cliente. No toca el esquema `programacion`.
drop view if exists public.siio_programacion_horas_cliente;
