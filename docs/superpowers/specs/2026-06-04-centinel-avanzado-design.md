# Centinel Avanzado — Diseño funcional

Fecha: 2026-06-04  
Proyecto: CRM Comercial Seguridad Nacional  
Alcance aprobado: habilitar Centinel avanzado para roles `admin`, `director`/Directivo y `gerencia`.

## Objetivo

Convertir Centinel de una sección de consulta/búsqueda segura a un copiloto ejecutivo comercial que ayude a dirección a priorizar riesgos, preparar comités y decidir qué oportunidades o comerciales necesitan intervención.

La primera versión avanzada debe seguir siendo **solo lectura**: no cambia etapas, no crea seguimientos, no envía correos y no modifica datos. Su valor está en interpretar el estado del CRM, ordenar prioridades y explicar por qué una oportunidad/comercial requiere atención.

## Usuarios y permisos

### Roles con Centinel avanzado

- `admin`
- `director` — etiqueta visible: Directivo
- `gerencia`

Estos roles ven el radar ejecutivo completo sobre todas las oportunidades y comerciales visibles en el bootstrap gerencial.

### Roles sin Centinel avanzado

- `comercial`: mantiene acceso limitado a vistas operativas propias si se decide mantener la navegación, pero no recibe radar gerencial global.
- Cualquier otro rol futuro: por defecto no recibe Centinel avanzado hasta que se autorice.

## Concepto de producto

Centinel Avanzado se presenta como un **Radar Gerencial Comercial** con cuatro modos principales:

1. **Qué revisar hoy**
2. **Oportunidades en riesgo**
3. **Brief por comercial**
4. **Resumen para comité**

Cada modo debe entregar:

- Tarjetas ejecutivas con métricas clave.
- Tabla priorizada y clicable.
- Motivo de riesgo o prioridad.
- Acción sugerida.
- Acceso rápido al detalle de la oportunidad.

## Motor de riesgo comercial

La base de Centinel Avanzado será un motor determinístico, no IA libre. Calcula un score por oportunidad con señales claras y auditables.

### Señales de riesgo por oportunidad

Cada oportunidad activa se evalúa con estas señales:

- Sin próxima acción registrada.
- Próxima acción vencida.
- Próxima acción para hoy.
- Más de 5 días sin seguimiento.
- Más de 10 días sin seguimiento.
- Valor alto frente al resto del pipeline.
- Etapa crítica: sustentación, negociación, cierre o equivalente según `stage_code` existente.
- Fecha estimada de cierre cercana o vencida.
- Oportunidad en etapa avanzada sin actividad reciente.
- Comercial asociado con bajo cumplimiento o muchas alertas.

### Categorías de riesgo

El score se traduce en tres niveles:

- **Alto**: requiere revisión gerencial inmediata.
- **Medio**: requiere seguimiento o validación esta semana.
- **Bajo**: sin señales críticas, mantener monitoreo.

Cada clasificación debe incluir explicación humana, por ejemplo:

> Alto: 12 días sin seguimiento, sin próxima acción y en etapa de sustentación.

## Modo 1 — Qué revisar hoy

Vista prioritaria para dirección. Debe responder la pregunta:

> ¿Qué necesita atención comercial hoy?

### Contenido

- Top oportunidades de riesgo alto.
- Oportunidades con próxima acción vencida.
- Oportunidades sin agenda y con valor relevante.
- Clientes en sustentación sin movimiento.
- Comerciales con mayor cantidad de alertas.
- Valor total en riesgo.

### Tarjetas sugeridas

- Riesgo alto
- Valor en riesgo
- Acciones vencidas
- Comercial con más alertas

### Tabla

Columnas:

- Cliente
- Comercial
- Etapa
- Valor
- Riesgo
- Motivo
- Acción sugerida
- Último seguimiento / próxima acción

## Modo 2 — Oportunidades en riesgo

Vista enfocada en priorización de pipeline.

### Contenido

- Ranking de oportunidades activas por score de riesgo.
- Filtros rápidos por riesgo alto/medio/bajo.
- Enfoque especial en oportunidades de alto valor y etapas avanzadas.

### Acciones sugeridas posibles

- Agendar próxima gestión.
- Pedir actualización al comercial.
- Validar decisor y siguiente paso.
- Escalar a gerencia.
- Revisar propuesta/valor si está estancada.

Estas acciones son solo texto recomendado en V1.

## Modo 3 — Brief por comercial

Vista para preparar reuniones 1:1 o seguimiento de equipo.

### Contenido por comercial

- Pipeline activo total.
- Número de oportunidades activas.
- Oportunidades sin agenda.
- Oportunidades vencidas.
- Oportunidades de riesgo alto.
- Ventas aprobadas del mes.
- Meta y cumplimiento cuando existan datos.
- Tres prioridades sugeridas.

### Tabla agrupada

Cada comercial debe aparecer como una tarjeta o bloque colapsable con:

- Semáforo general.
- Métricas clave.
- Top oportunidades para revisar.
- Recomendación gerencial.

## Modo 4 — Resumen para comité

Vista ejecutiva lista para leer en reunión.

### Contenido

- Estado general del pipeline.
- Valor total y valor ponderado.
- Riesgos principales.
- Oportunidades con mayor potencial de cierre.
- Comerciales o etapas que requieren intervención.
- Próximas acciones recomendadas para la semana.

### Formato

Debe combinar:

- Tarjetas de resumen.
- Bloque narrativo corto.
- Lista priorizada de 5 a 10 puntos.
- Tabla de oportunidades críticas.

La narrativa en V1 puede generarse con reglas y plantillas. La conexión a IA externa queda como evolución posterior.

## Arquitectura propuesta

### Frontend

El archivo actual `src/main.tsx` ya contiene `CentinelAssistant`, `interpretCentinelQuery` y los quick actions. Para V1 avanzada, se recomienda extraer lógica a unidades más pequeñas para evitar seguir creciendo un archivo ya grande.

Nuevas piezas sugeridas:

- `src/lib/centinel.ts`
  - `computeOpportunityRisk`
  - `buildExecutiveRadar`
  - `buildCommercialBriefs`
  - `buildCommitteeSummary`
  - helpers de score, motivos y acciones sugeridas

- `src/components/CentinelAdvanced.tsx`
  - UI de tabs/modos.
  - tarjetas ejecutivas.
  - tablas priorizadas.

- `src/components/CentinelRiskBadge.tsx`
  - badge Alto/Medio/Bajo.

Si se quiere minimizar refactor inicial, puede implementarse dentro de `main.tsx`, pero la recomendación es extraer al menos la lógica de score a `src/lib/centinel.ts`.

### Backend

Para V1 no se requiere nueva API. El frontend puede usar el `Bootstrap` existente porque ya recibe oportunidades, perfiles, metas, KPIs y totales filtrados por rol.

Más adelante, si Centinel requiere IA o consultas profundas, se debe crear una API dedicada:

- `POST /api/centinel/analyze`

Esa API debería validar rol y solo responder a `admin`, `director` y `gerencia`.

## Data flow

1. Usuario entra a `#/centinel`.
2. La app ya tiene `Bootstrap` cargado desde `/api/bootstrap`.
3. Se valida si el rol actual tiene acceso avanzado.
4. Centinel calcula riesgos y resúmenes localmente sobre los datos visibles.
5. La UI renderiza modos ejecutivos.
6. El usuario puede abrir detalle de oportunidad, pero Centinel no modifica datos.

## Estado vacío y errores

- Si no hay oportunidades activas: mostrar “No hay oportunidades activas para evaluar”.
- Si no hay metas: el brief debe indicar “Metas no cargadas” y no simular cumplimiento.
- Si faltan fechas de seguimiento: usar la mejor fecha disponible entre `last_interaction_at`, `updated_at` y `created_at`.
- Si una oportunidad no tiene comercial: marcar como “Sin comercial” y elevar prioridad si tiene valor relevante.

## Pruebas

### Pruebas estáticas

Agregar o ampliar `tests/centinel-static.test.mjs` para validar:

- Existe acceso avanzado para `admin`, `director`, `gerencia`.
- Existen los cuatro modos: revisar hoy, riesgo, brief comercial, comité.
- Existe motor de score de riesgo.
- Existen motivos y acciones sugeridas.
- Centinel mantiene texto “solo lectura”.

### Pruebas de build

Ejecutar:

```bash
node tests/centinel-static.test.mjs
npm run build
```

## Fuera de alcance V1

- Chat libre con IA generativa.
- Escritura o modificación de oportunidades.
- Envío de emails o notificaciones.
- Creación automática de seguimientos.
- Integración con Teams/Power BI.
- Historial persistente de conversaciones.

## Evolución posterior

### V2 — Narrativa con IA controlada

Usar IA solo para redactar análisis sobre datos ya calculados. La IA no debe consultar directamente la base ni inventar métricas.

### V3 — Acciones con confirmación

Permitir que admin/directivo/gerencia confirmen acciones sugeridas:

- Crear tarea de seguimiento.
- Registrar nota gerencial.
- Enviar recordatorio interno.

Cada acción debe requerir confirmación explícita.

## Decisiones cerradas

- Centinel avanzado aplica a `admin`, `director`/Directivo y `gerencia`.
- V1 es solo lectura.
- V1 prioriza radar gerencial, riesgo, brief por comercial y resumen de comité.
- La IA generativa queda para una fase posterior, después de tener datos y score confiables.
