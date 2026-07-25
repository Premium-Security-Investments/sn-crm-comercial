# Task 1 — Búsquedas guardadas compactas en el Radar

## Estado

**DONE**

## Alcance entregado

- Las acciones de búsquedas guardadas viven dentro del panel compacto de filtros del Radar.
- Guardar y consultar la biblioteca se abren como diálogos modales, con `aria-haspopup`, `aria-expanded`, `aria-controls`, `aria-modal`, Escape, cierre por backdrop y contención de Tab.
- El diálogo para guardar enfoca el campo de nombre; la biblioteca enfoca de forma consistente su botón **Cerrar** y devuelve el foco al disparador al cerrarse.
- Se conserva la degradación independiente de perfiles y las actualizaciones async seguras de guardar/borrar.

## Corrección de revisión de foco

El hallazgo era real: el efecto de apertura llamaba `libraryCloseRef.current?.focus()`, pero el JSX mantenía `ref={libraryTitleRef}` en el título y no vinculaba `libraryCloseRef` al botón **Cerrar**. Se retiró la referencia obsoleta del encabezado y se asignó `ref={libraryCloseRef}` al botón de cierre.

La regresión está cubierta por `tests/tender-saved-searches-radar.test.mjs`: exige la referencia del botón, su uso en el botón con etiqueta accesible y la ausencia de `libraryTitleRef`.

## Archivos del task

- `src/tenders/components/TenderSavedSearches.tsx`
- `src/tenders/TenderRadarView.tsx`
- `src/styles.css`
- `tests/tender-saved-searches-radar.test.mjs`

## Evidencia RED heredada

Después de convertir el hallazgo heredado en una expectativa explícita de prueba, y antes de corregir el JSX:

```text
$ node tests/tender-saved-searches-radar.test.mjs
AssertionError [ERR_ASSERTION]: Al abrir la biblioteca, el foco debe ir al botón Cerrar, no al título.
expected: /ref=\{libraryCloseRef\}[^>]*aria-label="Cerrar búsquedas guardadas"/
exit 1
```

El estado original también contenía `ref={libraryTitleRef}` sin declaración, mientras que `libraryCloseRef` sí estaba declarado y era el destino del efecto de foco.

## Evidencia GREEN exacta

```text
$ node tests/tender-saved-searches-radar.test.mjs
Tender saved searches are managed inside Radar with independent degradation and async-safe updates
exit 0

$ node tests/tender-filter-compact-layout.test.mjs
Tender compact filter layout expectations passed
exit 0

$ npm run build
> seguridad-nacional-sales-crm-web@0.1.0 build
> tsc && vite build
✓ built in 431ms
exit 0

$ git diff --check
exit 0
```

## Revisión del diff

- Se revisaron los cuatro archivos del task.
- No hay referencias restantes a `libraryTitleRef`.
- El foco inicial de biblioteca coincide ahora con el `libraryCloseRef` montado.
- El panel de perfiles no se renderiza hasta abrir la biblioteca.
- `git diff --check` no reportó errores de whitespace.

## Commit

- `d8630b1facde3b81b8651e9c9dd5bfadd7696098` — `feat(tenders): compact saved searches in radar`
- El commit contiene exclusivamente los cuatro archivos listados arriba.

## Concern conocido

Vite emitió el warning preexistente de un chunk JavaScript mayor de 500 kB tras minificación. No bloquea el build y no está relacionado con este cambio.

## Fix de revisión — feedback accesible en diálogos

### Causa y corrección

El único render de `message` estaba fuera de ambos diálogos. Con el backdrop modal activo, una validación de nombre vacío, un fallo de guardado o un fallo de eliminación quedaban ocultos visualmente y fuera del contexto modal accesible.

- El aviso `role="status"` ahora se renderiza sólo cuando `saveOpen` y `libraryOpen` están cerrados; el éxito de guardado sigue anunciándose después de cerrar el diálogo.
- La validación/fallo de **Guardar búsqueda** se renderiza dentro de ese diálogo con `role="alert"`.
- El fallo de **Eliminar** se renderiza dentro de la biblioteca activa con `role="alert"`.
- Abrir cualquiera de los diálogos limpia el aviso anterior para que un éxito ya anunciado no reaparezca como alerta.

### Regresión RED/GREEN y verificación

Se añadió una regresión focalizada en `tests/tender-saved-searches-radar.test.mjs` que exige el éxito fuera sólo con ambos diálogos cerrados y los dos avisos de error dentro de su diálogo activo con `role="alert"`.

```text
$ node tests/tender-saved-searches-radar.test.mjs
AssertionError [ERR_ASSERTION]: El éxito solo debe anunciarse fuera cuando ambos diálogos estén cerrados.
exit 1

$ node tests/tender-saved-searches-radar.test.mjs
Tender saved searches are managed inside Radar with independent degradation and async-safe updates
exit 0

$ node tests/tender-filter-compact-layout.test.mjs
Tender compact filter layout expectations passed
exit 0

$ npm run build
> tsc && vite build
✓ built in 398ms
exit 0

$ git diff --check
exit 0
```

El build conserva el warning preexistente de Vite sobre un chunk mayor de 500 kB; no introduce errores ni está relacionado con este fix.
