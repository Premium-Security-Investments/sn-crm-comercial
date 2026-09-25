# AGT-002 F0-A — Prohibición temporal de migraciones no autorizadas

## Alcance

Este runbook describe la **prohibición temporal** de ejecutar migraciones de
base de datos (Supabase o `psql`) **fuera del flujo autorizado** durante la
fase F0-A del plan de control de AGT-002.

F0-A es una fase **exclusivamente de observación**. Ninguna acción incluida
en esta fase puede alterar el estado de los sistemas en ejecución.

## Qué NO hace F0-A

- F0-A **no muta el runtime** de ningún servicio.
- F0-A **no escribe en Supabase** (ni ejecuta `supabase db push`,
  `supabase migration up`, ni comandos `psql -f` contra
  `supabase/migrations/`).
- F0-A **no reinicia servicios** (no ejecuta `systemctl restart`,
  `systemctl stop`, `systemctl start` ni `systemctl daemon-reload`).
- F0-A **no declara `F0-A PASS`** ni **`AGT002_CONTROL_PLANE_RECONCILED`**.
  Cualquier receipt observado que contenga `claims.f0a_pass = true`,
  `claims.control_plane_reconciled = true` o `claims.release_receipt = true`
  debe tratarse como inválido.

## Falsos positivos conocidos: hilos del kernel `migration/N`

Los procesos del kernel de Linux llamados `migration/0`, `migration/1`, etc.
(visibles entre corchetes como `[migration/0]` en `ps`/`top`) son **hilos de
kernel (kthreads)** responsables del balanceo de CPU y **no tienen relación
alguna con migraciones de base de datos**. No deben clasificarse ni
reportarse jamás como ejecutores de migraciones.

Solo se consideran ejecutores de migración real los procesos que invoquen
explícitamente `supabase db`, `supabase migration`, o `psql -f` contra
archivos bajo `supabase/migrations/`.

## Gate de autorización

Cualquier migración real de base de datos fuera de esta fase requiere pasar
por el flujo autorizado, señalizado mediante la variable de entorno o gate
**`AUTHORIZE_F0`**. Sin `AUTHORIZE_F0` presente y verificado, ninguna
migración debe ejecutarse, y cualquier intento observado fuera de este flujo
debe reportarse como una violación de la prohibición temporal descrita en
este documento.

## Resumen

| Acción                                   | Permitido en F0-A |
|-------------------------------------------|:------------------:|
| Observar y registrar estado (`receipts`)  | Sí                 |
| Ejecutar `supabase db` / `supabase migration` | No             |
| Ejecutar `psql -f` sobre `supabase/migrations/` | No           |
| Reiniciar servicios (`systemctl ...`)     | No                 |
| Declarar `F0-A PASS` / `AGT002_CONTROL_PLANE_RECONCILED` | No  |
