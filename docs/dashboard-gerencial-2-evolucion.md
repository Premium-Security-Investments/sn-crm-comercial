# Dashboard gerencial 2 — evolución propuesta

Fecha: 2026-06-23
Estado: documento de criterio / no implementado

## Objetivo

Usar el Dashboard gerencial 2 como única vista gerencial futura, absorbiendo lo mejor del dashboard original antes de eliminarlo. Este documento no implica implementación; deja registrada la lectura de qué conviene rescatar y cómo debería evolucionar la vista.

## Principio rector

El Dashboard 2 no debe ser una copia del dashboard original. Debe convertirse en una sala de decisión ejecutiva: menos visualización decorativa, más foco en decisiones comerciales concretas.

Prioridad visual:

1. Qué requiere decisión hoy.
2. Qué monto está en riesgo o cerca de cierre.
3. Dónde está concentrado o trabado el pipeline.
4. Qué comercial, regional, etapa o tipo de servicio necesita foco.
5. Qué tendencia respalda o contradice la lectura del día.

---

## Elementos rescatables del dashboard original

### 1. Sala de control comercial

Rescatar el concepto de encabezado ejecutivo dinámico.

Ejemplo observado:

> 10 gestiones vencidas requieren decisión hoy.

Valor para Dashboard 2:

- Traduce datos en una decisión diaria.
- Evita que el gerente tenga que interpretar 20 métricas antes de actuar.
- Permite priorizar por riesgo económico.

Aplicación sugerida en D2:

- Mensaje principal dinámico.
- Valor económico asociado.
- Acción sugerida.
- KPIs de soporte: pipeline activo, forecast ponderado, pipeline en riesgo, cierres próximos.

### 2. Prioridad gerencial de hoy

Rescatar las tarjetas:

- Sin próxima acción.
- Gestión vencida.
- Cierre próximo.
- Alto valor estancado.

Valor para Dashboard 2:

- Es el bloque más accionable del dashboard original.
- Permite separar problemas de disciplina comercial de oportunidades de cierre.
- Debe ubicarse muy arriba en la vista.

Aplicación sugerida en D2:

- Mantener cuatro tarjetas principales.
- Cada tarjeta debe tener número de oportunidades, valor económico y acción.
- Evitar exceso de texto; la lectura debe ser inmediata.

### 3. Semáforos ejecutivos

Rescatar los semáforos de:

- Concentración del pipeline.
- Efectividad / conversión de cierre.
- Disciplina de agenda.
- Cumplimiento de meta mensual.

Valor para Dashboard 2:

- Da lectura de salud comercial sin entrar todavía al detalle.
- Ayuda a saber si el problema es de volumen, cierre, seguimiento o concentración.

Aplicación sugerida en D2:

- Usar color semafórico con explicación corta.
- No mostrar solo porcentajes; cada porcentaje debe tener lectura ejecutiva.
- Ejemplo: “57% del pipeline está en Envío de Oferta. Riesgo: cuello de botella comercial.”

### 4. Top oportunidades que requieren decisión

Rescatar la intención de la tabla, no necesariamente su forma actual.

Valor para Dashboard 2:

- Ayuda a convertir el dashboard en una lista de decisiones.
- Identifica cliente, comercial, valor, próxima acción y riesgo.

Aplicación sugerida en D2:

- Convertir en “Decisiones comerciales pendientes”.
- Reducir columnas a lo esencial: cliente, comercial, valor, riesgo, acción requerida.
- Priorizar por valor en riesgo, vencimiento o cierre próximo.

### 5. Concentración y avance del pipeline

Rescatar el análisis por etapa.

Valor para Dashboard 2:

- Muestra dónde está trabado el pipeline.
- Permite detectar concentración excesiva en una etapa, por ejemplo Envío de Oferta.
- Complementa los KPIs de forecast y riesgo.

Aplicación sugerida en D2:

- Mantener lectura ejecutiva: etapa dominante, porcentaje, valor ponderado y acción recomendada.
- Evitar que sea solo una tabla; debe explicar el cuello de botella.

### 6. Ranking comercial ejecutivo

Rescatar el formato de ranking ejecutivo por comercial, no el indicador “salud 0/100” como métrica principal.

Valor para Dashboard 2:

- Muestra concentración por comercial.
- Permite comparar pipeline, forecast, aprobado y conversión.
- Las etiquetas “Cierre fuerte”, “En observación” y “Requiere foco” son más comprensibles que un score abstracto.

Aplicación sugerida en D2:

- Ranking por comercial con: pipeline, participación, forecast, aprobado, conversión y estado.
- Mantener explicación de criterio.
- Evitar rankings que parezcan castigo sin contexto.

### 7. Tendencia comercial disponible

Rescatar como bloque secundario, no como protagonista.

Valor para Dashboard 2:

- Da contexto de evolución mensual.
- Permite ver si el mes actual está acelerando o cayendo.

Aplicación sugerida en D2:

- Ubicar al final o como sección expandible.
- Mostrar últimos 6 meses con ventas aprobadas, prospectos y cotizaciones.
- No competir visualmente con prioridades del día.

---

## Elementos que no conviene copiar tal cual

### 1. Score de salud 0/100 como protagonista

Riesgo:

- Puede sentirse arbitrario.
- Requiere explicar fórmula.
- Puede generar discusión interna si alguien aparece con 0/100 sin contexto.

Preferencia:

- Usar etiquetas interpretables: Cierre fuerte, En observación, Requiere foco.
- Mostrar causas: sin agenda, vencidas, baja conversión, forecast, aprobado.

### 2. Exceso de links “Ver…”

Riesgo:

- Todo parece clickeable, pero nada parece prioritario.
- Reduce la jerarquía ejecutiva.

Preferencia:

- Pocas acciones fuertes: Ver casos críticos, Asignar próxima acción, Revisar etapa dominante, Ver comerciales en foco.

### 3. Tablas demasiado densas

Riesgo:

- La vista deja de ser gerencial y se vuelve operativa.
- El usuario vuelve a interpretar manualmente.

Preferencia:

- Listas de decisión y resúmenes accionables.
- Tablas solo cuando aporten priorización clara.

---

# Filtros gerenciales para Dashboard 2

## Problema actual

Dashboard 2 no tiene todavía un sistema de filtros gerenciales equivalente al dashboard original. Esto limita la capacidad de responder preguntas como:

- ¿Cómo está el pipeline solo de Seguridad Física?
- ¿Qué pasa si excluyo servicios no activos?
- ¿Qué comercial está concentrando riesgo en una regional específica?
- ¿Qué etapa domina dentro de un tipo de servicio?
- ¿Cómo cambia el forecast si filtro por mes, regional o comercial?

## Objetivo de filtros

Los filtros no deben ser una sección decorativa. Deben cambiar toda la lectura del Dashboard 2:

- KPIs superiores.
- Prioridades gerenciales.
- Semáforos.
- Top decisiones.
- Concentración por etapa.
- Ranking comercial.
- Tendencia.

Cada métrica visible debe responder al contexto filtrado.

## Filtros recomendados

### 1. Período

Opciones sugeridas:

- Hoy.
- Mes actual.
- Trimestre actual.
- Año 2026.
- Rango personalizado.

Uso:

- Controla ventas aprobadas, forecast, cierres próximos, metas, tendencia y actividad.

### 2. Tipo de servicio

Filtro clave solicitado.

Opciones esperadas según datos disponibles:

- Todos los servicios.
- Seguridad Física.
- Seguridad Electrónica.
- Consultoría / otros si existen en CRM.
- Licitación pública si se maneja como tipo de servicio.

Uso:

- Permite separar el negocio core de servicios adicionales.
- Evita que el pipeline general oculte comportamiento específico.
- Debe afectar ranking, pipeline, forecast, riesgos y top oportunidades.

Regla UX:

- Si solo hay un servicio visible en el contexto actual, mostrarlo como filtro activo, no como una métrica redundante.

### 3. Comercial

Opciones:

- Todos los comerciales.
- Comercial individual.

Uso:

- Permite revisar gestión individual.
- Debe recalcular ranking, oportunidades críticas y estado de agenda.

### 4. Regional

Opciones:

- Todas las regionales.
- Regional específica.
- Regional pendiente / sin regional.

Uso:

- Ayuda a detectar mala calidad de datos o concentración regional.
- “Regional pendiente” debe ser una opción explícita, no quedar escondida.

### 5. Etapa

Opciones:

- Todas las etapas.
- Prospecto.
- Envío de Oferta.
- Sustentación.
- Negociación.
- Aprobado.
- Perdido.
- Descartado.

Uso:

- Permite analizar cuellos de botella específicos.
- Muy útil junto con tipo de servicio y comercial.

### 6. Estado de gestión

Opciones sugeridas:

- Todo.
- Pipeline activo.
- Sin próxima acción.
- Gestión vencida.
- Cierre próximo.
- Alto valor estancado.

Uso:

- Convierte las tarjetas de prioridad en filtros accionables.
- Si el usuario hace clic en “Gestión vencida”, el dashboard debería quedar filtrado por esos casos.

### 7. Búsqueda libre

Placeholder sugerido:

> Buscar cliente, comercial, sede, ciudad o NIT

Uso:

- Ubicar una cuenta o cliente específico sin salir del dashboard.

---

## Filtros mínimos para primera iteración

Para no sobrecargar D2, la primera versión debería incluir solo los filtros de mayor impacto:

1. Período.
2. Tipo de servicio.
3. Comercial.
4. Regional.
5. Etapa.
6. Pipeline activo.
7. Búsqueda libre.

Luego se pueden agregar filtros por estado de gestión si la UX lo pide.

## Comportamiento recomendado

### Aplicación inmediata

Los filtros deberían aplicar inmediatamente al cambiar la selección, sin botón “Aplicar”.

### Botón limpiar

Debe existir “Limpiar filtros” para volver al contexto general.

### Resumen visible

Debajo de filtros mostrar:

> 263 de 300 oportunidades visibles · Última actualización: 22/06/2026

Y si hay filtro activo:

> 220 de 300 oportunidades visibles · Servicio: Seguridad Física · Mes actual

### Persistencia temporal

Mientras el usuario navega dentro del Dashboard 2, los filtros deberían mantenerse activos. Si cambia de vista y vuelve, idealmente conserva el contexto durante la sesión.

### Chips de filtros activos

Si se activan varios filtros, mostrar chips compactos:

- Servicio: Seguridad Física
- Comercial: Jhon Bermudez
- Etapa: Envío de Oferta

Esto evita que el gerente pierda contexto.

---

## Ubicación sugerida de filtros en Dashboard 2

Ubicarlos debajo del encabezado ejecutivo y antes de prioridades gerenciales.

Razón:

- El usuario primero entiende la sala de control general.
- Luego puede filtrar.
- Todo lo demás se recalcula bajo ese contexto.

Estructura sugerida:

1. Header / sala de control.
2. Filtros gerenciales.
3. Prioridad gerencial de hoy.
4. Semáforos ejecutivos.
5. Decisiones comerciales pendientes.
6. Concentración de pipeline.
7. Ranking comercial.
8. Tendencia.

---

## Consideraciones importantes

- No implementar filtros como cosmético visual: deben recalcular todos los bloques.
- Tipo de servicio es prioritario porque permite analizar Seguridad Física sin mezclar otros negocios.
- Evitar repetir el nombre del filtro dentro de las opciones. Ejemplo: usar “Seguridad Física”, no “Tipo de servicio: Seguridad Física”.
- Mantener labels externos y opciones cortas.
- Los filtros deben ayudar al gerente a responder preguntas, no crear una interfaz de analista pesada.

## Estado

Pendiente de implementación. Este documento queda como guía para la siguiente iteración del Dashboard gerencial 2.
