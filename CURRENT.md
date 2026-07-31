# CURRENT — SIIO Comercial / Licitaciones / Vig‑IA

**Corte autoritativo:** 2026-07-30 21:44 COT · 2026-07-31 02:44 UTC
**Producción:** https://seguridad-nacional-crm.vercel.app
**Commit productivo:** `5bb33047d43550e1753bcfafd78fd35f1ed68d56`
**Deployment Vercel:** `dpl_FV3RNCsthL8HyC3LiA83fevJq2dQ` · `READY`

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
| **E1** | Ruta funcional verificada con un caso durable controlado | Dispatch inmediato y drain continuo permanecen apagados; no se procesan otros expedientes |
| **E2–E5** | **Apagadas / no iniciadas** | No autorizadas por este corte |

Configuración desplegada:

- `TENDER_IMMEDIATE_DISPATCH=false`
- `TENDER_CONTINUOUS_DRAIN=false`

Estas flags controlan dispatch y drain; el scheduler durable conserva un claim unitario acotado. No deben activarse ahora sobre el job ya terminal porque eso no volvería a probar el caso controlado y podría afectar expedientes futuros.

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

## 5. QA y revisión

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
- suite completa: **298 tests · 297 pass · 1 fallo histórico**.

El único fallo es:

```text
tests/tender-radar-relevance.test.mjs
ReferenceError: tenderContextualPhysicalSecurityReason is not defined
```

Fue reproducido de forma idéntica en un worktree limpio de `origin/main`; no es regresión del lote 055.

Revisión independiente única con Claude Code Opus (`claude-opus-4-8`): **APPROVE · cero Critical/Important**. No se hizo re‑revisión.

## 6. Release y límites

- Deployment productivo: `dpl_FV3RNCsthL8HyC3LiA83fevJq2dQ` · `READY`.
- Alias canónico: https://seguridad-nacional-crm.vercel.app · HTTP 200.
- Migración 055: `applied`, marker `1/1`.
- E1: validada con el job preservado.
- E2–E5: no iniciadas.
- No se autoriza procesamiento general de otros expedientes.
- No se automatizó GO/NO GO ni firma, envío o presentación.

El cierre previo de Aerocivil, INDER Medellín y Bucaramanga LPR permanece como historial operativo anterior; este corte documenta exclusivamente la operacionalización por fases y el cierre controlado de E1.
