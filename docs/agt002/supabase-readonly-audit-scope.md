# AGT-002 — alcance de auditoría read-only de Supabase

**Estado:** propuesta de inspección; no autoriza acceso ni ejecución

## 1. Objetivo

Contrastar repositorio, informes y estado remoto sin cambiar datos ni servicios.
La auditoría debe distinguir al menos:

- CRM/SIIO y AGT-002/003;
- proyecto dedicado de `agente-it`/AGT-000;
- Plataforma Agentes, para la cual no se espera hoy una base persistente o
  productiva.

## 2. Fases de inspección

### A. Inventario de proyectos y ambientes

Sólo metadatos:

- project ref, nombre, región y estado;
- asociación documentada con repositorio/ambiente;
- versión de Postgres y extensiones instaladas;
- ramas o proyectos de desarrollo, piloto y producción;
- Edge Functions y jobs programados por nombre y estado, sin secretos.

### B. Drift de esquema

- ledger de migraciones aplicado frente a `supabase/migrations/`;
- presencia y firma de tablas, vistas, funciones, triggers e índices;
- RLS, policies, grants y owners;
- confirmación de que migraciones 097..100 de INITIAL no están aplicadas, salvo
  evidencia remota explícita en contrario;
- ausencia esperada de tablas de minería histórica durante el piloto local.

### C. Evidencia operativa mínima de AGT-002

Requiere autorización read-only específica. Consultas limitadas a identificadores,
estados, timestamps, progreso y relaciones:

- job de REANALYSIS reportado para Cali;
- lease, heartbeat, fase, progreso y estado terminal;
- workset asociado y estado de publicación;
- existencia o ausencia de corrida canónica relacionada;
- estado de timers/worker desde su sistema operativo, en una revisión separada.

No se leen prompts, texto documental, resultados completos, contactos, hojas de
vida, credenciales ni payloads de proveedor.

## 3. Prohibiciones

- no ejecutar RPC de escritura, claim, fail, complete, retry o recovery;
- no reencolar jobs ni renovar leases;
- no aplicar, reparar o revertir migraciones;
- no desplegar Edge Functions;
- no cambiar RLS, grants, Auth, Storage, Vault, cron o configuración;
- no habilitar timers ni reiniciar servicios;
- no imprimir service-role keys, JWT, secretos o URLs firmadas;
- no tomar una lectura remota como autorización para actuar.

## 4. Entregable

Una matriz con:

| Proyecto/ambiente | Repositorio dueño | Migración esperada/aplicada | Drift | Evidencia | Acción propuesta |
| --- | --- | --- | --- | --- | --- |

Cada hallazgo se clasifica como `CONFIRMADO_REMOTO`, `CONFIRMADO_REPO`,
`REPORTADO_NO_REVALIDADO`, `DRIFT` o `DESCONOCIDO`. Cualquier corrección queda
fuera de la auditoría y requiere autorización separada.
