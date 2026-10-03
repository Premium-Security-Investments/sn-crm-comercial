# AGT-002 INITIAL — recibo de cierre E0 candidato

**Fecha:** 2026-10-03
**Estado:** `AGT002_INITIAL_ANALYSIS_E0_IMPLEMENTATION_PASS_CANDIDATE`
**Entorno:** rama/worktree aislado; cero cambios de producción

## Alcance cerrado

- P0-10 reducido: proyección canónica `pending | running | ready | failed`, endpoint/UI separados
  de REANALYSIS, reporte sólo con readback de corrida válida y decisión humana preservada.
- P0-11 reducido: runtime real de rehidratación y bridge, validación `pre_go_analysis.v1`,
  clasificación cerrada, presupuesto de tokens/costo, switches fail-closed, identidad/readback y
  observabilidad sanitizada.
- P0-12 reducido: E0 A y A+B con 13 documentos, dos lotes y síntesis desde checkpoints; migración
  104 y rollback verificados en PGlite sobre la cadena real 099–103.

## Evidencia ejecutada

- `test:agt002-initial-analysis-engine`: PASS.
- `test:agt002-initial-analysis-canonical-persistence`: PASS, incluida cadena PGlite.
- `test:agt002-initial-analysis-closure`: PASS.
- `check:backend-parity`: PASS.
- `build` (TypeScript + Vite): PASS.

La suite completa y los checks de CI se registrarán en el PR de integración; este recibo no los
anticipa.

## Fronteras preservadas

- INITIAL no importa tabla, RPC, cola, worker ni polling de REANALYSIS.
- No hay GO/NO-GO automático ni acción externa.
- No se aplicaron migraciones, no se instaló systemd y los flags permanecen OFF por defecto.
- La migración 104 reserva el run ID y deriva la topología de lotes server-side.
- Un resultado del proveedor no cuenta como éxito sin checkpoint, contrato válido y persistencia
  atómica.

## Siguiente gate

El siguiente paso operativo no es desplegar automáticamente. Requiere revisión/merge técnico y,
después, autorizaciones separadas para migración, despliegue desactivado y un único canario
INITIAL. R1 permanece condicionado a una primera corrida INITIAL válida y aceptada E2E.
