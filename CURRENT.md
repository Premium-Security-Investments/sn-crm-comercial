# CURRENT — SIIO Comercial / Licitaciones / AGT-002

**Corte:** 2026-07-27 22:35 COT · 2026-07-28 03:35 UTC  
**Producción:** https://seguridad-nacional-crm.vercel.app  
**Resultado del smoke:** HTTP 200

## 1. Regla funcional vigente

El encargado de Licitaciones selecciona manualmente un caso del Radar y lo convierte en **Oportunidad**. Esa conversión humana es el gate funcional para entrar al pipeline durable y, una vez cumplidas las precondiciones documentales y de autorización, ejecutar AGT-002.

AGT-002 no debe:

- analizar indiscriminadamente todo el Radar;
- convertir procesos en oportunidades;
- procesar casos no convertidos o terminales;
- decidir GO/NO GO;
- enviar, firmar o presentar ofertas.

`TENDER_AUTO_ANALYSIS=on` está activo en producción. Su alcance está limitado por la cola durable: solo jobs ligados a `converted_opportunity_id`, snapshot válido, autorización y controles fail-closed.

## 2. Estado autoritativo de las tres oportunidades

| Oportunidad | Documentos / snapshot | Job durable | AGT-002 |
|---|---|---|---|
| **Aerocivil** | 40 documentos; snapshot vigente `d0b1c106-e9ab-47e6-9766-2a1bf08d6df3` | Flujo controlado completado | **Completado y vigente**. Run `4001a76e-11f6-41d5-8f9e-d1b7d4ec3ed6`; recomendación `advance_conditionally` |
| **INDER Medellín** | 8/8 importados; snapshot `e4d8c803-902b-40cc-bbde-84f6f250bc17` | `awaiting_analysis_authorization` · paso `analysis` | **Pendiente**; todavía no existe run persistido |
| **Bucaramanga — videovigilancia LPR** | 12 procesados: 7 importados y 5 fallidos; sin snapshot | `needs_attention` · paso `documents` | **Pendiente**; no puede analizarse hasta resolver el frente documental |

Los dos jobs históricos faltantes fueron creados mediante la RPC idempotente, exclusivamente para las oportunidades ya convertidas manualmente. No se crearon jobs para casos que permanecen en el Radar.

## 3. Cambios productivos verificados hoy

- Se corrigió el registro secuencial de documentos: ahora usa concurrencia acotada de cinco RPCs.
- Se corrigió la carrera de `safe-official-fetch` que leía `response.socket.remoteAddress` después de que Node liberaba el socket.
- El scheduler de Hetzner quedó con timeout HTTP de 120 segundos y `TimeoutStartSec=130s`; systemd mantiene ejecución oneshot sin solapamiento.
- El worker volvió a avanzar y persistir fases: descubrimiento, importación y snapshot.
- SECOP respondió correctamente para los dos procesos pendientes; la fuente oficial tenía 18 documentos para INDER y 30 para Bucaramanga antes de la selección prioritaria del pipeline.

### QA ejecutado

- `safe-official-fetch` / política SSRF: PASS.
- Concurrencia documental: PASS.
- Durable tender worker: PASS.
- Scheduler systemd: PASS.
- Paridad backend/API: PASS.
- Build TypeScript + Vite: PASS.
- `git diff --check`: PASS.
- Producción raíz: HTTP 200.

## 4. Estado de código y despliegue

La producción actual contiene cambios desplegados desde la rama:

- `feat/agt002-hetzner-runtime-bridge`
- commit desplegado y publicado: `a530cd8b458d7a78b18d0f711e786cc7c681f43b`

La rama técnica coincide con su remoto y estaba limpia al cierre. Sin embargo:

- `origin/main` estaba en `495c4fcb490402d40b8395475f3f8cc7c3c1eba6`;
- no existía PR abierto o cerrado para `feat/agt002-hetzner-runtime-bridge`;
- por tanto, existe **drift deliberado pendiente de normalización**: producción incluye código aún no integrado a `main`.

No declarar cierre de release técnica hasta crear/revisar el PR, pasar CI, fusionar y confirmar despliegue desde la rama canónica.

## 5. Pendientes y límites

1. **INDER:** registrar o resolver la autorización nominal que falta. La intención de negocio es que la conversión manual sea el gate; el estado `awaiting_analysis_authorization` muestra que la implementación todavía exige una autorización técnica adicional para este job histórico.
2. **Bucaramanga:** revisar los cinco import-items fallidos, recuperar al menos el conjunto documental utilizable y publicar snapshot. No reintentar AGT-002 sin snapshot.
3. **Ambas pendientes:** ejecutar AGT-002 real y verificar, por cada oportunidad, run `completed`, resultado estructurado, auditoría, cuota, lease final y correspondencia con el snapshot vigente.
4. **Worker:** estabilizar la duración por invocación. Durante la importación hubo timeouts de Vercel; el pipeline avanzó gracias a persistencia durable y reintentos, pero el tamaño de lote debe revisarse antes de considerar cerrado el frente operativo.
5. **Rama técnica:** preparar una única revisión del lote, abrir PR hacia `main`, corregir solo hallazgos Critical/Important o regresiones y completar la ruta CI/merge/deploy/smoke.
6. **Hetzner:** disco observado al 86%; programar mantenimiento separado, sin mezclarlo con la validación funcional de AGT-002.

## 6. Punto exacto para retomar

Retomar desde las dos precondiciones pendientes, sin volver a analizar Aerocivil:

1. resolver autorización de **INDER**;
2. diagnosticar y recuperar los cinco documentos fallidos de **Bucaramanga**;
3. ejecutar AGT-002 para esas dos oportunidades y cerrar únicamente después de verificar persistencia y auditoría en Supabase.

---

**Límite del cierre:** una de tres oportunidades tiene AGT-002 completado; dos de tres continúan pendientes. No hubo envío, firma, presentación de oferta ni decisión GO/NO GO automatizada.
