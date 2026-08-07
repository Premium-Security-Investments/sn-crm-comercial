# CURRENT — SIIO Comercial / Licitaciones / Vig‑IA

**Corte autoritativo:** 2026-08-06 11:52 COT · 2026-08-06 16:52 UTC
**Producción:** https://seguridad-nacional-crm.vercel.app
**Commit productivo:** `19987140def78d140cbca197b84f32467b6721e2`
**Deployment Vercel:** `dpl_5jV5B4PGR9ZGHHZkM2gmJYr6kRz5` · `READY`

## 1. Regla funcional y de autoridad vigente

El encargado de Licitaciones selecciona manualmente un caso del Radar y lo convierte en **Oportunidad**. La existencia de una oportunidad, un análisis completado o una recomendación condicionada no equivale a GO ni autoriza preparar o presentar una oferta.

Vig‑IA/AGT‑002 puede analizar, organizar evidencia, señalar brechas y proponer acciones. Nunca puede:

- convertir procesos del Radar en oportunidades;
- decidir GO/NO‑GO;
- aprobar requisitos, evidencias o propuestas de aprendizaje;
- asignar silenciosamente compromisos humanos;
- firmar, enviar o presentar ofertas.

Toda decisión humana debe ser trazable y asociarse al análisis vigente. El orden operativo es: **alertas de descarte → habilitantes → técnico → financiero/ejecución → estratégico**. Sin evidencia permitida, Vig‑IA debe abstenerse.

## 2. Estado confirmado por frente

| Frente | Estado confirmado | Gate pendiente |
|---|---|---|
| **E1–E3** | Pipeline durable, canonicidad y contexto v2 previamente verificados en producción | Mantener idempotencia, leases y cero fallback silencioso |
| **E4** | La recuperación/evidence packet fue utilizada por la ruta que produjo el canary E5 vigente | No inferir cobertura completa de SharePoint ni aplicabilidad empresarial por presencia documental |
| **E5** | **Canary canónico completado y verificado** con corpus jurídico `legal-corpus-v1.1` | La revisión jurídica y el GO/NO‑GO siguen siendo humanos |
| **E6** | Scheduler, endpoint, bridge, persistencia y autoridad probados técnicamente; secreto reparado y límites explícitos | Primer mensaje humano real en Mesa Vig‑IA y un único canary productivo |
| **F2 SIIO** | Código, migración de seguridad y deployment productivo completados | QA visual autenticado operado por Juan |
| **Identidad Vig‑IA** | **Desplegada y aprobada visualmente**: Vig‑IA Gerencial, Vig‑IA Licitaciones y Vig‑IA Comercial | Ninguno para identidad; no reemplaza el QA F2 restante |

El rollout visual de identidad está cerrado. No se declara rollout visual completo de F2 ni activación continua de E6 mientras esos gates permanezcan abiertos.

## 2.1 Fundaciones del análisis integral — F1/F2 en rama, no desplegadas

**Corte de desarrollo:** 2026-08-06 10:43 COT · 2026-08-06 15:43 UTC

**Rama:** `feat/agt002-v3-foundations`

**Base:** `origin/main` en `f85907d12d92d8ab956efd2ee9d6bfd264022c12`

Este lote corrige primero las fundaciones de confiabilidad aprobadas para el análisis integral. Permanece sólo en rama: **no se aplicó la migración 063, no se hizo push/PR/merge/deploy y producción no cambió**.

### F1 — canonicidad transaccional

- Migración aditiva `063_agt002_canonical_promotion.sql` y rollback correspondiente.
- Índice único parcial: máximo un run `canonical=true,status='completed'` por oportunidad.
- Promoción serializada por oportunidad; el canónico anterior se desmarca sin reescribir su payload.
- Idempotencia exacta preservada incluso después de supersesión; una misma key con payload distinto falla.
- Backend distingue un replay histórico (`canonical=false,current=false`) del análisis vigente.
- Los runs v2 permanecen consultables; no se borraron ni reinterpretaron.

### F2 — 17 clases tipadas y cobertura explícita

- Módulo `agt002-company-evidence-classes.js` con catálogo cerrado de las 17 clases de la migración 061.
- Dimensiones separadas: presencia, revisión, vigencia, aplicabilidad y cumplimiento.
- Cobertura explícita: disponible, seleccionada, omitida, vencida, inaccesible y pendiente de revisión.
- Una clase ausente no desaparece: se representa como `inaccessible` y `pending_review`.
- Sólo se transportan referencias y metadatos; no payload documental, PII, armas, banca ni anexos nominales.

### Evidencia mecánica del lote

- Pruebas focales F1/F2/paridad: `4/4` verdes.
- Regresión AGT‑002: `121/121` verdes.
- Suite completa: `360` verdes + `1` fallo baseline, reproducido en un worktree puro de `origin/main` (`module-permissions-migration-pglite.test.mjs`, `modulo_siio_gerencial` extra para Director).
- Paridad Express/Vercel: `OK`.
- `npm audit --omit=dev`: `0` vulnerabilidades.
- Build y `git diff --check`: `OK`.
- Revisión independiente Claude Opus 4.8: `APPROVE`, sin P0/P1.

### Observaciones no bloqueantes

- Dos llamadas simultáneas con la misma key nueva pueden devolver un `23505` genérico a la segunda; no duplican ni corrompen y el reintento es idempotente.
- `coverage` son flags independientes, no una partición mutuamente excluyente.
- `source_reference` está seleccionado pero el contrato emite una referencia sintética equivalente.
- El borde `expiry == asOf` se considera vigente.

### Contrato integral v3 — runtime implementado en rama, flag apagado por defecto

**Corte de este bloque:** 2026-08-07 · **Rama:** `feat/agt002-v3-foundations` (misma rama; no se hizo merge/push/PR/deploy)

- Auditoría: `docs/superpowers/specs/2026-08-06-agt002-integral-analysis-v3-audit.md`.
- Diseño cerrado: `docs/superpowers/specs/2026-08-06-agt002-integral-analysis-v3-design.md`.
- Plan TDD ejecutado tarea por tarea (1–9), TDD estricto RED→GREEN→regresión, un commit por tarea: `docs/superpowers/plans/2026-08-06-agt002-integral-analysis-v3-implementation-plan.md`.
- Verificación local detallada: `docs/verification/2026-08-07-agt002-integral-v3-local.md`.

**Qué queda implementado y probado (todo detrás de `AGT002_INTEGRAL_CONTRACT_V3`, apagado por defecto):**

- Validador puro cerrado (`agt002-integral-analysis-v3.js`): forma exacta, orden institucional descarte→habilitantes→técnico→financiero/ejecución→estratégico, evidencia‑o‑abstención, cinco ejes independientes (presencia/revisión/vigencia/aplicabilidad/cumplimiento) sin derivarse entre sí, controles jurídico/operativos (escalamiento, hitos, acciones sin PII, `external_side_effect` siempre falso, validación humana siempre pendiente).
- Proyección v2 determinística (`agt002-v3-compatibility.js`): deriva `recommendation/summary/strengths/weaknesses/blockers/questions/unverified/next_action` sólo desde `integral_analysis` validado; `critical_open_count` comparte exactamente el mismo criterio que las preguntas críticas proyectadas.
- Dispatch de versión explícito, nunca por forma del payload (`agt002-preview-contract.js`, `agt002-tender-adapter.js`): el modelo v3 sólo puede devolver `{ integral_analysis }`; v2 y v3 se rechazan mutuamente.
- **Origen de la categoría (gap C-3 de la auditoría), cerrado sin fabricar:** `agt002-integral-category-manifest.js` mapea `front: technical→technical` y `front: financial→financial_execution` por identidad honesta; cualquier otro caso (`front: legal`, o una reclasificación) exige una anulación gobernada explícita o falla cerrado — nunca adivina.
- **Origen de los cinco ejes (gap de esta sesión, cerrado):** `evidence_state` ya NO es salida libre del modelo. `agt002-evidence-state-manifest.js` es un builder puro que deriva, por `requirement_id`, un mapa gobernado desde un enlace curado explícito `evidenceClassLinkByRequirementId → evidence_class_id` (uno de los 17 reales, `agt002-company-evidence-classes.js`, migración 061); cada eje (`presence/review/validity/applicability`) se lee de su propia columna gobernada de esa clase, nunca de otro eje ni de la mera presencia documental; `compliance` nunca sale de `"unknown"` porque no existe todavía una vía de escritura real para esa determinación. Sin enlace curado (el caso por defecto hoy, `{}`), o si la clase enlazada no fue observada en el run, el requisito abstiene al estado seguro `{presence:"unknown",review:"not_reviewed",validity:"unknown",applicability:"unknown",compliance:"unknown"}` — nunca lanza excepción por ausencia de señal (sólo por gobernanza inválida, p. ej. un `evidence_class_id` fuera del catálogo). `validationContext.evidenceStateManifest` (cobertura 1:1 con el manifiesto) es ahora un campo obligatorio del validador (`agt002-integral-analysis-v3.js`): cualquier `evidence_state` que el modelo declare para una unidad `tender_requirement` que no coincida exactamente con ese mapa gobernado se rechaza — incluso si esa combinación es individualmente válida por enum e invariantes cruzados. El engine (`agt002-preview-engine.js`) construye este mapa de forma fail-closed dentro de `buildIntegralV3ValidationContext` y también lo entrega como `evidence_state_governed` en el `requirement_manifest` que ve el proveedor, para que el modelo tenga una oportunidad real de reproducirlo — la validación posterior nunca confía en que lo haya hecho. Las unidades `strategic_consideration` (sin `requirement_id`) quedan fuera de esta capa de gobernanza y conservan sólo los chequeos previos de enum/invariantes cruzados.
- Engine (`agt002-preview-engine.js`, `agt002-preview-input.js`): ensambla el envelope gobernado (run/snapshot/contexto/cobertura/corpus/uso); el proveedor nunca puede forjar esos campos (probado).
- Persistencia (`agt002-preview-persistence.js` + PGlite con la migración 063 local): v3 persiste `integral_analysis` + proyección v2 atómicamente; v2 histórico queda byte‑idéntico; coexistencia canónica probada (un run v2 histórico se desmarca sin reescribirse, el v3 lo supera, exactamente un canónico completado permanece, replay idempotente).
- Wiring de servidor (`agt002-preview-runtime.js`): paridad Express/Vercel es estructural — ambas rutas comparten el mismo módulo; ningún parámetro de solicitud puede activar v3.
- UI real de cinco fases (`TenderIntegralAnalysisV3View.tsx`): reemplaza el preview sintético de `UNITS` fijos; consume únicamente `analysis.integral_analysis` (opcional, no renderiza nada si está ausente); sin nombre de institución/expediente hardcodeado; preguntas humanas y GO/NO-GO permanecen en sus componentes existentes, sin duplicarse.

**Qué NO se hizo en este bloque (gates siguientes, explícitos):**

- No hay wiring real de `companyEvidenceClassesProvider`/`categoryOverrides`/`evidenceClassLinkByRequirementId` a una fuente de datos gobernada en `server/index.js`/`api/[...path].js` — el runtime falla cerrado sin esa inyección explícita. Con el mapa por defecto (`{}`), hoy todo requisito real abstiene sus cinco ejes al estado seguro hasta que se cure ese enlace requisito→clase de evidencia.
- No se ejecutó un caso E5 controlado con datos reales de Rama Judicial ni QA visual con etiquetas reales.
- No se activó el flag en ningún ambiente; no se aplicó ninguna migración remota; no hubo push/PR/deploy.
- Ningún revisor independiente fuera de esta sesión evaluó el trabajo (ver `docs/verification/2026-08-07-agt002-integral-v3-local.md` §4).

### Gate siguiente

1. Diseñar y construir el wiring real de evidencia empresarial (17 clases) y anulaciones de categoría gobernadas antes de cualquier caso con datos reales.
2. Ejecutar un caso E5 controlado sobre el snapshot real de Rama Judicial con el flag activado sólo para esa prueba, verificando cobertura 1:1 y abstención donde falte señal.
3. QA visual autenticado de la UI real (Juan) antes de activar el flag para cualquier usuario.
4. Sólo entonces, decisión humana sobre activar `AGT002_INTEGRAL_CONTRACT_V3` en un ambiente real, con canary único y sin timer.

## 3. F2 — coherencia y seguridad transversal de SIIO

### Entregado

- PR **#77**: implementación F2.
- PR **#78**: corrección de colisión de migración.
- Migración definitiva: `062_siio_f2_security_coherence.sql`.
- Commit posterior del lote E6/documentación: `2904efba2be9db9fc4622bd1f45d77b609398c4d`.
- Deployment productivo: `READY`; alias canónico responde HTTP 200.

### Controles verificados

- Director permanece fuera del acceso operativo de SIIO.
- Junta consume informes en estado `presentado`; no opera el expediente.
- Nómina `restringido` no se expone por defecto.
- SIIO falla explícitamente si falta su fundación/configuración requerida.
- Privilegios directos inseguros post‑migración: `0`.
- Escrituras prohibidas post‑migración: `0`.
- Conteos de filas antes/después: idénticos; `data_preserved=true`.
- `service_role` conserva únicamente los accesos mínimos requeridos.

### Identidad visible desplegada

- PR **#81** fusionado en `main`: `19987140def78d140cbca197b84f32467b6721e2`.
- Deployment productivo: `dpl_5jV5B4PGR9ZGHHZkM2gmJYr6kRz5` · `READY`.
- Alias canónico verificado con HTTP 200 y asset `index-FSatnFHf.js`.
- QA visual autenticado aprobado por Juan sobre el catálogo institucional gobernado.
- Identidades visibles: **Vig‑IA Gerencial**, **Vig‑IA Licitaciones** y **Vig‑IA Comercial**.
- `AGT-001/002/003` permanecen como IDs internos; **Agente Comercial PSI** permanece como router y Agente IT no entra al catálogo SIIO.
- No hubo migraciones, cambios de DB, productores, permisos ni automatización de decisiones.

### Gate abierto

Falta QA visual autenticado. Juan opera la UI; Hermes da **un solo paso** y espera captura. No se declara cierre visual sin esa evidencia.

## 4. E5 — corpus jurídico y run canónico vigente

Run productivo verificado:

```text
analysis_run_id=50f798f0-a526-421f-bd26-7b0e5dd0d5da
corpus_version=legal-corpus-v1.1
corpus_id=fc392e00-0363-4307-b2c4-80835ac474ca
recommendation=advance_conditionally
critical_open_count=3
human_review_required=true
```

Gates aprobados:

- metadata canónica correcta;
- snapshot del run era el más reciente para la oportunidad;
- binding exacto al corpus publicado;
- evento terminal `completed` presente;
- cero claims activos;
- obligaciones jurídicas sólo citan la allowlist verificada;
- hechos documentales no se renombraron como derecho;
- cinco fuentes inciertas quedaron en revisión humana y cubiertas por abstención;
- texto de abstención canónico: `No verificado jurídicamente; requiere revisión humana`;
- no existe campo decisorio, firma, aprobación, envío o presentación autónoma.

E5 está técnicamente cerrado. Su recomendación condicionada no reemplaza la decisión humana.

## 5. E6 — continuidad hacia la Mesa Vig‑IA

E6 lleva el expediente, snapshot, análisis, evidencia, preguntas y versiones a una conversación durable después del gate humano. El worker procesa como máximo un job por invocación y persiste mensajes/eventos de forma append‑only.

### Root cause y reparación

El scheduler recibía `403 No autorizado` cuando el drain estaba activo. Se confirmó desajuste del secreto dedicado entre el host y Vercel. Con el drain apagado, la misma ruta devuelve `404 No disponible`, que es el comportamiento fail‑closed esperado.

Se completó:

- timer detenido y deshabilitado durante la reparación;
- secreto dedicado rotado coordinadamente, sin exponer su valor;
- artefactos systemd instalados byte‑idénticos a Git;
- archivo de entorno del host con modo `0640`;
- límites productivos explícitos:
  - `MAX_CONCURRENT=1`;
  - `DAILY_MAX_JOBS=1`;
  - `TIMEOUT_MS=45000`;
  - `SWEEP_MAX=5`;
- `AGT002_WORKBENCH_DRAIN_ENABLED=false`;
- deployment productivo posterior a la rotación: `READY`;
- probe autenticado con drain apagado: HTTP 404, sin fuga del secreto.

PR **#79** añadió la prueba `secreto esperado ausente → 403, cero DB/RPC y cero bridge`. Revisión independiente: cero Critical/Important.

### Estado de cola al corte

```text
total_jobs=0
queued=0
active_claims=0
claimed_today=0
```

No se fabricó una decisión humana, un GO ni un mensaje productivo para aparentar éxito.

### Evidencia mecánica

Pasaron secuencialmente:

- worker route;
- endpoint estático;
- scheduler ops;
- runtime;
- worker, persistence y responder;
- paridad Express/Vercel;
- build;
- lifecycle E6 en PGlite;
- autoridad humana estática y dinámica.

El bridge está activo, pero su salud no sustituye la prueba del Workbench: son componentes y secretos separados.

## 6. Próximos pasos autorizables

### Paso 1 — QA visual F2

**Responsable:** Juan opera; Hermes guía y verifica.
**Acción:** abrir producción, iniciar sesión normalmente y enviar una captura de la pantalla inicial.
**Criterio de cierre:** recorrido autenticado confirma acceso por rol, Junta `presentado`, ausencia de nómina restringida y errores explícitos esperados.
**Límite:** un paso por captura; no declarar rollout por HTTP 200 o deployment `READY`.

### Paso 2 — preparar un único canary humano E6

**Precondición:** F2 visual sin bloqueantes críticos y una oportunidad real ya convertida, con gate humano válido.
**Responsable:** Juan escribe un único mensaje real en la Mesa Vig‑IA; Hermes no lo suplanta.
**Estado previo obligatorio:** timer deshabilitado, drain apagado, cola sin claims y límites `1/1`.

### Paso 3 — ejecutar el canary técnico E6

**Responsable:** Hermes, después del mensaje humano.
**Secuencia:**

1. inventario read‑only de cola y snapshot;
2. habilitar el drain sólo para la ventana controlada;
3. ejecutar una única invocación manual del servicio, sin timer;
4. verificar `queued → claimed → completed` o fallo terminal explícito;
5. comprobar mensaje, eventos, acciones requeridas, versiones y linaje;
6. comprobar que no existe decisión, aprobación, firma, envío o presentación de IA;
7. volver a `drain=false` al terminar el canary.

**Criterio de cierre:** exactamente un job procesado, una persistencia terminal válida, cero duplicados, cero claims activos y autoridad humana intacta.

### Paso 4 — decisión humana sobre operación continua

Sólo después del canary, Juan decide si se habilita el timer. Si se autoriza:

- conservar concurrencia `1` y cuota diaria inicial `1`;
- activar el timer;
- verificar un ciclo vacío posterior;
- mantener kill switch y rollback operativo por flags;
- no ejecutar rollback SQL 045/046/048 con datos dependientes.

### Paso 5 — siguiente evolución de producto, separada del cierre operativo

Después de cerrar F2 visual y E6 humano, diseñar la siguiente versión del análisis integral:

- matriz por requisito del pliego;
- evidencia empresarial tipada y aplicabilidad por caso;
- bloqueadores con acción, responsable sugerido, hito y condición de cierre;
- cobertura/omisiones explícitas de SharePoint;
- compatibilidad con runs históricos;
- UI compacta sin KPI duplicado ni panel jurídico desconectado.

Ese trabajo requiere diseño y aprobación humana antes de código. No debe mezclarse con el canary E6.

## 7. Estado operativo seguro al corte

- Producción desplegada y disponible.
- F2 técnicamente aplicado; QA visual pendiente.
- E5 canónico completado; decisión humana pendiente según cada caso.
- E6 desplegado pero **drain apagado y timer deshabilitado**.
- Cero jobs, cero claims y cero procesamiento masivo.
- No existe autorización para que Vig‑IA convierta, decida, firme, envíe o presente.
