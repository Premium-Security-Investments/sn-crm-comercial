# AGT-003 / Vig-IA: jerarquía visual de rótulos del copiloto — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan sintaxis de checkbox (`- [ ]`) para seguimiento.

**Goal:** Renombrar los tres rótulos fijos de `VigiaCopilotProposal` (`Qué pasó`/`Falta`/`Objetivo` → `Situación actual`/`Información por confirmar`/`Objetivo del próximo contacto`) y darles un tratamiento visual editorial mínimo (tamaño, peso, separación, línea lateral y fondo suave por fila), sin tocar el dato mostrado, el orden, la estructura DOM ni ningún otro bloque del panel.

**Architecture:** Cambio focal de sólo texto y CSS. `VigiaCopilotProposal` (`src/vigia/VigiaOpportunityCopilot.tsx`) sigue leyendo exactamente `presented.summary`/`presented.missingSummary`/`presented.contactObjective`; sólo cambian los tres literales dentro de `<strong>`. `.vigia-copilot-brief-row` en `src/styles.css` gana `padding`, `border-left` y `background` por fila vía `:nth-child`, sin ninguna clase nueva en el JSX. `tests/agt003-copilot-proposal-render.test.mjs` es la única prueba existente que fija el texto de esos rótulos y la única que se modifica.

**Tech Stack:** React 18 + TypeScript + Vite, `node --test` con `node:assert/strict`, esbuild (vía `tests/helpers/bundle-react-component.mjs`), CSS plano.

**Spec:** `docs/superpowers/specs/2026-09-02-agt003-copilot-heading-hierarchy-design.md` (fuente única).

**Rama de trabajo:** `fix/agt003-copilot-heading-hierarchy-20260902` (ya activa).

## Global Constraints

- Único alcance de archivos: `src/vigia/VigiaOpportunityCopilot.tsx`, `src/styles.css`, `tests/agt003-copilot-proposal-render.test.mjs`. Ningún otro archivo se modifica.
- No se toca `src/main.tsx` ni `MyDayGroup` (comparten por casualidad las mismas tres palabras, pero son una función distinta — ver spec, sección «Ambigüedad resuelta»). No se toca `src/vigia/copilot-presentation.ts`, `src/vigia/opportunity-copilot-state.ts`, ni `src/vigia/opportunity-preflight-presentation.ts`.
- No se toca ningún endpoint, migración, contrato de `contracts/agents/`, ni ninguna dependencia de `package.json`.
- No se cambia el dato mostrado en cada fila, el orden de las filas, su cantidad, ni la estructura DOM (`<section className="vigia-copilot-brief"><div className="vigia-copilot-brief-row"><strong>…</strong><p>…</p></div>…</section>`).
- No se agrega ninguna clase nueva al JSX: la variación de color por fila se resuelve en CSS puro con `:nth-child`.
- No se agrega icono, badge de estado, ni indicador semáforo (rojo/ámbar/verde). Los `border-left-color` nuevos (`#1b64f2`, `#64748b`, `#4f46e5`) no coinciden con `#dc2626`/`#f59e0b`/`#fbbf24`/`#16a34a`, reservados para alertas.
- El contenedor `.vigia-copilot-brief` no cambia ninguna declaración (`padding:14px;border-radius:14px;background:#f8fbff;border:1px solid #e2eaf5;display:grid;gap:10px`); `.vigia-copilot-brief-row p{margin:0;color:#17345b}` tampoco cambia.
- No se agrega ninguna regla `@media` nueva.
- Sin `git add -A`: cada `git add` cita explícitamente los tres archivos del alcance. Sin push, PR, merge ni despliegue — sólo commit local.

---

### Tarea única: renombrar rótulos y aplicar tratamiento visual editorial (RED → GREEN)

**Files:**
- Modify: `tests/agt003-copilot-proposal-render.test.mjs`
- Modify: `src/vigia/VigiaOpportunityCopilot.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `presented.summary`, `presented.missingSummary`, `presented.contactObjective` (sin cambios, provistos por `presentCopilotBrief` en `src/vigia/copilot-presentation.ts`, que no se toca).
- Produces: los tres literales `<strong>Situación actual</strong>`, `<strong>Información por confirmar</strong>`, `<strong>Objetivo del próximo contacto</strong>`, en ese orden; las declaraciones CSS exactas de `.vigia-copilot-brief-row`, `.vigia-copilot-brief-row strong` y las tres reglas `:nth-child`.

- [ ] **Step 1: Modificar sólo el test — RED**

  Editar `tests/agt003-copilot-proposal-render.test.mjs`.

  1a. Reemplazar el comentario y la aserción de rótulos (líneas 50 y 54):

  Antes:
  ```js
  // Qué pasó / Falta / Objetivo, en ese orden, con rótulo visible.
  const briefMatch = /<section class="vigia-copilot-brief">([\s\S]*?)<\/section>/.exec(html);
  assert.ok(briefMatch);
  const rows = [...briefMatch[1].matchAll(/<div class="vigia-copilot-brief-row"><strong>([^<]+)<\/strong><p>([^<]*)<\/p><\/div>/g)];
  assert.deepEqual(rows.map(r => r[1]), ['Qué pasó', 'Falta', 'Objetivo']);
  ```

  Después:
  ```js
  // Situación actual / Información por confirmar / Objetivo del próximo contacto, en ese orden, con rótulo visible.
  const briefMatch = /<section class="vigia-copilot-brief">([\s\S]*?)<\/section>/.exec(html);
  assert.ok(briefMatch);
  const rows = [...briefMatch[1].matchAll(/<div class="vigia-copilot-brief-row"><strong>([^<]+)<\/strong><p>([^<]*)<\/p><\/div>/g)];
  assert.deepEqual(rows.map(r => r[1]), ['Situación actual', 'Información por confirmar', 'Objetivo del próximo contacto']);
  ```

  1b. Añadir, inmediatamente antes de la línea `console.log('AGT-003 copilot proposal render checks passed');` (línea final del archivo), un bloque nuevo que exige las declaraciones CSS exactas de la spec (el `const css` ya existe más arriba, en la sección de target táctil de 44px — reutilizarlo, no declararlo de nuevo):

  ```js
  // Jerarquía visual de los tres rótulos: tamaño, peso, separación, línea lateral y fondo por fila.
  assert.match(css, /\.vigia-copilot-brief-row\{display:grid;gap:5px;padding:5px 10px 5px 12px;border-left:3px solid #cbd5e1;border-radius:0 6px 6px 0;background:#f8fafc\}/, 'falta el tratamiento de fila (gap/padding/border-left/border-radius/background)');
  assert.match(css, /\.vigia-copilot-brief-row strong\{font-size:14px;font-weight:700;text-transform:none;letter-spacing:normal;color:#17345b\}/, 'falta el rótulo en 14px/700/sin mayúsculas');
  assert.match(css, /\.vigia-copilot-brief-row p\{margin:0;color:#17345b\}/, 'el párrafo de contenido no debe cambiar');
  assert.match(css, /\.vigia-copilot-brief-row:nth-child\(1\)\{border-left-color:#1b64f2;background:#f5f8ff\}/, 'falta el acento de la fila 1 (azul primario)');
  assert.match(css, /\.vigia-copilot-brief-row:nth-child\(2\)\{border-left-color:#64748b;background:#f8fafc\}/, 'falta el acento de la fila 2 (gris/slate)');
  assert.match(css, /\.vigia-copilot-brief-row:nth-child\(3\)\{border-left-color:#4f46e5;background:#f7f6ff\}/, 'falta el acento de la fila 3 (índigo)');
  for (const alarmColor of ['#dc2626', '#f59e0b', '#fbbf24', '#16a34a']) {
    assert.equal(
      new RegExp(`\\.vigia-copilot-brief-row:nth-child\\([1-3]\\)\\{border-left-color:${alarmColor}`).test(css),
      false,
      `ninguna fila puede usar el color de alarma ${alarmColor}`,
    );
  }
  ```

  No se toca ninguna otra línea del archivo: el resto de aserciones (orden de secciones, `Siguiente paso`, ausencia de `whyBullets`, `Contexto y evidencia`, insignias de confianza, target táctil de 44px) permanece igual.

- [ ] **Step 2: Correr el test y confirmar FAIL**

  Run: `node --test tests/agt003-copilot-proposal-render.test.mjs`

  Expected: FAIL. Dos causas simultáneas, ambas por implementación pendiente (no por error en el test):
  - `assert.deepEqual(rows.map(r => r[1]), [...])` falla porque `VigiaOpportunityCopilot.tsx` todavía renderiza `['Qué pasó', 'Falta', 'Objetivo']`.
  - El primer `assert.match(css, /\.vigia-copilot-brief-row\{display:grid;gap:5px;.../)` falla porque `src/styles.css` todavía tiene `gap:2px` sin `padding`/`border-left`/`background` en esa regla.

- [ ] **Step 3: Modificar sólo la implementación — GREEN**

  En `src/vigia/VigiaOpportunityCopilot.tsx`, reemplazar las tres filas (líneas 64-66) dentro de `<section className="vigia-copilot-brief">`:

  Antes:
  ```tsx
      <section className="vigia-copilot-brief">
        <div className="vigia-copilot-brief-row"><strong>Qué pasó</strong><p>{presented.summary}</p></div>
        <div className="vigia-copilot-brief-row"><strong>Falta</strong><p>{presented.missingSummary}</p></div>
        <div className="vigia-copilot-brief-row"><strong>Objetivo</strong><p>{presented.contactObjective}</p></div>
      </section>
  ```

  Después:
  ```tsx
      <section className="vigia-copilot-brief">
        <div className="vigia-copilot-brief-row"><strong>Situación actual</strong><p>{presented.summary}</p></div>
        <div className="vigia-copilot-brief-row"><strong>Información por confirmar</strong><p>{presented.missingSummary}</p></div>
        <div className="vigia-copilot-brief-row"><strong>Objetivo del próximo contacto</strong><p>{presented.contactObjective}</p></div>
      </section>
  ```

  Ningún otro texto, prop, clase ni atributo del archivo cambia.

  En `src/styles.css`, reemplazar las dos reglas existentes (líneas 496-497) y añadir las tres reglas `:nth-child` justo después de la tercera regla (`.vigia-copilot-brief-row p`, línea 498, que no cambia):

  Antes:
  ```css
  .vigia-copilot-brief-row{display:grid;gap:2px}
  .vigia-copilot-brief-row strong{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#527099}
  .vigia-copilot-brief-row p{margin:0;color:#17345b}
  ```

  Después:
  ```css
  .vigia-copilot-brief-row{display:grid;gap:5px;padding:5px 10px 5px 12px;border-left:3px solid #cbd5e1;border-radius:0 6px 6px 0;background:#f8fafc}
  .vigia-copilot-brief-row strong{font-size:14px;font-weight:700;text-transform:none;letter-spacing:normal;color:#17345b}
  .vigia-copilot-brief-row p{margin:0;color:#17345b}
  .vigia-copilot-brief-row:nth-child(1){border-left-color:#1b64f2;background:#f5f8ff}
  .vigia-copilot-brief-row:nth-child(2){border-left-color:#64748b;background:#f8fafc}
  .vigia-copilot-brief-row:nth-child(3){border-left-color:#4f46e5;background:#f7f6ff}
  ```

  Ningún otro selector de `src/styles.css` cambia; en particular `.vigia-copilot-brief` (línea 495) conserva exactamente `display:grid;gap:10px;padding:14px;border-radius:14px;background:#f8fbff;border:1px solid #e2eaf5`.

- [ ] **Step 4: Correr focales, tsc, build y git diff --check**

  Run:
  ```bash
  node --test tests/agt003-copilot-proposal-render.test.mjs tests/vigia-opportunity-copilot-ui-static.test.mjs tests/consultant-detail-static.test.mjs
  npx tsc --noEmit
  npx vite build
  git diff --check
  ```

  Expected:
  - Los tres `node --test` en verde: `agt003-copilot-proposal-render.test.mjs` (18+ aserciones, incluidas las nuevas de rótulos y CSS), `vigia-opportunity-copilot-ui-static.test.mjs` (sólo referencia el marcador de clase `.vigia-copilot-brief`, que no cambia) y `consultant-detail-static.test.mjs` (su aserción sobre `Qué pasó:` pertenece a `MyDayGroup` en `src/main.tsx`, fuera de alcance).
  - `npx tsc --noEmit` exit 0 (cambio de sólo texto JSX y CSS, sin impacto de tipos).
  - `npx vite build` exit 0 (se usa `vite build` directo, no `npm run build`, para no disparar `postbuild`).
  - `git diff --check` sin salida (sin espacios en blanco al final de línea ni conflictos).

- [ ] **Step 5: Verificar diff acotado y commit**

  Run: `git diff --stat`

  Expected: exactamente tres archivos listados — `src/vigia/VigiaOpportunityCopilot.tsx`, `src/styles.css`, `tests/agt003-copilot-proposal-render.test.mjs` — ninguno más. Si aparece cualquier otro archivo, detenerse y revertirlo antes de continuar (`git checkout -- <archivo>`), sin commitear.

  ```bash
  git add src/vigia/VigiaOpportunityCopilot.tsx src/styles.css tests/agt003-copilot-proposal-render.test.mjs
  git commit -m "fix(agt003): rename copilot brief labels and add row hierarchy"
  ```

  Expected: commit creado sobre `fix/agt003-copilot-heading-hierarchy-20260902`; `git status --porcelain` queda limpio.
