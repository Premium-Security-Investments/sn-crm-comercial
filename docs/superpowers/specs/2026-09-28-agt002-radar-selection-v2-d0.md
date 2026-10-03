# Especificación normativa D0 — Selección Canónica del Radar AGT-002 v2

**Fecha:** 2026-09-28
**Política:** `agt002-radar-selection-v2`
**Estado:** `D0_CANDIDATE_FOR_HUMAN_REVIEW`
**Repositorio:** `Premium-Security-Investments/sn-crm-comercial`

**Naturaleza de este documento.** Es diseño y especificación normativa solamente. No autoriza,
implica ni habilita: código, esquema de base de datos, migración, replay contra datos reales,
corrida en modo sombra (*shadow*), despliegue, cambio de configuración productiva, escritura real
sobre ninguna tabla, ni comunicación saliente (CRM, Discord o cualquier otro canal). Ningún gate
posterior a D0 (D1, S0, S1, producción) queda abierto por este documento; cada uno requiere su
propia puerta humana explícita, descrita en la sección O.

---

## Cadena de custodia

Este documento consolida y sustituye, como dirección normativa futura, la coexistencia actual de
score legado, cupos por sección, gate determinístico, `tender-fit-v1` y proyecciones de UI/CRM/Discord
como autoridades separadas y potencialmente divergentes sobre qué proceso merece atención comercial.
Esa consolidación fue trabajada y revisada con la siguiente cadena de custodia:

| Artefacto | SHA |
|---|---|
| Propuesta final | `47fba50f13dab12929cb97dcd43250c58112ae592c3507552ee7c56596da2a0b` |
| Revisión Fable 001 | `26520ff659b564a74fae6a584232250ec118d13a16197133d3622e833185981d` |
| Adenda v2.1 | `455b91932083a58e61057505ae1426b908f24f598aba21bb99fcc9dd31c27d23` |
| Revisión Fable 002 (SHA local) | `af6c042b3fb2acf3c0a532b16231de56cb672b5f6a0d7d328591323ba3dc33bb` |

Fable emitió `APPROVE_D0_DIRECTION` sobre esa cadena. Esa marca es una aprobación de **dirección
normativa**, no una autorización de construcción: no habilita D1, no habilita schema, no habilita
ningún flag, y no sustituye la revisión humana que este documento solicita como próximo paso (sección
Q). Este documento es el texto candidato que esa cadena de revisión produjo, presentado ahora para
revisión humana — no está aprobado por el responsable de producto, y este documento no debe leerse
en ningún momento como si lo estuviera.

---

## 0. Relación con el estado operativo vigente

Al 2026-09-28, `CURRENT.md` §17 registra que el Radar AGT-002 es **determinístico único**: no hay
preanálisis de IA en operación, los flags `AGT002_RADAR_GATE`/`AGT002_RADAR_VISIBILITY` fueron
retirados del config, el runner de preanálisis IA es un tombstone retirado, y la única superficie de
priorización activa fuera del gate de sobrevivencia es `tender-fit-v1` (`tender-fit-policy.js`), una
política pura, determinística y versionada que deriva puntaje/banda de encaje en memoria.

Este documento:

- **no reactiva** el preanálisis de IA ni ninguno de sus flags, cola, worker o `systemd`; el
  preanálisis con IA permanece retirado exactamente como lo deja `CURRENT.md` §17;
- **no modifica** `tender-fit-v1` ni ninguno de sus contratos (`tender-fit-policy.js`,
  `dbTenderToPublic`, el filtro/orden "Encaje"). `tender-fit-v1` queda intacto por ahora — cualquier
  convergencia entre `tender-fit-v1` y el eje de prioridad descrito en la sección J de este documento
  es trabajo de un gate posterior (D1 en adelante), no de D0;
- **sí propone**, como dirección normativa futura y sustituyendo la coexistencia actual de score
  legado / cupos por sección / gate / `tender-fit-v1` / proyecciones de UI-CRM-Discord como
  autoridades separadas, un único run canónico de selección con una sola tabla de resolución de
  estado (sección I) y ejes de prioridad estrictamente posteriores y separados de la elegibilidad
  (sección J).

La coexistencia actual no se declara defectuosa por sí misma: `tender-fit-v1` fue diseñado
explícitamente como una proyección adicional, no autoritativa, sobre el gate existente
(`docs/superpowers/specs/2026-09-20-radar-fit-feedback-design.md`), y el gate determinístico
(`docs/superpowers/specs/2026-08-25-agt002-radar-learning-design.md`,
`docs/runbooks/agt002-radar-pipeline.md`) ya declara sus propias reglas y su propio ledger
append-only. Lo que este documento observa es que hoy existen **varias autoridades independientes**
(score legado, sección `hacer`/`revisar`/`prioridad_baja`, gate, `tender-fit-v1`, y cualquier lectura
directa que la UI, el CRM o Discord hagan sobre columnas distintas) sin una única función de
resolución que las subordine, y propone sustituir esa coexistencia por el modelo de esta
especificación como dirección futura — no como una corrección urgente del estado actual, que sigue
operando dentro de sus propios límites ya documentados.

---

## 1. Propósito funcional y alcance

### 1.1 Propósito

El Radar Canónico de Selección v2 existe para:

1. **Adquirir y normalizar procesos** desde las fuentes oficiales configuradas, dejando constancia
   verificable de qué se intentó traer y qué efectivamente se selló.
2. **Decidir deterministicamente cuáles merecen atención comercial**, mediante una única función de
   resolución de estado, evaluada sobre evidencia y nunca sobre inferencia no verificable.
3. **Separar elegibilidad y prioridad** como dos preguntas distintas: elegibilidad responde "¿puede
   este proceso presentarse como candidato?"; prioridad responde, sólo para los que ya son elegibles,
   "¿en qué orden merece atención humana?".
4. **Presentar los resultados de forma simple y explicada al humano**, con razones citables, sin
   score agregado opaco.
5. **Dejar la conversión a Oportunidad exclusivamente en manos del humano**. El sistema nunca
   convierte, nunca decide GO/NO-GO, y nunca ejecuta ningún paso del flujo comercial posterior a la
   conversión.

### 1.2 Lo que este documento no automatiza

- No automatiza la conversión de un proceso en Oportunidad.
- No automatiza ni emite una recomendación GO/NO-GO.
- No automatiza el análisis profundo posterior a la conversión (el análisis integral/canónico sobre
  la Oportunidad ya creada, descrito en otros diseños, sigue siendo un flujo separado y no depende de
  esta especificación).
- No automatiza la oferta, la adjudicación ni ningún paso del workflow comercial posterior.

### 1.3 No es un proyecto de rediseño visual

D0 define **qué se muestra**: estados, orden, razones, campos, agrupación y reconciliación de
totales. D0 **no** define ni autoriza:

- cambios de colores, tipografía o branding;
- cambios de navegación o layout;
- cambios de componentes;
- ningún cambio bajo `src/`.

La forma visual actual del Radar puede conservarse sin modificación. Cualquier proyección descrita
en la sección L es un contrato de datos, no un mockup ni una instrucción de diseño de interfaz.

### 1.4 Fuera de alcance

- **AGT-003** y cualquiera de sus flujos, contratos o superficies.
- **DANE** y **MinTIC** como fuente, dependencia o validación — no se introduce ninguna dependencia
  hacia esos organismos en este documento.
- **Señales privadas** que ya son competencia de otro agente: este documento no absorbe, redefine ni
  reclama autoridad sobre señales que el diseño vigente transfiere a otro agente (véase la regla R5,
  sección I, que las pone en cuarentena sin trasladarlas).
- **IA runtime** y **aprendizaje automático** de cualquier tipo: la selección descrita aquí es
  puramente determinística (principio "cero IA", sección A).
- **Migración** de datos o de esquema: este documento no propone ni autoriza ninguna migración
  concreta; el diseño de esquema pertenece a D1 en adelante.
- **Producción**: ningún contenido de este documento se ejecuta contra producción.
- **Composición editorial final de Discord**: este documento fija el contrato de qué subconjunto
  puede proyectarse y bajo qué reglas de determinismo (sección L.3), pero no diseña el mensaje, el
  formato ni el tono de la publicación final.

---

## 2. Las siete piezas obligatorias de la revisión Fable

Esta especificación incorpora explícitamente, como obligación normativa y no como sugerencia, las
siete piezas que la revisión Fable identificó como necesarias para que D0 sea completo:

| # | Pieza obligatoria | Dónde se resuelve en este documento |
|---|---|---|
| 1 | Evaluación total y resolución única final | Principio de autoridad única (sección A); tabla R0–R16 (sección I) |
| 2 | Taxonomía de fases | Sección E |
| 3 | Política de modalidades/régimen especial | Sección F |
| 4 | Identidad completa con merge/split/reversión/workflow/fases simultáneas | Sección D |
| 5 | Elegibilidad estructuralmente incapaz de recibir señales de prioridad | Sección J.1 |
| 6 | Retención de raw original por clase de fuente | Sección C.5 |
| 7 | Congelamiento de umbrales antes de S1 | Sección O.4 |

---

## A. Principios

Estos principios son invariantes de diseño de la política `agt002-radar-selection-v2`. Ninguna
sección posterior de este documento, ni ningún diseño de implementación derivado, puede contradecirlos
sin abrir una nueva versión de política con su propia revisión humana.

1. **Única autoridad por run.** Para un `run_id` dado, existe exactamente una función de resolución
   de estado (la tabla R0–R16, sección I) y exactamente un `phase_selection_status` por cada unidad
   `(business_process_id, source_phase_id)` sellada y resoluble evaluada (sección D.8.1). No hay una
   segunda autoridad (score legado, `tender-fit-v1`, una lectura directa de columna en CRM o Discord)
   que pueda producir un estado distinto para la misma unidad proceso+fase en el mismo run. El
   resumen compacto por proceso (`process_summary_bucket`, sección D.8.2) es una proyección pura de
   estos resultados de fase — no es una segunda autoridad de elegibilidad y nunca puede producir, por
   sí solo, un estado que no provenga de una evaluación de fase ya resuelta.
2. **Manifiesto antes de filtros comerciales.** Ninguna fila se descarta de la observación sellada por
   razones comerciales (relevancia de servicio, modalidad, prioridad) antes de que el manifiesto quede
   sellado. Sólo el rechazo técnico (ventana técnica, transporte, parseo, ausencia de identificador)
   puede impedir que una fila entre al manifiesto.
3. **Proceso, fase, registro y run son entidades separadas.** Un proceso de contratación no es una
   fase; una fase no es un registro de observación; un registro de observación no es una corrida de
   evaluación. Cada una tiene su propio identificador y su propio ciclo de vida (sección D).
4. **Todos los ejes siempre se calculan.** Los siete ejes de la sección G se computan para todo
   proceso evaluado, sin importar cuál vaya a ser el estado final. No existe un camino corto que evite
   calcular un eje porque otro ya "decidió".
5. **Sólo la tabla R0–R16 asigna estado.** Ningún eje individual, por sí mismo, asigna el
   `phase_selection_status` final de una unidad proceso+fase. Ese estado es siempre la salida de la
   función de resolución única (sección I), que consume los siete ejes como entrada, evaluados a
   nivel de proceso+fase (sección D.8.1). Ninguna proyección de resumen (`process_summary_bucket`,
   sección D.8.2) puede tampoco asignarlo — sólo puede leerlo y combinarlo determinísticamente.
6. **Elegibilidad antes de prioridad.** Cada unidad proceso+fase primero se resuelve como elegible o
   no elegible (sección I, D.8.1); sólo las elegibles (`phase_selection_status` en `ACTIONABLE` o
   `MONITOR_*`) entran a la función de prioridad (sección J). La función de prioridad no puede alterar
   la elegibilidad ya resuelta.
7. **Datos faltantes no son evidencia negativa.** La ausencia de un dato nunca se interpreta como
   incumplimiento, exclusión o mal encaje. Se refleja como `MISSING` en la clase de evidencia del eje
   correspondiente (sección G) y, según la regla que aplique, produce un estado de validación
   (`V_*`) en vez de una exclusión.
8. **Toda exclusión exige evidencia.** Ningún estado `EXCLUDE_*` se asigna sin al menos una referencia
   de evidencia verificable (`evidence_refs`) que lo sostenga. La ausencia de evidencia nunca produce
   una exclusión; produce, a lo sumo, un estado de validación.
9. **Cero score acumulativo en elegibilidad.** La función de elegibilidad no suma puntos de ningún
   tipo. No existe un umbral numérico que, cruzado, decida por sí mismo que un proceso es o no
   elegible. La elegibilidad es un árbol de reglas evaluadas en orden fijo (sección I), no una suma.
10. **Cero IA.** Ningún paso de adquisición, identidad, elegibilidad, prioridad o proyección invoca un
    modelo de lenguaje, un clasificador entrenado ni ningún componente de aprendizaje automático. Todo
    es función pura y determinística sobre datos observados y reglas versionadas.
11. **CRM y Discord son proyecciones puras.** Ninguna de las dos superficies recalcula elegibilidad ni
    prioridad; ambas leen el snapshot ya resuelto del run canónico (sección L).
12. **El humano decide.** Ningún artefacto de esta especificación convierte un proceso en Oportunidad,
    emite GO/NO-GO, ni ejecuta ningún paso del workflow comercial. Esas decisiones permanecen
    exclusivamente humanas (sección L.4, workflow humano).
13. **Historia append-only.** Ningún registro de observación, evaluación de identidad, resolución de
    estado o evento de prioridad se sobrescribe. Toda corrección es un nuevo registro que referencia
    y, cuando corresponde, supera al anterior, nunca lo reemplaza en su lugar.

---

## B. Seis contratos separados

La política `agt002-radar-selection-v2` se descompone en seis contratos con autoridad estrictamente
delimitada. Ningún contrato puede escribir en el dominio de otro:

| Contrato | Responde | No responde |
|---|---|---|
| **Observación** | ¿Qué se adquirió, de dónde, y qué forma cruda tiene? | Si el proceso es elegible o prioritario |
| **Identidad** | ¿A qué proceso, fase y registro corresponde esta observación? | Si el proceso es elegible, prioritario o su modalidad |
| **Elegibilidad** | ¿Puede esta unidad proceso+fase presentarse como candidata? (evaluada por `(business_process_id, source_phase_id)`, sección D.8.1) | En qué orden se presenta; qué bucket resumido le corresponde al proceso (eso es proyección, sección D.8.2) |
| **Prioridad** | Entre las fases elegibles, ¿en qué orden merece atención? | Si la fase es o no elegible |
| **Proyección** | ¿Qué subconjunto y con qué forma se entrega a CRM/Discord? | Elegibilidad, prioridad o identidad — sólo lee lo ya resuelto |
| **Workflow humano** | ¿Qué decisión tomó el humano y cuándo? | Cualquier cálculo de elegibilidad o prioridad |

Cada contrato tiene su propio esquema de datos, su propia versión de política y su propio ledger
donde corresponda. Un contrato posterior en la cadena (p. ej. Prioridad) puede leer la salida de uno
anterior (p. ej. Elegibilidad), pero nunca puede escribirla ni alterarla retroactivamente.

---

## C. Observación y manifiesto

### C.1 Campos que se sellan por observación

Cada observación individual, antes de cualquier evaluación comercial, sella:

- `run_id`
- `attempt_no`
- `source_id`
- `source_record_id`
- `fetched_at`
- `content_hash`
- `raw_ref`
- `source_health`

### C.2 Campos de evaluación capturados por observación

- identificador nativo de proceso (native process ID) e identificador nativo de fase (native phase
  ID);
- entidad contratante y NIT;
- objeto contractual y descripción, **capturados como campos separados** (nunca concatenados en uno
  solo antes de sellar);
- fase;
- `estado_del_procedimiento`;
- `modalidad_de_contratacion`;
- `estado_resumen`;
- `adjudicado`;
- fecha de recepción;
- fecha de apertura de respuesta;
- fecha de publicación;
- valor;
- URL de origen;
- `provenance` por campo — cada valor capturado declara de qué columna/campo de la fuente proviene,
  no sólo su valor final.

### C.3 Campos por corrida y por fuente

Por cada combinación de corrida (`run_id`) y fuente (`source_id`):

- ventana temporal cubierta;
- cursor o mecanismo de paginación usado;
- conteo declarado por la fuente y conteo efectivamente obtenido;
- `sealed_at`;
- `manifest_hash`;
- `policy_hash`.

### C.4 El manifiesto precede a cualquier filtro comercial

El manifiesto se sella **antes** de aplicar cupos, gate comercial, elegibilidad o prioridad. En la
etapa de sellado del manifiesto, la única causa de rechazo admisible es **técnica**:

- fuera de la ventana técnica declarada de la corrida;
- fallo de transporte (la fuente no respondió, respondió con error, se cortó a mitad de página);
- fallo de parseo (la fila no es interpretable con el esquema declarado de la fuente);
- ausencia de identificador (`source_record_id` no resoluble).

Ninguna razón comercial (relevancia de servicio, modalidad, estado, fecha, prioridad) puede impedir
que una fila entre al manifiesto sellado. Esas razones sólo pueden actuar después, dentro de la
función de resolución de estado (sección I).

### C.5 Retención de raw original por clase de fuente

El campo `raw` es siempre el **registro fuente original**, nunca una copia normalizada. Su forma de
retención depende de la clase de fuente:

- **Scraping / web / régimen especial / fuentes privadas no reconsultables**: el cuerpo crudo es
  **inmutable y se retiene siempre completo**, porque no existe garantía de poder volver a consultar
  la fuente y recuperar el mismo contenido después.
- **APIs reconsultables (SECOP, ESU)**: se retiene **referencia + hash + provenance**, no
  necesariamente el cuerpo completo replicado, porque la fuente permite reconsulta. Todo consumidor
  de este `raw` debe recibir advertencia explícita de que está leyendo un **estado vivo** (lo que la
  API responde hoy si se reconsulta) frente a un **estado histórico** (lo que se observó y selló en
  el momento de la corrida) — ambos pueden divergir legítimamente, y confundirlos es un error de
  interpretación, no un defecto del dato.

### C.6 Reintentos y estado de corrida

- Los reintentos se identifican por `attempt_no`, incremental dentro del mismo `run_id` y la misma
  fuente.
- Un estado `partial` o `failed` de una fuente **nunca** se reporta como `COMPLETE`. La distinción
  entre "la fuente respondió completamente" y "la fuente respondió parcialmente o falló" debe
  permanecer visible en `source_health` y no puede colapsarse a un único valor de éxito.
- Una fuente **deshabilitada** debe quedar visible como deshabilitada (`source_health = disabled` o
  equivalente), nunca reportada silenciosamente como "0 oportunidades encontradas". La ausencia de
  intento no es lo mismo que un intento que no encontró nada.

### C.7 Ecuaciones de reconciliación

La reconciliación **no asume una relación 1:1 entre observación y fase**: varias observaciones
selladas pueden sustentar la misma unidad `(business_process_id, source_phase_id)` (p. ej. la misma
fase reobservada en corridas o reintentos sucesivos), y una observación puede no vincularse a ninguna
fase resoluble — en ese caso pertenece a un `identity_validation_case` (sección D.10), nunca a una
evaluación de fase. `V_IDENTITY` **no es una fase comercial** y no se cuenta como tal en ninguna de
estas ecuaciones: es el `identity_selection_status` de un `identity_validation_case`, un agrupamiento
de observaciones, no una unidad `(business_process_id, source_phase_id)` evaluada. Por eso la
reconciliación se expresa en siete ecuaciones encadenadas, cada una verificable de forma
independiente, y no en una única igualdad que confunda conteo de observaciones con conteo de estados.
Su incumplimiento, en cualquiera de las siete, es en sí mismo una señal de fallo del pipeline, no un
resultado a ignorar:

```
adquiridos                       = rechazos_tecnicos + observaciones_selladas
observaciones_selladas           = observaciones_vinculadas + observaciones_en_casos_identidad
observaciones_vinculadas         = Σ supporting_observation_count (sobre todas las evaluaciones de fase)
observaciones_en_casos_identidad = Σ supporting_observation_count (sobre todos los identity_validation_cases)
evaluaciones_fase                = ACTIONABLE_fase + MONITOR_fase + VALIDATE_fase_sin_V_IDENTITY + EXCLUDE_fase
resultados_seleccion             = evaluaciones_fase + identity_validation_cases
proyecciones_proceso             = cardinalidad distinta de business_process_id entre evaluaciones_fase
```

Donde:

- `adquiridos` es el total de filas que la fuente entregó en la corrida, antes de cualquier filtro;
- `rechazos_tecnicos` es R0 (sección I), evaluado por fila/observación, no por fase;
- `observaciones_selladas` es el total de filas que entraron al manifiesto (C.4);
- `observaciones_vinculadas` es el subconjunto de observaciones selladas que quedó asociado a una
  unidad proceso+fase resoluble (sección D.8.1);
- `observaciones_en_casos_identidad` es el resto — las observaciones selladas que la cascada de
  identidad (D.2–D.4) no pudo resolver de forma segura a `(business_process_id, source_phase_id)` y
  que, por eso, quedaron agrupadas en uno o más `identity_validation_cases` (sección D.10, regla R6);
- `supporting_observation_count` sobre evaluaciones de fase es un campo de cada evaluación de fase
  (sección D.8.1) que cuenta cuántas observaciones selladas y vinculadas la sustentan; su suma sobre
  todas las evaluaciones de fase del run debe igualar `observaciones_vinculadas` exactamente — ninguna
  observación vinculada puede quedar fuera de ese conteo ni contarse dos veces en evaluaciones de fase
  distintas;
- `supporting_observation_count` sobre `identity_validation_cases` es el mismo tipo de campo, aplicado
  a cada caso de identidad (sección D.10); su suma sobre todos los `identity_validation_cases` del run
  debe igualar `observaciones_en_casos_identidad` exactamente, con la misma garantía de no duplicación
  ni omisión;
- `evaluaciones_fase` es el total de unidades proceso+fase evaluadas por las reglas R1–R5 y R7–R16
  (sección I), con identidad ya resuelta — **nunca incluye R6**; `MONITOR_fase` agrupa todos los
  subestados `MONITOR_*`, `VALIDATE_fase_sin_V_IDENTITY` agrupa todos los subestados `V_*` que son
  `phase_selection_status` de una fase resuelta (`V_EVIDENCE`, `V_MODALITY`, `V_DATE`, `V_SOURCE`,
  `V_SEMANTIC`, etc.) **excluyendo `V_IDENTITY`**, y `EXCLUDE_fase` agrupa todos los subestados
  `EXCLUDE_*` (sección I), todos contados a nivel de fase, no de proceso;
- `identity_validation_cases` es el total de casos de identidad producidos por R6 en el run (sección
  D.10) — cada uno con `identity_selection_status = V_IDENTITY`, nunca un `phase_selection_status`;
- `resultados_seleccion` es la suma de todo lo que la función de resolución de estado produjo en el
  run: toda evaluación de fase resuelta más todo caso de identidad sin resolver, sin doble conteo y sin
  omisión — es la cifra que debe coincidir con el total de resultados expuestos en el recibo (sección
  K);
- `proyecciones_proceso` es el número de procesos distintos representados entre las evaluaciones de
  fase (`evaluaciones_fase`) — es una proyección de conteo (cuántos procesos tienen al menos una fase
  evaluada), no una autoridad adicional, y nunca debe usarse para recalcular o sustituir el conteo de
  `evaluaciones_fase`. Los `identity_validation_cases` no contribuyen a `proyecciones_proceso`, porque
  no tienen `business_process_id` resuelto.

El recibo de la corrida (sección K) debe exponer las **siete ecuaciones** ya verificadas, no sólo los
totales que las componen.

---

## D. Identidad

### D.1 Entidades distintas

`source_record_id`, `source_phase_id`, `business_process_id` y `run_id` son identificadores
**distintos entre sí**, con ciclos de vida propios. `stable_key` (una clave técnica de
deduplicación) **no es una autoridad empresarial**: puede usarse como mecanismo interno de
indexación, pero nunca sustituye la resolución de identidad de negocio descrita abajo.

### D.2 Cascada de resolución de fase

La identidad de una fase se resuelve, en este orden, hasta que una etapa produzca una identidad
verificable:

1. **ID de fase nativo** de la fuente, si la fuente lo expone de forma estable.
2. **ID de publicación/evento**, si el nativo no está disponible pero existe un identificador de
   evento de publicación estable.
3. **Hash versionado** de `source + native_process + normalized_phase + official_publication`, como
   última alternativa determinística.
4. Si ninguna de las tres produce una identidad resoluble, la observación que sustenta esa fase se
   incorpora a un `identity_validation_case` (sección D.10) y no se le asigna una identidad sintética;
   ese caso de identidad produce `identity_selection_status = V_IDENTITY` (sección I, regla R6), nunca
   un `phase_selection_status`, porque no existe una unidad `(business_process_id, source_phase_id)`
   resuelta a la cual asignárselo.

### D.3 Cascada de resolución de proceso

1. **ID de proceso nativo** de la fuente.
2. **Referencia oficial** del proceso (número de proceso publicado oficialmente).
3. **Compuesta exacta** `source + NIT + referencia + año`.
4. Si ninguna produce una identidad resoluble, las observaciones que sustentan ese proceso se
   incorporan a un `identity_validation_case` (sección D.10), con `identity_selection_status =
   V_IDENTITY`; el proceso no recibe una identidad comercial sintética.

### D.4 Cruce entre fuentes

Cuando el mismo proceso aparece observado por más de una fuente, el cruce se intenta en este orden:

1. **Referencia compartida** exacta entre fuentes.
2. **`NIT + referencia + año`** exacto entre fuentes.
3. **Coincidencia difusa** (`LOW` confidence) — nunca funde automáticamente los registros. Una
   coincidencia difusa se registra como candidata de fusión con confianza `LOW` y queda pendiente de
   revisión; nunca decide una fusión canónica en solitario.

### D.5 Ledger de identidad

Todo evento de resolución de identidad (asignación inicial, fusión, división, reversión) se escribe
en un ledger **append-only** con, como mínimo:

- `method` (cuál de las cascadas/reglas produjo la resolución);
- `confidence` (`HIGH`/`MEDIUM`/`LOW` según corresponda al método);
- `evidence` (qué observación concreta sostiene esta resolución);
- `version` (versión de la política de identidad vigente al momento);
- `author` (sistema o humano que originó el evento);
- `superseded_by` (referencia al evento que, si existe, lo reemplaza — nunca se borra el evento
  original).

### D.6 Fusión manual y su reversión

Una fusión manual (`MANUAL_MERGE`) sólo se revierte mediante un evento `MANUAL_SPLIT` que la
**supersede** explícitamente (`superseded_by` apuntando del merge al split correspondiente). La
historia nunca se reescribe: el evento `MANUAL_MERGE` original permanece en el ledger, marcado como
superado, no eliminado ni editado.

### D.7 División de un proceso ya convertido

Si un proceso que ya fue convertido a Oportunidad se divide (`MANUAL_SPLIT`), la Oportunidad **no se
duplica**. Es el humano quien asigna el workflow (la Oportunidad ya existente) a **uno** de los
procesos resultantes de la división. Hasta que esa asignación humana ocurra, los procesos resultantes
de la división permanecen representados por un `identity_validation_case` (sección D.10), con
`identity_selection_status = V_IDENTITY`: el sistema no infiere automáticamente a cuál de los dos
pertenece la Oportunidad preexistente, y el `identity_case_id` de ese caso nunca sustituye ni fabrica
la identidad comercial pendiente de asignación humana.

### D.8 Unidad de evaluación proceso+fase, y resumen agregado por proceso

#### D.8.1 Las tres granularidades de la tabla R0–R16

La tabla R0–R16 (sección I) no opera sobre una sola granularidad: opera sobre **tres**, estrictamente
separadas entre sí, y cada observación sellada participa en exactamente una de ellas:

- **R0** (rechazo técnico) se evalúa por **fila/observación** en el manifiesto, antes de cualquier
  evaluación comercial (principio A.2, sección C.4). No es una evaluación de proceso ni de fase, y no
  produce ni `phase_selection_status` ni `identity_selection_status`.
- **R6** se evalúa por **`identity_validation_case`** (sección D.10): un agrupamiento de una o más
  observaciones selladas cuya identidad no pudo resolverse de forma segura a `(business_process_id,
  source_phase_id)` mediante las cascadas D.2–D.4. El resultado de R6 es `identity_selection_status =
  V_IDENTITY` sobre ese caso — **nunca** un `phase_selection_status`, porque no existe una unidad
  proceso+fase resuelta a la que asignárselo. R6 queda **fuera** de `evaluaciones_fase` (sección C.7).
- **R1–R5 y R7–R16** se ejecutan **exactamente una vez** por cada unidad `(business_process_id,
  source_phase_id)` sellada y resoluble (es decir, ya excluida de R6). El resultado de esa ejecución es
  el único `phase_selection_status` de esa fase: existe exactamente **un** `phase_selection_status` por
  proceso+fase — nunca más de uno, y nunca ninguno para una unidad que alcanzó evaluación.

Cada observación sellada pertenece exactamente a una evaluación de fase resoluble (R1–R5, R7–R16) o
exactamente a un `identity_validation_case` (R6) — **nunca a ambas, y nunca a ninguna**. Esta
pertenencia exclusiva es la que sostiene la ecuación `observaciones_selladas = observaciones_vinculadas
+ observaciones_en_casos_identidad` (sección C.7).

Toda observación sellada y vinculada que sustenta una unidad proceso+fase se conserva y queda
referenciada por esa evaluación (`evidence_refs`, y el conteo `supporting_observation_count`,
sección C.7). La evaluación de fase nunca descarta las observaciones que la sustentan al resolver
su estado. Del mismo modo, toda observación agrupada en un `identity_validation_case` queda referenciada
por ese caso (`evidence_refs`, y su propio `supporting_observation_count`, secciones C.7 y D.10).
- Es válido, y esperado, que un mismo proceso tenga **varias fases activas simultáneamente**, cada
  una con su propio `phase_selection_status` independiente. La evaluación de elegibilidad y prioridad
  ocurre siempre a nivel de `proceso + fase` — nunca se colapsa a un solo par antes de evaluar. La
  proyección hacia CRM/Discord (sección L) entrega siempre la lista completa `active_phase_ids` junto
  con el `phase_selection_status` de cada una, nunca sólo un estado resumido en su lugar.

#### D.8.2 `process_summary_bucket`: proyección pura, no una segunda autoridad

El resultado compacto por proceso (una sola línea representativa en una vista resumida) es
`process_summary_bucket`. **No es una segunda autoridad de elegibilidad** ni redefine el estado de
ninguna fase: es una función pura y determinística de los `phase_selection_status` ya calculados de
las fases activas de ese proceso (D.8.1). No consume evidencia propia ni evalúa reglas — sólo lee
resultados de fase ya resueltos.

**Roll-up determinístico**, evaluado en este orden estricto sobre las fases activas del proceso:

1. si alguna fase activa tiene `phase_selection_status = ACTIONABLE` ⇒ `process_summary_bucket =
   ACTIONABLE`;
2. si no, si alguna fase activa tiene `phase_selection_status` en `MONITOR_*` ⇒
   `process_summary_bucket = MONITOR`;
3. si no, si alguna fase activa tiene `phase_selection_status` en `V_*` ⇒ `process_summary_bucket =
   VALIDATE`;
4. si todas las fases activas están en `EXCLUDE_*` ⇒ `process_summary_bucket = EXCLUDE`.

`primary_phase_id` se elige **únicamente entre las fases que pertenecen al bucket ganador** (nunca
entre todas las fases activas indiscriminadamente), aplicando en ese subconjunto, en este orden
estricto de desempate:

1. hito o fecha más próxima;
2. desempate final por `source_phase_id` (orden determinístico, no aleatorio).

El cálculo de `process_summary_bucket` y de `primary_phase_id` **nunca reescribe ni oculta** los
resultados de fase: la proyección entrega siempre, junto al resumen, la lista completa
`active_phase_ids` con el `phase_selection_status` individual de cada una (sección L.1). La elección
de `primary_phase_id` es únicamente para resumen visual.

### D.9 Fixture real de referencia — 104/103

Una consulta oficial real devolvió **104 filas para 103 identificadores** de SECOP II. El
identificador `CO1.REQ.11047375` apareció **dos veces** con contenido equivalente. Este documento D0
**no presume la causa** de esa duplicación (podría ser reintento de la fuente, republicación técnica,
paginación superpuesta, u otra causa no verificada aquí). **D1 debe probar la deduplicación** contra
este caso concreto como fixture obligatorio (sección O.2): cualquier implementación de la cascada de
identidad (D.2–D.4) debe demostrar, sobre este caso real, que produce una única identidad de fase o
de proceso para las dos filas observadas, con la evidencia de por qué. Esta unicidad de identidad es
un prerrequisito de la granularidad canónica descrita en D.8.1: si las dos filas no se resuelven a la
misma unidad `(business_process_id, source_phase_id)`, el resultado no es una única evaluación de
fase sustentada por dos observaciones (`supporting_observation_count = 2`), sino dos evaluaciones de
fase distintas donde debería existir una sola — exactamente el defecto que las ecuaciones de
reconciliación de C.7 están diseñadas para exponer.

### D.10 `identity_validation_case` y `identity_case_id`

**Definición.** Un `identity_validation_case` es un agrupamiento de una o más observaciones selladas
que, en el momento de la evaluación, **no pueden resolverse de forma segura** a una unidad
`(business_process_id, source_phase_id)` mediante ninguna de las cascadas de identidad (D.2–D.4). Es
el mecanismo formal por el cual la regla R6 (sección I) produce su resultado: R6 nunca opera sobre una
fase ya resuelta, opera sobre un `identity_validation_case`.

**`identity_case_id`.** Es el identificador técnico, determinístico y auditable de un
`identity_validation_case`, generado con el mismo rigor determinístico que el resto de identificadores
de esta especificación (hash versionado sobre las observaciones que lo componen y la política vigente,
sección D.5). `identity_case_id`:

- **nunca** puede emplearse como `business_process_id`;
- **nunca** puede emplearse como `source_phase_id`;
- **nunca** constituye ni sustituye una identidad comercial de ningún tipo;
- **nunca** puede usarse como clave de una Oportunidad, ni aparecer en el evento
  `CONVERT_TO_OPPORTUNITY` (sección L.4) en lugar de `business_process_id`.

Un `identity_case_id` es una referencia técnica a un problema de identidad sin resolver, no una
identidad de negocio. Confundir ambas cosas — por ejemplo, presentar un `identity_case_id` como si
fuera el identificador de un proceso candidato — es exactamente el error que esta sección prohíbe.

**Pertenencia exclusiva.** Cada observación sellada (C.1–C.4) pertenece **exactamente** a una de estas
dos categorías, nunca a ambas y nunca a ninguna:

1. sustenta exactamente una evaluación de fase resoluble (`(business_process_id, source_phase_id)`,
   sección D.8.1, reglas R1–R5 y R7–R16); o
2. pertenece exactamente a un `identity_validation_case` (esta sección, regla R6).

No existe una tercera posibilidad, y no existe superposición: una observación no puede sustentar
simultáneamente una evaluación de fase y un caso de identidad, ni puede quedar fuera de ambos
recuentos. Esta exclusividad es la que sostiene la ecuación `observaciones_selladas =
observaciones_vinculadas + observaciones_en_casos_identidad` (sección C.7).

**`identity_selection_status`, no `phase_selection_status`.** Un `identity_validation_case` produce
siempre `identity_selection_status = V_IDENTITY` (R6). `identity_selection_status` y
`phase_selection_status` son campos distintos, con dominios y significados distintos, y nunca se
mezclan en la misma columna, en el mismo conteo, ni en la misma ecuación de reconciliación sin
distinguirse explícitamente (sección C.7).

**`supporting_observation_count`.** Cada `identity_validation_case` declara su propio
`supporting_observation_count` — el número de observaciones selladas que agrupa — con el mismo
significado y la misma disciplina de no duplicación que el campo homónimo de las evaluaciones de fase
(sección C.7).

**Resolución posterior.** Cuando una observación nueva, una fusión manual, o evidencia adicional
permite resolver un `identity_validation_case` a una unidad `(business_process_id, source_phase_id)`
verificable, ese evento se registra en el ledger de identidad (D.5) como cualquier otro evento de
resolución, con `superseded_by` apuntando del caso de identidad original hacia la evaluación de fase
que lo resuelve. El `identity_case_id` original **permanece en el ledger, nunca se borra, y nunca se
reutiliza** como `business_process_id` ni como `source_phase_id` de ninguna evaluación futura.

**Exclusión de proyección comercial.** Un `identity_validation_case` **no** tiene
`phase_selection_status`, no puede alcanzar `ACTIONABLE` ni `MONITOR_*`, y por lo tanto nunca satisface
el criterio de inclusión de CRM o Discord como proceso candidato (sección L.2, L.3): no puede
proyectarse hacia ninguna de las dos superficies como una licitación comercial elegible. Si un
contrato de datos posterior decide exponerlo, sólo puede hacerlo en una cola de validación de
identidad separada, identificada por `identity_case_id`, nunca mezclada ni confundida con la lista de
procesos candidatos.

---

## E. Taxonomía de fases y estados

### E.1 Clases

Toda fase observada se clasifica en exactamente una de estas cinco clases:

- **`TERMINAL_MONOTONIC`** — una vez alcanzado, el estado no puede revertirse por definición de
  negocio (p. ej. `Celebrado`/`Liquidado`).
- **`TERMINAL_REVOCABLE`** — es terminal en el sentido de que cierra la fase, pero puede en principio
  ser revocado por un acto administrativo posterior (p. ej. `Evaluación`, `Seleccionado`,
  `Adjudicado`).
- **`OFFERABLE`** — el proceso admite presentación de oferta o manifestación de interés en este
  momento.
- **`PRE_PUBLICATION`** — el proceso está en una etapa previa a la apertura de ofertas (observaciones,
  aclaraciones, borrador).
- **`UNMAPPED`** — el valor observado no corresponde a ninguna de las clases anteriores conocidas.

Un valor `UNMAPPED` produce siempre `V_EVIDENCE` con razón `UNMAPPED_PHASE` o `UNMAPPED_STATE` según
corresponda (nunca se asume una clase por defecto).

### E.2 Valores observados — SECOP II

| Valor observado | Clase |
|---|---|
| Presentación de oferta | `OFFERABLE` |
| Fase de ofertas | `OFFERABLE` |
| Manifestación de interés (Menor Cuantía) | `OFFERABLE` |
| Presentación de observaciones | `PRE_PUBLICATION` |
| Clarification submission | `PRE_PUBLICATION` |
| Publicado (estado, no fase) | no terminal — **la fase, no el estado, decide la clase** |
| Evaluación | `TERMINAL_REVOCABLE` |
| Seleccionado | `TERMINAL_REVOCABLE` |
| Adjudicado = Sí | `TERMINAL_REVOCABLE` |
| Adjudicado = No | no prueba elegibilidad por sí solo |

### E.3 Valores observados — SECOP I

| Valor observado | Clase |
|---|---|
| Convocado | `OFFERABLE` |
| Borrador | `PRE_PUBLICATION` |
| Adjudicado | `TERMINAL_REVOCABLE` |

### E.4 Valores observados — ESU

- `Presentación de oferta` es `OFFERABLE` **únicamente** con `provenance` de fuente presente y
  verificable.
- `Señal web / validar` **no es una fase oficial**: se clasifica siempre `UNMAPPED`.

### E.5 Valores adicionales, si aparecen oficialmente

| Valor | Clase |
|---|---|
| Celebrado | `TERMINAL_MONOTONIC` |
| Liquidado | `TERMINAL_MONOTONIC` |
| Desierto | `TERMINAL_REVOCABLE` de esa fase concreta |
| Cancelado | `TERMINAL_REVOCABLE` de esa fase concreta |
| Revocado | `TERMINAL_REVOCABLE` de esa fase concreta |

Una **reapertura** posterior a `Desierto`/`Cancelado`/`Revocado` es siempre una **nueva fase**, nunca
una reactivación de la fase terminal anterior — la fase terminal permanece terminal en el registro
histórico.

**`Adjudicado` no es monotónico absoluto.** A diferencia de `Celebrado`/`Liquidado`, un `Adjudicado`
puede en principio ser revocado por acto administrativo; por eso su clase es `TERMINAL_REVOCABLE`, no
`TERMINAL_MONOTONIC`.

### E.6 Conflictos entre fase, estado, resumen y `adjudicado`

Cuando fase, `estado_del_procedimiento`, `estado_resumen` y `adjudicado` no son consistentes entre sí
para la misma observación, el resultado es `V_EVIDENCE`, **salvo** en estas dos excepciones, en las
que la evidencia terminal domina el conflicto:

- la observación ya alcanzó un estado `TERMINAL_MONOTONIC` verificado;
- la observación ya alcanzó un estado `TERMINAL_REVOCABLE` con clase de evidencia
  `VERIFIED_CURRENT` (sección G).

En cualquier otro caso de conflicto, la regla es `V_EVIDENCE`, nunca una asunción de cuál campo es
"más confiable" por defecto.

---

## F. Modalidades

### F.1 Clases

- **`CONTESTABLE`** — la modalidad admite competencia abierta.
- **`NON_CONTESTABLE`** — la modalidad está documentadamente cerrada a un destinatario único o
  restringida sin competencia.
- **`NEEDS_EVIDENCE`** — no hay evidencia suficiente para decidir entre las dos anteriores.
- **`UNMAPPED`** — el valor observado no corresponde a ninguna modalidad conocida.

`EXCLUDE_MODALITY` (regla R2, sección I) **sólo** se asigna cuando la modalidad es `NON_CONTESTABLE`
**y** su clase de evidencia es `VERIFIED_CURRENT`. Ninguna otra combinación produce exclusión por
modalidad.

### F.2 Mapeo inicial

| Modalidad observada | Clasificación |
|---|---|
| Licitación pública | `CONTESTABLE` (el servicio resuelve alcance/suministro por separado, sección H) |
| Selección Abreviada de Menor Cuantía | `CONTESTABLE` |
| Mínima cuantía | `CONTESTABLE` |
| Concurso de méritos abierto | `CONTESTABLE` |
| Selección abreviada — subasta inversa | `CONTESTABLE` |
| Solicitud de información a los Proveedores | `CONTESTABLE` como interacción, pero su fase es `PRE_PUBLICATION` (sección E) |
| Contratación directa | `NEEDS_EVIDENCE` por defecto (ver F.3) |
| Régimen especial | ver F.4 |

### F.3 Contratación directa

- Por defecto: `NEEDS_EVIDENCE`.
- Si hay evidencia de convocatoria **abierta**: `CONTESTABLE`.
- Si hay evidencia de proceso **cerrado/documentado** (destinatario único documentado): `NON_CONTESTABLE`.
- Si la evidencia es **ambigua**: `V_MODALITY`.

### F.4 Régimen especial

- Convocatoria/invitación **abierta**: `CONTESTABLE`.
- Invitación **cerrada documentada** o con destinatario único: `NON_CONTESTABLE`.
- **Sin señal** suficiente: `NEEDS_EVIDENCE` / `V_MODALITY`.

### F.5 Valores nuevos

Cualquier valor de modalidad no contemplado en F.2–F.4 se clasifica `UNMAPPED` y produce
`V_EVIDENCE` con razón `UNMAPPED_MODALITY`.

---

## G. Los siete ejes siempre computados

Para todo proceso evaluado se calculan, sin excepción, estos siete ejes:

1. **Fuente**
2. **Identidad**
3. **Estado**
4. **Modalidad**
5. **Servicio**
6. **Fecha/ventana**
7. **Participación**

Cada eje emite, como salida estructurada:

- `axis_status`
- `reason_code`
- `evidence_class`
- `evidence_refs`
- `observed_values`
- `policy_version`

### G.1 Clases de evidencia

| Clase | Significado |
|---|---|
| `VERIFIED_CURRENT` | Verificado y vigente al momento de la evaluación |
| `VERIFIED_MONOTONIC` | Verificado y, por naturaleza del dato, no puede volverse falso con el tiempo |
| `STALE` | Fue verificado en algún momento, pero su vigencia actual no está confirmada |
| `MISSING` | El dato no está presente en la observación |
| `CONFLICT` | Hay más de un valor observado y no son consistentes entre sí |

`MISSING` nunca se trata como `CONFLICT` ni como evidencia negativa (principio A.7). `STALE` nunca se
trata como `VERIFIED_CURRENT`.

---

## H. Servicio

### H.1 Clases de servicio

- Vigilancia fija
- Vigilancia móvil
- Escolta
- Canino
- Electrónica integral
- Monitoreo/operación tecnológica de seguridad física
- Combinación de las anteriores

Confianza del eje de servicio: `HIGH` / `MEDIUM` / `NONE`.

### H.2 Reglas de lectura del objeto y la descripción

- Objeto/título y descripción se leen **como campos separados** (consistente con C.2); nunca se
  concatenan antes de evaluar.
- Entidad, sector, categoría o metadata **no prueban** servicio por sí solos.
- El "concepto más largo" que aparece en el texto **no suma** con otras palabras clave — no hay
  acumulación de keywords.
- Un servicio **explícito en el objeto** produce confianza `HIGH`, **aunque** el texto también
  contenga un término auxiliar de otra naturaleza.
- `CONTEXT_RISK` (un riesgo contextual detectado, p. ej. terminología ambigua) **no excluye** por sí
  solo.
- `HARD_NEGATIVE_OBJECT` (el objeto describe un núcleo de negocio que no es servicio ofertable de
  seguridad) sólo aplica cuando ese núcleo **es** el objeto principal, sin servicio ofertable
  presente junto a él.
- Si el texto describe **dos núcleos** de servicio distintos sin que uno domine claramente:
  `V_SEMANTIC` con razón `MIXED_SERVICES`.
- Si el objeto está **ausente o truncado**: `V_SEMANTIC`.
- **Electrónica integral** exige una **acción explícita** (diseñar, instalar, integrar, operar,
  mantener, soportar, monitorear, poner en funcionamiento) **ligada al activo** en el **mismo
  segmento** de texto. Un suministro aislado de equipos, sin ninguna de esas acciones ligadas, **no
  basta** para clasificar como electrónica integral.

### H.3 Fixtures obligatorios para D1

Estos casos reales deben incorporarse como fixtures de D1 (sección O.2), con evidencia adjunta (texto
exacto, ID de proceso, campo de origen, segmento citado, término detectado):

| Caso | Resultado esperado |
|---|---|
| CAR | `HIGH` + `AUX_TERM` (la presencia de "equipos de comunicación" como término auxiliar **no excluye**) |
| Cota | `HIGH` si hay "integral" junto con evidencia de implementación |
| Yopal | `HIGH` |
| OFB | `HIGH` |

### H.4 Participación como eje de exclusión

El eje de participación **sólo** puede producir exclusión (`EXCLUDE_PARTICIPATION`, regla R3, sección
I) cuando se cumplen **todas** estas condiciones simultáneamente:

1. hay un requisito **explícito** de participación documentado;
2. existe un perfil SN (perfil de la compañía) **vigente y versionado** contra el cual comparar;
3. la comparación entre el requisito y el perfil es **reproducible** (no depende de juicio no
   auditable);
4. la clase de evidencia del requisito es `VERIFIED_CURRENT`.

La ausencia de cualquiera de estas cuatro condiciones impide la exclusión por participación.

---

## I. Tabla normativa de resolución de estado — R0 a R16

La función de resolución de estado evalúa las reglas **en orden**, de R0 a R16. La **primera** regla
cuya condición se cumple **dispara el estado final** de la unidad evaluada. Todas las demás reglas
cuya condición también se cumpliría quedan registradas como `secondary_reason_codes` — se calculan y
se citan, pero no determinan el estado.

**Grano de evaluación — tres granularidades distintas (sección D.8.1).** Esta tabla no opera sobre una
sola unidad de evaluación:

- **R0** se evalúa por **fila/observación** del manifiesto, antes de la evaluación comercial. No
  produce `phase_selection_status` ni `identity_selection_status`.
- **R6** se evalúa por **`identity_validation_case`** (sección D.10) — un agrupamiento de observaciones
  selladas sin identidad proceso+fase resoluble. Produce `identity_selection_status = V_IDENTITY`,
  **nunca** un `phase_selection_status`. R6 queda fuera de `evaluaciones_fase` y dentro de
  `resultados_seleccion` mediante `identity_validation_cases` (sección C.7).
- **R1–R5 y R7–R16** se evalúan exactamente una vez por cada unidad `(business_process_id,
  source_phase_id)` sellada y resoluble (es decir, ya excluida de R6); el estado que producen es el
  único `phase_selection_status` de esa unidad, no un estado agregado del proceso.

El resumen por proceso (`process_summary_bucket`) es una proyección posterior y pura de los resultados
de R1–R5 y R7–R16 (sección D.8.2), no una regla adicional de esta tabla, y no incorpora resultados de
`identity_validation_cases`.

| Regla | Condición | Estado asignado |
|---|---|---|
| **R0** | Fuera de la ventana técnica declarada de la corrida, fallo de transporte, no parseable, o sin `source_record_id` (las cuatro causas de C.4/A.2) | Rechazo técnico (nunca entra a evaluación comercial) |
| **R1** | Terminal monotónico verificado, o terminal revocable con evidencia `VERIFIED_CURRENT` | `EXCLUDE_STATE` |
| **R2** | Modalidad `NON_CONTESTABLE` con evidencia `VERIFIED_CURRENT` | `EXCLUDE_MODALITY` |
| **R3** | Restricción de participación documentada contra perfil SN (ver H.4) | `EXCLUDE_PARTICIPATION` |
| **R4** | Servicio `NONE` + `HARD_NEGATIVE_OBJECT` como núcleo, sin servicio ofertable presente, con `evidence_class = VERIFIED_CURRENT` (sección G.1) | `EXCLUDE_SCOPE` |
| **R5** | Proceso privado o fuera del alcance de AGT-002 | `EXCLUDE_OUT_OF_AGT002` (cuarentena, **sin traslado** a otro agente) |
| **R6** | Una o más observaciones selladas con identidad `LOW`, en conflicto, o duplicado posible sin resolver — evaluada sobre un `identity_validation_case` (sección D.10), no sobre una unidad proceso+fase | `identity_selection_status = V_IDENTITY` del caso de identidad — **nunca** un `phase_selection_status` |
| **R7** | Ver subreglas ordenadas R7a–R7c (debajo de la tabla), evaluadas en ese orden estricto antes de continuar a R8 | `V_EVIDENCE` (R7a, R7b) o `V_SEMANTIC` (R7c) |
| **R8** | Modalidad `NEEDS_EVIDENCE` | `V_MODALITY` |
| **R9** | Fase en prepublicación | `MONITOR_PRE_PUBLICATION` |
| **R10** | Apertura de ofertas aún futura | `MONITOR_NOT_YET_OPEN` |
| **R11** | Alianza/unión temporal documentada como requisito, o ventana disponible menor al tiempo de estructuración necesario | `MONITOR_ALLIANCE_REQUIRED` (nunca se infiere por el valor del contrato) |
| **R12** | Fecha de cierre pasada, verificada | `EXCLUDE_TEMPORAL` |
| **R13** | Ofertable + contestable + servicio suficiente + fecha ausente tras enriquecimiento medido | `V_DATE` |
| **R14** | Fuente degradada y sin exclusión monotónica aplicable; fuera de la antigüedad admitida | `V_SOURCE` |
| **R15** | Días hábiles/calendario restantes (`bd_remaining`) menores a `W_MIN`, sin conversión ni trabajo previo sobre el proceso | `EXCLUDE_TEMPORAL_SHORT_WINDOW` |
| **R16** | Ninguna de las anteriores aplica | `ACTIONABLE` |

### I.1 R7 — subreglas ordenadas

R7 no es una sola condición sino tres subreglas evaluadas **en este orden estricto**, cada una
concluyente por sí misma: si una subregla se cumple, la evaluación se detiene ahí con el estado
indicado, exactamente como cualquier otra regla de la tabla, y las subreglas posteriores no se
evalúan como si fueran a determinar el estado.

- **R7a.** Cualquier valor `UNMAPPED` de fase, de `estado_del_procedimiento` o de modalidad (secciones
  E.1, E.6, F.5), o cualquier conflicto entre ejes no resuelto por las dos excepciones de E.6, ⇒
  `V_EVIDENCE`.
- **R7b.** Evidencia `STALE` (sección G.1) en un eje cuyo valor sería necesario para excluir
  (condiciones de R1–R5) o para declarar elegibilidad (condiciones de R9–R16) ⇒ `V_EVIDENCE` con
  subcódigo `STALE_<AXIS>` (p. ej. `STALE_STATE`, `STALE_MODALITY`, `STALE_SERVICE`,
  `STALE_PARTICIPATION`, `STALE_DATE`).
- **R7c.** Servicio `NONE` sin `HARD_NEGATIVE_OBJECT` verificado (`evidence_class =
  VERIFIED_CURRENT`), servicio `MEDIUM` sin corroborar, servicio mixto (`MIXED_SERVICES`, sección
  H.2), o objeto ausente o truncado ⇒ `V_SEMANTIC`.

Ninguna de las tres subreglas cae por defecto a R16: una combinación que satisface R7a, R7b o R7c
termina ahí, nunca continúa hacia una elegibilidad implícita. El orden interno es estricto — una
condición que ya satisface R7a nunca se reclasifica bajo R7c aunque también sea cierto, por ejemplo,
que el servicio es `MEDIUM` sin corroborar.

**Nota sobre `MISSING` y ruta de validación.** Cuando una clase de evidencia `MISSING` (G.1) ya tiene
una ruta de validación específica en esta tabla — fecha ausente (R13, `V_DATE`), identidad no
resoluble (R6, `V_IDENTITY`), modalidad sin evidencia suficiente (R8, `V_MODALITY`) — esa ruta
específica es la que aplica, no R7a. Para la ausencia de fase o de `estado_del_procedimiento` que
impida clasificar la unidad proceso+fase, y que no tiene una ruta dedicada propia en esta tabla, la
regla aplicable es R7a (`V_EVIDENCE`).

**Notas normativas sobre la tabla:**

- Toda combinación de ejes no contemplada explícitamente por una condición de R0–R15 —incluidas las
  subreglas R7a–R7c— **nunca** se resuelve como `ACTIONABLE` por ausencia de regla aplicable. R16 sólo
  se alcanza cuando ninguna regla anterior encontró una condición de exclusión o de validación
  pendiente; ante cualquier combinación no anticipada por el catálogo de reglas, el resultado correcto
  es alguna forma de `V_*` (típicamente R7a), nunca un salto directo a `ACTIONABLE`.
- `evidence_class = VERIFIED_CURRENT` (sección G.1) es una condición explícita de R4: evidencia
  `STALE` o `CONFLICT` sobre el eje de servicio nunca produce `EXCLUDE_SCOPE` por sí sola — cae en
  R7b (`STALE`) o R7c (`CONFLICT`/mixto), según corresponda.
- `W_MIN` (ventana mínima de días, regla R15) es un parámetro a **calibrar en S0** (sección O.3) y a
  **congelar antes de S1** (sección O.4, pieza obligatoria 7). Este documento no fija su valor
  numérico.
- R11 nunca infiere la necesidad de alianza a partir del **valor** del contrato por sí solo; requiere
  evidencia documental del requisito o de la ventana insuficiente frente al tiempo de estructuración.
- Un estado `EXCLUDE_*` **no es un descarte de workflow**. Es una conclusión de la función de
  selección sobre si la fase se presenta como candidata; el descarte de workflow, cuando exista
  como concepto separado, sigue siendo un acto humano documentado en el contrato de workflow (sección
  L.4), no una consecuencia automática de `EXCLUDE_*`.
- Las ecuaciones de reconciliación de la sección C.7 dependen de que `ACTIONABLE_fase`, todos los
  `MONITOR_*` de fase, todos los `V_*` de fase **con `phase_selection_status`** (es decir, excluyendo
  `V_IDENTITY`, que no es un `phase_selection_status`) y todos los `EXCLUDE_*` de fase sean mutuamente
  excluyentes y colectivamente exhaustivos sobre `evaluaciones_fase` (R1–R5, R7–R16) — exactamente lo
  que esta tabla garantiza al asignar siempre un único `phase_selection_status` por unidad proceso+fase,
  por la primera regla (o subregla, en el caso de R7) que dispara. R6 es una regla separada, sobre una
  granularidad separada (`identity_validation_case`, sección D.10), y por eso no participa de esta
  exhaustividad de fase: participa en cambio de `resultados_seleccion` (sección C.7).

---

## J. Prioridad

### J.1 Elegibilidad estructuralmente aislada de la prioridad

La función de elegibilidad (sección I) **no recibe como entrada** ninguna de las siguientes señales:

- `account_signal`
- `capacity_signal`
- `value_band`
- `priority_tier`
- cualquier señal proveniente de Gevecol

Esto no es una recomendación de implementación: es un requisito de **firma y esquema**. La función que
implementa la tabla R0–R16 no puede aceptar estos campos como parámetro, de modo que sea
estructuralmente imposible que una señal de prioridad contamine la elegibilidad, incluso por error de
programación futuro.

### J.2 Atributos de prioridad, separados entre sí

Sólo para unidades proceso+fase ya elegibles (`phase_selection_status` en `ACTIONABLE` o
`MONITOR_*`, sección D.8.1), se calculan estos atributos, cada uno independiente de los demás:

- **`account`**: `DEFENSE` / `SELECTIVE_ATTACK` / `PREPARE` / `STANDARD` / `UNKNOWN`
- **`capacity`**: `WITHIN_PROFILE` / `ALLIANCE_DOCUMENTED` / `PROFILE_UNKNOWN`
- **`value_band`**
- **`tier`**
- **`next_action`**

### J.3 Asignación de tier

| Tier | Condición |
|---|---|
| **P1** | `ACTIONABLE` con señal estratégica **verificada** que exige atención inmediata, y sin faltante crítico |
| **P2** | Resto de `ACTIONABLE` |
| **P3** | `MONITOR` con hito próximo **verificable** |
| **P4** | Resto de `MONITOR` |

`VALIDATE` (cualquier `V_*`) y `EXCLUDE` (cualquier `EXCLUDE_*`) tienen `tier = null`: no participan
del ordenamiento P1–P4. Las unidades proceso+fase en `VALIDATE` se agrupan en una **cola separada**,
ordenada por fecha próxima, gravedad, antigüedad (edad) e identificador, en ese orden.

### J.4 Orden estable dentro de cada tier

Dentro de un mismo tier, el orden es estable y sigue, en este orden de desempate:

1. `account`;
2. `capacity`;
3. hito o fecha más próxima;
4. fecha de publicación;
5. `business_process_id` seguido de `source_phase_id` (desempate final determinístico entre unidades
   proceso+fase).

`value_band` **no** participa de este desempate. `value_band` es un atributo de prioridad calculado
(J.2), pero pertenece a un eje de orden distinto y separado — el selector `Mayor valor primero`
(sección L.5) — nunca se mezcla dentro del desempate de `Mayor encaje primero` que esta sección define.
Esto evita que el criterio de valor económico contamine, ni siquiera como desempate silencioso, el
orden por encaje.

**No existe score agregado.** Ningún paso de este ordenamiento suma puntos de distintos atributos en
un único número; el orden es una comparación lexicográfica de atributos discretos, en el orden fijo
anterior. La combinación de tier (J.3) seguido de este desempate es, en conjunto, la definición
completa y única del orden `Mayor encaje primero` que expone la proyección de presentación (sección
L.5) — no existe una segunda definición divergente de ese orden en ningún otro lugar de este
documento.

### J.5 Calibración diferida

Las ventanas temporales y las bandas de valor usadas por estos atributos **se calibran en S0**
(sección O.3), no en D0. Este documento no fija sus valores numéricos.

---

## K. Snapshot, recibo y determinismo

- Cada run declara un **reloj explícito** `evaluation_at`, nunca un reloj implícito del sistema en el
  momento de lectura. Dos evaluaciones con la misma entrada y el mismo `evaluation_at` deben producir
  el mismo resultado, byte a byte.
- Cada run emite un **recibo**, por fuente y total, que expone:
  - todos los `phase_selection_status` asignados (R1–R5, R7–R16, incluidas las subreglas R7a–R7c) con
    sus conteos por fase, nunca colapsados de antemano en un conteo por proceso;
  - todos los `identity_selection_status` asignados (R6, sección D.10), con el `identity_case_id` y el
    `supporting_observation_count` de cada `identity_validation_case` — expuestos por separado de los
    `phase_selection_status`, nunca mezclados en el mismo conteo;
  - todos los `source_record_id`/`business_process_id`/`source_phase_id` involucrados, y el
    `supporting_observation_count` de cada evaluación de fase (sección C.7);
  - todas las fases activas por proceso, con su `phase_selection_status` individual, y el
    `process_summary_bucket` derivado (sección D.8.2) como campo adicional de resumen — nunca como
    sustituto de la lista de fases;
  - todas las proyecciones generadas a partir de este run (CRM, Discord u otra).
- El recibo debe exponer las **siete ecuaciones verificadas** de la sección C.7 (no sólo los totales
  que las componen), lo que permite auditar la reconciliación completa del run sin recalcularlo.

---

## L. Contrato de presentación funcional (no de interfaz)

Esta sección define **datos**, no diseño visual (recordatorio del alcance, sección 1.3).

### L.1 Por proceso, con estado explícito por fase

La proyección de cada proceso hacia cualquier consumidor (CRM, Discord, o cualquier otra superficie
futura) incluye, a nivel de **cada fase activa** (sección D.8.1):

- identificadores (`business_process_id`, `source_phase_id`, `source_record_id`(s) que la sustentan,
  `supporting_observation_count`);
- `phase_selection_status` y subcódigo (de la tabla R0–R16, incluidas las subreglas R7a–R7c);
- razones de esa fase (`reason_code` primario y `secondary_reason_codes`);
- evidencia positiva que sostiene ese `phase_selection_status`;
- conflictos o faltantes detectados en esa fase (clase de evidencia `CONFLICT`/`MISSING` por eje);
- fechas de esa fase, su `provenance` y `bd_remaining` (días restantes calculados);
- `tier` de prioridad de esa fase (si aplica, sección J);

y, a nivel del **proceso** como agregado de sus fases:

- referencia oficial;
- entidad contratante;
- objeto;
- URL de origen;
- fuente y su `source_health`;
- lista completa de fases activas (`active_phase_ids`) con el `phase_selection_status` de cada una
  (nunca colapsada a un único estado);
- `process_summary_bucket` y `primary_phase_id` (sección D.8.2), como campos de resumen **adicionales**
  a la lista completa de fases, nunca en su lugar;
- `next_action`;
- `run_id`, `policy_version` y el momento observado (`evaluation_at`/`fetched_at` según corresponda);
- el estado de workflow humano, como campo **separado** de todo lo anterior (nunca mezclado con el
  estado de selección) — incluido, cuando exista, el evento `CONVERT_TO_OPPORTUNITY` (sección L.4).

### L.2 CRM como proyección completa

El CRM recibe el **snapshot completo** del run canónico: todas las unidades proceso+fase con
`phase_selection_status` en `ACTIONABLE`, `MONITOR_*`, `V_*` o `EXCLUDE_*`, con su auditoría completa
(razones, evidencia, versiones), agrupadas por proceso con su `process_summary_bucket` (sección D.8.2)
como resumen adicional, más los procesos ya convertidos con su workflow separado. El CRM **no
recalcula** nada: lee exactamente lo que el run canónico produjo, a nivel de fase y de resumen por
proceso.

Los `identity_validation_cases` (sección D.10) **no** son unidades proceso+fase, no tienen
`phase_selection_status`, y por lo tanto **no** forman parte de este snapshot de procesos candidatos.
Si el CRM decide exponerlos, sólo puede hacerlo en una cola de validación de identidad separada,
identificada por `identity_case_id`, nunca agrupada, mezclada ni contada junto a los procesos
candidatos en `ACTIONABLE`/`MONITOR_*`/`V_*`/`EXCLUDE_*`. Un `identity_validation_case` nunca aparece
en el CRM como licitación comercial elegible.

### L.3 Discord como subconjunto determinístico, gateado por separado de la publicación real

- **S0 no publica y no autoriza Discord.** S0 (sección O.3) es exclusivamente de sólo lectura; dentro
  de ese límite, S0 puede **definir y calibrar una política candidata de proyección** para Discord
  (qué subconjunto, con qué orden, con qué límite de elementos) como parte de su trabajo de
  calibración. Definir o calibrar esa política candidata no es publicar, y no habilita ningún envío
  real de contenido a Discord.
- **La ejecución real de la publicación a Discord sólo puede ocurrir tras un gate productivo posterior
  y explícito**, con su propia autorización humana ("GO" de publicación), análogo al gate de *shadow*
  (sección O.4) y al gate de producción (sección O.5). La aprobación de D0, D1, S0 o S1 **no implica**,
  por sí sola ni en conjunto, que Discord empiece a publicar — cada una de esas aprobaciones cubre
  únicamente lo que su propia sección describe.
- Cuando la publicación real esté autorizada, el contenido de Discord es siempre un **subconjunto
  determinístico** del mismo snapshot CRM ya resuelto por el run canónico: los identificadores que
  aparecen en Discord son un subconjunto de los identificadores del snapshot de CRM, nunca
  identificadores nuevos ni generados aparte. Discord **no tiene selector propio** — no aplica ningún
  criterio de inclusión/exclusión, orden o umbral que no provenga ya resuelto del run canónico.
- Discord **no** introduce IDs nuevos, **no** duplica IDs y **no** reevalúa ninguna unidad proceso+fase
  — usa el mismo `run_id` y la misma `policy_version` que ya produjeron el snapshot de CRM. Como
  `identity_case_id` nunca es un `business_process_id` ni forma parte del snapshot de procesos
  candidatos del CRM (sección L.2), ningún `identity_case_id` puede aparecer en Discord: la restricción
  IDs Discord ⊆ IDs elegibles CRM excluye por construcción a todo `identity_validation_case`.
- El orden, el límite de elementos y la paginación de lo que se envía a Discord son **determinísticos**
  (mismo criterio de orden que J.4, o uno declarado explícitamente si difiere).
- Discord expone **heartbeat y cobertura** (evidencia de que la publicación corresponde a una corrida
  real y completa, no a un subconjunto silenciosamente truncado).
- El **informe técnico** que sostiene la publicación es un **artefacto separado**, no el mensaje
  mismo.
- Si la reconciliación (sección C.7 / K) no cierra para el run que alimenta la publicación, el
  comportamiento es **fail-closed**: no se publica.
- **Cero IA** también aplica a la composición de Discord: ningún paso de selección, resumen o
  redacción automática usa un modelo de lenguaje ni un clasificador entrenado.
- Se reitera explícitamente: **D0 no modifica ningún componente ni diseño visual existente**, ni de
  CRM ni de Discord ni de ningún otro consumidor, y **D0 no autoriza ninguna publicación real**. Todo
  lo anterior en esta sección es contrato de datos, no especificación de interfaz ni autorización de
  ejecución.

### L.4 Workflow humano, separado

El estado de workflow (interés registrado, conversión a Oportunidad, GO/NO-GO, cualquier paso
comercial posterior) es un campo que la proyección **expone** pero que ningún artefacto de esta
especificación **escribe**. La autoridad de escritura sobre workflow es exclusivamente humana, y su
contrato de datos vive separado del contrato de selección descrito en esta especificación (secciones
C a K).

`CONVERT_TO_OPPORTUNITY` es el **evento de ejemplo/contrato** que representa esta decisión humana: un
humano, y sólo un humano, registra `CONVERT_TO_OPPORTUNITY` cuando decide convertir un proceso (o una
de sus fases elegibles) en Oportunidad. Ningún artefacto de esta política —ni la función de
elegibilidad, ni la de prioridad, ni ninguna proyección— escribe jamás ese evento ni ningún evento de
workflow equivalente. GO/NO-GO sigue siendo, en todos los casos y sin excepción, una decisión
exclusivamente humana (principio A.12, sección 1.2).

### L.5 Orden inicial del selector del Radar — decisión humana sobre D0

**Decisión humana.** Cuando una entrada nueva llega al Radar, la opción de orden preseleccionada por
defecto es `Mayor encaje primero`, aplicada de mayor a menor sobre la selección canónica ya resuelta
(secciones D.8, I). Esta decisión fija únicamente el **valor inicial** del selector de orden — no
retira, oculta ni deshabilita ninguna de las demás opciones (L.5.3), y no cambia ninguna otra parte de
esta especificación.

Esta decisión se aplica **exclusivamente al despliegue futuro construido sobre la dirección normativa
de D0**, sujeto a sus propios gates posteriores (sección L.5.4). No se aplica al Radar operativo
vigente descrito en la sección 0, cuyo selector `Mayor encaje primero` hoy ordena por `score`
legado/`tender-fit-v1` (`docs/superpowers/specs/2026-09-20-radar-fit-feedback-design.md`) y que este
documento no modifica.

#### L.5.1 Definición del orden — clave lexicográfica, sin score ni IA

`Mayor encaje primero` es una **clave de comparación lexicográfica determinística** sobre atributos ya
definidos en este documento, evaluada exclusivamente sobre unidades `(business_process_id,
source_phase_id)` ya elegibles (`phase_selection_status` en `ACTIONABLE` o `MONITOR_*`, sección D.8.1;
principio A.6). No existe score agregado ni invocación de IA en ningún paso de este orden (principios
A.9, A.10); ningún atributo se suma ni se pondera en un único número — cada nivel de la clave se
compara de forma discreta, y sólo se pasa al siguiente nivel para desempatar.

La clave, de mayor a menor, en este orden estricto:

1. **`priority_tier`** (sección J.3): `P1`, `P2`, `P3`, `P4`;
2. dentro del mismo tier, **`account`** (sección J.2): `DEFENSE`, `SELECTIVE_ATTACK`, `PREPARE`,
   `STANDARD`, `UNKNOWN`;
3. luego **`capacity`** (sección J.2): `WITHIN_PROFILE`, `ALLIANCE_DOCUMENTED`, `PROFILE_UNKNOWN`;
4. luego hito o fecha más próxima;
5. luego fecha de publicación;
6. por último, como desempate estable, `business_process_id` seguido de `source_phase_id`.

Esta clave es, exactamente, la composición de la asignación de tier (J.3) seguida del desempate
intra-tier ya definido en J.4 — no es una segunda definición de orden divergente: es la misma regla,
expuesta aquí como contrato de presentación. `value_band` **no** participa de esta clave, por la misma
razón ya explícita en J.4: pertenece al eje separado `Mayor valor primero` (L.5.3), no a `Mayor encaje
primero`.

#### L.5.2 Qué no cambia al reordenar

Cambiar la opción del selector — incluida la carga inicial en `Mayor encaje primero` — **únicamente
reordena la misma selección canónica** ya resuelta por el run (secciones D.8, I, K). En particular,
cambiar de selector, o aplicar el orden por defecto al entrar:

- **no** incluye ni excluye ninguna unidad proceso+fase — el conjunto mostrado es siempre el mismo
  snapshot resuelto (sección L.1, L.2);
- **no** cambia ningún `phase_selection_status` ni ningún `identity_selection_status`;
- **no** altera ningún `priority_tier` ni ningún otro atributo de J.2 ya calculado;
- **no** crea, otorga ni retira elegibilidad — la elegibilidad sigue siendo exclusivamente el resultado
  de la tabla R0–R16 (sección I), nunca del selector de orden (principio A.6);
- **no** es una segunda autoridad de resolución de estado ni de prioridad — es una proyección de
  presentación pura sobre atributos ya calculados (consistente con el principio de proyección de la
  sección B, contrato "Proyección").

#### L.5.3 Opciones que permanecen disponibles

Además de `Mayor encaje primero` como valor inicial, permanecen disponibles, sin restricción, al menos
estas opciones de orden, seleccionables libremente por el humano en cualquier momento:

- `Cierre más próximo`;
- `Mayor valor primero` (ordena por `value_band`, sección J.2 — el único lugar de esta especificación
  donde `value_band` participa del orden);
- `Entidad A-Z`;
- `Fuente A-Z`.

Esta sección no diseña el control visual del selector (dropdown, botones, posición en pantalla u otro
detalle de interfaz): eso permanece fuera de alcance de D0 (sección 1.3). Lo único normativo aquí es el
contrato de datos: cuál es el valor inicial, cómo se define exactamente `Mayor encaje primero`, y qué
no cambia al reordenar.

#### L.5.4 Esta decisión no autoriza implementación

Esta sección L.5, como el resto de D0, es dirección normativa, no autorización de construcción. Fijar
`Mayor encaje primero` como valor inicial del selector **no autoriza** por sí sola ni en conjunto con
el resto de D0: ningún cambio de código, ningún cambio de componente bajo `src/`, ningún despliegue,
ninguna corrida contra datos reales, ni ninguna publicación (sección Q.2). Esta decisión se materializa
únicamente cuando se implemente/despliegue la política derivada de D0, y ese despliegue queda sujeto,
como cualquier otro contenido de este documento, a sus propios gates posteriores explícitos (D1, S0,
S1, producción; sección O) — ninguno de los cuales queda abierto por esta decisión ni por la aprobación
de D0 en sí misma.

---

## M. Invariantes al 100%

Estos invariantes deben cumplirse siempre, sin excepción, para cualquier implementación de esta
política:

1. El run es inmutable una vez sellado.
2. Misma entrada + misma política + mismo reloj ⇒ mismo hash de resultado.
3. `run_id` no es lo mismo que un identificador de licitación/tender.
4. El manifiesto está completo antes de cualquier evaluación comercial (C.4).
5. Los siete ejes (sección G) se calculan siempre, a nivel de cada unidad proceso+fase evaluada.
6. Sólo la función de resolución (tabla R0–R16) asigna `phase_selection_status`. R0 opera por
   fila/observación y no asigna `phase_selection_status`. R6 opera por `identity_validation_case`
   (D.10) y asigna `identity_selection_status = V_IDENTITY` — **nunca** un `phase_selection_status`.
   R1–R5 y R7–R16 se ejecutan exactamente una vez por unidad `(business_process_id, source_phase_id)`
   sellada y resoluble (D.8.1) — nunca dos veces, nunca ninguna — y son las únicas reglas que asignan
   el `phase_selection_status` de una fase.
7. Toda razón (`reason_code`) es resoluble a una definición documentada — no hay razones "libres" sin
   catálogo.
8. La prioridad no puede contaminar la elegibilidad (J.1).
9. Un estado `EXCLUDE_*` no es un candidato nuevo — no reingresa al flujo de selección salvo por una
   nueva observación con evidencia distinta.
10. Un estado `V_*` (validación) no es `ACTIONABLE` — nunca se presenta como si ya fuera elegible;
    ninguna combinación no resuelta por R0–R15 (incluidas R7a–R7c) se resuelve como `ACTIONABLE` por
    ausencia de regla aplicable (sección I.1).
11. Las fases activas simultáneas se preservan siempre (D.8.1) — ninguna proyección las colapsa sin
    dejar constancia de las demás.
12. `process_summary_bucket` (D.8.2) es siempre una **proyección pura y determinística** de los
    `phase_selection_status` ya resueltos de las fases activas de un proceso — nunca una segunda
    autoridad de elegibilidad, nunca calculado a partir de evidencia propia, y nunca publicado sin la
    lista completa `active_phase_ids` que lo sustenta.
13. Existe **un solo** workflow de Oportunidad por proceso, incluso tras una división (D.7).
14. CRM y Discord, para el mismo `run_id`, ven el **mismo snapshot** subyacente (L.2, L.3).
15. Discord es siempre subconjunto, nunca superconjunto ni conjunto independiente, del snapshot de
    CRM, y **nunca tiene selector propio** (L.3).
16. La aprobación de D0, D1, S0 o S1 nunca implica, por sí sola, autorización para publicar en
    Discord; la publicación real requiere su propio gate productivo explícito, posterior y separado
    (L.3, O.4, O.5).
17. Las proyecciones (CRM, Discord, cualquier otra) **no recalculan** — sólo leen.
18. Los conteos de todo run reconcilian según las **siete ecuaciones** de C.7, incluida la igualdad
    entre `observaciones_vinculadas` y la suma de `supporting_observation_count` de las evaluaciones de
    fase, y la igualdad equivalente entre `observaciones_en_casos_identidad` y la suma de
    `supporting_observation_count` de los `identity_validation_cases`.
19. `source_health` se reporta siempre explícitamente, nunca implícito.
20. Cero IA en cualquier paso de adquisición, identidad, elegibilidad, prioridad o proyección.
21. Un modo *shadow* (si existiera en un gate posterior) nunca escribe sobre datos reales.
22. No hay conversión automática ni recomendación GO/NO-GO automática en ningún punto de esta
    especificación; `CONVERT_TO_OPPORTUNITY` (L.4) y cualquier evento de workflow equivalente son
    siempre de autoría exclusivamente humana.
23. `identity_case_id` (D.10) nunca se emplea como `business_process_id`, como `source_phase_id`, como
    identidad comercial ni como clave de una Oportunidad; un `identity_validation_case` nunca aparece
    en CRM o Discord como licitación comercial elegible (L.2, L.3).

---

## N. Métricas

Toda métrica declarada aquí se define por su **numerador** y su **denominador** explícitos. Ninguna
métrica se reporta como número aislado sin esa definición adjunta. Salvo que se indique lo contrario,
toda métrica que hable de `ACTIONABLE`/`MONITOR`/`VALIDATE`/`EXCLUDE` cuenta **unidades proceso+fase**
(por su `phase_selection_status`, sección D.8.1), no procesos resumidos por `process_summary_bucket`
— contar por bucket resumido subcontaría fases no ganadoras dentro de un mismo proceso.
`identity_validation_cases` (R6, `identity_selection_status = V_IDENTITY`, sección D.10) **no** son
unidades proceso+fase: cuando una métrica necesita cubrirlos, se reportan como una serie separada,
nunca sumados dentro de `VALIDATE` ni de ninguna otra categoría de `phase_selection_status`.

| Métrica | Numerador | Denominador |
|---|---|---|
| **Precisión de `ACTIONABLE`** | Unidades proceso+fase en `ACTIONABLE` que un humano confirma como correctamente presentadas | Total de unidades proceso+fase en `ACTIONABLE` en el período medido |
| **Elusión dentro de `EXCLUDE`** | Unidades proceso+fase excluidas que un humano determina que debieron ser `ACTIONABLE`/`MONITOR_*` | Total de unidades proceso+fase en `EXCLUDE_*` en el período medido |
| **Elusión del universo previamente no persistido** | Procesos que el pipeline anterior nunca había persistido y que esta política sí captura como candidatos válidos (al menos una fase) | Universo de referencia reconstruido para el período medido (nunca inferido retroactivamente sin reconstrucción explícita) |
| **Carga de `VALIDATE`** | Unidades proceso+fase en cualquier `V_*` de fase (excluye `identity_validation_cases`; sección D.10) | Total de unidades proceso+fase evaluadas en el período |
| **Antigüedad de `VALIDATE`** | — (se mide como distribución de días desde primera aparición de una unidad proceso+fase en `V_*` hasta resolución o corte de medición) | — |
| **Carga de casos de identidad** | `identity_validation_cases` (R6) abiertos en el período | Total de `resultados_seleccion` del período (sección C.7) |
| **Regresiones detectadas por expertos** | Casos en que un experto identifica una regresión frente al comportamiento esperado | Total de casos revisados por expertos en el período |
| **Acuerdo entre evaluadores (inter-rater)** | Casos en que dos o más evaluadores humanos coinciden en su juicio | Total de casos evaluados por más de un evaluador |
| **Cobertura** | Unidades proceso+fase efectivamente evaluadas por la política (R1–R5, R7–R16) | Observaciones vinculadas que el manifiesto selló como válidas y resolubles (C.7) |
| **Delta contra el sistema legado** | Unidades proceso+fase donde el estado de esta política difiere del resultado del sistema legado (score/cupos/gate actuales) | Total de unidades proceso+fase comparables entre ambos sistemas en el período |
| **M9 — sólo reconstructible** | Cualquier métrica que dependa de universo histórico no capturado por el manifiesto se marca explícitamente como **sólo reconstructible**, nunca como medida directa disponible desde el inicio |

Toda proporción reportada con muestra pequeña o moderada se acompaña de su **estimación puntual, el
tamaño de muestra `n`, y un intervalo de confianza del 95% calculado con el método de Wilson** — nunca
sólo el porcentaje puntual sin `n` ni intervalo.

### N.1 Overrides de dueño (owner overrides)

Cuando un dueño de proceso comercial interviene manualmente sobre un resultado (p. ej. reclasifica un
caso), la métrica de calidad se reporta en **dos series separadas**:

1. **serie original**, con la etiqueta independiente producida por la política antes de cualquier
   intervención;
2. **serie posterior a la intervención**, con la razón de la intervención documentada.

La métrica de **calidad primaria** nunca se infla mezclando ambas series sin distinguirlas: un
override de dueño no puede usarse para maquillar el desempeño real de la política.

### N.2 Dueños de etiquetado y disponibilidad

Toda métrica que dependa de etiquetado humano (precisión, elusión, acuerdo inter-rater, regresiones)
debe declarar explícitamente quién es el dueño de producir esa etiqueta y su disponibilidad esperada
para el período de medición correspondiente, como parte del gate S0 (sección O.3) — este documento no
asigna dueños concretos, porque eso es una decisión operativa posterior a D0.

---

## O. Gates

Cada gate requiere su propia autorización humana explícita y no se hereda automáticamente del gate
anterior.

### O.1 D0 (este documento)

Contenido: la especificación normativa completa descrita en las secciones A–N. No autoriza nada más
allá de sí mismo (ver sección Q).

### O.2 D1 — fixtures y corpus

D1 debe producir, como mínimo:

- un corpus de **al menos 30 fixtures**, que incluya obligatoriamente:
  - los casos **CAR**, **Cota**, **Yopal** y **OFB** (sección H.3);
  - casos que cubran fechas límite (ventana, vencimiento);
  - casos de modalidad (contestable, no contestable, régimen especial en sus tres variantes);
  - un caso de **prepublicación**;
  - un caso **terminal** y un caso de **reapertura** tras terminal;
  - un caso de **electrónica** frente a un caso de **suministro aislado** (para probar H.2, la
    distinción acción-ligada-al-activo);
  - casos de identidad: **duplicado**, **fase nueva**, **fusión (`merge`)** y **división (`split`)**;
  - una muestra del **universo previamente no persistido** (para la métrica de elusión de universo,
    sección N);
  - el caso **104/103** (sección D.9) como fixture obligatorio de deduplicación;
  - un **fixture/prueba contractual de presentación** (sección L.5) que verifique, sobre un conjunto
    fijo de unidades proceso+fase ya elegibles: (a) que el valor inicial del selector de orden, al
    entrar al Radar, es `Mayor encaje primero`; (b) que el orden resultante sigue, de mayor a menor, la
    clave lexicográfica `priority_tier` → `account` → `capacity` → hito/fecha más próxima → fecha de
    publicación → `business_process_id` + `source_phase_id` (sección L.5.1), sin score agregado ni
    `value_band`; (c) que dos o más unidades empatadas en todos los niveles anteriores a los
    identificadores producen un desempate estable y determinístico por `business_process_id` y
    `source_phase_id`; y (d) que seleccionar cualquier otra opción (`Cierre más próximo`, `Mayor valor
    primero`, `Entidad A-Z`, `Fuente A-Z`) cambia únicamente el orden mostrado, sin alterar el conjunto
    de unidades incluidas ni ninguno de sus `phase_selection_status`, `identity_selection_status`,
    `priority_tier` u otro estado ya resuelto (sección L.5.2).

### O.3 S0 — sólo lectura

S0 es exclusivamente de **sólo lectura**: no escribe sobre datos reales. S0 debe:

- congelar snapshots y sus hashes;
- ejecutar una **corrida doble** (misma entrada, mismo `evaluation_at`) para verificar determinismo;
- reproducir las figuras/cifras que sostienen cualquier comparación contra el sistema legado;
- explicar explícitamente los casos "14 sólo en exportación + 14 sólo en CRM" por identificador
  concreto (no como cifra agregada sin trazabilidad);
- medir la recuperación de fecha de detalle oficial (cuántos casos con `V_DATE` se resuelven tras
  enriquecimiento medido);
- medir la carga de `V_MODALITY`;
- tratar las exclusiones directas por palabra clave del sistema legado como **sospechosas** y
  compararlas explícitamente por identificador y por razón contra el resultado de esta política, no
  sólo por conteo agregado;
- comparar variantes de parámetro (sensibilidad) antes de proponer valores para S1;
- calibrar `W_MIN` (regla R15) y cualquier `W_ACT` equivalente para prioridad;
- calibrar el SLO de frescura por fuente, después de **al menos 14 corridas comparables**;
- medir la antigüedad de acarreo (*carry age*) de procesos que permanecen en el mismo estado entre
  corridas;
- validar la carga de `VALIDATE` como variable observable, no supuesta;
- calibrar las bandas de valor (J.2, `value_band`);
- caracterizar procesos pequeños (bajo valor) y anomalías de volumen;
- **definir y calibrar, como política candidata de sólo lectura, el subconjunto/orden/límite de
  proyección para Discord** (sección L.3) — sin que esa definición constituya, por sí sola, ninguna
  publicación real ni ninguna autorización de publicación;
- producir el mínimo de evidencia requerido para poder proponer S1.

### O.4 S1 — umbrales congelados antes de shadow

- Los umbrales (incluido `W_MIN` y cualquier parámetro de calibración de S0) se **proponen después de
  S0** y quedan **firmados y congelados ANTES** de iniciar cualquier corrida en modo sombra
  (*shadow*).
- Los umbrales **no pueden cambiar durante la ventana de medición** de shadow. Si un cambio resulta
  necesario, el procedimiento es: **detener** la medición en curso, **firmar de nuevo** los nuevos
  umbrales, y **reiniciar** el período afectado — nunca ajustar umbrales a mitad de una medición ya en
  curso.
- El modo *shadow* requiere su **propia autorización humana explícita ("GO") separada** de la
  aprobación de D0 y de S0. En modo *shadow*: no hay escrituras reales, no hay IA, y no se reemplaza
  al sistema legado — corre en paralelo, sólo con fines de comparación.

### O.5 Producción

Cualquier paso hacia producción está **gateado por separado**, con su propia autorización, y no se
concede ni se implica por este documento ni por ninguno de los gates D1/S0/S1. La **publicación real**
en Discord (sección L.3) es uno de esos pasos: requiere su propio "GO" explícito, posterior a S0/S1, y
ese "GO" no se hereda de la aprobación de D0, D1, S0 o S1.

---

## P. Riesgos

| Riesgo | Naturaleza |
|---|---|
| Fases o modalidades `UNMAPPED` sin catálogo suficiente | Riesgo de cobertura: valores nuevos de las fuentes que ningún mapeo anticipó |
| Carga elevada de régimen especial | Riesgo de volumen sobre `NEEDS_EVIDENCE`/`V_MODALITY` si el régimen especial resulta más frecuente de lo esperado |
| Casos "14 sólo exportación + 14 sólo CRM" | Riesgo de divergencia entre superficies si no se reconcilian por identificador durante S0 |
| Irreproducibilidad histórica | Riesgo de que cifras históricas del sistema legado no puedan reconstruirse con la misma trazabilidad que exige esta política |
| Exclusiones legadas por palabra clave | Riesgo de que el sistema legado haya excluido silenciosamente procesos válidos sin evidencia citable, y que esa pérdida no sea recuperable retroactivamente |
| Extensión no autorizada del alcance visual (*UI scope creep*) | Riesgo de que la implementación de gates posteriores derive en cambios de interfaz no contemplados en D0 (sección 1.3) |
| Contaminación de prioridad sobre elegibilidad | Riesgo de que una implementación futura relaje el aislamiento estructural de J.1 |
| Métricas de dueño mal gobernadas | Riesgo de que los overrides de dueño (N.1) se usen para inflar métricas de calidad sin declarar la intervención |

---

## Q. Relación con diseños anteriores y significado de esta aprobación

### Q.1 Relación con diseños anteriores

- `docs/superpowers/specs/2026-08-25-agt002-radar-learning-design.md` describe el gate determinístico,
  el preanálisis con IA (hoy retirado) y el aprendizaje gobernado como retrieval. Esta especificación
  no invalida su historia ni su ledger existente; propone que la **función de resolución de estado**
  (sección I de este documento) sea, hacia adelante, la única autoridad de elegibilidad, en vez de la
  coexistencia de gate + score + secciones que existe hoy.
- `docs/superpowers/specs/2026-09-20-radar-fit-feedback-design.md` describe `tender-fit-v1` como una
  proyección de prioridad/encaje explícitamente no autoritativa sobre elegibilidad, con su propio
  compromiso de no incorporar retroalimentación sin cohorte revisada y aprobación humana. Esa
  disciplina es consistente con el aislamiento de J.1 de este documento. `tender-fit-v1` **queda
  intacto** por esta especificación; cualquier convergencia entre ambos es trabajo de un gate
  posterior a D0, no de este documento.
- `CURRENT.md` §17 (2026-09-28) registra el retiro operativo del preanálisis con IA y de sus flags.
  Esta especificación es consistente con ese retiro: **cero IA** (principio A.10) es un invariante de
  diseño de esta política, no una condición temporal.

### Q.2 Significado de la aprobación de D0

La aprobación humana de este documento D0 aprueba **únicamente la dirección normativa** descrita en
las secciones A a Q. Explícitamente, **no** aprueba:

- ninguna implementación de código;
- ningún umbral numérico concreto (todos los umbrales mencionados —`W_MIN`, bandas de valor, ventanas
  de calibración— quedan para S0/S1, sección O);
- ningún cambio de interfaz de usuario;
- el corpus/fixtures de D1;
- la ejecución de S0;
- la ejecución de S1 ni ningún modo *shadow*;
- ningún despliegue a producción.

El siguiente gate, tras la aprobación humana de esta dirección, es **D1** — construcción del
corpus/fixtures descrito en la sección O.2 — y **no** incluye producción bajo ninguna circunstancia.
