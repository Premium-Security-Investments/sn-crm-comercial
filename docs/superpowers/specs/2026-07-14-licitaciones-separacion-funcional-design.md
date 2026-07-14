# Diseño funcional — Separación de Radar, Seguimiento, Expedientes y Perfiles

**Fecha:** 2026-07-14  
**Estado:** Aprobado para especificación; pendiente revisión final antes del plan de implementación  
**Repositorio:** `Premium-Security-Investments/sn-crm-comercial`  
**Rama:** `feature/tender-functional-separation`

## 1. Contexto y problema

El módulo de Licitaciones fue diseñado tomando como antecedentes:

- análisis comparativo de Licitaciones.info y LicitarUS realizado en junio de 2026;
- benchmark autenticado de `col.licitaciones.info` realizado en julio de 2026;
- flujo propio de Seguridad Nacional basado en SECOP I, SECOP II, TVEC, ESU, Supabase, RUP, documentos, GO/NO GO y conversión comercial.

La implementación actual refleja parte de la navegación, filtros regionales y perfiles guardados, pero no la separación funcional acordada. Radar, Seguimiento y Expedientes usan `TendersRadar` y terminan en `TenderUnifiedBoard`; Seguimiento y Expedientes solo cambian el filtro de `internal_status`.

Esto produce una separación nominal, no operativa:

```text
Diseño esperado: cuatro flujos con propósitos y acciones diferentes
Implementación actual: un tablero común + filtros + una vista parcial de Perfiles
```

## 2. Objetivo

Convertir Licitaciones en cuatro submódulos funcionalmente distintos:

```text
Radar → Seguimiento → Conversión → Expediente → GO/NO GO → Preparación de oferta
   ↘ Descartar
Perfiles → aplicar criterios al Radar
```

La solución debe aprovechar las capacidades existentes, evitar duplicar oportunidades y conservar la arquitectura oficial:

```text
Hermes dispara → motor oficial procesa → Supabase persiste → CRM muestra y gestiona
```

## 3. Principios

1. **Separación por finalidad de negocio**, no por título o filtro.
2. **Una fuente maestra persistida** en Supabase.
3. **Radar descubre; Seguimiento gestiona; Expedientes produce; Perfiles configura.**
4. Las acciones sensibles conservarán confirmación y trazabilidad.
5. No se aplicarán migraciones, merge ni deploy sin autorización humana.
6. El benchmark de Licitaciones.info orienta la experiencia, pero no se copiará literalmente ni sustituirá el flujo propio de Seguridad Nacional.
7. Los datos ya existentes de documentos, análisis y preparación se reutilizarán; no se crearán modelos paralelos sin necesidad.

## 4. Arquitectura de frontend

La vista monolítica actual se sustituirá gradualmente por unidades con límites explícitos:

```text
TendersModule
├── TenderRadarView
├── TenderTrackingView
├── TenderDossiersView
└── TenderProfilesView
```

### 4.1 Responsabilidad compartida

`TendersModule` resolverá:

- permisos;
- subruta activa;
- navegación entre vistas;
- mensajes de error generales;
- tipos y utilidades comunes.

Cada vista será responsable de sus propios datos, controles, estados vacíos, acciones y renderer. Compartir tipos o funciones de formato no autoriza compartir el mismo tablero operacional.

### 4.2 Extracción dirigida

Se crearán módulos bajo `src/tenders/` para reducir el acoplamiento de `src/main.tsx`, sin emprender una refactorización general del CRM:

```text
src/tenders/
├── types.ts
├── api.ts
├── TenderRadarView.tsx
├── TenderTrackingView.tsx
├── TenderDossiersView.tsx
├── TenderProfilesView.tsx
└── components/
```

La extracción se limitará al dominio de Licitaciones.

## 5. Radar — descubrimiento y clasificación

### 5.1 Propósito

Detectar, priorizar y clasificar procesos públicos antes de que entren a gestión activa.

### 5.2 Datos

- `psi_public_tenders`;
- `psi_tender_radar_runs`;
- perfiles aplicados como criterios de filtrado;
- diagnósticos por fuente devueltos por el backend.

### 5.3 Contenido

- fecha y resultado de la última corrida;
- cobertura y errores por SECOP I, SECOP II, TVEC y ESU;
- búsqueda y filtros de región, fuente, cierre, valor, prioridad y encaje;
- procesos nuevos o no convertidos;
- score, razones, riesgos, valor, cierre y fuente;
- responsable y fecha de revisión cuando exista trazabilidad.

### 5.4 Acciones

- **Pasar a seguimiento**;
- **Descartar**;
- **Convertir en oportunidad**;
- **Abrir fuente oficial**;
- **Sincronizar fuentes oficiales** — exclusiva de Radar.

### 5.5 Exclusiones

Radar no mostrará:

- controles de preparación documental;
- checklist de oferta;
- GO/NO GO como operación principal;
- ficha RUP expandida en la bandeja;
- controles propios de Seguimiento o Expedientes.

## 6. Seguimiento — cola operativa persistente

### 6.1 Propósito

Gestionar los procesos que una persona decidió revisar activamente antes de convertirlos o descartarlos.

### 6.2 Presentación

Bandeja compacta orientada a trabajo, fechas y responsabilidad. No reutilizará `TenderCard` ni `TenderUnifiedBoard`.

Cada fila o tarjeta operativa mostrará:

- entidad, referencia y objeto;
- responsable;
- fecha de entrada a seguimiento;
- última revisión;
- fecha de cierre del proceso;
- próxima acción;
- fecha compromiso;
- días sin gestión;
- estado operativo;
- bloqueo actual;
- nota más reciente;
- prioridad y riesgo.

### 6.3 Estados operativos

Los estados iniciales serán:

```text
pendiente_revision
analizando
esperando_informacion
listo_para_decision
bloqueado
```

`internal_status = en_revision` seguirá indicando pertenencia al submódulo. El estado operativo detalla el trabajo dentro de Seguimiento.

### 6.4 Acciones

- asignar o cambiar responsable;
- registrar actualización;
- programar próxima acción;
- registrar o retirar bloqueo;
- consultar historial;
- convertir en oportunidad;
- descartar;
- devolver al Radar.

### 6.5 Persistencia

Se ampliará `psi_public_tenders` con el snapshot operativo actual:

- `tracking_owner_id`;
- `tracking_status`;
- `tracking_next_action`;
- `tracking_due_at`;
- `tracking_blocker`;
- `tracking_last_note`;
- `tracking_started_at`;
- `tracking_updated_at`.

Se creará `psi_tender_tracking_events` para historial inmutable:

- `id`;
- `tender_id`;
- `event_type`;
- `note`;
- `from_status`;
- `to_status`;
- `assigned_to`;
- `next_action`;
- `due_at`;
- `blocker`;
- `created_by`;
- `created_at`.

La migración será idempotente, tendrá índices y políticas RLS coherentes con el módulo. Se preparará y probará localmente, pero no se aplicará en producción sin autorización.

## 7. Expedientes — producción y control de ofertas

### 7.1 Propósito

Concentrar las licitaciones convertidas y dar visibilidad del estado real de documentos, análisis, decisión y preparación de la oferta.

### 7.2 Fuente

La bandeja se construirá sobre procesos con `converted_opportunity_id IS NOT NULL`, enriquecidos con las capacidades existentes:

- `/api/tender-documents`;
- `/api/tender-documents-upload`;
- `/api/tender-documents-import`;
- `/api/tender-documents-analyze`;
- `/api/tender-offer-preparation`;
- `/api/tender-offer-preparation-approve`;
- `/api/tender-offer-preparation-note`;
- detalle de la oportunidad comercial.

### 7.3 Endpoint resumen

Se añadirá un endpoint de lectura agregado, por ejemplo `GET /api/tender-dossiers`, que devuelva una fila resumen por proceso convertido y evite llamadas N+1 desde el navegador.

Cada resumen incluirá:

- licitación y oportunidad vinculada;
- entidad, referencia y cierre;
- responsable;
- cantidad de documentos;
- documentos faltantes;
- estado de importación;
- análisis disponible;
- recomendación GO/NO GO;
- nivel de riesgo;
- avance del checklist;
- preparación aprobada o pendiente;
- pendientes humanos;
- estado y URL de carpeta SharePoint/OneDrive cuando exista;
- última actualización.

### 7.4 Presentación

Bandeja documental compacta con semáforos y avance. No reutilizará las tarjetas del Radar.

### 7.5 Acciones

- **Abrir expediente**;
- importar o reintentar documentos;
- analizar documentos;
- revisar GO/NO GO;
- aprobar preparación;
- registrar nota;
- abrir oportunidad comercial.

Las acciones sensibles conservarán confirmación explícita.

## 8. Perfiles — configuración aislada

### 8.1 Propósito

Configurar criterios de búsqueda y la información corporativa usada para evaluar licitaciones.

### 8.2 Contenido

- ficha corporativa y RUP;
- perfiles guardados;
- nombre y descripción;
- región, fuente, búsqueda, cuantía, cierre, prioridad y encaje;
- perfil predeterminado;
- fecha y autor de actualización;
- edición y eliminación explícitas.

### 8.3 Comportamiento

- Aplicar perfil navega al Radar con criterios activos.
- Entrar a Perfiles carga perfiles y ficha corporativa, pero no `/api/tenders`.
- No se listan procesos en esta vista.

## 9. API y contratos

### 9.1 Seguimiento

Se diseñarán rutas Vercel-safe y sus equivalentes REST, manteniendo un único servicio interno por operación:

- lectura de seguimiento;
- actualización del snapshot operativo;
- creación y lectura de eventos;
- transición Radar ↔ Seguimiento;
- asignación de responsable.

La duplicación actual entre rutas anidadas y alias Vercel-safe se mantendrá solo en la capa de routing; la lógica de negocio debe residir en una función compartida.

### 9.2 Expedientes

`GET /api/tender-dossiers` agregará documentos, análisis y preparación por oportunidad convertida. No duplicará datos persistidos: compondrá resúmenes desde los registros existentes.

### 9.3 Validación y autorización

- validar identidad Supabase;
- comprobar permisos del módulo;
- validar IDs, estados, fechas y longitudes;
- registrar `created_by`/`updated_by`;
- impedir conversión duplicada;
- responder errores de forma accionable.

## 10. Estados y transiciones

```text
nueva
  ├── pasar a seguimiento → en_revision + tracking_started_at
  ├── convertir directamente → convertida_oportunidad
  └── descartar → descartada

en_revision
  ├── actualizar seguimiento → en_revision
  ├── convertir → convertida_oportunidad
  ├── volver al Radar → nueva
  └── descartar → descartada

convertida_oportunidad
  └── gestionar expediente documental
```

Una transición debe escribir el snapshot actual y un evento de historial cuando corresponda.

## 11. Manejo de errores y estados vacíos

### Radar

- errores por fuente visibles sin bloquear las fuentes exitosas;
- estado vacío explica cómo sincronizar o limpiar filtros.

### Seguimiento

- estado vacío invita a seleccionar procesos desde Radar;
- fallos al guardar conservan el formulario y muestran el error;
- conflictos de actualización deben recargar el registro afectado.

### Expedientes

- el fallo de un expediente no bloquea toda la bandeja;
- diferenciar “sin documentos”, “importación fallida”, “sin análisis” y “preparación pendiente”;
- enlaces ausentes no se presentan como carpeta lista.

### Perfiles

- errores de carga de perfiles no deben disparar carga del Radar;
- nombres duplicados deben tratarse como edición consciente o rechazarse con mensaje claro.

## 12. Pruebas

Se seguirá TDD: prueba roja, implementación mínima, prueba verde y refactor.

### 12.1 Pruebas estructurales

Deben fallar si:

- Radar, Seguimiento y Expedientes vuelven a terminar en el mismo renderer;
- Seguimiento reutiliza `TenderCard`;
- Expedientes reutiliza `TenderUnifiedBoard`;
- “Sincronizar fuentes oficiales” aparece fuera de Radar;
- Perfiles llama `/api/tenders`;
- se restaura la exigencia de “Vista unificada de licitaciones”.

### 12.2 Pruebas funcionales

- transición a Seguimiento crea snapshot y evento;
- asignación, próxima acción, bloqueo y nota persisten;
- volver a Radar mantiene trazabilidad;
- convertir evita duplicados;
- resumen de Expedientes expone documentos, análisis, GO/NO GO y preparación;
- un expediente sin documentos devuelve estado correcto;
- aplicar perfil abre Radar con filtros;
- permisos impiden escritura no autorizada.

### 12.3 Pruebas de migración

- ejecución sobre esquema limpio;
- segunda ejecución idempotente;
- claves foráneas e índices válidos;
- RLS y grants verificados;
- rollback documentado.

### 12.4 QA

Antes de solicitar merge/deploy:

- suite JavaScript completa;
- pruebas Python/checkers existentes;
- `npm run build`;
- QA autenticado por rutas;
- consola sin errores;
- desktop y móvil;
- datos reales o fixtures representativos;
- comparación visual y funcional contra esta especificación;
- auditoría independiente del diff.

## 13. Entregas y gates

### Entrega técnica en rama

- componentes separados;
- migración preparada;
- APIs y pruebas;
- documentación actualizada;
- evidencia de build y QA;
- sin escrituras en producción.

### Gates humanos

Se solicitará autorización separada para:

1. aplicar migración en Supabase;
2. mergear el PR;
3. desplegar a producción;
4. ejecutar cualquier corrección de datos productivos.

## 14. Criterios de aceptación

El diseño se considera implementado cuando:

1. Las cuatro rutas tienen propósitos, datos, controles y renderers distinguibles.
2. Seguimiento permite operar responsable, próxima acción, fecha, bloqueo, nota e historial.
3. Expedientes muestra estado documental y GO/NO GO sin obligar a recorrer oportunidades una por una.
4. Radar es la única vista de descubrimiento y sincronización.
5. Perfiles no carga ni lista el Radar.
6. Las transiciones son persistentes, trazables y no duplican oportunidades.
7. Las pruebas detectan una futura regresión hacia el tablero unificado.
8. Build, suite y QA autenticado pasan con evidencia fresca.
9. No se ha aplicado migración ni desplegado sin autorización.