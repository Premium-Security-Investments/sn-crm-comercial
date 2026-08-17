# AGT-002 — checklist de observabilidad

**Fecha:** 2026-08-17 · **Alcance:** documental. No cambia runtime; enumera lo que ya existe y lo que la tarea 7 (fuera de alcance de este bloque documental) debe cerrar.

## 1. Qué existe hoy (verificado en código en esta sesión)

- **Diagnóstico post-bridge:** `agt002-post-bridge-observability.js` expone `classifyAgt002PostBridgeFailure({ phase, error, integralContractV3 })`, que clasifica de forma segura (sin payloads ni prompts) el punto de falla después de que el bridge fue invocado.
- **Presupuesto de prompt V3:** `agt002-v3-prompt-budget.js` existe como módulo dedicado desde el merge del piloto Manizales (`960a967`), con `tests/agt002-v3-prompt-budget.test.mjs` (589 líneas) cubriéndolo.
- **Clasificación segura de fallos de turno Codex:** el cliente distingue errores de proveedor (`AGT002_CODEX_PROVIDER_ERROR`), de validación V3 y de creación de runtime, sin registrar prompts, documentos ni payloads completos — patrón usado durante el diagnóstico histórico de `error.code=other` (ver `CURRENT.md`, historial 2026-08-13/14).
- **Paridad Express/Vercel:** `server/index.js` y `api/[...path].js` comparten el mismo módulo de runtime (`agt002-preview-runtime.js`); `npm run check:backend-parity` verifica que ambas rutas permanecen estructuralmente idénticas.

## 2. Huecos conocidos, pendientes de la tarea 7 (no ejecutada en este bloque documental)

Según el plan de fase 9, la tarea 7 debe probar primero estos dos huecos antes de implementar cualquier corrección:

1. **Prompt budget no activado end-to-end:** el módulo `agt002-v3-prompt-budget.js` existe y tiene pruebas propias, pero esta sesión no verificó si está efectivamente wireado en el camino de ejecución real de `agt002-preview-engine.js` para todo request V3, o sólo probado de forma aislada.
2. **Worker durable sin diagnóstico post-bridge equivalente:** `agt002-post-bridge-observability.js` cubre el camino síncrono de preview; no se verificó en esta sesión si el worker durable (E6, Mesa Vig-IA) tiene un mecanismo de clasificación de fallo post-bridge equivalente o si silenciosamente carece de él.

Esta sesión **no reprodujo** estos huecos con evidencia mecánica propia — los señala como huecos a probar primero, tal como exige explícitamente la tarea 7 del plan, y deja su cierre a esa tarea.

## 3. Checklist operativo antes de cualquier corrida V3

- [ ] `agt002-analysis-config.js` confirma que el flag depende de `AGT002_CANONICAL_ONLY`, `AGT002_CONTEXT_V2`, `AGT002_DOCUMENT_RETRIEVAL` — los tres activos.
- [ ] Bridge `active/running`, módulos desplegados byte-idénticos al commit productivo (patrón ya usado en cada corte de `CURRENT.md`).
- [ ] Cero claims activos y cero runs V3 previos no reconciliados para la oportunidad objetivo.
- [ ] Clasificación segura de fallos disponible en el camino que se va a ejercitar (preview síncrono confirmado; worker durable pendiente de verificar por la tarea 7).
- [ ] Ningún log de la corrida contiene payloads, prompts, documentos o PII — sólo metadatos sanitizados (ids, conteos, estados, tiempos).

## 4. Qué no se registra nunca (invariante transversal)

Consistente con cada corte histórico de `CURRENT.md`: credenciales, headers, URLs completas, stderr crudo, prompts, inputs completos o mensajes libres del modelo no se conservan en ningún artefacto de observabilidad. La reproducción sintética documentada en `CURRENT.md` §0.5 (histórico) es el patrón de referencia: correlación por ids de thread/turn y conteos de tokens, nunca contenido.

## 5. Paridad backend como gate de observabilidad

Cualquier cambio a la capa de diagnóstico debe mantener `server/index.js` y `api/[...path].js` estructuralmente idénticos. `npm run check:backend-parity` es el gate mecánico; no se documenta aquí ningún cambio a ese script ni a los módulos de runtime — eso pertenece a la tarea 7, no a este bloque documental.
