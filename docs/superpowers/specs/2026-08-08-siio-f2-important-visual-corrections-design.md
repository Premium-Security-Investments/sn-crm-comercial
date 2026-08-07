# SIIO F2 — correcciones Important del QA visual

**Fecha:** 2026-08-08  
**Base:** `origin/main@39bef1d4d0755c916ee3a44aa7ee4bc222aaf8a1`  
**Rama aislada:** `fix/siio-f2-important-fixes`  
**Estado:** aprobado por Juan con autonomía de ejecución; detenerse antes de push/deploy.

## 1. Objetivo

Corregir exclusivamente los siete hallazgos `Important` del QA visual autenticado de F2.0, sin ampliar producto ni modificar datos productivos:

1. aterrizaje inicial incoherente con el rol;
2. seguimiento que presenta inventario heredado o contradictorio como estado actual;
3. fuentes que mezclan disponibilidad, revisión, vigencia y validación;
4. conclusiones ejecutivas demasiado fuertes sobre cifras no validadas;
5. catálogo de agentes sin corte ni fuente de estado;
6. tabla de nómina agregada recortada en móvil;
7. contraste insuficiente en textos secundarios de Seguimiento.

## 2. Límites no negociables

- Sin cambios de Supabase, migraciones, RLS, usuarios o datos reales.
- Sin productores, bots, timers, costos o acciones externas.
- Sin cambios al runtime, contratos o ramas AGT-002/003.
- Sin mostrar PII ni nómina individual.
- Sin ocultar registros mediante IDs o frases específicas del seed productivo.
- Sin reescribir estado histórico para aparentar vigencia.
- Sin push, PR, merge o deploy en este carril.
- Mantener Junta en modo read-only y revisión humana.

## 3. Alternativas evaluadas

### A. Limpiar datos en Supabase

Ventaja: corrige el origen. Rechazada en este carril porque requiere autorización de datos, validación de responsables y migración/operación remota.

### B. Ocultar registros concretos por ID o texto

Ventaja: cambio rápido. Rechazada porque maquilla la verdad, acopla la UI a fixtures y no generaliza.

### C. Capa de presentación determinística y conservadora — elegida

La UI preserva el dato de origen, pero separa estado operativo, calidad de evidencia y vigencia. Sólo aplica reglas generales probables y probadas; ante ausencia de señal muestra “no confirmado” o “pendiente”, nunca inventa cierre.

## 4. Diseño

### 4.1 Aterrizaje inicial por rol y permisos

Crear un selector puro de ruta preferida basado en permisos reales, no sólo en el nombre del rol:

- perfiles con acceso SIIO gerencial: `#/siio`;
- perfiles comerciales sin SIIO: `#/dashboard2` cuando esté autorizado;
- otros perfiles: primera ruta realmente visible y autorizada;
- una ruta explícita del usuario nunca se reemplaza;
- la redirección ocurre sólo al resolver una sesión en una URL raíz/sin hash.

No se concede acceso: el selector sólo elige entre módulos que el perfil ya puede ver.

### 4.2 Seguimiento: actividad, historial y coherencia semántica

Extender el modelo de presentación para conservar trazabilidad y evitar falsos asuntos activos:

- estados terminales (`cerrado`, `completado`, `resuelto`, `cancelado`, equivalentes normalizados) quedan fuera del conteo operativo por defecto;
- decisiones terminales relacionadas no reaparecen como pendientes;
- textos negativos inequívocos de bloqueo (“sin bloqueo”, “no hay bloqueo”, “ningún bloqueo”) no generan un ítem de tipo bloqueo;
- los registros sin fecha/actualización suficiente no se declaran vigentes: se etiquetan como `vigencia no confirmada`;
- el tablero incorpora una nota visible: los asuntos sin corte confirmado requieren revisión del responsable;
- los filtros permiten consultar historial sin borrar ni mutar origen;
- las cifras superiores cuentan exactamente lo visible bajo la semántica activa.

No se marcará como cerrado “qué plataforma usar” desde cliente si la fuente aún lo declara pendiente; se mostrará su vigencia no confirmada hasta que el responsable corrija el origen en un carril de datos autorizado.

### 4.3 Fuentes: dimensiones separadas

Cada fuente mostrará por separado:

- **Disponibilidad:** derivada de `status`;
- **Revisión:** derivada de `last_reviewed_at`;
- **Vigencia:** derivada de `next_review_at` y la fecha de corte;
- **Validación/confianza:** derivada de `trust_level`;
- **Aplicabilidad:** `no registrada` mientras no exista campo gobernado;
- **Cumplimiento:** `no evaluado` mientras no exista determinación humana.

Reglas:

- “activa” nunca equivaldrá a “vigente”, “aplicable”, “validada” o “cumple”;
- una fuente sin fecha de revisión no se llama vigente;
- filtros de frescura usan exclusivamente `next_review_at`.

### 4.4 Recomendaciones con evidencia no validada

Cuando `financialValidationStatus !== 'validado'`:

- la UI declara “Lectura preliminar — requiere validación financiera”;
- títulos y hallazgos derivados no usan voz de hecho cerrado;
- los insights cuantitativos se redactan como “la fuente preliminar indica…”;
- se conserva evidencia, periodo, fuente y acción de validación;
- el borrador de Junta mantiene el gate humano y no presenta conclusiones como aprobadas.

Cuando el periodo sí está validado, se conserva la redacción ejecutiva normal.

### 4.5 Catálogo de agentes versionado sin tocar runtime

Agregar metadata de presentación al catálogo institucional:

- `state_as_of`;
- `state_source`;
- `production_capability`;
- `development_status`.

La UI separa “capacidad productiva” de “trabajo en desarrollo/no desplegado”. Para AGT-002 se explicita que E6 productivo conserva drain apagado/timer deshabilitado y que el contrato integral v3 permanece fuera de producción con gates pendientes. Para AGT-003 se conserva la identidad aprobada y no se declara capacidad futura como operativa.

Esta tarea sólo modifica metadata y presentación del catálogo; no toca engines, providers, workers ni contratos AGT.

### 4.6 Nómina agregada responsive

- Escritorio: conservar tabla completa.
- Móvil (`<=760px`): ocultar presentación tabular y renderizar tarjetas compactas por área.
- Cada tarjeta conserva área, personas agregadas, devengado, deducciones, neto y control.
- No se elimina ninguna cifra ni se introduce scroll horizontal.
- Los datos provienen del mismo `payrollRows`; no hay segunda lógica de negocio.
- Mantener ausencia de nombres, cédulas, salarios individuales u otros identificadores.

### 4.7 Contraste y densidad móvil

- Reemplazar colores secundarios de bajo contraste por tokens que cumplan WCAG AA sobre fondos blancos/azules claros.
- Garantizar contraste mínimo 4.5:1 para texto normal y 3:1 para texto grande/controles.
- Mantener el encabezado y navegación compactos; no rediseñar globalmente la aplicación.
- Verificar 390×844, 768×1024 y escritorio 1440×900.

## 5. Arquitectura y archivos previstos

- `src/navPermissions.ts`: selector puro de ruta preferida.
- `src/main.tsx`: aplicar selector sólo en aterrizaje raíz autenticado.
- `src/siio/types.ts`: metadata de vigencia de presentación.
- `src/siio/selectors.ts`: normalización terminal, negación de bloqueos, filtros/historial y estado de fuente.
- `src/siio/SiioManagementTrackingView.tsx`: nota de vigencia, separación activo/historial y etiquetas.
- `src/siio/SiioSourcesIntelligenceView.tsx`: dimensiones separadas.
- `src/siioExecutive.ts` y/o `src/siio/SiioExecutiveView.tsx`: redacción preliminar condicionada y tarjetas de nómina.
- `src/siioAgents.ts` y `src/siio/SiioAgentsView.tsx`: metadata versionada.
- `src/styles.css`: responsive y contraste local SIIO.
- `tests/*`: contratos unitarios/estáticos y pruebas de regresión focales.

No se prevén cambios en `server/`, `api/`, `supabase/` ni módulos `agt002-*`/`vigia-*`.

## 6. Flujo de datos

1. La sesión autenticada carga perfil y permisos.
2. Si la URL no contiene ruta explícita, se calcula una ruta permitida y se reemplaza el hash.
3. SIIO consume el mismo bootstrap read-only.
4. Selectores puros producen modelos de presentación:
   - asuntos activos/históricos/coherencia;
   - dimensiones de fuente;
   - recomendaciones preliminares o validadas.
5. Componentes renderizan desktop/mobile desde el mismo modelo.
6. Ningún cambio se persiste.

## 7. Manejo de errores y abstención

- Perfil sin ruta autorizada: conservar fallback existente y no inventar permiso.
- Estado desconocido: tratar como no terminal, pero con vigencia no confirmada.
- Fecha inválida/ausente: `sin fecha de revisión`; nunca `vigente`.
- Fuente sin aplicabilidad/cumplimiento: `no registrada` / `no evaluado`.
- Insight sin validación: preliminar y sujeto a revisión humana.
- Metadata de agente sin fuente/corte: la prueba falla; no se muestra como actual.

## 8. Estrategia de pruebas

TDD estricto por bloque:

1. pruebas rojas de ruta preferida y preservación de ruta explícita;
2. pruebas rojas de estados terminales, negaciones y conteos;
3. pruebas rojas de dimensiones de fuente;
4. pruebas rojas de lenguaje preliminar;
5. pruebas rojas de metadata del catálogo;
6. contrato estático de tabla desktop + tarjetas mobile y ausencia PII;
7. prueba de contraste/tokens y QA visual automatizado con Playwright.

Verificación final:

- pruebas focales SIIO;
- suite completa, documentando cualquier baseline reproducible;
- `npm run build`;
- `npm audit --omit=dev`;
- `git diff --check`;
- screenshots locales en 1440×900, 768×1024 y 390×844;
- revisión independiente Claude Opus, una sola ronda salvo hallazgo crítico.

## 9. Criterios de aceptación

- Gerencia/Admin aterrizan en SIIO sólo desde raíz; Comercial no recibe acceso SIIO; rutas explícitas permanecen.
- Seguimiento no cuenta terminales ni frases que niegan bloqueos; lo no confirmado se etiqueta honestamente.
- Fuentes no confunden presencia con vigencia, aplicabilidad o cumplimiento.
- Cifras no validadas no producen voz de hecho cerrado.
- Cada agente muestra corte, fuente, capacidad productiva y desarrollo por separado.
- Nómina móvil es legible sin scroll horizontal y sin PII.
- Texto secundario SIIO cumple contraste AA.
- Ningún archivo de datos, migración, backend o runtime AGT cambia.
- Todo queda local, listo para revisión humana antes de push/deploy.
