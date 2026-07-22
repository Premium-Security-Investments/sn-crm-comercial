# Diseño funcional — Licitaciones: navegación, Oportunidades y decisión GO/NO GO

**Fecha:** 2026-07-22

**Estado:** aprobado en conversación; pendiente revisión del documento por Juan Botero

**Repositorio:** `Premium-Security-Investments/sn-crm-comercial`

**Rama documental:** `docs/tender-opportunities-navigation-design`

## 1. Contexto

El módulo de Licitaciones está separado actualmente en cuatro vistas:

```text
Radar de oportunidades | Seguimiento | Expedientes | Perfiles de búsqueda
```

La separación técnica funciona, pero la jerarquía de negocio mezcla conceptos de naturalezas distintas:

- **Radar** y **Seguimiento** representan etapas operativas.
- **Expedientes** es el nombre de una capacidad documental, aunque la bandeja contiene realmente oportunidades ya convertidas.
- **Perfiles de búsqueda** mezcla búsquedas guardadas con la ficha corporativa/RUP de Seguridad Nacional.

Además, el análisis documental genera una recomendación GO/NO GO y el sistema permite aprobar la preparación de oferta, pero no existe una decisión humana formal, persistida y claramente separada de la recomendación automática.

Durante el análisis también se confirmó una regresión en `Radar → Pasar a seguimiento`: la tarjeta envía una clave estable externa a un endpoint que exige el UUID interno de la licitación.

## 2. Objetivos

1. Reorganizar la navegación principal alrededor del ciclo real de una licitación.
2. Renombrar **Expedientes** como **Oportunidades** sin perder sus capacidades documentales.
3. Representar **GO autorizado** como un estado y filtro dentro de Oportunidades, no como una pestaña independiente.
4. Separar la recomendación automática de la decisión humana formal GO/NO GO.
5. Iniciar automáticamente la preparación de oferta al autorizar GO.
6. Integrar búsquedas guardadas dentro del Radar.
7. Mover RUP y ficha habilitante a Configuración de Licitaciones.
8. Corregir el contrato de identificadores de `Pasar a seguimiento`.
9. Mantener trazabilidad y evitar copias o registros paralelos.

## 3. Fuera de alcance

Esta fase no incluye:

- presentación automática de ofertas en SECOP;
- generación física completa de todos los DOCX/XLSX prometidos por la preparación;
- integración real con SharePoint/OneDrive;
- reemplazo del análisis determinístico por un modelo de IA;
- sincronización programada o alertas automáticas;
- rediseño general del módulo comercial de Oportunidades;
- correcciones de datos productivos sin autorización separada.

## 4. Principios

1. **Una licitación evoluciona; no se copia entre vistas.**
2. **La oportunidad es el contenedor; el expediente es una capacidad interna.**
3. **La recomendación automática no equivale a aprobación humana.**
4. **GO autorizado es un estado de la oportunidad, no un nuevo registro.**
5. **Autorizar GO inicia preparación de oferta de forma atómica e idempotente.**
6. **Las búsquedas guardadas pertenecen al Radar.**
7. **La base habilitante pertenece a Configuración.**
8. **Toda decisión sensible registra actor y fecha.**
9. **Las licitaciones vencidas conservan acciones, pero muestran advertencia visible.**

## 5. Navegación principal

La navegación primaria del módulo será:

```text
Radar | Seguimiento | Oportunidades
```

Se elimina de la navegación primaria:

- `Expedientes` como nombre de pestaña;
- `Perfiles de búsqueda` como pestaña.

En el encabezado general del módulo se agrega una acción secundaria:

```text
Configuración
```

### 5.1 Rutas conceptuales

Se conservará el patrón actual basado en hash y `view`, con nombres coherentes:

```text
#/tenders?view=radar
#/tenders?view=seguimiento
#/tenders?view=oportunidades
#/tenders?view=configuracion
```

`configuracion` no se mostrará como pestaña operativa; se abrirá desde el botón Configuración y estará protegida por permisos.

Los enlaces antiguos a `view=expedientes` deberán redirigir o normalizarse a `view=oportunidades` para no romper marcadores existentes.

Los enlaces antiguos a `view=perfiles` deberán redirigir a Radar o Configuración según el contexto disponible; no deben quedar como una pantalla huérfana.

## 6. Radar

### 6.1 Responsabilidad

Descubrir, filtrar, priorizar y seleccionar procesos antes de convertirlos en trabajo activo u oportunidad.

### 6.2 Acciones

- sincronizar fuentes oficiales;
- recargar vista;
- abrir fuente;
- pasar a Seguimiento;
- convertir directamente en Oportunidad;
- guardar búsqueda actual;
- abrir búsquedas guardadas.

### 6.3 Búsquedas guardadas

La funcionalidad existente de perfiles se renombrará como **Búsquedas guardadas**.

El Radar mostrará dos acciones explícitas:

```text
Guardar búsqueda | Búsquedas guardadas
```

**Guardar búsqueda** toma los filtros activos del Radar, solicita un nombre y persiste:

- texto;
- fuente;
- región;
- cierre;
- valor;
- score;
- sección;
- estado interno;
- orden si el contrato se amplía para soportarlo.

**Búsquedas guardadas** abre un panel o modal que permite:

- aplicar;
- renombrar o sobrescribir de forma explícita;
- eliminar con confirmación;
- ver un resumen legible de criterios.

Aplicar una búsqueda actualiza los filtros del Radar sin navegar a una pestaña independiente.

### 6.4 Licitaciones vencidas

Si `deadline < fecha actual en America/Bogota`, la tarjeta mostrará una advertencia destacada:

```text
Vencida · valide adendas o nueva fecha en la fuente oficial
```

Por decisión de negocio aprobada:

- no se bloqueará `Pasar a seguimiento`;
- no se bloqueará `Convertir en oportunidad`;
- no se alterará automáticamente el estado interno;
- las acciones mantendrán su confirmación normal;
- la fecha y advertencia permanecerán visibles.

### 6.5 Corrección del paso a Seguimiento

El Radar usa una `stable_key` externa de 20 caracteres para identidad entre sincronizaciones. Seguimiento y sus RPC usan el UUID de `psi_public_tenders.id`.

La solución no relajará la validación UUID del endpoint de Seguimiento. La frontera Radar → Seguimiento deberá:

1. recibir la clave estable;
2. resolver el registro persistido por `stable_key` en backend;
3. obtener el UUID interno;
4. ejecutar `psi_update_tender_tracking` mediante la función compartida existente;
5. crear el evento `entered_tracking`;
6. devolver el resumen actualizado.

Se reutilizará o consolidará el servicio backend existente `setTenderStatus`; no se expondrá una ruta que acepte identificadores ambiguos sin resolución explícita.

El comportamiento debe ser equivalente en `server/index.js` y `api/[...path].js`.

## 7. Seguimiento

Seguimiento conserva su responsabilidad actual:

- procesos seleccionados para evaluación antes de convertirse en oportunidades;
- responsable;
- estado operativo;
- próxima acción;
- fecha compromiso;
- bloqueo;
- nota;
- historial.

Acciones permitidas:

- actualizar;
- reasignar según permisos;
- devolver al Radar;
- descartar;
- convertir en Oportunidad.

Seguimiento no mostrará controles de preparación de oferta ni configuración de RUP.

## 8. Oportunidades

### 8.1 Propósito

Reemplazar la bandeja llamada Expedientes y concentrar todas las licitaciones convertidas en oportunidades comerciales.

La bandeja seguirá construyéndose sobre licitaciones con `converted_opportunity_id IS NOT NULL`, enriquecidas con oportunidad, documentos, análisis, decisión y preparación.

### 8.2 Contenido de cada oportunidad

- entidad, objeto, referencia, fuente, cierre y valor;
- responsable;
- acceso a la oportunidad comercial;
- expediente documental;
- estado de importación;
- documentos faltantes;
- análisis disponible;
- recomendación automática GO/NO GO;
- decisión humana GO/NO GO;
- riesgo;
- preparación de oferta;
- pendientes humanos;
- estado de SharePoint/OneDrive;
- última actualización.

### 8.3 Filtros principales

```text
Todas | Pendiente de decisión | GO autorizado | En preparación | Presentadas | Cerradas
```

Definiciones:

- **Todas:** todas las oportunidades de licitación visibles según permisos.
- **Pendiente de decisión:** no existe decisión humana GO/NO GO vigente.
- **GO autorizado:** la decisión humana vigente es GO.
- **En preparación:** existe GO vigente y paquete de preparación iniciado; mientras la preparación actual no esté presentada/cerrada.
- **Presentadas:** la oferta fue marcada explícitamente como presentada.
- **Cerradas:** NO GO, no adjudicada, adjudicada u otro cierre terminal definido.

Los filtros pueden solaparse cuando representan dimensiones distintas; por ejemplo, una oportunidad puede cumplir `GO autorizado` y `En preparación`. La interfaz debe explicar esta condición y no presentar los filtros como estados mutuamente excluyentes si no lo son.

### 8.4 Expediente

El término **Expediente** permanece para:

- botón `Abrir expediente`;
- sección documental dentro del detalle;
- conjunto de documentos, análisis, checklist y evidencia.

No se utilizará como nombre de la bandeja principal.

## 9. Recomendación y decisión GO/NO GO

### 9.1 Recomendación automática

El resultado de `tender_document_analysis` conserva su carácter de recomendación asistida:

- recomendación;
- riesgo;
- hallazgos;
- requisitos;
- cruce con base habilitante;
- resumen para comité.

Nunca debe mostrarse como `GO autorizado`.

La interfaz usará etiquetas inequívocas:

```text
Recomendación del sistema
Decisión humana
```

### 9.2 Decisión humana formal

Se añadirá un registro persistente, explícito e inmutable por evento para cada decisión, con al menos:

- `id` UUID;
- `opportunity_id` UUID;
- `tender_id` UUID cuando exista vínculo;
- `decision`: `go` o `no_go`;
- `analysis_interaction_id` o referencia/versionado del análisis utilizado, nullable si no existe análisis;
- `justification` opcional;
- `decided_by` UUID;
- `decided_at` timestamptz;
- `supersedes_decision_id` nullable para una rectificación explícita;
- `created_at`.

Se recomienda una tabla dedicada, por ejemplo `psi_tender_go_no_go_decisions`, en lugar de inferir la decisión desde JSON libre en `psi_sales_interactions`.

La decisión vigente será el último evento válido de la cadena de supersesión. No se actualizarán destructivamente decisiones anteriores.

### 9.3 Permisos

Pueden registrar o rectificar GO/NO GO:

- Admin;
- Gerencia;
- Dirección de Licitaciones.

Debe aplicarse la acción central existente:

```text
licitaciones.go_no_go.approve
```

No basta con comprobar acceso general a Licitaciones. La API debe ejecutar la autorización fina antes de persistir.

La justificación será opcional para GO y NO GO, según decisión aprobada.

### 9.4 Confirmación

Antes de registrar la decisión, el sistema mostrará:

- decisión seleccionada;
- nombre de la oportunidad;
- recomendación automática vigente;
- advertencias/riesgos relevantes;
- campo opcional de justificación;
- confirmación explícita.

## 10. GO autorizado e inicio de preparación

Autorizar GO debe ejecutar una sola operación de negocio atómica e idempotente:

1. validar permiso `licitaciones.go_no_go.approve`;
2. validar oportunidad de tipo Licitación Pública;
3. registrar decisión GO;
4. crear o reutilizar el paquete de preparación;
5. generar pendientes humanos y checklist inicial;
6. registrar trazabilidad;
7. devolver decisión y preparación actualizadas.

Si la preparación ya existe, un reintento no creará duplicados.

Si falla la creación de preparación, la transacción no debe dejar un GO parcialmente aplicado sin estado de preparación coherente. Si la arquitectura de almacenamiento actual impide una única transacción SQL, se deberá implementar recuperación explícita, idempotencia y un estado de error accionable; el plan técnico deberá justificar la estrategia.

El botón actual **Aprobar preparación de oferta** se sustituirá por el flujo formal de **Autorizar GO**. No deben coexistir dos botones que representen la misma aprobación.

Autorizar NO GO:

- registra la decisión;
- conserva documentos, análisis y oportunidad;
- retira el caso del trabajo activo;
- no elimina ni desliga evidencia;
- no inicia preparación.

## 11. Presentación y cierre

Para que los filtros `Presentadas` y `Cerradas` sean reales y no inferidos de texto libre, el modelo deberá soportar estados explícitos de oferta, como mínimo:

```text
pendiente
en_preparacion
lista_para_presentar
presentada
adjudicada
no_adjudicada
cerrada_no_go
```

La especificación no obliga a mostrar todos como pestañas. Se usarán como estados internos y etiquetas legibles.

Cambios terminales o sensibles deben registrar actor, fecha y nota opcional.

## 12. Configuración de Licitaciones

### 12.1 Acceso

Un botón **Configuración** estará visible en el encabezado del módulo para usuarios autorizados.

Pueden editar y cargar RUP:

- Admin;
- Gerencia;
- Dirección de Licitaciones.

Los demás usuarios con acceso a Licitaciones no podrán modificar la base habilitante. Si se permite consulta directa, será de solo lectura y deberá definirse en el plan de implementación sin exponer documentos sensibles innecesariamente.

La API debe comprobar una acción fina de configuración; si el catálogo actual no tiene una acción específica, el plan propondrá agregarla sin reutilizar permisivamente `licitaciones.view`.

### 12.2 Base habilitante SN

La vista contendrá:

- nombre legal;
- NIT;
- estado RUP;
- códigos UNSPSC;
- servicios autorizados;
- licencia SuperVigilancia;
- capacidad financiera;
- capacidad organizacional;
- experiencia habilitante;
- certificaciones, pólizas y permisos;
- documentos recurrentes;
- alertas o restricciones;
- información útil para cruzar pliegos;
- carga y procesamiento del RUP.

La interfaz dejará claro que actualizar la base puede afectar análisis GO/NO GO futuros. Los análisis históricos no se reescribirán silenciosamente.

## 13. Modelo de ciclo de vida

```text
Radar: nueva
  ├── Seguimiento: en_revision
  │     ├── volver → nueva
  │     ├── descartar → descartada
  │     └── convertir → convertida_oportunidad
  ├── convertir directamente → convertida_oportunidad
  └── descartar → descartada

Oportunidad: convertida_oportunidad
  ├── análisis documental → pendiente_decision
  ├── decisión NO GO → cerrada_no_go
  └── decisión GO → go_autorizado + en_preparacion
        ├── lista_para_presentar
        ├── presentada
        ├── adjudicada
        └── no_adjudicada
```

La recomendación del sistema no cambia por sí sola este ciclo.

## 14. API y contratos

El plan técnico deberá definir rutas Vercel-safe y servicios compartidos para:

- resolver `stable_key` e iniciar Seguimiento;
- listar Oportunidades con filtros y paginación;
- leer historial de decisiones;
- autorizar GO e iniciar preparación;
- registrar NO GO;
- rectificar una decisión con trazabilidad;
- cambiar estado de oferta;
- leer y editar Configuración según permisos;
- gestionar búsquedas guardadas desde Radar.

`server/index.js` y `api/[...path].js` deben mantener paridad, preferiblemente delegando a módulos compartidos para no duplicar lógica de negocio.

## 15. Manejo de errores

- Un identificador externo inválido no debe llegar a un RPC UUID.
- Si una licitación no está persistida, Radar debe mostrar un error accionable y recomendar sincronizar.
- Los conflictos de actualización en Seguimiento conservan el formulario y ofrecen recarga.
- Una decisión sin permiso responde 403 sin crear registros parciales.
- Un GO duplicado reutiliza la preparación existente o informa que ya está autorizado.
- Un fallo de preparación no debe ocultar que la operación quedó incompleta.
- Una búsqueda guardada inválida no modifica los filtros actuales.
- Un error de Configuración no bloquea Radar, Seguimiento u Oportunidades.

## 16. Migraciones y datos existentes

Las migraciones deberán ser:

- idempotentes;
- compatibles con datos actuales;
- con claves foráneas e índices;
- protegidas por RLS/grants coherentes;
- probadas sobre esquema limpio y sobre esquema con datos.

La información histórica existente en `psi_sales_interactions` deberá conservarse. El plan debe definir una estrategia de lectura compatible:

- decisiones formales nuevas se leen desde la tabla dedicada;
- preparaciones históricas continúan visibles;
- no se convertirá una recomendación automática histórica en GO autorizado;
- una preparación histórica aprobada puede marcarse como legado pendiente de reconciliación, pero no migrarse a GO humano sin evidencia de quién autorizó.

No se aplicarán migraciones productivas sin autorización separada.

## 17. Pruebas obligatorias

### 17.1 Regresión Radar → Seguimiento

- una tarjeta con `stable_key` no UUID pasa a Seguimiento;
- el backend resuelve el UUID correcto;
- se crea `entered_tracking`;
- el responsable es válido;
- el proceso aparece en Seguimiento;
- el reintento no duplica eventos indebidamente;
- un valor arbitrario sigue siendo rechazado.

### 17.2 Navegación

- solo existen las pestañas Radar, Seguimiento y Oportunidades;
- Expedientes redirige a Oportunidades;
- Perfiles no aparece como pestaña;
- Configuración respeta permisos;
- los enlaces antiguos no quedan rotos.

### 17.3 Búsquedas guardadas

- guardar usa los filtros actuales;
- aplicar actualiza el Radar;
- eliminar exige confirmación;
- no se carga una pantalla independiente de perfiles.

### 17.4 Vencidas

- se calcula con zona `America/Bogota`;
- se muestra advertencia;
- Seguimiento y Conversión siguen disponibles.

### 17.5 GO/NO GO

- recomendación automática no equivale a decisión;
- usuario sin permiso recibe 403;
- Admin, Gerencia y Dirección de Licitaciones pueden decidir;
- actor y fecha quedan persistidos;
- justificación puede estar vacía;
- GO inicia preparación;
- reintento GO es idempotente;
- NO GO no inicia preparación;
- rectificación conserva historial.

### 17.6 Oportunidades

- todos los convertidos siguen visibles;
- filtros usan estado formal, no coincidencias de texto;
- expediente abre el detalle correcto;
- un fallo en un expediente no bloquea la bandeja;
- paginación y filtros son compatibles.

### 17.7 Verificación general

- suite JavaScript completa;
- pruebas Python existentes;
- TypeScript;
- build productivo;
- QA autenticada desktop y móvil;
- consola sin errores;
- smoke sin escrituras no autorizadas;
- auditoría independiente del diff.

## 18. Criterios de aceptación

1. La navegación principal muestra `Radar | Seguimiento | Oportunidades`.
2. La bandeja antes llamada Expedientes se denomina Oportunidades.
3. El expediente sigue disponible dentro de cada oportunidad.
4. GO autorizado es un filtro dentro de Oportunidades.
5. Recomendación automática y decisión humana son visual y técnicamente distintas.
6. Solo Admin, Gerencia y Dirección de Licitaciones pueden autorizar GO/NO GO.
7. La justificación es opcional y actor/fecha son obligatorios.
8. Autorizar GO inicia preparación sin duplicados.
9. Búsquedas guardadas se gestionan desde Radar.
10. RUP y base habilitante se gestionan desde Configuración.
11. Solo Admin, Gerencia y Dirección de Licitaciones editan Configuración.
12. Una licitación vencida muestra advertencia y conserva acciones.
13. `Pasar a seguimiento` funciona desde una tarjeta con clave estable.
14. Los enlaces antiguos de Expedientes/Perfiles no quedan rotos.
15. No se pierde evidencia histórica ni se inventan aprobaciones para registros existentes.
16. Pruebas, build y QA autenticada pasan antes de merge/deploy.

## 19. Gates

Se requerirá autorización separada para:

1. iniciar implementación;
2. aplicar migraciones en Supabase;
3. reconciliar datos históricos;
4. mergear el PR;
5. desplegar a producción;
6. ejecutar escrituras de verificación productiva.

Este documento por sí solo no autoriza implementación ni despliegue.
