# AGT-003 / Vig-IA Consolidated Visual QA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir en Vig-IA los cuatro focos de QA visual consolidados y aprobados por diseño: densidad y accesibilidad de "Prioridades Comerciales" (7/4+3/2/1 columnas y CTAs de tarjeta ≥44px), saneamiento de evidencia cruda (claves de BD, fechas ISO y montos COP) hacia texto legible en zona horaria America/Bogota, rotulado explícito "Qué pasó:" en las tres superficies de "Mi día" (incluida una extensión gerencial nueva), y reestructuración del copiloto de oportunidad (Qué pasó/Falta/Objetivo/Siguiente paso, sin foco programático decorativo, "Contexto y evidencia" plegado).

**Architecture:** Un sanitizador puro nuevo, `src/vigia/text-sanitizer.ts` (`humanizeVigiaText`, `DB_KEY_LABEL`), es consumido por `src/vigia/VigiaCommercial.tsx` (Tarea 1) y reexportado como `humanizePresentedText` desde `src/vigia/copilot-presentation.ts` (Tarea 3), donde `PresentedCopilotBrief` gana `missingInformation`/`missingSummary` y reclasifica los "hechos" marcados como "Seguimiento migrado:" hacia información no verificada. `src/main.tsx` extiende `MyDayGroup` (mismo contrato de props) con un rótulo `Qué pasó:` y agrega un banner gerencial nuevo en `ConsultantDetail` que reutiliza `buildMyDayQueue`/`myDay`/`ownerName` ya existentes, sin tocar `my-day-presentation.ts`. `src/vigia/VigiaOpportunityCopilot.tsx` consume `PresentedCopilotBrief` para reordenar `VigiaCopilotProposal` (cabecera con "Actualizar propuesta", bloque Qué pasó/Falta/Objetivo, Siguiente paso, Revisión humana, acciones, Contexto y evidencia plegado) y retira el foco programático. `src/styles.css` recibe los ajustes de densidad, CTAs, "Mi día" y el nuevo bloque del copiloto en los bloques ya existentes correspondientes.

**Tech Stack:** React + TypeScript + Vite, esbuild (bundling de los tests estáticos vía `buildSync`), `node --test` (Node test runner nativo), `tsc --noEmit`, Vercel (despliegue de producción en el cierre del plan).

**Spec:** `docs/superpowers/specs/2026-09-02-agt003-consolidated-visual-qa-design.md` (estado: diseño aprobado, implementación autorizada explícitamente).

**Rama de trabajo:** `fix/agt003-consolidated-visual-qa-20260902` (ya creada, base `main` en `cdabf1d`).

**Fecha:** 2026-09-02.

## Global Constraints

- **Alcance:** frontend puro — `src/vigia/VigiaCommercial.tsx`, `src/vigia/VigiaOpportunityCopilot.tsx`, `src/vigia/copilot-presentation.ts`, `src/vigia/text-sanitizer.ts` (nuevo), `src/main.tsx` (`MyDayGroup`, `ConsultantDetail`), `src/styles.css`, y los archivos de `tests/` listados en cada tarea. **No** se toca `vigia-engine.js`, `src/vigia/my-day-presentation.ts`, `src/vigia/opportunity-copilot-state.ts`, `src/tenders/**`, `server/**`, `api/**`, `supabase/migrations/**`, ni ningún archivo de `contracts/agents/AGT-002/*`.
- **Método:** TDD por tarea, RED → GREEN, sin dejar ninguna tarea a medio terminar antes de pasar a la siguiente. Cada tarea es desplegable de forma independiente (no rompe la suite existente al terminar).
- **Convención de comandos:** usar `node --test <archivo>` para correr un test puntual durante RED/GREEN. **No se ejecuta `npm test`/la suite completa del repositorio en ningún punto de este plan** — hay antecedente confirmado de OOM al correrla completa. Al cierre de cada tarea y al final del plan se corre en su lugar la suite focal AGT-003/Vig-IA en forma segura:

  ```bash
  node --test tests/agt003-*.test.mjs tests/vigia-*.test.mjs tests/consultant-detail-static.test.mjs
  npx tsc --noEmit
  npm run check:backend-parity
  npm run check:siio-integration
  npm run build
  git diff --check
  ```

---

## Interfaces globales (consume/produce)

- **`src/vigia/text-sanitizer.ts`** (nuevo, Tarea 1) — produce `humanizeVigiaText(text: string | null | undefined): string` y `DB_KEY_LABEL: Record<string, string>`. Consumido por `src/vigia/VigiaCommercial.tsx` (Tarea 1) y por `src/vigia/copilot-presentation.ts` (Tarea 3, como alias `humanizePresentedText`). No importa React, no importa nada de `api/`/`server/`.
- **`src/vigia/copilot-presentation.ts`** (Tarea 3) — `PresentedCopilotBrief` gana los campos `missingInformation: string[]` y `missingSummary: string`; gana la función exportada `humanizePresentedText`/`summarizeMissingInformation`. Ningún campo existente cambia de tipo. Consumido por `src/vigia/VigiaOpportunityCopilot.tsx` (Tarea 4), que es el único consumidor fuera de su propio test.
- **`src/vigia/my-day-presentation.ts`** — sin cambios de interfaz en este plan (`buildMyDayQueue`/`MyDayAlert`/`MyDayQueue` ya existen e implementados). La Tarea 2 sólo extiende quién consume su salida (`ConsultantDetail` en modo `!personal`), no el módulo puro.
- **`MyDayGroup`** (`src/main.tsx`) — misma firma de props (`title`, `alerts`, `total`, `tone`, `empty`); la Tarea 2 la reutiliza sin cambios de tipo en una segunda ubicación (banner gerencial).
- **`VigiaCopilotProposal`** (`src/vigia/VigiaOpportunityCopilot.tsx`, Tarea 4) — su tipo `ProposalProps` gana `onRegenerate: () => void`; consume `PresentedCopilotBrief` (Tarea 3) vía `presentCopilotBrief`/`presentCompactCopilotSummary` (sin cambios de estas dos funciones puras salvo lo ya cubierto en Tarea 3).

---

## Tarea 1 — Prioridades Comerciales, CTAs de tarjeta y sanitizador de evidencia (A + B)

**Archivos:**
- `src/vigia/text-sanitizer.ts` — nuevo
- `src/vigia/VigiaCommercial.tsx` — líneas 1-6 (imports), 40 (formateador de fecha), 50 (tras `displayDateOnly`), 185, 186, 188 (tarjeta de prioridad)
- `src/styles.css` — bloque "Vig-IA Comercial Gate 0" (línea 359, una sola línea) y bloque "Prioridades Comerciales — filtros consolidados" (línea 362, una sola línea)
- `tests/agt003-consolidated-visual-qa-static.test.mjs` — nuevo

**Interfaces:** consume nada nuevo; produce `humanizeVigiaText`/`DB_KEY_LABEL` (ver sección global) para consumo de la Tarea 3.

### RED

- [ ] Crear `tests/agt003-consolidated-visual-qa-static.test.mjs` con el siguiente contenido exacto:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';

// --- text-sanitizer.ts (puro) ---------------------------------------------------------------
const entry = new URL('../src/vigia/text-sanitizer.ts', import.meta.url).pathname;
const bundle = buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false });
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
const { humanizeVigiaText, DB_KEY_LABEL } = await import(moduleUrl);

const BOGOTA_DATETIME_LABEL = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' });
const COP_GROUPING = new Intl.NumberFormat('es-CO');

assert.equal(
  humanizeVigiaText('Campos inválidos: last_interaction_at, updated_at.'),
  'Campos inválidos: última interacción registrada, última actualización del registro.',
  'los nombres de columna crudos deben traducirse a etiquetas legibles',
);
assert.equal(
  humanizeVigiaText('created_at y offer_value'),
  `${DB_KEY_LABEL.created_at} y ${DB_KEY_LABEL.offer_value}`,
  'las cuatro claves del diccionario deben traducirse usando el mismo lookup',
);

const isoInput = 'Próxima gestión vencida: 2026-07-21T14:29:00+00:00.';
const expectedIso = BOGOTA_DATETIME_LABEL.format(new Date('2026-07-21T14:29:00+00:00'));
assert.equal(
  humanizeVigiaText(isoInput),
  `Próxima gestión vencida: ${expectedIso}.`,
  'una fecha ISO completa con hora y zona debe reformatearse a America/Bogota con hora visible',
);

const expectedAmount = `$${COP_GROUPING.format(75310000)} COP`;
assert.equal(humanizeVigiaText('Valor registrado: 75310000 COP.'), `Valor registrado: ${expectedAmount}.`, 'monto con COP como sufijo debe normalizarse a $X.XXX.XXX COP');
assert.equal(humanizeVigiaText('Valor registrado: COP 75310000.'), `Valor registrado: ${expectedAmount}.`, 'monto con COP como prefijo debe normalizarse igual que el sufijo');

assert.equal(humanizeVigiaText('4 24 horas'), '4 24 horas', 'texto no reconocido debe quedar intacto, sin inventar formato');
assert.equal(humanizeVigiaText(null), '', 'entrada nula produce cadena vacía, sin lanzar');
assert.equal(humanizeVigiaText(undefined), '', 'entrada indefinida produce cadena vacía, sin lanzar');

// --- VigiaCommercial.tsx (uso del sanitizador + huso horario + sufijo COP) ------------------
const component = readFileSync(new URL('../src/vigia/VigiaCommercial.tsx', import.meta.url), 'utf8');
assert.match(component, /import \{ humanizeVigiaText, DB_KEY_LABEL \} from '\.\/text-sanitizer';/, 'VigiaCommercial debe importar el sanitizador compartido');
assert.match(component, /const date = new Intl\.DateTimeFormat\('es-CO', \{ dateStyle: 'medium', timeZone: 'America\/Bogota' \}\);/, 'el formateador de fecha corta debe anclarse a America/Bogota');
assert.match(component, /function activityBasisLabel\(basis: string\): string \{/, 'debe existir el lookup activityBasisLabel');
assert.match(component, /<span>\{humanizeVigiaText\(signal\.evidence\)\}<\/span>/, 'la evidencia de cada señal debe pasar por humanizeVigiaText, sin excepción');
assert.match(component, /\(\{activityBasisLabel\(priority\.evidence\.activity_basis\)\}\)/, 'el pie de evidencia debe usar activityBasisLabel para activity_basis');
assert.match(component, /\{Number\(priority\.offer_value\) > 0 \? `\$\{money\.format\(priority\.offer_value\)\} COP` : 'Valor no registrado'\}/, 'el monto de la tarjeta debe llevar el sufijo explícito COP');

// --- styles.css (A: densidad de Prioridades Comerciales; B: acciones de tarjeta) ------------
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

assert.match(css, /\.priority-filter-tabs\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\);gap:10px\}/, 'base: 4 columnas (7 tarjetas ⇒ 4+3)');
assert.match(css, /\.priority-filter-tab\{display:grid;gap:3px;min-height:84px;padding:12px 14px;/, 'la tarjeta de categoría debe bajar a min-height:84px');
assert.match(css, /\.priority-filter-tab strong\{font-size:22px\}/, 'el contador de categoría debe reducir su tipografía a 22px');
assert.match(css, /@media\(min-width:1800px\)\{\.priority-filter-tabs\{grid-template-columns:repeat\(7,minmax\(0,1fr\)\)\}\}/, 'en pantallas ≥1800px las 7 categorías caben en una sola fila');
assert.match(css, /@media\(max-width:1100px\)\{\.priority-filter-tabs\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}\.priority-filter-grid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}\.priority-search\{grid-column:span 2\}\}/, '≤1100px: 2 columnas para las categorías, sin cambiar el panel de filtros');
assert.match(css, /@media\(max-width:700px\)\{\.priority-filter-grid\{grid-template-columns:1fr 1fr\}/, '.priority-filter-grid conserva su propia escalera en 700px, separada de .priority-filter-tabs');
assert.match(css, /@media\(max-width:640px\)\{\.priority-filter-tabs\{grid-template-columns:1fr\}\.priority-filter-tab\{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:44px;padding:10px 12px\}\.priority-filter-tab strong\{font-size:18px\}\}/, '≤640px: 1 columna, layout horizontal compacto, min-height:44px');
assert.ok(!/\.priority-filter-tabs,\.priority-filter-grid\{grid-template-columns:1fr 1fr\}/.test(css), '.priority-filter-tabs ya no debe compartir selector con .priority-filter-grid en 700px');
assert.ok(!/\.priority-filter-tabs,\.priority-filter-grid\{grid-template-columns:1fr\}/.test(css), '.priority-filter-tabs ya no debe compartir selector con .priority-filter-grid en 480px');

assert.match(css, /\.vigia-command-hero\{[^}]*padding:18px 22px/, 'el hero de Prioridades Comerciales debe reducir su padding');
assert.match(css, /\.vigia-command-hero h2\{margin:5px 0 6px;font-size:23px\}/, 'el título del hero debe reducir su tipografía a 23px');

assert.match(css, /\.vigia-card-actions \.button\{display:inline-flex;align-items:center;justify-content:center;min-height:44px;/, 'la acción primaria de la tarjeta debe tener estilo dedicado con min-height:44px');
assert.match(css, /\.vigia-card-actions \.button:hover\{background:#123f8e\}/, 'la acción primaria debe tener estado :hover');
assert.match(css, /\.vigia-card-actions \.button:focus-visible\{outline:3px solid #93c5fd;outline-offset:2px\}/, 'la acción primaria debe tener :focus-visible visible');
assert.match(css, /\.vigia-card-actions \.button\.secondary\{background:#e9eef7;color:#1b355f;border:1px solid #cbd9e8\}/, 'la acción secundaria debe tener estilo outline/clara');
assert.match(css, /@media\(max-width:560px\)\{[\s\S]*?\.vigia-card-actions\{flex-direction:column\}\.vigia-card-actions \.button\{width:100%\}\}/, 'en móvil, las dos acciones deben apilarse al 100% de ancho');

console.log('AGT-003 consolidated visual QA static contract passed');
```

- [ ] Ejecutar `node --test tests/agt003-consolidated-visual-qa-static.test.mjs` y observar el fallo esperado: el `import()` del módulo falla (`Cannot find module .../text-sanitizer.ts` vía esbuild) porque el archivo no existe todavía; el test se aborta en el primer bloque, antes de llegar a las aserciones de `VigiaCommercial.tsx`/`styles.css`.

### GREEN

- [ ] Crear `src/vigia/text-sanitizer.ts` con exactamente este contenido (verbatim de la sección B del diseño):

```ts
const DB_KEY_LABEL: Record<string, string> = {
  last_interaction_at: 'última interacción registrada',
  updated_at: 'última actualización del registro',
  created_at: 'creación del registro',
  offer_value: 'valor de la oferta',
};
const DB_KEY_PATTERN = new RegExp(`\\b(${Object.keys(DB_KEY_LABEL).join('|')})\\b`, 'g');
const ISO_DATETIME = /\b(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)(Z|[+-]\d{2}:?\d{2})\b/g;
const COP_AMOUNT = /(?:COP\s*([\d.,]{4,}))|(?:\b([\d.,]{4,})\s*COP\b)/gi;
const BOGOTA_DATETIME_LABEL = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' });
const COP_GROUPING = new Intl.NumberFormat('es-CO');

export { DB_KEY_LABEL };

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

- [ ] En `src/vigia/VigiaCommercial.tsx`:
   - Agregar el import, junto a los existentes (línea 5): `import { humanizeVigiaText, DB_KEY_LABEL } from './text-sanitizer';`
   - Línea 40, cambiar:
     ```ts
     const date = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' });
     ```
     por:
     ```ts
     const date = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: 'America/Bogota' });
     ```
   - Tras `displayDateOnly` (línea 50), agregar:
     ```ts
     function activityBasisLabel(basis: string): string {
       return DB_KEY_LABEL[basis] || (basis === 'missing' ? 'sin actividad registrada' : 'sin dato de origen');
     }
     ```
   - Línea 185, cambiar:
     ```tsx
     <div className="vigia-card-value"><small>Valor registrado</small><strong>{Number(priority.offer_value) > 0 ? money.format(priority.offer_value) : 'Valor no registrado'}</strong></div>
     ```
     por:
     ```tsx
     <div className="vigia-card-value"><small>Valor registrado</small><strong>{Number(priority.offer_value) > 0 ? `${money.format(priority.offer_value)} COP` : 'Valor no registrado'}</strong></div>
     ```
   - Línea 186, cambiar `<span>{signal.evidence}</span>` por `<span>{humanizeVigiaText(signal.evidence)}</span>`.
   - Línea 188, cambiar `({priority.evidence.activity_basis})` por `({activityBasisLabel(priority.evidence.activity_basis)})`.

- [ ] En `src/styles.css`, dentro del bloque "Vig-IA Comercial Gate 0" (línea 359):
   - Reemplazar `.vigia-command-hero{...}.vigia-command-hero h2{margin:6px 0 8px;font-size:28px}` — específicamente los fragmentos `padding:24px;` → `padding:18px 22px;` y `.vigia-command-hero h2{margin:6px 0 8px;font-size:28px}` → `.vigia-command-hero h2{margin:5px 0 6px;font-size:23px}`.
   - Tras `.vigia-card-actions,.vigia-feedback{display:flex;flex-wrap:wrap;gap:8px}`, insertar:
     ```css
     .vigia-card-actions .button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:11px 16px;border-radius:11px;background:#1b64f2;color:#fff;font-weight:800;font-size:13px;text-decoration:none;text-align:center;transition:background .16s ease}.vigia-card-actions .button:hover{background:#123f8e}.vigia-card-actions .button:focus-visible{outline:3px solid #93c5fd;outline-offset:2px}.vigia-card-actions .button.secondary{background:#e9eef7;color:#1b355f;border:1px solid #cbd9e8}.vigia-card-actions .button.secondary:hover{background:#dce6f5}
     ```
   - Cambiar `@media(max-width:560px){.vigia-summary-grid{grid-template-columns:1fr}.vigia-evidence{grid-template-columns:1fr}.vigia-control-strip{align-items:flex-start;flex-direction:column}}` por:
     ```css
     @media(max-width:560px){.vigia-summary-grid{grid-template-columns:1fr}.vigia-evidence{grid-template-columns:1fr}.vigia-control-strip{align-items:flex-start;flex-direction:column}.vigia-card-actions{flex-direction:column}.vigia-card-actions .button{width:100%}}
     ```
   - Dentro del bloque "Prioridades Comerciales — filtros consolidados" (línea 362):
     - Cambiar:
       ```css
       .priority-filter-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.priority-filter-tab{display:grid;gap:4px;min-height:118px;padding:15px;text-align:left;border:1px solid #dce7f4;border-top:4px solid #2563eb;border-radius:16px;background:#fff;color:#17345b;box-shadow:0 7px 20px rgba(31,65,110,.07)}.priority-filter-tab strong{font-size:27px}
       ```
       por:
       ```css
       .priority-filter-tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.priority-filter-tab{display:grid;gap:3px;min-height:84px;padding:12px 14px;text-align:left;border:1px solid #dce7f4;border-top:4px solid #2563eb;border-radius:14px;background:#fff;color:#17345b;box-shadow:0 6px 16px rgba(31,65,110,.06)}.priority-filter-tab strong{font-size:22px}
       ```
       (`.priority-filter-tab small/span/.danger/.amber/.blue/.active*` no se tocan.)
     - Cambiar:
       ```css
       @media(max-width:1100px){.priority-filter-tabs{grid-template-columns:repeat(3,minmax(0,1fr))}.priority-filter-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.priority-search{grid-column:span 2}}@media(max-width:700px){.priority-filter-tabs,.priority-filter-grid{grid-template-columns:1fr 1fr}.priority-filter-heading{align-items:flex-start}.priority-search{grid-column:1/-1}}@media(max-width:480px){.priority-filter-tabs,.priority-filter-grid{grid-template-columns:1fr}.priority-search{grid-column:auto}}
       ```
       por:
       ```css
       @media(min-width:1800px){.priority-filter-tabs{grid-template-columns:repeat(7,minmax(0,1fr))}}@media(max-width:1100px){.priority-filter-tabs{grid-template-columns:repeat(2,minmax(0,1fr))}.priority-filter-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.priority-search{grid-column:span 2}}@media(max-width:700px){.priority-filter-grid{grid-template-columns:1fr 1fr}.priority-filter-heading{align-items:flex-start}.priority-search{grid-column:1/-1}}@media(max-width:480px){.priority-filter-grid{grid-template-columns:1fr}.priority-search{grid-column:auto}}@media(max-width:640px){.priority-filter-tabs{grid-template-columns:1fr}.priority-filter-tab{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:44px;padding:10px 12px}.priority-filter-tab strong{font-size:18px}}
       ```

- [ ] `node --test tests/agt003-consolidated-visual-qa-static.test.mjs` → verde.
- [ ] `node --test tests/agt003-priority-card-actions-static.test.mjs tests/commercial-alerts-static.test.mjs` → verde sin modificar sus aserciones (ambos sólo verifican presencia de selectores/marcadores por substring, no los valores CSS tocados).
- [ ] `npx tsc --noEmit` → verde.

### Criterio observable de cierre de la tarea

`git diff --stat` muestra únicamente `src/vigia/text-sanitizer.ts` (nuevo), `src/vigia/VigiaCommercial.tsx`, `src/styles.css`, `tests/agt003-consolidated-visual-qa-static.test.mjs` (nuevo). `grep -c "priority.evidence.activity_basis}" src/vigia/VigiaCommercial.tsx` devuelve `0` (ya no se interpola el valor crudo).

### Commit

```bash
git add src/vigia/text-sanitizer.ts src/vigia/VigiaCommercial.tsx src/styles.css tests/agt003-consolidated-visual-qa-static.test.mjs
git commit -m "feat(vigia): density + card CTAs + evidence sanitizer for Prioridades Comerciales"
```

---

## Tarea 2 — "Mi día": rótulo `Qué pasó:` y extensión gerencial (C)

**Archivos:**
- `src/main.tsx` — `MyDayGroup` (línea 747-760), `ConsultantDetail` (bloque `personal &&`/`!personal`, líneas 2362-2386)
- `src/styles.css` — bloque "Mi día" (líneas 215-231)
- `tests/consultant-detail-static.test.mjs` — extender

**Interfaces:** consume `buildMyDayQueue`/`myDay`/`ownerName` ya existentes en `ConsultantDetail` (sin cambios de `my-day-presentation.ts`); no produce ninguna interfaz nueva — `MyDayGroup` conserva su firma.

### RED

- [ ] En `tests/consultant-detail-static.test.mjs`:
   - Reemplazar la aserción existente de `min-height:40px` (línea 50) por su equivalente en `44px`:
     ```js
     assert.match(css, /\.my-day-card \.button\{[^}]*min-height:44px/, '.my-day-card .button debe tener un objetivo táctil de 44px (paquete de QA visual consolidado)');
     ```
   - Agregar, después de la aserción de `Preparar seguimiento` (línea 16):
     ```js
     assert.match(source, /<p className="my-day-fact"><em>Qué pasó:<\/em> \{a\.fact\}<\/p>/, 'MyDayGroup debe rotular el primer dato de cada tarjeta con "Qué pasó:"');
     assert.match(
       source,
       /<section className="commercial-followup-banner my-day-manager-banner" aria-label=\{`Prioridades de hoy de \$\{ownerName\}`\}>/,
       'un gerente en el detalle de un consultor específico debe ver "Prioridades de hoy de {ownerName}"',
     );
     assert.match(source, /<h3>Prioridades de hoy de \{ownerName\}<\/h3>/, 'el título del banner gerencial debe nombrar al consultor');
     assert.match(source, /\{!personal && <section className="commercial-followup-banner my-day-manager-banner"/, 'el banner gerencial debe ser mutuamente excluyente con el tablero personal');
     ```
   - Agregar, tras las aserciones de CSS existentes (línea 24):
     ```js
     assert.match(css, /\.my-day-card \.my-day-fact em,\.my-day-card \.my-day-gap em,\.my-day-card \.my-day-goal em\{font-style:normal;color:#bfdbfe;font-weight:800\}/, '.my-day-fact em debe compartir el estilo de énfasis claro sobre fondo oscuro');
     assert.match(
       css,
       /\.my-day-secondary \.my-day-card \.my-day-fact em,\.my-day-secondary \.my-day-card \.my-day-gap em,\.my-day-secondary \.my-day-card \.my-day-goal em,\.my-day-muted \.my-day-card \.my-day-fact em,\.my-day-muted \.my-day-card \.my-day-gap em,\.my-day-muted \.my-day-card \.my-day-goal em\{color:#1d4ed8\}/,
       '.my-day-fact em en tarjetas secondary/muted debe llevar el mismo override azul oscuro que .my-day-gap/.my-day-goal',
     );
     assert.match(css, /\.my-day-manager-banner\{grid-template-columns:1fr\}/, 'el banner gerencial debe forzar una sola columna (sin segunda columna de tarjetas de resumen)');
     ```
- [ ] `node --test tests/consultant-detail-static.test.mjs` → falla: la aserción de `min-height:44px` no calza (hoy es `40px`), `Qué pasó:` no existe en el código fuente, y el banner gerencial no existe.

### GREEN

- [ ] En `src/main.tsx`, dentro de `MyDayGroup` (línea 753), cambiar:
   ```tsx
   <p>{a.fact}</p>
   ```
   por:
   ```tsx
   <p className="my-day-fact"><em>Qué pasó:</em> {a.fact}</p>
   ```
- [ ] En `src/main.tsx`, insertar el siguiente bloque nuevo inmediatamente después del cierre `</div>}` del bloque `{personal && <div className="personal-dashboard">...}` (línea 2386) y antes de `<div className="grid kpis manager-kpis consultant-kpis">` (línea 2388):
   ```tsx
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
   ```
   (`myDay`/`ownerName` ya están declarados en `ConsultantDetail`, líneas 2259-2260 — no se agrega ningún import ni hook nuevo.)
- [ ] En `src/styles.css`, bloque "Mi día":
   - Cambiar (línea 221):
     ```css
     .my-day-card .my-day-gap em,.my-day-card .my-day-goal em{font-style:normal;color:#bfdbfe;font-weight:800}
     ```
     por:
     ```css
     .my-day-card .my-day-fact em,.my-day-card .my-day-gap em,.my-day-card .my-day-goal em{font-style:normal;color:#bfdbfe;font-weight:800}
     ```
   - Cambiar (línea 222) `min-height:40px` por `min-height:44px` dentro de `.my-day-card .button{...}`.
   - Cambiar (línea 228):
     ```css
     .my-day-secondary .my-day-card .my-day-gap em,.my-day-secondary .my-day-card .my-day-goal em,.my-day-muted .my-day-card .my-day-gap em,.my-day-muted .my-day-card .my-day-goal em{color:#1d4ed8}
     ```
     por:
     ```css
     .my-day-secondary .my-day-card .my-day-fact em,.my-day-secondary .my-day-card .my-day-gap em,.my-day-secondary .my-day-card .my-day-goal em,.my-day-muted .my-day-card .my-day-fact em,.my-day-muted .my-day-card .my-day-gap em,.my-day-muted .my-day-card .my-day-goal em{color:#1d4ed8}
     ```
   - Tras `.my-day-hygiene>summary{cursor:pointer;font-weight:800;color:#dbeafe;padding:4px 0}` (línea 230), agregar:
     ```css
     .my-day-manager-banner{grid-template-columns:1fr}
     ```
- [ ] `node --test tests/consultant-detail-static.test.mjs` → verde.
- [ ] `node --test tests/vigia-ui-static.test.mjs` → verde sin cambios (no referencia `.my-day-*`).
- [ ] `npx tsc --noEmit` → verde.

### Criterio observable de cierre de la tarea

`git diff --stat` muestra únicamente `src/main.tsx`, `src/styles.css`, `tests/consultant-detail-static.test.mjs`. `grep -n "my-day-manager-banner" src/main.tsx` devuelve exactamente una coincidencia (la nueva sección), condicionada a `!personal`.

### Commit

```bash
git add src/main.tsx src/styles.css tests/consultant-detail-static.test.mjs
git commit -m "feat(vigia): label Mi día's first fact and extend it to manager consultant view"
```

---

## Tarea 3 — Presentación pura del copiloto: sanitizador compartido y reclasificación de "Seguimiento migrado" (D.1)

**Archivos:**
- `src/vigia/copilot-presentation.ts`
- `tests/agt003-copilot-presentation.test.mjs` — extender

**Interfaces:** consume `humanizeVigiaText` de `src/vigia/text-sanitizer.ts` (Tarea 1); produce los campos nuevos de `PresentedCopilotBrief` (ver sección global) que consumirá la Tarea 4.

### RED

- [ ] En `tests/agt003-copilot-presentation.test.mjs`:
   - Ampliar el import de línea 7-14 agregando `humanizePresentedText` y `summarizeMissingInformation`:
     ```js
     const {
       COMMERCIAL_TEXT_FALLBACKS,
       isTechnicalCopilotText,
       normalizeCopilotErrorMessage,
       presentCompactCopilotSummary,
       presentCopilotBrief,
       splitContactPlanSteps,
       humanizePresentedText,
       summarizeMissingInformation,
     } = await import(moduleUrl);
     ```
   - Reemplazar el objeto `brief` (líneas 54-71) para incluir montos `COP` sin ambigüedad de puntuación final (evita que el punto de cierre de oración quede adyacente a los dígitos):
     ```js
     const brief = Object.freeze({
       summary: 'La oportunidad está valorada en COP 125.000.000 dentro de la etapa Propuesta.',
       facts: Object.freeze([
         Object.freeze({ text: 'El valor registrado alcanza COP 125.000.000 según el CRM.', evidence_refs: Object.freeze(['e1']) }),
         Object.freeze({ text: 'El payload devuelto respeta el schema acordado.', evidence_refs: Object.freeze(['e2']) }),
       ]),
       inferences: Object.freeze([
         Object.freeze({ text: 'El cliente sigue evaluando.', evidence_refs: Object.freeze(['e3']), confidence: 'medium' }),
         Object.freeze({ text: 'No se recomendaron approved_assets.', evidence_refs: Object.freeze(['e4']), confidence: 'low' }),
       ]),
       missing_information: Object.freeze(['Correo del contacto decisor']),
       contact_objective: 'Reactivar la conversación y confirmar el decisor.',
       strategy: 'Primero confirme el decisor. Luego proponga una reunión de 20 minutos.',
       draft: Object.freeze({ subject: 'Seguimiento propuesta', body: 'Buen día…' }),
       recommended_asset_ids: Object.freeze([]),
       warnings: Object.freeze(['No hay contacto decisor verificado.']),
       human_review_required: true,
     });
     ```
   - Reemplazar las líneas 72-89 (snapshot + aserciones sobre `presented`) por:
     ```js
     const COP_GROUPING = new Intl.NumberFormat('es-CO');
     const expectedSummary = `La oportunidad está valorada en $${COP_GROUPING.format(125000000)} COP dentro de la etapa Propuesta.`;
     const expectedFactText = `El valor registrado alcanza $${COP_GROUPING.format(125000000)} COP según el CRM.`;

     const snapshot = JSON.stringify(brief);
     const presented = presentCopilotBrief(brief);

     assert.deepEqual(presented.contactPlanSteps, [
       'Primero confirme el decisor.',
       'Luego proponga una reunión de 20 minutos.',
     ]);
     assert.equal(presented.contactObjective, brief.contact_objective);
     assert.equal(presented.summary, expectedSummary, 'el resumen debe pasar por el sanitizador compartido antes de presentarse');
     assert.deepEqual(presented.facts, [{ text: expectedFactText, evidence_refs: brief.facts[0].evidence_refs }], 'cada fact debe humanizarse con el mismo sanitizador que la evidencia de Prioridades Comerciales');
     assert.deepEqual(presented.inferences, [brief.inferences[0]]);
     assert.deepEqual(presented.recommendedAssetIds, []);
     assert.equal(presented.hasApprovedAssets, false);
     assert.deepEqual(presented.missingInformation, ['Correo del contacto decisor']);
     assert.equal(presented.missingSummary, 'Correo del contacto decisor');
     for (const removed of ['strategy', 'warnings']) {
       assert.equal(removed in presented, false, `${removed} ya no forma parte de la presentación`);
     }
     assert.equal('draft' in presented, false, 'el borrador editable no se reencuadra en presentación');
     assert.equal(JSON.stringify(brief), snapshot, 'presentCopilotBrief no muta el brief persistido');
     ```
   - Agregar, inmediatamente después del bloque anterior (antes del bloque `hostile`):
     ```js
     // Degradación conservadora por marcador explícito: un fact "Seguimiento migrado:" nunca aparece
     // en Datos utilizados — se mueve, sin reescribir su texto, a Información no verificada.
     const migratedBrief = {
       ...brief,
       facts: [...brief.facts, { text: 'Seguimiento migrado: Llamada. 4 24 horas', evidence_refs: [] }],
     };
     const migratedPresented = presentCopilotBrief(migratedBrief);
     assert.deepEqual(
       migratedPresented.facts,
       [{ text: expectedFactText, evidence_refs: brief.facts[0].evidence_refs }],
       'el fact con el marcador de migración no debe aparecer en Datos utilizados',
     );
     assert.ok(
       migratedPresented.missingInformation.includes('Seguimiento migrado: Llamada. 4 24 horas'),
       'el fact migrado se degrada a Información no verificada, con su texto intacto (no calza ningún patrón de fecha/monto)',
     );
     assert.equal(migratedPresented.missingInformation.length, 2, 'la lista de no verificados suma el original más el fact migrado');
     assert.equal(
       migratedPresented.missingSummary,
       `${migratedPresented.missingInformation[0]} (+1 más)`,
       'con más de un elemento, el resumen "Falta" muestra el primero y cuenta el resto',
     );

     assert.equal(summarizeMissingInformation([]), 'Sin brechas de información pendientes según el registro.', 'sin brechas, el resumen debe ser el mensaje explícito, nunca una cadena vacía');

     const BOGOTA_DATETIME_LABEL = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' });
     const isoText = 'Próxima gestión vencida: 2026-07-21T14:29:00+00:00.';
     assert.equal(
       humanizePresentedText(isoText),
       `Próxima gestión vencida: ${BOGOTA_DATETIME_LABEL.format(new Date('2026-07-21T14:29:00+00:00'))}.`,
       'humanizePresentedText debe ser un alias directo del sanitizador compartido',
     );
     assert.equal(humanizePresentedText('4 24 horas'), '4 24 horas', 'texto no reconocido por el sanitizador debe quedar intacto');
     ```
- [ ] `node --test tests/agt003-copilot-presentation.test.mjs` → falla: `humanizePresentedText`/`summarizeMissingInformation` son `undefined` (no exportados todavía), y `presented.summary`/`presented.facts`/`presented.missingInformation`/`presented.missingSummary` no calzan con el comportamiento actual (`presentCopilotBrief` hoy no humaniza ni expone `missingInformation`).

### GREEN

- [ ] En `src/vigia/copilot-presentation.ts`:
   - Agregar el import, junto al de `agentIdentity` (línea 6):
     ```ts
     import { humanizeVigiaText } from './text-sanitizer';
     ```
   - Agregar, después de `filterCommercialEntries` (línea 46):
     ```ts
     export function humanizePresentedText(text: string): string {
       return humanizeVigiaText(text);
     }

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

     function filterCommercialTextList(list: readonly string[] | null | undefined): string[] {
       const result: string[] = [];
       for (const raw of list ?? []) {
         const text = String(raw ?? '').trim();
         if (!text || isTechnicalCopilotText(text)) continue;
         result.push(text);
       }
       return result;
     }

     const MISSING_INFORMATION_EMPTY = 'Sin brechas de información pendientes según el registro.';
     export function summarizeMissingInformation(items: readonly string[]): string {
       if (!items.length) return MISSING_INFORMATION_EMPTY;
       return items.length > 1 ? `${items[0]} (+${items.length - 1} más)` : items[0];
     }
     ```
   - Reemplazar el tipo `PresentedCopilotBrief` (líneas 62-70) por:
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
     ```
   - Reemplazar `presentCopilotBrief` (líneas 88-100) por:
     ```ts
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
- [ ] `node --test tests/agt003-copilot-presentation.test.mjs` → verde, incluidas todas las aserciones preexistentes no listadas arriba (`normalizeCopilotErrorMessage`, `presentCompactCopilotSummary`, truncado/elipsis) sin modificarse.
- [ ] `npx tsc --noEmit` → verde (confirma que `src/vigia/VigiaOpportunityCopilot.tsx`, que todavía no lee los campos nuevos, sigue compilando sin castings — los campos son aditivos).

### Criterio observable de cierre de la tarea

`git diff --stat` muestra únicamente `src/vigia/copilot-presentation.ts` y `tests/agt003-copilot-presentation.test.mjs`. `grep -n "missingInformation" src/vigia/VigiaOpportunityCopilot.tsx` no devuelve resultados todavía (ese consumo es la Tarea 4).

### Commit

```bash
git add src/vigia/copilot-presentation.ts tests/agt003-copilot-presentation.test.mjs
git commit -m "feat(vigia): humanize copilot brief text and reclassify migrated facts as unverified"
```

---

## Tarea 4 — Componente y CSS del copiloto (D.2 + E), gates finales, PR, merge y despliegue

**Archivos:**
- `src/vigia/VigiaOpportunityCopilot.tsx` — `VigiaCopilotProposal` (líneas 53-81), `VigiaOpportunityCopilot` (líneas 83-143)
- `src/styles.css` — bloque "Vig-IA Comercial — copiloto en detalle de oportunidad" (líneas 479-497)
- `tests/agt003-copilot-proposal-render.test.mjs` — reescritura completa
- `tests/vigia-opportunity-copilot-ui-static.test.mjs` — marcadores actualizados

**Interfaces:** consume `PresentedCopilotBrief` (Tarea 3) vía `presentCopilotBrief`/`presentCompactCopilotSummary`; no produce ninguna interfaz nueva para otras tareas — es el último eslabón de consumo de este plan.

### RED

- [ ] Reescribir `tests/agt003-copilot-proposal-render.test.mjs` completo con el siguiente contenido (el fixture evita deliberadamente montos `COP`/fechas ISO en `summary`/`facts`/`inferences`, porque esa transformación ya la prueba la Tarea 3 — aquí se prueba únicamente la estructura D+E):

```js
import assert from 'node:assert/strict';
import { loadReactComponent, renderReactComponent } from './helpers/bundle-react-component.mjs';

const VigiaCopilotProposal = await loadReactComponent('src/vigia/VigiaOpportunityCopilot.tsx', 'VigiaCopilotProposal');

const brief = {
  summary: 'La oportunidad sigue en etapa de propuesta, sin respuesta del cliente en dos semanas.',
  facts: [{ text: 'El cliente confirmó presupuesto aprobado internamente.', evidence_refs: ['e1'] }],
  inferences: [{ text: 'El cliente sigue evaluando alternativas.', evidence_refs: ['e2'], confidence: 'medium' }],
  missing_information: ['Correo del contacto decisor'],
  contact_objective: 'Reactivar la conversación y confirmar el decisor.',
  strategy: 'Primero confirme el decisor.\nSegundo acuerde una reunión.\nTercero documente el resultado.',
  draft: { subject: 'Seguimiento a la propuesta', body: 'Buen día, retomo el contacto…' },
  recommended_asset_ids: [],
  warnings: [],
  human_review_required: true,
};
const draft = { subject: 'Seguimiento a la propuesta', body: 'Buen día, retomo el contacto…' };
const noop = () => {};
const html = renderReactComponent(VigiaCopilotProposal, { brief, draft, alerts: [], onDraftChange: noop, onCopy: noop, onDiscard: noop, onRegenerate: noop });

const at = needle => {
  const index = html.indexOf(needle);
  assert.notEqual(index, -1, `la propuesta debe renderizar "${needle}"`);
  return index;
};

// Sin foco programático: ningún elemento lleva tabIndex={-1}; hay una región role="status" oculta
// que anuncia el resultado a lectores de pantalla sin mover el foco del usuario.
assert.equal(/tabindex="-1"/.test(html), false, 'ningún elemento debe llevar tabIndex={-1} (foco programático retirado)');
assert.match(html, /<p role="status" class="sr-only">Propuesta preparada para revisión\.<\/p>/, 'debe existir una región role="status" oculta que anuncie la propuesta sin mover el foco');

const header = at('vigia-copilot-proposal-header');
const briefSection = at('vigia-copilot-brief');
const draftSection = at('vigia-copilot-draft');
const review = at('vigia-human-warning');
const actions = at('vigia-copilot-actions');
const context = at('vigia-copilot-context');
assert.ok(header < briefSection && briefSection < draftSection, 'orden: cabecera, luego Qué pasó/Falta/Objetivo, luego el borrador editable');
assert.ok(draftSection < review && review < actions, 'Revisión humana aparece antes de Copiar correo/Descartar');
assert.ok(actions < context, 'Contexto y evidencia va al final, plegado');

// Cabecera: "Actualizar propuesta" vive junto al título, no aislada entre alertas y resultado.
const headerMatch = /<header class="vigia-copilot-proposal-header">([\s\S]*?)<\/header>/.exec(html);
assert.ok(headerMatch, 'debe existir <header class="vigia-copilot-proposal-header">');
assert.match(headerMatch[1], /<h4>Propuesta de seguimiento<\/h4>/);
assert.match(headerMatch[1], /<button type="button" class="secondary">Actualizar propuesta<\/button>/);

// Qué pasó / Falta / Objetivo, en ese orden, con rótulo visible.
const briefMatch = /<section class="vigia-copilot-brief">([\s\S]*?)<\/section>/.exec(html);
assert.ok(briefMatch);
const rows = [...briefMatch[1].matchAll(/<div class="vigia-copilot-brief-row"><strong>([^<]+)<\/strong><p>([^<]*)<\/p><\/div>/g)];
assert.deepEqual(rows.map(r => r[1]), ['Qué pasó', 'Falta', 'Objetivo']);
assert.equal(rows[0][2], brief.summary);
assert.equal(rows[1][2], 'Correo del contacto decisor');
assert.equal(rows[2][2], brief.contact_objective);

// Siguiente paso destacado, sólo cuando la recomendación no se abstiene.
assert.match(html, /<div class="vigia-copilot-next-step"><strong>Siguiente paso:<\/strong> <span>Primero confirme el decisor\.<\/span><\/div>/);
assert.equal(html.includes('vigia-copilot-why'), false, 'whyBullets ya no se renderiza (duplicaría Qué pasó)');

// Contexto y evidencia: cerrado por defecto, con conteo, sin duplicar resumen/objetivo/plan.
assert.equal(/<details[^>]*\sopen(=|\s|>)/.test(html), false, 'el contexto arranca plegado');
const detailsMatch = /<details class="vigia-copilot-context">([\s\S]*?)<\/details>/.exec(html);
assert.ok(detailsMatch, '"Contexto y evidencia" debe ser plegable');
assert.match(detailsMatch[1], /<summary>Contexto y evidencia · 1 datos · 1 inferencias · 1 pendientes<\/summary>/);
assert.equal(detailsMatch[1].includes(brief.summary), false, 'el resumen no se duplica dentro del plegable');
assert.equal(detailsMatch[1].includes(brief.contact_objective), false, 'el objetivo no se duplica dentro del plegable');
assert.equal(detailsMatch[1].includes('Plan de contacto'), false, '"Plan de contacto" se retira del plegable (el primer paso ya vive arriba)');
assert.match(detailsMatch[1], /<h5>Datos utilizados<\/h5>/);
assert.match(detailsMatch[1], /<h5>Inferencias de Vig-IA · por confirmar<\/h5>/);
assert.match(detailsMatch[1], /<h5>Información no verificada<\/h5>/);
assert.ok(detailsMatch[1].includes('El cliente confirmó presupuesto aprobado internamente.'));
assert.ok(detailsMatch[1].includes('Correo del contacto decisor'));

// Insignias de confianza en español, nunca el valor crudo en inglés.
assert.match(detailsMatch[1], /El cliente sigue evaluando alternativas\. <span class="vigia-copilot-confidence confidence-medium">Media<\/span>/);
assert.equal(html.includes('Confianza medium'), false, 'la confianza cruda en inglés no debe exponerse');

for (const forbidden of ['input no confiable', 'instrucciones embebidas', 'approved_assets', 'evidence_refs', 'Ver contexto analizado', 'Borrador editable', 'Siguiente paso sugerido']) {
  assert.equal(html.includes(forbidden), false, `la UI no puede exponer "${forbidden}"`);
}
assert.ok(html.includes('>Copiar correo</button>'));
assert.ok(html.includes('>Descartar</button>'));
assert.ok(html.includes('Puede editar esta propuesta sin modificar el historial de la oportunidad. Verifique nombres, fechas, compromisos y tono antes de copiar el mensaje.'));

const withAssets = renderReactComponent(VigiaCopilotProposal, {
  brief: { ...brief, recommended_asset_ids: ['asset-approved-001'] },
  draft, alerts: [], onDraftChange: noop, onCopy: noop, onDiscard: noop, onRegenerate: noop,
});
assert.ok(withAssets.includes('Adjuntos sugeridos'));
assert.ok(withAssets.includes('asset-approved-001'));

// Criterio 8: el resumen compacto se abstiene si repite una alerta activa; "Siguiente paso" desaparece,
// el resto de la propuesta (borrador, revisión humana, contexto) sigue visible.
const redundantAlerts = [{ key: 'next_action:overdue', category: 'next_action', risk_text: 'La próxima gestión está vencida hace 4 días.' }];
const redundantHtml = renderReactComponent(VigiaCopilotProposal, { brief: { ...brief, strategy: redundantAlerts[0].risk_text }, draft, alerts: redundantAlerts, onDraftChange: noop, onCopy: noop, onDiscard: noop, onRegenerate: noop });
assert.equal(redundantHtml.includes('vigia-copilot-next-step'), false, 'sin recomendación distinta, no hay "Siguiente paso"');
assert.ok(redundantHtml.includes('vigia-copilot-draft') && redundantHtml.includes('vigia-copilot-context'), 'el resto de la propuesta sigue visible aunque se abstenga el siguiente paso');

// AGT-003 hotfix (se conserva): un "Siguiente paso" largo se renderiza completo, sin elipsis.
const longStrategy = ('Confirme con el cliente la fecha exacta de ' + 'la reunión de seguimiento propuesta sigue pendiente de confirmación final '.repeat(4)).trim();
const longHtml = renderReactComponent(VigiaCopilotProposal, { brief: { ...brief, strategy: longStrategy }, draft, alerts: [], onDraftChange: noop, onCopy: noop, onDiscard: noop, onRegenerate: noop });
assert.ok(longStrategy.length > 240, 'el texto de prueba debe superar el antiguo límite de 240 caracteres');
const longNextStepMatch = /<div class="vigia-copilot-next-step">([\s\S]*?)<\/div>/.exec(longHtml);
assert.ok(longNextStepMatch, 'el bloque "Siguiente paso" debe existir para una recomendación genuina');
assert.ok(longNextStepMatch[1].includes(longStrategy), 'el paso sugerido largo se renderiza íntegro');
assert.equal(longNextStepMatch[1].includes('…'), false, 'el bloque no contiene ninguna elipsis de truncado');

console.log('AGT-003 copilot proposal render checks passed');
```

- [ ] En `tests/vigia-opportunity-copilot-ui-static.test.mjs`:
   - En el bloque de marcadores requeridos (líneas 8-22), quitar `'Plan de contacto'` (línea 11) y `'Actualizar borrador'` (línea 19); agregar `'Actualizar propuesta'` y `'onRegenerate'`.
   - En el bloque de marcadores prohibidos (líneas 24-32), agregar `'Plan de contacto'`, `'Actualizar borrador'`, `'Ver contexto analizado'`, `'Siguiente paso sugerido'`, `'Borrador editable'`.
   - Reemplazar el bloque de marcadores CSS (líneas 49-53):
     ```js
     for (const marker of [
       '.vigia-opportunity-copilot', '.vigia-copilot-draft', '.vigia-copilot-actions',
       '.vigia-preflight-alerts', '.vigia-copilot-generate', '.vigia-copilot-error',
     ]) assert.ok(css.includes(marker), `styles missing Vig-IA panel marker: ${marker}`);
     ```
     por:
     ```js
     for (const marker of [
       '.vigia-opportunity-copilot', '.vigia-copilot-draft', '.vigia-copilot-actions',
       '.vigia-preflight-alerts', '.vigia-copilot-generate', '.vigia-copilot-error',
       '.vigia-copilot-proposal-header', '.vigia-copilot-brief', '.vigia-copilot-next-step',
       '.vigia-copilot-confidence', '.vigia-copilot-context>summary',
     ]) assert.ok(css.includes(marker), `styles missing Vig-IA panel marker: ${marker}`);

     for (const removedMarker of ['.vigia-copilot-plan ol', '.vigia-copilot-summary']) {
       assert.ok(!css.includes(removedMarker), `styles.css debe retirar el selector huérfano: ${removedMarker}`);
     }
     ```
   - Reemplazar la aserción de línea 77-81 (`className={ready ? 'secondary' : undefined}`):
     ```js
     // Tras generar un borrador, "Actualizar borrador" pasa a ser visualmente secundario frente a la
     // acción primaria de completar el flujo (Copiar correo).
     assert.match(
       component,
       /<button type="button" className=\{ready \? 'secondary' : undefined\}[^>]*onClick=\{generate\}>/,
       'el botón de generación debe volverse "secondary" una vez que existe un borrador (ready)',
     );
     ```
     por:
     ```js
     // El botón de generación externo sólo existe mientras no hay propuesta lista: una vez generada,
     // el refresco vive en la cabecera de la propuesta ("Actualizar propuesta"), nunca huérfano.
     assert.match(
       component,
       /\{state\.phase !== 'error' && !ready && <div className="vigia-copilot-generate">/,
       'el botón de generación externo sólo debe renderizarse mientras no hay propuesta lista (!ready)',
     );
     assert.equal(
       component.includes("className={ready ? 'secondary' : undefined}"),
       false,
       'el botón de generación externo ya no alterna a "secondary": ese slot deja de existir una vez lista la propuesta',
     );
     assert.match(component, /onRegenerate=\{generate\}/, 'VigiaCopilotProposal debe recibir onRegenerate para refrescar desde su propia cabecera');
     ```
- [ ] `node --test tests/agt003-copilot-proposal-render.test.mjs tests/vigia-opportunity-copilot-ui-static.test.mjs` → falla: `VigiaCopilotProposal` todavía no acepta `onRegenerate`, sigue enfocando por script un `<h4>`, no renderiza `.vigia-copilot-proposal-header`/`.vigia-copilot-brief`/`.vigia-copilot-next-step`, y el botón de generación externo todavía lleva `className={ready ? 'secondary' : undefined}`.

### GREEN

- [ ] En `src/vigia/VigiaOpportunityCopilot.tsx`:
   - Agregar `onRegenerate: () => void;` al tipo `ProposalProps` (tras `alerts`, línea 31).
   - Reemplazar `VigiaCopilotProposal` completo (líneas 53-81) por:
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
   - En `VigiaOpportunityCopilot`, cambiar el bloque de generación externo (líneas 123-125):
     ```tsx
     {state.phase !== 'error' && <div className="vigia-copilot-generate">
       <button type="button" className={ready ? 'secondary' : undefined} disabled={state.phase === 'loading'} onClick={generate}>{ready ? 'Actualizar borrador' : 'Preparar próximo seguimiento'}</button>
     </div>}
     ```
     por:
     ```tsx
     {state.phase !== 'error' && !ready && <div className="vigia-copilot-generate">
       <button type="button" disabled={state.phase === 'loading'} onClick={generate}>Preparar próximo seguimiento</button>
     </div>}
     ```
   - Agregar `onRegenerate={generate}` a la invocación de `<VigiaCopilotProposal ... />` (junto a `onDiscard`, línea 139).
- [ ] En `src/styles.css`, dentro del bloque "Vig-IA Comercial — copiloto en detalle de oportunidad":
   - Eliminar las líneas:
     ```css
     .vigia-copilot-plan ol{margin:0;padding-left:20px;display:grid;gap:6px}
     .vigia-copilot-summary{display:grid;gap:6px;margin-bottom:8px}
     .vigia-copilot-summary h4{margin:0;color:#124174}
     .vigia-copilot-summary .vigia-copilot-why{margin:0;padding-left:20px;display:grid;gap:4px;font-size:13px;color:#374151}
     ```
   - Insertar en su lugar:
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
- [ ] `node --test tests/agt003-copilot-proposal-render.test.mjs tests/vigia-opportunity-copilot-ui-static.test.mjs` → verde.
- [ ] `npx tsc --noEmit` → verde.

### Criterio observable de cierre del GREEN

`git diff --stat` muestra `src/vigia/VigiaOpportunityCopilot.tsx`, `src/styles.css`, `tests/agt003-copilot-proposal-render.test.mjs`, `tests/vigia-opportunity-copilot-ui-static.test.mjs`. `grep -n "tabIndex" src/vigia/VigiaOpportunityCopilot.tsx` no devuelve resultados.

### Commit del GREEN

```bash
git add src/vigia/VigiaOpportunityCopilot.tsx src/styles.css tests/agt003-copilot-proposal-render.test.mjs tests/vigia-opportunity-copilot-ui-static.test.mjs
git commit -m "feat(vigia): restructure copilot proposal (Qué pasó/Falta/Objetivo/Siguiente paso) and drop programmatic focus"
```

### Cierre del plan — gates finales, diff de rutas prohibidas, QA responsive, revisión, PR, merge, despliegue

- [ ] **Suite focal completa + gates estáticos**, en este orden, deteniéndose y volviendo a la tarea correspondiente si algo falla:
   ```bash
   node --test tests/agt003-*.test.mjs tests/vigia-*.test.mjs tests/consultant-detail-static.test.mjs
   npx tsc --noEmit
   npm run check:backend-parity
   npm run check:siio-integration
   npm run build
   git diff --check
   ```
   Todos en verde. **No se ejecuta `npm test`/la suite completa del repositorio** (antecedente confirmado de OOM).

- [ ] **Diff de rutas prohibidas:**
   ```bash
   git diff --stat main -- src/tenders server api supabase/migrations contracts/agents/AGT-002
   ```
   Expected: salida vacía. Además:
   ```bash
   git diff --stat main
   ```
   Expected: la lista de archivos coincide exactamente con «Archivos tocados» de este plan (ver sección final) — ningún archivo fuera de `src/vigia/`, `src/main.tsx`, `src/styles.css`, `tests/`.

- [ ] **QA responsive manual**, con `npm run dev` corriendo localmente, en los cuatro anchos de viewport pedidos — **1920px, 1440px, 1024px, 390px** — sobre las cuatro superficies tocadas:
    - `Prioridades Comerciales` (`#/alerts`): confirmar 7 tarjetas en una fila a 1920px, 4+3 a 1440/1024px, 2 columnas si el ancho efectivo del panel cruza el breakpoint de 1100px, y layout horizontal compacto de una columna a 390px con `min-height:44px` visible.
    - Tarjeta de prioridad: dos acciones con estilo completo (primaria azul sólida, secundaria clara), sin claves técnicas/timestamps con hora+zona/montos sin `COP` visibles en ninguna tarjeta de la muestra.
    - "Mi día" personal (`#/consultant`, usuario propio) y gerencial (`#/consultant/<id>`, sesión gerencial): `Qué pasó:`/`Falta:`/`Objetivo:` rotulados en las tres, CTA único `Preparar seguimiento` ≥44px, "Depurar CRM" colapsado.
    - Copiloto de oportunidad, tras generar una propuesta: sin rectángulo de foco visible alrededor de un elemento decorativo tras la generación; `Actualizar propuesta` sólo dentro de la cabecera de la propuesta; orden `Qué pasó`/`Falta`/`Objetivo`/`Siguiente paso`/`Revisión humana`/acciones; `Contexto y evidencia` cerrado con conteo y chevron, sin duplicar resumen/objetivo/plan al expandir.
    Documentar el resultado (capturas o descripción por breakpoint) en la entrega. Si no hay credenciales/sesión disponibles para alguna superficie, no inventar el resultado: reportar el bloqueo exacto en vez de darlo por verificado.

- [ ] **Revisión independiente** (antes de push/PR): invocar el skill `code-review` sobre el diff completo de la rama contra `main`, nivel `high`. Cualquier hallazgo `CONFIRMED` de severidad alta o media debe corregirse (con su propio ciclo RED→GREEN sobre el archivo afectado) antes de continuar al Step 12; hallazgos `PLAUSIBLE` se documentan en la entrega con la decisión tomada.

- [ ] **Escaneo final de alcance, publicar rama y abrir PR:**
    ```bash
    git status --porcelain
    git diff --stat origin/main
    ```
    Confirmar árbol limpio (todo comiteado) y que el diff no toca ninguna ruta prohibida. Luego:
    ```bash
    git push -u origin fix/agt003-consolidated-visual-qa-20260902
    gh pr create --base main --head fix/agt003-consolidated-visual-qa-20260902 \
      --title "fix(vigia): consolidated visual QA — priorities density, card evidence, Mi día labels, copilot restructure" \
      --body "Implementa docs/superpowers/specs/2026-09-02-agt003-consolidated-visual-qa-design.md. Sólo frontend (src/vigia/**, src/main.tsx, src/styles.css); sin cambios de backend/contratos/AGT-002."
    ```

- [ ] **Esperar checks:** `gh pr checks --watch` — si algún check falla, corregir en la rama y repetir el Step 8 antes de continuar.

- [ ] **Merge y actualización local:**
    ```bash
    gh pr merge --merge
    git switch main
    git pull --ff-only origin main
    ```

- [ ] **Desplegar producción:** `vercel --prod --yes` — Expected: deployment `Ready` en el alias de producción. Registrar el deployment ID (rollback: revertir el commit/PR restaura el estado visual anterior sin acción de backend, ya que este corte es frontend-only).

- [ ] **Verificación de strings del bundle en producción:**
    ```bash
    BASE=<alias-de-producción>
    ASSETS=$(curl -s $BASE/ | grep -o '/assets/index-[A-Za-z0-9_-]*\.\(js\|css\)')
    for A in $ASSETS; do
      echo "== $A"
      curl -s "$BASE$A" | grep -o 'Actualizar propuesta\|Contexto y evidencia\|Información no verificada\|Prioridades de hoy de\|Qué pasó\|Actualizar borrador\|Ver contexto analizado\|Siguiente paso sugerido\|Plan de contacto' | sort -u
    done
    ```
    Expected: el bundle contiene «Actualizar propuesta», «Contexto y evidencia», «Información no verificada», «Prioridades de hoy de», «Qué pasó», y **no** contiene «Actualizar borrador», «Ver contexto analizado», «Siguiente paso sugerido», «Plan de contacto».

- [ ] **QA visual autenticado (Juan):** con sesión real, abrir `#/alerts`, una tarjeta de prioridad, `#/consultant` (personal y gerencial) y una oportunidad con el copiloto generado, en los cuatro breakpoints del Step 10. Si no hay credenciales/sesión disponibles, no marcar como aprobado: entregar PR/merge/deploy/bundle verificables y describir el bloqueo exacto, sin inventar el resultado.

## Cobertura de los 12 criterios de aceptación (autorrevisión)

| # | Criterio (resumen) | Cubierto por |
|---|---|---|
| 1 | Densidad de Prioridades Comerciales (7/4+3/2/1 según ancho, 44px en móvil) | Tarea 1 |
| 2 | Dos acciones de tarjeta con estilo completo, ≥44px, apiladas en móvil | Tarea 1 |
| 3 | Sin claves técnicas crudas; Bogotá; `$X COP` | Tarea 1 |
| 4 | "Mi día" rotulado en las tres ubicaciones (personal + gerencial) | Tarea 1 (rótulo) + Tarea 2 (rótulo + gerencial) |
| 5 | Banner gerencial "Prioridades de hoy de {ownerName}", tercera persona, mismo `buildMyDayQueue` | Tarea 2 |
| 6 | Copiloto sin foco programático decorativo, controles reales conservan `:focus-visible` | Tarea 4 |
| 7 | "Actualizar propuesta" sólo en la cabecera de la propuesta generada | Tarea 4 |
| 8 | Orden Qué pasó/Falta/Objetivo/Siguiente paso; Revisión humana antes de acciones; sin nuevas acciones de envío | Tarea 3 (datos) + Tarea 4 (estructura) |
| 9 | "Contexto y evidencia" cerrado, con conteo/chevron, sin duplicar resumen/objetivo/plan | Tarea 4 |
| 10 | Ninguna clave técnica expuesta en la UI tocada | Tareas 1, 3 y 4 (todas reutilizan `isTechnicalCopilotText`/`humanizeVigiaText` ya existentes o nuevos) |
| 11 | Fechas ISO+zona y montos `COP` reformateados; texto no reconocido intacto; `missing_information` nunca promovido a hechos | Tarea 1 (sanitizador) + Tarea 3 (reclasificación) |
| 12 | Suite focal + tsc + backend-parity + siio-integration + build + git diff --check en verde, sin correr la suite completa | Cierre de cada tarea + Step 8 de la Tarea 4 |

Ningún gap detectado en la autorrevisión: los 12 criterios tienen al menos una tarea que los implementa y al menos un test que los verifica.

## Archivos tocados (lista final esperada)

- `src/vigia/text-sanitizer.ts` — nuevo (Tarea 1)
- `src/vigia/VigiaCommercial.tsx` (Tarea 1)
- `src/vigia/copilot-presentation.ts` (Tarea 3)
- `src/vigia/VigiaOpportunityCopilot.tsx` (Tarea 4)
- `src/main.tsx` (Tarea 2)
- `src/styles.css` (Tareas 1, 2 y 4)
- `tests/agt003-consolidated-visual-qa-static.test.mjs` — nuevo (Tarea 1)
- `tests/consultant-detail-static.test.mjs` (Tarea 2)
- `tests/agt003-copilot-presentation.test.mjs` (Tarea 3)
- `tests/agt003-copilot-proposal-render.test.mjs` (Tarea 4)
- `tests/vigia-opportunity-copilot-ui-static.test.mjs` (Tarea 4)

Ningún archivo de `api/`, `server/`, `contracts/agents/`, `supabase/migrations/`, `src/tenders/`, `vigia-engine.js`, `src/vigia/my-day-presentation.ts`, `src/vigia/opportunity-copilot-state.ts`, ni de AGT-002.

## Fuera de este plan

- QA visual autenticado formal de Juan: el Step 17 lo intenta con sesión real, pero si no hay credenciales disponibles, queda pendiente y documentado como bloqueo — no se marca como aprobado por este plan.
- Cualquier cambio a `vigia-engine.js`, al contrato `/api/vigia/priorities`/`/api/vigia/copilot/generate`, o a `src/vigia/my-day-presentation.ts`: fuera de alcance, documentado como No objetivo en el diseño base.
- Reescritura semántica de `facts`/`inferences`/`missing_information` con NLP o un modelo adicional: explícitamente rechazada por el diseño (riesgo de alucinación); este plan sólo aplica saneamiento de patrones de alta confianza y clasificación visual de incertidumbre.
