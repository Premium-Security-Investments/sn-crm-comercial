# AGT-002 Radar — gate, preanálisis y visibilidad: runbook operacional

## 0. Separación scan/worker, 2026-08-28

**[Actualizado 2026-08-28]** El productor de 15 minutos descrito en este runbook (una sola
invocación que hacía `esu_refresh → fetch → gate → ledger → claim → aprendizaje → AGT-002 →
persistencia`) se dividió en **dos procesos con cadencia propia**, sin flag nuevo y sin cambio de
esquema. Ver `docs/superpowers/specs/2026-08-28-agt002-daily-scan-queue-design.md` y
`docs/superpowers/plans/2026-08-28-agt002-daily-scan-queue-implementation.md` para el diseño
completo.

- **Exploración diaria** (`agt002-radar-scan.js`, `ops/agt002-radar-scan/`): `esu_refresh → fetch →
  gate → ledger → enqueue`. Corre **una vez al día**, invocada por
  `ops/agt002-radar-scan/run-agt002-radar-daily-export.sh` justo después de que la exportación de
  fuente del cron de Hermes persista con éxito (o a mano en QA). Sin `.timer` propio. Nunca reclama
  un job ni invoca al proveedor.
- **Drenado de cola cada 15 minutos** (`agt002-radar-worker.js`,
  `ops/agt002-radar-pipeline/`, mismo `.service`/`.timer` de siempre): **reclama primero** un job de
  la cola durable y, si no hay ninguno, retorna de inmediato sin refrescar ESU ni leer ninguna
  página. **Ya no es cierto que "una invocación evalúa una página acotada y reclama como máximo un
  job"** (frase heredada de la versión anterior de este runbook, corregida abajo): el scan evalúa la
  página, el worker reclama.

**Tres autorizaciones nuevas**, equivalentes a las cuatro de §3 más abajo, aplicadas al proceso de
exploración: **instalar** `agt002-radar-scan.service` (sin habilitar: no tiene `.timer`), **desplegar
el wrapper diario** (`run-agt002-radar-daily-export.sh`, versionado pero no instalado por sí solo en
ningún cron hasta que un humano lo autorice), y **actualizar el crontab de Hermes** para que llame al
wrapper en vez de al script de exportación directamente — esta última sólo procede después de la QA
controlada de la Task 8 del plan de implementación, y el cron viejo se conserva hasta entonces.

El módulo combinado `agt002-radar-pipeline.js` **se conserva en el árbol** como artefacto de
compatibilidad y rollback; ya no es lo que ejecuta el `.timer` de 15 minutos.

**Alcance:** `docs/superpowers/specs/2026-08-25-agt002-radar-learning-design.md` y
`docs/superpowers/plans/2026-08-25-agt002-radar-learning-implementation.md`.

**Estado al escribir este runbook:** ambos flags (`AGT002_RADAR_GATE`, `AGT002_RADAR_VISIBILITY`)
están **OFF** por defecto en `agt002-analysis-config.js`; las migraciones `071`/`072` existen en el
repositorio y **no** se han aplicado a ninguna base real; las unidades `systemd` de
`ops/agt002-radar-pipeline/` existen en Git y **no** están instaladas ni habilitadas. Este runbook
no enciende nada: describe el procedimiento que un humano debe seguir, con autorizaciones
separadas, cuando decida hacerlo.

## 1. Qué es y qué no es

El Radar **ingiere y muestra**. La conversión de una licitación en Oportunidad es **exclusivamente
manual**, del encargado de Licitaciones. Ningún artefacto de este alcance:

- crea filas en `psi_sales_opportunities`;
- invoca `psi_convert_tender_to_opportunity` ni `POST /api/tender-convert`;
- escribe `psi_public_tenders.internal_status` ni `converted_opportunity_id`;
- emite una decisión GO/NO-GO.

`no_mostrar_en_radar` **no es un descarte**: no toca la fila, es reversible por la siguiente corrida
y siempre lleva `human_review_required = true`. El descarte sigue siendo el acto humano que escribe
`internal_status = 'descartada'`, y ninguna tabla nueva tiene `grant` para ejercerlo.

## 2. Las dos palancas, y por qué son dos

| Flag | Por defecto | Qué habilita |
|---|---|---|
| `AGT002_RADAR_GATE` | **OFF** | La cadena productora, dividida desde 2026-08-28 en dos procesos que comparten el mismo flag (§0): exploración diaria (`fetch → gate → ledger → enqueue`) y drenado de cola cada 15 min (`claim → aprendizaje → AGT-002 → persistencia`). **No cambia nada de lo que el Radar muestra.** |
| `AGT002_RADAR_VISIBILITY` | **OFF** | El filtro de visibilidad en la lectura del Radar. |

Sólo los literales `'true'` y `'1'` (con `trim`, sin distinción de mayúsculas) encienden un flag;
cualquier otro valor —incluida la ausencia— lo deja apagado.

`AGT002_RADAR_VISIBILITY` sin `AGT002_RADAR_GATE` **lanza** en `buildAgt002AnalysisConfig`
(`agt002-analysis-config.js`): pedir que sólo se muestre lo preanalizado mientras nada produce
preanálisis vaciaría el Radar. Es una configuración contradictoria, no una degradación tolerable.

Separarlos es lo que permite el backfill: encender el productor, drenar la cola durante los días que
haga falta, auditar, y sólo entonces encender el filtro.

## 3. Cuatro autorizaciones distintas

Nunca se conceden juntas ni se infieren una de otra:

1. **Migrar** — aplicar `071_agt002_radar_gate.sql` y `072_agt002_radar_preanalysis_ledger.sql`.
2. **Instalar** — copiar `.service`/`.timer` a `/etc/systemd/system` (`systemctl` es acto humano).
3. **Encender el productor** — `AGT002_RADAR_GATE=true` en el `EnvironmentFile` del entorno.
4. **Habilitar el temporizador** — `systemctl enable --now` del `.timer`.

Y, después de todas ellas y sólo tras la auditoría del §6, la quinta y última:
**encender `AGT002_RADAR_VISIBILITY`**.

## 4. Precondición dura antes de cualquier acción contra producción

`CURRENT.md` §7.9 lo fija: **producción no es `origin/main`**. Antes de migrar, instalar o cambiar un
flag contra el entorno productivo hay que **reconfirmar el commit efectivamente desplegado** contra
el deployment vivo. No se asume la equivalencia; una estimación de impacto calculada sobre otro
commit no es una estimación.

## 5. Procedimiento por etapas

Corresponde al §12 del spec. Cada etapa tiene criterio de salida propio; no se avanza sin él.

**E0 — todo apagado, esquema aplicado en entorno no productivo.**
Migraciones `071`/`072` aplicadas fuera de producción; entrypoint creado y **no instalado**; ambos
flags OFF. Criterio de salida: suites verdes, `GET /api/tenders` sin cambio observable, y ejecutar
`node ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs` imprime `disabled` y sale con código
0 **sin tocar la base** (cero lecturas, cero escrituras, cero llamadas al puente).

**E1 — productor encendido, a mano, fuera de producción.**
`AGT002_RADAR_GATE=true` sólo en el `EnvironmentFile` no productivo. Primero la auditoría read-only
del §6; después el entrypoint **una invocación a la vez**, sin habilitar el `timer`. Criterio de
salida: la cola drena de a un job, el ledger se puebla, `psi_public_tenders` no registra ninguna
fila tocada, y el Radar no cambia.

**E1b — temporizador habilitado fuera de producción.** Autorización separada. Criterio de salida:
drenado sostenido dentro de `AGT002_RADAR_PREANALYSIS_DAILY_MAX_RUNS`, y ningún job `running` con
reserva vencida sin cerrar.

**E2 — auditoría histórica sobre datos reales.** Criterio de salida: informe con eliminadas por
regla, muestras verificables y **`uncovered_visible_tenders = 0`**.

**E3 — filtro de visibilidad.** `AGT002_RADAR_VISIBILITY=true`, con autorización separada y
explícita. Resultado esperado: el Radar muestra convertidas históricas + no convertidas con
preanálisis canónico `mostrar_en_radar` **fresco**.

### Condición dura previa a E3

El backfill debe cubrir el **100%** de las licitaciones no convertidas hoy visibles que sobreviven
el gate. El criterio es conteo cero, no un umbral porcentual: con una sola sin cubrir, encender el
flag la ocultaría sin haberla evaluado.

"Cubrir" significa **tener corrida canónica**, no tener veredicto `mostrar_en_radar`. Una licitación
con canónica `no_mostrar_en_radar` o con abstención `no_concluyente` está cubierta —fue evaluada y
dejó evidencia auditable— aunque E3 la oculte. Lo prohibido es ocultar por **ausencia** de
preanálisis. Por eso el informe de E2 debe reportar además, con muestras, cuántas visibles hoy
quedarían ocultas por cada uno de los dos veredictos no-mostrar: ese conteo es el impacto real de
encender E3 y se revisa **antes** de autorizarlo.

## 6. Auditoría e informes read-only

Los tres scripts exigen `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`. Sus accesos a
Supabase usan sólo `GET`, no aceptan ninguna bandera de escritura y **no escriben nada**. Ninguno
encola, reclama, completa ni falla un job: ese es el criterio que separa "informe" de "ejecución".
El dry-run sí invoca el puente de preanálisis para validar el sobre de salida; esa llamada externa
no persiste el resultado ni modifica Supabase.

| Script | Qué produce |
|---|---|
| `scripts/agt002-radar-gate-historical-audit.mjs` | total, sobrevivientes, eliminadas por `rule_id`, `data_gaps` por tipo, muestras verificables, convertidas que el gate eliminaría (siguen visibles por I-12), desglose por `visibility_verdict` y **`uncovered_visible_tenders`** |
| `scripts/agt002-radar-preanalysis-dryrun.mjs` | entrada cerrada + sobre del proveedor **validado** y **no persistido**, para una licitación sobreviviente indicada por ID |
| `scripts/agt002-radar-learning-signals-report.mjs` | señales candidate-specific y artefacto DRAFT, a `stdout` |

Ejecución manual (ningún comando acepta `--apply`):

```bash
ENV_FILE=/ruta/al/entorno.env node scripts/agt002-radar-gate-historical-audit.mjs > /tmp/agt002-radar-audit.json
ENV_FILE=/ruta/al/entorno.env node scripts/agt002-radar-preanalysis-dryrun.mjs <tender-id> > /tmp/agt002-radar-dryrun.json
ENV_FILE=/ruta/al/entorno.env node scripts/agt002-radar-learning-signals-report.mjs > /tmp/agt002-radar-learning.json
```

La auditoría histórica sale con código `1` mientras el ledger no esté disponible o exista al menos
una sobreviviente sin canónica fresca; ese código es el gate de seguridad esperado, no una orden de
backfill. El dry-run requiere además la configuración del puente y modelo del preanálisis. Ninguno de
los tres comandos debe ejecutarse con `AGT002_RADAR_VISIBILITY=true` como mecanismo de prueba.

El DRAFT del tercero es **para lectura humana**. Cambiar una regla del gate exige que una persona lo
lea y edite `agt002-radar-gate.js` subiendo `AGT002_RADAR_GATE_POLICY_VERSION`. No existe camino de
escritura de reglas en tiempo de ejecución.

**Vigencia de las decisiones GO/NO-GO en el aprendizaje.** `psi_tender_go_no_go_decisions` no expone
una relación PostgREST autorreferente sobre `supersedes_decision_id`: pedirla devuelve `HTTP 400
PGRST200` y tumbaba el reporte y el dry-run completos. La proyección lee la columna plana y resuelve
la sucesión en JS. Como el lote principal está acotado por `limit`, un sucesor puede quedar fuera de
él (por ejemplo una corrección retrofechada), así que además se consulta la arista inversa
`supersedes_decision_id in (…)` acotada a las decisiones que el lote todavía considera vigentes, en
trozos de 50 identificadores; si un trozo vuelve saturado se subdivide hasta que ninguna decisión
quede escondida detrás del truncamiento. De cada cadena sobrevive sólo la hoja y, si un tender
conserva varias hojas, la más reciente por `decided_at` (desempate por `id`). Todo esto son `GET`:
no hay RPC ni escritura, y la evidencia sigue citando el `id` de la decisión humana proyectada.

## 7. Qué significa "fresco", y por qué una licitación desaparece

Con `AGT002_RADAR_VISIBILITY` encendido, una fila **no convertida** se muestra si y sólo si:

1. existe corrida canónica para ella;
2. su `visibility_verdict` es `mostrar_en_radar`;
3. su `source_row_hash` coincide con el hash recalculado sobre **la fila que se va a mostrar**;
4. su `policy_version` **y** su `context_version` son las vigentes en el proceso lector;
5. el **gate determinista vigente** la sigue considerando `sobreviviente` al reevaluarla en lectura.

La quinta condición existe porque una canónica positiva es una **foto del día en que se produjo**.
El veredicto `fecha_vencida` depende del día calendario en `America/Bogota`, así que una fila
preanalizada como visible el lunes puede haber cruzado su cierre el martes sin que cambie ni su
`source_row_hash` ni ninguna versión. La lectura reevalúa el gate con **un único reloj para toda la
página** —determinista, sin reloj por fila— y oculta lo que ya no sobrevive.

Las **convertidas históricas se muestran siempre**, cortocircuitando las cinco condiciones —la
reevaluación del gate incluida—: no se ocultan por hash rezagado, por versión vieja, por cierre
vencido ni por no tener preanálisis alguno.

Si el reloj o el evaluador no están disponibles, la lectura **no** degrada a "mostrar igual": falla
cerrado en el mismo borde 503 del §8.

Seis causas ocultan, y son deliberadamente indistinguibles en la superficie: sin canónica,
canónica `no_mostrar_en_radar`, canónica `no_concluyente`, canónica con hash rezagado, canónica con
versión rezagada, y fila eliminada por el gate vigente. El desglose por causa **existe**, y vive en
el informe del §6 —que es donde un humano lo necesita—, no en el payload.

**Una fila oculta por rezago se repara sola.** El triple `(source_row_hash, policy_version,
context_version)` que oculta es exactamente el que impide al encolado corto circuitar en
`satisfied`: la siguiente corrida del pipeline la encola, la preanaliza y la devuelve a la
superficie, al ritmo del temporizador y sin backfill manual.

## 8. Diagnóstico: el Radar responde 503

`AGT002_RADAR_VISIBILITY_LEDGER_UNAVAILABLE` (HTTP 503) significa que el flag está encendido y la
lectura del ledger falló o las tablas no existen. Es deliberado: mostrar todo sin filtrar violaría
la política y mostrar vacío destruiría la operación, así que la petición falla en voz alta.

**Recuperación: una sola acción — apagar `AGT002_RADAR_VISIBILITY`.** El Radar vuelve
inmediatamente a su comportamiento previo. Con el flag apagado —el estado por defecto— esta ruta es
inalcanzable, y la lectura del Radar no emite ninguna consulta adicional.

Causa habitual: se encendió el flag sin haber aplicado `072`, o el `grant select` sobre las tablas
nuevas no alcanza al rol que lee.

## 9. Rollback

- **De cualquier etapa de encendido:** poner el flag en cualquier valor distinto de `'true'`/`'1'`
  (o eliminarlo). Si se llegó a E1b, además `systemctl disable --now` del `.timer`.
  No requiere migración inversa.
- **El ledger se conserva:** es historia, no estado mutable. Los jobs `queued` sin drenar son
  inertes —nada los ejecuta si el entrypoint no corre— y el encolado volverá a corto circuitar en
  `satisfied` cuando exista canónica.
- **De esquema:** `supabase/rollbacks/072_...` **primero**, luego `supabase/rollbacks/071_...`.
  Ninguno de los dos toca `psi_public_tenders`.

## 10. Costo y ritmo del backfill

El preanálisis es **una llamada al proveedor por licitación sobreviviente**, y una corrida del
pipeline procesa **a lo sumo un job**. El backfill avanza al ritmo del `timer`, no al de la página
leída: es una elección deliberada que acota el costo por invocación y el radio de un fallo.

Si el ritmo resulta insuficiente, las palancas son la **frecuencia del `timer`** y
`AGT002_RADAR_PREANALYSIS_DAILY_MAX_RUNS` — nunca un bucle interno, que reintroduciría exactamente
el modo de falla que la cola durable elimina.

### Timeout del proveedor: techo de 5 minutos bajo el lease de 600 s

`AGT002_RADAR_PREANALYSIS_TIMEOUT_MS` acota una única llamada al proveedor. Rango aceptado
**`1000`–`300000` ms**, por defecto **`30000`**, que es también el valor recomendado en producción.
Un valor fuera de rango o malformado **no se recorta**: `getAgt002RadarPreanalysisRuntimeConfig`
lanza `AGT002_RADAR_RUNTIME_CONFIG_INVALID` y el runtime no llega a construirse.

El techo existe por la cola durable. El pipeline reclama el job con `leaseSeconds = 600`; después de
que el proveedor responde todavía quedan aprendizaje, validación del sobre y persistencia. Permitir
un timeout de 600 000 ms era admitir que la reserva venciera **después** de una respuesta exitosa:
otro disparo podría reclamar el mismo job mientras el primero aún estaba persistiendo. Con 300 000 ms
quedan ≥300 s de holgura. El lease y `TimeoutStartSec=720` de la unidad **no** se tocan; subir el
timeout no es la palanca para un backfill más rápido (véanse la frecuencia del `timer` y
`AGT002_RADAR_PREANALYSIS_DAILY_MAX_RUNS`, arriba).

### Identidad diaria del gate y coalescencia de intentos

La clave de idempotencia del gate incluye la **fecha calendario efectiva en `America/Bogota`**
además de `(tender, source_row_hash, policy_version, context_version)`. Sin ella, la misma fila
producía dos veredictos distintos bajo la misma clave al cruzar su cierre y el ledger append-only
devolvía `23505` permanente. Consecuencia operativa: el ledger de gate crece una fila por licitación
y **por día** mientras el productor corra; es historia, no estado mutable.

Esa identidad diaria **no** dispara reanálisis diario: el corto circuito `satisfied` del encolado
sigue comparando sólo `(source_row_hash, policy_version, context_version)` contra la canónica.

Cuando ya existe un job `queued`/`running` para la licitación y llega un intento con la **misma
entrada semántica** —mismo `source_row_hash` y mismas versiones, aunque el `gate_evaluation_id` y la
clave de intento sean nuevos por el cambio de día—, el encolado devuelve **el job existente
conservando su identidad de intento original** en vez de conflictuar. Si la entrada difiere en algo
material, sigue siendo conflicto `55000`: no se conflacionan fuente, política ni contexto. Ese
rechazo es de esa fila, no de la corrida: el lote continúa y el `claim` se ejecuta igual.

### `rejected`: sólo el conflicto 55000, nunca un fallo de infraestructura

`rejected` en el resultado de `agt002-radar-scan.js` cuenta **exclusivamente** el conflicto
semántico esperado de `psi_enqueue_agt002_radar_preanalysis_job` —`SQLSTATE 55000` con el mensaje
fijo "AGT-002 Radar tender already has a different active job"— descrito arriba: una licitación con
un job activo bajo una entrada semántica distinta. El scan reconoce ese conflicto exacto (código
**y** mensaje) por fila, incrementa `rejected` y sigue con el resto del lote.

Cualquier otro fallo de encolado —caída de conexión con Supabase, timeout, error genérico de
PostgREST, cualquier código distinto de `55000` o el mismo `55000` con un mensaje distinto— **no**
se cuenta como `rejected`: se propaga y aborta la corrida completa con `status:'unavailable'`,
`error_code:'persistence_failure'`. Contar un fallo de infraestructura como un rechazo silencioso
por fila disfrazaría una caída real de Supabase/la cola como una corrida diaria exitosa, y ni la
unidad `systemd` ni el wrapper de Hermes lo detectarían. El texto crudo del error nunca se expone en
el resultado del scan, precisamente porque `unavailable`/`persistence_failure` ya es la señal
suficiente para investigar en `journalctl -u agt002-radar-scan.service`.

### `stale_input`: un job que sobrevivió a su fila

La cola es durable y el gate se reevalúa en cada disparo, así que un job encolado ayer puede
reclamarse hoy sobre una fila que el gate vigente ya eliminó. Tras el `claim`, el pipeline exige que
la evaluación vigente siga siendo `sobreviviente` y coincida con `(source_row_hash, policy_version,
context_version)` del job. Si no coincide, el job se cierra como **`stale_input`** —código terminal
acotado, mensaje fijo— **sin invocar a AGT-002 y sin persistir corrida**: nunca se produce una
canónica positiva para una fila actualmente eliminada. Un `stale_input` no bloquea nada: es terminal,
y la fila se reencola limpia en la corrida siguiente si vuelve a sobrevivir.

Si `AGT002_RADAR_GATE_POLICY_VERSION` cambia con jobs sin drenar, esos jobs conservan la política
congelada en su fila y se ejecutan igual, atribuidos a la versión con la que se encolaron; el gate
reevaluará la fila bajo la nueva política en la corrida siguiente. **Purgar la cola es una acción
humana explícita**, fuera de este runbook.

## 11. Lo que este runbook no autoriza

- Aplicar `071`/`072` a producción, ni asumir que producción es `origin/main`.
- Instalar o habilitar el `.service`/`.timer` como parte de encender el flag: son autorizaciones
  distintas.
- Encender `AGT002_RADAR_VISIBILITY` antes de un informe de auditoría con
  `uncovered_visible_tenders = 0` leído por una persona.
- Tratar un `no_mostrar_en_radar` como descarte, o escribir `internal_status` a partir de él.
- Cualquier decisión GO/NO-GO, o cualquier conversión de licitación en Oportunidad: siguen siendo
  actos exclusivamente humanos, en sus propios componentes, ajenos a este alcance.
