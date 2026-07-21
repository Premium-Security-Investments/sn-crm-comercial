# Compact Tender Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir el panel de filtros del Radar de Licitaciones en la grilla compacta aprobada, sin alterar comportamiento ni datos.

**Architecture:** La estructura funcional permanece en `TenderRadarView.tsx`; cada control recibe una clase semántica estable. `styles.css` define una grilla de 12 columnas y breakpoints específicos para escritorio, tablet y móvil. Una regresión estática comprueba la estructura y reglas responsive antes de QA visual autenticada.

**Tech Stack:** React 19, TypeScript, CSS nativo, Node.js `assert`, Vite.

## Global Constraints

- Mantener visibles los nueve controles actuales.
- No cambiar opciones, estados, handlers, perfiles guardados, filtrado ni ordenamiento.
- No modificar backend, APIs, datos, roles o permisos.
- Escritorio: dos filas; móvil de 390 px: sin overflow horizontal y controles táctiles de al menos 44 px.
- No añadir dependencias.

---

### Task 1: Regresión de estructura compacta

**Files:**
- Create: `tests/tender-filter-compact-layout.test.mjs`
- Read: `src/tenders/TenderRadarView.tsx`
- Read: `src/styles.css`

**Interfaces:**
- Consumes: clases JSX y reglas CSS del panel `tender-control-panel`.
- Produces: gate ejecutable que exige clases semánticas, grilla de 12 columnas y breakpoints tablet/móvil.

- [ ] **Step 1: Write the failing test**

Crear `tests/tender-filter-compact-layout.test.mjs` que lea ambos archivos y verifique:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const radar = readFileSync(new URL('../src/tenders/TenderRadarView.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

for (const className of ['tender-filter-source', 'tender-filter-region', 'tender-filter-deadline', 'tender-filter-value', 'tender-filter-score', 'tender-filter-section', 'tender-filter-status', 'tender-filter-order']) {
  assert.match(radar, new RegExp(`className="[^"]*${className}`), `${className} debe estar aplicada a su control.`);
}
assert.match(css, /\.tender-control-top\{[^}]*grid-template-columns:repeat\(12,minmax\(0,1fr\)\)/, 'La grilla de escritorio debe usar 12 columnas.');
assert.match(css, /\.tender-search-input\{[^}]*grid-column:span 6/, 'La búsqueda debe ocupar seis columnas en escritorio.');
assert.match(css, /\.tender-filter-order\{[^}]*grid-column:span 4/, 'Orden debe ocupar cuatro columnas en escritorio.');
assert.match(css, /@media\(max-width:1240px\)[\s\S]*\.tender-search-input\{grid-column:1\/-1/, 'Tablet debe llevar búsqueda a ancho completo.');
assert.match(css, /@media\(max-width:640px\)[\s\S]*\.tender-control-top\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, 'Móvil debe usar dos columnas.');
assert.match(css, /@media\(max-width:640px\)[\s\S]*\.tender-control-top select[^{]*\{[^}]*min-height:44px/, 'Móvil debe conservar altura táctil mínima.');
console.log('Tender compact filter layout expectations passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/tender-filter-compact-layout.test.mjs`  
Expected: FAIL porque las clases semánticas y la grilla de 12 columnas aún no existen.

- [ ] **Step 3: Commit the RED test with the design documents**

```bash
git add tests/tender-filter-compact-layout.test.mjs docs/superpowers/specs/2026-07-21-compact-tender-filters-design.md docs/superpowers/plans/2026-07-21-compact-tender-filters.md
git commit -m "test: specify compact tender filter layout"
```

### Task 2: Implementar y verificar la grilla

**Files:**
- Modify: `src/tenders/TenderRadarView.tsx:113`
- Modify: `src/styles.css:103-105`
- Test: `tests/tender-filter-compact-layout.test.mjs`

**Interfaces:**
- Consumes: los estados y handlers actuales de `TenderRadarView` sin cambiar firmas.
- Produces: clases `tender-filter-*` y layout responsive de dos filas.

- [ ] **Step 1: Add semantic classes without changing behavior**

En cada `label` del panel añadir:

```tsx
className="tender-filter tender-filter-source"
className="tender-filter tender-filter-region"
className="tender-filter tender-filter-deadline"
className="tender-filter tender-filter-value"
className="tender-filter tender-filter-score"
className="tender-filter tender-filter-section"
className="tender-filter tender-filter-status"
className="tender-filter tender-filter-order"
```

No cambiar los `value`, `onChange` ni `<option>` existentes.

- [ ] **Step 2: Replace the two-column rule with the approved grid**

Añadir reglas equivalentes a:

```css
.tender-control-panel{gap:10px;padding:15px 16px}
.tender-control-top{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:10px 12px;align-items:end}
.tender-control-top>label{display:grid;gap:5px;min-width:0;font-size:11px;font-weight:900;color:#526173;text-transform:uppercase;letter-spacing:.055em}
.tender-control-top input,.tender-control-top select{height:42px;padding:8px 10px;border-radius:10px;font-size:14px}
.tender-search-input{grid-column:span 6;min-height:42px}
.tender-filter-source,.tender-filter-region,.tender-filter-deadline,.tender-filter-value,.tender-filter-score,.tender-filter-section,.tender-filter-status{grid-column:span 2}
.tender-filter-order{grid-column:span 4}
@media(max-width:1240px){
  .tender-search-input{grid-column:1/-1}
  .tender-control-top>.tender-filter{grid-column:span 4}
  .tender-control-top>.tender-filter-order{grid-column:span 8}
}
@media(max-width:640px){
  .tender-control-panel{padding:12px}
  .tender-control-top{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
  .tender-search-input,.tender-control-top>.tender-filter-order{grid-column:1/-1}
  .tender-control-top>.tender-filter{grid-column:span 1}
  .tender-control-top>.tender-filter-order{grid-column:1/-1}
  .tender-control-top input,.tender-control-top select{min-height:44px;font-size:13px}
}
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
node tests/tender-filter-compact-layout.test.mjs
node tests/tender-module-ui.test.mjs
node tests/tender-search-profiles.test.mjs
```

Expected: los tres comandos terminan con código 0.

- [ ] **Step 4: Run full verification**

Run:

```bash
for f in tests/*.test.mjs; do timeout 90s node "$f"; done
python3 tests/siio-board-source-extractor.test.py
npm run build
git diff --check
```

Expected: todos los archivos JavaScript pasan, Python reporta `OK`, Vite termina con `built in`, y `git diff --check` no produce salida.

- [ ] **Step 5: QA visual authenticated**

Verificar en 1440 px y 390 px:
- nueve controles visibles;
- dos filas en escritorio;
- búsqueda y Orden a ancho completo donde corresponde;
- panel sustancialmente más bajo;
- `scrollWidth <= innerWidth` en móvil;
- filtros cambian resultados;
- consola sin errores y cero escrituras API.

- [ ] **Step 6: Commit implementation**

```bash
git add src/tenders/TenderRadarView.tsx src/styles.css tests/tender-filter-compact-layout.test.mjs
git commit -m "feat: compact tender radar filters"
```

- [ ] **Step 7: Release gate**

Revisar diff, abrir PR hacia `main`, confirmar checks, integrar, desplegar Vercel a producción y repetir smoke visual en el alias oficial.
