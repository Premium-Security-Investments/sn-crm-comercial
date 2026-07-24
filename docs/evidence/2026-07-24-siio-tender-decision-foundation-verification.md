# Verificación — Fundación SIIO para decisión documental de licitaciones

- **Resultado:** PASS
- **Fecha UTC:** 2026-07-24T15:51:44Z
- **Rango verificado:** `c531bdb..ae57385`
- **HEAD funcional:** `ae57385fbce49f374af98a747cf23785ccd2bdb6`
- **Alcance:** Tasks 1–7 del plan `2026-07-24-siio-tender-decision-foundation.md`
- **Modalidad:** verificación local, sin despliegue ni mutaciones remotas

## 1. Inmutabilidad de AGT-002 v1

| Comprobación | Resultado | Evidencia |
|---|---:|---|
| SHA-256 literal de `manifest.json`, `analysis.request.schema.json` y `analysis.response.schema.json` | PASS | `b42efca7952e917da93c551400efaa71db7c8fa0c69a8c74b6fb4980782ca82e` |
| `git diff c531bdb -- contracts/agents/AGT-002/v1` | PASS | Sin salida |

AGT-002 v1 permanece intacto. Los contratos nuevos están en `v2-draft` y no sustituyen ni modifican v1.

## 2. Suites focales

Todos los comandos terminaron con código de salida `0`:

```text
PASS  node tests/agt002-tender-analysis-contract.test.mjs
PASS  node tests/hermes-interim-tender-analysis.test.mjs
PASS  node tests/tender-analysis-foundation-migration.test.mjs
PASS  node tests/tender-analysis-foundation-pglite.integration.test.mjs
PASS  node tests/tender-analysis-rules-registration.test.mjs
PASS  node tests/tender-internal-interaction-kinds.test.mjs
PASS  node tests/tender-analysis-go-gate-pglite.integration.test.mjs
PASS  node tests/tender-decision-brief-ui.test.mjs
PASS  node tests/tender-go-no-go-api.test.mjs
PASS  node tests/tender-go-no-go-ui.test.mjs
PASS  node tests/tender-go-no-go-pglite.integration.test.mjs
```

Resultado focal: **11/11 PASS**.

## 3. Gates globales

| Comando | Salida | Resultado |
|---|---|---:|
| `for test in tests/*.test.mjs; do node "$test" || exit 1; done` | 111 archivos ejecutados | PASS |
| `npx tsc --noEmit` | código `0` | PASS |
| `npm run check:backend-parity` | `backend parity OK` | PASS |
| `npm run check:siio-agents` | `SIIO governed agent catalog OK` | PASS |
| `npm run build` | build Vite completado | PASS |
| `git diff --check` | sin salida | PASS |

Observación no bloqueante: Vite conserva el warning conocido de un chunk superior a 500 kB después de minificación.

## 4. Controles de seguridad y no producción

Durante esta fundación:

- No se aplicó la migración `025_tender_analysis_foundation.sql` en Supabase remoto.
- No se desplegó frontend, backend ni funciones serverless.
- No se hizo push ni merge.
- No se llamó al runtime institucional AGT-002.
- No se llamó a un modelo, proveedor o transporte Hermes real.
- Las pruebas de Hermes usaron exclusivamente transporte inyectado y respuestas sintéticas en memoria.
- No se creó ni modificó el perfil Hermes `psi-licitaciones-interim`.
- No se guardaron secretos ni se reinició el gateway.
- No se activó el fixture sintético como fallback de runtime.
- El preanálisis auténtico permanece identificado como `siio_rules_v1/rules`.
- Hermes conserva la identidad auditada `HERMES-INTERIM/agent_ai`; ningún adaptador lo presenta como AGT-002.
- La decisión GO/NO GO permanece humana y exige análisis tipado vigente, justificación y autorización.

Presencia de variables de activación comprobada sin leer valores:

```text
TENDER_ANALYSIS_ENGINE=ABSENT
HERMES_INTERIM_BASE_URL=ABSENT
HERMES_INTERIM_API_KEY=ABSENT
HERMES_INTERIM_PROVIDER=ABSENT
HERMES_INTERIM_MODEL=ABSENT
HERMES_INTERIM_POLICY_VERSION=ABSENT
HERMES_INTERIM_MAX_COST_USD=ABSENT
```

Resultado: integración Hermes **hard-off** en este entorno.

## 5. Gates residuales antes de cualquier activación

Hermes no puede activarse hasta obtener aprobación explícita y evidencia de:

1. proveedor y modelo;
2. región, tratamiento y retención de datos documentales;
3. presupuesto diario y por ejecución, precios y límites;
4. endpoint, autenticación, timeouts, reintento y sanitización de errores;
5. perfil dedicado `psi-licitaciones-interim` sin herramientas operativas, memoria, web, terminal, archivos, mensajería ni delegación;
6. verificaciones autenticadas de `/v1/toolsets`, `/v1/capabilities` y `/health/detailed`;
7. autorización humana para configurar secretos, reiniciar gateway y habilitar variables.

AGT-002 institucional tampoco puede activarse hasta aprobar formalmente:

1. contrato v2 definitivo — `v2-draft` no es contrato productivo;
2. identidad técnica, autenticación y endpoint institucional;
3. proveedor/modelo y residencia/tratamiento de datos;
4. presupuesto, observabilidad, timeouts, reintentos y errores;
5. pruebas de integración y autorización de producción.

## 6. Cierre proporcional

Tasks 5 y 6 recibieron revisión independiente y correcciones verificadas. Para evitar revisiones recursivas, la instrucción posterior del usuario fue cerrar el lote restante mediante una única verificación automatizada integral; no se solicitó otra revisión manual de Task 7/8. Este documento registra esa verificación reproducible.

**Conclusión:** la fundación local está completa y verificada. Sigue prohibido desplegar, migrar, activar Hermes o llamar AGT-002 sin autorización explícita y aprobación de los gates residuales.
