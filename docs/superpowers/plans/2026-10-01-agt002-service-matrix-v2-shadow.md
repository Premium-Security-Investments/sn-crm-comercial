# Plan de implementación — AGT002 Radar: matriz de Servicio v2 data-driven (modo sombra)

**Fecha:** 2026-10-01 · **Spec:** `docs/superpowers/specs/2026-10-01-agt002-service-matrix-v2-shadow.md` · **Worktree:** `/workspace`.
Ningún paso usa `git add -A` ni `git add .`. Comando de prueba verificado en `package.json`: `npm test` = `node --test tests/*.test.mjs`.

> Convención ya vigente en este repo: los `*.test.mjs` son scripts planos (sin `describe`/`test()`) con `assert.*` a nivel superior; `node --test` falla el archivo si algo lanza (incluido un `import` que no resuelve).

## Tarea 0 — Preflight (sin código) [COMPLETADA en esta sesión]
1. `git status` — rama aislada actual, sin cambios previos relevantes.
2. Lectura íntegra de `tender-fit-policy.js`, `tender-relevance-terms.js`, `agt002-radar-gate.js`.
3. Lectura de `tests/tender-fit-policy.test.mjs` y `tests/agt002-radar-relevance-terms.test.mjs` para fijar el estilo de prueba del repo (script plano, `node:assert/strict`, sin framework de test adicional).
4. Confirmado: no existe `tender-service-matrix-v2.js` en el worktree (`Glob` sin resultados) — el rojo de la Tarea 2 es genuino, no un redescubrimiento de un rojo que ya no existe.

## Tarea 0.1 — Corrección de contrato RED (2026-10-01, misma sesión) [COMPLETADA]
La primera versión de este spec/plan/test redujo e inventó términos (listas acotadas "representativas" en vez de la transcripción completa, y expresiones de contexto/ambigua/suministro que no venían del diseño aprobado) y tenía dos errores de dominio (`suministro de personal de vigilancia` como ancla de suministro confundía suministro con guardas; `vigilancia epidemiologica` usada como ejemplo de exclusión condicional cuando en realidad es exclusión dura). El usuario corrigió esto en un prompt posterior de la misma sesión, proporcionando las listas exactas normalizadas por rol/familia. Esta tarea aplica esa corrección a spec (§5 reescrito íntegro) y test, sin tocar código de producción. **RED fue comprobado por el parent de esta sesión** ejecutando `node --test tests/tender-service-matrix-v2.test.mjs` y confirmando el fallo `ERR_MODULE_NOT_FOUND`; GREEN se completó en la Tarea 3.

## Tarea 1 (RED, sin código de producción) — Spec + plan [COMPLETADA en esta sesión]
- `docs/superpowers/specs/2026-10-01-agt002-service-matrix-v2-shadow.md`: transcribe el diseño aprobado por el usuario (roles `ANCLA`/`AMBIGUA`/`CONTEXTO`/`EXCLUSION`, tabla de puntaje por combinación de familias, reglas de exclusión dura/condicional por campo, normalización/matching de frase completa, forma de traza, contrato de validación fail-closed, contrato de integración sombra con `evaluateTenderFit`) sin leer el documento fuente fuera del worktree.
- Este plan.

## Tarea 2 (RED) — `tests/tender-service-matrix-v2.test.mjs` [COMPLETADA en esta sesión]
Archivo nuevo que importa de `../tender-service-matrix-v2.js` (no existe) y de `../tender-fit-policy.js` (existe). Cubre, en orden:

1. **Export shape**: `TENDER_SERVICE_MATRIX_V2_VERSION` string no vacío; `TENDER_SERVICE_MATRIX_V2` congelada; `validateTenderServiceMatrixV2(TENDER_SERVICE_MATRIX_V2 real)` no lanza.
2. **Cada familia sola**: texto con solo ancla `FISICA` (`vigilancia armada`) → 45/`FISICA`/`EN_ALCANCE`; solo `ELECTRONICA` (`cctv` + `control de acceso`) → 48; solo `SUMINISTRO` (`suministro e instalacion de camaras` — el ancla real de suministro, no `suministro de personal de vigilancia`, que no existe en la matriz y confundiría suministro con guardas) → 40.
3. **Híbrida**: física + electrónica (sin suministro) → 50/`HIBRIDA`.
4. **Combinaciones con suministro**: el ancla real `suministro e instalacion de camaras` junto con `seguridad electronica` → 48 (no 50); junto con `vigilancia armada` → 45; los tres juntos → 50 (suministro no baja la híbrida).
5. **Ambigua + 2 contextos, sin ancla**: `escolta con armas 24 horas` (ambigua `escolta` + contextos reales `con armas` y `24 horas`, ambos `family: null`) → 30/`AMBIGUA`/`POR_VALIDAR`.
6. **Ambigua sola (0 o 1 contexto), sin ancla** → 0/`null`/`FUERA_DE_ALCANCE` (el caso de un solo contexto usa `escolta con armas`, un único contexto real — no el `personal uniformado` inventado de la versión anterior).
7. **Exclusión dura en `title`** → `excluded: true`, `exclusion_rule: 'dura'`, `points: 0`, `status: 'EXCLUIDA'`, incondicional aunque haya ancla.
8. **Misma exclusión dura solo en `description`** (con ancla válida en `title`) → NO excluye; se califica normalmente por la familia del ancla.
9. **Exclusión condicional sin ancla** (`telecomunicaciones`, no `vigilancia epidemiologica` — esta última es exclusión **dura**, no condicional) → excluye. **Exclusión condicional con ancla** (`vigilancia armada con telecomunicaciones`) → NO excluye, se califica por la familia del ancla.
10. **Normalización/diacríticos**: mayúsculas y tildes (`SEGURIDAD ELECTRÓNICA`) resuelven igual que la forma normalizada.
11. **Límites de palabra/frase**: `"control de accesorios electronicos"` no dispara el ancla `"control de acceso"`; `"arco detectorado"` no dispara la ambigua `"arco detector"`.
12. **Traza / campo fuente / determinismo**: cada entrada de `trace` trae `term`, `role`, `family`, `field`, `rule`; dos llamadas idénticas producen `JSON.stringify` idéntico.
13. **Ausencia de términos retirados**: ningún término normalizado de `TENDER_SERVICE_MATRIX_V2` coincide con `transporte de valores` / `custodia y transporte de valores` / `manejo de valores`.
14. **Filas sin `points`**: ninguna fila de `TENDER_SERVICE_MATRIX_V2` tiene la clave `points`.
15. **Validador rechaza**: versión vacía; rol inválido; familia inválida; `AMBIGUA` sin familia; `EXCLUSION` con familia; fila con `points`; término con `.`; matriz con un término retirado; dos filas activas con el mismo término normalizado (duplicado/conflicto).
16. **Compatibilidad sombra**: `evaluateTenderFit(tender, { nowIso })` sigue devolviendo `policy_version: 'tender-fit-v1'` y el mismo `score`/`band`/`reasons` de hoy (comparado contra el cálculo documentado en `tests/tender-fit-policy.test.mjs`), y además expone `shadow.servicio_v2` con la misma forma que devuelve `evaluateTenderServiceMatrixV2` directamente sobre los mismos campos.
17. **Las siete expresiones amplias movidas nunca son `ANCLA`**: para `escolta`, `escoltas`, `proteccion a personas`, `camaras de seguridad`, `detector de metales`, `arco detector`, `central de monitoreo`, cada una existe en `TENDER_SERVICE_MATRIX_V2` únicamente como fila `role: 'AMBIGUA'`; ninguna fila `role: 'ANCLA'` usa estas frases como término.

**Ejecutar y confirmar rojo:**
```
node --test tests/tender-service-matrix-v2.test.mjs
```
**Fallo esperado:** `ERR_MODULE_NOT_FOUND` al resolver `../tender-service-matrix-v2.js` — el archivo de test falla por completo en la fase de `import`, antes de que corra ninguna aserción. Esto es el rojo correcto y suficiente para esta fase: fija el contrato íntegro (§4-§6 del spec) que la fase GREEN futura debe satisfacer literalmente.

No se modifica ningún archivo de producción en esta tarea.

## Tarea 3 (GREEN) — [COMPLETADA]
Creado `tender-service-matrix-v2.js` implementando el contrato fijado por spec + pruebas (matriz real con las filas de §5, `validateTenderServiceMatrixV2`, `evaluateTenderServiceMatrixV2`), y modificado `tender-fit-policy.js` únicamente para importar `evaluateTenderServiceMatrixV2` y añadir el campo `shadow.servicio_v2` (§4.7 del spec) sin tocar `score`/`band`/`reasons`/`policy_version` ni el eje `servicio` v1. Verificado por ejecución real (Tarea 4).

## Tarea 3.1 (RED, corrección de bug descubierto en revisión) — [COMPLETADA en este paso]
Una revisión posterior a la Tarea 3 (GREEN) detectó que el matching de `evaluateTenderServiceMatrixV2` cuenta como ancla `ELECTRONICA` independiente a términos que son en realidad subfrases contenidas literalmente dentro de un término `ANCLA`/`SUMINISTRO` (`instalacion de sistema de videovigilancia` contiene `sistema de videovigilancia`; `mantenimiento de cctv` contiene `cctv`; `instalacion de control de acceso` y `suministro de equipos de control de acceso` contienen `control de acceso`), inflando el resultado a `ELECTRONICA`/48 cuando el documento aprobado dice `SUMINISTRO`/40 puro. Este paso:
- Agregó la regla de corrección a la especificación (§4.3.1 y actualización de §4.6) y la documentó en el estado del spec.
- Agregó la sección 17 a `tests/tender-service-matrix-v2.test.mjs` con los 4 casos de absorción pura más el caso de ancla electrónica independiente fuera de span (`Instalación de control de acceso junto con servicio de seguridad electrónica recurrente` → `ELECTRONICA`/48).
- **No modificó** `tender-service-matrix-v2.js` ni `tender-fit-policy.js`.

**Verificación de rojo requerida al parent de esta sesión:**
```
node --test tests/tender-service-matrix-v2.test.mjs
```
A diferencia del rojo histórico de la Tarea 2 (que fallaba por `ERR_MODULE_NOT_FOUND` porque el módulo no existía), en este paso el módulo **sí existe** (GREEN de la Tarea 3 ya está implementado). El parent debe confirmar que el fallo es por **`AssertionError` dentro de la sección 17** (p. ej. `suministroVideovigilancia.family` siendo `'ELECTRONICA'` en vez del `'SUMINISTRO'` esperado por la nueva aserción) — **no** por `ERR_MODULE_NOT_FOUND`. Si el parent observa `ERR_MODULE_NOT_FOUND` aquí, eso indica una discrepancia de rama/entorno (p. ej. el archivo de la Tarea 3 no está presente en el checkout que el parent está probando) y debe investigarse antes de continuar a GREEN de esta corrección.

## Tarea 3.2 (GREEN de la corrección 3.1) — [COMPLETADA]
Implementada la absorción de §4.3.1 en `evaluateTenderServiceMatrixV2` (`tender-service-matrix-v2.js`): el matching ahora calcula spans `{ start, end }` por ocurrencia de término por campo (en vez de un booleano `includes` por fila/campo), y una coincidencia `ANCLA`/`ELECTRONICA` cuyo span queda completamente contenido en el span de alguna coincidencia `ANCLA`/`SUMINISTRO` del mismo campo queda marcada como absorbida: no activa la familia `ELECTRONICA` y su entrada de traza usa `rule: 'ancla_absorbida_por_suministro'`, `verdict: 'absorbida_por_suministro'`. Una coincidencia electrónica fuera de todo span de suministro se trata igual que antes. No se modificó `tender-fit-policy.js` (su único acoplamiento con v2 es delegar en `evaluateTenderServiceMatrixV2`, que conserva su firma y forma de salida). Ver detalle en spec §7.1. Verificado por ejecución real (Tarea 4).

## Tarea 4 — Verificación dirigida [COMPLETADA]
```
node --test tests/tender-service-matrix-v2.test.mjs tests/tender-fit-policy.test.mjs tests/tender-fit-backend-projection.test.mjs tests/tender-fit-cohort-audit.test.mjs tests/tender-fit-frontend.test.mjs tests/tender-radar-card-fit-humanized.test.mjs
```
Ejecutado por el parent de esta sesión: **11 pass, 0 fail**. Confirma que `tests/tender-fit-policy.test.mjs` sigue en verde sin ninguna modificación a ese archivo (no regresión del eje `servicio` v1), que las secciones 1-16 de `tests/tender-service-matrix-v2.test.mjs` pasan, y que la sección 17 (corrección de absorción, Tarea 3.1/3.2) pasa en verde tras la implementación de la corrección.
```
npm run build
```
Ejecutado por el parent de esta sesión: **exit 0**.

**Suite completa [COMPLETADA]:**
```
npm test -- --test-concurrency=1
```
Ejecutado por el parent de esta sesión: **exit 0**, 2817 tests, 2807 pass, 0 fail, 10 skipped, duración 391765.396833ms.

```
git diff --check
```
Ejecutado por el parent de esta sesión: **exit 0**.

## Tarea 5 — Revisión de código independiente [COMPLETADA]
Invocado el skill `code-review` sobre el diff acumulado. Revisó la lógica (incluida la corrección de §4.3.1) y no dejó bloqueos; condicionó la aprobación únicamente al resultado verde de la suite completa (Tarea 4). Esa condición ya se cumplió — **revisión aprobada**.

## Tarea 6 — Commit [PENDIENTE]
No se ejecuta en este paso; no se hizo commit en esta sesión. Commit, PR y despliegue quedan pendientes de un paso posterior.

## Tarea 7 (RED, sin código de producción) — Captura diaria del reporte sombra [COMPLETADA en esta sesión]
Cierra el modo sombra de dos semanas (§1 del spec) sin DB, sin timer nuevo y sin tocar ninguna decisión. Contrato completo en spec §8.

1. **Spec**: añadida la sección 8 (`docs/superpowers/specs/2026-10-01-agt002-service-matrix-v2-shadow.md`) con el contrato íntegro de `scripts/agt002-service-v2-shadow-report.mjs`: exports, alias de entrada estilo Radar, forma del item (incluido `flags` derivado solo de `status`/`excluded`, sin reimplementar matching), prioridad de `classification`, forma del reporte y `summary` con claves explícitas en cero, validación fail-closed, y contrato de escritura atómica diaria+`latest.json`.
2. **Test nuevo**: `tests/agt002-service-v2-shadow-report.test.mjs`, script plano con `assert` de `node:assert/strict` a nivel superior (mismo estilo que `tests/tender-service-matrix-v2.test.mjs`), que importa de `../scripts/agt002-service-v2-shadow-report.mjs` (no existe) y de `../tender-fit-policy.js` / `../tender-service-matrix-v2.js` (existen, solo para comparar `policy_version`/`matrix_version` sin hardcodearlos). Cubre:
   - Forma completa del reporte y de cada item para seis casos de texto que cubren las cuatro `classification` (`SAME_SERVICE_POINTS` por puntos iguales detectados y por ambos en cero, `POINTS_CHANGED`, `CURRENT_IN_V2_OUT` vía exclusión dura con ancla presente, `CURRENT_OUT_V2_IN` vía ancla v2 que v1 no reconoce y vía `AMBIGUA`/`POR_VALIDAR`), con `current_v1.total_score`/`band` calculados a mano reusando las reglas ya verificadas de `tender-fit-policy.js`.
   - `summary` con las cuatro claves de `by_classification`, las cuatro de `by_v2_status` y las seis de `by_v2_family` siempre presentes (incluida al menos una en cero), más `changed_count`.
   - Aceptación de payload `{items:[...]}` y de arreglo directo con resultado idéntico.
   - Orden determinístico y estable por `stable_key`, independiente del orden de entrada.
   - Alias de Radar (`object`/`summary`/`budget`/`municipality`/`department`/`closing_date`/`notice_id`) produciendo el mismo resultado que los nombres canónicos.
   - `existing_decision` presente solo si el item de entrada lo trae (`decision`), ausente en caso contrario.
   - `stable_key` cayendo a `source_url` como último recurso cuando no hay `stable_key`/`notice_id`/`id`.
   - No-copia de campos arbitrarios/`password`/`secret`/`token`/`api_key` del input: allowlist exacta de claves del item de salida y ausencia de los valores sensibles en el reporte serializado.
   - Validación fail-closed de `build...`: `nowIso` ausente, no canónico (sin hora/`Z`) o inválido; `payload` que no es objeto/arreglo; `items` que no es arreglo; item `null`/string/no-objeto.
   - Escritura atómica: `outputDir` anidado se crea; `<YYYY-MM-DD>.json` y `latest.json` con contenido idéntico y un único newline final; devuelve `{ report, dailyPath, latestPath }`; no es JSONL.
   - Rerun el mismo día reemplaza (no acumula) el archivo de ese día.
   - Retención: escribir un día nuevo no borra el artefacto del día anterior; `latest.json` siempre refleja la corrida más reciente.
   - Validación fail-closed de `write...`: `outputDir` vacío/ausente, `nowIso`/`payload` inválidos — ninguna corrida inválida deja un artefacto escrito.

**Ejecutar y confirmar rojo:**
```
node --test tests/agt002-service-v2-shadow-report.test.mjs
```
**Fallo esperado:** `ERR_MODULE_NOT_FOUND` al resolver `../scripts/agt002-service-v2-shadow-report.mjs` — el archivo de test falla por completo en la fase de `import`, antes de que corra ninguna aserción. Este es el rojo correcto y suficiente para esta fase: fija el contrato íntegro de spec §8 que la fase GREEN futura debe satisfacer literalmente.

No se modifica ningún archivo de producción en esta tarea (ni `tender-fit-policy.js`, ni `tender-service-matrix-v2.js`, ni ningún script existente). `scripts/agt002-service-v2-shadow-report.mjs` queda pendiente de implementación.

## Tarea 8 (GREEN de la Tarea 7) — [COMPLETADA]
Implementado `scripts/agt002-service-v2-shadow-report.mjs` satisfaciendo literalmente spec §8 y el contrato fijado en `tests/agt002-service-v2-shadow-report.test.mjs`, sin modificar `tender-fit-policy.js` ni `tender-service-matrix-v2.js`.

**Verificación dirigida:**
```
node --test tests/agt002-service-v2-shadow-report.test.mjs
```
Resultado: **24 pass, 0 fail** (el rojo inicial fue `ERR_MODULE_NOT_FOUND`, confirmado en la Tarea 7 antes de esta implementación). La fórmula productiva de Servicio v1 (`evaluateServicioAxis`, `tender-fit-v1`) no se tocó.

## Tarea 8.1 (RED, corrección de bug de alias detectado en revisión independiente) — [COMPLETADA]
Una revisión de código independiente sobre `scripts/agt002-service-v2-shadow-report.mjs` detectó que la resolución de alias de entrada (spec §8.3) no trataba siempre un `null` explícito en un alias como "no presente": cuando el primer alias de una fila de la tabla llegaba con valor `null` explícito (en vez de estar simplemente ausente/`undefined`), la resolución no caía de forma consistente al siguiente alias de la lista, dejando en `null` campos del reporte para items que sí traían un alias real y válido más adelante en el orden de preferencia; los casos de alias "reales" (valores no-canónicos presentes) tampoco tenían cobertura de prueba explícita. Corregido con TDD: se añadieron primero los casos rojos correspondientes a `tests/agt002-service-v2-shadow-report.test.mjs` (alias con `null` explícito cayendo al siguiente alias de la lista; alias real no-canónico resuelto correctamente), confirmando el fallo, y después se corrigió `scripts/agt002-service-v2-shadow-report.mjs` para que la regla "primer campo presente y no `undefined`/`null` gana" (spec §8.3) se aplique literalmente a cada campo de la tabla. Documentado en spec §8.3.1.

## Tarea 8.2 (GREEN de la Tarea 8.1 + verificación dirigida) — [COMPLETADA]
```
node --test tests/agt002-service-v2-shadow-report.test.mjs
```
Resultado: **29 pass, 0 fail** (frente a las 24 de la Tarea 8, por los casos nuevos de alias `null`/alias real de la Tarea 8.1).

Verificación dirigida ampliada (service-matrix-v2 + fit-policy + proyecciones + reporte sombra), ejecutada por el parent de esta sesión:
```
node --test tests/tender-service-matrix-v2.test.mjs tests/tender-fit-policy.test.mjs tests/tender-fit-backend-projection.test.mjs tests/tender-fit-cohort-audit.test.mjs tests/tender-fit-frontend.test.mjs tests/tender-radar-card-fit-humanized.test.mjs tests/agt002-service-v2-shadow-report.test.mjs
```
Resultado: **34 pass, 0 fail**.
```
npm run build
```
Resultado: **exit 0**.

## Tarea 8.3 — Corrida seca sobre archivo real [COMPLETADA]
`buildAgt002ServiceV2ShadowReport`/`writeAgt002ServiceV2ShadowReport` ejecutado en modo seco (solo lectura/observación, sin tocar ninguna decisión existente de Radar) sobre el archivo real `secop_psi_radar_latest.json`: **137 items** procesados, resultando en **54 `SAME_SERVICE_POINTS`**, **75 `POINTS_CHANGED`**, **6 `CURRENT_OUT_V2_IN`**, **2 `CURRENT_IN_V2_OUT`**, **3 `EXCLUIDA`**. El script sigue siendo de solo observación (spec §8.7); ninguna decisión fue modificada por esta corrida.

## Tarea 8.4 — Suite completa de seguimiento [COMPLETADA]
```
npm test -- --test-concurrency=1
```
Ejecutado por el parent de esta sesión: **exit 0**, 2846 tests, 2836 pass, 0 fail, 10 skipped, duración 388248.604145ms.

**El código capturador (`scripts/agt002-service-v2-shadow-report.mjs`) y su validación quedan completos.** Pendiente: integración en el wrapper diario externo (Tarea 9), commit, PR, despliegue y la corrida inicial canónica en producción.

## Tarea 9 — Integración en wrapper diario y despliegue [PENDIENTE]
Añadir la invocación de `writeAgt002ServiceV2ShadowReport` (`outputDir: '/root/.hermes/state/agt002-service-v2-shadow'`) como paso **no bloqueante** dentro del wrapper diario externo que ya ejecuta Radar (fuera de este worktree), sin crear ningún timer/systemd nuevo: una falla en este paso debe quedar como **warning** en el log del wrapper y no debe interrumpir la ejecución de Radar ni el envío a Discord. Pendiente también: commit, PR, despliegue y la corrida inicial canónica en producción.
