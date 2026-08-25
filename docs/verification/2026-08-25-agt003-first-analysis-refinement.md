# AGT-003 — bloque 1 de refinamiento de la ficha comercial (primer análisis)

**Fecha:** 2026-08-25
**Rama:** `fix/agt003-first-analysis-refinement`
**Alcance:** integrar `src/vigia/opportunity-ficha-presentation.ts` en `src/main.tsx` y
`src/styles.css`; completar la UI VIG-IA (botón `Actualizar propuesta`, estado vacío compacto);
conservar `agt003-copilot-*`, `api/[...path].js`, `server/index.js`,
`src/vigia/copilot-presentation.ts` y `VigiaOpportunityCopilot.tsx` salvo lo estrictamente exigido
por test. Sin cambios en AGT-002, licitaciones, DB, permisos, etapas ni envíos.

## 1. RED inicial (real, ejecutado)

De los 5 tests focales del bloque, 4 fallaron en rojo por integración ausente (exports/módulo/
componente/markup no conectados) y 1 pasó porque el módulo puro ya estaba completo aunque
desconectado:

- `tests/agt003-ficha-presentation.test.mjs` — **PASS** (helpers puros ya completos:
  `calendarDaysBetween`, `humanDayCount`, `followUpAgeLabel`, `nextActionCardState`,
  `expectedCloseCardState`, `decisionMakerCardState`, `presentFollowUpEntry`).
- `tests/agt003-first-analysis-refinement-static.test.mjs` — **FAIL**: `src/main.tsx` no
  importaba `opportunity-ficha-presentation`, seguía usando `daysSince`/`lastDays` y copy
  `${action.label} · ${action.detail}` / `día(s)`; `VigiaOpportunityCopilot.tsx` no tenía
  `vigia-copilot-empty` ni el botón condicional; `styles.css` no tenía `.opportunity-ficha`,
  `.followup-form-compact`, `.opportunity-more-info-group` ni `.opportunity-insight-card.is-*`.
- `tests/agt003-copilot-presentation.test.mjs` — **FAIL** (exports pendientes de integración).
- `tests/agt003-copilot-proposal-render.test.mjs` — **FAIL** (componente sin el markup exigido).
- `tests/agt003-copilot-context-currency-date.test.mjs` — **FAIL** (contexto de fecha/moneda sin
  conectar).

## 2. Implementación

### `src/main.tsx`
- Importa `decisionMakerCardState, expectedCloseCardState, followUpAgeLabel, nextActionCardState,
  presentFollowUpEntry` desde `./vigia/opportunity-ficha-presentation`.
- `OpportunityDetail` calcula `priorityNextAction`, `priorityClose`, `priorityDecisionMaker` con
  los helpers puros; elimina `daysSince`/`lastDays` locales.
- El `<section>` raíz de la ficha usa `className={o.service_type_code === 'licitacion_publica' ?
  'stack' : 'stack opportunity-ficha'}` (compactación con alcance exclusivo a la ficha comercial).
- Las 4 tarjetas de prioridad usan `priorityNextAction/.priorityClose/.priorityDecisionMaker`
  (className + detail de urgencia) y `followUpAgeLabel(o.last_interaction_at)`.
- El formulario de seguimiento usa `className="form followup-form followup-form-compact"`.
- El historial usa `presentFollowUpEntry(i)`: tipo inferido, autor con badge
  `followup-migrated-badge` para registros migrados, contenido depurado.
- "Más información" pasa a dos grupos (`FichaField`) con acordeón; el grupo de datos de origen
  sólo se monta si hay al menos un dato.

### `src/vigia/VigiaOpportunityCopilot.tsx`
- Botón: `{ready ? 'Actualizar propuesta' : 'Preparar seguimiento'}`.
- Estado vacío (`phase === 'idle'`) envuelto en `<div className="vigia-copilot-empty">`.
- Presentación defensiva action-first del contexto de fecha/moneda/política del copiloto.

### `src/styles.css`
- `.opportunity-insight-card.is-critical/.is-attention/.is-ok/.is-neutral`.
- `.opportunity-ficha{}` (banner/tarjetas compactas) y su contraparte `@media(max-width:760px)`.
- `.followup-form-compact{}` (grid 2 columnas) y contraparte responsive de 1 columna.
- `.followup-migrated-badge{}`, `.opportunity-more-info-group{}`, `.vigia-copilot-empty{}`.

### Tests estáticos corregidos (markup literal obsoleto, conducta preservada)
- `tests/agt003-followup-priority-layout-static.test.mjs`, `tests/next-action-static.test.mjs`,
  `tests/opportunity-created-date-static.test.mjs`,
  `tests/vigia-opportunity-copilot-followup-copy.test.mjs`,
  `tests/tender-detail-layout-order.test.mjs`: marcadores fijados a markup previo, retirado a
  propósito por este bloque; se realinearon a la conducta equivalente (`presentFollowUpEntry`,
  `priorityNextAction.detail`, `FichaField`, botón condicional, grilla estable del resumen de
  licitación), sin cambiar la intención original de cada test.

## 3. Primer GREEN focal: 5/5

Con la integración anterior, los 5 tests focales pasaron.

## 4. Primera suite completa: 882 total, 880 pass, 1 fail, 1 skipped

Único fallo: un test estático obsoleto de adjuntos que fijaba markup viejo de la sección de
activos aprobados. Se corrigió **sólo el test**, alineándolo con `presented.hasApprovedAssets`
(la lógica de presentación real); el render condicional de vacío/con activos ya estaba cubierto
por los tests de conducta existentes, que no requirieron cambio.

## 5. Segunda ejecución: adjuntos/render 2/2 verdes; build verde; suite 881 pass / 0 fail / 1 skipped

## 6. Revisión Opus (primera pasada) — hallazgo C1

**C1 (crítico):** `offer_value=3500000000` se redactaba como si fuera un teléfono (falso positivo
del filtro de datos sensibles del copiloto) por un problema de tipado en la ruta de entrada del
valor de oferta.

**Fix:** corrección de tipado en la normalización de `offer_value`, más tests de regresión:
numérico grande, string decimal, `NaN`, `Infinity` y string arbitrario no numérico.

## 7. Tras el fix de C1

- Tests focales: **6/6** (se añade el foco de la regresión de C1 al conjunto de 5 originales).
- Ejecución fresca `npm run build && node --test tests/*.test.mjs`: build exit 0; **882 total,
  881 pass, 0 fail, 1 skipped**.
- `npm run check:backend-parity` y `npm run check:siio-integration`: verdes. `git diff --check`:
  limpio. (Estas tres verificaciones se corrieron antes del fix de C1, que sólo tocó
  input/normalización y su test de regresión; la suite completa y el build posteriores al fix ya
  cubren ese cambio.)

## 8. Revisión Opus (segunda pasada, post-fix)

- Critical: ninguno.
- Important: ninguno.
- C1_FIXED: yes.
- READY_FOR_COMMIT: yes.
- Se mencionan algunos *minors* no bloqueantes; quedan anotados como pendientes de criterio, sin
  declararlos resueltos en este bloque.

## 9. Límites y alcance

- Cero cambios en DB, permisos, etapas del pipeline o envíos (correo/CRM).
- Licitaciones y AGT-002 quedan aislados: sin cambios en su código ni sus tests.
- Contrato/API pública de AGT-003 (`agt003-copilot-*`, `api/[...path].js`, `server/index.js`,
  `src/vigia/copilot-presentation.ts`) intactos salvo el fix de tipado de C1 (§6–7).
- **QA visual autenticada pendiente:** no se levantó sesión autenticada en navegador para
  confirmar visualmente compactación, acordeón con foco por teclado y badge de migrados.
- No se pulsó `Generar`/`Copiar`/`Registrar` del copiloto contra ambiente de producción en ningún
  momento de esta verificación.

## 10. Estado al redactar

Listo para commit, aún sin PR/deploy.
