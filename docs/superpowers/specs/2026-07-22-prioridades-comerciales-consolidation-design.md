# Diseño — Prioridades Comerciales consolidada

**Fecha:** 2026-07-22
**Estado:** Aprobado por producto
**Alcance:** consolidar Alertas Comerciales y la capacidad comercial actual de Vig-IA

## Decisión

La pestaña actual **Alertas Comerciales** se transformará en **Prioridades Comerciales** y permanecerá en la sección **Comercial**.

No será solamente un cambio de nombre. La nueva vista desplegará una única experiencia consolidada con las capacidades útiles de **Alertas Comerciales** y de la versión comercial actual de **Vig-IA / AGT-003**.

## Objetivo

Prioridades Comerciales responderá:

> ¿Qué oportunidades requieren atención, por qué y cuál es la siguiente acción humana recomendada?

El Dashboard Comercial continuará respondiendo cómo está el negocio en general. Prioridades Comerciales será la bandeja de intervención.

## Capacidades provenientes de Alertas Comerciales

- filtros por comercial, región, etapa, producto y tipo de cliente;
- pipeline en riesgo;
- oportunidades sin próxima acción;
- gestiones vencidas;
- sustentación estancada;
- cierres próximos;
- bandeja de acción;
- acceso para registrar seguimiento en la oportunidad;
- marcación local como revisada.

## Capacidades provenientes de Vig-IA

- motor determinístico `AGT-003`;
- score de prioridad;
- clasificación alta, media y baja;
- señales y puntos;
- evidencia utilizada;
- explicación de la prioridad;
- recomendación humana;
- fuente, fecha de corte y versión de política;
- actualización de lectura;
- navegación gobernada al Dashboard y a la oportunidad;
- autorización y alcance resueltos antes de leer el CRM;
- operación read-only.

## Regla de consolidación

El motor de Vig-IA será la fuente canónica de priorización. No se mantendrán dos motores independientes calculando alertas diferentes para la misma oportunidad.

Las categorías operativas de Alertas se derivarán o mapearán desde las señales y prioridades producidas por Vig-IA. La interfaz conservará la rapidez de los filtros de Alertas, pero cada prioridad podrá mostrar score, evidencia y recomendación de Vig-IA.

## Navegación

La sección Comercial mostrará:

```text
COMERCIAL
├── Dashboard Comercial
├── Prioridades Comerciales
├── Oportunidades
└── Metas y cumplimiento
```

La ruta existente `#/alerts` se conservará inicialmente para no romper enlaces guardados, aunque su nombre visible será Prioridades Comerciales.

La capacidad comercial que hoy se expone en la ruta de Vig-IA se trasladará a Prioridades Comerciales. La ruta anterior de Vig-IA no mantendrá una segunda copia de esa misma experiencia; durante la transición podrá redirigir a Prioridades Comerciales.

## Vig-IA futura

Esta consolidación no define todavía el futuro centro transversal de agentes.

La decisión posterior deberá establecer si Vig-IA se convierte en:

- una sección global de agentes;
- una capa contextual dentro de cada módulo;
- o una combinación de ambas.

Esa decisión no cambia que `AGT-003` continúe impulsando Prioridades Comerciales.

## Permisos y alcance

- Los usuarios conservarán el alcance comercial autorizado por rol, módulo, área y propietario.
- El agente no ampliará los permisos del usuario.
- Se diseñará una transición de permisos para no retirar acceso legítimo durante la consolidación.
- Los botones hacia Dashboard y oportunidad seguirán dependiendo de permisos explícitos.
- Licitaciones permanecerá separada.

## Fuera de alcance

Esta fase no incluye:

- crear un centro global de agentes;
- incorporar nuevos agentes;
- modificar oportunidades automáticamente;
- persistir el feedback local;
- enviar mensajes o asignar tareas automáticamente;
- ejecutar migraciones de datos;
- mezclar Licitaciones con prioridades del CRM privado.

## Criterios de aceptación

- La pestaña aparece como **Prioridades Comerciales** dentro de Comercial.
- Existe una sola experiencia para alertas y prioridades comerciales.
- Los filtros operativos de Alertas continúan disponibles.
- Cada prioridad puede mostrar score, señales, evidencia y recomendación de Vig-IA.
- El motor `AGT-003` es la fuente canónica de priorización.
- No existe una segunda copia comercial activa en la antigua pestaña Vig-IA.
- Los enlaces existentes se mantienen mediante compatibilidad o redirección.
- Los permisos y alcances siguen fallando cerradamente.
- La experiencia permanece read-only y requiere decisión humana.
- Las pruebas, integración, build, audit y smoke por roles continúan aprobando.
