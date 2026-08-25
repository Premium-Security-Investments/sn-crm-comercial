# AGT-003 Follow-up Priority Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar la vista de detalle de oportunidades no licitatorias alrededor de la decisión comercial (próxima gestión, último contacto, cierre estimado, contacto decisor), mover lo secundario a `Más información`, y rescatar `observaciones` dentro del historial de seguimiento sin tocar DB, API ni permisos.

**Architecture:** Un módulo JS puro `src/opportunity-followup-presentation.js` (con `.d.ts` de firmas, patrón `src/vigia/priority-filters.js`) concentra rótulos de interacción, normalización de texto, deduplicación de la observación migrada y el armado ordenado del historial. `src/main.tsx` consume ese módulo y reestructura únicamente `OpportunityDetail` (chips en el banner, cuatro tarjetas de prioridad, sección `Seguimiento comercial` antes del copiloto, `<details>Más información`) y el copy de `FollowUpForm`. Todo el CSS es aditivo al final de `src/styles.css`.

**Tech Stack:** React 18 + TypeScript + Vite, módulos ESM puros, `node --test` con `node:assert/strict`, esbuild, Vercel.

**Spec:** `docs/superpowers/specs/2026-08-24-agt003-followup-priority-layout-design.md` (fuente única; el diseño anterior `2026-08-24-agt003-commercial-context-card-design.md` fue eliminado y no debe reintroducirse).

**Rama de trabajo:** `feat/agt003-followup-priority-layout`.

## Global Constraints

- Sin migraciones, cambios de esquema, de `/api/opportunity-detail` ni del payload de `POST /api/opportunity-interactions`.
- Sin cambios de permisos, roles ni de `canRenderOpportunityCopilot`. El evento de observación migrada existe sólo en memoria: cero escrituras en base de datos.
- La rama `service_type_code === 'licitacion_publica'` y sus componentes no cambian.
- `FollowUpForm` conserva endpoint, payload, valores internos y rótulos vigentes; sólo se agregan el párrafo de contexto y el placeholder de tres líneas. No se agrega `minLength`.
- El agente se nombra con `VIGIA_VISIBLE_NAMES.commercial`; el literal `VIG-IA` queda prohibido en `src/main.tsx` y `tests/vigia-visible-identity-static.test.mjs` no se modifica.
- CSS estrictamente aditivo: no se toca `.grid`, `.two`, `.three`, `.hero`, `.badge`, `.event`, `.timeline`, `.opportunity-insight-grid` ni `.opportunity-insight-card`.
- `interactionTypeLabels` (local a `FollowUpForm`) no se consolida con `INTERACTION_TYPE_LABELS`: duplicación intencional documentada en el spec §5.
- El componente `Dt` deja de usarse pero **no se elimina**: modificarlo está fuera de alcance y `tsconfig.json` no activa `noUnusedLocals`, así que una función de módulo sin uso no rompe `tsc`.
- No reestructurar `src/main.tsx` fuera de `OpportunityDetail` y el copy de `FollowUpForm`.
- Push, PR, merge y despliegue sólo en la Tarea D, y sólo con autorización explícita del usuario.

---

### Task A: Módulo puro de presentación del seguimiento

**Files:**
- Create: `src/opportunity-followup-presentation.js`
- Create: `src/opportunity-followup-presentation.d.ts`
- Test: `tests/opportunity-followup-presentation.test.mjs`

**Interfaces:**
- Produces: `INTERACTION_TYPE_LABELS`, `capitalizeVisibleLabel(text)`, `followUpInteractionTypeLabel(type)`, `normalizeFollowUpText(text)`, `isObservationCapturedInNotes(observaciones, interactions)`, `buildMigratedObservationEvent(opportunity)`, `buildFollowUpHistory(opportunity, interactions)`.
- Consumes: objetos `{ observaciones, quote_date, created_at }` y arreglos de `{ id, interaction_type, notes, occurred_at, created_at, psi_sales_profiles }` tal como los entrega `/api/opportunity-detail`.
- Sin JSX, sin React, sin DOM: importable directamente desde `tests/*.test.mjs` sin transpilación.

- [ ] **Step 1: Write the failing test**

Crear `tests/opportunity-followup-presentation.test.mjs` con `import { test } from 'node:test'` y cobertura de los siete exports:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INTERACTION_TYPE_LABELS, capitalizeVisibleLabel, followUpInteractionTypeLabel,
  normalizeFollowUpText, isObservationCapturedInNotes, buildMigratedObservationEvent, buildFollowUpHistory,
} from '../src/opportunity-followup-presentation.js';

test('labels are frozen and cover the seven internal values', () => {
  assert.equal(Object.isFrozen(INTERACTION_TYPE_LABELS), true);
  assert.deepEqual(Object.keys(INTERACTION_TYPE_LABELS), ['llamada','correo','reunion','whatsapp','nota','cambio_estado','documento']);
  assert.equal(INTERACTION_TYPE_LABELS.cambio_estado, 'Cambio de estado');
});

test('capitalize only touches the first character', () => {
  assert.equal(capitalizeVisibleLabel('llamada urgente'), 'Llamada urgente');
  for (const empty of ['', null, undefined]) assert.equal(capitalizeVisibleLabel(empty), '');
});

test('type label falls back without inheriting prototype members', () => {
  for (const [input, expected] of [['reunion', 'Reunión'], ['visita_tecnica', 'Visita_tecnica'], ['constructor', 'Constructor'], ['toString', 'ToString'], [null, '']]) {
    assert.equal(followUpInteractionTypeLabel(input), expected);
  }
});

test('normalization only serves comparison', () => {
  assert.equal(normalizeFollowUpText('  Cliente\n  pidió   PROPUESTA '), 'cliente pidió propuesta');
  assert.equal(normalizeFollowUpText(null), '');
});

test('observation coverage uses containment, not equality', () => {
  const notes = [{ id: 'a', interaction_type: 'nota', notes: 'Reunión inicial. Cliente pidió propuesta antes del viernes.' }];
  assert.equal(isObservationCapturedInNotes('cliente pidió propuesta', notes), true);
  assert.equal(isObservationCapturedInNotes('Cliente pidió visita técnica', notes), false);
  for (const [obs, list] of [['   ', notes], ['algo', []], ['algo', null]]) assert.equal(isObservationCapturedInNotes(obs, list), false);
});

test('migrated event keeps the original text and dates', () => {
  for (const empty of [null, { observaciones: '   ' }]) assert.equal(buildMigratedObservationEvent(empty), null);
  const event = buildMigratedObservationEvent({ observaciones: '  Pendiente   visita\ntécnica  ', quote_date: '2026-03-01T10:00:00.000Z', created_at: '2026-01-01T10:00:00.000Z' });
  assert.equal(event.id, 'observacion-migrada');
  assert.equal(event.interaction_type, 'nota');
  assert.equal(event.notes, '  Pendiente   visita\ntécnica  ');
  assert.equal(event.occurred_at, '2026-03-01T10:00:00.000Z');
  assert.equal(event.created_at, '2026-03-01T10:00:00.000Z');
  assert.equal(event.actor_label, 'Migrado / sistema');
  assert.equal(event.psi_sales_profiles, null);
});

test('history hides documents, interleaves the migrated note and never mutates', () => {
  const interactions = [
    { id: 'i2', interaction_type: 'llamada', notes: 'Llamada de cierre', occurred_at: '2026-05-10T10:00:00.000Z', created_at: '2026-05-10T10:00:00.000Z' },
    { id: 'i1', interaction_type: 'documento', notes: '{"kind":"tender"}', occurred_at: '2026-04-10T10:00:00.000Z', created_at: '2026-04-10T10:00:00.000Z' },
    { id: 'i0', interaction_type: 'correo', notes: 'Correo inicial', occurred_at: '2026-01-10T10:00:00.000Z', created_at: '2026-01-10T10:00:00.000Z' },
  ];
  const snapshot = JSON.stringify(interactions);
  const history = buildFollowUpHistory({ observaciones: 'Migrada desde Excel', quote_date: '2026-03-01T10:00:00.000Z', created_at: '2026-01-01T10:00:00.000Z' }, interactions);
  assert.deepEqual(history.map(i => i.id), ['i2', 'observacion-migrada', 'i0']);
  assert.equal(JSON.stringify(interactions), snapshot);
  assert.equal(history.some(i => i.interaction_type === 'documento'), false);
});

test('history drops the migrated note when a visible note already covers it', () => {
  const history = buildFollowUpHistory(
    { observaciones: 'Cliente pidió propuesta' },
    [{ id: 'i1', interaction_type: 'nota', notes: 'Cliente pidió propuesta antes del viernes', occurred_at: '2026-05-10T10:00:00.000Z', created_at: '2026-05-10T10:00:00.000Z' }],
  );
  assert.deepEqual(history.map(i => i.id), ['i1']);
});

test('history tolerates empty and unparseable inputs', () => {
  assert.deepEqual(buildFollowUpHistory(null, null), []);
  assert.deepEqual(buildFollowUpHistory({ observaciones: '' }, []), []);
  const history = buildFollowUpHistory({ observaciones: 'Sólo observación' }, [{ id: 'x', interaction_type: 'nota', notes: 'Nota sin fecha', occurred_at: null, created_at: null }]);
  assert.deepEqual(history.map(i => i.id), ['x', 'observacion-migrada']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/opportunity-followup-presentation.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` porque `src/opportunity-followup-presentation.js` no existe.

- [ ] **Step 3: Write minimal implementation**

Crear `src/opportunity-followup-presentation.js`:

```js
export const INTERACTION_TYPE_LABELS = Object.freeze({
  llamada: 'Llamada', correo: 'Correo', reunion: 'Reunión', whatsapp: 'WhatsApp',
  nota: 'Nota', cambio_estado: 'Cambio de estado', documento: 'Documento',
});
export function capitalizeVisibleLabel(text) {
  const value = String(text ?? '');
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
}
export function followUpInteractionTypeLabel(type) {
  const key = String(type ?? '');
  return Object.prototype.hasOwnProperty.call(INTERACTION_TYPE_LABELS, key)
    ? INTERACTION_TYPE_LABELS[key]
    : capitalizeVisibleLabel(key);
}
export function normalizeFollowUpText(text) {
  return String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}
export function isObservationCapturedInNotes(observaciones, interactions) {
  const needle = normalizeFollowUpText(observaciones);
  if (!needle || !Array.isArray(interactions) || !interactions.length) return false;
  return interactions.some(item => normalizeFollowUpText(item?.notes).includes(needle));
}
export function buildMigratedObservationEvent(opportunity) {
  const notes = opportunity?.observaciones;
  if (!String(notes ?? '').trim()) return null;
  const at = opportunity?.quote_date || opportunity?.created_at || null;
  return { id: 'observacion-migrada', interaction_type: 'nota', notes, occurred_at: at, created_at: at, actor_label: 'Migrado / sistema', psi_sales_profiles: null };
}
function sortKey(item) {
  const parsed = Date.parse(item?.occurred_at || item?.created_at || '');
  return Number.isNaN(parsed) ? 0 : parsed;
}
export function buildFollowUpHistory(opportunity, interactions) {
  const visible = (Array.isArray(interactions) ? interactions : []).filter(i => i?.interaction_type !== 'documento');
  const migrated = buildMigratedObservationEvent(opportunity);
  const all = migrated && !isObservationCapturedInNotes(opportunity?.observaciones, visible) ? [...visible, migrated] : [...visible];
  return all.sort((a, b) => sortKey(b) - sortKey(a));
}
```

Crear `src/opportunity-followup-presentation.d.ts` con los tipos y las siete firmas exactas de la sección «Tipos (`.d.ts`)» del spec.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/opportunity-followup-presentation.test.mjs`
Expected: PASS — 9 subtests en verde.

- [ ] **Step 5: Commit**

```bash
git add src/opportunity-followup-presentation.js src/opportunity-followup-presentation.d.ts tests/opportunity-followup-presentation.test.mjs
git commit -m "feat(agt003): add pure follow-up presentation module"
```

---

### Task B: Layout de prioridad en `OpportunityDetail` y copy de `FollowUpForm`

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Test: `tests/agt003-followup-priority-layout-static.test.mjs`

**Interfaces:**
- Consumes: `buildFollowUpHistory`, `followUpInteractionTypeLabel` desde `./opportunity-followup-presentation.js`; `nextActionStatus(o)`, `daysSince(o.last_interaction_at || o.updated_at || o.created_at)`, `customerSegmentLabel`, `commercialAreaLabel`, `fmtDate`, `fmtDateOnly`, `Badge`, `Info`, `Panel`, `VIGIA_VISIBLE_NAMES` ya existentes.
- Produces: chips `.hero-chip-row`, `<section className="opportunity-insight-grid opportunity-priority-grid" aria-label="Resumen prioritario de la oportunidad">` de cuatro tarjetas, sección `Seguimiento comercial` (formulario primero en el DOM, historial segundo), `<details className="opportunity-more-info">`, y `FOLLOW_UP_NOTES_PLACEHOLDER` a nivel de módulo.
- Sin cambios en `id="tender-follow-up"`, `id="opportunity-follow-up"`, `tabIndex={-1}`, `ref={followUpRef}` ni en los props de `VigiaOpportunityCopilot`.

- [ ] **Step 1: Write the failing test**

Crear `tests/agt003-followup-priority-layout-static.test.mjs` (estilo estático del repo: aserciones directas y `console.log` final) con:

```js
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

// 1) módulo puro conectado
assert.match(main, /import \{ buildFollowUpHistory, followUpInteractionTypeLabel \} from '\.\/opportunity-followup-presentation\.js';/);
assert.match(main, /const followUpHistory = buildFollowUpHistory\(o, detail\.interactions\);/);
assert.ok(!main.includes("const visibleInteractions = detail.interactions.filter"));

// 2) chips del banner, sólo en la rama no licitatoria
assert.match(main, /\{o\.service_type_code !== 'licitacion_publica' && <div className="hero-chip-row">/);
assert.match(main, /<Badge>Servicio: \{o\.service_type_name \|\| o\.tipo_producto_original \|\| 'Sin servicio'\}<\/Badge>/);
assert.match(main, /<Badge>Tipo de cliente: \{customerSegmentLabel\(o\.customer_segment\)\}<\/Badge>/);
assert.match(main, /\{locationChip && <Badge>Ubicación: \{locationChip\}<\/Badge>\}/);
assert.ok(!/hero-chip-row[\s\S]{0,600}Área comercial/.test(main), 'no debe existir chip de Área comercial');

// 3) cuatro tarjetas de prioridad reemplazan el grid de once campos
assert.match(main, /<section className="opportunity-insight-grid opportunity-priority-grid" aria-label="Resumen prioritario de la oportunidad">/);
const gridStart = main.indexOf('opportunity-priority-grid');
const gridEnd = main.indexOf('</section>}', gridStart);
const priorityGrid = main.slice(gridStart, gridEnd);
assert.deepEqual([...priorityGrid.matchAll(/<small>([^<]+)<\/small>/g)].map(m => m[1]),
  ['Próxima gestión', 'Último seguimiento', 'Cierre estimado', 'Contacto decisor']);
assert.ok(!/opportunity-insight-card (blue|green|amber|purple)/.test(priorityGrid));
for (const removed of ['label="Área comercial"', 'label="Próxima acción"', 'label="Estado próxima gestión"', 'label="Días sin seguimiento"', 'label="Decisor"', 'label="Correo decisor"', 'label="Teléfono"']) {
  assert.ok(!priorityGrid.includes(removed), `${removed} no debe sobrevivir en el resumen`);
}

// 4) valores derivados
assert.match(main, /const locationChip = \[o\.quote_city, o\.sede\]/);
assert.match(main, /const decisionMakerSummary = \[o\.decision_maker_name, o\.decision_maker_email, o\.decision_maker_phone\][\s\S]{0,120}'Por completar'/);

// 5) Datos comerciales y Línea de seguimientos desaparecen
assert.ok(!main.includes('Panel title="Datos comerciales"'));
assert.ok(!main.includes('Panel title="Línea de seguimientos"'));
assert.ok(!main.includes('<Dt label='), 'Dt deja de usarse (el componente se conserva sin cambios)');

// 6) Seguimiento comercial: formulario primero en el DOM, historial después, antes del copiloto
const section = main.indexOf('<h2 className="followup-section-title">Seguimiento comercial</h2>');
const formSlot = main.indexOf('followup-form-slot', section);
const history = main.indexOf('<Panel title="Historial de seguimiento" className="followup-history">', section);
const copilot = main.indexOf('canRenderOpportunityCopilot(data.currentProfile, o.service_type_code)', history);
const moreInfo = main.indexOf('<summary>Más información</summary>', copilot);
assert.ok(section > 0 && section < formSlot && formSlot < history && history < copilot && copilot < moreInfo,
  'orden: sección → formulario → historial → copiloto → Más información');
assert.match(main, /id="opportunity-follow-up" className="opportunity-follow-up-anchor followup-form-slot" tabIndex=\{-1\} ref=\{followUpRef\}/);
assert.match(main, /<div className="timeline followup-timeline">/);
assert.match(main, /<strong>\{followUpInteractionTypeLabel\(i\.interaction_type\)\}<\/strong>/);
assert.match(main, /\{i\.actor_label \|\| i\.psi_sales_profiles\?\.full_name \|\| 'Migrado \/ sistema'\}/);
assert.ok(main.includes('Sin seguimientos registrados.'));

// 7) Más información
assert.match(main, /\{o\.service_type_code !== 'licitacion_publica' && <details className="opportunity-more-info">/);
const detailsStart = main.indexOf('opportunity-more-info');
const details = main.slice(detailsStart, main.indexOf('</details>}', detailsStart));
for (const label of ['Fecha creación', 'Área comercial', 'Sector', 'ID legacy', 'Hoja origen', 'Estado original']) {
  assert.ok(details.includes(`label="${label}"`), `Más información debe incluir ${label}`);
}
assert.ok(!details.includes('observaciones'), 'observaciones nunca aparece en Más información');
for (const guard of ['{legacyId &&', '{legacySheet &&', '{legacyStatus &&']) assert.ok(details.includes(guard));

// 8) FollowUpForm: copy nuevo, mecánica intacta
const followUp = main.slice(main.indexOf('function FollowUpForm('), main.indexOf('\nconst publicActuationOptions'));
assert.match(main, /const FOLLOW_UP_NOTES_PLACEHOLDER = 'Resultado de la gestión\\nAcuerdos o compromisos\\nSiguiente paso';/);
assert.match(followUp, /<p className="followup-form-hint">Este registro alimenta el historial comercial y las recomendaciones de \{VIGIA_VISIBLE_NAMES\.commercial\}\. Describa hechos, acuerdos, responsables y el siguiente paso\.<\/p>/);
assert.match(followUp, /<textarea required placeholder=\{FOLLOW_UP_NOTES_PLACEHOLDER\}/);
assert.ok(!followUp.includes('placeholder="Registre el resultado'));
assert.ok(!followUp.includes('minLength'), 'no se agregan validaciones nuevas al formulario');
assert.ok(!/VIG-IA/.test(main), 'la identidad visible se interpola, nunca se escribe literal');

// 9) CSS aditivo
for (const rule of [
  '.hero-chip-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}',
  '.opportunity-priority-grid .opportunity-insight-card strong{',
  '.followup-section-title{', '.followup-section-grid{', '.followup-section-grid>.followup-history{order:1',
  '.followup-section-grid>.followup-form-slot{order:2', '.followup-timeline .event strong{text-transform:none}',
  '.followup-form-hint{', '.opportunity-more-info>summary{', '.opportunity-more-info>.grid{',
  '@media(max-width:760px){.followup-section-grid{grid-template-columns:1fr}',
]) assert.ok(css.includes(rule), `styles.css debe incluir ${rule}`);
assert.ok(css.includes('.event strong{text-transform:capitalize}'), 'la regla global compartida no se toca');
assert.match(css, /\.followup-section-grid\{[^}]*grid-template-columns:minmax\(0,3fr\) minmax\(280px,2fr\)/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agt003-followup-priority-layout-static.test.mjs`
Expected: FAIL en la primera aserción del import, porque `src/main.tsx` sigue con `grid three`, `Datos comerciales` y `Línea de seguimientos`.

- [ ] **Step 3: Write minimal implementation**

En `src/main.tsx`:

1. Agregar `import { buildFollowUpHistory, followUpInteractionTypeLabel } from './opportunity-followup-presentation.js';` junto a los imports existentes.
2. Declarar `const FOLLOW_UP_NOTES_PLACEHOLDER = 'Resultado de la gestión\nAcuerdos o compromisos\nSiguiente paso';` a nivel de módulo.
3. En `OpportunityDetail`, reemplazar `visibleInteractions` por `followUpHistory = buildFollowUpHistory(o, detail.interactions)` y agregar `locationChip`, `decisionMakerSummary`, `legacyId`, `legacySheet`, `legacyStatus` con las expresiones de «Reglas de datos» del spec.
4. Agregar la fila de chips dentro de `.hero`, bajo el guard `o.service_type_code !== 'licitacion_publica'`.
5. Sustituir el `<div className="grid three">` de once `Info` por el `<section>` de cuatro tarjetas del spec §2.
6. Reescribir la rama no licitatoria de `id="tender-follow-up"` como `Seguimiento comercial` (spec §3): `<h2 className="followup-section-title">`, `.followup-section-grid`, formulario primero con `followup-form-slot`, `Panel title="Historial de seguimiento" className="followup-history"` después.
7. Mover la línea de `VigiaOpportunityCopilot` para que quede inmediatamente después del contenedor `id="tender-follow-up"`, con props y guard idénticos.
8. Agregar el `<details className="opportunity-more-info">` como último bloque de la vista no licitatoria (spec §4).
9. En `FollowUpForm`, insertar el `<p className="followup-form-hint">` entre el título del `Panel` y el `<form>`, y cambiar el `placeholder` del `<textarea>` a `{FOLLOW_UP_NOTES_PLACEHOLDER}`.

En `src/styles.css`, anexar al final exactamente el bloque de «CSS nuevo» del spec (once reglas, incluido el `@media(max-width:760px)`).

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tests/agt003-followup-priority-layout-static.test.mjs
npx tsc --noEmit
```

Expected: PASS y `tsc` exit 0 (`buildFollowUpHistory(o, detail.interactions)` compila contra el `.d.ts` sin castings).

- [ ] **Step 5: Commit**

```bash
git add src/main.tsx src/styles.css tests/agt003-followup-priority-layout-static.test.mjs
git commit -m "feat(agt003): reorder non-tender opportunity detail around follow-up priority"
```

---

### Task C: Contratos preexistentes, verificación completa y revisión

**Files:**
- Modify: `tests/tender-summary-public-fields.test.mjs`
- Modify: `tests/tender-opportunity-compact-summary.test.mjs`
- Modify: `tests/next-action-static.test.mjs`
- Modify: `tests/agt003-followup-form-copy-static.test.mjs`
- Verify unchanged: `tests/tender-detail-layout-order.test.mjs`, `tests/commercial-alerts-static.test.mjs`, `tests/vigia-visible-identity-static.test.mjs`, `tests/consultant-detail-static.test.mjs`

**Interfaces:**
- Consumes: el `src/main.tsx` ya reestructurado por la Tarea B.
- Produces: contratos preexistentes alineados con el layout vigente, sin relajar ninguna regla que siga siendo verdadera.

Sólo se actualiza lo que falla por copy/layout retirado. Ninguna aserción de identidad, endpoint, payload, valores internos o rama de licitaciones se debilita.

- [ ] **Step 1: Run the pre-existing contracts to see them RED**

Run:

```bash
node --test \
  tests/tender-summary-public-fields.test.mjs \
  tests/tender-opportunity-compact-summary.test.mjs \
  tests/next-action-static.test.mjs \
  tests/agt003-followup-form-copy-static.test.mjs \
  tests/tender-detail-layout-order.test.mjs \
  tests/commercial-alerts-static.test.mjs \
  tests/vigia-visible-identity-static.test.mjs \
  tests/consultant-detail-static.test.mjs
```

Expected: FAIL exactamente en los cuatro primeros, por estas causas:

| Archivo | Aserción que falla | Causa |
|---|---|---|
| `tender-summary-public-fields.test.mjs` | marcador `'</> : <div className="grid three">'` (l. 9), fin `'</div>}'` (l. 13) y las once `label="…"` de la rama privada (l. 37-42) | el grid de once campos ya no existe |
| `tender-opportunity-compact-summary.test.mjs` | regex terminada en `: <div className="grid three">` (l. 6) deja `tenderBranch` vacío | mismo marcador retirado |
| `next-action-static.test.mjs` | marcadores `'Estado próxima gestión'` y `'Días sin seguimiento'` (l. 10-11) | rótulos sustituidos por las tarjetas de prioridad |
| `agt003-followup-form-copy-static.test.mjs` | `placeholder="Registre el resultado, los acuerdos y el siguiente paso"` (l. 66-69) | placeholder de tres líneas por expresión JSX |

Los otros cuatro deben pasar sin tocarlos: `tender-detail-layout-order` sólo exige que un `<div className="grid three">` aparezca después de `TenderDetailNavigation`, y `Más información` lo satisface; `commercial-alerts-static` exige `interactionFocusRequested`, `followUpRef` e `id="opportunity-follow-up"`, todos conservados; `vigia-visible-identity-static` sigue verde porque el nombre se interpola; `consultant-detail-static` sólo exige el texto `Registrar seguimiento`, que no cambia. Si alguno falla, corregir `src/main.tsx`, no la prueba.

- [ ] **Step 2: Update only the assertions invalidated by the retired layout**

- `tender-summary-public-fields.test.mjs`: cambiar el marcador de la rama privada a `'</> : <section className="opportunity-insight-grid opportunity-priority-grid"'` y su cierre a `'</section>}'`; sustituir el bucle de once `label="…"` por la exigencia de las cuatro tarjetas (`<small>Próxima gestión</small>`, `<small>Último seguimiento</small>`, `<small>Cierre estimado</small>`, `<small>Contacto decisor</small>`) y por `assert.doesNotMatch(privateBlock, /<Panel title="Proceso oficial"/)`. Todas las aserciones de la rama pública (siete campos gobernados, campos CRM prohibidos, `fmtDateOnly`, `Vigente`/`Vencida`, `tenderDaysRemainingLabel`) quedan intactas.
- `tender-opportunity-compact-summary.test.mjs`: terminar la regex en `: <section className="opportunity-insight-grid opportunity-priority-grid"`. El resto del archivo no cambia.
- `next-action-static.test.mjs`: reemplazar los dos marcadores retirados por `'<small>Próxima gestión</small>'`, `'<small>Último seguimiento</small>'`, `` '`${action.label} · ${action.detail}`' `` y `'día(s) de antigüedad'`. Conservar `'function nextActionStatus'`, `'Programar próxima gestión'`, `'Próxima gestión (opcional)<input type="datetime-local"'` y todos los marcadores CSS.
- `agt003-followup-form-copy-static.test.mjs`: sustituir la aserción 7 por la exigencia del literal de módulo y de su uso por expresión, más el párrafo de contexto:

```js
assert.match(main, /const FOLLOW_UP_NOTES_PLACEHOLDER = 'Resultado de la gestión\\nAcuerdos o compromisos\\nSiguiente paso';/);
assert.ok(followUp.includes('placeholder={FOLLOW_UP_NOTES_PLACEHOLDER}'), 'el placeholder multilínea debe venir de una expresión JSX');
assert.ok(!followUp.includes('placeholder="Registre el resultado'), 'el placeholder de una línea queda retirado');
assert.match(followUp, /<p className="followup-form-hint">Este registro alimenta el historial comercial y las recomendaciones de \{VIGIA_VISIBLE_NAMES\.commercial\}\./);
```

Las aserciones 1 a 6 y 8 (valores internos, rótulos de opciones, etiquetas visibles, `Próxima gestión (opcional)`, `Detalle del seguimiento`, endpoint y payload) no se tocan.

- [ ] **Step 3: Run focal tests**

```bash
node --test \
  tests/opportunity-followup-presentation.test.mjs \
  tests/agt003-followup-priority-layout-static.test.mjs \
  tests/tender-summary-public-fields.test.mjs \
  tests/tender-opportunity-compact-summary.test.mjs \
  tests/next-action-static.test.mjs \
  tests/agt003-followup-form-copy-static.test.mjs \
  tests/tender-detail-layout-order.test.mjs \
  tests/commercial-alerts-static.test.mjs \
  tests/vigia-visible-identity-static.test.mjs \
  tests/consultant-detail-static.test.mjs
```

Expected: PASS en los diez.

- [ ] **Step 4: Run the full suite serially, plus build and parity**

```bash
node --test --test-concurrency=1 tests/*.test.mjs
npm run check:siio-integration
npm run check:backend-parity
npx tsc --noEmit
npx vite build
git diff --check
```

Expected: suite completa PASS o, si aparece un fallo, comprobar contra `git stash`/`main` que es preexistente y reportarlo textualmente sin ocultarlo. `tsc` y `vite build` exit 0 (la advertencia de bundle > 500 kB es preexistente y no bloquea). Se usa `npx vite build` en local para no disparar el `postbuild` de `npm run build`; el `npm run build` completo corre en los checks del PR (Tarea D, Step 3). `git diff --check` sin salida.

- [ ] **Step 5: Claude review and remediation**

Ejecutar `/code-review high` sobre el diff de la rama. Revisar en particular: que el evento sintético no se persista, que `notes` y `observaciones` se rendericen verbatim, que ningún CSS compartido haya cambiado, que el orden de foco documentado coincida con el DOM y que no se hayan tocado endpoint, payload ni permisos. Corregir cada hallazgo real y repetir los Steps 3 y 4 hasta verde.

- [ ] **Step 6: Commit**

```bash
git add tests/tender-summary-public-fields.test.mjs tests/tender-opportunity-compact-summary.test.mjs tests/next-action-static.test.mjs tests/agt003-followup-form-copy-static.test.mjs
git commit -m "test(agt003): realign pre-existing detail contracts with the priority layout"
```

---

### Task D: Integración, despliegue y smoke público de bundle

**Files:**
- Modify (sólo si el review dejó ajustes pendientes): `src/main.tsx`, `src/styles.css`, `src/opportunity-followup-presentation.js`, `tests/*`
- Modify: `docs/superpowers/plans/2026-08-24-agt003-followup-priority-layout.md` (marcar los checkboxes ejecutados)

**Interfaces:**
- Consumes: rama `feat/agt003-followup-priority-layout` verde en la Tarea C.
- Produces: PR con checks en verde, `main` actualizado, despliegue productivo y evidencia de smoke público sobre el bundle.

**Gate:** los Steps 2 a 6 requieren autorización explícita del usuario para push, merge y despliegue. Sin ese GO, la tarea se detiene tras el Step 1.

- [ ] **Step 1: Commit final si queda árbol sucio**

```bash
git status --porcelain
git add -A && git commit -m "chore(agt003): finalize follow-up priority layout"
```

Expected: árbol limpio. Si `git status --porcelain` no imprime nada, omitir el commit.

- [ ] **Step 2: Publicar rama y abrir PR**

```bash
git push -u origin feat/agt003-followup-priority-layout
gh pr create --base main --head feat/agt003-followup-priority-layout \
  --title "feat(agt003): follow-up priority layout for non-tender opportunities" \
  --body "Implementa docs/superpowers/specs/2026-08-24-agt003-followup-priority-layout-design.md. Sin cambios de DB, API ni permisos."
```

Expected: PR abierto y mergeable.

- [ ] **Step 3: Esperar checks**

```bash
gh pr checks --watch
```

Expected: todos los checks en verde. Si alguno falla, corregir en la rama y repetir los Steps 3 y 4 de la Tarea C antes de continuar.

- [ ] **Step 4: Merge y actualización local**

```bash
gh pr merge --merge
git switch main
git pull --ff-only origin main
```

Expected: PR mergeado y `main` local al día.

- [ ] **Step 5: Desplegar producción**

```bash
vercel --prod --yes
```

Expected: deployment `Ready` con alias `https://seguridad-nacional-crm.vercel.app`. Registrar el deployment ID para rollback.

- [ ] **Step 6: Smoke público de bundle**

```bash
BASE=https://seguridad-nacional-crm.vercel.app
ASSETS=$(curl -s $BASE/ | grep -o '/assets/index-[A-Za-z0-9_-]*\.\(js\|css\)')
for A in $ASSETS; do echo "== $A"; curl -s "$BASE$A" | grep -o 'Seguimiento comercial\|Historial de seguimiento\|Más información\|Resumen prioritario de la oportunidad\|Contacto decisor\|observacion-migrada\|Vig-IA Comercial\|Datos comerciales\|Línea de seguimientos\|followup-section-grid\|followup-timeline\|hero-chip-row\|opportunity-more-info\|opportunity-priority-grid' | sort -u; done
```

Expected: el bundle JS contiene `Seguimiento comercial`, `Historial de seguimiento`, `Más información`, `Resumen prioritario de la oportunidad`, `Contacto decisor`, `observacion-migrada` y `Vig-IA Comercial`, y **no** contiene `Datos comerciales` ni `Línea de seguimientos`. El bundle CSS contiene las cinco clases nuevas. Es un smoke sin sesión: verifica que el bundle desplegado es el de esta rama, no reemplaza una revisión visual autenticada del detalle de una oportunidad no licitatoria.

- [ ] **Step 7: Cerrar el plan**

Marcar en este documento los checkboxes ejecutados, dejar constancia del deployment ID y del resultado del smoke, y confirmar `git status` limpio en `main`.
