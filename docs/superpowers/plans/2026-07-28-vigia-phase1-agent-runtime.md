# Vig-IA Fase 1 — Plan de implementación Plataforma Agentes

> **Ejecución:** usar `superpowers:executing-plans` y TDD estricto. Crear un worktree limpio desde `origin/main`. No implementar sobre `/root/agente-it-phase4-p4`, porque contiene cambios y documentos locales ajenos. Push, migración, secretos, consumo del proveedor y deploy requieren gate humano.

**Objetivo:** exponer una capacidad interna de AGT-003 que reciba un snapshot SIIO saneado, trate todo texto CRM como no confiable y devuelva un brief y borrador comercial estrictamente estructurados. No consulta SIIO por su cuenta, no usa tools, no investiga web, no envía mensajes, no escribe CRM y no decide por el comercial.

**Diseño canónico:** `docs/superpowers/specs/2026-07-28-vigia-commercial-presales-copilot-design.md` del repositorio SIIO.

**Plan complementario:** `docs/superpowers/plans/2026-07-28-vigia-phase1-siio-opportunity-copilot.md`.

## Arquitectura del runtime

```text
SIIO backend
  -> HTTPS + HMAC + timestamp + nonce
  -> vigia-copilot Edge Function
  -> autenticación y anti-replay
  -> validación del contrato v2-draft
  -> policy AGT-003 + proveedor Claude existente
  -> validación estricta de JSON/evidence/assets
  -> envelope auditable
  -> respuesta a SIIO
```

Plataforma Agentes genera; SIIO sigue siendo owner de datos, permisos, scoring, persistencia comercial y UX.

---

## Tarea 1 — Crear worktree y baseline limpio

**Repositorio objetivo:** Plataforma Agentes.

1. `git fetch origin main`.
2. Crear rama `feat/agt003-opportunity-copilot-runtime` desde `origin/main` en un worktree nuevo.
3. Ejecutar `deno task check`, `deno task test`, `deno task fmt:check` y `deno task lint`.
4. Registrar resultados reales en `docs/verification/vigia-phase1-agent-runtime.md`.
5. Si el baseline falla, detener implementación y documentar el fallo; no absorber deuda ajena.

## Tarea 2 — Importar y fijar contratos v2-draft

**Crear/modificar**
- `catalog/siio-agent-contracts-v2-draft.pin.json`
- `supabase/functions/_shared/agt003_copilot_contract.ts`
- `tests/agt003_copilot_contract_test.ts`
- fixtures contractuales bajo `tests/fixtures/agt003-copilot/`

1. Copiar exactamente request/response schemas aprobados en SIIO `AGT-003/v2-draft` hacia fixtures de validación.
2. Calcular SHA-256 de ambos schemas y fijarlos en el catálogo; no editar pins v1.
3. Tests RED para hash distinto, versión distinta, capability distinto, campos extra, autoridad ampliada, evidence ID desconocido, asset ID desconocido y campo de envío.
4. Implementar validación JSON Schema cerrada con AJV 2020 ya disponible.
5. Ejecutar `deno test --config deno.json --allow-read=catalog,tests tests/agt003_copilot_contract_test.ts`.
6. Commit: `feat(agt003): pin opportunity copilot draft contracts`.

## Tarea 3 — Registrar capability y autoridad institucional

**Modificar**
- `supabase/functions/_shared/capacidades.ts`
- `supabase/functions/_shared/capacidad_institucional.ts`
- `supabase/functions/_shared/institutional_agent_request.ts`
- `supabase/functions/_shared/perfil_institucional.ts`
- `tests/capacidades_test.ts`
- `tests/capacidad_institucional_test.ts`
- `tests/phase3a_p3a_institutional_request_test.ts`

**Crear**
- `supabase/migrations/0019_agt003_opportunity_copilot_capability.sql`
- `tests/agt003_copilot_capability_migration_test.ts`

Capability: `agt003.opportunity-copilot.preview`. Autoridad constante: lectura de snapshot suministrado, generación de borrador, revisión humana obligatoria, sin tools, sin fuentes externas, sin persistencia autónoma, sin envío, sin efectos.

1. Escribir tests RED para cualquier identidad distinta de AGT-003, capability de escritura, scope controlado por cliente, canal no interno o authority flags ampliados.
2. Registrar capability y política inmutables; migración idempotente y sin ampliar otras capacidades.
3. Mantener `agt003.priorities.read` intacto.
4. Ejecutar tests unitarios y de migración.
5. Commit: `feat(agt003): register commercial copilot preview authority`.

## Tarea 4 — Sanitizar contenido no confiable

**Crear**
- `supabase/functions/agente-it/agt003_copilot_input.ts`
- `tests/agt003_copilot_input_test.ts`
- `tests/agt003_copilot_hostile_content_test.ts`

1. Tests RED para prompt injection en observaciones/interacciones, secretos, bearer tokens, URLs firmadas, correos y teléfonos no necesarios.
2. Revalidar límites aunque SIIO ya los aplique: máximo 20 interacciones, 2.000 caracteres por nota y 20.000 totales.
3. Congelar profundamente el input normalizado.
4. Separar policy/instrucciones del contenido y rotular cada evidencia no confiable.
5. Rechazar snapshots sin evidence IDs estables, authority exacta o catálogo de activos válido.
6. Ejecutar ambos tests.
7. Commit: `feat(agt003): sanitize bounded untrusted CRM context`.

## Tarea 5 — Generador estructurado sin tools

**Crear**
- `supabase/functions/agente-it/agt003_copilot.ts`
- `supabase/functions/agente-it/agt003_copilot_policy.ts`
- `tests/agt003_copilot_generation_test.ts`

**Reutilizar**
- `supabase/functions/_shared/claude.ts`
- utilidades existentes de observabilidad/resiliencia sin habilitar herramientas.

1. Definir policy explícita: distinguir hechos/inferencias/faltantes, citar evidence IDs, recomendar sólo asset IDs recibidos, no investigar, no prometer, no inventar precios/capacidades, no enviar ni mutar.
2. Inyectar cliente de modelo para tests; no leer secretos dentro de la lógica de dominio.
3. Exigir respuesta JSON pura conforme al schema; rechazar Markdown, claves extra, evidence desconocida, asset desconocido o `human_review_required:false`.
4. No corregir silenciosamente una salida inválida; devolver error seguro auditable.
5. Probar español profesional, asunto/cuerpo editables y comportamiento con manifest vacío.
6. Ejecutar `deno test ... tests/agt003_copilot_generation_test.ts`.
7. Commit: `feat(agt003): generate evidence-bound commercial drafts`.

## Tarea 6 — Endpoint interno HMAC y anti-replay

**Crear**
- `supabase/functions/vigia-copilot/index.ts`
- `supabase/functions/vigia-copilot/handler.ts`
- `supabase/functions/vigia-copilot/bootstrap.ts`
- `tests/agt003_copilot_ingress_test.ts`

**Modificar**
- `supabase/functions/deno.json`
- `deno.json` tarea `check:functions`
- `.env.example`

1. Reutilizar primitives de `supabase/functions/_shared/seguridad.ts`; no inventar un segundo algoritmo HMAC.
2. Verificar método POST, content type, tamaño máximo, timestamp, nonce, firma constante-tiempo y ventana anti-replay antes de invocar modelo.
3. Validar contrato/pins antes de generación.
4. Aplicar timeout, concurrencia y cuota desde configuración server-side validada.
5. Responder envelope con run ID, policy/model version, usage y output validado; nunca incluir secretos ni prompt interno.
6. Tests RED: firma inválida, replay, timestamp vencido/futuro, body alterado, método incorrecto, body grande, contrato inválido, timeout y proveedor inválido.
7. Ejecutar test de ingress y `deno task check:functions`.
8. Commit: `feat(agt003): expose signed internal copilot ingress`.

## Tarea 7 — Observabilidad sin PII

**Modificar**
- `supabase/functions/_shared/observabilidad.ts`
- `supabase/functions/vigia-copilot/handler.ts`
- `tests/agt003_copilot_observability_test.ts`

Eventos permitidos: accepted, rejected, model_completed, output_rejected, quota, timeout y internal_error. Campos: correlation/run ID, capability, policy/model version, latency bucket, token counts y error code. Prohibidos: cuerpo del correo, notas, nombres, correos, teléfonos, prompts, secretos y payload completo.

1. Tests RED que inspeccionen logs y rechacen PII/contenido.
2. Implementar logging estructurado mínimo.
3. Ejecutar test.
4. Commit: `feat(agt003): add privacy-safe copilot telemetry`.

## Tarea 8 — Integración contractual sintética

**Crear**
- `tests/agt003_copilot_siio_bridge.integration_test.ts`
- `tests/fixtures/agt003-copilot/valid-siio-request.json`
- `tests/fixtures/agt003-copilot/valid-agent-response.json`
- `docs/verification/vigia-phase1-agent-runtime.md`

1. Levantar handler con cliente de modelo sintético inyectado.
2. Firmar request como SIIO, verificar anti-replay y response schema/hash.
3. Probar oportunidad hostil, manifest vacío, activo válido y salida inválida.
4. Confirmar por test estático que el módulo no importa conectores de red, tools, DB de SIIO, correo, calendario ni SharePoint.
5. Ejecutar:

```bash
deno test --config deno.json --allow-read=catalog,supabase/functions,tests tests/agt003_copilot_contract_test.ts
deno test --config deno.json --allow-read=catalog,supabase/functions,tests tests/agt003_copilot_input_test.ts tests/agt003_copilot_hostile_content_test.ts
deno test --config deno.json --allow-read=catalog,supabase/functions,tests tests/agt003_copilot_generation_test.ts
deno test --config deno.json --allow-read=catalog,supabase/functions,tests --allow-env=WEBHOOK_SECRET tests/agt003_copilot_ingress_test.ts
deno test --config deno.json --allow-read=catalog,supabase/functions,tests tests/agt003_copilot_observability_test.ts
deno test --config deno.json --allow-read=catalog,supabase/functions,tests --allow-env=WEBHOOK_SECRET tests/agt003_copilot_siio_bridge.integration_test.ts
deno task check
deno task test
deno task fmt:check
deno task lint
```

6. Registrar resultados reales y hashes en verificación.
7. Commit: `test(agt003): verify opportunity copilot runtime`.

## Gates de rollout

Fuera de la ejecución local:

1. revisión humana de policy y prompts;
2. aprobación de consumo del proveedor;
3. creación de HMAC secret en ambos lados;
4. migración de catálogo;
5. deploy de la Edge Function;
6. smoke sintético firmado;
7. configuración del URL/modelo/cuotas en SIIO;
8. canary con usuarios y datos reales.

## Definition of Done

- v1 y pins v1 intactos;
- capability nueva con autoridad cerrada;
- input hostil saneado y acotado;
- generación sin tools/red/acciones;
- response estricta con evidence y assets permitidos;
- HMAC, anti-replay, cuotas y timeout probados;
- observabilidad sin PII;
- suite Deno completa verde;
- ningún deploy, secreto o consumo real ejecutado sin gate.
