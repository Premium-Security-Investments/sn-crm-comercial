# AGT-003: layout de prioridad de seguimiento — diseño

**Fecha:** 2026-08-24
**Estado:** Aprobado por producto (rediseño completo; sustituye y deja sin efecto `2026-08-24-agt003-commercial-context-card-design.md`, que nunca se implementó y fue eliminado)
**Alcance:** oportunidades comerciales no licitatorias (`o.service_type_code !== 'licitacion_publica'`), vista de detalle de oportunidad (`OpportunityDetail` en `src/main.tsx`)
**Plan de implementación:** `docs/superpowers/plans/2026-08-24-agt003-followup-priority-layout.md`

## Problema

En el detalle de una oportunidad no licitatoria conviven demasiadas prioridades visuales al mismo nivel.

1. `src/main.tsx:835` renderiza un `<div className="grid three">` con once tarjetas `Info` (Servicio, Tipo de cliente, Área comercial, Fecha creación, Cierre estimado, Próxima acción, Estado próxima gestión, Días sin seguimiento, Decisor, Correo decisor, Teléfono). El comercial debe leer una cuadrícula densa de once celdas equivalentes antes de llegar a lo accionable.
2. `src/main.tsx:843` renderiza el panel `Datos comerciales` como un `<dl>` que mezcla, sin jerarquía, datos operativos vigentes (Sector, Ciudad, Sede) con trazabilidad de migración desde Excel (`legacy_excel_id`, `excel_hoja_origen`, `estado_pipeline_original`) y una observación (`observaciones`) que puede estar ya representada por una interacción migrada (como Coats Cadena), causando duplicación, pero no hay garantía de que todos los registros históricos la tengan; eso justifica un fallback deduplicado en lugar de asumir que el dato siempre está cubierto o siempre falta.
3. La bitácora (`Panel title="Línea de seguimientos"`, `src/main.tsx:844`) se renderiza **después** del copiloto `VigiaOpportunityCopilot` (`src/main.tsx:836`), y muestra el `interaction_type` crudo (`llamada`, `cambio_estado`) con una capitalización sólo visual aplicada por CSS (`.event strong{text-transform:capitalize}`, `src/styles.css:52`).
4. `FollowUpForm` (`src/main.tsx:1158`) no explica por qué el texto que se escribe ahí importa para el historial comercial ni para las recomendaciones del copiloto.

## Decisión

Se reorganiza la vista de detalle no licitatoria alrededor de lo que un comercial necesita decidir primero — próxima gestión, último contacto, cierre estimado, cómo contactar al decisor — y se mueve todo lo secundario (Fecha creación, Área comercial, Sector, trazabilidad legacy) a un `<details>` colapsado al final.

El panel `Datos comerciales` desaparece por completo: Servicio, Tipo de cliente y Ubicación pasan a chips compactos en el banner; Sector y trazabilidad legacy pasan a `Más información`; la observación (`o.observaciones`) deja de vivir en un panel aparte y se integra al historial de seguimiento como un evento migrado sintético, sólo cuando su contenido no está ya cubierto por una interacción visible.

Se crea una sección `Seguimiento comercial` (historial + formulario) que se renderiza **antes** que el copiloto, no después.

No se toca DB, API, permisos ni el modelo de IA: es un cambio de presentación sobre datos ya cargados por `/api/opportunity-detail`, más un evento sintético calculado en memoria.

## Conflicto de copy resuelto: nombre visible del agente

El copy aprobado por producto para el formulario nombra al agente como `VIG-IA`. El repositorio tiene un contrato de identidad visible activo (`tests/vigia-visible-identity-static.test.mjs:60-62`) que prohíbe en `src/main.tsx` tanto la etiqueta desnuda `Vig-IA` como la forma en mayúsculas `VIG-IA`, y obliga a usar los nombres calificados por dominio de `VIGIA_VISIBLE_NAMES` (`src/vigia/agentIdentity.ts`).

Ese contrato **no es copy retirado**: es la regla de marca vigente, aplicada hoy a once archivos. Escribir `VIG-IA` literal en `src/main.tsx` obligaría a debilitarlo y dejaría el párrafo en contradicción con el panel contiguo, que se rotula `Vig-IA Comercial`.

**Decisión:** el párrafo se implementa con el nombre canónico interpolado, conservando el resto de la frase palabra por palabra:

```tsx
`Este registro alimenta el historial comercial y las recomendaciones de ${VIGIA_VISIBLE_NAMES.commercial}. Describa hechos, acuerdos, responsables y el siguiente paso.`
```

Texto renderizado: *«Este registro alimenta el historial comercial y las recomendaciones de Vig-IA Comercial. Describa hechos, acuerdos, responsables y el siguiente paso.»*

`src/main.tsx:34` ya importa `VIGIA_VISIBLE_NAMES`, así que no se agrega ninguna dependencia nueva.

**Variante autorizada (sólo si producto ratifica el literal `VIG-IA`):** el único cambio adicional sería exceptuar `src/main.tsx` de la aserción `assert.doesNotMatch(source, /VIG-IA/)` en `tests/vigia-visible-identity-static.test.mjs:61`. Esa variante no se implementa en este diseño; queda documentada para que la decisión sea explícita y reversible.

## Comportamiento

### 1. Banner (`.hero`)

El banner conserva exactamente lo que ya muestra hoy — `Badge` de etapa, nombre de empresa, comercial responsable, regional, valor formateado (`fmtMoney`) y el botón `Editar` — y, **sólo para oportunidades no licitatorias**, agrega una fila de chips compactos debajo del párrafo existente:

```tsx
{o.service_type_code !== 'licitacion_publica' && <div className="hero-chip-row">
  <Badge>Servicio: {o.service_type_name || o.tipo_producto_original || 'Sin servicio'}</Badge>
  <Badge>Tipo de cliente: {customerSegmentLabel(o.customer_segment)}</Badge>
  {locationChip && <Badge>Ubicación: {locationChip}</Badge>}
</div>}
```

- **Servicio:** siempre presente. Fallback `'Sin servicio'`.
- **Tipo de cliente:** siempre presente. Reutiliza `customerSegmentLabel` (`src/main.tsx:194`) y su fallback `'Pendiente'`.
- **Ubicación:** `${ciudad} · ${sede}` cuando ambos tienen contenido; sólo el que exista si falta uno (sin separador `·` colgante); **si ninguno tiene contenido el chip no se renderiza** (no se agrega un tercer chip vacío).

No se agrega un chip de **Área comercial**: ese campo pasa a `Más información` (sección 4).

Los chips reutilizan el componente `Badge` (`src/main.tsx:744`), que dentro de `.hero` ya hereda el estilo blanco/azul de `.hero .badge` (`src/styles.css:52`); no se crea un componente de chip nuevo. Para la rama de licitaciones el banner no cambia.

### 2. Resumen prioritario de 4 tarjetas (sustituye el `grid three` de once campos)

El `<div className="grid three">` de once `Info` se reemplaza por:

```tsx
<section className="opportunity-insight-grid opportunity-priority-grid" aria-label="Resumen prioritario de la oportunidad">
  <div className="opportunity-insight-card"><small>Próxima gestión</small><strong>{fmtDate(o.next_action_at)}</strong><span>{`${action.label} · ${action.detail}`}</span></div>
  <div className="opportunity-insight-card"><small>Último seguimiento</small><strong>{fmtDate(o.last_interaction_at)}</strong><span>{lastDays === null ? 'Sin registro' : `${lastDays} día(s) de antigüedad`}</span></div>
  <div className="opportunity-insight-card"><small>Cierre estimado</small><strong>{fmtDateOnly(o.expected_close_date)}</strong></div>
  <div className="opportunity-insight-card"><small>Contacto decisor</small><strong>{decisionMakerSummary}</strong></div>
</section>
```

1. **Próxima gestión** — `fmtDate(o.next_action_at)` como valor principal y `${action.label} · ${action.detail}` como detalle. `action = nextActionStatus(o)` ya existe en `src/main.tsx:792` y no cambia.
2. **Último seguimiento** — `fmtDate(o.last_interaction_at)` como valor principal y la antigüedad como detalle. `lastDays = daysSince(o.last_interaction_at || o.updated_at || o.created_at)` ya existe en `src/main.tsx:800` y no cambia.
3. **Cierre estimado** — `fmtDateOnly(o.expected_close_date)` como único valor, sin detalle.
4. **Contacto decisor** — nombre, correo y teléfono unidos con `' · '` omitiendo los vacíos; `'Por completar'` cuando los tres están vacíos.

Las tarjetas **no llevan clase de tono** (`blue`/`green`/`amber`/`purple`): `nextActionStatus` devuelve tonos (`success`/`danger`/`amber`) que no existen como modificadores de `.opportunity-insight-card` (`src/styles.css:177`), y mapearlos implicaría inventar semántica de color nueva. La urgencia sigue comunicándose por texto (`Vencida · 3 día(s) vencida`).

Servicio, Tipo de cliente y Ubicación **no se repiten aquí** (están en los chips del banner). Área comercial, Fecha creación y Sector **no se repiten aquí** (pasan a `Más información`).

### 3. Sección `Seguimiento comercial` (antes de VIG-IA)

Ocupa la posición donde hoy está el `<div className="grid two">` con `Datos comerciales` + `FollowUpForm`, dentro del contenedor `id="tender-follow-up"` existente:

```tsx
<div id="tender-follow-up" className="tender-detail-anchor" tabIndex={-1}>{o.service_type_code === 'licitacion_publica' ? <PublicTenderFollowUp .../> : <>
  <h2 className="followup-section-title">Seguimiento comercial</h2>
  <div className="followup-section-grid">
    <div id="opportunity-follow-up" className="opportunity-follow-up-anchor followup-form-slot" tabIndex={-1} ref={followUpRef}>
      <FollowUpForm opportunityId={id} profiles={data.profiles} currentProfile={data.currentProfile} onSaved={async()=>{await load(); await refresh();}} />
    </div>
    <Panel title="Historial de seguimiento" className="followup-history">…</Panel>
  </div>
</>}</div>
```

- **Historial de seguimiento** (`Panel title="Historial de seguimiento"`, antes `Línea de seguimientos`): ver sección 5. `Panel` ya acepta `className` (`src/main.tsx:539`).
- **Registrar seguimiento** (`FollowUpForm`, que sigue siendo su propio `Panel` interno): ver sección 7.

**Escritorio (> 760 px):** historial a la izquierda al 60 % y formulario a la derecha al 40 % (`grid-template-columns: minmax(0,3fr) minmax(280px,2fr)`), alineados al inicio (`align-items:start`) para que ninguno se estire a la altura del otro.

**Móvil (`max-width:760px`):** una sola columna, **formulario primero e historial después**.

**Orden en el DOM (importante para foco de teclado):** el formulario se declara primero en el JSX y el historial segundo. En escritorio, `order` invierte sólo el orden **visual** para poner el historial a la izquierda; en móvil no se aplica `order`, así que DOM, foco y orden visual coinciden exactamente con «formulario primero, historial después». Ver Accesibilidad para el trade-off consciente en escritorio.

El contenedor conserva las dos anclas existentes sin cambios: `id="tender-follow-up"` (externa) e `id="opportunity-follow-up"` con `ref={followUpRef}` y `tabIndex={-1}` (interna, usada por `interactionFocusRequested` para el scroll+foco programático de `?focus=interaction`, por ejemplo desde el enlace «Registrar seguimiento» de las tarjetas de prioridad). Sólo cambia qué hay dentro y la clase adicional del wrapper del formulario.

`{canRenderOpportunityCopilot(data.currentProfile, o.service_type_code) && <VigiaOpportunityCopilot opportunityId={o.id} request={api} />}` se mueve desde `src/main.tsx:836` a **inmediatamente después** del contenedor `id="tender-follow-up"`. La llamada es idéntica (mismos props, mismo guard); sólo cambia su posición en el JSX. Como `canRenderOpportunityCopilot` ya excluye `service_type_code === 'licitacion_publica'`, moverla no afecta el render de la rama de licitaciones (ahí ya era un no-op).

### 4. `Más información` (secundario, al final)

Último bloque de la vista, después del copiloto y bajo su propio guard de rama:

```tsx
{o.service_type_code !== 'licitacion_publica' && <details className="opportunity-more-info">
  <summary>Más información</summary>
  <div className="grid three">
    <Info label="Fecha creación" value={fmtDate(o.created_at)}/>
    <Info label="Área comercial" value={commercialAreaLabel(o.owner_commercial_area)}/>
    <Info label="Sector" value={o.economic_sector}/>
    {legacyId && <Info label="ID legacy" value={o.legacy_excel_id}/>}
    {legacySheet && <Info label="Hoja origen" value={o.excel_hoja_origen}/>}
    {legacyStatus && <Info label="Estado original" value={o.estado_pipeline_original}/>}
  </div>
</details>}
```

Orden final del JSX de `OpportunityDetail` (los bloques marcados `licitación` conservan su guard actual sin cambios):

1. `<div id="tender-summary">` con el banner y, sólo en no licitatorias, la fila de chips.
2. `TenderModuleNavigation` y `TenderDetailNavigation` (licitación).
3. Ternario de resumen: `Panel "Resumen de la oportunidad"` (licitación) / `<section>` de cuatro tarjetas (no licitatoria).
4. `TenderDocumentReviewPanel`, `#tender-decision`, `#tender-preparation` (licitación).
5. `<div id="tender-follow-up">`: `PublicTenderFollowUp` (licitación) / `Seguimiento comercial` (no licitatoria).
6. `VigiaOpportunityCopilot` bajo su guard `canRenderOpportunityCopilot`, que ya excluye licitaciones.
7. `Más información` (no licitatoria).

- **Siempre presentes:** Fecha creación, Área comercial y Sector, con el comportamiento estándar de `Info` (`src/main.tsx:1156`), incluido su placeholder `—`. `Fecha creación` y `Área comercial` conservan literalmente la expresión que tenían en el `grid three`; `Sector` es nuevo aquí (antes vivía en el `<dl>` de `Datos comerciales`).
- **Trazabilidad legacy:** cada campo se renderiza sólo si tiene contenido tras `trim()`. Una fila sin dato no aparece; no se usa el placeholder `—` para estos tres.
- **`o.observaciones` nunca aparece dentro de `Más información`.** Su único destino es el historial de seguimiento (secciones 5 y 6).
- El `<details>` nunca se oculta por completo: los tres campos siempre presentes garantizan contenido, de modo que no hace falta una condición de visibilidad para el bloque entero.
- El contenedor interno reutiliza `.grid.three` (`src/styles.css:37`), que ya colapsa a una columna en `max-width:1100px`; no requiere CSS de rejilla nuevo.

### 5. Historial de seguimiento

`Línea de seguimientos` se renombra a **`Historial de seguimiento`**. Su fuente de datos deja de ser el filtro inline `detail.interactions.filter(i => i.interaction_type !== 'documento')` (`src/main.tsx:791`) y pasa a ser `buildFollowUpHistory(o, detail.interactions)`, exportado por el módulo puro `src/opportunity-followup-presentation.js`.

```tsx
<Panel title="Historial de seguimiento" className="followup-history">
  <div className="timeline followup-timeline">{followUpHistory.length
    ? followUpHistory.map(i => <div className="event" key={i.id}>
        <strong>{followUpInteractionTypeLabel(i.interaction_type)}</strong>
        <span>{fmtDate(i.occurred_at)} · {i.actor_label || i.psi_sales_profiles?.full_name || 'Migrado / sistema'}</span>
        <p>{i.notes}</p>
      </div>)
    : <p className="muted">Sin seguimientos registrados.</p>}</div>
</Panel>
```

- **Antes:** `<strong>{i.interaction_type}</strong>` — valor crudo (`llamada`, `cambio_estado`).
- **Después:** `<strong>{followUpInteractionTypeLabel(i.interaction_type)}</strong>` — rótulo humano (`Llamada`, `Correo`, `Reunión`, `WhatsApp`, `Nota`, `Cambio de estado`, `Documento`), con `capitalizeVisibleLabel` como respaldo para cualquier valor no mapeado. Es puramente presentación: no muta `i.notes` ni `o.observaciones` en ningún punto del pipeline.
- **Capitalización CSS:** la regla global `.event strong{text-transform:capitalize}` (`src/styles.css:52`) convertiría `Cambio de estado` en `Cambio De Estado`. Se neutraliza **sólo en esta línea de tiempo** con `.followup-timeline .event strong{text-transform:none}`; la regla global no se toca porque `.event` se sigue usando en `PublicTenderFollowUp` y en la nota interna de preparación de oferta (`src/main.tsx:1139`), donde el valor sí llega en minúsculas y depende de esa capitalización.
- El actor se muestra igual que hoy, con `i.actor_label` como primera opción. `actor_label` sólo existe en el evento sintético de la sección 6; las interacciones reales de la API nunca lo traen, así que su comportamiento no cambia.
- `documento` sigue oculto: `buildFollowUpHistory` filtra `interaction_type === 'documento'` internamente, igual que el filtro inline al que sustituye.
- El estado vacío conserva el mensaje existente `Sin seguimientos registrados.`

El mapa de rótulos de `FollowUpForm` (`interactionTypeLabels`, local a esa función, `src/main.tsx:1160`, usado para las opciones del `<Select>`) **no se toca ni se unifica** con el nuevo módulo: ambos mapas terminan con el mismo contenido, pero consolidarlos implicaría reestructurar `FollowUpForm`, y esta tarea sólo debe conservar su endpoint/payload/values. La duplicación queda documentada como decisión consciente, no como descuido.

### 6. Observación migrada (fallback sintético, sin escritura en DB)

Cuando `o.observaciones` tiene contenido tras `trim()`, se evalúa si ese texto ya está cubierto por alguna interacción **visible** (`interaction_type !== 'documento'`):

- **Regla de cobertura:** se normalizan tanto `o.observaciones` como cada `interaction.notes` (`trim()` + minúsculas + colapso de espacios repetidos) y se comprueba si el texto normalizado de la observación está **contenido** (substring) en el texto normalizado de alguna nota visible. La comparación es de contención y no de igualdad exacta para tolerar que la nota real incluya la observación junto con texto adicional. Si hay coincidencia, la observación se considera ya representada y **no** se agrega evento sintético.
- **Si no está cubierta**, se agrega al historial un evento migrado sintético:
  - `id: 'observacion-migrada'` — clave estable y única para React dentro de esta lista; ninguna interacción real puede colisionar porque los ids reales son UUID de `psi_sales_interactions`.
  - `interaction_type: 'nota'` → rótulo visible `Nota`.
  - `notes: o.observaciones` — el texto **original, sin modificar**. El `trim()` sólo se usa para decidir si el campo está vacío y para comparar.
  - `occurred_at` y `created_at`: `o.quote_date || o.created_at || null`.
  - `actor_label: 'Migrado / sistema'` — mismo texto de respaldo que ya usan las interacciones sin perfil asociado.
  - `psi_sales_profiles: null`.
- **Orden:** el evento sintético se intercala **cronológicamente**, no al principio ni al final. `buildFollowUpHistory` ordena el conjunto completo (reales + sintético) de más reciente a más antiguo por `occurred_at || created_at`. Esto es necesario porque la API ya entrega los reales en orden *newest-first* (`api/[...path].js:4640`: `.order('occurred_at', { ascending: false })`) pero el sintético no viene de la API.
- **No hay escritura en base de datos** en ningún punto: el evento existe sólo en memoria, para el render de esta sesión de la vista.

### 7. Formulario `Registrar seguimiento` (copy nuevo, mecánica intacta)

`FollowUpForm` conserva exactamente:

- su endpoint `POST /api/opportunity-interactions?id=...`;
- su payload (`interaction_type`, `notes`, `occurred_at`, `created_by`, `next_action_at`) y las transformaciones de fecha existentes;
- sus valores y rótulos vigentes (`Tipo de seguimiento`, `Registrado por`, `Fecha del seguimiento`, `Próxima gestión (opcional)`, `Detalle del seguimiento`, `Guardar seguimiento`);
- el atributo `required` del `<textarea>`.

Se agregan, sin quitar nada:

1. Un párrafo de contexto entre el título del panel y el `<form>`:

   ```tsx
   <p className="followup-form-hint">Este registro alimenta el historial comercial y las recomendaciones de {VIGIA_VISIBLE_NAMES.commercial}. Describa hechos, acuerdos, responsables y el siguiente paso.</p>
   ```

2. El `placeholder` del `<textarea>` cambia de `"Registre el resultado, los acuerdos y el siguiente paso"` a un placeholder de tres líneas:

   ```
   Resultado de la gestión
   Acuerdos o compromisos
   Siguiente paso
   ```

   **Detalle de implementación obligatorio:** en JSX, una cadena entre comillas dentro de un atributo **no interpreta `\n`** (`placeholder="a\nb"` renderiza el literal `a\nb`). El salto de línea debe venir de una expresión JavaScript, así que se declara una constante a nivel de módulo y se pasa por llaves:

   ```tsx
   const FOLLOW_UP_NOTES_PLACEHOLDER = 'Resultado de la gestión\nAcuerdos o compromisos\nSiguiente paso';
   …
   <textarea required placeholder={FOLLOW_UP_NOTES_PLACEHOLDER} value={form.notes} onChange={…}/>
   ```

   El `<textarea>` renderiza los saltos de línea del placeholder de forma nativa en los navegadores objetivo.

No se agrega `minLength` ni ninguna otra validación nueva.

## Módulo de presentación (`src/opportunity-followup-presentation.js`)

Módulo JS puro (sin JSX, sin React, sin DOM), importable tanto desde `src/main.tsx` (`import { … } from './opportunity-followup-presentation.js'`) como directamente desde pruebas Node (`tests/*.test.mjs`) sin transpilación, siguiendo el patrón ya usado por `src/vigia/dashboard-link-filters.js` y `src/vigia/priority-filters.js`.

Como `tsconfig.json` tiene `"allowJs": false`, el módulo se acompaña de un `src/opportunity-followup-presentation.d.ts` con las firmas, exactamente igual que `src/vigia/priority-filters.d.ts`. `moduleResolution: "Bundler"` resuelve el import `./opportunity-followup-presentation.js` contra ese `.d.ts` en compilación y contra el `.js` en tiempo de bundle.

### Tipos (`.d.ts`)

```ts
export type FollowUpInteraction = {
  id: string;
  interaction_type: string;
  notes: string | null;
  occurred_at?: string | null;
  created_at?: string | null;
  actor_label?: string | null;
  psi_sales_profiles?: { full_name?: string } | null;
};
export type FollowUpOpportunity = {
  observaciones?: string | null;
  quote_date?: string | null;
  created_at?: string | null;
};
export const INTERACTION_TYPE_LABELS: Readonly<Record<string, string>>;
export function capitalizeVisibleLabel(text?: string | null): string;
export function followUpInteractionTypeLabel(type?: string | null): string;
export function normalizeFollowUpText(text?: string | null): string;
export function isObservationCapturedInNotes(observaciones?: string | null, interactions?: FollowUpInteraction[] | null): boolean;
export function buildMigratedObservationEvent(opportunity?: FollowUpOpportunity | null): FollowUpInteraction | null;
export function buildFollowUpHistory(opportunity?: FollowUpOpportunity | null, interactions?: FollowUpInteraction[] | null): FollowUpInteraction[];
```

El tipo `Interaction` de `src/main.tsx:59` es estructuralmente asignable a `FollowUpInteraction`, por lo que `buildFollowUpHistory(o, detail.interactions)` compila sin castings ni cambios en `Interaction`.

### Contrato de cada export

| Export | Contrato |
|---|---|
| `INTERACTION_TYPE_LABELS` | Mapa congelado con `Object.freeze`: `{ llamada: 'Llamada', correo: 'Correo', reunion: 'Reunión', whatsapp: 'WhatsApp', nota: 'Nota', cambio_estado: 'Cambio de estado', documento: 'Documento' }`. Mismos siete valores internos que `interactionTypes` (`src/main.tsx:88`). |
| `capitalizeVisibleLabel(text)` | Primera letra en mayúscula, resto de la cadena **sin modificar**. `''`, `null` y `undefined` devuelven `''`. No hace `trim` ni reemplaza guiones bajos. |
| `followUpInteractionTypeLabel(type)` | `INTERACTION_TYPE_LABELS[type]` si existe; si no, `capitalizeVisibleLabel(type)`. Sólo consulta claves propias del mapa (`Object.prototype.hasOwnProperty`), para que `'constructor'` o `'toString'` no devuelvan funciones heredadas. |
| `normalizeFollowUpText(text)` | `String(text ?? '')` → `trim()` → `toLowerCase()` → colapso de cualquier secuencia de espacios en blanco (`/\s+/g`) a un solo espacio. Sólo para comparar; nunca se renderiza. |
| `isObservationCapturedInNotes(obs, interactions)` | `false` si `normalizeFollowUpText(obs)` es `''` o si `interactions` no es un arreglo con elementos. En otro caso, `true` si el texto normalizado de la observación está contenido en el texto normalizado de la nota de alguna interacción recibida. **Evalúa exactamente las interacciones que recibe**: `buildFollowUpHistory` le pasa sólo las visibles, nunca las de tipo `documento`. |
| `buildMigratedObservationEvent(opportunity)` | `null` si `opportunity` es nulo o `observaciones` queda vacío tras `trim()`. En otro caso, el evento sintético descrito en la sección 6, con `notes` igual al valor original sin mutar. |
| `buildFollowUpHistory(opportunity, interactions)` | 1) filtra `interaction_type === 'documento'`; 2) calcula el evento migrado con `buildMigratedObservationEvent` y lo descarta si `isObservationCapturedInNotes` devuelve `true` sobre las visibles; 3) concatena el sintético al final del arreglo de visibles; 4) devuelve una copia ordenada *newest-first* por `occurred_at || created_at`. Nunca muta el arreglo recibido ni sus elementos. |

### Reglas de ordenamiento

- La clave de orden es `Date.parse(occurred_at || created_at || '')`. Un valor ausente o no parseable (`NaN`) se trata como `0`, es decir, va al final.
- El orden es descendente. Ante claves iguales se depende de la estabilidad de `Array.prototype.sort` (garantizada por la especificación desde ES2019): las visibles conservan el orden que trajo la API y el sintético, por ir último antes de ordenar, queda después de las reales con el mismo instante. El resultado es determinista y reproducible en pruebas.

Este módulo no conoce React, JSX ni el DOM: toda la integración visual (chips, tarjetas, `Más información`) queda en `src/main.tsx`, que sigue siendo el único lugar con JSX de esta vista. **No se reestructura el resto de `main.tsx`**: sólo cambian las secciones descritas arriba dentro de `OpportunityDetail` y el copy de `FollowUpForm`.

## Reglas de datos

- **Valores derivados en `OpportunityDetail`**, todos calculados con lecturas directas de `Opportunity`:
  - `locationChip = [o.quote_city, o.sede].map(v => (v || '').trim()).filter(Boolean).join(' · ')`.
  - `decisionMakerSummary = [o.decision_maker_name, o.decision_maker_email, o.decision_maker_phone].map(v => (v || '').trim()).filter(Boolean).join(' · ') || 'Por completar'`.
  - `legacyId`, `legacySheet`, `legacyStatus`: `(campo || '').trim()`.
  - `followUpHistory = buildFollowUpHistory(o, detail.interactions)`, que reemplaza la constante `visibleInteractions` (`src/main.tsx:791`), hoy consumida en un solo punto.
- **Servicio (chip):** `o.service_type_name || o.tipo_producto_original || 'Sin servicio'`; siempre se renderiza.
- **Tipo de cliente (chip):** `customerSegmentLabel(o.customer_segment)`; siempre se renderiza, con su fallback `'Pendiente'`.
- **Ubicación (chip):** omitido por completo si `locationChip` es `''`.
- **Próxima gestión:** reutiliza `nextActionStatus(o)` sin cambios; sólo cambia dónde y cómo se presenta su resultado.
- **Último seguimiento:** reutiliza `daysSince(o.last_interaction_at || o.updated_at || o.created_at)` sin cambios, y agrega la fecha de `o.last_interaction_at`, que antes no se mostraba explícitamente en esta vista. La fecha y la antigüedad pueden provenir de campos distintos (`last_interaction_at` vs. el encadenamiento con `updated_at`/`created_at`); es el mismo comportamiento que ya tienen hoy `Próxima acción` y `Días sin seguimiento` por separado, y se conserva sin cambios para no alterar el cálculo de inactividad usado en el resto de la app.
- **Contacto decisor:** `'Por completar'` sólo cuando los tres campos están vacíos; en cualquier otro caso se muestran los que existan.
- **`Más información`, campos siempre presentes:** comportamiento estándar de `Info` (placeholder `—`); no se modifica `Info`.
- **`Más información`, trazabilidad legacy:** cada campo se omite individualmente si está vacío tras `trim()`.
- **Deduplicación de la observación migrada:** normalización antes de comparar; comparación por contención, no por igualdad.
- **Capitalización visual:** afecta únicamente al rótulo del tipo de interacción; nunca a `notes` ni a `observaciones`, que se renderizan verbatim (`.event p{white-space:pre-wrap}` ya preserva sus saltos de línea).
- Ningún campo de esta vista se persiste, transforma ni deriva hacia la base de datos.

## CSS nuevo

Todo el CSS es aditivo, al final de `src/styles.css`. **No se modifica ninguna regla compartida existente** (`.grid`, `.two`, `.three`, `.hero`, `.badge`, `.event`, `.timeline`, `.opportunity-insight-grid`, `.opportunity-insight-card`).

```css
.hero-chip-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.opportunity-priority-grid .opportunity-insight-card strong{font-size:19px;letter-spacing:-.02em;line-height:1.25}
.followup-section-title{margin:0;font-size:20px;letter-spacing:-.015em;color:#111827}
.followup-section-grid{display:grid;gap:16px;min-width:0;align-items:start;grid-template-columns:minmax(0,3fr) minmax(280px,2fr)}
.followup-section-grid>.followup-history{order:1;min-width:0}
.followup-section-grid>.followup-form-slot{order:2;min-width:0}
.followup-timeline .event strong{text-transform:none}
.followup-form-hint{margin:-6px 0 14px;color:#526173;font-size:13px;line-height:1.45}
.opportunity-more-info>summary{cursor:pointer;font-weight:800;color:#40516b;padding:4px 0}
.opportunity-more-info>.grid{margin-top:12px}
@media(max-width:760px){.followup-section-grid{grid-template-columns:1fr}.followup-section-grid>.followup-history,.followup-section-grid>.followup-form-slot{order:0}}
```

- `.opportunity-priority-grid` existe porque `.opportunity-insight-card strong` usa `font-size:clamp(22px,1.8vw,31px)` (`src/styles.css:174`), pensado para cifras cortas: un correo de decisor a 31 px rompería la tarjeta. El modificador sólo baja el tamaño tipográfico; conserva el resto de la tarjeta (acento superior, sombra, altura mínima) tal cual.
- `.followup-section-grid` es una clase propia y **no** reutiliza `.grid.two`, porque `.two` colapsa a una columna en `max-width:1240px` y define un reparto 1.25/0.75, no el 60/40 pedido, y porque `.two` se comparte con otras vistas donde ese comportamiento sigue siendo el correcto.
- El bloque `@media(max-width:760px)` usa el mismo quiebre que `.opportunity-insight-grid` (`src/styles.css:179`), de modo que resumen y sección de seguimiento colapsan a una columna en el mismo punto: no hay ancho intermedio con comportamientos contradictorios.

## Accesibilidad

- **Resumen prioritario:** el contenedor es un `<section aria-label="Resumen prioritario de la oportunidad">`. Se usa `<section>` y no un `<div>` porque `aria-label` sobre un `div` sin `role` es inerte y no se anuncia; un `<section>` con nombre accesible expone rol `region`. (El `<div aria-label>` de `src/main.tsx:647` tiene ese defecto; no se corrige aquí porque está fuera de alcance, y no se replica.)
- **Chips del banner:** son `Badge` (`<span>` con texto plano) y su texto ya es autodescriptivo (`Servicio: Vigilancia`, `Tipo de cliente: Cliente Actual`, `Ubicación: Bogotá · Norte`). No se les agrega `aria-label` de grupo sobre un `<div>` genérico, precisamente para no añadir un atributo inerte; el contenido leído es el mismo con o sin él.
- **`Más información`:** `<details>`/`<summary>` nativos, igual que los usos existentes en `src/main.tsx`; sin JavaScript propio de apertura/cierre ni gestión manual de foco. No lleva `open`, así que un lector de pantalla lo anuncia colapsado por defecto y `<summary>` es enfocable y accionable con teclado de forma nativa.
- **Orden de foco en `Seguimiento comercial`:** el DOM declara el formulario antes que el historial y ese orden se mantiene en el foco de teclado en ambos anchos. En móvil coincide exactamente con el orden visual. En escritorio, el CSS invierte sólo el orden visual (historial a la izquierda) sin tocar el DOM, por lo que un usuario de teclado llega primero al formulario aunque visualmente esté a la derecha. Es una decisión consciente: el formulario es la acción principal de la sección y cada panel lleva su propio encabezado (`Historial de seguimiento`, `Registrar seguimiento`), así que no se pierde contexto al llegar a cualquiera de los dos primero. Se documenta para que no se lea como un defecto no intencional en una revisión futura.
- **Encabezados:** cada `Panel` renderiza `<h2>` de forma plana, patrón ya establecido en todo `src/main.tsx` entre paneles hermanos. `Seguimiento comercial` sigue la misma convención (`<h2 className="followup-section-title">`) y no introduce una jerarquía nueva.
- **Anclas y foco programático:** `id="tender-follow-up"` e `id="opportunity-follow-up"` conservan `tabIndex={-1}` y `ref={followUpRef}`; `?focus=interaction` sigue llevando el foco al formulario, que ahora además es el primer elemento de la sección.
- **Placeholder multilínea:** el placeholder es una pista, no una etiqueta; el `<textarea>` conserva su `<label>Detalle del seguimiento`, que es lo que anuncia el lector de pantalla.

## Responsive

| Bloque | > 760 px | ≤ 760 px |
|---|---|---|
| Chips del banner | fila con `flex-wrap`, sin overflow horizontal | se acomodan en varias líneas, sin CSS adicional |
| Resumen prioritario | `.opportunity-insight-grid` → `repeat(auto-fit,minmax(210px,1fr))` | una columna (regla existente, `src/styles.css:179`) |
| Seguimiento comercial | `minmax(0,3fr) minmax(280px,2fr)`, historial izquierda / formulario derecha | una columna, formulario primero e historial después |
| `Más información` | `.grid.three` a tres columnas | una columna desde `max-width:1100px` (regla existente) |

## Estados vacíos

- **Próxima gestión** sin `next_action_at`: `fmtDate` devuelve `'—'` y el detalle muestra `Sin agenda · Programar próxima gestión`, comportamiento ya existente de `nextActionStatus`.
- **Último seguimiento** sin `last_interaction_at`: el valor principal muestra `'—'`; si además no hay `updated_at` ni `created_at`, `lastDays === null` y el detalle muestra `'Sin registro'`.
- **Cierre estimado** sin `expected_close_date`: `fmtDateOnly` devuelve `'—'` (fallback de `formatDateOnly`).
- **Contacto decisor** sin nombre, correo ni teléfono: `'Por completar'`.
- **Ubicación (chip)** sin ciudad ni sede: el chip no se renderiza; la fila queda con dos chips.
- **Historial de seguimiento** sin interacciones visibles y sin observación migrable (vacía o ya cubierta por una nota): `Sin seguimientos registrados.`
- **Historial de seguimiento** con sólo la observación migrada: se muestra un único evento `Nota · Migrado / sistema`.
- **`Más información`**: nunca vacío en su totalidad; la trazabilidad legacy puede estar completamente ausente sin que eso oculte el `<details>`.
- **`Más información`** con `Sector` vacío: muestra el `—` estándar de `Info`.

## Fuera de alcance

- Migraciones de base de datos, cambios de esquema o de la respuesta de `/api/opportunity-detail`.
- Cambios de API, endpoints o contratos de datos, incluido el payload de `POST /api/opportunity-interactions`.
- Cambios de permisos, roles o alcance de autorización, incluida la lógica de `canRenderOpportunityCopilot`.
- La rama de licitaciones (`service_type_code === 'licitacion_publica'`) y sus componentes (`PublicTenderFollowUp`, `TenderDetailNavigation`, `TenderDocumentReviewPanel`, `TenderGoNoGoDecisionPanel`, `TenderOfferPreparationPanel`, `TenderDossierWorkspacePanel`).
- El componente `VigiaOpportunityCopilot` y el modelo de IA que lo alimenta: sólo se reubica el punto donde `OpportunityDetail` lo invoca.
- `OpportunityForm` (creación/edición de oportunidades).
- Documentos (`interaction_type === 'documento'`): siguen ocultos del historial, sin exponerse en ningún punto de este diseño.
- Consolidar `interactionTypeLabels` (local a `FollowUpForm`) con `INTERACTION_TYPE_LABELS` — duplicación intencional, justificada en la sección 5.
- Nuevas validaciones (`minLength` u otras) en `FollowUpForm`.
- Escritura en base de datos del evento migrado sintético.
- Renombrar o reestructurar los campos `legacy_excel_id`, `excel_hoja_origen`, `estado_pipeline_original` u `observaciones` en el modelo de datos.
- Cambios a los componentes compartidos `Info`, `Dt`, `Badge` y `Panel`, y a las reglas CSS compartidas listadas en «CSS nuevo».
- Corregir el `aria-label` inerte del tablero de oportunidades (`src/main.tsx:647`).
- Reestructurar `src/main.tsx` más allá de `OpportunityDetail` y del copy de `FollowUpForm`.

## Criterios de aceptación

1. El panel `Datos comerciales` ya no existe en `src/main.tsx`, y el componente `Dt` deja de usarse en la rama no licitatoria del detalle.
2. El banner de una oportunidad no licitatoria muestra, además de lo que ya mostraba (etapa, empresa, responsable, regional, valor, `Editar`), chips de `Servicio` y `Tipo de cliente` siempre, y de `Ubicación` sólo cuando hay ciudad o sede; nunca un chip de `Área comercial`. El banner de licitaciones no cambia.
3. El `grid three` de once campos ya no existe; en su lugar hay exactamente cuatro tarjetas: `Próxima gestión`, `Último seguimiento`, `Cierre estimado`, `Contacto decisor`, dentro de un `<section aria-label="Resumen prioritario de la oportunidad">`.
4. `Fecha creación`, `Área comercial` y `Sector` aparecen dentro de un único `<details><summary>Más información</summary>` al final de la vista no licitatoria, y ese bloque no contiene `observaciones` en ningún punto.
5. La trazabilidad legacy (`legacy_excel_id`, `excel_hoja_origen`, `estado_pipeline_original`) aparece dentro de `Más información` campo por campo, sólo cuando tiene contenido.
6. Existe una sección `Seguimiento comercial` con el historial (60 % en escritorio, a la izquierda) y el formulario (40 % en escritorio, a la derecha); en móvil (≤ 760 px) el formulario aparece antes que el historial, en una sola columna.
7. El panel de historial se titula `Historial de seguimiento` y cada evento muestra un rótulo humano del tipo de interacción (`Cambio de estado`, no `cambio_estado` ni `Cambio De Estado`), sin alterar el texto de `notes`.
8. `o.observaciones`, cuando tiene contenido y no está cubierto por una nota visible, aparece como evento migrado (`Nota`, `Migrado / sistema`, fecha `quote_date || created_at`) intercalado cronológicamente en el historial, sin escritura en base de datos. Cuando sí está cubierto, no se duplica.
9. `FollowUpForm` sigue publicando en `POST /api/opportunity-interactions?id=...` con el mismo payload y los mismos rótulos, y agrega el párrafo de contexto y el placeholder de tres líneas (mediante expresión JSX, no literal de atributo), sin `minLength` nuevo.
10. Los documentos (`interaction_type === 'documento'`) siguen ocultos del historial.
11. `VigiaOpportunityCopilot` se renderiza inmediatamente después de `Seguimiento comercial` en la rama no licitatoria, con el mismo guard y los mismos props que hoy.
12. `src/opportunity-followup-presentation.js` existe como módulo JS puro (sin JSX/DOM), exporta los siete símbolos especificados, tiene su `.d.ts` de firmas y es importable directamente desde una prueba Node sin transpilación.
13. El CSS nuevo es aditivo: ninguna regla compartida preexistente cambia, y `.event strong{text-transform:capitalize}` se neutraliza sólo dentro de `.followup-timeline`.
14. El párrafo del formulario nombra al agente como `Vig-IA Comercial` vía `VIGIA_VISIBLE_NAMES.commercial`, y `tests/vigia-visible-identity-static.test.mjs` sigue pasando sin modificaciones.
15. No hay cambios de esquema de base de datos, de API ni de permisos.
16. Las pruebas unitarias del nuevo módulo, la prueba estática del nuevo layout y la suite completa pasan en verde antes de considerar la tarea completa.
