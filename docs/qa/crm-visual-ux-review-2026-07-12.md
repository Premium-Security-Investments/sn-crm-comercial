# QA visual y UX — CRM Comercial SN / PSI

Fecha: 2026-07-12  
Repo oficial: `Premium-Security-Investments/sn-crm-comercial`  
Aplicación local auditada: `http://127.0.0.1:4173`  
Stack: React + Vite + Express + Supabase  
Auditoría: Hermes + segunda revisión independiente con ClaudeSdk/Claude Code, solo lectura.

## 1. Objetivo

Antes de seguir agregando pestañas, botones o módulos, se hizo una revisión visual/UX para responder:

> ¿Cada pantalla ayuda a tomar una decisión o ejecutar una acción concreta, o solo agrega ruido?

Criterios usados:

- Claridad de navegación.
- Utilidad real por pantalla.
- Exceso de botones, filtros o tablas.
- Duplicidad entre módulos.
- Legibilidad de tablas y tarjetas.
- Facilidad de consulta gerencial/comercial.
- Riesgo de seguir creciendo por acumulación.

## 2. Resumen ejecutivo

El CRM ya tiene una base funcional importante, pero el crecimiento reciente empieza a mostrar señales de saturación visual:

- Hay pantallas muy largas que mezclan reporte, operación y configuración.
- Hay módulos que se parecen entre sí: Dashboard, Alertas, Vig-IA y Oportunidades comparten información y podrían confundirse.
- Licitaciones tiene buena intención operativa, pero algunas subvistas aún se sienten como la misma pantalla con distinto título.
- Las tablas de Alertas y Oportunidades son demasiado largas para una consulta rápida.
- Hay botones que parecen principales pero realmente son filtros o accesos secundarios.
- La navegación lateral mezcla módulos, acciones y configuración en una misma lista.

Recomendación principal:

> No agregar más pestañas ni botones hasta corregir navegación, jerarquía y densidad de las pantallas principales.

## 3. Inventario observado por pantalla

| Pantalla | Botones | Inputs/selects | Links | Tablas | Texto aprox. | Diagnóstico |
|---|---:|---:|---:|---:|---:|---|
| Dashboard gerencial | 19 | 7 | 54 | 6 | 11.6k | Visual fuerte, pero demasiado largo; mezcla dashboard, forecast, alertas, cumplimiento y tendencias. |
| SIIO Gerencial | 6 | 0 | 0 | 0 | 1.1k | Se siente como landing/placeholder. Debe implementarse con contenido real o bajarse de prioridad visual. |
| Alertas comerciales | 19 | 7 | 0 | 2 | 31k | Tabla infinita; no funciona como bandeja de acción. Duplica Oportunidades filtradas. |
| Licitaciones / Radar | 1 | 0 | 0 | 0 | 99 | Bug: al navegar directo a `#/tenders?view=radar` aparece casi vacío. |
| Licitaciones / Seguimiento | 17 | 10 | 0 | 0 | 1.7k | Cambia el título pero se parece demasiado a otras vistas de licitaciones. |
| Licitaciones / Expedientes | 17 | 24 | 0 | 0 | 1.7k | Misma estructura que Seguimiento; riesgo de falsa separación funcional. |
| Licitaciones / Perfiles | 115 | 26 | 27 | 0 | 14k | Funcional pero cargada: perfiles, regiones, empresa, filtros y radar/listado en una sola pantalla. |
| Oportunidades | 11 | 7 | 0 | 1 | 28k | Vista útil, pero tabla demasiado larga y densa; requiere paginación/columnas prioritarias. |
| Vig-IA | 18 | 1 | 0 | 2 | 4.9k | Puede duplicar Dashboard/Alertas si no se delimita mejor. |
| Crear oportunidad | 2 | 18 | 0 | 0 | 0.8k | Formulario claro, pero no debería ser ítem permanente del sidebar. |
| Metas y cumplimiento | 7 | 12 | 0 | 1 | 2.5k | Mezcla consulta gerencial y edición/carga de metas. |
| Usuarios y permisos | 19 | 8 | 0 | 1 | 1.8k | Correcto como módulo admin; debe quedar agrupado como configuración. |

## 4. Hallazgos críticos

### H1 — Bug de navegación directa en Licitaciones Radar

Se observó que `#/tenders?view=radar` puede cargar una pantalla casi vacía: solo título `Licitaciones` y botón `Nueva oportunidad`.

Impacto:

- Mala primera impresión en demo.
- Rompe enlaces directos.
- Puede hacer creer que no hay procesos cargados.

Prioridad: **Crítica**.

Recomendación:

- Revisar inicialización de estado interno de filtros/sección en `TendersRadar`.
- Asegurar que cada vista de licitaciones pueda abrirse directo por URL.
- Agregar test estático o funcional para `radar`, `seguimiento`, `expedientes` y `perfiles`.

### H2 — Alertas comerciales no funciona como bandeja de acción

Visualmente la pantalla muestra una tabla enorme de alertas. El usuario debe leer y hacer scroll durante mucho tiempo.

Problema:

- Una alerta debería decir qué requiere acción ahora.
- La tabla actual se parece a una versión filtrada de Oportunidades.
- No hay límite visible de prioridad ni estados de resolución.

Prioridad: **Alta**.

Recomendación:

- Convertir Alertas en una bandeja priorizada, no una tabla infinita.
- Mostrar máximo 20 alertas críticas por defecto.
- Agrupar por tipo:
  - Sin próxima acción.
  - Vencidas.
  - Sin seguimiento reciente.
  - Alto valor en riesgo.
- Cada alerta debe tener una acción clara:
  - Ver oportunidad.
  - Registrar seguimiento.
  - Marcar revisada.
  - Reasignar / agendar próxima acción.

### H3 — Dashboard gerencial demasiado largo

El Dashboard tiene buena apariencia y contenido valioso, pero intenta resolver demasiadas preguntas a la vez.

Problema:

- Mezcla resumen ejecutivo, presupuesto, ranking, pipeline, top oportunidades, alertas, semáforos y tendencia.
- Se vuelve un reporte completo, no una pantalla de decisión rápida.
- Hay acciones repetidas como botones y tarjetas.

Prioridad: **Alta**.

Recomendación:

Dejar el dashboard con:

1. 4–6 KPIs principales.
2. 1 lectura ejecutiva.
3. 3 prioridades críticas.
4. 1 bloque de pipeline o forecast.
5. Links hacia pantallas específicas para profundizar.

Mover detalle pesado a:

- Alertas.
- Metas.
- Oportunidades.
- Reportes / Vig-IA, si se conserva.

### H4 — Licitaciones Perfiles mezcla configuración y operación

La vista `Perfiles de búsqueda` contiene:

- Hero de licitaciones.
- KPIs.
- Filtros rápidos.
- Información empresa.
- Regiones.
- Guardado de perfiles.
- Perfiles sugeridos.
- Buscador/filtros de radar.
- Vista unificada de licitaciones.

Problema:

- El usuario que configura perfiles no necesariamente quiere revisar procesos.
- La lista de licitaciones dentro de Perfiles duplica Radar.
- 115 botones es señal clara de saturación.

Prioridad: **Alta**.

Recomendación:

- `Perfiles de búsqueda` debe ser solo configuración.
- La lista/radar de licitaciones debe vivir solo en Radar/Seguimiento.
- La información empresa debe ir a una ficha compacta o modal `Empresa licitante`.
- Reducir botones repetidos por tarjeta.

### H5 — Oportunidades necesita densidad controlada

La vista es útil y tiene KPIs/filtros correctos, pero la tabla se vuelve muy larga y difícil de consultar.

Problema:

- Muchísimas filas en una sola pantalla.
- Las filas contienen demasiada información comprimida.
- La lectura se vuelve cansada.

Prioridad: **Media-Alta**.

Recomendación:

- Paginación de 25 o 50 registros.
- Columnas prioritarias:
  - Cliente.
  - Responsable.
  - Etapa.
  - Valor.
  - Próxima acción.
  - Último seguimiento / riesgo.
- Mover información secundaria al detalle lateral o ficha.

## 5. Hallazgos de navegación

### Navegación actual

El sidebar mezcla:

- Vistas ejecutivas.
- Módulos operativos.
- Acciones como `Crear oportunidad`.
- Configuración como `Usuarios y permisos`.
- Submódulos de Licitaciones.

Esto hace que el CRM parezca más grande y complejo de lo necesario.

### Navegación recomendada

Agrupar el sidebar en tres bloques:

```text
Visión ejecutiva
- Dashboard gerencial
- SIIO Gerencial
- Vig-IA / Reportes IA

Operación comercial
- Oportunidades
- Alertas comerciales
- Licitaciones
  - Radar
  - Seguimiento
  - Expedientes
  - Perfiles

Administración
- Metas y cumplimiento
- Usuarios y permisos
```

Recomendaciones adicionales:

- Mover `Crear oportunidad` fuera del sidebar. Debe ser botón contextual dentro de Oportunidades.
- Mantener Licitaciones como grupo colapsable.
- No duplicar navegación del sidebar dentro del contenido.
- Separar configuración de operación.

## 6. Reglas de diseño recomendadas

### Regla 1 — Una pantalla, una pregunta

Cada pantalla debe responder una pregunta dominante:

| Pantalla | Pregunta que debe responder |
|---|---|
| Dashboard | ¿Cómo va el negocio hoy? |
| Alertas | ¿Qué necesita atención ahora? |
| Oportunidades | ¿En qué estado está el pipeline? |
| Licitaciones Radar | ¿Qué procesos públicos conviene revisar? |
| Licitaciones Seguimiento | ¿Qué procesos ya están en revisión y qué sigue? |
| Expedientes | ¿Qué documentos y decisiones faltan para ofertar? |
| Perfiles | ¿Qué criterios de búsqueda tenemos guardados? |
| Metas | ¿Cómo va el cumplimiento contra presupuesto? |
| Usuarios | ¿Quién puede entrar y con qué permisos? |

### Regla 2 — Acción, filtro y navegación no deben verse igual

- Navegación: sidebar.
- Filtros: barra superior o panel compacto.
- Acciones: botones cerca del objeto sobre el que actúan.

### Regla 3 — No más tablas infinitas

Para consultas operativas:

- Máximo 25–50 filas por página.
- Orden claro por prioridad.
- Filtros visibles.
- Acción primaria por fila.

### Regla 4 — Menos botones principales

Cada pantalla debe tener máximo una acción primaria.

Ejemplos:

- Oportunidades: `Nueva oportunidad`.
- Alertas: `Atender alerta` / `Ver oportunidad` por fila.
- Licitaciones Radar: `Actualizar fuentes` o `Crear oportunidad` según contexto.
- Perfiles: `Guardar perfil actual`.
- Usuarios: `Guardar usuario`.

### Regla 5 — Configuración no debe competir con operación

Usuarios, metas editables y perfiles de búsqueda deben sentirse secundarios frente a operación comercial diaria.

## 7. Plan de intervención recomendado

### Fase 1 — Correcciones críticas de navegación

1. Corregir bug de `#/tenders?view=radar` vacío.
2. Validar acceso directo a todas las subvistas de Licitaciones.
3. Asegurar que no haya navegación duplicada dentro de cada módulo.
4. Agrupar sidebar por intención de uso.

### Fase 2 — Limpieza de pantallas saturadas

1. Convertir Alertas en bandeja priorizada.
2. Reducir Dashboard a resumen ejecutivo real.
3. Separar Perfiles de búsqueda del radar operativo.
4. Revisar Vig-IA para decidir si se conserva, renombra o absorbe.

### Fase 3 — Mejorar consulta de datos

1. Paginación/scroll controlado en Oportunidades.
2. Paginación/estado en Alertas.
3. Detalle lateral o ficha para información secundaria.
4. Ordenamiento por prioridad real, no solo por valor.

### Fase 4 — QA visual final

Validar en navegador:

- Desktop 1440px.
- Laptop 1366px.
- Tablet si aplica.
- Consola sin errores.
- Navegación directa por URL.
- Flujo principal de cada módulo.

## 8. Prioridad de implementación

| Prioridad | Acción | Motivo |
|---|---|---|
| P0 | Corregir Radar de Licitaciones vacío por URL directa | Bug visible, afecta demo y uso real. |
| P1 | Rediseñar Alertas como bandeja de acción | Es la pantalla más saturada y menos accionable. |
| P1 | Reducir Dashboard gerencial | Debe ser decisión rápida, no informe completo. |
| P1 | Separar Perfiles de Licitaciones del radar/listado | Evita duplicidad y reduce 115 botones. |
| P2 | Agrupar navegación lateral | Mejora orientación sin reescribir lógica. |
| P2 | Paginación/columnas prioritarias en Oportunidades | Mejora lectura diaria del pipeline. |
| P2 | Metas en modo lectura + edición explícita | Reduce riesgo y carga visual. |
| P3 | Decidir futuro de Vig-IA | Evita duplicidad conceptual. |

## 9. Segunda revisión ClaudeSdk

La segunda revisión independiente coincidió en los siguientes puntos:

- El bug de navegación directa de Licitaciones/Radar debe corregirse primero.
- Alertas es hoy más un log o tabla filtrada que una bandeja de trabajo.
- Dashboard debe reducirse aproximadamente 50–60% y enlazar al detalle, no contenerlo todo.
- Perfiles de búsqueda debe separarse de la operación diaria del radar.
- `Crear oportunidad` no debería ser un ítem permanente del sidebar.
- Vig-IA debe delimitarse mejor o absorberse dentro de Dashboard/Reportes.

## 10. Decisión recomendada antes de seguir desarrollando

Congelar temporalmente nuevas pestañas/botones hasta completar al menos P0 y P1.

Regla operativa propuesta:

> El CRM no debe crecer por acumulación de controles. Debe crecer por claridad de decisión y reducción de trabajo manual.

Antes de aprobar una nueva función, exigir:

1. Usuario principal.
2. Pregunta que responde.
3. Acción que habilita.
4. Lugar correcto en navegación.
5. Evidencia de que no duplica una pantalla existente.

## 11. Comandos de verificación ejecutados

```bash
npm run build
```

Resultado:

```text
✓ built successfully
```

También se validó en navegador local con sesión admin temporal y consola sin errores visibles durante la revisión inicial del Dashboard.

## 12. Complemento SIIO / navegación

Se incorporó como anexo el reporte específico de navegación CRM / SIIO Gerencial:

```text
docs/qa/crm-siio-navigation-qa-report-v1-2026-07-12.md
```

Ese complemento aterriza la revisión sobre la preview `feature/siio-f2-mvp`, especialmente:

- Diferencia entre `Dashboard gerencial` comercial y `SIIO Gerencial`.
- Estado pre-login de SIIO.
- Matriz de rutas principales.
- Botones sensibles que requieren clasificación visual y confirmación.
- Recomendación de agrupar navegación por dominios: Gerencia, Comercial, Licitaciones y Administración.

