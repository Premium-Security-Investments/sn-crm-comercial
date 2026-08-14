# CURRENT — SIIO Comercial / Licitaciones / Vig‑IA

## 0. Corte autoritativo final — integración V3 y canary Manizales detenido, 2026-08-14 08:29 COT

**Este bloque reemplaza como autoridad a todos los cortes e historiales posteriores de este archivo.** Se verificó contra Git local/remoto, GitHub, pruebas frescas, Supabase productivo, Vercel y el bridge. Las secciones desde **“Historial anterior”** conservan trazabilidad, pero no deben usarse para inferir estado vigente cuando contradigan este bloque.

### 0.1 Resumen ejecutivo

El lote AGT‑002/V3 fue integrado mediante PR **#85** y está desplegado en la aplicación productiva. La migración lógica 066 tiene sus **seis efectos materiales exactos** en Supabase productivo, pero **no figura en el ledger** `supabase_migrations.schema_migrations`. La aplicación y el bridge están disponibles. Sin embargo, **no se ejecutó el canary V3 de Manizales**: el operador fijo conserva un guard exclusivo de E4 que rechaza el perfil E5/V3 antes de invocar el proveedor. No hubo consumo Codex asociado al canary, run V3, claim activo, GO/NO‑GO, firma, envío ni presentación. Sí hubo antes de la integración una única reproducción externa sintética y no productiva, sin datos de Manizales, descrita en §0.8.

Estado de cierre: **integración y deployment completados; canary cancelado por bloqueo material fail‑closed; corrección del operador y reconciliación del ledger pendientes de gate humano.**

### 0.2 Git — local, remoto y commits

#### Local

- Worktree de cierre: `/root/worktrees/siio-vigia-v3-foundations`.
- Rama documental final: `docs/agt002-final-close-20260814`.
- HEAD de código integrado antes del commit exclusivamente documental de este corte: `0536746283aa3ccdc078c1c979ca24556b41d1c8`.
- El commit que contiene este bloque se reporta al finalizar el cierre; no se incluye su propio hash dentro del archivo para evitar una referencia autorrecursiva imposible.
- Se descartó la prueba RED incompleta de la rama histórica `fix/agt002-fixed-canary-e5`. El mandato posterior de cierre productivo abrió `fix/agt002-fixed-canary-e5-v3`, donde la corrección mínima ya existe en el commit local `288c500`, todavía pendiente de merge y deploy en este corte intermedio.
- Se retiraron del worktree temporal de deployment el export y los runners de canary creados sólo para diagnóstico. Ese worktree volvió a limpio.

#### Remoto

- `origin/main`: `0536746283aa3ccdc078c1c979ca24556b41d1c8` al corte.
- PR **#85**, `fix/agt002-codex-schema-closure → main`: **MERGED** el `2026-08-14T12:56:56Z`.
- URL: `https://github.com/Premium-Security-Investments/sn-crm-comercial/pull/85`.
- Commit de merge: `0536746283aa3ccdc078c1c979ca24556b41d1c8` (`fix(agt002): close Codex V3 schema and stabilize pre-GO (#85)`).
- Padres del merge: `701822d91de15ef7248961689b95d890da19ff0e` y `2f00c5f55222da6d7e3428139f94b92488effd12`.
- Commits de la rama integrada: `26ae07a`, `71b2550`, `7345e60`, `5df620a`, `b462628`, `9d59c32`, `7819ede`, `b3cc060`, `4ceed28`, `33e96c8`, `48ccf11`, `4500478`, `3150a78`, `2f00c5f`.
- GitHub no reportó checks ni workflow runs asociados al merge (`statusCheckRollup=[]`, `gh run list=[]`); por tanto, **no se declara CI GitHub verde**. La confianza proviene de los gates locales frescos descritos en §0.4.

#### Limpieza y alcance

Los dos worktrees usados por este proceso quedaron limpios antes del commit documental: el worktree de cierre y `/tmp/siio-deploy-0536746-TTvTxS`. El inventario global encontró cuatro worktrees con cambios preexistentes o ajenos —documentación de navegación, un `__pycache__`, dos imágenes AGT‑003 y otro `CURRENT.md` histórico— que no fueron tocados para no invadir trabajo activo. “Git limpio” en este cierre significa **los worktrees de este proceso**, no la destrucción de trabajo independiente en otros worktrees.

### 0.3 Diff real integrado por PR #85

Diff mecánico del merge `0536746`:

```text
33 files changed
1,681 insertions(+)
186 deletions(-)
```

El cambio comprende contrato/schema V3 recursivamente cerrado, validación y persistencia pre‑GO, observabilidad segura, cliente/bridge Codex, runtime Express/Vercel, análisis gobernado de Manizales, migración/rollback 066 y pruebas asociadas. Incluye, entre otros, `agt002-preview-contract.js`, `agt002-preview-codex-client.js`, `agt002-preview-runtime.js`, `agt002-pre-go-analysis.js`, `server/index.js`, `api/[...path].js`, `agt002-hetzner-bridge-server.js`, `supabase/migrations/066_agt002_manizales_integral_governance.sql` y 14 archivos de pruebas AGT‑002. No incorpora el parche posterior del operador E4/E5: ese intento quedó únicamente como RED local y fue descartado.

### 0.4 Pruebas y revisión

Verificación fresca sobre `0536746`, sin proveedor ni datos productivos escritos:

- regresión integral serial `node --test --test-concurrency=1 tests/agt002-*.test.mjs`: **266/266**;
- runner Workbench `npm run test:agt002-runtime`: **11/11**;
- migración 066 PGlite: **1/1**;
- `npm run check:backend-parity`: **OK**;
- `npm run build`: **OK**;
- `git diff --check`: **OK**.

El build conserva el warning conocido de chunk JavaScript >500 kB; no bloquea compilación y no fue introducido por el cierre documental. La revisión independiente Claude Code Opus del lote de código previo a integración devolvió **`passed=true`**, sin errores lógicos, de seguridad o documentación material. GitHub no contiene review formal ni checks adjuntos al PR; no se debe reinterpretar la revisión local como aprobación registrada en GitHub. Dos intentos read-only de revisión documental Sonnet agotaron su límite de turnos sin emitir veredicto; no se cuentan como gate aprobado.

El intento TDD histórico produjo RED **19/21** y fue descartado sin GREEN. El mandato posterior repitió el ciclo desde limpio con Claude Code Sonnet: RED mecánico **18/22** —cuatro fallos esperados— y GREEN **22/22**. La corrección actual conserva E4, admite exclusivamente E5/V3 cuando `legal=true` y `v3=true`, y rechaza combinaciones parciales o ambiguas antes de loaders/proveedor.

### 0.5 Migración 066 — código, efecto material y ledger

Artefactos integrados:

- `supabase/migrations/066_agt002_manizales_integral_governance.sql`;
- `supabase/rollbacks/066_agt002_manizales_integral_governance_rollback.sql`.

Estado productivo read-only:

- existen exactamente **6** filas de Manizales en `psi_agt002_integral_governance_overrides`;
- las seis coinciden 1:1 con el conjunto aprobado: tres `category_override=habilitating` y tres enlaces `rup`, `rce_policy`, `collective_life_policy`;
- todas están `current=true`, `version=3`, con el curador y timestamp aprobados;
- el conjunto no presenta drift material;
- `supabase_migrations.schema_migrations` devuelve **0** registros para versión/nombre 066.

Conclusión autoritativa: **la 066 está aplicada materialmente, pero no está registrada en el ledger de migraciones**. No debe reaplicarse a ciegas: aunque el SQL es idempotente para el conjunto exacto, hacerlo no resolvería por sí solo la trazabilidad del ledger y podría ocultar el origen operativo. La reconciliación debe definirse y aprobarse como acción separada, sin modificar las seis filas.

### 0.6 Aplicación, deployment y producción

#### Aplicación integrada

- Código remoto integrado en `origin/main`: `0536746`.
- La paridad `server/index.js` / `api/[...path].js` pasó fresca.
- El `origin/main` base `0536746` no contenía la corrección. La rama candidata `fix/agt002-fixed-canary-e5-v3` sí la contiene en `288c500`; sólo podrá considerarse remota/productiva después de merge y deploy verificados.

#### Desplegado en Vercel

- Deployment: `dpl_Ff3H6YP2P52JmS7H5bHbvacdqpb2`.
- Target: `production`.
- Estado: `Ready`.
- Creado: `2026-08-14 12:58:47 UTC`.
- URL de deployment: `https://seguridad-nacional-33bvwwhb1-psi-llc-projects.vercel.app`.
- Alias: `https://seguridad-nacional-crm.vercel.app`.
- El alias respondió HTTP **200**.
- Vercel no mostró metadata Git en `inspect`; la atribución a `0536746` se sostiene por el worktree exacto usado para desplegar y el registro del proceso, no por metadata del deployment.

#### Producción Supabase / Manizales

- Oportunidad: `54190e51-15fb-46af-b0aa-8f13461a3110`.
- Último run canónico: `4f5f8bcf-6de2-45d9-b74a-4588a514bdf3`.
- Schema del último run: `2.0-preview.1`.
- Snapshot de ese run: `4770667d-1b47-4a52-af68-b199911b52d4`.
- Runs V3 encontrados: **0**.
- Claims con lease activo: **0**.
- El preflight fijo había validado 17 documentos y actor humano para el snapshot objetivo, pero el canary no avanzó hasta proveedor ni persistencia.

### 0.7 Bridge

- Servicio `agt002-bridge.service`: `active/running`.
- Inicio del proceso vigente: `2026-08-13 14:51:42 UTC`.
- Los módulos desplegados se habían verificado byte‑idénticos al lote integrado; al no existir diferencia material, **no se reinició** el servicio durante este cierre.
- El bridge no implementa `GET /health`; ese método responde 405 por contrato.
- Probe correcto, sin firma y sin payload real, contra local y público: ambos respondieron HTTP **401** con `AGT002_BRIDGE_AUTH_INVALID` en `POST /v1/agt002-preview/run`.
- Esto verifica listener local, TLS/proxy público y rechazo fail‑closed. No prueba un turno Codex y no consumió proveedor.

### 0.8 Acciones realizadas y no realizadas

#### Realizadas

1. integración de los 14 commits mediante PR #85;
2. merge remoto en `0536746`;
3. deployment productivo Vercel y verificación HTTP 200;
4. verificación del bridge sin reinicio innecesario;
5. preflight read-only de oportunidad, snapshot, documentos, actor, runs y claims;
6. diagnóstico del bloqueo del operador fijo;
7. una reproducción externa mínima, sintética y no productiva para demostrar la causa del schema abierto: 4.526 s, 9,687 tokens de entrada, 19 de salida y 9,706 totales; sin oportunidad, documentos, snapshot, contexto ni datos de Manizales; coste monetario exacto no observable;
8. TDD RED histórico para E5/V3, descartado al no existir GREEN; posteriormente, nuevo ciclo RED **18/22** → GREEN **22/22** con corrección mínima en `288c500`;
9. verificación productiva read-only del efecto material 066, ledger, runs y claims;
10. limpieza de artefactos temporales propios;
11. actualización autoritativa de este archivo.

#### No realizadas

- no se ejecutó el canary real de Manizales;
- no hubo invocación Codex productiva ni consumo de proveedor asociado a Manizales después del deployment; la única invocación del proceso fue la reproducción sintética no productiva declarada arriba;
- no se creó run V3, claim vigente, contexto nuevo ni análisis alternativo;
- no se registró respuesta humana ficticia ni se suplantó sesión UI;
- no se modificó el operador fijo en código integrado;
- no se creó PR para la corrección E4/E5;
- no se reaplicó, registró ni revirtió la migración 066 durante este cierre;
- no se cambiaron secretos, permisos, RLS, scheduler, timer o drain;
- no se creó ni modificó GO/NO‑GO;
- no hubo firma, envío, presentación, compromiso de garantías ni acción post‑GO;
- no se hizo push de la rama documental sin una autorización separada.

### 0.9 Riesgos residuales y bloqueos materiales

#### Bloqueo material para el canary

El bloqueo E4-only fue corregido localmente en `agt002-fixed-snapshot-reanalysis.js` mediante `assertSupportedRuntimeProfile`: admite únicamente E4 (`legal=false`, `v3=false`) y E5/V3 (`legal=true`, `v3=true`), con canonical, retrieval y autoanálisis estrictamente activos. En este corte intermedio la corrección aún no está integrada ni desplegada; por tanto, **no debe ejecutarse el canary** hasta completar PR, merge, deploy y preflight exacto, y nunca por rutas alternativas.

#### Riesgos residuales

1. **Ledger 066 divergente:** efecto material exacto presente, registro formal ausente. Riesgo de auditoría/reaplicación futura.
2. **Contrato V3 no probado con caso real:** 266/266 y schema sintético pasan, pero no existe aceptación productiva del payload integral de Manizales.
3. **Operador acoplado a E4:** impide el canary seguro después de activar E5/V3.
4. **CI remoto ausente:** GitHub no ejecutó/reportó checks para #85; las pruebas son locales y frescas, no checks remotos.
5. **Metadata de deployment incompleta:** Vercel reporta deployment/estado, pero no el commit Git; conservar el vínculo operacional al worktree exacto.
6. **Warning de bundle:** chunk >500 kB conocido; no bloqueante para este proceso, pero permanece como deuda técnica.
7. **Otros worktrees sucios:** cuatro worktrees independientes conservan cambios preexistentes; no son parte de este cierre y deben tratarse por sus propios dueños/gates.

### 0.10 Rollback seguro

No hay run V3 ni claim del canary que revertir.

- **Aplicación:** preferir un revert explícito del merge `0536746` sobre `main`, con pruebas y nuevo deployment; no reescribir historia ni forzar ramas. El padre de código previo es `701822d`.
- **Vercel:** después del revert probado, desplegar y reasignar el alias productivo. No asumir que cambiar el alias revierte Supabase o bridge.
- **Bridge:** sólo si el revert modifica su contrato, restaurar los módulos desde el commit previo aprobado y reiniciar una vez, verificando firma/rechazo fail‑closed. No reiniciar por rutina.
- **Migración 066:** el rollback versionado elimina sólo las seis filas exactas, no runs, documentos ni GO/NO‑GO. Aunque hoy hay cero runs V3, ejecutarlo requiere autorización humana y reconciliación previa del ledger; no usarlo para “arreglar” la ausencia de registro.
- **Kill switch operativo:** ante duda, mantener sin canary y sin automatización. No crear rutas de bypass, sesiones artificiales ni respuestas humanas ficticias.

### 0.11 Siguiente gate humano consolidado

El mandato autónomo posterior autoriza el paquete mínimo de corrección, PR, merge, deploy y **exactamente un** canary real sin retry ni fallback. La autorización no elimina los gates: antes del consumo deben estar verdes la integración, el deployment, el bridge sin diferencias inesperadas y el preflight productivo exacto. La deriva sistémica del ledger se inventaría read-only y su reparación permanece fuera de alcance.

---

## Historial anterior — no autoritativo frente al corte §0

### Corte productivo AGT‑002/Manizales pre‑GO, 2026-08-13

**Este bloque fue autoritativo en su fecha.** Se conserva como historial; el corte §0 anterior manda ante cualquier conflicto.

### 0.1 Verdad de Git y cierre técnico

**Snapshot del 2026-08-13:** rama `feat/agt002-v3-foundations` · HEAD `56a5883` · en ese corte el único cambio local era este archivo `CURRENT.md`. Para el estado local posterior y vigente del cierre del error, ver §0.5.

**Base remota:** `origin/main` en `0e5f150`, merge de PR #84 que integró la punta de feature `18447c0`. Sobre esa punta hay 12 commits adicionales en esta rama.

**Lote técnico estable de nueve commits** (el más reciente al final): `999bbbc`, `368f0d3`, `eb19a4c`, `09ba140`, `3fae8bf`, `26ab35a`, `f866877`, `473c3f0`, `56a5883`.

Clasificación:

- **Ejecución crítica** — `999bbbc` (aísla identidad de idempotencia v3), `368f0d3` (admite payloads v3 integrales acotados), `26ab35a` (conecta requisitos gobernados al runtime v3).
- **Cierre diagnóstico/confiabilidad** — `eb19a4c` (observa solicitudes de bridge sobredimensionadas), `09ba140` (traza fallos canónicos de forma segura), `3fae8bf` (clasifica fallos de creación de runtime), `f866877` (maneja estado de turno Codex estructurado), `473c3f0` (clasifica fallos de turno Codex de forma segura), `56a5883` (adapta esquemas `const` para el app server de Codex).

Los commits de funcionalidad/gobernanza pre‑GO de Manizales sobre esa misma punta son `641009c`, `29da6eb` y `041c17e` — anteriores y distintos del lote técnico de nueve; no se reclasifican aquí. Ninguno de los nueve automatiza GO/NO‑GO, firma, envío o presentación.

Validación fresca del lote: pruebas AGT‑002 **266/266**, paridad backend **OK**, build **OK** y `git diff --check` limpio. Revisión independiente Claude Code Sonnet: **APPROVE**, sin bloqueos materiales del código revisado.

### 0.2 Preflight productivo del caso real Manizales

Caso: Rama Judicial, proceso `SA-24-2026`, oportunidad `54190e51-15fb-46af-b0aa-8f13461a3110`.

Preflight read-only confirmado:

- aplicación productiva `https://seguridad-nacional-crm.vercel.app` accesible; deployment observado `dpl_GJxnLPyZHURsg69oEp5VwkgbWFzF`, estado `READY` (Vercel no expuso metadata Git suficiente para atribuirle mecánicamente el HEAD local);
- pliego definitivo resuelto y 68 secciones estructuradas, de las cuales 15 son relevantes al pre‑GO;
- 17/17 clases empresariales presentes en el catálogo cerrado, pero 17/17 pendientes de revisión humana y aplicabilidad al caso; 15/17 con vigencia desconocida y ninguna promovida a cumplimiento;
- corpus jurídico `legal-corpus-v1.1` publicado y hash validado;
- gobernanza Manizales completa: 6/6 filas `current`, versión 3 (tres clasificaciones `habilitating` y tres enlaces a evidencia para capital de trabajo/RUP, póliza RCE y póliza de vida colectiva);
- persistencia canónica, snapshots, contexto, claims y eventos append-only disponibles;
- último run canónico previo: schema `2.0-preview.1`; **no existe run integral V3 reutilizable**.

La evidencia empresarial permite presencia documental, no cumplimiento. Toda conclusión sustantiva sigue obligada a evidencia verificable o abstención explícita.

### 0.3 Ejecución humana observada y resultado

El 2026-08-13, desde una sesión humana autorizada en la pestaña **Análisis** del caso real, se accionó **Actualizar con Vig‑IA Licitaciones**. La UI devolvió: **“Vig‑IA no está disponible; no se generó un análisis alternativo.”**

La validación final read-only encontró **dos ciclos humanos** con la misma clave idempotente `d5edd9…a055`, separados por aproximadamente 26 segundos:

```text
queued → running → unavailable
queued → running → unavailable
```

Ambos ciclos:

- conservaron la misma identidad idempotente y el snapshot `4770667d-1b47-4a52-af68-b199911b52d4`;
- registraron `error_code=AGT002_UNAVAILABLE` y `analysis_run_id=null`;
- alcanzaron `stage=engine_analysis` con `bridge_invocation_started=true`;
- terminaron en aproximadamente 4.617 s y 3.645 s;
- no produjeron fallback ni análisis alternativo.

**Resultado canónico:** no se creó un run nuevo; no existe run V3 `3.0.0`; no se produjo brief pre‑GO real. El V2 histórico no se reutiliza ni se presenta como evidencia V3.

**Bloqueo material único vigente:** el bridge fue invocado, pero el motor no produjo una respuesta canónica válida y la ruta cerró en `AGT002_UNAVAILABLE` durante `engine_analysis`. La telemetría segura actual no distingue todavía entre rechazo del proveedor, incompatibilidad del contrato desplegado, error del bridge o fallo de validación.

**Límites preservados:** no se decidió GO/NO‑GO, no se comprometieron recursos ni garantías y no hubo firma, envío, presentación, scheduler, worker drain ni acción post‑GO. No debe hacerse un tercer intento sin resolver y verificar primero el bloqueo de `engine_analysis`.

**Acciones de repositorio/infraestructura no realizadas en esta actualización:** no hubo commit, push, PR, merge, deploy ni migración remota.

### 0.4 Hard debugging bridge → Codex — 2026-08-13, sin nuevo consumo

Este diagnóstico refina el bloqueo descrito en §0.3 sin cambiar el resultado canónico del caso ni autorizar un nuevo intento.

**Preflight preservado:** rama `feat/agt002-v3-foundations`, HEAD `56a5883`, único cambio local `CURRENT.md`; bridge `active/running` desde 14:51 UTC; Codex App Server `0.145.0`. Los ocho módulos JavaScript cargados por `agt002-bridge.service` en `/opt/agt002-bridge` coinciden byte a byte con `56a5883`. El `package.json` remoto es un manifiesto mínimo de runtime y difiere del manifiesto del repositorio, pero no altera la lógica ejecutada.

**Etapa exacta demostrada:** ambos intentos superaron autenticación, lectura de cuota, `thread/start` y `turn/start`; Codex emitió `turn/started`. El segundo proceso alcanzó además `item/completed`. El cierre recibido por el bridge fue `turn/completed` con `status=failed` y `error.code=other`. El cliente convirtió exactamente ese estado en `AGT002_CODEX_PROVIDER_ERROR`; la extracción de una respuesta válida y la validación del contrato V3 nunca se ejecutaron. No fue un rechazo HTTP del bridge, un fallo al crear el turno ni una validación V3 local.

**Reproducción aislada:** un child process falso, sin red, OAuth ni proveedor, recorrió el protocolo real `initialize → account/read → account/rateLimits/read → thread/start → turn/start` y emitió `turn/completed(failed, other)`. El resultado fue exactamente `AGT002_CODEX_PROVIDER_ERROR`, `provider_status=failed`, `provider_error_code=other` y mensaje seguro. Esto reproduce y demuestra el mapeo observado, no la causa interna por la que Codex marcó el turno como fallido.

**Compatibilidad de schema:** auditoría recursiva local de las variantes legacy y legal del `outputSchema`: 40/48 nodos, 6/7 objetos y 10/13 arrays respectivamente, sin hallazgos; todos los objetos tienen `additionalProperties:false`, propiedades explícitas y `required` completo. Los logs técnicos sanitizados no mostraron indicadores cerrados de schema inválido, auth, cuota, modelo, HTTP 4xx/5xx o transporte. Por tanto, no quedó demostrada una incompatibilidad con Codex `0.145.0`.

**Conclusión del bloque:** la causa interna de `error.code=other` **no quedó demostrada**. La hipótesis prioritaria es un fallo interno del proveedor durante la ejecución del turno, posterior a `turn/start` y anterior al estado final, cuyo detalle se pierde porque el cliente y la telemetría segura conservan sólo la categoría cerrada `other`. La observación mínima faltante es capturar, en una reproducción sintética autorizada y no productiva, el evento final estructurado completo o un diagnóstico técnico correlacionado del App Server, con redacción en origen y sin payloads, prompts ni documentos.

No se implementó corrección ni se invocó Claude Code Sonnet: hacerlo habría sido basarse sólo en una hipótesis. No se ejecutó Manizales, no hubo tercer intento, nuevo consumo de Codex, reinicio, cambio de secretos, modificación remota, commit, push, PR, merge o deploy.

### 0.5 Cierre local de `AGT002_CODEX_PROVIDER_ERROR` — 2026-08-14

Este bloque continúa §0.4 con la única reproducción sintética externa autorizada. No modifica el resultado canónico de Manizales ni autoriza otro intento real.

**Reproducción externa mínima:** se ejecutó exactamente un turno sintético, no productivo y sin documentos, contexto, oportunidad, snapshots, prompts o datos de Manizales. Usó Codex App Server `0.145.0`, modelo `gpt-5.6-sol`, input artificial y schema mínimo cerrado `{ok:boolean}`. El turno recorrió `initialize → account/read → account/rateLimits/read → thread/start → turn/start → item/completed → tokenUsage → turn/completed` y terminó `completed` en 4.526 s. Correlación segura: thread `019c7653-2a62-7b63-a64b-7f8ee75fce29`, turn `019c7653-2aa0-7d92-bd6d-fb611501b88b`; 9.687 tokens de entrada, 19 de salida y 9.706 totales. No se conservaron credenciales, headers, URLs, stderr, prompts, inputs completos ni mensajes libres. No hubo una segunda invocación.

**Causa raíz demostrada:** el App Server, la cuenta, el modelo y la secuencia de protocolo sí completan un turno mínimo. La diferencia causal está en `buildAgt002IntegralAnalysisV3OutputJsonSchema()`: el envelope superior era cerrado, pero `$.properties.integral_analysis` se enviaba como `{type:"object"}`, sin `additionalProperties:false`, `properties` ni `required`. Codex Structured Outputs exige cierre recursivo; el cliente sólo adaptaba `const→enum` y no reparaba el objeto abierto. La prueba de regresión confirmó RED exactamente en `$.properties.integral_analysis must set additionalProperties=false`. Los fallos `failed/other` ocurrieron antes de extracción y validación V3, coherente con el rechazo del schema wire.

**Corrección mínima local:** `agt002-preview-contract.js` materializa ahora el schema estructural V3 completo y recursivamente cerrado, reflejando claves, tipos, enums, nulabilidad y límites ya exigidos por el validador canónico. No mueve las invariantes cruzadas ni allowlists gobernadas fuera de `validateAgt002IntegralAnalysisV3`; no agrega fallback, no transforma error en éxito y no cambia autoridad humana, idempotencia, persistencia o límites pre-GO. El cliente conserva la adaptación wire `const→enum` sin mutar el schema canónico.

**TDD y verificación fresca:** RED específico observado antes del cambio; GREEN específico después. Pruebas focales de contrato y frontera wire `2/2`; schema wire verificado con cierre recursivo, cero `const`, máximo cuatro niveles de objetos y 78 propiedades, dentro de los límites Codex de cinco niveles y 100 propiedades. Suite AGT‑002 serial `266/266`; `npm run check:backend-parity` OK; `npm run build` OK; `git diff --check` limpio. El warning Vite de chunk >500 kB es preexistente/no relacionado. Revisión independiente Claude Code Opus: `passed:true`, sin errores lógicos, de seguridad o documentación material. Commit local de código/pruebas tras rebase sobre `origin/main`: `3150a78` (`fix(agt002): close v3 Codex output schema recursively`).

**Riesgo residual no bloqueante para integración:** no se consumió una segunda invocación para probar el schema V3 completo contra Codex `0.145.0`; por tanto, la aceptación real de todos sus keywords (`minLength`, `maxLength`, `minItems`, `maxItems`, `minimum`, `anyOf`) debe confirmarse únicamente en el canary posterior autorizado. El límite wire de 30 elementos coincide con los arrays internos acotados del contrato y cubre Manizales, pero es más estricto que el validador canónico para `analysis_units`; antes de generalizar a manifiestos o unidades por encima de 30 debe revisarse como límite operativo explícito.

**Estado y límites:** no se ejecutó Manizales ni un tercer intento real; no se tocó `/opt/agt002-bridge`; no hubo reinicio, cambio de secretos, Supabase productivo, scheduler, worker drain, push, PR, merge o deploy. El cambio permanece únicamente local y requiere gate humano consolidado antes de integrar o desplegar. El canary posterior debe ser único, expresamente autorizado y ejecutarse sólo después de integrar y desplegar la corrección.

---

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

- ~~No hay wiring real de `companyEvidenceClassesProvider`/`categoryOverrides`/`evidenceClassLinkByRequirementId` a una fuente de datos gobernada~~ — cerrado en la sesión de continuación del 2026-08-07 (§2.1.1 abajo): el wiring real de lectura existe hoy en `server/index.js`/`api/[...path].js`. Lo que sigue abierto es la **curación humana** de esos mapas para una oportunidad real: con el mapa por defecto (sin filas curadas en la migración `064`), todo requisito real sigue abstenido en sus cinco ejes al estado seguro hasta que un humano cure ese enlace requisito→clase de evidencia para el caso objetivo.
- No se ejecutó un caso E5 controlado con datos reales de Rama Judicial ni QA visual con etiquetas reales.
- No se activó el flag en ningún ambiente; no se aplicó ninguna migración remota; no hubo push/PR/deploy.
- Ningún revisor independiente fuera de esta sesión evaluó el trabajo (ver `docs/verification/2026-08-07-agt002-integral-v3-local.md` §4).

### Gate siguiente

1. Curar, con revisión humana y fuente trazable del pliego real, las filas `category_override` y `evidence_class_link` de la oportunidad objetivo en la superficie gobernada de la migración `064`; el wiring read-only de las 17 clases y de ambos mapas ya está construido y probado.
2. Ejecutar un caso E5 controlado sobre el snapshot real de Rama Judicial con el flag activado sólo para esa prueba, verificando cobertura 1:1 y abstención donde falte señal.
3. QA visual autenticado de la UI real (Juan) antes de activar el flag para cualquier usuario.
4. Sólo entonces, decisión humana sobre activar `AGT002_INTEGRAL_CONTRACT_V3` en un ambiente real, con canary único y sin timer.

### Cierre técnico autónomo — 2026-08-07 07:14 COT

Se verificó de nuevo la verdad de disco sobre `feat/agt002-v3-foundations`: worktree limpio al inicio del cierre, 17 commits locales sobre el merge-base `f85907d`, sin push/PR/merge/deploy y sin migraciones remotas. `origin/main` avanzó dos commits (`1998714`, `39bef1d`); la rama permanece deliberadamente sin integrar esos cambios.

Gates secuenciales frescos del cierre:

- v3 focal: `22/22`;
- regresión `tests/agt002-*.test.mjs`: `137/137`;
- PGlite migración 063/canonicidad y coexistencia v2/v3: `2/2`;
- paridad backend: `OK`;
- build: `OK` (sólo warning preexistente de chunk >500 kB);
- `npm audit --omit=dev`: `0` vulnerabilidades;
- `git diff --check`: limpio;
- suite completa: `376/377`; único fallo baseline `module-permissions-migration-pglite.test.mjs:98`, reproducido idéntico sobre el `origin/main` actual `39bef1d` (`0/1`). La aserción siguiente del mismo test exige precisamente el permiso extra que rompe la igualdad anterior.

Se añadió cobertura explícita de cierre que prueba: UI alimentada sólo por `analysis.integral_analysis`, sin `UNITS`/fixtures ni “Rama Judicial”; sin corpus publicado no se admite conclusión jurídica sustantiva ni referencia jurídica; el catálogo cerrado rechaza acciones `go`, `no_go`, `approve`, `sign`, `send` y `submit`; cualquier handoff `human_decision` continúa pendiente, reservado a `authorized_human` y con `external_side_effect=false`.

**Estado de release:** **NOT READY para canary real**. El wiring read-only de la fuente DB de 17 clases y de la nueva superficie gobernada de mapas ya existe; no puede rellenarse honestamente el gate restante sin (a) mapas humanos curados `categoryOverrides` y `evidenceClassLinkByRequirementId` con cobertura del caso objetivo y trazabilidad al pliego real, y (b) QA visual autenticado con etiquetas reales. Hasta recibir esas dos evidencias no se autoriza ejecutar el runbook ni consumir un caso real/costos. El runbook queda preparado en `docs/runbooks/agt002-integral-v3-canary.md`, pero no fue ejecutado.

### Continuación autónoma — cierre de wiring gobernado, 2026-08-07

- Commits del bloque: `efad172` (loader crudo de las 17 filas), `9ce504b` (forward del enlace requisito→clase), `154519d` (fuente gobernada + migración/rollback `064` + PGlite) y `b3b8794` (wiring read-only común en los tres flujos Express/Vercel + documentación del expediente).
- TDD: RED observados antes de cada implementación; GREEN focal confirmado para loader/runtime, builder de overrides, migración `064` PGlite y wiring de servidor.
- Gates secuenciales frescos: `tests/agt002-*.test.mjs` **140/140**; PGlite relevante **3/3**; backend parity **OK**; build **OK** (único warning preexistente de chunk >500 kB); `npm audit --omit=dev` **0 vulnerabilidades**; `git diff --check` limpio; suite completa **379/380**.
- El único fallo completo sigue siendo el baseline conocido `tests/module-permissions-migration-pglite.test.mjs:98`: el esperado omite `modulo_siio_gerencial` mientras la migración y la aserción siguiente lo exigen. No hay fallos AGT-002.
- Para Rama Judicial `54190e51-15fb-46af-b0aa-8f13461a3110` no se inventó ningún mapa: sin pliego/manifest real accesible y sin fuente trazable, la migración `064` conserva cero seeds y el caso sigue fail-closed. Evidencia: `docs/verification/2026-08-07-agt002-rama-judicial-governance-gap.md`.

### Auditoría autónoma de procedencia y mínima exposición — 2026-08-07

- Revisión inicial read-only con Claude Code Opus contra `b99a805`, diseño v3 y gates del
  canary: sin P0/P1; detectó P2 de auditabilidad del binding gobernado y hardening de la
  lectura de las 17 clases.
- Se cerró el binding end-to-end: cada override/enlace aplicado conserva en el envelope y
  en persistencia su `rationale`, `source_reference`, curator, `curated_at` y `version`.
  Mapas no vacíos con procedencia ausente o inconsistente fallan antes del proveedor;
  persistencia y adapter cerrado revalidan el mapa. `curated_at`/`version` inválidos fallan
  cerrado y los registros quedan congelados.
- Las dos lecturas runtime de `psi_agt002_company_evidence_registry` tienen allowlists
  explícitas; `select(*)`, duplicados y columnas no permitidas son rechazados. No se amplió
  RLS/ACL ni se añadió ninguna escritura.
- Evidencia final: focales **8/8**; AGT-002 **140/140**; PGlite relevante **3/3**; paridad
  backend **OK**; build **OK**; diff check/paridad byte Express-Vercel **OK**; suite completa
  **379/380**. El único fallo fue reproducido **0/1** en archivo limpio `b99a805`
  (`module-permissions-migration-pglite.test.mjs`) y permanece baseline.
- `npm audit --omit=dev` reporta ahora 1 high transitivo (`nanoid@3.3.16` vía
  Vite/PostCSS); `package.json`/`package-lock.json` no cambiaron frente a `b99a805`, por lo
  que no fue introducido por este lote. Revisión final independiente Opus: **passed**, sin
  hallazgos de seguridad ni errores lógicos.

**Estado:** **NOT READY para canary real**. Rama Judicial sigue sin mapas porque no hubo
señal read-only trazable suficiente; se mantiene abstención/missing governance. Siguen
pendientes curación humana sobre pliego real, caso E5 controlado y QA visual autenticado.

### Borrador de gobernanza Rama Judicial — versión 2, 17/17 documentos — 2026-08-08

- Revisión independiente Claude Opus 4.8 sobre la versión 1 del borrador (`docs/governance/2026-08-07-agt002-rama-judicial-governance-draft.md`, `db257d9`): **APPROVE** para presentar el borrador a aprobación humana, sin P0/P1 bloqueantes de esa presentación. Un P1 real bloqueaba solo *canary*: la extracción cubría 3/17 documentos vigentes porque dependía de `psi_tender_document_chunks`, cuyo pipeline de *chunking* nunca se volvió a ejecutar tras las adendas que reemplazaron 14 de los 17 documentos. Tres P2: semántica ambigua de `snapshot_id`, test de aislamiento no recursivo/no enganchado a un runner, y defensa anti-fuga final imprecisa (regex asimétrica).
- Esta sesión cerró el P1 y los tres P2 con TDD estricto RED→GREEN, usando las mismas credenciales de solo lectura ya localizadas fuera del worktree (nunca impresas): `scripts/agt002-rama-judicial-governance-draft-generate.mjs` ya no lee texto desde `psi_tender_document_chunks`; lee `extracted_text` de las 17 filas vigentes de `psi_tender_document_versions` y reconstruye chunks **localmente** con el mismo contrato puro de producción (`buildAgt002DocumentChunks`), reconciliado por igualdad exacta de `chunk_id`/`content_hash`/`chunk_hash` contra los 479 chunks reales que sí existen hoy en la base (0 discrepancias). Extracción de requisitos y citas corren ahora sobre **17/17** documentos vigentes.
- El extractor cerrado (`tender-requirement-extraction.js`) sigue reconociendo exactamente los mismos 3 `requirement_id` de siempre — la ampliación de cobertura documental no inventó ningún `requirement_id` nuevo ni usó un modelo/LLM para clasificar; amplió la evidencia (48 citas legales, 33 técnicas, 4 financieras, frente a 16/9/1) para esos mismos 3 requisitos, releída íntegramente para confirmar honestamente las propuestas/abstenciones (ninguna cambió de conclusión). El borrador declara explícitamente, en un `data_gap` dedicado, que 3 `requirement_id` es el alcance actual del extractor, **no** cobertura semántica total del pliego real.
- Se agregó el campo cerrado y obligatorio `evidence_chunk_snapshot_ids` al artefacto (`agt002-governance-draft-proposal.js`), se reemplazó la regex final anti-fuga por un escaneo recursivo por clave sobre todo el objeto (corrigiendo un falso positivo real demostrado con test), y se reescribió el test de aislamiento runtime para recorrer recursivamente todo el repositorio (163 archivos), enganchándolo a `npm run test:agt002-runtime` en `package.json`.
- Gates frescos de cierre tras recuperar el timeout del cron: generador real read-only **17/17**, **1.973** chunks locales y reconciliación **479/479** sin discrepancias; focales de gobernanza **2/2**; runner runtime **11/11**; `tests/agt002-*.test.mjs` secuencial **142/142**; backend parity **OK**; build **OK**; suite completa **381/382**. El único fallo (`module-permissions-migration-pglite.test.mjs:98`) se reprodujo idéntico **0/1** en el worktree limpio de `main` y no fue introducido por este lote. `npm audit --omit=dev` mantiene una vulnerabilidad transitiva alta conocida en `nanoid <3.3.17`, corregible por dependencia y no introducida aquí. Revisión final independiente Claude Opus 4.8: **APPROVE** para presentar el borrador a aprobación humana, sin P0/P1; canary **NOT_READY** hasta curación humana. El gate 4 (filas curadas reales en `psi_agt002_integral_governance_overrides`) permanece abierto: cero escritura remota, cero migración, cero RPC con efecto, cero canary/modelo productivo, cero push/PR/merge/deploy en esta sesión. Detalle: `docs/governance/2026-08-07-agt002-rama-judicial-governance-draft.md`, `docs/verification/2026-08-07-agt002-rama-judicial-governance-gap.md` §7.

### Rebase de integración sobre `origin/main` — 2026-08-11

Se reintegró `feat/agt002-v3-foundations` (30 commits, foundations + gobernanza Rama Judicial) sobre `origin/main` en `bbef30aba84310d92a82fa40636855dc13d640e7`, que ya incluía la identidad visible Vig‑IA (§ "Identidad visible desplegada" arriba, PR #81) y el cierre de hallazgos visuales F2 Important (PR #83, no documentado antes en esta sección). Es **un único producto AGT‑002**, no dos: la ruta productiva de nombres visibles (`Vig‑IA Gerencial/Licitaciones/Comercial`, `Agente Comercial PSI`) y la ruta de `TenderIntegralAnalysisV3View` de esta rama coexisten en `src/main.tsx` sin pisarse — el rebase no tuvo conflictos porque tocan líneas distintas del mismo archivo.

- Rama de respaldo previa al rebase: `backup/agt002-v3-pre-rebase-20260811` → `2a3e398`.
- `server/index.js` y `api/[...path].js` verificados byte‑idénticos entre sí tras el rebase.
- Migraciones `063_agt002_canonical_promotion.sql` y `064_agt002_integral_governance_overrides.sql` verificadas byte‑idénticas al contenido pre‑rebase; siguen siendo aditivas después de la `062` de `main` y **no se aplicaron** en ningún ambiente.
- Gates frescos post‑rebase: `git diff --check origin/main...HEAD` limpio; `tests/agt002-*.test.mjs` **161/161**; `npm run check:backend-parity` **OK**; `npm run build` **OK** (mismo warning preexistente de chunk >500 kB).
- Sigue sin push/PR/merge/deploy. `AGT002_INTEGRAL_CONTRACT_V3` sigue apagado por defecto. **Estado de release sin cambios: NOT READY para canary real** — los gates pendientes descritos arriba (curación humana de mapas, caso E5 controlado, QA visual autenticado de la vista integral) no se tocaron en este rebase.

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
