# ADR — Plataforma Agentes y mapa institucional AGT-000..AGT-006

- **Estado:** aceptado
- **Fecha:** 2026-10-02
- **Decisión funcional:** propietario del producto
- **Ámbito:** identidad y pertenencia de los agentes institucionales
- **Registro:** [`DEC-AGT-001` a `DEC-AGT-007`](./agent-decision-registry.md)
- **Estado del artefacto:** aceptado para versionado documental; no autoriza
  implementación, despliegue ni operación

## Contexto

Existen tres conceptos que no deben confundirse:

1. la plataforma transversal que registra, autoriza y audita agentes;
2. la identidad institucional de cada agente `AGT-###`;
3. el runtime y sistema fuente donde vive la lógica de dominio del agente.

`agente-it` precede a `plataforma-agentes` y contiene un runtime funcional y
controles institucionales tempranos. El CRM contiene desarrollo funcional de
AGT-002 y AGT-003. Sin una decisión explícita, los nombres de repositorio podían
interpretarse erróneamente como agentes competidores o plataformas sucesoras.

Esta decisión sustituye únicamente las formulaciones anteriores que trataban a
Agente IT como el molde sin ID definitivo o como sinónimo de la Plataforma. No
deroga las decisiones previas de ownership funcional de SIIO, separación entre
AGT-002/AGT-003 ni gobierno transversal.

## Decisión

### Plataforma común

`plataforma-agentes` es la plataforma institucional común bajo la cual estarán
cobijados todos los agentes del mapa. No es un agente, no recibe ID `AGT-###` y
no absorbe automáticamente su lógica de dominio.

La plataforma será autoridad para:

- registro e identidad institucional;
- ciclo de vida y activación explícita;
- configuración y policy por ambiente;
- admisión PEP/PDP y delegación;
- referencias gobernadas a secretos;
- auditoría y recibos comunes de ejecución.

### Identidad de Agente IT

`AGT-000` es Agente IT. El repositorio y runtime `agente-it` constituyen su
implementación existente. Su incorporación a la plataforma común se hará
mediante el futuro adaptador P3.1; no convierte a `agente-it` en la plataforma
ni convierte a Plataforma Agentes en el runtime funcional de IT.

### Mapa institucional

| ID | Agente | Estado o siguiente frontera |
| --- | --- | --- |
| `AGT-000` | IT | Primer corte vertical; adaptador P3.1 futuro |
| `AGT-001` | Gerencial | Reconocido; estado técnico y paquete de integración por definir |
| `AGT-002` | Licitaciones | `INITIAL`, R1; contrato P3.2 futuro |
| `AGT-003` | Comercial | Contrato P3.3 futuro; sin reactivación automática |
| `AGT-004` | Operaciones | Conceptual; gates y plan propios pendientes |
| `AGT-005` | Reclutamiento | Conceptual; gates y plan propios pendientes |
| `AGT-006` | Programación | Conceptual; gates y plan propios pendientes |

## Consecuencias

- Todos los agentes comparten gobierno institucional, no necesariamente código,
  base de datos, runtime o despliegue.
- Los sistemas fuente conservan datos y reglas funcionales: CRM/SIIO mantiene
  AGT-002 y AGT-003; `agente-it` mantiene el dominio funcional de AGT-000 hasta
  que un plan aprobado cambie esa frontera.
- Los agentes conservan identidades, owners, capabilities, sources, scopes,
  contratos y evaluaciones independientes.
- Un runtime existente no queda activo por estar registrado o cobijado por la
  plataforma. Activación, reactivación, datos reales y despliegue requieren
  gates explícitos.
- Los contratos V1 incompatibles de `agente-it` y `plataforma-agentes` no se
  renombran ni sustituyen silenciosamente; P3.1 debe conservarlos o adaptarlos
  de forma versionada.
- AGT-004, AGT-005 y AGT-006 no se implementan por el solo hecho de figurar en
  el mapa.

## Arquitectura resultante

```text
Plataforma Agentes
  |-- AGT-000 / IT ---------- runtime agente-it
  |-- AGT-001 / Gerencial --- paquete por definir
  |-- AGT-002 / Licitaciones  dominio CRM/SIIO
  |-- AGT-003 / Comercial --- dominio CRM/SIIO
  |-- AGT-004 / Operaciones - conceptual
  |-- AGT-005 / Reclutamiento conceptual
  `-- AGT-006 / Programación  conceptual
```

La relación de cobijo expresa gobierno y controles comunes; las líneas no
representan integración productiva ya implementada.
