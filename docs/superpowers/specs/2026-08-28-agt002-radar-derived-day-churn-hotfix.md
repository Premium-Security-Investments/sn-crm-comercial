# Especificación — AGT-002 Radar hotfix: reanálisis causado sólo por `raw.days`/`raw.window`

**Fecha:** 2026-08-28
**Naturaleza:** hotfix transicional de código. Este documento no ejecuta nada.
**Documento base:** `docs/superpowers/specs/2026-08-28-agt002-daily-scan-queue-design.md` (§6.1, §8.1).
Aquí sólo se registra el **delta**: el contrato de `agt002-radar-scan.js::runOnce()` cambia de forma
material respecto de §6.1 y por eso se documenta, en vez de reescribir aquel documento.
**Estado operativo al escribir:** cron y timer pausados. Este cambio **no** toca producción,
`systemd`, cron, Supabase ni credenciales, y **no** limpia ni procesa los 18 jobs pendientes.

**Ampliación (mismo día, misma naturaleza de hotfix):** el §3 original filtraba el churn únicamente
**antes de encolar** (`agt002-radar-scan.js`), lo que previene jobs *futuros* pero no dice nada de
los jobs *ya* encolados antes del hotfix. De los 18 `queued` reportados, 5 son exactamente este
churn (probado por sha256 contra el canónico vigente), 6 son novedades reales y 7 son material o
ambiguo. El RPC de reclamación (`psi_claim_agt002_radar_preanalysis_job`) sólo reclama el `queued`
más antiguo — no admite reclamo dirigido por id — y no hay SQL directo disponible para
actualizar/quarantinar filas de la cola ni para saltar jobs reales sin evaluarlos. §3.3 añade un
preflight equivalente dentro de `agt002-radar-worker.js`, en el mismo punto donde ese archivo ya
resuelve `stale_input`, para que los 5 jobs legacy drenen de forma gobernada — uno por tick, sin
modelar — la próxima vez que el worker se reactive, sin necesidad de tocar la cola por fuera del
contrato existente. Ver §3.3 y §4 para el delta completo; §2 se actualiza para reflejar que
`agt002-radar-worker.js` ya no queda fuera de alcance.

**Segunda ampliación (mismo día, bloqueo Critical de revisión independiente).** §3 y §3.3 sólo
resuelven el churn **antes de encolar** y **al reclamar un job**: ninguno de los dos toca lo que ya
está persistido. Pero el positivo canónico persiste con su `source_row_hash` de cuando se generó, y
dos lectores comparaban ese hash contra la fila de **hoy** con igualdad estricta, ajenos al filtro:
`agt002-radar-visibility.js:41` (`filterRadarRowsByCanonicalPreanalysis`, el filtro de lectura del
Radar en `server/index.js`/`api/[...path].js`) y
`scripts/agt002-radar-gate-historical-audit.mjs:106` (`planAgt002RadarGateAudit`, el script de
auditoría de solo lectura). El resultado: una oportunidad con un positivo canónico vigente
desaparecía del Radar el día después de que el recolector reescribiera `raw.days`/`raw.window`, y el
mismo caso se reportaba como `stale_hash`/`uncovered_visible_tenders` en la auditoría — contradiciendo
el propio hotfix, que documenta esta deriva como no-reanalizable. Ver §3.4 y §4.3/§4.4 para el delta
completo; §2 se actualiza para reflejar que estos dos archivos ahora también consumen el clasificador.

## 1. Causa raíz (dada por demostrada en producción)

- El gate calcula `source_row_hash` sobre una proyección que incluye **`raw` entero**
  (`agt002-radar-gate.js:18-22,42-46`).
- El recolector diario externo (`/root/.hermes/scripts/secop_psi_radar_export.sh
  --persist-supabase`, fuera de este repositorio, que invoca `secop_psi_radar.py`) reescribe cada
  día dos campos que **no son datos de la fuente sino derivados del reloj**: `raw.days` (días que
  faltan para el cierre) y `raw.window` (su etiqueta de banda). La forma exacta del cálculo vive en
  `secop_psi_radar.py::window_label` (líneas 811-823), **fuera de este repositorio y de este
  sandbox** — evidencia dada directamente, no leída del archivo. **No** es
  `tenderDaysUntil`/`tenderWindow` (`server/index.js:1053-1054`, `api/[...path].js:1053-1054`,
  `esu-direct-crawl.js:60-61`): esa es la etiqueta de la UI de este repo, para pintar en pantalla, y
  nunca escribe `raw`. Las bandas difieren: `window_label` da `days < 0` → `vencido / validar
  estado` (no "urgente") y `days > 30` → `excelente ventana (30+ días)` (no "ventana amplia").
- Consecuencia: una licitación sin ningún cambio material cambia de `source_row_hash` todos los
  días; el corto circuito `satisfied` de `psi_enqueue_agt002_radar_preanalysis_job`
  (`supabase/migrations/072_...sql:205-207`, que compara `(source_row_hash, policy_version,
  context_version)` contra la canónica) deja de aplicar; y se encola un reanálisis que sólo puede
  llegar a la misma conclusión que la corrida canónica vigente.
- Los 5 jobs pendientes reproducidos reproducen exactamente el hash canónico previo al cambiar sólo
  `days` al valor anterior y `window` a su etiqueta derivada.

## 2. Qué NO se cambia (y por qué)

- **No** se cambia el algoritmo de `computeAgt002RadarSourceRowHash`, ni `AGT002_RADAR_GATE_POLICY_VERSION`,
  ni `AGT002_RADAR_GATE_CONTEXT_VERSION`, ni el esquema `071`/`072`. Cualquiera de esas tres cosas
  invalidaría **todos** los canónicos ya escritos y convertiría un hotfix en una migración.
- **No** se toca `agt002-radar-gate.js`, `agt002-radar-preanalysis-jobs.js` ni
  `agt002-radar-preanalysis-persistence.js`. El lector bulk de canónicos
  (`readAgt002RadarCanonicalPreanalysis`) ya existía y sólo se **consume**, tanto desde el scan
  (§3) como, en la ampliación de este mismo documento, desde el worker (§3.3). `agt002-radar-worker.js`
  sí gana un preflight — ver §3.3 — pero conserva exactamente su arquitectura: `claim -> fetch_row ->
  gate -> ledger -> [gate/ledger ya resolvían `stale_input` aquí] -> learning -> agt -> persist`,
  `AGT002_RADAR_WORKER_STAGES` no cambia y no se añade ninguna llamada a `claimJob`/`completeJob`/
  `failJob` nueva ni distinta de las que ya existían.
- **No** se duplica el algoritmo de `isAgt002RadarDerivedDayOnlyChurn`/`hasAgt002RadarDerivedDayShape`
  en ningún sitio nuevo. En la segunda ampliación de este documento (§3.4), tanto
  `agt002-radar-visibility.js` como `scripts/agt002-radar-gate-historical-audit.mjs` **importan** el
  mismo clasificador que ya usan el scan (§3) y el worker (§3.3); ninguno de los dos reimplementa la
  comparación de hash ni el cálculo de `window_label`.
- **No** hay autoridad de conversión ni CRM: no se tocan `internal_status`,
  `converted_opportunity_id`, `responsible`, `followup`, `notes`, `decision`, ni ninguna ruta de
  conversión. `agt002-radar-derived-day-churn.js` queda bajo `DECISION_PATH_FILES` de
  `tests/agt002-radar-no-conversion-authority.test.mjs`.
- **No** hay emparejamiento difuso: no se compara por título, entidad ni similitud. La única
  comparación es la igualdad de un sha256.
- **No** se toca TLS/pinning, no se llama a `setMaxListeners`, no se silencia ningún warning.
- **No** se limpian ni procesan los 18 jobs pendientes: eso es un acto separado, posterior a review.

## 3. Diseño

Filtro **previo al encolado**, dentro de la etapa `enqueue` ya existente del scan. No se añade
ninguna etapa: `AGT002_RADAR_SCAN_STAGES` no cambia.

`agt002-radar-derived-day-churn.js` responde una única pregunta pura, sin I/O, sin reloj y sin
lanzar nunca:

> ¿El `source_row_hash` de la corrida canónica vigente se reproduce desde la fila de hoy cambiando
> **únicamente** `raw.days` y `raw.window` a una variante histórica válida?

Condiciones acumulativas; cualquier fallo cierra el camino y la fila **se encola como hoy**:

1. Existe canónica para esa licitación, con **el mismo** `policy_version` y `context_version` que la
   evaluación de gate de hoy, y con `source_row_hash` en `^[0-9a-f]{64}$`.
2. La fila trae la forma derivada exacta: `raw` objeto, `raw.days` **entero**, y `raw.window`
   **exactamente** la etiqueta determinista de ese `days` (`agt002RadarDerivedDayWindowLabel`,
   réplica de `window_label` del exportador productivo externo, no de `tenderWindow`). `days: null`
   —"sin fecha de cierre reportada"— queda deliberadamente fuera de alcance.
3. El hash de hoy **difiere** del canónico (si coincide, ya lo corta el RPC; no se contamina el
   contador de este hotfix).
4. Existe `offset ∈ [1, AGT002_RADAR_DERIVED_DAY_MAX_OFFSET_DAYS]` tal que, con
   `days = actual + offset` y `window = etiqueta(days)`, el hash reproduce el canónico. Sólo
   **valores históricos**: el recolector cuenta días que faltan, así que ayer siempre había más que
   hoy; probar `actual - offset` aceptaría un futuro que el recolector no pudo escribir.

La mutación ocurre sobre **una copia** (`{...row, raw:{...row.raw}}`) creada una vez y reescrita sólo
en esos dos campos escalares; `tenderRow` y `tenderRow.raw` quedan intactos, incluso congelados.
Como todo lo demás se comparte por referencia y nunca se toca, una coincidencia de sha256 **prueba**
que la diferencia estaba exclusivamente en `days`/`window`.

Dos propiedades que el filtro conserva por construcción:

- **La evidencia diaria no se pierde.** El filtro vive en la etapa `enqueue`; la etapa `ledger` ya
  corrió y escribió la evaluación de gate de **todas** las filas, sobrevivientes y eliminadas. Lo
  único que no ocurre es la reserva de un job.
- **La cobertura de visibilidad no puede regresar.** El filtro sólo actúa cuando **existe** una
  corrida canónica para esa licitación; una licitación sin canónica siempre se encola. Por lo tanto
  `uncovered_visible_tenders` no puede subir por causa de este hotfix.

### 3.1 El límite de offsets y su evidencia

`AGT002_RADAR_DERIVED_DAY_MAX_OFFSET_DAYS = 60`.

Es una **ventana de compatibilidad explícita y fail-closed**, no el horizonte máximo global del
Radar: TVEC y ESU no tienen esa prueba. Evidencia en el árbol: `RECENT_DAYS=60` del recolector
SECOP dominante externo, replicado en este repositorio por `fetchSecopSource` —
`new Date(Date.now() - 60 * 86400000)` en `server/index.js:1203`, `api/[...path].js:1203`—: 60 días
es el intervalo más largo durante el cual una fila SECOP puede seguir reapareciendo en la ingesta
diaria. `fetchTvecEvents` (server/index.js) y el crawler directo de ESU (`esu-direct-crawl.js`) no
acotan su consulta a 60 días. Para esas fuentes, o para una canónica SECOP más vieja que la
ventana, el límite simplemente no alcanza a explicar la deriva: la fila **reanaliza de forma
conservadora**, el comportamiento vigente antes de este hotfix, no una regresión.

Costo: como mucho 60 sha256 sobre una proyección pequeña, y **sólo** por superviviente con la forma
derivada exacta. Sobrepasar el techo **falla cerrado**: se encola, que es el comportamiento vigente
antes del hotfix.

### 3.2 Carga de canónicos: bulk, nunca N+1

El scan diario procesa hasta 250 licitaciones. Se hace **una sola** llamada a
`readAgt002RadarCanonicalPreanalysis(database, ids)` por corrida (ese lector ya trocea internamente
de a 250 ids), con los ids de las supervivientes que traen la forma derivada. Las filas sin esa
forma no pueden clasificarse nunca, así que no justifican consulta: si ninguna la trae, **no se
consulta nada**.

Dos canónicas para la misma licitación —imposible según el índice único
`psi_agt002_radar_preanalysis_one_canonical_idx` de `072:44`— envenenan la entrada y esa licitación
se encola.

### 3.3 Drenaje del worker: mismo filtro, en el punto donde ya se resuelve `stale_input`

El RPC `psi_claim_agt002_radar_preanalysis_job` sólo reclama el `queued` más antiguo, sin claim
dirigido por id. No hay forma de "saltar" selectivamente los 5 jobs de churn dentro de la cola sin
tocarla por SQL directo (fuera de alcance) ni de dejar de evaluar los 6 novedades reales y los 7
material/ambiguos que están delante o detrás en el orden de reclamación. La única forma gobernada de
drenarlos es dejar que cada uno se reclame en su turno y decidir, con el mismo criterio puro que ya
usa el scan, si hace falta modelar.

`agt002-radar-worker.js` ya recomputa el gate sobre la fila vigente en cada disparo y, si esa
recomputación **no** coincide exactamente con `source_row_hash`/`policy_version`/`context_version`
congelados en el job, lo falla como `stale_input` sin aprendizaje ni modelo (línea 67-73 antes de
este delta). Ese chequeo cubre el caso en que la fila cambió *entre* el encolado y la reactivación,
pero no dice nada del caso en que la fila **sigue siendo exactamente la misma** que cuando se
encoló: los 5 jobs de churn son precisamente ese caso, porque fueron encolados por el mismo
`source_row_hash` que hoy sigue vigente en la fila (el recolector no ha vuelto a correr desde
entonces, o corrió y produjo el mismo `days`/`window`).

El preflight se inserta **inmediatamente después** de ese chequeo de coincidencia y **antes** de
`stages.push('learning')` — el punto exacto donde el propio código ya deja escrito el comentario
"si no coincide, el job se falla como `stale_input` sin invocar al agente ni persistir una corrida":

1. Si la fila vigente (`row`, ya fetchada en la etapa `fetch_row`) no trae la forma derivada exacta
   (`hasAgt002RadarDerivedDayShape`), no se consulta nada y el job sigue al modelo como hoy.
2. Si la trae, se hace **una única** consulta bulk —`readCanonicalPreanalysis(database,
   [job.tenderId])`, el mismo lector ya inyectado en el scan, ahora también inyectable en
   `createAgt002RadarWorker` (por defecto `readAgt002RadarCanonicalPreanalysis`)— con un **solo** id:
   el worker procesa un job por disparo, así que esto nunca es N+1, a diferencia del lote de hasta
   250 licitaciones del scan.
3. Se clasifica como churn **sólo** si la consulta devuelve **exactamente un** canónico cuyo
   `tender_id` coincide con `job.tenderId` y `isAgt002RadarDerivedDayOnlyChurn(row, canonicalRun,
   {policyVersion: evaluation.policy_version, contextVersion: evaluation.context_version})` es
   `true`. Ausencia, duplicado, `tender_id` distinto o cualquier otra forma extraña **no** suprime:
   el job sigue al modelo, igual que hoy.
4. Si clasifica, se lanza `Object.assign(new Error(...), {runtime_boundary_code:
   'AGT002_RADAR_STALE_INPUT'})` — el mismo código que ya usan los otros dos sitios de este archivo
   (fila ausente, divergencia de identidad) — y el `catch` **ya existente** de `runOnce()` lo
   clasifica vía `classifyAgt002RadarPreanalysisError` (que ya mapea `STALE` → `stale_input`, sin
   cambios) y llama `failJob(...,{errorCode:'stale_input'})`. No se añade ningún error code nuevo,
   ninguna migración, ninguna etapa a `AGT002_RADAR_WORKER_STAGES` y ninguna llamada nueva a
   `claimJob`/`completeJob`.
5. Un fallo **técnico** de esa consulta (la conexión, el `select` fallando) se propaga tal cual: el
   lector ya envuelve sus errores con `runtime_boundary_code: 'AGT002_RADAR_PERSISTENCE_FAILURE'`
   (`agt002-radar-preanalysis-persistence.js`, sin cambios), y el `catch` de `runOnce()` lo clasifica
   como `persistence_failure` — el mismo camino que ya usan hoy `fetchTenderRow`,
   `recordGateEvaluation`, `projectLearningObservations`, `runPreanalysis` y `recordPreanalysisRun`
   cuando fallan. El job se falla con ese código, sin exponer el mensaje crudo del error, y sin haber
   invocado nunca al modelo.

**Efecto sobre los 18 jobs pendientes.** El worker sigue reclamando de a uno, en el orden que ya
usa el RPC (más antiguo primero), y sigue siendo el único llamador de `claimJob`/`completeJob`/
`failJob`. Los 5 jobs de churn, al reclamarse, se resuelven como `stale_input` sin tocar el modelo;
los 6 novedades reales y los 7 material/ambiguos, al no tener forma derivada exacta o no reproducir
el hash canónico con un offset histórico válido, siguen exactamente el camino de hoy: se modelan. No
hace falta —y este documento no lo hace— reactivar cron/timer para que esto sea correcto: es una
propiedad del código, verificable con la suite de tests sin tocar producción. Reactivar el timer
para que el drenaje ocurra en producción es un acto operativo posterior, separado de este commit.

## 4. Delta de contrato

### 4.1 `agt002-radar-scan.js`

- `createAgt002RadarScan` acepta un parámetro inyectable más: `readCanonicalPreanalysis`
  (por defecto `readAgt002RadarCanonicalPreanalysis`). Sigue **sin** admitir `claimJob`,
  `runPreanalysis`, `recordPreanalysisRun`, `completeJob` ni `failJob`.
- El resultado gana **una clave**: `satisfied_derived_only`. `satisfied` sigue significando
  exactamente el corto circuito del RPC; los dos contadores están separados a propósito para poder
  medir el hotfix y retirarlo. La clave aparece tanto en `status:'completed'` como en el
  `status:'unavailable'` de la etapa `enqueue`.
- `AGT002_RADAR_SCAN_STAGES` y el resto del sobre (`status`, `stages`, `esu_refresh`, `evaluated`,
  `survivors`, `eliminated`, `enqueued`, `satisfied`, `rejected`, `error_code`) **no cambian**.
- Un fallo del lookup de canónicos es **técnico**: cae en el `catch` de la etapa `enqueue` y devuelve
  `{status:'unavailable', error_code:'persistence_failure'}` sin filtrar el texto crudo del error, y
  **sin haber encolado** sobre evidencia que no se pudo leer. Nunca se cuenta como `rejected`.

### 4.2 `agt002-radar-worker.js` (ampliación de este documento)

- `createAgt002RadarWorker` acepta un parámetro inyectable más: `readCanonicalPreanalysis` (por
  defecto `readAgt002RadarCanonicalPreanalysis`), simétrico al del scan. Sigue **sin** admitir
  ningún parámetro nuevo de `claimJob`/`completeJob`/`failJob` ni cambiar su firma.
- `AGT002_RADAR_WORKER_STAGES` **no cambia**: `['claim','fetch_row','gate','ledger','learning','agt',
  'persist']`. El preflight de §3.3 no es una etapa nueva; se resuelve dentro de la etapa `ledger` ya
  existente, exactamente como el chequeo de coincidencia de identidad que ya vivía ahí.
- El sobre de retorno (`status`, `stages`, `job_id`, `preanalysis_run_id`, `error_code`) **no
  cambia** ni gana claves nuevas: un drenaje de churn legacy es indistinguible, desde el shape de la
  respuesta, de cualquier otro `stale_input` que el worker ya producía antes de este delta
  (`{status:'unavailable', stages:['claim','fetch_row','gate','ledger'], job_id, error_code:
  'stale_input'}`). No se introduce un contador equivalente a `satisfied_derived_only`: a diferencia
  del scan, que corre sobre un lote y agrega, el worker resuelve un job por invocación y el propio
  `error_code:'stale_input'` en la respuesta ya es la señal observable.
- Un fallo técnico del lookup de canónicos sigue el mismo camino que cualquier otro fallo de
  `runOnce()` con un job ya reclamado: `error_code:'persistence_failure'`, `failJob` se llama
  exactamente una vez, y si `failJob` también falla, `runOnce()` sigue devolviendo
  `{status:'unavailable', error_code:'persistence_failure'}` en vez de rechazar la promesa —
  comportamiento ya cubierto por la suite existente (`tests/agt002-radar-worker.test.mjs`, casos
  9c/9d) y no alterado por este delta.

### 4.3 `agt002-radar-visibility.js` (segunda ampliación, §3.4)

- `filterRadarRowsByCanonicalPreanalysis` no gana ni pierde parámetros: sigue recibiendo exactamente
  `canonicalByTenderId`, `alwaysVisibleTenderIds`, `computeSourceRowHash`, `policyVersion`,
  `contextVersion`, `nowIso`, `evaluateGate`, `enabled`. No hay inyección nueva de
  `isAgt002RadarDerivedDayOnlyChurn`: se importa directo de `agt002-radar-derived-day-churn.js`, igual
  que el scan y el worker importan `hasAgt002RadarDerivedDayShape`/`isAgt002RadarDerivedDayOnlyChurn`
  sin inyectarlos.
- El borde `AGT002_RADAR_VISIBILITY_LEDGER_UNAVAILABLE` (503) y su condición de disparo **no
  cambian**: un `evaluateGate`/`nowIso` roto o ausente sigue lanzando exactamente igual; este delta
  vive por completo antes de esa etapa, en la condición que decide si el canónico es hash-compatible.
- El shape de la fila devuelta **no cambia**: sigue siendo la fila original de `rows`, sin propiedades
  añadidas. Ningún caller (`server/index.js`, `api/[...path].js`) cambia su firma de llamada.

### 4.4 `scripts/agt002-radar-gate-historical-audit.mjs` (segunda ampliación, §3.4)

- `planAgt002RadarGateAudit` no gana ni pierde parámetros de entrada (`tenders`, `nowIso`,
  `canonicalPreanalysisByTenderId`, `policyVersion`, `contextVersion`) ni claves nuevas en el reporte:
  `canonical_breakdown` conserva exactamente sus ocho claves (`missing`, `stale_hash`, `stale_policy`,
  `stale_context`, `fresh_mostrar_en_radar`, `no_mostrar_en_radar`, `no_concluyente`,
  `invalid_verdict`); no se añade una novena categoría para el caso derivado-solo porque, una vez
  demostrado hash-compatible, es indistinguible de un canónico exacto para el resto del pipeline de
  categorización.
- `ready_for_visibility_flag` y `uncovered_visible_tenders` siguen siendo una función pura de
  `canonical_breakdown`: `uncovered` es exactamente lo que no cae en
  `{fresh_mostrar_en_radar, no_mostrar_en_radar, no_concluyente}`, sin cambios en esa regla.
- Sigue siendo un script de sólo lectura: no gana ninguna llamada de escritura, no acepta `--apply`, y
  las invariantes ya cubiertas por `tests/agt002-radar-no-conversion-authority.test.mjs`
  (`READ_ONLY_REPORT_FILES`) no cambian.

## 5. Riesgos residuales

- **Falso negativo de reanálisis.** Si la fuente cambiara algo material **y** ese cambio produjera
  exactamente el mismo hash que una variante histórica de `days`/`window`, se saltaría el
  reanálisis. Requiere una colisión de sha256: descartable.
- **Deriva no cubierta.** Si el recolector externo empezara a recalcular un tercer campo derivado, el
  hotfix dejaría de aplicar y volvería el churn — de forma **visible**: `satisfied_derived_only`
  caería a 0 y `enqueued` subiría. Es el indicador a vigilar post-deploy.
- **Canónicas de más de 60 días.** Se reanalizan. Es el comportamiento previo, no una regresión.
- **Sigue siendo un parche.** La corrección de fondo es excluir los derivados del reloj de la
  proyección de identidad (o dejar de escribirlos en `raw`), lo que exige versionar política/contexto
  y reescribir canónicos. Queda fuera de alcance y se decide con evidencia post-deploy.
- **(Ampliación) Job legacy que además cambió de fila entre encolado y reactivación.** El preflight
  de §3.3 sólo se alcanza si la fila vigente **coincide exactamente** con lo congelado en el job (el
  chequeo de identidad que ya vivía antes de §3.3 sigue siendo la primera puerta). Si un job de
  churn además quedó obsoleto por otro motivo mientras esperaba en cola, ya se resuelve como
  `stale_input` por el camino existente, sin llegar siquiera a consultar el canónico — incluido en
  el mismo resultado observable, sin distinción.
- **(Ampliación) Orden de reclamación no gobernable por id.** El worker sigue reclamando el `queued`
  más antiguo; si un job de novedad real quedó encolado antes que uno de churn, se modela primero
  como corresponde. Este hotfix no reordena la cola ni necesita hacerlo: cada job se decide de forma
  independiente en el momento en que se reclama.

### 3.4 Lectura del Radar y auditoría histórica: mismo clasificador, sin cambiar la identidad de hash

§3 y §3.3 evitan que la deriva de `raw.days`/`raw.window` genere trabajo **nuevo** (encolado, modelado).
Pero un positivo canónico ya escrito congela su `source_row_hash` del día en que se generó, y dos
lectores de sólo lectura comparaban ese hash contra la fila de **hoy** con igualdad estricta, sin
conocer el filtro de §3:

- `filterRadarRowsByCanonicalPreanalysis` (`agt002-radar-visibility.js:41`), el filtro que decide qué
  licitaciones se muestran en el Radar (`server/index.js`, `api/[...path].js`) cuando
  `AGT002_RADAR_VISIBILITY=true`.
- `planAgt002RadarGateAudit` (`scripts/agt002-radar-gate-historical-audit.mjs:106`), el script de
  auditoría de sólo lectura que reporta `canonical_breakdown`/`uncovered_visible_tenders`.

Sin el filtro, un positivo canónico vigente —gate actual sobreviviente, `policy_version`/
`context_version` al día, `visibility_verdict: 'mostrar_en_radar'`— desaparecía del Radar el primer
día que el recolector reescribía `raw.days`/`raw.window` sin reanalizarse (porque §3 ya lo impidió), y
el mismo caso se contaba como `stale_hash`/`uncovered_visible_tenders` en la auditoría: dos lecturas
contradiciendo directamente lo que el propio hotfix documenta como no-reanalizable.

**Corrección, en ambos lectores por igual:** se reutiliza `isAgt002RadarDerivedDayOnlyChurn`
(`agt002-radar-derived-day-churn.js`), la misma función pura que ya usan el scan y el worker — sin
copiar su algoritmo. Un candidato con `visibility_verdict`/`policy_version`/`context_version`
correctos (ese chequeo **no** cambia y sigue siendo el primer filtro) se considera hash-compatible si:

1. `source_row_hash` coincide exactamente con el de la fila de hoy (el camino que ya existía), **o**
2. `isAgt002RadarDerivedDayOnlyChurn(row, canonical, { policyVersion, contextVersion })` es `true` — el
   canónico se reproduce cambiando únicamente `raw.days`/`raw.window` a una variante histórica válida.

Cualquier otra diferencia — material, `policy_version`/`context_version` distintos (el helper ya
exige que coincidan con los vigentes; una política/contexto atrasados nunca se "cuelan" como
hash-compatibles por esta vía), forma de `raw` inválida, canónico ausente o envenenado por duplicado,
offset fuera del techo declarado (§3.1) — sigue cerrando el camino exactamente igual que antes de esta
ampliación: oculto en `agt002-radar-visibility.js`, `stale_hash`/`uncovered` en la auditoría.

En `agt002-radar-visibility.js` esto **no** cambia la reevaluación del gate en lectura (§ el propio
archivo, "un positivo canónico sigue siendo una foto de cuando se produjo"): vencido o eliminado sigue
oculto, y `alwaysVisibleTenderIds` (las convertidas) conserva exactamente su precedencia — se resuelve
antes de mirar el canónico y nunca se ve afectado por este cambio. En
`scripts/agt002-radar-gate-historical-audit.mjs` esto tampoco cambia la precedencia de categorías: si
el hash coincide exactamente pero `policy_version`/`context_version` quedaron atrás, la categoría
sigue siendo `stale_policy`/`stale_context` como hoy — el helper sólo amplía qué cuenta como "el hash
coincide", nunca reordena las comprobaciones que vienen después.

## 6. Reversión

Revertir el commit (o los dos commits, si la segunda ampliación de §3.4 quedó en un commit separado).
No hay migración, ni backfill, ni estado nuevo que deshacer: el filtro es puro y no escribe nada. Un
`git revert` devuelve exactamente el comportamiento de encolado y de drenaje anterior
(`agt002-radar-scan.js` vuelve a encolar todo el churn; `agt002-radar-worker.js` vuelve a modelar los
jobs legacy que coincidan exactamente con la fila vigente) y, para la segunda ampliación,
`agt002-radar-visibility.js` vuelve a exigir igualdad exacta de `source_row_hash` (una fila derivada-
solo vuelve a ocultarse el día siguiente al rollover) y
`scripts/agt002-radar-gate-historical-audit.mjs` vuelve a clasificar ese mismo caso como `stale_hash`.
