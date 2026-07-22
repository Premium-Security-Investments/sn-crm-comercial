# ADR — Ownership de contratos SIIO–Agentes y catálogo institucional canónico

- **Estado:** Aceptado para P0 documental
- **Fecha de decisión:** 2026-07-22
- **Decisor:** Juan Botero
- **Base verificada de SIIO:** `main@c3304b4126a441523aa7bb0a6e7dc288ec4eab7b`
**Alcance:** decisión arquitectónica; no implementa contratos, schemas, identidades, integraciones, endpoints ni despliegues.

## 1. Contexto

SIIO ya contiene los motores y contratos funcionales que gobiernan la priorización comercial privada y el trabajo licitatorio público. La futura Plataforma Agentes aportará identidad institucional, membresías, capacidades, fuentes autorizadas, política, auditoría, canales y gates de ejecución.

Sin una decisión explícita de ownership podían aparecer tres derivas:

1. duplicar reglas y catálogos en SIIO, Plataforma Agentes y cada canal;
2. tratar al Agente Comercial PSI como un cuarto motor funcional;
3. mezclar pipeline privado y licitaciones públicas bajo permisos, fuentes o resultados comunes.

El estado técnico de AGT-002 y AGT-003 está documentado en [el assessment de preparación](./2026-07-22-agt-002-agt-003-integration-readiness-assessment.md).

Esta decisión materializa el P0 definido por los siguientes artefactos de gobierno externos al repositorio, citados por nombre portable:

- `SIIO-AGENTS-PHASE3-DESIGN-DECISION-PACK-2026-07-22.md`;
- `SIIO-AGENTS-PHASE3A-AUTHORIZATION-2026-07-22.md`;
- `SIIO-AGENTS-PHASE3A-EXECUTION-CONTROL.md`.

## 2. Decisión

### 2.1 Catálogo institucional único

La **Plataforma Agentes** es la fuente canónica futura para el registro institucional de agentes:

- identidad e ID canónico;
- estado del agente;
- membresías y responsables;
- capacidades habilitadas;
- fuentes autorizadas;
- política institucional;
- evidencia y auditoría de ejecución;
- conversaciones, canales y gates.

El catálogo local actual de SIIO se conserva como manifest de compatibilidad durante la transición. No se convierte en un segundo catálogo institucional ni autoriza sincronización, creación de registros o activación de agentes durante P0.

### 2.2 Ownership funcional de SIIO

**SIIO conserva la propiedad de los contratos funcionales y la inteligencia de negocio que implementa**, incluyendo:

- inputs, outputs, errores y evidencia del dominio;
- score, señales, orden y política de AGT-003;
- score de Radar, reglas documentales y GO/NO GO de AGT-002;
- fuentes de verdad, filtros, fechas de corte y semántica funcional;
- reglas de scope y minimización que deban revalidarse junto a los datos;
- flujos humanos existentes de oportunidades y licitaciones.

Plataforma Agentes consume resultados canónicos mediante adaptadores gobernados. No recalcula score, no copia reglas funcionales y no interpreta silenciosamente versiones incompatibles.

### 2.3 IDs, owners y función institucional

| Identidad | Owner funcional | Ownership de lógica/contrato | Función institucional |
|---|---|---|---|
| `AGT-001` — Agente Gerencial PSI | Dirección/Gerencia PSI | SIIO para los contratos gerenciales que publique | Agente canónico gerencial |
| `AGT-002` — Copiloto de Licitaciones | Dirección de Licitaciones | SIIO | Agente/motor canónico del dominio público y licitatorio |
| `AGT-003` — Vig-IA Comercial | Dirección Comercial | SIIO | Agente/motor canónico de priorización comercial privada |
| Agente Comercial PSI | Dirección Comercial | Sin motor funcional propio | Router institucional hacia AGT-003 o AGT-002 según dominio |
| Agente IT | Gobierno técnico de Plataforma Agentes | Plataforma Agentes | Primer molde técnico común; no sustituye agentes funcionales |

### 2.4 Agente Comercial PSI es un router

El Agente Comercial PSI no es `AGT-004`, no contiene scoring propio y no absorbe Licitaciones ni Vig-IA.

```text
Agente Comercial PSI
→ clasifica/enruta la intención
   ├── oportunidad comercial privada → AGT-003
   └── proceso público/licitatorio   → AGT-002
```

El enrutamiento no amplía permisos. Cada agente conserva ID, owner, membresías, capacidades, fuentes, scope, política, evidencia y auditoría independientes.

### 2.5 Separación obligatoria de dominios

`AGT-003` y `AGT-002` permanecen separados:

| Dimensión | AGT-003 | AGT-002 |
|---|---|---|
| Dominio | Pipeline comercial privado | Procesos públicos y licitaciones |
| Owner | Dirección Comercial | Dirección de Licitaciones |
| Fuente principal | CRM-F1 | Radar, SECOP I/II, TVEC, ESU y expediente |
| Primer modo futuro | Read-only de prioridades | Lecturas licitatorias separadas, después de AGT-003 |
| Mutaciones desde Agentes | Prohibidas | Prohibidas en el alcance autorizado |

No se comparten automáticamente scopes, fuentes, contratos, resultados ni aprobaciones entre ambos dominios.

### 2.6 Autorización en dos fronteras

En una integración futura, Plataforma Agentes será el punto institucional de decisión de política; SIIO revalidará la solicitud en la frontera de su contrato y resolverá el scope server-side.

```text
principal
∩ membresía del agente
∩ capability habilitada
∩ fuente autorizada
∩ scope resuelto por servidor
∩ política funcional de SIIO
∩ clasificación del dato
= allow / deny
```

Una ausencia, error o incompatibilidad produce `deny`. Ningún cliente puede ampliar rol, owner, área, agente o capability mediante el body o un deep-link.

Esta sección es una decisión de ownership; P0 no crea esa infraestructura.

### 2.7 Mismo contrato para todas las interfaces

SIIO UI, Hermes, Copilot/Teams y futuras aplicaciones deben consumir el mismo ID, versión, capability, fuente, política, scope, evidencia y auditoría por agente.

Las interfaces pueden presentar o enrutar resultados, pero no se convierten en propietarias de reglas ni mantienen forks del contrato.

## 3. Secuencia y límites

La ejecución autorizada es secuencial:

```text
P0 documental → G0
P1 catálogo/schemas inactivos → G1
P2 envelope/auditoría local e inactiva → G2
P3 identidad/delegación y adaptadores sintéticos → G3
```

Este ADR ejecuta únicamente P0. No constituye `G0_PASS` por sí solo y no inicia P1.

Durante P0 quedan expresamente fuera de alcance:

- código funcional o contratos JSON;
- schemas machine-readable;
- migraciones o cambios de base de datos;
- endpoints o adaptadores;
- identidades, tokens, secrets o membresías;
- fuentes o datos reales;
- activación de Hermes/Copilot;
- modelos externos, embeddings o costos;
- SharePoint;
- sincronización, conversión, descarte, aprobación, preparación, envío, firma o presentación;
- despliegues.

## 4. Consecuencias

### Positivas

- Evita un cuarto motor comercial y catálogos paralelos.
- Preserva SIIO como fuente de verdad funcional.
- Permite que Plataforma Agentes gobierne identidad y ejecución sin copiar reglas.
- Mantiene separados los riesgos y permisos de privado y licitaciones.
- Hace posible validar paridad entre interfaces contra un único contrato.

### Costos y trabajo futuro

- El catálogo local de SIIO deberá validarse contra versión/hash institucional en un gate posterior.
- Se necesitarán schemas versionados y adaptadores, pero no se crean en P0.
- La identidad técnica, delegación y auditoría común continúan pendientes.
- AGT-002 requiere guards por acción antes de cualquier futura capacidad mutante.

### Invariantes

- `AGT-003` es el único motor canónico de priorización comercial privada.
- `AGT-002` es el único agente/motor canónico licitatorio.
- Agente Comercial PSI solo enruta.
- Agente IT solo es molde técnico.
- SIIO conserva reglas, datos y contratos funcionales.
- Plataforma Agentes conserva catálogo institucional, identidad, política y auditoría común.
- Toda mutación permanece humana y fuera del runtime de Agentes hasta una autorización futura separada.

## 5. Criterio de aceptación P0 / Gate G0

Esta decisión queda lista para Gate G0 cuando:

1. el ADR y el assessment estén versionados mediante PR;
2. el diff del PR contenga únicamente archivos Markdown;
3. checks y CI estén verdes;
4. exista revisión independiente;
5. el PR esté fusionado y `main` quede sincronizado;
6. CURRENT de SIIO registre PR, commit, checks, diff y límites;
7. el frente Agentes complete su P0 documental independiente;
8. `#psi-general` consolide ambos frentes.

Hasta que las ocho condiciones se verifiquen, P1 permanece bloqueado.

## 6. Alternativas rechazadas

### Duplicar los motores en Plataforma Agentes

Rechazada porque introduce deriva de score, reglas y evidencia.

### Convertir al Agente Comercial en agente canónico de ambos dominios

Rechazada porque mezcla ownership, fuentes, permisos y riesgos incompatibles.

### Usar Agente IT como runtime de AGT-002/003

Rechazada porque el molde técnico común no reemplaza identidades funcionales.

### Reutilizar cuentas humanas o `service_role` como identidad entre sistemas

Rechazada por falta de delegación, audiencia, revocación y trazabilidad adecuadas.

## 7. Rollback

P0 es exclusivamente documental. El rollback consiste en revertir el PR de documentación. No requiere migraciones inversas, cambios de datos, revocación de credenciales ni rollback de Producción.
