# Plan de implementación — AGT-003 / Vig-IA: seguimiento integrado v1 ("Mi día")

**Fecha:** 2026-09-02
**Diseño base:** `docs/superpowers/specs/2026-09-02-agt003-integrated-followup-v1-design.md`
**Rama:** `feat/agt003-integrated-followup-v1-20260902`
**Método:** TDD por vertical slices, RED → GREEN en cada slice, sin dejar ningún slice a medio terminar antes de pasar al siguiente. Cada slice es desplegable de forma independiente (no rompe la suite existente al terminar).

Convención de comandos: usar `node --test <archivo>` para correr un test puntual durante RED/GREEN. **No se ejecuta `npm test`/la suite completa del repositorio en ningún punto de este plan** — hay antecedente confirmado de OOM al correrla completa. Al cierre de cada slice y al final del plan se corre en su lugar la suite focal AGT-003/Vig-IA en forma segura: `node --test tests/agt003-*.test.mjs tests/vigia-*.test.mjs tests/consultant-detail-static.test.mjs` (glob que cubre los cinco archivos tocados/creados por este plan, más `tests/consultant-detail-static.test.mjs` que no calza con ninguno de los dos globs), seguida de `npx tsc --noEmit`, `npm run check:backend-parity`, `npm run check:siio-integration`, `npm run build` y `git diff --check`.

---

## Slice 0 — Corrección de huso horario en `vigia-engine.js`

**Por qué primero:** es la corrección de bug más aislada e independiente (una sola función pura, cero dependientes nuevos), y no depende de ningún otro slice. Hacerla primero evita que el ranking de `Mi día` (slice 2) se construya sobre una base horaria todavía incorrecta en el motor gerencial adyacente.

### RED

1. Abrir `tests/vigia-engine.test.mjs` y agregar un caso nuevo (no modificar los existentes) que reproduzca el desfase nocturno descrito en el diseño:
   ```js
   test('no marca close_overdue para un cierre de HOY evaluado de noche en Bogotá (no en UTC)', () => {
     const rows = [{ id: 'row-bogota-night', stage_code: 'prospecto', expected_close_date: '2026-09-02',
       next_action_at: null, offer_value: 1, regional_nombre: 'Bogotá', updated_at: '2026-09-02T10:00:00Z' }];
     // 2026-09-02T23:30:00-05:00 == 2026-09-03T04:30:00Z: son las 11:30pm en Bogotá, sigue siendo "hoy" 2 de sept.
     const [priority] = prioritizeVigiaOpportunities(rows, { now: '2026-09-02T23:30:00-05:00' });
     assert.ok(!priority.signal_codes.includes('close_overdue'), 'un cierre "hoy" en Bogotá no debe verse como vencido por culpa del reloj UTC');
   });
   test('marca close_overdue para un cierre ya pasado en Bogotá, evaluado a la misma hora', () => {
     const rows = [{ id: 'row-bogota-past', stage_code: 'prospecto', expected_close_date: '2026-09-01',
       next_action_at: null, offer_value: 1, regional_nombre: 'Bogotá', updated_at: '2026-09-01T10:00:00Z' }];
     const [priority] = prioritizeVigiaOpportunities(rows, { now: '2026-09-02T23:30:00-05:00' });
     assert.ok(priority.signal_codes.includes('close_overdue'), 'un cierre de ayer en Bogotá sigue vencido, el fix no debe volverlo permisivo');
   });
   ```
   Ejecutar `node --test tests/vigia-engine.test.mjs` y confirmar que el primer caso **falla** (el bug hoy hace que `close_overdue` se dispare de más) y el segundo **pasa** ya antes del fix (control negativo, para no arreglar el bug "apagando" la detección real de vencidos).

### GREEN

2. En `vigia-engine.js`, agregar el formateador `BOGOTA_DATE` y reescribir `dayStart` exactamente como especifica la sección 1 del diseño (import de `Intl.DateTimeFormat`, sin dependencias nuevas). No tocar `daysBetween`, `activityEvidence`, `levelFor`, `recommendationFor`, ni la forma de `signals`/`evidence`/`score`.
3. `node --test tests/vigia-engine.test.mjs` → verde, incluidos los dos casos nuevos y todos los preexistentes sin modificar sus aserciones.
4. `node --test tests/agt003-priorities-service-p3b2.test.mjs tests/agent-agt003-synthetic-parity-p3b2.test.mjs tests/agent-contracts-p1a.test.mjs` → verde sin cambios (confirma que el fix no rompe la paridad sintética ni los pines de manifiesto/esquema, que son hashes de archivos JSON no tocados).

### Criterio observable de cierre del slice

`git diff --stat` muestra únicamente `vigia-engine.js` y `tests/vigia-engine.test.mjs`. Ningún archivo de `api/`, `server/`, `contracts/` en el diff.

---

## Slice 1 — Corrección de huso horario en `opportunity-ficha-presentation.ts`

**Depende de:** nada del slice 0 (son módulos independientes); se hace después sólo por orden narrativo del diseño.

### RED

1. Abrir `tests/agt003-ficha-presentation.test.mjs` y agregar (sin tocar los casos existentes):
   ```js
   test('nextActionCardState no marca "overdue" para una próxima gestión de HOY evaluada de noche en Bogotá', () => {
     const now = new Date('2026-09-02T23:30:00-05:00'); // 2026-09-03T04:30:00Z
     const state = nextActionCardState({ stage_code: 'prospecto', next_action_at: '2026-09-02T15:00:00-05:00' }, now);
     assert.equal(state.code, 'today', 'una gestión agendada hoy en Bogotá no debe verse como vencida por el reloj UTC');
   });
   test('calendarDaysBetween es estable frente al huso del proceso (no depende de TZ del runtime)', () => {
     const now = new Date('2026-09-02T23:30:00-05:00');
     assert.equal(calendarDaysBetween('2026-09-02', now), 0);
   });
   ```
   `node --test tests/agt003-ficha-presentation.test.mjs` (vía el mismo arnés de `buildSync`/import dinámico que ya usa el archivo) → confirmar que el primer caso **falla** hoy (el bug reporta `overdue` en vez de `today` porque `now.getFullYear()/getMonth()/getDate()` lee el huso del proceso, que en CI puede ser UTC).

### GREEN

2. En `src/vigia/opportunity-ficha-presentation.ts`, agregar `BOGOTA_DAY`/`bogotaDayUtcMs` y reescribir `startOfCalendarDay`/`calendarDaysBetween` exactamente como especifica la sección 1 del diseño. `startOfCalendarDay` deja de estar tipada `Date | null` y pasa a `number | null` (ms UTC del día de Bogotá); no está exportada, así que no hay consumidores externos que actualizar. `calendarDaysBetween` conserva su firma pública (`(value, now) => number | null`).
3. `node --test tests/agt003-ficha-presentation.test.mjs` → verde, incluidos los casos nuevos y **todos** los existentes (tono, `humanDayCount`, `followUpAgeLabel`, `presentFollowUpEntry`) sin tocar sus aserciones.

### Criterio observable de cierre del slice

`git diff --stat` muestra únicamente `src/vigia/opportunity-ficha-presentation.ts` y `tests/agt003-ficha-presentation.test.mjs`. `npx tsc --noEmit` en verde (confirma que el cambio de tipo interno de `startOfCalendarDay` no rompe ningún otro archivo — no debería, porque no está exportada).

---

## Slice 2 — Módulo puro `buildMyDayQueue` (`src/vigia/my-day-presentation.ts`)

**Depende de:** slice 1 (importa `nextActionCardState`/`decisionMakerCardState`, ya corregidos a Bogotá).

### RED

1. Crear `tests/agt003-my-day-presentation.test.mjs` (mismo arnés `esbuild.buildSync` + `import()` dinámico que `tests/agt003-ficha-presentation.test.mjs`, para poder testear el `.ts` directamente sin paso de build previo). Casos, todos sobre `buildMyDayQueue`:
   - **Exclusión de tenders:** una fila con `service_type_code: 'licitacion_publica'` y `next_action_at` vencido nunca aparece en ningún balde.
   - **Exclusión de etapas terminales:** `stage_code: 'aprobado'`/`'perdido'`/`'descartado'` con `next_action_at` vencido nunca aparece en ningún balde.
   - **Balde `hacer_hoy` — elegibilidad:** una fila con `next_action_at` en el pasado cae en `hacer_hoy`; una fila con `next_action_at: null` también; una fila con `next_action_at` en el futuro no cae en ningún balde por esta regla.
   - **Ranking `hacer_hoy` — desempate 1 (vencida antes que faltante):** dos filas, una `overdue` y otra `missing`, mismo `offer_value`; la `overdue` debe quedar primero.
   - **Ranking `hacer_hoy` — desempate 2 (valor):** dos filas `overdue`, `offer_value` distinto; la de mayor valor primero.
   - **Ranking `hacer_hoy` — desempate 3 (etapa):** dos filas `overdue`, mismo `offer_value`, `stage_order` distinto; la de `stage_order` mayor primero.
   - **Ranking `hacer_hoy` — desempate 4 y 5 (nombre, id):** dos filas idénticas en todo lo anterior; ordenar por `company_name` (`localeCompare('es')`) y, si empatan, por `id`.
   - **Requisito explícito — valor/regional faltante NO desplaza:** una fila `overdue` con `regional_nombre: null` y `offer_value: null` debe seguir apareciendo en `hacer_hoy` (nunca excluida, nunca recategorizada a `depurar_crm` habiendo calificado ya para `hacer_hoy`) — construir el caso con `offer_value: null` explícito para probar que no lanza ni la excluye. Esta prueba es deliberadamente independiente del desempate 2 de abajo: no mezcla "`offer_value: null`" con "alto valor" en la misma fila — el desempate 2 (dos filas `overdue`/`missing` con `offer_value` presente pero distinto) ya cubre por separado que, dentro del mismo estado, valor alto ordena antes que valor bajo.
   - **Tope de `hacer_hoy`:** 5 filas elegibles → `hacerHoy.length === 3`, `hacerHoyTotal === 5`.
   - **Balde `preparar` — elegibilidad y exclusión mutua:** una fila en `stage_code: 'sustentacion'`, `next_action_at` futuro (no elegible para `hacer_hoy`), `decision_maker_email: null` → cae en `preparar`. La misma fila pero además con `next_action_at` vencido → cae en `hacer_hoy`, no en `preparar` (no se duplica).
   - **`preparar` incluye `envio_oferta`:** una fila en `stage_code: 'envio_oferta'`, `next_action_at` futuro, decisor incompleto → cae en `preparar` igual que `sustentacion`/`negociacion` (cubre el hallazgo de auditoría de que esa etapa concentra riesgo por falta de decisor).
   - **`preparar` no elegible con decisor completo:** `stage_code: 'negociacion'`, decisor completo → no aparece en `preparar` (ni en ningún otro balde si tampoco califica para los otros dos).
   - **Balde `depurar_crm` — elegibilidad y exclusión mutua:** una fila fuera de `hacer_hoy`/`preparar` con `offer_value: 0` → cae en `depurar_crm`; una con `regional_nombre: ''` → también; una fila que ya calificó para `preparar` con `offer_value: 0` a la vez → aparece sólo en `preparar`, no en `depurar_crm`.
   - **Topes de `preparar`/`depurar_crm`:** mismo patrón de `*Total` vs. longitud truncada que `hacer_hoy` (con 3 y 5 respectivamente).
   - **Contenido de cada alerta:** para un caso `overdue`, `missing`, `preparar` y `depurar_crm`, verificar `fact`/`gap`/`goal` contra el texto exacto de la tabla del diseño (no substrings sueltos: comparar la cadena completa donde el diseño la especifica literalmente, p. ej. `gap === 'La fecha pasó y no hay una próxima acción vigente.'` y `goal === 'Registrar el resultado pendiente, si aplica, y agendar la próxima gestión.'` para el caso `overdue`).
   - **`ctaHref`:** siempre `` `#/detail/${id}?focus=interaction` ``, verificado en al menos un caso de cada balde.
   - **Pureza:** llamar `buildMyDayQueue(opportunities, now)` dos veces con el mismo `structuredClone` del input y comparar `deepEqual` de ambas salidas (determinismo); además, congelar (`Object.freeze`) el arreglo de entrada y cada fila antes de llamar, y confirmar que la llamada no lanza (si mutara, lanzaría en modo estricto).
   - **Entrada vacía:** `buildMyDayQueue([])` devuelve los tres arreglos vacíos y los tres `*Total` en `0`, sin lanzar.
2. `node --test tests/agt003-my-day-presentation.test.mjs` → falla (el módulo no existe todavía: `Cannot find module`).

### GREEN

3. Crear `src/vigia/my-day-presentation.ts` exactamente según la sección 2 del diseño: tipos `MyDayBucket`/`MyDayAlert`/`MyDayQueue`/`MyDayOpportunity`, constantes `HACER_HOY_LIMIT`/`PREPARAR_LIMIT`/`DEPURAR_LIMIT`/`TERMINAL_STAGES`/`ADVANCED_STAGES` (`['sustentacion', 'negociacion', 'envio_oferta']`), y `buildMyDayQueue`. Reutilizar sólo `nextActionCardState`/`decisionMakerCardState` importados de `./opportunity-ficha-presentation` (no importar `expectedCloseCardState`: el diseño no lo usa en ningún balde); no reimplementar ninguna de sus reglas.
4. `node --test tests/agt003-my-day-presentation.test.mjs` → verde, todos los casos.
5. `npx tsc --noEmit` → verde.

### Criterio observable de cierre del slice

`git diff --stat` muestra sólo `src/vigia/my-day-presentation.ts` (nuevo) y `tests/agt003-my-day-presentation.test.mjs` (nuevo). El módulo no importa React, no importa nada de `api/`/`server/`, no toca `window`/`document`.

---

## Slice 3 — Advertencia no bloqueante en `FollowUpForm`

**Depende de:** nada de los slices anteriores (cambio aislado en `main.tsx`); se ordena aquí porque es rápido y desbloquea el slice 4 (que también toca `main.tsx`) sin pisarse.

### RED

1. En `tests/agt003-followup-form-copy-static.test.mjs`, agregar un bloque `9)` (después del bloque `8)` existente, sin tocar los anteriores):
   ```js
   // 9) guardar sin próxima acción advierte, sin bloquear el envío ni completar la fecha automáticamente.
   assert.match(
     followUp,
     /setStatus\(form\.next_action_at \? 'Seguimiento registrado\.' : 'Seguimiento registrado\. Falta agendar la próxima gestión\.'\)/,
     'guardar sin próxima acción debe mostrar una advertencia breve, sin bloquear el guardado',
   );
   assert.doesNotMatch(followUp, /next_action_at:\s*form\.next_action_at \|\| new Date/, 'nunca se debe inventar ni completar automáticamente la próxima acción');
   ```
2. `node --test tests/agt003-followup-form-copy-static.test.mjs` → falla en la primera aserción nueva (el `setStatus('Seguimiento registrado.')` incondicional actual no calza con el patrón).

### GREEN

3. En `src/main.tsx`, dentro de `FollowUpForm::save`, reemplazar el `setStatus('Seguimiento registrado.')` incondicional por la expresión condicional exacta de la sección 4 del diseño. No tocar el resto de `save` (endpoint, payload, manejo de error).
4. `node --test tests/agt003-followup-form-copy-static.test.mjs` → verde, incluidos los 8 bloques preexistentes sin modificar.

### Criterio observable de cierre del slice

`git diff --stat` muestra sólo `src/main.tsx` (una línea) y `tests/agt003-followup-form-copy-static.test.mjs`.

---

## Slice 4 — Integración de "Mi día" en `ConsultantDetail`

**Depende de:** slice 2 (el módulo `my-day-presentation.ts` debe existir) y slice 3 (evita conflictos de edición simultánea sobre `main.tsx`).

### RED

1. En `tests/consultant-detail-static.test.mjs`, reemplazar las aserciones que apuntan al banner retirado y agregar las nuevas, conservando las que siguen aplicando:
   ```js
   assert.match(source, /import \{ buildMyDayQueue \} from '\.\/vigia\/my-day-presentation';/);
   assert.match(source, /const myDay = useMemo\(\s*\(\) => buildMyDayQueue\(opportunities, new Date\(\)\),\s*\[opportunities\],\s*\);/);
   assert.match(source, /<h2>Mi día<\/h2>|Mi día/); // eyebrow/título del banner renombrado
   assert.ok(!source.includes('Gestión comercial de hoy'), 'el banner anterior debe quedar retirado');
   assert.match(source, /function MyDayGroup\(/);
   assert.match(source, /Preparar seguimiento/);
   assert.match(source, /className="my-day-hygiene"/);
   // se conservan sin cambios:
   assert.match(source, /personalFollowUpCards/, 'los 4 chips agregados (Vencidas/Para hoy/Sin agenda/Valor en riesgo) se conservan');
   assert.match(source, /focusFollowUpFilter/, 'el enfoque de la tabla de críticas por chip se conserva');
   assert.ok(!source.includes('commercial-followup-list'), 'la lista plana reemplazada por Mi día no debe sobrevivir');
   ```
   Ajustar/eliminar la aserción preexistente `Registrar seguimiento` de este archivo sólo si deja de aparecer literalmente en el banner (sigue existiendo en otras partes de `main.tsx`, p. ej. `VigiaCommercial.tsx`/otros CTAs — verificar con una búsqueda de texto antes de decidir si la aserción genérica sigue siendo válida o debe apuntar a `Preparar seguimiento` específicamente dentro del banner).
2. `node --test tests/consultant-detail-static.test.mjs` → falla (el código fuente todavía no tiene `Mi día`/`buildMyDayQueue`/`MyDayGroup`).

### GREEN

3. En `src/main.tsx`:
   - Agregar el import `import { buildMyDayQueue, type MyDayAlert } from './vigia/my-day-presentation';` junto a los demás imports de `./vigia/*`.
   - Dentro de `ConsultantDetail`, agregar `const myDay = useMemo(() => buildMyDayQueue(opportunities, new Date()), [opportunities]);` (después de la declaración de `opportunities`, antes de su primer uso en JSX).
   - Agregar el componente local `MyDayGroup` (fuera de `ConsultantDetail`, junto a otros componentes co-ubicados como `Badge`/`Panel`).
   - Reemplazar el bloque `<div className="commercial-followup-list">...</div>` (`src/main.tsx:2359-2364`) por el bloque `<div className="my-day">...</div>` de la sección 3 del diseño, y renombrar el eyebrow/`<h3>` del banner de "Gestión comercial de hoy" a "Mi día" (conservando el resto de `commercial-followup-copy`/`commercial-followup-cards` sin cambios).
4. `node --test tests/consultant-detail-static.test.mjs` → verde.
5. `npx tsc --noEmit` → verde (confirma que `MyDayAlert`/`buildMyDayQueue` casan con el tipo `Opportunity` de `main.tsx` sin castings — `Opportunity` ya trae todos los campos que pide `MyDayOpportunity`).

### Verificación de comportamiento (no sólo estática)

6. Con `npm run dev` corriendo localmente (o el harness de preview del repo si aplica), navegar a `#/consultant` (vista personal) con un usuario comercial que tenga al menos una oportunidad activa no licitatoria con `next_action_at` vencido o ausente, y confirmar visualmente: máximo 3 tarjetas en "Hacer hoy", "Depurar CRM" colapsado por defecto, y que "Preparar seguimiento" navega a la ficha con el foco en `Seguimiento comercial`. Documentar el resultado en la entrega (capturas o descripción), sin marcarlo como QA visual autenticado formal (eso sigue pendiente de Juan).

### Criterio observable de cierre del slice

`git diff --stat` muestra `src/main.tsx` y `tests/consultant-detail-static.test.mjs`. `grep -n "commercial-followup-list" src/main.tsx` no devuelve resultados.

---

## Slice 5 — CSS y limpieza final

**Depende de:** slice 4 (las clases `.my-day-*` deben existir ya en el JSX para que el CSS tenga selector).

### RED

1. Extender (o crear, si no existe uno de estilos estáticos para este bloque) una aserción sobre `src/styles.css` — puede vivir como bloque adicional en `tests/consultant-detail-static.test.mjs` o en un test nuevo `tests/agt003-my-day-static.test.mjs`, a criterio de quien implemente, prefiriendo reutilizar el archivo existente si no crece desproporcionadamente:
   ```js
   const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
   assert.match(css, /\.my-day\{/);
   assert.match(css, /\.my-day-card\{/);
   assert.ok(!css.includes('.commercial-followup-list{'), 'la regla sin selector debe retirarse junto con el JSX que la usaba');
   ```
2. `node --test` sobre ese archivo → falla (CSS todavía no existe).

### GREEN

3. Agregar el bloque CSS de la sección "CSS (aditivo)" del diseño al final de `src/styles.css`; retirar las reglas `.commercial-followup-list`, `.commercial-followup-row*`, `.commercial-followup-empty` (ya sin selector en el JSX tras el slice 4). No tocar `.commercial-followup-banner`/`-copy`/`-cards`/`-card*`.
4. `node --test` sobre el archivo de aserciones de CSS → verde.

### Criterio observable de cierre del slice

`git diff --stat` muestra sólo `src/styles.css` (y el archivo de test si se creó/extendió). `npm run build` completo (ver cierre del plan) confirma que Vite sigue empaquetando sin advertencias de CSS huérfano relevantes al cambio.

---

## Cierre del plan — verificación completa

Ejecutar en este orden, deteniéndose y volviendo al slice correspondiente si algo falla:

1. `node --test tests/agt003-my-day-presentation.test.mjs tests/agt003-ficha-presentation.test.mjs tests/vigia-engine.test.mjs tests/consultant-detail-static.test.mjs tests/agt003-followup-form-copy-static.test.mjs` — los cinco archivos tocados/creados por este plan, juntos.
2. `node --test tests/agt003-*.test.mjs tests/vigia-*.test.mjs tests/consultant-detail-static.test.mjs` — suite focal AGT-003/Vig-IA (glob que cubre el paso 1 más cualquier otro test `agt003-*`/`vigia-*` ya existente en el repositorio), en verde, sin modificar ninguna aserción fuera de las listadas en cada slice. **No se ejecuta `npm test`/la suite completa del repositorio**: hay antecedente confirmado de OOM al correrla completa; esta suite focal es el sustituto seguro para este corte.
3. `npx tsc --noEmit` — sin errores.
4. `npm run check:backend-parity` — en verde; este plan no debería tocar `api/[...path].js`/`server/index.js`, así que este chequeo confirma que siguen siendo byte-idénticos (no se rompió por accidente).
5. `npm run check:siio-integration` — en verde; confirma que no hay interferencia con SIIO (no se esperaba ninguna, ya que este plan no toca `src/siio/**`).
6. `npm run build` — en verde (incluye `check:deployment-safety`, `tsc`, `vite build`).
7. `git diff --check` — sin conflictos de espacio en blanco/marca de merge.
8. `git diff --stat` contra `main` — confirma que la lista de archivos tocados coincide exactamente con «Archivos esperados en la implementación» del diseño: `vigia-engine.js`, `src/vigia/opportunity-ficha-presentation.ts`, `src/vigia/my-day-presentation.ts` (nuevo), `src/main.tsx`, `src/styles.css`, `tests/vigia-engine.test.mjs`, `tests/agt003-ficha-presentation.test.mjs`, `tests/agt003-my-day-presentation.test.mjs` (nuevo), `tests/consultant-detail-static.test.mjs`, `tests/agt003-followup-form-copy-static.test.mjs`. Ningún archivo de `api/`, `server/`, `contracts/agents/`, `supabase/migrations/`, `src/tenders/`, ni `tests/agt002*`.

## Fuera de este plan

- Push, apertura de PR, merge o despliegue: quedan para un paso posterior, fuera del alcance de esta tarea (sólo diseño + plan + commit local de los propios documentos).
- QA visual autenticado (Juan): pendiente, no se marca como aprobado por este plan.
- Cualquier extensión de "Mi día" a la vista gerencial de un consultor específico o a un enlace de contexto hacia `Prioridades Comerciales`: documentado como fuera de alcance en el diseño, no forma parte de los slices anteriores.
