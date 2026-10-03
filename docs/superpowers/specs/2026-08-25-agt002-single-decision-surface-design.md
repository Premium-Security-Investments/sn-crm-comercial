# Diseño — AGT-002 · superficie única `Análisis para decidir`

**Fecha:** 2026-08-25
**Estado:** diseño aprobado por Juan. **No implementado.** Sin código, sin migraciones, sin despliegue.
**Producto:** SIIO — Licitaciones / Oportunidades · detalle de una oportunidad `licitacion_publica`
**Agente visible:** Vig-IA Licitaciones (`VIGIA_VISIBLE_NAMES.tenders`, `src/vigia/agentIdentity.ts:3`)
**Identificador:** `AGT-002`
**Alcance temporal:** frente de análisis profundo y decisión **de una oportunidad ya seleccionada**.

> **Relación con `CURRENT.md`.** Este diseño **no toca** `CURRENT.md` §14 (radar + preanálisis temprano, diseño abierto, marcado NO IMPLEMENTAR). §14 gobierna qué entra al radar y si AGT-002 hace un preanálisis selectivo **antes** de opcionar. Este documento gobierna la lectura y decisión **después** de opcionar, sobre el expediente completo. Son dos frentes disjuntos y ninguno modifica al otro. El estado publicado de AGT-002 sigue siendo el de `CURRENT.md` §13 (PUBLICADO / QA PROD PASS); este diseño no lo reabre.

---

## 1. Problema y principios

### 1.1 Problema observado

Hoy el expediente de una licitación reparte la misma información entre seis secciones hermanas (`src/tenders/detailNavigationState.ts:40-51`): `Resumen`, `Documentos`, `Análisis`, `Decisión`, `Preparación`, `Seguimiento`. Dentro de ellas conviven cuatro lecturas paralelas del **mismo** artefacto gobernado `decision_review`:

1. `TenderAnalysisSection.tsx:89-96` — condiciones e impedimentos como una tarjeta por hallazgo, más dos bloques compactos (`Aspectos favorables`, `Acciones de preparación`).
2. `TenderDecisionBrief.tsx:47-79` — el mismo `decision_review`, reproyectado en tres ejes propios (`Potencial comercial`, `Impedimentos`, `Condiciones pendientes`) más una síntesis de tres frases.
3. `TenderGoNoGoDecisionPanel.tsx:237-251` — un tercer conteo del mismo material (`Revisar pendientes en Análisis (N)`), advertencias del modal y el registro formal.
4. `TenderIntegralAnalysisV3View.tsx:136-208` — el respaldo técnico V3 con cinco fases, conteos por estado de conclusión y trazabilidad cruda (`unit_id`, `requirement_id`, `char_start`).

Consecuencias verificadas en el código y en el historial del propio checkpoint:

- **El mismo hallazgo se cuenta tres veces con reglas distintas.** `TenderDecisionBrief` cuenta sólo `decision_questions` en estado `Pendiente de validación`; `TenderGoNoGoDecisionPanel` suma `blockers + pendingConditions` bajo el rótulo único `Revisar pendientes en Análisis`. `CURRENT.md` §11.8 registra ese desalineamiento como Minor preexistente todavía abierto.
- **La lectura no responde una pregunta de negocio.** Las tarjetas responden «¿qué falta en este requisito?», no «¿podemos participar?».
- **La categoría técnica se filtra a la lectura decisoria.** Las cinco fases institucionales (`discard`, `habilitating`, `technical`, `financial_execution`, `strategic`, `tenderIntegralAnalysisPresentation.ts:88-94`) son un orden de análisis, no un criterio de decisión, y aun así compiten visualmente con ella.
- **La decisión llega al final de una lista, no de un juicio.** Para responder «¿vamos o no vamos?» hay que recorrer y reconciliar mentalmente cuatro superficies.

### 1.2 Principios de diseño (vinculantes)

- **P1 · Una sola superficie decisoria.** `Análisis para decidir` es la única pantalla donde se lee para decidir. No hay brief, ni análisis paralelo, ni decisión paralela, ni respaldo técnico como vista protagonista.
- **P2 · Cinco ejes fijos de presentación.** Los cinco ejes son el andamiaje de lectura, **no** el límite del análisis ni preguntas universales inventadas por requisito. AGT-002 sigue analizando todos los documentos vigentes y todos los requisitos reales del caso; los ejes son dónde se **presenta** el resultado.
- **P3 · Cada afirmación visible es una cadena completa.** Todo lo que se muestra debe poder leerse como: *la licitación exige X; SN demuestra Y; el cruce produce Z; esto afecta la decisión así; la siguiente acción es A*. Un bloque que no puede completar la cadena declara qué eslabón falta; nunca la completa por su cuenta.
- **P4 · Fail-closed.** La ausencia de señal nunca es favorable. Un eje sin evidencia es `No evaluado`, jamás `Favorable con evidencia`.
- **P5 · La decisión es humana y no se bloquea.** GO/NO GO permanece disponible para la persona autorizada incluso con pendientes, con advertencia explícita y sin bloqueo artificial. `tenderDecisionGate()` ya devuelve `{canGo: true, canNoGo: true}` incondicionalmente (`src/tenders/tenderDecisionGate.ts:70-72`) y se conserva.
- **P6 · Política material intacta.** Sólo escalan impedimentos **materiales**. El catálogo cerrado de siete categorías materiales y el de ocho categorías de preparación ordinaria (`agt002-pre-go-analysis.js:86-107`) no se amplían, no se reinterpretan y no se sustituyen por heurísticas de texto.
- **P7 · Ninguna afirmación derivada de texto libre.** La relación requisito → eje se hace por igualdad de enumerado gobernado, nunca por coincidencia de título, etiqueta o palabra clave. Es la misma regla que ya rige `tenderIntegralUnitPrimaryConditionKey` (`src/tenders/tenderIntegralAnalysisPresentation.ts:325-338`).
- **P8 · Nunca se imprime nomenclatura interna.** `finding.id`, `finding.label` y `finding.rationale` siguen siendo internos. Es un contrato ya protegido por prueba (`tests/tender-decision-front-render.test.mjs:329-348`).
- **P9 · Sin pérdida de trazabilidad.** Nada se borra: documentos, historial, respaldo técnico y evidencia cruda se mueven a *drawers* bajo demanda dentro de la misma superficie.

---

## 2. Alcance y no alcance

### 2.1 En alcance

1. Sustituir, en el detalle de una oportunidad `licitacion_publica`, las superficies `Análisis` y `Decisión` por una única superficie `Análisis para decidir`.
2. Definir el modelo de presentación por cinco ejes fijos, sus cuatro estados, sus reglas de agrupación y su semántica fail-closed.
3. Definir la anatomía exacta (regiones A–D), su wireframe de escritorio, su comportamiento móvil, su accesibilidad y sus estados de error.
4. Definir el contrato de datos: qué se reutiliza tal cual, qué se extiende de forma aditiva y qué se retira.
5. Definir persistencia de respuestas humanas, adjuntos, autor/fecha y decisión GO/NO GO **sobre los endpoints ya existentes**.
6. Definir estrategia TDD, criterios de aceptación verificables, migración, compatibilidad histórica, rollout y rollback.
7. Renombrar la superficie post-GO a `Mesa de ayuda` conservando su ancla y su lógica.

### 2.2 Fuera de alcance

1. El radar de licitaciones y el preanálisis temprano de `CURRENT.md` §14. No se mezcla, no se referencia como dependencia y no se modifica.
2. Generalizar `decision_review` a otras oportunidades. Hoy el servidor lo deriva **sólo** para el par oportunidad/corrida fijado del piloto Manizales (`tender-analysis-foundation.js:315-341`). Producir artefactos gobernados para Bogotá, Pereira u otro proceso es trabajo de gobernanza y onboarding (`docs/runbooks/agt002-process-onboarding-gate.md`), no de esta UI.
3. Cualquier automatización de GO/NO GO, firma, envío o presentación. Prohibido por `docs/architecture/agt002-human-review-policy.md` §1 y §4.
4. Cambios al motor V3, al manifiesto, al corpus jurídico o al pipeline documental.
5. Migraciones de base de datos, tablas nuevas, columnas nuevas o RPC nuevos.
6. Convertir requisitos particulares de Bogotá, Manizales o Pereira en lista universal. Cada licitación define sus propios requisitos (`CURRENT.md` §14.8).
7. Añadir `comercialmente conveniente` al eje 5. El eje 5 pregunta viabilidad económica; la conveniencia comercial no es un eje.
8. Commit, push, merge, despliegue, reinicio y escrituras externas.

---

## 3. Modelo de información y flujo de datos

### 3.1 La cadena documento → requisito → evidencia SN → cruce → eje → síntesis humana

```
[1] DOCUMENTOS VIGENTES DEL PROCESO
    pliego · anexos · estudios previos · adendas · formatos
    origen: psi_tender_document_versions (current = true)
    en la UI: TenderDocumentRecord[]  (payload de /api/tender-documents)
        │
        │  extracción + snapshot + manifiesto gobernado de requisitos
        ▼
[2] REQUISITO REAL DEL CASO
    integral_analysis.analysis_units[]  → un requisito = una unidad
    campos: requirement_id · category · conclusion · evidence_state (5 ejes) ·
            missing_evidence · blocking · legal_assessment · actions
    tipo: TenderIntegralAnalysisUnit (src/tenders/types.ts:295-315)
        │
        │  revisión gobernada por requisito (curada, versionada, fail-closed)
        ▼
[3] EVIDENCIA DE SEGURIDAD NACIONAL
    decision_review.review_findings[]  → hallazgo probatorio con locator + summary
    disposition: 'supports' | 'requires_verification'
    tipo: TenderDecisionReviewFindingSource (src/tenders/types.ts:389-395)
    + evidencia empresarial (17 clases) y evidencia humana registrada en SIIO
        │
        │  cruce requisito ↔ evidencia, con materialidad explícita
        ▼
[4] CRUCE  →  una de cinco cubetas cerradas
    decision_review.blockers            impedimento material confirmado
    decision_review.decision_questions  verificación que puede confirmar/descartar
                                        un impedimento material
    decision_review.supported           sustentado con hallazgo 'supports'
    decision_review.preparation         preparación ordinaria post-GO
    decision_review.not_applicable      ruido / señal despriorizada
    derivación: agt002-manizales-exercise-decision-review.js:368-415
        │
        │  asignación determinística a eje (§6.1)
        ▼
[5] EJE FIJO DE PRESENTACIÓN  (cinco, siempre los cinco, siempre en este orden)
    1 legal · 2 experiencia+financiera · 3 ejecución técnica · 4 plazo · 5 económico
    estado por eje: Favorable con evidencia | Impedimento material |
                    Por confirmar | No evaluado
        │
        │  respuesta humana registrada (autor + fecha + adjuntos)
        ▼
[6] SÍNTESIS HUMANA
    estado global + síntesis de una línea + única siguiente acción
        │
        ▼
    DECISIÓN HUMANA GO / NO GO   (psi_tender_go_no_go_decisions, ya existente)
```

### 3.2 Qué es dato y qué es derivación

| Capa | Naturaleza | Dónde vive |
|---|---|---|
| [1] Documentos | Dato persistido | `psi_tender_document_versions`; servido por `getTenderDocumentRecords` (`server/index.js:2705`) |
| [2] Requisitos | Dato derivado por el motor y persistido en la corrida | `analysis.integral_analysis` |
| [3] Evidencia SN | Dato curado y versionado | fixture gobernado `data/agt002/manizales-sa-24-2026.exercise-decision-review.v1.json` |
| [4] Cruce | Derivación pura y determinística en servidor | `deriveAgt002ManizalesExerciseDecisionReview` |
| [5] Ejes y estados | **Derivación pura nueva en cliente** | `src/tenders/tenderDecisionAxes.ts` (§7.2) |
| [6] Síntesis y decisión | Estado global derivado + dato humano persistido | derivación en `tenderDecisionAxes.ts`; decisión en `psi_tender_go_no_go_decisions` |

**Regla dura:** la capa [5] es **exclusivamente presentacional y pura**. No inventa hallazgos, no reclasifica materialidad, no llama a red, no escribe. Si un hallazgo no puede asignarse a un eje por enumerado gobernado, la capa [5] **no lo asigna** (§6.2), y ese hecho es visible.

### 3.3 Estado real hoy con el artefacto vigente (verificado, no supuesto)

Con el artefacto de producción actual (`data/agt002/manizales-sa-24-2026.exercise-decision-review.v1.json`):

- 2 `decision_questions`, ambas con `material_impediment_category: "licencia_habilitante_esencial_imposible"` (líneas 458 y 484 del artefacto).
- 0 `blockers` (la cubeta está reservada y hoy vacía; `agt002-manizales-exercise-decision-review.js:41-46`).
- Ninguna entrada declara eje explícito, porque el campo todavía no existe en el contrato.

Por tanto, **al activar esta superficie sin extender el contrato**, el piloto Manizales muestra:

| Eje | Estado |
|---|---|
| 1 · ¿Podemos participar legalmente? | `Por confirmar` (2 verificaciones abiertas) |
| 2 · ¿Cumplimos experiencia y capacidad financiera? | `No evaluado` |
| 3 · ¿Podemos ejecutar sin imposibilidad técnica grave? | `No evaluado` |
| 4 · ¿Podemos presentar dentro del plazo? | `No evaluado` |
| 5 · ¿Es económicamente viable? | `No evaluado` |

Eso es correcto, honesto y fail-closed: hoy el artefacto sólo sustenta el eje 1. La extensión aditiva del contrato descrita en §7.3 es lo que permite que `supported` y `preparation` alimenten los ejes 2–5, y es un acto de curación humana, no de código.

Para **cualquier otra oportunidad** (Bogotá, Pereira, etc.) no existe `decision_review` en absoluto (`tender-analysis-foundation.js:317-318`): los cinco ejes quedan en `No evaluado` y la superficie muestra el estado `Clasificación ejecutiva no disponible` descrito en §9.5. Esto no es una limitación introducida por este diseño; es el estado real del backend hoy y el diseño se niega a disimularlo.

---

## 4. Wireframe textual exacto

### 4.1 Escritorio (≥ 1024 px)

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ ← Oportunidades   ALCALDÍA DE MANIZALES              [Vigente]      Fuente oficial ↗     │  navegación del expediente
│ ●Resumen   ●Análisis para decidir   ●Mesa de ayuda   ●Seguimiento                        │  (4 destinos, §12.2)
└──────────────────────────────────────────────────────────────────────────────────────────┘

╔══ REGIÓN A · cabecera compacta ══════════════════════════════════════════════════════════╗
║ Análisis para decidir                                                                    ║
║                                                                                          ║
║ Alcaldía de Manizales · SA-24-2026            Cuantía   COP 1.284.500.000                ║
║ Servicio de vigilancia y seguridad privada    Cierre    12 sep 2026 · faltan 18 días     ║
║                                               Ubicación Manizales, Caldas                ║
║                                                                                          ║
║ ┌──────────────────────────────────┐   ┌───────────────────────────────────────────────┐ ║
║ │ Estado global                    │   │ Siguiente acción                              │ ║
║ │ ▲ Pendientes por confirmar       │   │ [ Responder «¿Podemos participar legalmente?» ]│ ║
║ └──────────────────────────────────┘   └───────────────────────────────────────────────┘ ║
╚══════════════════════════════════════════════════════════════════════════════════════════╝

┌── REGIÓN B · cinco ejes ─────────────┐┌── REGIÓN C · panel contextual del eje seleccionado ──┐
│ (ancho fijo 340 px)                  ││ (ancho restante, mín. 520 px)                        │
│                                      ││                                                      │
│ ▸ 1  ¿Podemos participar             ││  ¿Podemos participar legalmente?                     │
│      legalmente?                     ││  ▲ Por confirmar · 2 verificaciones abiertas         │
│      ▲ Por confirmar · 2             ││ ─────────────────────────────────────────────────────│
│      ─────────────────────────────── ││                                                      │
│   2  ¿Cumplimos experiencia y        ││  Requisito 1 de 2                                    │
│      capacidad financiera?           ││  Autorización de la agencia en Manizales             │
│      ○ No evaluado                   ││                                                      │
│      ─────────────────────────────── ││  LO QUE EXIGE LA LICITACIÓN                          │
│   3  ¿Podemos ejecutar sin una       ││  Infraestructura física en Manizales-Caldas          │
│      imposibilidad técnica grave?    ││  autorizada por SuperVigilancia y registrada en      │
│      ○ No evaluado                   ││  la Cámara de Comercio respectiva.                   │
│      ─────────────────────────────── ││  [ Pliego · cláusula SA-24-2026#2.1#i11 ]  ← chip    │
│   4  ¿Podemos presentar dentro       ││                                                      │
│      del plazo?                      ││  LO QUE DEMUESTRA SEGURIDAD NACIONAL                 │
│      ○ No evaluado                   ││  Resolución 20214100005697 · licencia principal      │
│      ─────────────────────────────── ││  en Pereira.                                         │
│   5  ¿Es económicamente viable?      ││  Vigencia: vigente · Aplicabilidad: no cubre la      │
│      ○ No evaluado                   ││  territorialidad exigida                             │
│                                      ││  [ Ver evidencia (2) ]                     ← drawer  │
│ ──────────────────────────────────── ││                                                      │
│ Preparación ordinaria (post-GO)   6  ││  RESULTADO DEL CRUCE                                 │
│ Auditoría y descartados          12  ││  Territorialidad no probada. No hay incumplimiento   │
│                          ← drawers   ││  confirmado ni evidencia que la acredite.            │
└──────────────────────────────────────┘│                                                      │
                                        │  EFECTO SOBRE LA DECISIÓN                            │
                                        │  Mantiene el eje legal en «Por confirmar». Si se     │
                                        │  confirma la ausencia, es impedimento material.      │
                                        │                                                      │
                                        │  ACCIÓN HUMANA                                       │
                                        │  Solicitar y verificar el acto de SuperVigilancia y  │
                                        │  el certificado de Cámara de Comercio.               │
                                        │  [ Registrar validación ]                            │
                                        │                                                      │
                                        │ ─────────────────────────────────────────────────────│
                                        │  Requisito 2 de 2                                    │
                                        │  Comunicaciones habilitadas para Manizales           │
                                        │  … (misma estructura de cinco bloques) …             │
                                        └──────────────────────────────────────────────────────┘

╔══ REGIÓN D · barra final de decisión ════════════════════════════════════════════════════╗
║ 0 favorables · 0 impedimentos · 1 por confirmar · 4 no evaluados            (suma = 5)    ║
║                                                                                          ║
║ Hay 2 verificaciones abiertas en el eje legal y cuatro ejes sin evidencia evaluada.       ║
║                                                                                          ║
║ Decisión humana vigente: Pendiente de decisión                                            ║
║                                                                                          ║
║ [ Registrar GO ]  [ Registrar NO GO ]      Vig-IA Licitaciones recomienda; la persona     ║
║                                            autorizada conserva la autoridad absoluta.     ║
║                                                                                          ║
║ ▸ Documentos del proceso (14)   ▸ Historial de decisiones   ▸ Trazabilidad técnica        ║
╚══════════════════════════════════════════════════════════════════════════════════════════╝
```

Notas de lectura del wireframe:

- Los `▸` marcan *drawers* (`<details>`) cerrados por defecto.
- El chip `[ Pliego · cláusula … ]` no imprime `char_start`; el desplazamiento vive dentro del drawer `Ver evidencia`.
- Región B fija el ancho a 340 px para que las cinco preguntas se lean completas en dos líneas sin truncar.
- Región D es *sticky* al pie del contenedor de la superficie mientras la superficie esté en viewport.

### 4.2 Móvil (≤ 900 px)

Mismo DOM, mismo orden, mismas etiquetas y mismos roles ARIA. Cambia sólo la disposición:

```
┌────────────────────────────────┐
│ Análisis para decidir          │  REGIÓN A colapsada a dos líneas:
│ Alcaldía de Manizales·SA-24-26 │   línea 1: entidad · referencia
│ COP 1.284.500.000 · 12 sep     │   línea 2: cuantía · cierre
│ ▸ Ver contexto completo        │   drawer: servicio, ubicación, días restantes
│                                │
│ ▲ Pendientes por confirmar     │  estado global
│ [ Responder «¿Podemos          │  única acción primaria, ancho completo,
│   participar legalmente?» ]    │  altura mínima 44 px
├────────────────────────────────┤
│ ▾ 1 ¿Podemos participar        │  REGIÓN B como acordeón de un solo abierto.
│     legalmente?                │  El eje seleccionado se expande EN SITIO y
│     ▲ Por confirmar · 2        │  REGIÓN C se renderiza inmediatamente debajo
│  ┌──────────────────────────┐  │  del botón del eje, dentro del mismo <li>.
│  │ REGIÓN C completa        │  │
│  │ (cinco bloques, apilados)│  │  Los cinco bloques nunca se colapsan entre sí:
│  └──────────────────────────┘  │  la cadena de P3 se lee siempre entera.
│ ▸ 2 ¿Cumplimos experiencia…    │
│ ▸ 3 …                          │
│ ▸ 4 …                          │
│ ▸ 5 …                          │
│ ▸ Preparación ordinaria (6)    │
│ ▸ Auditoría y descartados (12) │
├════════════════════════════════┤
│ REGIÓN D · barra inferior fija │  position: sticky; bottom: 0
│ 0·0·1·4                        │  conteo abreviado con etiqueta accesible completa
│ Decisión vigente: Pendiente    │
│ ▸ Decidir GO / NO GO           │  los dos botones viven dentro del drawer para
│ ▸ Documentos · Historial ·     │  no competir con la acción primaria de región A
│   Trazabilidad                 │
└────────────────────────────────┘
```

Reglas responsive vinculantes:

- **R1.** Entre 901 px y 1023 px, regiones B y C se apilan (B arriba en formato lista horizontal envolvente, C debajo a ancho completo). Región D conserva su forma de escritorio.
- **R2.** A ≤ 900 px se aplica el acordeón descrito arriba.
- **R3.** Ninguna píldora de estado se recorta a 375 px. El contrato CSS es el mismo que ya se endureció para la tarjeta de condición en `CURRENT.md` §12.2.9: contenedor en `flex-direction: column`, `align-items: stretch`, y la píldora con `min-width: 0; width: 100%`. Se replica con la especificidad suficiente para vencer la regla base, verificado por prueba (§11.4, AC-14).
- **R4.** Ningún texto de eje se trunca con elipsis. Si no cabe, envuelve.

---

## 5. Contenido, estados y acciones por región

### 5.1 Región A — cabecera compacta

| Campo | Fuente exacta | Fallback |
|---|---|---|
| Oportunidad | `opportunity.company_name` + `opportunity.ref`/`process_id` cuando exista | `Expediente` |
| Objeto | `opportunity.service_type_name` \|\| `opportunity.tipo_producto_original` | `Servicio por confirmar` |
| Cuantía | `fmtMoney(opportunity.offer_value)` | `Cuantía por confirmar` |
| Cierre | `fmtDateOnly(opportunity.expected_close_date)` + días restantes | `Cierre por confirmar` |
| Ubicación | `opportunity.quote_city` | `Ciudad por confirmar` (literal ya vigente, `src/main.tsx:832`) |
| Vigencia | `resolveTenderValidity(expected_close_date)` (`TenderDetailNavigation.tsx:66-72`) | `Vigente` |
| Estado global | derivado, §6.4 | — |
| Siguiente acción | derivada, §6.5 | — |

**Estados de la región A:** `cargando` (esqueleto, sin cifras inventadas), `listo`, `error de expediente` (banner `role="alert"` con el mensaje real del backend y la acción `Reintentar`).

**Acciones:** exactamente **una** acción primaria, la de §6.5. Ninguna otra acción primaria existe en toda la superficie. La cabecera no contiene GO/NO GO.

### 5.2 Región B — lista compacta de cinco ejes

Contenido por fila: número (1–5), pregunta completa, píldora de estado, y el conteo de requisitos que sustentan ese estado (`· 2` significa dos requisitos contribuyentes, no dos preguntas nuevas).

Las cinco filas **siempre** se renderizan, en el orden fijo 1→5, aunque estén en `No evaluado`. El orden es parte de la lectura; nunca se reordena por severidad ni se ocultan ejes vacíos.

Debajo de la lista, dos accesos que **no son ejes** y se ven visiblemente distintos (sin numeración, sin píldora de estado):

- `Preparación ordinaria (post-GO) · N` — abre el drawer con las entradas `preparation`.
- `Auditoría y descartados · N` — abre el drawer con `not_applicable`, entradas `exercise_bypassed`, y entradas no resolubles a eje (§6.2).

**Estados de una fila:** `Favorable con evidencia`, `Impedimento material`, `Por confirmar`, `No evaluado`, más el estado de interacción `seleccionado`.

**Acciones:** seleccionar el eje. La selección no persiste en servidor; sí se refleja en el hash (`?section=tender-analysis&eje=legal`) para poder compartir el enlace.

### 5.3 Región C — panel contextual del eje seleccionado

Encabezado del panel: pregunta del eje + estado + una frase de conclusión del eje.

Luego, por cada requisito contribuyente del eje, en orden estable, exactamente cinco bloques y en este orden:

1. **Lo que exige la licitación** — texto gobernado + chip de cita.
2. **Lo que demuestra Seguridad Nacional** — texto gobernado + línea `Vigencia: … · Aplicabilidad: …` + drawer `Ver evidencia (N)`.
3. **Resultado del cruce** — texto gobernado.
4. **Efecto sobre la decisión** — texto gobernado.
5. **Acción humana** — texto gobernado + control de registro/soporte.

**Regla anti-tarjeta:** un requisito es una sección `<section>` con `<h4>` y un `<dl>` de cinco entradas. No lleva marco de tarjeta propio, ni segunda píldora de estado, ni botón de historial propio, ni formulario visible en reposo. Se elimina así la multiplicación de tarjetas por hallazgo.

**Estado de cada bloque cuando falta la copia gobernada:** el bloque se renderiza con la frase exacta `Sin lectura gobernada para este punto.` y el panel marca el requisito como `Por confirmar`. **Nunca** degrada a `rationale` ni a `label` (P8; ya protegido por `tests/tender-decision-front-render.test.mjs:282`).

**Acciones:**
- `Registrar validación` / `Actualizar validación` (rótulos ya vigentes, `TenderQuestionResponseCard.tsx:65`), habilitadas sólo para identidad humana activa.
- Formulario en sitio: estado (`Pendiente` / `Resuelta` / `No aplica`), respuesta obligatoria (`maxLength 10000`), adjuntos opcionales (máx. 8, 25 MiB, tipos ya permitidos), y la leyenda ya vigente `El autor y la fecha se registran automáticamente desde la sesión. No autoriza GO / NO GO.`
- `Ver evidencia (N)` — drawer.
- `Historial de respuestas (N)` — drawer, sólo si `responses.length > 1`.

### 5.4 Región D — barra final de decisión

| Elemento | Contenido | Fuente |
|---|---|---|
| Conteo de estados | `F favorables · I impedimentos · C por confirmar · N no evaluados` | derivado; invariante `F+I+C+N === 5` |
| Síntesis de una línea | frase única derivada, §6.6 | derivado |
| Decisión humana vigente | `GO registrado` / `NO GO registrado` / `Pendiente de decisión` + autor + fecha + comentario | `TenderGoNoGoDecisionSummary` reutilizado sin cambios |
| Controles | `Registrar GO`, `Registrar NO GO` | `TenderGoNoGoDecisionPanel` reutilizado |
| Drawers | `Documentos del proceso (N)`, `Historial de decisiones`, `Trazabilidad técnica` | componentes existentes |

**Estados:** `cargando decisión`, `sin decisión`, `decisión registrada`, `decisión registrada anterior al análisis vigente` (aviso `role="status"` cuando `analysis.completed_at > decision.decided_at`), `sincronización pendiente` (con `Reintentar actualización`, ya existente), `error de registro`.

**Acciones y su gobierno:**
- Los dos botones permanecen **habilitados** para la persona autorizada aunque haya pendientes o impedimentos (P5). El modal de confirmación conserva y muestra las advertencias reales (`TenderGoNoGoDecisionPanel.tsx:54-71`).
- Para quien no está autorizado, se muestra el texto de solo lectura ya vigente.
- **Durante HOLD** (§6.5), los botones siguen habilitados pero **no** son la acción primaria: la acción primaria de región A apunta a completar el expediente o a validar el eje pendiente, y en móvil los botones viven dentro del drawer `Decidir GO / NO GO`.
- **Después de GO**, la acción primaria pasa a `Abrir Mesa de ayuda` y enfoca `#tender-preparation`.
- **Después de NO GO**, la acción primaria pasa a `Cerrar con registro auditable`, que enfoca el historial de decisiones y el registro de seguimiento. No hay escritura automática.

---

## 6. Reglas de agrupación de hallazgos y materialidad

### 6.1 Mapa cerrado categoría material → eje

El catálogo `AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES` tiene exactamente siete entradas (`agt002-pre-go-analysis.js:86-94`). El mapa a los cinco ejes es total, cerrado y no admite un octavo valor:

| Categoría material gobernada | Eje |
|---|---|
| `inhabilidad_incompatibilidad` | 1 · ¿Podemos participar legalmente? |
| `licencia_habilitante_esencial_imposible` | 1 · ¿Podemos participar legalmente? |
| `experiencia_minima_insuficiente` | 2 · ¿Cumplimos experiencia y capacidad financiera? |
| `capacidad_financiera_insuficiente` | 2 · ¿Cumplimos experiencia y capacidad financiera? |
| `imposibilidad_tecnica_grave` | 3 · ¿Podemos ejecutar sin una imposibilidad técnica grave? |
| `plazo_objetivamente_imposible` | 4 · ¿Podemos presentar dentro del plazo? |
| `inviabilidad_economica_critica` | 5 · ¿Es económicamente viable? |

Cobertura: 7 de 7. Sin residuo. Si en el futuro el catálogo gobernado creciera, la derivación **falla cerrado** (§6.2) en lugar de inventar un eje.

### 6.2 Orden de resolución del eje de un hallazgo

Para cada `TenderDecisionReviewFinding`, en este orden estricto:

1. Si trae `decision_axis` (campo aditivo de §7.3) y su valor pertenece al enumerado cerrado de cinco → ese eje.
2. Si no, y trae `material_impediment_category` → el eje del mapa §6.1.
3. Si no → **no se asigna eje**. El hallazgo:
   - si su `reviewed_status` es `preparation` → va al drawer `Preparación ordinaria (post-GO)`;
   - si es `not_applicable` → va al drawer `Auditoría y descartados`;
   - si es `supported` → va al drawer `Auditoría y descartados`, subgrupo `Sustentado sin eje declarado`, y **no** vuelve favorable ningún eje;
   - si es `decision_question` o `blocker` → va al drawer `Auditoría y descartados`, subgrupo `Sin eje resoluble`, **y degrada el estado global** a lo sumo a `Sin evidencia suficiente` (§6.4, regla G3).

Nunca se asigna eje por título, etiqueta, `requirement_id`, `front` del manifiesto ni por palabra clave (P7).

### 6.3 Estado de un eje

Con `A` = conjunto de hallazgos asignados al eje y `R(f)` = respuesta humana más reciente de `f` según `latestQuestionResponse` (`src/tenders/tenderDecisionSurface.ts:40-49`), el estado se resuelve por precedencia estricta:

| # | Condición | Estado |
|---|---|---|
| 1 | Existe `f ∈ A` con `reviewed_status === 'blocker'` | **Impedimento material** |
| 2 | Existe `f ∈ A` con `reviewed_status === 'decision_question'` y `conditionState(R(f)) === 'Pendiente de validación'` | **Por confirmar** |
| 3 | Existe `f ∈ A` que aporta sustento: `reviewed_status === 'supported'` **o** (`decision_question` con `conditionState(R(f)) === 'Validación registrada'`) | **Favorable con evidencia** |
| 4 | En cualquier otro caso, incluido `A = ∅` | **No evaluado** |

Corolarios verificables:

- **C1 (fail-closed, P4).** `A = ∅ ⇒ No evaluado`. Nunca `Favorable con evidencia`.
- **C2.** Un `decision_question` respondido `No aplica` deja de contribuir; si el eje queda sin otro aporte, vuelve a `No evaluado`, no a favorable.
- **C3.** Una respuesta humana `Validación registrada` **sí** es evidencia: queda registrada con autor, fecha y adjuntos verificables. Es la única vía por la que la acción humana mueve un eje a favorable.
- **C4.** Una respuesta humana **nunca** crea un `blocker`. La confirmación de un impedimento material es un acto de curación gobernada fuera de runtime (`agt002-manizales-exercise-decision-review.js:41-46`, «nunca se infiere sola»).
- **C5.** Las entradas `exercise_bypassed` permanecen visibles en el drawer de auditoría y **no** cuentan para ningún estado de eje, exactamente como hoy no cuentan para la recomendación.

### 6.4 Estado global

Precedencia estricta:

| # | Condición | Estado global |
|---|---|---|
| G0 | Existe decisión humana vigente | `GO registrado` / `NO GO registrado` |
| G1 | HOLD de expediente (§6.5, condiciones H1–H5) | `Expediente incompleto` |
| G2 | Algún eje en `Impedimento material` | `Impedimento material detectado` |
| G3 | Algún eje en `Por confirmar`, **o** existe al menos un hallazgo sin eje resoluble de tipo `decision_question`/`blocker` | `Pendientes por confirmar` |
| G4 | Algún eje en `No evaluado` | `Sin evidencia suficiente` |
| G5 | Los cinco ejes en `Favorable con evidencia` | `Base suficiente para decidir` |

`G5` es el único estado que afirma suficiencia, y sólo se alcanza con los cinco ejes favorables. Ningún otro camino lo produce.

### 6.5 Regla de la única acción primaria

HOLD de expediente si y sólo si se cumple alguna de:

- **H1** no hay documentos vigentes (`documents.length === 0`);
- **H2** no hay análisis (`analysis === null`);
- **H3** el análisis falló (`analysis.status === 'failed'`);
- **H4** el análisis está obsoleto (`analysis.current === false`);
- **H5** hay procesamiento visible en curso (`deriveTenderProcessingPresentation(...).visible === true` con tono no final) o error de carga del expediente.

Resolución de la acción primaria, por precedencia estricta:

| # | Condición | Etiqueta de la acción | Destino |
|---|---|---|---|
| 1 | Decisión vigente `go` | `Abrir Mesa de ayuda` | enfoca `#tender-preparation` |
| 2 | Decisión vigente `no_go` | `Cerrar con registro auditable` | abre `Historial de decisiones` y enfoca `#tender-follow-up` |
| 3 | HOLD (H1–H5) | `Completar expediente` | abre el drawer `Documentos del proceso` y enfoca su primer control |
| 4 | Estado global `Pendientes por confirmar` | `Responder «<pregunta del primer eje pendiente en orden 1→5>»` | selecciona ese eje y enfoca su primer control de validación |
| 5 | Estado global `Impedimento material detectado` o `Base suficiente para decidir` | `Registrar decisión` | enfoca `#tender-go-no-go-actions` |
| 6 | Estado global `Sin evidencia suficiente` | `Revisar evidencia del expediente` | selecciona el primer eje en `No evaluado` |

Exactamente una fila aplica siempre; la tabla es total sobre los estados de §6.4.

### 6.6 Síntesis de una línea

Frase única, compuesta determinísticamente y sin adjetivos comerciales:

- Con impedimentos: `Hay N impedimento(s) material(es) confirmado(s) en <ejes>.`
- Sin impedimentos y con pendientes: `Hay N verificación(es) abierta(s) en <ejes> y M eje(s) sin evidencia evaluada.`
- Sin impedimentos ni pendientes y con no evaluados: `No hay impedimentos confirmados; N eje(s) siguen sin evidencia evaluada.`
- Todos favorables: `Los cinco ejes cuentan con evidencia favorable registrada.`
- HOLD: `El expediente no está en condiciones de sustentar una lectura: <causa H1–H5>.`

La síntesis **nunca** afirma «no hay impedimentos» sin calificar la cobertura, en línea con `tenderBriefUnavailableCopy()`: «Que no haya clasificación ejecutiva no significa que se hayan buscado impedimentos y no se hayan encontrado.»

### 6.7 Materialidad: lo que NO escala

Se conserva íntegra la política vigente. Las ocho categorías ordinarias (`agt002-pre-go-analysis.js:98-107`) —`personal`, `armas_medios`, `estructura_consorcio_ut`, `garantias_polizas_emitir_modificar`, `formatos`, `firmas`, `certificados`, `asignaciones`— **nunca**:

- ocupan un eje;
- producen `Impedimento material`;
- producen `Por confirmar`;
- generan pregunta humana pre-GO;
- por sí solas, mueven el estado global.

Son preparación post-GO y viven en el drawer `Preparación ordinaria (post-GO)`. **Única excepción**, ya prevista por la política: si la curación gobernada clasifica esa misma situación como `imposibilidad_tecnica_grave` (categoría material), entonces —y sólo entonces— entra por el eje 3. Esa reclasificación es un acto humano de curación, jamás una inferencia de la UI.

---

## 7. Contrato de datos: reutilización, extensión y sustitución

### 7.1 Se reutiliza sin ningún cambio

| Ruta real | Qué aporta | Uso en la nueva superficie |
|---|---|---|
| `src/tenders/tenderDecisionSurface.ts` | `latestQuestionResponse`, `conditionState`, `tenderDecisionConditions/Blockers/SupportedAspects/PreparationActions`, `tenderDecisionConditionAnchorMap/Anchor` | única proyección de `decision_review` a copia humana y única fuente de anclas |
| `src/tenders/tenderDecisionGate.ts` | `tenderRecommendationKind/Label/Copy`, `tenderExecutive*`, `tenderDecisionGate` | advertencias del modal y no-bloqueo de GO/NO GO |
| `src/tenders/permissions.ts:27-33` | `canApproveTenderGoNoGo` | habilitación de los controles de decisión |
| `src/tenders/api.ts:60-69` | `loadTenderGoNoGoDecision`, `recordTenderGoNoGoDecision` | región D |
| `src/tenders/tenderQuestionResponseActions.ts` | `createTenderQuestionResponseActions`, límites de adjuntos | formulario de validación |
| `src/tenders/processingStatus.ts` | `deriveTenderProcessingPresentation` | condición H5 y banner de procesamiento |
| `src/tenders/components/TenderGoNoGoDecisionSummary.tsx` | decisión vigente | región D |
| `src/tenders/components/TenderDocumentSection.tsx` | navegador y carga documental | drawer `Documentos del proceso` |
| `src/tenders/components/TenderIntegralAnalysisV3View.tsx` | respaldo técnico V3 | drawer `Trazabilidad técnica` |
| `src/tenders/tenderIntegralAnalysisPresentation.ts` | fases, conteos, traducción de enums, `tenderIntegralUnitConditionAnchor` | drawer `Trazabilidad técnica` |
| `src/tenders/tenderDecisionBriefModel.ts` → `resolveFindingEvidence` | evidencia resuelta con `locator` y `summary` | chip de cita y drawer `Ver evidencia` |
| `src/tenders/components/TenderFindingEvidence.tsx` | lista de evidencia con `Ver evidencia` | drawer `Ver evidencia`; hoy el componente existe pero **no está montado** en ninguna vista |
| `src/tenders/components/TenderDetailNavigation.tsx` | observer, intención de navegación, `aria-current`, vigencia | navegación del expediente, con la lista de secciones reducida (§12.2) |

### 7.2 Se crea (derivación pura nueva)

**`src/tenders/tenderDecisionAxes.ts`** — selectores puros, sin I/O, sin React, sin reloj salvo el que ya reciben por parámetro:

```ts
export type TenderDecisionAxisKey =
  | 'legal' | 'experiencia_financiera' | 'ejecucion_tecnica' | 'plazo' | 'economico';

export type TenderDecisionAxisState =
  | 'Favorable con evidencia' | 'Impedimento material' | 'Por confirmar' | 'No evaluado';

export type TenderDecisionAxisRequirement = {
  key: string;                       // finding.id — sólo llave React, nunca texto visible
  anchorId: string | null;           // reutiliza tenderDecisionConditionAnchor
  persistence: { questionText: string };  // finding.label, sólo persistencia
  title: string;
  demand: string | null;             // "lo que exige la licitación"
  demandCitations: TenderBriefEvidence[];
  companyEvidence: string | null;    // "lo que demuestra SN"
  validityLabel: string | null;
  applicabilityLabel: string | null;
  evidence: TenderBriefEvidence[];
  crossing: string | null;           // "resultado del cruce"
  decisionEffect: string | null;     // "efecto sobre la decisión"
  humanAction: string | null;        // "acción humana"
  answerable: boolean;               // decision_question ⇒ true
  humanState: TenderDecisionConditionState | null;
};

export type TenderDecisionAxis = {
  key: TenderDecisionAxisKey;
  order: 1 | 2 | 3 | 4 | 5;
  question: string;
  state: TenderDecisionAxisState;
  requirements: TenderDecisionAxisRequirement[];
  conclusion: string;                // una frase, derivada del estado y del conteo
};

export type TenderDecisionSurfaceModel = {
  axes: [TenderDecisionAxis, TenderDecisionAxis, TenderDecisionAxis, TenderDecisionAxis, TenderDecisionAxis];
  counts: { favorable: number; impediment: number; pending: number; unevaluated: number };
  ordinaryPreparation: TenderDecisionAxisRequirement[];
  auditTrail: { notApplicable: []; bypassed: []; unresolvedAxis: [] };
  globalState: TenderDecisionGlobalState;
  headline: string;
  primaryAction: TenderDecisionPrimaryAction;
};

export function tenderDecisionSurfaceModel(input: {
  analysis: TenderDocumentAnalysis | null;
  documents: TenderDocumentRecord[];
  questionResponses: TenderQuestionResponse[];
  decision: TenderGoNoGoDecision | null;
  processing: TenderProcessingStatus | null;
}): TenderDecisionSurfaceModel;
```

Invariantes exigidas por prueba: `axes.length === 5`; el orden es siempre `1..5`; `favorable + impediment + pending + unevaluated === 5`; ningún campo visible contiene `finding.id`, `finding.label` ni `finding.rationale`.

**`src/tenders/components/TenderDecisionSurface.tsx`** — regiones A, B y D, orquestación de selección de eje, *deep-link* y drawers.

**`src/tenders/components/TenderDecisionAxisPanel.tsx`** — región C: los cinco bloques por requisito y el formulario de validación en sitio.

### 7.3 Se extiende de forma aditiva (contrato gobernado)

El contrato de presentación hoy permite exactamente cuatro campos (`agt002-manizales-exercise-decision-review.js:60-66`): `title`, `summary`, `missing`, `action_required`. Con eso **no** se puede completar la cadena de P3: falta el enunciado de la exigencia, la evidencia de SN, el cruce y el efecto sobre la decisión.

Extensión propuesta, **aditiva y opcional**, en `agt002-manizales-exercise-decision-review.js`:

```
PRESENTATION_ALLOWED_FIELDS  += 'demand' | 'company_evidence' | 'crossing' | 'decision_effect'
finding                      += 'decision_axis'   // enumerado cerrado de cinco, opcional
```

Reglas de la extensión:

1. **Opcional en `contract_version @1`.** Los artefactos v1 existentes siguen validando sin cambios. La superficie degrada bloque por bloque con `Sin lectura gobernada para este punto.` (§5.3).
2. **Obligatoria a partir de `contract_version @2`.** Un artefacto que declare `@2` debe traer los cuatro campos nuevos para `decision_question` y `blocker`, y `decision_axis` para `supported`. La validación es fail-closed, con la misma forma de error que las reglas ya existentes.
3. **Mismas guardas.** Los campos nuevos pasan por `validatePresentationCopy`: texto humano no vacío y sin nomenclatura técnica `snake_case` (`TECHNICAL_NOMENCLATURE_PATTERN`).
4. **`material_impediment_category` para `blocker`.** Hoy el validador la permite sólo en `decision_question` (`agt002-manizales-exercise-decision-review.js:242-244`). En `@2` se exige también para `blocker`, porque un bloqueador **es** un impedimento material confirmado y sin categoría no tiene eje. En `@1` no cambia nada, y un `blocker` sin categoría cae en `Sin eje resoluble` (§6.2), nunca en un eje inventado.
5. **Sin migración.** El artefacto es un fichero versionado en `data/agt002/`; no hay tabla ni columna que alterar.
6. **Vigencia y aplicabilidad.** `validityLabel` y `applicabilityLabel` no se inventan: se leen de los ejes `validity` y `applicability` de la unidad V3 correspondiente (`TenderIntegralAnalysisUnit.evidence_state`), traducidos por el diccionario cerrado ya existente `AXIS_VALUE_LABELS` (`src/tenders/tenderIntegralAnalysisPresentation.ts:68-76`), y la unidad se localiza con `tenderIntegralPrimaryUnitForCondition` por igualdad de `requirement_id` (`ibid.:351-357`). Sin unidad correspondiente, ambas líneas se omiten; nunca se rellenan.

### 7.4 Se extiende el payload del backend (una sola bandera)

- `agt002-analysis-config.js`: añadir `'TENDER_DECISION_SURFACE_V1'` a `ANALYSIS_FLAG_NAMES`. Sin dependencias con otras banderas, `false` por defecto, mismo *parser* fail-closed (`'true'` / `'1'`).
- `getTenderDocumentRecords` (`server/index.js:2705-2755`): añadir al objeto de retorno
  `decision_surface: { enabled: agt002AnalysisConfig.TENDER_DECISION_SURFACE_V1 === true }`.
- `src/tenders/types.ts`: añadir a `TenderDocumentsPayload` el campo opcional
  `decision_surface?: { enabled: boolean }`.
- **Paridad obligatoria:** `api/[...path].js` debe recibir el cambio **byte a byte idéntico**; `scripts/check_backend_parity.mjs` compara los dos ficheros completos y falla si difieren.

Es el único cambio de backend del diseño. No hay endpoint nuevo, tabla nueva, columna nueva ni RPC nuevo.

### 7.5 Se sustituye o se retira

| Ruta real | Destino |
|---|---|
| `src/tenders/components/TenderDecisionBrief.tsx` | **Se retira.** Su función la absorben las regiones A, B y D. |
| `tenderBriefHeadline`, `tenderCommercialPotential`, `tenderBriefClassificationAvailable` (`src/tenders/tenderDecisionBriefModel.ts:13-44, 96-109`) | **Se retiran** con el brief. `resolveFindingEvidence` y `TenderBriefEvidence` se conservan. `tenderBriefUnavailableCopy()` se conserva: su texto es el que usa el estado de §9.5. |
| `src/tenders/components/TenderAnalysisSection.tsx` | **Se conserva, degradado a modo drawer.** Se le añade la prop opcional `variant?: 'standalone' \| 'drawer'` con valor por defecto `'standalone'` (comportamiento actual intacto). En la nueva superficie se monta con `variant="drawer"` **sólo** para corridas heredadas sin V3 y sin `decision_review`, dentro del drawer `Lectura preliminar del análisis`. Así no se pierde la lectura de expedientes históricos con `siio_rules_v1`. |
| Bloques `Aspectos favorables y capacidad` / `Acciones de preparación` de `TenderAnalysisSection.tsx:92-95` | **Se retiran de la lectura frontal**: `supported` alimenta ejes (con `decision_axis`) o el drawer de auditoría; `preparation` alimenta el drawer de preparación ordinaria. |
| `src/tenders/components/TenderGoNoGoDecisionPanel.tsx` | **Se conserva y se reubica** dentro de la región D. Se retira de él el puntero `Revisar pendientes en Análisis (N)` (`líneas 244`), que era el tercer conteo divergente y la causa del Minor abierto en `CURRENT.md` §11.8, y el `article` `tender-go-no-go-brief-pointer` (`línea 238`), que sólo explicaba la separación entre brief y panel. Todo lo demás —carga, modal, advertencias, foco, historial, reconciliación optimista— se conserva íntegro. |
| `details#tender-technical-analysis` (`src/main.tsx:1086`) | **Se mueve** a la región D como drawer `Trazabilidad técnica`. |
| Sección de navegación `tender-document-review` | **Se retira como destino de navegación**; su contenido pasa al drawer `Documentos del proceso`. El `id` del contenedor se conserva para no romper anclas históricas. |
| Sección de navegación `tender-decision` | **Se retira como destino de navegación**; el `id="tender-decision"` sobrevive como ancla de la región D. |

---

## 8. Persistencia

### 8.1 Respuestas humanas y adjuntos

Se usa el flujo ya existente, sin cambios de contrato:

1. **Adjuntos primero.** `createTenderQuestionResponseActions().uploadAttachments(opportunityId, files)` (`src/tenders/tenderQuestionResponseActions.ts:30-52`) pide un ticket por archivo a `POST /api/tender-question-response-attachment-upload-url`, sube con URL firmada y devuelve `{response_id, response_ticket, attachments[]}` con `content_hash` SHA-256 calculado en cliente.
2. **Respuesta después.** `POST /api/tender-question-responses` con `{opportunity_id, analysis_run_id, question_id, question_text, status, response, response_id, response_ticket, attachments}`. El servidor verifica el ticket, verifica el contenido de cada adjunto y llama a la RPC `psi_record_tender_question_response_with_attachments` (`server/index.js:3931-3949`).
3. **Autor y fecha.** No se envían nunca desde el cliente: `p_responded_by: currentProfile.id` y la marca temporal la pone la RPC. La UI muestra `responded_by_name` y `responded_at` tal como llegan (`TenderQuestionResponseCard.tsx:64`).
4. **Identidad.** `requireHumanTenderIdentity(currentProfile)` bloquea escritura desde identidades de agente en el servidor; el cliente además oculta el control salvo identidad humana.
5. **Límites.** Máx. 8 adjuntos, 25 MiB por archivo, seis tipos MIME permitidos (`tenderQuestionResponseActions.ts:3-12`, replicados en servidor).
6. **Correlación con el eje.** `question_id` sigue siendo `finding.id`; `question_text` sigue siendo `finding.label`. Ninguno de los dos se imprime. La superficie **no** persiste el eje: el eje es derivación pura y se recalcula en cada render.
7. **Reanálisis.** El servidor sigue disparando `reanalyzeAgt002AfterHumanAnswer` tras registrar la respuesta (`server/index.js:3950`). La superficie refresca el modelo con el payload devuelto; no introduce sondeo propio.

### 8.2 Decisión humana

- Lectura: `GET /api/tender-go-no-go-decision?id=<opportunity_id>` → `{decision, history, preparation}`.
- Escritura: `POST /api/tender-go-no-go-decision` con `{opportunity_id, decision, analysis_run_id, justification}`; autorización de servidor por `ACTIONS.LICITACIONES_GO_NO_GO_APPROVE`.
- Autor y fecha: los pone el servidor. La actualización optimista del cliente (`TenderGoNoGoDecisionPanel.tsx:190-203`) se conserva tal cual, incluida la reconciliación con `Reintentar actualización`.
- El historial completo (`payload.history`) alimenta el drawer `Historial de decisiones`.

### 8.3 Lo que NO se persiste

El eje seleccionado, el estado por eje, el estado global, la síntesis y la acción primaria son **derivación pura**: no se guardan, no se cachean en servidor y no se versionan. Cambiar la regla de derivación no requiere reescribir historial y no puede alterar una decisión ya registrada.

### 8.4 Backend que este diseño NO inventa

Se declara explícitamente que **no existen hoy** y **no se crean aquí**: tabla o columna de ejes; endpoint de estado de eje; persistencia de la selección; `decision_review` para oportunidades distintas del par piloto; y cualquier «mesa de ayuda» como servicio propio —`Mesa de ayuda` es únicamente el **rótulo visible** de la superficie post-GO ya existente (`TenderOfferPreparationPanel` + `TenderDossierWorkspacePanel`, ancla `#tender-preparation`).

---

## 9. Estados de error, cobertura parcial y ausencia de datos

| # | Situación | Detección | Presentación |
|---|---|---|---|
| E1 | Error al cargar el expediente | excepción de `GET /api/tender-documents` | Región A en `error de expediente`, banner `role="alert"` con el mensaje real y `Reintentar`. Regiones B/C/D no muestran cifras: los cinco ejes se rotulan `No evaluado` con la nota `No fue posible cargar el expediente.` |
| E2 | Sin documentos vigentes | `documents.length === 0` | HOLD H1. Estado global `Expediente incompleto`. Acción primaria `Completar expediente`. Texto exacto ya vigente: `Actualice o cargue documentos antes de analizar con Vig-IA Licitaciones.` |
| E3 | Documentos sin análisis | `analysis === null` | HOLD H2. `Hay documentos vigentes, pero todavía no existe una conclusión preliminar para revisar.` La acción secundaria `Analizar con Vig-IA Licitaciones` vive en el drawer de documentos, sujeta a `ACTIONS.AI_ANALYSIS_RUN`. |
| E4 | Análisis fallido | `analysis.status === 'failed'` | HOLD H3. Banner `role="alert"`: `Análisis fallido. El último intento no produjo una conclusión utilizable. Puede intentarlo nuevamente sin afectar la decisión humana.` Los ejes se muestran en `No evaluado`; no se reutiliza contenido de la corrida fallida. |
| E5 | Análisis obsoleto | `analysis.current === false` | HOLD H4. Banner `role="status"`: `Análisis desactualizado. El contenido histórico se conserva para trazabilidad, pero los documentos vigentes cambiaron.` Los ejes **sí** se muestran con su contenido, marcados con el sello `Basado en un análisis desactualizado` en el encabezado de la región C, y el estado global es `Expediente incompleto`. Se conserva la lectura porque borrarla destruiría trazabilidad, y se marca porque afirmarla como vigente sería falso. |
| E6 | Procesamiento en curso | `deriveTenderProcessingPresentation(...).visible` | HOLD H5. Banner con el mensaje real de la presentación derivada y, si aplica, `Reintentar`. La acción primaria es `Completar expediente`. |
| E7 | V3 presente sin `decision_review` | `integral_analysis.analysis_units.length > 0 && !decision_review` | Los cinco ejes en `No evaluado`. Texto exacto de `tenderBriefUnavailableCopy()`: título `Clasificación ejecutiva no disponible`, cuerpo `No existe una revisión de materialidad para este expediente. Que no haya clasificación ejecutiva no significa que se hayan buscado impedimentos y no se hayan encontrado.`, nota `No hay clasificación ejecutiva de impedimentos. No se afirma que no existan.` El drawer `Trazabilidad técnica` sí muestra las unidades V3. Estado global `Sin evidencia suficiente`. |
| E8 | Ni V3 ni `decision_review` (corrida heredada) | ambos ausentes | Los cinco ejes en `No evaluado` con la misma copia de E7, y se monta el drawer `Lectura preliminar del análisis` con `TenderAnalysisSection variant="drawer"` para no perder la lectura histórica. |
| E9 | Cobertura parcial declarada | `integral_analysis.coverage.material_omissions === true` o `manifest_unresolved_entries.length > 0` | Línea permanente en la región D: `Cobertura incompleta: N requisito(s) del manifiesto sin evidencia suficiente.` con enlace al drawer de trazabilidad, donde ya se listan por identidad. Cumple la política de `docs/architecture/agt002-human-review-policy.md` §3: una vista filtrada debe declarar cuántas preguntas quedan fuera y por qué criterio. |
| E10 | Hallazgo sin eje resoluble | §6.2 caso 3 | Nunca se descarta ni se asigna por aproximación. Va al drawer `Auditoría y descartados` con su subgrupo, y si es `decision_question`/`blocker` degrada el estado global (regla G3). |
| E11 | Copia gobernada incompleta | falta uno de los bloques de §5.3 | El bloque muestra `Sin lectura gobernada para este punto.` y el requisito queda `Por confirmar`. Prohibido degradar a `rationale`/`label`. |
| E12 | Error al guardar una validación | excepción del POST | Error `role="alert"` dentro del formulario, con el mensaje real; el formulario conserva lo escrito y los archivos seleccionados. No se marca la validación como registrada. |
| E13 | Adjunto rechazado | validación de cliente o de servidor | Mensaje exacto ya vigente (`tipo permitido` / `supera 25 MiB` / `máximo 8 archivos`). Ningún adjunto rechazado se cuenta como evidencia. |
| E14 | Error al cargar la decisión | excepción del GET | Región D muestra el error, oculta el conteo de decisión y **mantiene habilitados** los controles GO/NO GO para la persona autorizada, con el aviso `No fue posible leer la decisión vigente.` |
| E15 | Decisión anterior al análisis vigente | `decision.decided_at < analysis.completed_at` | Aviso `role="status"` en región D: `La decisión registrada es anterior al análisis vigente.` Sin invalidar la decisión ni bloquear nada. |
| E16 | Sin permiso de decisión | `canApproveTenderGoNoGo === false` | Texto de solo lectura ya vigente. La superficie se lee completa; la acción primaria nunca es `Registrar decisión` para ese perfil: se degrada al siguiente caso aplicable de §6.5. |

---

## 10. Accesibilidad y responsive

### 10.1 Estructura semántica

- La superficie es un `<section aria-labelledby="tender-decision-surface-title">` con `<h2 id="tender-decision-surface-title">Análisis para decidir</h2>`.
- Región A: `<header>`. Región B: `<nav aria-label="Ejes de decisión">` con `<ul>`/`<li>`/`<button>`. Región C: `<section id="tender-decision-axis-panel" tabIndex={-1} aria-labelledby="tender-decision-axis-title">`. Región D: `<footer aria-label="Decisión humana">`.
- Jerarquía de encabezados sin saltos: `h2` (superficie) → `h3` (pregunta del eje en región C, y rótulo de región D) → `h4` (cada requisito).

### 10.2 Patrón ARIA de la lista de ejes (decisión cerrada)

Se usa **un solo patrón** en escritorio y móvil: botones con `aria-expanded` + `aria-controls`, más `aria-current="true"` en el eje seleccionado. **No** se usa `tablist`/`tab`/`tabpanel`.

Razón: `tabpanel` no puede vivir dentro de `tablist`, y el layout móvil exige que el panel se renderice inmediatamente después del botón del eje seleccionado, dentro del mismo `<li>`. Cambiar de patrón ARIA según el ancho produce roles inconsistentes entre *breakpoints* y rompe lectores de pantalla en rotación. Un único patrón de divulgación funciona idéntico en ambos.

- Los cinco botones son tabulables (sin `roving tabindex`), de modo que `Tab` recorre los cinco ejes.
- `ArrowDown`/`ArrowUp` mueven el foco entre ejes con envolvimiento; `Home`/`End` van al primero/último.
- `Enter`/`Espacio` seleccionan. La selección mueve el foco al contenedor de la región C (`tabIndex={-1}`), replicando el patrón ya probado de `focusTenderDetailSection`.
- El estado de cada eje se anuncia en el nombre accesible del botón: `Eje 1 de 5. ¿Podemos participar legalmente? Estado: Por confirmar. 2 requisitos.` La píldora visual lleva `aria-hidden="true"` para no duplicar.

### 10.3 Anuncios en vivo

- El conteo de estados de la región D vive en un contenedor `role="status" aria-live="polite" aria-atomic="true"`, para que registrar una validación anuncie el nuevo balance sin robar el foco.
- Los banners de error usan `role="alert"`; los informativos `role="status"`. Es la convención ya vigente en todo el módulo.
- El modal GO/NO GO conserva `role="dialog" aria-modal="true"`, foco inicial en el título, trampa de foco con `Tab`/`Shift+Tab`, cierre con `Escape` y restauración de foco al disparador. Se conserva el endurecimiento ya aplicado: si el disparador desapareció, no se fuerza foco a un nodo desconectado.

### 10.4 Contraste, tamaño y movimiento

- Todas las píldoras de estado cumplen contraste ≥ 4.5:1 sobre su fondo, y el estado **nunca** se comunica sólo por color: cada píldora lleva su texto (`Favorable con evidencia`, `Impedimento material`, `Por confirmar`, `No evaluado`) y un glifo distinto (`●`, `■`, `▲`, `○`) marcado `aria-hidden`.
- Objetivos táctiles ≥ 44×44 px en móvil.
- El desplazamiento suave respeta `prefers-reduced-motion: reduce` degradando a `behavior: 'auto'`.
- Foco visible en los cinco botones de eje, en los controles de validación y en los dos botones de decisión, con indicador de 2 px y contraste ≥ 3:1.

### 10.5 Enlaces profundos y anclas

- `#/oportunidad/<id>?section=tender-analysis&eje=<clave>` selecciona el eje al montar.
- Un ancla histórica `#tender-condition-N` (`tenderDecisionConditionAnchorMap`) se resuelve así: se busca el hallazgo dueño del ancla, se selecciona su eje, se renderiza la región C y se enfoca el requisito. Sin coincidencia, se selecciona el primer eje y se anuncia `La condición enlazada ya no existe en el análisis vigente.` Se reutiliza el mapa existente; no se crea un segundo esquema de anclas.
- El enlace `Ver condición principal` de la vista V3 (`TenderIntegralAnalysisV3View.tsx:97`) sigue funcionando por la misma vía.

### 10.6 Objetivos verificables de accesibilidad

`axe` sin violaciones en escritorio (1440×900) y móvil (375×844), con la superficie en los estados: sin análisis, con análisis vigente, con impedimento, con validación registrada, con GO registrado, con NO GO registrado.

---

## 11. Estrategia TDD y criterios de aceptación

### 11.1 Regla de trabajo

TDD estricto: cada comportamiento entra por una prueba que falla primero (RED), se implementa al mínimo (GREEN) y sólo entonces se refactoriza. Las pruebas de UI se ejecutan sobre el **HTML realmente renderizado** por el componente TSX real usando el arnés ya existente `tests/helpers/bundle-react-component.mjs` (`loadReactComponent` + `renderReactComponent`), nunca sobre el texto fuente. Las aserciones sobre el fuente se reservan para prohibiciones de montaje (p. ej. «este componente ya no se importa»).

### 11.2 Ficheros de prueba nuevos

| Fichero | Cubre |
|---|---|
| `tests/tender-decision-axes.test.mjs` | selectores puros de §7.2: mapa 7→5, precedencia de estados, invariantes de conteo, fail-closed, acción primaria |
| `tests/tender-decision-surface-render.test.mjs` | render real de regiones A–D, cinco bloques por requisito, prohibición de `id`/`label`/`rationale` visibles |
| `tests/tender-decision-surface-states.test.mjs` | los dieciséis estados E1–E16 de §9 |
| `tests/tender-decision-surface-a11y.test.mjs` | roles, `aria-*`, jerarquía de encabezados, nombres accesibles, ausencia de `tablist` |
| `tests/tender-decision-surface-responsive.test.mjs` | contrato CSS de §4.2 R3/R4 sobre `src/styles.css` |
| `tests/tender-decision-surface-flag.test.mjs` | bandera apagada ⇒ superficie ausente y UI actual intacta; encendida ⇒ superficie presente |
| `tests/agt002-decision-axis-contract.test.mjs` | extensión aditiva de §7.3: `@1` sigue validando; `@2` exige los campos nuevos; nomenclatura técnica sigue rechazada |

### 11.3 Ficheros de prueba existentes que se amplían

- `tests/tender-detail-navigation-state.test.mjs` — nueva lista de cuatro destinos e indicador de la superficie.
- `tests/tender-detail-layout-order.test.mjs` — orden de secciones tras la fusión.
- `tests/tender-decision-front-render.test.mjs` — se conserva íntegro mientras la bandera esté apagada; se amplía con el caso de bandera encendida. **No se relaja ninguna aserción existente.**
- `tests/agt002-analysis-config.test.mjs` — la bandera nueva por defecto en `false` y sin dependencias cruzadas.
- `tests/tender-question-responses.test.mjs` — persistencia sin cambios de contrato desde la superficie nueva.

### 11.4 Criterios de aceptación verificables

| ID | Criterio | Verificación |
|---|---|---|
| AC-1 | La superficie renderiza exactamente cinco ejes, en el orden 1→5, siempre | contar `[data-axis-order]` en el HTML renderizado === 5 y comparar la secuencia |
| AC-2 | `favorable + impediment + pending + unevaluated === 5` en todos los escenarios de prueba | aserción sobre `counts` en ≥ 12 fixtures |
| AC-3 | Un eje sin hallazgos asignados es `No evaluado` y nunca `Favorable con evidencia` | fixture con `decision_review` vacío |
| AC-4 | Las siete categorías materiales mapean a un eje y sólo uno | iterar `AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES` y exigir cobertura 7/7 sin duplicado de destino inesperado |
| AC-5 | Ninguna de las ocho categorías ordinarias produce estado de eje | fixture con `preparation` en las ocho categorías ⇒ los cinco ejes `No evaluado` |
| AC-6 | `finding.id`, `finding.label` y `finding.rationale` nunca aparecen en el HTML | fixture con centinelas `ETIQUETA-INTERNA-*` / `RATIONALE-INTERNO-*` |
| AC-7 | Un `blocker` fuerza `Impedimento material` en su eje y `Impedimento material detectado` global | fixture con un `blocker` categorizado |
| AC-8 | Una respuesta `resolved` más reciente mueve el eje de `Por confirmar` a `Favorable con evidencia`; una `not_applicable` lo deja en `No evaluado` si no hay otro aporte | dos respuestas con `responded_at` distintos |
| AC-9 | GO y NO GO están habilitados con pendientes e impedimentos, para perfil autorizado | render con impedimento ⇒ ningún `disabled` en los dos botones |
| AC-10 | Durante HOLD la acción primaria no es `Registrar decisión` | cuatro fixtures H1–H4 |
| AC-11 | Con GO registrado la acción primaria es `Abrir Mesa de ayuda`; con NO GO, `Cerrar con registro auditable` | dos fixtures |
| AC-12 | Existe exactamente **una** acción primaria en el HTML | contar `[data-primary-action]` === 1 en los diez escenarios |
| AC-13 | Sin `decision_review` se emite el texto exacto de `tenderBriefUnavailableCopy()` y ningún eje favorable | fixture V3 sin revisión |
| AC-14 | A 375 px la píldora de estado no se recorta | prueba de contrato CSS: `flex-direction: column`, `align-items: stretch`, `width: 100%`, `min-width: 0` con especificidad suficiente |
| AC-15 | `axe` sin violaciones en escritorio y móvil, en los seis estados de §10.6 | QA autenticada con navegador real |
| AC-16 | La lista de ejes no usa `role="tablist"` ni `role="tab"` | aserción negativa sobre el HTML |
| AC-17 | Con la bandera apagada, el HTML del detalle es idéntico al actual | comparación de render con y sin bandera |
| AC-18 | Registrar una validación no envía autor ni fecha desde el cliente | inspección del cuerpo de la petición en doble de prueba |
| AC-19 | Un ancla `#tender-condition-N` selecciona el eje dueño y enfoca el requisito | prueba del resolutor de anclas |
| AC-20 | Un hallazgo sin eje resoluble aparece en auditoría y degrada el estado global, sin desaparecer | fixture con `decision_question` sin categoría |

### 11.5 Compuertas técnicas obligatorias antes de considerar terminado

1. Suite focal nueva y ampliada en verde.
2. `node --test --test-force-exit tests/*.test.mjs` sin regresión respecto de la línea base registrada en `CURRENT.md` §12.3 (**812 total, 811 PASS, 0 FAIL, 1 SKIP**).
3. `npx tsc --noEmit` con salida 0.
4. `npx vite build` con salida 0.
5. `npm run check:backend-parity` con salida 0.
6. `git diff --check` con salida 0.
7. QA visual autenticada en escritorio y móvil con capturas, bajo las reglas de sesión vigentes de `CURRENT.md` §11.10 (sin crear usuarios, sin *service-role*, sin suplantación, `storageState` temporal fuera del repositorio con `chmod 0600` y borrado al terminar).
8. Revisión independiente sin Critical ni Important.

---

## 12. Migración segura y compatibilidad histórica

### 12.1 Secuencia de migración (siete pasos, cada uno reversible por sí solo)

| Paso | Contenido | Reversión |
|---|---|---|
| M1 | Bandera `TENDER_DECISION_SURFACE_V1` + campo `decision_surface` en el payload, en `server/index.js` y `api/[...path].js` idénticos | quitar la bandera; el campo desaparece del payload |
| M2 | `src/tenders/tenderDecisionAxes.ts` con pruebas puras. No se monta en ninguna vista | borrar fichero y prueba |
| M3 | `TenderDecisionSurface` + `TenderDecisionAxisPanel`, montados **sólo** si `decision_surface.enabled === true` | apagar bandera |
| M4 | Traslado de drawers: documentos, trazabilidad técnica, historial, evidencia | apagar bandera |
| M5 | Reducción de la navegación a cuatro destinos y renombrado de `Preparación` a `Mesa de ayuda`, **condicionados a la bandera** | apagar bandera |
| M6 | Retiro de `TenderDecisionBrief` y del puntero divergente del panel GO/NO GO, tras dos semanas de bandera encendida sin incidencias | revertir el commit de retiro |
| M7 | Extensión aditiva del contrato `@2` y curación de artefactos por proceso | los artefactos `@1` siguen válidos; no hay reversión de datos que hacer |

M1–M5 no borran nada. M6 es el único paso destructivo y va después de la evidencia de uso.

### 12.2 Navegación resultante

`TENDER_DETAIL_SECTIONS` (`src/tenders/detailNavigationState.ts:40-51`) pasa de seis a cuatro entradas cuando la bandera está encendida:

| `id` | Etiqueta | Etiqueta accesible |
|---|---|---|
| `tender-summary` | Resumen | Resumen de la oportunidad |
| `tender-analysis` | Análisis para decidir | Análisis y decisión de la licitación |
| `tender-preparation` | Mesa de ayuda | Mesa de ayuda y preparación de la oferta |
| `tender-follow-up` | Seguimiento | Seguimiento comercial |

Decisiones de compatibilidad:

- Se conserva el `id` `tender-analysis` como raíz de la superficie, porque es el destino de anclas históricas (`#tender-analysis`).
- Se conservan como anclas internas, no como destinos de navegación: `tender-document-review`, `tender-decision`, `tender-go-no-go-actions`, `tender-technical-analysis` y todos los `tender-condition-N`.
- Se conserva `tender-preparation` como `id`; sólo cambia el rótulo visible a `Mesa de ayuda`. Esto mantiene intacto `scrollToPreparation` (`TenderGoNoGoDecisionPanel.tsx:116-121`) y el salto automático tras un GO.
- `resolveTenderDetailIndicators` gana el indicador combinado de la superficie: `error` si E1/E4; `attention` si HOLD o `Pendientes por confirmar` o `Impedimento material detectado`; `ready` si `Base suficiente para decidir` o decisión registrada; `unknown` en el resto. El indicador documental se pliega dentro de éste.

### 12.3 Compatibilidad histórica

1. **Ningún dato histórico se reescribe.** No hay migración de base de datos, ni *backfill*, ni reescritura de corridas, ni de respuestas, ni de decisiones.
2. **Las decisiones ya registradas se leen exactamente igual.** `TenderGoNoGoDecisionSummary` y el historial no cambian de contrato.
3. **Las respuestas ya registradas siguen resolviéndose** por `question_id === finding.id`, con la misma regla de «más reciente por `responded_at`».
4. **Las corridas heredadas sin V3** conservan su lectura mediante el drawer `Lectura preliminar del análisis` (E8).
5. **Las corridas con V3 sin `decision_review`** —es decir, todas las oportunidades salvo el par piloto— muestran ejes en `No evaluado` con la copia honesta de E7 y su respaldo técnico completo en el drawer. No se degrada ninguna capacidad existente: hoy esas oportunidades tampoco tienen lectura por condiciones.
6. **Anclas y enlaces profundos antiguos siguen funcionando** (§10.5, §12.2).
7. **`CURRENT.md` no se modifica** por este diseño.

---

## 13. Rollout y rollback

### 13.1 Bandera

- Nombre: `TENDER_DECISION_SURFACE_V1`.
- Valor por defecto: **apagado**. Sólo `'true'` o `'1'` la encienden (`agt002-analysis-config.js:15-20`).
- Sin dependencias con otras banderas: la superficie debe poder encenderse en un entorno sin V3 y comportarse correctamente (todos los ejes `No evaluado`).
- Ámbito: servidor. El cliente no la lee de su propio entorno; la recibe en el payload. Así no puede quedar desincronizada entre *build* y *runtime*.

### 13.2 Secuencia de despliegue

1. **Fase 0 — apagada en todos los entornos.** Se despliega el código con la bandera apagada. Criterio de salida: AC-17 verde en producción (el detalle renderiza idéntico) y suite completa sin regresión.
2. **Fase 1 — local autenticada.** Encendida sólo en el entorno local con sesión humana autorizada. QA de escritorio y móvil, `axe`, capturas de los seis estados. Criterio de salida: AC-1..AC-20 verdes y revisión independiente sin Critical/Important.
3. **Fase 2 — canary sobre el par piloto.** Encendida en producción, verificada primero sobre la oportunidad Manizales `54190e51-15fb-46af-b0aa-8f13461a3110` / corrida `7553a51f-e4ca-4ad4-bde8-02528063d178`, que es la única con `decision_review`. Observación durante 48 h: errores de consola, fallos de petición, escrituras inesperadas. Criterio de salida: cero errores nuevos y cero escrituras no solicitadas.
4. **Fase 3 — general.** Encendida para todas las oportunidades de licitación. Se comunica explícitamente que fuera del piloto los ejes aparecerán `No evaluado` hasta que exista revisión gobernada por proceso, para que nadie lea la falta de clasificación como ausencia de impedimentos.
5. **Fase 4 — limpieza.** Paso M6 (retiro de `TenderDecisionBrief` y del puntero divergente) sólo tras dos semanas estables en Fase 3.

Cada fase requiere autorización expresa y separada. Ninguna se ejecuta como parte de este diseño.

### 13.3 Rollback

- **Mecanismo primario:** apagar `TENDER_DECISION_SURFACE_V1`. Es un cambio de variable de entorno, sin redespliegue de código y sin tocar datos.
- **Tiempo objetivo de reversión:** el de propagar la variable y reiniciar el proceso servidor.
- **Efecto sobre datos:** ninguno. Las validaciones registradas, los adjuntos y las decisiones GO/NO GO permanecen intactos y siguen visibles en la UI anterior, porque comparten contrato y endpoints.
- **Efecto sobre historial:** ninguno. El diseño no escribe en `psi_sales_interactions`, ni en las tablas de respuestas, ni en las de decisiones, más allá de lo que ya escribían los formularios existentes.
- **Rollback secundario** (si el fallo estuviera en M1, es decir en el payload): revertir el commit de M1 en `server/index.js` y `api/[...path].js` a la vez, y volver a correr `npm run check:backend-parity`.
- **Rollback de despliegue** (si fuera necesario): se conserva el procedimiento vigente de `CURRENT.md` §13.1, que identifica un *deployment* de reversión antes de publicar.

### 13.4 Observabilidad mínima durante el rollout

Se reutiliza lo que ya existe: registros `console.warn` del servidor con evento nombrado (patrón `agt002_*_failed`), el informe de QA autenticada y el conteo de escrituras bloqueadas. No se añade telemetría de producto nueva ni se envía nada a servicios externos.

---

## 14. Decisiones cerradas y no-decisiones

### 14.1 Decisiones cerradas

| # | Decisión |
|---|---|
| D1 | Existe **una sola** superficie decisoria, titulada `Análisis para decidir`. |
| D2 | Se eliminan como vistas o bloques protagonistas: brief, análisis paralelo, decisión paralela, respaldo técnico histórico, categorías y conteos V3, lista genérica de condiciones, múltiples tarjetas por hallazgo y traza cruda. |
| D3 | Los cinco ejes son fijos, siempre visibles, siempre en orden 1→5, y son ejes de **presentación**, no el límite del análisis. |
| D4 | Los cuatro estados por eje son exactamente `Favorable con evidencia`, `Impedimento material`, `Por confirmar`, `No evaluado`. |
| D5 | La ausencia de señal nunca es favorable (fail-closed). |
| D6 | El eje 5 pregunta **viabilidad económica**. No se añade `comercialmente conveniente`. |
| D7 | La asignación requisito→eje es por enumerado gobernado (`decision_axis`, o `material_impediment_category` vía el mapa cerrado 7→5). Nunca por texto. |
| D8 | Un hallazgo sin eje resoluble no se descarta ni se aproxima: va a auditoría y degrada el estado global si es `decision_question`/`blocker`. |
| D9 | La política material vigente se conserva íntegra: las ocho categorías ordinarias son preparación post-GO y no escalan, salvo reclasificación humana a `imposibilidad_tecnica_grave`. |
| D10 | GO/NO GO permanece disponible para la persona autorizada aun con pendientes, con advertencia y sin bloqueo artificial. |
| D11 | Durante HOLD, GO/NO GO no es la acción primaria; en móvil vive dentro de un drawer. |
| D12 | Hay **exactamente una** acción primaria en toda la superficie, resuelta por la tabla total de §6.5. |
| D13 | Después de GO, la continuación es `Mesa de ayuda`, que es el rótulo visible de la superficie post-GO ya existente, con el `id` `tender-preparation` conservado. |
| D14 | Documentos, historial, evidencia y trazabilidad técnica pasan a drawers dentro de la misma superficie; ninguno vuelve a ser vista decisoria. |
| D15 | El estado por eje, el estado global, la síntesis y la acción primaria son derivación pura y **no** se persisten. |
| D16 | No se crean tablas, columnas, endpoints ni RPC. El único cambio de backend es la bandera y un campo booleano en el payload de documentos, replicado byte a byte en los dos ficheros de backend. |
| D17 | La extensión del contrato de presentación es aditiva: opcional en `@1`, obligatoria en `@2`, con las mismas guardas anti-nomenclatura técnica. |
| D18 | La lista de ejes usa un único patrón ARIA de divulgación (`aria-expanded`/`aria-controls`/`aria-current`) en escritorio y móvil. No se usan `tablist`/`tab`/`tabpanel`. |
| D19 | La navegación del expediente pasa a cuatro destinos; todos los `id` retirados sobreviven como anclas internas. |
| D20 | La bandera nace apagada, el rollback es apagarla, y ninguna fase de rollout se ejecuta sin autorización expresa y separada. |
| D21 | `TenderAnalysisSection` sobrevive en modo drawer para corridas heredadas; no se pierde lectura histórica. |
| D22 | Este diseño no toca `CURRENT.md`, ni el radar, ni el preanálisis temprano de §14. |

### 14.2 No-decisiones (fuera de la autoridad de este diseño, con dueño y momento)

| # | Asunto | Quién decide | Cuándo | Por qué no se decide aquí |
|---|---|---|---|---|
| N1 | Producir `decision_review` para procesos distintos del piloto | Gobernanza AGT-002, vía el gate de onboarding de proceso | antes de aplicar la superficie a un proceso nuevo | Es curación humana de un artefacto versionado, no código de UI. El diseño ya se comporta correctamente sin él (E7). |
| N2 | Emitir el contrato `@2` y curar `decision_axis` por proceso | Gobernanza AGT-002 con la persona responsable de Licitaciones | tras la Fase 2 del rollout | Requiere criterio jurídico y comercial por licitación; forzarlo desde la UI convertiría requisitos de un caso en lista universal. |
| N3 | Si el eje 5 debe alimentarse de datos financieros del CRM además del pliego | Dirección de Licitaciones | al definir `@2` | Hoy no existe fuente gobernada de viabilidad económica en el contrato; inventarla sería afirmar sin evidencia. |
| N4 | Umbrales de alerta por proximidad de cierre en el eje 4 | Dirección de Licitaciones | al definir `@2` | El eje 4 hoy se sustenta en la categoría `plazo_objetivamente_imposible`, que es binaria; un umbral por días es política comercial. |
| N5 | Si `Mesa de ayuda` debe absorber también el *workbench* de Vig-IA | Producto SIIO | fase posterior | Fuera del frente decisional; tocarlo ampliaría el alcance sin necesidad. |
| N6 | Mecanismo seguro de sesión para QA autenticada local | Juan | antes de la Fase 1 | Sigue siendo el bloqueo operativo registrado en `CURRENT.md` §10.10 y §11.10; no se resuelve con diseño. |
| N7 | Autorización de commit, push, merge, migración, despliegue o reinicio | Juan | orden expresa y separada | Gates cerrados por política vigente. |

Ninguna no-decisión bloquea la implementación de este diseño: las siete tienen comportamiento definido y seguro mientras no se resuelvan.

---

## 15. Registro de la auto-revisión

Revisión final del documento contra sus propias reglas, con los ajustes que produjo:

1. **Contradicción entre «superficie única» y la sección Documentos.** Una versión intermedia dejaba `Documentos` como destino de navegación mientras afirmaba superficie única. Resuelto: `Documentos` pasa a drawer (§5.4, §12.2) y el `id` sobrevive como ancla.
2. **Doble patrón ARIA entre escritorio y móvil.** Una versión usaba `tablist` en escritorio y acordeón en móvil, lo que rompe roles al rotar el dispositivo. Resuelto con un patrón único de divulgación y su justificación explícita (§10.2, D18, AC-16).
3. **Supuesto no demostrado sobre la cobertura de `decision_review`.** Se verificó en `tender-analysis-foundation.js:315-341` que sólo existe para un par oportunidad/corrida fijo. Se añadió §3.3 con el estado real hoy y se corrigieron §2.2, E7 y la Fase 3 del rollout para no prometer cobertura general.
4. **Ejes 2–5 sin fuente de datos.** El contrato actual no permite asignar `supported`/`preparation` a un eje. En vez de inventar una heurística, se explicitó la extensión aditiva `decision_axis` (§7.3) y se aceptó que hoy esos ejes queden `No evaluado`, que es la lectura honesta.
5. **`blocker` sin categoría material.** El validador vigente prohíbe `material_impediment_category` fuera de `decision_question`. Se documentó como caso `Sin eje resoluble` en `@1` (§6.2) y como requisito en `@2` (§7.3 regla 4), en vez de asumir que siempre habrá categoría.
6. **Vigencia y aplicabilidad sin origen.** Se eliminó una redacción que las presentaba como texto libre y se ancló a `evidence_state.validity` / `.applicability` traducidos por el diccionario cerrado existente, con omisión explícita cuando no hay unidad V3 correspondiente (§7.3 regla 6).
7. **Cita del pliego mediante análisis de cadenas.** Se descartó formatear `SA-24-2026#2.1#i11` como `numeral 2.1 · ítem i11`, porque implicaría heurística de texto sobre un identificador, prohibido por P7. Resuelto: el chip usa `resolveFindingEvidence` tal cual y el desplazamiento vive en el drawer.
8. **`Impedimento material` dentro de HOLD.** Una versión lo incluía, lo que dejaba sin acción primaria coherente el caso «impedimento confirmado, hay base para decidir NO GO». Resuelto: HOLD se limita a expediente/análisis no utilizable (H1–H5) y el impedimento lleva a `Registrar decisión` (§6.5).
9. **Conteos divergentes heredados.** Se verificó que el puntero `Revisar pendientes en Análisis (N)` suma `blockers` bajo rótulo de condiciones (`CURRENT.md` §11.8). Se decidió retirarlo en M6 y sustituirlo por el conteo único e invariante de región D (AC-2).
10. **Riesgo de perder la lectura de expedientes históricos.** El retiro completo de `TenderAnalysisSection` habría dejado sin lectura las corridas `siio_rules_v1`. Resuelto con `variant="drawer"` y valor por defecto que preserva el comportamiento actual (§7.5, D21, E8).
11. **Paridad de backend.** Se verificó que `scripts/check_backend_parity.mjs` compara los ficheros completos byte a byte; se añadió la exigencia explícita de aplicar M1 idéntico en ambos (§7.4, M1).
12. **Vaguedades eliminadas.** Se sustituyeron formulaciones como «se muestra un aviso» o «se prioriza lo importante» por tablas de precedencia estricta y totales (§6.3, §6.4, §6.5) y por textos exactos ya vigentes en el producto (§9).
13. **Ausencia de TBD.** Revisión textual: el documento no contiene `TBD`, `TODO`, `pendiente de definir`, `por definir` ni marcadores de relleno. Lo no decidido está en §14.2 con dueño, momento, razón y comportamiento seguro entretanto.
14. **Trazabilidad de afirmaciones.** Toda ruta, número de línea, nombre de símbolo, literal de interfaz y catálogo citado en este documento fue leído directamente en el repositorio durante la redacción.
