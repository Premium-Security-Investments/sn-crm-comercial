# Vig-IA Fase 1 — Plan de implementación SIIO

> **Ejecución:** usar `superpowers:executing-plans` y TDD estricto. Crear un worktree limpio desde `origin/main`. No usar worktrees con cambios ajenos. Cada commit es local; push, migración y deploy requieren gate humano.

**Objetivo:** entregar en el detalle de una oportunidad no licitatoria un panel de Vig-IA que, bajo demanda, construya un brief factual, identifica faltantes, propone estrategia, genera un borrador editable y recomienda únicamente activos aprobados. No envía correo, no investiga fuentes públicas, no cambia CRM y no calcula ingeniería.

**Diseño canónico:** `docs/superpowers/specs/2026-07-28-vigia-commercial-presales-copilot-design.md`

**Plan complementario:** `docs/superpowers/plans/2026-07-28-vigia-phase1-agent-runtime.md`

## Arquitectura del slice

```text
OpportunityDetail
  -> POST /api/vigia-opportunity-copilot
  -> autenticación + módulos Oportunidades/Vig-IA + scope
  -> snapshot SIIO saneado y acotado
  -> runtime firmado hacia Plataforma Agentes
  -> validación cerrada de respuesta
  -> persistencia append-only
  -> panel editable, sin acción de envío
```

El contrato `contracts/agents/AGT-003/v1` es inmutable. La nueva capacidad vive en `AGT-003/v2-draft`. El scoring sigue siendo propiedad de SIIO y no se duplica.

---

## Tarea 1 — Corregir identidad visible

**Archivos**
- Modificar: `src/vigia/VigiaCommercial.tsx`
- Modificar: `tests/vigia-ui-static.test.mjs`

1. Cambiar el test para exigir `Impulsado por Vig-IA` y rechazar `AGT-003` en texto visible.
2. Ejecutar `node tests/vigia-ui-static.test.mjs`; debe fallar.
3. Eliminar el identificador interno de la UI, sin tocar contratos ni auditoría.
4. Repetir el test; debe pasar.
5. Commit local: `fix(vigia): keep AGT-003 internal to contracts and audit`.

## Tarea 2 — Definir contratos v2-draft

**Crear**
- `contracts/agents/AGT-003/v2-draft/manifest.json`
- `contracts/agents/AGT-003/v2-draft/opportunity-copilot.request.schema.json`
- `contracts/agents/AGT-003/v2-draft/opportunity-copilot.response.schema.json`
- fixtures válidos e inválidos bajo `contracts/agents/AGT-003/v2-draft/fixtures/`
- `tests/agt003-copilot-contract.test.mjs`

El capability ID será `agt003.opportunity-copilot.preview`. Request cerrado: versión, capability, correlation ID, snapshot ID, oportunidad saneada, interacciones acotadas, activos aprobados y autoridad `{read_only:true,human_review_required:true,external_send_allowed:false}`. Response cerrado: brief, hechos con evidence IDs, inferencias, faltantes, objetivo, estrategia, asunto, cuerpo, activos recomendados, advertencias y `human_review_required:true`.

1. Escribir primero tests que rechacen claves extra, autoridad ampliada, evidence IDs inexistentes, activos no enviados y cualquier campo de envío.
2. Ejecutar `node tests/agt003-copilot-contract.test.mjs`; debe fallar.
3. Crear schemas/fixtures y validador `agt003-copilot-contract.js`.
4. Ejecutar el test; debe pasar.
5. Verificar que ningún archivo de `AGT-003/v1` cambió con `git diff -- contracts/agents/AGT-003/v1`.
6. Commit: `feat(vigia): define opportunity copilot draft contract`.

## Tarea 3 — Construir contexto y manifiesto de activos

**Crear**
- `agt003-copilot-input.js`
- `vigia-approved-assets.js`
- `config/vigia-approved-assets.v1.json`
- `tests/agt003-copilot-input.test.mjs`
- `tests/vigia-approved-assets.test.mjs`

1. Probar límites: máximo 20 interacciones, 2.000 caracteres por nota, 20.000 totales; orden estable; PII innecesaria, secretos y URLs firmadas redactados.
2. Marcar observaciones e interacciones como `untrusted_crm_text`; ninguna instrucción incrustada puede convertirse en política.
3. Generar evidence IDs determinísticos para campos e interacciones.
4. Validar el manifiesto cerrado: ID, título, tipo, URL HTTPS SharePoint permitida, vigencia, industrias/servicios y estado `approved`.
5. El manifiesto de producción inicia vacío de forma deliberada. Los fixtures sintéticos viven sólo en tests. La carga de activos reales es un gate de contenido, no un bloqueo de código.
6. Ejecutar ambos tests hasta verde.
7. Commit: `feat(vigia): build bounded copilot context and approved asset catalog`.

## Tarea 4 — Runtime SIIO fail-closed

**Crear**
- `agt003-copilot-bridge-client.js`
- `agt003-copilot-engine.js`
- `agt003-copilot-runtime.js`
- `tests/agt003-copilot-bridge-client.test.mjs`
- `tests/agt003-copilot-engine.test.mjs`
- `tests/agt003-copilot-runtime.test.mjs`

Usar el patrón defensivo de AGT-002, no su semántica. Configuración server-side: `AGT003_COPILOT_ENGINE=agt003_bridge_preview`, modelo, URL HTTPS, secreto HMAC, timeout, concurrencia, cuota diaria y versión de política.

1. Tests RED para configuración incompleta, URL no HTTPS, secreto débil, replay, timeout, cuota, concurrencia, JSON inválido, schema inválido y evidence/asset IDs inventados.
2. Firmar cuerpo + timestamp + nonce; no gestionar API keys del proveedor en SIIO.
3. Política: contenido no confiable; sin tools, red, persistencia autónoma, envío, investigación pública, compromisos ni cambios de CRM.
4. Colapsar ejecuciones concurrentes por idempotency key `snapshot:policy:model`.
5. Si falla el runtime, devolver error seguro; no fabricar borrador determinístico como si fuera IA.
6. Ejecutar los tres tests.
7. Commit: `feat(vigia): add fail-closed commercial copilot runtime`.

## Tarea 5 — Persistencia append-only

**Crear**
- `supabase/migrations/039_agt003_copilot_runs.sql`
- `agt003-copilot-persistence.js`
- `tests/agt003-copilot-persistence.test.mjs`
- `tests/agt003-copilot-pglite.integration.test.mjs`

Tablas: `psi_agt003_copilot_runs` y `psi_agt003_copilot_feedback`. Guardar run, opportunity, snapshot, actor, policy, model, status, output validado, usage, hashes y timestamps. Feedback separado: useful/needs_change/discarded y comentario opcional. Revocar acceso directo a `anon` y `authenticated`; backend `service_role`; runs inmutables; feedback append-only.

1. Probar migración, grants, constraints, inmutabilidad e idempotencia.
2. Implementar claim antes del proveedor, lease acotado, release terminal y conteo de cuota.
3. Probar que una ejecución duplicada reutiliza exactamente el run persistido.
4. Ejecutar tests unitarios y PGlite.
5. Commit: `feat(vigia): persist copilot runs and feedback append-only`.

## Tarea 6 — Autorización y endpoint paritario

**Modificar**
- `access-control.js`
- `server/index.js`
- `api/[...path].js`
- `tests/access-control.test.mjs`
- `tests/backend-module-guards.test.mjs`

**Crear**
- `tests/agt003-copilot-endpoint.test.mjs`
- `tests/agt003-copilot-auth.integration.test.mjs`

1. Agregar acción `AI_COMMERCIAL_DRAFT_RUN` sólo para humanos con `modulo_oportunidades`, `modulo_vig_ia` y scope válido sobre la oportunidad. Perfil inactivo, agente, comercial ajeno o director fuera de subárea fallan cerrado.
2. Añadir `POST /api/vigia-opportunity-copilot`; exigir body exacto `{opportunity_id}`.
3. Autenticar antes de DB; autorizar antes de armar contexto; llamar proveedor sólo después de claim persistente.
4. Consultar la oportunidad enriquecida y sus interacciones únicamente después del scope check.
5. Añadir endpoint de feedback `POST /api/vigia-opportunity-copilot-feedback` con run visible para el mismo scope.
6. Replicar bytes en ambos entrypoints y agregar las rutas a `HTTP_ACTION_MATRIX`.
7. Ejecutar tests y `npm run check:backend-parity`.
8. Commit: `feat(vigia): expose scoped opportunity copilot preview API`.

## Tarea 7 — Panel en detalle de oportunidad

**Crear**
- `src/vigia/VigiaOpportunityCopilot.tsx`
- `src/vigia/opportunity-copilot-state.ts`
- `tests/vigia-opportunity-copilot-state.test.mjs`
- `tests/vigia-opportunity-copilot-ui-static.test.mjs`

**Modificar**
- `src/main.tsx`
- `src/styles.css`

1. Probar state machine: idle/loading/ready/error, descarte de respuestas tardías al cambiar de oportunidad y regeneración explícita.
2. Renderizar sólo para no licitaciones y usuarios con ambos módulos.
3. Mostrar una sola superficie progresiva: resumen colapsado, brief, faltantes, objetivo/estrategia, editor de asunto/cuerpo, activos y advertencia humana.
4. Botones permitidos: `Generar borrador`, `Copiar`, `Descartar`, `Útil`, `Necesita cambios`. No incluir `Enviar`, selección de destinatarios ni mutación de etapa.
5. La edición permanece local en este slice; no reescribe el run original.
6. Agregar estilos compactos existentes, responsive y accesibilidad básica.
7. Ejecutar tests y `npm run build`.
8. Commit: `feat(vigia): add opportunity copilot draft panel`.

## Tarea 8 — Pruebas integrales y documentación operativa

**Crear**
- `tests/agt003-copilot-prompt-injection.test.mjs`
- `tests/agt003-copilot-end-to-end.integration.test.mjs`
- `docs/verification/vigia-phase1-siio.md`

**Modificar**
- `.env.example`

Casos obligatorios: oportunidad propia/ajena, módulos parciales, perfil inactivo, observación hostil, correo/teléfono/secretos, respuesta con activo inventado, timeout, duplicidad, cambio de oportunidad durante request y manifest vacío.

Ejecutar:

```bash
node tests/vigia-ui-static.test.mjs
node tests/agt003-copilot-contract.test.mjs
node tests/agt003-copilot-input.test.mjs
node tests/vigia-approved-assets.test.mjs
node tests/agt003-copilot-bridge-client.test.mjs
node tests/agt003-copilot-engine.test.mjs
node tests/agt003-copilot-runtime.test.mjs
node tests/agt003-copilot-persistence.test.mjs
node tests/agt003-copilot-pglite.integration.test.mjs
node tests/agt003-copilot-endpoint.test.mjs
node tests/agt003-copilot-auth.integration.test.mjs
node tests/vigia-opportunity-copilot-state.test.mjs
node tests/vigia-opportunity-copilot-ui-static.test.mjs
node tests/agt003-copilot-prompt-injection.test.mjs
node tests/agt003-copilot-end-to-end.integration.test.mjs
npm run check:backend-parity
npm run build
```

Documentar comandos, resultados reales, hashes de schemas y evidencia de que no existe envío. Commit: `test(vigia): verify phase1 opportunity copilot slice`.

## Gates de rollout

No forman parte de la implementación local:

1. aprobar activos reales y cargarlos al manifiesto;
2. aprobar consumo del proveedor y secretos;
3. desplegar Plataforma Agentes;
4. migrar Supabase SIIO;
5. configurar bridge;
6. desplegar SIIO;
7. habilitar `modulo_vig_ia` sólo a pilotos;
8. ejecutar canary con datos reales y aprobación humana.

## Definition of Done

- v1 intacto y v2-draft validado;
- identidad visible sólo Vig-IA;
- acceso doble + scope;
- input acotado y contenido hostil neutralizado;
- salida estructurada y citada;
- manifest vacío falla de forma útil, nunca inventa activos;
- runs/feedback auditables;
- cero envío y cero mutación de CRM;
- paridad backend y build verdes;
- evidencia registrada en `docs/verification/vigia-phase1-siio.md`.
