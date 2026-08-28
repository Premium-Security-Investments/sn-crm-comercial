# Especificación — AGT-002 Radar: separar exploración diaria y drenado de cola cada 15 min

**Fecha:** 2026-08-28
**Repositorio:** `Premium-Security-Investments/sn-crm-comercial`
**Estado del árbol de trabajo:** limpio (`git status` sin cambios pendientes) en el momento de escribir este documento.
**Naturaleza:** diseño y especificación técnica; este documento en sí mismo (el texto) no ejecuta nada. **[CORREGIDO 2026-08-28]** El usuario aprobó implementar el plan asociado a través de PR/despliegue el 2026-08-28 (§2, §4, §6.3, §8); la ejecución vive en `docs/superpowers/plans/2026-08-28-agt002-daily-scan-queue-implementation.md`, cuya Task 8 fija el orden exacto de rollout en el host, incluida la QA controlada que precede al cambio del cron de Hermes.
**Plan asociado:** `docs/superpowers/plans/2026-08-28-agt002-daily-scan-queue-implementation.md`
**Documentos base (no se repiten aquí salvo delta):**
- `docs/superpowers/specs/2026-08-25-agt002-radar-learning-design.md`
- `docs/superpowers/plans/2026-08-25-agt002-radar-learning-implementation.md`
- `docs/runbooks/agt002-radar-pipeline.md`
- `CURRENT.md` §14 (estado local al 2026-08-25: ambos flags OFF, esquema no aplicado, entrypoint creado y no instalado)

> **Convención de evidencia:** **[EXISTE]** = verificado leyendo el archivo citado en este árbol de trabajo. **[OPERADOR]** = hecho reportado por quien encargó este documento sobre el entorno operativo, posterior al cierre de `CURRENT.md` §14 (2026-08-25) y no verificable desde este repositorio porque describe un despliegue vivo, no un commit. **[PROPUESTO]** = diseño de este documento, aún no implementado. **[CORREGIDO 2026-08-28]** = decisión que la revisión de arquitectura de esta misma fecha revirtió o endureció respecto de la primera redacción de este documento.

> **Enmienda de revisión de arquitectura — 2026-08-28.** Este documento fue revisado tras su primera redacción y **ocho decisiones cambiaron**. Se listan aquí para que nadie implemente la versión anterior por haber leído sólo una sección:
> 1. **A6 se revierte** (§5, §6.3): el wrapper diario invoca `systemctl start agt002-radar-scan.service` y luego `systemctl start agt002-radar-pipeline.service`, **síncronamente**. Ya **no** invoca `node .../run-*.mjs` directamente. Motivo: invocar Node directo desde un cron de root ejecutaría el runner **como root** y obligaría al wrapper a cargar el environment file con los secretos del puente, tirando a la basura todo el endurecimiento (`User=psi-comercial`, `ProtectSystem=strict`, `CapabilityBoundingSet=`) que la unidad ya declara **[EXISTE]** (`ops/agt002-radar-pipeline/agt002-radar-pipeline.service:11-26`). La probabilidad de las pruebas se resuelve con un `systemctl` falso al frente del `PATH`, no degradando producción.
> 2. **`agt002-radar-pipeline.js` y `tests/agt002-radar-pipeline.test.mjs` NO se borran** (§3.5, §5 A8, §6.2). Se conservan como artefacto de compatibilidad y rollback. Lo que cambia en producción es **qué módulo importa el runner del timer**, probado con aserciones estáticas.
> 3. **El horario del cron no cambia** (§8). Ya es 13:00 UTC = 08:00 Colombia en días laborables. La recomendación anterior de "mover a 08:00 America/Bogota" se retira: es un no-op en tiempo absoluto y, escrita como `0 8 * * 1-5` en un crontab con TZ=UTC, sería un **desplazamiento real de cinco horas**. Cambiar horario, días o entrega es una aprobación separada que nadie ha dado.
> 4. **El kick del worker deja de ser un `|| true` semántico** (§6.3, §6.4): su fallo se reporta explícitamente con su propio código de salida en la línea de estado, aunque el wrapper pueda terminar en 0 porque el `.timer` durable reintenta.
> 5. **El wrapper distingue etapas en su código de salida y en su salida estructurada** (§6.3, §10), porque el cron de Hermes hoy interpreta "distinto de 0 ⇒ no se persistió nada" y esa lectura sería **falsa** para un fallo de scan (las fuentes SÍ quedaron persistidas).
> 6. **El reloj se valida antes de reclamar** (§6.2.1, §6.2.2): reclamar primero y validar `now()` después dejaba un job reclamado con lease vivo y sin cierre.
> 7. **El dominio de `error_code` queda congelado** (§6.2.2, §7): la matriz de fallo original atribuía a un fallo de aprendizaje el código `invalid_output`, que el clasificador vigente **no puede producir** para ese caso. Se corrige la matriz en vez de ampliar el clasificador.
> 8. **Autorización de implementación concedida** (§2, §4, §6.3, §8): el usuario aprobó, el 2026-08-28, implementar este diseño a través de PR/despliegue. Las frases "no se hace commit ni push salvo autorización explícita adicional" y "requiere autorización operativa separada" de la primera redacción quedaban obsoletas y se retiran; el plan asociado fija el orden de rollout exacto (merge/despliegue → backup → instalar unidad/env del scan → actualizar runner/unidad del timer → `daemon-reload` → QA manual del wrapper → observar el `.timer` con la cola vacía → recién entonces cambiar el cron de Hermes), y el cron viejo se preserva hasta que esa QA pase.

---

## 1. Propósito

Entre el cierre de `CURRENT.md` §14 (2026-08-25, todo apagado) y hoy, alguien encendió `AGT002_RADAR_GATE` e instaló/habilitó `ops/agt002-radar-pipeline/agt002-radar-pipeline.timer` en al menos un entorno **[OPERADOR]**. El resultado reportado es: **37/37 corridas del timer terminaron `empty`, 0 jobs encolados, 0 llamadas al proveedor AGT-002, 1123 checks de idempotencia (`satisfied`) del RPC `psi_enqueue_agt002_radar_preanalysis_job`** — es decir, la cadena funciona y es fail-closed, pero cada corrida de 15 minutos paga el costo completo de `esu_refresh → fetch(≤250) → gate(≤250) → ledger(≤250 escrituras) → claim` sólo para confirmar, casi siempre, que no hay nada nuevo que hacer. Este documento no puede releer ese log — no vive en este árbol — y lo toma como dato de entrada aprobado, igual que el resto del "Approved design" que originó este trabajo.

La causa estructural: `agt002-radar-pipeline.js::createAgt002RadarPipeline` **[EXISTE]** (`agt002-radar-pipeline.js:21-68`) es **un solo proceso** que hace dos cosas de naturaleza y de costo completamente distintos en cada invocación:

1. **Descubrir** qué hay de nuevo en `psi_public_tenders` (refresco ESU, página acotada, gate determinístico, ledger de evaluación) — trabajo que tiene sentido hacer **una vez al día**, porque la fuente misma (`persistTenderRadar`, vía el cron de Hermes que ejecuta `/root/.hermes/scripts/secop_psi_radar_export.sh` **[OPERADOR]**) también corre una vez al día.
2. **Drenar** la cola durable reclamando y ejecutando **a lo sumo un job** — trabajo que sí tiene sentido revisar cada 15 minutos, porque es barato (una reclamación) cuando no hay nada y acotado (un job, un preanálisis) cuando sí lo hay.

Correr (1) noventa y seis veces al día para que (2) tenga noventa y seis oportunidades de encontrar trabajo es exactamente al revés de cómo cambia la fuente: la fuente cambia una vez al día, y la cola —si (1) la alimentó correctamente esa vez— tiene lo que va a tener hasta la siguiente exportación. Este diseño separa las dos responsabilidades en dos procesos con cadencias propias, sin tocar ninguna de las garantías de gobernanza ya construidas en `071`/`072`.

## 2. Autoridad y límites indelegables

Sin cambios frente a `docs/superpowers/specs/2026-08-25-agt002-radar-learning-design.md` §2. Se reafirman explícitamente porque este documento toca los dos procesos que tocan la cola y el ledger:

- Radar **ingiere y muestra**. La conversión a Oportunidad sigue siendo exclusivamente humana.
- Ningún artefacto de este alcance crea `psi_sales_opportunities`, invoca `psi_convert_tender_to_opportunity`/`POST /api/tender-convert`, escribe `internal_status`/`converted_opportunity_id`, ni emite GO/NO-GO.
- `no_mostrar_en_radar` no es descarte; sigue siendo reversible y con `human_review_required = true`.
- Sin cambios bajo `src/`.
- Los dos flags (`AGT002_RADAR_GATE`, `AGT002_RADAR_VISIBILITY`) y su dependencia fail-closed no cambian de semántica. Este trabajo **no introduce un flag nuevo**: ambos procesos —exploración y cola— siguen gobernados por el mismo `AGT002_RADAR_GATE`. Separarlos en dos flags independientes se evaluó y se descarta (§5, A3): añadiría una quinta combinación fail-closed que auditar sin que ningún operador la haya pedido.

## 3. Estado actual verificado

### 3.1 La cadena hoy es un solo `runOnce()`

**[EXISTE]** `createAgt002RadarPipeline` (`agt002-radar-pipeline.js:21`) construye un único objeto con un único método `runOnce()` que ejecuta, en una sola invocación y en este orden fijo (`AGT002_RADAR_PIPELINE_STAGES`, línea 12): `esu_refresh → fetch → gate → ledger → claim → learning → agt → persist`. No hay forma de pedirle "sólo explora" o "sólo drena": el guardián de flag (línea 13, 31) es binario (`disabled` / ejecuta las ocho etapas), y las ocho etapas están en el mismo `try`/`await` secuencial.

**[EXISTE]** El costo por invocación, con el flag encendido y la cola vacía de trabajo nuevo, es exactamente:
- 1 refresco ESU directo (`refreshEsuDirect`, sujeto a su propio checkpoint de 6 h — `esu-direct-refresh.js:6,66-70` — así que la mayoría de las corridas de 15 min lo saltan con `skipped_fresh`, pero igual se invoca y se decide en cada tick);
- 1 `fetch` de hasta `maxTendersPerRun` filas (250 por defecto, línea 27) de `psi_public_tenders`;
- hasta 250 evaluaciones del gate puro (`evaluateAgt002RadarGate`, sin I/O);
- hasta 250 escrituras de ledger (`recordGateEvaluation` → RPC `psi_record_agt002_radar_gate_evaluation`), cada una con corto circuito de idempotencia **[EXISTE]** (`docs/superpowers/specs/2026-08-25-...md` §7.1) pero cada una es igual un viaje de red y una consulta;
- 1 llamada `enqueueJob` por sobreviviente, cada una con su propio corto circuito `satisfied` **[EXISTE]** (§7.2 del spec de aprendizaje: `psi_enqueue_agt002_radar_preanalysis_job` compara `(source_row_hash, policy_version, context_version)` contra la canónica y no encola si coincide);
- 1 `claimJob` (barato: una reclamación con `for update skip locked limit 1`).

Con evidencia de 1123 `satisfied` y 0 jobs **[OPERADOR]**, el fetch+gate+ledger de las 250 filas se está pagando en cada uno de los 96 ticks diarios para producir, en el caso típico, cero trabajo nuevo. El `claimJob` final —que sí es la parte barata y la que de verdad necesita cadencia de 15 min— siempre se ejecuta también, pero va después de todo lo demás, no antes.

### 3.2 Ya existe en el árbol un primitivo "reclama primero, sal si no hay nada"

**[EXISTE]** `agt002-radar-preanalysis-worker.js:5-15` (`createAgt002RadarPreanalysisWorker`) es un módulo genérico, **no usado hoy por `agt002-radar-pipeline.js`**, cuyo `runOnce()` hace exactamente `claim → (si vacío, `{status:'empty'}` y termina) → executeJob(database, job) → complete|fail`. Es la forma correcta de un worker de cola, y ya está probado en aislamiento (usa `classifyAgt002RadarPreanalysisError`, que también reutiliza el pipeline actual). Este diseño reutiliza esa forma como base del Target B (§6.2), pero no reutiliza el módulo tal cual porque `executeJob` en su forma genérica no hace la revalidación de una sola fila contra el gate vigente (§6.2.2); esa revalidación es específica de este dominio y no existe en `agt002-radar-preanalysis-worker.js`.

### 3.3 Cron de origen y su cadencia real

**[OPERADOR]** El cron de Hermes ejecuta `/root/.hermes/scripts/secop_psi_radar_export.sh`, que a su vez invoca un comando Python que persiste en Supabase con `mode=cron_export`. Ese script vive fuera de este repositorio (no hay coincidencias para `secop_psi_radar_export` en el árbol de trabajo — confirmado con búsqueda) y por tanto este documento no puede citar su contenido línea por línea; lo trata como una caja negra cuyo contrato observable es "corre, y si sale con código 0 persistió la fuente cruda en `psi_public_tenders`".

**[OPERADOR]** La cadencia real es **días laborables a las 13:00 UTC**, que es **08:00 en Colombia** (`America/Bogota` = UTC−5 todo el año, sin horario de verano). **[CORREGIDO 2026-08-28]** Ese horario **ya es el pedido** y **no se cambia en este alcance**. La primera redacción de este documento recomendaba "moverlo a 08:00 America/Bogota"; esa recomendación se retira por dos motivos: (a) en tiempo absoluto es un no-op, así que no compra nada; (b) escrita como `0 8 * * 1-5` en un crontab cuyo `TZ` efectivo es UTC —que es el caso hoy, porque la entrada vigente está expresada en UTC— produciría un **adelanto real de cinco horas** (03:00 Colombia), es decir un cambio de entrega no solicitado disfrazado de cosmética. Cualquier cambio de hora, de días (p. ej. añadir fin de semana) o de destinatario de la entrega es una **aprobación operativa separada** que este trabajo no tiene y no asume. Lo aprobado es una sincronización de fuente **una vez al día**, que es exactamente lo que ya ocurre.

**[OPERADOR]** Contrato de reporte vigente del cron: la automatización de Hermes ejecuta el script de exportación y **interpreta cualquier código de salida distinto de 0 como "no se persistió nada"**. Ese contrato es correcto hoy porque el único paso es la exportación. Deja de serlo en cuanto el wrapper encadena etapas posteriores a la persistencia, y por eso §10 define semántica por etapa y §6.3 la hace legible por máquina.

### 3.5 `agt002-radar-pipeline.js` no es un módulo aislado — inventario de acoplamiento verificado

**[EXISTE]** Antes de proponer su borrado hay que saber quién lo toca. Búsqueda sobre el árbol de trabajo:

| Archivo | Cómo lo usa | Qué pasa si el módulo se borra |
|---|---|---|
| `ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs:3` | `import { createAgt002RadarPipeline }` | Es el punto que este diseño **sí** quiere repuntar al worker. |
| `tests/esu-direct-refresh.test.mjs:8,152-174` | **importa y ejecuta** `createAgt002RadarPipeline` para probar que el refresco ESU corre antes del fetch y no bloquea | El archivo deja de cargar: `ERR_MODULE_NOT_FOUND`. Es una prueba de un dominio distinto (ESU), no del Radar. |
| `tests/agt002-radar-no-conversion-authority.test.mjs:9,27-39` | lo lista en `DECISION_PATH_FILES` y hace `readFileSync` incondicional | `ENOENT` y caída de la prueba que garantiza que la ruta de decisión **no** puede convertir a oportunidad ni emitir GO/NO-GO. |
| `tests/agt002-radar-preanalysis-runtime.test.mjs:41-47` | `readFileSync` + regex para extraer el `leaseSeconds` por defecto y verificar ≥300 s de holgura sobre el techo de timeout | `ENOENT`; se pierde el invariante de holgura lease/timeout. |
| `tests/agt002-radar-learning-proposals.test.mjs:9` | `readFileSync` **con `catch` de `ENOENT`** | Único que ya tolera la ausencia. |
| `tests/esu-direct-refresh-adapter.test.mjs:131-137,309-316` | exige que **el runner del pipeline** contenga `createSupabaseEsuDirectRefresher`, `fetchEsuProcesses` y `fetchEsuProcesses({includeHistorical:true})` | No depende del módulo, pero **sí** del runner: la Task 4 propuesta le quita exactamente esos tres símbolos. |

Conclusión **[CORREGIDO 2026-08-28]**: borrar el módulo rompe cuatro archivos de prueba, tres de ellos de dominios ajenos a este cambio, y **desactiva dos invariantes de seguridad** (no-conversión/no-GO-NO-GO y holgura lease/timeout) justo cuando se introduce código nuevo que debería quedar bajo esos mismos invariantes. El borrado no es una limpieza barata: es una ampliación del radio de daño en el mismo cambio que ya mueve el productor de la cola. Ver §5 A8 y §6.2.

### 3.4 Unidades `systemd` existentes

**[EXISTE]** `ops/agt002-radar-pipeline/` contiene `run-agt002-radar-pipeline.mjs`, `agt002-radar-pipeline.service` (`Type=oneshot`, `TimeoutStartSec=720`, endurecimiento completo), `agt002-radar-pipeline.timer` (`OnUnitActiveSec=15m`, `OnBootSec=10m`, `RandomizedDelaySec=90`, `Persistent=false`), `env.example` y `README.md`. **[OPERADOR]** Estas unidades están hoy instaladas y con el timer habilitado en al menos un entorno (es la fuente de las 37 corridas). No existe hoy ninguna unidad `agt002-radar-scan.*`.

## 4. No-alcance

Idéntico al no-alcance de `2026-08-25-agt002-radar-learning-design.md` §4, y además:

- No se cambia el esquema `071`/`072`: ni tablas, ni columnas, ni RPC, ni dominios de `error_code`/`status`. La cola y los dos ledgers append-only se leen y se escriben con las mismas RPC ya existentes.
- No se introduce un flag nuevo. `AGT002_RADAR_GATE` sigue gobernando ambos procesos.
- No se cambia `AGT002_RADAR_PREANALYSIS_TIMEOUT_MS` (30 s por defecto, rango `1000..300000`) ni el `leaseSeconds` de la cola (600 s). Ambos siguen exactamente como están.
- No se toca `agt002-radar-gate.js`, `agt002-radar-preanalysis-jobs.js`, `agt002-radar-preanalysis-persistence.js`, `agt002-radar-preanalysis-runtime.js`, `agt002-radar-learning-projection.js` ni `agt002-radar-learning-retrieval.js`: son consumidos, no modificados.
- **[CORREGIDO 2026-08-28]** No se borra `agt002-radar-pipeline.js` ni `tests/agt002-radar-pipeline.test.mjs`. Quedan en el árbol como artefacto de compatibilidad y rollback (§3.5, §5 A8). Lo que cambia de comportamiento en producción es el `import` del runner del timer, no la existencia del módulo.
- **[CORREGIDO 2026-08-28]** No se cambia el horario, ni los días, ni el destinatario del cron de Hermes. Sigue en días laborables 13:00 UTC / 08:00 Colombia (§3.3, §8). Lo único que cambia en el crontab, y sólo al final del rollout, es **qué comando** ejecuta esa misma entrada y **qué reporta** el prompt asociado (§10).
- **[CORREGIDO 2026-08-28]** No se añade, renombra ni reinterpreta ningún valor del dominio `error_code` de `072` ni de `AGT002_RADAR_QUEUE_ERROR_CODES` **[EXISTE]** (`agt002-radar-preanalysis-worker.js:2`, `supabase/migrations/072_...sql:72`). No se toca `classifyAgt002RadarPreanalysisError`.
- No se edita `/root/.hermes/scripts/secop_psi_radar_export.sh` ni el comando Python que invoca: son externos a este repositorio. Lo único que este diseño propone es **qué llama Hermes en su lugar** (§6.3) y **cómo reporta lo que pasó** (§10).
- No se instala, habilita ni arranca ninguna unidad `systemd` durante las tareas de código (Tasks 1-7 del plan): eso queda en la fase de despliegue (Task 8/9 del plan), que sigue el orden de rollout fijo descrito en §6.3/§8 y en la Task 8 del plan.
- **[CORREGIDO 2026-08-28]** Commit, PR, merge y despliegue de este trabajo están autorizados por la aprobación del usuario del 2026-08-28 (enmienda, punto 8). Lo que sigue gated detrás del orden fijo de la Task 8 del plan —y, en particular, detrás de su QA controlada— es tocar `/etc/psi-comercial/`, ejecutar `systemctl` y editar el crontab/prompt de Hermes en el host de producción: el cron viejo se preserva hasta que esa QA pase.

## 5. Alternativas descartadas

| # | Alternativa | Por qué se descarta |
|---|---|---|
| A1 | Bajar la frecuencia del `.timer` único (p. ej. a 1 h) en vez de separar procesos | No resuelve el problema: seguiría acoplando "explorar la fuente" y "drenar la cola" a la misma cadencia, y cualquier cadencia intermedia es un mal compromiso entre "la cola tarda demasiado en drenar" y "se sigue re-escaneando fuente sin cambios". Los dos trabajos tienen cadencias naturales distintas (diaria vs. 15 min) y deben tener procesos distintos. |
| A2 | Añadir un `if` interno a `agt002-radar-pipeline.js::runOnce()` que salte `esu_refresh/fetch/gate/ledger` según un contador o un reloj de pared, dejando un solo proceso y un solo `.timer` | Reintroduce estado mutable de calendario dentro de un proceso que hoy es puro por invocación (sin reloj propio salvo el `now()` inyectado), y hace que "es de día de escanear" dependa de que el proceso recuerde su última corrida en vez de en la fuente durable (`psi_esu_direct_refresh_runs`/la exportación diaria misma). Es exactamente el modo de falla que la cola durable ya evitó para el drenado (A11 del spec de 2026-08-25): un proceso que decide por reloj interno en vez de por evidencia persistida. |
| A3 | Dos flags independientes: `AGT002_RADAR_SCAN` y `AGT002_RADAR_WORKER`, en vez de que ambos sigan bajo `AGT002_RADAR_GATE` | El "Approved design" no lo pide, y añadiría una quinta combinación fail-closed a auditar (¿qué hace el worker con `SCAN=false, WORKER=true`? — nada nuevo que drenar nunca, porque nunca se encoló nada) sin ganancia operativa: nadie ha pedido apagar la exploración sin apagar el drenado, o viceversa. Un solo flag sigue siendo la superficie mínima. |
| A4 | Fusionar el kick inmediato del worker dentro del propio proceso de scan (que el scan, tras encolar, llame directamente `createAgt002RadarWorker(...).runOnce()` en el mismo proceso Node) | Acoplaría de nuevo el ciclo de vida de los dos procesos: un fallo del worker terminaría marcando como fallido el proceso de scan (que ya persistió la fuente y el ledger con éxito), y el `.service` de scan tendría que declarar todas las credenciales del puente Hetzner que hoy sólo necesita el worker, ampliando su superficie de secretos sin necesidad. El kick vive en el wrapper externo (§6.3), que ya es el punto que conoce el resultado de ambos pasos. |
| A5 | Renombrar también el directorio `ops/agt002-radar-pipeline/` y sus archivos `.service`/`.timer` a `ops/agt002-radar-worker/` | El "Approved design" pide explícitamente **repurpose** de la unidad/timer existentes para minimizar el riesgo operativo: un entorno que ya tiene esas unidades instaladas y habilitadas **[OPERADOR]** no necesita que nadie reinstale nada bajo una ruta nueva. Sólo cambia qué archivo Node ejecuta `ExecStart` (sin cambiar la ruta del propio `ExecStart`) y qué módulo importa ese archivo. El desacople de nombres entre el módulo JS (`agt002-radar-worker.js`) y el directorio de operaciones (`ops/agt002-radar-pipeline/`) es una asimetría deliberada, documentada aquí para que no se lea como un descuido. |
| ~~A6~~ **REVERTIDA [CORREGIDO 2026-08-28]** | Que el wrapper invoque `node .../run-*.mjs` directamente en vez de `systemctl start <unidad>` | **Se rechaza.** El razonamiento original ("`ExecStart` no añade lógica, así que es idéntico") es **falso**: `ExecStart` es la última línea de la unidad, no la única. La unidad **[EXISTE]** (`ops/agt002-radar-pipeline/agt002-radar-pipeline.service:8-26`) también fija `User=psi-comercial`, `Group=psi-comercial`, `EnvironmentFile=/etc/psi-comercial/agt002-radar-pipeline.env`, `WorkingDirectory=`, `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=strict`, `ProtectHome`, `ProtectKernel*`, `ProtectControlGroups`, `RestrictSUIDSGID`, `LockPersonality`, `CapabilityBoundingSet=` y `AmbientCapabilities=` vacíos, `RestrictAddressFamilies=`, `SystemCallArchitectures=native` y `TimeoutStartSec=720`. El cron de Hermes corre como **root** **[OPERADOR]** (su script vive en `/root/.hermes/scripts/`): invocar `node` directo desde ahí ejecutaría el preanálisis **como root, sin sandbox, sin límite de tiempo y sin identidad de servicio**, y —peor— obligaría al wrapper a **cargar él mismo el environment file** para que el runner viera `SUPABASE_SERVICE_ROLE_KEY` y `AGT002_HETZNER_BRIDGE_HMAC_SECRET`, metiendo secretos de puente y de base en el entorno de un script de shell de cron que hoy no los necesita. Eso convierte una separación de procesos en una **regresión de privilegio y de superficie de secretos**. La "dificultad de prueba" que motivaba A6 es menor de lo que se afirmó: basta anteponer al `PATH` un directorio con un `systemctl` ejecutable de dos líneas que registre sus argumentos y salga con el código que el test le indique (§9, Task 5); es exactamente el mismo truco que se iba a usar para `node`, con el mismo costo. El requisito de permisos en producción es real y se resuelve documentándolo (§6.4), no evitándolo. |
| A6′ | **[CORREGIDO 2026-08-28] DECISIÓN VIGENTE:** el wrapper invoca `systemctl start agt002-radar-scan.service` y después `systemctl start agt002-radar-pipeline.service` | `systemctl start` de una unidad `Type=oneshot` **bloquea hasta que la unidad termina** y devuelve un código de salida que refleja el resultado del job, así que el encadenamiento serial fail-closed del wrapper se conserva íntegro. El runner sigue corriendo bajo su identidad y su sandbox; el wrapper no ve ni un secreto; los logs quedan en el journal de cada unidad, con `journalctl -u`, en vez de mezclados en el stdout del cron. Consecuencias operativas y de concurrencia: §6.4. |
| A7 | Que el worker, al revalidar la fila reclamada, reutilice `job.gateEvaluationId` en vez de **recomputar** la evaluación de gate | El job pudo haberse encolado ayer sobre una evaluación de gate ya vieja; reutilizar su id no produce evidencia de que la fila **hoy** sigue siendo sobreviviente con el mismo hash/política/contexto, que es exactamente lo que exige la revalidación de "single-row stale". El worker **recomputa** el gate sobre la fila y lo asienta con la misma clave diaria idempotente, y compara **esa** evaluación fresca contra los tres campos congelados del job, igual que hacía el pipeline combinado (`agt002-radar-pipeline.js:59-62`). **[CORREGIDO 2026-08-28] Precisión necesaria:** la redacción original decía "graba una evaluación **nueva** (con su propio `gate_evaluation_id`)". Eso es inexacto y no hay que construir el diseño sobre ello: la clave de idempotencia incluye `evaluation_date`, y el RPC **[EXISTE]** (`supabase/migrations/071_agt002_radar_gate.sql:86-95`) devuelve `{status:'existing', id:<el id ya escrito>}` cuando la clave coincide y el payload semántico es idéntico. Es decir, si el scan de las 08:00 y el worker de las 08:15 ven la misma fila con el mismo veredicto, **el id es el mismo**, no uno nuevo. La propiedad de seguridad no viene de que haya una fila nueva: viene de que el gate se **vuelve a computar** y se **vuelve a comparar** contra lo congelado en el job. Ver también §6.2.2, fila del conflicto `23505`. |
| A8 | **[CORREGIDO 2026-08-28]** Borrar `agt002-radar-pipeline.js` y su prueba en el mismo cambio, "porque su contenido queda absorbido" | **Se rechaza.** §3.5 documenta que cuatro archivos de prueba lo tocan, tres de ellos de dominios ajenos (ESU, runtime, propuestas de aprendizaje), y que dos invariantes de seguridad se apagarían con el borrado. Conservarlo cuesta un archivo muerto en el árbol; borrarlo cuesta tocar cuatro pruebas ajenas en el mismo commit que cambia el productor de la cola, y deja el rollback dependiendo de un `git revert` limpio en vez de de un archivo que ya está en disco. La regla que sí importa —"producción ejecuta el worker nuevo"— se prueba **estáticamente sobre el runner** (`ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs` importa `createAgt002RadarWorker` y **no** importa ni construye `createAgt002RadarPipeline`), que es donde vive el comportamiento, no en la ausencia del archivo. El borrado se difiere a un cambio posterior, aislado, cuando exista una razón probada de que ya nadie —ni prueba ni runner ni script— depende del módulo. |
| A9 | **[CORREGIDO 2026-08-28]** Que los tres comandos del wrapper sean **cadenas** de shell (`SCAN_CMD="node /ruta/x.mjs"`) ejecutadas como `"$SCAN_CMD"` | **Se rechaza: no funciona.** Con comillas, Bash busca un ejecutable cuyo nombre literal contiene un espacio (`node /ruta/x.mjs`) y falla con 127; sin comillas, se abre inyección de shell y globbing desde una variable de entorno. Con la decisión A6′ el problema no desaparece —`systemctl start agt002-radar-scan.service` también son dos palabras—. Los tres comandos se declaran como **arrays de Bash** y se ejecutan como `"${SCAN_CMD[@]}"`: sin `eval`, sin división de palabras accidental, con argumentos explícitos. |
| A10 | **[CORREGIDO 2026-08-28]** Reclamar primero y validar `now()` después, tal como decía la primera redacción de §6.2.1 | **Se rechaza.** Validar el reloj es una comprobación **pura, sin I/O y sin costo**; hacerla después de reclamar significa que un reloj inválido deja un job en `running` con lease vivo y sin `failJob`, esperando 600 s a que el barrido de leases lo marque `lease_lost`. El invariante que de verdad importa —"si no hay trabajo, la **única** operación contra la base es la reclamación"— se conserva igual validando el reloj antes: no es una operación contra la base. Además así el comportamiento ante reloj inválido queda **byte-idéntico** al de hoy (`agt002-radar-pipeline.js:34-35`: `{status:'unavailable', stages:[], error_code:'provider_error'}`, sin job abierto), en vez de estrenar un camino de fallo nuevo. |
| A11 | **[CORREGIDO 2026-08-28]** Que el wrapper devuelva un único "distinto de 0" indiferenciado para cualquier fallo | **Se rechaza.** El cron de Hermes hoy traduce "distinto de 0" a "no se persistió nada" **[OPERADOR]**. Con el wrapper, un fallo de scan ocurre **después** de que la exportación persistió las fuentes: reportarlo como "no se persistió nada" sería un **reporte falso** sobre el estado de la base. El wrapper devuelve códigos reservados por etapa y emite una línea de estado estructurada por etapa (§6.3), y el prompt del cron se actualiza para leerlos (§10). |

## 6. Arquitectura objetivo

```text
Hermes cron (externo, dias laborables 13:00 UTC = 08:00 America/Bogota — SIN CAMBIOS, §8)
  │
  ▼
run-agt002-radar-daily-export.sh   [PROPUESTO, versionado en este repo]
  Corre como root desde el cron, pero NO carga ningun environment file y NO
  conoce ningun secreto: los tres pasos son procesos externos gobernados.
  1) EXPORT   (por defecto: /root/.hermes/scripts/secop_psi_radar_export.sh)
     └─ exit != 0 ⇒ etapa 'export', salida 10. Ni scan ni worker corren.
        Semantica para el cron: NADA SE PERSISTIO.
  2) SCAN     (por defecto: systemctl start agt002-radar-scan.service)   [A6']
     └─ sincrono: Type=oneshot, systemctl start bloquea y propaga resultado.
        exit != 0 ⇒ etapa 'scan', salida 20. El worker NO se invoca ahora.
        Semantica para el cron: LAS FUENTES SI SE PERSISTIERON; fallo el
        gate/encolado posterior. El .timer de 15 min sigue intacto.
  3) WORKER KICK (por defecto: systemctl start agt002-radar-pipeline.service) [A6']
     └─ sincrono tambien. exit != 0 ⇒ etapa 'worker_kick', se REPORTA
        explicitamente con su codigo; el wrapper puede salir 0 porque el
        .timer durable reintenta. Semantica: fuente + scan OK; el drenado
        inmediato no arranco y queda a cargo del temporizador. NUNCA `|| true`.
═══════════════════════════════════════════════════════════════════════════
 TARGET A — EXPLORACIÓN DIARIA, SIN MODELO             agt002-radar-scan.js
 AGT002_RADAR_SCAN_STAGES = ['esu_refresh','fetch','gate','ledger','enqueue']
 AGT002_RADAR_GATE apagado ⇒ {status:'disabled'}: 0 lecturas, 0 escrituras.

  (1) esu_refresh  refreshEsuDirect(database,{environment, now})   — igual que hoy,
                    nunca bloquea lo siguiente, nunca relaja el gate.
  (2) fetch        fetchTenderPage(database,{limit: maxTendersPerRun})  (≤250, igual que hoy)
  (3) gate         evaluateAgt002RadarGate(row,{nowIso})  — puro, sin I/O — para CADA fila
  (4) ledger       recordAgt002RadarGateEvaluation(...)   — append-only, idempotente,
                    para CADA fila (sobreviviente o eliminada): evidencia completa.
  (5) enqueue      enqueueAgt002RadarPreanalysisJob(...)  — SÓLO sobrevivientes.
                    El corto circuito 'satisfied' YA EXISTE en el RPC (072, §7.2 del
                    spec de aprendizaje): compara (source_row_hash, policy_version,
                    context_version) contra la canónica vigente y no encola si
                    coincide. Este diseño no reimplementa ese corto circuito: lo
                    hereda sin cambios. "Sólo faltantes/vencidas/nuevas" es
                    exactamente lo que ese corto circuito ya produce.
                    NUNCA llama claimJob. NUNCA llama al proveedor AGT-002.
═══════════════════════════════════════════════════════════════════════════
                    psi_agt002_radar_preanalysis_jobs (queued)
                                  │
                                  ▼
 TARGET B — DRENADO CADA 15 MIN, RECLAMA-PRIMERO       agt002-radar-worker.js
 AGT002_RADAR_WORKER_STAGES = ['claim','fetch_row','gate','ledger','learning','agt','persist']
 AGT002_RADAR_GATE apagado ⇒ {status:'disabled'}: 0 lecturas, 0 escrituras.

  (1) claim        claimJob(database,{leaseSeconds:600})  — SIEMPRE lo primero y
                    SIEMPRE lo único que toca la base si no hay trabajo.
                    Sin job ⇒ {status:'empty', stages:['claim']} y TERMINA.
                    Nunca refresca ESU. Nunca hace fetch de página completa.
  (2) fetch_row    fetchTenderRow(database,{id: job.tenderId})  — UNA fila, por id.
                    Fila ausente ⇒ falla 'stale_input' (misma familia que abajo).
  (3) gate         evaluateAgt002RadarGate(row,{nowIso})  — la MISMA fila, ahora.
  (4) ledger       recordAgt002RadarGateEvaluation(...)   — una evaluación fresca,
                    con su propio gate_evaluation_id (no reutiliza el del job:
                    ver A7 en §5).
                    Si verdict != 'sobreviviente', o source_row_hash/policy_version/
                    context_version no coinciden con los congelados en el job
                    ⇒ failJob('stale_input'). NUNCA se llega a (5)/(6)/(7).
  (5) learning     projectAgt002RadarLearningObservations + buildAgt002RadarLearningSignals
                    — igual que hoy, específico del candidato reclamado.
  (6) agt          runPreanalysis(...)  — ÚNICA llamada al proveedor de la corrida,
                    ÚNICA vez que se gasta el timeout de 30 s bajo el lease de 600 s.
  (7) persist      recordAgt002RadarPreanalysisRun + completeJob
                    (o failJob con el código clasificado, en cualquier error).
═══════════════════════════════════════════════════════════════════════════
              readPersistedTenderRadar  [SIN CAMBIOS: mismo filtro de visibilidad,
                                          misma frescura, mismas seis causas de
                                          ocultamiento, mismo 503 fail-closed]
```

### 6.1 Target A — `agt002-radar-scan.js` [PROPUESTO]

Firma exacta:

```js
export const AGT002_RADAR_SCAN_STAGES = Object.freeze(['esu_refresh', 'fetch', 'gate', 'ledger', 'enqueue']);

export function createAgt002RadarScan({
  database, environment = process.env, now,
  fetchTenderPage = defaultFetch,               // idéntico al de agt002-radar-pipeline.js hoy
  evaluateGate = evaluateAgt002RadarGate,
  recordGateEvaluation = recordAgt002RadarGateEvaluation,
  enqueueJob = enqueueAgt002RadarPreanalysisJob,
  refreshEsuDirect = defaultRefreshEsuDirect,    // mismo no-op seguro por defecto
  maxTendersPerRun = 250,
} = {}) { /* ... */ return Object.freeze({ async runOnce() { /* ... */ } }); }
```

Contrato de `runOnce()`:
- Flag apagado ⇒ `{status:'disabled', stages:[], code:'AGT002_RADAR_SCAN_DISABLED'}`, cero efectos — mismo patrón de guardia que hoy (`buildAgt002AnalysisConfig(environment).AGT002_RADAR_GATE`).
- Un solo `now()` invocado una vez por corrida (igual invariante que hoy: `assert.doesNotMatch(source, /Date\.now\(\)|new Date\(\)/)`).
- `esu_refresh` nunca bloquea ni relaja el gate (comentario ya existente en `agt002-radar-pipeline.js:36-39`, se traslada literal).
- `fetch` con fallo ⇒ `{status:'unavailable', stages, esu_refresh, error_code:'provider_error'}`.
- `gate`/`ledger` con fallo ⇒ `{status:'unavailable', stages, esu_refresh, evaluated, error_code:'persistence_failure'}` (mismo comportamiento fail-closed por corrida completa: un fallo de ledger no debe dejar sobrevivientes encolados sobre una evidencia que no se pudo asentar).
- `enqueue` es **por fila** y **nunca aborta el lote** *sólo para el conflicto semántico esperado*: un rechazo de una licitación con job activo bajo identidad distinta —`SQLSTATE 55000` **y** el mensaje fijo "AGT-002 Radar tender already has a different active job" de `psi_enqueue_agt002_radar_preanalysis_job`, ambos exactos— se cuenta en `rejected` y el resto de las filas se sigue encolando — mismo comportamiento que el "Bloqueo permanente adyacente" ya probado en `tests/agt002-radar-pipeline.test.mjs` líneas 69-85 hoy, que este diseño traslada literal a `agt002-radar-scan.js`. **[CORREGIDO 2026-08-28]** Cualquier otro fallo de encolado —código distinto de `55000`, el mismo `55000` con otro mensaje, timeout, caída de conexión— **no** se cuenta como `rejected`: se repropaga y aborta la corrida completa con `{status:'unavailable', error_code:'persistence_failure'}`, sin filtrar el texto crudo del error al resultado. Contarlo como `rejected` disfrazaría una caída real de infraestructura como una corrida diaria exitosa.
- `runOnce()` **nunca** referencia `claimJob`, `runPreanalysis`, `recordPreanalysisRun` ni `completeJob`/`failJob`: no forman parte de la firma de `createAgt002RadarScan`. No es sólo que no se llamen: **no existe parámetro por el que se les pudiera inyectar**, así que ninguna llamada futura accidental puede colar una invocación al modelo dentro del scan.
- Retorno en el caso exitoso: `{status:'completed', stages, esu_refresh, evaluated, survivors, eliminated, enqueued, satisfied, rejected}`. No hay `status:'empty'` distinguible de `'completed'` con `evaluated:0`: a diferencia del worker, el scan siempre "hace su trabajo" (leer y evaluar la página) aunque no haya nada que encolar; `'empty'` se reserva para el worker, donde sí es una salida cualitativamente distinta (cero lecturas más allá de la reclamación).

### 6.2 Target B — `agt002-radar-worker.js` [PROPUESTO]

**[CORREGIDO 2026-08-28] Reemplaza a `agt002-radar-pipeline.js` en producción, no en el árbol.** El módulo combinado sigue existiendo, compilando y probado (§3.5, §5 A8). Lo que cambia es que `ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs` —el `ExecStart` del timer de 15 min— pasa a importar `createAgt002RadarWorker` y deja de importar y de construir `createAgt002RadarPipeline`. Ese hecho, que es el que determina el comportamiento productivo, se prueba **estáticamente** sobre el texto del runner (plan, Task 4): debe contener `createAgt002RadarWorker` y **no** debe contener `createAgt002RadarPipeline` ni `agt002-radar-pipeline.js` como especificador de import. Rollback = redesplegar el commit anterior, sin resucitar ningún archivo.

```js
export const AGT002_RADAR_WORKER_STAGES = Object.freeze(['claim', 'fetch_row', 'gate', 'ledger', 'learning', 'agt', 'persist']);

export function createAgt002RadarWorker({
  database, environment = process.env, now,
  claimJob = claimAgt002RadarPreanalysisJob,
  fetchTenderRow = defaultFetchTenderRow,        // NUEVO: select ... .eq('id', id) — una fila
  evaluateGate = evaluateAgt002RadarGate,
  recordGateEvaluation = recordAgt002RadarGateEvaluation,
  completeJob = completeAgt002RadarPreanalysisJob,
  failJob = failAgt002RadarPreanalysisJob,
  projectLearningObservations = projectAgt002RadarLearningObservations,
  buildLearningSignals = buildAgt002RadarLearningSignals,
  runPreanalysis = defaultRunPreanalysis,
  recordPreanalysisRun = recordAgt002RadarPreanalysisRun,
  leaseSeconds = 600, maxLearningSignals = 10,
} = {}) { /* ... */ return Object.freeze({ async runOnce() { /* ... */ } }); }
```

#### 6.2.1 Orden exacto y "reclama primero"

1. Guardia de flag (idéntica, con `code:'AGT002_RADAR_WORKER_DISABLED'`).
2. **[CORREGIDO 2026-08-28, ver A10] Validación del reloj antes de reclamar.** `nowIso = now()`; si no es una cadena con `Date.parse` finito ⇒ `{status:'unavailable', stages:[], error_code:'provider_error'}` **sin haber tocado la base y sin ningún job abierto** — byte-idéntico al comportamiento de hoy (`agt002-radar-pipeline.js:34-35`). Se calcula también `evaluationDate`. Esto es una función pura inyectada: no es una operación contra la base y por tanto **no viola** el invariante "reclama primero". El invariante que se conserva y que hay que probar es *"si la cola está vacía, la única operación contra la base de la corrida es la reclamación"*, no *"`now()` no se llama"*.
3. `stages.push('claim')`; `job = await claimJob(database, {leaseSeconds})`. **Si `!job`, retorna `{status:'empty', stages:['claim']}` inmediatamente.** Ningún fetch, ninguna lectura adicional, ninguna escritura: la única operación contra la base fue el RPC de reclamación, que ya hace internamente su propio `for update skip locked limit 1` y su propio cierre de leases vencidos (`lease_lost`) **[EXISTE]** en `068`/réplica de `072`.
4. `stages.push('fetch_row')`; `row = await fetchTenderRow(database, {id: job.tenderId})`. Fila ausente (`null`) ⇒ trata el caso como stale (§6.2.2, misma familia que "fila ya no está en la página" del pipeline actual, líneas 58-67 del archivo viejo).
5. `stages.push('gate')`; `evaluation = evaluateGate(row, {nowIso})`.
6. `stages.push('ledger')`; `gateEvaluation = {...evaluation, id: (await recordGateEvaluation(...)).id}` — misma clave de idempotencia diaria (`kind:'gate'`) que usa el scan y que usaba el pipeline combinado.
7. **Revalidación (ver A7, §5):** si `evaluation.verdict !== 'sobreviviente'` **o** `evaluation.source_row_hash !== job.sourceRowHash` **o** `evaluation.policy_version !== job.policyVersion` **o** `evaluation.context_version !== job.contextVersion` ⇒ `failJob(database,{jobId, leaseId, errorCode:'stale_input'})` y retorna `{status:'unavailable', stages, job_id, error_code:'stale_input'}`. **Ni `learning`, ni `agt`, ni `persist` se alcanzan.**
8. Si pasa la revalidación: `learning` → `agt` → `persist` → `complete`, en ese orden, idéntico en forma al tramo final del pipeline combinado actual (`agt002-radar-pipeline.js:63-65`), sólo que operando sobre `row`/`gateEvaluation` obtenidos en (4)-(6) en vez de sobre `matched` extraído de una página ya cargada en memoria.
9. **[CORREGIDO 2026-08-28]** Cualquier error **desde (4) hasta (8) inclusive** —es decir, desde el instante en que existe un job reclamado— se clasifica con `classifyAgt002RadarPreanalysisError` (**sin cambios**, `agt002-radar-preanalysis-worker.js:2-4`) y cierra el job con `failJob`. La primera redacción decía "(5)-(8)", lo que dejaba un fallo de `fetch_row` sin cierre explícito y con el lease colgando. **Regla dura: mientras haya un job reclamado, ningún camino de retorno puede salir de `runOnce()` sin haber intentado `failJob` o `completeJob`.** El único caso en que el job queda abierto es que el propio `failJob` falle, y ahí el barrido de leases de `072` lo cierra como `lease_lost` — que es el mecanismo ya existente, no uno nuevo.
10. **[CORREGIDO 2026-08-28] `failJob` sólo se invoca con miembros de `AGT002_RADAR_QUEUE_ERROR_CODES`** **[EXISTE]** (`'timeout'`, `'provider_error'`, `'invalid_output'`, `'persistence_failure'`, `'lease_lost'`, `'capacity_unavailable'`, `'stale_input'`), que es exactamente el `check` de `supabase/migrations/072_...sql:72`. Los códigos de envoltorio del proceso (`AGT002_RADAR_WORKER_DISABLED`, `AGT002_RADAR_SCAN_DISABLED`, `AGT002_RADAR_ENTRYPOINT_*`) viven **sólo** en el JSON de stdout y **nunca** se pasan a `failJob` ni se escriben en ninguna columna. Un valor fuera del dominio haría fallar la RPC con `error_message = null` contra el `check` de consistencia de estado (`072:80-82`), es decir, convertiría un fallo clasificado en un fallo de persistencia — por eso el dominio se congela y se prueba.

#### 6.2.2 Matriz de fallo — quién falla, con qué código, y qué NO se llama

**[CORREGIDO 2026-08-28]** Cada `error_code` de esta tabla es el que el clasificador **vigente** produce; ninguna fila exige tocar `classifyAgt002RadarPreanalysisError`. Donde el código real no coincide con lo que sería semánticamente ideal, se dice y se deja como está: ampliar el dominio o reescribir el clasificador está fuera de alcance (§4).

| Punto de fallo | `error_code` | ¿Hay job abierto que cerrar? | ¿Se llegó a `agt`/al proveedor? | ¿Se llegó a `persist`? |
|---|---|---|---|---|
| Flag apagado | *(no aplica — `status:'disabled'`)* | No | No | No |
| `now()` inválido (**antes** de reclamar, A10) | `provider_error` — devuelto en el JSON, **no** escrito en la cola | **No**: no se reclamó nada | No | No |
| `claimJob` lanza | `persistence_failure` — devuelto en el JSON, **no** escrito en la cola | No | No | No |
| `claimJob` no encuentra trabajo | *(no aplica — `status:'empty'`, no es un fallo)* | No | No | No |
| `fetchTenderRow` lanza (fallo de red/DB) | `persistence_failure` (el envoltorio `persistenceError` fija `runtime_boundary_code='AGT002_RADAR_PERSISTENCE_FAILURE'` **[EXISTE]** `agt002-radar-preanalysis-jobs.js:1`; el mismo patrón debe usarse en `defaultFetchTenderRow`, si no el clasificador cae a `provider_error`) | Sí ⇒ `failJob` | No | No |
| `fetchTenderRow` devuelve fila inexistente (`null`) | `stale_input` | Sí ⇒ `failJob` | No | No |
| `evaluateGate` marca `eliminada` sobre la fila actual | `stale_input` | Sí ⇒ `failJob` | No | No |
| `source_row_hash` cambió desde que se encoló | `stale_input` | Sí ⇒ `failJob` | No | No |
| `policy_version` o `context_version` cambiaron | `stale_input` | Sí ⇒ `failJob` | No | No |
| `recordGateEvaluation` (ledger) lanza por indisponibilidad | `persistence_failure` | Sí ⇒ `failJob` | No | No |
| **[CORREGIDO 2026-08-28]** `recordGateEvaluation` lanza `23505` porque el veredicto del día cambió (p. ej. el plazo venció entre el scan de las 08:00 y el worker de las 08:15: misma clave diaria, evidencia distinta ⇒ `071:88-94` levanta conflicto) | `persistence_failure` — **no** `stale_input`, aunque la causa sea semánticamente staleness | Sí ⇒ `failJob` | **No** | No |
| `projectLearningObservations`/`buildLearningSignals` lanza | **`provider_error`** — corregido: la proyección relanza el error crudo de Supabase (**[EXISTE]** `agt002-radar-learning-projection.js:60,142,167`), que no trae `runtime_boundary_code` y cuyo `code` es un `SQLSTATE` numérico, así que el clasificador cae a su rama por defecto. La primera redacción decía `invalid_output`; el clasificador **no puede** producir ese código aquí, y perseguirlo obligaría a ampliar el clasificador. | Sí ⇒ `failJob` | No | No |
| `runPreanalysis` lanza | según `runtime_boundary_code` del proveedor (`timeout`/`invalid_output`/`capacity_unavailable`/`provider_error`) | Sí ⇒ `failJob` | Sí (fue la llamada que falló) | No |
| `recordPreanalysisRun` lanza | `persistence_failure` | Sí ⇒ `failJob` | Sí | No (no se asentó) |
| `completeJob` lanza tras persistir con éxito | `persistence_failure` en el intento de `failJob`; si eso también falla, `{status:'unavailable', error_code:'persistence_failure'}` sin lanzar | Sí ⇒ `failJob` | Sí | Sí (la corrida canónica ya quedó escrita; sólo el cierre del job quedó inconsistente, igual que hoy) |

Dos notas de fail-closed que la tabla hace explícitas y que **no** deben "arreglarse" en este alcance:

- **El `23505` del ledger es un fallo correcto, con etiqueta imprecisa.** El resultado observable es el que se quiere: el job se cierra, **el proveedor no se llama**, no se produce ninguna canónica positiva sobre una fila cuyo veredicto vigente cambió, y el próximo scan diario reevaluará con clave nueva. Sólo el `error_code` dice `persistence_failure` donde un humano diría `stale_input`. Reclasificarlo exigiría inspeccionar `SQLSTATE` dentro del clasificador —es decir, cambiar el comportamiento de clasificación de **todo** el dominio, incluido el pipeline combinado y el worker genérico que lo comparten— y eso es exactamente lo que §4 prohíbe aquí. Se registra como observación para un cambio posterior aislado. Nota de frecuencia: este conflicto **ya existe hoy** y el split lo hace **menos** probable, no más — hoy hay hasta 96 recomputaciones del gate por día contra la misma clave diaria; después habrá dos (scan + worker).
- **El scan aborta el lote completo si el ledger falla** (§6.1), y eso se conserva: no se encola sobre evidencia que no se pudo asentar. Lo que **sí** cambia con la cadencia diaria es el costo de ese aborto (§9): antes el siguiente intento era en 15 minutos, ahora es al día siguiente salvo re-ejecución manual.

Esta tabla es una extensión de la ya cubierta por `tests/agt002-radar-pipeline.test.mjs` líneas 37-57 (los cuatro casos `stale_input` por fila) y línea 58-67 (fila ausente), trasladada al nuevo punto donde ocurre la revalidación (fetch de una fila, no de una página). Esas pruebas **siguen existiendo y siguen corriendo** contra el módulo combinado (§5 A8): la cobertura nueva del worker se **suma**, no sustituye.

### 6.3 El wrapper externo — `run-agt002-radar-daily-export.sh` [PROPUESTO]

Vive en `ops/agt002-radar-scan/run-agt002-radar-daily-export.sh`, versionado en este repositorio para que sea revisable y probable, aunque el script que orquesta (`secop_psi_radar_export.sh`) siga siendo externo. Contrato **[CORREGIDO 2026-08-28]**:

**Invocación de las etapas 2 y 3 — unidades, no runners.** Por A6′:

| Etapa | Comando por defecto | Naturaleza |
|---|---|---|
| 1 `export` | `/root/.hermes/scripts/secop_psi_radar_export.sh` | externo, sin cambios |
| 2 `scan` | `systemctl start agt002-radar-scan.service` | unidad `Type=oneshot` endurecida, síncrona |
| 3 `worker_kick` | `systemctl start agt002-radar-pipeline.service` | la **misma** unidad que dispara el `.timer` de 15 min |

- Los tres comandos son **arrays de Bash** (A9), sobreescribibles sólo para pruebas: `AGT002_RADAR_EXPORT_CMD`, `AGT002_RADAR_SCAN_CMD`, `AGT002_RADAR_WORKER_KICK_CMD`. Si la variable está definida, se parte en palabras de forma controlada (`read -r -a`); si no, se usa el array por defecto. **Nunca `eval`, nunca expansión sin comillas de una cadena.** En producción el cron **no** pasa ninguna de las tres: los valores por defecto son el contrato.
- **El wrapper no carga ningún `EnvironmentFile`, no exporta ningún secreto y no acepta secretos por línea de comandos ni por argumento.** `SUPABASE_SERVICE_ROLE_KEY` y `AGT002_HETZNER_BRIDGE_HMAC_SECRET` los lee `systemd` al arrancar cada unidad, desde `/etc/psi-comercial/*.env` con permisos restringidos, y sólo quedan en el entorno del proceso ya sandboxeado. El wrapper nunca los ve, así que tampoco pueden aparecer en `ps`, en el log del cron ni en un volcado de entorno del shell.
- **Secuencia estrictamente serial, fail-closed en las dos primeras etapas.** Exportación falla ⇒ ni scan ni worker corren. Scan falla ⇒ el worker no se invoca **ahora** (el `.timer` de 15 min sigue intacto y seguirá reclamando lo que ya estuviera encolado de corridas previas).
- **Códigos de salida reservados por etapa** (A11, §10). Son códigos del wrapper, no del dominio `error_code` de la cola, y no se escriben en ninguna tabla:

  | Salida | Significado exacto para quien reporta |
  |---|---|
  | `0` | Exportación y scan terminaron bien. El kick pudo terminar bien o no; el detalle está en su línea de estado. |
  | `10` | **Fallo de exportación.** Nada se persistió en esta corrida. El código real del script externo va en la línea de estado, no en la salida del wrapper (para que `10` sea inconfundible). |
  | `20` | **Fallo de scan.** Las fuentes **sí** quedaron persistidas por la exportación; falló la evaluación/encolado posterior. Decir "no se persistió nada" aquí sería falso. |

- **El kick del worker se reporta explícitamente; no se silencia.** Emite su propia línea de estado con `exit_code` real y `best_effort: true`. El wrapper puede terminar en `0` con el kick fallido **porque la cola es durable y el `.timer` de 15 min reintenta**: perder el kick cuesta hasta 15 minutos + `RandomizedDelaySec=90` de latencia, nunca un job. Lo que **no** se hace en ningún caso es `|| true`, `&>/dev/null` ni descartar el código: si nadie puede leer que el kick falló, el "mejor esfuerzo" se vuelve un fallo silencioso.
- **Advertencia sobre lo que el código de salida del kick puede y no puede decir.** `systemctl start` devuelve el resultado de la unidad, y el runner del worker sólo sale distinto de 0 si la configuración es inválida o si lanza (`run-agt002-radar-pipeline.mjs:7,15` **[EXISTE]**). Un `runOnce()` que devuelve `{status:'unavailable', error_code:'stale_input'}` imprime su JSON y sale **0**. Por lo tanto `worker_kick.exit_code = 0` significa **"la unidad corrió"**, no "el job se completó". El resultado real del job se lee en `journalctl -u agt002-radar-pipeline.service`. Esto se dice aquí para que el prompt del cron (§10) no afirme más de lo que sabe.
- **El runner del scan sí debe salir distinto de 0 cuando `runOnce()` devuelve `status:'unavailable'`** — asimetría deliberada con el runner del worker. Sin eso, un fallo de fetch/gate/ledger dejaría la unidad en `active (exited)` con código 0, `systemctl start` devolvería 0 y el wrapper reportaría un día bueno mientras nada se encoló. El runner del worker **no** cambia sus códigos de salida en este alcance: un `stale_input` es un desenlace normal y esperado del drenado, y convertirlo en unidad fallida ensuciaría el estado de una unidad que dispara 96 veces al día y podría activar alarmas de `systemd` que hoy no existen.
- **No usa `set -e`.** Cada paso se ejecuta, su código se captura explícitamente y la decisión de seguir o cortar es una línea de código legible. Sí usa `set -u` y `set -o pipefail`.
- No hace ninguna llamada de red/DB por sí mismo: es pura orquestación. No acepta `--apply` ni ninguna bandera que lo haga escribir.
- **Sobre "ningún script de este alcance ejecuta `systemctl`":** esa regla —heredada de `ops/agt002-radar-pipeline/README.md` y probada en `tests/agt002-radar-pipeline-systemd.test.mjs:1`— existe para que **instalar y habilitar** unidades siga siendo un acto humano autorizado, no algo que un script haga por su cuenta. Este wrapper hace `systemctl start` de una unidad **ya instalada** por decisión humana previa: no instala, no habilita, no `daemon-reload`, no escribe en `/etc/systemd/`, no toca ningún `.timer`. La prueba estática del wrapper debe reflejar esa distinción exacta: prohibir `systemctl (enable|disable|daemon-reload|link|mask|edit)` y cualquier escritura bajo `/etc/systemd`, y **permitir** `systemctl start` sólo de esas dos unidades nominales. Las prohibiciones existentes sobre los archivos del directorio `ops/*` que **no** son este wrapper se mantienen intactas.

### 6.4 Concurrencia, privilegios y garantías de la cola bajo `systemd` [CORREGIDO 2026-08-28]

- **Sincronía.** Ambas unidades son `Type=oneshot` sin `RemainAfterExit`. `systemctl start` sobre un `oneshot` **no retorna hasta que la unidad termina** y su código de salida refleja el resultado del job (`done` ⇒ 0, `failed` ⇒ distinto de 0). Por eso el encadenamiento serial del wrapper es real y no una carrera. `TimeoutStartSec=720` **[EXISTE]** acota cada arranque a 12 minutos; superarlo mata el proceso y la unidad queda `failed`, que el wrapper ve como fallo de etapa. El wrapper no impone timeout propio: duplicar el techo sólo crearía dos verdades sobre el mismo límite.
- **Colisión con el `.timer` de 15 min.** El paso 3 arranca **la misma unidad** que el temporizador. `systemd` no ejecuta dos instancias de una unidad no-templada: si ya hay un arranque en curso, el `start` del wrapper se encola sobre ese job y devuelve **su** resultado; si no hay ninguno, arranca una instancia nueva. No hay doble ejecución, ni doble reclamación, ni dos llamadas al proveedor.
- **Efecto sobre el propio temporizador.** `OnUnitActiveSec=15m` cuenta desde la última activación **sea quien sea** quien la haya provocado, así que el kick del wrapper desplaza el siguiente disparo hasta 15 min. Es benigno y deseado: el kick ya hizo el trabajo que ese disparo iba a hacer. `Persistent=false` **[EXISTE]** sigue significando que un arranque tardío del host no dispara corridas atrasadas acumuladas.
- **Idempotencia y durabilidad, que es lo que hace segura toda la concurrencia anterior.** Aunque dos procesos llegaran a solaparse: `psi_claim_agt002_radar_preanalysis_job` reclama con `for update skip locked limit 1` y lease de 600 s, así que dos reclamantes nunca obtienen el mismo job; `psi_enqueue_agt002_radar_preanalysis_job` corta en `satisfied` cuando `(source_row_hash, policy_version, context_version)` coinciden con la canónica vigente, así que un scan repetido el mismo día no duplica jobs; `psi_record_agt002_radar_gate_evaluation` devuelve `{status:'existing'}` ante la misma clave diaria con la misma evidencia (`071:86-95`), así que reejecutar el scan no duplica ledger; `computeAgt002RadarPreanalysisIdempotencyKey({kind:'run', attempt_key})` mantiene una sola corrida canónica por intento. **Conclusión operativa: re-ejecutar el wrapper, o el scan a mano, el mismo día es seguro y no gasta presupuesto de modelo por filas ya satisfechas.**
- **Privilegios necesarios.** El cron de Hermes corre como root **[OPERADOR]**, y root puede `systemctl start` sin polkit. Si en el futuro ese cron se moviera a un usuario sin privilegios, la forma correcta **no** es volver a invocar `node` directo (A6), sino una regla de polkit o una entrada de `sudoers` acotada **exactamente** a `systemctl start agt002-radar-scan.service` y `systemctl start agt002-radar-pipeline.service`, sin comodines y sin `stop`/`disable`/`daemon-reload`.
- **Dónde queda cada log.** El stdout de los runners ya no llega al correo/registro del cron: va al journal de cada unidad. El wrapper emite sólo sus tres líneas de etapa. Quien diagnostique necesita `journalctl -u agt002-radar-scan.service` y `journalctl -u agt002-radar-pipeline.service`; el runbook y el prompt del cron (§10) deben decirlo explícitamente, porque es la contrapartida real de A6′.

## 7. Qué se preserva sin cambios (invariantes)

- **Fail-closed:** cualquier configuración inválida, cualquier error no clasificable, cualquier ambigüedad de frescura sigue cerrando en vez de degradar abierto, en ambos procesos.
- **Idempotencia:** las mismas claves (`gate` por `(tender, source_row_hash, policy_version, context_version, evaluation_date)`; `job`/`attempt`/`run` por sus respectivas claves) siguen siendo las únicas fuentes de idempotencia. Ningún proceso nuevo introduce una clave paralela.
- **Ledger append-only:** ninguna tabla ni RPC de `071`/`072` cambia. El scan y el worker escriben con las mismas RPC `security definer` ya auditadas.
- **Visibilidad canónica:** `readPersistedTenderRadar` y su frescura de cinco condiciones (§7 del runbook) no se tocan; siguen leyendo exactamente las mismas tablas con exactamente el mismo triple de frescura.
- **Sin conversión ni GO/NO-GO:** ninguno de los dos procesos nuevos gana ninguna capacidad de escritura sobre `psi_public_tenders.internal_status`/`converted_opportunity_id`, ni invoca rutas de conversión.
- **Revisión humana:** `human_review_required = true` sigue siendo un `check` de base de datos sobre el resultado del preanálisis, no una convención de aplicación; el worker no cambia el sobre que produce `runPreanalysis`.
- **Un job por invocación:** el worker sigue reclamando y ejecutando a lo sumo un job por `runOnce()`. El scan nunca reclama ninguno.
- **Timeout de 30 s / lease de 600 s:** sin cambios en ninguno de los dos números ni en su relación de holgura (§10 del runbook, "techo de 5 minutos bajo el lease de 600 s").
- **[CORREGIDO 2026-08-28] Privilegio mínimo y separación de secretos:** el scan corre bajo su propia unidad endurecida con `EnvironmentFile=/etc/psi-comercial/agt002-radar-scan.env`, que contiene **sólo** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `AGT002_RADAR_GATE`. **No** contiene `AGT002_HETZNER_BRIDGE_URL`, `AGT002_HETZNER_BRIDGE_HMAC_SECRET`, `AGT002_RADAR_PREANALYSIS_MODEL` ni `AGT002_RADAR_PREANALYSIS_TIMEOUT_MS`: el scan nunca llama al proveedor y su firma ni siquiera admite inyectarle esa llamada (§6.1). El worker conserva **sin cambios** su `EnvironmentFile=/etc/psi-comercial/agt002-radar-pipeline.env` ya protegido y su unidad ya instalada. La verificación negativa (`env.example` del scan **no** menciona `AGT002_HETZNER_BRIDGE_*`) es parte de las pruebas del plan. Confirmado además que el refresco ESU del scan **no necesita ninguna variable adicional**: `esu-direct-crawl.js` no lee `process.env` **[EXISTE]**.
- **[CORREGIDO 2026-08-28] Endurecimiento `systemd` sin regresión:** `agt002-radar-scan.service` replica línea por línea la misma `HARDENING_BASELINE` que ya se prueba para el worker (`tests/agt002-radar-pipeline-systemd.test.mjs:5,10-32`), incluida la comprobación de "exactamente una asignación por directiva" que impide que un segundo `RestrictSUIDSGID=false` desactive la protección. Ninguna unidad corre como `root`.
- **[CORREGIDO 2026-08-28] Dominio de errores congelado:** `AGT002_RADAR_QUEUE_ERROR_CODES` y el `check` de `error_code` en `072` no cambian, y `classifyAgt002RadarPreanalysisError` no se toca (§6.2.2).
- **[CORREGIDO 2026-08-28] Ningún secreto en línea de comandos ni en argumentos:** ni el wrapper, ni el cron, ni ninguna invocación de `systemctl` transporta credenciales. Todo secreto entra por `EnvironmentFile` leído por `systemd`.

## 8. Programación operativa

- **Exportación de fuente: el horario NO cambia. [CORREGIDO 2026-08-28]** Sigue siendo **una vez al día, días laborables, 13:00 UTC = 08:00 `America/Bogota`** **[OPERADOR]**. Eso ya es exactamente lo aprobado: una sincronización de fuente diaria. La recomendación anterior de "moverlo a 08:00 America/Bogota" queda **retirada** (§3.3): en tiempo absoluto no cambia nada, y expresarla como `0 8 * * 1-5` en un crontab con `TZ` efectivo UTC adelantaría la entrega cinco horas. **Cambiar la hora, añadir fines de semana o alterar la entrega son aprobaciones separadas, explícitamente fuera de esta implementación.** Lo único que se toca del crontab, y sólo al final del rollout, es **qué comando** ejecuta esa entrada ya existente y **qué reporta** su prompt (§10). Ninguna fecha/hora está hardcodeada en `agt002-radar-scan.js` ni en `agt002-radar-worker.js`; ambos reciben `now()` inyectado y no tienen noción de "hora de exportación", así que el diseño es indiferente al horario que el operador decida algún día aprobar.
- **Drenado de cola:** sin cambios, `.timer` cada 15 minutos (`OnUnitActiveSec=15m`), más el kick inmediato del wrapper tras un scan exitoso (§6.3). El plan de implementación (Task 4) verifica con un diff explícito que `ops/agt002-radar-pipeline/agt002-radar-pipeline.timer` no cambia ni una línea.
- **Exploración diaria:** sin `.timer` propio; se invoca únicamente desde el wrapper, después de que la exportación haya terminado con éxito. `ops/agt002-radar-scan/agt002-radar-scan.service` se instala (para tener supervisión, sandbox y logs de `systemd` consistentes con el resto del sistema, y porque es la unidad que el wrapper arranca — A6′) pero **no se habilita ni se le asocia timer alguno**: arranca sólo cuando algo lo invoca explícitamente (el wrapper, o un operador a mano durante QA con `systemctl start agt002-radar-scan.service`).

### 8.1 Qué se reevalúa realmente, y qué no [CORREGIDO 2026-08-28]

Hay que decirlo sin ambigüedad para no vender un ahorro que no existe:

- **El gate determinístico se reevalúa una vez al día sobre el inventario acotado completo** — hasta `maxTendersPerRun = 250` filas, ordenadas por `last_seen_at desc, id asc` **[EXISTE]** (`agt002-radar-pipeline.js:14,27`). **No** es "sólo lo nuevo": es la página acotada entera, todos los días. Cualquier afirmación de "cero reevaluación de reglas" sería falsa.
- **Lo que sí es incremental es el modelo**, y por un mecanismo que ya existe y no se reimplementa: el corto circuito `satisfied` del RPC de encolado compara `(source_row_hash, policy_version, context_version)` contra la canónica vigente y **no encola** si coinciden, de modo que una fila sin cambios no produce job y por tanto no produce llamada al proveedor. Los 1123 `satisfied` reportados **[OPERADOR]** son exactamente ese mecanismo funcionando.
- **El ledger no crece más ni menos que hoy.** La clave de idempotencia del gate incluye `evaluation_date`, así que hoy los 96 disparos diarios producen **una** fila por licitación por día (el primero escribe, los 95 siguientes reciben `{status:'existing'}`). Con el scan diario se produce igualmente **una** fila por licitación por día. El ahorro real del cambio no está en el ledger: está en **95 refrescos ESU evaluados, 95 fetches de 250 filas y ~23.750 viajes de red de ledger al día** que dejan de hacerse.
- **El worker recomputa el gate una vez más, por job reclamado**, sobre **una** fila. Si es el mismo día y la fila no cambió, esa recomputación resuelve al mismo registro de ledger ya escrito (A7).

## 9. Riesgos y mitigaciones

- **Riesgo:** el wrapper se despliega pero el cron de Hermes sigue llamando a `secop_psi_radar_export.sh` directamente (nadie actualizó el crontab). *Mitigación:* el `.timer` de 15 min sigue funcionando exactamente como antes de este cambio —sigue haciendo `esu_refresh → fetch → gate → ledger → claim → …` completo, porque **hasta que se repurpose el runner del worker, `ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs` seguirá apuntando al módulo viejo si el deploy no se completó**; el plan de implementación (Task 8) exige verificar el commit desplegado antes de tocar el crontab, y sólo actualiza el crontab después de confirmar que el worker nuevo ya está desplegado. Si el crontab se actualiza primero por error, el wrapper simplemente añade una exploración diaria extra sin drenar nada nuevo, sin perder ningún job existente.
- **Riesgo:** el kick "mejor esfuerzo" del worker falla silenciosamente y nadie lo nota. *Mitigación:* el wrapper emite una línea JSON de resultado por cada paso (§6.3); el plan exige revisar esos logs durante la QA controlada (Task 8) antes de declarar la operación estable, y el `.timer` de 15 min es la red de seguridad estructural, no una opción.
- **Riesgo:** separar `agt002-radar-pipeline.js` en dos módulos introduce una divergencia de comportamiento no intencional (p. ej. el worker deja de escribir al ledger de gate en algún camino donde el pipeline combinado sí lo hacía). *Mitigación:* la matriz de fallo (§6.2.2) y las pruebas del plan (Task 2) **replican** en el nuevo par de módulos **cada** aserción existente de `tests/agt002-radar-pipeline.test.mjs` (flag apagado, orden de etapas, cola vacía, fallo de aprendizaje, fallo de ledger, reintento tras fallo terminal, los cuatro `stale_input` por divergencia, el `stale_input` por ausencia y el conflicto de una fila que no debe abortar el lote), **sin borrar la prueba original**: durante la ventana de compatibilidad ambas suites corren, así que una divergencia se ve como un par de resultados distintos y no como una prueba que desapareció junto con su módulo.

- **[CORREGIDO 2026-08-28] Riesgo nuevo introducido por la cadencia diaria: el radio de daño de un fallo de scan pasa de 15 minutos a 24 horas.** Hoy, un fallo de fetch/gate/ledger se reintenta solo en el siguiente tick. Con el scan diario, un fallo deja el día entero sin encolar y nadie se entera hasta el día siguiente si nadie mira. *Mitigaciones exigidas, todas ya incorporadas:* (a) el runner del scan sale distinto de 0 ante `status:'unavailable'` (§6.3), de modo que la unidad queda `failed` y es visible en `systemctl`/journal; (b) el wrapper devuelve salida `20`, que el prompt del cron reporta como "fuentes persistidas, gate/encolado fallido" (§10) — un reporte accionable el mismo día; (c) la re-ejecución manual `systemctl start agt002-radar-scan.service` es **segura e idempotente** (§6.4) y es el procedimiento de recuperación documentado; (d) el `.timer` de 15 min sigue drenando lo que ya estuviera encolado, así que un fallo de scan **no** detiene el trabajo pendiente.

- **[CORREGIDO 2026-08-28] Riesgo: el prompt del cron sigue diciendo "no se persistió nada" ante cualquier fallo.** Si se cambia el comando del crontab sin cambiar el prompt, un fallo de scan se reportará como pérdida de fuente que no ocurrió. *Mitigación:* comando y prompt se cambian en **la misma edición del crontab**, al final del rollout y después de la QA controlada (§10 y plan, Task 8). Hasta entonces el cron sigue llamando al script de exportación tal cual.

- **[CORREGIDO 2026-08-28] Riesgo: el kick del worker "verde" no significa job completado.** `systemctl start` devuelve 0 mientras la unidad no falle, y el runner del worker sale 0 aun devolviendo `status:'unavailable'`. *Mitigación:* §6.3 lo declara explícitamente y §10 obliga al prompt a decir "kick invocado", no "preanálisis completado"; el resultado real se lee en el journal de la unidad.

- **[CORREGIDO 2026-08-28] Riesgo: la cobertura del gate está acotada a 250 filas por corrida y ahora hay una sola corrida al día.** El ordenamiento por `last_seen_at desc` hace que la página tienda a contener justo lo que la exportación acaba de tocar, así que en régimen normal la cobertura es la misma que hoy; pero si una exportación llegara a refrescar más de 250 filas, el excedente no se evalúa ese día. *Mitigación:* el scan reporta `evaluated`/`survivors`/`eliminated`/`enqueued`/`satisfied`/`rejected`; si `evaluated` toca sistemáticamente el techo de 250, es señal de que hay que revisar el límite o paginar. **Subir `maxTendersPerRun` o paginar está fuera de este alcance** y sería un cambio propio, con su propio análisis de costo; aquí sólo se instrumenta para poder detectarlo.

- **[CORREGIDO 2026-08-28] Riesgo: los invariantes de seguridad transversales no cubren el código nuevo.** `tests/agt002-radar-no-conversion-authority.test.mjs` enumera archivos por nombre; si `agt002-radar-scan.js`, `agt002-radar-worker.js` y `ops/agt002-radar-scan/run-agt002-radar-scan.mjs` no se añaden a `DECISION_PATH_FILES`, el código que de verdad corre en producción queda **fuera** de la garantía de "no convierte, no emite GO/NO-GO, no escribe en base fuera de RPC gobernadas". Lo mismo con el invariante de holgura lease/timeout de `tests/agt002-radar-preanalysis-runtime.test.mjs:41-47`, que hoy lee el `leaseSeconds` de `agt002-radar-pipeline.js`. *Mitigación:* el plan añade explícitamente esas entradas (Task 2b) antes de declarar nada verificado.

## 10. Semántica de reporte del cron de Hermes [CORREGIDO 2026-08-28]

**Estado actual [OPERADOR]:** la entrada de cron ejecuta el script de exportación y su prompt asociado traduce el resultado a lenguaje natural con una regla binaria: **salida 0 ⇒ se persistió; salida distinta de 0 ⇒ no se persistió nada**. Esa regla es correcta mientras la exportación sea el único paso, y **deja de serlo** en cuanto el wrapper añade etapas posteriores a la persistencia.

**Contrato nuevo, por etapa.** El wrapper emite una línea JSON por etapa ejecutada, y su código de salida es el de §6.3. El prompt del cron debe reportar exactamente esto y nada más:

| Salida | Etapas observadas | Qué debe decir el reporte | Qué **no** puede decir |
|---|---|---|---|
| `10` | `export` con `exit_code != 0` | "La exportación de fuente falló. **No se persistió nada** en `psi_public_tenders` en esta corrida. No se evaluó el gate ni se encoló trabajo." | — (aquí sí es cierto que no se persistió) |
| `20` | `export` OK, `scan` con `exit_code != 0` | "La exportación **sí persistió** las fuentes. Falló la etapa posterior de evaluación del gate / encolado: no se creó trabajo nuevo para el preanálisis. Revisar `journalctl -u agt002-radar-scan.service`. El drenado de la cola sigue activo por temporizador." | **Nunca** "no se persistió nada": es falso y además dispararía una investigación en el lugar equivocado. |
| `0` con `worker_kick.exit_code != 0` | `export` OK, `scan` OK, kick fallido | "Fuente persistida y gate evaluado correctamente. El arranque inmediato del worker no se pudo ejecutar; el temporizador de 15 minutos lo reintentará. Ningún trabajo se pierde: la cola es durable." | No presentarlo como corrida fallida; tampoco ocultarlo. |
| `0` con las tres etapas en `exit_code = 0` | todas | "Fuente persistida, gate evaluado y encolado, worker **invocado**." Puede citar `evaluated`/`survivors`/`enqueued`/`satisfied`/`rejected` **si** los toma del journal del scan. | **No** afirmar "preanálisis completado" ni "N licitaciones analizadas": el código de salida del kick no lo prueba (§6.3). |

**Reglas de redacción para el prompt:**
1. La afirmación sobre persistencia de fuente se deriva **únicamente** de la etapa `export`. Ninguna otra etapa puede modificarla.
2. Si el wrapper no emitió una etapa, el prompt dice "no se ejecutó", no infiere su resultado.
3. Cualquier detalle por licitación (cuántas evaluadas, cuántas encoladas, resultado de un preanálisis) se cita desde `journalctl -u agt002-radar-scan.service` / `journalctl -u agt002-radar-pipeline.service`, o no se cita.
4. **Cuándo se cambia:** el prompt se actualiza en **la misma edición del crontab** que cambia el comando (plan, Task 8). Nunca antes —el prompt nuevo describiría etapas que no existen— y nunca después —el prompt viejo reportaría una falsedad—.

## 11. Referencias de código citadas en este documento

- `agt002-radar-pipeline.js` (**se conserva**; deja de ser lo que ejecuta el timer — ver §3.5, §5 A8 y §6.2)
- `agt002-radar-preanalysis-worker.js` (primitivo "reclama primero" y `classifyAgt002RadarPreanalysisError`/`AGT002_RADAR_QUEUE_ERROR_CODES`, **no modificado**)
- `agt002-radar-gate.js` (`evaluateAgt002RadarGate`, `agt002RadarEvaluationDate`, no modificado)
- `agt002-radar-preanalysis-jobs.js` (`claimAgt002RadarPreanalysisJob`, `enqueueAgt002RadarPreanalysisJob`, `completeAgt002RadarPreanalysisJob`, `failAgt002RadarPreanalysisJob`; RPCs y dominio de error sin cambio. **[CORREGIDO 2026-08-28]** `persistenceError` sí se modifica mínimamente: además de fijar `runtime_boundary_code='AGT002_RADAR_PERSISTENCE_FAILURE'`, ahora preserva en el Error envuelto un `database_code` acotado (`error.code`, hasta 40 caracteres) y un mensaje acotado (hasta 500 caracteres) cuando la base devuelve un objeto plano estilo PostgREST (`{code, message}`) en vez de una instancia de `Error`. Es lo que permite a `agt002-radar-scan.js` distinguir el conflicto `55000` esperado de cualquier otro fallo — ver §6.1 arriba.)
- `agt002-radar-preanalysis-persistence.js` (`recordAgt002RadarGateEvaluation`, `recordAgt002RadarPreanalysisRun`, `computeAgt002RadarPreanalysisIdempotencyKey`, no modificado)
- `agt002-radar-learning-projection.js` (relanza el error crudo de Supabase — base de la corrección de la matriz §6.2.2)
- `esu-direct-refresh.js` (`createSupabaseEsuDirectRefresher`, no modificado), `esu-direct-crawl.js` (no lee `process.env`)
- `supabase/migrations/071_agt002_radar_gate.sql:86-95` (corto circuito de idempotencia del ledger de gate), `supabase/migrations/072_...sql:72,80-82,288-304` (dominio de `error_code` y cierre de jobs)
- `ops/agt002-radar-pipeline/*` (sólo el runner cambia de import; `.service`/`.timer` **no se tocan**; `env.example`/`README.md` se actualizan)
- `ops/agt002-radar-scan/*` (nuevo: runner, `.service` endurecida, `env.example` de menor privilegio, `README.md`, wrapper diario)
- `tests/agt002-radar-pipeline.test.mjs` (**se conserva tal cual**), `tests/agt002-radar-pipeline-systemd.test.mjs` (se actualiza para el runner del worker)
- `tests/agt002-radar-no-conversion-authority.test.mjs`, `tests/agt002-radar-preanalysis-runtime.test.mjs`, `tests/esu-direct-refresh.test.mjs`, `tests/esu-direct-refresh-adapter.test.mjs` (invariantes transversales que el plan debe extender — §3.5)
- `docs/runbooks/agt002-radar-pipeline.md` (a actualizar con la separación de procesos, preservando las cadenas literales que `tests/agt002-radar-historical-audit.test.mjs:119-132` exige)
