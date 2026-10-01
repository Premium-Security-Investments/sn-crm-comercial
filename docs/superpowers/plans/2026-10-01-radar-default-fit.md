# Plan de implementación — Radar: orden por defecto "Mayor encaje primero"

**Fecha:** 2026-10-01 · **Spec:** `docs/superpowers/specs/2026-10-01-radar-default-fit.md` · **Worktree:** `/workspace`.
Ningún paso usa `git add -A` ni `git add .`. Comando de prueba verificado en `package.json`: `npm test` = `node --test tests/*.test.mjs`; `npm run build` = `check:deployment-safety && tsc && vite build`.

> Convención ya vigente: los `*.test.mjs` de este repo son scripts planos (sin `describe`/`test()`) con `assert.*` a nivel superior; `node --test` falla el archivo si algo lanza.

## Tarea 0 — Preflight (sin código)
1. `git status --porcelain` y `git rev-parse HEAD` — fijar el estado y el commit real antes de tocar nada.
2. Confirmar que `src/tenders/TenderRadarView.tsx:53-54` sigue teniendo exactamente `useState<TenderSortKey>('deadline')` / `useState<'asc' | 'desc'>('asc')` (spec §2) antes de escribir el test, para no describir un rojo que ya no existe.

## Tarea 1 (RED) — Regresión en `tests/tender-fit-frontend.test.mjs` [COMPLETADA en esta sesión]
Se añadieron al final del archivo existente (reutilizando `view`, ya leído por `readFileSync` en la cabecera del archivo, sin nueva lectura de disco):

```js
assert.match(view, /const \[sort, setSort\] = useState<TenderSortKey>\('score'\);/, 'Radar debe inicializar sort en "score" (Mayor encaje primero) por defecto');
assert.match(view, /const \[direction, setDirection\] = useState<'asc' \| 'desc'>\('desc'\);/, 'Radar debe inicializar direction en "desc" por defecto');
assert.doesNotMatch(view, /const \[sort, setSort\] = useState<TenderSortKey>\('deadline'\);/, 'Radar no debe inicializar sort en "deadline" (regresión al valor legado)');
assert.doesNotMatch(view, /const \[direction, setDirection\] = useState<'asc' \| 'desc'>\('asc'\);/, 'Radar no debe inicializar direction en "asc" (regresión al valor legado)');
assert.match(view, /<option value="score:desc">Mayor encaje primero<\/option>/, 'La opción "Mayor encaje primero" debe seguir existiendo en el selector de Orden');
```

Estas aserciones leen el código fuente de `TenderRadarView.tsx` tal cual (mismo patrón ya usado en el resto del archivo para `types.ts`/`view`), sin montar React ni DOM — consistente con el estilo "aserciones de forma sobre texto fuente" ya establecido en este archivo de test.

**Ejecutar y confirmar rojo:** `node --test tests/tender-fit-frontend.test.mjs`. Contra el `TenderRadarView.tsx` actual (`'deadline'`/`'asc'`, spec §2) las dos primeras `assert.match` deben fallar; esto es el rojo esperado de esta tarea. Ningún archivo de producción se modifica en esta tarea.

## Tarea 2 (GREEN) — Cambiar el valor inicial en `TenderRadarView.tsx` [COMPLETADA en esta sesión]
Editar únicamente `src/tenders/TenderRadarView.tsx:53-54` (spec §3):

```tsx
const [sort, setSort] = useState<TenderSortKey>('score');
const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
```

No tocar ninguna otra línea: ni el `<select>` de Orden (`:131`), ni `sortTenderCards`, ni `filterRadarTenders`, ni ningún otro `useState`.

**Ejecutar y confirmar verde:** `node --test tests/tender-fit-frontend.test.mjs`.

## Tarea 3 — Verificación integral [PENDIENTE]
```
node --test tests/*.test.mjs
npm run build
```
Confirmar manualmente (navegador o lectura del DOM renderizado): al entrar al Radar sin perfil aplicado, el selector "Orden" muestra "Mayor encaje primero" seleccionado; elegir "Cierre más próximo" en el `<select>` sigue reordenando la lista por fecha de cierre ascendente sin restricción. `git diff --stat` contra el `HEAD` de la Tarea 0 debe listar únicamente `src/tenders/TenderRadarView.tsx` y `tests/tender-fit-frontend.test.mjs`.

## Tarea 4 — Revisión de código independiente (sólo lectura) [PENDIENTE]
Invocar el skill `code-review` sobre el diff acumulado antes de cualquier commit. No escribe nada; es puerta de calidad.

## Tarea 5 — Commit (con confirmación humana antes de ejecutar) [PENDIENTE]
```
git add src/tenders/TenderRadarView.tsx tests/tender-fit-frontend.test.mjs \
  docs/superpowers/specs/2026-10-01-radar-default-fit.md \
  docs/superpowers/plans/2026-10-01-radar-default-fit.md
git status --porcelain
```
Commitear sólo con autorización explícita del usuario en ese punto de la conversación; no `push`, no tocar `main`.
