# Especificación — Radar de Licitaciones: política de encaje gobernada (`tender-fit-v1`) y retroalimentación de aprendizaje sin doble conteo

**Fecha:** 2026-09-20
**Repositorio:** `Premium-Security-Investments/sn-crm-comercial` (worktree `/workspace`)
**Árbol inspeccionado:** estado de trabajo al 2026-09-20. Esta sesión no tuvo acceso a `git log`/`git rev-parse` para fijar un hash de commit; la Task 0 del plan asociado debe fijar el `HEAD` real antes de ejecutar cualquier tarea.
**Naturaleza:** diseño y especificación técnica. Este documento no implementa código, no modifica datos ni configuración, no ejecuta migraciones y no despliega producción.
**Plan asociado:** `docs/superpowers/plans/2026-09-20-radar-fit-feedback-implementation.md`

> **Convención de evidencia:** **[EXISTE]** significa verificado leyendo el código de este árbol de trabajo; **[PROPUESTO]** significa diseño aún no implementado; **[APORTADO]** significa un dato aportado por el usuario/product owner como contexto aprobado que esta sesión no pudo verificar de forma independiente contra el repositorio (se cita tal como se recibió, sin inflar su grado de verificación).

---

## 1. Propósito

El Radar de Licitaciones ya lista, filtra y ordena procesos públicos. El control **"Encaje"** y la opción de orden **"Mayor encaje primero"** existen hoy, pero ambos leen exclusivamente el campo legado `score`: una suma de puntos por coincidencia de palabras clave más dos ajustes por valor del contrato. Esa señal es barata de calcular y ya está mal calibrada — **[APORTADO]** un snapshot de auditoría reportado por el usuario clasificó 72 de 74 procesos como "alto", es decir, el campo `score` no discrimina; casi todo cae en el mismo cajón.

Este diseño introduce una **política de encaje pura, determinística y versionada** (`tender-fit-v1`) que reemplaza al `score` legado como fuente de verdad para el filtro "Encaje" y el orden "Mayor encaje primero", sin abrir ninguna bandeja ni vista nueva y sin tocar la autoridad humana de conversión/GO-NO-GO. El alcance es **backend-first**: la política se deriva una vez en el servidor, viaja en el payload existente bajo una clave nueva `fit`, y el frontend consume esa proyección con una única extensión mínima al control "Encaje" ya existente (`por_validar`).

En paralelo, se cierra un riesgo de gobernanza sobre el aprendizaje ya existente: la proyección de observaciones históricas (`agt002-radar-learning-projection.js`) hoy puede emitir hasta cuatro observaciones correlacionadas por la misma licitación (conversión, análisis canónico, decisión GO/NO-GO, resultado de oferta). Cualquier conteo agregado sobre esas observaciones sin colapsarlas primero cuenta la misma licitación varias veces. Este diseño añade una función pura de colapso por precedencia, usada únicamente por una auditoría de cohorte de sólo lectura — **la política `tender-fit-v1` no consume retroalimentación**: su campo `feedback` es un valor fijo que aporta cero puntos.

## 2. Autoridad y límites indelegables

- El Radar sigue siendo **una sola vista**; no se crean bandejas, pestañas ni pantallas nuevas.
- Ningún artefacto de este alcance escribe `internal_status`, `converted_opportunity_id` ni invoca `/api/tender-convert` o `psi_convert_tender_to_opportunity`.
- Ningún artefacto de este alcance emite, persiste ni insinúa una decisión GO/NO-GO.
- No hay migración de base de datos: `fit` se **deriva en memoria** en cada lectura (`dbTenderToPublic`), nunca se persiste en `psi_public_tenders`.
- El campo legado `score` **se conserva íntegro** — mismo cálculo, mismo campo, misma posición en el payload — por compatibilidad con todo el código que ya lo lee (secciones `hacer`/`revisar`/`prioridad_baja`, badges existentes, exportaciones). Sólo deja de ser la fuente que gobierna el filtro/orden "Encaje".
- `tender-fit-v1` no tiene autoridad de descarte: la ausencia de datos (valor, fecha de cierre, territorio) nunca se interpreta como incumplimiento ni baja el proceso de la lista; se refleja como `data_gaps` y como la banda `por_validar`, siempre con `human_review_required` implícito en que ninguna banda cierra el proceso ni lo oculta.
- La retroalimentación (`feedback`) es **de solo evidencia** en v1: `applied_points` es siempre `0`. Ningún peso de política puede cambiar sin (a) una cohorte revisada, (b) una comparación sombra contra la banda actual, (c) una nueva versión de política (`tender-fit-v2`, …) y (d) aprobación humana explícita. Esto es un invariante de diseño, no una preferencia de implementación.

## 3. Estado actual verificado

### 3.1 El filtro y el orden "Encaje" sólo leen `score`

**[EXISTE]** `sortTenderCards` (`src/tenders/radarUtils.ts:132-139`) resuelve la clave de orden `score` así:

```ts
const value = (tender: PublicTender): string | number => key === 'deadline' ? tender.deadline || '9999-12-31'
  : key === 'value' ? Number(tender.value || 0)
  : key === 'score' ? Number(tender.score || 0)
  : key === 'entity' ? tender.entity : tender.source;
```

**[EXISTE]** El selector de orden en `src/tenders/TenderRadarView.tsx:131` tiene la opción `<option value="score:desc">Mayor encaje primero</option>`, que fija `sort='score', direction='desc'` — es decir, **"Mayor encaje primero" hoy es, literalmente, "ordenar por `score` legado descendente"**, sin excepción.

**[EXISTE]** `filterRadarTenders` (`src/tenders/radarUtils.ts:116-130`) calcula `const fit = Number(tender.score || 0)` y filtra con umbrales fijos `alto >= 70`, `40 <= medio < 70`, `bajo < 40` — de nuevo, exclusivamente sobre `score`.

**[EXISTE]** `TenderScoreFilter` (`src/tenders/types.ts:9`) es `'todas' | 'alto' | 'medio' | 'bajo'`; no existe hoy ningún valor `por_validar`.

### 3.2 Qué calcula realmente `score`

**[EXISTE]** `scoreTender(row, nameFields)` (`server/index.js:1322-1352`) es la única función que produce `score`:

1. Recorre `tenderPositiveEntries` (términos positivos con puntaje fijo por coincidencia textual en el objeto/título/descripción) y suma puntos por cada término distinto que aparece, evitando duplicar sinónimos que se contienen entre sí.
2. Añade una razón contextual si `vigilancia` aparece junto a contexto de seguridad física.
3. Recorre `tenderFocusTerms` (`server/index.js:1076`: `bogotá`/`bogota`/`distrito capital`/`medellín`/`medellin`/`antioquia`, con pesos 22/22/20/22/22/14) y suma puntos por cada coincidencia textual en **todo** el texto de la fila, no sólo el objeto contractual.
4. Ajusta por valor: `value >= 500_000_000` suma `+25`; `0 < value < 50_000_000` resta `-15`; `value` ausente/`0` sólo agrega un riesgo textual, sin puntaje.
5. Devuelve `{ score, reasons, risks }`, sin límite superior — el puntaje es una suma abierta de coincidencias léxicas, no una proyección acotada.

**[EXISTE]** `scoreTender` **no modela**: recurrencia del comprador (cuántas veces esa entidad ya contrató con SN), rotación de incumbente, similitud de experiencia SN con el objeto, ruta de alianza vs. oferta directa, calidad/integridad del dato de origen, ni ninguna señal de retroalimentación humana (GO/NO-GO, conversión, resultado de oferta). Es puramente léxico + un ajuste de valor.

**[APORTADO]** Un snapshot de auditoría reportado por el usuario mostró 72 de 74 procesos clasificados en la banda "alto" bajo los umbrales actuales del filtro (`score >= 70`). Esta sesión no tuvo forma de reproducir ese snapshot contra datos de producción, pero el hallazgo es consistente con el mecanismo verificado en 3.1–3.2: una suma abierta de puntos por coincidencia léxica, sin techo, con dos zonas focales que aportan hasta 22 puntos cada una y un bono de valor de 25 puntos, cruza fácilmente cualquier umbral fijo bajo (70) para la mayoría de procesos de vigilancia/seguridad que ya superaron el filtro de relevancia (`isTenderTrackable`/`hasTenderServiceSignal`) antes de llegar al Radar.

### 3.3 Cómo se sirve el payload al frontend

**[EXISTE]** `dbTenderToPublic(row)` (`server/index.js:1577-1591`, sin `export`) proyecta cada fila de `psi_public_tenders` al `PublicTender` público. Copia `score: Number(row.score || 0)` desde la columna persistida, sin ningún campo adicional de encaje.

**[EXISTE]** `readPersistedTenderRadar` (`server/index.js:1633-1691`) es el camino normal (tabla disponible): lee filas, las mapea con `dbTenderToPublic`, y ordena en `server/index.js:1685-1689`:

```js
.sort((a,b) => {
  const statusOrder = { nueva: 0, en_revision: 1, convertida_oportunidad: 2, descartada: 3 };
  const sectionOrder = { hacer: 0, revisar: 1, prioridad_baja: 2 };
  return (statusOrder[a.internal_status] ?? 9) - (statusOrder[b.internal_status] ?? 9)
      || sectionOrder[a.section] - sectionOrder[b.section]
      || b.score - a.score;
});
```

**[EXISTE]** Dos caminos alternos (`server/index.js:1713` y `:1740`, ambos vía `radarPayload(live, …)`) sirven el Radar **sin pasar por `dbTenderToPublic`** cuando la tabla `psi_public_tenders` no está disponible: usan directamente la salida de `normalizeTender`/`fetchPublicTenderRadar`. Estos payloads sólo tendrán `score` (legado), nunca `fit` — de ahí la necesidad de un *fallback* explícito en frontend (§6.3).

**[EXISTE]** `radarPayload(tenders, …)` (`server/index.js:1547-1566`) calcula `totals` con conteos fijos (`all`, `hacer`, `revisar`, `prioridadBaja`, `highValue`, `urgent`, `enRevision`, `convertidas`, `descartadas`); no existe hoy ningún conteo por banda de encaje.

**[EXISTE]** El endpoint de perfiles guardados valida `score_filter` contra una lista blanca idéntica en ambos archivos: `const tenderScoreFilters = ['todas','alto','medio','bajo'];` (`server/index.js:1083`, `api/[...path].js:1083`), consumida por `pickTenderFilter(value, allowed, fallback='todas')` (`server/index.js:1084`). La columna `score_filter` en `psi_tender_search_profiles` (`supabase/migrations/013_tender_search_profiles.sql:14`) es `text not null default 'todas'` **sin** `check` — la validación vive sólo en el servidor.

**[EXISTE]** `npm run check:backend-parity` (`scripts/check_backend_parity.mjs`) exige que `server/index.js` y `api/[...path].js` sean **byte-idénticos**. Todo cambio de backend se aplica dos veces, idéntico.

### 3.4 Vocabulario de servicio ya factorizado y reutilizable

**[EXISTE]** `tender-relevance-terms.js` (raíz del repo, consumido por ambos backends) exporta `TENDER_CORE_SERVICE_TERMS` (14 términos), `isTenderCoreServiceTerm(value)` y `extractTenderCoreServiceTerms(value)` (normaliza acentos/mayúsculas y hace *match* por frontera de palabra). El conjunto mezcla dos familias sin distinguirlas hoy:

- **Física/privada/armada:** `vigilancia y seguridad privada`, `vigilancia y seguridad`, `servicios de vigilancia`, `servicio de vigilancia`, `vigilancia armada`, `vigilancia privada`, `seguridad privada` (7 términos).
- **Electrónica/CCTV/control de acceso:** `seguridad electronica`, `seguridad electrónica`, `cctv`, `videovigilancia`, `video vigilancia`, `control de acceso`, `circuito cerrado` (7 términos).

La partición es exacta (14 = 7 + 7) y ya está probada indirectamente por `tests/agt002-radar-relevance-terms.test.mjs` y por el uso de `hasTenderServiceSignal`/`extractTenderCoreServiceTerms` en `agt002-radar-learning-projection.js`.

### 3.5 Aprendizaje ya existente y su doble conteo correlacionado

**[EXISTE]** `projectAgt002RadarLearningObservations(database, { limit })` (`agt002-radar-learning-projection.js`) lee cuatro fuentes independientes y emite **una observación por fila de cada fuente**, todas dentro de un único arreglo plano `precedents`:

| Fuente | Tabla | `observation_id` | Polaridad |
|---|---|---|---|
| Conversión manual | `psi_public_tenders` (`internal_status='convertida_oportunidad'`) | `converted_tender:<id>` | `favorable` |
| Análisis canónico | `psi_tender_analysis_runs` (`canonical=true, status='completed'`) | `canonical_analysis:<id>` | `neutra` |
| Decisión humana vigente | `psi_tender_go_no_go_decisions` (colapsada por sucesión con `resolveCurrentHumanDecisions`) | `human_decision:<id>` | `favorable`/`desfavorable`/`neutra` |
| Resultado de oferta | `psi_tender_offer_status_transitions` (`to_status in (presentada,adjudicada,no_adjudicada)`) | `offer_outcome:<id>` | `favorable`/`desfavorable`/`neutra` |

**Hallazgo de diseño:** una misma licitación convertida, con análisis canónico, con decisión GO y con resultado adjudicada puede aportar **hasta cuatro observaciones simultáneas** en `precedents`. `agt002-radar-learning-retrieval.js::buildAgt002RadarLearningSignals` deduplica por `observation_id`, no por `tender_id`, así que las cuatro pueden sobrevivir como cuatro señales "independientes" para un mismo candidato comparable — son la misma historia contada cuatro veces. Esto es aceptable para el retrieval específico del candidato (cada observación aporta evidencia distinta sobre la *misma* licitación, y el candidato nunca es engañado sobre su origen), pero es **inválido** para cualquier estadística agregada que cuente "cuántas licitaciones históricas fueron favorables": ahí, la licitación con cuatro observaciones pesa cuatro veces lo que una con una sola.

### 3.6 Plantilla ya existente para auditorías de sólo lectura

**[EXISTE]** `scripts/agt002-radar-gate-historical-audit.mjs` es el patrón ya establecido para una auditoría de cohorte contra Supabase por REST directo (sin SDK), de sólo lectura: `readAll` pagina con `GET` puro, `main()` imprime JSON y fija `process.exitCode` según una condición de cierre, y **[EXISTE]** `tests/agt002-radar-historical-audit.test.mjs:170-177` guarda ese contrato con aserciones de forma: el código fuente del script no debe contener `method: 'POST'|'PATCH'|'PUT'|'DELETE'`, no debe aceptar `--apply`, y no debe invocar ningún RPC de escritura (`psi_record_*`, `psi_append_*`, `psi_enqueue_*`, etc.).

### 3.7 Archivos con cambios recientes ajenos a este alcance

**[EXISTE]** `agt002-radar-preanalysis-runtime.js` contiene una corrección de producción fechada **2026-09-20** (el mismo día de este diseño): un *fail-closed* de `isAgt002RadarPreanalysisConfigured` contra `AGT002_PREVIEW_ALLOWED_MODELS` (ver el comentario inline "regresión producción 2026-09-20" y el bloque `REQUIRED`/`AGT002_PREVIEW_ALLOWED_MODELS.includes(...)`). Sus pruebas asociadas son `tests/agt002-radar-preanalysis-runtime.test.mjs` y `tests/agt002-radar-preanalysis-usage-authority.test.mjs` (esta última documenta la misma regresión en un comentario). **Ninguna tarea de este alcance toca estos tres archivos**: no forman parte de la política de encaje, del envoltorio del Radar ni de la proyección de aprendizaje. Se documentan aquí únicamente como advertencia operativa: cualquier commit de este plan debe listar rutas explícitas (`git add <rutas>`), nunca `git add -A` ni `git add .`, para no arrastrar cambios en curso ajenos al alcance si el árbol de trabajo real tuviera algo pendiente sobre estos archivos al momento de ejecutar.

## 4. No-alcance

- No se crea ninguna bandeja, pestaña ni vista nueva. El Radar sigue siendo una sola pantalla.
- No se modifica el layout de `TenderRadarView.tsx`: mismos filtros, mismo panel, mismas tarjetas. La única adición visual es una opción más en el `<select>` "Encaje" ya existente y, opcionalmente, un fragmento de texto en el badge de score ya existente.
- No hay migración de esquema ni columna nueva en `psi_public_tenders`. `fit` se deriva en memoria en cada lectura.
- No se toca `persistTenderRadar`, `scoreTender`, `classifyTenderSection` ni la sección (`hacer`/`revisar`/`prioridad_baja`): la política de encaje es una proyección adicional, no un reemplazo del pipeline de ingesta/sección existente.
- No se modifica `agt002-radar-preanalysis-runtime.js` ni sus dos pruebas asociadas (§3.7).
- `feedback` no tiene efecto en el puntaje en `tender-fit-v1`. Ningún artefacto de este alcance ajusta pesos de política a partir de datos de retroalimentación.
- No se emite, persiste ni insinúa ninguna recomendación GO/NO-GO. No se escribe `internal_status` ni `converted_opportunity_id`.
- No se despliega, no se hace commit a `main`, no se aplican migraciones ni se cambian variables de entorno productivas dentro de este alcance de diseño; el plan asociado deja el *deploy* como puerta final separada y explícitamente gateada.

## 5. Alternativas descartadas

| # | Alternativa | Por qué se descarta |
|---|---|---|
| A1 | Reemplazar `score` legado por `fit.score` en la misma columna/campo | Rompe todo el código que hoy lee `score` para secciones, badges y exportaciones sin relación con "Encaje". El campo legado se conserva íntegro; sólo se deja de usar para el filtro/orden "Encaje". |
| A2 | Persistir `fit` como columna nueva en `psi_public_tenders` (migración) | El alcance aprobado es "backend-first... sin nueva vista" y no pide migración. Derivar en memoria en `dbTenderToPublic` es determinístico y barato (una función pura sobre una fila ya leída); persistir introduce una segunda fuente de verdad que puede quedar rezagada frente a la política vigente sin backfill. |
| A3 | Calcular `fit` en el frontend (`radarUtils.ts`) | Viola "backend-first" y duplicaría la política en TypeScript. Además, dos implementaciones de la misma política divergen con el tiempo (ver el precedente ya documentado de `tenderDeadlineBucket` vs `tenderDaysUntil` en `docs/superpowers/specs/2026-08-25-agt002-radar-learning-design.md` §3.3, que este diseño evita repetir para la política de encaje). |
| A4 | Reutilizar `tenderFocusTerms` y `tenderDaysUntil` del backend legado directamente para los ejes de territorio/ventana de `tender-fit-v1` | Ambos son internos a `scoreTender`/`server/index.js`, no exportados, y están atados a la escala de puntos abierta del `score` legado (pesos 22/20/14, sin techo) que es precisamente lo que se reemplaza. `tender-fit-v1` define sus propias listas de alias y su propio cómputo de días, versionadas y acotadas (§7), aceptando la duplicación deliberada ya precedentada en este repositorio antes que acoplar un módulo nuevo, puro y versionado a un cálculo legado que se está degradando en autoridad. |
| A5 | Hacer que la ausencia de valor/fecha cuente como `score` bajo (banda `bajo`) | El alcance aprobado exige explícitamente que "missing data is not non-compliance". Un proceso sin valor reportado no es un mal encaje: es un encaje **no verificable**. Se modela con la banda `por_validar` y `data_gaps` críticos, nunca como `bajo`. |
| A6 | Que `tender-fit-v1` module GO/NO-GO, conversión o alianza como una recomendación | Excede la autoridad de un backend de lectura y contradice la carta ya vigente en `030_agt002_radar_priority.sql` ("the automated score may prioritize, never decide"). `participation_hint` es una pista de forma de participación (`directa`/`alianza_probable`/`por_definir`), nunca una decisión. |
| A7 | Hacer que `feedback` aporte puntos ya en v1, usando las observaciones de aprendizaje existentes | El alcance aprobado exige un cambio de peso futuro gobernado por cohorte revisada + comparación sombra + nueva versión + aprobación humana. Aplicar puntos en v1 sin ese proceso repetiría el mismo error de calibración no auditada que hizo que `score` clasificara 72/74 en "alto". `feedback` en v1 es un valor fijo de cero efecto, documentado como tal. |
| A8 | Dejar que la auditoría de cohorte cuente observaciones de aprendizaje sin colapsar | Produce doble/triple/cuádruple conteo correlacionado de la misma licitación (§3.5), sesgando cualquier comparación legado-vs-`fit` hacia las licitaciones con más eventos registrados, no hacia las que realmente tuvieron mejor resultado. Se introduce una función pura de colapso por precedencia (§8) usada sólo por la auditoría. |
| A9 | Cambiar `TenderRadarView.tsx` para mostrar los ejes/razones de `fit` en una sección nueva de la tarjeta | Excede "no cambios visuales mayores". El badge existente puede opcionalmente anotar la banda (`Score 80 · Encaje alto`); no se añade ningún bloque, acordeón ni sección nueva. |
| A10 | Quitar las opciones `alto`/`medio`/`bajo` del filtro y reemplazarlas por las nuevas bandas | El alcance exige "extend... con `por_validar`", no reemplazar. Las etiquetas `alto`/`medio`/`bajo` se conservan (ahora leídas de `fit.band` cuando existe) y se añade `por_validar` como cuarta opción, preservando compatibilidad con perfiles guardados existentes. |

## 6. Arquitectura objetivo

```text
psi_public_tenders (SIN CAMBIOS: sin migración, sin columna nueva)
        │  (lectura ya existente)
        ▼
readPersistedTenderRadar
        │
        ▼
dbTenderToPublic(row)                                              [MODIFICADO]
        │  row.score → PublicTender.score   (SIN CAMBIOS, se conserva)
        │  evaluateTenderFit(row, { nowIso }) → PublicTender.fit   [NUEVO]
        ▼
.sort(...)  — banda fit, score fit, status, sección, urgencia, score legado  [MODIFICADO]
        ▼
radarPayload(rows, …) — totals.fit{alto,medio,porValidar,bajo,sinDatos}     [MODIFICADO]
        ▼
GET /api/tenders  →  payload.tenders[].fit  (forma nueva y opcional)
        │
        ▼
src/tenders/radarUtils.ts
  filterRadarTenders  — usa tender.fit?.band si existe; si no, fallback a score legado [MODIFICADO]
  sortTenderCards     — clave 'score' lee tender.fit?.score ?? tender.score            [MODIFICADO]
        ▼
TenderRadarView.tsx
  <select> "Encaje": Alto | Medio | Por validar | Bajo   [MODIFICADO: +1 opción]
  badge de tarjeta: "Score {score}" (+ banda opcional)   [MODIFICADO: texto opcional]

Rutas sin dbTenderToPublic (tabla ausente): radarPayload(live, …) — SIN `fit`, frontend cae a score legado
────────────────────────────────────────────────────────────────────────────────────

tender-fit-policy.js (NUEVO, raíz del repo, módulo puro)
  evaluateTenderFit(tender, { nowIso }) → envoltorio `fit` (§7)
  importa: tender-relevance-terms.js (servicio)
  no importa: base de datos, red, reloj del sistema (nowIso siempre inyectado)

Retroalimentación gobernada (sólo lectura, sin efecto en v1)
  agt002-radar-learning-projection.js
    projectAgt002RadarLearningObservations(...)         [SIN CAMBIOS DE COMPORTAMIENTO]
    collapseAgt002RadarLearningObservationsByTender(...) [NUEVO, función pura añadida al mismo módulo]
        │  precedencia: offer_outcome > human_decision > converted_tender > canonical_analysis
        ▼
  scripts/tender-fit-cohort-audit.mjs (NUEVO, sólo lectura, sin --apply, sin RPC de escritura)
    compara distribución legado (score/70-40) vs fit (banda) sobre el mismo cohorte de licitaciones,
    usando observaciones colapsadas como contexto de resultado — nunca como entrada de puntaje.
```

## 7. `tender-fit-policy.js` — contrato [PROPUESTO]

### 7.1 Firma y garantías

```js
export const TENDER_FIT_POLICY_VERSION = 'tender-fit-v1';
export function evaluateTenderFit(tender, { nowIso }) { … }
```

- **Pura:** ninguna llamada a `Date.now()`, `Math.random()`, red o base de datos. `nowIso` se inyecta siempre.
- **Determinística:** misma entrada + mismo `nowIso` ⇒ mismo `JSON.stringify(resultado)`, byte a byte.
- **Total sobre entradas parciales:** nunca lanza por campos ausentes en `tender` (`value`, `deadline_at`, `city`, `dept`, `category` faltantes son datos gap, no errores). Lanza únicamente ante forma estructuralmente inválida: `tender` no es objeto, o `nowIso` no es una fecha ISO parseable.
- **Versionada:** el envoltorio de salida lleva `policy_version: 'tender-fit-v1'` embebido, no inferido por el consumidor.
- **Sin autoridad de estado:** no escribe nada; es una función `(input) → output`.

### 7.2 Entrada esperada

`tender` se acepta con forma de fila de `psi_public_tenders` (duck-typed, todos los campos opcionales salvo estructura de objeto):

```
{ title, description, value, deadline_at, city, dept, category }
```

Esto permite invocarla directamente como `evaluateTenderFit(row, { nowIso })` dentro de `dbTenderToPublic(row)` sin remapear nombres de columna.

### 7.3 Eje 1 — Servicio (máx. 50 puntos)

Usa `extractTenderCoreServiceTerms(`${tender.title || ''} ${tender.description || ''}`)` de `tender-relevance-terms.js` y clasifica los términos encontrados contra dos subconjuntos definidos **dentro de `tender-fit-policy.js`** (partición exacta de `TENDER_CORE_SERVICE_TERMS`, ver §3.4):

| Condición | Puntos | Nota |
|---|---|---|
| Al menos un término de vigilancia física/privada/armada | 50 | Los sinónimos no se acumulan: uno o varios términos físicos siguen sumando 50, nunca más. |
| Ningún término físico, pero al menos un término de seguridad electrónica/CCTV/videovigilancia/control de acceso | 40 | Igual: los sinónimos electrónicos no se acumulan entre sí. |
| Ningún término de ninguna de las dos familias | 0 | Fuerza la banda `bajo` (§7.7), independientemente de los demás ejes. |

Precedencia física-sobre-electrónica: si el texto contiene términos de ambas familias (p. ej. "vigilancia armada y CCTV"), puntúa 50, no 90 — el eje tiene techo 50 por definición.

### 7.4 Eje 2 — Escala comercial (máx. 20 puntos, referencia GEVECOL)

Basado en `Number(tender.value || 0)`, con intervalos semiabiertos para resolver sin ambigüedad los límites que el alcance aprobado describió por rango de etiqueta (`50m-500m`, `500m-1b`, `1b-10b`, `10b-30b`, `>30b`, `<50m`):

| Rango (COP) | Puntos | Nota |
|---|---|---|
| `valor <= 0` o ausente | 0 (sin puntaje de este eje) | **Brecha crítica de dato** (`valor_no_reportado`), nunca "encaje bajo". Fuerza banda `por_validar` salvo que el eje de servicio ya haya forzado `bajo`. |
| `0 < valor < 50.000.000` | 0 | |
| `50.000.000 <= valor < 500.000.000` | 6 | |
| `500.000.000 <= valor < 1.000.000.000` | 12 | |
| `1.000.000.000 <= valor < 10.000.000.000` | 20 | |
| `10.000.000.000 <= valor <= 30.000.000.000` | 16 | |
| `valor > 30.000.000.000` | 10 | Añade `participation_hint = 'alianza_probable'` (§7.8). |

### 7.5 Eje 3 — Territorio (máx. 15 puntos)

Compara `tender.city`/`tender.dept` (normalizado: sin tildes, minúsculas) contra dos listas de alias internas a `tender-fit-policy.js` — la misma pareja de focos "actualmente verificados" que ya usa `TENDER_SN_REGIONS` en el frontend (`bog_cundinamarca`, `med_antioquia`; ver `src/tenders/radarUtils.ts:5-15`), duplicadas deliberadamente aquí en vez de importadas (A4, §5):

| Condición | Puntos | Nota |
|---|---|---|
| `city`/`dept` coincide con alias de Bogotá/Cundinamarca o Medellín/Antioquia | 15 | |
| `city`/`dept` presente pero no coincide con ningún foco conocido | 0 | **Sin penalización**: es un territorio conocido fuera del foco actual, no un dato malo. |
| `city` y `dept` ambos ausentes/vacíos | 0 | **Brecha no crítica** (`territorio_no_reportado`): baja `confidence` a `media`, no fuerza `por_validar`. |

### 7.6 Eje 4 — Ventana operativa (máx. 15 puntos)

Días hasta `tender.deadline_at`, calculados con la misma asimetría ya establecida en `src/tenders/radarUtils.ts:62-97` — reimplementada internamente en `tender-fit-policy.js` sin importar (A4, §5): `nowIso` se convierte a día calendario **Bogotá** vía `Intl.DateTimeFormat('en', { timeZone: 'America/Bogota', … })` (mismo método que `bogotaCalendarDate`, `radarUtils.ts:76-85`, y que `bogotaCalendarDay` en `agt002-radar-gate.js`), porque "ahora" es un instante real que necesita resolución de huso horario para saber qué día es hoy en Bogotá; `deadline_at`, en cambio, se lee como **fecha calendario literal** extrayendo `YYYY-MM-DD` por expresión regular (mismo método que `parseTenderCalendarDate`, `radarUtils.ts:62-74`), **sin** aplicarle ninguna conversión de huso horario — un `deadline_at` con sufijo `Z`/offset no se reinterpreta como instante; sus tres primeros componentes numéricos son la fecha de cierre. Mezclar ambos métodos (aplicar `Intl`/huso horario también al `deadline_at`) desplazaría la fecha de cierre hasta un día calendario distinto cuando el offset cruza medianoche en Bogotá, y es exactamente el error que esta asimetría evita.

| Condición | Puntos | Nota |
|---|---|---|
| `deadline_at` ausente o no parseable como fecha calendario | 0 | **Brecha crítica** (`fecha_cierre_no_verificable`). Fuerza `por_validar` salvo que el eje de servicio ya haya forzado `bajo`. |
| días restantes `>= 16` | 15 | |
| `8 <= días <= 15` | 10 | |
| `0 <= días <= 7` | 4 | Se añade una razón de urgencia explícita en `reasons[]` (no es una brecha; el dato existe y es válido). |
| `días < 0` (vencida) | 0 | La política de encaje **no decide validez**: esa autoridad sigue siendo del gate/estado del proceso en otra capa. Aquí sólo se refleja como ventana agotada. |

### 7.7 Puntaje total y bandas

`score = eje_servicio + eje_escala + eje_territorio + eje_ventana` (rango `0..100`, entero).

Precedencia de banda (se evalúa en este orden; la primera condición que aplica decide):

1. **`bajo`** — el eje de servicio puntuó `0` (ningún término de ninguna familia). Ningún otro eje puede compensar la ausencia de servicio ofertable.
2. **`por_validar`** — hay al menos una brecha crítica (`valor_no_reportado` o `fecha_cierre_no_verificable`), con servicio presente.
3. **`alto`** — `score >= 75` y sin brecha crítica.
4. **`bajo`** — `score < 45`, sin brecha crítica (servicio presente pero encaje objetivamente débil).
5. **`medio`** — cualquier otro caso (servicio presente, sin brecha crítica, `45 <= score < 75`).

### 7.8 Confianza y pista de participación

`confidence`:
- `alta` — `value`, `deadline_at`, territorio (`city` o `dept`) y `category` presentes y verificables.
- `baja` — cualquier brecha crítica presente (valor o fecha de cierre).
- `media` — cualquier otro caso (falta territorio y/o `category`, sin brecha crítica).

`participation_hint`:
- `por_definir` — el eje de servicio puntuó `0` (nada que ofertar), **o** el valor es una brecha crítica (sin valor no se puede estimar si se requiere alianza).
- `alianza_probable` — `valor > 30.000.000.000` (único disparador en v1, §7.4).
- `directa` — cualquier otro caso con servicio presente y valor conocido `<= 30.000.000.000`.

### 7.9 Envoltorio de salida

```json
{
  "policy_version": "tender-fit-v1",
  "score": 100,
  "band": "alto",
  "confidence": "alta",
  "participation_hint": "directa",
  "reasons": [
    { "axis": "servicio", "points": 50, "detail": "vigilancia armada" },
    { "axis": "escala_comercial", "points": 20, "detail": "valor COP 2.500.000.000 (1b-10b)" },
    { "axis": "territorio", "points": 15, "detail": "Bogotá/Cundinamarca" },
    { "axis": "ventana_operativa", "points": 15, "detail": "22 días hasta el cierre" }
  ],
  "data_gaps": [],
  "feedback": { "mode": "evidence_only", "applied_points": 0, "policy": "human_reviewed_version_only" },
  "evaluated_at": "2026-09-20T15:00:00.000Z"
}
```

`reasons[]` trae exactamente un elemento por eje (orden fijo: `servicio`, `escala_comercial`, `territorio`, `ventana_operativa`), con `points` igual al puntaje efectivamente otorgado en ese eje (nunca negativo: el rango es `0..max_del_eje`) y `detail` en español, legible por humano, citando el dato observado. `data_gaps[]` trae `{ gap_id, field, severity: 'critical'|'noncritical' }`, con `gap_id` de un vocabulario cerrado: `valor_no_reportado`, `fecha_cierre_no_verificable` (críticos), `territorio_no_reportado`, `categoria_no_reportada` (no críticos). `feedback` es **siempre** el mismo objeto literal en v1 — no depende de la entrada.

## 8. Integración de backend [PROPUESTO]

### 8.1 `dbTenderToPublic`

`server/index.js:1577` y su copia byte-idéntica en `api/[...path].js`: se añade `export` a la declaración de la función (para poder probarla unitariamente, siguiendo el patrón ya usado por `isTenderTrackable`/`scoreTender`) y se añade una clave:

```js
export function dbTenderToPublic(row) {
  return {
    // … campos existentes sin cambios …
    fit: evaluateTenderFit(row, { nowIso: new Date().toISOString() }),
  };
}
```

Import nuevo en ambos archivos: `import { evaluateTenderFit } from '../tender-fit-policy.js';` (mismo nivel de profundidad que `tender-relevance-terms.js`, ver §Task 1 del plan de aprendizaje ya mergeado).

### 8.2 Orden en `readPersistedTenderRadar`

El comparador de `server/index.js:1685-1689` pasa de `(status, sección, score)` a `(status, banda fit, score fit, sección, urgencia, score legado)`:

```js
const statusOrder = { nueva: 0, en_revision: 1, convertida_oportunidad: 2, descartada: 3 };
const sectionOrder = { hacer: 0, revisar: 1, prioridad_baja: 2 };
const fitBandOrder = { alto: 0, medio: 1, por_validar: 2, bajo: 3 };
const urgency = t => t.days === null || t.days === undefined ? Number.POSITIVE_INFINITY : t.days;
.sort((a, b) =>
  (statusOrder[a.internal_status] ?? 9) - (statusOrder[b.internal_status] ?? 9)
  || (fitBandOrder[a.fit?.band] ?? 9) - (fitBandOrder[b.fit?.band] ?? 9)
  || (b.fit?.score ?? 0) - (a.fit?.score ?? 0)
  || sectionOrder[a.section] - sectionOrder[b.section]
  || urgency(a) - urgency(b)
  || b.score - a.score);
```

`b.score - a.score` se conserva como desempate final (el "legacy fallback" pedido en el alcance) para dos filas que empatan en todo lo demás.

### 8.3 Totales en `radarPayload`

`server/index.js:1547-1566` añade un sub-objeto sin tocar ninguna clave existente:

```js
totals: {
  all, hacer, revisar, prioridadBaja, highValue, urgent, enRevision, convertidas, descartadas, // SIN CAMBIOS
  fit: {
    alto: normalized.filter(t => t.fit?.band === 'alto').length,
    medio: normalized.filter(t => t.fit?.band === 'medio').length,
    porValidar: normalized.filter(t => t.fit?.band === 'por_validar').length,
    bajo: normalized.filter(t => t.fit?.band === 'bajo').length,
    sinDatos: normalized.filter(t => !t.fit).length,
  },
},
```

`sinDatos` cuenta filas servidas por los caminos `live`/`live_no_table` (§3.3) que nunca pasaron por `dbTenderToPublic`; en el camino normal (tabla disponible) siempre es `0`.

### 8.4 Perfiles guardados

`tenderScoreFilters` (`server/index.js:1083`, `api/[...path].js:1083`) pasa de `['todas','alto','medio','bajo']` a `['todas','alto','medio','por_validar','bajo']`. No se toca `psi_tender_search_profiles` (columna `text` sin `check`, ya acepta cualquier cadena); los perfiles guardados antes de este cambio con `score_filter` en `{alto,medio,bajo}` siguen siendo válidos sin migración de datos.

## 9. Integración de frontend (mínima) [PROPUESTO]

### 9.1 Tipos (`src/tenders/types.ts`)

```ts
export type TenderFitBand = 'alto' | 'medio' | 'por_validar' | 'bajo';
export type TenderFitConfidence = 'alta' | 'media' | 'baja';
export type TenderFitParticipationHint = 'directa' | 'alianza_probable' | 'por_definir';
export type TenderFitReason = { axis: string; points: number; detail: string };
export type TenderFitDataGap = { gap_id: string; field: string; severity: 'critical' | 'noncritical' };
export type TenderFitFeedback = { mode: 'evidence_only'; applied_points: 0; policy: 'human_reviewed_version_only' };
export type TenderFitProjection = {
  policy_version: string; score: number; band: TenderFitBand; confidence: TenderFitConfidence;
  participation_hint: TenderFitParticipationHint; reasons: TenderFitReason[]; data_gaps: TenderFitDataGap[];
  feedback: TenderFitFeedback; evaluated_at: string;
};
```

`PublicTender` (`types.ts:14-23`) gana `fit?: TenderFitProjection` (opcional — payloads `live`/`live_no_table` no lo traen). `TenderScoreFilter` (`types.ts:9`) pasa de `'todas' | 'alto' | 'medio' | 'bajo'` a `'todas' | 'alto' | 'medio' | 'por_validar' | 'bajo'`. `TenderRadarPayload.totals` (`types.ts:28`) gana un campo opcional `fit?: { alto: number; medio: number; porValidar: number; bajo: number; sinDatos: number }`.

### 9.2 `filterRadarTenders` (`src/tenders/radarUtils.ts:116-130`)

```ts
const fitBand = tender.fit?.band;
const legacyFit = Number(tender.score || 0);
const scoreMatches = filters.score === 'todas' || (
  fitBand
    ? fitBand === filters.score
    : filters.score !== 'por_validar' && (
        filters.score === 'alto' && legacyFit >= 70 ||
        filters.score === 'medio' && legacyFit >= 40 && legacyFit < 70 ||
        filters.score === 'bajo' && legacyFit < 40
      )
);
```

Cuando `tender.fit` existe (camino normal), el filtro compara directamente contra `fit.band` — `por_validar` funciona de inmediato. Cuando no existe (payload `live`/`live_no_table`), se usa exactamente el mismo umbral legado de hoy, y `por_validar` no puede coincidir con nada (no hay forma de derivarlo del `score` legado sin la política completa) — esto es el "legacy fallback" pedido en el alcance.

### 9.3 `sortTenderCards` (`src/tenders/radarUtils.ts:132-139`)

```ts
: key === 'score' ? Number(tender.fit?.score ?? tender.score ?? 0)
```

"Mayor encaje primero" pasa a ordenar por `fit.score` cuando existe, con el mismo *fallback* al `score` legado para payloads sin `fit`. El texto de la opción en el `<select>` (`TenderRadarView.tsx:131`) no cambia.

### 9.4 Control "Encaje" (`TenderRadarView.tsx:131`)

```html
<option value="todas">Todos</option>
<option value="alto">Alto</option>
<option value="medio">Medio</option>
<option value="por_validar">Por validar</option>
<option value="bajo">Bajo</option>
```

Una opción nueva insertada entre `medio` y `bajo`, mismo `<select>`, misma clase `tender-filter-score`, sin cambios de layout.

### 9.5 Badge (opcional, mínimo)

El badge existente `<span className="badge">Score {tender.score}</span>` (`TenderRadarView.tsx:136`) puede anotar la banda cuando `tender.fit` existe, p. ej. `Score {tender.score}{tender.fit ? \` · Encaje ${tender.fit.band}\` : ''}`. No se añade ningún elemento, sección ni clase nueva — es una extensión de texto dentro del badge que ya existe.

## 10. Retroalimentación gobernada, sin doble conteo [PROPUESTO]

### 10.1 Colapso por precedencia

Nueva función exportada desde el mismo módulo `agt002-radar-learning-projection.js` (sin tocar `projectAgt002RadarLearningObservations`, que sigue alimentando el retrieval específico del candidato sin cambios de comportamiento, §4):

```js
export const AGT002_RADAR_LEARNING_OBSERVATION_PRECEDENCE = Object.freeze([
  'offer_outcome', 'human_decision', 'converted_tender', 'canonical_analysis',
]);
export function collapseAgt002RadarLearningObservationsByTender(precedents) { … }
```

Para cada `tender_id` presente en `precedents`, conserva **una sola** observación: la de menor índice en `AGT002_RADAR_LEARNING_OBSERVATION_PRECEDENCE` (leyendo el prefijo de `observation_id` antes de `:`), y en empate de tipo, la de `decided_at` más reciente, y en empate de fecha, la de `observation_id` mayor (orden lexicográfico, determinístico). El resultado es un arreglo con **a lo sumo una observación por licitación**, ordenado por `observation_id` para determinismo byte a byte.

Esto materializa exactamente la precedencia aprobada: *resultado final de oferta* (la señal más cercana al desenlace comercial real) > *GO/NO-GO humano vigente* > *conversión humana* (interés, no desenlace) > *análisis canónico neutro* (la señal más débil: ni siquiera es una decisión humana).

### 10.2 Dónde se usa y dónde no

- `agt002-radar-learning-retrieval.js::buildAgt002RadarLearningSignals` **no cambia**: sigue leyendo `observations.precedents` sin colapsar, porque el retrieval específico del candidato necesita ver toda la evidencia distinta disponible sobre un precedente, no una sola observación resumida (§3.5). Las observaciones siguen siendo contexto para AGT-002 exactamente como hoy.
- `tender-fit-v1` **no llama** a `collapseAgt002RadarLearningObservationsByTender` en ningún punto de `evaluateTenderFit`. El campo `feedback` es un literal fijo (§7.9); la función de colapso existe únicamente para el consumidor descrito en §10.3.

### 10.3 Auditoría de cohorte de sólo lectura

`scripts/tender-fit-cohort-audit.mjs` [PROPUESTO], siguiendo el patrón ya establecido en `scripts/agt002-radar-gate-historical-audit.mjs` (§3.6):

1. Lee todas las filas de `psi_public_tenders` por REST `GET` paginado (sin SDK, sin escritura).
2. Para cada fila calcula `scoreTender`-equivalente ya persistido (`row.score`, legado) y `evaluateTenderFit(row, { nowIso })` (`tender-fit-v1`).
3. Lee las cuatro fuentes de aprendizaje vía `projectAgt002RadarLearningObservations` y las colapsa con `collapseAgt002RadarLearningObservationsByTender` — **una fila de contexto por licitación**, nunca más.
4. Emite un reporte JSON: distribución legado (bajo el umbral actual `70/40`) vs. distribución `fit` (por banda), y una tabla cruzada opcional contra la polaridad de la observación colapsada (favorable/desfavorable/neutra) **sólo como contexto descriptivo** — el script nunca usa esa tabla para ajustar ningún peso; sólo la imprime para que un humano decida si vale la pena proponer `tender-fit-v2`.
5. No escribe nada: sin `POST`/`PATCH`/`PUT`/`DELETE`, sin `--apply`, sin llamar ningún RPC de escritura. Guardado por un test de forma idéntico en espíritu a `tests/agt002-radar-historical-audit.test.mjs:170-177`.

### 10.4 Cambio de peso futuro (fuera de este alcance)

Cualquier `tender-fit-v2` que incorpore puntos de `feedback` requiere, como mínimo: (a) el reporte de §10.3 sobre una cohorte real, (b) una comparación sombra (`fit-v1` vs. `fit-v2` sobre el mismo cohorte, sin desplegar `v2`), (c) una nueva constante `policy_version`, y (d) aprobación humana explícita registrada. Nada de este diseño implementa ese camino; sólo dejarlo mencionado es dentro del alcance para que la intención de versión quede documentada.

## 11. Riesgos y mitigación

| Riesgo | Mitigación |
|---|---|
| `evaluateTenderFit` lanza sobre una fila real de producción con forma inesperada y tumba `GET /api/tenders` | Contrato de "total sobre entradas parciales" (§7.1): sólo lanza por forma estructuralmente inválida del argumento, nunca por campos de negocio ausentes. Se prueba explícitamente con filas mínimas (`{}`) y con `tender=null`. |
| El nuevo comparador de orden invierte silenciosamente el orden esperado para usuarios que ya memorizaron el Radar | `score` legado se mantiene como desempate final; el cambio de "Mayor encaje primero" es una mejora de discriminación (de 72/74 en una banda a una distribución real en cuatro bandas), documentado en el badge opcional (§9.5) para que el cambio sea visible, no silencioso. |
| Perfiles guardados con `score_filter='alto'` bajo el umbral legado (`score>=70`) ahora filtran por `fit.band==='alto'` (`score>=75` sin brecha crítica) y muestran menos resultados | Es el comportamiento deseado: el umbral legado era el problema (§3.2). No se requiere migración de datos porque `score_filter` es texto libre ya validado en el servidor (§8.4); el perfil sigue siendo válido, sólo cambia qué banda selecciona. |
| El colapso por precedencia (§10.1) esconde una observación real y sesga la auditoría de cohorte | El colapso sólo alimenta la auditoría descriptiva de §10.3, nunca el retrieval de AGT-002 (§10.2) ni el puntaje de `tender-fit-v1`. Ninguna decisión operativa depende de qué observación "gana" el colapso. |
| Un commit de este plan arrastra sin querer el trabajo en curso ajeno de `agt002-radar-preanalysis-runtime.js` (§3.7) | Cada tarea del plan asociado usa `git add <rutas explícitas>`, nunca `-A`/`.`; Task 0 exige comprobar `git status --porcelain` sobre esos tres archivos antes de empezar. |

## 12. Verificación exigida (resumen; detalle en el plan)

- Suite completa: `npm test` (equivalente a `node --test tests/*.test.mjs`, confirmar comando exacto en `package.json` antes de ejecutar).
- `npm run build` (`check:deployment-safety && tsc && vite build`).
- `npm run check:backend-parity` (`server/index.js` ≡ `api/[...path].js` byte a byte).
- `git diff --check` (sin conflictos residuales/espacios en blanco).
- Auditoría de cohorte (`scripts/tender-fit-cohort-audit.mjs`) ejecutada contra un entorno no productivo, de sólo lectura, con su propio test de forma.
- Revisión independiente del diff acumulado antes de cualquier PR/merge.
- *Deploy* y lectura post-cambio (*readback*) como puerta final separada, no ejecutada dentro de la fase de implementación de este alcance.
