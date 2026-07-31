# CURRENT — SIIO Comercial / Licitaciones / Vig‑IA

**Corte autoritativo:** 2026-07-30 22:31 COT · 2026-07-31 03:31 UTC
**Producción:** https://seguridad-nacional-crm.vercel.app
**Commit productivo:** `5bb33047d43550e1753bcfafd78fd35f1ed68d56`
**Deployment Vercel:** `dpl_ZiGjr5aSqLnM8ZvZrzaqGGMwyKFg` · `READY`

## 1. Regla funcional vigente

El encargado de Licitaciones selecciona manualmente un caso del Radar y lo convierte en **Oportunidad**. Esa conversión humana es el gate funcional para entrar al pipeline durable y ejecutar Vig‑IA cuando se cumplan las precondiciones documentales.

Vig‑IA no debe:

- analizar indiscriminadamente todo el Radar;
- convertir procesos en oportunidades;
- procesar casos no convertidos o terminales;
- decidir GO/NO GO;
- enviar, firmar o presentar ofertas.

Las recomendaciones y runs son insumos para revisión humana. No constituyen decisión comercial o jurídica.

## 2. Estado actual del programa por fases

| Fase | Estado productivo | Límite |
|---|---|---|
| **E1** | Ruta durable verificada; drain continuo activado después del canary unitario | Dispatch inmediato permanece apagado; drain libera leases en cada checkpoint |
| **E2** | **Activa y verificada en producción** | Solo Vig‑IA canónico; cero fallback silencioso |
| **E3** | **Activa y verificada en producción** | Contexto v2 trazable; gaps empresariales explícitos |
| **E4** | **Apagada — gate pendiente** | No existe hoy un snapshot nuevo de 14 documentos elegible para canary E2E |
| **E5** | **Apagada — dependencia E4** | Corpus productivo todavía vacío; manifest local validado, no publicado |

Configuración desplegada:

- `TENDER_IMMEDIATE_DISPATCH=false`
- `TENDER_CONTINUOUS_DRAIN=true`
- `AGT002_CANONICAL_ONLY=true`
- `AGT002_CONTEXT_V2=true`
- `AGT002_DOCUMENT_RETRIEVAL=false`
- `AGT002_LEGAL_CORPUS=false`

El dispatch inmediato continúa apagado, por lo que una conversión futura no dispara por sí sola el worker. El scheduler durable y las invocaciones operativas conservan exclusión por lease. E4/E5 no deben activarse hasta satisfacer sus gates independientes.

## 3. Migración 055 — lectura backend mínima

PR técnica única: **#53**
Commit focal: `edd9d93fb4818523b3ebdd60c453f691b480f0cb`
Merge commit: `5bb33047d43550e1753bcfafd78fd35f1ed68d56`

La migración `055_agt002_company_documents_service_read.sql` corrige el mismatch `42501` del loader empresarial sobre `public.psi_company_procurement_documents`.

Estado productivo verificado:

```text
service_select=true
service_insert=false
service_update=false
service_delete=false
service_truncate=false
service_references=false
service_trigger=false
public_select=false
anon_select=false
authenticated_select=false
RLS=true
marker 055=1/1
```

El permiso no llega al frontend y no se expone ninguna clave `service_role` al navegador. El rollback transaccional específico revoca `SELECT` de `service_role`; la verificación terminal exige cero privilegios para `service_role`, `public`, `anon` y `authenticated`, con RLS activa.

## 4. Reentrada controlada E1

Se preservó y reanudó el mismo job durable:

- job: `dda4a2d6-bf58-4023-9f7a-5574bdfb703d`;
- snapshot: `be9d136f-fa26-49fc-acce-23ad0a7d6a32`;
- documentos: **14/14**;
- chunks: **1.466**;
- documentos fallidos: **0**;
- `attempt_count=0`;
- estado terminal: `completed/done`;
- `analysis_run_id=898d7f9e-5eac-4d4d-a26b-8c8387f8f554`.

El run enlazado ya existía antes del job controlado y fue reutilizado idempotentemente:

- run total para el snapshot: **1**;
- producer: `AGT-002`;
- status: `completed`;
- no se creó run sustituto ni duplicado.

Evidencia del scheduler post‑055:

```text
processed=0 · status=empty · stop_reason=empty
processed=1 · status=completed · stop_reason=yield
```

Verificaciones finales:

- otros jobs reclamables: **0**;
- job con ese ID: **1**;
- snapshot con ese ID: **1**;
- run para el snapshot: **1**;
- decisiones GO/NO‑GO para el caso: **0**;
- `last_error_code=null`;
- no se crearon jobs, snapshots, runs ni decisiones duplicadas.

## 5. Canary productivo E2 — canonicidad

Caso controlado sobre la misma oportunidad de E1:

- job: `fb54938d-012b-47af-9fdb-7e86f39e4381`;
- snapshot reutilizado: `be9d136f-fa26-49fc-acce-23ad0a7d6a32`;
- documentos: **14/14**;
- fallidos: **0**;
- run nuevo: `7acb0ed3-d57a-401b-acb0-10eaf77fb62e`;
- `producer=AGT-002`, `method=agent_ai`, `canonical=true`, `status=completed`;
- eventos append-only: `queued → running → completed` con una misma `attempt_key`;
- cero decisiones GO/NO-GO;
- lease final liberado;
- idempotencia de job: **1**.

El primer reintento E3 sobre ese mismo snapshot reutilizó correctamente el run E2. Esa reutilización demostró idempotencia, pero no se contó como canary E3 porque no hubo una invocación nueva del agente.

## 6. Canary productivo E3 — contexto v2

Se usó un segundo caso ya convertido por Juan Botero, sin run canónico ni job activo. El objeto contractual era vigilancia y seguridad privada; no se creó ni convirtió una oportunidad nueva.

- job: `15f9bf06-75b1-4266-a680-effea966f60b`;
- snapshot nuevo: `29e801d0-3d8d-4fc3-aa32-3e82b7eeedad`;
- documentos: **9/9**;
- fallidos: **0**;
- run canónico: `8c122c04-c613-4bcb-8d58-b8f04b746bbe`;
- contexto: `35ae6f3c-e221-468c-92b4-533bf6293e3d`, `context_version=2`;
- secciones: `commercial_context`, `company_dossier`, `context_version`, `human_evidence`, `opportunity`, `snapshot_id`;
- `human_evidence_count=0`;
- gaps del dossier expresados explícitamente;
- sin campos prohibidos de contacto, OAuth, claves, GO/NO-GO o análisis profundo;
- eventos append-only: `queued → running → completed`;
- cero decisiones GO/NO-GO.

## 7. Gate real E4

E4 permanece apagada. El contrato aprobado exige un canary end-to-end sobre un snapshot representativo de **14 documentos**. El único snapshot de 14 documentos ya está ligado idempotentemente al run E2; activar retrieval y reencolar el mismo snapshot reutiliza ese run y no prueba el nuevo evidence packet. El único snapshot nuevo disponible tiene 9 documentos.

No se clonaron snapshots, no se inventó evidencia humana y no se activó retrieval sobre casos futuros. E4 podrá continuar cuando exista uno de estos insumos gobernados:

1. un nuevo snapshot real de 14 documentos sobre una oportunidad ya convertida; o
2. una nueva versión de contexto originada por respuesta humana auténtica que habilite reanálisis idempotente distinto.

E5 también permanece apagada por dependencia. El manifest local `legal-corpus-v1` pasó validación con 6 fuentes; las tablas productivas siguen en cero y no se publicó corpus sin el gate E4.

## 8. QA y revisión

TDD y gates ejecutados secuencialmente:

- RED real: fallo por ausencia del artefacto 055;
- GREEN DB real: apply, rollback y privilegios exactos;
- runner real PGlite: preflight, estado absent/applied, marker, apply/apply y rollback/rollback;
- detección de grant backend inesperado: `unsafe_service_table_grants=1`, normalizado atómicamente;
- migraciones relacionadas y seguridad/RLS: PASS;
- paridad Express/Vercel: PASS;
- TypeScript: PASS;
- build Vite: PASS;
- `git diff --check`: PASS;
- Gitleaks oficial: 54,34 KB, cero filtraciones;
- suite completa: **298 tests · 297 pass · 1 fallo histórico**;
- gate fresco E2: **13/13** + backend parity + build;
- gates frescos E3–E5: **20/20**;
- ACL/RLS productivas 051–053: solo `service_role:SELECT`, RLS activa;
- estado final de jobs activos: **0**.

El único fallo es:

```text
tests/tender-radar-relevance.test.mjs
ReferenceError: tenderContextualPhysicalSecurityReason is not defined
```

Fue reproducido de forma idéntica en un worktree limpio de `origin/main`; no es regresión del lote 055.

Revisión independiente única con Claude Code Opus (`claude-opus-4-8`): **APPROVE · cero Critical/Important**. No se hizo re‑revisión.

## 9. Release y límites

- Deployment productivo: `dpl_ZiGjr5aSqLnM8ZvZrzaqGGMwyKFg` · `READY`.
- Alias canónico: https://seguridad-nacional-crm.vercel.app · HTTP 200.
- Migraciones 049–055: `applied`; 055 marker `1/1`.
- E1: validada; drain continuo activo, dispatch inmediato apagado.
- E2: activa y validada en producción.
- E3: activa y validada en producción.
- E4/E5: apagadas por gate explícito; no son rollback de E2/E3.
- No se autoriza procesamiento indiscriminado del Radar.
- No se automatizó GO/NO GO ni firma, envío o presentación.

El cierre previo de Aerocivil, INDER Medellín y Bucaramanga LPR permanece como historial operativo anterior; este corte documenta el avance productivo E1–E3 y el gate real que protege E4/E5.
