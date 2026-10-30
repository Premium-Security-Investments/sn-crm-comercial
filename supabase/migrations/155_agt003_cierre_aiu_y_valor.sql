-- AGT-003 — el AIU se calcula y el valor del puesto deja de llamarse mensual (Juan, 2026-10-24).
--
-- Dos reglas que dio Juan al cerrar el 24 de octubre:
--   · **El AIU es el 10 % del valor del servicio, y el IVA del 19 % va sobre ese 10 %.** Entonces el AIU dejó de ser
--     una pregunta al comercial: se calcula, como el subtotal y el total. Se quita la columna `aiu_value`, que la 151
--     había dejado opcional porque esa política no se conocía todavía.
--   · **El valor que se escribe es mensual, salvo en los proyectos, donde es el total del proyecto**, y siempre sin
--     IVA. Por eso `monthly_value` pasa a llamarse `service_value`: el nombre viejo habría mentido en cada proyecto,
--     y un nombre que miente es el tipo de cosa que en tres meses nadie entiende.
--
-- Se puede renombrar y quitar sin perder nada: al 2026-10-24 hay **cero** formularios y **cero** puestos guardados
-- (verificado con `select count(*)` antes de escribir esta migración). Hacerlo ahora es gratis; en un mes no.
begin;

alter table public.psi_sales_closure_form_posts rename column monthly_value to service_value;

comment on column public.psi_sales_closure_form_posts.service_value is
  'Valor del puesto SIN IVA. Mensual, salvo en los proyectos (service_type_code = proyecto), donde es el total del proyecto. El subtotal, el AIU del 10 % y el IVA no se guardan: los calcula src/vigia/closure-form.js.';

alter table public.psi_sales_closure_forms drop column if exists aiu_value;

comment on table public.psi_sales_closure_forms is
  'Formulario de cierre de un negocio nuevo (formato GGC-FO-001 v18), uno por oportunidad. Reemplaza el Word que el comercial mandaba por correo. Solo con el formulario completo se puede marcar la oportunidad como ganada. El dinero no se guarda: el AIU es el 10 % del valor del servicio y el IVA el 19 % del AIU, y los dos se calculan.';

commit;
