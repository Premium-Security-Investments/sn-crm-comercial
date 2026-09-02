# AGT-003 / Vig-IA: QA visual consolidado — diseño

**Fecha:** 2026-09-02
**Estado:** Diseño aprobado. Producto ya aprobó las recomendaciones de QA visual consolidado y autorizó explícitamente la implementación (no es un documento de propuesta pendiente de aprobación).
**Alcance:** frontend puro dentro de AGT-003/Vig-IA — `src/vigia/VigiaCommercial.tsx`, `src/vigia/VigiaOpportunityCopilot.tsx`, `src/vigia/copilot-presentation.ts`, `src/main.tsx` (`ConsultantDetail`, `MyDayGroup`), `src/styles.css`. **No** se crean endpoints, no hay migraciones, no se toca `access-control.js`, no se amplían permisos del copiloto, no se activa preflight IA, no se agregan dependencias.
**Rama:** `fix/agt003-consolidated-visual-qa-20260902` (ya creada; base `main` en `cdabf1d`).
**No toca:** AGT-002, `src/tenders/**`, `server/`, `api/`, `supabase/migrations/`, ningún archivo de `contracts/agents/AGT-002/*`.

## Problema

Un QA visual del corte más reciente de AGT-003/Vig-IA (Prioridades Comerciales, tarjetas de oportunidad, "Mi día" y el copiloto de oportunidad) encontró seis focos de fricción visual/de accesibilidad, todos frontend-only y todos verificables leyendo el código actual:

1. **`Prioridades Comerciales` es demasiado alta antes de llegar a resultados.** `.priority-filter-tab` tiene `min-height:118px` para 7 botones de categoría que hoy se acomodan en `grid-template-columns:repeat(3,minmax(0,1fr))` (3 columnas ⇒ 7 tarjetas ocupan 3 filas), y `.vigia-command-hero` usa `padding:24px`/`h2{font-size:28px}`. El resultado es un desplazamiento vertical largo antes de que el comercial vea filtros o resultados. No hay ninguna regla `@media(min-width:1800px)`: en monitores anchos el espacio horizontal disponible no se aprovecha para bajar la altura.
2. **Las acciones de la tarjeta de prioridad no tienen estilo dedicado.** `VigiaCommercial.tsx` ya renderiza exactamente dos acciones por tarjeta — `<a className="button" href="...">Registrar seguimiento</a>` y `<a className="button secondary" href="...">Ver oportunidad</a>` (`src/vigia/VigiaCommercial.tsx:189`) — pero `styles.css` no tiene ninguna regla `.vigia-card-actions .button`/`.vigia-card-actions .button.secondary`. Sin una regla propia, esos `<a>` se renderizan como enlaces de navegador sin estilo (azul, subrayado, sin fondo, sin padding): visualmente rotos, sin `min-height` de 44px, sin `:hover`/`:focus-visible` dedicados.
3. **La tarjeta de prioridad filtra mal su propia evidencia — en dos lugares, no sólo uno.** `priority.evidence.activity_basis` (`vigia-engine.js::activityEvidence`) es literalmente uno de los nombres de columna de la base de datos — `'last_interaction_at' | 'updated_at' | 'created_at' | 'missing'` — y se interpola sin traducir: `` `Actividad: {displayDate(...)} ({priority.evidence.activity_basis})` `` (`VigiaCommercial.tsx:188`). El mismo problema, más grave porque no pasa por ningún formateador, aparece en `priority.signals[].evidence` (`VigiaCommercial.tsx:186`, `<span>{signal.evidence}</span>`, sin ningún saneamiento hoy): `vigia-engine.js` construye varios de esos textos interpolando directamente valores crudos del CRM — `` `Próxima gestión vencida: ${row.next_action_at}.` `` (`vigia-engine.js:118`, timestamptz completo con hora y zona, p. ej. `2026-07-21T14:29:00+00:00`), `` `Valor registrado: ${offerValue} COP.` `` (`vigia-engine.js:135`, monto con la palabra `COP` como **sufijo**, p. ej. `75310000 COP`), y `` `Campos inválidos: ${activity.invalid_fields.join(', ')}.` `` (`vigia-engine.js:120`, que puede contener literalmente `last_interaction_at`/`updated_at`/`created_at`, los mismos nombres de columna crudos). Esto es exactamente lo que capturó el QA visual: una tarjeta mostrando `last_interaction_at`, `2026-07-21T14:29:00+00:00` y `75310000 COP` sin traducir. El formateador de fecha `const date = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' })` (`VigiaCommercial.tsx:40`) no fija `timeZone: 'America/Bogota'` ni incluye hora, así que dos usuarios en husos horarios distintos (o un proceso Node en UTC) pueden ver una fecha distinta para el mismo instante, y ninguna fecha con hora visible indica a qué hora ocurrió el hecho. `money.format(priority.offer_value)` (`VigiaCommercial.tsx:185`) produce `$75.310.000` sin la palabra `COP`, ambigua frente a otras monedas si el dato se comparte fuera de pantalla (captura, exportación).
4. **"Mi día" no rotula su primer dato y no existe para el gerente.** `MyDayGroup` (`src/main.tsx:747-760`) ya rotula `Falta:`/`Objetivo:` pero deja el primer párrafo (`a.fact`) sin etiqueta — inconsistente con el resto de la tarjeta. Además, `buildMyDayQueue`/`MyDayGroup` (spec `2026-09-02-agt003-integrated-followup-v1-design.md`, ya implementada) sólo se renderiza dentro de `{personal && ...}` (`src/main.tsx:2363`): un gerente que abre el detalle de un consultor específico (`personal === false`) no ve ninguna versión de esta cola, aunque `myDay` ya se calcula sin condicionar a `personal` (`src/main.tsx:2259`) — el dato está disponible, sólo no se renderiza.
5. **El copiloto de oportunidad tiene un foco programático feo y un botón de refresco aislado.** `VigiaCopilotProposal` (`src/vigia/VigiaOpportunityCopilot.tsx:53-81`) enfoca por script un `<h4 tabIndex={-1}>Siguiente paso sugerido</h4>` sin ninguna regla `:focus`/`:focus-visible` que suprima el anillo de foco nativo del navegador — como el foco es programático (no un clic ni un tab del usuario), Chromium igual lo trata como `:focus-visible` y dibuja el rectángulo por defecto alrededor de un encabezado decorativo, no de un control interactivo. Por separado, el botón secundario de regeneración (`Actualizar borrador`) vive en `.vigia-copilot-generate`, un contenedor que persiste **entre** `VigiaCommercialAlerts` y el resultado (`VigiaOpportunityCopilot.tsx:123-125`) incluso cuando ya existe una propuesta — queda visualmente huérfano, no asociado a la propuesta que actualiza.
6. **El contexto del copiloto duplica información y no clasifica la incertidumbre.** `<details className="vigia-copilot-context"><summary>Ver contexto analizado</summary>` (`VigiaOpportunityCopilot.tsx:72-79`) repite dentro del plegable el resumen narrativo (`presented.summary`) y el objetivo de contacto (`presented.contactObjective`), que son justamente lo que el comercial necesita ver primero, no al final de un plegable. `missing_information` no se presenta en absoluto hoy (fue retirado explícitamente en la spec 2026-08-31 para no duplicar el plan de contacto), así que un comercial no tiene ninguna señal visual de "esto es lo que Vig-IA no pudo confirmar". Las inferencias muestran `Confianza {item.confidence}` con el valor crudo en inglés (`low`/`medium`/`high`), no una insignia en español.

Ninguno de estos seis puntos requiere cambiar el motor de priorización (`vigia-engine.js`), el contrato del copiloto, ni el módulo puro `my-day-presentation.ts` — todos son de presentación (CSS + JSX + funciones puras de saneamiento de texto) sobre datos que ya llegan al frontend.

## Objetivos

- **A.** Reducir la altura de `Prioridades Comerciales` antes de ver filtros/resultados, preservando las 7 categorías operativas y su comportamiento de filtro exacto, con una fila de 7 en pantallas ≥1800px.
- **B.** Dar estilo accesible (44px, contraste, sin subrayado en la secundaria) a las dos acciones ya existentes de la tarjeta de prioridad, y sanear la evidencia que hoy expone claves técnicas/husos horarios ambiguos/montos sin unidad.
- **C.** Rotular el primer dato de cada tarjeta de "Mi día" (`Qué pasó:`) y extender la misma cola — mismo motor, mismos componentes — a la vista gerencial de un consultor específico, en tercera persona.
- **D.** Quitar el rectángulo de foco feo del copiloto, mover el refresco a la cabecera de la propuesta ya generada, y reestructurar el resultado visible como `Qué pasó` / `Falta` / `Objetivo` / `Siguiente paso` (énfasis), con la revisión humana antes de las acciones finales.
- **E.** Renombrar el plegable a `Contexto y evidencia`, con resumen de conteo y chevron; mostrar `missing_information` como `Información no verificada` (nunca como hecho); insignias en español para la confianza de las inferencias; sin duplicar resumen/objetivo/plan dentro del plegable.
- **F.** Verificar que cada cambio anterior deja objetivos táctiles ≥44px, `:focus-visible` en controles reales, medida de lectura y apilado en móvil, sin regresiones visuales globales fuera de los componentes tocados.

## No objetivos

- No se toca `vigia-engine.js`, `/api/vigia/priorities`, `/api/vigia/copilot/generate`, ni el contrato de `CopilotResult`/`CopilotBrief` — sólo su presentación.
- No se rediseña `Prioridades Comerciales`: se preservan las 7 categorías, sus contadores, `filterCommercialPriorities`/`summarizeCommercialPriorities` (`priority-filters.js`), el panel de filtros y la grilla de tarjetas.
- No se toca `my-day-presentation.ts` (módulo puro `buildMyDayQueue`): ni sus tipos, ni sus reglas de elegibilidad/ranking/tope. La reutilización gerencial (C) consume exactamente su misma salida.
- No se crea un segundo motor ni una bandeja global de "Mi día" para todos los consultores a la vez: la extensión gerencial sigue viviendo dentro de `ConsultantDetail`, para un único `ownerId` a la vez — el mismo alcance que ya tiene esa vista.
- No se reescribe semánticamente el texto libre que devuelve el modelo (`facts`/`inferences`/`missing_information`): sólo se (1) filtra lo técnico (ya existente, `isTechnicalCopilotText`), (2) se reformatean sustantivos reconocibles y de bajo riesgo de falso positivo — fechas ISO completas con hora+zona, y montos explícitamente prefijados con `COP` — y (3) se clasifica visualmente toda inferencia como "por confirmar". Nunca se intenta inferir significado de texto no estructurado.
- No se agrega ninguna acción de envío, ninguna escritura automática, ningún nuevo permiso de copiloto.
- No se agregan dependencias nuevas.

## Decisión

### A. Densidad de `Prioridades Comerciales`

**Botones/JSX:** sin cambios. Los 7 `<button className="priority-filter-tab ...">` (`VigiaCommercial.tsx:153-159`) y su `toggleCategory` conservan exactamente su comportamiento actual.

**CSS (`src/styles.css`, bloque "Prioridades Comerciales — filtros consolidados", línea ~362):**

Base — 4 columnas (7 tarjetas ⇒ 4+3), altura reducida, densidad mayor:
```css
.priority-filter-tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.priority-filter-tab{display:grid;gap:3px;min-height:84px;padding:12px 14px;text-align:left;border:1px solid #dce7f4;border-top:4px solid #2563eb;border-radius:14px;background:#fff;color:#17345b;box-shadow:0 6px 16px rgba(31,65,110,.06)}
.priority-filter-tab strong{font-size:22px}
```
(`.priority-filter-tab small/span/.danger/.amber/.blue/.active*` no cambian de declaración, sólo heredan el nuevo `padding`/`min-height` del selector base.)

Pantallas anchas — una sola fila de 7:
```css
@media(min-width:1800px){.priority-filter-tabs{grid-template-columns:repeat(7,minmax(0,1fr))}}
```

`.priority-filter-grid` (el panel de selects debajo) **no cambia** de breakpoints; se separa de `.priority-filter-tabs` en las reglas combinadas existentes:
```css
@media(max-width:1100px){.priority-filter-tabs{grid-template-columns:repeat(2,minmax(0,1fr))}.priority-filter-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.priority-search{grid-column:span 2}}
@media(max-width:700px){.priority-filter-grid{grid-template-columns:1fr 1fr}.priority-filter-heading{align-items:flex-start}.priority-search{grid-column:1/-1}}
@media(max-width:480px){.priority-filter-grid{grid-template-columns:1fr}.priority-search{grid-column:auto}}
@media(max-width:640px){.priority-filter-tabs{grid-template-columns:1fr}.priority-filter-tab{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:44px;padding:10px 12px}.priority-filter-tab strong{font-size:18px}}
```
(Antes, `.priority-filter-tabs` compartía selector con `.priority-filter-grid` en las reglas de 700px/480px, forzando 2/1 columnas en ambas a la vez; se separan para que `.priority-filter-tabs` siga sólo la escalera 1800/base/1100/640 pedida, y `.priority-filter-grid` conserve su escalera 1100/700/480 actual sin cambios de comportamiento.) A ≤640px, `.priority-filter-tab` pasa de `display:grid` (rótulo/contador/ayuda apilados verticalmente) a `display:flex` (fila horizontal compacta: rótulo — contador — ayuda), reduciendo la altura por tarjeta sin perder ningún dato visible; `min-height:44px` mantiene el objetivo táctil.

**Hero (`.vigia-command-hero`, mismo bloque "Vig-IA Comercial Gate 0", línea ~359):**
```css
.vigia-command-hero{padding:18px 22px}
.vigia-command-hero h2{margin:5px 0 6px;font-size:23px}
```
(Resto de `.vigia-command-hero`/`.vigia-source-status` sin cambios — no se toca el gradiente, el layout de dos columnas ni `.centinel-topline`.)

Con esto, en desktop normal el hero + 7 tarjetas en 2 filas de ~84px caben en un alto sensiblemente menor que hoy (118px × 3 filas), y en ≥1800px las 7 caben en una sola fila.

### B. Tarjetas de oportunidad antes de entrar al detalle

**Acciones (`VigiaCommercial.tsx:189`):** el JSX ya es correcto — `<a className="button" href={...}>Registrar seguimiento</a>` (primaria) y `<a className="button secondary" href={...}>Ver oportunidad</a>` (secundaria), ambas dentro de `.vigia-card-actions`. Sólo falta CSS dedicado. Agregar al bloque "Vig-IA Comercial Gate 0" (`src/styles.css`, junto a la regla existente `.vigia-card-actions,.vigia-feedback{display:flex;flex-wrap:wrap;gap:8px}`):
```css
.vigia-card-actions .button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:11px 16px;border-radius:11px;background:#1b64f2;color:#fff;font-weight:800;font-size:13px;text-decoration:none;text-align:center;transition:background .16s ease}
.vigia-card-actions .button:hover{background:#123f8e}
.vigia-card-actions .button:focus-visible{outline:3px solid #93c5fd;outline-offset:2px}
.vigia-card-actions .button.secondary{background:#e9eef7;color:#1b355f;border:1px solid #cbd9e8}
.vigia-card-actions .button.secondary:hover{background:#dce6f5}
```
(Colores reutilizados 1:1 de patrones ya existentes: `#1b64f2`/`#fff` es el mismo primario que `.my-day-card .button`; `#e9eef7`/`#1b355f` es el mismo secundario que `.secondary`/`.critical-opportunities-table .button.secondary`; `#93c5fd` es el mismo anillo de foco que `.my-day-card .button:focus-visible`. Cero paletas nuevas.) Apilado móvil, en la regla `@media(max-width:560px)` ya existente del mismo bloque:
```css
@media(max-width:560px){.vigia-summary-grid{grid-template-columns:1fr}.vigia-evidence{grid-template-columns:1fr}.vigia-control-strip{align-items:flex-start;flex-direction:column}.vigia-card-actions{flex-direction:column}.vigia-card-actions .button{width:100%}}
```

**Saneamiento de evidencia — sanitizador compartido (`src/vigia/text-sanitizer.ts`, nuevo) + `VigiaCommercial.tsx`:**

El QA visual mostró tres clases de fuga simultáneas en la misma tarjeta (`last_interaction_at`, `2026-07-21T14:29:00+00:00`, `75310000 COP`, ver Problema #3), y dos de las tres ocurren dentro de `priority.signals[].evidence` — texto libre construido por `vigia-engine.js`, no un valor enumerado como `activity_basis`. Un solo diccionario de `activity_basis` no alcanza para sanear texto libre; se introduce un sanitizador de texto único, reutilizado también por el copiloto (sección D.1) para no mantener dos implementaciones con capacidades distintas:

```ts
// src/vigia/text-sanitizer.ts
const DB_KEY_LABEL: Record<string, string> = {
  last_interaction_at: 'última interacción registrada',
  updated_at: 'última actualización del registro',
  created_at: 'creación del registro',
  offer_value: 'valor de la oferta',
};
const DB_KEY_PATTERN = new RegExp(`\\b(${Object.keys(DB_KEY_LABEL).join('|')})\\b`, 'g');
const ISO_DATETIME = /\b(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)(Z|[+-]\d{2}:?\d{2})\b/g;
// Una sola alternancia con dos grupos de captura mutuamente excluyentes evita procesar dos veces
// el mismo monto: aplicar primero un regex de prefijo (`COP 75310000`) y luego uno de sufijo
// (`75310000 COP`) haría que el segundo re-matchee el resultado `$75.310.000 COP` ya formateado
// por el primero (los dígitos agrupados con puntos siguen calzando `[\d.,]{4,}`), produciendo `$$`.
const COP_AMOUNT = /(?:COP\s*([\d.,]{4,}))|(?:\b([\d.,]{4,})\s*COP\b)/gi;
const BOGOTA_DATETIME_LABEL = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' });
const COP_GROUPING = new Intl.NumberFormat('es-CO');

export function humanizeVigiaText(text: string | null | undefined): string {
  let result = String(text ?? '');
  result = result.replace(DB_KEY_PATTERN, match => DB_KEY_LABEL[match] || match);
  result = result.replace(ISO_DATETIME, match => {
    const parsed = new Date(match);
    return Number.isNaN(parsed.getTime()) ? match : BOGOTA_DATETIME_LABEL.format(parsed);
  });
  result = result.replace(COP_AMOUNT, (match, prefixDigits, suffixDigits) => {
    const digits = prefixDigits ?? suffixDigits;
    const amount = Number(String(digits).replace(/[.,]/g, ''));
    return Number.isFinite(amount) && amount > 0 ? `$${COP_GROUPING.format(amount)} COP` : match;
  });
  return result;
}
```
Comportamiento defensivo explícito, igual que el resto del corte: si la fecha capturada no parsea o el monto capturado no da un número positivo finito, la función devuelve el fragmento **original sin tocar** — nunca inventa ni oculta datos. Texto no reconocido (p. ej. `4 24 horas` dentro de una nota migrada) queda intacto. `DB_KEY_PATTERN` sólo reemplaza los cuatro nombres de columna literales pedidos (`last_interaction_at`/`updated_at`/`created_at`/`offer_value`); ninguno de los cuatro contiene dígitos ni la palabra `COP`, así que no interfiere con los dos reemplazos siguientes, y el orden (claves → fechas → montos) es estable independientemente de qué patrones aparezcan en el texto de entrada.

Uso en `VigiaCommercial.tsx`:
1. **`priority.signals[].evidence`** — se sanea siempre, sin excepción: `<span>{humanizeVigiaText(signal.evidence)}</span>` (línea 186). Esto cubre directamente los tres textos crudos de `vigia-engine.js` descritos en el Problema #3 (`Próxima gestión vencida: {ISO}.`, `Valor registrado: {monto} COP.`, `Campos inválidos: {claves}.`) sin tocar `vigia-engine.js`.
2. **Pie de evidencia estructurado** (`.vigia-evidence`, línea 188) — `activity_basis` es un valor enumerado (no texto libre), así que se resuelve con un lookup dedicado que reutiliza el mismo diccionario de etiquetas, para no mantener dos textos distintos para la misma clave:
```ts
import { humanizeVigiaText, DB_KEY_LABEL } from './text-sanitizer';

function activityBasisLabel(basis: string): string {
  return DB_KEY_LABEL[basis] || (basis === 'missing' ? 'sin actividad registrada' : 'sin dato de origen');
}
```
Uso: `` `Actividad: ${displayDate(priority.evidence.activity_at)} (${activityBasisLabel(priority.evidence.activity_basis)})` ``. `activity_basis` sólo puede ser uno de `'last_interaction_at' | 'updated_at' | 'created_at' | 'missing'` (`vigia-engine.js::activityEvidence`, ver Problema #3); el fallback `'sin dato de origen'` es defensivo para cualquier valor futuro no anticipado, nunca se alcanza con el motor actual. `next_action_at`/`expected_close_date` en ese mismo pie ya pasan por `displayDate`/`displayDateOnly` (valores formateados, no texto libre), así que no necesitan `humanizeVigiaText` — no hay texto crudo remanente en el pie estructurado una vez aplicado este lookup.
3. **Huso horario del formateador de fecha existente** — anclar a Bogotá (mismo patrón ya usado en `vigia-engine.js`/`opportunity-ficha-presentation.ts`/`my-day-presentation.ts`):
```ts
const date = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: 'America/Bogota' });
```
(Único cambio: se agrega `timeZone: 'America/Bogota'` al objeto de opciones ya existente en `VigiaCommercial.tsx:40`. `displayDate`/`displayDateOnly` no cambian de firma. Este formateador queda deliberadamente sin `timeStyle` — sigue siendo una fecha corta para el pie de tarjeta, distinta de `BOGOTA_DATETIME_LABEL` en `text-sanitizer.ts`, que sí necesita hora porque reformatea timestamps completos embebidos en texto libre.)
4. **Monto de la tarjeta** — sufijo explícito de moneda, sin cambiar el formateador `money` (que ya usa `style:'currency',currency:'COP'` y produce el símbolo `$` agrupado con puntos, formato correcto salvo la unidad explícita):
```tsx
<strong>{Number(priority.offer_value) > 0 ? `${money.format(priority.offer_value)} COP` : 'Valor no registrado'}</strong>
```

Ninguno de estos cambios toca `vigia-engine.js` (el backend sigue devolviendo `activity_basis`/`activity_at`/`offer_value`/`signals[].evidence` tal cual); todo el saneamiento vive en la capa de presentación (`text-sanitizer.ts` + `VigiaCommercial.tsx`), reutilizada también por `copilot-presentation.ts` (sección D.1).

### C. Descubribilidad de "Mi día"

**C.1 — Rótulo `Qué pasó:` (`MyDayGroup`, `src/main.tsx:747-760`):**
```tsx
function MyDayGroup({ title, alerts, total, tone, empty }: { title: string; alerts: MyDayAlert[]; total: number; tone: string; empty: string }) {
  return <div className={`my-day-group my-day-${tone}`}>
    {title && <h4>{title}{total > alerts.length ? ` · mostrando ${alerts.length} de ${total}` : ''}</h4>}
    {alerts.length
      ? <div className="my-day-list">{alerts.map(a => <article className="my-day-card" key={a.id}>
          <strong>{a.companyName}</strong>
          <p className="my-day-fact"><em>Qué pasó:</em> {a.fact}</p>
          <p className="my-day-gap"><em>Falta:</em> {a.gap}</p>
          <p className="my-day-goal"><em>Objetivo:</em> {a.goal}</p>
          <a className="button" href={a.ctaHref}>Preparar seguimiento</a>
        </article>)}</div>
      : (empty && <p className="my-day-empty">{empty}</p>)}
  </div>;
}
```
(Único cambio: `<p>{a.fact}</p>` → `<p className="my-day-fact"><em>Qué pasó:</em> {a.fact}</p>`, mismo patrón ya usado por `.my-day-gap`/`.my-day-goal`. `MyDayAlert.fact`/`gap`/`goal` — el contenido de texto — no cambia; sólo se le agrega el rótulo visual que ya tienen sus dos hermanos.)

**CSS** (bloque "Mi día", `src/styles.css` línea ~215-231) — se extiende la lista de selectores existente para incluir `.my-day-fact em`, sin cambiar ningún valor de color:
```css
.my-day-card .my-day-fact em,.my-day-card .my-day-gap em,.my-day-card .my-day-goal em{font-style:normal;color:#bfdbfe;font-weight:800}
.my-day-secondary .my-day-card .my-day-fact em,.my-day-secondary .my-day-card .my-day-gap em,.my-day-secondary .my-day-card .my-day-goal em,.my-day-muted .my-day-card .my-day-fact em,.my-day-muted .my-day-card .my-day-gap em,.my-day-muted .my-day-card .my-day-goal em{color:#1d4ed8}
```

**C.2 — Reutilización gerencial (`ConsultantDetail`, `src/main.tsx`):** `myDay` ya se calcula sin condicionar a `personal` (`const myDay = useMemo(() => buildMyDayQueue(opportunities, new Date()), [opportunities]);`, línea 2259) — no se toca esa línea, ni `my-day-presentation.ts`. Se agrega un bloque nuevo, hermano de `{personal && <div className="personal-dashboard">...}`, condicionado a `!personal` (mutuamente excluyente con el bloque personal existente):
```tsx
<div className="actions-row">{/* ... sin cambios ... */}</div>
{!personal && <section className="commercial-followup-banner my-day-manager-banner" aria-label={`Prioridades de hoy de ${ownerName}`}>
  <div className="commercial-followup-copy">
    <span className="eyebrow">Prioridades de hoy</span>
    <h3>Prioridades de hoy de {ownerName}</h3>
    <p>{(myDay.hacerHoy.length || myDay.preparar.length || myDay.depurarCrm.length)
      ? `Resumen de las gestiones más urgentes de ${ownerName} para hoy, con el mismo criterio de priorización que Mi día.`
      : `${ownerName} no tiene gestiones vencidas, sin agenda ni decisores pendientes por confirmar hoy.`}</p>
  </div>
  <div className="my-day">
    <MyDayGroup title="Hacer hoy" alerts={myDay.hacerHoy} total={myDay.hacerHoyTotal} tone="primary" empty={`${ownerName} no tiene próximas gestiones vencidas o sin agendar.`} />
    {(myDay.preparar.length > 0) && <MyDayGroup title="Preparar" alerts={myDay.preparar} total={myDay.prepararTotal} tone="secondary" empty="" />}
    {(myDay.depurarCrm.length > 0) && <details className="my-day-hygiene"><summary>Depurar CRM ({myDay.depurarCrmTotal})</summary>
      <MyDayGroup title="" alerts={myDay.depurarCrm} total={myDay.depurarCrmTotal} tone="muted" empty="" />
    </details>}
  </div>
</section>}
{personal && <div className="personal-dashboard">{/* ... sin cambios ... */}</div>}
```
Reutiliza literalmente `MyDayGroup` y `myDay` — no hay una segunda función de construcción de cola, no hay bandeja global (esto sigue siendo el detalle de **un** `ownerId`, igual que el resto de `ConsultantDetail`). La copia está en tercera persona (`{ownerName} no tiene...`, `Resumen de las gestiones más urgentes de {ownerName}...`) y el `aria-label` nombra explícitamente al consultor, a diferencia del banner personal que usa segunda persona (`Hola {ownerName}...`, `aria-label="Mi día"`). Se reutiliza la clase `.commercial-followup-banner` (mismo fondo oscuro degradado, necesario para que `.my-day-primary .my-day-card` — pensada para fondo oscuro, texto blanco — siga siendo legible) con un modificador de una sola declaración:
```css
.my-day-manager-banner{grid-template-columns:1fr}
```
(`.commercial-followup-banner` por defecto es `grid-template-columns:minmax(260px,.72fr) minmax(0,1.28fr)`, pensada para copy+tarjetas de resumen lado a lado; el banner gerencial no tiene esa segunda columna de tarjetas, así que se fuerza a una sola columna para que `.commercial-followup-copy` y `.my-day` se apilen verticalmente sin dejar una celda vacía a la derecha.)

`Hacer hoy` sigue mostrando su mensaje vacío explícito (contrato ya definido por `buildMyDayQueue`/`MyDayGroup`: tope de 3, `Preparar`/`Depurar CRM` colapsado y subordinado) — ningún comportamiento del módulo puro cambia, sólo se renderiza en un segundo lugar de la aplicación, con otra copia alrededor.

**C.3 — Objetivo táctil del CTA de "Mi día" (44px):** `.my-day-card .button` (`src/styles.css:222`) tiene hoy `min-height:40px`, por debajo del objetivo táctil de 44px que este mismo paquete exige para el resto de CTAs tocados (Objetivo B/F). Como "Mi día" se extiende a una segunda ubicación en este corte (C.2), su CTA único (`Preparar seguimiento`) queda dentro del alcance de la verificación transversal F y se corrige junto con el resto:
```css
.my-day-card .button{display:inline-flex;align-items:center;justify-content:center;gap:6px;margin-top:4px;justify-self:start;padding:10px 16px;min-height:44px;border-radius:11px;background:#1b64f2;color:#fff;font-weight:800;font-size:13px;text-decoration:none;line-height:1.1;transition:background .16s ease,box-shadow .16s ease}
```
(Único cambio respecto a la regla actual: `min-height:40px` → `44px`. El resto de la declaración, `:hover`/`:focus-visible`, y la regla responsive `@media(max-width:640px){...}.my-day-card .button{width:100%;justify-self:center}` no cambian.) Esto aplica por igual a la tarjeta personal (existente) y a la gerencial (C.2, nueva) porque ambas reutilizan el mismo `MyDayGroup`/CSS — no hay una regla separada que actualizar por vista.

### D + E. Copiloto de oportunidad — estructura del resultado y contexto plegable

D y E tocan el mismo componente (`VigiaOpportunityCopilot.tsx`) y el mismo módulo de presentación (`copilot-presentation.ts`); se documentan juntos para evitar describir dos veces la misma reestructuración de `VigiaCopilotProposal`.

**D.1 — `copilot-presentation.ts`: `missing_information` deja de descartarse; se reutiliza el sanitizador compartido; los `facts` con el marcador de migración se degradan a "no verificados".**

`humanizePresentedText` deja de definir su propio saneamiento parcial (que sólo cubría fechas ISO sin hora visible y montos con `COP` como prefijo) y pasa a ser un alias directo del sanitizador compartido introducido en la sección B (`src/vigia/text-sanitizer.ts`), que ya cubre ambas formas de monto (`COP 75310000` y `75310000 COP`), fecha+hora en Bogotá, y las cuatro claves crudas de base de datos — necesario porque el texto libre del modelo puede citar cualquiera de esos patrones igual que `vigia-engine.js`:
```ts
import { humanizeVigiaText } from './text-sanitizer';

export function humanizePresentedText(text: string): string {
  return humanizeVigiaText(text);
}
```
(Se conserva el nombre exportado `humanizePresentedText` para no romper el único call-site interno del módulo; es un alias de una línea, no una reimplementación — evita mantener dos sanitizadores con distinta cobertura, lo que sería en sí mismo una fuente de inconsistencia entre lo que se sanea en la tarjeta de prioridad y lo que se sanea en el copiloto.) Comportamiento defensivo explícito, heredado de `humanizeVigiaText`: si la fecha capturada no parsea o el monto capturado no da un número positivo finito, la función devuelve el fragmento **original sin tocar** — nunca inventa ni oculta datos. "Basura migrada" (texto que no calza ningún patrón) queda intacta y, como se ve abajo, sólo puede terminar en `facts`/`inferences`/`missingInformation` si ya venía en esa categoría desde el backend — `humanizePresentedText` nunca mueve texto entre categorías por sí sola, sólo reformatea in-place; la única reclasificación de categoría de este corte es la explícita y acotada por marcador que sigue.

**Degradación conservadora por marcador explícito (`Seguimiento migrado:`).** El backend puede entregar como `facts` notas migradas del CRM legado con forma libre y a veces truncada/mal formada (p. ej. `Seguimiento migrado: Llamada. 4 24 horas`). Presentarlas en `Datos utilizados` las hace ver como hechos confirmados por Vig-IA cuando en realidad son texto migrado sin garantía de formato. La regla es deliberadamente estrecha — un único marcador literal, sin heurística de contenido — para no caer en la reescritura semántica que el propio diseño prohíbe (ver No objetivos):
```ts
const MIGRATED_FACT_MARKER = /seguimiento migrado:/i;

function partitionMigratedFacts(entries: CopilotPresentationFact[]): { facts: CopilotPresentationFact[]; migratedTexts: string[] } {
  const facts: CopilotPresentationFact[] = [];
  const migratedTexts: string[] = [];
  for (const entry of entries) {
    if (MIGRATED_FACT_MARKER.test(entry.text)) migratedTexts.push(entry.text);
    else facts.push(entry);
  }
  return { facts, migratedTexts };
}
```
El texto del `fact` migrado **no se reescribe**: se mueve tal cual (ya pasado por `humanizeVigiaText`, igual que cualquier otro texto presentado) a la lista de `missingInformation`, para que aparezca bajo `Información no verificada` en vez de `Datos utilizados`. No se aplica ninguna heurística equivalente sobre `inferences` — toda inferencia ya vive bajo `Inferencias de Vig-IA · por confirmar` (sección E), que es la clasificación de incertidumbre correcta para texto inferido; no hay necesidad ni justificación de reescribir o mover texto como `Daniela no es...`, y este diseño explícitamente no lo intenta.

Nuevo helper de lista (paralelo a `filterCommercialEntries`, pero para `string[]` en vez de `{text}[]`):
```ts
function filterCommercialTextList(list: readonly string[] | null | undefined): string[] {
  const result: string[] = [];
  for (const raw of list ?? []) {
    const text = String(raw ?? '').trim();
    if (!text || isTechnicalCopilotText(text)) continue;
    result.push(text);
  }
  return result;
}
```

Resumen conciso de "Falta" para el bloque siempre visible (no la lista completa, que vive en el plegable):
```ts
const MISSING_INFORMATION_EMPTY = 'Sin brechas de información pendientes según el registro.';
export function summarizeMissingInformation(items: readonly string[]): string {
  if (!items.length) return MISSING_INFORMATION_EMPTY;
  return items.length > 1 ? `${items[0]} (+${items.length - 1} más)` : items[0];
}
```

`PresentedCopilotBrief` gana dos campos (`missingInformation` para la lista completa saneada, usada en "Información no verificada"; `missingSummary` para la línea concisa "Falta"); ningún campo existente cambia de tipo:
```ts
export type PresentedCopilotBrief = {
  summary: string;
  facts: CopilotPresentationFact[];
  inferences: CopilotPresentationInference[];
  missingInformation: string[];
  missingSummary: string;
  contactObjective: string;
  contactPlanSteps: string[];
  recommendedAssetIds: string[];
  hasApprovedAssets: boolean;
};

export function presentCopilotBrief(brief: CopilotPresentationBrief): PresentedCopilotBrief {
  const recommendedAssetIds = brief.recommended_asset_ids ?? [];
  const summary = presentCommercialText(humanizePresentedText(brief.summary), COMMERCIAL_TEXT_FALLBACKS.summary);
  const strategy = presentCommercialText(humanizePresentedText(brief.strategy), COMMERCIAL_TEXT_FALLBACKS.strategy);
  const contactObjective = presentCommercialText(humanizePresentedText(brief.contact_objective), COMMERCIAL_TEXT_FALLBACKS.contactObjective);
  const humanizedFacts = filterCommercialEntries(brief.facts).map(f => ({ ...f, text: humanizePresentedText(f.text) }));
  const { facts, migratedTexts } = partitionMigratedFacts(humanizedFacts);
  const missingInformation = [...filterCommercialTextList(brief.missing_information).map(humanizePresentedText), ...migratedTexts];
  return {
    summary,
    facts,
    inferences: filterCommercialEntries(brief.inferences).map(i => ({ ...i, text: humanizePresentedText(i.text) })),
    missingInformation,
    missingSummary: summarizeMissingInformation(missingInformation),
    contactObjective,
    contactPlanSteps: splitContactPlanSteps(strategy),
    recommendedAssetIds,
    hasApprovedAssets: recommendedAssetIds.length > 0,
  };
}
```
(`partitionMigratedFacts` corre sobre los `facts` ya saneados/humanizados por `filterCommercialEntries`+`humanizePresentedText` — el marcador `Seguimiento migrado:` nunca contiene fechas ISO ni montos `COP`, así que el orden humanizar-luego-partir no le cambia el resultado; se elige ese orden por simplicidad, no porque sea el único válido.)
`presentCompactCopilotSummary` (bloque "Siguiente paso") no cambia — sigue derivando `nextStep`/`whyBullets` de `contactPlanSteps`/`facts`/`inferences`, que ya vienen saneados/humanizados por `presentCopilotBrief` antes de llegar a esa función.

**D.2 + E — `VigiaOpportunityCopilot.tsx`: reestructuración de `VigiaCopilotProposal`.**

Orden final del resultado (de arriba hacia abajo):
```tsx
const CONFIDENCE_LABEL: Record<'low' | 'medium' | 'high', string> = { low: 'Baja', medium: 'Media', high: 'Alta' };

export function VigiaCopilotProposal({ brief, draft, alerts, onDraftChange, onCopy, onDiscard, onRegenerate }: ProposalProps) {
  const presented = presentCopilotBrief(brief);
  const compact = presentCompactCopilotSummary(presented, alerts);
  return <div className="vigia-copilot-result">
    <p role="status" className="sr-only">Propuesta preparada para revisión.</p>
    <header className="vigia-copilot-proposal-header">
      <h4>Propuesta de seguimiento</h4>
      <button type="button" className="secondary" onClick={onRegenerate}>Actualizar propuesta</button>
    </header>
    <section className="vigia-copilot-brief">
      <div className="vigia-copilot-brief-row"><strong>Qué pasó</strong><p>{presented.summary}</p></div>
      <div className="vigia-copilot-brief-row"><strong>Falta</strong><p>{presented.missingSummary}</p></div>
      <div className="vigia-copilot-brief-row"><strong>Objetivo</strong><p>{presented.contactObjective}</p></div>
    </section>
    {compact.nextStep && <div className="vigia-copilot-next-step">
      <strong>Siguiente paso:</strong> <span>{compact.nextStep}</span>
    </div>}
    <div className="vigia-copilot-draft"><label>Asunto<input value={draft.subject} maxLength={300} onChange={event => onDraftChange({ subject: event.target.value })}/></label><label>Cuerpo<textarea value={draft.body} maxLength={8000} rows={10} onChange={event => onDraftChange({ body: event.target.value })}/></label></div>
    <div className="vigia-human-warning"><strong>Revisión humana</strong><span>Puede editar esta propuesta sin modificar el historial de la oportunidad. Verifique nombres, fechas, compromisos y tono antes de copiar el mensaje.</span></div>
    <div className="vigia-copilot-actions"><button type="button" onClick={onCopy}>Copiar correo</button><button type="button" className="secondary" onClick={onDiscard}>Descartar</button></div>
    <details className="vigia-copilot-context">
      <summary>Contexto y evidencia · {presented.facts.length} datos · {presented.inferences.length} inferencias · {presented.missingInformation.length} pendientes</summary>
      <section><h5>Datos utilizados</h5>{presented.facts.length ? <ul>{presented.facts.map((fact, index) => <li key={`${fact.text}-${index}`}>{fact.text}</li>)}</ul> : <p className="muted">Sin datos adicionales.</p>}</section>
      <section><h5>Inferencias de Vig-IA · por confirmar</h5>{presented.inferences.length ? <ul>{presented.inferences.map((item, index) => <li key={`${item.text}-${index}`}>{item.text} <span className={`vigia-copilot-confidence confidence-${item.confidence}`}>{CONFIDENCE_LABEL[item.confidence]}</span></li>)}</ul> : <p className="muted">Sin inferencias.</p>}</section>
      <section><h5>Información no verificada</h5>{presented.missingInformation.length ? <ul>{presented.missingInformation.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <p className="muted">Sin brechas de información registradas.</p>}</section>
      {presented.hasApprovedAssets && <section><h5>Adjuntos sugeridos</h5><ul>{presented.recommendedAssetIds.map(id => <li key={id}>{id}</li>)}</ul></section>}
    </details>
  </div>;
}
```

Cambios frente al componente actual, uno por uno:
- **Sin foco programático, anuncio accesible por región `role="status"` (D):** se retira por completo el patrón `ref`/`tabIndex={-1}`/`useEffect(() => focus())` — hoy foca por script un encabezado decorativo y, al ser foco programático, Chromium igual lo trata como `:focus-visible` y dibuja el rectángulo nativo alrededor de un elemento no interactivo (Problema #5). No se reemplaza por ningún mecanismo de foco alternativo: mover el foco del usuario sin una acción de teclado/clic que lo justifique es en sí mismo el problema, no sólo su anillo visual. En su lugar, el primer hijo de `.vigia-copilot-result` es `<p role="status" className="sr-only">Propuesta preparada para revisión.</p>` — una región `role="status"` visualmente oculta (clase `.sr-only` ya existente en `styles.css:394`, sin CSS nuevo) que un lector de pantalla anuncia por el cambio de contenido/inserción en el DOM, sin mover el foco del usuario ni dejar ningún indicador visual espurio para usuarios videntes. Ningún encabezado lleva `tabIndex` ni `ref` de foco; los controles interactivos reales (`button`, `input`, `textarea`, `a`) conservan su `:focus-visible` nativo sin ninguna regla `outline:none` nueva — no se suprime el foco de ningún elemento que pueda recibirlo.
- **Refresco integrado a la cabecera (D):** `Actualizar propuesta` (antes `Actualizar borrador`) deja de vivir en `.vigia-copilot-generate` una vez que existe una propuesta; pasa a ser el segundo elemento de `.vigia-copilot-proposal-header`, siempre `secondary` (nunca compite visualmente con `Copiar correo`, que sigue siendo la acción primaria). En `VigiaOpportunityCopilot`, el botón externo `.vigia-copilot-generate` sólo se renderiza mientras **no** hay propuesta lista (`!ready`); una vez lista, desaparece de esa posición — nunca queda huérfano entre alertas y resultado.
- **Estructura Qué pasó / Falta / Objetivo / Siguiente paso, sin duplicar `whyBullets` (D):** el antiguo bloque condicional "Siguiente paso sugerido"/"Borrador editable" se reemplaza por `.vigia-copilot-brief` (siempre visible, tres filas fijas) seguido de `.vigia-copilot-next-step` (sólo si `compact.nextStep` no se abstiene — mismo criterio de abstención ya probado en `presentCompactCopilotSummary`, sin cambios). `compact.whyBullets` **no se renderiza** en ningún punto de la UI: son los mismos `facts`/`inferences` que ya resume `Qué pasó`, y mostrarlos de nuevo bajo "Siguiente paso" duplicaría esa misma información en la misma pantalla. `presentCompactCopilotSummary`/`CompactCopilotSummary`/`whyBullets` **no se tocan** en `copilot-presentation.ts` — la función sigue calculando y devolviendo `whyBullets` exactamente igual (`tests/agt003-copilot-presentation.test.mjs` ya cubre su lógica de deduplicación/truncado en detalle y no se modifica en este corte); el único cambio es que `VigiaOpportunityCopilot.tsx` deja de leer ese campo del objeto devuelto. Alcance mínimo deliberado: no hay otro consumidor de `presentCompactCopilotSummary` fuera de este componente y su propio test (verificado por búsqueda de texto), así que simplificar el tipo de retorno sería una opción válida pero innecesaria — se prefiere no tocar un módulo puro ya probado exhaustivamente cuando el fix real vive enteramente en la capa de presentación JSX.
- **Revisión humana antes de las acciones (D):** `.vigia-human-warning` se mueve de después de `.vigia-copilot-actions` a antes — el comercial ve la advertencia de revisión humana justo después de editar el borrador, antes de decidir copiar o descartar.
- **Contexto y evidencia (E):** `Ver contexto analizado` → `Contexto y evidencia · N datos · N inferencias · N pendientes` (conteo siempre visible sin necesidad de abrir); el plegable sigue cerrado por defecto (sin `open`, sin cambios de comportamiento del `<details>` nativo). Dentro: `Hechos observados` → `Datos utilizados` (mismo contenido, `presented.facts`); `Inferencias` gana el sufijo `· por confirmar` en el título de sección y una insignia `Alta`/`Media`/`Baja` por ítem (mapeada de `item.confidence`, nunca el valor crudo en inglés); nueva sección `Información no verificada` con `presented.missingInformation` (antes, inexistente); `Plan de contacto` (la lista `<ol>` completa de `contactPlanSteps`) se retira — el primer paso ya vive arriba como "Siguiente paso" destacado, y mostrar además el plan completo dentro del plegable duplicaba la misma información dos veces en la misma pantalla; el resumen narrativo (`presented.summary`) y `Objetivo de contacto` (`presented.contactObjective`) se retiran del plegable — ya viven arriba, en `Qué pasó`/`Objetivo`, sin duplicación.
- **Nunca se expone lenguaje técnico (D+E, sin cambios de comportamiento, sólo se preserva):** `isTechnicalCopilotText`/`filterCommercialEntries`/`filterCommercialTextList` siguen siendo la única puerta de entrada de cualquier texto libre del modelo hacia la UI; `evidence_refs`, `warnings`, `human_review_required`, `schema`, `payload`, `snapshot_id` nunca se leen en el componente (igual que hoy).

**`VigiaOpportunityCopilot` (componente contenedor):** cambia sólo la condición del botón de generación externo y el paso de `onRegenerate`:
```tsx
const ready = state.phase === 'ready' ? state : null;
// ...
{state.phase !== 'error' && !ready && <div className="vigia-copilot-generate">
  <button type="button" disabled={state.phase === 'loading'} onClick={generate}>{VIGIA_ready_label}</button>
</div>}
```
donde el texto del botón sigue siendo `Preparar próximo seguimiento` (nunca fue condicional a `ready` en este slot, porque ahora este slot **sólo** existe cuando `!ready`). Al invocar `VigiaCopilotProposal` se agrega `onRegenerate={generate}` a las props ya existentes (`brief`, `draft`, `alerts`, `onDraftChange`, `onCopy`, `onDiscard`). No se toca `opportunity-copilot-state.ts`: `beginCopilotGeneration` sigue transicionando a `phase:'loading'` (por eso `ready` vuelve a `null` en cuanto se pulsa `Actualizar propuesta`, desmontando la propuesta anterior y mostrando el aviso de carga ya existente — mismo comportamiento de hoy al regenerar, sólo cambia dónde vivía el botón que lo dispara).

**CSS (`src/styles.css`, bloque "Vig-IA Comercial — copiloto en detalle de oportunidad", línea ~479-497):**
```css
.vigia-copilot-proposal-header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.vigia-copilot-proposal-header h4{margin:0;color:#10213d}
.vigia-copilot-brief{display:grid;gap:10px;padding:14px;border-radius:14px;background:#f8fbff;border:1px solid #e2eaf5}
.vigia-copilot-brief-row{display:grid;gap:2px}
.vigia-copilot-brief-row strong{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#527099}
.vigia-copilot-brief-row p{margin:0;color:#17345b}
.vigia-copilot-next-step{margin:0;padding:12px 14px;border-radius:12px;background:#eff6ff;border:1px solid #bfdbfe;color:#124174}
.vigia-copilot-next-step strong{color:#0b2f61}
.vigia-copilot-confidence{display:inline-flex;padding:3px 8px;border-radius:999px;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.04em;margin-left:6px}
.vigia-copilot-confidence.confidence-high{background:#dbeafe;color:#1d4ed8}
.vigia-copilot-confidence.confidence-medium{background:#fef3c7;color:#92400e}
.vigia-copilot-confidence.confidence-low{background:#f1f5f9;color:#64748b}
.vigia-copilot-context>summary{display:flex;align-items:center;gap:7px;list-style:none;cursor:pointer;color:#17345b}
.vigia-copilot-context>summary::-webkit-details-marker{display:none}
.vigia-copilot-context>summary:before{content:"▸";display:inline-block;font-size:11px;color:#527099;transition:transform .15s ease}
.vigia-copilot-context[open]>summary:before{transform:rotate(90deg)}
```
No se agrega ninguna regla `:focus`/`outline:none` sobre `.vigia-copilot-proposal-header h4` — el encabezado ya no recibe foco programático, así que no hay ningún anillo que suprimir (ver bullet de foco arriba); esto es, en sí mismo, el fix del Problema #5, no una regla CSS adicional. Se retiran (huérfanas tras el cambio de JSX, ya sin selector consumidor): `.vigia-copilot-summary`, `.vigia-copilot-summary h4`, `.vigia-copilot-summary .vigia-copilot-why` (reemplazadas por `.vigia-copilot-next-step`, que ya no tiene una variante `.vigia-copilot-why` porque `compact.whyBullets` no se renderiza en ningún punto de la UI, ver bullet de estructura arriba), `.vigia-copilot-plan ol` (la sección "Plan de contacto" se retira del JSX, ver arriba). El resto del bloque (`.vigia-opportunity-copilot`, `.vigia-copilot-draft`, `.vigia-human-warning`, `.vigia-copilot-actions`, `.vigia-copilot-generate`, `.vigia-copilot-error`, `.vigia-copilot-evidence` si sigue en uso por `.vigia-copilot-result details` genérico) no cambia.

### F. Responsive/accesibilidad — verificación transversal

No es un bloque de código nuevo: es la lista de propiedades que cada cambio anterior debe cumplir, verificada en el cierre de cada slice del plan y en el cierre general:
- **Objetivos táctiles ≥44px:** `.priority-filter-tab` (84px desktop, 44px en ≤640px), `.vigia-card-actions .button`/`.button.secondary` (44px), `.my-day-card .button` (sube de `min-height:40px` a `44px` en este mismo corte — ver sección C.3 — para cumplir el requisito de objetivo táctil aprobado; hasta ahora era el único CTA por debajo de 44px en el alcance tocado).
- **`:focus-visible` en controles reales, nunca en decorativos:** `.vigia-card-actions .button:focus-visible` (nuevo); el `<h4>` de la cabecera del copiloto nunca recibe foco (sin `tabIndex`, sin `ref` de foco) así que no necesita ni lleva ninguna regla `outline:none` — el `button` de esa misma cabecera conserva el `:focus-visible` por defecto del navegador, intacto.
- **Medida de lectura / espaciado compacto:** `.vigia-copilot-brief-row p`, `.vigia-copilot-next-step` heredan `max-width` implícito del contenedor `.vigia-opportunity-copilot` (ya limitado por el layout de la ficha de oportunidad, `opportunity-ficha`); no se introduce texto de ancho completo de pantalla en ningún punto de este corte.
- **Chevron/estado abierto:** `.vigia-copilot-context[open]>summary:before{transform:rotate(90deg)}` (nuevo, E).
- **Apilado móvil:** `.vigia-card-actions{flex-direction:column}` en `@media(max-width:560px)` (B); `.priority-filter-tab` pasa a `display:flex` compacto en `@media(max-width:640px)` (A); `.vigia-copilot-proposal-header{flex-wrap:wrap}` (D) permite que el botón baje de línea en pantallas angostas sin overflow.
- **Sin regresión visual global:** todos los selectores nuevos o modificados están calificados por una clase específica del componente tocado (`.priority-filter-tab`, `.vigia-card-actions`, `.my-day-fact`, `.vigia-copilot-*`, `.my-day-manager-banner`) — ninguna regla toca `button{}`, `.button{}` global, `a{}` ni ningún selector de etiqueta desnuda.

## Accesibilidad (detalle por componente)

- **Prioridades Comerciales:** los 7 botones de categoría siguen siendo `<button>` reales (ya con `aria-label="Categorías operativas"` en el contenedor); no cambia su semántica, sólo tamaño/densidad.
- **Tarjeta de prioridad:** dos `<a className="button">` distintos, cada uno con texto visible único (`Registrar seguimiento`/`Ver oportunidad`) — no se requiere `aria-label` adicional.
- **"Mi día" gerencial:** `aria-label={`Prioridades de hoy de ${ownerName}`}` en la sección contenedora nombra explícitamente de quién es la cola, evitando ambigüedad para un gerente que navega entre varios consultores.
- **Copiloto:** el encabezado con foco programático anuncia el cambio de contenido a lectores de pantalla sin dejar un indicador visual espurio para usuarios videntes; `Contexto y evidencia` usa `<details>`/`<summary>` nativos (foco de teclado y `Enter`/`Espacio` para abrir/cerrar sin JavaScript propio, mismo patrón ya usado por `Más información` en la ficha de oportunidad y por `Depurar CRM` en "Mi día").

## Riesgos y autocrítica

- **YAGNI revisado:** se evaluó y descartó (a) una segunda función `buildManagerMyDayQueue` — innecesaria, `buildMyDayQueue` ya es agnóstica de quién mira el resultado; (b) reescribir semánticamente `facts`/`inferences` con un LLM adicional o reglas de NLP para "traducir" texto libre — explícitamente rechazado por el propio requisito ("no brittle semantic rewriting"), se usa en su lugar clasificación visual (`por confirmar`) + saneamiento conservador de patrones de alta confianza (fecha ISO completa, monto `COP` explícito); (c) extender el saneamiento de fechas/montos a fechas sueltas `YYYY-MM-DD` o montos sin la palabra `COP` — se descartó por riesgo de falso positivo (un ID de oportunidad o un teléfono podría calzar el patrón), documentado como limitación intencional, no como omisión.
- **Riesgo de regresión — CSS compartido:** `.priority-filter-tabs`/`.priority-filter-grid` compartían selector en dos `@media` existentes; separarlas requiere una edición quirúrgica (no un `find/replace` ingenuo) para no alterar el comportamiento ya probado de `.priority-filter-grid` en esos mismos breakpoints. Mitigado documentando explícitamente el texto CSS antes/después en el plan y verificando con una prueba estática que ambas reglas conservan su comportamiento esperado en cada breakpoint.
- **Riesgo de regresión — `.commercial-followup-banner` reutilizada:** el banner gerencial nuevo comparte clase base con el banner personal ya probado (`tests/consultant-detail-static.test.mjs`); el único cambio es un modificador de una declaración (`grid-template-columns:1fr`). Mitigado porque `.my-day-manager-banner` es un selector nuevo y aislado — no modifica ninguna declaración existente de `.commercial-followup-banner`, sólo la sobreescribe localmente donde se aplican ambas clases a la vez.
- **Riesgo de regresión — `copilot-presentation.ts` amplía su superficie pública:** `PresentedCopilotBrief` gana dos campos nuevos (`missingInformation`, `missingSummary`) y una función nueva (`humanizePresentedText`). Ningún campo existente cambia de tipo ni de significado; `contactPlanSteps` se conserva exactamente igual (sigue alimentando `presentCompactCopilotSummary`), así que el único consumidor actual de `presentCopilotBrief` (`VigiaCopilotProposal`) puede adoptar los campos nuevos sin migrar nada existente.
- **Riesgo de regresión — reordenar `Revisión humana` antes de las acciones:** es un cambio puramente de orden DOM/visual, no de comportamiento (`onCopy`/`onDiscard` no cambian) — el riesgo real es que algún test estático dependa del orden anterior; se listan explícitamente en el plan todos los archivos de test que fijan ese orden para actualizarlos en el mismo slice.
- **Sin placeholders ni TODO:** cada texto nuevo (`Registrar seguimiento`/`Ver oportunidad` sin cambios; `Qué pasó`/`Falta`/`Objetivo`/`Siguiente paso`; `Contexto y evidencia · N datos · N inferencias · N pendientes`; `Datos utilizados`/`Inferencias de Vig-IA · por confirmar`/`Información no verificada`; `Prioridades de hoy de {ownerName}`) está completamente especificado arriba, sin ninguna plantilla pendiente de redactar.
- **QA visual autenticado:** este documento no lo marca como aprobado formalmente por Juan; el plan incluye una verificación manual/responsive como gate de cierre, pero no sustituye el QA visual autenticado en producción.

## Criterios de aceptación

1. `Prioridades Comerciales` conserva las 7 categorías/contadores y su comportamiento de filtro exacto; en desktop normal las tarjetas ocupan 2 filas (4+3) con `min-height:84px`; en ≥1800px ocupan 1 fila de 7; en ≤1100px, 2 columnas; en ≤640px, 1 columna con layout interno horizontal compacto y `min-height:44px`.
2. La tarjeta de prioridad muestra exactamente dos acciones con estilo completo — primaria sólida azul/blanca, secundaria outline/clara sin subrayado — ambas ≥44px de alto, con `:hover`/`:focus-visible` visibles, apiladas al 100% de ancho en móvil.
3. Ninguna tarjeta de prioridad expone `last_interaction_at`/`updated_at`/`created_at`/`missing` como texto crudo; la fecha de actividad se calcula en `America/Bogota`; el valor registrado se presenta como `$X.XXX.XXX COP`.
4. Cada tarjeta de "Mi día" (en los tres baldes, en ambas ubicaciones — personal y gerencial) expone `Qué pasó:`/`Falta:`/`Objetivo:` rotulados y un único CTA `Preparar seguimiento`.
5. Un gerente que abre el detalle de un consultor específico (`#/consultant/<id>`, `personal === false`) ve una sección `Prioridades de hoy de {ownerName}` con el mismo contenido/tope/orden que produciría `buildMyDayQueue` para ese consultor, en copy de tercera persona; el tablero personal del propio consultor no cambia de significado.
6. El copiloto de oportunidad, tras generar una propuesta, no muestra ningún rectángulo de foco visible alrededor de un elemento decorativo; los controles interactivos reales conservan su `:focus-visible`.
7. `Actualizar propuesta` sólo aparece dentro de la cabecera de la propuesta ya generada, nunca aislado entre las alertas comerciales y el resultado.
8. El resultado del copiloto muestra, en orden, `Qué pasó`/`Falta`/`Objetivo` y luego un `Siguiente paso` destacado (cuando la recomendación no se abstiene por repetir una alerta activa — criterio sin cambios); `Revisión humana` aparece antes de `Copiar correo`/`Descartar`; ninguna acción de envío ni escritura automática se agrega.
9. `Contexto y evidencia` está cerrado por defecto, muestra un resumen de conteo (`N datos · N inferencias · N pendientes`) y un chevron que rota al abrir; expandido, muestra únicamente `Datos utilizados`, `Inferencias de Vig-IA · por confirmar` (con insignia `Alta`/`Media`/`Baja`), `Información no verificada` y, si aplica, adjuntos aprobados — sin duplicar `Plan de contacto`, el resumen narrativo ni `Objetivo de contacto`.
10. Ninguna clave técnica (`evidence_refs`, `warnings`, `schema`, `payload`, `snapshot_id`, nombres de columna crudos) se expone en ningún punto de la UI tocada por este corte.
11. Fechas ISO completas (con hora y zona) y montos explícitamente rotulados `COP` dentro de texto libre del modelo se reformatean a `America/Bogota`/`$X.XXX.XXX COP`; cualquier otro texto no reconocido queda intacto y, si proviene de `missing_information`, permanece exclusivamente bajo `Información no verificada` — nunca se promueve a `Datos utilizados`.
12. Suite focal — `node --test tests/agt003-*.test.mjs tests/vigia-*.test.mjs tests/consultant-detail-static.test.mjs` —, seguida de `npx tsc --noEmit`, `npm run check:backend-parity`, `npm run check:siio-integration`, `npm run build` y `git diff --check`, todos en verde. **No se ejecuta `npm test`/la suite completa del repositorio**: hay antecedente confirmado de OOM al correrla completa.

## Archivos esperados en la implementación

- `src/vigia/VigiaCommercial.tsx` — `ACTIVITY_BASIS_LABEL`/`activityBasisLabel`, `timeZone` en el formateador de fecha, sufijo ` COP`.
- `src/vigia/VigiaOpportunityCopilot.tsx` — `VigiaCopilotProposal` reestructurado (D+E), `CONFIDENCE_LABEL`, `onRegenerate`, condición `!ready` del botón externo.
- `src/vigia/copilot-presentation.ts` — `humanizePresentedText`, `filterCommercialTextList`, `summarizeMissingInformation`, `PresentedCopilotBrief.missingInformation`/`.missingSummary`.
- `src/main.tsx` — `MyDayGroup` (rótulo `Qué pasó:`), `ConsultantDetail` (bloque `!personal` de "Prioridades de hoy de {ownerName}").
- `src/styles.css` — `.priority-filter-tabs`/`.priority-filter-tab` (A), `.vigia-card-actions .button*` (B), `.my-day-fact em`/overrides (C.1), `.my-day-manager-banner` (C.2), `.vigia-copilot-proposal-header`/`.vigia-copilot-brief*`/`.vigia-copilot-next-step`/`.vigia-copilot-confidence`/`.vigia-copilot-context>summary` (D+E); retiro de `.vigia-copilot-summary*`/`.vigia-copilot-plan ol` ya sin selector.
- `tests/agt003-consolidated-visual-qa-static.test.mjs` — nuevo, cubre A y B (CSS de densidad, saneamiento de evidencia, CSS de acciones de tarjeta).
- `tests/consultant-detail-static.test.mjs` — assertions actualizadas/nuevas para C.1 (`Qué pasó:`) y C.2 (banner gerencial).
- `tests/agt003-copilot-presentation.test.mjs` — assertions nuevas para `humanizePresentedText`/`summarizeMissingInformation`/`missingInformation`.
- `tests/agt003-copilot-proposal-render.test.mjs` — reescritura de la estructura esperada (D+E).
- `tests/vigia-opportunity-copilot-ui-static.test.mjs` — marcadores actualizados (`Actualizar propuesta` en vez de `Actualizar borrador`, retiro del marcador `Plan de contacto`, nueva aserción de orden de cabecera interna).

No se espera ningún cambio en `api/`, `server/`, `contracts/agents/`, `supabase/migrations/`, `src/tenders/`, `vigia-engine.js`, `src/vigia/my-day-presentation.ts`, `src/vigia/opportunity-copilot-state.ts`, ni en ningún archivo de AGT-002.
