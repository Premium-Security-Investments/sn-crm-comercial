# Especificación — Radar de Licitaciones: orden por defecto "Mayor encaje primero"

**Fecha:** 2026-10-01
**Repositorio:** `Premium-Security-Investments/sn-crm-comercial` (worktree `/workspace`)
**Naturaleza:** diseño y especificación técnica. Este documento no implementa código, no modifica datos ni configuración, no ejecuta migraciones y no despliega producción.
**Plan asociado:** `docs/superpowers/plans/2026-10-01-radar-default-fit.md`
**Estado:** aprobado por el usuario/product owner para esta sesión (alcance acotado según se describe en §4).

> **Convención de evidencia:** **[EXISTE]** significa verificado leyendo el código de este árbol de trabajo; **[PROPUESTO]** significa diseño aún no implementado.

## 1. Propósito

Al entrar por primera vez al Radar, el selector "Orden" abre hoy en "Cierre más próximo" (`sort='deadline', direction='asc'`). El usuario pidió que el Radar abra, por defecto, en **"Mayor encaje primero"** (`sort='score', direction='desc'`), dejando "Cierre más próximo" disponible exactamente como hoy: una opción más del mismo `<select>`, seleccionable manualmente en cualquier momento.

Este cambio es puramente de **valor inicial de estado de React** en un componente de presentación. No toca la política de encaje (`tender.fit`), el comparador `sortTenderCards`, los filtros, las búsquedas guardadas, el backend, los datos ni ningún script de despliegue.

## 2. Estado actual verificado

**[EXISTE]** `TenderRadarView` (`src/tenders/TenderRadarView.tsx:53-54`) declara:

```tsx
const [sort, setSort] = useState<TenderSortKey>('deadline');
const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
```

**[EXISTE]** El selector "Orden" (`src/tenders/TenderRadarView.tsx:131`) ya contiene las cinco opciones, sin cambios necesarios en esta lista:

```html
<option value="deadline:asc">Cierre más próximo</option>
<option value="value:desc">Mayor valor primero</option>
<option value="score:desc">Mayor encaje primero</option>
<option value="entity:asc">Entidad A-Z</option>
<option value="source:asc">Fuente A-Z</option>
```

El valor del `<select>` es `${sort}:${direction}`; su `onChange` ya separa el valor elegido en `setSort`/`setDirection` sin restricción alguna — cualquier opción, incluida `deadline:asc`, sigue siendo seleccionable manualmente después de este cambio, exactamente como hoy.

**[EXISTE]** `TenderSortKey` (`src/tenders/types.ts:21`) ya incluye `'score'` como valor válido; no se requiere ningún cambio de tipos.

**[EXISTE]** `sortTenderCards` (`src/tenders/radarUtils.ts`) ya resuelve la clave `'score'` leyendo `tender.fit?.score ?? tender.score ?? 0` (introducido en `docs/superpowers/specs/2026-09-20-radar-fit-feedback-design.md`); este diseño no modifica esa función.

## 3. Cambio propuesto [PROPUESTO]

Cambiar únicamente los dos valores iniciales de `useState` en `src/tenders/TenderRadarView.tsx:53-54`:

```tsx
const [sort, setSort] = useState<TenderSortKey>('score');
const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
```

Ningún otro carácter de esas líneas cambia. No se reordena el `<select>`, no se renombra ninguna opción, no se añade lógica condicional.

## 4. No-alcance

- No se modifica `sortTenderCards`, `filterRadarTenders` ni ninguna otra función de `src/tenders/radarUtils.ts`.
- No se modifica la fórmula ni el comparador de `tender-fit-policy.js`, ni `tender.fit`.
- No se modifican filtros (`score`, `deadline`, `value`, `región`, `sección`, `estado interno`) ni su comportamiento.
- No se modifican búsquedas guardadas (`TenderSavedSearches`, perfiles, `applyProfile`) — un perfil guardado que fije `sort`/`direction` propios (si en el futuro existiera esa capacidad) seguiría teniendo prioridad sobre el valor inicial, porque `applyProfile` se ejecuta después del montaje; hoy los perfiles no incluyen `sort`/`direction`, así que esto es una observación de diseño, no un cambio de comportamiento.
- No se modifica backend, datos, scripts de despliegue, temporizadores (`useEffect` de paginación) ni el módulo de oportunidades.
- No se añade, quita ni reordena ninguna opción del `<select>` "Orden". "Cierre más próximo" sigue siendo la primera opción en el DOM y sigue siendo seleccionable manualmente sin restricción.
- No se cambia el texto de ninguna etiqueta ni opción existente.

## 5. Verificación exigida (resumen; detalle en el plan)

- `tests/tender-fit-frontend.test.mjs` (regresión añadida en esta sesión, RED antes del cambio de producción, GREEN después).
- `node --test tests/*.test.mjs` completo antes de cualquier commit.
- `npm run build` (`tsc && vite build`) para confirmar que el tipo `TenderSortKey` acepta `'score'` sin error (ya lo acepta, §2).
- Revisión manual: "Cierre más próximo" sigue siendo seleccionable y reordena la lista exactamente como antes.
