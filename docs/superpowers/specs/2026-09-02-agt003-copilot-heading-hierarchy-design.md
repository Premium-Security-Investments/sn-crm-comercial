# AGT-003 / Vig-IA: jerarquía visual de rótulos del copiloto — diseño

**Fecha:** 2026-09-02
**Estado:** Aprobado por producto (Juan). Ajuste muy simple sobre el resultado ya generado del copiloto Vig-IA: no cambia flujo, lógica, contrato ni componentes fuera de los listados abajo.
**Alcance:** frontend puro — `src/vigia/VigiaOpportunityCopilot.tsx` (sólo el texto de tres rótulos), `src/styles.css` (sólo las reglas de `.vigia-copilot-brief-row`), y `tests/agt003-copilot-proposal-render.test.mjs` (única prueba que hoy fija el texto de esos rótulos). Ningún otro archivo.
**Rama:** `fix/agt003-copilot-heading-hierarchy-20260902`
**No toca:** `src/main.tsx`, `src/vigia/copilot-presentation.ts`, `src/vigia/opportunity-copilot-state.ts`, `src/vigia/opportunity-preflight-presentation.ts`, ningún endpoint, ninguna migración, ningún contrato de `contracts/agents/`.

## Problema

`VigiaCopilotProposal` (`src/vigia/VigiaOpportunityCopilot.tsx:63-67`) muestra hoy tres filas fijas dentro de `.vigia-copilot-brief`, rotuladas `Qué pasó` / `Falta` / `Objetivo`. Dos fricciones, ambas cosméticas:

1. **Los rótulos son ambiguos fuera de contexto.** `Falta` y `Objetivo`, sin más calificación, no dejan claro a qué se refieren cuando se leen aislados (p. ej. en una captura de pantalla o al pasar rápido la vista) — no comunican que `Falta` es información aún no confirmada por Vig-IA ni que `Objetivo` es el objetivo del **próximo** contacto, no un objetivo general de la oportunidad.
2. **El tratamiento visual actual es demasiado discreto para su función.** `.vigia-copilot-brief-row strong{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#527099}` (`src/styles.css:497`) usa un rótulo pequeño, en mayúsculas y con poco contraste de peso frente al texto que le sigue; el espacio entre el rótulo y su contenido es mínimo (`.vigia-copilot-brief-row{display:grid;gap:2px}`, `src/styles.css:496`), y las tres filas comparten un único fondo de contenedor sin ninguna marca visual por fila que ayude a diferenciarlas de un vistazo.

Ninguno de los dos problemas es funcional: el dato mostrado en cada fila (`presented.summary`/`presented.missingSummary`/`presented.contactObjective`) es correcto y no cambia.

## Objetivos

- Renombrar los tres rótulos para que cada uno comunique su función sin depender del contexto circundante.
- Dar a los tres rótulos algo más de peso visual — tamaño, grosor, separación de su contenido, marca lateral y fondo muy suave por fila — sin convertir el bloque en una tarjeta pesada ni aumentar sensiblemente su altura.
- Diferenciar visualmente las tres filas entre sí con una variación de color sobria y funcional (no decorativa al azar), sin recurrir a semántica de alarma (rojo/ámbar/verde) ni a iconografía.
- Mantener intactos el resto del resultado (`Siguiente paso`, el borrador editable, `Revisión humana`, `Contexto y evidencia`) y su comportamiento responsive.

## No objetivos

- No se cambia el dato mostrado en cada fila, ni las funciones que lo calculan (`presented.summary`, `presented.missingSummary`, `presented.contactObjective`, `summarizeMissingInformation`, `presentCopilotBrief`) — `src/vigia/copilot-presentation.ts` no se toca.
- No se cambia el orden de las filas, su cantidad, ni la estructura DOM (`<section className="vigia-copilot-brief"><div className="vigia-copilot-brief-row"><strong>…</strong><p>…</p></div>…</section>`) — sigue siendo exactamente tres filas, mismos elementos, mismo anidamiento.
- No se toca `Siguiente paso` (`.vigia-copilot-next-step`), el borrador editable (`.vigia-copilot-draft`), `Revisión humana` (`.vigia-human-warning`), las acciones de salida (`.vigia-copilot-actions`) ni `Contexto y evidencia` (`.vigia-copilot-context`) — ni su JSX ni su CSS.
- No se agrega ningún icono, badge de estado, ni indicador de tipo semáforo (rojo/ámbar/verde) a estas filas. Los colores usados son una variación sutil dentro de una paleta ya sobria (azul primario / gris neutro / índigo), nunca los tonos de alerta ya usados en otras partes del panel (`#dc2626`/`#f59e0b`/`#16a34a`, reservados para alertas comerciales y estados de error).
- No se introduce ninguna clase nueva en el JSX: la variación de color por fila se resuelve en CSS puro con selectores `:nth-child`, porque el orden de las tres filas es fijo y conocido — evita tocar el componente más allá del texto de los tres rótulos.
- **No se toca `src/main.tsx` ni `MyDayGroup` (Mi día), aunque usan literalmente las mismas tres palabras (`Qué pasó:` / `Falta:` / `Objetivo:`, `src/main.tsx:753-755`).** Es una función distinta (la cola de prioridades del día, alimentada por `buildMyDayQueue`/`MyDayAlert.fact`/`.gap`/`.goal`), no "el resultado ya generado de Vig-IA" al que se refiere este ajuste — ver «Ambigüedad resuelta».
- No se agregan breakpoints nuevos: el bloque no tiene hoy ninguna regla `@media` propia y no la necesita para este ajuste (ver «Responsive»).

## Decisión

### 1. Renombrado exacto (sólo texto, `VigiaOpportunityCopilot.tsx:64-66`)

| Antes | Después |
|---|---|
| `Qué pasó` | `Situación actual` |
| `Falta` | `Información por confirmar` |
| `Objetivo` | `Objetivo del próximo contacto` |

```tsx
<section className="vigia-copilot-brief">
  <div className="vigia-copilot-brief-row"><strong>Situación actual</strong><p>{presented.summary}</p></div>
  <div className="vigia-copilot-brief-row"><strong>Información por confirmar</strong><p>{presented.missingSummary}</p></div>
  <div className="vigia-copilot-brief-row"><strong>Objetivo del próximo contacto</strong><p>{presented.contactObjective}</p></div>
</section>
```

Cada fila sigue leyendo exactamente el mismo dato que hoy (`presented.summary`/`presented.missingSummary`/`presented.contactObjective`); el único cambio es el texto literal dentro de `<strong>`.

### 2. Tratamiento visual — enfoque editorial mínimo (`src/styles.css`)

Reglas actuales (a modificar):
```css
.vigia-copilot-brief-row{display:grid;gap:2px}
.vigia-copilot-brief-row strong{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#527099}
.vigia-copilot-brief-row p{margin:0;color:#17345b}
```

Reglas nuevas (reemplazan las dos primeras; la tercera no cambia):
```css
.vigia-copilot-brief-row{display:grid;gap:5px;padding:5px 10px 5px 12px;border-left:3px solid #cbd5e1;border-radius:0 6px 6px 0;background:#f8fafc}
.vigia-copilot-brief-row strong{font-size:14px;font-weight:700;text-transform:none;letter-spacing:normal;color:#17345b}
.vigia-copilot-brief-row p{margin:0;color:#17345b}
.vigia-copilot-brief-row:nth-child(1){border-left-color:#1b64f2;background:#f5f8ff}
.vigia-copilot-brief-row:nth-child(2){border-left-color:#64748b;background:#f8fafc}
.vigia-copilot-brief-row:nth-child(3){border-left-color:#4f46e5;background:#f7f6ff}
```

Detalle de cada requisito visual y cómo esta regla lo satisface:
- **14px, negrita, capitalización normal:** `font-size:14px` (antes 12px), `font-weight:700` (antes implícito por `<strong>`, ahora explícito para no depender del `font-weight` heredado), `text-transform:none`/`letter-spacing:normal` (antes `uppercase`/`.05em` — la tipografía en mayúsculas ya no aporta jerarquía una vez que el tamaño y el peso hacen ese trabajo, y en minúscula/capitalización normal el rótulo se lee más rápido).
- **Mayor separación respecto al contenido:** `gap` de la fila sube de `2px` a `5px` — el rótulo (`<strong>`) y su párrafo son dos elementos hermanos dentro de la misma grilla de una columna, así que `gap` es exactamente el espacio vertical entre ambos.
- **Línea lateral:** `border-left:3px solid #cbd5e1` (color base neutro, sobreescrito por fila — ver abajo), con `border-radius:0 6px 6px 0` para que la esquina izquierda de la fila, pegada al borde, quede recta y las otras tres redondeadas — evita el efecto de tarjeta cerrada por los cuatro lados.
- **Fondo muy suave por fila:** `background` pasa de vivir sólo en el contenedor `.vigia-copilot-brief` (que no cambia) a tener además un tono casi blanco por fila (`#f5f8ff`/`#f8fafc`/`#f7f6ff` — diferencias de luminosidad mínimas, perceptibles sólo al comparar filas una junto a otra).
- **Colores sobrios y accesibles con variación funcional sutil, sin semáforo:** cada fila usa un matiz ya presente en la paleta del producto y ajeno a la semántica de alerta: `#1b64f2` (azul primario, ya usado como acento informativo en el resto del panel — fila 1, hecho constatado), `#64748b` (gris/slate neutro, ya usado para texto secundario/silenciado en el mismo archivo — fila 2, información pendiente de confirmar), `#4f46e5` (índigo, ya usado como acento de categoría en otras superficies del producto — fila 3, objetivo). Ninguno de los tres coincide con los tonos de alerta ya reservados en este mismo panel (`#dc2626` rojo de error, `#f59e0b`/`#fbbf24` ámbar de `.vigia-copilot-error`, `#16a34a` verde) — la variación es puramente de identificación, nunca de urgencia o de estado aprobado/rechazado.
- **Sin iconos, sin tarjetas pesadas:** no se agrega ningún `<svg>`/emoji/pseudo-elemento de icono; el contenedor `.vigia-copilot-brief` conserva exactamente su `border`/`border-radius`/`box-shadow` actuales (ninguno de los tres cambia) — el peso visual adicional vive sólo dentro de cada fila, con un borde de 3px y un radio de 6px, muy por debajo del tratamiento de tarjeta (`border-radius:14-22px`, sombra) que usa el contenedor exterior del panel (`.vigia-opportunity-copilot`, `.vigia-copilot-brief`).
- **Sin aumentar mucho la altura:** el padding vertical nuevo es de 5px por lado y el `gap` sube 3px respecto al valor actual; sumado al medio punto adicional de tamaño de fuente (12px→14px), el alto añadido por fila es de aproximadamente 14-16px, es decir, ≈45px en total para las tres filas combinadas — un incremento perceptible pero acotado, sin aproximarse al alto de una tarjeta con padding propio de 20px+ como las que ya existen en otras superficies del producto (p. ej. `.priority-filter-tab`, `.my-day-card`).

El contenedor `.vigia-copilot-brief` (línea 495 de `src/styles.css`) no cambia ninguna declaración: sigue siendo el mismo envoltorio ligero (`padding:14px`, fondo y borde propios) alrededor de las tres filas.

## Accesibilidad

- **Contraste:** el color de texto de los rótulos y del contenido (`#17345b`) sobre cualquiera de los tres fondos nuevos (`#f5f8ff`/`#f8fafc`/`#f7f6ff`, todos casi blancos) mantiene una relación de contraste muy por encima del mínimo AA de 4.5:1 exigido para texto normal — los fondos son variaciones de luminosidad mínimas sobre blanco, no colores saturados que comprometan la lectura.
- **El color nunca es el único medio de distinción (WCAG 1.4.1):** cada fila ya tiene un rótulo de texto único y explícito (`Situación actual`/`Información por confirmar`/`Objetivo del próximo contacto`); el color de la línea lateral y el fondo son un refuerzo visual adicional, no la única señal de a qué corresponde cada fila.
- **Sin cambios de foco ni de orden de tabulación:** `<strong>` y `<p>` no son elementos interactivos, no reciben `tabIndex` ni manejadores de eventos; el orden de lectura de un lector de pantalla (rótulo seguido de su contenido, fila por fila) no cambia porque la estructura DOM es idéntica a la actual.
- **Sin iconografía que requiera `aria-hidden` ni texto alternativo:** al no agregarse ningún icono, no hay ninguna superficie nueva de accesibilidad que gestionar en este cambio.

## Responsive

`.vigia-copilot-brief`/`.vigia-copilot-brief-row` no tienen hoy ninguna regla `@media` propia — la única regla responsive del bloque del copiloto (`@media(max-width:720px){...}`, `src/styles.css:511`) afecta a `.vigia-opportunity-copilot>header`, `.vigia-copilot-evidence`, `.vigia-copilot-actions button` y `.vigia-copilot-error`, ninguno de los cuales se toca en este ajuste. Este diseño no agrega ninguna regla `@media` nueva: las tres filas siguen apiladas verticalmente en una sola columna (`display:grid` de una columna implícita) en cualquier ancho de pantalla, exactamente como hoy, y el `padding-left:12px` que deja espacio para la línea lateral es lo bastante pequeño para no causar desbordamiento ni en el ancho mínimo soportado por el resto del panel (320px). El comportamiento responsive del panel completo —incluyendo la fila de 720px ya existente— queda intacto.

## Ambigüedad resuelta

**¿Se renombran también los rótulos de "Mi día" (`MyDayGroup`, `src/main.tsx:753-755`), que usan literalmente las mismas tres palabras `Qué pasó:`/`Falta:`/`Objetivo:`?** No. Son dos features distintas que coinciden por casualidad en el texto de sus rótulos: `MyDayGroup` presenta la cola diaria de prioridades (`buildMyDayQueue`, con datos `MyDayAlert.fact`/`.gap`/`.goal`, `src/vigia/my-day-presentation.ts`), no "el resultado ya generado" del copiloto de oportunidad (`VigiaCopilotProposal`) al que se refiere este ajuste. El alcance aprobado por Juan es explícitamente el panel del copiloto; `src/main.tsx`, `MyDayGroup` y su prueba (`tests/consultant-detail-static.test.mjs:17`, que fija el texto `Qué pasó:` de esa fila) quedan fuera de este cambio y no deben tocarse.

## Criterios de aceptación (verificables)

1. `src/vigia/VigiaOpportunityCopilot.tsx` contiene exactamente los literales `<strong>Situación actual</strong>`, `<strong>Información por confirmar</strong>` y `<strong>Objetivo del próximo contacto</strong>`, en ese orden, dentro de `<section className="vigia-copilot-brief">`; no contiene `<strong>Qué pasó</strong>`, `<strong>Falta</strong>` ni `<strong>Objetivo</strong>`.
2. Ningún otro texto, prop, clase o estructura de `VigiaOpportunityCopilot.tsx` cambia: un diff del archivo muestra únicamente la sustitución de los tres literales de texto anteriores.
3. `src/styles.css` contiene, para `.vigia-copilot-brief-row`, las declaraciones exactas `gap:5px`, `padding:5px 10px 5px 12px`, `border-left:3px solid #cbd5e1` y `border-radius:0 6px 6px 0`; para `.vigia-copilot-brief-row strong`, `font-size:14px`, `font-weight:700`, `text-transform:none` y `letter-spacing:normal`; y existen las tres reglas `.vigia-copilot-brief-row:nth-child(1)`, `:nth-child(2)`, `:nth-child(3)` con `border-left-color` distinto entre sí y ninguno igual a `#dc2626`, `#f59e0b`, `#fbbf24` ni `#16a34a`.
4. `.vigia-copilot-brief` (el contenedor) no cambia ninguna declaración existente (`padding:14px`, `border-radius:14px`, `background:#f8fbff`, `border:1px solid #e2eaf5`, `gap:10px`); `.vigia-copilot-brief-row p` no cambia (`margin:0;color:#17345b`).
5. `tests/agt003-copilot-proposal-render.test.mjs` actualizado: `rows.map(r => r[1])` es igual a `['Situación actual', 'Información por confirmar', 'Objetivo del próximo contacto']`; el resto de aserciones del archivo (orden de secciones, `Siguiente paso`, ausencia de `whyBullets`, `Contexto y evidencia` sin duplicar resumen/objetivo/plan, insignias de confianza, target táctil de 44px) permanece sin cambios y sigue pasando.
6. `tests/vigia-opportunity-copilot-ui-static.test.mjs` sigue pasando sin ninguna modificación — no referencia el texto de estos tres rótulos, sólo el marcador de clase `.vigia-copilot-brief`, que no cambia.
7. `tests/consultant-detail-static.test.mjs` sigue pasando sin ninguna modificación — su aserción sobre `Qué pasó:` corresponde a `MyDayGroup` en `src/main.tsx`, fuera de alcance de este cambio.
8. `git diff --stat` de la implementación no incluye ningún archivo fuera de `src/vigia/VigiaOpportunityCopilot.tsx`, `src/styles.css` y `tests/agt003-copilot-proposal-render.test.mjs`.
9. `npx tsc --noEmit` y `node --test tests/agt003-copilot-proposal-render.test.mjs tests/vigia-opportunity-copilot-ui-static.test.mjs tests/consultant-detail-static.test.mjs` pasan sin errores.
10. QA visual (Juan): abrir una oportunidad no licitatoria, generar una propuesta con el copiloto y confirmar de un vistazo que las tres filas se leen como `Situación actual` / `Información por confirmar` / `Objetivo del próximo contacto`, con rótulo en negrita de tamaño legible, separación clara de su contenido, línea lateral y fondo suave distinguibles entre las tres filas, sin que el bloque se sienta como una tarjeta pesada ni notablemente más alto que antes.

## Archivos esperados en la implementación

- `src/vigia/VigiaOpportunityCopilot.tsx` — renombre de los tres literales de texto dentro de `.vigia-copilot-brief`; ningún otro cambio.
- `src/styles.css` — reemplazo de `.vigia-copilot-brief-row`/`.vigia-copilot-brief-row strong` y adición de las tres reglas `:nth-child`; ningún otro selector del archivo cambia.
- `tests/agt003-copilot-proposal-render.test.mjs` — actualización del arreglo esperado de rótulos (línea con `rows.map(r => r[1])`) y del comentario que los menciona; ninguna otra aserción cambia.

No se espera ningún cambio en `src/main.tsx`, `src/vigia/copilot-presentation.ts`, `src/vigia/opportunity-copilot-state.ts`, `src/vigia/opportunity-preflight-presentation.ts`, `api/`, `server/`, `contracts/agents/`, `supabase/migrations/`, ni en `tests/vigia-opportunity-copilot-ui-static.test.mjs` o `tests/consultant-detail-static.test.mjs`.
