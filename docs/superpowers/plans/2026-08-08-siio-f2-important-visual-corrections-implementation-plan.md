# SIIO F2 Important Visual Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir los siete hallazgos Important del QA visual F2.0 sin mutar datos, permisos, backend ni runtime AGT.

**Architecture:** Añadir selectores puros y conservadores para aterrizaje, seguimiento, fuentes y lenguaje preliminar; los componentes sólo renderizan sus modelos derivados. Mantener una única fuente de datos para escritorio/móvil y metadata versionada para agentes, con cambios locales exclusivos en frontend y pruebas.

**Tech Stack:** React 19, TypeScript, Vite, Node test runner, esbuild, CSS responsive.

## Global Constraints

- Base exacta: `origin/main@39bef1d4d0755c916ee3a44aa7ee4bc222aaf8a1`.
- Rama local: `fix/siio-f2-important-fixes`.
- No modificar `server/`, `api/`, `supabase/`, usuarios, RLS ni datos reales.
- No modificar módulos `agt002-*`, `vigia-*`, workers, providers, bots o timers.
- No mostrar PII, nombres de empleados, cédulas ni salarios individuales.
- No ocultar registros mediante IDs/fixtures/textos específicos de producción.
- Toda nueva conducta sigue RED → GREEN → regresión focal → commit local.
- Detenerse antes de push, PR, merge o deploy.
- Diseño: `docs/superpowers/specs/2026-08-08-siio-f2-important-visual-corrections-design.md`.

---

## File map

- `src/navPermissions.ts`: permisos existentes más selector puro de aterrizaje.
- `src/main.tsx`: aplica aterrizaje sólo en raíz autenticada.
- `src/siio/types.ts`: actividad/vigencia de presentación y timestamps opcionales.
- `src/siio/selectors.ts`: terminalidad, negación de bloqueos, filtro activo/historial y evaluación de fuentes.
- `src/siio/SiioManagementTrackingView.tsx`: etiquetas de vigencia e historial.
- `src/siio/SiioSourcesIntelligenceView.tsx`: seis dimensiones separadas.
- `src/siioExecutive.ts`: copy validado versus preliminar.
- `src/siio/SiioExecutiveView.tsx`: aviso preliminar y representación responsive de nómina.
- `src/siioAgents.ts`: metadata de estado versionada, sin runtime.
- `src/siio/SiioAgentsView.tsx`: capacidad productiva y desarrollo separados.
- `src/styles.css`: cards móviles, contraste AA y estilos locales.
- `tests/siio-role-default-route.test.mjs`: aterrizaje y ruta explícita.
- `tests/siio-manager-navigation-selectors.test.mjs`: seguimiento y fuentes.
- `tests/siio-executive-copy.test.mjs`: lenguaje preliminar.
- `tests/siio-agent-catalog-static.test.mjs`: metadata obligatoria.
- `tests/siio-executive-dashboard-static.test.mjs`: contrato desktop/mobile y no PII.
- `tests/siio-accessibility-contrast.test.mjs`: contraste calculado.

---

### Task 1: Aterrizaje inicial basado en permisos

**Files:**
- Modify: `src/navPermissions.ts`
- Modify: `src/main.tsx`
- Create: `tests/siio-role-default-route.test.mjs`

**Interfaces:**
- Produces: `isInitialAppHash(hash: string): boolean`.
- Produces: `preferredLandingRoute(profile: Profile): Route`.
- Consumes: `canOpenRoute(profile, route)` existente.

- [ ] **Step 1: Write the failing behavioral test**

Crear un test que transpile `src/navPermissions.ts` con esbuild e importe las funciones nuevas. Casos mínimos:

```js
assert.equal(mod.isInitialAppHash(''), true);
assert.equal(mod.isInitialAppHash('#/'), true);
assert.equal(mod.isInitialAppHash('#/dashboard2'), false);
assert.equal(mod.preferredLandingRoute(admin), 'siio');
assert.equal(mod.preferredLandingRoute(gerencia), 'siio');
assert.equal(mod.preferredLandingRoute(comercial), 'dashboard2');
assert.notEqual(mod.preferredLandingRoute(director), 'siio');
```

También leer `src/main.tsx` y exigir que la redirección esté condicionada por `isInitialAppHash(window.location.hash)`, de modo que una ruta explícita no sea reemplazada.

- [ ] **Step 2: Run RED**

Run:

```bash
node --test tests/siio-role-default-route.test.mjs
```

Expected: FAIL porque `isInitialAppHash` y `preferredLandingRoute` no existen.

- [ ] **Step 3: Implement minimal selector and integration**

En `src/navPermissions.ts`, normalizar sólo los hashes iniciales y escoger la primera ruta de esta prioridad que `canOpenRoute` autorice:

```ts
const LANDING_PRIORITY: Route[] = ['siio', 'dashboard2', 'dashboard', 'opportunities', 'tenders', 'attention', 'consultant'];
export const isInitialAppHash = (hash: string) => hash === '' || hash === '#' || hash === '#/';
export function preferredLandingRoute(profile: Profile): Route {
  return LANDING_PRIORITY.find(route => canOpenRoute(profile, route)) || 'dashboard';
}
```

En `src/main.tsx`, añadir un efecto posterior a la carga de perfil que use `window.location.replace` sólo cuando `isInitialAppHash` sea verdadero. No modificar `parseRoute`, `canOpenRoute` ni el enforcement actual.

- [ ] **Step 4: Run GREEN and regression**

```bash
node --test tests/siio-role-default-route.test.mjs tests/siio-main-integration-static.test.mjs tests/siio-area-scope-blocker.test.mjs
```

Expected: 3/3 PASS.

- [ ] **Step 5: Commit locally**

```bash
git add src/navPermissions.ts src/main.tsx tests/siio-role-default-route.test.mjs
git commit -m "fix(siio): choose initial module from authorized routes"
```

---

### Task 2: Seguimiento activo, histórico y semántica de bloqueos

**Files:**
- Modify: `src/siio/types.ts`
- Modify: `src/siio/selectors.ts`
- Modify: `src/siio/SiioManagementTrackingView.tsx`
- Modify: `tests/siio-manager-navigation-selectors.test.mjs`
- Modify: `tests/siio-executive-dashboard-static.test.mjs`

**Interfaces:**
- Produces: `isTerminalSiioStatus(status?: string | null): boolean`.
- Produces: `isNegatedBlocker(text?: string | null): boolean`.
- Extends `SiioTrackingItem` with `activityState: 'active' | 'history' | 'unconfirmed'`.
- `filterTrackingItems` excludes `history` only when no explicit terminal status filter is selected.

- [ ] **Step 1: Add failing selector cases**

Añadir casos reales y generales:

```js
assert.equal(mod.isTerminalSiioStatus('Completado'), true);
assert.equal(mod.isTerminalSiioStatus('en curso'), false);
assert.equal(mod.isNegatedBlocker('No hay bloqueo crítico; continuar monitoreo'), true);
assert.equal(mod.isNegatedBlocker('Sin bloqueos pendientes'), true);
assert.equal(mod.isNegatedBlocker('Bloqueo por vacantes'), false);
```

Construir filas con un registro `cerrado`, un bloqueo negado, un bloqueo real y una decisión pendiente sin fecha. Exigir:

- el registro cerrado tenga `activityState='history'`;
- el bloqueo negado no produzca ítem;
- el bloqueo real permanezca;
- la decisión sin fecha tenga `activityState='unconfirmed'`;
- el filtro por defecto omita historial;
- un filtro explícito `status='cerrado'` lo recupere.

- [ ] **Step 2: Run RED**

```bash
node --test tests/siio-manager-navigation-selectors.test.mjs
```

Expected: FAIL por funciones/campo ausentes y porque el historial aún aparece.

- [ ] **Step 3: Implement minimal pure semantics**

Normalizar minúsculas, espacios y tildes. Terminalidad cerrada:

```ts
const TERMINAL_STATUSES = new Set(['cerrado', 'cerrada', 'completado', 'completada', 'resuelto', 'resuelta', 'cancelado', 'cancelada', 'done', 'closed']);
```

Negación sólo si el texto normalizado empieza con una construcción inequívoca (`sin bloqueo`, `sin bloqueos`, `no hay bloqueo`, `no hay bloqueos`, `ningun bloqueo`, `ninguna obstruccion`). No buscar IDs ni nombres de asuntos.

`activityState`:

- terminal → `history`;
- no terminal y sin `dueDate`, `updated_at` o `created_at` disponibles → `unconfirmed`;
- en otro caso → `active`.

Extender tipos de record/decision para timestamps opcionales y transportar el timestamp sin cambiar la API.

En la vista:

- añadir aviso “Estado operativo sujeto al corte y confirmación del responsable”;
- mostrar badge `Histórico`, `Vigencia no confirmada` o `Activo`;
- mantener filtros y trazabilidad;
- los conteos deben usar `filterTrackingItems`.

- [ ] **Step 4: Run GREEN and regression**

```bash
node --test tests/siio-manager-navigation-selectors.test.mjs tests/siio-manager-navigation-static.test.mjs tests/siio-executive-dashboard-static.test.mjs
```

Expected: 3/3 PASS.

- [ ] **Step 5: Commit locally**

```bash
git add src/siio/types.ts src/siio/selectors.ts src/siio/SiioManagementTrackingView.tsx tests/siio-manager-navigation-selectors.test.mjs tests/siio-executive-dashboard-static.test.mjs
git commit -m "fix(siio): separate active tracking from unconfirmed history"
```

---

### Task 3: Estado multidimensional de fuentes

**Files:**
- Modify: `src/siio/selectors.ts`
- Modify: `src/siio/SiioSourcesIntelligenceView.tsx`
- Modify: `tests/siio-manager-navigation-selectors.test.mjs`

**Interfaces:**
- Produces: `deriveSourceAssessment(source: SiioSource, asOf?: Date): SourceAssessment`.
- `SourceAssessment` tiene `availability`, `review`, `freshness`, `validation`, `applicability`, `compliance`.

- [ ] **Step 1: Add failing deterministic tests**

Usar fecha inyectada `new Date('2026-08-08T00:00:00Z')`:

```js
const assessment = mod.deriveSourceAssessment({
  status: 'activa', trust_level: 'oficial_requiere_validacion',
  last_reviewed_at: null, next_review_at: '2026-08-01',
}, new Date('2026-08-08T00:00:00Z'));
assert.deepEqual(assessment, {
  availability: 'Disponible', review: 'Sin revisión registrada',
  freshness: 'Revisión vencida', validation: 'Requiere validación',
  applicability: 'No registrada', compliance: 'No evaluado',
});
```

Añadir un caso con `status='activa'` y fechas ausentes; exigir que nunca contenga `Vigente`.

- [ ] **Step 2: Run RED**

```bash
node --test tests/siio-manager-navigation-selectors.test.mjs
```

Expected: FAIL porque `deriveSourceAssessment` no existe.

- [ ] **Step 3: Implement and render six dimensions**

Implementar helper puro con reloj inyectable. La vista debe dejar de mostrar `status` como semáforo omnicomprensivo y renderizar seis pares etiqueta/valor. Mantener filtros existentes de `next_review_at`, `trust_level` y `source_type` sin reinterpretarlos.

- [ ] **Step 4: Run GREEN**

```bash
node --test tests/siio-manager-navigation-selectors.test.mjs tests/siio-manager-filter-semantics.test.mjs
```

Expected: 2/2 PASS.

- [ ] **Step 5: Commit locally**

```bash
git add src/siio/selectors.ts src/siio/SiioSourcesIntelligenceView.tsx tests/siio-manager-navigation-selectors.test.mjs
git commit -m "fix(siio): separate source status dimensions"
```

---

### Task 4: Copy preliminar condicionado a validación

**Files:**
- Modify: `src/siioExecutive.ts`
- Modify: `src/siio/SiioExecutiveView.tsx`
- Create: `tests/siio-executive-copy.test.mjs`
- Modify: `tests/siio-executive-dashboard-static.test.mjs`

**Interfaces:**
- Produces: insights cuya redacción depende de `financialValidationStatus`.
- La vista muestra un aviso preliminar si el estado no es `validado`.

- [ ] **Step 1: Write failing data-level tests**

Transpilar/importar `src/siioExecutive.ts`. Crear el mismo set de ingresos/costos dos veces: una sin `validated_by` y otra con responsable. Exigir:

```js
assert.match(preliminary.managementInsights.find(i => i.id === 'cost-growth-pressure').title, /preliminar|fuente/i);
assert.doesNotMatch(preliminary.managementInsights.find(i => i.id === 'cost-growth-pressure').finding, /^El crecimiento comercial no se está/);
assert.match(validated.managementInsights.find(i => i.id === 'cost-growth-pressure').title, /costos crecen/i);
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/siio-executive-copy.test.mjs
```

Expected: FAIL porque ambos estados usan voz de hecho cerrado.

- [ ] **Step 3: Implement conditional copy and banner**

En `deriveManagementInsights`, usar `financialValidationStatus === 'validado'` para elegir títulos/findings confirmados o preliminares. No alterar cálculos, periodos, fuentes ni acciones. En la vista, antes de recomendaciones/finanzas, mostrar:

```tsx
<div className="notice siio-preliminary-notice" role="status">
  Lectura preliminar — requiere validación financiera antes de usarse como conclusión ejecutiva.
</div>
```

sólo cuando no está validado.

- [ ] **Step 4: Run GREEN and regression**

```bash
node --test tests/siio-executive-copy.test.mjs tests/siio-executive-dashboard-static.test.mjs tests/siio-board-draft-behavior.test.mjs
```

Expected: 3/3 PASS.

- [ ] **Step 5: Commit locally**

```bash
git add src/siioExecutive.ts src/siio/SiioExecutiveView.tsx tests/siio-executive-copy.test.mjs tests/siio-executive-dashboard-static.test.mjs
git commit -m "fix(siio): qualify unvalidated executive findings"
```

---

### Task 5: Catálogo institucional con corte y fuente

**Files:**
- Modify: `src/siioAgents.ts`
- Modify: `src/siio/SiioAgentsView.tsx`
- Modify: `tests/siio-agent-catalog-static.test.mjs`

**Interfaces:**
- Extends `SiioInstitutionalAgent` with `state_as_of`, `state_source`, `production_capability`, `development_status`.

- [ ] **Step 1: Add failing metadata contract**

Exigir los cuatro campos en el tipo y en cada uno de los tres objetos. Exigir además que la vista renderice explícitamente “Capacidad productiva”, “Desarrollo / no desplegado”, “Corte” y “Fuente”. El test debe negar frases que equiparen desarrollo con producción.

- [ ] **Step 2: Run RED**

```bash
node --test tests/siio-agent-catalog-static.test.mjs
```

Expected: FAIL por campos ausentes.

- [ ] **Step 3: Add conservative versioned metadata**

Usar cortes y fuentes explícitos por agente:

- AGT-001: corte `2026-08-08`, fuente `QA F2.0 + CURRENT.md@39bef1d`; productivo F2 read-only; desarrollo = correcciones Important locales no desplegadas.
- AGT-002: corte `2026-08-07`, fuente `CURRENT.md feat/agt002-v3-foundations`; productivo E5/E6 con gate humano y drain/timer apagados; v3 en rama, no desplegado y NOT READY para canary real.
- AGT-003: corte `2026-08-06`, fuente `CURRENT.md@39bef1d`; identidad productiva aprobada y funciones declaradas actuales; no promover capacidades futuras.

No importar ni llamar módulos AGT.

- [ ] **Step 4: Run GREEN**

```bash
node --test tests/siio-agent-catalog-static.test.mjs tests/siio-manager-filter-semantics.test.mjs
```

Expected: 2/2 PASS.

- [ ] **Step 5: Commit locally**

```bash
git add src/siioAgents.ts src/siio/SiioAgentsView.tsx tests/siio-agent-catalog-static.test.mjs
git commit -m "fix(siio): version visible agent operating state"
```

---

### Task 6: Nómina responsive y contraste AA

**Files:**
- Modify: `src/siio/SiioExecutiveView.tsx`
- Modify: `src/siio/SiioManagementTrackingView.tsx`
- Modify: `src/siio/SiioSourcesIntelligenceView.tsx`
- Modify: `src/styles.css`
- Modify: `tests/siio-executive-dashboard-static.test.mjs`
- Create: `tests/siio-accessibility-contrast.test.mjs`

**Interfaces:**
- Escritorio usa `.siio-payroll-table`.
- Móvil usa `.siio-payroll-cards` a partir del mismo `payrollRows`.
- Componentes locales usan `.siio-eyebrow` con colores calculables.

- [ ] **Step 1: Write failing static responsive contract**

Exigir:

```js
assert.match(executive, /siio-payroll-table/);
assert.match(executive, /siio-payroll-cards/);
assert.equal((executive.match(/payrollRows\.map/g) || []).length, 2);
assert.match(styles, /@media\(max-width:760px\)[\s\S]*\.siio-payroll-table\{display:none\}/);
assert.match(styles, /\.siio-payroll-cards\{display:none\}/);
assert.match(styles, /@media\(max-width:760px\)[\s\S]*\.siio-payroll-cards\{display:grid\}/);
```

El doble `map` es sólo presentación desktop/mobile del mismo arreglo; cálculos y filtros no se duplican.

Mantener assertions negativas para PII.

- [ ] **Step 2: Write failing contrast calculation**

Crear helper de test que convierta hex a luminancia relativa y calcule contraste WCAG. Leer los tokens CSS de `.siio-eyebrow` y texto secundario SIIO; exigir:

```js
assert.ok(contrast('#1e40af', '#dbeafe') >= 4.5);
assert.ok(contrast('#475569', '#ffffff') >= 4.5);
```

El test estático también exige que los componentes usen `siio-eyebrow`, no `.eyebrow` clara sobre fondo blanco.

- [ ] **Step 3: Run RED**

```bash
node --test tests/siio-executive-dashboard-static.test.mjs tests/siio-accessibility-contrast.test.mjs
```

Expected: FAIL por clases/cards/tokens ausentes.

- [ ] **Step 4: Implement responsive presentation and local contrast**

En `SiioExecutiveView.tsx`, conservar tabla dentro de `.siio-payroll-table` y añadir tarjetas que muestren exactamente área, personas, devengado, deducciones, neto y control. En CSS:

```css
.siio-payroll-cards{display:none}
.siio-eyebrow{color:#1e40af;background:#dbeafe}
.siio-secondary{color:#475569}
@media(max-width:760px){
  .siio-payroll-table{display:none}
  .siio-payroll-cards{display:grid;grid-template-columns:1fr;gap:12px}
}
```

No cambiar estilos globales fuera de superficies SIIO.

- [ ] **Step 5: Run GREEN and focal suite**

```bash
node --test tests/siio-accessibility-contrast.test.mjs tests/siio-executive-dashboard-static.test.mjs tests/siio-manager-navigation-static.test.mjs
node --test tests/siio-*.test.mjs
```

Expected: 3/3 PASS y 14/14 PASS (11 baseline + 3 nuevas).

- [ ] **Step 6: Commit locally**

```bash
git add src/siio/SiioExecutiveView.tsx src/siio/SiioManagementTrackingView.tsx src/siio/SiioSourcesIntelligenceView.tsx src/styles.css tests/siio-executive-dashboard-static.test.mjs tests/siio-accessibility-contrast.test.mjs
git commit -m "fix(siio): make payroll mobile-safe and restore contrast"
```

---

### Task 7: Verificación integral y revisión independiente

**Files:**
- Create: `docs/verification/2026-08-08-siio-f2-important-local.md`
- No production code unless a failing regression is first added.

**Interfaces:**
- Produces evidencia mecánica local y screenshots; no publicación.

- [ ] **Step 1: Enforce scope mechanically**

```bash
git diff --name-only origin/main...HEAD
```

Expected: sólo archivos listados en este plan; ningún path bajo `server/`, `api/`, `supabase/` ni módulos AGT/Vig-IA.

- [ ] **Step 2: Run fresh focal and full verification**

```bash
node --test tests/siio-*.test.mjs
npm test
npm run build
npm audit --omit=dev
git diff --check origin/main...HEAD
```

Expected:

- focal SIIO: 14/14 PASS;
- full suite: todos PASS salvo un único baseline conocido sólo si se reproduce sobre `origin/main@39bef1d` (`module-permissions-migration-pglite.test.mjs`);
- build exit 0; warning preexistente de chunk permitido;
- audit: 0 vulnerabilities;
- diff check limpio.

- [ ] **Step 3: Run local responsive QA**

Detectar Chromium/Playwright local. Levantar preview Vite sin exponerlo externamente. Usar fixtures/intercepción local, nunca credenciales o datos reales, para capturar:

- `1440x900` Resumen y Seguimiento;
- `768x1024` Resumen;
- `390x844` Nómina cards, Seguimiento y Fuentes.

Validar en cada captura: sin overflow horizontal, sin texto cortado, badges legibles, seis cifras por tarjeta, aviso preliminar, metadata de fuentes/agentes y ausencia de PII.

Si el navegador local no está disponible, documentar el bloqueo y no sustituirlo por una afirmación de QA visual; las pruebas CSS/build siguen siendo evidencia mecánica, no visual.

- [ ] **Step 4: Request one independent Opus review**

Ejecutar Claude Code CLI con `--model opus --permission-mode plan`, base `39bef1d`, HEAD local y el diseño/plan. Pedir sólo Critical/Important. Si Opus vuelve a bloquearse, usar Sonnet en contexto separado y documentar la degradación.

- [ ] **Step 5: Fix review findings with TDD**

Para cada Critical/Important válido: añadir una prueba que falle, ejecutar RED, implementar mínimo, ejecutar GREEN y suite focal. No corregir Minor en este carril.

- [ ] **Step 6: Write verification record**

Registrar comandos, conteos, SHA base/HEAD, screenshots, límites y veredicto del revisor en `docs/verification/2026-08-08-siio-f2-important-local.md`.

- [ ] **Step 7: Final local commit**

```bash
git add docs/verification/2026-08-08-siio-f2-important-local.md
git commit -m "docs(siio): record F2 important fixes verification"
```

- [ ] **Step 8: Stop before external actions**

No ejecutar `git push`, `gh pr create`, merge, migración o deploy. Entregar a Juan: rama, SHAs, diff, resultados, screenshots y cualquier gate pendiente.

---

## Self-review

- Spec coverage: los siete Important están mapeados a Tasks 1–6; límites y verificación están en Task 7.
- Completitud: todos los pasos contienen contenido, comando y resultado esperado; no quedan marcadores pendientes.
- Type consistency: `preferredLandingRoute`, `isInitialAppHash`, `activityState`, `deriveSourceAssessment` y metadata de agentes se definen antes de ser consumidos.
- Scope: un solo frontend SIIO; no requiere dividir en subproyectos porque todos los cambios convergen en el mismo recorrido F2 y se verifican como una unidad.
