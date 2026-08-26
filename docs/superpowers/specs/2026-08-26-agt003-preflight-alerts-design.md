# AGT-003: alertas comerciales previas a la generación (preflight) — diseño

**Fecha:** 2026-08-26
**Estado:** Aprobado por producto (Juan) — flujo **híbrido**: alertas deterministas inmediatas + una etapa explícita de preanálisis con IA (llamada real, separada de la generación) antes de poder generar la propuesta.
**Alcance:** frontend (`src/vigia/VigiaOpportunityCopilot.tsx`, `src/vigia/copilot-presentation.ts`, `src/vigia/opportunity-preflight-presentation.ts` nuevo, `src/vigia/opportunity-preflight-state.ts` nuevo, el único call-site en `src/main.tsx` — `OpportunityDetail` —, CSS aditivo en `src/styles.css`) **y** backend (una ruta autenticada nueva `POST /api/vigia/copilot/preflight`, un módulo de contrato/entrada/motor/runtime/API nuevos para esa ruta, una extensión aditiva del manifiesto de contratos AGT-003 v2-draft). Sin migraciones de base de datos y sin escritura de CRM en ningún punto del flujo.
**Rama:** `feat/agt003-preflight-alerts`

## Problema

En `src/vigia/VigiaOpportunityCopilot.tsx:30-47` (`VigiaCopilotProposal`), la propuesta generada por Vig-IA Comercial repite el mismo tipo de riesgo comercial en tres lugares distintos:

1. `presented.strategy` se renderiza como un párrafo bajo `<h4>Acción recomendada</h4>` (línea 33) y con frecuencia empieza recomendando verificar al decisor o retomar una fecha vencida.
2. `presented.missingInformation` se renderiza como una sección independiente `<h4>Antes de contactar</h4>` (línea 34), que repite huecos de datos (p. ej. «Correo del contacto decisor») ya visibles en otra parte de la ficha.
3. `presented.warnings` se renderiza como `<div className="notice vigia-copilot-warnings"><strong>Alertas comerciales</strong>...` (línea 44), **al final** de la propuesta generada, con el mismo tipo de mensaje que las dos secciones anteriores (`tests/agt003-copilot-presentation.test.mjs:58-62` confirma que el modelo devuelve textos como «No hay contacto decisor verificado» y «La fecha de cierre estimada ya venció» — el mismo hecho que aparece en `strategy` y en `missingInformation`).

Las tres secciones dependen de texto libre generado por el modelo (`brief.strategy`, `brief.missing_information`, `brief.warnings`), por lo que no hay ninguna garantía de que una misma condición («decisor sin verificar», «fecha vencida») tenga una única identidad: puede aparecer 0, 1, 2 o 3 veces, con redacciones distintas cada vez, y sólo después de pulsar «Preparar seguimiento» (nunca antes). No existe hoy ninguna señal de riesgo visible **antes** de generar, y no existe ningún paso intermedio en el que el comercial reciba una lectura cualitativa (llamadas, notas, tono de la negociación) antes de que se redacte un correo.

Cualquier solución que introduzca una segunda fuente de recomendaciones (un preanálisis con IA) reintroduce el mismo riesgo de duplicación si no se diseña con una identidad canónica compartida entre lo determinista y lo generado por el modelo. Esta spec resuelve ambos problemas a la vez: la duplicación original y la duplicación potencial de una nueva capa de IA.

## Decisión: flujo híbrido en cuatro etapas

1. **Alertas comerciales deterministas** — visibles en cuanto se abre la oportunidad, antes de cualquier llamada a Vig-IA. Son señales factuales de atención (decisor incompleto, próxima gestión y fecha de cierre vencidas o faltantes), no instrucciones ni acciones a ejecutar: no traen un texto de acción precisa, ni una acción genérica, ni un prerrequisito, ni una validación, ni una condición bloqueante. Una fecha vencida o faltante nunca impide continuar. Sin LLM, de solo lectura, no bloquean nada y no participan en absoluto de la condición que habilita generar la propuesta (`canGenerate`).
2. **Preanálisis inteligente** — una llamada real a Vig-IA, distinta de la generación, disparada por el botón explícito **«Analizar cómo fortalecer el seguimiento»**. Analiza el historial cualitativo de la oportunidad (interacciones/notas) y devuelve sugerencias contextuales concretas (p. ej. «hable con Daniela de Gerencia sobre el descuento pedido», «retome la llamada del 14/08 con el gerente de compras», «aclare con el cliente los términos de pago pendientes») que siguen siendo opcionales y de decisión humana: el comercial evalúa si aplicarlas o no.
3. **Edición opcional del CRM** — el comercial puede actuar sobre esas acciones y actualizar el CRM, pero nada de esto es obligatorio. Al guardar, las alertas deterministas se recalculan solas (ya lo hacían) y el preanálisis queda invalidado: puede volver a ejecutarlo sobre el contexto nuevo.
4. **Generación de la propuesta** — botón **«Generar propuesta con el contexto actual»**, que vuelve a cargar contexto fresco (como ya hace hoy `POST /api/vigia/copilot/generate`) y produce: Plan de contacto en lista ordenada, asunto y cuerpo editables, una revisión humana compacta junto a las acciones de copiar/descartar, y el contexto analizado plegado al final. El preanálisis es el camino normal antes de generar, pero no es una puerta cerrada: si falla o el comercial no lo ejecuta, puede generar igual tras reconocerlo explícitamente (ver «Etapa 2», sección «Continuidad sin preanálisis»).

`brief.missing_information` y `brief.warnings` dejan de renderizarse en la UI (siguen generándose y persistiendo sin cambios, ver «Fuera de alcance»). La sección «Antes de contactar» desaparece. La propuesta generada ya no repite «Alertas comerciales» al final. `brief.strategy` se renombra en la UI a **«Plan de contacto»** y se renderiza como pasos separados y ordenados (`<ol>`), nunca como un párrafo único. «Revisión humana» se reposiciona junto a «Copiar correo»/«Descartar». «Contexto analizado» permanece plegado, al final, sin cambios de contenido.

Secuencia de acciones del humano en el panel `VigiaOpportunityCopilot` (no es el orden exacto de píxeles: describe cuándo tiene sentido usar cada control):

```
Alertas comerciales (deterministas: sólo señales factuales, nunca bloquean) ← visible siempre, sin llamar a Vig-IA
   ↓
[botón] Analizar cómo fortalecer el seguimiento                     ← dispara POST /api/vigia/copilot/preflight
   ↓
Sugerencia contextual de Vig-IA (asociada a una alerta o autónoma)  ← se agrega bajo la alerta, opcional, decisión humana
   ↓ (el humano puede ir a editar el CRM aquí; opcional, no bloqueante)
   ↓    al guardar → alertas deterministas se recalculan solas, preanálisis se invalida
   ↓    (puede repetir el ciclo "Analizar" ⇄ "editar CRM" cuantas veces quiera)
[botón] Generar propuesta con el contexto actual                    ← POST /api/vigia/copilot/generate (sin cambios de contrato)
   ↓
Plan de contacto (pasos numerados)
   ↓
Correo editable (asunto/cuerpo)
   ↓
Revisión humana (aviso compacto, junto a Copiar correo/Descartar)
   ↓
Contexto analizado (plegado, trazabilidad)
```

Orden real del DOM (de arriba hacia abajo): `<header>` (título) → `VigiaCommercialAlerts` (etapa 1) → `VigiaPreflightAnalysis` (etapa 2) → bloque de generación (botón «Generar…» + estados `idle`/`loading`/`error`/`ready` con `VigiaCopilotProposal`) → `notice` transitorio. Ver «Comportamiento de la UI».

## Etapa 1 — Alertas comerciales deterministas

### Decisión de arquitectura: reutilizar datos ya disponibles, sin endpoint

`src/vigia/opportunity-ficha-presentation.ts` ya expone tres funciones puras, sin red, sin LLM, ya cubiertas por `tests/agt003-ficha-presentation.test.mjs`, y **ya están siendo invocadas hoy** en `src/main.tsx:805-807` dentro de `OpportunityDetail`:

```ts
const priorityNextAction = nextActionCardState(o);                              // src/main.tsx:805
const priorityClose = expectedCloseCardState(o.expected_close_date);            // src/main.tsx:806
const priorityDecisionMaker = decisionMakerCardState({ name: o.decision_maker_name, email: o.decision_maker_email, phone: o.decision_maker_phone }); // src/main.tsx:807
```

Estas tres funciones ya calculan, de forma determinística y a partir del mismo objeto `o` (la oportunidad vigente cargada por `/api/opportunity-detail`), exactamente las dos condiciones que el problema cita como repetidas («decisor sin verificar» → `decisionMakerCardState`; «fechas vencidas» → `nextActionCardState` y `expectedCloseCardState`). Cada una devuelve un `FichaCardState` con un `tone` (`'ok' | 'neutral' | 'attention' | 'critical'`).

Construir un endpoint dedicado para esta capa habría significado una nueva consulta SQL a `v_psi_sales_opportunity_enriched` (duplicando columnas que `/api/opportunity-detail` ya trae) y reimplementar en el backend las mismas reglas de fecha/decisor que ya existen y están probadas en el frontend, con el riesgo de que las dos implementaciones diverjan. Reutilizar `opportunity-ficha-presentation.ts` evita esa duplicación por construcción. (La etapa 2 sí necesita un endpoint nuevo porque implica una llamada real a un modelo — ver más abajo — pero esta capa determinista no lo necesita.)

### Contrato de tipos (`src/vigia/opportunity-preflight-presentation.ts`, nuevo)

Módulo TypeScript puro (sin JSX, sin red), análogo en estilo a `copilot-presentation.ts`. Además de las alertas deterministas, este módulo define el mecanismo de **consolidación** con las acciones del preanálisis de la etapa 2 (ver «Deduplicación combinada»):

```ts
import type { FichaCardState } from './opportunity-ficha-presentation';

export type CommercialAlertCategory = 'next_action' | 'close_date' | 'decision_maker';

export type CommercialAlert = {
  key: string;                          // `${category}:${state.code}`, p. ej. "next_action:overdue"
  category: CommercialAlertCategory;
  risk_text: string;                    // señal factual; bullet en "Alertas comerciales" — nunca una instrucción ni una acción
  contextualAction: ConsolidatedPreflightAction | null; // sugerencia contextual opcional del preanálisis (etapa 2), sólo si Vig-IA la asoció a esta categoría
};

export type CommercialPreflightInput = {
  nextAction: FichaCardState;
  expectedClose: FichaCardState;
  decisionMaker: FichaCardState;
};

export const COMMERCIAL_PREFLIGHT_EXPLANATION: string; // ver copy abajo

export function buildCommercialAlerts(input: CommercialPreflightInput): Omit<CommercialAlert, 'contextualAction'>[];

// --- Consolidación con el preanálisis de Vig-IA (etapa 2) ---

export const KNOWN_PREFLIGHT_ISSUE_CODES: readonly CommercialAlertCategory[]; // ['next_action', 'close_date', 'decision_maker']

export type PreflightAction = {
  issue_code: string;        // valor de PREFLIGHT_ISSUE_CODES (ver contrato del agente, etapa 2)
  title: string;
  description: string;
  evidence_refs: string[];   // no se renderiza; sólo trazabilidad (mismo criterio que brief.facts[].evidence_refs)
};

export type ConsolidatedPreflightAction = { issue_code: string; title: string; description: string; evidence_refs: string[] };

export function consolidatePreflightActions(actions: PreflightAction[]): ConsolidatedPreflightAction[];

export type PreflightMergeResult = {
  alerts: CommercialAlert[];                     // con `contextualAction` ya resuelto
  standaloneActions: ConsolidatedPreflightAction[]; // issue_code fuera de KNOWN_PREFLIGHT_ISSUE_CODES
};

export function mergeCommercialAlertsWithPreflight(
  alerts: Omit<CommercialAlert, 'contextualAction'>[],
  preflightActions: PreflightAction[],
): PreflightMergeResult;
```

`buildCommercialAlerts` es pura: evalúa las tres categorías en un orden fijo (`next_action`, `close_date`, `decision_maker` — el mismo orden en que las tarjetas de prioridad ya aparecen en pantalla), omite cualquier categoría cuyo `tone` sea `'ok'`, y devuelve como máximo una alerta por categoría. Un código de estado sin regla mapeada se omite en silencio en vez de lanzar.

### Reglas determinísticas (texto por categoría/código)

Cada fila produce únicamente un `risk_text` factual: una descripción de lo que se observa en los datos, nunca una instrucción, una acción genérica, un prerrequisito ni una condición de bloqueo. No existe una columna de acción por defecto: si el preanálisis no asocia una sugerencia contextual a la categoría, la alerta se muestra sólo con su `risk_text`.

| Categoría | `code` | `tone` | `risk_text` |
|---|---|---|---|
| `next_action` | `missing` | critical | «No hay una próxima gestión agendada.» |
| `next_action` | `overdue` | critical | `` `La próxima gestión está ${detail.toLowerCase()}.` `` → «La próxima gestión está vencida hace N días.» |
| `next_action` | `today` | attention | «La próxima gestión está programada para hoy.» |
| `next_action` | `soon` | attention | `` `La próxima gestión es ${detail.toLowerCase()}.` `` → «La próxima gestión es en N días.» |
| `next_action` | `scheduled`/`closed` | ok | *(sin alerta)* |
| `close_date` | `missing` | attention | «No hay fecha de cierre estimada registrada.» |
| `close_date` | `overdue` | critical | «La fecha de cierre estimada ya venció.» |
| `close_date` | `today` | attention | «La fecha de cierre estimada es hoy.» |
| `close_date` | `scheduled` | ok | *(sin alerta)* |
| `decision_maker` | `pending` | attention | «No hay datos de contacto del decisor registrados.» |
| `decision_maker` | `partial` | attention | `` `El contacto del decisor está incompleto (${detail.toLowerCase()}).` `` → «El contacto del decisor está incompleto (falta correo).» |
| `decision_maker` | `complete` | ok | *(sin alerta)* |

Ninguna fila —tampoco `overdue` ni `missing`— impide continuar: son señales de atención, no validaciones ni bloqueos.

`COMMERCIAL_PREFLIGHT_EXPLANATION = 'Señales para tener en cuenta durante el seguimiento. No impiden continuar.'` — se muestra sólo cuando hay al menos una alerta.

### Frescura de contexto (etapa 1)

Las alertas se derivan de `o` como prop de React en cada render de `OpportunityDetail`. `FollowUpForm` y `OpportunityForm` (edición) ya disparan `load()`/`refresh()` al guardar (`src/main.tsx:856`), así que `o` — y por lo tanto las alertas deterministas — se recalculan automáticamente en cuanto cambia cualquier dato relevante. No hace falta ningún fetch ni estado de carga propio para esta etapa.

## Etapa 2 — Preanálisis inteligente (Vig-IA)

### Por qué esta etapa necesita un endpoint nuevo (a diferencia de la etapa 1)

La etapa 1 reutiliza cálculo ya hecho en el cliente. Esta etapa es distinta por naturaleza: requiere una llamada real a un modelo (leer el historial cualitativo — notas de llamadas, reuniones, correos resumidos en `psi_sales_interactions` — y razonar sobre qué acción concreta ayuda) que **no puede ejecutarse en el navegador**: el modelo corre detrás del mismo puente Claude ya usado por `POST /api/vigia/copilot/generate` (`agt003-claude-bridge-host.js`), que exige HMAC firmado desde el backend y sostiene un único turno de proveedor a la vez (`agt003-copilot-runtime.js:7-11`). No hay forma de cumplir «Vig-IA analiza historial cualitativo y devuelve acciones contextuales, en una llamada IA real separada» sin una ruta de servidor nueva.

**Arquitectura elegida:** un endpoint autenticado `POST /api/vigia/copilot/preflight`, hermano de `POST /api/vigia/copilot/generate`, con el mismo control de acceso/ownership, la misma fuente de contexto fresco, pero **sin persistencia de ejecución** (a diferencia de `generate`, que graba cada corrida en `psi_agt003_copilot_runs` para idempotencia y auditoría — ver «Persistencia y auditoría» más abajo).

### Ruta y control de acceso

En `api/[...path].js` y `server/index.js` (deben quedar **byte-idénticos**; lo exige `tests/backend-parity.test.mjs`, que compara ambos archivos):

```js
// Mismo mapa de acciones que ya lista 'POST /api/vigia/copilot/generate' y '.../feedback' (api/[...path].js:264-265)
'POST /api/vigia/copilot/preflight': ['vigia', ACTIONS.AI_COMMERCIAL_DRAFT_RUN],
```

```js
app.post('/api/vigia/copilot/preflight', async (req, res) => {
  try {
    const { profile } = await getAuthContext(req);
    const result = await createBackendAgt003PreflightApi(requireDb()).preflight({ profile, body: req.body });
    res.status(200).json(result);
  } catch (error) { sendAuthError(res, error); }
});
app.all('/api/vigia/copilot/preflight', (_req, res) => res.status(405).json({ error: 'Método no permitido.' }));
```

No se agrega ninguna acción nueva a `access-control.js`: reutiliza `ACTIONS.AI_COMMERCIAL_DRAFT_RUN`, la misma que ya protege `generate`/`feedback`, y la misma función `resolveAgt003OpportunityResource` (`api/[...path].js:2322-2327`) para resolver ownership — un comercial que puede generar la propuesta de una oportunidad puede pedir su preanálisis, ni más ni menos.

### Carga de contexto fresco (reutilizada, no duplicada)

`createBackendAgt003PreflightApi(database)` reutiliza **la misma** `loadAgt003OpportunityContext(database, opportunityId)` que ya usa `generate` (`api/[...path].js:2329-2353`): una consulta a `v_psi_sales_opportunity_enriched` más las últimas 20 filas de `psi_sales_interactions` (el historial cualitativo que la etapa 2 necesita ya está siendo cargado por código existente). Cada llamada HTTP a `/preflight` ejecuta esta carga de nuevo — contexto fresco garantizado por construcción, igual que en `generate`.

### Módulos nuevos (mismo patrón por-capacidad que ya usa `agt003-copilot-*`)

- **`agt003-preflight-contract.js`** (nuevo) — análogo a `agt003-copilot-contract.js`: `AGT003_PREFLIGHT_CAPABILITY = 'agt003.opportunity-preflight.preview'`, `AGT003_PREFLIGHT_CONTRACT_VERSION = 'agt003-preflight-v1'`, `validateAgt003PreflightRequest(value)`, `validateAgt003PreflightResponse(value, { request })` — objetos cerrados (`additionalProperties: false` a mano, mismo estilo que el módulo copilot), sin librería de JSON Schema en runtime.
- **`agt003-preflight-input.js`** (nuevo) — construye la solicitud. Reutiliza, sin reimplementar, las piezas ya probadas de `agt003-copilot-input.js`:
  - `redactAgt003CopilotText` y `agt003PreparationDate` se **importan tal cual** desde `./agt003-copilot-input.js` (ya son named exports; `agt002-workbench-responder.js:3` sienta el precedente de importarlos desde ahí para otra capacidad).
  - Las funciones hoy privadas `buildFacts`/`buildInteractions` de `agt003-copilot-input.js` se **exportan** (renombradas `buildAgt003Facts`/`buildAgt003Interactions`, sin cambiar su lógica, firma ni el esquema de `evidence_id` que ya producen: `evidence:opportunity:<id>:<field>` y `evidence:interaction:<id>`) para que `agt003-preflight-input.js` las reutilice en vez de reimplementar el truncado/orden/redacción de hechos e interacciones. Esto es una extensión de exports, no un archivo compartido nuevo: cero ficheros movidos, cero import roto (`tests/agt003-copilot-context-currency-date.test.mjs:126` sigue pasando porque no cambia la ruta de import de `agt003PreparationDate`).
  - `buildAgt003CopilotPreflightRequest({ opportunity, interactions, correlationId, snapshotId })` arma:
    ```ts
    {
      contract_version: 'agt003-preflight-v1',
      capability_id: 'agt003.opportunity-preflight.preview',
      correlation_id, snapshot_id,
      opportunity: { opportunity_id, title, company_name, stage, service, owner_name, facts }, // buildAgt003Facts
      interactions: [...],                                                                     // buildAgt003Interactions
      authority: { read_only: true, human_review_required: true, external_send_allowed: false, crm_write_allowed: false, public_research_allowed: false },
    }
    ```
    No incluye `approved_assets`: el preanálisis no recomienda adjuntos, sólo acciones de seguimiento.
- **`agt003-preflight-engine.js`** (nuevo) — análogo a `agt003-copilot-engine.js`: define el `outputSchema` que se envía al puente, valida la respuesta cruda del modelo, y expone `createAgt003PreflightEngine({ client, model, policyVersion, policyText, timeoutMs, maxConcurrent, dailyMaxRuns, countDailyRuns, now }).preflight(request, { signal })`. Mismo patrón interno que `draft()` (`agt003-copilot-engine.js:188-213`): un `Map` de `inflight` por `idempotencyKey` (por defecto `${snapshot_id}:${policyVersion}:${model}`) que colapsa dobles clics, y un contador `active`/`maxConcurrent` en memoria del proceso. `countDailyRuns` aquí es un **contador en memoria del proceso** (no una consulta a `psi_agt003_copilot_runs`, que no existe para esta capacidad — ver «Persistencia y auditoría»), inicializado en 0 y reseteado por día calendario UTC; su límite (`AGT003_PREFLIGHT_DAILY_MAX_RUNS`, por defecto 40) es una salvaguarda de costo de mejor esfuerzo, no una cuota global exacta entre instancias — se documenta como límite conocido, no se oculta (ver «Persistencia y auditoría»).
  - **Vocabulario cerrado de `issue_code`** (contrato, no texto libre): `next_action`, `close_date`, `decision_maker`, `stalled_conversation`, `pending_terms`, `escalation_needed`, `other`. Los tres primeros son los mismos nombres de categoría que usa `CommercialAlertCategory` en la etapa 1 — esto es lo que permite la consolidación exacta por clave sin comparar texto (ver «Deduplicación combinada»). Los otros cuatro cubren hallazgos que sólo el historial cualitativo puede revelar (retomar una conversación, aclarar términos, escalar internamente, u otro).
  - Cada acción de la respuesta declara `evidence_refs: string[]` (1 a 5 elementos) que deben existir entre los `evidence_id` del `request.opportunity.facts`/`request.interactions` — la misma validación anti-alucinación que ya aplica `validateAgt003CopilotResponse` sobre `brief.facts[].evidence_refs` (`tests/agt003-copilot-contract.test.mjs:86-88`); una referencia inventada hace fallar la respuesta como inválida (mismo código `AGT003_CLAUDE_INVALID_RESPONSE`/`SAFE_INVALID` que ya usa el motor de copilot).
- **`agt003-preflight-runtime.js`** (nuevo) — análogo a `agt003-copilot-runtime.js`, pero reutiliza la **misma conexión de puente** que copilot en vez de inventar credenciales nuevas: `agt003-copilot-runtime.js` exporta adicionalmente su función hoy privada `resolveRuntimeValues` (renombrada `resolveAgt003BridgeConnection`, sin cambio de lógica) para que el runtime de preflight arme el mismo `createAgt003CopilotBridgeClient` con las mismas variables de entorno (`AGT003_COPILOT_WIRE_PROTOCOL`, `AGT003_COPILOT_MODEL`, `AGT003_COPILOT_BRIDGE_URL`, `AGT003_COPILOT_HMAC_SECRET`) — es el mismo puente Claude, no uno nuevo. `isAgt003PreflightConfigured` es un alias directo de `isAgt003CopilotConfigured` (misma condición de configuración; no se duplica). Lo que sí es propio de esta capacidad, con sus propias variables de entorno y valores por defecto:
  - `AGT003_PREFLIGHT_POLICY_VERSION` (por defecto `'agt003-preflight-policy-v1'`) y un texto de política propio, corto, centrado en «leer el historial y proponer acciones de seguimiento, nunca redactar un correo ni tomar decisiones comerciales» — evita que el modelo se «adelante» y devuelva un borrador de correo en esta etapa.
  - `AGT003_PREFLIGHT_TIMEOUT_MS` (por defecto `20000`, más corto que los `30000` de `generate`: esta llamada no redacta un correo, sólo clasifica).
  - `AGT003_PREFLIGHT_MAX_CONCURRENT` (por defecto `1`) y `AGT003_PREFLIGHT_DAILY_MAX_RUNS` (por defecto `40`) — guardas en memoria de proceso, independientes de las de `generate`; ambos motores comparten el mismo `client.run` hacia el puente, así que si un `generate` y un `preflight` coinciden en el mismo proceso, el segundo en llegar recibe `AGT003_BRIDGE_BUSY` del propio puente (límite real de concurrencia hacia el proveedor) — la guarda en memoria de cada motor sólo evita intentos redundantes antes de siquiera llamar al puente.
- **`agt003-preflight-api.js`** (nuevo) — análogo a `agt003-copilot-api.js`, pero con muchas menos dependencias porque no hay persistencia:
  ```ts
  export function createAgt003PreflightApi(dependencies: {
    isConfigured: () => boolean;
    getConfig: () => PreflightConfig;
    resolveOpportunityResource: (opportunityId: string, profile: Profile) => Promise<Resource>;
    loadOpportunityContext: (opportunityId: string) => Promise<OpportunityContext>;
    createRuntime: () => { preflight: (request, opts?) => Promise<{ response, usage }> };
  }): { preflight(args: { profile: Profile; body: unknown }): Promise<PreflightResultPayload> };
  ```
  `preflight()` valida el cuerpo (`{ opportunity_id }`, mismas reglas de UUID que `parseGenerateBody`), resuelve el recurso y exige la acción, verifica configuración, carga contexto, construye la solicitud, y llama a `dependencies.createRuntime().preflight(request)`. Códigos de error propios (no se reutilizan los de `generate`, para que el cliente distinga qué etapa falló): `VIGIA_PREFLIGHT_BAD_REQUEST` (400), `VIGIA_PREFLIGHT_NOT_CONFIGURED` (503), `VIGIA_PREFLIGHT_CONTEXT_UNAVAILABLE` (503), `VIGIA_PREFLIGHT_SATURATED` (503, puente ocupado), `VIGIA_PREFLIGHT_SESSION_LIMIT` (503), `VIGIA_PREFLIGHT_QUOTA` (429, cuota de proceso agotada), `VIGIA_PREFLIGHT_UNAVAILABLE` (502, fallback genérico — incluye una respuesta inválida/con evidencia inventada, sin exponer el detalle interno). Payload de éxito: `{ status: 'completed', actions: PreflightAction[] }` — sin `run_id` ni `reused`, porque no hay una fila persistida a la que referirse.
- **`createBackendAgt003PreflightApi(database)`** en `api/[...path].js`/`server/index.js`, junto a `createBackendAgt003CopilotApi` (línea 2355): conecta las cinco dependencias a los mismos helpers de backend que ya existen (`resolveAgt003OpportunityResource`, `loadAgt003OpportunityContext`, `isAgt003PreflightConfigured`, `getAgt003PreflightRuntimeConfig`, `createAgt003PreflightRuntime`) — cero SQL nuevo, cero tabla nueva.

### Persistencia y auditoría

**Decisión: el preanálisis no persiste ninguna fila.** No escribe en `psi_agt003_copilot_runs` (esa tabla es la bitácora de ejecuciones de *generación*, con su propio esquema de idempotencia/cuota; reutilizarla mezclaría dos formas de auditoría distintas) y no se crea una tabla nueva (eso exigiría una migración, fuera de alcance por decisión explícita del diseño). El resultado del preanálisis vive únicamente en el estado de React del navegador (`opportunity-preflight-state.ts`) durante la sesión de la pestaña; al recargar la página o cambiar de oportunidad se pierde, y eso es aceptable porque es una recomendación de apoyo, no un registro comercial — el registro comercial real sigue siendo el CRM (interacciones, próxima gestión, decisor) y, para la propuesta final, los runs de `generate`.

Esto significa explícitamente que **no hay auditoría propia por fila** de qué acciones sugirió el preanálisis en cada oportunidad. La trazabilidad que sí existe: (a) el propio puente Claude (`agt003-claude-bridge-host.js`) registra cada turno de proveedor a nivel de infraestructura, igual que ya hace para `generate`, sin cambios; (b) el motor rechaza y registra en log (`console.warn`, mismo patrón que `agt003_copilot_output_rejected` en `agt003-copilot-engine.js:152,169`) cualquier respuesta inválida o con evidencia inventada, con un evento `agt003_preflight_output_rejected`. Si en el futuro se necesita una bitácora consultable de preanálisis por oportunidad, es una migración nueva y deliberada — no se simula aquí con un `TODO`.

**Ningún dato de la oportunidad se muta:** el preanálisis no escribe en `psi_sales_opportunities` ni en `psi_sales_interactions`; `authority.crm_write_allowed: false` en el contrato de solicitud lo hace explícito y `agt003-preflight-contract.js` lo valida igual que ya hace `agt003-copilot-contract.js` con `generate`.

### Contrato del agente (manifiesto v2-draft, capacidad nueva y aditiva)

Se agrega una capacidad al manifiesto existente `contracts/agents/AGT-003/v2-draft/manifest.json` (no se crea una v3 ni se toca `v1/`, que sigue `immutable: true`):

```json
{
  "id": "agt003.opportunity-preflight.preview",
  "mode": "preview",
  "persisted_results_only": false,
  "request_schema": "opportunity-preflight.request.schema.json",
  "response_schema": "opportunity-preflight.response.schema.json",
  "human_review_required": true,
  "external_send_allowed": false,
  "crm_write_allowed": false,
  "public_research_allowed": false
}
```

Con sus dos esquemas nuevos (mismo estilo cerrado que `opportunity-copilot.{request,response}.schema.json`: `additionalProperties: false` en todo objeto, `assertClosedObjects` del test de contrato debe seguir pasando):

`contracts/agents/AGT-003/v2-draft/opportunity-preflight.request.schema.json` — mismas formas de `opportunity.facts`/`interactions` que el schema de `generate` (reutilizadas, no reinventadas), sin `approved_assets`.

`contracts/agents/AGT-003/v2-draft/opportunity-preflight.response.schema.json`:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["contract_version", "capability_id", "correlation_id", "snapshot_id", "policy_version", "model", "generated_at", "actions"],
  "properties": {
    "contract_version": { "const": "agt003-preflight-v1" },
    "capability_id": { "const": "agt003.opportunity-preflight.preview" },
    "correlation_id": { "type": "string", "minLength": 1 },
    "snapshot_id": { "type": "string", "minLength": 1 },
    "policy_version": { "type": "string", "minLength": 1 },
    "model": { "type": "string", "minLength": 1 },
    "generated_at": { "type": "string", "format": "date-time" },
    "actions": {
      "type": "array",
      "maxItems": 8,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["issue_code", "title", "description", "evidence_refs"],
        "properties": {
          "issue_code": { "enum": ["next_action", "close_date", "decision_maker", "stalled_conversation", "pending_terms", "escalation_needed", "other"] },
          "title": { "type": "string", "minLength": 1, "maxLength": 200 },
          "description": { "type": "string", "minLength": 1, "maxLength": 1000 },
          "evidence_refs": { "type": "array", "minItems": 1, "maxItems": 5, "items": { "type": "string", "minLength": 1 } }
        }
      }
    }
  }
}
```

Con sus fixtures `fixtures/valid-opportunity-preflight-request.json` y `fixtures/valid-opportunity-preflight-response.json`, agregados a `manifest.json.fixtures` con el mismo patrón `{ path, schema, valid: true }` que ya usan las de `opportunity-copilot`.

### Continuidad sin preanálisis (requisito: no bloquear al comercial)

El preanálisis es el camino normal antes de generar, pero **no es obligatorio**: ni ejecutarlo, ni actuar sobre sus sugerencias. El botón «Generar propuesta con el contexto actual» (etapa 4):

- Si `preflightPhase === 'ready'` (el preanálisis de esta oportunidad, con este contexto, terminó bien): habilitado sin fricción adicional.
- Si `preflightPhase === 'loading'`: deshabilitado (evita generar mientras el análisis está en curso; no hay cancelación en este alcance).
- Si `preflightPhase === 'idle'` o `'error'` (nunca se ejecutó, o falló): habilitado sólo tras marcar una casilla explícita «Entiendo que no se ejecutó el análisis inteligente antes de generar» — esto es el «reconocer» que pide el diseño aprobado: no es un bloqueo duro (el comercial puede seguir sin IA por continuidad operativa), pero tampoco es silencioso.

Esta gobernanza (ejecutar o saltar el preanálisis, y la casilla de reconocimiento) es enteramente independiente de las alertas comerciales de la etapa 1. `canGenerate` sólo depende de `preflightPhase` y de la casilla; las alertas deterministas —incluida cualquiera con `code: 'overdue'` o `code: 'missing'`— **nunca** son un insumo de esa condición ni de ninguna otra puerta del flujo: son señales de lectura, no requisitos.

La casilla es estado local de `VigiaOpportunityCopilot` (no del módulo de estado del preanálisis) y se reinicia a no marcada cada vez que `preflightPhase` transiciona a `'idle'` — incluida una invalidación automática por cambio de contexto (ver «Frescura de contexto (etapa 2)»), para que un reconocimiento viejo nunca se arrastre a un contexto nuevo.

Un fallo del preanálisis (`preflightPhase === 'error'`) muestra el mensaje de error y un botón «Reintentar» que vuelve a disparar la misma llamada; no consume ni afecta la posibilidad de generar sin preanálisis descrita arriba.

## Deduplicación combinada

### Canónica, dentro de la etapa determinista (sin cambios respecto al diseño original)

Cada `CommercialAlert.key` es `${category}:${code}`. Como `buildCommercialAlerts` evalúa exactamente una vez cada una de las tres categorías fijas y cada función de `opportunity-ficha-presentation.ts` devuelve un único `FichaCardState`, la unicidad de `key` es una garantía estructural: no puede existir un `next_action:overdue` duplicado en la misma respuesta.

### Entre lo determinista y el preanálisis de IA (nueva)

`consolidatePreflightActions(actions)` agrupa las acciones devueltas por `/preflight` por `issue_code` exacto (no hay comparación difusa de texto en ningún punto de esta spec): varias acciones con el mismo `issue_code` se combinan en una sola — título de la primera, descripciones concatenadas con salto de línea si difieren, `evidence_refs` unidos y sin duplicados, preservando el primer orden de aparición del `issue_code`.

`mergeCommercialAlertsWithPreflight(alerts, actions)` hace el cruce con la etapa 1:

- Si el `issue_code` consolidado coincide con la `category` de una alerta determinista **actualmente activa**, esa acción se adjunta como `alerts[i].contextualAction` — se muestra como **sugerencia contextual**, opcional y de decisión humana, bajo el `risk_text` de esa misma alerta, pero **no** genera un ítem nuevo de riesgo ni una alerta adicional: es una única entrada enriquecida, nunca dos. La alerta no tiene ninguna acción por defecto que reemplazar (no existe `action_text`): sin sugerencia contextual, la alerta se muestra sólo con su `risk_text`.
- Si el `issue_code` es uno de los tres nombres de categoría (`next_action`/`close_date`/`decision_maker`) pero **no** hay ninguna alerta determinista activa para esa categoría en este momento (p. ej. el modelo señaló `decision_maker` pero el decisor ya está completo en los datos vigentes), la acción se descarta en silencio: los datos deterministas recién cargados son la fuente de verdad para esas tres categorías, y una recomendación de IA que las contradiga no se muestra como si fuera vigente.
- Si el `issue_code` no es ninguno de los tres nombres de categoría (`stalled_conversation`, `pending_terms`, `escalation_needed`, `other`), la acción no tiene una alerta determinista con la que fusionarse por definición — se agrega a `standaloneActions`, presentada por separado en el mismo panel de la etapa 2 como sugerencia opcional adicional, no asociada a ninguna alerta.

Esto resuelve, con una identidad exacta y sin heurísticas de similitud, los dos requisitos pedidos: «un issue determinístico puede tener una sola sugerencia contextual asociada, sin volver a presentar el mismo riesgo como otra alerta» y «varias acciones del mismo issue se consolidan».

### Frescura de contexto (etapa 2)

`opportunity-preflight-state.ts` (nuevo, análogo a `opportunity-copilot-state.ts`):

```ts
export type PreflightAction = { issue_code: string; title: string; description: string; evidence_refs: string[] };
export type PreflightResult = { actions: PreflightAction[] };

type PreflightBase = { opportunityId: string; contextFingerprint: string; sequence: number };
export type OpportunityPreflightState =
  | (PreflightBase & { phase: 'idle' })
  | (PreflightBase & { phase: 'loading'; requestId: number })
  | (PreflightBase & { phase: 'ready'; requestId: number; result: PreflightResult })
  | (PreflightBase & { phase: 'error'; requestId: number; message: string });

export function createOpportunityPreflightState(opportunityId: string, contextFingerprint: string): OpportunityPreflightState;
// Si opportunityId o contextFingerprint difieren del estado actual: reinicia a 'idle' con el fingerprint nuevo,
// salvo que phase === 'loading' (nunca se interrumpe una llamada en curso; ver completePreflightAnalysis).
export function invalidateStalePreflight(state: OpportunityPreflightState, opportunityId: string, contextFingerprint: string): OpportunityPreflightState;
export function beginPreflightAnalysis(state: OpportunityPreflightState, explicitRequestId?: number): { requestId: number; state: OpportunityPreflightState };
// Descarta el resultado (vuelve a 'idle' con el fingerprint nuevo) si currentContextFingerprint ya no coincide
// con el fingerprint capturado al iniciar la llamada: el contexto cambió mientras Vig-IA analizaba.
export function completePreflightAnalysis(state: OpportunityPreflightState, event: { opportunityId: string; requestId: number; result: PreflightResult; currentContextFingerprint: string }): OpportunityPreflightState;
export function failPreflightAnalysis(state: OpportunityPreflightState, event: { opportunityId: string; requestId: number; message: string }): OpportunityPreflightState;
```

`contextFingerprint` se construye en `src/main.tsx` como `` `${o.updated_at}|${o.last_interaction_at ?? ''}` ``: `updated_at` cambia cuando se edita cualquier campo de la oportunidad (decisor, fecha de cierre, etc.) y `last_interaction_at` cambia cuando se registra una nueva interacción/nota — exactamente las dos fuentes que alimentan el contexto que `/preflight` analiza. No se agrega ningún campo nuevo a la oportunidad: ambos ya existen en `Opportunity` (`src/main.tsx:59`, usado ya como fallback de ordenamiento en varias vistas, p. ej. `src/main.tsx:296,1449`).

Este mecanismo cubre los dos casos de «no mostrar acciones viejas como vigentes» pedidos: (a) el comercial edita el CRM *después* de ver el resultado del preanálisis → `invalidateStalePreflight` lo detecta en el siguiente render y vuelve a `'idle'`; (b) el comercial edita el CRM *mientras* el preanálisis está en curso → `completePreflightAnalysis` compara el fingerprint capturado al iniciar contra el vigente al completar, y si difieren descarta el resultado en vez de mostrarlo como `'ready'`.

## Comportamiento de la UI

### `VigiaOpportunityCopilot` (contenedor)

Nuevos props: `preflight: CommercialPreflightInput` (etapa 1, sin cambios respecto al diseño original) y `contextVersion: string` (fingerprint de etapa 2, ver arriba).

```tsx
type Props = { opportunityId: string; request: Request; preflight: CommercialPreflightInput; contextVersion: string };

export function VigiaOpportunityCopilot({ opportunityId, request, preflight, contextVersion }: Props) {
  const baseAlerts = buildCommercialAlerts(preflight);
  const [preflightState, setPreflightState] = useState(() => createOpportunityPreflightState(opportunityId, contextVersion));
  const [acknowledgedNoPreflight, setAcknowledgedNoPreflight] = useState(false);
  useEffect(() => {
    setPreflightState(current => invalidateStalePreflight(current, opportunityId, contextVersion));
  }, [opportunityId, contextVersion]);
  useEffect(() => { if (preflightState.phase === 'idle') setAcknowledgedNoPreflight(false); }, [preflightState.phase]);

  const merged = preflightState.phase === 'ready'
    ? mergeCommercialAlertsWithPreflight(baseAlerts, preflightState.result.actions)
    : { alerts: baseAlerts.map(a => ({ ...a, contextualAction: null })), standaloneActions: [] };

  // canGenerate depende sólo del preanálisis (etapa 2) y de la casilla de reconocimiento;
  // `merged.alerts`/`baseAlerts` (etapa 1) nunca son un insumo de esta condición.
  const canGenerate = state.phase !== 'loading' && preflightState.phase !== 'loading'
    && (preflightState.phase === 'ready' || acknowledgedNoPreflight);

  return <section className="vigia-opportunity-copilot" aria-labelledby="vigia-copilot-title">
    <header>...</header>                                              {/* sólo título/descripción, sin botón */}
    <VigiaCommercialAlerts alerts={merged.alerts} />                  {/* etapa 1 — siempre, antes de cualquier fase */}
    <VigiaPreflightAnalysis
      phase={preflightState.phase}
      standaloneActions={merged.standaloneActions}
      onAnalyze={() => runPreflight()}
      onRetry={() => runPreflight()}
      errorMessage={preflightState.phase === 'error' ? preflightState.message : null}
    />                                                                 {/* etapa 2 */}
    <div className="vigia-copilot-generate">
      {preflightState.phase !== 'ready' && preflightState.phase !== 'loading' && <label className="vigia-preflight-ack">
        <input type="checkbox" checked={acknowledgedNoPreflight} onChange={e => setAcknowledgedNoPreflight(e.target.checked)} />
        Entiendo que no se ejecutó el análisis inteligente antes de generar.
      </label>}
      <button type="button" disabled={!canGenerate} onClick={generate}>{state.phase === 'ready' ? 'Actualizar propuesta con el contexto actual' : 'Generar propuesta con el contexto actual'}</button>
    </div>
    {state.phase === 'loading' && ...}
    {state.phase === 'error' && ...}
    {ready && brief && <VigiaCopilotProposal .../>}
    {notice && ...}
  </section>;
}
```

`VigiaCommercialAlerts` y `VigiaPreflightAnalysis` se renderizan **siempre**, sin importar la fase de generación (`idle`/`loading`/`error`/`ready` de `state`): son capas independientes del ciclo de vida de la generación.

### `VigiaCommercialAlerts` (co-ubicado en `VigiaOpportunityCopilot.tsx`)

```tsx
function VigiaCommercialAlerts({ alerts }: { alerts: CommercialAlert[] }) {
  return <section className="notice vigia-preflight-alerts" aria-labelledby="vigia-preflight-title">
    <h4 id="vigia-preflight-title">Alertas comerciales</h4>
    {alerts.length === 0
      ? <p className="muted">Sin alertas comerciales detectadas.</p>
      : <>
          <p>{COMMERCIAL_PREFLIGHT_EXPLANATION}</p>
          <ul>{alerts.map(a => <li key={a.key}>
            {a.risk_text}
            {a.contextualAction && <p className="vigia-preflight-suggestion"><strong>Sugerencia contextual:</strong> {a.contextualAction.description}</p>}
          </li>)}</ul>
        </>}
  </section>;
}
```

No hay ninguna sección/lista «Acciones para mejorar la propuesta»: cada alerta muestra únicamente su `risk_text` factual y, si el preanálisis le asoció una, su sugerencia contextual opcional inmediatamente debajo, etiquetada «Sugerencia contextual:». Sin preanálisis o sin coincidencia, la alerta se muestra sin ninguna acción — nunca con un texto de acción genérico, porque `CommercialAlert` no tiene ningún campo de acción por defecto.

Estado vacío (`alerts.length === 0`): el contenedor **no desaparece** — sigue siendo la misma capa canónica, con un mensaje de confirmación en vez de la lista.

### `VigiaPreflightAnalysis` (nuevo, co-ubicado en `VigiaOpportunityCopilot.tsx`)

```tsx
function VigiaPreflightAnalysis({ phase, standaloneActions, onAnalyze, onRetry, errorMessage }: {
  phase: 'idle' | 'loading' | 'error' | 'ready';
  standaloneActions: ConsolidatedPreflightAction[];
  onAnalyze: () => void; onRetry: () => void; errorMessage: string | null;
}) {
  return <section className="vigia-preflight-analysis" aria-labelledby="vigia-preflight-analysis-title">
    <h4 id="vigia-preflight-analysis-title">Análisis inteligente del seguimiento</h4>
    {phase === 'idle' && <button type="button" onClick={onAnalyze}>Analizar cómo fortalecer el seguimiento</button>}
    {phase === 'loading' && <div className="notice" role="status">{VIGIA_VISIBLE_NAMES.commercial} está revisando el historial de la oportunidad…</div>}
    {phase === 'error' && <div className="error" role="alert"><strong>No fue posible analizar el historial.</strong><p>{errorMessage}</p><button type="button" onClick={onRetry}>Reintentar</button></div>}
    {phase === 'ready' && <>
      {standaloneActions.length === 0
        ? <p className="muted">Vig-IA no encontró sugerencias adicionales fuera de las alertas comerciales.</p>
        : <ul className="vigia-preflight-standalone">{standaloneActions.map(a => <li key={a.issue_code}><strong>{a.title}</strong><p>{a.description}</p></li>)}</ul>}
      <button type="button" className="secondary" onClick={onAnalyze}>Actualizar análisis</button>
    </>}
  </section>;
}
```

### `VigiaCopilotProposal` (propuesta generada, tras «Generar propuesta con el contexto actual»)

Sin cambios respecto al diseño original: se elimina `<section className="vigia-copilot-missing">` («Antes de contactar»), se elimina `<div className="notice vigia-copilot-warnings">` (segunda «Alertas comerciales»), `strategy` se renombra a **«Plan de contacto»** en `<ol>` (vía `contactPlanSteps`, ver `copilot-presentation.ts`), y `<div className="vigia-human-warning">` se reposiciona inmediatamente después de `<div className="vigia-copilot-actions">`, antes de `<details className="vigia-copilot-context">`.

```tsx
export function VigiaCopilotProposal({ brief, draft, onDraftChange, onCopy, onDiscard }: ProposalProps) {
  const presented = presentCopilotBrief(brief);
  return <div className="vigia-copilot-result">
    <section className="vigia-copilot-plan"><h4>Plan de contacto</h4>
      <ol>{presented.contactPlanSteps.map((step, index) => <li key={index}>{step}</li>)}</ol>
    </section>
    <div className="vigia-copilot-draft">...</div>            {/* sin cambios */}
    <div className="vigia-copilot-actions">...</div>           {/* sin cambios */}
    <div className="vigia-human-warning">...</div>             {/* reposicionado aquí */}
    <details className="vigia-copilot-context">...</details>   {/* sin cambios de contenido; al final */}
  </div>;
}
```

### `copilot-presentation.ts`

`PresentedCopilotBrief` pierde `missingInformation` y `warnings`, gana `contactPlanSteps`:

```ts
export type PresentedCopilotBrief = {
  summary: string;
  facts: CopilotPresentationFact[];
  inferences: CopilotPresentationInference[];
  contactObjective: string;
  contactPlanSteps: string[];       // reemplaza a `strategy` en el render
  recommendedAssetIds: string[];
  hasApprovedAssets: boolean;
};

export function splitContactPlanSteps(text: string): string[];
```

`presentCopilotBrief` sigue saneando `brief.strategy` con el mismo `presentCommercialText`/fallback de siempre, y sólo al final aplica `splitContactPlanSteps` sobre el texto ya saneado — nunca sobre el texto crudo del modelo.

Al retirar `missingInformation`/`warnings` de la salida, quedan sin ningún consumidor y se eliminan del módulo (no se dejan como código muerto): `filterMissingInformation`, `filterCommercialWarnings`, `collectContextText`, `hasExplicitCurrency`, `isCurrencyGapRequest`, `COMMERCIAL_DEFAULT_CURRENCY`. `isTechnicalCopilotText`, `TECHNICAL_PATTERNS`, `filterCommercialEntries`, `presentCommercialText`, `COMMERCIAL_TEXT_FALLBACKS` y `normalizeCopilotErrorMessage` siguen usándose y no cambian.

**`splitContactPlanSteps` — algoritmo determinístico, sin cambios de contrato del agente:**

1. Si el texto trae saltos de línea explícitos (`\n`), cada línea no vacía es un paso.
2. Si es un único bloque, se intenta dividir por límite de oración (`/(?<=[.;:])\s+(?=[A-ZÁÉÍÓÚÑ¿¡])/`); si produce más de un fragmento, cada fragmento es un paso.
3. Si ninguna de las dos divisiones aplica, el texto completo es el único paso.
4. Si cualquiera de las dos divisiones produce **más de 8** fragmentos, se descarta la división y se usa el texto completo como único paso.
5. Nunca devuelve un arreglo vacío.

**Alternativa descartada:** extender el contrato de `generate` con un campo `strategy_steps: string[]` generado directamente por el modelo. Se descarta porque implica una nueva versión de ese contrato, cambios de prompt/política y fixtures, y tocar `agt003-copilot-engine.js`/`agt003-copilot-runtime.js` — la división determinística en presentación cubre el requisito sin ese costo, y no interfiere con el contrato nuevo de preanálisis (que es un capacidad distinta, no una versión de `generate`).

### `src/main.tsx` (único call-site)

```tsx
{canRenderOpportunityCopilot(data.currentProfile, o.service_type_code) && <VigiaOpportunityCopilot
  opportunityId={o.id}
  request={api}
  preflight={{ nextAction: priorityNextAction, expectedClose: priorityClose, decisionMaker: priorityDecisionMaker }}
  contextVersion={`${o.updated_at}|${o.last_interaction_at ?? ''}`}
/>}
```

`priorityNextAction`, `priorityClose` y `priorityDecisionMaker` ya existen (`src/main.tsx:805-807`); `o.updated_at`/`o.last_interaction_at` ya existen en el tipo `Opportunity` (`src/main.tsx:59`). No se duplica ningún cálculo.

## Contratos (resumen)

```ts
// src/vigia/opportunity-preflight-presentation.ts
export type CommercialAlertCategory = 'next_action' | 'close_date' | 'decision_maker';
export type CommercialAlert = { key: string; category: CommercialAlertCategory; risk_text: string; contextualAction: ConsolidatedPreflightAction | null };
export type CommercialPreflightInput = { nextAction: FichaCardState; expectedClose: FichaCardState; decisionMaker: FichaCardState };
export const COMMERCIAL_PREFLIGHT_EXPLANATION: string;
export function buildCommercialAlerts(input: CommercialPreflightInput): Omit<CommercialAlert, 'contextualAction'>[];
export const KNOWN_PREFLIGHT_ISSUE_CODES: readonly CommercialAlertCategory[];
export type PreflightAction = { issue_code: string; title: string; description: string; evidence_refs: string[] };
export type ConsolidatedPreflightAction = { issue_code: string; title: string; description: string; evidence_refs: string[] };
export function consolidatePreflightActions(actions: PreflightAction[]): ConsolidatedPreflightAction[];
export type PreflightMergeResult = { alerts: CommercialAlert[]; standaloneActions: ConsolidatedPreflightAction[] };
export function mergeCommercialAlertsWithPreflight(alerts: Omit<CommercialAlert, 'contextualAction'>[], preflightActions: PreflightAction[]): PreflightMergeResult;

// src/vigia/opportunity-preflight-state.ts
export type OpportunityPreflightState = /* idle | loading | error | ready, ver "Frescura de contexto (etapa 2)" */ unknown;
export function createOpportunityPreflightState(opportunityId: string, contextFingerprint: string): OpportunityPreflightState;
export function invalidateStalePreflight(state: OpportunityPreflightState, opportunityId: string, contextFingerprint: string): OpportunityPreflightState;
export function beginPreflightAnalysis(state: OpportunityPreflightState, explicitRequestId?: number): { requestId: number; state: OpportunityPreflightState };
export function completePreflightAnalysis(state: OpportunityPreflightState, event: { opportunityId: string; requestId: number; result: { actions: PreflightAction[] }; currentContextFingerprint: string }): OpportunityPreflightState;
export function failPreflightAnalysis(state: OpportunityPreflightState, event: { opportunityId: string; requestId: number; message: string }): OpportunityPreflightState;

// src/vigia/copilot-presentation.ts (cambios)
export type PresentedCopilotBrief = { summary: string; facts: CopilotPresentationFact[]; inferences: CopilotPresentationInference[]; contactObjective: string; contactPlanSteps: string[]; recommendedAssetIds: string[]; hasApprovedAssets: boolean };
export function splitContactPlanSteps(text: string): string[];
export function presentCopilotBrief(brief: CopilotPresentationBrief): PresentedCopilotBrief;

// src/vigia/VigiaOpportunityCopilot.tsx (cambios)
type Props = { opportunityId: string; request: Request; preflight: CommercialPreflightInput; contextVersion: string };

// Backend nuevo
// agt003-preflight-contract.js
export const AGT003_PREFLIGHT_CAPABILITY = 'agt003.opportunity-preflight.preview';
export const AGT003_PREFLIGHT_CONTRACT_VERSION = 'agt003-preflight-v1';
export function validateAgt003PreflightRequest(value: unknown): unknown;
export function validateAgt003PreflightResponse(value: unknown, opts: { request: unknown }): unknown;
// agt003-preflight-input.js
export function buildAgt003CopilotPreflightRequest(args: { opportunity: unknown; interactions: unknown[]; correlationId: string; snapshotId: string }): unknown;
// agt003-preflight-engine.js
export function createAgt003PreflightEngine(args: { client: unknown; model: string; policyVersion: string; policyText: string; timeoutMs: number; maxConcurrent: number; dailyMaxRuns: number; countDailyRuns?: () => Promise<number>; now?: () => string }): { preflight(request: unknown, opts?: { idempotencyKey?: string; signal?: AbortSignal }): Promise<{ response: unknown; usage: unknown }> };
// agt003-preflight-runtime.js
export const isAgt003PreflightConfigured: (environment?: NodeJS.ProcessEnv) => boolean; // alias de isAgt003CopilotConfigured
export function getAgt003PreflightRuntimeConfig(environment?: NodeJS.ProcessEnv): unknown;
export function createAgt003PreflightRuntime(args?: { environment?: NodeJS.ProcessEnv }): { preflight(request: unknown, opts?: unknown): Promise<unknown> };
// agt003-preflight-api.js
export function createAgt003PreflightApi(dependencies: unknown): { preflight(args: { profile: unknown; body: unknown }): Promise<{ status: 'completed'; actions: unknown[] }> };
// agt003-copilot-input.js (extensión de exports, sin cambio de comportamiento)
export function buildAgt003Facts(opportunity: unknown, preparationDate: string): unknown[]; // antes privada `buildFacts`
export function buildAgt003Interactions(interactions: unknown[]): unknown[];               // antes privada `buildInteractions`
// agt003-copilot-runtime.js (extensión de exports, sin cambio de comportamiento)
export function resolveAgt003BridgeConnection(environment?: NodeJS.ProcessEnv): { wireProtocol: string; model?: string; bridgeUrl?: string; hmacSecret?: string }; // antes privada `resolveRuntimeValues`
```

`CopilotPresentationBrief` (lo que devuelve `/api/vigia/copilot/generate`) **no cambia**: sigue incluyendo `missing_information`/`warnings`; sólo cambia lo que la capa de presentación expone hacia la UI.

## Estados UI

| Componente | Loading | Error | Vacío | Listo |
|---|---|---|---|---|
| `VigiaCommercialAlerts` (etapa 1) | *(no aplica — cálculo síncrono, sin red)* | *(no aplica)* | `alerts.length === 0` → «Sin alertas comerciales detectadas.» | `alerts.length > 0` → frase explicativa + `<ul>` con el `risk_text` de cada alerta y, si existe, su `contextualAction.description` como «Sugerencia contextual:» debajo — nunca bloquea, nunca influye en `canGenerate` |
| `VigiaPreflightAnalysis` (etapa 2, `preflightState.phase`) | `loading` → notice `role="status"`, botón «Analizar»/«Actualizar» oculto | `error` → `div.error role="alert"` + botón «Reintentar» | `idle` → sólo el botón «Analizar cómo fortalecer el seguimiento» | `ready` → `standaloneActions` (lista de sugerencias opcionales o mensaje «sin sugerencias adicionales») + botón «Actualizar análisis» |
| Generación (etapa 4, `state.phase`) | `loading` → notice `role="status"` (sin cambios) | `error` → `div.error role="alert"` (sin cambios) | `idle` → `.vigia-copilot-empty` (sin cambios) | `ready` → `VigiaCopilotProposal` (contenido interno cambia, ver arriba) |
| Botón «Generar…» | deshabilitado si `preflightState.phase === 'loading'` | — | — | habilitado si `preflightState.phase === 'ready'` o si la casilla de reconocimiento está marcada — condición independiente de las alertas de la etapa 1 |
| `VigiaCopilotProposal` → Plan de contacto | — | — | *(no puede estar vacío: `contactPlanSteps` nunca es `[]`)* | `<ol>` con 1+ `<li>` |

Invalidación: cualquier cambio de `opportunityId` o `contextVersion` reinicia `preflightState` a `'idle'` (`invalidateStalePreflight`, salvo que haya una llamada en curso, que se descarta al completar si el contexto ya cambió — ver «Frescura de contexto (etapa 2)»). La casilla de reconocimiento se reinicia junto con `'idle'`. Esto garantiza que nunca se muestren sugerencias de un contexto anterior como vigentes.

## Accesibilidad

- `VigiaCommercialAlerts` y `VigiaPreflightAnalysis` son `<section aria-labelledby="...">` con un `<h4 id="...">` real, igual criterio que ya se usó para `aria-label="Resumen prioritario de la oportunidad"` en el mismo archivo.
- Los riesgos van en `<ul>` (cada `<li>` incluye su `risk_text` y, si existe, la sugerencia contextual asociada); las sugerencias independientes de la etapa 2 (`standaloneActions`) van en su propio `<ul>` — semántica de lista real, no párrafos con guiones.
- `Plan de contacto` usa `<ol>` en vez de `<p>`: cada paso es navegable individualmente.
- El estado `loading` de `VigiaPreflightAnalysis` usa `role="status"` (anuncio no interruptor) y el estado `error` usa `role="alert"` (anuncio inmediato) — mismo criterio ya usado en la generación.
- El botón «Reintentar» y el botón «Analizar»/«Actualizar análisis» son `<button type="button">` normales, alcanzables por teclado, sin `tabindex` manual.
- La casilla de reconocimiento usa `<label>` envolviendo `<input type="checkbox">` (asociación implícita, sin `aria-label` redundante) y su texto explica la consecuencia («no se ejecutó el análisis inteligente»), no sólo una instrucción genérica.
- No hay foco programático nuevo: ninguna sección es un modal ni un toast.
- `.vigia-human-warning`, al reposicionarse, conserva su rol implícito de texto informativo; no se le agrega `role="alert"`.

## CSS (aditivo)

```css
.vigia-preflight-alerts{display:grid;gap:8px}
.vigia-preflight-alerts h4{margin:0;color:#124174}
.vigia-preflight-alerts ul{margin:0;padding-left:20px;display:grid;gap:6px}
.vigia-preflight-alerts .vigia-preflight-suggestion{margin:2px 0 0;font-size:13px;color:#374151}
.vigia-preflight-analysis{display:grid;gap:8px;margin-top:8px}
.vigia-preflight-analysis h4{margin:0;color:#124174}
.vigia-preflight-standalone{margin:0;padding-left:20px;display:grid;gap:6px}
.vigia-copilot-generate{display:grid;gap:6px;margin-top:8px}
.vigia-preflight-ack{display:flex;gap:6px;align-items:flex-start;font-size:13px;color:#5b6472}
.vigia-copilot-plan ol{margin:0;padding-left:20px;display:grid;gap:6px}
```

No se modifica ninguna regla existente. `.vigia-preflight-alerts`/`.vigia-preflight-analysis` reutilizan `.notice`/`.error` (`src/styles.css:44`) como clase base para fondo/padding donde aplica.

## Pruebas

### Unitarias

- **`tests/agt003-preflight-alerts-presentation.test.mjs`** (nuevo) — `buildCommercialAlerts` (tabla de casos, unicidad de `key`, pureza, cada alerta expone únicamente `key`/`category`/`risk_text` — sin ningún campo de acción, ni `action_text`) **más**: `consolidatePreflightActions` (agrupa por `issue_code` exacto, sin comparar texto; conserva orden de primera aparición; une `evidence_refs` sin duplicados) y `mergeCommercialAlertsWithPreflight` (una acción con `issue_code` de categoría activa se adjunta como `contextualAction` sin crear una alerta nueva; una acción con `issue_code` de categoría sin alerta activa se descarta; una acción con `issue_code` fuera del vocabulario de categorías cae en `standaloneActions`; con `actions: []` todas las alertas tienen `contextualAction: null` y `standaloneActions` es `[]`).
- **`tests/agt003-preflight-state.test.mjs`** (nuevo) — `createOpportunityPreflightState`/`beginPreflightAnalysis`/`completePreflightAnalysis`/`failPreflightAnalysis`/`invalidateStalePreflight`: transiciones válidas, eventos con `requestId`/`opportunityId` obsoletos se ignoran (mismo patrón que ya prueba `opportunity-copilot-state.ts`), y el caso propio de esta capa — `completePreflightAnalysis` con `currentContextFingerprint` distinto al capturado al iniciar descarta el resultado y vuelve a `'idle'` con el fingerprint nuevo.
- **`tests/agt003-copilot-presentation.test.mjs`** (actualizar) — mismos cambios que en el diseño original: retirar aserciones sobre `missingInformation`/`warnings`/símbolos eliminados; reemplazar por `contactPlanSteps`; casos de `splitContactPlanSteps`.
- **`tests/agt003-preflight-input.test.mjs`** (nuevo) — `buildAgt003CopilotPreflightRequest` produce `evidence_id` idénticos en forma a los que ya prueba `tests/agt003-copilot-input.test.mjs` para `buildAgt003Facts`/`buildAgt003Interactions` (mismo truncado, mismo orden, misma redacción); el objeto resultante no incluye `approved_assets`.
- **`tests/agt003-copilot-input.test.mjs`** (actualizar) — agregar casos para los exports nuevos `buildAgt003Facts`/`buildAgt003Interactions` (mismas aserciones que hoy corren sobre las funciones privadas equivalentes, sin cambiar el comportamiento probado).

### Contrato

- **`tests/agt003-preflight-contract.test.mjs`** (nuevo, mismo esqueleto que `tests/agt003-copilot-contract.test.mjs`): carga `manifest.json`, `opportunity-preflight.{request,response}.schema.json` y sus fixtures; `assertClosedObjects` sobre ambos esquemas; `validateSchema`/`validateAgt003PreflightRequest`/`validateAgt003PreflightResponse` aceptan la fixture válida; casos negativos — `issue_code` fuera del enum, `evidence_refs` con una referencia inventada (mismo patrón que la línea 86-88 del test de copilot), objeto con clave inesperada, `snapshot_id` no coincidente con la solicitud.
- **`tests/agt003-copilot-contract.test.mjs`** (sin cambios de aserciones; se ejecuta igual, ya que el manifiesto sigue conteniendo la capacidad de `generate` sin modificar sus campos).

### Motor y runtime

- **`tests/agt003-preflight-engine.test.mjs`** (nuevo, mismo esqueleto que `tests/agt003-copilot-engine.test.mjs`): `createAgt003PreflightEngine(...).preflight(request)` valida la solicitud, llama a `client.run` con el `outputSchema` correcto, rechaza una respuesta con `evidence_refs` inventados o `issue_code` fuera del enum, colapsa llamadas concurrentes con la misma `idempotencyKey` por defecto, respeta `maxConcurrent`/`dailyMaxRuns` en memoria.
- **`tests/agt003-preflight-runtime.test.mjs`** (nuevo, mismo esqueleto que `tests/agt003-copilot-runtime.test.mjs`): `isAgt003PreflightConfigured` es idéntico a `isAgt003CopilotConfigured` para el mismo entorno; `getAgt003PreflightRuntimeConfig` resuelve sus propias variables (`AGT003_PREFLIGHT_*`) con los valores por defecto documentados; `resolveAgt003BridgeConnection` (reexportada desde `agt003-copilot-runtime.js`) sigue siendo la fuente única de la conexión al puente.
- **`tests/agt003-preflight-api.test.mjs`** (nuevo, mismo esqueleto que `tests/agt003-copilot-api.test.mjs`): valida cuerpo (`opportunity_id` obligatorio, UUID), exige la acción `AI_COMMERCIAL_DRAFT_RUN` vía `resolveOpportunityResource`, mapea cada código de error (`VIGIA_PREFLIGHT_*`) a su status HTTP, no invoca ninguna dependencia de persistencia (el mock de dependencias no incluye `claimRun`/`recordRun`/etc. y la prueba falla si `createAgt003PreflightApi` los exige).

### HTTP

- **`tests/agt003-preflight-endpoint-static.test.mjs`** (nuevo, mismo esqueleto que `tests/agt003-copilot-endpoint-static.test.mjs`): confirma que tanto `api/[...path].js` como `server/index.js` incluyen `'POST /api/vigia/copilot/preflight': ['vigia', ACTIONS.AI_COMMERCIAL_DRAFT_RUN]` y la ruta `app.post('/api/vigia/copilot/preflight', ...)`/`app.all(...)`.
- **`tests/agt003-copilot-endpoint-static.test.mjs`** (sin cambios: sigue verificando únicamente `generate`/`feedback`, que no se modifican).
- **`tests/opportunity-auth-errors.integration.test.mjs`** (actualizar) — agregar el caso `POST /api/vigia/copilot/preflight` sin sesión → 401, con sesión pero sin ownership del área de la oportunidad → 403, mismo patrón que ya cubre `generate`.
- **`tests/agt003-preflight-end-to-end.integration.test.mjs`** (nuevo, mismo esqueleto que `tests/agt003-copilot-end-to-end.integration.test.mjs` pero contra `/preflight`): con un doble de puente que devuelve una respuesta válida, el endpoint responde `200` con `{ status: 'completed', actions: [...] }`; con un doble que devuelve `evidence_refs` inventados, responde `502 VIGIA_PREFLIGHT_UNAVAILABLE`; dos llamadas concurrentes con el mismo `opportunity_id` y snapshot sin cambios sólo generan un turno de proveedor (verifica el `inflight` del motor).
- **`tests/agt003-copilot-end-to-end.integration.test.mjs`**, **`tests/agt003-copilot-pglite.integration.test.mjs`** (sin cambios esperados en su resultado: `generate` no cambia de contrato ni de comportamiento).

### Paridad

- **`tests/backend-parity.test.mjs`** (sin cambios de aserciones, pero es la prueba que obliga a que la nueva ruta se agregue **idénticamente** en `api/[...path].js` y `server/index.js`: compara ambos archivos byte a byte). No se necesita ninguna prueba de paridad adicional para este cambio.

### Estáticas

- **`tests/vigia-opportunity-copilot-ui-static.test.mjs`** (actualizar) — agregar a los marcadores requeridos: `Alertas comerciales`, `Sugerencia contextual`, `Plan de contacto`, `Analizar cómo fortalecer el seguimiento`, `Generar propuesta con el contexto actual`, `Entiendo que no se ejecutó el análisis inteligente`, `buildCommercialAlerts`, `mergeCommercialAlertsWithPreflight`, `contactPlanSteps`; agregar a los prohibidos: `Antes de contactar`, `Acción recomendada`, `Acciones para mejorar la propuesta`, `action_text`, `vigia-copilot-missing`, `vigia-copilot-warnings`, `Preparar seguimiento` (el botón original desaparece; su texto no debe seguir presente en ningún punto).

### Render

- **`tests/agt003-copilot-proposal-render.test.mjs`** (actualizar, `renderReactComponent` real): `Plan de contacto` antes de `vigia-copilot-draft`; `vigia-human-warning` antes de `vigia-copilot-context`; ausencia total de `Antes de contactar` y de una segunda ocurrencia de `Alertas comerciales` dentro del HTML de `VigiaCopilotProposal`; el `<ol>` de `vigia-copilot-plan` contiene tantos `<li>` como pasos produce `splitContactPlanSteps`.
- **`tests/agt003-preflight-alerts-render.test.mjs`** (nuevo, `renderReactComponent` real) para `VigiaCommercialAlerts` y `VigiaPreflightAnalysis`: `VigiaCommercialAlerts` con `alerts: []` → «Sin alertas comerciales detectadas.»; cada `<li>` muestra siempre el `risk_text` de la alerta; con una alerta cuyo `contextualAction` es `null` → no aparece ningún texto de «Sugerencia contextual:» ni ningún otro texto de acción para esa alerta (no hay `action_text` en el tipo, así que no hay nada que caiga por defecto); con una alerta cuyo `contextualAction` no es `null` → aparece «Sugerencia contextual:» seguido de `contextualAction.description` debajo del `risk_text` de esa misma alerta; el HTML nunca contiene «Acciones para mejorar la propuesta»; `VigiaPreflightAnalysis` en cada fase (`idle`/`loading`/`error`/`ready`) renderiza exactamente los elementos de la tabla «Estados UI»; en `ready` con `standaloneActions` no vacío, cada sugerencia aparece con su `title`/`description` y sin exponer `evidence_refs` en el HTML.

### E2E manual

Checklist contra un entorno con datos reales/seed (una oportunidad no licitatoria, permiso `vigia_copilot_pilot` activo, `AGT003_COPILOT_ENGINE`/variables de puente configuradas):

1. Abrir una oportunidad con próxima gestión vencida y decisor sin correo/teléfono → «Alertas comerciales» debe verse de inmediato, con 2 señales factuales (`risk_text`) y ninguna acción/instrucción asociada todavía, **sin** haber pulsado ningún botón. Confirmar que el botón «Generar propuesta con el contexto actual» no está condicionado por estas alertas (su estado depende únicamente del preanálisis y de la casilla de reconocimiento).
2. Pulsar «Analizar cómo fortalecer el seguimiento» → ver el estado de carga, y al completar, confirmar que las alertas cuyo `issue_code` coincide ahora muestran, debajo de su `risk_text`, una «Sugerencia contextual:» con la descripción devuelta por Vig-IA (opcional, no reemplaza nada porque no había ninguna acción por defecto), y que cualquier sugerencia de tipo `stalled_conversation`/`pending_terms`/`escalation_needed` aparece en la lista separada de sugerencias adicionales.
3. Editar la oportunidad (completar el correo del decisor) → al volver al detalle: la alerta de decisor desaparece de «Alertas comerciales» sin recargar manualmente, y el panel de análisis inteligente vuelve a mostrar el botón «Analizar cómo fortalecer el seguimiento» (no las sugerencias viejas).
4. Sin volver a analizar, pulsar «Generar propuesta con el contexto actual» aunque sigan visibles alertas con fecha vencida o faltante → debe aparecer la casilla de reconocimiento; sin marcarla el botón de generar permanece deshabilitado; al marcarla se habilita y la generación se completa con normalidad — confirmar que las alertas deterministas por sí solas nunca bloquean este paso.
5. Repetir el análisis inteligente hasta `ready` y luego generar sin pasar por la casilla (debe estar habilitado directamente).
6. Provocar un fallo del preanálisis (p. ej. desconectando temporalmente el puente) → ver el mensaje de error con «Reintentar»; confirmar que aun así se puede generar la propuesta marcando la casilla.
7. Tras generar: confirmar «Plan de contacto» con pasos numerados, ausencia de «Antes de contactar», ausencia de una segunda «Alertas comerciales» dentro de la propuesta, «Revisión humana» inmediatamente debajo de «Copiar correo»/«Descartar», y «Contexto analizado» plegado al final.
8. Abrir una oportunidad sin ningún riesgo determinista → «Sin alertas comerciales detectadas.», y tras analizar, si Vig-IA tampoco encuentra nada en el historial, «Vig-IA no encontró sugerencias adicionales fuera de las alertas comerciales.»
9. Verificar con el árbol de accesibilidad del navegador que ambas secciones (alertas y análisis inteligente) se anuncian como regiones con nombre propio, que el estado de carga se anuncia como `status` y el de error como `alert`.

## Rollout

Se despliega en el mismo ciclo que el resto de cambios de AGT-003 (mismo repo, mismo build). Sigue detrás del mismo guard existente (`canRenderOpportunityCopilot`, que ya exige `vigia_copilot_pilot`) — no se introduce una bandera de features nueva para la UI. La ruta `/preflight` queda protegida por la misma acción de control de acceso que `generate`; si el puente Vig-IA no está configurado en un entorno (`isAgt003PreflightConfigured` → `false`), el endpoint responde `503 VIGIA_PREFLIGHT_NOT_CONFIGURED` y la UI lo muestra como el estado `error` normal de `VigiaPreflightAnalysis` — el resto del flujo (alertas deterministas, generación) sigue funcionando sin degradarse, porque el preanálisis nunca es obligatorio. Verificación manual (checklist E2E de arriba) contra al menos una cuenta piloto real antes de mergear a `main`, incluyendo al menos un ciclo con el puente deliberadamente no configurado para confirmar la degradación descrita.

## Rollback

No hay migraciones que revertir (esta spec no crea tablas ni columnas) y no hay datos escritos por `/preflight` que limpiar (no persiste nada, ver «Persistencia y auditoría»). Revertir es un revert simple del commit/PR que: (a) retira la ruta `/preflight` de `api/[...path].js` y `server/index.js` en el mismo cambio (mantiene la paridad byte a byte durante todo el rollback, no sólo al final), (b) retira los módulos `agt003-preflight-*.js` y la capacidad nueva del manifiesto de contratos, y (c) revierte los componentes de frontend a su forma anterior. Un rollback parcial que deje la ruta backend pero retire la UI es seguro (el endpoint simplemente queda sin invocar) pero no es la opción recomendada — se documenta como aceptable, no como el camino esperado.

## Fuera de alcance

- Cambios al contrato de `POST /api/vigia/copilot/generate` o `POST /api/vigia/copilot/feedback`: mismo request/response schema, mismo `agt003-copilot-engine.js`/`agt003-copilot-runtime.js`/`agt003-copilot-persistence.js`, sin cambios.
- `brief.missing_information` y `brief.warnings` se siguen generando y persistiendo en `psi_agt003_copilot_runs` sin cambios (auditoría de `generate` intacta); esta spec sólo deja de renderizarlos en la UI.
- Persistencia propia del preanálisis: no se crea una tabla ni una fila de auditoría por ejecución de `/preflight` (ver «Persistencia y auditoría» — es una decisión explícita, no un olvido).
- Cualquier migración de base de datos: no se necesita ninguna para lo descrito en esta spec.
- Acciones o permisos nuevos en `access-control.js`: `/preflight` reutiliza `ACTIONS.AI_COMMERCIAL_DRAFT_RUN`.
- Categorías de alerta deterministas nuevas más allá de `next_action`, `close_date`, `decision_maker` (p. ej. valor de oferta ausente) — no se inventan umbrales nuevos no solicitados.
- Ampliar el vocabulario de `issue_code` del preanálisis más allá de los siete valores listados, o convertirlo en texto libre — es un cambio de contrato deliberado y futuro si se necesita, no algo que esta spec deje abierto.
- Ejecutar acciones automáticamente sobre el CRM desde el panel del preanálisis (crear una interacción, reagendar la próxima gestión, etc.): el comercial actúa manualmente sobre el CRM existente; el preanálisis nunca escribe.
- Cambios a `src/vigia/opportunity-ficha-presentation.ts` o a sus pruebas existentes: se reutiliza tal cual.
- La rama de licitaciones (`service_type_code === 'licitacion_publica'`) y sus componentes.
- Enlaces de navegación directa desde las alertas o las sugerencias contextuales hacia el formulario de edición del CRM: el texto describe la señal detectada, pero no agrega botones ni rutas nuevas.
- El feedback `Útil`/`Necesita cambios`, ya retirado de esta UI en un cambio anterior — sigue fuera, y no se extiende a la etapa de preanálisis.
- `OpportunityForm` (creación/edición de oportunidades) y `FollowUpForm`: no se les agrega ningún enlace ni referencia nueva.
- Cancelar una llamada de preanálisis en curso desde la UI: el botón de generar simplemente permanece deshabilitado hasta que termine.

## Criterios de aceptación

1. `VigiaOpportunityCopilot` recibe `preflight: CommercialPreflightInput` y `contextVersion: string`, y renderiza `VigiaCommercialAlerts` seguido de `VigiaPreflightAnalysis` inmediatamente después del `<header>`, antes de cualquier rama de fase de generación.
2. `buildCommercialAlerts` es puro y devuelve como máximo una alerta por categoría, nunca dos con la misma `key`; cada alerta expone únicamente `key`/`category`/`risk_text` (más `contextualAction`, resuelto aparte) — el tipo `CommercialAlert` no tiene ningún campo `action_text` ni de acción por defecto, y `risk_text` es siempre una descripción factual, nunca una instrucción, un prerrequisito ni una condición de bloqueo.
3. `POST /api/vigia/copilot/preflight` existe en `api/[...path].js` y en `server/index.js`, con el mismo texto en ambos archivos (`tests/backend-parity.test.mjs` sigue en verde), protegido por `ACTIONS.AI_COMMERCIAL_DRAFT_RUN` a través de `resolveAgt003OpportunityResource`, y devuelve `503` si `isAgt003PreflightConfigured()` es `false`.
4. `POST /api/vigia/copilot/preflight` reutiliza `loadAgt003OpportunityContext` (misma consulta que `generate`) en cada llamada — no hay caché propia del contexto de esta ruta.
5. La respuesta de `/preflight` valida contra `opportunity-preflight.response.schema.json`; una respuesta con un `issue_code` fuera del enum o con un `evidence_ref` que no existe en la solicitud es rechazada por `validateAgt003PreflightResponse` y nunca llega al cliente como éxito.
6. `/preflight` no invoca ninguna función de `agt003-copilot-persistence.js` ni escribe en `psi_agt003_copilot_runs`, `psi_sales_opportunities` ni `psi_sales_interactions` — verificable porque `createAgt003PreflightApi` no declara esas dependencias en su firma.
7. `consolidatePreflightActions`/`mergeCommercialAlertsWithPreflight` usan comparación exacta de `issue_code` en toda su lógica — ningún test ni implementación compara texto de forma difusa (`includes`, similitud, distancia de edición) para deduplicar.
8. Con una acción de preanálisis cuyo `issue_code` coincide con una alerta determinista activa, el render muestra, bajo el `risk_text` de esa alerta y sólo ahí, una única línea «Sugerencia contextual:» con `contextualAction.description`; no existe ninguna sección ni encabezado «Acciones para mejorar la propuesta», y la sugerencia no aparece como una alerta adicional en ningún otro punto de la UI.
9. Con una acción de preanálisis cuyo `issue_code` no coincide con ninguna de las tres categorías deterministas, aparece como sugerencia independiente en `VigiaPreflightAnalysis` (`standaloneActions`), no dentro de `VigiaCommercialAlerts`.
10. Las alertas comerciales (etapa 1) nunca son un insumo de `canGenerate` ni de ninguna otra condición que habilite o bloquee avanzar: ni una alerta `overdue` ni una `missing` deshabilitan el botón «Generar propuesta con el contexto actual» por sí solas. La gobernanza de ejecutar/saltar el preanálisis y la casilla de reconocimiento (criterio 12) es independiente de las alertas y no cambia por su presencia o ausencia.
11. Editar la oportunidad (cambiar `updated_at` o `last_interaction_at`) mientras `preflightState.phase === 'ready'` o `'error'` la reinicia a `'idle'` en el siguiente render; si ocurre mientras `phase === 'loading'`, el resultado que llega después se descarta (vuelve a `'idle'`) en vez de mostrarse como vigente.
12. El botón «Generar propuesta con el contexto actual» está deshabilitado mientras `preflightState.phase === 'loading'`; si `phase` es `'idle'` o `'error'`, sólo se habilita tras marcar la casilla de reconocimiento, que se reinicia a no marcada cada vez que `phase` vuelve a `'idle'`.
13. `VigiaCopilotProposal` ya no renderiza `<section className="vigia-copilot-missing">`, el texto «Antes de contactar», ni `<div className="notice vigia-copilot-warnings">`; renderiza `<h4>Plan de contacto</h4>` seguido de un `<ol>` con uno o más `<li>`.
14. `.vigia-human-warning` se renderiza inmediatamente después de `.vigia-copilot-actions` y antes de `<details className="vigia-copilot-context">`.
15. `presentCopilotBrief` ya no expone `missingInformation` ni `warnings`; expone `contactPlanSteps: string[]` no vacío. `splitContactPlanSteps` es puro, exportado y cubierto por los casos: multilínea, una sola oración, varias oraciones en un bloque, y texto patológico (>8 fragmentos).
16. Ningún archivo de `contracts/agents/AGT-003/v1/`, `agt003-copilot-engine.js`, `agt003-copilot-runtime.js`, `agt003-copilot-persistence.js`, `agt003-copilot-api.js`, `supabase/migrations/` cambia.
17. `tests/vigia-opportunity-copilot-ui-static.test.mjs`, `tests/agt003-copilot-proposal-render.test.mjs`, `tests/agt003-preflight-alerts-render.test.mjs`, `tests/agt003-copilot-presentation.test.mjs`, `tests/agt003-preflight-alerts-presentation.test.mjs`, `tests/agt003-preflight-state.test.mjs`, `tests/agt003-preflight-contract.test.mjs`, `tests/agt003-preflight-engine.test.mjs`, `tests/agt003-preflight-runtime.test.mjs`, `tests/agt003-preflight-api.test.mjs`, `tests/agt003-preflight-endpoint-static.test.mjs`, `tests/agt003-preflight-end-to-end.integration.test.mjs` existen y pasan.
18. `tests/backend-parity.test.mjs` sigue en verde después de agregar la ruta nueva.
19. No hay cambios de esquema de base de datos ni de permisos (`access-control.js` no agrega ninguna acción nueva).
20. La suite completa del repositorio pasa en verde antes de considerar la tarea completa.
