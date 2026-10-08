# AGT-002 R1 C7 — recibo de verificación local del candidato

**Fecha:** 2026-10-08  
**Baseline:** `origin/main@1fe2c334de92028aacda17af634e5e51a0968891`  
**Candidato C4-C6:** `97784384bb09ae56ce3fd0a3582198d12a32d89f`  
**Rama aislada:** `feat/agt002-r1-implementation-20261008`  
**Estado:** `C7_LOCAL_VERIFIED_REMOTE_AND_STAGING_PENDING`  
**Autoriza:** publicar la rama y ejecutar CI/preview con flags R1 apagados  
**No autoriza:** migración o despliegue de producción, encender flags, ejecutar un canario, emitir `AGT002_INCREMENTAL_E2E_ACCEPTED` ni abrir Plataforma Agentes Fase 2

## Alcance verificado

El candidato implementa la frontera congelada de R1 sin fabricar una primera corrida y sin adquirir
autoridad comercial:

- ledger append-only para señales, conjuntos, membresía y transiciones;
- validación explícita de señales inciertas sin reescribir la señal original;
- manifiesto `incremental_delta_manifest_v1` calculado y sellado server-side bajo el mismo lock por
  oportunidad;
- input delta-only ligado a la corrida/contexto anteriores y al hash del manifiesto;
- ingreso de lotes oficiales, documentos humanos, respuestas, notas de revisión accionable y enlaces
  a versiones inmutables de evidencia empresarial;
- cola durable, fencing, recuperación de crash, cierre terminal y sellado atómico del sucesor;
- despacho HMAC dirigido por evento, sin timer continuo, más un único despertar diario condicional;
- proyección segura del resultado incremental y conservación visible del reporte INITIAL histórico;
- interruptores `AGT002_INCREMENTAL_SIGNAL_INGRESS_ENABLED` y
  `AGT002_INCREMENTAL_DISPATCH_ENABLED` fail-closed y literalmente apagados por defecto.

El candidato no cambia AGT-003, no implementa P3.2, no comparte documentos con Plataforma Agentes y
no crea GO/NO-GO, firma, envío, publicación ni comunicación automática.

## Verificación local

1. `corepack pnpm run build`: PASS, incluidos deployment-safety, TypeScript y Vite.
2. `node --check server/index.js` y `node --check api/[...path].js`: PASS.
3. Paridad byte-exacta entre ambos backends (`cmp`): PASS.
4. `git diff --check`: PASS.
5. Conjunto enfocado R1, incluida la migración real PGlite 116: 18 archivos PASS, 0 FAIL.
6. La primera suite AGT-002 integral encontró una única regresión estática en el contrato de
   adaptación documental. El producto ya centralizaba correctamente el reanálisis canónico R1; la
   prueba antigua exigía dos llamadas textualmente idénticas. El contrato se corrigió para verificar
   por separado el worker durable y el reanálisis canónico R1/humano. Su prueba aislada pasó.
7. Segunda suite integral: 2.896 PASS, 11 SKIP y un único fallo de infraestructura local. Una
   reproducción con log retenido demostró `listen EPERM: operation not permitted 127.0.0.1` al abrir
   el servidor de fixture de `agt002-actionable-review-attachments-http.test.mjs`; ese mismo archivo
   había pasado en las dos corridas integrales anteriores al cambio de política de sockets. No hubo
   aserción funcional R1 fallida en la segunda corrida.

La restricción local de sockets no se convierte en excepción de aceptación. El workflow remoto debe
repetir la suite completa y el build en un entorno que permita los fixtures HTTP. Cualquier fallo
remoto mantiene C7 abierto.

## Disposición C7/C8

El siguiente paso permitido es publicar el candidato, abrir PR y exigir:

1. CI integral verde en el SHA exacto;
2. preview/staging `READY` con ambos flags R1 ausentes o literalmente `false`;
3. revisión de paridad y del SHA remoto;
4. sólo después, integración a `main` y preflight C8 con producción todavía apagada.

Este recibo no es la aceptación C7 completa ni la aceptación E2E. El programa debe detenerse tras la
emisión verificada de `AGT002_INCREMENTAL_E2E_ACCEPTED`, antes de Plataforma Agentes Fase 2.
