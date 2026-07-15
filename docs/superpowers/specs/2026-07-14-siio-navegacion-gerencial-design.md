# SIIO — navegación gerencial orientada a tareas

**Fecha:** 2026-07-14  
**Rama:** `feature/siio-manager-navigation`  
**Base:** `main` en `eaec6f9`

## 1. Objetivo

Reorganizar el Dashboard SIIO Gerencial para que un directivo navegue por necesidades de gestión y no por la arquitectura técnica F1–F6.

La navegación principal tendrá exactamente cuatro vistas:

1. **Resumen ejecutivo**
2. **Seguimiento gerencial**
3. **Fuentes e inteligencia**
4. **Agentes**

`Modo Junta` deja de ser una pestaña y un agente independiente. Se convierte en la acción controlada **Preparar informe de Junta**, capacidad del Agente Gerencial SIIO.

Este cambio reorganiza componentes y datos existentes. No crea otra aplicación, no cambia login, repositorio, Vercel, Supabase ni contratos de datos.

## 2. Principios obligatorios

- Mantener SIIO dentro del CRM actual y su ruta protegida.
- Conservar autorización por rol: usuarios comerciales no acceden a SIIO Gerencial.
- Mostrar nómina únicamente agregada. Nunca nombres, cédulas, salarios individuales ni filas personales.
- No eliminar datos ni capacidades existentes: Frentes, Registro F2, decisiones, bloqueos, riesgos, compromisos, Archivo F4, razonamiento F5, catálogo F6 y Junta se recomponen.
- F1–F6 permanecen como metadatos y etiquetas secundarias, no como navegación principal.
- Evitar KPIs, pestañas y filtros duplicados.
- Preservar responsive, drawer móvil, paginación, deduplicación y permisos ya corregidos.
- No aplicar migraciones, tocar Supabase productivo, hacer merge ni desplegar producción durante esta rama.
- Validar mediante preview, pruebas automatizadas y QA visual desktop/móvil.

## 3. Arquitectura frontend

Se extraerá la UI SIIO de `src/main.tsx` hacia un módulo `src/siio/` con límites claros:

- `types.ts`: claves de vista, filtros y tipos de presentación.
- `SiioDashboard.tsx`: carga única de `/api/siio/bootstrap`, autorización defensiva y composición.
- `SiioNavigation.tsx`: cuatro opciones principales; no contiene F1–F6 ni Junta.
- `SiioExecutiveView.tsx`: resumen y filtros propios.
- `SiioManagementTrackingView.tsx`: frentes, F2, decisiones, compromisos, riesgos, bloqueos y próximas acciones.
- `SiioSourcesIntelligenceView.tsx`: fuentes, vigencia, trazabilidad, restricciones, evidencia, razonamiento y recomendaciones.
- `SiioAgentsView.tsx`: catálogo institucional gobernado.
- `SiioBoardDraftAction.tsx`: acción controlada para preparar/consultar/exportar un borrador de Junta usando solo información ya cargada y validada.
- `selectors.ts`: derivaciones puras, filtros y deduplicación de elementos compuestos.

La ruta será compatible con `#/siio` y admitirá navegación directa:

```text
#/siio?view=resumen
#/siio?view=seguimiento
#/siio?view=inteligencia
#/siio?view=agentes
```

Una vista ausente o inválida cae en `resumen`. El `hashchange` conserva navegación atrás/adelante y permite enlaces filtrados.

La carga de datos continúa siendo única: `/api/siio/bootstrap`. Cambiar de vista o filtro no duplica llamadas.

## 4. Vistas funcionales

### 4.1 Resumen ejecutivo

Pregunta principal:

> ¿Cómo estamos y qué requiere atención?

Contenido:

- indicadores financieros sin duplicados;
- variaciones frente al comparativo;
- nómina agregada;
- alertas ejecutivas;
- prioridades;
- decisiones pendientes;
- principales recomendaciones;
- estado de validación y periodo de la información.

Filtros exclusivos:

- periodo;
- área.

Comportamiento accionable:

- Las tarjetas meramente informativas no simulan interactividad.
- Una tarjeta interactiva abre la vista pertinente con filtros preaplicados en la URL.
- Alertas, decisiones, riesgos o compromisos abren Seguimiento.
- Recomendaciones y vigencia de fuentes abren Fuentes e inteligencia.
- No se repite el mismo KPI en hero, tarjeta y panel con el mismo alcance.

### 4.2 Seguimiento gerencial

Integra:

- frentes institucionales;
- registros F2;
- decisiones;
- compromisos;
- riesgos;
- bloqueos;
- próximas acciones.

Vistas internas:

```text
Todos | Decisiones | Bloqueos | Riesgos | Compromisos
```

Filtros exclusivos:

- estado;
- semáforo;
- responsable.

Reglas:

- Frentes F1–F6 se presentan como etiquetas o metadatos del registro.
- El conjunto combina registros y elementos de decisión sin duplicar el mismo asunto.
- Cada fila conserva responsable, estado, semáforo, próxima acción y metadatos disponibles.
- Los enlaces provenientes del Resumen aplican el filtro interno correspondiente.

### 4.3 Fuentes e inteligencia

Integra:

- Archivo Corporativo;
- fuentes autorizadas;
- vigencia;
- trazabilidad;
- restricciones;
- razonamiento automático;
- evidencia;
- recomendaciones.

Filtros exclusivos:

- vigencia;
- confianza;
- tipo de fuente.

Reglas de trazabilidad:

- Cada recomendación muestra fuente o fuentes que la soportan.
- Cada recomendación muestra el periodo de origen disponible.
- Si falta fuente o periodo, se muestra como pendiente; no se inventa evidencia.
- Las recomendaciones no ejecutan decisiones ni modifican información.
- La vista reutiliza `deriveSiioExecutiveSnapshot`; no duplica reglas F5 en JSX.

### 4.4 Agentes

Muestra el catálogo institucional gobernado:

- propósito;
- responsable institucional;
- estado;
- fuentes autorizadas;
- acciones permitidas;
- prohibiciones;
- aprobación humana requerida;
- regla de auditoría;
- siguiente gate.

Filtros exclusivos:

- estado;
- responsable institucional.

Corrección de catálogo:

- Se elimina `AGT-004 Asistente de Junta` como agente independiente.
- `AGT-001 Agente Gerencial SIIO` incorpora **Preparar borrador de Junta** entre sus capacidades permitidas.
- Se mantiene la prohibición de publicar, aprobar cifras, ocultar alertas o ejecutar decisiones.
- La revisión humana sigue siendo obligatoria y no hay escritura automática en producción.

## 5. Preparar informe de Junta

No es una pestaña, fuente ni agente.

La acción aparece en el encabezado del SIIO para roles autorizados y abre una superficie controlada —drawer o panel modal responsive— que:

- usa exclusivamente `boardReports`, `boardSections`, métricas, registros y fuentes ya cargados;
- señala periodos, validación financiera y revisiones humanas pendientes;
- permite consultar el contenido existente y exportar/imprimir un borrador;
- no llama a un endpoint de generación persistente;
- no crea datos, no altera fuentes y no ejecuta decisiones;
- no oculta alertas ni restricciones.

La etiqueta de acción será **Preparar informe de Junta**. La salida debe identificarse como **Borrador sujeto a revisión humana**.

## 6. Filtros y estado de navegación

No existirá una barra global de filtros.

Cada vista conserva únicamente sus filtros contextuales. Los filtros se serializan en parámetros de la ruta cuando sea útil para drill-down y navegación atrás/adelante:

- Resumen: `period`, `area`.
- Seguimiento: `kind`, `status`, `semaphore`, `owner`.
- Inteligencia: `freshness`, `trust`, `sourceType`.
- Agentes: `status`, `owner`.

Los parámetros desconocidos se ignoran. Cambiar de vista descarta los filtros que no pertenecen a la vista destino para evitar estados ambiguos.

## 7. Permisos y privacidad

- La autorización central `canAccessRoute(..., 'siio')` se conserva.
- `SiioDashboard` mantiene una guarda defensiva con `isManagementRole`.
- Los roles comerciales continúan sin ver enlace ni contenido SIIO.
- No se introduce ningún dato individual de nómina en tipos, selectores, DOM, capturas o pruebas.
- El catálogo de agentes permanece visible únicamente dentro de la ruta SIIO ya protegida.

## 8. Responsive y accesibilidad

- Las cuatro opciones principales serán accesibles por teclado y mostrarán estado activo.
- En móvil, la navegación interna será desplazable o se adaptará sin desbordar.
- Tablas conservarán su contenedor con scroll horizontal cuando corresponda.
- El panel de Junta tendrá cierre explícito, foco visible y layout móvil.
- Filtros usarán etiquetas visibles o `aria-label` claros.
- Se conservará el drawer móvil general del CRM sin duplicar navegación SIIO.

## 9. Pruebas

### Contratos automatizados

- exactamente cuatro vistas principales con sus etiquetas requeridas;
- ausencia de pestañas principales F1–F6 y Junta;
- `AGT-004` ausente y capacidad Junta presente en `AGT-001`;
- filtros contextuales por vista y ausencia de barra global;
- drill-down desde tarjetas a vista filtrada;
- cada recomendación presenta evidencia, fuente y periodo o marca pendiente;
- nómina únicamente agregada;
- usuarios comerciales sin acceso;
- carga única de bootstrap;
- ruta inválida cae en Resumen;
- action de Junta sin endpoint de escritura ni mutación.

### Regresión

- suite JavaScript completa;
- pruebas Python existentes;
- build TypeScript/Vite;
- chequeos de sintaxis y navegación/permisos;
- `git diff --check`;
- QA visual autenticado.

### QA visual

Capturas mínimas:

- Resumen desktop y móvil;
- Seguimiento desktop y móvil;
- Fuentes e inteligencia desktop y móvil;
- Agentes desktop y móvil;
- acción Junta desktop y móvil.

Se verificará:

- ausencia de duplicados;
- legibilidad;
- filtros correctos por vista;
- drawer móvil;
- scroll/paginación;
- permisos por rol;
- ausencia de PII de nómina.

## 10. Entrega y gates

La entrega de la rama incluirá:

- listado de archivos y cambios;
- pruebas ejecutadas con resultado real;
- capturas por vista;
- URL de preview, si la autorización permite push y preview;
- hallazgos QA y correcciones;
- confirmación explícita de que no hubo migraciones ni cambios en producción.

No se hará merge ni despliegue a producción sin aprobación humana posterior.

## 11. Fuera de alcance

- nuevas fuentes de información;
- nuevas tablas o migraciones;
- razonamiento generativo nuevo;
- automatización de decisiones;
- publicación automática de informes de Junta;
- rediseño del CRM comercial;
- cambios al módulo de Licitaciones.
