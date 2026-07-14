# QA detallado post-deploy — PR #11

- **Entorno:** Producción
- **URL:** https://seguridad-nacional-crm.vercel.app
- **Fecha:** 2026-07-13T20:44:34+00:00
- **Usuario:** Admin QA temporal
- **Viewport escritorio:** 1280 px
- **Viewport móvil:** 390 × 844 px
- **Resultado general:** **FAIL — requiere correcciones antes de aprobación UX/operativa**
- **Consola:** 0 errores JavaScript observados

## Resumen ejecutivo

La aplicación está desplegada, autentica correctamente y las rutas principales cargan. Los cambios del PR #11 están presentes: navegación agrupada, URLs directas de Licitaciones y bandeja de acción en Alertas. Sin embargo, el QA detectó cuatro problemas de prioridad alta: navegación móvil bloqueante, listas operativas sin paginación, posibles duplicados en Radar y falta de separación real de Perfiles respecto al Radar.

### Conteo

| Severidad | Cantidad |
|---|---:|
| P0 | 0 |
| P1 | 4 |
| P2 | 4 |
| P3 | 1 |
| **Total** | **9** |

## Cobertura

| Área | Estado | Evidencia principal |
|---|---|---|
| Login / autenticación | PASS | Login real con usuario temporal |
| Dashboard gerencial | PASS funcional / FAIL UX | Carga y filtros; densidad y responsive |
| Alertas comerciales | PASS funcional / FAIL UX | 20 tarjetas, acciones locales y filtros |
| Oportunidades | PASS funcional / FAIL UX/performance | 216 filas renderizadas sin paginación |
| Licitaciones — Radar | PASS funcional / FAIL datos/performance | 99 tarjetas; pares potencialmente duplicados |
| Licitaciones — Seguimiento | PASS | Ruta directa + filtro `En revisión`; empty state correcto |
| Licitaciones — Expedientes | PASS | Ruta directa + filtro `Convertida`; empty state correcto |
| Licitaciones — Perfiles | FAIL separación | Configuración + Radar completo en la misma vista |
| Metas y cumplimiento | PASS funcional / FAIL roles | Consulta y edición separadas; admins aparecen como asesores |
| Usuarios y permisos | PASS lectura | Tabla, roles y formulario visibles; no se hicieron escrituras |
| Consola JS | PASS | 0 mensajes / 0 errores |
| Móvil 390 × 844 | FAIL | Sidebar ocupa el primer viewport y Dashboard desborda |

---

## Hallazgos

### QA-001 — P1 — Navegación móvil bloquea el contenido principal

- **Categoría:** Visual / Usabilidad / Responsive
- **Rutas:** `#/dashboard2`, `#/alerts`, `#/opportunities`
- **Reproducción:**
  1. Abrir producción con viewport 390 × 844.
  2. Iniciar sesión.
  3. Abrir cualquiera de las rutas indicadas.
- **Resultado actual:** El sidebar se renderiza completo antes del contenido. Ocupa todo el primer viewport y obliga a recorrer menú, submenús, sesión y botones antes de llegar a la pantalla solicitada. No hay hamburguesa, drawer ni colapso automático.
- **Evidencia mecánica:** Dashboard reporta `body.scrollWidth=416` con `innerWidth=390`; existe overflow horizontal.
- **Impacto:** En móvil, entrar a una sección no muestra la sección; el usuario ve primero un menú de pantalla completa. Afecta navegación y percepción de carga.
- **Esperado:** Sidebar colapsable/drawer; contenido visible en el primer viewport; sin overflow horizontal.
- **Evidencia:**
  - [Dashboard móvil](screenshots/mobile-dashboard.png)
  - [Alertas móvil](screenshots/mobile-alerts.png)
  - [Oportunidades móvil](screenshots/mobile-opportunities.png)

### QA-002 — P1 — Colecciones grandes se renderizan completas sin paginación/virtualización

- **Categoría:** Rendimiento / Usabilidad
- **Rutas:** `#/opportunities`, `#/tenders?view=radar`
- **Resultado actual:**
  - Oportunidades: **216 filas** en una sola tabla, **3.419 elementos DOM**, sin texto ni controles de paginación.
  - Radar: **99 tarjetas**, **2.578 elementos DOM**, **315 botones**.
  - En móvil, la tabla de Oportunidades tiene contenedor de 343 px y contenido de 1.290 px; requiere desplazamiento horizontal interno.
- **Impacto:** Páginas extremadamente largas, alto costo de render, búsqueda visual pobre y riesgo de degradación al crecer los datos.
- **Esperado:** Paginación o virtualización; límite inicial razonable; contador y navegación de páginas; en móvil, vista de tarjetas o columnas prioritarias.

### QA-003 — P1 — Radar contiene pares que parecen el mismo proceso duplicado por fase

- **Categoría:** Datos / Funcional
- **Ruta:** `#/tenders?view=radar`
- **Método:** Normalización de `Ref:` eliminando el sufijo `(Presentación de oferta)` y puntuación final; comparación por título + referencia.
- **Resultado actual:** Se observaron al menos nueve pares con mismo título y referencia normalizada, entre ellos:
  - Instituto de Deportes y Recreación de Medellín — `6700049978`
  - Alcaldía Municipio de Villavicencio — `LP-002-2026`
  - Mintrabajo Nivel Central — `SASI-MT-003-2026`
  - Alcaldía Municipio de Arauca — `7L-007-2026`
  - Alcaldía Local Rafael Uribe Uribe — `FDLRUU-LP-001-2026`
  - Ministerio del Interior — `SAMC-001-2026`
  - Instituto de Turismo del Meta — `LP-ITM-001-2026`
  - Transmilenio — `TMSA-SAM-06-2026`
  - Municipio de Guachetá — `SAMC 014-2026 ALC-GTA`
- **Impacto:** El usuario puede revisar o convertir dos veces el mismo proceso; contradice el mensaje de la interfaz “sin duplicar oportunidades”.
- **Esperado:** Agrupar fases/hitos bajo un proceso canónico o deduplicar con fuente + identificador normalizado + entidad.
- **Nota:** Referencias genéricas reutilizadas entre entidades (`07-2026`, `LP-002-2026`, `215330`) no deben usarse solas como clave global.

### QA-004 — P1 — Perfiles de búsqueda no está separado de la operación Radar

- **Categoría:** Usabilidad / Arquitectura de información / Rendimiento
- **Ruta:** `#/tenders?view=perfiles`
- **Resultado actual:** La vista contiene la configuración de regiones y perfiles guardados, pero también vuelve a renderizar controles de Radar, contador `99 de 99`, ayuda y las **99 tarjetas** de la “Vista unificada de licitaciones”. Total: **2.661 elementos DOM**.
- **Impacto:** La nueva sección no cumple su objetivo de separar configuración de operación; duplica contenido y vuelve la página innecesariamente larga.
- **Esperado:** Perfiles debe terminar después de configuración/perfiles guardados. Aplicar un perfil puede navegar al Radar con filtros, no incrustar el Radar completo.

### QA-005 — P2 — Alertas mezcla bandeja operativa con tabla extensa de cumplimiento

- **Categoría:** Usabilidad / Arquitectura de información
- **Ruta:** `#/alerts`
- **Resultado actual:** La bandeja muestra 20 alertas críticas, pero debajo continúa una tabla larga de “Cumplimiento bajo 80%”. La pantalla mezcla gestión de oportunidades con cumplimiento de metas.
- **Evidencia:** 20 tarjetas de acción; tabla adicional al final de una página muy extensa.
- **Impacto:** Distrae del objetivo de la bandeja y obliga a scroll excesivo.
- **Esperado:** Mover cumplimiento a `Metas y cumplimiento` o mostrar solo un resumen con enlace.

### QA-006 — P2 — Filtros de región contienen valores duplicados y no normalizados

- **Categoría:** Datos / Usabilidad
- **Rutas:** `#/dashboard2`, `#/alerts`, `#/opportunities`
- **Ejemplos observados:**
  - `Antioquia`, `ANTIOQUIA`, duplicados exactos de `Antioquia`
  - `Bogota`, `BOGOTA`, `Bogotá`, `Distrito Capital de Bogotá`
  - `Eje cafetero`, `Eje Cafetero`, `EJE CAFETERO`, `Eje Cafetero.`
  - `Medellin`, `medellin`, duplicados exactos de `Medellin`
  - `Risaralda`, `RISARALDA`
  - `Valle del Cauca`, `VALLE DEL CAUCA`
- **Impacto:** Fragmenta métricas y obliga al usuario a elegir varias variantes para una misma región.
- **Esperado:** Normalización canónica en ingestión y presentación; conservar valor original solo como metadata.

### QA-007 — P2 — Usuarios admin/directivos aparecen como asesores comerciales

- **Categoría:** Permisos / Datos / Reportería
- **Rutas:** `#/dashboard2`, `#/opportunities`, `#/goals`
- **Resultado actual:** El admin temporal `QA Detailed Hermes` aparece en filtros de Comercial/Asesor y en carga de metas. También aparecen cuentas administrativas como Juan Botero y Luis Fernando Lopez en el selector comercial.
- **Impacto:** Riesgo de metas, filtros y métricas asignadas a perfiles no comerciales; contamina reportes.
- **Esperado:** Selectores comerciales deben incluir solo usuarios activos con rol comercial o roles explícitamente elegibles para metas.

### QA-008 — P2 — Dashboard gerencial mantiene demasiados bloques en una sola página

- **Categoría:** Usabilidad / Jerarquía
- **Ruta:** `#/dashboard2`
- **Resultado actual:** KPIs, múltiples filtros, tablas y secciones operativas generan una página muy larga. La lectura gerencial requiere demasiado desplazamiento y compite con información de detalle.
- **Impacto:** Dificulta la lectura rápida de estado y desvíos.
- **Esperado:** Primer viewport con 4–6 indicadores clave y alertas; detalle mediante tabs, drill-down o bloques colapsables.

### QA-009 — P3 — Inconsistencia de etiqueta de rol

- **Categoría:** Contenido / Consistencia
- **Ruta:** `#/users`
- **Resultado actual:** El formulario ofrece `Directivo`, mientras perfiles existentes muestran el valor `director` en minúscula.
- **Impacto:** Confusión menor entre etiqueta visible y valor almacenado.
- **Esperado:** Etiquetas humanas consistentes (`Directivo`, `Gerencia`, `Admin`, `Comercial`) y valores internos no expuestos.

---

## Validaciones que pasaron

- Producción responde y autentica.
- Rutas directas de Licitaciones preservan vista:
  - `?view=radar` → Radar
  - `?view=seguimiento` → Estado `En revisión`
  - `?view=expedientes` → Estado `Convertida`
  - `?view=perfiles` → Perfiles
- Seguimiento y Expedientes muestran empty state comprensible cuando no hay registros.
- Oportunidades: búsqueda `AEROCIVIL` redujo 216 filas a 1.
- Alertas: “Marcar revisada” ocultó la tarjeta y mantuvo 20 visibles cargando la siguiente.
- Alertas: no existe la tabla antigua `.alert-readable-table`.
- Oportunidades: scroll horizontal está contenido en `.tablewrap`; no desborda el body en escritorio/móvil.
- Metas: filtros de consulta no modifican metas y están separados del formulario de carga.
- Usuarios: formulario y tabla de permisos visibles; no se realizaron escrituras.
- Consola: 0 errores JS durante el recorrido.

## Orden recomendado de corrección

1. **QA-003** Deduplicación canónica del Radar.
2. **QA-001** Navegación móvil/drawer y overflow.
3. **QA-004** Separar Perfiles del Radar.
4. **QA-002** Paginación/virtualización en Oportunidades y Radar.
5. **QA-007** Filtrado por roles en asesores/comerciales.
6. **QA-006** Normalización de regiones.
7. **QA-005 / QA-008** Reducir densidad y separar objetivos por pantalla.
8. **QA-009** Homologar etiquetas de roles.

## Criterio de cierre sugerido

No aprobar UX/operación hasta corregir QA-001 a QA-004. Los P2 pueden entrar en una segunda tanda, salvo QA-007 si las metas se van a usar inmediatamente.
