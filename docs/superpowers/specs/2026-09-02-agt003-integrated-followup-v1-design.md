# AGT-003 / Vig-IA: seguimiento integrado v1 ("Mi día") — diseño

**Fecha:** 2026-09-02
**Estado:** Diseño para aprobación de producto. Documento **sólo de diseño y plan**; no se implementa producto en esta tarea.
**Alcance:** frontend puro dentro de AGT-003/Vig-IA — `src/vigia/my-day-presentation.ts` (nuevo), `src/vigia/opportunity-ficha-presentation.ts` (corrección de huso horario), `vigia-engine.js` (corrección de huso horario), `src/main.tsx` (`ConsultantDetail`, `FollowUpForm`), `src/styles.css`. **No** se crean endpoints, no hay migraciones, no se toca `access-control.js`, no se activa preflight IA, no se amplían permisos del copiloto.
**Rama:** `feat/agt003-integrated-followup-v1-20260902`
**No toca:** `src/tenders/**`, ningún archivo de `contracts/agents/AGT-002/*`, `api/[...path].js`/`server/index.js` en las rutas de licitaciones, ni el comportamiento de SIIO.

## Problema

Hoy existen dos experiencias adyacentes que no forman una cadena completa de disciplina comercial:

1. **`Prioridades Comerciales`** (`src/vigia/VigiaCommercial.tsx`, `/api/vigia/priorities`, motor `vigia-engine.js`) es una bandeja completa, filtrable, sin límite operativo de "cuántas debo mirar hoy". Sirve para explorar, no para decidir en el arranque del día.
2. **El banner personal** `Gestión comercial de hoy` dentro de `ConsultantDetail` (`src/main.tsx:2347-2369`, sección `personal-dashboard`) ya prioriza vencidas/hoy/sin agenda, pero mezcla en una sola lista plana (hasta 6 filas) señales de calidad de gestión (próxima acción vencida o faltante) con nada que distinga "esto es una gestión comercial" de "esto es un hueco de datos administrativo" (valor o regional faltante). No hay tope de 3, no hay separación Hacer hoy / Preparar / Depurar CRM, y cada fila no expone hecho/faltante/objetivo — sólo una etiqueta (`Vencida`, `Sin agenda`) y un enlace genérico.
3. El copiloto Vig-IA (`VigiaOpportunityCopilot`, ya simplificado a un solo CTA por `docs/superpowers/specs/2026-08-31-vigia-single-action-followup-design.md`) y el formulario de seguimiento (`FollowUpForm`, ya con próxima acción opcional) existen y funcionan, pero **nada dirige al comercial hacia ellos desde una alerta accionable con un solo botón**: el enlace actual del banner apunta a `#/detail/{id}` sin `?focus=interaction`, y no hay ninguna advertencia cuando se guarda un seguimiento sin próxima acción — el hueco puede reabrirse en silencio.
4. **Bug de huso horario confirmado.** `vigia-engine.js::dayStart` calcula el "día de hoy" con `Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())` — es decir, en UTC, no en `America/Bogota`. Bogotá es UTC-5 todo el año (sin horario de verano). Entre las 19:00 y las 23:59 hora de Bogotá, el instante UTC ya cayó en el día calendario siguiente. Ejemplo reproducible: con `now = '2026-09-02T23:30:00-05:00'` (2 de septiembre, 11:30pm en Bogotá) y una oportunidad con `expected_close_date: '2026-09-02'` (cierre esperado *hoy*, en Bogotá), `dayStart(now)` calcula erróneamente el 3 de septiembre como "hoy", y la señal `close_overdue` se dispara un día antes de tiempo. Lo mismo aplica a `next_action_overdue`. Este motor alimenta `/api/vigia/priorities`, consumido por `VigiaCommercial.tsx`. `src/vigia/opportunity-ficha-presentation.ts::startOfCalendarDay` tiene la misma clase de defecto de forma latente: usa `new Date(now.getFullYear(), now.getMonth(), now.getDate())`, que lee el huso horario local del entorno de ejecución (correcto sólo si el navegador o el proceso Node están configurados en `America/Bogota`; no está anclado explícitamente, así que un CI en UTC o un navegador mal configurado reproduce el mismo corrimiento).

No existe hoy ninguna cola compacta, con tope operativo, separada por tipo de brecha (comercial vs. administrativa vs. preparación), que aterrice en el flujo de seguimiento/copiloto ya existente con una sola llamada a la acción, ni ninguna corrección explícita a `America/Bogota` en los cálculos de vencimiento que alimentan esa cola.

## Objetivos

- Una cola diaria, `Mi día`, con un tope duro de **3 acciones comerciales principales** por comercial (`Hacer hoy`), separada explícitamente de preparación comercial (`Preparar`) y de higiene de datos (`Depurar CRM`), de modo que ningún hueco administrativo compita por esas 3 casillas.
- Cada entrada de `Mi día` expone **hecho verificable, faltante y objetivo/resultado buscado**, con **una sola CTA** — `Preparar seguimiento` — que reutiliza el flujo ya existente de detalle de oportunidad (formulario de seguimiento + copiloto Vig-IA), sin gate intermedio ni segundo CTA.
- Ranking determinista con desempates explícitos: compromiso vencido antes que faltante; dentro de cada grupo, valor alto primero; luego etapa más avanzada; luego orden alfabético y `id` como desempate final — de modo que valor o regional faltante **nunca** oculten una oportunidad importante (no participan del ranking de `Hacer hoy` en absoluto).
- Corregir los cálculos de día de negocio a `America/Bogota` en los dos puntos donde hoy dependen implícita o explícitamente de UTC/huso local no anclado (`vigia-engine.js`, `opportunity-ficha-presentation.ts`), evitando el desfase nocturno descrito arriba.
- Una advertencia breve, no bloqueante, al guardar un seguimiento sin próxima acción — nunca inventar ni completar automáticamente esa fecha.
- Resolución **derivada** del propio CRM (próxima acción vigente ⇒ la alerta de `Hacer hoy` desaparece tras refrescar), sin tabla de ciclo de vida ni snooze.
- Medición mínima: reutilizar los mismos campos ya cargados (`data.opportunities`); no agregar tracking ni datos personales nuevos.

## No objetivos

- No se toca AGT-002, `src/tenders/**`, ni ningún test `tests/agt002*`. `Mi día` excluye explícitamente `service_type_code === 'licitacion_publica'` (mismo guard que ya usa `canRenderOpportunityCopilot`).
- No se modifica el copiloto Vig-IA (`VigiaOpportunityCopilot`, `copilot-presentation.ts`) ni su contrato: se reutiliza tal cual, sin ampliar sus permisos ni activar el backend de preflight (que sigue desplegado y sin tráfico, según la spec 2026-08-31).
- No se crea ningún endpoint nuevo, ninguna tabla, ninguna migración. `Mi día` es una derivación pura en memoria sobre `data.opportunities`, igual que ya lo son `personalCriticalRows`/`personalFollowUpRows`.
- No se envía nada automáticamente, no se registra nada sin que el comercial lo escriba explícitamente en `FollowUpForm`.
- No se rediseña `Prioridades Comerciales` (`VigiaCommercial.tsx`) ni su motor de filtros (`priority-filters.js`): siguen existiendo, sin cambios de comportamiento, como la bandeja completa de exploración.
- No se introduce una tabla de ciclo de vida de alertas ni un mecanismo de snooze/dismiss persistente: la única forma de que una alerta de `Mi día` desaparezca es que el CRM refleje que ya no aplica.
- No se cambia `nextActionStatus`/`daysSince`/`startOfToday` de uso general en `src/main.tsx` (usadas también en licitaciones, tablas gerenciales y otras vistas fuera de alcance): `Mi día` reutiliza en su lugar `opportunity-ficha-presentation.ts`, que ya es la fuente de verdad unificada usada por la ficha de oportunidad no licitatoria.

## Evidencia (cadena de la experiencia ya construida)

La cadena pedida por producto — *alerta → contexto/recomendación → seguimiento de calidad → resultado registrado → próxima acción* — **ya existe en sus últimos cuatro pasos**, construida en entregas previas:

1. `VigiaOpportunityCopilot` (spec 2026-08-31) ya da contexto/recomendación con un solo botón, «Preparar próximo seguimiento», sin preanálisis intermedio.
2. `FollowUpForm` (spec 2026-08-24) ya explica por qué el registro importa («Este registro alimenta el historial comercial y las recomendaciones de Vig-IA Comercial») y ya tiene un campo de próxima gestión.
3. Guardar un seguimiento en `OpportunityDetail` ya dispara `await load(); await refresh();` (`src/main.tsx:874`), donde `refresh` es el `refresh()` de `App()` (`src/main.tsx:320-325`) que recarga `/api/bootstrap` completo — es decir, **`data.opportunities` ya se actualiza automáticamente** en cuanto se guarda un seguimiento, sin ningún mecanismo nuevo.
4. `?focus=interaction` (`src/main.tsx:770,792`) ya desplaza el foco al contenedor `Seguimiento comercial` (formulario + copiloto, contiguos desde la spec 2026-08-24), que es exactamente "el flujo existente de oportunidad/copilot/registro" que la CTA debe abrir.

Esto significa que este diseño **sólo necesita construir el primer eslabón** (la alerta con tope de 3, separada por tipo, con hecho/faltante/objetivo) y conectarlo al punto de entrada ya existente (`#/detail/{id}?focus=interaction`). No se reconstruye nada de los pasos 2-5.

## Decisión

### 1. Corrección de huso horario (fundación, antes que el ranking)

**`vigia-engine.js::dayStart`** — se reemplaza el cálculo UTC por uno anclado a `America/Bogota`, replicando el patrón ya probado en `agt002-radar-gate.js::agt002RadarEvaluationDate` (`Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', ... })`, que produce `YYYY-MM-DD` y se reconstruye con `Date.UTC` para mantener la aritmética de días en enteros, sin problemas de horario de verano — Bogotá no tiene):

```js
const BOGOTA_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
});
function dayStart(value) {
  const date = validDate(value) || new Date();
  const [y, m, d] = BOGOTA_DATE.format(date).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
```

`daysBetween`, `levelFor`, todos los `signals.push(...)` que comparan `dayStart(...)` no cambian: siguen restando dos enteros de milisegundos UTC que ahora representan el día calendario de Bogotá en vez del día calendario UTC. El contrato de `prioritizeVigiaOpportunities` (forma de `signals`/`score`/`level`/`evidence`) no cambia; sólo cambia el valor de `today` cerca de la frontera nocturna.

**`opportunity-ficha-presentation.ts::startOfCalendarDay`/`calendarDaysBetween`** — mismo patrón, aplicado sólo a la parte que hoy depende del huso local no anclado (`now`, y el caso `timestamptz` sin ancla); el caso `date`-only (`DATE_ONLY.test`) sigue usando `parseDateOnly` sin cambios, porque ya es un día calendario literal sin instante que convertir:

```ts
const BOGOTA_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
});
function bogotaDayUtcMs(date: Date): number {
  const [y, m, d] = BOGOTA_DAY.format(date).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function startOfCalendarDay(value?: string | null): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  if (DATE_ONLY.test(trimmed)) {
    const parts = parseDateOnly(trimmed);
    return parts ? Date.UTC(parts.year, parts.month - 1, parts.day) : null;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : bogotaDayUtcMs(parsed);
}
export function calendarDaysBetween(value?: string | null, now: Date = new Date()): number | null {
  const from = startOfCalendarDay(value);
  if (from === null) return null;
  return Math.round((bogotaDayUtcMs(now) - from) / DAY_MS);
}
```

`startOfCalendarDay` cambia de tipo de retorno (`Date | null` → `number | null`, milisegundos UTC del día de Bogotá) porque ya no hace falta un objeto `Date` intermedio — es un cambio interno sin consumidores externos (`startOfCalendarDay` no está exportado; sólo `calendarDaysBetween` lo está y su firma pública no cambia). `nextActionCardState`/`expectedCloseCardState`/`decisionMakerCardState`/`presentFollowUpEntry` no cambian: siguen llamando a `calendarDaysBetween` con la misma firma.

**Por qué no se toca `src/main.tsx::startOfToday/daysSince/nextActionStatus`:** son de uso general (tablas gerenciales, licitaciones, otras vistas fuera de alcance de AGT-003), y `Mi día` no las necesita — construye su ranking sobre `opportunity-ficha-presentation.ts`, ya corregido. Tocar esas tres funciones ampliaría el radio de la tarea muy por fuera de Vig-IA/AGT-003 y arriesgaría regresiones en vistas no relacionadas; queda documentado como deuda conocida, no como parte de este corte.

### 2. Módulo puro `src/vigia/my-day-presentation.ts` (nuevo)

Análogo en estilo a `opportunity-ficha-presentation.ts`: sin JSX, sin red, sin mutación de sus argumentos.

```ts
import { nextActionCardState, decisionMakerCardState } from './opportunity-ficha-presentation';

export type MyDayBucket = 'hacer_hoy' | 'preparar' | 'depurar_crm';

export type MyDayAlert = {
  id: string;
  bucket: MyDayBucket;
  companyName: string;
  fact: string;     // hecho verificable
  gap: string;       // faltante
  goal: string;       // objetivo / resultado buscado
  ctaHref: string;     // `#/detail/{id}?focus=interaction`
};

export type MyDayQueue = {
  hacerHoy: MyDayAlert[];       // máx. 3
  hacerHoyTotal: number;         // elegibles totales antes del tope, para "N más"
  preparar: MyDayAlert[];        // máx. 3
  prepararTotal: number;
  depurarCrm: MyDayAlert[];      // máx. 5
  depurarCrmTotal: number;
};

export type MyDayOpportunity = {
  id: string; company_name: string; stage_code: string; stage_name: string; stage_order: number;
  service_type_code: string | null; offer_value: number | null; regional_nombre: string | null;
  next_action_at: string | null; expected_close_date?: string | null;
  decision_maker_name: string | null; decision_maker_email: string | null; decision_maker_phone: string | null;
};

const HACER_HOY_LIMIT = 3;
const PREPARAR_LIMIT = 3;
const DEPURAR_LIMIT = 5;
const TERMINAL_STAGES = ['aprobado', 'perdido', 'descartado'];
// Basado en VIGIA_CONFIG.criticalStages (vigia-engine.js: ['sustentacion', 'negociacion']), pero no
// es una copia exacta: agrega 'envio_oferta' de forma intencional porque el audit de riesgo mostró
// que esa etapa concentra el mayor riesgo por falta de decisor verificado. No hay precedente en el
// repositorio de que un módulo de src/ importe un archivo raíz pensado para el backend, y ese
// acoplamiento nuevo no se introduce aquí. Si vigia-engine.js cambia sustentacion/negociacion, revisar
// si el cambio también aplica aquí.
const ADVANCED_STAGES = ['sustentacion', 'negociacion', 'envio_oferta'];

export function buildMyDayQueue(opportunities: MyDayOpportunity[], now: Date = new Date()): MyDayQueue { /* ver Ranking */ }
```

**Elegibilidad y exclusión mutua (por orden de evaluación, cada oportunidad cae en el primer balde donde califica):**

1. **Filtro base**, aplicado antes de cualquier balde: `!TERMINAL_STAGES.includes(stage_code)` y `service_type_code !== 'licitacion_publica'`.
2. **`hacer_hoy`**: `nextActionCardState(o, now).code` es `'overdue'` o `'missing'`.
3. **`preparar`** (excluye lo ya asignado a `hacer_hoy`): `ADVANCED_STAGES.includes(stage_code)` **y** `decisionMakerCardState(...).code !== 'complete'`.
4. **`depurar_crm`** (excluye lo ya asignado a `hacer_hoy`/`preparar`): `!(offer_value > 0)` **o** `!String(regional_nombre || '').trim()`.

Una oportunidad puede ser elegible para más de un balde a la vez (p. ej. vencida y con decisor incompleto); sólo aparece en el primero de la lista de arriba en el que califica — nunca duplicada. Esto es lo que garantiza que los huecos administrativos (balde 4) o de preparación (balde 3) no puedan nunca ocupar una de las 3 casillas de `hacer_hoy`.

**Ranking de `hacer_hoy` (determinista, con desempates explícitos):**

1. `overdue` antes que `missing` (compromiso vencido primero).
2. Dentro del mismo grupo: `offer_value` descendente (`null`/`0` se trata como `0` y **nunca se excluye**, sólo ordena al final del grupo).
3. Empate: `stage_order` descendente (etapa más avanzada primero).
4. Empate: `company_name` ascendente (`localeCompare('es')`).
5. Empate final: `id` ascendente — garantiza un orden 100% determinista incluso con datos idénticos.

`preparar` y `depurar_crm` usan el mismo comparador de `offer_value` descendente → `stage_order` descendente → `company_name` → `id`, sin el paso 1 (no aplica: ninguno de los dos baldes distingue vencido/faltante). Los tres arreglos se truncan a su tope (`HACER_HOY_LIMIT`/`PREPARAR_LIMIT`/`DEPURAR_LIMIT`) **después** de ordenar; `*Total` reporta el conteo elegible completo antes de truncar, para que la UI pueda mostrar "3 de N" sin inventar un mecanismo de paginación.

**Contenido de cada `MyDayAlert` (hecho / faltante / objetivo):**

| Balde | `fact` | `gap` | `goal` |
|---|---|---|---|
| `hacer_hoy`, overdue | `` `Próxima gestión vencida ${next.detail.toLowerCase()} (programada para ${fmtDate(next_action_at)}).` `` | `La fecha pasó y no hay una próxima acción vigente.` | `Registrar el resultado pendiente, si aplica, y agendar la próxima gestión.` |
| `hacer_hoy`, missing | `Sin próxima gestión agendada.` | `No hay fecha ni acción definida para el siguiente contacto.` | `Agendar la próxima gestión con fecha concreta.` |
| `preparar` | `` `Oportunidad en etapa ${stage_name} sin decisor verificado.` `` | `decisionMakerCardState(...).detail` (p. ej. `Falta correo y teléfono`) | `Completar el contacto del decisor antes de avanzar la negociación.` |
| `depurar_crm` | `Faltan datos base de la oportunidad.` | lista de lo ausente, unida con `' y '` (`'valor registrado'` si `!(offer_value>0)`, `'regional'` si falta) | `Completar los datos para mejorar reportes y priorización.` |

Ninguno de estos textos se genera con IA: son plantillas deterministas sobre datos ya cargados, igual que `recommendationFor` en `vigia-engine.js` o `personalPriorityText` en `main.tsx`.

El `gap` de `hacer_hoy`/overdue describe únicamente lo que es demostrable a partir de `next_action_at` (la fecha pasó y no quedó una próxima acción vigente); no afirma que la gestión no se haya registrado, porque `MyDayOpportunity` no trae el historial de interacciones y esa suposición no sería verificable con los datos disponibles. Por la misma razón, el `goal` pide registrar el resultado "si aplica" en vez de darlo por pendiente.

`ctaHref` es siempre `` `#/detail/${id}?focus=interaction` `` — **el mismo destino para los tres baldes**, sin variantes por tipo de brecha. Aterriza en el contenedor `Seguimiento comercial` (formulario + copiloto Vig-IA, contiguos), desde donde el comercial puede: registrar el resultado y la próxima gestión (`hacer_hoy`), pulsar «Editar» en el banner para completar el decisor (`preparar`) o completar valor/regional (`depurar_crm`), y opcionalmente usar el copiloto para redactar el seguimiento. No se introduce un segundo destino ni un CTA adicional por alerta.

### 3. Integración en `ConsultantDetail` (`src/main.tsx`)

`Mi día` reemplaza únicamente `commercial-followup-list` (`src/main.tsx:2359-2364`), dentro de la misma sección `commercial-followup-banner` que hoy vive bajo `{personal && ...}` (`src/main.tsx:2347`). **Se conservan sin cambios**: `personalFollowUpCards` (los 4 chips «Vencidas / Para hoy / Sin agenda / Valor en riesgo», que son conteos agregados, no la cola de 3 acciones) y `focusFollowUpFilter` (siguen enfocando la tabla `Mis oportunidades críticas` más abajo). El eyebrow/título del banner cambia de «Gestión comercial de hoy» a **«Mi día»**, coherente con el nombre que pide el requisito de producto.

```tsx
const myDay = useMemo(
  () => buildMyDayQueue(opportunities, new Date()),
  [opportunities],
);
```

`opportunities` es el mismo arreglo ya filtrado por `ownerId` (`src/main.tsx:2241-2243`), así que `Mi día` sólo se muestra dentro del propio tablero del comercial (`personal === true`), exactamente donde hoy vive el banner — no se extiende a la vista gerencial de un consultor específico (`personal === false`), que sigue mostrando la tabla completa sin este bloque, sin cambio de comportamiento.

```tsx
<div className="my-day">
  <MyDayGroup title="Hacer hoy" alerts={myDay.hacerHoy} total={myDay.hacerHoyTotal} tone="primary" empty="Sin próximas gestiones vencidas o sin agendar." />
  {(myDay.preparar.length > 0) && <MyDayGroup title="Preparar" alerts={myDay.preparar} total={myDay.prepararTotal} tone="secondary" empty="" />}
  {(myDay.depurarCrm.length > 0) && <details className="my-day-hygiene"><summary>Depurar CRM ({myDay.depurarCrmTotal})</summary>
    <MyDayGroup title="" alerts={myDay.depurarCrm} total={myDay.depurarCrmTotal} tone="muted" empty="" />
  </details>}
</div>
```

- `Hacer hoy` siempre se renderiza (con su estado vacío explícito) porque es la sección primaria pedida por el requisito.
- `Preparar` sólo se renderiza si hay al menos una entrada — no ocupa espacio con un estado vacío secundario que compita visualmente con `Hacer hoy`.
- `Depurar CRM` va dentro de un `<details>` colapsado por defecto (mismo patrón ya usado por `Más información` en la ficha de oportunidad, spec 2026-08-24) — visualmente subordinado y nunca compitiendo por atención con `Hacer hoy`, cumpliendo literalmente "los huecos administrativos no compiten con Hacer hoy".

`MyDayGroup` es un componente local co-ubicado en `main.tsx` (mismo patrón que otros bloques de esta vista, no hay archivo de componente propio):

```tsx
function MyDayGroup({ title, alerts, total, tone, empty }: { title: string; alerts: MyDayAlert[]; total: number; tone: string; empty: string }) {
  return <div className={`my-day-group my-day-${tone}`}>
    {title && <h4>{title}{total > alerts.length ? ` · mostrando ${alerts.length} de ${total}` : ''}</h4>}
    {alerts.length
      ? <div className="my-day-list">{alerts.map(a => <article className="my-day-card" key={a.id}>
          <strong>{a.companyName}</strong>
          <p>{a.fact}</p>
          <p className="my-day-gap"><em>Falta:</em> {a.gap}</p>
          <p className="my-day-goal"><em>Objetivo:</em> {a.goal}</p>
          <a className="button" href={a.ctaHref}>Preparar seguimiento</a>
        </article>)}</div>
      : (empty && <p className="my-day-empty">{empty}</p>)}
  </div>;
}
```

### 4. Advertencia no bloqueante en `FollowUpForm`

Único cambio de comportamiento en `save()` (`src/main.tsx:1245`): el mensaje de éxito distingue si se guardó sin próxima acción, sin agregar ninguna validación ni bloquear el envío:

```tsx
setStatus(form.next_action_at ? 'Seguimiento registrado.' : 'Seguimiento registrado. Falta agendar la próxima gestión.');
```

El `<input type="datetime-local">` de próxima gestión sigue sin `required`; el payload sigue enviando `next_action_at: null` cuando está vacío (comportamiento actual, sin cambios); no se agrega ningún valor por defecto ni se completa automáticamente. La advertencia es puramente textual, en el mismo `<small>{status}</small>` que ya existe.

### 5. Resolución derivada (sin tabla de ciclo de vida)

`Mi día` se recalcula en cada render a partir de `opportunities` (`useMemo` sobre `data.opportunities`). Como guardar un seguimiento ya dispara `refresh()` (bootstrap completo, ver «Evidencia»), en cuanto el comercial guarda una próxima gestión vigente:

- `nextActionCardState(o, now).code` deja de ser `'overdue'`/`'missing'` → la entrada desaparece de `hacer_hoy` en el siguiente render tras refrescar.
- Si además completa el decisor o el valor/regional vía «Editar», las entradas correspondientes de `preparar`/`depurar_crm` desaparecen igual, por el mismo mecanismo.

No se introduce ningún campo nuevo, ninguna tabla `psi_*` de estado de alerta, ningún snooze. "Gestión reciente" no se valida como una condición separada de "próxima acción vigente": guardar un seguimiento con `FollowUpForm` siempre crea una fila nueva en `psi_sales_interactions` como efecto del propio flujo de guardado (mismo endpoint, sin cambios), así que exigir "próxima acción vigente" ya implica, en la práctica de uso, que hubo una gestión reciente — modelarlo como una segunda condición explícita duplicaría la fuente de verdad de `next_action_at` sin agregar protección real.

## Fuera de alcance (decisiones explícitas, no vencimientos)

- **Enlace "ver todas" hacia `Prioridades Comerciales` cuando hay más de 3/3/5 elegibles.** `prioritiesHashFromDashboard` (`priority-filters.js`) ya existe para construir ese enlace, pero sus categorías (`missing`/`overdue`/etc., una a la vez) no calzan limpio con el balde combinado `hacer_hoy` (vencida + faltante a la vez) sin forzar una categoría arbitraria. La bandeja completa sigue disponible de forma independiente vía la navegación a `Prioridades Comerciales`; no se fuerza un enlace de contexto en este corte. Se documenta como ambigüedad resuelta, no como omisión accidental.
- **`Mi día` en la vista gerencial de un consultor específico (`personal === false`)**: el bloque vive donde ya vivía el banner que reemplaza, dentro de `{personal && ...}`. Extenderlo a la vista de un gerente mirando a otro consultor es una decisión de producto distinta (¿debe un gerente ver "mi día" de otra persona con el mismo tono?) y queda fuera de este corte.
- **Snooze o descarte manual de una alerta de `Mi día`.** Explícitamente prohibido por el requisito ("NO agregar una tabla de ciclo de vida/snooze"): la única forma de resolución es que el dato del CRM cambie.
- **Corrección de `startOfToday`/`daysSince`/`nextActionStatus` de uso general en `main.tsx`.** Ver «Por qué no se toca» en la sección 1.
- **Cualquier cambio al backend de preflight, al contrato del copiloto o a `access-control.js`.**

## Accesibilidad

- `Hacer hoy`/`Preparar` son `<div className="my-day-group">` con `<h4>` propio; no se introduce un `aria-live` nuevo porque no hay actualización asíncrona en este bloque (es una derivación síncrona de `data.opportunities`, ya cargado).
- `Depurar CRM` usa `<details><summary>`, mismo patrón nativo y accesible ya usado por `Más información` (spec 2026-08-24): sin JavaScript propio de apertura/cierre, foco de teclado nativo.
- Cada `MyDayAlert` es un `<article>` con un único elemento enfocable de acción (`<a className="button">Preparar seguimiento</a>`) — nunca dos controles por tarjeta.
- El orden de tabulación sigue el orden visual: `Hacer hoy` (hasta 3 tarjetas) → `Preparar` (si existe) → `Depurar CRM` (colapsado; su contenido sólo es alcanzable por teclado tras expandir el `<summary>`, comportamiento nativo esperado de `<details>`).

## CSS (aditivo)

```css
.my-day{display:grid;gap:14px;grid-column:1/-1}
.my-day-group h4{margin:0 0 8px;font-size:15px;color:#0f2140}
.my-day-primary .my-day-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.my-day-card{display:grid;gap:5px;padding:12px 14px;border-radius:16px;border:1px solid rgba(219,234,254,.4);background:rgba(255,255,255,.1);color:#fff}
.my-day-card strong{font-size:15px}
.my-day-card p{margin:0;font-size:12.5px;line-height:1.35;color:#d8e7fb}
.my-day-card .my-day-gap em,.my-day-card .my-day-goal em{font-style:normal;color:#bfdbfe;font-weight:800}
.my-day-card .button{margin-top:4px;justify-self:start}
.my-day-empty{margin:0;color:#d8e7fb;font-size:13px}
.my-day-secondary .my-day-card,.my-day-muted .my-day-card{background:#f8fbff;color:#10213d;border-color:#e2eaf5}
.my-day-secondary .my-day-card p,.my-day-muted .my-day-card p{color:#40516b}
.my-day-hygiene{margin-top:4px}
.my-day-hygiene>summary{cursor:pointer;font-weight:800;color:#40516b;padding:4px 0}
@media(max-width:640px){.my-day-primary .my-day-list{grid-template-columns:1fr}}
```

Reglas conservadas sin cambio: `.commercial-followup-banner`, `.commercial-followup-copy`, `.commercial-followup-cards`, `.commercial-followup-card*` (los 4 chips agregados, que se mantienen). Reglas retiradas por quedar sin selector: `.commercial-followup-list`, `.commercial-followup-row*`, `.commercial-followup-empty` — su único consumidor (`src/main.tsx:2359-2364`) se reemplaza por `.my-day-*`.

## Riesgos y autocrítica

- **YAGNI revisado:** se evaluó y se descartó (a) un endpoint dedicado para `Mi día` (innecesario: los datos ya están en `data.opportunities`, igual que el resto de `ConsultantDetail`); (b) una tabla de ciclo de vida/snooze (prohibida explícitamente por el requisito, y la resolución derivada ya cubre el caso de uso); (c) importar `VIGIA_CONFIG.criticalStages` desde `vigia-engine.js` en vez de declarar `ADVANCED_STAGES` de forma independiente (se prefirió la constante propia y documentada, porque no hay precedente en el repositorio de que `src/` importe un archivo raíz orientado a backend, y crear ese precedente para tres strings — que además ya no coinciden 1:1, porque `ADVANCED_STAGES` agrega `envio_oferta` por el hallazgo de auditoría y `criticalStages` no — es una superficie de acoplamiento nueva no justificada); (d) un enlace "ver todas" hacia `Prioridades Comerciales` (las categorías no calzan limpio sin forzar un balde arbitrario; se documenta como fuera de alcance en vez de forzarlo).
- **Riesgo de regresión — `vigia-engine.js`:** es el motor detrás de `/api/vigia/priorities`, consumido hoy por `VigiaCommercial.tsx` en producción. El cambio es una función pura, aislada, sin cambio de firma ni de forma de salida; el riesgo real es que algún signal cambie de estado cerca de la frontera horaria para oportunidades ya visibles en la bandeja gerencial. Mitigado por: (a) el cambio corrige un bug real, no introduce uno nuevo — el comportamiento anterior estaba objetivamente desalineado con Bogotá; (b) la suite existente (`tests/vigia-engine.test.mjs`, `tests/agt003-priorities-service-p3b2.test.mjs`, `tests/agent-agt003-synthetic-parity-p3b2.test.mjs`) debe seguir en verde sin tocar sus aserciones — sus fixtures usan `now` fijos alejados de la franja de riesgo (madrugada UTC), y el test de paridad sintética compara dos rutas de código entre sí, no un valor fijo, por lo que no debería verse afectado.
- **Riesgo de regresión — `opportunity-ficha-presentation.ts`:** consumida por la ficha de oportunidad completa (tarjetas de prioridad, historial de seguimiento). El cambio de tipo interno de `startOfCalendarDay` (de `Date | null` a `number | null`) es no observable desde fuera del módulo porque la función no está exportada; `calendarDaysBetween` conserva su firma pública. Mitigado por: la suite `tests/agt003-ficha-presentation.test.mjs` ya cubre exhaustivamente los estados de tono/etiqueta y debe seguir en verde sin modificar sus aserciones existentes, sólo agregando los casos nuevos de frontera horaria.
- **Coherencia con patrones existentes:** el módulo nuevo replica el estilo de `opportunity-ficha-presentation.ts` (puro, sin red, sin JSX, con tipos exportados); la corrección de huso horario replica el patrón ya probado de `agt002-radar-gate.js::agt002RadarEvaluationDate`; el `<details>` de `Depurar CRM` replica `Más información`; el único CTA por alerta replica el patrón de un solo control de generación del copiloto (spec 2026-08-31). No se introduce ningún patrón nuevo sin precedente en el repositorio.
- **Sin placeholders ni TODO:** todos los textos de `fact`/`gap`/`goal` están completamente especificados en la tabla de la sección 2; no hay ninguna plantilla pendiente de redactar ni ninguna rama de código sin comportamiento definido.
- **QA visual autenticado:** este documento no lo marca como aprobado; sigue pendiente de Juan, como en toda entrega reciente de AGT-003.

## Criterios de aceptación

1. En el tablero personal (`ConsultantDetail`, `personal === true`), el comercial ve como máximo 3 tarjetas bajo `Hacer hoy`, incluso si hay más de 3 oportunidades elegibles (`myDay.hacerHoyTotal > 3` en ese caso, y la UI lo indica sin ocultar el conteo real).
2. Una oportunidad activa, no licitatoria, con `offer_value` alto y `next_action_at` vencido o ausente aparece en `Hacer hoy` sin que ninguna oportunidad con sólo huecos administrativos (valor/regional faltante) la desplace: `depurar_crm` nunca compite por las 3 casillas de `hacer_hoy` (`buildMyDayQueue` nunca mezcla los baldes).
3. `Depurar CRM` se renderiza visualmente subordinado (colapsado, `<details>`) y nunca en la misma lista que `Hacer hoy`.
4. Cada `MyDayAlert` (en los tres baldes) expone `fact`, `gap`, `goal` y exactamente un botón `Preparar seguimiento`.
5. `Preparar seguimiento` navega a `#/detail/{id}?focus=interaction`, que enfoca el contenedor `Seguimiento comercial` (formulario + copiloto Vig-IA existentes), sin ningún gate ni paso intermedio nuevo.
6. Guardar un seguimiento sin `next_action_at` muestra `'Seguimiento registrado. Falta agendar la próxima gestión.'`, sin bloquear el envío ni completar la fecha automáticamente.
7. Después de guardar un seguimiento con próxima acción vigente y refrescar (`refresh()`, ya disparado por `onSaved`), la alerta correspondiente de `hacer_hoy` deja de aparecer en el siguiente render de `ConsultantDetail`.
8. `calendarDaysBetween` (`opportunity-ficha-presentation.ts`) y `dayStart`/`daysBetween` (`vigia-engine.js`) calculan el día calendario en `America/Bogota`, verificado con instantes UTC que caen entre las 19:00 y las 23:59 hora de Bogotá del mismo día calendario.
9. Ninguna protección humana existente se debilita: sin envío automático, sin escritura del modelo, sin investigación pública, sin nuevo permiso de copiloto, sin preflight IA activado.
10. Suite focal AGT-003/Vig-IA — `node --test tests/agt003-*.test.mjs tests/vigia-*.test.mjs tests/consultant-detail-static.test.mjs` (cubre los cinco archivos exactos tocados por este corte: `tests/agt003-my-day-presentation.test.mjs`, `tests/agt003-ficha-presentation.test.mjs`, `tests/agt003-followup-form-copy-static.test.mjs`, `tests/vigia-engine.test.mjs`, `tests/consultant-detail-static.test.mjs`) —, seguida de `npx tsc --noEmit`, `npm run check:backend-parity`, `npm run check:siio-integration`, `npm run build` y `git diff --check`, todos en verde. **No se ejecuta `npm test`/la suite completa del repositorio**: hay antecedente confirmado de OOM al correrla completa. La suite focal más los checks de paridad/build cubre la misma superficie tocada por este corte sin ese riesgo.

## Archivos esperados en la implementación

- `vigia-engine.js` — `dayStart` anclado a `America/Bogota`.
- `src/vigia/opportunity-ficha-presentation.ts` — `startOfCalendarDay`/`calendarDaysBetween` anclados a `America/Bogota`.
- `src/vigia/my-day-presentation.ts` — nuevo, módulo puro `buildMyDayQueue`.
- `src/main.tsx` — `ConsultantDetail` (bloque `Mi día`, componente `MyDayGroup`), `FollowUpForm` (advertencia no bloqueante).
- `src/styles.css` — reglas `.my-day-*` aditivas; retiro de `.commercial-followup-list/-row*/-empty` ya sin selector.
- `tests/vigia-engine.test.mjs` — casos de frontera horaria Bogotá/UTC.
- `tests/agt003-ficha-presentation.test.mjs` — casos de frontera horaria Bogotá/UTC.
- `tests/agt003-my-day-presentation.test.mjs` — nuevo, cobertura completa de `buildMyDayQueue`.
- `tests/consultant-detail-static.test.mjs` — assertions actualizadas (`Mi día` en vez de `Gestión comercial de hoy`, presencia de `buildMyDayQueue`/`MyDayGroup`, `personalFollowUpCards`/`focusFollowUpFilter` sin cambios).
- `tests/agt003-followup-form-copy-static.test.mjs` — assertion nueva para la advertencia no bloqueante.

No se espera ningún cambio en `api/`, `server/`, `contracts/agents/`, `supabase/migrations/`, `src/tenders/`, ni en ningún archivo de AGT-002.
