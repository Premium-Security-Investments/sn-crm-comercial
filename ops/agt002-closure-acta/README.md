# AGT-002 — Acta de cierre (borrador de Vig-IA)

Vig-IA profundiza el acta de cierre a partir de **la nota con la que la persona cerró** la licitación
(decisión de Juan, 2026-10-19). El acta nace en `borrador`: confirmarla es un acto humano y la base de
datos no se lo permite a Vig-IA (`psi_confirm_tender_closure_acta` exige `identity_type = 'human'`).

- Modo: `run-agt002-radar-import.mjs --closure-acta`
- Código: `agt002-closure-acta-run.js`, `agt002-closure-acta-draft.js`
- Base: migración `134_tender_closure_acta.sql` (`psi_list_tender_closure_acta_pending`)
- Pantalla: pestaña Historial de la ficha (`src/tenders/workspace/TenderClosureActa.tsx`)

## Estado: propuesto, NO instalado

Dos cosas por decidir antes de instalar esto:

1. **Permisos de los dos archivos de entorno.** El servicio necesita el de Supabase (el mismo del análisis
   automático, usuario `psi-agt002`) y el del puente de la Mesa (modo `0640` de
   `root:agt002-workbench-scheduler`). Hay que resolver si `psi-agt002` puede leer el segundo o si el
   servicio corre con otra identidad. Sin esto, el servicio arranca y falla.
2. **Cuándo corre.** El `timer` propuesto corre 40 minutos después de cada revisión de fases. La otra opción
   es redactar el acta en el mismo momento del cierre, dentro del pedido HTTP que archiva o cambia el
   estado. El timer no bloquea el clic de la persona y reintenta en la corrida siguiente; el cierre en vivo
   es más inmediato, pero hace esperar y puede fallar delante de ella.

## Interruptor

Reutiliza el de la Mesa: con `AGT002_WORKBENCH_DRAIN_ENABLED` distinto de `true` no se invoca al modelo y
no se escribe nada (registra `agt002_closure_acta_disabled`).

## Qué registra

`agt002_closure_acta_drafted` por acta escrita (sin contenido: sólo conteos), `agt002_closure_acta_failed`
con el código de la falla, `agt002_closure_acta_nothing_pending` y `agt002_closure_acta_run` con el resumen.
