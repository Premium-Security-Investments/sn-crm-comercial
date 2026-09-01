# AGT-002 — Mentoría y próximos pasos (2026-09-01)

**Para:** Juan.
**Contexto:** no existe ningún artefacto llamado "mentoría" en el repositorio ni en el historial de
AGT-002. Este documento cubre ese hueco: reúne lo aprendido y deja explícito qué sigue, en español
simple.

**Importante desde ya:** este documento distingue todo el tiempo entre **lo que está vivo en
producción** y **lo que sólo existe en la rama `fix/agt002-closeout-20260901`**. Lo segundo no debe
leerse como si ya estuviera funcionando para los usuarios reales.

## Qué quedó aprendido

- **Evidencia no es lo mismo que decisión.** AGT-002 puede reunir evidencia completa, clara y bien
  verificada, y aun así eso no reemplaza el juicio humano sobre qué hacer con ella.
- **AGT-002 recomienda, el humano decide.** El sistema puede señalar riesgos, faltantes o
  preguntas críticas, pero el GO/NO-GO, la firma, el envío y el compromiso de recursos siguen siendo
  actos humanos, no del sistema.
- **Los procesos de práctica se archivan, no se borran.** Cuando un ejercicio como Manizales o
  Bogotá termina en NO GO, el expediente se conserva íntegro como historial verificable; no se
  elimina ni se reescribe.
- **`usage` (consumo/tokens) sólo es confiable si viene del bridge.** El bloque de uso que reporta
  el propio modelo dentro de su respuesta es material auto-declarado y no es confiable por sí solo:
  el modelo no puede certificar sus propios tokens ni su propio costo. El único `usage` que el
  sistema acepta es el que mide el bridge (`agt002-hetzner-bridge-client.js` / issue #136), nunca el
  que el JSON del modelo intenta declarar.
- **Las pruebas deben validar comportamiento, no detalles internos.** Un test que se acopla al orden
  de los `imports` o a nombres internos de implementación se rompe con cualquier refactor inocuo,
  aunque el comportamiento real no haya cambiado. Las pruebas deben verificar lo que el sistema hace,
  no cómo está escrito por dentro.
- **Optimizar el bundle no es ocultar la advertencia.** El objetivo de trabajar sobre el tamaño del
  bundle es que cargue mejor de verdad (por ejemplo, mediante code splitting), no simplemente
  silenciar o esconder el warning de Vite sobre chunks grandes.

## Qué está terminado

- El frente decisional de AGT-002 (Análisis, Decisión, V3, navegación) está **publicado y en
  producción** desde el cierre documentado en `CURRENT.md` §13 (2026-08-21).
- El Radar de AGT-002 (gate, ledger, worker, auditoría) está **desplegado en producción** desde el
  rollout documentado en `CURRENT.md` §15 (2026-08-28), con visibilidad (`AGT002_RADAR_VISIBILITY`)
  todavía apagada a la espera de que la auditoría reporte `uncovered = 0`.
- PR #167 (revisión colaborativa), PR #168 (polish/navegación) y PR #169 (contraste) están
  mergeados y forman parte del estado live actual.
- Manizales y Bogotá quedaron cerrados como ejercicios de práctica: decisión humana **NO GO** en
  ambos, con sus expedientes preservados y fuera de las licitaciones activas.
- Producción fue verificada sana justo antes de este cierre: la SPA responde `200` y la API
  protegida responde `401` (comportamiento esperado sin sesión). El último deploy verificado es
  `dpl_HmQdynLwUK4Ai7m2sMn5vZTW3kz4`, sobre `origin/main` en `00e22eaf7af4cc9712b58e1ef4896728a96f369a`.

## Qué no es pendiente

Para evitar reabrir cosas que ya están resueltas o que nunca fueron un bloqueo real de este cierre:

- **La migración 062 sin rollback exacto** es un gap ya conocido y documentado, no un defecto nuevo
  que haya que fabricar una solución para él.
- **La QA de UI autenticada** no es un *blocker* técnico de este cierre; es trabajo aparte.
- **El presupuesto real del modelo** sólo se mide antes del próximo despliegue canario, no ahora.
- **PR #112** quedó obsoleto/superado por trabajo posterior; ya está **cerrado**.
- **PR #10 y PR #12** pertenecen al proyecto SIIO, no a AGT-002; no forman parte de este cierre.

## Evidencia final de la rama (2026-09-01)

La rama `fix/agt002-closeout-20260901` contiene trabajo que **todavía no está en producción**, con
la siguiente evidencia ya ejecutada:

- La corrección del issue #136 (medición autoritativa de `usage` desde el bridge): el costo se
  reporta como `cost_usd: null` cuando el bridge no lo entrega, y como el valor explícito sólo
  cuando el bridge sí lo entrega. El issue **sigue sin cerrarse** — la corrección existe en la
  rama, pendiente de integración.
- Baseline antes de cambios: 1189 tests, 1186 PASS, 2 FAIL históricos
  (`agt002-v3-open-questions-visibility`, `tender-opportunity-exit-ui`), 1 SKIP.
- La reparación robusta de esas dos pruebas históricamente frágiles.
- Focal final usage/contract/runtime/persistence/pipeline/worker: **7/7 PASS**.
- Suite completa final mediante `npm test`: **1191 tests, 1190 PASS, 0 FAIL, 1 SKIP**.
- `npm run check:backend-parity`: **PASS**.
- Code splitting del bundle: `npm run build` **PASS**. Antes: un solo JS de 829.39 kB
  (gzip 221.82 kB) con warning de Vite por chunk >500 kB. Después: chunk máximo `tenders`
  404.55 kB (gzip 105.18 kB), sin warning; `chunkSizeWarningLimit` no fue modificado.
- `npm audit --audit-level=high`: **0 vulnerabilidades**.
- `git diff --check`: **PASS**.
- Escaneo de secretos: **20 archivos, 0 hits**.
- Revisión independiente inicial halló ambigüedad de costo (0 vs. no medido), corregida como se
  describe arriba; re-revisión focal: **APPROVE, sin hallazgos**.
- Producción, verificación predeploy: SPA responde `200`, API protegida responde `401`.

Evidencia detallada: `docs/verification/2026-09-01-agt002-closeout.md`.

## Qué falta

Nada de lo anterior es live todavía. Falta, en orden:

1. Abrir el PR de esta rama.
2. Que corra CI y pase.
3. Merge a `main`.
4. Deploy.
5. Smoke test productivo sobre ese deploy.

La rama aún no ha sido publicada (sin push) y el issue #136 no está cerrado hasta que este gate se
complete.

## Próximo paso recomendado

Una vez cerrado el gate anterior (PR → CI → merge → deploy → smoke), el siguiente paso es que
**Juan elija una licitación real** — Pereira **o** Procuraduría, una a la vez, no ambas de una vez —
para llevarla a través del gate de onboarding de procesos
(`docs/runbooks/agt002-process-onboarding-gate.md`).

Esa licitación **no debe copiar** la configuración de Manizales ni de Bogotá: cada proceso nuevo
entra por su propio registro, su propia identidad y su propia aprobación humana explícita, siguiendo
el mismo criterio fail-closed que ya rige el resto de AGT-002. La decisión de cuál elegir y cuándo
avanzar es humana y debe quedar registrada por Juan, no asumida por el sistema.
