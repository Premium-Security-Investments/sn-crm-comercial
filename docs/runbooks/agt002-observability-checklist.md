# AGT-002 — checklist de observabilidad

**Fecha:** 2026-08-17 · **Estado:** actualizado después de implementar y verificar la Fase 9.

## 1. Qué existe hoy (verificado en código en esta sesión)

- **Diagnóstico post-bridge:** `agt002-post-bridge-observability.js` expone `classifyAgt002PostBridgeFailure({ phase, error, integralContractV3 })`, que clasifica de forma segura (sin payloads ni prompts) el punto de falla después de que el bridge fue invocado.
- **Presupuesto de prompt V3:** `agt002-v3-prompt-budget.js` existe como módulo dedicado desde el merge del piloto Manizales (`960a967`), con `tests/agt002-v3-prompt-budget.test.mjs` (589 líneas) cubriéndolo.
- **Clasificación segura de fallos de turno Codex:** el cliente distingue errores de proveedor (`AGT002_CODEX_PROVIDER_ERROR`), de validación V3 y de creación de runtime, sin registrar prompts, documentos ni payloads completos — patrón usado durante el diagnóstico histórico de `error.code=other` (ver `CURRENT.md`, historial 2026-08-13/14).
- **Paridad Express/Vercel:** `server/index.js` y `api/[...path].js` comparten el mismo módulo de runtime (`agt002-preview-runtime.js`); `npm run check:backend-parity` verifica que ambas rutas permanecen estructuralmente idénticas.

## 2. Resultado de la tarea 7 y hueco residual

La Fase 9 probó los dos huecos antes de implementar:

1. **Prompt budget interactivo:** quedó activado end-to-end en `agt002-preview-runtime.js` y cubierto por `tests/agt002-v3-prompt-budget-runtime-activation.test.mjs`.
2. **Worker durable:** la inspección confirmó que no tiene diagnóstico post-bridge equivalente. El gap permanece deliberadamente abierto porque modificarlo sin una fase TDD separada podría alterar la semántica de claim/retry.

El estado y el límite exacto están registrados en `docs/architecture/agt002-phase9-runtime-open-gaps.md`.

## 3. Checklist operativo antes de cualquier corrida V3

- [ ] `agt002-analysis-config.js` confirma que el flag depende de `AGT002_CANONICAL_ONLY`, `AGT002_CONTEXT_V2`, `AGT002_DOCUMENT_RETRIEVAL` — los tres activos.
- [ ] Bridge `active/running`, módulos desplegados byte-idénticos al commit productivo (patrón ya usado en cada corte de `CURRENT.md`).
- [ ] Cero claims activos y cero runs V3 previos no reconciliados para la oportunidad objetivo.
- [ ] Clasificación segura de fallos disponible en el camino que se va a ejercitar (preview síncrono confirmado; worker durable pendiente de implementación TDD separada).
- [ ] Ningún log de la corrida contiene payloads, prompts, documentos o PII — sólo metadatos sanitizados (ids, conteos, estados, tiempos).

## 4. Qué no se registra nunca (invariante transversal)

Consistente con cada corte histórico de `CURRENT.md`: credenciales, headers, URLs completas, stderr crudo, prompts, inputs completos o mensajes libres del modelo no se conservan en ningún artefacto de observabilidad. La reproducción sintética documentada en `CURRENT.md` §0.5 (histórico) es el patrón de referencia: correlación por ids de thread/turn y conteos de tokens, nunca contenido.

## 5. Paridad backend como gate de observabilidad

Cualquier cambio a la capa de diagnóstico debe mantener `server/index.js` y `api/[...path].js` estructuralmente idénticos. `npm run check:backend-parity` permanece como gate mecánico.
