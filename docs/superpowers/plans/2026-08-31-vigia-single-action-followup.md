# Vig-IA: seguimiento de oportunidad en una sola acción — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Colapsar `VigiaOpportunityCopilot` de un flujo híbrido de cuatro pasos (alertas → preanálisis IA → casilla de reconocimiento → generar) a un único CTA que llama directamente a `POST /api/vigia/copilot/generate`, con resumen compacto («Siguiente paso sugerido»/«Por qué») al éxito y error no bloqueante con «Reintentar». El backend de `/preflight` se preserva byte a byte.

**Architecture:** `copilot-presentation.ts` gana el adaptador puro `presentCompactCopilotSummary`. `VigiaOpportunityCopilot.tsx` pierde el estado/efectos de preflight y `VigiaPreflightAnalysis`; expone un único control de generación por fase. `VigiaCopilotProposal` renderiza el bloque compacto y mueve «Plan de contacto» dentro de `<details>«Ver contexto analizado»`. `opportunity-preflight-presentation.ts` se simplifica; `opportunity-preflight-state.ts` se borra. `main.tsx` deja de pasar `contextVersion`. Las pruebas de click/foco usan un helper nuevo con DOM real (`jsdom` + `react-dom/client`), porque `renderToStaticMarkup` no ejecuta `onClick` ni `useEffect`.

**Tech Stack:** React 19 + TypeScript + Vite, esbuild, `node --test`, `jsdom` (devDependency nueva), Vercel.

**Spec:** `docs/superpowers/specs/2026-08-31-vigia-single-action-followup-design.md` (sustituye el flujo activo de frontend de `docs/superpowers/specs/2026-08-26-agt003-preflight-alerts-design.md`).

**Rama de trabajo:** `feat/vigia-single-action-followup`, creada a partir de la rama actual `design/vigia-single-action-followup-20260831` una vez comiteado este plan; esa rama de diseño ya incluye la spec, este plan y la base de `main` reconciliada, así que la rama de implementación parte de ese punto y no directamente de `main`.

## Global Constraints

- Sólo frontend: `src/vigia/*`, `src/main.tsx` (único call-site), `src/styles.css`, `tests/*`, `package.json`/`package-lock.json` (sólo para `jsdom`).
- **Prohibido tocar:** `api/`, `server/`, `contracts/agents/AGT-002/`, `contracts/agents/AGT-003/`, `supabase/migrations/`, `access-control.js`, los cinco `agt003-preflight-*.js` de raíz, y cualquier proveedor/modelo/prompt/política de `generate` o del preflight backend.
- Las alertas comerciales deterministas son advisorias y nunca bloquean `generate`; no cambia en ninguna tarea.
- Sin escritura automática de CRM; el borrador es local, editable, y sólo se copia por acción explícita.
- Push, PR, merge y despliegue sólo en la Tarea 5. El usuario ya autorizó explícitamente estos cambios en la conversación previa, así que forman parte del alcance solicitado de esta implementación; siguen condicionados a que la suite, la revisión de código y los checks de CI estén en verde antes de cada paso irreversible (merge y despliegue).

---

### Task 1: Adaptador compacto puro (`presentCompactCopilotSummary`)

**Files:** Modify `src/vigia/copilot-presentation.ts`; Modify `tests/agt003-copilot-presentation.test.mjs`.

**Interfaces:**
- Produces: `export type CompactCopilotSummary = { nextStep: string | null; whyBullets: string[] }` y `export function presentCompactCopilotSummary(presented: PresentedCopilotBrief, activeAlerts: CommercialAlert[]): CompactCopilotSummary`.
- Consumes: `PresentedCopilotBrief` (sin cambios) y `CommercialAlert` (`import type { CommercialAlert } from './opportunity-preflight-presentation'`, forma actual, sin tocar hasta la Tarea 4).
- Pura: no muta argumentos; no hace red; no lanza.

**Resuelto:** la spec agrupa sus tres condiciones de abstención como omisión total en la prosa descriptiva, pero el criterio de aceptación TDD #7 —explícito y más específico— gobierna el contrato: con `facts`/`inferences` vacíos, `whyBullets` es `[]` **aunque `nextStep` no sea `null`**. Se implementa el contrato operativo del criterio #7: condiciones 1-2 (texto redundante con una alerta activa, o igual a `COMMERCIAL_TEXT_FALLBACKS.strategy`) anulan `nextStep`; la condición 3 (sin hechos/inferencias) sólo vacía `whyBullets`, de forma independiente. Esta lectura queda resuelta por el criterio de aceptación ya aprobado; no requiere confirmación adicional de producto.

- [ ] **Step 1: Write the failing test**

Añadir al final de `tests/agt003-copilot-presentation.test.mjs`, antes del `console.log`, incluyendo `presentCompactCopilotSummary` en el destructure del import dinámico:

```js
const distinctPresented = Object.freeze({
  summary: 'Resumen', contactObjective: 'Objetivo',
  contactPlanSteps: Object.freeze(['Proponga una reunión de 20 minutos con el decisor financiero.']),
  facts: Object.freeze([{ text: 'El valor registrado es COP 125.000.000.', evidence_refs: [] }]),
  inferences: Object.freeze([{ text: 'El cliente sigue evaluando alternativas.', evidence_refs: [], confidence: 'medium' }]),
  recommendedAssetIds: [], hasApprovedAssets: false,
});
const baseAlerts = Object.freeze([{ key: 'next_action:overdue', category: 'next_action', risk_text: 'La próxima gestión está vencida hace 4 días.' }]);
const snap = [JSON.stringify(distinctPresented), JSON.stringify(baseAlerts)];
const compact = presentCompactCopilotSummary(distinctPresented, baseAlerts);
assert.equal(compact.nextStep, distinctPresented.contactPlanSteps[0]);
assert.deepEqual(compact.whyBullets, ['El valor registrado es COP 125.000.000.', 'El cliente sigue evaluando alternativas.']);
assert.deepEqual([JSON.stringify(distinctPresented), JSON.stringify(baseAlerts)], snap, 'no muta sus argumentos');

const longStep = 'Paso siguiente muy detallado. '.repeat(12).trim();
const longFact = 'Hecho relevante muy extenso repetido. '.repeat(8).trim();
const truncated = presentCompactCopilotSummary({ ...distinctPresented, contactPlanSteps: [longStep], facts: [{ text: longFact, evidence_refs: [] }], inferences: [] }, []);
assert.ok(longStep.length > 240 && truncated.nextStep.length <= 240);
assert.ok(longFact.length > 180 && truncated.whyBullets.every(b => b.length <= 180));

for (const [label, override, alerts] of [
  ['repite una alerta activa', { contactPlanSteps: ['  LA PRÓXIMA GESTIÓN   está vencida HACE 4 días.  '] }, baseAlerts],
  ['iguala el resguardo de estrategia', { contactPlanSteps: [COMMERCIAL_TEXT_FALLBACKS.strategy] }, []],
]) assert.deepEqual(presentCompactCopilotSummary({ ...distinctPresented, ...override }, alerts), { nextStep: null, whyBullets: [] }, label);

const noEvidence = presentCompactCopilotSummary({ ...distinctPresented, facts: [], inferences: [] }, []);
assert.equal(noEvidence.nextStep, distinctPresented.contactPlanSteps[0]);
assert.deepEqual(noEvidence.whyBullets, []);

assert.deepEqual(
  presentCompactCopilotSummary({ summary: '', contactObjective: '', contactPlanSteps: [], facts: [], inferences: [], recommendedAssetIds: [], hasApprovedAssets: false }, []),
  { nextStep: null, whyBullets: [] }, 'brief mínimo nunca lanza',
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agt003-copilot-presentation.test.mjs`
Expected: FAIL — `TypeError: presentCompactCopilotSummary is not a function` (el export aún no existe).

- [ ] **Step 3: Write minimal implementation**

Añadir a `src/vigia/copilot-presentation.ts`:

```ts
import type { CommercialAlert } from './opportunity-preflight-presentation';

const MAX_NEXT_STEP_LENGTH = 240;
const MAX_WHY_BULLET_LENGTH = 180;
const MAX_WHY_BULLETS = 2;

function normalizeForComparison(text: string): string { return text.trim().toLowerCase().replace(/\s+/g, ' '); }
function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

export type CompactCopilotSummary = { nextStep: string | null; whyBullets: string[] };

export function presentCompactCopilotSummary(presented: PresentedCopilotBrief, activeAlerts: CommercialAlert[]): CompactCopilotSummary {
  const candidate = String(presented?.contactPlanSteps?.[0] ?? '').trim();
  const normalizedCandidate = normalizeForComparison(candidate);
  const repeatsAlert = (activeAlerts ?? []).some(a => normalizeForComparison(String(a?.risk_text ?? '')) === normalizedCandidate);
  const isFallback = normalizedCandidate === normalizeForComparison(COMMERCIAL_TEXT_FALLBACKS.strategy);
  const nextStepAbstains = !candidate || repeatsAlert || isFallback;

  const bulletSource = [...(presented?.facts ?? []), ...(presented?.inferences ?? [])]
    .map(entry => String(entry?.text ?? '').trim()).filter(Boolean);
  const whyBullets = bulletSource.slice(0, MAX_WHY_BULLETS).map(t => truncate(t, MAX_WHY_BULLET_LENGTH));

  return { nextStep: nextStepAbstains ? null : truncate(candidate, MAX_NEXT_STEP_LENGTH), whyBullets };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agt003-copilot-presentation.test.mjs` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/vigia/copilot-presentation.ts tests/agt003-copilot-presentation.test.mjs
git commit -m "feat(vigia): add pure compact copilot summary adapter"
```

---

### Task 2: Flujo de una sola acción en `VigiaOpportunityCopilot`

**Files:**
- Modify: `src/vigia/VigiaOpportunityCopilot.tsx`, `tests/vigia-opportunity-copilot-ui-static.test.mjs`, `tests/agt003-preflight-alerts-render.test.mjs`, `package.json`, `package-lock.json`.
- Create: `tests/helpers/render-react-dom.mjs`, `tests/agt003-copilot-single-action-dom.test.mjs`.

**Interfaces:**
- `VigiaOpportunityCopilot` expone un único control de generación por fase (botón «Preparar próximo seguimiento»/«Actualizar borrador» en `idle`/`loading`/`ready`; bloque `.vigia-copilot-error role="alert"` con «Reintentar» en `error`, sin botón primario). Retira `VigiaPreflightAnalysis`, `runPreflight`, `preflightState`, `acknowledgedNoPreflight`.
- `mountWithJsdom(Component, props)` monta con `react-dom/client` sobre DOM real de `jsdom`; devuelve `{ window, container, click(selector), flush(), unmount() }`.

**Por qué `jsdom`:** el arnés existente sólo ofrece `renderToStaticMarkup` (SSR estático), que no ejecuta `onClick` ni `useEffect`; sin un DOM real no se pueden probar clics, el deshabilitado durante `loading`, ni el movimiento de foco de la Tarea 3. `jsdom` queda como devDependency exclusiva de pruebas (ver Restricción de alcance sobre `package.json`), sin cambio de dependencias de producción.

- [ ] **Step 1: Instalar la dependencia de prueba**

```bash
npm install --save-dev jsdom
```

Confirmar en el diff de `package.json` que `jsdom` queda sólo bajo `devDependencies` y que `dependencies` no cambia.

- [ ] **Step 2: Write the failing tests**

Crear `tests/helpers/render-react-dom.mjs`:

```js
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

const GLOBAL_KEYS = ['window', 'document', 'navigator', 'HTMLElement', 'Event', 'MouseEvent', 'CustomEvent'];

export function mountWithJsdom(Component, initialProps) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
  const previous = {};
  for (const key of GLOBAL_KEYS) { previous[key] = globalThis[key]; globalThis[key] = dom.window[key]; }
  const previousActEnv = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = dom.window.document.getElementById('root');
  const root = createRoot(container);
  act(() => { root.render(createElement(Component, initialProps)); });
  return {
    window: dom.window, container,
    async click(selector) {
      const el = container.querySelector(selector);
      if (!el) throw new Error(`mountWithJsdom: no element matches "${selector}"`);
      await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    },
    async flush() { await act(async () => { await Promise.resolve(); }); },
    unmount() {
      act(() => root.unmount());
      for (const key of GLOBAL_KEYS) globalThis[key] = previous[key];
      globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnv;
    },
  };
}
```

Crear `tests/agt003-copilot-single-action-dom.test.mjs` (criterios 4, 5, 6). El criterio 10 de la spec (protección ante respuesta obsoleta) ya está cubierto por aserciones reales sobre la máquina de estados en `tests/vigia-opportunity-copilot-state.test.mjs:45-53` (`beginCopilotGeneration`/`completeCopilotGeneration` descartan por `requestId`); no se añade aquí una prueba DOM equivalente porque un test de componente con dos `request()` que resuelven en el orden en que se invocan (secuencial) no reproduce el caso de resolución en orden inverso que exige ese criterio, y presentarlo como tal sería engañoso:

```js
import assert from 'node:assert/strict';
import { loadReactComponent } from './helpers/bundle-react-component.mjs';
import { mountWithJsdom } from './helpers/render-react-dom.mjs';

const VigiaOpportunityCopilot = await loadReactComponent('src/vigia/VigiaOpportunityCopilot.tsx', 'VigiaOpportunityCopilot');
const preflight = {
  nextAction: { code: 'overdue', label: 'overdue', detail: 'Vencida hace 4 días', tone: 'critical', className: 'is-critical' },
  expectedClose: { code: 'scheduled', label: 'scheduled', detail: 'En 30 días', tone: 'ok', className: 'is-ok' },
  decisionMaker: { code: 'complete', label: 'complete', detail: 'Contacto verificado', tone: 'ok', className: 'is-ok' },
};
const okResult = subject => ({
  run_id: 'r1', status: 'completed', human_review_required: true,
  output: { brief: { summary: 'Resumen', facts: [], inferences: [], missing_information: [], contact_objective: 'Objetivo',
    strategy: 'Confirme la fecha de la próxima reunión con el cliente.', draft: { subject, body: 'Cuerpo' },
    recommended_asset_ids: [], warnings: [], human_review_required: true } },
});

{ // Criterio 4: un click invoca generate una vez, sólo /generate; se deshabilita mientras carga.
  const calls = []; let resolveGenerate;
  const request = url => { calls.push(url); return new Promise(r => { resolveGenerate = () => r(okResult('Asunto')); }); };
  const view = mountWithJsdom(VigiaOpportunityCopilot, { opportunityId: 'op-1', request, preflight, contextVersion: 'v1' });
  await view.click('.vigia-copilot-generate button');
  assert.deepEqual(calls, ['/api/vigia/copilot/generate']);
  assert.ok(view.container.querySelector('.vigia-copilot-generate button[disabled]'));
  assert.match(view.container.querySelector('[role="status"]').textContent, /está preparando un borrador acotado/);
  resolveGenerate(); await view.flush(); view.unmount();
}

{ // Criterio 5/6: alertas persisten en error; error compacto, no bloqueante, único control.
  const request = () => Promise.reject(new Error('bridge unavailable'));
  const view = mountWithJsdom(VigiaOpportunityCopilot, { opportunityId: 'op-2', request, preflight, contextVersion: 'v1' });
  const alertsBefore = view.container.querySelector('.vigia-preflight-alerts').textContent;
  await view.click('.vigia-copilot-generate button'); await view.flush();
  assert.equal(view.container.querySelector('.vigia-preflight-alerts').textContent, alertsBefore);
  assert.equal(view.container.querySelector('.vigia-copilot-generate'), null, 'sin botón primario en error');
  assert.equal(view.container.querySelector('input[type="checkbox"]'), null);
  assert.equal(view.container.querySelector('.error'), null, 'no usa la clase genérica .error');
  const errorBlock = view.container.querySelector('.vigia-copilot-error');
  assert.equal(errorBlock.getAttribute('role'), 'alert');
  assert.match(errorBlock.textContent, /No se pudo preparar el seguimiento\. Puede continuar registrándolo manualmente\./);
  assert.equal(errorBlock.querySelectorAll('button').length, 1);
  assert.equal(view.container.querySelector('.vigia-copilot-result'), null, 'sin propuesta sintética');
  view.unmount();
}

console.log('AGT-003 single-action DOM behavior checks passed');
```

En `tests/vigia-opportunity-copilot-ui-static.test.mjs`: en el arreglo `marker` requerido, quitar `'Análisis inteligente del seguimiento'`, `'Analizar cómo fortalecer el seguimiento'`, `'Generar propuesta con el contexto actual'`, `'Entiendo que no se ejecutó...'`, `'/api/vigia/copilot/preflight'`, `'mergeCommercialAlertsWithPreflight'`, `'createOpportunityPreflightState'`, `'invalidateStalePreflight'`, `'beginPreflightAnalysis'`, `'completePreflightAnalysis'`, `'failPreflightAnalysis'`, `"preflightState.phase !== 'loading'"`, `'export function VigiaPreflightAnalysis('`; añadir `'Preparar próximo seguimiento'`, `'Actualizar borrador'`, `'No se pudo preparar el seguimiento. Puede continuar registrándolo manualmente.'`, `'vigia-copilot-error'`. En `forbidden`, añadir los siete strings prohibidos de la spec (criterio 1). Cambiar el chequeo de orden del DOM a `header < alerts < generate` (sin `analysis`). Añadir el grep de directorio (criterio 3):

```js
import { readdirSync } from 'node:fs';
for (const file of readdirSync(new URL('../src/vigia/', import.meta.url)).filter(f => /\.tsx?$/.test(f))) {
  assert.equal(readFileSync(new URL(`../src/vigia/${file}`, import.meta.url), 'utf8').includes('/api/vigia/copilot/preflight'), false, `${file} no debe llamar a /preflight`);
}
```

Reescribir `tests/agt003-preflight-alerts-render.test.mjs`: quitar el import/uso de `VigiaPreflightAnalysis` y las aserciones de `Sugerencia contextual:`/`contextualAction`; conservar sólo los dos casos de `VigiaCommercialAlerts` (vacío y con alertas) con fixtures `{ key, category, risk_text }`.

- [ ] **Step 3: Run tests to verify they fail**

```bash
node --test tests/agt003-copilot-single-action-dom.test.mjs tests/vigia-opportunity-copilot-ui-static.test.mjs tests/agt003-preflight-alerts-render.test.mjs
```

Expected: FAIL — el componente aún tiene `VigiaPreflightAnalysis`, la casilla, el botón viejo y llama a `/preflight`.

- [ ] **Step 4: Write minimal implementation**

Editar `src/vigia/VigiaOpportunityCopilot.tsx`:
1. Quitar el import de `./opportunity-preflight-state` completo y, del import de `./opportunity-preflight-presentation`, quitar `mergeCommercialAlertsWithPreflight`, `normalizePreflightErrorMessage`, `ConsolidatedPreflightAction`.
2. En `VigiaCommercialAlerts`, quitar `{alert.contextualAction && <p className="vigia-preflight-context">...}` del `<li>`.
3. Borrar por completo `type PreflightAnalysisProps` y la función `VigiaPreflightAnalysis`.
4. En `VigiaOpportunityCopilot`, quitar `preflightState`, `acknowledgedNoPreflight`, `preflightRequestSequenceRef`, `currentContextVersionRef`, los dos `useEffect` de preflight y `runPreflight`; sustituir `merged`/`canGenerate` por `const alerts = buildCommercialAlerts(preflight);`; reemplazar el `<div className="vigia-copilot-generate">` + `<VigiaPreflightAnalysis .../>` + los tres bloques de fase por:

```tsx
{state.phase !== 'error' && <div className="vigia-copilot-generate">
  <button type="button" disabled={state.phase === 'loading'} onClick={generate}>{ready ? 'Actualizar borrador' : 'Preparar próximo seguimiento'}</button>
</div>}
{state.phase === 'idle' && <div className="vigia-copilot-empty"><p className="muted">Prepara un borrador editable de seguimiento, separado del registro original.</p></div>}
{state.phase === 'loading' && <div className="notice" role="status">{VIGIA_VISIBLE_NAMES.commercial} está preparando un borrador acotado…</div>}
{state.phase === 'error' && <div className="vigia-copilot-error" role="alert">
  <span>No se pudo preparar el seguimiento. Puede continuar registrándolo manualmente.</span>
  <button type="button" className="secondary" onClick={generate}>Reintentar</button>
</div>}
```

5. Cambiar `<VigiaCommercialAlerts alerts={merged.alerts} />` a `<VigiaCommercialAlerts alerts={alerts} />`. `VigiaCopilotProposal` no se toca en esta tarea (Tarea 3 la reescribe); `state.error` deja de llamar `normalizeCopilotErrorMessage` (mensaje fijo). Quitar el import de `normalizeCopilotErrorMessage` si queda sin uso.

- [ ] **Step 5: Run tests to verify they pass**

```bash
node --test tests/agt003-copilot-single-action-dom.test.mjs tests/vigia-opportunity-copilot-ui-static.test.mjs \
  tests/agt003-preflight-alerts-render.test.mjs tests/vigia-opportunity-copilot-state.test.mjs tests/vigia-opportunity-copilot-followup-copy.test.mjs
npx tsc --noEmit
```

Expected: PASS en los cinco; `tsc` exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/vigia/VigiaOpportunityCopilot.tsx tests/vigia-opportunity-copilot-ui-static.test.mjs \
  tests/agt003-preflight-alerts-render.test.mjs tests/helpers/render-react-dom.mjs \
  tests/agt003-copilot-single-action-dom.test.mjs package.json package-lock.json
git commit -m "feat(vigia): collapse copilot panel to a single generation action"
```

---

### Task 3: UI de `ready` — resumen compacto, «Ver contexto analizado», foco y CSS

**Files:**
- Modify: `src/vigia/VigiaOpportunityCopilot.tsx` (sólo `VigiaCopilotProposal`), `src/styles.css`, `tests/agt003-copilot-proposal-render.test.mjs`, `tests/vigia-opportunity-copilot-ui-static.test.mjs`.
- Create: `tests/agt003-copilot-single-action-focus.test.mjs`.

**Interfaces:** `ProposalProps` gana `alerts: CommercialAlert[]`. `VigiaCopilotProposal` consume `presentCompactCopilotSummary` (Tarea 1); mueve `contactPlanSteps` dentro de `<details className="vigia-copilot-context"><summary>Ver contexto analizado</summary>`. Foco: el padre renderiza `<VigiaCopilotProposal key={ready.requestId} .../>`, así cada resultado nuevo remonta el componente y su `useEffect([])` dispara una vez por transición a `ready`.

- [ ] **Step 1: Write the failing tests**

En `tests/agt003-copilot-proposal-render.test.mjs`: añadir `alerts: []` a las llamadas existentes de `renderReactComponent(VigiaCopilotProposal, {...})`; mover la aserción del plan dentro de `detailsMatch[1]`; renombrar `'Contexto analizado'` a `'Ver contexto analizado'`; añadir:

```js
// Criterio 8/9: el resumen compacto se abstiene si repite una alerta activa; el plan sólo vive en <details>.
const redundantAlerts = [{ key: 'next_action:overdue', category: 'next_action', risk_text: 'La próxima gestión está vencida hace 4 días.' }];
const redundantHtml = renderReactComponent(VigiaCopilotProposal, { brief: { ...brief, strategy: redundantAlerts[0].risk_text }, draft, alerts: redundantAlerts, onDraftChange: noop, onCopy: noop, onDiscard: noop });
assert.equal(redundantHtml.includes('vigia-copilot-summary'), false, 'sin recomendación distinta, no hay bloque compacto');
assert.ok(redundantHtml.includes('vigia-copilot-draft') && redundantHtml.includes('vigia-copilot-context'));

const genuineHtml = renderReactComponent(VigiaCopilotProposal, { brief, draft, alerts: [], onDraftChange: noop, onCopy: noop, onDiscard: noop });
assert.match(genuineHtml, /<h4[^>]*>Siguiente paso sugerido<\/h4>/);
assert.ok(genuineHtml.includes('vigia-copilot-why'));
assert.equal(genuineHtml.slice(0, genuineHtml.indexOf('<details')).includes('vigia-copilot-plan'), false, '"Plan de contacto" no vive fuera de "Ver contexto analizado"');
const genuineDetails = /<details class="vigia-copilot-context">([\s\S]*?)<\/details>/.exec(genuineHtml)[1];
assert.ok(genuineDetails.includes('vigia-copilot-plan'));
assert.match(genuineDetails, /<summary[^>]*>Ver contexto analizado<\/summary>/);
```

Crear `tests/agt003-copilot-single-action-focus.test.mjs` (criterio 11):

```js
import assert from 'node:assert/strict';
import { loadReactComponent } from './helpers/bundle-react-component.mjs';
import { mountWithJsdom } from './helpers/render-react-dom.mjs';

const VigiaOpportunityCopilot = await loadReactComponent('src/vigia/VigiaOpportunityCopilot.tsx', 'VigiaOpportunityCopilot');
const preflight = {
  nextAction: { code: 'scheduled', label: 'scheduled', detail: 'En 10 días', tone: 'ok', className: 'is-ok' },
  expectedClose: { code: 'scheduled', label: 'scheduled', detail: 'En 30 días', tone: 'ok', className: 'is-ok' },
  decisionMaker: { code: 'complete', label: 'complete', detail: 'Contacto verificado', tone: 'ok', className: 'is-ok' },
};
const brief = {
  summary: 'Resumen', facts: [{ text: 'Hecho relevante.', evidence_refs: [] }], inferences: [], missing_information: [],
  contact_objective: 'Objetivo', strategy: 'Proponga una reunión de seguimiento con el cliente.',
  draft: { subject: 'Asunto', body: 'Cuerpo' }, recommended_asset_ids: [], warnings: [], human_review_required: true,
};
const request = () => Promise.resolve({ run_id: 'r1', status: 'completed', human_review_required: true, output: { brief } });

const view = mountWithJsdom(VigiaOpportunityCopilot, { opportunityId: 'op-1', request, preflight, contextVersion: 'v1' });
assert.equal(view.container.querySelector('[role="status"]'), null);
await view.click('.vigia-copilot-generate button');
assert.match(view.container.querySelector('[role="status"]').textContent, /está preparando un borrador acotado/);
await view.flush();
const heading = view.window.document.activeElement;
assert.notEqual(heading, view.window.document.body, 'el foco se movió fuera del <body>');
assert.match(heading.textContent, /Siguiente paso sugerido/);
view.unmount();

console.log('AGT-003 single-action focus/a11y checks passed');
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/agt003-copilot-proposal-render.test.mjs tests/agt003-copilot-single-action-focus.test.mjs
```

Expected: FAIL — `VigiaCopilotProposal` no acepta `alerts`, no tiene `vigia-copilot-summary`, y sigue diciendo «Contexto analizado»; el foco nunca se mueve.

- [ ] **Step 3: Write minimal implementation**

Editar `VigiaCopilotProposal` en `VigiaOpportunityCopilot.tsx`:
1. `ProposalProps` gana `alerts: CommercialAlert[]`; importar `presentCompactCopilotSummary` desde `./copilot-presentation`.
2. Al inicio de la función, calcular `const compact = presentCompactCopilotSummary(presented, alerts);` y declarar `const resultRef = useRef<HTMLDivElement>(null); const headingRef = useRef<HTMLHeadingElement>(null); useEffect(() => { (headingRef.current ?? resultRef.current)?.focus(); }, []);`.
3. El `<div className="vigia-copilot-result">` raíz gana `ref={resultRef} tabIndex={-1}`.
4. Insertar como primer hijo, antes de `vigia-copilot-draft`:

```tsx
{compact.nextStep && <section className="vigia-copilot-summary">
  <h4 ref={headingRef} tabIndex={-1}>Siguiente paso sugerido</h4>
  <p>{compact.nextStep}</p>
  {compact.whyBullets.length > 0 && <ul className="vigia-copilot-why">{compact.whyBullets.map((bullet, index) => <li key={`${index}-${bullet}`}>{bullet}</li>)}</ul>}
</section>}
```

5. Sacar `<section className="vigia-copilot-plan">...</section>` de fuera de `<details>` (sin cambiar su contenido) y moverlo como primer hijo dentro de `<details className="vigia-copilot-context">`, antes de `<p>{presented.summary}</p>`.
6. Renombrar `<summary>Contexto analizado</summary>` a `<summary>Ver contexto analizado</summary>`.
7. En `VigiaOpportunityCopilot`, cambiar la llamada a `<VigiaCopilotProposal key={ready.requestId} brief={brief} draft={ready.draft} alerts={alerts} onDraftChange={...} onCopy={...} onDiscard={...} />`.

En `src/styles.css`: eliminar `.vigia-preflight-analysis`, `.vigia-preflight-analysis h4`, `.vigia-preflight-standalone`, `.vigia-preflight-ack`; añadir al final del bloque Vig-IA Comercial:

```css
.vigia-copilot-summary{display:grid;gap:6px;margin-bottom:8px}
.vigia-copilot-summary h4{margin:0;color:#124174}
.vigia-copilot-summary .vigia-copilot-why{margin:0;padding-left:20px;display:grid;gap:4px;font-size:13px;color:#374151}
.vigia-copilot-error{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:6px;background:#fffbeb;border:1px solid #fbbf24;color:#78350f;font-size:13px}
.vigia-copilot-error .secondary{margin-left:auto;flex-shrink:0}
```

En `tests/vigia-opportunity-copilot-ui-static.test.mjs`: quitar `.vigia-preflight-analysis`, `.vigia-preflight-standalone`, `.vigia-preflight-ack` de los marcadores CSS requeridos; añadir `.vigia-copilot-summary`, `.vigia-copilot-error`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test tests/agt003-copilot-proposal-render.test.mjs tests/agt003-copilot-single-action-focus.test.mjs tests/vigia-opportunity-copilot-ui-static.test.mjs
npx tsc --noEmit
```

Expected: PASS; `tsc` exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/vigia/VigiaOpportunityCopilot.tsx src/styles.css tests/agt003-copilot-proposal-render.test.mjs \
  tests/vigia-opportunity-copilot-ui-static.test.mjs tests/agt003-copilot-single-action-focus.test.mjs
git commit -m "feat(vigia): compact ready summary, collapse contact plan, focus management"
```

---

### Task 4: Limpieza de frontend muerto y verificación completa

**Files:** Modify `src/vigia/opportunity-preflight-presentation.ts`, `src/main.tsx`, `src/vigia/VigiaOpportunityCopilot.tsx`, `tests/agt003-preflight-alerts-presentation.test.mjs`, `tests/vigia-opportunity-copilot-ui-static.test.mjs`. Delete `src/vigia/opportunity-preflight-state.ts`, `tests/agt003-preflight-state.test.mjs`.

**Interfaces:** `opportunity-preflight-presentation.ts` queda con `CommercialAlertCategory`, `CommercialAlert = { key, category, risk_text }`, `CommercialPreflightInput`, `COMMERCIAL_PREFLIGHT_EXPLANATION`, `buildCommercialAlerts(input): CommercialAlert[]`; se retiran `PreflightAction`, `ConsolidatedPreflightAction`, `PreflightMergeResult`, `KNOWN_PREFLIGHT_ISSUE_CODES`, `consolidatePreflightActions`, `mergeCommercialAlertsWithPreflight`, `normalizePreflightErrorMessage`, `PREFLIGHT_ANALYSIS_UNAVAILABLE_MESSAGE`, `BaseCommercialAlert`. `VigiaOpportunityCopilot` `Props` pierde `contextVersion`; `main.tsx` deja de pasarla.

- [ ] **Step 1: Write failing static assertions (RED) before deleting anything**

En `tests/vigia-opportunity-copilot-ui-static.test.mjs`, añadir `existsSync` al import ya existente de `node:fs` (`import { readFileSync, existsSync } from 'node:fs';`) y, al final del archivo, antes del `console.log`, añadir:

```js
assert.equal(existsSync(new URL('../src/vigia/opportunity-preflight-state.ts', import.meta.url)), false, 'opportunity-preflight-state.ts debe eliminarse');

const preflightPresentation = readFileSync(new URL('../src/vigia/opportunity-preflight-presentation.ts', import.meta.url), 'utf8');
for (const removed of ['PreflightAction', 'ConsolidatedPreflightAction', 'BaseCommercialAlert', 'PreflightMergeResult', 'KNOWN_PREFLIGHT_ISSUE_CODES', 'PREFLIGHT_ANALYSIS_UNAVAILABLE_MESSAGE', 'TECHNICAL_PREFLIGHT_ERROR_PATTERNS', 'normalizePreflightErrorMessage', 'consolidatePreflightActions', 'mergeCommercialAlertsWithPreflight']) {
  assert.equal(preflightPresentation.includes(removed), false, `opportunity-preflight-presentation.ts no debe contener ${removed}`);
}

assert.equal(component.includes('contextVersion'), false, 'VigiaOpportunityCopilot.tsx no debe contener contextVersion');
assert.equal(main.includes('contextVersion'), false, 'main.tsx no debe contener contextVersion');
```

(`component` y `main` ya están definidos al principio del archivo; no redeclarar.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/vigia-opportunity-copilot-ui-static.test.mjs`
Expected: FAIL — `opportunity-preflight-state.ts` todavía existe, `opportunity-preflight-presentation.ts` todavía contiene los símbolos retirados, y `contextVersion` sigue presente tanto en el componente como en `main.tsx`. Esto es un RED real: la prueba falla porque el código muerto que se va a eliminar aún está presente, no una prueba preexistente que ya pasaba.

- [ ] **Step 3: Reescribir el módulo y las pruebas que dependen de lo retirado**

En `src/vigia/opportunity-preflight-presentation.ts`: quitar `PreflightAction`, `ConsolidatedPreflightAction`, `BaseCommercialAlert`, `PreflightMergeResult`, `KNOWN_PREFLIGHT_ISSUE_CODES`, `PREFLIGHT_ANALYSIS_UNAVAILABLE_MESSAGE`, `TECHNICAL_PREFLIGHT_ERROR_PATTERNS`, `normalizePreflightErrorMessage`, `consolidatePreflightActions`, `mergeCommercialAlertsWithPreflight`; simplificar `CommercialAlert` a `{ key, category, risk_text }` y que las tres funciones `*Alert` devuelvan `CommercialAlert | null` directamente; `buildCommercialAlerts` filtra por `CommercialAlert`, no por `BaseCommercialAlert`.

En `tests/agt003-preflight-alerts-presentation.test.mjs`: quitar el destructure y los bloques de prueba de `consolidatePreflightActions`/`mergeCommercialAlertsWithPreflight`/`KNOWN_PREFLIGHT_ISSUE_CODES`; conservar `COMMERCIAL_PREFLIGHT_EXPLANATION` y `buildCommercialAlerts` con sus `assert.deepEqual` existentes (ya usan la forma `{ key, category, risk_text }`, sin `contextualAction`).

Borrar `src/vigia/opportunity-preflight-state.ts` y `tests/agt003-preflight-state.test.mjs`.

En `VigiaOpportunityCopilot.tsx`: quitar `contextVersion` de `type Props` y de la desestructuración del componente.

En `src/main.tsx`: quitar la línea `contextVersion={\`${o.updated_at}|${o.last_interaction_at ?? ''}\`}` del call-site de `<VigiaOpportunityCopilot .../>`.

En `tests/vigia-opportunity-copilot-ui-static.test.mjs`: quitar del arreglo de marcadores de `main` la línea `'contextVersion={\`${o.updated_at}|${o.last_interaction_at ?? \'\'}\`}'`.

- [ ] **Step 4: Run focal tests**

```bash
node --test tests/agt003-preflight-alerts-presentation.test.mjs tests/agt003-preflight-alerts-render.test.mjs \
  tests/agt003-copilot-single-action-dom.test.mjs tests/agt003-copilot-single-action-focus.test.mjs \
  tests/agt003-copilot-proposal-render.test.mjs tests/vigia-opportunity-copilot-ui-static.test.mjs \
  tests/vigia-opportunity-copilot-state.test.mjs tests/vigia-opportunity-copilot-followup-copy.test.mjs \
  tests/agt003-copilot-presentation.test.mjs
node -e "process.exit(require('fs').existsSync('tests/agt003-preflight-state.test.mjs') ? 1 : 0)" && echo 'confirmado: tests/agt003-preflight-state.test.mjs eliminado'
```

Expected: PASS en los nueve (el propio `vigia-opportunity-copilot-ui-static.test.mjs` ya confirma con `existsSync` la ausencia de `opportunity-preflight-state.ts`); el segundo comando confirma con `existsSync`, sin ejecutar, que el archivo de test eliminado ya no existe. La suite completa del Step 5 tampoco lo recogerá.

- [ ] **Step 5: Verificación fresca completa**

```bash
node --test --test-concurrency=1 tests/*.test.mjs
npm run check:siio-integration
npm run check:backend-parity
npx tsc --noEmit
npx vite build
git diff --check
git diff --stat origin/main -- api/ server/ contracts/agents/AGT-002/ contracts/agents/AGT-003/ supabase/migrations/
```

Expected: suite completa PASS (comparar cualquier fallo contra `main` antes de asumirlo de esta rama); `tsc`/`vite build` exit 0; ambos `git diff` sin salida.

- [ ] **Step 6: Claude review and remediation**

Ejecutar `/code-review high` sobre el diff completo. Revisar: ausencia de strings prohibidos, que las alertas nunca bloqueen `generate`, `.vigia-copilot-error` en vez de `.error`, foco sólo en la transición a `ready`, backend de preflight intacto, y que la resolución de la Tarea 1 quede documentada. Corregir hallazgos reales y repetir Steps 4-5 hasta verde.

- [ ] **Step 7: Commit**

```bash
git add src/vigia/opportunity-preflight-presentation.ts src/vigia/VigiaOpportunityCopilot.tsx src/main.tsx \
  tests/agt003-preflight-alerts-presentation.test.mjs tests/vigia-opportunity-copilot-ui-static.test.mjs
git rm src/vigia/opportunity-preflight-state.ts tests/agt003-preflight-state.test.mjs
git commit -m "chore(vigia): remove dead preflight frontend state and merge helpers"
```

---

### Task 5: Escaneo de alcance final, PR, CI, merge y despliegue

**GO:** el usuario ya autorizó explícitamente push/PR/merge/despliegue en la conversación de diseño; no se requiere una nueva confirmación para ejecutar los Steps 2+. Esa autorización no exime de las condiciones de calidad: Step 3 (checks CI) y la revisión de la Tarea 4 Step 6 deben estar en verde antes de Step 4 (merge), y Step 6 (verificación de strings del bundle) debe pasar antes de dar por cerrado el despliegue del Step 5.

- [ ] **Step 1: Escaneo final de alcance**

```bash
git status --porcelain
git diff --stat origin/main
```

Confirmar que ningún archivo fuera de `src/vigia/`, `src/main.tsx`, `src/styles.css`, `tests/`, `package.json`, `package-lock.json`, `docs/superpowers/` aparece en el diff. Si el árbol tiene cambios sin commitear: `git add -A && git commit -m "chore(vigia): finalize single-action follow-up"`.

- [ ] **Step 2: Publicar rama y abrir PR**

```bash
git push -u origin feat/vigia-single-action-followup
gh pr create --base main --head feat/vigia-single-action-followup \
  --title "feat(vigia): single-action opportunity follow-up" \
  --body "Implementa docs/superpowers/specs/2026-08-31-vigia-single-action-followup-design.md. Sólo frontend; backend de /preflight preservado sin tráfico desde la UI."
```

- [ ] **Step 3: Esperar checks**

Run: `gh pr checks --watch` — si algún check falla, corregir en la rama y repetir Steps 4-5 de la Tarea 4.

- [ ] **Step 4: Merge y actualización local**

```bash
gh pr merge --merge
git switch main
git pull --ff-only origin main
```

- [ ] **Step 5: Desplegar producción**

Run: `vercel --prod --yes` — Expected: deployment `Ready` en el alias de producción. Registrar el deployment ID (rollback: revertir el commit/PR restaura el flujo híbrido anterior sin acción de backend).

- [ ] **Step 6: Verificación de strings del bundle**

```bash
BASE=<alias-de-producción>
ASSETS=$(curl -s $BASE/ | grep -o '/assets/index-[A-Za-z0-9_-]*\.\(js\|css\)')
for A in $ASSETS; do echo "== $A"; curl -s "$BASE$A" | grep -o 'Preparar próximo seguimiento\|Actualizar borrador\|Ver contexto analizado\|Siguiente paso sugerido\|No se pudo preparar el seguimiento\|Analizar cómo fortalecer el seguimiento\|Entiendo que no se ejecutó el análisis inteligente' | sort -u; done
```

Expected: el bundle contiene «Preparar próximo seguimiento», «Actualizar borrador», «Ver contexto analizado», «Siguiente paso sugerido», «No se pudo preparar el seguimiento» y **no** contiene «Analizar cómo fortalecer el seguimiento» ni «Entiendo que no se ejecutó el análisis inteligente».

- [ ] **Step 7: QA visual autenticado (Juan)**

Abrir una oportunidad no licitatoria con alertas comerciales activas (sesión real) y confirmar: un único botón de generación visible por fase; un ciclo de fallo real de `generate` muestra el mensaje fijo no bloqueante con «Reintentar», sin casilla ni barra roja; un ciclo de éxito muestra «Siguiente paso sugerido»/«Por qué» (o arranca en el borrador si hay abstención) y «Ver contexto analizado» plegado con el plan completo dentro; las alertas deterministas permanecen visibles y nunca bloquean. Si no hay credenciales/sesión, no inventar el resultado: entregar PR/merge/deploy/bundle verificables y describir el bloqueo exacto.

## Evidencia final requerida

- PR y SHA de merge; checks CI con estado.
- Deployment ID/URL/alias de Vercel.
- Comandos y conteos de la suite completa (Tarea 4, Step 5).
- Resultado del grep de strings del bundle (Tarea 5, Step 6).
- Matriz QA autenticado criterio por criterio (Tarea 5, Step 7), o el bloqueo exacto si no pudo completarse.
- Confirmación de que ningún archivo de `api/`, `server/`, `contracts/agents/AGT-002/`, `contracts/agents/AGT-003/` ni `supabase/migrations/` aparece en el diff.
- Referencia a la resolución de la Tarea 1 (abstención parcial de `whyBullets` vs. total): gobernada por el criterio de aceptación #7 ya aprobado, sin pendientes.
