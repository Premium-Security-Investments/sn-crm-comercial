# Especificación — AGT-002 Radar: gate determinístico, preanálisis y aprendizaje gobernado

**Fecha:** 2026-08-25
**Repositorio:** `Premium-Security-Investments/sn-crm-comercial`
**Commit inspeccionado:** `b2ebb80`
**Naturaleza:** diseño y especificación técnica. Este documento no implementa código, no modifica datos ni configuración, no ejecuta migraciones y no despliega producción.
**Plan asociado:** `docs/superpowers/plans/2026-08-25-agt002-radar-learning-implementation.md`

> **Convención de evidencia:** **[EXISTE]** significa verificado en el código o DDL del commit `b2ebb80`; **[PROPUESTO]** significa diseño aún no implementado.

---

## 1. Propósito

Hoy el Radar de Licitaciones muestra el resultado crudo de la ingesta multifuente filtrado por heurísticas de relevancia embebidas en el backend. El encargado de Licitaciones debe leer manualmente ruido que es mecánicamente descartable (procesos cancelados, fechas vencidas, contratación directa, contextos que no son vigilancia y seguridad privada), y no dispone de un preanálisis atribuible por proceso antes de decidir si abre el expediente.

Este diseño introduce, sin tocar la autoridad humana:

1. la ingesta cruda continúa exactamente como hoy;
2. un **gate determinístico fail-closed** que elimina de la superficie visible los procesos mecánicamente descartables, dejando evidencia por regla;
3. un **preanálisis estructurado AGT-002** para los sobrevivientes, previo a su visibilidad;
4. un **ledger append-only por licitación**, con promoción canónica e idempotencia;
5. una **cola durable con reserva** (`queued → running → completed|unavailable`) y un **entrypoint real, apagado por defecto**, que encadena de extremo a extremo `fetch → gate → ledger → claim durable → aprendizaje → AGT-002 → persistencia`;
6. un **flag de rollout apagado por defecto** que impide vaciar el Radar antes del backfill;
7. **aprendizaje como retrieval gobernado y específico del candidato** sobre datos ya existentes: para *esta* licitación se recuperan a lo sumo `maxSignals` precedentes comparables, cada uno con la evidencia de por qué es comparable, y entran a la cadena como contexto versionado que nunca muta reglas automáticamente;
8. una **visibilidad con frescura exigida**: una licitación se muestra sólo si su preanálisis canónico corresponde a la fila tal como se está leyendo ahora y a la política y el contexto vigentes; un preanálisis que quedó rezagado oculta igual que su ausencia.

El punto 5 es lo que separa este alcance de un conjunto de módulos inertes: la cadena existe como **un** proceso ejecutable real, con su unidad `systemd` y su cola durable, no como una colección de piezas que alguien debería pegar después. Y existe **apagada**: sin `AGT002_RADAR_GATE` encendido el entrypoint es un no-op verificable —cero lecturas, cero escrituras, cero llamadas al proveedor— y la unidad se entrega instalable pero **no habilitada**.

## 2. Autoridad y límites indelegables

El contexto aprobado por Juan Botero fija estos límites, que son invariantes de diseño, no preferencias:

- Radar **ingiere y muestra** licitaciones en el CRM.
- **Sólo el encargado de Licitaciones convierte manualmente** una licitación en Oportunidad.
- AGT-002 **jamás** crea filas en `psi_sales_opportunities`.
- AGT-002 **jamás** invoca `psi_convert_tender_to_opportunity` ni `POST /api/tender-convert`.
- AGT-002 **jamás** escribe `psi_public_tenders.converted_opportunity_id` ni `internal_status = 'convertida_oportunidad'` (ni ningún otro valor de `internal_status`).
- AGT-002 **jamás** decide GO/NO-GO.
- **No hay cambios visuales**: no se modifica ningún archivo bajo `src/`.

Estos límites son coherentes con la carta ya vigente **[EXISTE]** en `supabase/migrations/030_agt002_radar_priority.sql`: *"the automated score may prioritize, never decide that a process is discarded"*, y con `docs/architecture/agt002-reusable-licitacion-architecture.md` §5: *"El registry no convierte oportunidades ni decide qué licitación analizar."*

**Dónde encaja el veredicto `no_mostrar_en_radar` (§7.2, §8.3).** El preanálisis puede concluir que un proceso no se muestra en la superficie del Radar. Eso **no** es un descarte y no contradice la carta de `030`: no escribe `internal_status`, no toca la fila, no es irreversible y no decide GO/NO-GO. Es una conclusión sobre presentación, reversible por la siguiente corrida, sostenida en evidencia citada y marcada `human_review_required = true` sin excepción. El descarte sigue siendo un acto humano que escribe `internal_status = 'descartada'`, y ningún artefacto de este alcance tiene esa capacidad ni el `grant` para ejercerla.

## 3. Estado actual verificado

### 3.1 Ingesta y persistencia del Radar

**[EXISTE]** `persistTenderRadar` (`server/index.js:1596`) obtiene el radar multifuente, hace `upsert` sobre `psi_public_tenders` por `stable_key` (`defaultToNull: false`, es decir, sin pisar columnas ausentes) e inserta una corrida en `psi_tender_radar_runs`. La ingesta es un `upsert` crudo: no elimina filas ni evalúa relevancia al escribir.

**[EXISTE]** `psi_public_tenders` (`supabase/migrations/005_public_tenders_radar.sql`) tiene `id uuid` como clave primaria, `stable_key text unique`, `internal_status` con dominio `('nueva','en_revision','descartada','convertida_oportunidad')`, `converted_opportunity_id`, `raw jsonb` y `section` con dominio `('hacer','revisar','prioridad_baja')` tras `030`.

### 3.2 Lectura del Radar

**[EXISTE]** `readPersistedTenderRadar` (`server/index.js:1548`):

1. lee la última corrida de `psi_tender_radar_runs` y usa su `run_at` como corte;
2. lee hasta 250 filas de `psi_public_tenders` ordenadas por `last_seen_at desc`, con `or(last_seen_at.gte.<corte>, deadline_at.gte.<hoy UTC>)`;
3. lee **aparte y sin límite** todas las convertidas (`readAllConvertedTenderRows`, `.eq('internal_status','convertida_oportunidad')`, paginado de 1000);
4. fusiona ambos conjuntos por `stable_key`;
5. filtra con `isConvertedTenderRecord(row) || isTenderTrackable(row)`;
6. mapea con `dbTenderToPublic` (que **descarta el uuid**: el `id` de salida pasa a ser `stable_key`);
7. vuelve a filtrar `isConvertedTenderRecord(t) || !['SECOP I','SECOP II'].includes(t.source) || hasTenderServiceSignal(t)`;
8. ordena por estado interno, sección y score, y arma `radarPayload`.

**[EXISTE]** `tests/tender-radar-converted-visible.test.mjs` protege con aserciones sobre el texto fuente que las convertidas históricas permanezcan visibles aunque su proceso público esté en estado terminal y aunque queden fuera de la ventana de 250 filas activas.

### 3.3 Heurísticas de relevancia hoy vigentes

**[EXISTE]** `isTenderTrackable` (`server/index.js:1056`) combina cuatro listas literales declaradas en el mismo archivo: `tenderNonSecurityContextTerms`, `tenderNonCommercialActTerms`, `tenderDisqualifyingTerms` y el estado oficial vía `isTenderTrackableStatus`.

**[EXISTE]** `tender-source-status.js` concentra la semántica de estado terminal (`isTenderTerminalStatus`, `tenderStatusSearchText`, `officialTenderStatus`) y **[EXISTE]** `supabase/migrations/031_tender_terminal_status_guard.sql` replica esa semántica en SQL (`psi_is_tender_terminal_status`) para bloquear la conversión de procesos cancelados/revocados/desiertos.

No existe hoy ninguna regla de **contratación directa** ni ninguna regla de **fecha no verificable** en la superficie del Radar. `tenderDeadlineBucket`/`isTenderExpired` **[EXISTE]** en `src/tenders/radarUtils.ts` (frontend, zona `America/Bogota`), y `tenderDaysUntil` **[EXISTE]** en `server/index.js:1064` (backend, zona local del proceso). Son implementaciones distintas de la misma pregunta.

### 3.4 Ledger canónico ya existente y su llave

**[EXISTE]** `psi_tender_analysis_runs` es append-only desde `025`, con `canonical` desde `050` y **promoción canónica real** desde `063`: índice único parcial `(opportunity_id) where canonical and status='completed'`, `supersedes_run_id`, y una única transición `canonical true -> false` autorizada por el trigger de inmutabilidad comparando `to_jsonb(old) - 'canonical' = to_jsonb(new) - 'canonical'`.

**[EXISTE]** `psi_agt002_analysis_attempt_events` (`050`) es un ledger append-only de intentos con máquina de estados `queued → running → completed|retry_wait|needs_attention|unavailable` y reingreso a `queued`.

**Limitación decisiva:** `psi_tender_analysis_runs.opportunity_id` es `not null` y referencia `psi_sales_opportunities`. Una licitación **no convertida no tiene oportunidad**. Reutilizar esa tabla obligaría a crear una oportunidad, que es exactamente lo prohibido.

### 3.5 Flags y runtime AGT-002

**[EXISTE]** `agt002-analysis-config.js` define el patrón canónico de flags: lista congelada `ANALYSIS_FLAG_NAMES`, sólo `'true'`/`'1'` (case-insensitive, con `trim`) activan, cualquier otro valor —incluido ausente o malformado— queda apagado, y las dependencias entre flags **lanzan** en lugar de degradar en silencio.

**[EXISTE]** `agt002-preview-runtime.js` define el patrón de runtime: validación de configuración, códigos de frontera (`withRuntimeBoundaryCode`), construcción del cliente puente vía `createAgt002HetznerBridgeClient`, timeouts, concurrencia y cupo diario. **[EXISTE]** `agt002-hetzner-bridge-client.js` firma HMAC, acota la respuesta a 262.144 bytes y exige `input`/`outputSchema` cerrados.

**[EXISTE]** `agt002-reanalysis-worker.js` define el patrón de worker durable: un solo job por invocación, `claim → execute → complete|fail`, clasificación de error acotada a un dominio cerrado, sin reintentos internos.

**[EXISTE]** `supabase/migrations/068_agt002_reanalysis_jobs.sql` define el patrón completo de **cola durable con reserva**, que este alcance copia en técnica:

- tabla con `status in ('queued','running','completed','unavailable')`, `lease_id`, `lease_expires_at`, `error_code` acotado a los seis códigos cerrados, `started_at`/`completed_at`/`updated_at`;
- `constraint … lease_all_or_none` (`lease_id` y `lease_expires_at` van juntos o no van) y `constraint … terminal_shape` (qué columnas pueden estar pobladas en cada estado);
- índice único parcial de **un solo job activo** por sujeto `where status in ('queued','running')`, más un índice `claimable` parcial `where status = 'queued' and lease_id is null`;
- trigger `before update` que hace inmutable la identidad y el insumo congelado del job;
- cuatro RPC `security definer`: `psi_create_agt002_reanalysis_job` (idempotente, reusa el job activo y lanza `55000` si la clave choca con otra identidad), `psi_claim_agt002_reanalysis_job(p_lease_seconds)` —que **antes** de reclamar cierra como `lease_lost` toda fila `running` con reserva vencida, acota los segundos a `[1, 600]` y selecciona `for update skip locked limit 1`—, `psi_complete_agt002_reanalysis_job(p_job_id, p_lease_id, p_analysis_run_id)` —que exige reserva vigente y una corrida canónica **ya existente** del mismo sujeto, y nunca escribe el ledger él mismo— y `psi_fail_agt002_reanalysis_job(p_job_id, p_lease_id, p_error_code)` —que no acepta texto crudo del proveedor: deriva el mensaje de una tabla `case` cerrada—.

**[EXISTE]** `agt002-reanalysis-jobs.js` es el envoltorio JS de esos cuatro RPC (`database.rpc`, sin `select`/`insert` directos), y **[EXISTE]** `ops/agt002-reanalysis-worker/` es el patrón de **entrypoint real**: `run-agt002-reanalysis-worker.mjs` (una sola `runOnce()`, sin `setInterval`, sin `fetch` propio), `agt002-reanalysis-worker.service` (`Type=oneshot`, `EnvironmentFile=`, `NoNewPrivileges`, `ProtectSystem`, `RestrictAddressFamilies`), `agt002-reanalysis-worker.timer`, `env.example` y `README.md`. **[EXISTE]** `tests/agt002-reanalysis-worker-systemd.test.mjs` verifica esa forma archivo por archivo.

**[EXISTE]** `agt002-governance-draft-proposal.js` define el patrón de **aprendizaje que no muta reglas**: produce un artefacto `DRAFT` deliberadamente incompatible con la forma curada, de modo que *no puede* alimentarse directamente al runtime; un humano debe leerlo y re-autorizar filas curadas.

### 3.6 Restricciones operativas del repositorio

**[EXISTE]** `npm run check:backend-parity` (`scripts/check_backend_parity.mjs`) exige que `server/index.js` y `api/[...path].js` sean **byte-idénticos**.
**[EXISTE]** `npm run build` = `check:deployment-safety && tsc && vite build`.
**[EXISTE]** Las pruebas de integración usan PGlite (`@electric-sql/pglite`) cargando el SQL real de la migración tras retirar `begin;`/`commit;` (patrón `strip` en `tests/agt002-canonical-promotion-pglite.integration.test.mjs`).
**[EXISTE]** `contracts/agents/AGT-002/v1/manifest.json` declara `"immutable": true`.
**[EXISTE]** La última migración aplicada en el árbol es `070_agt002_workbench_job_status.sql`. Las siguientes libres son `071` y `072`.

### 3.7 Referencia de producción

`CURRENT.md` §13.1 registra un merge histórico en `main` (`a6cf4a6…`) y un deployment Vercel `dpl_Dp7TAssBg2nPZymHTd6ercfEjCr3`. Ese registro es del **2026-08-21** y no autoriza asumir que el commit desplegado hoy sea `origin/main`. `CURRENT.md` §7.9 lo dice explícitamente: *"Producción sigue referenciada en `7ad7b91` y no coincide con `main`; queda prohibido desplegar `main` a ciegas."*

**Regla de diseño:** ninguna migración, backfill o cambio de flag de este alcance puede ejecutarse contra producción sin **reconfirmar primero** el commit efectivamente desplegado contra el deployment vivo. No se asume `producción = origin/main`.

## 4. No-alcance

- No se crea ninguna fila en `psi_sales_opportunities`.
- No se llama `psi_convert_tender_to_opportunity`, `POST /api/tender-convert` ni ninguna ruta de conversión.
- No se escribe `psi_public_tenders.internal_status` ni `converted_opportunity_id` desde ningún artefacto de este alcance.
- No se emite, insinúa ni persiste ninguna recomendación GO/NO-GO.
- No se modifica ningún archivo bajo `src/`; no hay cambios de componentes, estilos, textos ni layout.
- No se borra ni se archiva ninguna fila de `psi_public_tenders`; la ingesta cruda permanece intacta.
- No se altera el dominio de `internal_status`, de `section`, ni las políticas RLS de `psi_public_tenders`.
- No se relaja la inmutabilidad de `psi_tender_analysis_runs` ni sus invariantes de `063`.
- No se extiende `contracts/agents/AGT-002/v1/manifest.json` (declara `immutable: true`).
- No se despliega, no se hace commit a `main`, no se ejecutan migraciones en producción ni se cambian flags productivos dentro de este alcance.
- No se instala, habilita ni arranca ninguna unidad `systemd`: los archivos `.service`/`.timer` del entrypoint se crean en el repositorio y nada más. Ninguna tarea ejecuta `systemctl`.
- No se ejecuta el entrypoint contra producción, ni con los flags encendidos, dentro de este alcance.
- El aprendizaje no modifica automáticamente ninguna regla, umbral, peso ni política.

## 5. Alternativas descartadas

| # | Alternativa | Por qué se descarta |
|---|---|---|
| A1 | Que el gate marque `internal_status='descartada'` sobre las filas eliminadas | Usurpa la autoridad humana de descarte, contradice la carta de `030`, destruye la ingesta cruda y es irreversible sin un backfill inverso. El descarte humano debe seguir siendo el único que escriba `internal_status`. |
| A2 | Reutilizar `psi_tender_analysis_runs` para el preanálisis de Radar | `opportunity_id` es `not null` y referencia `psi_sales_opportunities`: exigiría crear la oportunidad, que es precisamente lo prohibido. |
| A3 | Filtrar en el frontend (`src/tenders/radarUtils.ts::filterRadarTenders`) | Viola "sin cambios visuales", duplica la política en TypeScript, y un filtro de gobernanza evaluado en el navegador es evitable por el cliente. |
| A4 | Filtrar al escribir, dentro de `persistTenderRadar` | Rompe el requisito (1): la ingesta cruda dejaría de ser cruda, se perdería la trazabilidad de lo eliminado y una regla equivocada sería irrecuperable. El gate debe ser capa de derivación y lectura, nunca de escritura sobre la fuente. |
| A5 | Un solo flag que produzca preanálisis y cambie la visibilidad a la vez | Imposibilita el backfill: al encender, el Radar se vaciaría hasta que todas las filas tuvieran preanálisis canónico. Se requieren dos flags con dependencia explícita. |
| A6 | Aprendizaje que ajuste automáticamente reglas, pesos o umbrales del gate | Las reglas derivarían sin curaduría humana. Además, GO es señal y no verdad universal; NO-GO y `no_adjudicada` tienen causas comerciales, presupuestales o de oportunidad ajenas a la elegibilidad del proceso. |
| A7 | Declarar el sobre del preanálisis en `contracts/agents/AGT-002/v1/` | El manifiesto v1 declara `"immutable": true`. El sobre se valida con un módulo JS de forma cerrada, siguiendo `agt002-tender-adapter.js` y `agt002-integral-analysis-v3.js`. |
| A8 | Tabla auxiliar mutable con un puntero "preanálisis vigente" | `063` ya estableció el patrón mecánicamente superior: índice único parcial + degradación in-place `canonical true → false` + `supersedes_run_id`. Un puntero mutable reintroduce el modo de falla que `063` eliminó. |
| A9 | Un único documento de diseño + dos planes (gate primero, aprendizaje después) | El entregable visible —un Radar que sólo muestra procesos con preanálisis canónico— depende de la cadena completa: gate, preanálisis, ledger, flag y backfill. Partirlo produce dos mitades no verificables por separado. Se mantiene **un solo plan coherente**. |
| A10 | Entregar los módulos sin entrypoint, y "pegarlos" en una orden posterior | Produce un alcance que pasa sus pruebas unitarias y no ejecuta nada: nadie descubre hasta el día del backfill que el orden real —gate antes de encolar, aprendizaje después del claim, persistencia antes de cerrar el job— no estaba verificado. La cadena se entrega **ejecutable**, y el riesgo se controla apagándola, no dejándola sin construir. |
| A11 | Cola en memoria dentro del proceso, o iterar todos los sobrevivientes en un bucle | Un proceso que muere a mitad de una llamada al proveedor pierde el trabajo sin dejar rastro, y un bucle sobre toda la página convierte un fallo en pérdida de toda la corrida y hace ilimitado el costo por invocación. La cola durable con reserva de `068` **[EXISTE]** ya resuelve exactamente esto: un job por invocación, reserva vencida ⇒ `lease_lost` terminal. |
| A12 | Encolar congelando también las señales de aprendizaje (como el `frozen_engine_input` de `068`) | Las señales son retrieval sobre datos que cambian; congelarlas en el encolado atribuiría corridas a señales inexistentes al momento de ejecutar. Se congela la identidad de la evidencia (`gate_evaluation_id` + `source_row_hash` + versiones) y se persiste `learning_signals_version` al ejecutar. |
| A13 | Encender el entrypoint (habilitar el `timer`) dentro de este alcance | El flag y el temporizador son dos autorizaciones distintas. Habilitar el `timer` con el flag apagado no hace nada, pero deja instalado un disparador que un cambio de variable de entorno convierte en gasto real contra el proveedor sin revisión. Instalar y habilitar es una orden separada, posterior a la auditoría del §13. |
| A14 | Derivar las señales una vez por corrida y repartir el mismo conjunto a todos los jobs | Es aprendizaje **global**: al candidato se le entregan precedentes que no tienen ninguna relación verificable con él, y la corrida queda atribuida a un contexto que no explica nada de *esta* licitación. Un preanálisis que cita un precedente ajeno es peor que uno sin señales, porque parece fundado. El retrieval se ejecuta **por candidato** (§8.8) y cada señal debe declarar en qué dimensiones coincide con él. La proyección —que es la lectura cara— sigue siendo una por corrida. |
| A15 | Guardia de vocabulario GO/NO-GO por búsqueda de subcadena | `indexOf('go')` prohíbe `riesgo`, `catálogo`, `negociación`, `código`, `pliego` y `Bogotá`: convierte en error de contrato el vocabulario normal de una licitación, y el modo de falla es un preanálisis válido rechazado en producción. La guardia opera sobre **límites de token y de frase** (§8.3), que es lo que efectivamente distingue la palabra `go` de la sílaba `go`. |
| A16 | Visibilidad por mera existencia de canónica `mostrar_en_radar`, sin comparar contra la fila actual | Un preanálisis atribuible a una fila que ya cambió —nuevo `deadline_at`, nuevo estado oficial, nueva `raw`— sostendría la superficie con evidencia caduca, y un cambio de política no tendría efecto observable hasta el redrenado. La visibilidad exige el mismo triple (`source_row_hash`, `policy_version`, `context_version`) que el corto circuito de encolado usa para decidir que no hay que reprocesar (§8.7): una sola definición de "vigente", en los dos extremos de la cadena. |

## 6. Arquitectura objetivo

```text
Fuentes oficiales (SECOP I/II, TVEC, ESU)
  │
  ▼
persistTenderRadar  ──►  psi_public_tenders          [SIN CAMBIOS: ingesta cruda]
                             ▲
                             │ (sólo lectura)
═════════════════════════════╪═══════════════════════════════════════════════════════
 ENTRYPOINT REAL, APAGADO POR DEFECTO                                    [PROPUESTO]
 ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs  (systemd oneshot + timer)
 agt002-radar-pipeline.js :: runOnce()
   AGT002_RADAR_GATE apagado ⇒ { status: 'disabled' } y termina: 0 lecturas, 0
   escrituras, 0 llamadas al proveedor. La unidad se entrega NO habilitada.
═════════════════════════════╪═══════════════════════════════════════════════════════
                             │
  (1) fetch ─────────────────┘  página de psi_public_tenders, sin escribir nada
                             │
                             ▼
  (2) gate      ┌──────────────────────────────────────┐
                │ Gate determinístico fail-closed      │  agt002-radar-gate.js
                │  estado_terminal                     │  un solo nowIso por corrida
                │  fecha_vencida / fecha_no_verificable│
                │  contratacion_directa                │
                │  contexto_no_seguridad               │
                └───────────┬──────────────┬───────────┘
                            │ eliminada    │ sobreviviente
                            ▼              ▼
  (3) ledger    psi_agt002_radar_gate_evaluations (append-only, 071)
                                           │  (idempotente por source_row_hash)
                                           ▼
  (4) cola      psi_agt002_radar_preanalysis_jobs (durable, 072)
                enqueue ──► queued ──► claim(lease) ──► running
                                           │   una reserva, un job por invocación
                                           ▼
  (5) aprendizaje   agt002-radar-learning-projection.js  (sólo lectura, 4 fuentes)
                    │   observations: una proyección por corrida
                    ▼
                    agt002-radar-learning-retrieval.js
                    │   retrieval POR CANDIDATO: (candidate, observations, maxSignals)
                    │   similitud auditable: servicio/objeto · entidad · modalidad
                    │                        · fuente · territorio
                    │   orden determinista + desempate total ──► top-K acotado
                                           │  entran SÓLO como contexto de entrada
                                           ▼
  (6) AGT-002   ┌──────────────────────────────┐
                │ Preanálisis AGT-002          │  puente Hetzner (existente)
                │ entrada cerrada + señales    │  agt002-radar-preanalysis-*.js
                │ validación de sobre cerrado  │
                └──────────────┬───────────────┘
                               ▼
  (7) persistencia
      psi_agt002_radar_preanalysis_runs (append-only + promoción canónica, 072)
      psi_agt002_radar_preanalysis_attempt_events (append-only, 072)
                               │
                               ▼
      complete(job, lease, run) │ fail(job, lease, error_code)   ← única transición
                               │                                   terminal del job
                               ▼
              readPersistedTenderRadar ──► filtro de visibilidad con FRESCURA
                                            (sólo si AGT002_RADAR_VISIBILITY)
                                            muestra ⇔ canónica vigente
                                              ∧ verdict = mostrar_en_radar
                                              ∧ run.source_row_hash == hash(fila leída)
                                              ∧ policy_version/context_version vigentes
                                            (convertidas: visibles siempre)
                                         │
                                         ▼
                                  GET /api/tenders   [payload de forma idéntica]

Aprendizaje (retrieval gobernado, sólo lectura) — una proyección, dos consumidores:
  psi_public_tenders (conversión manual)
  psi_tender_analysis_runs (canónico)
  psi_tender_go_no_go_decisions (GO/NO-GO humano)
  psi_sales_opportunities.tender_offer_status + psi_tender_offer_status_transitions
        │
        ▼
  agt002-radar-learning-projection.js ──► observaciones proyectadas (sólo GET)
        │                                  una por corrida; NO son señales
        ├──► agt002-radar-learning-retrieval.js (candidate, observations, maxSignals)
        │         top-K acotado, específico del candidato, con evidencia y versión
        │         ──► paso (5) de la cadena: contexto del preanálisis
        │
        └──► agt002-radar-learning-proposals.js ──► artefacto DRAFT (agregados
                  globales permitidos AQUÍ y sólo aquí) para curaduría humana
                  (NUNCA se aplica automáticamente, NUNCA entra al preanálisis)
```

## 7. Esquema de datos

### 7.1 Migración `071_agt002_radar_gate.sql` [PROPUESTO]

```sql
create table public.psi_agt002_radar_gate_evaluations (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  stable_key text not null check (nullif(btrim(stable_key), '') is not null),
  verdict text not null check (verdict in ('eliminada', 'sobreviviente')),
  rule_ids text[] not null default '{}',
  reasons jsonb not null,
  data_gaps jsonb not null default '[]'::jsonb,
  policy_version text not null check (nullif(btrim(policy_version), '') is not null),
  context_version text not null check (nullif(btrim(context_version), '') is not null),
  source_row_hash text not null check (source_row_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null unique check (nullif(btrim(idempotency_key), '') is not null),
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint psi_agt002_radar_gate_evaluations_verdict_rules_check check (
    (verdict = 'eliminada'     and coalesce(array_length(rule_ids, 1), 0) >= 1 and jsonb_array_length(reasons) >= 1)
    or
    (verdict = 'sobreviviente' and coalesce(array_length(rule_ids, 1), 0) = 0)
  ),
  constraint psi_agt002_radar_gate_evaluations_reasons_shape_check check (jsonb_typeof(reasons) = 'array'),
  constraint psi_agt002_radar_gate_evaluations_gaps_shape_check check (jsonb_typeof(data_gaps) = 'array')
);
```

- Índices: `(tender_id, evaluated_at desc, id desc)` y `(verdict, evaluated_at desc)`.
- Trigger `before update or delete` que **siempre** lanza (append-only estricto, sin excepciones — a diferencia de `072`, aquí no hay promoción canónica que exceptuar).
- `enable row level security`; `revoke all` a `public, authenticated, anon, service_role`; `grant select` sólo a `service_role`.
- RPC `psi_record_agt002_radar_gate_evaluation(...)` `security definer`, `set search_path = public, pg_temp`, con corto circuito de idempotencia **antes** de cualquier escritura y `23505` ante payload en conflicto bajo la misma clave. `revoke all` + `grant execute` sólo a `service_role`.
- Rollback: `supabase/rollbacks/071_agt002_radar_gate_rollback.sql`, que retira RPC, trigger y tabla, sin tocar `psi_public_tenders`.

**Forma exigida de `reasons[]`** (validada dentro del RPC, no sólo por la aplicación): cada elemento es un objeto con exactamente `rule_id`, `field`, `observed_value`, `source`, `policy_version`, `context_version`. Un elemento sin `field`/`observed_value`/`source` no verificable hace fallar el RPC con `22023`. Esto materializa el requisito (7): **toda razón lleva evidencia y versión**.

### 7.2 Migración `072_agt002_radar_preanalysis_ledger.sql` [PROPUESTO]

```sql
create table public.psi_agt002_radar_preanalysis_runs (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  gate_evaluation_id uuid not null references public.psi_agt002_radar_gate_evaluations(id) on delete restrict,
  producer text not null check (producer = 'AGT-002'),
  method text not null check (method = 'agent_ai'),
  status text not null check (status in ('completed', 'abstained')),
  visibility_verdict text not null check (visibility_verdict in ('mostrar_en_radar', 'no_mostrar_en_radar', 'no_concluyente')),
  result jsonb not null,
  evidence jsonb not null,
  policy_version text not null,
  context_version text not null,
  source_row_hash text not null check (source_row_hash ~ '^[0-9a-f]{64}$'),
  learning_signals_version text,
  learning_signals_count integer not null default 0 check (learning_signals_count >= 0),
  model text,
  usage jsonb,
  canonical boolean not null default false,
  supersedes_run_id uuid references public.psi_agt002_radar_preanalysis_runs(id) on delete restrict,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint psi_agt002_radar_preanalysis_runs_canonical_check
    check (not canonical or (producer = 'AGT-002' and method = 'agent_ai' and status in ('completed', 'abstained'))),
  constraint psi_agt002_radar_preanalysis_runs_verdict_status_check
    check ((status = 'completed' and visibility_verdict in ('mostrar_en_radar', 'no_mostrar_en_radar'))
        or (status = 'abstained' and visibility_verdict = 'no_concluyente')),
  constraint psi_agt002_radar_preanalysis_runs_human_review_check
    check ((result -> 'human_review_required') = 'true'::jsonb),
  constraint psi_agt002_radar_preanalysis_runs_evidence_check
    check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) >= 1),
  constraint psi_agt002_radar_preanalysis_runs_learning_shape_check
    check ((learning_signals_version is null and learning_signals_count = 0)
        or (learning_signals_version is not null and learning_signals_count >= 1))
);

create unique index psi_agt002_radar_preanalysis_one_canonical_idx
  on public.psi_agt002_radar_preanalysis_runs (tender_id)
  where canonical;
```

**Dominio de veredicto y su relación con el estado.** `visibility_verdict` tiene tres valores: `mostrar_en_radar`, `no_mostrar_en_radar` y `no_concluyente`. Una corrida `completed` es una conclusión y admite los dos veredictos conclusivos —mostrar y **no** mostrar—; una corrida `abstained` es la ausencia de conclusión y sólo admite `no_concluyente`. Las tres combinaciones restantes son imposibles por `check`, no por convención de la aplicación. `no_mostrar_en_radar` **no es un descarte**: no escribe `internal_status`, no archiva la fila y no impide que el encargado la vea por cualquier otra vía; sólo declara que este preanálisis no sostiene la presencia del proceso en la superficie del Radar, y la próxima corrida puede concluir lo contrario sin borrar nada.

**Canónica sobre cualquier resultado terminal.** `canonical` no distingue entre conclusión y abstención: marca **la corrida terminal vigente** de una licitación, sea `completed` (con cualquiera de los dos veredictos conclusivos) o `abstained`. Por eso el índice único parcial es `where canonical` a secas, sin `and status = 'completed'`. La razón es que "cuál fue el último resultado" debe tener una única respuesta siempre: si sólo las `completed` pudieran ser canónicas, una abstención posterior a una conclusión dejaría vigente una corrida que ya fue reemplazada, y el Radar mostraría un proceso apoyándose en un preanálisis que la corrida más reciente no confirmó. Toda corrida nueva —incluida una abstención y una `no_mostrar_en_radar`— degrada la canónica anterior y la referencia en `supersedes_run_id`: no existe camino por el que un resultado terminal quede sin superseder a su predecesor.

**Divergencia deliberada frente a `063`.** `psi_tender_analysis_runs` indexa `where canonical and status='completed'` **[EXISTE]**; aquí se indexa `where canonical`. Se copia de `063` la *técnica* —índice único parcial, degradación in-place con la excepción `to_jsonb(old) - 'canonical'`, `supersedes_run_id`— y no el predicado. Motivo: en `063` la abstención no compite por la vigencia porque el consumidor es un análisis de oportunidad ya convertida; aquí la canónica gobierna una **superficie visible**, y dejar vigente una corrida superada por una abstención posterior mostraría el Radar sobre evidencia que la última corrida no sostiene. El predicado más ancho es lo que hace que `canonical` signifique "el último resultado" en lugar de "el último resultado que dijo que sí".

**`source_row_hash` desnormalizado en la corrida, y por qué.** El hash de la fila observada ya vive en `psi_agt002_radar_gate_evaluations` (§7.1), pero el filtro de visibilidad (§8.7) tiene que decidir *por fila leída* si el preanálisis canónico sigue correspondiendo a lo que está mostrando, y hacerlo con un `join` por petición sobre dos tablas en el camino caliente de `GET /api/tenders` es exactamente el tipo de lectura que se degrada primero. La corrida guarda su propio `source_row_hash`, y el RPC **no lo recibe como parámetro**: lo copia de la evaluación de gate referenciada dentro de la misma sentencia de inserción. Al no existir parámetro no existe forma de que diverja del hash de su evidencia; la desnormalización no introduce una segunda verdad, sólo una segunda copia de la misma. Con `policy_version` y `context_version`, que ya estaban en la tabla, la lectura de visibilidad resuelve el triple de frescura consultando una sola tabla.

**`learning_signals_count` y la ausencia legítima.** `learning_signals_version` responde *qué versión de señales tuvo a la vista* la corrida; `learning_signals_count` responde *cuántas señales específicas del candidato entraron efectivamente a la entrada cerrada*. El `check` los ata: o hay versión y al menos una señal, o no hay ninguna de las dos. Esa segunda combinación —cero señales, versión nula— es el caso legítimo de un candidato sin precedente comparable (§8.8), y es distinguible en el ledger de una corrida hecha con señales sin necesidad de reconstruir el retrieval. Lo que el par hace imposible es persistir "usé la versión v1" sin que ninguna señal haya entrado, que es precisamente la forma en que un aprendizaje global se disfrazaría de aprendizaje específico.

**`human_review_required` es siempre `true`.** No es un campo que el proveedor module: es la afirmación permanente de que el preanálisis es insumo y nunca cierre. El `check` de la tabla exige el literal JSON `true`; el validador de sobre (§8.3) rechaza cualquier otro valor —incluidos `false`, `"true"`, `1` y la ausencia de la clave— como error de contrato. Un preanálisis que se declarara a sí mismo exento de revisión humana no puede persistirse.

- Trigger de inmutabilidad **con la única excepción de `063`**: se permite `canonical true → false` si y sólo si `(to_jsonb(old) - 'canonical') = (to_jsonb(new) - 'canonical')`. Cualquier otro `UPDATE`/`DELETE` lanza.
- `psi_agt002_radar_preanalysis_attempt_events`: espejo exacto de `psi_agt002_analysis_attempt_events` (`050`) pero con `tender_id` en lugar de `opportunity_id`/`snapshot_id`; misma máquina de estados `queued/running/completed/retry_wait/needs_attention/unavailable`, mismo `event_key unique`, mismo enlace obligatorio de `preanalysis_run_id` sólo en `completed`. Cuidado con la homonimia: el `completed` del evento de intento significa "el intento terminó habiendo persistido una corrida", y se asienta igual cuando esa corrida es `abstained` o `no_mostrar_en_radar`. El `status` de la corrida (§7.2) y el del evento de intento son dominios distintos y no se leen uno por el otro; lo que nunca produce evento `completed` es un fallo de ejecución, que va a `unavailable` con su código cerrado.
- RPC `psi_record_agt002_radar_preanalysis_run(...)`, `security definer`, en este orden estricto:
  1. validaciones de forma (`22023`), incluidos el par `status`/`visibility_verdict` del dominio de arriba y `result -> 'human_review_required' = 'true'::jsonb`;
  2. corto circuito por `idempotency_key` **antes de cualquier bloqueo o mutación**, con `23505` ante payload en conflicto;
  3. `select 1 from public.psi_public_tenders where id = p_tender_id for update` (serializa promociones concurrentes de la misma licitación) → `P0002` si no existe;
  4. verificación de que `gate_evaluation_id` pertenece al mismo `tender_id` y tiene `verdict='sobreviviente'` → `22023` si no; en la misma consulta se lee su `source_row_hash`, que es el que quedará escrito en la corrida (no hay parámetro para él), y se exige que `policy_version`/`context_version` de la corrida coincidan con los de esa evaluación → `22023` si no: una corrida no puede declararse de una política distinta a la de la evidencia que la sostiene;
  5. bloqueo y degradación in-place de la corrida canónica previa —cualquiera que sea su `status` y su `visibility_verdict`— a `canonical = false`, sin tocar ninguna otra columna;
  6. `insert` de la nueva corrida con `canonical = true`, `source_row_hash` copiado del paso 4 y `supersedes_run_id` apuntando a la degradada (nulo sólo en la primera corrida de esa licitación). El RPC no recibe `canonical` como parámetro: **toda** corrida terminal que asienta es la vigente, incluida una abstención y una `no_mostrar_en_radar`. No hay forma de persistir un resultado terminal que deje vigente al anterior.
- RPC `psi_append_agt002_radar_preanalysis_attempt(...)`: idéntico en estructura al de `050`.
- RLS activa; `revoke all` a todos; `grant select` sólo a `service_role`; `grant execute` de todos los RPC sólo a `service_role`.
- Rollback: `supabase/rollbacks/072_agt002_radar_preanalysis_ledger_rollback.sql`, que retira la cola, los dos ledgers y sus RPC, y **no toca `071`** ni `psi_public_tenders`.

**Cola durable, en la misma migración `072`.** El ledger dice *qué se concluyó*; la cola dice *qué falta por ejecutar y quién lo tiene reservado*. Sin ella no hay cadena real: un entrypoint sin reserva o reejecuta lo mismo en cada tick del temporizador, o pierde trabajo cuando el proceso muere a mitad de una llamada al proveedor. Se copia la técnica de `068` **[EXISTE]**, con `tender_id` como sujeto en lugar de `opportunity_id`:

```sql
create table public.psi_agt002_radar_preanalysis_jobs (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  gate_evaluation_id uuid not null references public.psi_agt002_radar_gate_evaluations(id) on delete restrict,
  source_row_hash text not null check (source_row_hash ~ '^[0-9a-f]{64}$'),
  policy_version text not null check (nullif(btrim(policy_version), '') is not null),
  context_version text not null check (nullif(btrim(context_version), '') is not null),
  attempt_key text not null check (nullif(btrim(attempt_key), '') is not null),
  idempotency_key text not null unique check (nullif(btrim(idempotency_key), '') is not null),
  status text not null check (status in ('queued', 'running', 'completed', 'unavailable')),
  lease_id uuid,
  lease_expires_at timestamptz,
  preanalysis_run_id uuid references public.psi_agt002_radar_preanalysis_runs(id) on delete restrict,
  error_code text check (error_code is null or error_code in (
    'timeout', 'provider_error', 'invalid_output', 'persistence_failure', 'lease_lost', 'capacity_unavailable'
  )),
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint psi_agt002_radar_preanalysis_jobs_lease_all_or_none check (
    (lease_id is null and lease_expires_at is null) or (lease_id is not null and lease_expires_at is not null)),
  constraint psi_agt002_radar_preanalysis_jobs_terminal_shape check (
    (status in ('queued', 'running') and preanalysis_run_id is null and error_code is null and error_message is null)
    or (status = 'completed' and preanalysis_run_id is not null and error_code is null and error_message is null)
    or (status = 'unavailable' and preanalysis_run_id is null and error_code is not null and error_message is not null)
  )
);

create unique index psi_agt002_radar_preanalysis_jobs_one_active
  on public.psi_agt002_radar_preanalysis_jobs (tender_id)
  where status in ('queued', 'running');
create index psi_agt002_radar_preanalysis_jobs_claimable_idx
  on public.psi_agt002_radar_preanalysis_jobs (status, created_at)
  where status = 'queued' and lease_id is null;
```

- Trigger `before update` que hace inmutables `tender_id`, `gate_evaluation_id`, `source_row_hash`, `policy_version`, `context_version`, `attempt_key`, `idempotency_key` y `created_at` (`55000`), igual que en `068`. Lo único mutable de un job es su estado, su reserva y su cierre.
- **`psi_enqueue_agt002_radar_preanalysis_job(p_tender_id, p_gate_evaluation_id, p_attempt_key, p_idempotency_key, p_policy_version, p_context_version, p_source_row_hash)`**: verifica que la evaluación de gate pertenezca a la misma licitación y tenga `verdict = 'sobreviviente'` (`22023` si no); toma `pg_advisory_xact_lock` por licitación; si ya existe un job activo con la misma identidad devuelve `{'status':'existing'}` y si la identidad difiere lanza `55000`; y **corto circuita a `{'status':'satisfied'}` sin encolar** cuando ya hay una corrida canónica —de cualquier resultado terminal: `mostrar_en_radar`, `no_mostrar_en_radar` o abstención `no_concluyente`— cuyos propios `source_row_hash`, `policy_version` y `context_version` coinciden con los tres del encolado. Es el **mismo triple y la misma comparación** que el filtro de visibilidad del §8.7 aplica al leer: lo que hace que una corrida siga siendo suficiente para no reprocesar es exactamente lo que la hace suficiente para sostener la superficie, y no hay dos definiciones de "vigente" que puedan divergir. El corto circuito mira `canonical`, no `status`: una abstención sobre una fila que no cambió tampoco se repreanaliza, porque volver a preguntar lo mismo con la misma evidencia y la misma política no puede producir una respuesta más atribuible, sólo más gasto. Ese corto circuito es lo que impide que un temporizador queme presupuesto del proveedor repreanalizando filas que no cambiaron; el trabajo reaparece exactamente cuando cambia la fila (`raw`/`status`/`deadline_at` ⇒ hash nuevo) **o** cuando cambia la política o el contexto (⇒ versión nueva), que son justo los dos casos en que el preanálisis anterior dejó de ser atribuible.
- **`psi_claim_agt002_radar_preanalysis_job(p_lease_seconds)`**: acota los segundos a `[1, 600]`; **antes** de seleccionar trabajo nuevo cierra como `lease_lost` toda fila `running` con `lease_expires_at <= now()` y asienta su evento `unavailable` en `psi_agt002_radar_preanalysis_attempt_events` con `event_key = attempt_key || ':lease_lost'` —así el ledger de intentos no queda con huecos cuando un worker muere—; luego reclama a lo sumo una fila con `order by created_at, id for update skip locked limit 1` y devuelve `{'status':'empty'}` si no hay ninguna. Un job que perdió su reserva es terminal: **nunca** se vuelve a entregar al proveedor.
- **`psi_complete_agt002_radar_preanalysis_job(p_job_id, p_lease_id, p_preanalysis_run_id)`**: exige `status = 'running'`, reserva vigente y coincidente, y una corrida **ya existente** en `psi_agt002_radar_preanalysis_runs` que sea `canonical`, del mismo `tender_id` y con el mismo `gate_evaluation_id` del job (`22023` si no). No exige `status = 'completed'`: una abstención es un resultado terminal legítimo del preanálisis y cierra el job igual que una conclusión —el trabajo encomendado era producir una corrida atribuible, no producir un veredicto de mostrar—. El único cierre que **no** pasa por aquí es el fallo de ejecución, que va por `psi_fail_...` con su código cerrado. Este RPC **no escribe el ledger**: sólo cierra la fila de cola contra algo que ya existe, exactamente como `068`. Replay con la misma corrida ⇒ `{'status':'existing'}`; con otra corrida ⇒ `23505`.
- **`psi_fail_agt002_radar_preanalysis_job(p_job_id, p_lease_id, p_error_code)`**: acepta sólo los seis códigos cerrados del §8.6 y deriva `error_message` de un `case` fijo. **No recibe texto crudo del proveedor ni de la base**, de modo que esa superficie no puede filtrar nada. `unavailable` es terminal igual que `completed`.
- Divergencia deliberada frente a `068`: allí se congela un `frozen_engine_input` completo en el encolado. Aquí lo congelado es la **identidad de la evidencia** (`gate_evaluation_id` + `source_row_hash` + versiones); las señales de aprendizaje se resuelven **después del claim**, en el paso (5) de la cadena, y su versión queda persistida en `psi_agt002_radar_preanalysis_runs.learning_signals_version`. Motivo: las señales son retrieval de sólo lectura sobre datos que cambian, y congelarlas en el encolado produciría corridas atribuidas a señales que ya no existen. Con `source_row_hash` congelado y `learning_signals_version` persistido, toda corrida sigue siendo atribuible a un par (fila observada, señales usadas).

**Guardia de autoridad, mecánica:** ninguna de las dos migraciones puede contener los identificadores `psi_sales_opportunities`, `psi_convert_tender_to_opportunity`, `converted_opportunity_id` ni `internal_status`. Esto se verifica como prueba estática sobre el texto de los archivos SQL, además de la verificación dinámica en PGlite (snapshot de `psi_public_tenders` y `psi_sales_opportunities` antes y después de cada RPC).

## 8. Contratos y módulos

### 8.1 `tender-relevance-terms.js` [PROPUESTO]

Extrae **sin cambio semántico** las listas hoy literales en `server/index.js`: `TENDER_NON_SECURITY_CONTEXT_TERMS`, `TENDER_NON_COMMERCIAL_ACT_TERMS`, `TENDER_DISQUALIFYING_TERMS`. `server/index.js` (y su par byte-idéntico) las importa; `isTenderTrackable` conserva exactamente el mismo comportamiento observable. Objetivo: que gate y backend compartan una sola fuente de términos en lugar de duplicarla.

### 8.2 `agt002-radar-gate.js` [PROPUESTO]

```js
export const AGT002_RADAR_GATE_POLICY_VERSION = 'agt002-radar-gate-policy-v1';
export const AGT002_RADAR_GATE_CONTEXT_VERSION = 'agt002-radar-context-v1';
export const AGT002_RADAR_GATE_RULE_IDS = Object.freeze([
  'estado_terminal',
  'fecha_vencida',
  'fecha_no_verificable',
  'contratacion_directa',
  'contexto_no_seguridad',
]);
export function evaluateAgt002RadarGate(tenderRow, { nowIso, contextVersion }); // → verdict cerrado
export function computeAgt002RadarSourceRowHash(tenderRow);                     // → sha256 hex
```

Reglas, todas determinísticas y con evidencia obligatoria:

| `rule_id` | Elimina cuando | Fuente reutilizada |
|---|---|---|
| `estado_terminal` | `isTenderTerminalStatus(tenderStatusSearchText(row))` es verdadero | `tender-source-status.js` **[EXISTE]**, sin lógica paralela |
| `fecha_vencida` | `deadline_at` es una fecha calendario válida estrictamente anterior a hoy en `America/Bogota` | lógica de calendario propia del módulo, determinística y con zona explícita |
| `fecha_no_verificable` | `deadline_at` es nulo, vacío o no parseable como fecha calendario | fail-closed sobre la fecha, exigido por el contexto aprobado |
| `contratacion_directa` | el texto normalizado de modalidad contiene `contratacion directa` | campos `raw.modalidad_de_contratacion`, `raw.modalidad_de_contrataci_n`, `raw.tipo_de_proceso`, `raw.modalidad`, más `category` |
| `contexto_no_seguridad` | coincide `TENDER_NON_SECURITY_CONTEXT_TERMS`, `TENDER_NON_COMMERCIAL_ACT_TERMS` o `TENDER_DISQUALIFYING_TERMS` | `tender-relevance-terms.js` |

**Decisión explícita sobre modalidad ausente.** `contratacion_directa` es una regla de coincidencia positiva: si **ningún** campo de modalidad está presente, la licitación **no** se elimina; se registra un `data_gap` tipado `modalidad_no_reportada` en la evaluación. Razón: una porción material de las filas SECOP persistidas no conserva el campo de modalidad en `raw`, y eliminarlas por ausencia vaciaría el Radar en lugar de limpiarlo. El fail-closed del contexto aprobado se aplica donde fue pedido —fechas— y la ausencia de modalidad se hace visible como brecha, no como veredicto silencioso.

**Determinismo verificable.** `evaluateAgt002RadarGate` no lee reloj propio: recibe `nowIso`. Dos ejecuciones con el mismo `tenderRow` y el mismo `nowIso` producen bytes idénticos, incluido el orden de `rule_ids` (orden de `AGT002_RADAR_GATE_RULE_IDS`, no de descubrimiento).

**Idempotencia.** `idempotency_key = sha256(tender_id | policy_version | context_version | source_row_hash)`. Reevaluar una fila que no cambió es un no-op del RPC; cambiar `raw`/`status`/`deadline_at` produce un nuevo hash y por tanto una nueva evaluación, sin borrar la anterior.

### 8.3 `agt002-radar-preanalysis-contract.js` [PROPUESTO]

Validador de forma cerrada (patrón `exactKeys` de `agt002-tender-adapter.js`) del sobre devuelto por el proveedor:

```
schema_version, agent_id ('AGT-002'), run_id, policy_version, context_version,
tender_id, gate_evaluation_id, status ('completed'|'abstained'),
visibility_verdict ('mostrar_en_radar'|'no_mostrar_en_radar'|'no_concluyente'),
summary, signals[], evidence[], data_gaps[], human_review_required (siempre true), usage
```

Invariantes del validador:

- `evidence[]` tiene al menos un elemento; cada elemento lleva exactamente `evidence_id`, `evidence_type` (`tender_field`|`gate_rule`|`learning_signal`), `reference`, `observed_value`, `policy_version`, `context_version`. Esto vale para los tres veredictos: un `no_mostrar_en_radar` y una abstención exigen evidencia exactamente igual que un `mostrar_en_radar`. No se admite "no mostrar porque sí".
- Toda entrada de `signals[]` referencia al menos un `evidence_id` existente; una señal huérfana hace fallar la validación.
- El validador recibe además `expectedLearningSignalIds`: el conjunto de `signal_id` que la entrada cerrada de esa corrida le entregó al proveedor (§8.4). Toda `evidence[]` de tipo `learning_signal` debe citar uno de ellos; citar un `signal_id` ausente de ese conjunto es error de contrato, no una referencia laxa. Sin esta comprobación, un precedente inventado por el modelo sería indistinguible de uno recuperado. Con `learning_signals = null` el conjunto es vacío y **cualquier** evidencia `learning_signal` falla.
- `visibility_verdict = 'no_mostrar_en_radar'` exige al menos un elemento de `evidence[]` con `evidence_type` distinto de `learning_signal`. El aprendizaje puede acompañar un "no mostrar", nunca sostenerlo solo (I-13).
- El vocabulario prohibido se verifica con la **guardia léxica de límites** descrita abajo, sobre nombres de clave **y** sobre todo valor de texto libre del sobre. Una clave prohibida es error de contrato, no un campo ignorado.
- Emparejamiento cerrado de `status` y `visibility_verdict`, idéntico al `check` de `072`: `completed` admite `mostrar_en_radar` **o** `no_mostrar_en_radar`; `abstained` admite **sólo** `no_concluyente`. Las otras tres combinaciones —`completed` + `no_concluyente`, `abstained` + `mostrar_en_radar`, `abstained` + `no_mostrar_en_radar`— fallan. Una abstención es la ausencia de conclusión, así que no puede acompañar a un veredicto conclusivo; y una corrida que concluyó debe decir qué concluyó.
- `human_review_required` debe ser el booleano `true`. `false`, `"true"`, `1`, `null` y la ausencia de la clave son error de contrato. El campo no es una decisión del proveedor sobre este proceso: es la afirmación invariante de que el preanálisis nunca sustituye al encargado de Licitaciones, coherente con §2. Un `no_mostrar_en_radar` es, por tanto, un insumo revisable y jamás un descarte automático.
- `agent_id` distinto de `'AGT-002'` falla.

**Guardia léxica de GO/NO-GO: límites de token y de frase, nunca subcadena.**

```js
export const AGT002_RADAR_FORBIDDEN_TOKENS = Object.freeze([
  'go', 'nogo', 'gonogo', 'recommendation', 'recomendacion',
  'decision', 'decidir', 'convert', 'convertir', 'conversion',
  'opportunity_id', 'converted_opportunity_id',
]);
export const AGT002_RADAR_FORBIDDEN_PHRASES = Object.freeze([
  ['no', 'go'], ['go', 'no', 'go'], ['recomendacion', 'de', 'go'],
  ['decision', 'de', 'go'], ['convertir', 'en', 'oportunidad'],
]);
export function findAgt002RadarForbiddenVocabulary(value); // → [{ path, match, kind, token_index }]
```

La guardia normaliza (NFD, se retiran diacríticos, minúsculas), **tokeniza** partiendo por la clase fija `[^a-z0-9]+` y evalúa:

- **token**: coincidencia sólo si un token completo es igual a un elemento de `AGT002_RADAR_FORBIDDEN_TOKENS`. `go` prohíbe la palabra `go`, no la sílaba `go`.
- **frase**: coincidencia sólo si una ventana de tokens **consecutivos** iguala una entrada de `AGT002_RADAR_FORBIDDEN_PHRASES`. Así `GO / NO-GO`, `go_no_go` y `Go No Go` colisionan por igual —los separadores desaparecen en la tokenización— sin que la guardia tenga que enumerar sus escrituras.

Está **prohibido implementar esto por subcadena** (`includes`/`indexOf`/`~ '.*go.*'`). Una guardia por subcadena rechaza el vocabulario ordinario de una licitación colombiana, y su modo de falla no es un GO que se cuela sino un preanálisis correcto que se cae en producción. El módulo declara una lista congelada de **términos que deben pasar**, que la prueba recorre entera:

`riesgo`, `riesgos`, `matriz de riesgos`, `Bogotá` / `bogota`, `catálogo`, `código`, `pliego`, `negociación`, `gobierno`, `agosto`, `algoritmo`, `cargo`, `obligaciones`, `logística`, `pago`, `rubro presupuestal`.

`riesgo` es el caso de prueba obligatorio y no es un ejemplo cualquiera: es el término que el preanálisis usa con más frecuencia legítima —`risks` ya se persiste hoy en `psi_public_tenders` **[EXISTE]**— y contiene `go` como subcadena. Una guardia que rechace un sobre por decir "riesgo de incumplimiento" habría hecho inutilizable el preanálisis entero.

Un hallazgo de la guardia falla el sobre con `AGT002_RADAR_PREANALYSIS_FORBIDDEN_VOCABULARY` y reporta `path` y `token_index`, no el texto del proveedor: el error es diagnosticable sin reexportar la cadena que lo produjo.

**Alcance de la guardia.** Se aplica (a) al sobre devuelto por el proveedor en tiempo de ejecución, claves y valores de texto sin excepción, y (b) a los campos que la **cadena misma construye** dentro de la entrada cerrada del §8.4: veredicto y razones del gate, y señales de aprendizaje. **No** se aplica al texto público verbatim del proceso —objeto, entidad, modalidad— que viaja en esa entrada: censurar el objeto de una licitación porque una palabra suya cae en la lista mutilaría el insumo y produciría un preanálisis sobre un proceso que no es el real. La asimetría es deliberada: lo que la cadena escribe está bajo su control y debe respetar el vocabulario; lo que la fuente oficial publicó se transporta tal cual.

La guardia tampoco se aplica al texto fuente del repositorio: `psi_tender_go_no_go_decisions` es una tabla existente que la proyección del §8.8 debe nombrar para leerla, y confundir "el módulo no puede nombrar la tabla" con "el sobre no puede hablar de GO" volvería inejecutable el aprendizaje. Las pruebas estáticas de I-3 siguen buscando identificadores inequívocos (`psi_convert_tender_to_opportunity`, `/api/tender-convert`), que no tienen este problema.

### 8.4 `agt002-radar-preanalysis-input.js` [PROPUESTO]

`buildAgt002RadarPreanalysisInput({ tenderRow, gateEvaluation, learningSignals })` construye la entrada cerrada del proveedor. Sólo campos públicos del proceso (entidad, objeto, ciudad/departamento, valor, fechas, fuente, referencia, estado oficial, `reasons`/`risks` ya persistidos), el veredicto del gate con sus brechas, y las señales de aprendizaje ya versionadas. **No** incluye información de oportunidades, decisiones GO/NO-GO individuales ni identidades de personas.

**El builder es el punto donde se rechaza el aprendizaje global.** `learningSignals` es `null` o el objeto `{ version, signals[] }` que devuelve el retrieval del §8.8, y el builder valida antes de construir nada:

- `signals.length <= maxSignals` y `maxSignals` es el mismo con el que se llamó al retrieval; un conjunto sin cota es error de contrato, no una entrada larga.
- toda señal declara `candidate_match` con **al menos una** dimensión coincidente y su evidencia (§8.8). Una señal sin `candidate_match` —un agregado, una tasa base, un patrón "del corpus"— hace lanzar `AGT002_RADAR_LEARNING_SIGNAL_NOT_CANDIDATE_SPECIFIC`. No hay campo en la entrada donde quepa una estadística global: la forma cerrada no lo admite y el validador no lo tolera (I-31).
- toda señal declara `signal_polarity in ('favorable','desfavorable','neutra')`, **no** el veredicto humano que la originó. La polaridad es lo que el preanálisis puede usar para ordenar prioridad relativa; la decisión GO/NO-GO en sí no cruza la frontera, ni como valor ni como vocabulario (§8.3, I-4).
- `tenderRow` y `gateEvaluation` deben referirse a la misma licitación que `learningSignals.candidate_id`; una señal recuperada para otro candidato es `AGT002_RADAR_LEARNING_CANDIDATE_INVALID`.

El builder devuelve además `learning_signals_count`, que es lo que el paso (7) persiste junto a `learning_signals_version` (§7.2).

### 8.5 `agt002-radar-preanalysis-runtime.js` [PROPUESTO]

Espejo estructural de `agt002-preview-runtime.js`: `isAgt002RadarPreanalysisConfigured(env)`, `getAgt002RadarPreanalysisRuntimeConfig(env)`, `createAgt002RadarPreanalysisRuntime({...})`. Reutiliza `createAgt002HetznerBridgeClient` **[EXISTE]** y las variables `AGT002_HETZNER_BRIDGE_URL` / `AGT002_HETZNER_BRIDGE_HMAC_SECRET` ya existentes; añade `AGT002_RADAR_PREANALYSIS_MODEL`, `AGT002_RADAR_PREANALYSIS_TIMEOUT_MS`, `AGT002_RADAR_PREANALYSIS_MAX_CONCURRENT`, `AGT002_RADAR_PREANALYSIS_DAILY_MAX_RUNS`. Falla cerrado (lanza) si falta cualquiera de las requeridas.

### 8.6 `agt002-radar-preanalysis-jobs.js` y `agt002-radar-preanalysis-worker.js` [PROPUESTO]

`agt002-radar-preanalysis-jobs.js` es el envoltorio JS de los cuatro RPC de cola, espejo de `agt002-reanalysis-jobs.js` **[EXISTE]**: `enqueueAgt002RadarPreanalysisJob`, `claimAgt002RadarPreanalysisJob(database, { leaseSeconds })`, `completeAgt002RadarPreanalysisJob(database, { jobId, leaseId, preanalysisRunId })`, `failAgt002RadarPreanalysisJob(database, { jobId, leaseId, errorCode })`. Sólo `database.rpc(...)`: ningún `insert`/`update`/`upsert`/`delete` directo sobre ninguna tabla.

`agt002-radar-preanalysis-worker.js` es espejo de `agt002-reanalysis-worker.js` **[EXISTE]**:

```js
export const AGT002_RADAR_QUEUE_ERROR_CODES = Object.freeze([
  'timeout', 'provider_error', 'invalid_output', 'persistence_failure', 'lease_lost', 'capacity_unavailable',
]);
export function classifyAgt002RadarPreanalysisError(error);
export function createAgt002RadarPreanalysisWorker({ database, executeJob, leaseSeconds = 600, claimJob, completeJob, failJob });
```

- `runOnce()` reclama **a lo sumo un job**; sin trabajo devuelve `{ status: 'empty' }` sin llamar al proveedor.
- `executeJob` se invoca **como máximo una vez** por invocación. No hay reintentos internos: cada invocación termina en exactamente una transición terminal (`complete` o `fail`), nunca en ninguna y nunca en dos.
- Si `completeJob` falla después de que la corrida canónica ya se persistió, el job se cierra `persistence_failure`. Esa asimetría es intencional y es la misma de `068`: el ledger es la verdad; la cola es sólo el registro de lo que falta.
- `leaseSeconds` acotado a `[30, 600]`; fuera de rango lanza en construcción.
- Cada transición se asienta además en `psi_agt002_radar_preanalysis_attempt_events` (`running`, y luego `completed` o `unavailable`), de modo que el intento queda en el ledger aunque la cola se purgue.

### 8.7 `agt002-radar-visibility.js` [PROPUESTO]

```js
export function filterRadarRowsByCanonicalPreanalysis(rows, {
  canonicalByTenderId,      // Map<tender uuid, { visibility_verdict, source_row_hash,
                            //                    policy_version, context_version }>
  alwaysVisibleTenderIds,
  computeSourceRowHash,     // la MISMA función del §8.2, inyectada
  policyVersion,            // versión de política vigente en el proceso lector
  contextVersion,           // versión de contexto vigente en el proceso lector
  enabled,
});
```

- `enabled === false` → devuelve `rows` **por identidad de referencia**; sin flag, el Radar es byte a byte el de hoy. Ninguno de los parámetros de frescura se evalúa siquiera.
- `enabled === true` → conserva una fila si su `id` está en `alwaysVisibleTenderIds` **o** si su preanálisis canónico es **conclusivo y fresco**, es decir, si se cumplen las cuatro condiciones a la vez:
  1. existe `canonical = canonicalByTenderId.get(row.id)`;
  2. `canonical.visibility_verdict === 'mostrar_en_radar'`;
  3. `canonical.source_row_hash === computeSourceRowHash(row)` — el hash se calcula sobre **la fila que se está a punto de mostrar**, no sobre la que existía cuando corrió el preanálisis;
  4. `canonical.policy_version === policyVersion` **y** `canonical.context_version === contextVersion`.
- **Por qué la frescura es parte de la visibilidad y no una tarea de mantenimiento.** Un preanálisis es una afirmación sobre una fila concreta bajo una política concreta. Si la fila cambió —nueva fecha de cierre, estado oficial que pasó a terminal, `raw` reemplazada por la siguiente ingesta— la afirmación ya no habla de lo que el Radar muestra, aunque siga siendo la canónica. Mostrar esa fila sería sostener la superficie con evidencia caduca y presentar como preanalizado algo que nadie preanalizó en su forma actual. Lo mismo vale para un cambio de `AGT002_RADAR_GATE_POLICY_VERSION` o de la versión de contexto: si la política cambió, la conclusión anterior no fue tomada bajo la política vigente. La condición 3 es además la que hace que el gate y la superficie no puedan divergir: la ingesta cruda sigue actualizando `psi_public_tenders` sin pedir permiso, y el instante en que una fila cambia es el instante en que deja de estar cubierta.
- **Los cinco casos que ocultan son deliberadamente indistinguibles para el filtro**: sin canónica (nunca preanalizada, o encolada y aún sin ejecutar), canónica `no_mostrar_en_radar`, canónica `no_concluyente` por abstención, canónica **rezagada** por hash distinto, y canónica **rezagada** por versión de política o contexto distinta. El filtro no expone cuál de los cinco fue: distinguirlos en la superficie sería filtrar el estado del ledger al frontend, que es un cambio visual, y ninguno de los cinco autoriza mostrar. El desglose por causa existe, pero vive en la auditoría del §13, que es donde un humano lo necesita.
- `canonicalByTenderId` se construye leyendo `where canonical` —sin filtrar por `status`—, precisamente para que una abstención o un `no_mostrar_en_radar` posterior a un `mostrar_en_radar` oculte la fila: si el mapa sólo cargara corridas `completed` con veredicto de mostrar, la corrida superada seguiría gobernando la superficie y la promoción canónica no tendría efecto observable. Con `source_row_hash` desnormalizado en la corrida (§7.2), ese mapa se arma con **una sola consulta a una sola tabla**, acotada a los `tender_id` de la página ya leída.
- La comparación de la condición 3 usa `computeAgt002RadarSourceRowHash` **inyectada**, no reimplementada: si el filtro calculara el hash con su propia lógica, dos implementaciones de la misma pregunta podrían divergir y el Radar se vaciaría sin que nada estuviera roto. Es el mismo error que §3.3 documenta ya existente entre `tenderDeadlineBucket` y `tenderDaysUntil`, y aquí se evita por construcción.
- El triple `(source_row_hash, policy_version, context_version)` es **exactamente** el que `psi_enqueue_agt002_radar_preanalysis_job` usa para corto circuitar en `satisfied` (§7.2). De ahí se sigue la propiedad que hace operable todo esto: una fila oculta por rezago es, por la misma comparación, una fila que la siguiente corrida del pipeline **sí** encolará —el corto circuito no aplica—, así que el rezago se repara solo al ritmo del temporizador, sin intervención ni backfill manual.
- Ocultar **no** es descartar: la fila permanece intacta en `psi_public_tenders`, sigue apareciendo con el flag apagado, y una corrida posterior con `mostrar_en_radar` sobre el hash y las versiones vigentes la devuelve a la superficie sin ninguna acción de reparación. El único registro de "esto no se muestra" vive en el ledger append-only, con evidencia y versión.
- `alwaysVisibleTenderIds` lo construye el backend con `isConvertedTenderRecord` **[EXISTE]** (`server/index.js:1531`), que es donde ya vive esa semántica. El módulo de visibilidad **no** interpreta `internal_status` ni `converted_opportunity_id`: recibe un `Set` de identificadores ya decididos. Así el invariante I-2 —ningún módulo del camino de decisión nombra siquiera esas columnas— es mecánicamente cierto en lugar de ser una promesa, y las convertidas históricas siguen visibles siempre (I-12). La pertenencia a ese `Set` se evalúa **antes** que las cuatro condiciones de frescura y las cortocircuita: una convertida no se oculta por hash rezagado, por versión vieja ni por no tener preanálisis alguno. La frescura gobierna lo que el preanálisis sostiene; una licitación que el encargado ya convirtió no depende del preanálisis para existir en la superficie.
- Opera sobre **filas de base de datos**, antes de `dbTenderToPublic`, porque ese mapeo descarta el uuid y deja `stable_key` en `id`.
- No agrega, quita ni renombra ninguna clave del objeto devuelto al frontend.

### 8.8 Aprendizaje: `agt002-radar-learning-projection.js`, `agt002-radar-learning-retrieval.js` y `agt002-radar-learning-proposals.js` [PROPUESTO]

El aprendizaje **no es un informe aparte**: es el paso (5) de la cadena del §6, entre el claim durable y la llamada a AGT-002. Se parte en tres módulos con responsabilidades disjuntas:

| Módulo | Responsabilidad | Puede tocar la base |
|---|---|---|
| `agt002-radar-learning-projection.js` | proyectar por `GET` las cuatro fuentes a un objeto `observations` de forma cerrada | sí, **sólo lectura** (`select`) |
| `agt002-radar-learning-retrieval.js` | dado **un candidato**, recuperar de `observations` los precedentes comparables y emitir señales tipadas, versionadas y acotadas | no: función pura |
| `agt002-radar-learning-proposals.js` | emitir el artefacto `DRAFT` para curaduría humana | no: función pura |

La proyección está separada del retrieval a propósito: así el módulo que decide *qué significa* una señal es una función pura, verificable sin base de datos, y el único módulo que habla con las tablas de decisiones humanas es una proyección de sólo lectura sin ninguna lógica de interpretación.

**La proyección es por corrida; el retrieval es por candidato.** El pipeline (§8.9) llama a la proyección **una vez por corrida** —es la lectura cara, y `observations` no depende de qué licitación se esté preanalizando—, y llama al retrieval **una vez por candidato**, ya con el job reclamado y por tanto con la licitación identificada. `observations` no es un conjunto de señales: es materia prima. Una observación se convierte en señal sólo cuando se demuestra comparable con *este* candidato, y esa demostración viaja con ella.

#### Contrato del retrieval [PROPUESTO]

```js
export const AGT002_RADAR_LEARNING_SIGNALS_VERSION = 'agt002-radar-learning-v1';
export const AGT002_RADAR_LEARNING_MAX_SIGNALS_LIMIT = 25;
export const AGT002_RADAR_LEARNING_DIMENSIONS = Object.freeze([
  'servicio_objeto', 'entidad', 'modalidad', 'fuente', 'territorio',
]);
export function buildAgt002RadarLearningSignals({ candidate, observations, maxSignals });
// → { version, candidate_id, max_signals, considered, signals: [...] }  (a lo sumo maxSignals)
```

- `candidate` es la proyección cerrada de la licitación a preanalizar: `{ tender_id, service_terms[], entity_key, modality_key, source_key, territory_key }`, derivada de la misma fila que evaluó el gate y de las mismas normalizaciones del §8.2. No se acepta la fila cruda: lo que entra al retrieval ya está normalizado y es auditable.
- `observations` es la salida de la proyección, verbatim. El retrieval **no** lee la base: no puede haber una señal cuyo origen no esté en `observations`.
- `maxSignals` es un entero en `[1, AGT002_RADAR_LEARNING_MAX_SIGNALS_LIMIT]`. Ausente, no entero, fuera de rango ⇒ lanza `AGT002_RADAR_LEARNING_SIGNALS_INVALID`. **No hay valor por defecto implícito**: quien llama declara la cota, de modo que ninguna ruta de código puede terminar pidiendo "todas".

**Similitud auditable, cinco dimensiones.** Cada observación se compara con el candidato en las cinco dimensiones congeladas de `AGT002_RADAR_LEARNING_DIMENSIONS`. Cada dimensión produce un resultado **verificable a mano**: qué campo del candidato, qué campo de la observación, qué valor normalizado coincidió.

| Dimensión | Qué compara | Cómo coincide | Peso |
|---|---|---|---|
| `servicio_objeto` | términos de servicio del objeto contractual, normalizados y tokenizados con la misma clase de separadores del §8.3 | coincidencia de **tokens y frases completas** contra el vocabulario de servicios de `tender-relevance-terms.js`; el peso se otorga por **cantidad de términos de servicio compartidos**, acotada a 3 | 3 por término compartido (máx. 9) |
| `entidad` | entidad contratante | igualdad exacta de la clave normalizada (NIT cuando existe; si no, nombre normalizado) | 4 |
| `modalidad` | modalidad de contratación | igualdad exacta de la clave normalizada; ausente en cualquiera de los dos lados ⇒ **no coincide** y se registra `data_gap` `modalidad_no_reportada`, nunca coincidencia por omisión | 3 |
| `fuente` | `SECOP I` / `SECOP II` / `TVEC` / `ESU` | igualdad exacta | 1 |
| `territorio` | ciudad y departamento normalizados | ciudad igual ⇒ 2; sólo departamento igual ⇒ 1; ninguno ⇒ 0 | 2 / 1 |

- **Todos los pesos son enteros.** No hay coseno, no hay embeddings, no hay flotantes. La razón no es simplicidad sino auditabilidad y determinismo: un puntaje entero se recalcula a mano desde la tabla de arriba, y dos puntajes iguales lo son exactamente, sin depender del orden de las sumas en coma flotante. El puntaje máximo es 19 y está fijo en el módulo como constante verificada por prueba.
- **Cero dimensiones coincidentes ⇒ no es señal.** Una observación que no coincide en nada no entra al top-K ni con puntaje cero ni como relleno. Esto es lo que hace que "no hay precedente comparable" sea un resultado posible y honesto en lugar de un conjunto de precedentes irrelevantes.
- Cada señal emitida lleva `candidate_match`: la lista de dimensiones que coincidieron, con el valor observado en cada lado y el peso aportado, más `score` y `max_score`. Un humano que lee el ledger puede reconstruir por qué ese precedente acompañó a esa licitación sin ejecutar nada.

**Orden determinista y desempate total.** Las señales se ordenan por:

1. `score` descendente;
2. `dimensions_matched` descendente (a igual puntaje, gana la coincidencia más ancha: dos dimensiones distintas informan más que una fuerte);
3. `decided_at` descendente, comparado como cadena ISO-8601 **normalizada a UTC** en la proyección —comparación lexicográfica, sin `Date` ni zona local;
4. `observation_id` **ascendente**, que es único por construcción.

El paso 4 es lo que hace el orden **total**: no existen dos observaciones que empaten hasta el final, así que `sort` no depende de la estabilidad de la implementación ni del orden en que la proyección devolvió las filas. La prueba lo verifica barajando `observations` y exigiendo salida byte-idéntica (I-30). El corte a `maxSignals` se aplica **después** de ordenar, de modo que el top-K es una función de los datos y no del orden de llegada.

**Cota dura.** `signals.length <= maxSignals` siempre; el campo `considered` reporta cuántas observaciones tuvieron al menos una dimensión coincidente, de modo que un top-K que dejó fuera precedentes comparables sea visible en lugar de silencioso. `considered > signals.length` no es un error: es el dato que un humano necesita para decidir si `maxSignals` está bien calibrado.

Retrieval **gobernado y de sólo lectura** sobre datos que ya existen:

| Fuente | Qué aporta |
|---|---|
| `psi_public_tenders.internal_status` / `converted_opportunity_id` **[EXISTE]** | qué procesos el encargado convirtió manualmente |
| `psi_tender_analysis_runs` canónico **[EXISTE]** | qué concluyó el análisis canónico de esos procesos |
| `psi_tender_go_no_go_decisions` **[EXISTE]** | decisión GO/NO-GO humana, con `justification` y `decided_at` |
| `psi_sales_opportunities.tender_offer_status` + `psi_tender_offer_status_transitions` **[EXISTE]** | `presentada`, `adjudicada`, `no_adjudicada` |

Reglas de interpretación, fijadas por el contexto aprobado:

- **GO es señal, no verdad universal.** Un GO aumenta la confianza en un patrón; nunca lo convierte en criterio de admisión ni de exclusión.
- **NO-GO y `no_adjudicada` no excluyen por sí solos.** Sus causas típicas —capacidad, precio, calendario, decisión comercial— no son propiedades del proceso. Una señal negativa sólo puede *reducir prioridad relativa* dentro del preanálisis, jamás producir por sí sola un `no_mostrar_en_radar` ni una abstención `no_concluyente`, ni ocultar una licitación. Un `no_mostrar_en_radar` debe sostenerse en evidencia del proceso mismo (`tender_field` o `gate_rule`); una `evidence[]` compuesta únicamente de elementos `learning_signal` no basta para no mostrar.
- **Ninguna señal de aprendizaje puede eliminar una licitación.** La eliminación es competencia exclusiva del gate determinístico del §8.2. Esto es un invariante probado, no una convención.
- **Toda señal lleva evidencia y versión.** Cada señal referencia filas concretas por id, con `policy_version` y `context_version`, y además su `candidate_match`: qué la hace comparable con *esta* licitación.
- **Ninguna señal global entra al preanálisis.** Tasas base, promedios del corpus, "el histórico muestra que…" y cualquier agregado que no se sostenga en observaciones concretas comparables con el candidato están fuera de la entrada cerrada, y el builder del §8.4 lanza si aparecen (I-31). Un agregado no es citable: no hay fila que un humano pueda abrir para contradecirlo, y una afirmación que no se puede contradecir no es evidencia. Los agregados tienen exactamente un destino legítimo, el artefacto DRAFT de curaduría humana, donde un humano los lee sabiendo que son agregados y decide si valen una regla.
- **La polaridad viaja; el veredicto humano no.** Una señal declara `signal_polarity in ('favorable','desfavorable','neutra')` y no el GO/NO-GO que la originó, coherente con la guardia léxica del §8.3 y con §8.4. Lo que el preanálisis necesita para ordenar prioridad relativa es el signo, no la decisión comercial de una persona sobre otro proceso.
- `AGT002_RADAR_LEARNING_SIGNALS_VERSION = 'agt002-radar-learning-v1'` se persiste, junto con `learning_signals_count`, en cada corrida que usó señales, para que un cambio de señales sea distinguible de un cambio de modelo o de política.

Reglas de **entrada a la cadena** (paso 5 del §6), que son las que hacen del aprendizaje algo real y a la vez inocuo:

- Las señales entran **únicamente** como un campo de la entrada cerrada de `buildAgt002RadarPreanalysisInput` (§8.4). No tocan el gate, no tocan el filtro de visibilidad y no tocan ningún RPC: no existe camino de código por el que una señal alcance la decisión de eliminar (I-13).
- Cada señal usada queda referenciable desde el sobre: una `evidence[]` de tipo `learning_signal` cita un `signal_id` que **debe estar entre los que la entrada cerrada le entregó**, y el validador (§8.3) rechaza tanto señales huérfanas como una evidencia que cite un `signal_id` inexistente en la entrada de esa corrida —que es la forma en que un precedente inventado se colaría con apariencia de citado. Una corrida que *invoca* el aprendizaje pero no lo cita en ninguna evidencia sigue siendo válida —el modelo puede haber concluido sin apoyarse en él—, pero `learning_signals_version` queda persistido igual, así que siempre se sabe qué señales tuvo a la vista.
- **Ausencia legítima ≠ fallo, y ahora tiene dos formas.** Con `observations` vacías (todavía no hay conversiones ni decisiones) y también cuando **ninguna** observación coincide con el candidato en ninguna dimensión —el caso normal de una licitación sin precedente parecido—, la corrida se ejecuta con `learning_signals = null` y persiste `learning_signals_version = null` y `learning_signals_count = 0`. Las dos formas son legítimas y ninguna degrada a error. Lo prohibido es lo contrario: rellenar el top-K con los precedentes "menos malos" para que el campo no vaya vacío. Un candidato sin comparables debe llegar a AGT-002 declarándolo, porque un precedente irrelevante presentado como comparable es peor insumo que la ausencia de precedentes.
- **Fallo de aprendizaje ⇒ el job falla, no degrada en silencio.** Si la proyección o el retrieval lanzan (`AGT002_RADAR_LEARNING_SIGNALS_INVALID`), el pipeline **no** llama al proveedor sin señales: cierra el job con `invalid_output` y deja la licitación encolable en la siguiente corrida —un job terminal no ocupa el índice único de job activo—. Persistir una corrida "sin señales" cuando en realidad el retrieval falló haría inauditable el ledger.

`agt002-radar-learning-proposals.js` sigue el patrón de `agt002-governance-draft-proposal.js` **[EXISTE]**: emite un artefacto con `status: 'DRAFT'` y `human_approval_required: true`, de forma **deliberadamente incompatible** con cualquier entrada consumible por el runtime. Cambiar una regla del gate exige que un humano lea el DRAFT y edite `agt002-radar-gate.js` subiendo `AGT002_RADAR_GATE_POLICY_VERSION`. No existe camino de escritura de reglas en tiempo de ejecución.

Este módulo es el **único** lugar del alcance donde un agregado sobre todo el corpus es legítimo: consume `observations` directamente, sin candidato, porque su lector es una persona que está decidiendo si una regla merece existir, y para eso un patrón agregado es justamente lo pertinente. La separación es dura: `proposals` no es invocable desde el pipeline (§8.9 no lo inyecta), su salida no tiene la forma de `learningSignals` y el builder del §8.4 la rechazaría por carecer de `candidate_match`. El aprendizaje agregado sirve para proponer reglas a humanos; el aprendizaje específico del candidato sirve para contextualizar un preanálisis. Nunca se cruzan.

### 8.9 `agt002-radar-pipeline.js` — la cadena real [PROPUESTO]

Es el único módulo que conoce el orden completo. Todo lo anterior son piezas puras o envoltorios; aquí es donde la cadena existe.

```js
export const AGT002_RADAR_PIPELINE_STAGES = Object.freeze([
  'fetch', 'gate', 'ledger', 'claim', 'learning', 'agt', 'persist',
]);
export function createAgt002RadarPipeline({
  database, environment, now,            // `now` inyectable: el pipeline no lee reloj propio
  fetchTenderPage, evaluateGate, recordGateEvaluation,
  enqueueJob, claimJob, completeJob, failJob,
  projectLearningObservations, buildLearningSignals,
  runPreanalysis, recordPreanalysisRun, appendAttempt,
  leaseSeconds = 600, maxTendersPerRun = 250,
});
```

`runOnce()` ejecuta, en este orden y una sola vez por invocación:

| # | Etapa | Qué hace | Qué no hace |
|---|---|---|---|
| 0 | guardia | si `AGT002_RADAR_GATE` no está encendido devuelve `{ status: 'disabled', stages: [] }` | **no abre conexión, no lee, no escribe, no llama al proveedor** |
| 1 | `fetch` | lee una página de `psi_public_tenders` (`maxTendersPerRun`, orden estable por `last_seen_at desc, id`) | no escribe nada; no toca `persistTenderRadar` |
| 2 | `gate` | evalúa cada fila con `evaluateAgt002RadarGate` usando **un solo `nowIso`** capturado al inicio de la corrida | no llama al proveedor; no persiste |
| 3 | `ledger` | asienta cada veredicto vía `psi_record_agt002_radar_gate_evaluation` (idempotente por `source_row_hash`) | no escribe `psi_public_tenders` |
| 4 | `claim` | encola los **sobrevivientes** (`psi_enqueue_...`, corto circuito `satisfied` si ya hay canónica para el mismo hash) y reclama **un** job con reserva | no encola eliminadas; no reclama más de uno |
| 5 | `learning` | proyecta las cuatro fuentes por `GET` y deriva señales versionadas, una vez por corrida | no escribe; no puede eliminar nada |
| 6 | `agt` | construye la entrada cerrada y llama al puente Hetzner; valida el sobre | no acepta un sobre inválido como éxito |
| 7 | `persist` | `psi_record_agt002_radar_preanalysis_run` (promoción canónica) + evento de intento + `psi_complete_...` | no escribe `internal_status`, `converted_opportunity_id` ni oportunidades |

Reglas del pipeline:

- **Una corrida = a lo sumo una llamada al proveedor.** Las etapas 1–3 procesan la página completa (son puras y baratas); las etapas 4–7 procesan **un** job. Vaciar la cola es trabajo del temporizador, no de un bucle interno: así el costo por invocación está acotado y un fallo nunca arrastra a los demás jobs.
- Devuelve un resumen cerrado y serializable: `{ status: 'disabled' | 'empty' | 'completed' | 'unavailable', stages: [...], evaluated, eliminated, survivors, enqueued, satisfied, job_id, preanalysis_run_id, error_code }`. Nada de texto crudo del proveedor.
- Cualquier fallo **después** del claim cierra el job con `failJob` y el código clasificado del §8.6; ningún fallo deja un job `running` huérfano salvo la muerte del proceso, que el `claim` siguiente cierra como `lease_lost`.
- Un fallo en las etapas 1–3 aborta la corrida antes de encolar: `{ status: 'unavailable', stages: ['fetch', ...] }`. No se llama al proveedor con un gate que no se pudo asentar.
- Todas las dependencias son inyectables porque la prueba del pipeline verifica **el orden y el corte**, no la implementación de cada pieza: `stages` es la lista literal de etapas ejecutadas, y con el flag apagado debe ser exactamente `[]`.

### 8.10 Entrypoint real, apagado por defecto [PROPUESTO]

Espejo de `ops/agt002-reanalysis-worker/` **[EXISTE]**, en `ops/agt002-radar-pipeline/`:

| Archivo | Contenido |
|---|---|
| `run-agt002-radar-pipeline.mjs` | `#!/usr/bin/env node`; exige `SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`; construye el cliente, llama **una** `runOnce()` e imprime una línea JSON. Sin `setInterval`, sin `setTimeout`, sin `fetch` propio, sin bucle. |
| `agt002-radar-pipeline.service` | `Type=oneshot`, `EnvironmentFile=`, `NoNewPrivileges=true`, `PrivateTmp=true`, `ProtectSystem=strict`, `RestrictAddressFamilies=AF_UNIX AF_NETLINK AF_INET AF_INET6`, `TimeoutStartSec` holgado. |
| `agt002-radar-pipeline.timer` | `OnUnitActiveSec=` con `RandomizedDelaySec` distinto de cero y `Persistent=false`. |
| `env.example` | variables requeridas, **con `AGT002_RADAR_GATE=false` explícito**. |
| `README.md` | cómo instalar, y la declaración de que habilitar el `timer` es una autorización separada. |

**Qué significa "real pero apagado", con precisión:**

- El binario existe, es ejecutable y hace el trabajo completo cuando el flag está encendido. No es un `TODO`, un `dry-run` ni un esqueleto.
- Con `AGT002_RADAR_GATE` ausente o en cualquier valor distinto de `'true'`/`'1'`, `runOnce()` devuelve exactamente `{ status: 'disabled', stages: [], code: 'AGT002_RADAR_PIPELINE_DISABLED' }`, el proceso imprime esa línea y sale con **código 0**. Cero consultas, cero RPC, cero llamadas al puente. Es verificable con un doble de base de datos que lanza ante cualquier acceso (I-17).
- Los archivos `.service`/`.timer` se **crean pero no se instalan ni se habilitan** dentro de este alcance. Ninguna tarea del plan ejecuta `systemctl`. El entrypoint sólo se ejecuta a mano, contra un entorno no productivo, en la etapa E1 del §12.
- El entrypoint no tiene bandera de escritura forzada, no acepta `--apply`, y no puede encenderse a sí mismo: el flag vive en el `EnvironmentFile`, fuera del código.

## 9. Flags de rollout

Se añaden a `ANALYSIS_FLAG_NAMES` en `agt002-analysis-config.js`, respetando su semántica exacta (sólo `'true'`/`'1'`, todo lo demás apagado):

| Flag | Por defecto | Efecto |
|---|---|---|
| `AGT002_RADAR_GATE` | **OFF** | Habilita **la cadena completa del §8.9**: evaluar el gate, asentar el ledger, encolar, reclamar, aprender, llamar a AGT-002 y persistir. Apagado, el entrypoint es un no-op (`status: 'disabled'`). **No cambia nada de lo que el Radar muestra.** |
| `AGT002_RADAR_VISIBILITY` | **OFF** | Habilita el filtro de visibilidad en la lectura del Radar. |

El mismo flag gobierna el productor (entrypoint) y el lector del ledger, a propósito: no existe un estado en el que la cadena esté escribiendo y el operador crea que está apagada, ni uno en el que el Radar filtre por un ledger que nadie está poblando.

**Dependencia fail-closed:** `AGT002_RADAR_VISIBILITY` sin `AGT002_RADAR_GATE` **lanza** en `buildAgt002AnalysisConfig`, igual que `AGT002_DOCUMENT_RETRIEVAL` sin `AGT002_CONTEXT_V2` **[EXISTE]**. Es una configuración contradictoria: pedir que sólo se muestre lo preanalizado mientras nada produce preanálisis vaciaría el Radar.

**Indisponibilidad del ledger con `AGT002_RADAR_VISIBILITY` encendido.** Si la lectura del ledger falla o las tablas no existen, la petición falla con `AGT002_RADAR_VISIBILITY_LEDGER_UNAVAILABLE` (HTTP 503) en lugar de mostrar todo sin filtrar (violaría la política) o mostrar vacío (destruiría la operación). La recuperación es una sola acción: apagar `AGT002_RADAR_VISIBILITY`. Con el flag apagado —el estado por defecto— esta ruta es inalcanzable.

## 10. Invariantes

| # | Invariante | Cómo se hace mecánico |
|---|---|---|
| I-1 | AGT-002 nunca crea `psi_sales_opportunities` | Prueba estática: ningún módulo/migración del alcance menciona la tabla. Prueba PGlite: conteo de filas invariante antes/después de cada RPC. |
| I-2 | AGT-002 nunca escribe `internal_status` ni `converted_opportunity_id` | Mismas dos pruebas, más `grant` limitado a `select` sobre las tablas nuevas. |
| I-3 | AGT-002 nunca invoca la conversión | Prueba estática sobre `psi_convert_tender_to_opportunity` y `/api/tender-convert` en todos los archivos nuevos. |
| I-4 | AGT-002 nunca emite GO/NO-GO | Vocabulario prohibido en el validador de sobre (§8.3), verificado con un sobre que incluye `recommendation`. |
| I-5 | Ingesta cruda intacta | `persistTenderRadar` no se modifica; prueba de que su cuerpo no referencia gate ni ledger. |
| I-6 | Gate determinístico | Misma entrada + mismo `nowIso` ⇒ salida byte-idéntica, incluido el orden de `rule_ids`. |
| I-7 | Toda razón lleva evidencia y versión | Validado por el RPC de `071` (`22023`) y por el validador de sobre. |
| I-8 | A lo sumo un preanálisis canónico vigente por licitación, sea cual sea su resultado terminal | Índice único parcial `where canonical` (sin filtrar por `status`) en `072`. Prueba PGlite: la secuencia `mostrar_en_radar` → abstención → `no_mostrar_en_radar` deja exactamente una fila `canonical`, y es la última. |
| I-9 | El ledger es append-only salvo la degradación canónica | Trigger con la excepción exacta de `063` (`to_jsonb(old) - 'canonical'`). |
| I-10 | Idempotencia real | Reejecución con la misma clave no crea filas ni re-supersede; payload en conflicto ⇒ `23505`. |
| I-11 | Flag OFF ⇒ Radar idéntico | `filterRadarRowsByCanonicalPreanalysis` devuelve la misma referencia; prueba de igualdad profunda del payload de `GET /api/tenders` con y sin ledger poblado. |
| I-12 | Convertidas históricas siempre visibles | Prueba con flag ON, convertida sin preanálisis alguno ⇒ presente en el payload. |
| I-13 | El aprendizaje no elimina ni sostiene por sí solo un "no mostrar" | Prueba: señal negativa máxima sobre una licitación que sobrevive el gate ⇒ sigue pudiendo obtener `mostrar_en_radar`; y un sobre `no_mostrar_en_radar` cuya `evidence[]` sólo contiene elementos `learning_signal` falla la validación (§8.3). |
| I-14 | El aprendizaje no muta reglas | El artefacto DRAFT es incompatible de forma con toda entrada del runtime; prueba que alimentarlo al gate lanza. |
| I-15 | Sin cambios visuales | Prueba de que el diff no toca `src/`; forma de clave del objeto de salida idéntica a `dbTenderToPublic`. |
| I-16 | Paridad de backend | `npm run check:backend-parity`. |
| I-17 | Entrypoint apagado ⇒ no-op total | `runOnce()` con el flag apagado devuelve `{ status: 'disabled', stages: [] }` usando un doble de base de datos y un puente que **lanzan ante cualquier invocación**: si algo se llamara, la prueba falla. |
| I-18 | Orden real de la cadena | La prueba del pipeline con dependencias instrumentadas exige `stages` exactamente `['fetch','gate','ledger','claim','learning','agt','persist']`: el aprendizaje ocurre después del claim y antes de AGT-002, y la persistencia antes de cerrar el job. |
| I-19 | Una sola transición terminal por invocación | El worker llama `executeJob` a lo sumo una vez y cierra el job exactamente una vez (`complete` **o** `fail`); prueba que cuenta invocaciones de cada doble. |
| I-20 | Reserva vencida ⇒ terminal, nunca reejecución | PGlite: job `running` con `lease_expires_at` en el pasado ⇒ el `claim` siguiente lo deja `unavailable`/`lease_lost` y **no** lo devuelve como trabajo. |
| I-21 | La cola nunca ejecuta un gate no sobreviviente | `psi_enqueue_...` con una evaluación `eliminada` ⇒ `22023`; `psi_complete_...` con una corrida de otro `gate_evaluation_id` ⇒ `22023`. |
| I-22 | Sin repreanálisis de filas que no cambiaron | Encolar de nuevo con `source_row_hash`, `policy_version` y `context_version` iguales a los de la canónica vigente ⇒ `{'status':'satisfied'}` y cero llamadas al proveedor; cambiar cualquiera de los tres ⇒ `{'status':'created'}`. Se prueba con las tres formas de canónica —`mostrar_en_radar`, `no_mostrar_en_radar` y abstención—, porque el corto circuito mira `canonical` y no `status`. |
| I-23 | El aprendizaje entra sólo como contexto | Prueba de que las señales aparecen únicamente en la entrada del preanálisis: ni el gate ni el filtro de visibilidad reciben `learningSignals` en ninguna firma, y un fallo del retrieval cierra el job sin llamar al proveedor. |
| I-24 | El entrypoint no se auto-habilita | Prueba estática de `ops/agt002-radar-pipeline/`: el runner no contiene `setInterval`/`setTimeout`/bucle/`fetch` propio ni `systemctl`, y `env.example` declara `AGT002_RADAR_GATE=false`. |
| I-25 | Toda corrida terminal supersede a la anterior | PGlite: tras cada `psi_record_agt002_radar_preanalysis_run` —incluidas abstención y `no_mostrar_en_radar`— la canónica previa queda `canonical = false` con el resto de columnas idénticas (`to_jsonb(old) - 'canonical'`), y la nueva la referencia en `supersedes_run_id`. No existe parámetro `canonical` en el RPC. |
| I-26 | El preanálisis nunca se declara exento de revisión humana | `check` de `072` sobre `result -> 'human_review_required' = 'true'::jsonb` (`22023` vía RPC) y validador de sobre: `false`, `"true"`, `1`, `null` y la clave ausente fallan. |
| I-27 | Emparejamiento cerrado de estado y veredicto | Las tres combinaciones imposibles (`completed`+`no_concluyente`, `abstained`+`mostrar_en_radar`, `abstained`+`no_mostrar_en_radar`) fallan en el validador de sobre **y** en el `check` de `072`; se prueban las seis combinaciones. |
| I-28 | Ocultar no es descartar | Prueba con flag ON: una licitación con canónica `no_mostrar_en_radar` desaparece del payload, su fila de `psi_public_tenders` queda byte-idéntica (`internal_status` incluido), y una corrida posterior `mostrar_en_radar` la devuelve al payload sin ninguna otra acción. |

## 11. Errores

**Códigos de frontera de runtime** (patrón `runtime_boundary_code` **[EXISTE]** en `agt002-preview-runtime.js`):

`AGT002_RADAR_GATE_INPUT_INVALID`, `AGT002_RADAR_GATE_POLICY_MISMATCH`, `AGT002_RADAR_RUNTIME_CONFIG_INVALID`, `AGT002_RADAR_RUNTIME_BRIDGE_CLIENT_INVALID`, `AGT002_RADAR_PREANALYSIS_TIMEOUT`, `AGT002_RADAR_PREANALYSIS_INVALID_OUTPUT`, `AGT002_RADAR_PREANALYSIS_EVIDENCE_MISSING`, `AGT002_RADAR_PERSISTENCE_FAILURE`, `AGT002_RADAR_LEASE_LOST`, `AGT002_RADAR_CAPACITY_UNAVAILABLE`, `AGT002_RADAR_LEARNING_SIGNALS_INVALID`, `AGT002_RADAR_VISIBILITY_LEDGER_UNAVAILABLE`, `AGT002_RADAR_PIPELINE_DISABLED`, `AGT002_RADAR_PIPELINE_CONFIG_INVALID`, `AGT002_RADAR_QUEUE_UNAVAILABLE`.

`AGT002_RADAR_PIPELINE_DISABLED` no es un error de ejecución: es el código que acompaña al resultado `{ status: 'disabled' }` para que un operador que lee el log sepa **por qué** no pasó nada. El proceso sale con código 0.

**Códigos SQL**, alineados con el repositorio: `22023` forma/validación inválida, `23505` clave de idempotencia en conflicto, `P0002` referencia inexistente, `55000` violación de estado de cola (identidad inmutable, reserva inválida o vencida, transición desde estado terminal).

**Clasificación en el worker**: la función de clasificación mapea a los seis códigos cerrados del §8.6, con la misma técnica de subcadenas de `classifyAgt002ReanalysisWorkerError` **[EXISTE]** (`TIMEOUT`→`timeout`, `PERSIST`→`persistence_failure`, `LEASE`→`lease_lost`, `CAPACITY`/`QUOTA`→`capacity_unavailable`, `INVALID`/`VALIDATION`/`ENVELOPE`→`invalid_output`). Un error no reconocido cae en `provider_error`, nunca en un estado terminal exitoso.

## 12. Rollout

| Etapa | Acción | Criterio de salida |
|---|---|---|
| E0 | Ambos flags OFF. Migraciones `071`/`072` aplicadas en entorno no productivo. Entrypoint creado, **no instalado**. | Suites verdes; `GET /api/tenders` byte-idéntico al de antes; ejecutar el entrypoint imprime `disabled` y sale 0 sin tocar la base. |
| E1 | `AGT002_RADAR_GATE=true` **sólo en el `EnvironmentFile` de un entorno no productivo**. Primero la auditoría read-only del §13; luego el entrypoint a mano, una invocación a la vez (`node ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs`), sin habilitar el `timer`. | Cola drenando de a un job; ledger poblado; cero filas tocadas en `psi_public_tenders`; Radar sin cambio observable. |
| E1b | Habilitar el `timer` en el entorno no productivo, con autorización separada. | Drenado sostenido dentro de `AGT002_RADAR_PREANALYSIS_DAILY_MAX_RUNS`; ningún job `running` con reserva vencida sin cerrar. |
| E2 | Auditoría histórica (§13) sobre datos reales. | Informe con eliminadas por regla, muestras y **`uncovered_visible_tenders = 0`**. |
| E3 | `AGT002_RADAR_VISIBILITY=true`, con autorización separada y explícita. | Radar muestra sólo convertidas históricas + no convertidas con preanálisis canónico `mostrar_en_radar`. |

**Rollback de cada etapa:** poner el flag en cualquier valor distinto de `'true'`/`'1'` (o eliminarlo) y, si se llegó a E1b, `systemctl disable --now` del `timer`. No requiere migración inversa. El ledger se conserva: es historia, no estado mutable. Los jobs `queued` que queden sin drenar son inertes: nada los ejecuta si el entrypoint no corre, y el gate volverá a corto circuitar en `satisfied` cuando exista canónica.

**Rollback de esquema:** `supabase/rollbacks/072_...` primero, luego `supabase/rollbacks/071_...`. Ninguno toca `psi_public_tenders`.

**Condición dura previa a E3:** el backfill debe cubrir el 100% de las licitaciones no convertidas hoy visibles que sobreviven el gate. Con una sola sin cubrir, encender el flag la ocultaría sin haberla evaluado. Por eso el criterio es conteo cero, no un umbral porcentual. "Cubrir" significa **tener corrida canónica**, no tener veredicto `mostrar_en_radar`: una licitación con canónica `no_mostrar_en_radar` o con abstención `no_concluyente` está cubierta —fue evaluada y dejó evidencia auditable— aunque E3 la oculte. Lo prohibido es ocultar por ausencia de preanálisis, no ocultar por un preanálisis que concluyó. El informe de E2 debe por tanto reportar, además de `uncovered_visible_tenders = 0`, cuántas visibles hoy quedarían ocultas por cada uno de los dos veredictos no-mostrar, con muestras: ese conteo es el impacto real de encender E3 y se revisa antes de autorizarlo.

## 13. Auditoría histórica y corrida read-only

Antes de cualquier persistencia contra datos reales:

1. **`scripts/agt002-radar-gate-historical-audit.mjs`** — lee `psi_public_tenders` por REST con la service key, evalúa el gate **en memoria** y reporta: total, sobrevivientes, eliminadas por `rule_id`, `data_gaps` por tipo, muestras verificables por regla (identidad, campo, valor observado), cuántas convertidas históricas serían eliminadas por el gate (deben seguir visibles por I-12), y `uncovered_visible_tenders` —visibles hoy, no convertidas, que sobreviven el gate y **no** tienen corrida canónica—. Cuando el ledger de `072` ya está poblado, cruza además cada visible con su canónica y reporta el desglose por `visibility_verdict` (`mostrar_en_radar` / `no_mostrar_en_radar` / `no_concluyente`) con muestras verificables, que es el insumo de la condición dura previa a E3 (§12). **No escribe nada.**
2. **`scripts/agt002-radar-preanalysis-dryrun.mjs`** — para un conjunto acotado de licitaciones sobrevivientes, construye la entrada cerrada, ejecuta el proveedor y **valida** el sobre, imprimiendo el resultado sin llamar a ningún RPC de persistencia. **No escribe nada.**
3. **`scripts/agt002-radar-learning-signals-report.mjs`** — ejecuta el retrieval gobernado y emite señales y artefacto DRAFT a `stdout`. **No escribe nada.**

Los tres exigen `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`, y no aceptan ninguna bandera de escritura. La persistencia contra producción es una orden separada, posterior a leer estos informes, y requiere reconfirmar antes el commit realmente desplegado (§3.7).

## 14. Verificación

- Unitarias e integración: `node --test tests/agt002-radar-*.test.mjs`, que incluye la cadena (`tests/agt002-radar-pipeline.test.mjs`), la cola en PGlite (dentro de `tests/agt002-radar-preanalysis-ledger-pglite.integration.test.mjs`) y la forma del entrypoint (`tests/agt002-radar-pipeline-systemd.test.mjs`, espejo de `tests/agt002-reanalysis-worker-systemd.test.mjs` **[EXISTE]**).
- Regresión del Radar existente: `node --test tests/tender-radar-*.test.mjs`.
- Suite completa: `node --test --test-force-exit tests/*.test.mjs`.
- `npm run check:backend-parity`, `npx tsc --noEmit`, `npm run build`, `git diff --check`.

## 15. Riesgos aceptados

1. **Modalidad ausente en `raw`.** Una licitación de contratación directa cuya fila persistida no conserve modalidad sobrevivirá el gate. Se hace visible como `data_gap`, no se oculta. Corregirlo exige enriquecer la ingesta, que está fuera de alcance.
2. **Zona horaria de la fecha.** El gate usa `America/Bogota` explícitamente; `server/index.js::tenderDaysUntil` **[EXISTE]** usa la zona local del proceso. Ambas conviven porque el gate no reemplaza a `tenderDaysUntil`; la divergencia queda documentada aquí y no se resuelve en este alcance.
3. **Costo del proveedor en el backfill.** El preanálisis es una llamada por licitación sobreviviente. `AGT002_RADAR_PREANALYSIS_DAILY_MAX_RUNS` lo acota; el backfill completo puede requerir varios días de operación antes de habilitar E3.
4. **Suposición de producción.** Mientras no se reconfirme el commit desplegado, cualquier estimación de impacto sobre datos reales es provisional.
5. **Ritmo del drenado.** Un job por invocación significa que el backfill avanza al ritmo del `timer`, no al de la página leída. Es una elección: acota el costo y el radio de un fallo. Si el ritmo resulta insuficiente, la palanca es la frecuencia del `timer` (y el cupo diario), nunca un bucle interno que reintroduzca el modo de falla que la cola elimina.
6. **Jobs `queued` de una política anterior.** Si `AGT002_RADAR_GATE_POLICY_VERSION` cambia con jobs sin drenar, esos jobs conservan la política congelada en su fila. Se ejecutan igual y quedan atribuidos a la versión con la que se encolaron; el gate volverá a evaluar la fila bajo la nueva política en la siguiente corrida y producirá un `source_row_hash`/job nuevo. No se purgan automáticamente: purgar cola es una acción humana explícita, fuera de este alcance.
