# Especificación — AGT002 Radar: matriz de Servicio v2 data-driven (modo sombra)

**Fecha:** 2026-10-01
**Repositorio:** `Premium-Security-Investments/sn-crm-comercial` (worktree `/workspace`)
**Naturaleza:** especificación técnica de la implementación sombra actual (código ya implementado en este árbol de trabajo).
**Plan asociado:** `docs/superpowers/plans/2026-10-01-agt002-service-matrix-v2-shadow.md`
**Estado:** implementación completa y verificada. `tender-service-matrix-v2.js` fue creado y `tender-fit-policy.js` fue modificado de forma mínima y aditiva (campo `shadow.servicio_v2`). No se toca `tender-relevance-terms.js` ni `agt002-radar-gate.js`. Los tests dirigidos, la suite completa, `npm run build` y `git diff --check` fueron ejecutados por el parent de esta sesión (ver §7.2) con resultado verde; una revisión de código independiente evaluó la lógica sin encontrar bloqueos y condicionó su aprobación únicamente al resultado verde de la suite completa, condición ya cumplida — la revisión queda **aprobada** (§7.2). Commit, PR y despliegue siguen pendientes.

**Corrección 2026-10-01 (bug descubierto en revisión):** una revisión posterior a la implementación inicial detectó que varios términos `ANCLA`/`SUMINISTRO` (`instalacion de sistema de videovigilancia`, `mantenimiento de cctv`, `instalacion de control de acceso`, `suministro de equipos de control de acceso`) contienen **literalmente** una frase `ANCLA`/`ELECTRONICA` completa como subfrase (`sistema de videovigilancia`, `cctv`, `control de acceso`). El matching original de `evaluateTenderServiceMatrixV2` recorría cada fila de la matriz independientemente y añadía su familia a `anchoredFamilies` sin considerar si la coincidencia electrónica ocurría **dentro del span de texto ya cubierto** por una coincidencia de suministro, de modo que, p. ej., `"Instalación de sistema de videovigilancia"` resolvía a `ELECTRONICA`/48 en vez de `SUMINISTRO`/40 — el documento aprobado (§5.5) especifica estos términos como suministro puro (instalación/mantenimiento/actualización de equipos, sin servicio recurrente propio), y la coincidencia electrónica que disparaban era un artefacto léxico de la subfrase compartida, no una segunda ancla real independiente. §4.3.1 fija la regla de corrección; está implementada en el código actual (§7.1), con el contrato de prueba correspondiente en §7.

> **Convención de evidencia:** **[EXISTE]** significa verificado leyendo el código de este árbol de trabajo.

El diseño detallado de las expresiones de término fue aprobado por el usuario en una sesión previa y documentado originalmente en `/root/.hermes/cache/documents/doc_513814634318_radar-componente-servicio-v2.md`, un archivo **fuera de este worktree** al que este agente no tiene ni debe intentar tener acceso. Este spec **transcribe el diseño aprobado** (roles, familias, puntajes, términos movidos/retirados) tal como fue comunicado por el usuario en el prompt de esta sesión, sin inventar alcance adicional.

**Corrección 2026-10-01 (misma sesión):** una primera versión de este spec redujo e inventó términos en §5 (listas acotadas "representativas" y expresiones de contexto/ambigua que no venían del diseño aprobado, p. ej. `personal uniformado`, `porte de armas`, `suministro de personal de vigilancia`). El usuario corrigió esto en el prompt de corrección, proporcionando las listas **exactas y completas** (ya normalizadas) para cada rol/familia. §5 transcribe esas listas íntegramente, una fila por frase única, sin reducir ni sustituir ninguna por una "representativa". Donde el rol es `CONTEXTO`, el diseño corregido fija `family: null` para las 25 filas de contexto (ninguna confirma una familia específica por sí sola; solo cuentan para la confirmación de `AMBIGUA`, ver §4.3). Esta lista es la transcripción completa indicada por el usuario, ya implementada como la matriz real `TENDER_SERVICE_MATRIX_V2` (§7.1).

## 1. Propósito

Hoy, `evaluateTenderFit` (`tender-fit-policy.js`) calcula el eje **servicio** con una lista plana de términos sin estructura: cada término pertenece implícitamente a "física" (50 puntos) o "electrónica" (40 puntos), por term-matching directo contra `TENDER_CORE_SERVICE_TERMS` (`tender-relevance-terms.js`). No hay noción de familia "híbrida", "suministro", términos ambiguos que requieren confirmación contextual, ni exclusiones basadas en campo de origen.

Este diseño introduce un **componente de Servicio v2 data-driven**, aislado en un módulo nuevo, que:
- Modela los términos como **filas de una matriz versionada** (dato, no código): `{ term, role, family, strength, active }`.
- Calcula un puntaje de servicio **por familia**, nunca por término individual.
- Soporta roles `ANCLA`, `AMBIGUA`, `CONTEXTO`, `EXCLUSION` con reglas de decisión distintas (§4).
- Produce una **traza determinística** de qué términos se encontraron, en qué campo, con qué rol/familia y bajo qué regla.
- Se valida **fail-closed** (§6): una matriz mal formada lanza en vez de degradar silenciosamente.

El resultado se integra a `evaluateTenderFit` **solo en modo sombra**: una proyección interna `shadow.servicio_v2` que ninguna decisión del sistema (score v1, band v1, filtros, orden, Discord, candidatas, gate, UI) consume todavía. `policy_version` permanece `tender-fit-v1` y el score/band/reasons actuales no cambian ni un bit.

## 2. Estado actual verificado [EXISTE]

### 2.1 `tender-fit-policy.js`
- `evaluateServicioAxis(tender)` (líneas 52-64) concatena `title` + `description`, llama a `extractTenderCoreServiceTerms(text)`, y clasifica los términos encontrados contra dos `Set` locales (`PHYSICAL_SERVICE_TERMS_NORMALIZED`, `ELECTRONIC_SERVICE_TERMS_NORMALIZED`) duplicados del contenido de `TENDER_CORE_SERVICE_TERMS`. Física gana sobre electrónica si ambas están presentes (no hay noción de "híbrida" con puntaje propio); no hay familia "suministro"; no hay términos ambiguos ni exclusiones propias de este eje.
- `evaluateTenderFit(tender, { nowIso })` (líneas 110-177) exige `nowIso` como ISO canónico UTC, combina los 4 ejes (`servicio`, `escala_comercial`, `territorio`, `ventana_operativa`), y devuelve `{ policy_version: 'tender-fit-v1', score, band, confidence, participation_hint, reasons, data_gaps, feedback, evaluated_at }`. No existe campo `shadow` en el objeto devuelto hoy.
- `TENDER_FIT_POLICY_VERSION = 'tender-fit-v1'` (línea 3).

### 2.2 `tender-relevance-terms.js`
- `TENDER_CORE_SERVICE_TERMS` (líneas 22-26) es una lista plana congelada de 14 frases (física + electrónica mezcladas, sin metadato de rol/familia).
- `TENDER_DISQUALIFYING_TERMS`, `TENDER_NON_SECURITY_CONTEXT_TERMS`, `TENDER_NON_COMMERCIAL_ACT_TERMS` son listas de exclusión usadas por `agt002-radar-gate.js`, no por `tender-fit-policy.js`.
- `normalizeTenderTerm` (línea 28) normaliza con `NFD` + strip de diacríticos + lowercase + colapso de no-alfanuméricos a espacio — exactamente el mismo patrón que `normalizeTenderFitText` en `tender-fit-policy.js` (línea 7-9), duplicado de forma independiente en ambos archivos hoy.
- `extractTenderCoreServiceTerms` (líneas 38-41) hace matching de frase completa empleando `` ` ${texto normalizado} ` ``.includes(`` ` ${término} ` ``) — ya evita falsos positivos de substring simples (p. ej. "control de accesorios" no contiene `` ` control de acceso ` `` como subcadena delimitada por espacios en ambos lados), patrón que el nuevo evaluador v2 reutiliza por diseño.

### 2.3 `agt002-radar-gate.js`
- `evaluateAgt002RadarGate` es un gate **completamente separado** del eje de encaje: decide `eliminada`/`sobreviviente` por estado terminal, fecha vencida/no verificable, contratación directa y términos de contexto no-seguridad (`TENDER_DISQUALIFYING_TERMS` ∪ `TENDER_NON_SECURITY_CONTEXT_TERMS` ∪ `TENDER_NON_COMMERCIAL_ACT_TERMS`), buscando en `sourceText(row)` (título+descripción+desc+entidad+categoría+valores string de `raw`), **no** distingue campo primario de secundario. Este diseño v2 **no modifica este gate**; la regla "exclusión dura solo desde campo primario" es exclusiva del componente de Servicio v2 nuevo y no se retroalimenta al gate.
- `AGT002_RADAR_GATE_POLICY_VERSION`/`AGT002_RADAR_GATE_CONTEXT_VERSION` son el patrón de versión congelada + `context_version` inyectable que este diseño imita para `TENDER_SERVICE_MATRIX_V2_VERSION`.

### 2.4 Pruebas existentes relevantes
- `tests/tender-fit-policy.test.mjs`: script plano (sin `describe`/`test()`), `assert` de `node:assert/strict` a nivel de módulo; `node --test` falla el archivo completo si cualquier `assert` lanza. Este diseño sigue el mismo estilo.
- `tests/agt002-radar-relevance-terms.test.mjs`: valida que las listas de `tender-relevance-terms.js` estén congeladas (`Object.isFrozen`) y que `server/index.js` las importe en vez de duplicarlas.

## 3. No-alcance (explícito, esta sesión y el diseño completo)

- **No** se modifica valor (`evaluateEscalaComercialAxis`), territorio (`evaluateTerritorioAxis`), fecha/ventana operativa (`evaluateVentanaOperativaAxis`), filtros, orden (`sortTenderCards`), Discord, candidatas actuales, el gate de `agt002-radar-gate.js`, timers, base de datos, UI (`TenderRadarView.tsx` y componentes relacionados) ni ningún script de despliegue.
- **No** se cambia `TENDER_FIT_POLICY_VERSION` (sigue `'tender-fit-v1'`).
- **No** se cambia el score, band, confidence, participation_hint ni `reasons` que `evaluateTenderFit` devuelve hoy para el eje `servicio` (ni para ningún otro eje). El eje `servicio` v1 sigue usando `evaluateServicioAxis`/`extractTenderCoreServiceTerms` exactamente como hoy.
- **No** se consume `shadow.servicio_v2` desde ningún punto de decisión (ni band v1, ni filtros, ni candidatas, ni gate). Es un campo interno de observación, invisible en Radar.
- **No se modifica ningún otro archivo del repositorio** además de `tender-service-matrix-v2.js` (nuevo) y la adición mínima y aditiva en `tender-fit-policy.js` (§4.7, §7.1).

## 4. Diseño del componente de Servicio v2

### 4.1 Módulo nuevo: `tender-service-matrix-v2.js`

Exports:
```js
export const TENDER_SERVICE_MATRIX_V2_VERSION = 'tender-service-matrix-v2-shadow-v1';
export const TENDER_SERVICE_MATRIX_V2_ROLES = Object.freeze(['ANCLA', 'AMBIGUA', 'CONTEXTO', 'EXCLUSION']);
export const TENDER_SERVICE_MATRIX_V2_FAMILIES = Object.freeze(['FISICA', 'ELECTRONICA', 'SUMINISTRO']);
export const TENDER_SERVICE_MATRIX_V2 = Object.freeze([ /* filas, ver §5 */ ]);
export class TenderServiceMatrixV2ValidationError extends Error { /* .code */ }
export function validateTenderServiceMatrixV2({ version, rows }) { /* lanza o devuelve la matriz validada */ }
export function evaluateTenderServiceMatrixV2({ title, description, detail }) { /* ver §4.4 */ }
```

### 4.2 Esquema de fila (dato, no código)

```ts
{
  term: string,       // frase en minúsculas/sin tildes tal como se normaliza; no puede contener '.'
  role: 'ANCLA' | 'AMBIGUA' | 'CONTEXTO' | 'EXCLUSION',
  family: 'FISICA' | 'ELECTRONICA' | 'SUMINISTRO' | null,
  strength: 'dura' | 'condicional' | null,  // solo tiene sentido para role === 'EXCLUSION'
  active: boolean,
}
```

**Ninguna fila lleva `points`.** El puntaje se deriva exclusivamente de la combinación de familias ancladas encontradas (§4.3), nunca de qué término específico coincidió — así una matriz puede ganar o perder sinónimos sin tocar la tabla de puntajes.

Reglas de forma por rol:
- `ANCLA`: `family` obligatorio (no `null`); `strength` debe ser `null`.
- `AMBIGUA`: `family` obligatorio (no `null`) — es el "family hint" que la fila aportaría si se confirma por contexto; `strength` debe ser `null`.
- `CONTEXTO`: `family` opcional (puede ser `null` o una familia, para limitar qué `AMBIGUA` confirma); `strength` debe ser `null`. Una fila `CONTEXTO` **nunca puntúa por sí sola**.
- `EXCLUSION`: `family` debe ser `null` (una exclusión no pertenece a una familia de servicio); `strength` obligatorio, `'dura'` o `'condicional'`. Una fila `EXCLUSION` **nunca puntúa**.

### 4.3 Tabla de puntaje por combinación de familias ancladas

Solo las filas `role: 'ANCLA'` encontradas (no excluidas, ver §4.4) determinan esta tabla. "Encontrada" = al menos una fila `ANCLA` activa de esa familia coincide por frase completa en cualquiera de `title`/`description`/`detail`.

| Física | Electrónica | Suministro | → familia resultante | → puntos | → status |
|---|---|---|---|---|---|
| ✔ | ✔ | ✔ o — | `HIBRIDA` | 50 | `EN_ALCANCE` |
| — | ✔ | ✔ o — | `ELECTRONICA` | 48 | `EN_ALCANCE` |
| ✔ | — | ✔ o — | `FISICA` | 45 | `EN_ALCANCE` |
| — | — | ✔ | `SUMINISTRO` | 40 | `EN_ALCANCE` |
| — | — | — | *(ver ambigua)* | | |

### 4.3.1 Absorción de anclas ELECTRONICA contenidas en el span de una ancla SUMINISTRO (corrección 2026-10-01)

El matching de §4.5 es de frase completa, pero opera por **span/posición**, no solo por presencia booleana de cada término por separado. Cuando el texto normalizado de un campo contiene una coincidencia `ANCLA`/`SUMINISTRO` cuyo span (posición de inicio/fin en el texto normalizado de ese campo) **contiene completamente** el span de una coincidencia `ANCLA`/`ELECTRONICA` en el mismo campo, esa coincidencia electrónica queda **absorbida**: no se añade a `anchoredFamilies` (no cuenta para la tabla de §4.3) y se traza con `rule: 'ancla_absorbida_por_suministro'`, `verdict: 'absorbida_por_suministro'` en vez de `rule: 'ancla_familia'`, `verdict: 'incluido'`.

Esto existe porque varios términos de suministro del diseño aprobado (§5.5) contienen literalmente una frase ancla electrónica completa como subfrase — p. ej. `instalacion de sistema de videovigilancia` contiene `sistema de videovigilancia`; `mantenimiento de cctv` contiene `cctv`; `instalacion de control de acceso` y `suministro de equipos de control de acceso` contienen `control de acceso` — sin que eso implique un segundo servicio recurrente de electrónica independiente del suministro mismo.

Si el campo contiene **otra** coincidencia `ANCLA`/`ELECTRONICA` cuyo span **no** está contenido en ningún span de una coincidencia `ANCLA`/`SUMINISTRO` (en ese mismo campo), esa coincidencia sí es independiente, no se absorbe, y activa `ELECTRONICA` con normalidad según §4.3 — p. ej. `"Instalación de control de acceso junto con servicio de seguridad electrónica recurrente"` tiene `control de acceso` absorbido (dentro del span de `instalacion de control de acceso`) pero `seguridad electronica` aparece en una posición separada del texto, fuera de ese span, y sí activa `ELECTRONICA` (resultado: `ELECTRONICA`/48, no `SUMINISTRO`/40).

La absorción es **unidireccional** (electrónica absorbida por suministro) y **no** aplica entre anclas `FISICA` y `SUMINISTRO`, ni entre `FISICA` y `ELECTRONICA`: ninguna fila de §5.1/§5.3 contiene literalmente una frase de otra familia como subfrase completa, así que no hay caso equivalente que corregir ahí. El algoritmo **no** debe ignorar indiscriminadamente todas las coincidencias electrónicas del campo cuando hay una ancla de suministro presente — solo las que están efectivamente contenidas en el span de esa ancla.

Si no se encuentra ningún `ANCLA`, se evalúa la confirmación por ambigüedad:

| Condición | → familia | → puntos | → status |
|---|---|---|---|
| ≥1 término `AMBIGUA` encontrado **y** ≥2 términos `CONTEXTO` **distintos** encontrados (cualquier campo), sin ningún `ANCLA` | `AMBIGUA` | 30 | `POR_VALIDAR` |
| ≥1 `AMBIGUA` encontrado pero `CONTEXTO` distintos < 2, sin `ANCLA` | `null` | 0 | `FUERA_DE_ALCANCE` |
| 0 `AMBIGUA`, 0 `ANCLA` | `null` | 0 | `FUERA_DE_ALCANCE` |

La exclusión (§4.4) tiene prioridad sobre toda esta tabla: si el resultado es excluido, `family: null`, `points: 0`, `status: 'EXCLUIDA'`, independientemente de qué anclas/ambiguas se hayan encontrado.

### 4.4 Reglas de exclusión

- **Exclusión dura** (`strength: 'dura'`): decide **solo** si el término coincide (frase completa, normalizada) en el **campo primario** — `title` — de la entrada. Una coincidencia de la misma frase únicamente en `description` o `detail` **no excluye** (queda en la traza como encontrada pero con `verdict: 'ignorado_campo_secundario'`). Cuando sí decide, excluye **incondicionalmente**, sin importar si hay anclas presentes.
- **Exclusión condicional** (`strength: 'condicional'`): el término puede coincidir en cualquier campo (`title`, `description` o `detail`), pero **solo excluye si no hay ningún `ANCLA` encontrado** en la entrada completa. Si hay al menos un `ANCLA`, la coincidencia queda en la traza como `verdict: 'ignorado_por_ancla'` y no excluye.
- La exclusión se evalúa **antes** de calcular family/points (§4.3); si excluye, el resto de la tabla no se aplica, pero la traza igual reporta qué anclas/ambiguas/contextos se hubieran encontrado (transparencia total, ver §4.5).

### 4.5 Normalización y matching

Reutiliza exactamente el mismo algoritmo que `normalizeTenderFitText`/`normalizeTenderTerm` ya verificado en §2.1/§2.2: `String(valor).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()`. El matching de cada término es de **frase completa delimitada por espacios** (`` ` ${texto} ` ``.includes(`` ` ${termino} ` ``)) — nunca substring suelto — para que, por ejemplo, "control de accesorios electrónicos" no dispare el ancla "control de acceso", y "arco detectorado" no dispare la ambigua "arco detector".

### 4.6 Forma de salida de `evaluateTenderServiceMatrixV2`

```ts
{
  matrix_version: string,                  // TENDER_SERVICE_MATRIX_V2_VERSION
  family: 'HIBRIDA' | 'ELECTRONICA' | 'FISICA' | 'SUMINISTRO' | 'AMBIGUA' | null,
  points: 50 | 48 | 45 | 40 | 30 | 0,
  status: 'EN_ALCANCE' | 'POR_VALIDAR' | 'FUERA_DE_ALCANCE' | 'EXCLUIDA',
  excluded: boolean,
  exclusion_rule: 'dura' | 'condicional' | null,
  trace: Array<{
    term: string,
    role: 'ANCLA' | 'AMBIGUA' | 'CONTEXTO' | 'EXCLUSION',
    family: string | null,
    field: 'title' | 'description' | 'detail',
    rule: string,       // p. ej. 'ancla_familia', 'ancla_absorbida_por_suministro' (§4.3.1, corrección 2026-10-01),
                         // 'ambigua_confirmada', 'ambigua_sin_confirmar',
                         // 'exclusion_dura_title', 'exclusion_dura_ignorada_campo_secundario',
                         // 'exclusion_condicional_excluye', 'exclusion_condicional_ignorada_por_ancla',
                         // 'contexto_confirma'
    verdict: string,    // 'incluido' | 'absorbida_por_suministro' (§4.3.1) | 'excluye' | 'ignorado_campo_secundario' | 'ignorado_por_ancla' | 'confirma' | 'sin_confirmar'
  }>,
}
```

La función es **pura y determinística**: misma entrada produce siempre la misma salida serializada (`JSON.stringify` estable), sin reloj ni aleatoriedad.

### 4.7 Integración en modo sombra con `evaluateTenderFit`

`evaluateTenderFit(tender, { nowIso })` seguirá devolviendo exactamente los mismos campos que hoy (§2.1), con **un campo adicional**:

```js
return {
  policy_version: TENDER_FIT_POLICY_VERSION,   // sigue 'tender-fit-v1', sin cambios
  score, band, confidence, participation_hint, reasons, data_gaps, feedback, evaluated_at,
  shadow: {
    servicio_v2: evaluateTenderServiceMatrixV2({ title: tender.title, description: tender.description, detail: tender.detail }),
  },
};
```

`score`, `band`, `reasons` (incluyendo `reasons[0]` del eje `servicio`, que sigue viniendo de `evaluateServicioAxis`) **no cambian ni un bit** frente al comportamiento actual. `shadow` es aditivo y no participa en el cálculo de `score`/`band`/`confidence`/`participation_hint`/`data_gaps`. Ningún consumidor existente (filtros, orden, Discord, candidatas, gate, UI) lee `shadow` — por eso es seguro añadirlo sin cambiar comportamiento visible.

## 5. Matriz de términos (transcripción completa, corregida 2026-10-01)

Transcripción íntegra del diseño aprobado, tal como el usuario la proporcionó en el prompt de corrección de esta misma sesión: una fila por frase única, sin reducir a una lista "representativa" y sin inventar frases que no fueron dictadas. Esta es la transcripción exacta pedida, ya implementada como la matriz real `TENDER_SERVICE_MATRIX_V2` (§7.1).

### 5.1 `ANCLA` / `FISICA` (22 términos)
`vigilancia y seguridad privada`, `vigilancia y seguridad`, `servicio de vigilancia`, `servicios de vigilancia`, `vigilancia privada`, `vigilancia armada`, `seguridad privada`, `vigilancia fisica`, `puesto de vigilancia`, `puestos de vigilancia`, `guarda de seguridad`, `guardas de seguridad`, `personal de vigilancia`, `medio humano`, `medios humanos`, `vigilancia y proteccion`, `proteccion de bienes y personas`, `servicio canino`, `vigilancia canina`, `medio canino`, `supervision movil`, `vigilancia movil`.

### 5.2 `AMBIGUA` / family hint `FISICA` (8 términos)
`escolta`, `escoltas`, `proteccion a personas`, `vigilancia`, `custodia`, `guardas`, `porteria`, `recepcion`.

### 5.3 `ANCLA` / `ELECTRONICA` (16 términos)
`seguridad electronica`, `cctv`, `videovigilancia`, `video vigilancia`, `circuito cerrado`, `circuito cerrado de television`, `control de acceso`, `medios tecnologicos`, `medio tecnologico`, `monitoreo de alarmas`, `sistema de alarma`, `sistemas de alarma`, `deteccion de intrusion`, `control de acceso biometrico`, `sistema de videovigilancia`, `monitoreo electronico`.

### 5.4 `AMBIGUA` / family hint `ELECTRONICA` (9 términos)
`central de monitoreo`, `camaras de seguridad`, `detector de metales`, `arco detector`, `monitoreo`, `alarma`, `biometrico`, `biometria`, `seguridad perimetral`.

### 5.5 `ANCLA` / `SUMINISTRO` (13 términos)
`suministro e instalacion de camaras`, `suministro e instalacion de cctv`, `suministro de equipos de seguridad`, `instalacion de sistema de videovigilancia`, `mantenimiento de cctv`, `mantenimiento de camaras`, `mantenimiento de sistema de seguridad`, `actualizacion tecnologica de seguridad`, `repotenciacion de cctv`, `ampliacion de sistema de videovigilancia`, `suministro de equipos de control de acceso`, `instalacion de control de acceso`, `soporte tecnico cctv`.

### 5.6 `CONTEXTO`, `family: null` (25 términos)
Ninguna fila `CONTEXTO` confirma una familia específica por sí sola en este diseño corregido: todas llevan `family: null` y solo cuentan hacia el umbral de "≥2 `CONTEXTO` distintos" que confirma una `AMBIGUA` (§4.3).

`con armas`, `sin armas`, `puesto fijo`, `puesto movil`, `24 horas`, `24 7`, `turno`, `turnos`, `supervisor`, `rondas`, `sedes institucionales`, `proteccion de instalaciones`, `supervigilancia`, `superintendencia de vigilancia`, `licencia de funcionamiento`, `decreto 356`, `salario minimo legal mensual vigente`, `smlmv`, `smmlv`, `cedi`, `bodega`, `planta fisica`, `instalaciones`, `operador de medios tecnologicos`, `omt`.

### 5.7 `EXCLUSION`, `strength: 'dura'` (19 términos)
`vigilancia epidemiologica`, `vigilancia sanitaria`, `vigilancia fitosanitaria`, `vigilancia veterinaria`, `monitoreo epidemiologico`, `vigilancia tecnologica`, `vigilancia judicial`, `seguridad informatica`, `ciberseguridad`, `seguridad de la informacion`, `seguridad y salud en el trabajo`, `sst`, `seguridad vial`, `seguridad alimentaria`, `seguridad social`, `custodia documental`, `custodia de archivo`, `gestion documental`, `interventoria`.

Todas estas son exclusiones absolutas de dominio (salud pública/animal/vegetal, ciberseguridad, SST, vialidad, seguridad alimentaria/social, gestión documental, interventoría): si la frase aparece en `title`, excluye incondicionalmente aunque haya `ANCLA` presente (§4.4).

### 5.8 `EXCLUSION`, `strength: 'condicional'` (7 términos)
`blindaje`, `blindaje vehicular`, `vehiculo blindado`, `radiocomunicaciones`, `telecomunicaciones`, `redes de comunicacion`, `equipos de comunicacion`.

Estas son exclusiones de dominio adyacente (blindaje vehicular, telecomunicaciones/radiocomunicaciones) que solo excluyen si no hay ningún `ANCLA` de seguridad física/electrónica/suministro presente — p. ej. "vigilancia armada con telecomunicaciones" sí tiene ancla (`vigilancia armada`) y no se excluye, pero "proyecto de telecomunicaciones institucionales" sin ningún ancla sí se excluye (§4.4).

### 5.9 Expresiones retiradas de la matriz (no deben existir en ninguna fila, bajo ningún rol)
`transporte de valores`, `custodia y transporte de valores`, `manejo de valores` — instrucción explícita del usuario, confirmada de nuevo en la corrección de esta sesión. El validador (§6) falla cerrado si cualquiera de estas tres frases normalizadas aparece en la matriz.

### 5.10 Las siete expresiones amplias movidas de `ANCLA` a `AMBIGUA` nunca deben volver a `ANCLA`
`escolta`, `escoltas`, `proteccion a personas`, `camaras de seguridad`, `detector de metales`, `arco detector`, `central de monitoreo` — instrucción explícita del usuario (eran demasiado amplias para anclar solas). En la matriz real, cada una de estas siete frases debe existir únicamente como fila `role: 'AMBIGUA'`; ninguna fila `role: 'ANCLA'` puede usar estas frases como término. Las pruebas (§7) verifican esto explícitamente sobre `TENDER_SERVICE_MATRIX_V2`.

## 6. Validación fail-closed de la matriz

`validateTenderServiceMatrixV2({ version, rows })` lanza `TenderServiceMatrixV2ValidationError` (con `.code` identificando la regla violada) si:

1. `version` no es un string no vacío (`code: 'version_vacia'`).
2. Dos o más filas con `active: true` comparten el mismo término normalizado (mismo algoritmo de §4.5), sin importar el rol — conflicto/duplicado (`code: 'termino_duplicado'`).
3. `role` de alguna fila no está en `TENDER_SERVICE_MATRIX_V2_ROLES` (`code: 'rol_invalido'`).
4. `family` de alguna fila, si no es `null`, no está en `TENDER_SERVICE_MATRIX_V2_FAMILIES` (`code: 'familia_invalida'`).
5. Una fila `role: 'AMBIGUA'` tiene `family: null` (`code: 'ambigua_sin_familia'`).
6. Una fila `role: 'EXCLUSION'` tiene `family` distinto de `null` (`code: 'exclusion_con_familia'`).
7. Cualquier fila tiene una propiedad `points` (de cualquier rol — ninguna fila de término lleva puntaje) (`code: 'fila_con_points'`).
8. `term` de alguna fila contiene el carácter `.` (`code: 'termino_con_punto'`).
9. El término normalizado de alguna fila coincide con alguno de los tres retirados de §5.7, sin importar `active` (`code: 'termino_retirado'`).

El validador es la única puerta: `TENDER_SERVICE_MATRIX_V2` exportada debe pasarlo sin lanzar (se verifica en pruebas, §7).

## 7. Implementación y verificación

**Historial TDD (breve):** el módulo se desarrolló en esta sesión en dos ciclos rojo→verde. El primero fijó el contrato completo en `tests/tender-service-matrix-v2.test.mjs` (secciones 1-16) antes de que `tender-service-matrix-v2.js` existiera (fallo inicial `ERR_MODULE_NOT_FOUND`) y después implementó el módulo. El segundo, motivado por una revisión que detectó el bug de absorción de §4.3.1, añadió primero la sección 17 de aserciones contra la implementación ya existente (fallo por `AssertionError`, no por `ERR_MODULE_NOT_FOUND`) y después implementó la corrección correspondiente. Ambos ciclos están cerrados: no queda código pendiente de escribir para este diseño.

### 7.1 Implementación

`tender-service-matrix-v2.js` implementa la forma exacta de §4.1/§4.2: matriz real de §5, `validateTenderServiceMatrixV2`, `evaluateTenderServiceMatrixV2`, validación fail-closed al cargar el módulo. `tender-fit-policy.js` fue modificado de forma mínima y aditiva: import de `evaluateTenderServiceMatrixV2` y adición del campo `shadow.servicio_v2` (§4.7) al valor de retorno de `evaluateTenderFit`, sin tocar `score`/`band`/`reasons`/`policy_version` ni el eje `servicio` v1.

La corrección de absorción de §4.3.1 también está implementada en el motor de matching de `evaluateTenderServiceMatrixV2`:

- El matching de cada fila activa contra cada campo no es un `includes` booleano: `tokenizeNormalizedField` parte el texto normalizado del campo en palabras con posición `{ word, start, end }`, y `findTermOccurrences` busca **todas** las ocurrencias de la secuencia exacta de palabras del término, devolviendo un span `{ start, end }` por ocurrencia. Esto preserva el mismo criterio de frase completa delimitada por palabra de §4.5, pero distingue ocurrencias separadas del mismo término y expone su posición.
- Se recopilan los spans de las coincidencias `ANCLA`/`SUMINISTRO` por campo (`suministroSpansByField`). Una coincidencia `ANCLA`/`ELECTRONICA` se considera absorbida (`isAbsorbedBySuministro`) cuando su span queda completamente contenido (`start >= span.start && end <= span.end`) dentro de **algún** span de suministro del mismo campo.
- Una ancla `ELECTRONICA` absorbida no se agrega a `anchoredFamilies` (no participa en la tabla de §4.3) y en la traza pública lleva `rule: 'ancla_absorbida_por_suministro'`, `verdict: 'absorbida_por_suministro'` en vez de `rule: 'ancla_familia'`, `verdict: 'incluido'`. Una coincidencia `ELECTRONICA` cuyo span no está contenido en ningún span de suministro se trata igual que antes (incluida, activa `ELECTRONICA`).
- El resto de reglas (exclusión dura/condicional, confirmación de `AMBIGUA` por `CONTEXTO`, tabla de puntaje de §4.3, forma de salida pública de §4.6) no cambió: la traza pública sigue sin exponer `start`/`end` (el contrato de §4.6 no los pide).

### 7.2 Verificación

Ejecutado por el parent de esta sesión:
```
node --test tests/tender-service-matrix-v2.test.mjs tests/tender-fit-policy.test.mjs tests/tender-fit-backend-projection.test.mjs tests/tender-fit-cohort-audit.test.mjs tests/tender-fit-frontend.test.mjs tests/tender-radar-card-fit-humanized.test.mjs
```
Resultado: 11 pass, 0 fail (incluye las 17 secciones de `tests/tender-service-matrix-v2.test.mjs`, sin regresión en `tests/tender-fit-policy.test.mjs` para el eje `servicio` v1).
```
npm run build
```
Resultado: exit 0.

Suite completa, ejecutada por el parent de esta sesión:
```
npm test -- --test-concurrency=1
```
Resultado: exit 0, 2817 tests, 2807 pass, 0 fail, 10 skipped, duración 391765.396833ms.

```
git diff --check
```
Resultado: exit 0 (sin marcadores de conflicto ni espacios en blanco al final de línea en el diff).

Una revisión de código independiente evaluó la lógica de la implementación (incluida la corrección de §4.3.1) y no encontró bloqueantes; condicionó su aprobación únicamente a que la suite completa terminara en verde. Esa condición ya se cumplió (resultado de la suite completa arriba), por lo que la revisión queda **aprobada**. Commit, PR y despliegue siguen pendientes.
