# AGT-002 — Acta de cierre (borrador de Vig-IA)

Vig-IA profundiza el acta de cierre a partir de **la nota con la que la persona cerró** la licitación
(decisión de Juan, 2026-10-19). El acta nace en `borrador`: confirmarla es un acto humano y la base de
datos no se lo permite a Vig-IA (`psi_confirm_tender_closure_acta` exige `identity_type = 'human'`).

- En el cierre: `agt002-closure-acta-live.js`, llamado desde `/api/tender-offer-archive`,
  `/api/tender-offer-status` (sólo estados finales) y `/api/tender-go-no-go-decision` (sólo NO-GO).
- Red de seguridad semanal: `run-agt002-closure-acta.sh` → `POST /api/tender-closure-acta/worker/run`
- Código: `agt002-closure-acta-run.js`, `agt002-closure-acta-draft.js`
- Base: migración `134_tender_closure_acta.sql` (`psi_list_tender_closure_acta_pending`)
- Pantalla: pestaña Historial de la ficha (`src/tenders/workspace/TenderClosureActa.tsx`)

## Cómo está armado

El servidor **no conoce la configuración del modelo y no debe conocerla** (su archivo de entorno
sólo tiene la URL y el secreto del trabajador). Igual que el scheduler de la Mesa, este servicio
sólo dispara una llamada HTTP al endpoint protegido por secreto
`POST /api/tender-closure-acta/worker/run`, y es el proceso web quien redacta.

## Instalación

1. Copiar `run-agt002-closure-acta.sh` a `/opt/agt002-workbench-scheduler/` (junto al de la Mesa),
   con permiso de ejecución y propietario `root:agt002-workbench-scheduler`.
2. Añadir `AGT002_CLOSURE_ACTA_WORKER_URL` al archivo de entorno del scheduler de la Mesa
   (ver `env.example`). El secreto ya está ahí y es el mismo.
3. Instalar `agt002-closure-acta.service` y `.timer`, `daemon-reload` y `enable --now` el timer.

No necesita credenciales de Supabase ni acceso a otros archivos de entorno: no toca la base.

## Interruptor

Reutiliza el de la Mesa: con `AGT002_WORKBENCH_DRAIN_ENABLED` distinto de `true` no se invoca al modelo y
no se escribe nada (registra `agt002_closure_acta_disabled`).

## Qué registra

`agt002_closure_acta_drafted` por acta escrita (sin contenido: sólo conteos), `agt002_closure_acta_failed`
con el código de la falla, `agt002_closure_acta_nothing_pending` y `agt002_closure_acta_run` con el resumen.
