# Navegación compacta de Ver expediente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reordenar el detalle de oportunidades de licitación para mostrar primero el banner de la oportunidad y reemplazar la navegación vertical/redundante por tabs de módulo compactos y una barra híbrida sticky con sección activa y estados confiables.

**Architecture:** Se extrae una navegación de módulo reutilizable, se introduce un resolver puro de tonos/etiquetas para los seis accesos y se alimenta mediante callbacks tipados desde los paneles que ya cargan documentos, análisis, decisión y preparación. `TenderDetailNavigation` mantiene internamente la sección visible con `IntersectionObserver`; no duplica solicitudes ni requiere backend.

**Tech Stack:** React 19, TypeScript, Vite, CSS, Node.js `assert`, esbuild.

## Global Constraints

- Orden exacto: encabezado global → banner azul → navegación de módulo → barra híbrida → contenido.
- Navegación primaria exacta: `Radar | Seguimiento | Oportunidades`.
- El breadcrumb del expediente se elimina.
- `← Oportunidades` es el único regreso dentro de la barra.
- Azul significa sección visible, no avance.
- Verde, ámbar, rojo y gris solo se asignan con datos estructurados; ante duda se usa gris.
- Una decisión formal GO o NO GO resuelta usa verde; NO GO no es un error.
- La barra permanece sticky y los pasos se desplazan horizontalmente en móvil.
- No añadir endpoint, backend, migración, dependencia ni cambio de permisos.
- No tocar datos reales, desplegar, mergear ni hacer push sin autorización separada.
- TDD: observar RED antes de cada cambio de producción.

---

## Mapa de archivos y responsabilidades

### Archivos nuevos

- `src/tenders/detailNavigationState.ts`: tipos, secciones y resolución pura de tonos/etiquetas.
- `src/tenders/components/TenderModuleNavigation.tsx`: composición reutilizable de tabs y Configuración.
- `tests/tender-detail-navigation-state.test.mjs`: prueba dinámica del resolver de estados.
- `tests/tender-detail-layout-order.test.mjs`: contrato estático del orden banner → navegación.

### Archivos modificados

- `src/tenders/components/TenderDetailNavigation.tsx`: barra híbrida, observer, ARIA y fuente oficial.
- `src/tenders/components/TenderGoNoGoDecisionPanel.tsx`: callback estructurado de carga/decisión.
- `src/tenders/TendersModule.tsx`: reutiliza `TenderModuleNavigation`.
- `src/main.tsx`: reordena banner, monta navegaciones y agrega callbacks de estado.
- `src/styles.css`: layout compacto, tonos, sticky y respuesta móvil.
- `tests/tender-detail-navigation.test.mjs`: nuevo contrato sin breadcrumb y con sección activa.
- `tests/tender-navigation-opportunities.test.mjs`: conserva regresión de tabs principales.

---

### Task 1: Crear el modelo puro de estados del expediente

**Files:**
- Create: `src/tenders/detailNavigationState.ts`
- Create: `tests/tender-detail-navigation-state.test.mjs`

**Interfaces:**
- Produces: `TenderDetailSectionId`, `TenderPanelState<T>`, `TenderDetailStatusSnapshot`, `TenderDetailIndicator`, `TENDER_DETAIL_SECTIONS`, `resolveTenderDetailIndicators(snapshot)`.
- Consumes: `TenderDocumentAnalysis` y `TenderGoNoGoDecision` de `src/tenders/types.ts`.

- [ ] **Step 1: Escribir la prueba roja dinámica**

Crear `tests/tender-detail-navigation-state.test.mjs` usando `buildSync` de esbuild para importar el helper. Debe verificar como mínimo:

```js
assert.equal(resolve(base).summary, undefined);
assert.deepEqual(resolve(withCurrentAnalysis).analysis, { tone: 'ready', label: 'Análisis vigente' });
assert.equal(resolve(withStaleAnalysis).analysis.tone, 'attention');
assert.equal(resolve(withFailedAnalysis).analysis.tone, 'error');
assert.equal(resolve(withNoAnalysis).analysis.tone, 'unknown');
assert.deepEqual(resolve(withGo).decision, { tone: 'ready', label: 'GO autorizado' });
assert.deepEqual(resolve(withNoGo).decision, { tone: 'ready', label: 'NO GO autorizado' });
assert.equal(resolve(withReadyAnalysisButNoDecision).decision.tone, 'attention');
assert.equal(resolve(withPreparationError).preparation.tone, 'error');
assert.equal(resolve(withGoButNoPreparation).preparation.tone, 'attention');
assert.equal(resolve(withOverdueFollowUp).followUp.tone, 'error');
assert.equal(resolve(withTerminalFollowUp).followUp.tone, 'unknown');
```

El bundle debe seguir el patrón existente:

```js
const bundle = buildSync({
  entryPoints: [new URL('../src/tenders/detailNavigationState.ts', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const url = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
const { resolveTenderDetailIndicators } = await import(url);
```

- [ ] **Step 2: Ejecutar RED**

Run:

```bash
node tests/tender-detail-navigation-state.test.mjs
```

Expected: FAIL porque `src/tenders/detailNavigationState.ts` no existe.

- [ ] **Step 3: Implementar tipos y secciones**

Crear el módulo con estas firmas:

```ts
import type { TenderDocumentAnalysis, TenderGoNoGoDecision } from './types';

export type TenderDetailSectionId =
  | 'tender-summary'
  | 'tender-document-review'
  | 'tender-analysis'
  | 'tender-decision'
  | 'tender-preparation'
  | 'tender-follow-up';

export type TenderIndicatorTone = 'ready' | 'attention' | 'error' | 'unknown';
export type TenderPanelState<T> =
  | { phase: 'loading' }
  | { phase: 'ready'; value: T }
  | { phase: 'error'; message: string };

export type TenderDocumentNavigationValue = { currentDocumentCount: number };
export type TenderPreparationNavigationValue = {
  preparationStatus: string | null;
  decision: 'go' | 'no_go' | null;
  humanPendingCount: number;
};
export type TenderFollowUpNavigationValue = {
  code: 'closed' | 'missing' | 'overdue' | 'today' | 'soon' | 'scheduled';
  label: string;
  detail: string;
};

export type TenderDetailStatusSnapshot = {
  documents: TenderPanelState<TenderDocumentNavigationValue>;
  analysis: TenderPanelState<TenderDocumentAnalysis | null>;
  decision: TenderPanelState<TenderGoNoGoDecision | null>;
  preparation: TenderPanelState<TenderPreparationNavigationValue>;
  followUp: TenderFollowUpNavigationValue;
};

export type TenderDetailIndicator = { tone: TenderIndicatorTone; label: string };

export const TENDER_DETAIL_SECTIONS: ReadonlyArray<{
  id: TenderDetailSectionId;
  label: string;
  accessibleLabel: string;
}> = [
  { id: 'tender-summary', label: 'Resumen', accessibleLabel: 'Resumen de la oportunidad' },
  { id: 'tender-document-review', label: 'Documentos', accessibleLabel: 'Revisión documental' },
  { id: 'tender-analysis', label: 'Análisis', accessibleLabel: 'Análisis / preanálisis' },
  { id: 'tender-decision', label: 'Decisión', accessibleLabel: 'Decisión GO / NO GO' },
  { id: 'tender-preparation', label: 'Preparación', accessibleLabel: 'Preparación de oferta' },
  { id: 'tender-follow-up', label: 'Seguimiento', accessibleLabel: 'Seguimiento comercial' },
];

export function resolveTenderDetailIndicators(
  snapshot: TenderDetailStatusSnapshot,
): Partial<Record<TenderDetailSectionId, TenderDetailIndicator>>;
```

Implementar reglas exactas de la especificación. `summary` no devuelve indicador. Un panel `loading` produce `unknown`; un panel `error` produce `error`. Documentos sin registros y sin error producen gris, no ámbar. Preparación existente con pendientes humanos produce ámbar; existente sin pendientes produce verde.

- [ ] **Step 4: Ejecutar GREEN**

```bash
node tests/tender-detail-navigation-state.test.mjs
```

Expected: `tender detail navigation state passed`.

- [ ] **Step 5: Commit local**

```bash
git add src/tenders/detailNavigationState.ts tests/tender-detail-navigation-state.test.mjs
git commit -m "test: define tender detail navigation states"
```

---

### Task 2: Reutilizar una sola navegación compacta del módulo

**Files:**
- Create: `src/tenders/components/TenderModuleNavigation.tsx`
- Create: `tests/tender-detail-layout-order.test.mjs`
- Modify: `src/tenders/TendersModule.tsx`
- Modify: `src/main.tsx:724-777`

**Interfaces:**
- Produces: `TenderModuleNavigation({ active, navigate, currentProfile })`.
- Consumes: `TenderModuleTabs`, `canConfigureTenders`, `TenderModuleView`, `TenderCurrentProfile`.

- [ ] **Step 1: Escribir la prueba roja de composición y orden**

La prueba debe exigir:

```js
assert.match(moduleNavigation, /<TenderModuleTabs/);
assert.match(moduleNavigation, /canConfigureTenders/);
assert.match(moduleSource, /<TenderModuleNavigation/);
assert.match(main, /<TenderModuleNavigation active="oportunidades"/);

const banner = main.indexOf('id="tender-summary"');
const moduleNav = main.indexOf('<TenderModuleNavigation active="oportunidades"');
const detailNav = main.indexOf('<TenderDetailNavigation');
const infoGrid = main.indexOf('<div className="grid three">', banner);
assert.ok(banner >= 0 && banner < moduleNav && moduleNav < detailNav && detailNav < infoGrid);
```

También debe exigir que el banner contenga `className="hero"` antes de `TenderModuleNavigation`.

- [ ] **Step 2: Ejecutar RED**

```bash
node tests/tender-detail-layout-order.test.mjs
```

Expected: FAIL porque `TenderModuleNavigation.tsx` no existe y el detalle monta navegación antes del banner.

- [ ] **Step 3: Crear la navegación compartida**

Implementar:

```tsx
import { canConfigureTenders } from '../permissions';
import type { TenderCurrentProfile, TenderModuleView } from '../types';
import { TenderModuleTabs } from './TenderModuleTabs';

export function TenderModuleNavigation({ active, navigate, currentProfile }: {
  active: TenderModuleView;
  navigate: (hash: string) => void;
  currentProfile: TenderCurrentProfile;
}) {
  const canConfigure = canConfigureTenders(currentProfile);
  return <div className="tender-module-navigation">
    <TenderModuleTabs active={active} navigate={navigate} />
    {canConfigure && <button type="button" className="link-button tender-configuration-link" onClick={() => navigate('#/tenders?view=configuracion')}>Configuración</button>}
  </div>;
}
```

- [ ] **Step 4: Reutilizar en el módulo y reordenar el detalle**

En `TendersModule.tsx`, reemplazar el fragmento local por:

```tsx
const moduleNavigation = <TenderModuleNavigation
  active={props.view}
  navigate={props.navigate}
  currentProfile={props.data.currentProfile}
/>;
```

En `OpportunityDetail`, conservar el encabezado global externo. Dentro del detalle:

1. renderizar primero el wrapper `tender-summary` con solo el banner `.hero`;
2. renderizar `TenderModuleNavigation active="oportunidades"`;
3. renderizar `TenderDetailNavigation`;
4. renderizar la grilla `.grid.three` y el resto del contenido.

No duplicar el banner ni mover `Nueva oportunidad` desde el encabezado global.

- [ ] **Step 5: Ejecutar GREEN y regresión**

```bash
node tests/tender-detail-layout-order.test.mjs
node tests/tender-navigation-opportunities.test.mjs
npm run build
```

Expected: PASS y build sin errores TypeScript.

- [ ] **Step 6: Commit local**

```bash
git add src/tenders/components/TenderModuleNavigation.tsx src/tenders/TendersModule.tsx src/main.tsx tests/tender-detail-layout-order.test.mjs tests/tender-navigation-opportunities.test.mjs
git commit -m "refactor: reuse compact tender module navigation"
```

---

### Task 3: Convertir la navegación interna en barra híbrida activa

**Files:**
- Modify: `src/tenders/components/TenderDetailNavigation.tsx`
- Modify: `tests/tender-detail-navigation.test.mjs`

**Interfaces:**
- Consumes: `TenderDetailStatusSnapshot`, `TENDER_DETAIL_SECTIONS`, `resolveTenderDetailIndicators`.
- Maintains: `activeSection: TenderDetailSectionId`.
- Preserves: `resolveTenderSourceUrl` y validación de URL pública.

- [ ] **Step 1: Actualizar la prueba para que falle**

Reemplazar la expectativa antigua `aria-current="page"` del breadcrumb por contratos que exijan:

```js
assert.doesNotMatch(component, /tender-detail-breadcrumb|Ruta del expediente/);
assert.match(component, /aria-label="Secciones del expediente"/);
assert.match(component, /IntersectionObserver/);
assert.match(component, /aria-current=\{activeSection === id \? 'location' : undefined\}/);
assert.match(component, /tender-detail-indicator/);
assert.match(component, /Volver a Oportunidades/);
assert.match(component, /Abrir fuente oficial/);
assert.match(component, /scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/);
```

Conservar la comprobación de las seis anclas reales.

- [ ] **Step 2: Ejecutar RED**

```bash
node tests/tender-detail-navigation.test.mjs
```

Expected: FAIL porque el breadcrumb sigue presente y no existe observer.

- [ ] **Step 3: Implementar observer y barra**

Cambiar props a:

```ts
type TenderDetailNavigationProps = {
  entity: string;
  sourceUrl?: string | null;
  observations?: string | null;
  statusSnapshot: TenderDetailStatusSnapshot;
  onBack: () => void;
};
```

Implementar `useState<TenderDetailSectionId>('tender-summary')` y un `useEffect` que:

- resuelva las seis anclas existentes;
- cree `IntersectionObserver` con `rootMargin: '-20% 0px -65% 0px'` y `threshold: [0, 0.1, 0.5]`;
- elija entre entradas intersectando la de mayor `intersectionRatio`;
- actualice `activeSection`;
- desconecte en cleanup;
- no falle si `IntersectionObserver` no existe.

Renderizar una sola estructura:

```tsx
<div className="tender-detail-navigation">
  <button type="button" className="link-button tender-detail-back" onClick={onBack}>← Oportunidades</button>
  <strong className="tender-detail-entity" title={entity || 'Expediente'}>{entity || 'Expediente'}</strong>
  <nav className="tender-detail-sections" aria-label="Secciones del expediente">…</nav>
  {officialUrl && <a className="tender-detail-source" …>Fuente oficial <span aria-hidden="true">↗</span></a>}
</div>
```

Cada acceso incluye:

- etiqueta compacta;
- punto `.tender-detail-indicator.tone-${tone}` cuando exista indicador;
- `title` con la etiqueta de estado;
- texto visualmente oculto `Estado: …`;
- `aria-current="location"` solo para la sección activa.

- [ ] **Step 4: Ejecutar GREEN**

```bash
node tests/tender-detail-navigation.test.mjs
node tests/tender-detail-navigation-state.test.mjs
```

Expected: ambos PASS.

- [ ] **Step 5: Commit local**

```bash
git add src/tenders/components/TenderDetailNavigation.tsx tests/tender-detail-navigation.test.mjs
git commit -m "feat: add active hybrid tender detail navigation"
```

---

### Task 4: Alimentar estados sin duplicar solicitudes

**Files:**
- Modify: `src/main.tsx:724-880`
- Modify: `src/tenders/components/TenderGoNoGoDecisionPanel.tsx`
- Modify: `tests/tender-detail-navigation.test.mjs`

**Interfaces:**
- `TenderDocumentReviewPanel` emits `onNavigationStateChanged(documentsState, analysisState)`.
- `TenderGoNoGoDecisionPanel` emits `onNavigationStateChanged(decisionState)`.
- `TenderOfferPreparationPanel` emits `onNavigationStateChanged(preparationState)`.
- `OpportunityDetail` composes one `TenderDetailStatusSnapshot`.

- [ ] **Step 1: Escribir contratos rojos de callbacks**

Añadir a la prueba estática:

```js
assert.match(main, /onNavigationStateChanged/);
assert.match(decisionPanel, /onNavigationStateChanged/);
assert.match(main, /statusSnapshot=\{tenderNavigationSnapshot\}/);
assert.doesNotMatch(main, /\/api\/tender-opportunities[^'"`]*opportunity_id/, 'no debe agregarse una solicitud duplicada');
```

- [ ] **Step 2: Ejecutar RED**

```bash
node tests/tender-detail-navigation.test.mjs
```

Expected: FAIL porque los paneles no emiten estados y la navegación no recibe snapshot.

- [ ] **Step 3: Emitir estado desde revisión documental**

Añadir un callback tipado al panel local. Antes de cargar, emitir `loading`. Al cargar correctamente:

```ts
onNavigationStateChanged?.(
  { phase: 'ready', value: { currentDocumentCount: data.documents.filter(document => document.current).length } },
  { phase: 'ready', value: data.analysis || null },
);
```

En catch, emitir `error` para documentos y análisis con el mensaje estructurado. Después de subir, importar o analizar, emitir de nuevo usando el payload retornado. No deducir estado desde `statusText`.

- [ ] **Step 4: Emitir decisión y preparación**

En `TenderGoNoGoDecisionPanelProps` añadir:

```ts
onNavigationStateChanged?: (state: TenderPanelState<TenderGoNoGoDecision | null>) => void;
```

Emitir `loading` al iniciar `load`, `ready` al obtener `next.decision`, `error` en catch y `ready` tras la actualización optimista.

En `TenderOfferPreparationPanel`, emitir:

```ts
{
  phase: 'ready',
  value: {
    preparationStatus: data.preparation?.status || null,
    decision: data.decision?.decision || null,
    humanPendingCount: data.preparation?.human_required_items?.length || 0,
  },
}
```

Emitir `loading` antes de cargar y `error` al fallar. Reemitir después de guardar notas o cambios de preparación.

- [ ] **Step 5: Componer snapshot en `OpportunityDetail`**

Mantener cuatro estados iniciales `{ phase: 'loading' }`, reiniciarlos al cambiar `id` y construir:

```ts
const tenderNavigationSnapshot: TenderDetailStatusSnapshot = {
  documents: tenderDocumentNavigationState,
  analysis: tenderAnalysisNavigationState,
  decision: tenderDecisionNavigationState,
  preparation: tenderPreparationNavigationState,
  followUp: action,
};
```

Pasarlo a `TenderDetailNavigation`. No hacer `fetch` adicional.

- [ ] **Step 6: Ejecutar GREEN y regresión**

```bash
node tests/tender-detail-navigation.test.mjs
node tests/tender-detail-navigation-state.test.mjs
node tests/tender-go-no-go-ui-static.test.mjs
npm run build
```

Si el nombre exacto de la prueba GO/NO GO difiere, localizar el archivo existente que contiene `TenderGoNoGoDecisionPanel` y ejecutar ese archivo; registrar el comando exacto usado en la evidencia de ejecución.

Expected: PASS y build sin errores.

- [ ] **Step 7: Commit local**

```bash
git add src/main.tsx src/tenders/components/TenderGoNoGoDecisionPanel.tsx tests/tender-detail-navigation.test.mjs
git commit -m "feat: surface reliable tender detail states"
```

---

### Task 5: Aplicar estilos compactos, accesibles y responsive

**Files:**
- Modify: `src/styles.css:367-370`
- Modify: `tests/tender-detail-navigation.test.mjs`
- Modify: `tests/tender-detail-layout-order.test.mjs`

**Interfaces:**
- CSS classes: `.tender-module-navigation`, `.tender-detail-navigation`, `.tender-detail-back`, `.tender-detail-entity`, `.tender-detail-sections`, `.tender-detail-section`, `.tender-detail-indicator`, `.tone-ready`, `.tone-attention`, `.tone-error`, `.tone-unknown`, `.tender-detail-source`.

- [ ] **Step 1: Escribir prueba roja de CSS**

Exigir:

```js
assert.match(styles, /\.tender-module-navigation\s*\{[^}]*display:\s*flex/);
assert.match(styles, /\.tender-detail-navigation\s*\{[^}]*grid-template-columns:/);
assert.match(styles, /\.tender-detail-sections\s*\{[^}]*overflow-x:\s*auto/);
assert.match(styles, /\.tender-detail-indicator\.tone-ready/);
assert.match(styles, /\.tender-detail-indicator\.tone-attention/);
assert.match(styles, /\.tender-detail-indicator\.tone-error/);
assert.match(styles, /\.tender-detail-indicator\.tone-unknown/);
assert.doesNotMatch(styles, /\.tender-detail-actions\s*\{/);
```

- [ ] **Step 2: Ejecutar RED**

```bash
node tests/tender-detail-navigation.test.mjs
node tests/tender-detail-layout-order.test.mjs
```

Expected: FAIL por estilos antiguos.

- [ ] **Step 3: Reemplazar estilos antiguos**

Desktop:

```css
.tender-module-navigation{display:flex;align-items:center;justify-content:space-between;gap:12px}
.tender-module-tabs.module-segmented-nav{display:inline-flex;width:auto;grid-template-columns:none}
.tender-detail-navigation{position:sticky;top:8px;z-index:12;display:grid;grid-template-columns:auto minmax(100px,.28fr) minmax(0,1fr) auto;align-items:center;gap:10px}
.tender-detail-entity{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tender-detail-sections{display:flex;min-width:0;gap:6px;overflow-x:auto;scrollbar-width:thin}
.tender-detail-section{display:inline-flex;align-items:center;flex:0 0 auto;min-height:36px}
.tender-detail-indicator{width:7px;height:7px;border-radius:50%}
.tender-detail-indicator.tone-ready{background:#16a34a}
.tender-detail-indicator.tone-attention{background:#d97706}
.tender-detail-indicator.tone-error{background:#dc2626}
.tender-detail-indicator.tone-unknown{background:#94a3b8}
```

Añadir tratamiento azul para `[aria-current="location"]` independiente del punto semántico. Restablecer explícitamente `flex-direction:row` en los `nav` relevantes para neutralizar la regla global `nav{flex-direction:column}`.

Móvil (`max-width:640px`):

- conservar `position:sticky`;
- usar una primera fila para volver/entidad/fuente y segunda fila horizontal para secciones;
- `grid-template-columns:auto minmax(0,1fr) auto`;
- `.tender-detail-sections{grid-column:1/-1}`;
- altura mínima 44 px para controles;
- prohibido `flex-direction:column` en las seis secciones.

- [ ] **Step 4: Ejecutar pruebas y build**

```bash
node tests/tender-detail-navigation.test.mjs
node tests/tender-detail-layout-order.test.mjs
node tests/tender-detail-navigation-state.test.mjs
node tests/tender-navigation-opportunities.test.mjs
npm run build
```

Expected: todos PASS y Vite genera `dist/`.

- [ ] **Step 5: QA visual local**

Ejecutar:

```bash
npm run dev -- --host 127.0.0.1
```

Validar en anchos 1440, 1024, 768 y 390 px:

- banner azul antes de tabs y barra;
- tabs compactos a la izquierda;
- barra sticky al desplazar;
- sección azul cambia durante scroll;
- colores semánticos no sustituyen etiquetas;
- seis accesos horizontales en 390 px;
- regreso, entidad y fuente permanecen visibles;
- no hay superposición con encabezado;
- foco visible con Tab;
- la fuente abre solo URL pública validada.

Capturar una imagen de escritorio y una móvil como evidencia local; no agregarlas al repositorio salvo solicitud.

- [ ] **Step 6: Revisar diff y commit local**

```bash
git diff --check
git diff --stat
git status --short
git add src/styles.css tests/tender-detail-navigation.test.mjs tests/tender-detail-layout-order.test.mjs
git commit -m "style: compact tender opportunity detail navigation"
```

---

## Verificación final

Ejecutar con salida fresca:

```bash
node tests/tender-detail-navigation-state.test.mjs
node tests/tender-detail-layout-order.test.mjs
node tests/tender-detail-navigation.test.mjs
node tests/tender-navigation-opportunities.test.mjs
npm run build
git diff --check
```

Después revisar que ningún archivo backend, migración o permiso aparezca en:

```bash
git diff --name-only origin/main...HEAD
```

## Self-review

- Cobertura de spec: orden visual, navegación compartida, barra compacta, observer, estados confiables, ARIA, sticky y móvil están asignados a Tasks 1–5.
- No se añade backend ni solicitud duplicada.
- Los nombres `TenderDetailStatusSnapshot`, `TenderPanelState`, `TenderModuleNavigation` y `onNavigationStateChanged` son consistentes entre tareas.
- Los estados ambiguos quedan grises; NO GO resuelto queda verde.
- La ejecución debe partir de un worktree nuevo basado en `origin/main`; no usar el worktree `feat/tender-decision-workspace` sin actualizar, porque al momento de planificar estaba siete commits detrás.
