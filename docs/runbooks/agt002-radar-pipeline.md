# AGT-002 Radar — operación determinística: runbook operacional

> **[Reescrito 2026-09-28, issue #247]** Este runbook reemplaza por completo sus versiones
> anteriores. El Radar AGT-002 es hoy **exclusivamente determinístico**: no hay preanálisis de IA en
> operación, no hay flags que encender, no hay cola durable en uso y no hay temporizador corriendo.
> Este documento describe únicamente el procedimiento vigente; no contiene, ni por referencia, pasos
> para activar IA/flags/worker/modelo. El estado que codifica está registrado en
> `CURRENT.md` §17.

## 1. Propósito

El Radar de Licitaciones **ingiere y muestra** procesos públicos captados desde la fuente ESU. Su
única función es filtrar por un gate determinista y versionado, y dejar constancia de cada
evaluación en un ledger histórico. El Radar no decide, no convierte y no invoca ningún modelo:

- No crea filas en `psi_sales_opportunities`.
- No invoca `psi_convert_tender_to_opportunity` ni `POST /api/tender-convert`.
- No escribe `psi_public_tenders.internal_status` ni `converted_opportunity_id`.
- No emite ni insinúa una decisión GO/NO-GO.
- No llama a ningún proveedor de IA ni modelo como parte de su flujo operativo: el preanálisis de IA
  que antes ocupaba ese lugar está retirado (§5).

La conversión de una licitación en Oportunidad sigue siendo un acto **exclusivamente humano**, del
encargado de Licitaciones. `no_mostrar_en_radar` no es un descarte: no toca la fila fuente, es
reversible por la siguiente corrida del gate y nunca implica una decisión de negocio. El descarte
real sigue siendo el acto humano que escribe `internal_status = 'descartada'`.

## 2. Flujo determinístico

El único proceso operativo del Radar es el **scan**, invocado bajo demanda:

```text
esu_refresh → fetch → gate → ledger
```

1. **`esu_refresh`** — intenta refrescar la fuente ESU directa. Un fallo o resultado
   `skipped_fresh`/`unavailable` **no bloquea** las etapas siguientes: el scan continúa contra lo que
   ya está persistido en `psi_public_tenders`.
2. **`fetch`** — lee una página acotada de `psi_public_tenders` (`maxTendersPerRun`, 250 por
   defecto), ordenada por `last_seen_at` descendente y `id` ascendente.
3. **`gate`** — evalúa cada fila con el gate determinista vigente (`evaluateAgt002RadarGate`,
   `agt002-radar-gate.js`), versionado por `AGT002_RADAR_GATE_POLICY_VERSION` y
   `AGT002_RADAR_GATE_CONTEXT_VERSION`.
4. **`ledger`** — anota cada evaluación (veredicto, `rule_ids`, razones, `data_gaps`, versiones,
   hash de la fila fuente, fecha de evaluación efectiva) vía la RPC gobernada
   `psi_record_agt002_radar_gate_evaluation`, con clave de idempotencia derivada de la evaluación.

**No hay quinta etapa.** El scan no encola, no reclama, no invoca ningún proveedor ni modelo:
`AGT002_RADAR_SCAN_STAGES` (`agt002-radar-scan.js`) es exactamente
`['esu_refresh', 'fetch', 'gate', 'ledger']`, sin `enqueue` y sin ningún verbo de cola. El resultado
de una corrida es `{status:'completed', stages, esu_refresh, evaluated, survivors, eliminated}` o
`{status:'unavailable', ..., error_code}` ante un fallo de `fetch`/`gate`/`ledger`.

Este flujo es **siempre activo cuando se invoca**: no depende de ningún flag. No existe hoy ningún
interruptor que lo apague ni que lo encienda de forma distinta a "invocarlo o no invocarlo".

## 3. Ejecución on-demand del scan

El scan se ejecuta manualmente o desde un disparador operativo externo al Radar (por ejemplo, tras
una exportación de fuente exitosa). No tiene `.timer` propio y no corre en segundo plano:

```bash
node -e "
import('./agt002-radar-scan.js').then(async ({ createAgt002RadarScan }) => {
  const scan = createAgt002RadarScan({ database, now: () => new Date().toISOString() });
  console.log(JSON.stringify(await scan.runOnce()));
});
"
```

- `database` debe ser un cliente con acceso de lectura a `psi_public_tenders` y con permiso para
  invocar `psi_record_agt002_radar_gate_evaluation`.
- Una invocación procesa **una sola página** (hasta `maxTendersPerRun`) y termina; no hay bucle
  interno, no hay reintentos automáticos y no hay llamada de red a ningún proveedor de IA.
- Ejecutarlo dos veces sobre el mismo estado de datos es seguro: la clave de idempotencia del ledger
  evita duplicar la fila de evaluación del mismo día para la misma licitación.

## 4. Observabilidad

- **Resultado de cada corrida**: el `status` (`completed`/`unavailable`), las `stages` alcanzadas,
  `evaluated`/`survivors`/`eliminated` y, ante fallo, `error_code` (`provider_error` para reloj/fetch
  inválidos, `persistence_failure` para fallos de escritura del ledger).
- **Ledger de gate**: cada fila evaluada queda escrita, éxito o eliminación, con `rule_ids`, razones
  y `data_gaps`; es la fuente de verdad para auditar qué pasó y por qué en cualquier corrida pasada.
- **Auditoría histórica de sólo lectura**: `scripts/agt002-radar-gate-historical-audit.mjs` sigue
  siendo el mecanismo para inspeccionar el ledger acumulado (totales, eliminadas por regla,
  `data_gaps` por tipo, muestras verificables) sin escribir nada. Usa sólo `GET`, no acepta
  `--apply` y no invoca ningún RPC de escritura ni de cola.
- **Diagnóstico de fallo**: un `status:'unavailable'` con `error_code:'persistence_failure'` indica
  que el ledger no aceptó la escritura (permisos, tabla ausente, error de RPC); revisar el mensaje
  de error propagado por el cliente de base de datos usado en la invocación, no un log de proceso en
  segundo plano, porque no hay ninguno corriendo.

## 5. `tender-fit-v1` y el gate: afinación gobernada con revisión humana y versionado

La única superficie de "encaje"/priorización que el Radar expone hoy fuera del gate de
sobrevivencia es `tender-fit-v1` (`tender-fit-policy.js`): una política **pura, determinística y
versionada** que deriva un puntaje/banda de encaje en memoria, sin persistencia ni migración, para
alimentar el filtro y el orden "Encaje" del Radar. No sustituye al gate determinista: el gate decide
si una fila sobrevive; `tender-fit-v1` sólo prioriza entre las que ya sobrevivieron o ya están
listadas.

Reglas de gobierno, vigentes para **ambos** — el gate (`agt002-radar-gate.js`,
`AGT002_RADAR_GATE_POLICY_VERSION`) y `tender-fit-v1` (`tender-fit-policy.js`,
`TENDER_FIT_POLICY_VERSION`):

- Toda regla o peso está **versionado explícitamente**. Cambiar una regla exige subir la constante
  de versión correspondiente (`AGT002_RADAR_GATE_POLICY_VERSION` o `TENDER_FIT_POLICY_VERSION`); no
  existe camino de escritura de reglas en tiempo de ejecución ni desde configuración externa.
- Todo cambio de peso o regla requiere: (a) una cohorte revisada de datos reales, (b) una
  comparación sombra entre la versión vigente y la propuesta sobre el mismo cohorte, sin desplegar
  la nueva versión como activa, (c) la nueva constante de versión, y (d) aprobación humana explícita
  registrada. Ningún artefacto de este alcance ajusta pesos automáticamente a partir de
  retroalimentación.
- En `tender-fit-v1`, el campo `feedback` es **de solo evidencia**: `applied_points` es siempre `0`.
  Ninguna observación histórica (conversión, análisis canónico, decisión GO/NO-GO, resultado de
  oferta) mueve el puntaje en la versión vigente.
- La auditoría de cohorte de sólo lectura (`scripts/tender-fit-cohort-audit.mjs`, siguiendo el mismo
  patrón que la auditoría del gate) es el mecanismo para comparar distribuciones legado vs. `fit` y
  para dar contexto descriptivo a partir de observaciones colapsadas por licitación — nunca para
  ajustar pesos por sí sola. No escribe nada, no acepta `--apply`.
- Ausencia de dato (valor, fecha de cierre, territorio) nunca se interpreta como mal encaje ni como
  incumplimiento: se refleja como `data_gaps` y, cuando es crítica, fuerza la banda `por_validar`,
  nunca oculta ni descarta la fila.

## 6. Tombstone del preanálisis de IA — retirado, no reactivable desde este árbol

El pipeline de preanálisis de IA que antes ocupaba `ops/agt002-radar-pipeline/` está **retirado**:

- `run-agt002-radar-pipeline.mjs` sólo responde a `--control-plane` (reporte de identidad sin efecto
  secundario, gateado antes de cualquier requisito de secreto). Cualquier otra invocación imprime
  `{"status":"retired","code":"AGT002_RADAR_AI_RETIRED"}` y termina sin reclamar cola, sin llamar al
  puente ni al modelo, sin crear cliente de Supabase y sin leer ningún secreto ni variable de
  entorno.
- El `.service` y el `.timer` correspondientes son un tombstone: rechazan el arranque manual y no
  declaran `EnvironmentFile` ni ninguna variable de secreto/configuración. El `.timer` sí tiene un
  `OnCalendar` sintácticamente presente pero inerte: `ConditionPathExists=/run/agt002-radar-ai-retired-do-not-create`,
  `RefuseManualStart=true` y la ausencia de sección `[Install]` impiden su inicio. No hay forma de
  iniciarlos sin editar primero la unidad versionada.
- El código del worker (`agt002-radar-worker.js`), del runtime de preanálisis
  (`agt002-radar-preanalysis-runtime.js`) y de las jobs de cola (`agt002-radar-preanalysis-jobs.js`)
  se conserva en el árbol como historia, pero el worker queda inerte: su función `enabled(...)` lee
  `AGT002_RADAR_GATE` desde la config canónica, y ese flag ya no existe en `ANALYSIS_FLAG_NAMES`
  (§7), así que cualquier invocación del worker devuelve `disabled` sin tocar base de datos.
- El host que ejecutaba este pipeline **sigue apagado**. El runner/tombstone no lee secretos ni
  `EnvironmentFile` (ver arriba); la configuración inactiva o de respaldo que pueda existir se
  conserva fuera del alcance de este runbook, sin revelar sus valores aquí.

**Reactivar cualquiera de estas piezas no es un cambio de configuración ni de flag: es un rediseño**
que requiere spec, plan y aprobación humana explícita nuevos, fuera del alcance de este documento.
Este runbook no autoriza ni describe ese camino.

## 7. Flags retirados

`AGT002_RADAR_GATE` y `AGT002_RADAR_VISIBILITY` ya no existen en `ANALYSIS_FLAG_NAMES`
(`agt002-analysis-config.js`): `buildAgt002AnalysisConfig(...)` no los parsea, no los declara como
clave del objeto de flags devuelto, y su antigua dependencia fail-closed (`VISIBILITY` sin `GATE`
lanzaba) fue retirada junto con ellos. No hay ningún valor de entorno que active preanálisis de IA ni
un filtro de visibilidad gobernado por él. El Radar siempre muestra según el gate determinista
vigente (§2), sin una segunda capa de visibilidad que encender.

## 8. Preservación del ledger histórico y de las migraciones

- `supabase/migrations/071_agt002_radar_gate.sql` y
  `supabase/migrations/072_agt002_radar_preanalysis_ledger.sql`, junto con sus rollbacks
  independientes, permanecen en el árbol. No se eliminan ni se reescriben: son la base del ledger de
  gate y de preanálisis ya aplicado.
- El ledger es **append-only**: cada fila escrita por una corrida del scan (§2) o, en su momento,
  por el pipeline de preanálisis retirado (§6), es historia inmutable. Este cierre no purga, no
  trunca ni reescribe ninguna fila existente.
- Cualquier auditoría o reporte que necesite leer ese histórico (§4) sigue disponible sin cambios de
  esquema. El retiro del pipeline de IA no afecta la legibilidad del ledger acumulado.

## 9. Separación del análisis integral postconversión

El análisis integral que corre **después** de que un humano convierte una licitación en Oportunidad
(el flujo de Análisis/Decisión del frente decisional, cerrado en `CURRENT.md` §13) es un proceso
**distinto y separado** del preanálisis de IA del Radar que este runbook documenta como retirado:

- Nunca dependió del preanálisis de IA del Radar como entrada de autoridad ni como precondición.
- No usa la cola de preanálisis retirada, no invoca `run-agt002-radar-pipeline.mjs` ni ningún
  artefacto de `ops/agt002-radar-pipeline/`.
- El retiro descrito en §5–§7 no cambia, no bloquea ni degrada el análisis integral postconversión.

El Radar sigue siendo, de principio a fin, un mecanismo de **detección y listado previo a la
conversión**; el análisis integral postconversión opera sobre Oportunidades ya creadas, por decisión
humana, en su propia superficie.

## 10. Contrato F1 10

Ver `CURRENT.md` §17.2 para la definición vigente y autoritativa. En resumen, para referencia rápida
desde este runbook:

- **F1 v2** = las **primeras 10 licitaciones reales** convertidas por un humano a Oportunidad
  **después del receipt** de este cierre, **únicas por tender**.
- Cuenta el **análisis inicial postconversión** que alcanza un **estado terminal durable** para esa
  licitación; los **retries quedan deduplicados** (no generan una segunda entrada).
- **Reanalysis y preanalysis quedan excluidos** de la cohorte.
- **Sin ventana de 14/30 días, sin cohortes de 100+100 y sin afirmación estadística**: es un conteo
  de casos reales, no una muestra ni una proyección.

Este runbook no define cómo se calcula o reporta F1 10 operativamente más allá de lo anterior; ese
mecanismo de medición, si se automatiza, requiere su propio diseño y aprobación separados.

## 11. Lo que este runbook no autoriza

- Encender `AGT002_RADAR_GATE` ni `AGT002_RADAR_VISIBILITY`: ninguno de los dos existe ya como flag
  parseable (§7).
- Instalar, habilitar o iniciar manualmente el `.service`/`.timer` del pipeline de preanálisis de IA
  (§6): están construidos deliberadamente para rechazar el arranque manual; el `.timer` tiene un
  `OnCalendar` sintáctico pero inerte, bloqueado por `ConditionPathExists`, `RefuseManualStart=true`
  y la ausencia de sección `[Install]`.
- Ejecutar el worker de preanálisis, el runtime del modelo o cualquier llamada al puente de IA como
  parte de la operación normal del Radar.
- Tratar `no_mostrar_en_radar` como descarte, o escribir `internal_status` a partir de él.
- Cualquier decisión GO/NO-GO o cualquier conversión de licitación en Oportunidad: siguen siendo
  actos exclusivamente humanos, ajenos a este alcance.
