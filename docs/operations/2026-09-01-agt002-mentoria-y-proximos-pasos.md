# AGT-002 — Mentoría y próximos pasos (2026-09-01)

**Para:** Juan.
**Contexto:** no existe ningún artefacto llamado "mentoría" en el repositorio ni en el historial de
AGT-002. Este documento cubre ese hueco: reúne lo aprendido y deja explícito qué sigue, en español
simple.

**Importante desde ya:** el cierre descrito en este documento —incluida la corrección del issue
#136— ya está integrado a `main` y en producción. El PR #170 fue mergeado en
`b78981510b61d411450b6e046ccce5c10a9260da` (2026-09-01T23:20:12Z) y desplegado en
`dpl_Dk3j9CmZVuhV3yr9z8ZFWZawoKR6` (Production Ready), verificado con smoke postdeploy. Ninguna
parte de este cierre queda pendiente de publicación.

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

## Evidencia final del cierre (2026-09-01) — integrado y en producción

El trabajo antes desarrollado en la rama `fix/agt002-closeout-20260901` quedó integrado a `main` vía
PR #170 y desplegado en producción, con la siguiente evidencia:

- La corrección del issue #136 (medición autoritativa de `usage` desde el bridge): el costo se
  reporta como `cost_usd: null` cuando el bridge no lo entrega, y como el valor explícito sólo
  cuando el bridge sí lo entrega. El issue #136 está **cerrado** (2026-09-01T23:20:13Z).
- Baseline antes de cambios: 1189 tests, 1186 PASS, 2 FAIL históricos
  (`agt002-v3-open-questions-visibility`, `tender-opportunity-exit-ui`), 1 SKIP.
- La reparación robusta de esas dos pruebas históricamente frágiles.
- Focal final usage/contract/runtime/persistence/pipeline/worker: **7/7 PASS**.
- Suite completa final mediante `npm test`: **1191 tests, 1190 PASS, 0 FAIL, 1 SKIP**.
- `npm run check:backend-parity`: **PASS**.
- Code splitting del bundle: `npm run build` **PASS**. Antes: un solo JS de 829.39 kB
  (gzip 221.82 kB) con warning de Vite por chunk >500 kB. Después: chunk máximo productivo
  `tenders` 404.79 kB (gzip 105.42 kB), sin warning; `chunkSizeWarningLimit` no fue modificado.
- `npm audit --audit-level=high`: **0 vulnerabilidades** (confirmado también durante `npm install`
  en el build de Vercel).
- `git diff --check`: **PASS**.
- Escaneo de secretos: **20 archivos, 0 hits**.
- Revisión independiente inicial halló ambigüedad de costo (0 vs. no medido), corregida como se
  describe arriba; re-revisión focal: **APPROVE, sin hallazgos**.
- Integración: PR #170 mergeado 2026-09-01T23:20:12Z, squash
  `b78981510b61d411450b6e046ccce5c10a9260da`, en `origin/main`.
- Publicación: deploy manual `dpl_Dk3j9CmZVuhV3yr9z8ZFWZawoKR6`, Production Ready, alias
  `https://seguridad-nacional-crm.vercel.app`, sobre árbol idéntico a `origin/main`.
- Smoke postdeploy: SPA canónica `200`; los 9 assets JS/CSS listados en el HTML responden todos
  `200`; API protegida `/api/tender-opportunities` responde `401` con "Debe iniciar sesión.";
  pantalla de login visible; consola del navegador sin errores.

Evidencia detallada: `docs/verification/2026-09-01-agt002-closeout.md`.

## Gate de publicación cerrado

El gate de publicación quedó cerrado, en orden:

1. PR #170 abierto y mergeado a `main` (2026-09-01T23:20:12Z), squash
   `b78981510b61d411450b6e046ccce5c10a9260da`.
2. **No hay GitHub Actions, checks ni branch protection configurados en este repositorio.** El merge
   se sustentó en los gates locales listados arriba más una revisión independiente con veredicto
   APPROVE, no en un CI automatizado. No se afirma que "CI pasó".
3. Merge a `main` confirmado en `origin/main`.
4. Deploy manual exacto del árbol igual a `origin/main`: `dpl_Dk3j9CmZVuhV3yr9z8ZFWZawoKR6`,
   Production Ready.
5. Smoke test postdeploy ejecutado y en PASS (ver evidencia arriba).

El issue #136 está cerrado (2026-09-01T23:20:13Z). No se hizo QA de UI autenticada ni ejecución
real del bridge/modelo como parte de este cierre; eso no es un blocker de este gate — el
presupuesto real del modelo sigue midiéndose antes del próximo despliegue canario.

## Pendientes reales no bloqueantes

Estos dos puntos **no están cerrados** y no deben leerse como terminados en ningún resumen de este
cierre:

- **Worker durable post-bridge — diagnóstico OPEN.** El issue #136 cerró la autoridad de `usage` del
  PREANÁLISIS RADAR (`agt002-radar-preanalysis-usage.js`), pero **no** cerró el gap distinto descrito
  en `docs/architecture/agt002-phase9-runtime-open-gaps.md` §OPEN ("Durable worker post-bridge stage
  diagnostics"). El path legado `server/index.js::requestAgt002` sigue sin hooks ni classifier y
  conserva un error genérico. Este gap permanece **OPEN**: no bloquea el cierre productivo actual,
  pero debe cerrarse por TDD, preservando retry/claim, antes del próximo canary o activación real del
  worker.
- **Presupuesto real del modelo.** Sigue sin medirse contra el modelo efectivo; debe confirmarse
  antes del próximo despliegue canario, no ahora.

## Próximo paso recomendado

Con el gate de publicación de la sección anterior cerrado (issue #136, PR #170, deploy y smoke), el
orden de los próximos pasos es:

1. **Juan elige una licitación real** — Pereira **o** Procuraduría, una a la vez, no ambas de una
   vez.
2. **Antes de ejecutar el canary o el bridge para esa licitación**, cerrar el diagnóstico del worker
   durable post-bridge (ver "Pendientes reales no bloqueantes" arriba) mediante TDD que preserve
   retry/claim, y medir el presupuesto real del modelo.

Esa licitación **no debe copiar** la configuración de Manizales ni de Bogotá: cada proceso nuevo
entra por su propio registro, su propia identidad y su propia aprobación humana explícita, siguiendo
el mismo criterio fail-closed que ya rige el resto de AGT-002. La decisión de cuál elegir y cuándo
avanzar es humana y debe quedar registrada por Juan, no asumida por el sistema.
