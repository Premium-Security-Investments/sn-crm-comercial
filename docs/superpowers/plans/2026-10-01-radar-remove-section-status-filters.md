# Plan de implementación — Radar: retirar filtros "Sección" y "Estado interno"

**Fecha:** 2026-10-01 · **Spec:** `docs/superpowers/specs/2026-10-01-radar-remove-section-status-filters.md` · **Worktree:** `/workspace`.
Ningún paso usa `git add -A` ni `git add .`. Comando de prueba verificado en `package.json`: `npm test` = `node --test tests/*.test.mjs`; `npm run build` = `check:deployment-safety && tsc && vite build`.

> Convención ya vigente: los `*.test.mjs` de este repo son scripts planos (sin `describe`/`test()`) con `assert.*` a nivel superior; `node --test` falla el archivo si algo lanza.

## Tarea 0 — Preflight (sin código) [COMPLETADA en esta sesión]
1. Confirmar `git status --porcelain` limpio antes de tocar nada.
2. Leer `src/tenders/TenderRadarView.tsx` y `src/styles.css` completos y confirmar que coinciden con la spec §2 (ocho `<select>`, `tender-filter-section`/`tender-filter-status` presentes, `applyProfile` aplicando `section_filter`/`internal_status_filter`, `.tender-filter-order{grid-column:span 4}`) antes de describir un rojo que ya no existiera.

## Tarea 1 (RED) — Reescribir `tests/tender-filter-compact-layout.test.mjs` [ESTA SESIÓN]

**Files:**
- Modify: `tests/tender-filter-compact-layout.test.mjs`
- Read only: `src/tenders/TenderRadarView.tsx`, `src/styles.css` (no se modifican en esta tarea)

El archivo existente cubría nueve controles (incluyendo Sección y Estado interno). Se reemplaza su contenido para expresar el estado deseado:

- Exactamente **seis** `<select>` dentro del panel `tender-control-panel` (antes de `tender-source-diagnostics`).
- Las seis clases restantes (`tender-filter-source`, `tender-filter-region`, `tender-filter-deadline`, `tender-filter-value`, `tender-filter-score`, `tender-filter-order`) y sus handlers (`setSource`, `setRegion`, `setDeadline`, `setValue`, `setScore`, `setSort`, `setDirection`) siguen presentes.
- Ausencia total en `TenderRadarView.tsx` de: la clase `tender-filter-section`, la clase `tender-filter-status`, el handler `setSection`, el handler `setInternalStatus`, y la aplicación de perfil `profile.section_filter` / `profile.internal_status_filter`.
- Ausencia de las etiquetas de texto "Sección" y "Estado interno" dentro del panel de filtros.
- CSS: la grilla de 12 columnas y la búsqueda en `span 6` se mantienen; la lista de `span 2` sólo enumera los cinco filtros secundarios restantes (sin `tender-filter-section` ni `tender-filter-status`); `.tender-filter-order` pasa a `span 8` en escritorio; ninguna regla de CSS menciona `tender-filter-section` ni `tender-filter-status`; tablet y móvil conservan sus reglas genéricas y la altura táctil mínima de 44px.

**Ejecutar y confirmar rojo:** `node --test tests/tender-filter-compact-layout.test.mjs`. Contra el `TenderRadarView.tsx`/`styles.css` actuales (spec §2) deben fallar, como mínimo: el conteo de seis `<select>` (hoy hay ocho), la ausencia de `tender-filter-section`/`tender-filter-status` (hoy existen), la ausencia de `profile.section_filter`/`profile.internal_status_filter` (hoy existen en `applyProfile`), la lista CSS de `span 2` sin Sección/Estado interno (hoy los incluye) y `.tender-filter-order{grid-column:span 8}` (hoy es `span 4`). Esto es el rojo esperado de esta tarea. **No se modifica ningún archivo de producción (`TenderRadarView.tsx`, `styles.css`) en esta tarea.**

## Tarea 2 (GREEN) — Implementar en `TenderRadarView.tsx` y `styles.css` [PENDIENTE, próxima sesión]

**Files:**
- Modify: `src/tenders/TenderRadarView.tsx` (líneas `51-52`, `71-76`, `82`, `115-117`, `129`, `131` según numeración de la spec §2)
- Modify: `src/styles.css` (líneas `374-375`)
- Test: `tests/tender-filter-compact-layout.test.mjs`

Pasos (spec §3):
1. Sustituir `const [section, setSection] = useState(...)` y `const [internalStatus, setInternalStatus] = useState(...)` por constantes fijas `const section = 'todas' as const;` / `const internalStatus = 'todas' as const;` (o equivalente tipado), manteniendo el nombre de variable para no tocar `filterRadarTenders`, el objeto `filters` ni los `useEffect` existentes más de lo imprescindible.
2. Quitar `setSection(...)`/`setInternalStatus(...)` de `applyProfile`.
3. Quitar `section`/`internalStatus` de los arreglos de dependencias que ya no cambian (si el linter/TS lo exige; si no, dejarlos no rompe nada porque son constantes).
4. Eliminar del JSX las dos etiquetas `<label className="tender-filter tender-filter-section">...</label>` y `<label className="tender-filter tender-filter-status">...</label>`.
5. En `styles.css`, quitar `.tender-filter-section` y `.tender-filter-status` de la línea `374` y cambiar `.tender-filter-order{grid-column:span 4}` a `span 8` en la línea `375`.

**Ejecutar y confirmar verde:** `node --test tests/tender-filter-compact-layout.test.mjs`.

## Tarea 3 — Verificación integral [PENDIENTE]
```
node --test tests/*.test.mjs
npm run build
```
Confirmar manualmente en escritorio (1440px) y móvil (390px):
- Seis controles visibles, sin Sección ni Estado interno, sin salto de línea extraño ni hueco visual en la segunda fila.
- Un perfil guardado (nuevo o preexistente) se puede aplicar sin que cambie una sección/estado interno visible (porque ya no existen como filtro).
- Insignias de estado de tarjeta (`statusLabel`), acciones de tarjeta (seguimiento/convertir/abrir expediente/oportunidad) y el flujo de conversión no cambian.
- Consola sin errores, cero escrituras API inesperadas.

`git diff --stat` contra el `HEAD` de la Tarea 0 debe listar únicamente `src/tenders/TenderRadarView.tsx`, `src/styles.css` y `tests/tender-filter-compact-layout.test.mjs` (más los dos documentos de esta sesión si no se commitearon ya en la Tarea 1).

## Tarea 4 — Revisión de código independiente (sólo lectura) [PENDIENTE]
Invocar el skill `code-review` sobre el diff acumulado antes de cualquier commit de la fase GREEN. No escribe nada; es puerta de calidad.

## Tarea 5 — Commits (con confirmación humana antes de cada uno) [PENDIENTE]

Commit del RED (esta sesión, al cierre):
```bash
git add tests/tender-filter-compact-layout.test.mjs \
  docs/superpowers/specs/2026-10-01-radar-remove-section-status-filters.md \
  docs/superpowers/plans/2026-10-01-radar-remove-section-status-filters.md
git status --porcelain
```

Commit del GREEN (próxima sesión, tras Tarea 3 y Tarea 4):
```bash
git add src/tenders/TenderRadarView.tsx src/styles.css tests/tender-filter-compact-layout.test.mjs
git status --porcelain
```

Commitear sólo con autorización explícita del usuario en cada punto de la conversación; no `push`, no tocar `main`.
