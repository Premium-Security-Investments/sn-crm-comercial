# Evidencia — AGT-003: avisos y plan B "pausar y avisar" cuando Claude no responde (puerta única de modelos, Paso 3)

```text
AGENTE: AGT-003 / Vig-IA Comercial (trabajo sobre la Plataforma de Agentes → puerta única de modelos, Paso 3)
PROYECTO: SIIO / CRM comercial (sn-crm-comercial)
FECHA_CORTE_UTC: 2026-10-09
OBJETIVO: clasificar las fallas del puente o del modelo en categorías estables, registrarlas en el libro central,
          mostrar a la persona un mensaje claro de "no disponible por ahora" (sin cambiar de modelo ni de proveedor),
          evitar que una falla del proveedor consuma cupo y mostrar avisos en IT → Agentes.
REPOSITORIO: Premium-Security-Investments/sn-crm-comercial
RAMA: feat/agt003-paso3-fallas-modelo (base: main 1ee527a)
COMMIT_SHA: ver el PR (commit único de esta rama)
PR: ver la descripción del PR
ESTADO_DEL_TRABAJO: código escrito y PR abierto. Migración 120 ESCRITA, NO aplicada. Sin despliegue.
```

## Decisión del dueño (Juan Botero, 2026-10-09)

Si Claude no responde, la función se **pausa y avisa**. No se cambia a otro modelo ni a otro proveedor y no sale
información hacia un proveedor nuevo. El campo `fallback` de la configuración ya sólo admite `notify`
(`AI_FALLBACK_OPTIONS` en `platform-agent-configuration.js`); no se construyó ningún cambio de proveedor.

## CAMBIOS_REALIZADOS

| Pieza | Archivo | Qué hace |
|---|---|---|
| Clasificación | `src/vigia/model-failures.js` (+ `.d.ts`) | Lleva los códigos actuales del puente, del cliente del proveedor y del cliente del puente a 4 categorías; null para cancelación, puente ocupado, cupos y función apagada. |
| Registro | `platform-model-gateway.js` (`classifyFailure`), `agt003-copilot-runtime.js`, `agt003-lead-analysis.js` | El evento `failed` del libro guarda la categoría, la función, el modelo y la correlación (sin contenido). El código original sólo va a `console.warn`. Deduplicación de 60 s por correlación + código. Si el libro no responde, la petición sigue (tope de 1,5 s ya existente). |
| Cliente del puente | `agt003-copilot-bridge-client.js` | Una respuesta 5xx sin el cuerpo JSON del puente (p. ej. página de error de un proxy) ahora es `AGT003_COPILOT_TRANSPORT_ERROR` (puente no disponible) y no "respuesta inválida". |
| Mensajes | `agt003-copilot-engine.js`, `agt003-copilot-api.js`, `server/index.js` = `api/[...path].js`, `src/vigia/VigiaOpportunityCopilot.tsx` | Mensaje en lenguaje común por categoría en el copiloto y en el análisis profundo. Los errores internos del análisis profundo ya no se muestran como texto técnico. |
| Cupo | `supabase/migrations/120_…sql` (+ reversa) | El copiloto deja de contar las ejecuciones fallidas (como ya hacía el análisis profundo). |
| Avisos IT | `platform-model-usage.js` (`PLATFORM_MODEL_ALERTS_SQL`, `presentModelAlerts`), `src/platform/ModelAlerts.tsx`, `AgentsView.tsx`, `AgentDetail.tsx`, `agentsPresentation.ts` | Fallas de los últimos 7 días agrupadas por categoría, con la última vez, las veces en 24 h y las funciones; "Activo" mientras no haya un uso exitoso posterior. Cada aviso activo suma al indicador "Avisos" del Resumen. |

### Categorías

| Código estable | Significado | Códigos de hoy que entran |
|---|---|---|
| `AGT003_CLAUDE_LOGIN_REQUIRED` (existente) | Sesión de Claude vencida o no iniciada | `*_CLAUDE_LOGIN_REQUIRED` |
| `AGT003_BRIDGE_UNAVAILABLE` (nuevo) | Puente caído, sin respuesta, con tiempo agotado o que rechaza la conexión | `*_CLAUDE_TIMEOUT`, `*_CLAUDE_TRANSPORT_ERROR`, `AGT003_COPILOT_TRANSPORT_ERROR`, `*_BRIDGE_AUTH_INVALID`, `*_BRIDGE_INTERNAL` |
| `AGT003_CLAUDE_SESSION_LIMIT` (existente) | Límite de la suscripción | `*_CLAUDE_SESSION_LIMIT` |
| `AGT003_MODEL_ERROR` (nuevo) | Cualquier otro error del modelo | `PROVIDER_ERROR`, `INVALID_RESPONSE`, `OUTPUT_TOO_LARGE`, `SCHEMA_TOO_LARGE`, `COPILOT_INTERNAL`, desconocidos |

Sesión vencida, puente caído y límite de la suscripción se resuelven con un uso exitoso de **cualquier** función del
agente (la conexión es compartida); "otro error" sólo con un uso exitoso de la **misma** función. Los eventos
anteriores al Paso 3 (códigos crudos) también se reclasifican al leer.

### Cupo: cómo se contaban las fallidas (verificado en 117 y 118)

- Análisis profundo (114/118): ya **no** contaba las fallidas (sólo completados + reservas en curso de menos de 5 min).
- Copiloto (043/117): **sí** contaba las fallidas. La migración 120 lo corrige en la reserva v2. Mientras 120 no se
  aplique, una falla del proveedor sigue descontando un uso del copiloto. Por eso el mensaje del copiloto no promete
  "no se descontó"; el del análisis profundo sí, porque es cierto hoy.
- La reserva original (043), que sólo se usa si la v2 no existiera, no se toca y sigue contando las fallidas.
- "Uso de IA" (libro central) cuenta como "usos" completados + fallidos, como desde el Paso 1. Es un indicador, no el cupo.

## MIGRACIONES (escritas, no aplicadas)

- `120_agt003_copilot_quota_skip_provider_failures.sql`: `create or replace` de `psi_claim_agt003_copilot_run_v2` con la
  misma firma, permisos, lock e idempotencia. Sólo agrega `run.status = 'completed'` a los dos conteos.
  **No es destructiva**: no borra ni cambia datos.
- Reversa: `supabase/rollbacks/120_agt003_copilot_quota_skip_provider_failures_rollback.sql` (vuelve al cuerpo de la 117).

## PRUEBAS_EJECUTADAS / RESULTADO_DE_PRUEBAS / AMBIENTE

Locales, en el worktree, sin red ni bases reales (dobles y PGlite). Nuevas: `tests/agt003-model-failures.test.mjs` (20)
y `tests/agt003-copilot-quota-120-pglite.integration.test.mjs` (4). Los resultados de la suite completa frente a la línea
base están en la descripción del PR. También: `tsc` sin errores, `vite build` correcto y `check_backend_parity` OK.

## FALLOS_RIESGOS_Y_LIMITES

- Idempotencia: es por proceso (60 s). El libro (`platform.record_model_usage`) no tiene una clave única. La
  idempotencia fuerte necesita un índice único en la Plataforma de Agentes (otro repositorio). Queda pendiente.
- Avisos con más de 7 días sin un uso exitoso dejan de mostrarse (ventana de la consulta).
- El puente devuelve sólo el código, sin `providerErrorCode`: un límite de uso que el proveedor no informe con la frase
  conocida cae en "otro error del modelo".

## PENDIENTES

- **Aviso a una persona: no se construyó.** El CRM no tiene un canal reutilizable para avisar a administradores sin
  credenciales nuevas. El correo semanal es un outbox que envía Hermes. El Top 5 por Discord es de Vig-IA Licitaciones
  y sigue pendiente. Las alertas de licitaciones son de AGT-002 y no se pueden importar. Propuesta: cuando haya un canal
  aprobado (correo transaccional o un webhook), enviar un aviso cuando una categoría pasa a "Activo", como máximo uno
  cada 6 h por categoría.
- Aplicar la migración 120 en SIIO (`tyfzjqzcpgwcjnxozaaf`) después de fusionar.
- Índice único de idempotencia en `platform.model_usage_event` (repositorio plataforma-agentes).

## SIGUIENTE_PASO

Revisión y fusión del PR por Juan. Después, aplicar 120 y verificar un aviso real en IT → Agentes.
