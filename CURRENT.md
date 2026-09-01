# CURRENT — AGT-002 Decision Front Consolidation — CHECKPOINT AUTORITATIVO (§16: Cierre AGT-002 y continuidad)

> Estado vigente al 2026-09-01: la sección autoritativa vigente es la **§16 — Cierre AGT-002 y continuidad**. §13 sigue siendo la referencia histórica autoritativa para publicación/QA de producción del frente decisional tal como quedó el 2026-08-21, y §15 sigue siendo la referencia histórica autoritativa para el estado operativo del Radar tal como quedó el 2026-08-28; ninguna de las dos fue reescrita. §16 añade el corte de cierre de AGT-002 y continuidad hacia la próxima licitación, sin modificar lo ya registrado en §1–§15.

## 1. Estado y alcance autoritativo

- Fecha de corte operativo: 2026-08-21.
- Canal/proyecto: AGT-002, consolidación visual y funcional del frente decisional.
- Worktree: `/root/worktrees/agt002-decision-front-consolidation`.
- Rama: `feat/agt002-decision-front-consolidation-20260820`.
- Base del worktree: `408dbc153f4099c71cd72c29350819ac64ec1003`.
- Referencia de producción: `7ad7b91470228e6abd9b0236a9ac22f304c94624`.
- Objetivo: lectura frontal breve y accionable; Análisis como superficie completa; Decisión como síntesis y registro humano; V3 como respaldo técnico desplegable; Resumen/Documentos/navegación sin duplicados.
- Gates cerrados: commit, push, merge, migración y deploy. Todo permanece local y sin commit.

## 2. Tarea exacta en curso al ordenar la pausa

**Task 7.1 — Helper reusable de render TSX real y cobertura de los 12 estados mínimos de UX.**

El worker había terminado de preparar:

- `tests/helpers/bundle-react-component.mjs`;
- refactor y pruebas nuevas en `tests/tender-decision-front-render.test.mjs`;
- `.superpowers/sdd/task-7-1-report.md`.

Los archivos fueron comprobados en disco después del retorno del worker. La ejecución fue interrumpida antes de correr la primera prueba aislada de Task 7.1. Por tanto, Task 7 sigue **EN CURSO / NO VERIFICADA**.

## 3. Trabajo completado y evidencia

### Tasks 0–4

- Task 0: worktree aislado; línea base 33/33; TypeScript, Vite y paridad backend limpios.
- Task 1: presentación humana gobernada; 9/9 focales; fixtures sincronizados; revisión independiente aprobada.
- Task 2: selectores puros, estados humanos y conteos dinámicos; 28/28 acumuladas; revisión aprobada.
- Task 3: Análisis consolidado como superficie completa; 38/38 verificación GPT y 46/46 revisión Claude; TypeScript limpio.
- Task 4: V3 dinámico en dos capas, cinco fases, segundo fixture y anclas opacas; 62/62 y 51/51 en revisiones; TypeScript y diff-check limpios.

### Task 5 — COMPLETADA

- Decisión reducida a brief compacto y registro humano formal.
- CTA sólo navegan/enfocan; no seleccionan ni persisten GO/NO GO.
- Respuestas humanas sincronizadas al brief para contar sólo `Pendiente de validación`.
- Destino de registro con `tabIndex={-1}`.
- Suite exacta Task 5: **28/28 PASS**.
- Suite acumulada Tasks 1–5: **64/64 PASS**.
- `npx tsc --noEmit`: exit 0.
- `git diff --check`: exit 0.
- Revisión independiente final: `VERDICT_SPEC=APPROVED`, `VERDICT_QUALITY=APPROVED`, 0 Critical, 0 Important.
- Minor pendiente no bloqueante: el puntero compacto de `TenderGoNoGoDecisionPanel` puede sobrecontar condiciones ya validadas porque no recibe respuestas humanas.

### Task 6 — COMPLETADA

- Resumen depurado a Entidad, Servicio, Sector, Ciudad, Cuantía, Cierre oficial y Responsable.
- `Ciudad por confirmar` como fallback exacto.
- Fuente oficial única en navegación.
- Vigencia única en shell; se eliminó `Días restantes` para evitar duplicar `Vencida`.
- Navegación canónica, `IntersectionObserver`, hash inicial, `aria-current`, scroll y foco al contenedor.
- Jerarquía de oportunidad y Documentos protegida por pruebas.
- Suite vinculante: **39/39 PASS**.
- Regresiones adicionales: **5/5 PASS**.
- `npx tsc --noEmit`: exit 0.
- `git diff --check`: exit 0.
- Revisión independiente: `VERDICT_SPEC=APPROVED`, `VERDICT_QUALITY=APPROVED`, 0 Critical, 0 Important, 3 Minor no bloqueantes.

## 4. Qué estaba haciendo cuando se interrumpió

Se había cargado `.superpowers/sdd/task-7-brief.md` y la guía `webapp-testing`. Luego se ejecutó un worker atómico para Task 7.1, sin shell, con el encargo de crear el helper reusable y completar evidencia HTML real para:

1. condición sin respuesta;
2. respuesta pending;
3. respuesta resolved;
4. respuesta not_applicable;
5. condición sin presentation;
6. impedimento confirmado;
7. resumen GO/NO GO sin decisión;
8. GO registrado;
9. NO GO registrado;
10. V3 con cantidad piloto;
11. V3 con cantidad distinta;
12. fases vacías y con pendientes.

El worker reportó éxito. Se verificó que el helper y el reporte existen y se leyeron. **No se ejecutó todavía `node --test tests/tender-decision-front-render.test.mjs` después de esos cambios.**

## 5. Última prueba realmente ejecutada

Último comando de pruebas ejecutado antes de los cambios de Task 7.1:

```bash
node --test \
  tests/tender-summary-public-fields.test.mjs \
  tests/tender-opportunity-compact-summary.test.mjs \
  tests/tender-document-actions-layout.test.mjs \
  tests/tender-detail-layout-order.test.mjs \
  tests/tender-detail-navigation-state.test.mjs
```

Resultado real: **5/5 PASS, 0 fallos, exit 0**.

Inmediatamente antes también se ejecutó la suite vinculante de Task 6 con resultado **39/39 PASS**, seguida en la misma cadena por `npx tsc --noEmit` y `git diff --check`, ambos exit 0.

No hay resultado de pruebas posterior a la creación/refactor de Task 7.1.

## 6. Archivos creados o modificados

### Estado Git observado justo antes de escribir este checkpoint

Archivos rastreados modificados:

- `agt002-manizales-exercise-decision-review.js`
- `data/agt002/manizales-sa-24-2026.exercise-decision-review.v1.json`
- `src/main.tsx`
- `src/styles.css`
- `src/tenders/components/TenderAnalysisSection.tsx`
- `src/tenders/components/TenderDecisionBrief.tsx`
- `src/tenders/components/TenderDetailNavigation.tsx`
- `src/tenders/components/TenderDocumentSection.tsx`
- `src/tenders/components/TenderGoNoGoDecisionPanel.tsx`
- `src/tenders/components/TenderIntegralAnalysisV3View.tsx`
- `src/tenders/components/TenderQuestionResponseCard.tsx`
- `src/tenders/components/tender-integral-analysis-v3.css`
- `src/tenders/tenderDecisionBriefModel.ts`
- `src/tenders/types.ts`
- `tests/agt002-manizales-decision-review-presentation.test.mjs`
- `tests/agt002-manizales-decision-review-ui.test.mjs`
- `tests/agt002-manizales-exercise-decision-review.test.mjs`
- `tests/agt002-v3-open-questions-visibility.test.mjs`
- `tests/agt002-v3-real-analysis-view.test.mjs`
- `tests/fixtures/agt002-manizales-exercise-decision-review.v1.json`
- `tests/tender-decision-brief-ui.test.mjs`
- `tests/tender-decision-brief-v2.test.mjs`
- `tests/tender-detail-navigation.test.mjs`
- `tests/tender-document-actions-layout.test.mjs`
- `tests/tender-executive-projection.test.mjs`
- `tests/tender-guided-workspace-ui.test.mjs`
- `tests/tender-question-responses.test.mjs`
- `tests/tender-summary-public-fields.test.mjs`
- `CURRENT.md` (este checkpoint sustituye el corte viejo de este worktree).

Archivos/rutas no rastreados observados:

- `docs/superpowers/plans/2026-08-20-agt002-decision-front-consolidation.md`
- `src/tenders/components/TenderGoNoGoDecisionSummary.tsx`
- `src/tenders/tenderDecisionSurface.ts`
- `src/tenders/tenderIntegralAnalysisPresentation.ts`
- `tests/fixtures/tender-integral-analysis-dynamic.v3.json`
- `tests/helpers/bundle-react-component.mjs`
- `tests/tender-decision-front-render.test.mjs`
- `tests/tender-decision-surface.test.mjs`
- `tests/tender-integral-analysis-presentation.test.mjs`

Archivos operativos bajo `.superpowers/sdd/` relevantes, aunque puedan estar ignorados por Git:

- `context-checkpoint.md`
- `progress.md`
- `task-5-brief.md`
- `task-5-resume-report.md`
- `task-5-review.diff`
- `task-6-brief.md`
- `task-6-report.md`
- `task-6-review.diff`
- `task-7-brief.md`
- `task-7-1-report.md`

Diffstat rastreado observado antes de este checkpoint: **28 archivos, 1.808 inserciones y 731 eliminaciones**. Todos los cambios continúan sin commit.

## 7. Riesgos y bloqueos vigentes

1. **Task 7.1 no verificada:** el helper/refactor puede tener un error de ejecución aunque exista en disco.
2. Aserción específica pendiente de confirmar: React server puede serializar `<details open>` como `open=""`; el reporte del worker señala esa suposición.
3. El test del piloto ejecuta el motor completo y puede ser más lento.
4. El metadato `files_touched: []` del worker ha sido poco fiable; la verdad se verificó directamente en disco.
5. El sandbox de `claude_worker` no permite ejecutar Node/TypeScript sin aprobación; Hermes debe correr las verificaciones.
6. QA visual autenticada local, escritorio/móvil, accesibilidad y screenshots aún no han comenzado.
7. Deuda para QA: el observer conserva `deps: []`; las seis anclas deberían montarse en el mismo commit, pero debe verificarse en navegador.
8. Minor Task 5: posible sobreconteo del puntero de pendientes en el panel GO/NO GO.
9. Producción sigue referenciada en `7ad7b91` y no coincide con `main`; queda prohibido desplegar `main` a ciegas.
10. No hay autorización para commit, push, merge, migración ni deploy.

## 8. Próximo paso exacto para retomar

Después de autorización expresa para continuar, **no iniciar un worker primero**. Ejecutar exactamente:

```bash
cd /root/worktrees/agt002-decision-front-consolidation
node --test tests/tender-decision-front-render.test.mjs
```

- Registrar conteo, fallos y exit code reales.
- Si falla, corregir únicamente helper/pruebas de Task 7.1 mediante TDD y repetir la prueba aislada.
- Si pasa, ejecutar la suite focal completa indicada en `.superpowers/sdd/task-7-brief.md` §7.2.
- Sólo después ejecutar `npx tsc --noEmit`, `npx vite build` y `npm run check:backend-parity`.
- Luego realizar QA visual local autenticada con Playwright en escritorio y móvil, generar screenshots y `docs/verification/2026-08-20-agt002-decision-front-consolidation.md`.
- Finalmente solicitar revisión independiente. No commit, push, merge, migración ni deploy sin autorización separada.

## 9. Estado de pausa (historial y estado actualizado)

- **Histórico:** el 2026-08-20 se ordenó PAUSA TOTAL (sin herramientas, workers, pruebas ni cambios) a la espera de autorización del usuario. Esa evidencia se conserva.
- **Estado actual:** la **pausa fue levantada**. Ya no rige la PAUSA TOTAL.
- **Task 7 está en HOLD parcial**, no cerrada, por dos bloqueos vigentes:
  1. QA visual autenticada y screenshots imposibles sin sesión autorizada;
  2. los hallazgos **Important** de la revisión independiente requieren autorización expresa para modificar producción/reabrir Task 5.
- **No hay autorización** para commit, push, merge, migración, deploy ni restart.
- El detalle verificado de la reanudación está en la **§10**, que es la sección autoritativa.

## 10. Reanudación 2026-08-21 — Task 7.1 y gates Task 7

### 10.1. Smoke de `claude_worker` (solo lectura)

- Resultado: `success: true`, modelo `claude-sonnet-5`, exit 0, respuesta `WORKER_OK`.
- Marca de estado emitida: **TASK_7_1_HOLD**.

### 10.2. Corrección de ruta

- La ruta errónea `apps/api/...` fue corregida por Juan.
- Ruta real y única válida: `tests/tender-decision-front-render.test.mjs`.

### 10.3. Dependencias

- El primer test tras el restart **falló antes de llegar a las aserciones** por dependencias ausentes.
- `npm ci --ignore-scripts`: **144 paquetes, 0 vulnerabilidades, exit 0**.

### 10.4. RED fresco

```bash
node --test tests/tender-decision-front-render.test.mjs
```

- Resultado: **26/27 PASS**, exit 1.
- Único fallo: `not_applicable`, causado por un `assert` global (no acotado a una tarjeta concreta).

### 10.5. Cambio único de Task 7.1

- En `tests/tender-decision-front-render.test.mjs` se añadió el helper `extractCardByTitle`.
- Los tres asserts de `not_applicable` se acotaron al `article` de `CONDITION_PRESENTED`.
- **Sin cambios de producción ni de configuración.** Ese fue el único cambio.

### 10.6. GREEN aislado

- `node --test tests/tender-decision-front-render.test.mjs`: **27/27 PASS, exit 0**.

### 10.7. Suite focal exacta §7.2

- Resultado: **117/117 PASS, 0 fail, exit 0**.

### 10.8. Gates técnicos

- `npx tsc --noEmit`: **exit 0**.
- `npm run check:backend-parity`: **backend parity OK, exit 0**.
- `npx vite build`: **129 módulos, build 566 ms, exit 0**; advertencia **no bloqueante** de chunk > 500 kB.

### 10.9. Higiene de diff y gates cerrados

- `git diff --check`: **exit 0**.
- **No** se realizó commit, push, merge, migración, deploy ni restart.

### 10.10. QA visual autenticada — BLOQUEADA

- No existe `.env.local` ni en el worktree ni en el canónico.
- El navegador aislado queda en la pantalla de login, sin sesión.
- No hay `storageState` ni identidad/contraseña de QA disponibles.
- El archivo externo `/root/psi-comercial/plataforma-ventas/app/.env.local` **existe** y contiene llaves de Supabase, pero **no** contiene identidad QA; **sus valores no se imprimieron**.
- Crear el usuario `qahermes` está **fuera de alcance**.
- **No se generaron screenshots** y **no se simuló ni se fingió** QA.

### 10.11. Revisión independiente (solo lectura, `claude-opus-5`, exit 0)

- **Critical:** ninguno.
- **Important (verificado):**
  - `TenderGoNoGoDecisionPanel.tsx` líneas **45-46**: deriva `blockers`/`conditions` **sin** `questionResponses`, por lo que el conteo de pendientes y el warning del modal **no disminuyen**.
  - `main.tsx` línea **841**: no pasa las respuestas al panel, aunque el brief sí las recibe.
- **Minor:**
  - Restauración de foco vulnerable si el trigger desaparece.
  - La cobertura no prueba el conteo ni el warning del panel con respuestas.
- **No corregido** por la prohibición vigente de tocar producción / Tasks 0-6.

### 10.12. Estado del HOLD

- **EL HOLD NO SE RETIRA.**
- Bloqueos actuales:
  - (a) QA visual autenticada + screenshots, imposibles sin sesión autorizada;
  - (b) los **Important** de la revisión requieren autorización expresa para modificar producción / reabrir Task 5.
- **Task 7 sigue `in_progress`.**

### 10.13. Próximo paso exacto

1. Juan debe resolver/autorizar un **mecanismo seguro de sesión QA local**.
2. Juan debe decidir si autoriza corregir el **Important** del panel.
3. **No crear usuarios ni generar bypass.**
4. Cuando se autorice: aplicar **TDD mínimo** al panel; repetir **27/117/tsc/build/paridad**; ejecutar **QA desktop/mobile**; generar **screenshots**; actualizar la evidencia y la revisión final.
5. **Sin commit, push ni deploy.**

## 11. GO limitado 2026-08-21 — cierre del Important de TenderGoNoGoDecisionPanel

> Esta sección es autoritativa y supera a la **§10 únicamente** para lo relativo al cierre del Important del panel `TenderGoNoGoDecisionPanel` descrito en §10.11/§10.12. Para todo lo demás (QA visual, bloqueos de sesión, gates de publicación), sigue rigiendo lo indicado en §9/§10.

### 11.1. Autorización

- Juan autorizó reabrir **únicamente Task 5**, y sólo para corregir el Important señalado en §10.11 sobre `TenderGoNoGoDecisionPanel`.
- Alcance explícitamente excluido: sin refactors visuales, sin operaciones externas (sin commit, push, merge, migración, deploy ni restart).

### 11.2. TDD RED

- Se añadió una prueba real del panel en `tests/tender-decision-front-render.test.mjs`.
- Primera ejecución: **28 tests, 27 PASS, 1 FAIL, exit 1**.
- Único fallo: con una respuesta `resolved` más reciente, el panel seguía mostrando `Revisar pendientes en Análisis`.

### 11.3. Implementación mínima

- Nueva prop `questionResponses: TenderQuestionResponse[]` en el panel.
- `main.tsx` pasa `tenderQuestionResponses` al panel.
- El panel pasa esas respuestas a `tenderDecisionBlockers`/`tenderDecisionConditions`.
- `pendingConditions` filtra sólo el estado `Pendiente de validación`.
- La selección de la respuesta más reciente por `responded_at` sigue usando el selector existente; no se introdujo lógica paralela.

### 11.4. Primer intento GREEN (incompleto)

- Permaneció en **27/28** porque faltaba filtrar por estado.
- El fixture y los timestamps eran correctos; no fue necesario tocarlos.
- Se añadió únicamente el filtro de estado descrito en §11.3; **no se modificó el test**.

### 11.5. GREEN final

- `node --test tests/tender-decision-front-render.test.mjs`: **28/28 PASS, exit 0**.

### 11.6. Suite focal exacta (15 archivos, §7.2)

- Resultado: **118/118 PASS, exit 0**.

### 11.7. Gates técnicos

- `npx tsc --noEmit`: **exit 0**.
- `npx vite build`: **129 módulos, 503 ms, exit 0**; advertencia **no bloqueante** de chunk > 500 kB.
- `npm run check:backend-parity`: **backend parity OK, exit 0**.
- `git diff --check`: **exit 0**.

### 11.8. Revisión independiente final (`claude-opus-5`)

- **Critical:** ninguno.
- **Important:** ninguno.
- El hallazgo inicial sobre `blockers` fue **retirado** al revisar el contrato: los `blockers` siguen siendo impedimentos confirmados aunque tengan validación humana; sólo las `decision_questions` se filtran como pendientes.
- **Minor preexistente/fuera de alcance:** el enlace `Revisar pendientes en Análisis (N)` suma `blockers` bajo ese mismo rótulo.

### 11.9. Estado

- El Important autorizado en §10.11 queda **CERRADO localmente**.
- **Task 5 no se reabre para nada más** allá de este fix.
- **Task 7 sigue en HOLD**, únicamente por el bloqueo de QA visual autenticada manual y screenshots (§10.10, §10.12).

### 11.10. Reglas QA vigentes (sin cambios)

- No crear `qahermes`.
- No usar service-role ni suplantación.
- No pedir ni publicar contraseñas.
- Cuando exista sesión humana autorizada: `storageState` temporal fuera del repo, `chmod 0600`, uso limitado a desktop/móvil/accesibilidad/screenshots, y eliminación al terminar.
- Actualmente **no existe mecanismo seguro** de sesión en el navegador host: se reporta el bloqueo y **se detiene** aquí.

### 11.11. Gates cerrados

- **Sin commit, push, merge, migración, deploy ni restart.**

### 11.12. Próximo paso exacto

- Esperar a que exista un mecanismo seguro de sesión humana manual.
- **No ejecutar más herramientas ni cambios** por este alcance hasta entonces.

## 12. Cierre final autoritativo 2026-08-21 — Task 7 CERRADA LOCALMENTE / QA PASS

> **Esta es la sección autoritativa vigente para Task 7 y sustituye expresamente §9, §10 y §11 en todo lo relativo a su estado, HOLD, QA, revisión y siguiente paso.** Esas secciones se conservan sin borrado como historial de RED, bloqueos y correcciones previas.

### 12.1. Estado y alcance seguro

- **Task 7: CERRADA LOCALMENTE / QA PASS.** El HOLD de Task 7 descrito en §9–§11 queda superado.
- El cierre cubre sólo el worktree local `/root/worktrees/agt002-decision-front-consolidation` y la evidencia local; los cambios permanecen sin commit.
- No se ejecutaron: commit, push, merge, migración, deploy, restart, cambios de producción, cambios de roles/permisos ni escrituras CRM.
- Los gates de publicación siguen **cerrados**. Cualquier publicación o fase nueva requiere una **orden separada**.

### 12.2. Evidencia TDD y regresión de Task 7

1. **RED inicial de accesibilidad/navegación:** 33 tests, **28 PASS / 5 FAIL**.
2. **GREEN inicial:** **51/51 PASS** tras la corrección focal.
3. La revisión independiente detectó riesgos de **SSR, teclado y textarea**; se incorporaron a la regresión focal.
4. **RED de regresión:** 25 tests, **22 PASS / 3 FAIL**.
5. **GREEN focal ampliado:** **54/54 PASS**.
6. La inspección visual humana de `mobile-analisis.png` detectó un recorte de la píldora **Pendiente de validación** a 375 px que no estaba cubierto por los 36 gates funcionales.
7. **RED responsive suplementario:** **4 PASS / 1 FAIL**. La primera corrección mínima dejó el test en **5/5 PASS**, pero una revisión independiente detectó que `align-items: stretch` no vencía la especificidad de la regla base.
8. Se endureció el contrato para exigir un selector suficientemente específico y `width: 100%` explícito: segundo **RED 4/5**.
9. Corrección final: `.tender-question-response-card>header.tender-condition-head{align-items:stretch;flex-direction:column}` y `.tender-condition-state{min-width:0;width:100%}`. **GREEN final: 5/5 PASS**.
10. Navegador real a 375×844: `direction=column`, `align=stretch`, `stateWidth=311px`, documento `375/375`, tarjeta `335/335` y píldora completamente contenida. Evidencia: `mobile-condition-card-after.png`.

### 12.3. Gates técnicos y revisión final

- Suite completa final: `node --test --test-force-exit tests/*.test.mjs` → **812 total, 811 PASS, 0 FAIL, 1 SKIP, exit 0**. `--test-force-exit` cierra handles residuales de PGlite después de emitirse TAP; no omite pruebas.
- `npx tsc --noEmit` → **exit 0**.
- `npx vite build` → **129 módulos, exit 0**; advertencia de chunk >500 kB registrada como **no bloqueante**.
- `npm run check:backend-parity` → **backend parity OK, exit 0**.
- Contrato de navegación `navigation-dashboard-default-static.test.mjs` → **1/1 PASS**.
- `git diff --check` → **exit 0**.
- Revisión independiente final del delta responsive → **0 Critical / 0 Important / 0 Minor; sin cambios requeridos**.

### 12.4. QA autenticada y evidencia visual final

- Informe canónico autenticado: `/root/.hermes/qa/agt002-evidence/qa-report.json` → **36/36 PASS, 0 FAIL**.
- `axe` desktop y móvil: **0 violaciones**.
- `console_errors`, `request_failures`, `http_errors` y `blocked_writes`: vacíos.
- Guard de escritura: `POST/PUT/PATCH/DELETE` bloqueados en rutas locales CRM `/api/`; no hubo intentos de escritura.
- Móvil post-layout: muestras posteriores de Decisión y Análisis estables en `top=142`, seis muestras por destino y `range=0`; foco y `aria-current` correctos.
- Evidencia visual total: **14 capturas** — 12 autenticadas originales y dos suplementarias (`mobile-condition-card-after.png`, `sidebar-contract-licitaciones.png`) inventariadas en `QA-SUMMARY.md`.
- La captura autenticada `mobile-analisis.png` conserva el hallazgo responsive previo como evidencia RED; no fue sobrescrita ni presentada como post-fix.
- Notas no bloqueantes: los enlaces de condición V3 son **N/A** porque no están presentes en la forma actual del manifiesto; el modal GO/NO GO quedó bloqueado por acceso real de sólo lectura, sin alteración de permisos.

### 12.5. Aclaración final: Licitaciones/Radar

- Juan confirma que en la plataforma real, con su usuario, **sí ve Licitaciones**. Por tanto, queda retirada la interpretación anterior de que su perfil real carecía de acceso.
- La sesión local autenticada usada para QA resolvió un conjunto de capacidades distinto o incompleto y ocultó el grupo. Se clasifica como **discrepancia de sesión QA**, no como defecto del código ni falta real de acceso de Juan.
- El código conserva el grupo **Licitaciones** y la ruta Radar `#/tenders?view=radar` de forma idéntica en la base `408dbc...`, la referencia de producción `7ad7b...` y HEAD/current.
- El contrato ejecutable real `getVisibleNavGroups`, con la capability `licitaciones`, produjo `Licitaciones → Radar → #/tenders?view=radar`. El fixture visual suplementario `sidebar-contract-licitaciones.png` lo muestra visible, activo, contenido y sin recorte.
- No se cambiaron roles, permisos, datos ni producción.

### 12.6. Limpieza y observación de datos

- Limpieza operativa **completada**: QA Chrome, Xvfb, Fluxbox, x11vnc y websockify detenidos; puertos `5900`, `6080` y `9223` cerrados; storage state, secreto/archivo VNC y perfil Chrome eliminados.
- Se conservaron sólo evidencia y runner QA. Backend 4173, Vite 5173 y gateway PID 426375 permanecieron vivos.
- Se observó un carácter corrupto en el nombre vivo del expediente. Los artefactos versionados contienen correctamente `Rama Judicial — Dirección…`; no se realizó escritura de datos.

### 12.7. Próximo paso

- Mantener cerrados los gates de publicación.
- Cualquier publicación o fase posterior requiere orden explícita y separada; no forma parte de este cierre local.

## 13. Cierre autoritativo de publicación 2026-08-21 — PUBLICADO / QA PROD PASS

> **Esta es la sección autoritativa vigente para el estado final de AGT-002.** Sustituye §1–§12 únicamente respecto de publicación, QA de producción, limpieza y próximos pasos; §1–§12 permanecen intactas como historial verificable.

### 13.1. Publicación y rollback

- PR de publicación: **#113**.
- Merge publicado en `main`: **`a6cf4a644fdf61015020495893756cb755e2028b`**.
- Deployment Vercel: **`dpl_Dp7TAssBg2nPZymHTd6ercfEjCr3`**, estado **Ready**.
- Producción: **https://seguridad-nacional-crm.vercel.app**.
- Rollback identificado y disponible: **`dpl_6oz2Qh7h28K73fMUvf4v1Q7BYTKR`**.
- La regla de protección de `main` usada durante la publicación quedó **restaurada**.

### 13.2. QA de producción y seguridad operacional

- Smoke autenticado de producción: **33/33 PASS**.
- Escrituras observadas durante QA: **0**.
- Evidencia canónica: **`/root/.hermes/qa/agt002-prod-evidence/`**.
- Limpieza operativa: **completa**; no quedaron artefactos temporales del proceso.

### 13.3. Cierre documental

- Este cambio modifica **únicamente `CURRENT.md`**.
- Es un cierre exclusivamente documental: **sin cambios de aplicación y sin redeploy de Vercel**.
- Estado final: **PUBLICADO / QA PROD PASS, sin pendientes**.

---

## 14. AGT-002 Radar — gate, preanálisis y aprendizaje gobernado (estado local, 2026-08-25)

> **No sustituye a §13.** §13 sigue siendo la sección autoritativa del frente de decisión AGT-002.
> Esta sección registra un alcance **distinto y local**: la cadena del Radar, entregada **apagada**.

### 14.1. Alcance y documentos

- Spec: `docs/superpowers/specs/2026-08-25-agt002-radar-learning-design.md`.
- Plan: `docs/superpowers/plans/2026-08-25-agt002-radar-learning-implementation.md`.
- Runbook operacional: `docs/runbooks/agt002-radar-pipeline.md`.

### 14.2. Estado de flags — ambos OFF

- `AGT002_RADAR_GATE`: **OFF**. `AGT002_RADAR_VISIBILITY`: **OFF**.
- Declarados en `ANALYSIS_FLAG_NAMES` (`agt002-analysis-config.js`) con la semántica congelada del
  módulo: sólo `'true'`/`'1'` encienden; cualquier otro valor, incluida la ausencia, queda apagado.
- Dependencia fail-closed activa: `AGT002_RADAR_VISIBILITY` sin `AGT002_RADAR_GATE` **lanza** en
  `buildAgt002AnalysisConfig`.
- **No se encendió ningún flag en ningún entorno.**

### 14.3. Esquema — creado en Git, no aplicado

- `supabase/migrations/071_agt002_radar_gate.sql` y
  `supabase/migrations/072_agt002_radar_preanalysis_ledger.sql` existen en el árbol, con sus
  rollbacks independientes (`supabase/rollbacks/071_...`, `supabase/rollbacks/072_...`).
- **No se aplicaron a ninguna base real ni a producción.** La cola durable existe sólo como esquema
  local: ninguna tabla real creada, ningún job persistido.
- Orden de rollback, si algún día se aplican: `072` primero, `071` después. Ninguno toca
  `psi_public_tenders`.

### 14.4. Entrypoint — creado, no instalado

- `ops/agt002-radar-pipeline/` existe en Git con runner, `.service`, `.timer`, `env.example` y
  `README.md`.
- **`systemctl` nunca se ejecutó.** Ninguna unidad instalada, ninguna habilitada, ningún temporizador
  corriendo. Instalar y habilitar son dos autorizaciones separadas entre sí y separadas del flag.

### 14.5. Lectura del Radar

- `readPersistedTenderRadar` (`server/index.js` y su par byte-idéntico `api/[...path].js`) aplica el
  filtro de visibilidad **sólo** bajo `agt002AnalysisConfig.AGT002_RADAR_VISIBILITY`, sobre filas de
  base de datos y **antes** de `dbTenderToPublic`.
- Con el flag apagado —el estado actual— **no se emite ninguna consulta adicional** y el payload es
  el de siempre.
- Fallo de lectura del ledger con el flag encendido ⇒ `AGT002_RADAR_VISIBILITY_LEDGER_UNAVAILABLE`
  (HTTP 503) vía `sendError`. Recuperación: apagar el flag.
- `persistTenderRadar` **no se modificó**: la ingesta cruda sigue intacta.

### 14.6. Gates cerrados

- **Sin push, sin PR, sin merge, sin migración productiva, sin deploy, sin cambio de flags
  productivos.** Los commits son locales.
- Sin cambios bajo `src/`: no hay cambios visuales.
- Producción **no** se asume igual a `origin/main` (§7.9 sigue vigente): cualquier acción futura
  contra producción exige reconfirmar antes el commit realmente desplegado.

### 14.7. Verificación local ejecutada — PASS

Matriz ejecutada el 2026-08-26, sin aplicar migraciones a bases reales y con ambos flags apagados:

- Focal Radar: **19/19 PASS**.
- Suite AGT-002: **535 tests; 534 PASS, 1 SKIP, 0 FAIL**.
- Suite completa: **900 tests; 899 PASS, 1 SKIP, 0 FAIL**.
- PGlite `071` y `072`: ciclos apply/verify/rollback **PASS** dentro de la suite focal.
- `npm run check:backend-parity`: **PASS** (`backend parity OK`).
- `npm run build`: **PASS**; permanece sólo la advertencia no bloqueante de chunk cliente mayor a 500 kB.
- `git diff --check`: **PASS**. Los artefactos nuevos quedan en modo Git `100644`.
- La prueba dinámica con transportes falsos verificó que auditoría histórica, reporte de aprendizaje y
  dry-run sólo usan `GET` contra Supabase y no llaman RPC de persistencia ni de cola.

La auditoría contra el entorno local fue intentada, pero la URL Supabase configurada no fue parseable;
por tanto **no hay resultado histórico real ni autorización de rollout**. El dry-run vivo no se ejecutó
porque no había una fuente Supabase válida de la cual elegir una sobreviviente. Ningún intento escribió
datos.

### 14.8. Próximo paso exacto

**Detenerse.** Corregir/proveer credenciales read-only válidas, ejecutar la auditoría histórica y exigir
`uncovered_visible_tenders = 0` con revisión humana antes de cualquier rollout. Aplicar `071`/`072`,
instalar la unidad, encender `AGT002_RADAR_GATE`, habilitar el temporizador y encender
`AGT002_RADAR_VISIBILITY` siguen siendo **cinco autorizaciones distintas**. Este cierre no concede
ninguna de ellas.

---

## 15. AGT-002 Radar — rollout productivo, hotfix de churn y QA E2E (2026-08-28)

> **No sustituye a §13.** §13 sigue siendo la sección autoritativa del frente decisional AGT-002.
> Esta sección **sí sustituye a §14**, exclusivamente para el estado operativo del Radar (gate,
> ledger, visibilidad, worker y auditoría). §14 queda conservada íntegra como historial local previo
> al rollout; deja de ser la referencia vigente para el estado del Radar.

### 15.1. Publicación y despliegue

- PR de rollout/hotfix: **#147**.
- Merge/deploy exacto: **`6a666baa082615d74ba5389925ddd96931dfd555`**.
- Backup previo al hotfix: **`/root/agt002-radar-backup-20260828T142403Z-hotfix147`**.
- Spec de referencia: `docs/superpowers/specs/2026-08-28-agt002-radar-derived-day-churn-hotfix.md`.
- Runbook operacional vigente: `docs/runbooks/agt002-radar-pipeline.md`.

### 15.2. Causa raíz y alcance del hotfix

- El hash literal usado para detectar cambios materiales incluía `raw.days`/`raw.window`
  **recalculados**, no los valores crudos persistidos; eso producía churn — el mismo expediente
  cambiaba de hash entre corridas por variación derivada del día/ventana, no por un cambio real del
  dato fuente.
- El hotfix **alinea** el scan, el preflight del worker legacy, la visibilidad y la auditoría para
  que todos midan el mismo criterio de materialidad sobre datos crudos, no derivados.
- Regla **fail-closed** explícita: ante cualquier diferencia **material o ambigua**, política/contexto
  **incompatible**, `raw` **inválido**, u **offset > 60**, el sistema falla cerrado (no procesa,
  no expone).
- **Sin heurística difusa (no fuzzy)** y **sin autoridad sobre CRM ni sobre la decisión GO/NO-GO**: el
  Radar sigue siendo estrictamente un mecanismo de detección/cola, no un tomador de decisiones.

### 15.3. QA de código — PASS

- Suite completa: **1052 tests; 1051 PASS, 0 FAIL, 1 SKIP**.
- `npx tsc --noEmit`: **PASS**.
- `npm run check:backend-parity`: **PASS**.
- `npm run build`: **PASS**.
- Revisión independiente detectó un problema de **visibilidad**; fue corregido y la re-revisión dio
  **PASS, 0 Critical, 0 Important**.

### 15.4. QA live — scan inicial

- Scan inicial: **250 evaluated, 31 survivors, 13 enqueued**.
- De los encolados: **13 satisfied exact, 5 satisfied_derived_only, 0 rejected**.
- Auditoría inicial correspondiente: **total 1302**, **survivors 37**, **missing 6**,
  **stale_hash 7**, **fresh_mostrar_en_radar 24**, **uncovered 13**.

### 15.5. QA de sync e idempotencia

- Export directo `/root/.hermes/scripts/secop_psi_radar_export.sh`: **exit 0**.
- Dos scans consecutivos produjeron resultados **idénticos**: `evaluated 250 / survivors 31 /
  enqueued 11 / satisfied 15 / satisfied_derived_only 5 / rejected 0`.
- La cola durable permaneció en **16** entre ambos scans. Conclusión: los 11 "enqueued" del segundo
  scan **no fueron inserciones nuevas**, sino **respuestas idempotentes** sobre jobs ya activos en
  la cola.

### 15.6. E2E worker — jobs reales

- Dos jobs reales completaron el ciclo completo `claim → fetch_row → gate → ledger → learning → agt
  → persist`:
  - `b69175a0-1106-436c-8ce8-d6803e5c0ae8`.
  - `f8b10458-6bec-4a46-b2cc-4850108a3554`.
- Primer churn legacy observado, job `b5753f87-245e-4a6b-a74c-06da3f1a52b9`: cerró como
  `unavailable/stale_input`, con etapas limitadas a `claim → fetch_row → gate → ledger`, **sin**
  llegar a `learning`, sin invocar modelo y sin `persist`. Comportamiento fail-closed esperado ante
  un input obsoleto, no un fallo del pipeline.

### 15.7. Estado live tras esa observación

- **15 queued** = **4 derived_only** demostrados (churn legacy, se neutralizan solos) + **11
  reales/ambiguos** (siguen el modelo normal).
- `current_job_identity_mismatch`: **0**.
- Auditoría en ese punto: **missing 5, stale_hash 6, fresh 26, uncovered 11**.
- `ready_for_visibility_flag`: **false**.
- Ledger: **available**.
- `AGT002_RADAR_GATE`: **true**. `AGT002_RADAR_VISIBILITY`: **false**.
- Temporizador: **active**, `OnUnitActiveSec=15m` + jitter de **90 s**, máximo **1 job por tick**.
- Cron diario: **activo**, `0 13 * * 1-5`; próxima corrida **2026-08-31T13:00:00Z** (08:00
  Colombia).
- **No acelerar ni drenar manualmente la cola.** Los 4 derivados restantes se neutralizan de forma
  natural en corridas siguientes; los 11 reales siguen el flujo de modelo normal, sin intervención.

### 15.8. Estado honesto — sin visibilidad aún

- El código está desplegado y el hotfix quedó **validado end-to-end** con jobs reales.
- El backlog gobernado **sigue drenando por temporizador**; no se ha vaciado ni acelerado.
- Por tanto, el Radar **todavía no está listo para activar `AGT002_RADAR_VISIBILITY`** hasta que la
  auditoría reporte `uncovered = 0` y exista **revisión humana** de ese resultado.
- No se afirma "sin pendientes": quedan pendientes activos, gobernados por el temporizador y el cron,
  bajo seguimiento.

### 15.9. Gates y próximo paso

- Sin push adicional, sin nuevas migraciones, sin cambios de flags productivos más allá de los ya
  registrados en §15.7.
- Próximo paso exacto: dejar correr el temporizador y el cron programado (§15.7); tras el drenaje
  natural del backlog, repetir la auditoría y exigir `uncovered = 0` con revisión humana antes de
  encender `AGT002_RADAR_VISIBILITY`. Ver `docs/runbooks/agt002-radar-pipeline.md` para el
  procedimiento operativo detallado.

---

## 16. Cierre AGT-002 y continuidad (2026-09-01)

> Esta sección es la autoritativa vigente para el estado general y la continuidad de AGT-002 al
> 2026-09-01. **No sustituye** a §13 (cierre de publicación del frente decisional, 2026-08-21) ni a
> §15 (rollout operativo del Radar, 2026-08-28) para sus dominios respectivos: ambas siguen siendo la
> referencia histórica autoritativa de lo que describen. Esta sección añade el corte de cierre y
> continuidad sobre el trabajo hecho en la rama actual, que **aún no está publicado**.

### 16.1. Fuente de verdad separada de producción

- `origin/main` estaba en `00e22eaf7af4cc9712b58e1ef4896728a96f369a` antes de esta rama.
- Producción fue confirmada sana por HTTP: SPA responde `200`; API protegida responde `401` como se
  espera de una ruta que exige autenticación.
- Último deploy previamente verificado: `dpl_HmQdynLwUK4Ai7m2sMn5vZTW3kz4`.
- La rama actual, `fix/agt002-closeout-20260901`, **aún no ha sido publicada** (sin push).

### 16.2. Live/cerrado — decisiones humanas ya ejecutadas

- PR #167: revisión colaborativa.
- PR #168: polish y navegación.
- PR #169: contraste.
- Manizales y Bogotá quedan **archivados** por decisión humana **NO GO**, con sus expedientes
  preservados intactos; ambos quedan fuera de las licitaciones activas.

### 16.3. En rama — no afirmar live

Lo siguiente existe únicamente en `fix/agt002-closeout-20260901` y **no debe presentarse como
desplegado**:

- Corrección del issue #136 (medición de `usage` autoritativa desde el bridge; ver
  `agt002-radar-preanalysis-usage.js`); el issue **sigue sin cerrarse**, pendiente de integración.
- `npm test` ejecutado en la rama.
- Reparación robusta de dos pruebas históricamente frágiles.
- Code splitting del bundle.

### 16.3.1. Evidencia final ejecutada (2026-09-01)

- Baseline antes de cambios: 1189 tests, 1186 PASS, 2 FAIL históricos
  (`agt002-v3-open-questions-visibility`, `tender-opportunity-exit-ui`), 1 SKIP.
- Focal final usage/contract/runtime/persistence/pipeline/worker: **7/7 PASS**.
- Suite completa final mediante `npm test`: **1191 tests, 1190 PASS, 0 FAIL, 1 SKIP**.
- `npm run check:backend-parity`: **PASS**.
- `npm run build`: **PASS**. Antes: un JS de 829.39 kB (gzip 221.82 kB) con warning de chunk
  >500 kB. Después: chunk máximo `tenders` 404.55 kB (gzip 105.18 kB), sin warning;
  `chunkSizeWarningLimit` no fue modificado.
- `npm audit --audit-level=high`: **0 vulnerabilidades**.
- `git diff --check`: **PASS**.
- Escaneo de secretos: **20 archivos, 0 hits**.
- Revisión independiente inicial halló ambigüedad de costo 0/no medido; corregida a
  `cost_usd: null` cuando el bridge no lo entrega y al valor explícito sólo cuando sí lo entrega.
  Re-revisión focal: **APPROVE, sin hallazgos**.
- Producción, verificación predeploy: SPA responde `200`, API protegida responde `401`.
- Evidencia detallada: `docs/verification/2026-09-01-agt002-closeout.md`.

### 16.4. Clasificación de pendientes

- **Migración 062:** sin rollback exacto demostrable. Es un **gap aceptado y documentado**, no un
  defecto a resolver fabricando una inversión que no existe.
- **QA UI autenticada:** no se reabre como *blocker* técnico de este cierre.
- **Presupuesto real del modelo:** debe medirse únicamente antes del próximo canary, no antes.
- **PR #112:** obsoleto/superseded, ya **cerrado**.
- **PR #10 / PR #12:** pertenecen a SIIO, no a AGT-002; quedan fuera de este cierre, no tocados.

### 16.5. Próximo gate

1. PR → CI → merge → deploy → smoke productivo de esta rama.
2. Luego, Juan elige **una** licitación real (Pereira **o** Procuraduría, una a la vez) para
   atravesar el gate de onboarding (`docs/runbooks/agt002-process-onboarding-gate.md`) **sin copiar**
   Manizales ni Bogotá.
3. El humano decide y registra la decisión; AGT-002 no decide por sí mismo.

Documento de continuidad y aprendizaje para Juan:
`docs/operations/2026-09-01-agt002-mentoria-y-proximos-pasos.md`.
