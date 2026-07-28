# CURRENT — SIIO Comercial / Licitaciones / AGT-002

**Corte autoritativo:** 2026-07-28 07:04 COT · 2026-07-28 12:04 UTC
**Producción:** https://seguridad-nacional-crm.vercel.app
**Commit productivo:** `9c7a9120e750d5ef4fd8c65b81432af8cf0cad04`
**Deployment Vercel:** `dpl_FF6UjyJshBJWjUcXYoe6FDNJRTC1` · `Ready`

## 1. Regla funcional vigente

El encargado de Licitaciones selecciona manualmente un caso del Radar y lo convierte en **Oportunidad**. Esa conversión humana es el gate funcional para entrar al pipeline durable y ejecutar AGT-002 cuando se cumplan las precondiciones documentales.

No existe un segundo gate humano de `analysis_authorized_by`: el worker registra técnicamente al actor de la conversión, pero solo acepta casos con vínculo consistente `Radar → converted_opportunity_id → Oportunidad`. Los casos no convertidos fallan cerrados.

AGT-002 no debe:

- analizar indiscriminadamente todo el Radar;
- convertir procesos en oportunidades;
- procesar casos no convertidos o terminales;
- decidir GO/NO GO;
- enviar, firmar o presentar ofertas.

`TENDER_AUTO_ANALYSIS=on` está activo en producción y limitado por la cola durable, snapshot válido, controles fail-closed, idempotencia y concurrencia máxima de una ejecución.

## 2. Estado autoritativo de las tres oportunidades

| Oportunidad | Documentos / snapshot vigente | Job durable | AGT-002 |
|---|---|---|---|
| **Aerocivil** | 40 documentos; snapshot `d0b1c106-e9ab-47e6-9766-2a1bf08d6df3` | Flujo controlado completado | **Completado/current** · run `4001a76e-11f6-41d5-8f9e-d1b7d4ec3ed6` · `advance_conditionally` |
| **INDER Medellín** | 8/8 importados; snapshot `e4d8c803-902b-40cc-bbde-84f6f250bc17` | Job `fddcb080-9a15-45e5-834b-4c75959ce262` · `completed/done` | **Completado/current** · run `3b41eb0c-24ff-42ab-a31a-f4ef6c73b85f` · `pause` |
| **Bucaramanga — videovigilancia LPR** | 12/12 importados; snapshot `02c1283e-cb10-4fa3-a7e2-7f041b77ff12` | Job `374195eb-a590-44f3-834b-e7e5ba28f118` · `completed/done` | **Completado/current** · run `8ef997a2-fe7c-4de4-96a5-e62d04fd8593` · `advance_conditionally` |

Las recomendaciones son insumos para revisión humana. No constituyen decisión GO/NO GO ni autorización para firmar, enviar o presentar una oferta.

## 3. Recuperación documental de Bucaramanga

Cinco PDFs oficiales SECOP históricamente clasificados como terminales fueron reabiertos con guardas, reclasificados como críticos y recuperados sin insertar evidencia no verificada:

- concepto técnico: 18 páginas;
- estudios del sector: 48 páginas;
- dos minutas: 6 páginas cada una;
- requerimiento técnico: 58 páginas.

La recuperación OCR en español cubrió **136/136 páginas, con cero timeouts**. Los PDFs originales se conservaron en almacenamiento privado y el texto OCR se persistió mediante el versionado documental gobernado. El resultado final fue 12 importados, 0 fallidos.

Auditoría append-only: evento `case_note` `1753629b-6a5f-4df9-bdb4-427e32cbf660`, vinculado al job de Bucaramanga y marcado con `event_key=document_ocr_recovery_completed`.

## 4. Release técnico

- PR técnica única fusionada: **#34**.
- Código funcional fusionado y desplegado: `9c7a9120e750d5ef4fd8c65b81432af8cf0cad04`.
- Primer commit documental de cierre publicado en `main`: `9409beb107072ae1b63c20c4a1de5aabf0f2fac9` (`[skip ci]`, sin redeploy innecesario).
- Migraciones durables **032–037** aplicadas y verificadas.
- Deployment Vercel `dpl_FF6UjyJshBJWjUcXYoe6FDNJRTC1`: `Ready`.
- URL productiva: https://seguridad-nacional-crm.vercel.app.

La revisión técnica independiente del lote terminó **RESOLVED · NO CRITICAL/IMPORTANT** después de corregir los límites efectivos de reintento, `attempt_count`, `next_attempt_at`, contadores acumulados y transiciones a `needs_attention`.

### QA ejecutado

- 195/195 archivos de pruebas: PASS.
- Integraciones SIIO, agentes y permisos: PASS.
- Integraciones PGlite de autorización, jobs, RPC y migraciones: PASS.
- Paridad Express/Vercel: PASS.
- Build TypeScript + Vite: PASS.
- `git diff --check`: PASS.
- Scanner de secretos: sin credenciales reales; solo fixtures sintéticos.
- Producción raíz: HTTP 200.
- Endpoint interno real del scheduler: `GET/POST /api/tender-processing-worker-run`.
- Prueba de protección del endpoint: llamada sin secreto → HTTP 403 con respuesta JSON `error`; no se ejecutó el worker.

## 5. Verificación final de consistencia

Consulta autoritativa Supabase del 2026-07-28 12:04 UTC:

- 3/3 oportunidades mantienen conversión manual válida;
- 3/3 tienen snapshot vigente;
- 3/3 tienen exactamente un run AGT-002 `completed` asociado al snapshot vigente;
- jobs activos: **0**;
- leases de jobs o documentos: **0**;
- claims AGT-002 activos: **0**;
- claims vencidos: **0**;
- items documentales pendientes o fallidos en INDER/Bucaramanga: **0**;
- errores terminales pendientes: **0**.

Después de la verificación se eliminaron los PDFs/OCR temporales y el archivo temporal de entorno productivo. Los originales gobernados, las versiones documentales, snapshots, runs y auditoría permanecen en sus almacenes autoritativos.

## 6. Deuda separada no bloqueante

- `/api/health` en el dominio Vercel devuelve actualmente el shell SPA y no un healthcheck backend JSON dedicado. La función API sí está desplegada y el endpoint interno real del worker responde correctamente; el healthcheck dedicado debe corregirse como tarea separada de observabilidad.
- El disco de Hetzner fue observado cerca del 86 %. Programar mantenimiento separado y reversible; no mezclarlo con el cierre funcional de AGT-002.
- No se ejecutó prueba destructiva de rollback ni kill switch en producción.

## 7. Cierre

**PSI/AGT-002 queda cerrado operativamente para Aerocivil, INDER Medellín y Bucaramanga LPR: 3/3 `completed/current`, sin duplicados activos, claims ni leases huérfanos.**

Este cierre no automatiza decisiones comerciales ni jurídicas. GO/NO GO, firma, envío y presentación de ofertas permanecen bajo control humano.
