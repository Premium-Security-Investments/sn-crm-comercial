# Product

<!-- impeccable:product-schema 1 -->

> Capturado el 2026-10-22 sin entrevista en vivo: las respuestas de Juan Botero ya estaban
> recogidas, textuales, en `/root/handoffs/2026-10-22-AGT-003-plan-rediseno-mi-dia.md`
> (secciones 1 a 5) y en los handoffs de esa jornada. Lo que viene de ahí o del código está
> confirmado. Lo que no, está marcado `por confirmar`.

## Platform

web

## Users

- **Comercial de Seguridad Nacional (7 personas).** Trabaja la cartera de oportunidades propias:
  llama, visita, cotiza, registra lo que pasó y agenda la próxima gestión. Usa el CRM en el
  celular durante el día y en el computador cuando se sienta a trabajar una oportunidad.
  Decisión de Juan: *"la idea es que lo usen tanto en celular como en computador; tal vez Mi día
  será más de celular y ya las fichas de cada oportunidad sí deberían ser computador"*.
- **Director comercial.** Ve la cartera de cada consultor, carga las metas del mes y resuelve
  las solicitudes de eliminación.
- **Katherine Valencia.** Única persona que trabaja licitaciones públicas; ese flujo es de
  AGT-002 y no entra en Mi día.

## Product Purpose

CRM comercial de Seguridad Nacional: que ninguna oportunidad abierta se quede sin una decisión
ni sin una próxima gestión con fecha. "Mi día" es la pantalla de arranque del comercial y debe
responder tres preguntas en orden: qué hago ahora, qué viene, cómo voy.

## Positioning

El CRM no es un archivo donde se consulta: es una cola de trabajo con reglas. Toda oportunidad
abierta tiene una decisión vigente; mientras el comercial esté atrasado debe decidir al menos
10 al día para poder crear oportunidades nuevas. Vig-IA (AGT-003) registra gestiones por chat,
en lenguaje natural, en vez de obligar a llenar un formulario.

## Operating Context

- Pipeline por etapas: Prospecto → Envío de oferta → Sustentación → Negociación → Aprobado /
  Perdido / Descartado.
- Datos migrados de un Excel: muchas oportunidades llegaron sin valor, sin regional y sin
  decisor. El orden por valor se vuelve alfabético cuando toda la cartera vale 0.
- Zona horaria de trabajo: America/Bogota. Las fechas de la pantalla son días de Bogotá.
- Correo semanal del lunes con las señales de la semana (próximo envío: lunes 26, 11:45 UTC).

## Capabilities and Constraints

- **Pendiente de decisión** = la próxima gestión se venció o no existe. Congelada vigente o con
  eliminación pedida ya está decidida y sale del pipeline activo.
- **Cuota de decisión:** 10 al día (Bogotá). Con menos pendientes que la cuota, hay que
  decidirlas todas.
- **Estancamiento** (migración 145): días en la etapa contra el umbral de la etapa, y sólo si
  no hay próxima gestión con fecha futura. Con fecha sembrada el texto dice "al menos N días".
  Consecuencia: **toda oportunidad estancada es también una pendiente de decisión.**
- **Próximo paso obligatorio** al registrar una gestión y al mover etapa. **Motivo de pérdida
  obligatorio**, con competidor.
- **Chat de Vig-IA:** registra gestiones; hoy no mueve etapa, valor ni dueño. Cupo de 100
  mensajes por equipo al día.
- **Brief antes de la reunión** con un bloque de IA a pedido: cupo propio de 20 al día, el
  resultado no se guarda.
- Las licitaciones públicas (`service_type_code = 'licitacion_publica'`) quedan fuera de Mi día.
- La app es de **tema claro únicamente**; no hay tema oscuro y no se pidió uno.

## Brand Commitments

- Nombre del asistente: **Vig-IA**. En el CRM comercial es AGT-003.
- **Lenguaje del comercial, no del sistema.** Se escribe de usted. Nada de "Prospecto" suelto,
  "$ 0 M aprobado" ni "Lleva al menos 0 día(s)".
- Identidad visual existente en `src/styles.css` y `src/design-tokens.css`: fondo claro con
  degradado, azul #1b64f2 como acento, tipografía Inter con respaldo del sistema. El rediseño de
  Mi día es de jerarquía y estructura; la identidad no se toca.

## Evidence on Hand

- Datos reales en Supabase (`v_psi_sales_opportunity_enriched`, proyecto `tyfzjqzcpgwcjnxozaaf`).
- Capturas de producción enviadas por Juan el 2026-10-22 (`f0-7af2bda`).
- Pruebas estáticas que vigilan los textos y la estructura de Mi día: `npm run test:agt003`
  (348 pass al 2026-10-22) y `npm run check:backend-parity`.
- No hay archivo de contratos vigentes: sin él no hay renovaciones, venta cruzada ni ficha 360.
  No inventar esa información.

## Product Principles

1. Una pregunta por bloque, en orden: qué hago ahora → qué viene → cómo voy.
2. Un solo elemento fuerte por pantalla: el de "ahora". Todo lo demás baja de peso.
3. Celular primero en Mi día; la ficha de la oportunidad se diseña para computador.
4. El chat es una herramienta, no el protagonista.
5. Los estados vacíos son el caso normal y se diseñan como tales.

## Accessibility & Inclusion

Contraste mínimo 4.5:1 en texto normal, foco de teclado visible y área táctil mínima de 44 px,
verificados a 390 px y 1280 px. Criterio fijado por Juan en el plan del 2026-10-22.
