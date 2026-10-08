# AGT-002 R1 — congelación del contrato incremental

**Fecha:** 2026-10-08

**Baseline:** `origin/main@1fe2c334de92028aacda17af634e5e51a0968891`

**Estado:** `C3_CONTRACT_FROZEN_IMPLEMENTATION_IN_PROGRESS`
**Punto de alto del programa:** después de `AGT002_INCREMENTAL_E2E_ACCEPTED`, antes de Plataforma Agentes Fase 2

## Frontera

R1 procesa únicamente material confiable nuevo o modificado de una oportunidad convertida que ya
tiene una corrida canónica. Nunca crea la primera corrida, nunca toma GO/NO-GO, nunca firma, envía,
publica ni comunica, y no comparte autoridad ni datos con Plataforma Agentes.

La migración `108` ya integrada es un reanálisis completo, humano y explícito. Es una capacidad
separada y no satisface R1: no sustituye el ledger de eventos, el conjunto durable ni el input
delta-only de este contrato.

## Decisiones autoritativas

1. Las fuentes admitidas son documento oficial nuevo/modificado; documento humano; vínculo a una
   versión inmutable de evidencia de empresa; respuesta/comentario/aclaración; y texto/evidencia de
   revisión accionable. Metadatos cosméticos, `last_seen` y cambios deterministas no disparan IA.
2. Una mutación humana sólo es confiable cuando el actor es humano, activo, tiene acceso a la
   oportunidad y conserva `ACTIONS.AI_ANALYSIS_RUN`. Esa mutación autoriza incluir la evidencia,
   pero no autoriza una decisión comercial.
3. Fuente o identidad incierta se persiste append-only como `pending_validation`, sin manifiesto,
   job ni llamada al proveedor. Validarla crea una nueva señal referenciada; no reescribe la original.
4. Un sync oficial recibe un `source_batch_id` antes de descargar; todos sus resultados lo conservan
   y el ingreso ocurre una sola vez al cerrar el lote, incluyendo sólo versiones exitosas con hash nuevo.
5. Por oportunidad existe como máximo un conjunto `ACCUMULATING` y un conjunto/job
   `SEALED|DISPATCHED|RUNNING`. Señales que llegan durante un job se acumulan para el sucesor y se
   sellan una sola vez en la transición terminal.
6. Señales y membresía sellada son inmutables. Todas las transiciones se registran append-only y las
   RPC adquieren el mismo advisory lock de oportunidad antes de leer o escribir el conjunto.
7. `incremental_delta_manifest_v1` se construye server-side y liga corrida/contexto previos,
   identidades/versiones/hashes cambiados, hallazgos afectados y excerpts comparativos explícitos.
8. `buildAgt002IncrementalAnalysisInput` acepta sólo miembros cambiados cuyo contenido reproduce el
   hash congelado. Los hallazgos no afectados se trasladan mecánicamente y no pasan por el modelo.
9. Se reutilizan la cola durable, fencing, executor y promoción canónica existentes. El timer de
   reanálisis se retira; el despacho es por evento y sólo queda un despertar diario condicional.
10. El rollback operacional apaga ingreso/despacho y preserva evidencia. El rollback SQL falla si
    cualquiera de las tablas R1 contiene filas.

## Secuencia C3–C8

- C3: este contrato y su matriz de autoridad quedan congelados.
- C4: ledger/RPCs, manifiesto e input delta-only.
- C5: integración de fuentes, lote oficial y autoridad en ambos backends.
- C6: worker, transición terminal, despacho por evento y proyección.
- C7: suites unitarias, PGlite, concurrencia, paridad, build y staging con flags apagados.
- C8: despliegue con flags apagados, un canario R1, readback canónico y emisión de
  `AGT002_INCREMENTAL_E2E_ACCEPTED`.

Plataforma Agentes Fase 2 y P3.2 permanecen expresamente fuera de alcance.
