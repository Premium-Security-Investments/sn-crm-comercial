-- Reversa de la 157: devuelve el comentario de la tabla al texto anterior a la 155.
begin;

comment on table public.psi_sales_closure_forms is
  'Formulario de cierre de un negocio nuevo (formato GGC-FO-001 v18), uno por oportunidad. Reemplaza el Word que el comercial mandaba por correo. Solo con el formulario completo se puede marcar la oportunidad como ganada.';

commit;
