# Vig-IA: seguimiento de oportunidad en una sola acción — diseño

**Fecha:** 2026-08-31
**Estado:** Aprobado por producto (Juan) — simplificación del panel Vig-IA dentro de una oportunidad no licitatoria: se retira el preanálisis visible y su casilla de reconocimiento; queda un único botón que genera la propuesta directamente. Las alertas comerciales deterministas se mantienen sin cambios de comportamiento.
**Alcance:** sólo frontend (`src/vigia/VigiaOpportunityCopilot.tsx`, `src/vigia/copilot-presentation.ts`, `src/vigia/opportunity-preflight-presentation.ts`, `src/vigia/opportunity-preflight-state.ts` — se borra —, CSS en `src/styles.css`, pruebas). **No** se toca ningún endpoint, módulo de backend, migración de base de datos ni el manifiesto de contratos AGT-002/AGT-003.
**Rama:** `design/vigia-single-action-followup-20260831`
**Sustituye:** las secciones de flujo de frontend activo de `docs/superpowers/specs/2026-08-26-agt003-preflight-alerts-design.md` (ver «Sustitución del diseño anterior»).

## Problema

El panel `VigiaOpportunityCopilot` (`src/vigia/VigiaOpportunityCopilot.tsx:113-230`) implementa hoy un flujo híbrido de cuatro pasos: alertas comerciales deterministas → botón «Analizar cómo fortalecer el seguimiento» (preanálisis con IA) → casilla de reconocimiento cuando el preanálisis está ausente o falló → botón «Generar propuesta con el contexto actual». QA en producción (Juan) reporta que el preanálisis falla con frecuencia, y que cuando sí funciona, su resultado (`standaloneActions`, `contextualAction` bajo cada alerta) repite en prosa más larga el mismo tipo de señal que las alertas deterministas ya muestran de forma inmediata y gratuita — el mismo problema de duplicación que la spec anterior (2026-08-26) ya había identificado entre `strategy`/`missing_information`/`warnings` dentro de la propuesta generada, ahora reaparecido entre la etapa 1 (alertas) y la etapa 2 (preanálisis).

El costo de mantener la etapa 2 visible no es sólo cosmético: cada apertura del panel invita al comercial a esperar una llamada real a Vig-IA (`POST /api/vigia/copilot/preflight`) que con frecuencia falla, exige una casilla explícita para poder continuar sin ella, y —cuando tiene éxito— rara vez aporta una acción que el comercial no pudiera inferir ya de la alerta determinista correspondiente. El flujo actual antepone una etapa de valor marginal y fallo frecuente a la única acción que el comercial realmente necesita: generar el borrador de seguimiento.

## Evidencia

1. **Independencia de contrato entre preflight y generate.** `POST /api/vigia/copilot/preflight` y `POST /api/vigia/copilot/generate` son llamadas HTTP independientes (`src/vigia/VigiaOpportunityCopilot.tsx:147-167` y `:174-183`): ninguna pasa su resultado a la otra. `generate` reconstruye su propio contexto fresco (`loadAgt003OpportunityContext`, según `docs/superpowers/specs/2026-08-26-agt003-preflight-alerts-design.md:182`) de forma completamente independiente de si `/preflight` se ejecutó, tuvo éxito o falló. No existe ningún campo de la respuesta de `/preflight` que `generate` lea, ni ningún estado de React que un `generate` posterior consulte del resultado de `runPreflight` (`preflightState` y `state` — el de generación — son dos reducers separados, `opportunity-preflight-state.ts` y `opportunity-copilot-state.ts`, sin ningún acoplamiento entre sí más allá de habilitar/deshabilitar el botón). Ejecutar `/preflight` de forma invisible antes de `generate` no cambiaría absolutamente nada del resultado de `generate`: sólo añadiría una llamada más a un puente que ya está bajo presión, con su propio costo de latencia, cuota diaria de proceso (`AGT003_PREFLIGHT_DAILY_MAX_RUNS`) y probabilidad de fallo — sin ningún beneficio, porque nadie consume su salida.
2. **Fallos frecuentes en producción.** Observación directa de QA (Juan): el botón «Analizar cómo fortalecer el seguimiento» falla con frecuencia notable en producción, mostrando el estado `error` de `VigiaPreflightAnalysis` (`VigiaOpportunityCopilot.tsx:84`) y forzando al comercial a decidir entre reintentar o marcar la casilla de reconocimiento para continuar sin él.
3. **Valor marginal cuando tiene éxito.** Cuando `/preflight` sí responde, su salida se fusiona con las alertas deterministas (`mergeCommercialAlertsWithPreflight`, `opportunity-preflight-presentation.ts:163-188`) y aparece como «Sugerencia contextual:» bajo la alerta correspondiente, o como ítem independiente en `standaloneActions`. En la práctica observada, esa sugerencia repite en prosa el mismo hecho que ya comunica el `risk_text` determinista de la alerta (p. ej. «decisor sin verificar» ya lo dice la alerta; la sugerencia contextual lo repite con más palabras), sin agregar una acción verdaderamente distinta.
4. **Autoridad de producto ya establecida.** La spec 2026-08-26 ya fijó que las alertas comerciales son «señales factuales de atención […], no instrucciones ni acciones a ejecutar» y que «una fecha vencida o faltante nunca impide continuar» (línea 22 de esa spec). Este diseño no cambia esa autoridad: la extiende retirando la capa que la duplicaba con menor fiabilidad.

## Objetivos

- Un único punto de entrada visible para generar el seguimiento: un botón, una llamada, un resultado.
- Conservar las alertas comerciales deterministas exactamente como están (mismo cálculo, mismo `risk_text`, mismo criterio de no bloqueo) porque no dependen de ningún modelo y no han mostrado el problema de fiabilidad del preanálisis.
- Reducir la latencia y la probabilidad de fallo percibidas por el comercial antes de obtener un borrador utilizable.
- Preservar la posibilidad de revertir a la ruta backend de preflight sin una migración ni una re-implementación, por si una futura iteración de producto decide reintroducir una etapa de preanálisis con otro diseño.
- Mantener sin cambios el contrato de `POST /api/vigia/copilot/generate` y la autoridad humana ya vigente (edición local, sin envío ni escritura automática de CRM).

## No objetivos

- No se decomisiona el backend de preflight (ruta, módulos, contrato del manifiesto) en este cambio — ver «Backend preservado» y «Fuera de alcance».
- No se cambia el proveedor, el modelo ni la política de `generate`.
- No se rediseña la tarjeta «Contacto decisor» ni el estilo exterior del CTA de la tarjeta de oportunidad.
- No se resuelve la inconsistencia entre `last_interaction_at` y el historial de interacciones (issue conocido, fuera de alcance).
- No se agregan permisos ni acciones nuevas a `access-control.js`.
- No se toca ninguna migración de base de datos.

## Decisión

1. **Las alertas comerciales deterministas se mantienen visibles y concisas, sin cambios de comportamiento.** Siguen siendo el resultado puro y sin red de `buildCommercialAlerts` (`opportunity-preflight-presentation.ts:115-121`) sobre `nextActionCardState`/`expectedCloseCardState`/`decisionMakerCardState`, ya calculados en `src/main.tsx:806-808`. Siguen siendo señales factuales de atención, nunca instrucciones ni bloqueos, y siguen sin ser un insumo de la condición que habilita generar.
2. **Se retira del flujo activo de frontend:** la sección visible «Análisis inteligente del seguimiento» (`VigiaPreflightAnalysis`), sus botones «Analizar cómo fortalecer el seguimiento» / «Actualizar análisis» / «Reintentar», las sugerencias contextuales fusionadas bajo cada alerta (`contextualAction`, «Sugerencia contextual:») y las sugerencias independientes (`standaloneActions`), la casilla de reconocimiento «Entiendo que no se ejecutó el análisis inteligente antes de generar», y toda dependencia de `canGenerate` sobre `preflightState.phase` o sobre la casilla.
3. **Se expone exactamente un control de generación por fase, nunca dos a la vez.** En `idle`, un único CTA primario «Preparar próximo seguimiento»; al pulsarlo, se llama directamente a `POST /api/vigia/copilot/generate` — sin ninguna llamada previa, visible o invisible, a `/preflight`. En `ready`, el mismo botón cambia su texto a «Actualizar borrador» para regenerar la propuesta con el contexto actual, y sigue siendo el único control de generación visible en ese estado (las acciones de salida «Copiar correo»/«Descartar» son acciones distintas, no controles de generación). En `error`, este botón deja de renderizarse por completo — ver punto 7 — para que nunca coexistan un CTA de preparación y un botón de reintento.
4. **No se invoca `/preflight` de forma silenciosa.** Por la evidencia del punto 1: como `generate` no consume su salida, ejecutarlo en segundo plano sólo añadiría latencia, costo de proveedor y una fuente más de fallo, sin ningún beneficio observable por el comercial. Se preserva la ruta backend autenticada, sus módulos y sus contratos tal como están, por compatibilidad y para permitir un rollback simple, pero ningún camino del frontend activo la llama. La eliminación completa del backend de preflight queda explícitamente diferida a una limpieza separada, después de un período de observación en producción sin uso desde la UI (ver «Fuera de alcance» y «Riesgos»).
5. **La presentación del éxito optimiza para lectura rápida y evita duplicar el mismo contenido en dos niveles de detalle a la vez:**
   - Una frase «Siguiente paso sugerido» (máximo 240 caracteres) — omitida si el adaptador se abstiene.
   - Como máximo dos viñetas cortas «Por qué» (máximo 180 caracteres cada una).
   - Debajo, el borrador editable (asunto/cuerpo) y la revisión humana existente, sin cambios.
   - La lista ordenada «Plan de contacto» (`contactPlanSteps`) deja de mostrarse como sección visible independiente del resultado — se retira para no repetir en detalle lo que «Siguiente paso sugerido»/«Por qué» ya resumen. Se mueve íntegra, sin resumir ni truncar, dentro de «Ver contexto analizado».
   - Los hechos/inferencias/adjuntos sugeridos y ahora también el plan de contacto completo quedan plegados bajo «Ver contexto analizado» (mismo patrón que hoy `<details className="vigia-copilot-context"><summary>Contexto analizado</summary>`, renombrado), disponible para trazabilidad opcional sin ocupar espacio en la lectura rápida.
   - Si no puede producirse una recomendación genuinamente distinta de lo que ya dicen las alertas, el adaptador se abstiene (ver «Criterio de abstención») en vez de parafrasear las alertas con otras palabras; en ese caso la superficie visible empieza directamente en el borrador editable, sin ningún bloque de resumen encima.
6. **El contrato de respuesta de `generate` no cambia en esta entrega.** Se define un adaptador de presentación puro que deriva y acota esta vista compacta a partir de `CopilotPresentationBrief`, sin mutar la salida persistida (`psi_agt003_copilot_runs` sigue grabando el `brief` completo sin cambios). Si al implementar se descubre que no puede garantizarse una calidad semántica aceptable (frase «Siguiente paso sugerido» genuinamente accionable, viñetas «Por qué» no redundantes) sin cambiar el contrato del proveedor (`brief.strategy`/`brief.facts`/prompt/policy), la implementación debe detenerse y volver a este documento de diseño en vez de expandir el alcance en silencio.
7. **Comportamiento ante fallo de `generate`:** el botón primario de preparación («Preparar próximo seguimiento») se oculta/reemplaza — no queda un botón de preparación reactivado junto a un botón de reintento — y en su lugar se muestra una única alerta compacta y no bloqueante, con superficie propia `.vigia-copilot-error` (no la clase genérica `.error` de ancho completo, ver «CSS»), con el mensaje fijo «No se pudo preparar el seguimiento. Puede continuar registrándolo manualmente.» y, dentro del mismo bloque, exactamente un control secundario «Reintentar». Las alertas comerciales deterministas permanecen visibles sin cambios. Sin casilla, sin barra roja de ancho completo que actúe como puerta, sin propuesta sintética o inventada como respaldo. El registro manual del seguimiento (edición de la oportunidad / interacciones, ya existente fuera de este panel) sigue disponible sin ninguna dependencia de este panel.
8. **Carga:** el mismo botón de preparación se deshabilita mientras `generate` está en curso, sin sustituirse por otro control — sigue siendo el único elemento de generación visible en esta fase —; un estado conciso lo comunica (mismo patrón `role="status"` ya usado); los dobles clics quedan prevenidos por la protección de secuencia de solicitud/estado que ya existe en `opportunity-copilot-state.ts` (`beginCopilotGeneration`/`requestSequenceRef`), sin necesidad de un mecanismo nuevo.
9. **Autoridad humana sin cambios:** el texto generado permanece local y editable, no escribe en el CRM ni envía mensajes; la copia sigue siendo una acción explícita del comercial («Copiar correo»); descartar sigue siendo local (no revierte nada en el servidor).
10. **Frescura/invalidación de contexto ante cambios de oportunidad se mantiene:** igual que hoy, un cambio de `opportunityId` reinicia el estado de generación (`changeCopilotOpportunity`); no se necesita ningún fingerprint de contexto adicional porque ya no hay un segundo estado (`preflightState`) que invalidar por separado — se retira junto con la etapa 2.
11. **Accesibilidad:** un único control de generación enfocable por fase (el CTA primario en `idle`/`loading`/`ready`, o el botón «Reintentar» en `error` — nunca ambos a la vez); `aria-live`/`role="status"`/`role="alert"` para carga/error/éxito; el foco se mueve al encabezado del resultado en éxito; el orden de tabulación coincide con el orden visual; en `error`, «Reintentar» es una acción secundaria (visualmente subordinada) pero es el único elemento enfocable de generación en ese estado, dado que el botón primario no se renderiza.

## UX detallada — estados

| Estado | Disparador | Qué se ve | CTA primario | CTA secundario |
|---|---|---|---|---|
| `idle` | Apertura del panel / cambio de oportunidad | Alertas comerciales (si las hay) + mensaje vacío «Prepara un borrador editable de seguimiento, separado del registro original.» | «Preparar próximo seguimiento» (habilitado; único control de generación) | — |
| `loading` | Click en el CTA primario | Alertas comerciales sin cambios + notice `role="status"` «{VIGIA_VISIBLE_NAMES.commercial} está preparando un borrador acotado…» | «Preparar próximo seguimiento» (deshabilitado; mismo botón, ningún control adicional) | — |
| `error` | `generate` rechaza o lanza | Alertas comerciales sin cambios (nunca desaparecen) + alerta compacta `.vigia-copilot-error role="alert"` (superficie propia, atención neutra/ámbar, no la barra roja genérica `.error`) con el texto fijo «No se pudo preparar el seguimiento. Puede continuar registrándolo manualmente.» | *(ninguno — el botón de preparación no se renderiza en este estado)* | «Reintentar», único control de generación visible, dentro del mismo bloque `.vigia-copilot-error`, visualmente subordinado (`className="secondary"`) |
| `ready` | `generate` resuelve con éxito | «Siguiente paso sugerido» (1 frase, ≤240 car.) + hasta 2 viñetas «Por qué» (≤180 car. cada una) + borrador editable (asunto/cuerpo) + revisión humana + «Ver contexto analizado» plegado (incluye ahora el plan de contacto completo) | «Actualizar borrador» (mismo botón que en `idle`/`loading`, texto cambia como ya ocurre hoy; único control de regeneración) | «Copiar correo», «Descartar» (acciones de salida existentes, no controles de generación) |
| `ready` sin recomendación distinta (abstención) | `generate` resuelve pero el adaptador no puede derivar una frase no redundante | Sin bloque «Siguiente paso sugerido»/«Por qué»; la superficie visible empieza directamente en el borrador editable; revisión humana y «Ver contexto analizado» se muestran igual (el borrador en sí nunca se omite) | igual que `ready` | igual que `ready` |

No existe un estado `preflight-loading`/`preflight-error`/`preflight-ready` en este panel: la etapa 2 desaparece del árbol de estados de React, no sólo de la UI visible.

## Flujo activo — diagrama ASCII exacto

```
Alertas comerciales (deterministas: sólo señales factuales, nunca bloquean) ← visible siempre, sin llamar a Vig-IA
   ↓
[botón] Preparar próximo seguimiento / Actualizar borrador (ready)   ← único CTA; POST /api/vigia/copilot/generate directo
   ↓
   ├── loading ── botón deshabilitado (único control), notice role="status"
   ├── error   ── botón primario NO se renderiza; alerta compacta .vigia-copilot-error role="alert" no bloqueante, atención neutra/ámbar, con botón "Reintentar" (único control, secundario) dentro del mismo bloque; alertas comerciales siguen visibles; seguimiento manual sigue disponible fuera del panel
   └── ready (mismo botón, ahora "Actualizar borrador")
        ↓
        Siguiente paso sugerido (1 frase, ≤240 car.) — u omitido si no hay recomendación distinta de las alertas
        ↓
        Por qué (0–2 viñetas, ≤180 car. cada una)
        ↓
        Correo editable (asunto/cuerpo)
        ↓
        Acciones de salida (Copiar correo, Descartar)
        ↓
        Revisión humana (aviso compacto)
        ↓
        Ver contexto analizado (plegado, trazabilidad: resumen/hechos/inferencias/adjuntos sugeridos/plan de contacto completo)
```

Orden real del DOM (de arriba hacia abajo): `<header>` (título) → `VigiaCommercialAlerts` (alertas deterministas) → control único de generación por fase (botón «Preparar próximo seguimiento» en `idle`, mismo botón deshabilitado en `loading`, alerta compacta `.vigia-copilot-error` con el botón secundario «Reintentar» en `error` — el botón primario no se renderiza en este estado —, botón «Actualizar borrador» junto con `VigiaCopilotProposal` en `ready`) → `notice` transitorio (p. ej. «Borrador copiado»). Dentro de `VigiaCopilotProposal` el orden es: «Siguiente paso sugerido» (si no hay abstención) → «Por qué» (0–2 viñetas) → borrador editable (asunto/cuerpo) → acciones de salida («Copiar correo», «Descartar») → revisión humana → `<details>` «Ver contexto analizado» (plegado; contiene resumen/hechos/inferencias/adjuntos y el plan de contacto completo). No hay ninguna sección entre las alertas y el control de generación: `VigiaPreflightAnalysis` deja de renderizarse.

## Flujo de datos / API

- **Front → backend:** una sola llamada por generación, `POST /api/vigia/copilot/generate` con `{ opportunity_id }`, exactamente como hoy (`VigiaOpportunityCopilot.tsx:174-176`). Sin cambios de payload, de encabezados ni de control de acceso.
- **`POST /api/vigia/copilot/preflight` deja de tener ningún call-site en el frontend activo.** La ruta, sus módulos (`agt003-preflight-contract.js`, `agt003-preflight-input.js`, `agt003-preflight-engine.js`, `agt003-preflight-runtime.js`, `agt003-preflight-api.js`) y su entrada en el manifiesto de contratos (`contracts/agents/AGT-003/v2-draft/manifest.json`, capacidad `agt003.opportunity-preflight.preview`) permanecen en el repositorio, byte a byte, sin modificación. No se retira su registro de `api/[...path].js`/`server/index.js` ni su protección de `ACTIONS.AI_COMMERCIAL_DRAFT_RUN`.
- **Adaptador de presentación compacto** (`copilot-presentation.ts`, función pura nueva, ver «Contratos») recibe el mismo `CopilotPresentationBrief` que ya devuelve `generate` (sin ningún campo nuevo) y deriva `Siguiente paso sugerido`/`Por qué` a partir de `strategy`/`facts`/`inferences`/`contactObjective` ya saneados por `presentCopilotBrief`. No hace ninguna llamada de red adicional, no lee `missing_information` ni `warnings` (que siguen sin renderizarse, como ya decidió la spec anterior), y no persiste nada: opera enteramente sobre el objeto ya recibido en memoria del navegador.

## Fronteras de componentes

- **`VigiaOpportunityCopilot` (contenedor, `src/vigia/VigiaOpportunityCopilot.tsx`):** pierde el estado `preflightState`/`acknowledgedNoPreflight`, sus `useEffect` de invalidación/reconocimiento, y la función `runPreflight`. Conserva `state` (generación), `notice`, `requestSequenceRef`, `generate`, `copyDraft`. Se retira su prop `contextVersion`: ya no existe una segunda etapa (`preflightState`) que invalidar por fingerprint, y el llamador (`src/main.tsx`) deja de pasarla — ver «Ambigüedades resueltas».
- **`VigiaCommercialAlerts` (co-ubicado):** sin cambios de firma ni de render. Su prop `alerts: CommercialAlert[]` recibe directamente el resultado de `buildCommercialAlerts(preflight)`: `CommercialAlert` se simplifica a `{ key, category, risk_text }`, sin el campo `contextualAction` (ver «Contratos»).
- **`VigiaPreflightAnalysis`:** se elimina del árbol de componentes exportados de `VigiaOpportunityCopilot.tsx` y se borra su definición completa: es un componente co-ubicado sin ningún otro call-site en `src/`.
- **`VigiaCopilotProposal`:** gana el bloque «Siguiente paso sugerido» + «Por qué» al principio del resultado visible, antes del borrador editable. Pierde la lista ordenada visible «Plan de contacto» como sección independiente del resultado: sus pasos (`contactPlanSteps`, completos, sin resumir) se mueven dentro de `<details className="vigia-copilot-context">`, junto con el resumen/hechos/inferencias/adjuntos que ya vivían ahí (ver «Ambigüedades resueltas»). Renombra «Contexto analizado» a «Ver contexto analizado» (ver «Ambigüedades resueltas»). El resto (`vigia-copilot-draft`, `vigia-copilot-actions`, `vigia-human-warning`) no cambia de estructura, salvo por dejar de tener la lista ordenada como hermano visible directo.
- **`copilot-presentation.ts`:** gana el adaptador compacto puro (nueva función y tipo, ver «Contratos»); no pierde ninguna función existente salvo que quede genuinamente sin uso.
- **`opportunity-preflight-presentation.ts`:** conserva `CommercialAlertCategory`, `CommercialPreflightInput`, `COMMERCIAL_PREFLIGHT_EXPLANATION`, `buildCommercialAlerts` (siguen usándose para las alertas deterministas), con `buildCommercialAlerts` devolviendo ahora `CommercialAlert[]` directamente. Pierde `PreflightAction`, `ConsolidatedPreflightAction`, `PreflightMergeResult`, `KNOWN_PREFLIGHT_ISSUE_CODES`, `consolidatePreflightActions`, `mergeCommercialAlertsWithPreflight`, el campo `contextualAction` de `CommercialAlert` y el tipo auxiliar `BaseCommercialAlert` (queda idéntico a `CommercialAlert` una vez retirado `contextualAction`, y sin ningún otro consumidor). `normalizePreflightErrorMessage`/`PREFLIGHT_ANALYSIS_UNAVAILABLE_MESSAGE` se retiran junto con `VigiaPreflightAnalysis`, su único consumidor.
- **`opportunity-preflight-state.ts`:** deja de tener ningún call-site en `VigiaOpportunityCopilot.tsx` y no tiene ningún otro importador en `src/`; se borra completo (no se deja como código muerto). Es distinto del backend de preflight, que sí se preserva deliberadamente por ser una API pública versionada con valor de rollback — un módulo de estado de React interno no tiene ese mismo valor de compatibilidad.
- **`src/main.tsx` (call-site único):** dentro de `OpportunityDetail`, la prop `preflight={{ ... }}` se mantiene sin cambios (sigue alimentando `buildCommercialAlerts` con los mismos tres `FichaCardState` ya calculados en `src/main.tsx:806-808`); la prop `contextVersion` se retira de la llamada en `src/main.tsx:892`, porque ningún estado interno del componente vuelve a consumirla (ver «Ambigüedades resueltas»).

## Manejo de errores

- **Único mensaje de fallo de generación**, fijo y no técnico: «No se pudo preparar el seguimiento. Puede continuar registrándolo manualmente.» — reemplaza el actual `normalizeCopilotErrorMessage(state.message)` como texto mostrado por defecto en este panel; el mensaje original del error (`state.message`) deja de exponerse directamente en la UI de este panel para evitar filtrar detalle técnico o de proveedor, siguiendo el mismo criterio de saneamiento que ya aplica `normalizeCopilotErrorMessage`/`normalizePreflightErrorMessage` a otros textos.
- **Sin bloqueo:** el error no oculta las alertas comerciales ni impide reintentar; la alerta usa la superficie compacta `.vigia-copilot-error` (atención neutra/ámbar, `role="alert"`), nunca la clase genérica `.error` (barra roja de ancho completo que en otros paneles del producto actúa como puerta de otra acción) — este panel no usa ese patrón de bloqueo.
- **Sin propuesta de respaldo sintética:** si `generate` falla, no se muestra ningún borrador de relleno ni texto generado localmente para simular una propuesta; el estado `error` no renderiza `VigiaCopilotProposal`.
- **Reintento:** un botón secundario («Reintentar») dentro del mismo bloque de error vuelve a invocar `generate()` con la misma lógica de secuencia de solicitud que ya existe (no se introduce un mecanismo de reintento nuevo).
- **Registro manual siempre disponible:** el mensaje de error señala explícitamente la alternativa («puede continuar registrándolo manualmente») porque el resto de la ficha de oportunidad (edición de interacciones, próxima gestión) no depende de este panel ni se deshabilita por su fallo.

## Seguridad y autoridad

- Sin cambios de control de acceso: `generate` sigue protegido por `ACTIONS.AI_COMMERCIAL_DRAFT_RUN` vía `resolveAgt003OpportunityResource`, sin modificación en este cambio.
- Ninguna escritura automática de CRM: el resultado de `generate` se mantiene en memoria del navegador (`opportunity-copilot-state.ts`), editable, y sólo se copia al portapapeles por acción explícita («Copiar correo»); nunca se envía ni se persiste como interacción o próxima gestión.
- El adaptador de presentación compacto no introduce ninguna superficie de entrada nueva (no acepta HTML sin sanear ni ejecuta ninguna plantilla): opera sobre texto ya saneado por `presentCommercialText`/`filterCommercialEntries`, igual que el resto de `copilot-presentation.ts`.
- El backend de preflight preservado (ruta, módulos, contrato) sigue exigiendo autenticación y ownership igual que hoy; el hecho de que el frontend no lo llame no cambia su superficie de autorización ni la debilita — sigue siendo una ruta activa y protegida, sólo sin tráfico desde este panel.

## Accesibilidad

- Un único control de generación enfocable por fase: el botón «Preparar próximo seguimiento» / «Actualizar borrador» (mismo botón, texto condicional, como ya ocurre hoy) en `idle`/`loading`/`ready`; el botón «Reintentar» en `error`, donde el botón primario no se renderiza. Nunca coexisten dos controles de generación en el orden de tabulación. No hay una casilla ni un segundo botón de análisis.
- El estado de carga usa `role="status"` (anuncio no interruptor, mismo criterio ya usado en `state.phase === 'loading'`).
- El estado de error usa `role="alert"` (anuncio inmediato) en el contenedor `.vigia-copilot-error` para el mensaje compacto; el botón «Reintentar» es un `<button type="button" className="secondary">`, único elemento enfocable de generación en este estado, alcanzable por teclado inmediatamente después del mensaje.
- Al llegar a `ready`, el foco se mueve programáticamente al encabezado del resultado (`<h4>` de «Siguiente paso sugerido» si existe contenido, o al de `vigia-copilot-result`/al del borrador editable si el bloque se abstuvo) mediante `tabIndex={-1}` + `.focus()` en un `useEffect` que dispara sólo en la transición a `ready` — patrón estándar para anunciar contenido nuevo generado de forma asíncrona sin depender únicamente de `aria-live`.
- El orden de tabulación coincide con el orden visual: botón primario («Preparar próximo seguimiento» en `idle`/`loading`, «Actualizar borrador» en `ready`) o «Reintentar» (`error`) → (si `ready`) campos de asunto/cuerpo → Copiar correo → Descartar → detalles de «Ver contexto analizado» (el `<details>` nativo ya es accesible por teclado sin cambios).
- «Ver contexto analizado» conserva `<details><summary>`, con foco de teclado nativo del navegador (sin `tabindex` manual), igual que hoy.

## Criterio de abstención (adaptador compacto)

El adaptador deriva `Siguiente paso sugerido` a partir de `presented.contactPlanSteps[0]` (el primer paso del plan de contacto ya saneado) y las viñetas `Por qué` a partir de `presented.facts`/`presented.inferences` más relevantes, todos ya filtrados de lenguaje técnico por `presentCommercialText`/`filterCommercialEntries`. Se abstiene (omite el bloque «Siguiente paso sugerido»/«Por qué», mostrando sólo el borrador y el resto del resultado) cuando:

- `presented.contactPlanSteps[0]` es igual, tras normalizar espacios y mayúsculas, a alguno de los `risk_text` de las alertas comerciales deterministas actualmente visibles — evita repetir literalmente lo que la alerta ya dijo.
- El primer paso del plan de contacto cae en uno de los textos de resguardo (`COMMERCIAL_TEXT_FALLBACKS.strategy`), es decir, el modelo no devolvió una estrategia utilizable y `presentCommercialText` ya sustituyó el texto genérico de resguardo — mostrar ese texto como «recomendación» sería engañoso.
- No hay ningún `fact`/`inference` disponible tras el filtrado (`presented.facts.length === 0 && presented.inferences.length === 0`) para construir al menos una viñeta «Por qué» genuina — el diseño prefiere cero viñetas a una viñeta vacía o inventada.

Esta comparación es una igualdad de texto normalizada (no hay comparación difusa con distancia de edición), consistente con el criterio ya usado en la deduplicación por `issue_code` exacto de la spec anterior.

## Contratos

```ts
// src/vigia/copilot-presentation.ts (nuevo, aditivo)
export type CompactCopilotSummary = {
  nextStep: string | null;       // ≤240 caracteres; null si el adaptador se abstiene
  whyBullets: string[];          // 0–2 elementos, cada uno ≤180 caracteres
};
export function presentCompactCopilotSummary(presented: PresentedCopilotBrief, activeAlerts: CommercialAlert[]): CompactCopilotSummary;
// Pura: no muta `presented` ni `activeAlerts`; no hace red; no lanza — ante cualquier entrada degenerada devuelve { nextStep: null, whyBullets: [] }.

// src/vigia/opportunity-preflight-presentation.ts (cambios de firma en `CommercialAlert`/`buildCommercialAlerts`)
export type CommercialAlertCategory = 'next_action' | 'close_date' | 'decision_maker';
export type CommercialAlert = { key: string; category: CommercialAlertCategory; risk_text: string };
// `contextualAction` se retira del tipo: ya no hay ningún productor de esa propiedad en el frontend activo.
export type CommercialPreflightInput = { nextAction: FichaCardState; expectedClose: FichaCardState; decisionMaker: FichaCardState };
export const COMMERCIAL_PREFLIGHT_EXPLANATION: string;
export function buildCommercialAlerts(input: CommercialPreflightInput): CommercialAlert[];
// buildCommercialAlerts devuelve CommercialAlert[] directamente; el tipo auxiliar BaseCommercialAlert se retira
// (queda idéntico a CommercialAlert una vez fuera contextualAction).
// Se retiran: PreflightAction, ConsolidatedPreflightAction, PreflightMergeResult,
// KNOWN_PREFLIGHT_ISSUE_CODES, consolidatePreflightActions, mergeCommercialAlertsWithPreflight,
// normalizePreflightErrorMessage, PREFLIGHT_ANALYSIS_UNAVAILABLE_MESSAGE.

// src/vigia/VigiaOpportunityCopilot.tsx (cambios)
type Props = { opportunityId: string; request: Request; preflight: CommercialPreflightInput };
// `contextVersion` se retira de Props: ya no hay estado interno que la consuma (ver "Ambigüedades resueltas").
// Se retira VigiaPreflightAnalysis del módulo. VigiaCommercialAlerts y VigiaCopilotProposal se mantienen exportadas.
```

`CopilotPresentationBrief` (lo que devuelve `POST /api/vigia/copilot/generate`) **no cambia**. `PresentedCopilotBrief` (salida de `presentCopilotBrief`) **no cambia** — el adaptador compacto es una capa adicional que consume `PresentedCopilotBrief` ya construido, no lo reemplaza ni lo altera.

## CSS

Reglas retiradas por quedar sin ningún selector que las use: `.vigia-preflight-analysis`, `.vigia-preflight-analysis h4`, `.vigia-preflight-standalone`, `.vigia-preflight-ack`. Reglas conservadas sin cambio: `.vigia-preflight-alerts` y sus descendientes (siguen usándose por `VigiaCommercialAlerts`), `.vigia-copilot-generate`, `.vigia-copilot-plan ol` (mismo selector; el `<ol>` que estiliza pasa a vivir dentro de `details.vigia-copilot-context`, sin cambio de reglas). Reglas nuevas, aditivas, para el bloque compacto de éxito y para la alerta de error:

```css
.vigia-copilot-summary{display:grid;gap:6px;margin-bottom:8px}
.vigia-copilot-summary h4{margin:0;color:#124174}
.vigia-copilot-summary .vigia-copilot-why{margin:0;padding-left:20px;display:grid;gap:4px;font-size:13px;color:#374151}

.vigia-copilot-error{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:6px;background:#fffbeb;border:1px solid #fbbf24;color:#78350f;font-size:13px}
.vigia-copilot-error .secondary{margin-left:auto;flex-shrink:0}
```

`.vigia-copilot-error` es una superficie deliberadamente distinta de la clase genérica `.error` ya existente en `src/styles.css` (roja, de ancho completo, usada en otros paneles como puerta de bloqueo): mantiene `role="alert"` en el HTML para el anuncio inmediato de lectores de pantalla, pero su presentación visual es compacta y de atención neutra/ámbar, no una barra de error bloqueante. No se reutiliza ni se modifica la regla `.error` existente.

No se modifica ninguna regla existente que siga en uso.

## Rollout / rollback

1. **PR desde `main` reconciliado:** la rama parte de un `main` actualizado; sin commits de otra tarea mezclados.
2. **Pruebas locales:** suite completa en verde (unitarias, contrato, render, estáticas — ver «Criterios de aceptación TDD»); build y typecheck sin errores.
3. **Revisión independiente:** un segundo par de ojos revisa el diff antes de mergear, con foco en que ningún string prohibido reaparezca y en que el mensaje de error/abstención coincida exactamente con el texto de esta spec.
4. **Merge y despliegue a Vercel producción**, mismo pipeline ya existente, sin bandera de features nueva (sigue detrás de `canRenderOpportunityCopilot`, que ya exige el permiso piloto).
5. **Verificación de strings del bundle:** confirmar en el bundle de producción que «Analizar cómo fortalecer el seguimiento» y «Entiendo que no se ejecutó el análisis inteligente» ya no aparecen, y que «Preparar próximo seguimiento» sí.
6. **QA visual autenticado (Juan):** abrir al menos una oportunidad no licitatoria con alertas comerciales activas y confirmar el flujo de un solo botón, incluyendo un ciclo de fallo real de `generate` (para validar el mensaje no bloqueante) y un ciclo de éxito (para validar «Siguiente paso sugerido»/«Por qué»/abstención cuando aplique).
7. **Rollback:** revertir el commit/PR de frontend restaura el flujo híbrido anterior (alertas → preanálisis → casilla → generar) sin ninguna acción adicional, porque el backend de `/preflight` permanece intacto y desplegado durante todo este cambio — no hay una migración que revertir ni datos que limpiar (este cambio no persiste nada nuevo).

## Fuera de alcance

- Estilo del CTA exterior en la tarjeta de la oportunidad (fuera de este panel).
- Rediseño de la tarjeta «Contacto decisor».
- La inconsistencia entre `last_interaction_at` y el historial de interacciones.
- Eliminación completa del backend de preflight (ruta, módulos, capacidad del manifiesto de contratos) — se difiere explícitamente a una limpieza posterior, después de observar producción sin tráfico desde la UI durante un período razonable.
- Cambios de proveedor o de modelo de `generate` o del motor de preflight preservado.
- Cualquier escritura de datos (CRM, interacciones, próxima gestión) desde este panel.
- Envío de mensajes (correo, CRM) desde este panel: la copia al portapapeles sigue siendo la única acción de salida.
- Cambios a `contracts/agents/AGT-002/*` — este diseño no toca ningún contrato de AGT-002.
- Cambios de esquema de base de datos o de `access-control.js`.

## Riesgos y contrapartidas

- **Código backend dormido:** la ruta `/preflight` y sus módulos quedan sin tráfico real desde producción, pero siguen desplegados, ocupando superficie de mantenimiento (dependencias, variables de entorno `AGT003_PREFLIGHT_*`) sin verificación continua de que sigan funcionando — mitigado por ser una decisión explícita y temporal, con la decomisión ya planificada como tarea futura.
- **Límites semánticos del adaptador compacto:** derivar «Siguiente paso sugerido» de `contactPlanSteps[0]` puede producir una frase que, aunque no sea idéntica textualmente a una alerta, siga siendo poco accionable si el modelo devolvió una estrategia genérica — el criterio de abstención cubre la redundancia textual y los resguardos conocidos, pero no puede garantizar la calidad semántica de una estrategia genuinamente distinta pero igualmente poco útil; si esto resulta ser un problema recurrente en QA, corresponde volver a este diseño para decidir si se ajusta el prompt/política de `generate` (fuera de alcance aquí, ver punto 6 de la Decisión).
- **La propuesta generada puede seguir fallando:** retirar el preanálisis no reduce la tasa de fallo de `generate` en sí; sólo elimina una etapa previa que fallaba con más frecuencia y sin aportar al resultado final.
- **Pérdida de observabilidad de preflight desde la UI:** al dejar de invocarse desde el frontend, cualquier métrica o log que dependiera del tráfico real de `/preflight` en producción deja de recibir señal — aceptable porque la capacidad se preserva pero se considera no esencial para el flujo actual; documentado aquí para que no se interprete como una regresión no vista.

## Ambigüedades resueltas

- **¿Se retira la prop `contextVersion` de `VigiaOpportunityCopilot`?** Sí: ningún estado interno del componente la consume una vez que deja de existir `preflightState` que invalidar por fingerprint. El call-site en `src/main.tsx:892` se actualiza en el mismo cambio para dejar de pasarla.
- **¿Dónde vive exactamente el bloque «Siguiente paso sugerido»/«Por qué» dentro de `VigiaCopilotProposal`?** Al principio del resultado visible, antes del borrador editable — es la primera lectura del comercial al abrir la propuesta generada. La lista ordenada «Plan de contacto» deja de ser una sección visible independiente en este documento (a diferencia de la spec anterior, que sí la mostraba siempre): sus pasos completos se mueven dentro de «Ver contexto analizado», para no repetir en dos niveles de detalle visibles a la vez el mismo contenido que «Siguiente paso sugerido»/«Por qué» ya resumen. Cuando el adaptador se abstiene, no hay ningún bloque de resumen encima del borrador; el plan completo sigue disponible, siempre, sólo que dentro de la sección plegada.
- **¿El `<summary>` de «Contexto analizado» cambia de texto a «Ver contexto analizado»?** Sí, por consistencia con el verbo explícito que pide esta spec («Ver contexto analizado»); es un cambio de copy puro, sin efecto de comportamiento, y se actualiza en las pruebas estáticas/de render existentes que hoy buscan el texto «Contexto analizado».
- **¿`opportunity-preflight-state.ts` se borra o se preserva?** Se borra: tras retirar sus call-sites en `VigiaOpportunityCopilot.tsx`, ningún otro archivo del frontend lo importa (confirmado por búsqueda de fuente antes de esta entrega). Esto es distinto del backend de preflight, que se preserva deliberadamente por ser una API pública versionada con su propio contrato y valor de rollback; un módulo de estado de React interno no tiene ese mismo valor de compatibilidad.
- **¿Qué pasa si el comercial pulsa «Reintentar» repetidas veces tras varios fallos?** Mismo comportamiento que ya tiene `generate()` hoy vía `requestSequenceRef`: cada click incrementa la secuencia y sólo la respuesta de la última solicitud en vuelo actualiza el estado visible; no se introduce un límite de reintentos nuevo en este diseño.
- **¿Las alertas comerciales pueden mostrar alguna vez una sugerencia contextual de IA en este diseño?** No. Al retirar la etapa 2 del frontend activo, `CommercialAlert` dejará de tener ningún origen posible de `contextualAction`; el campo se retira del tipo en vez de mantenerse siempre en `null`, para que el propio sistema de tipos exprese que ya no existe esa posibilidad.

## Sustitución del diseño anterior

Este documento sustituye, dentro de `docs/superpowers/specs/2026-08-26-agt003-preflight-alerts-design.md`, todas las secciones que describen el **flujo activo de frontend**: la etapa 2 visible («Preanálisis inteligente»), sus componentes (`VigiaPreflightAnalysis`), su estado (`opportunity-preflight-state.ts` como consumido desde la UI), la casilla de reconocimiento, la fusión de alertas con acciones de IA (`mergeCommercialAlertsWithPreflight` como parte del flujo visible), y la condición `canGenerate` dependiente del preanálisis.

Se preserva sin cambios de esa spec anterior:
- La semántica advisoria de las alertas comerciales deterministas (etapa 1 completa: `buildCommercialAlerts`, la tabla de categorías/códigos/`risk_text`, el principio de que ninguna alerta bloquea).
- El diseño histórico del backend de preflight (ruta, módulos, contrato del manifiesto, persistencia — o ausencia de ella) como documentación de por qué existe ese código, aunque deje de tener tráfico desde la UI.
- El retiro de «Antes de contactar» y de la segunda «Alertas comerciales» ya hecho a `VigiaCopilotProposal`/`copilot-presentation.ts` respecto al diseño original de esa spec anterior — este documento construye sobre ese resultado.

Este documento sí modifica, respecto a esa spec anterior, la presentación de «Plan de contacto»: donde la spec 2026-08-26 lo mostraba como lista ordenada siempre visible en el resultado, este documento lo mueve íntegro (mismos `contactPlanSteps`, sin resumirlo ni truncarlo) dentro de `<details>` «Ver contexto analizado», por la razón de duplicación visible descrita en «Problema» y «Objetivos» — ver «Fronteras de componentes» y «Ambigüedades resueltas».

## Criterios de aceptación (TDD)

1. `tests/vigia-opportunity-copilot-ui-static.test.mjs` (actualizado): los strings `'Análisis inteligente del seguimiento'`, `'Analizar cómo fortalecer el seguimiento'`, `'Actualizar análisis'`, `'Entiendo que no se ejecutó el análisis inteligente antes de generar.'`, `'Sugerencia contextual'`, `'/api/vigia/copilot/preflight'`, `'VigiaPreflightAnalysis'` están ausentes de `src/vigia/VigiaOpportunityCopilot.tsx`.
2. El mismo archivo estático confirma que existe exactamente un `<button` cuyo texto condicional es `'Preparar próximo seguimiento'` / `'Actualizar borrador'`, y que no existe ningún otro elemento `<button` fuera de «Copiar correo»/«Descartar»/«Reintentar» (secundario, sólo en estado de error) dentro del árbol de `VigiaOpportunityCopilot`; ningún test acepta que ese botón primario y «Reintentar» aparezcan renderizados a la vez.
3. Ningún archivo bajo `src/vigia/` contiene el string literal `/api/vigia/copilot/preflight` (grep sobre el componente y sus módulos co-ubicados) — confirma que no hay ningún call-site de frontend activo hacia esa ruta.
4. Un test de comportamiento (mock de `request`) confirma que pulsar el CTA primario invoca `request` exactamente una vez, con `'/api/vigia/copilot/generate'`, sin ninguna llamada previa o concurrente a `/preflight`.
5. Un test de render confirma que las alertas comerciales deterministas se renderizan idénticamente con `state.phase` en `idle`, `loading`, `error` y `ready` — nunca desaparecen ni cambian por el resultado de generación.
6. Un test de comportamiento confirma que, en `error`: el botón primario de preparación no se renderiza en absoluto (ni habilitado ni deshabilitado); no se renderiza ningún `<input type="checkbox">`; no se renderiza ningún elemento con la clase genérica `.error`; no se renderiza `VigiaCopilotProposal`; el texto exacto `'No se pudo preparar el seguimiento. Puede continuar registrándolo manualmente.'` está presente dentro de un elemento `.vigia-copilot-error` con `role="alert"`, junto a exactamente un botón `'Reintentar'`.
7. Pruebas unitarias de `presentCompactCopilotSummary` (`tests/agt003-copilot-presentation.test.mjs`, extendido, o un archivo nuevo si el existente crece demasiado): `nextStep`/cada `whyBullets[i]` respetan los topes de 240/180 caracteres; con `contactPlanSteps[0]` textualmente igual (normalizado) a un `risk_text` de `activeAlerts`, devuelve `{ nextStep: null, whyBullets: [] }`; con `facts`/`inferences` vacíos tras el saneamiento, `whyBullets` es `[]` aunque `nextStep` no sea `null`; con un `contactPlanSteps[0]` igual a `COMMERCIAL_TEXT_FALLBACKS.strategy`, se abstiene; la función nunca lanza ante brief mínimo (todos los campos vacíos) y nunca muta sus argumentos.
8. Un test de render (`renderReactComponent` real) confirma que una respuesta de `generate` cuyo primer paso del plan repite literalmente una alerta activa no muestra ningún bloque «Siguiente paso sugerido»/«Por qué», mientras que el borrador editable y «Ver contexto analizado» sí se renderizan igual.
9. Un test de render confirma que la lista ordenada «Plan de contacto» (con todos sus `contactPlanSteps`, sin truncar) sólo aparece dentro de `<details className="vigia-copilot-context">` (colapsada por defecto, visible sólo al expandir «Ver contexto analizado»), y que ningún elemento fuera de ese `<details>` renderiza esa lista — confirma que no hay duplicación visible entre el resumen compacto y el plan completo.
10. Protección ante respuesta obsoleta: un test reproduce dos clics sucesivos en el CTA antes de que la primera respuesta llegue, resuelve las promesas en orden inverso, y confirma que sólo el resultado de la última solicitud (por `requestId`) queda reflejado en el estado final — mismo criterio que ya prueba `tests/vigia-opportunity-copilot-state.test.mjs` para `beginCopilotGeneration`/`completeCopilotGeneration`, sin necesidad de un mecanismo nuevo.
11. Accesibilidad: un test de render confirma `role="status"` en `loading`, `role="alert"` en `error`, y que al transicionar a `ready` el nodo enfocado programáticamente (`document.activeElement` en un entorno con DOM real, p. ej. jsdom) es el encabezado del resultado, no el `<body>`.
12. Copiar/editar/descartar (`onCopy`/`onDraftChange`/`onDiscard`) siguen probados sin cambios de comportamiento por los tests ya existentes (`tests/vigia-opportunity-copilot-followup-copy.test.mjs`, `tests/vigia-opportunity-copilot-state.test.mjs`) — se actualizan únicamente si cambian props/textos, nunca su lógica.
13. `npm run build` (o el comando de build configurado del repo) y el typecheck de TypeScript pasan sin errores tras retirar los tipos/exports muertos de `opportunity-preflight-presentation.ts` y borrar `opportunity-preflight-state.ts`.
14. `tests/agt003-preflight-state.test.mjs` se retira del repositorio: probaba el comportamiento de `opportunity-preflight-state.ts`, borrado en esta entrega. Su cobertura de ausencia queda dentro de los criterios 1 y 3 (strings/imports de preflight ausentes de `src/vigia/`); no se reescribe como prueba de comportamiento de un módulo que ya no existe. Los tests de backend bajo `tests/agt003-preflight-*.test.mjs` (que prueban la ruta y los módulos de servidor preservados) permanecen sin cambios.
15. La suite completa del repositorio pasa en verde, incluyendo `tests/backend-parity.test.mjs`, `tests/agt003-preflight-*.test.mjs` (backend, sin cambios de aserciones — siguen probando la ruta preservada) y `tests/agt003-copilot-*.test.mjs` relacionados con `generate` (sin cambios de contrato).
16. Ningún archivo bajo `api/`, `server/`, `contracts/agents/AGT-003/`, `contracts/agents/AGT-002/` ni `supabase/migrations/` aparece en el diff de este cambio — verificable con `git diff --stat` contra la lista de archivos esperados de la sección «Archivos esperados».

## Archivos esperados en la implementación

- `src/vigia/VigiaOpportunityCopilot.tsx` — retiro de la etapa 2 visible, del estado de preflight y de `VigiaPreflightAnalysis`; CTA único; bloque compacto de éxito; manejo de error no bloqueante; foco programático en éxito.
- `src/vigia/opportunity-preflight-presentation.ts` — retiro de los tipos/funciones de fusión ahora muertos (`PreflightAction`, `ConsolidatedPreflightAction`, `PreflightMergeResult`, `KNOWN_PREFLIGHT_ISSUE_CODES`, `consolidatePreflightActions`, `mergeCommercialAlertsWithPreflight`, `contextualAction`, `BaseCommercialAlert`, `normalizePreflightErrorMessage`, `PREFLIGHT_ANALYSIS_UNAVAILABLE_MESSAGE`); `CommercialAlert` queda como `{ key, category, risk_text }` y `buildCommercialAlerts` la devuelve directamente.
- `src/vigia/opportunity-preflight-state.ts` — se borra: sin ningún call-site en el frontend.
- `src/vigia/copilot-presentation.ts` — adaptador de presentación compacto puro (`presentCompactCopilotSummary`, `CompactCopilotSummary`), aditivo.
- `src/main.tsx` — actualización del call-site único de `VigiaOpportunityCopilot` (retiro de `contextVersion`, sin cambios en `preflight={{ ... }}`).
- `src/styles.css` — retiro de reglas de `.vigia-preflight-analysis`/`.vigia-preflight-standalone`/`.vigia-preflight-ack`; reglas aditivas de `.vigia-copilot-summary` y `.vigia-copilot-error` (esta última no reemplaza ni modifica `.error`).
- `tests/vigia-opportunity-copilot-ui-static.test.mjs` — markers requeridos/prohibidos actualizados, incluyendo la ausencia de un botón primario renderizado a la vez que «Reintentar».
- `tests/agt003-preflight-state.test.mjs` — se retira: probaba `opportunity-preflight-state.ts`, borrado en esta entrega.
- `tests/agt003-copilot-presentation.test.mjs` (o un archivo nuevo específico) — pruebas de `presentCompactCopilotSummary` y del criterio de abstención.
- `tests/agt003-copilot-proposal-render.test.mjs` — render del bloque compacto, orden de secciones (incluyendo que «Plan de contacto» sólo aparece dentro de «Ver contexto analizado»), ausencia de checkbox/botón primario/clase `.error` genérica en el estado de error.
- `tests/vigia-opportunity-copilot-state.test.mjs` — sin cambios de comportamiento esperado en `generate`; se extiende sólo si el foco programático o el mensaje de error requieren un caso nuevo.

No se espera ningún cambio en archivos de `api/`, `server/`, `contracts/agents/`, `supabase/migrations/`, ni en el manifiesto de AGT-002.
