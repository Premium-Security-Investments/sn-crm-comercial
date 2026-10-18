# Registro autoritativo de decisiones — ecosistema de agentes PSI

**Estado de las decisiones:** aceptadas por el propietario del producto

**Estado del artefacto:** aceptado para versionado documental; no autoriza
implementación, despliegue ni operación

**Fecha de corte:** 2026-10-03; estado de AGT-001, AGT-004 y AGT-006 actualizado
al 2026-10-18 (sección 2.1)

**Ámbito:** identidad, ownership, fronteras, secuencia y gates de AGT-000 a
AGT-006 y Plataforma Agentes

## 1. Regla de autoridad

Este registro es el índice de decisiones vigente para el mapa institucional.
No sustituye contratos, código, migraciones, estado vivo ni autorizaciones
operativas. Cuando exista una discrepancia:

1. una decisión más reciente y explícitamente aceptada prevalece sobre una
   formulación documental anterior;
2. el código y las migraciones describen lo construido, no lo autorizado;
3. el estado vivo debe comprobarse en su sistema fuente;
4. ningún registro, commit o despliegue autoriza por sí solo el siguiente gate.

Los documentos anteriores se conservan como historia. Una sustitución afecta
solamente las afirmaciones señaladas y no reescribe su evidencia original.

## 2. Decisiones vigentes

| ID | Decisión autoritativa | Estado | Consecuencia inmediata | Fuente o detalle |
| --- | --- | --- | --- | --- |
| `DEC-AGT-001` | Plataforma Agentes es el plano de gobierno común; no es un agente y no recibe ID `AGT-###`. | Aceptada | No trasladar allí lógica, datos o runtimes de dominio. | [ADR del mapa institucional](./ADR-2026-10-02-plataforma-y-mapa-institucional-de-agentes.md) |
| `DEC-AGT-002` | El catálogo institucional está compuesto por `AGT-000` a `AGT-006`, con identidades globales únicas. | Aceptada | No crear familias de IDs alternativas por área o repositorio. | [Mapa del ecosistema](./agent-ecosystem-map.md) |
| `DEC-AGT-003` | `AGT-000` es Agente IT y el repositorio/runtime `agente-it` es su implementación existente. | Aceptada; identidad materializada por `agente-it#18` | P3.1 será una integración futura, no una fusión. | Sustituye únicamente las formulaciones anteriores que dejaban el ID de Agente IT pendiente o lo confundían con la Plataforma. |
| `DEC-AGT-004` | `AGT-001` es Gerencial; su estado técnico vivo y paquete de integración todavía deben definirse. | Aceptada en cuanto a identidad; la parte de estado técnico queda superada por los hechos de la sección 2.1 | La evidencia adicional ya existe; ver `DEC-AGT-013`. | [ADR del mapa institucional](./ADR-2026-10-02-plataforma-y-mapa-institucional-de-agentes.md) |
| `DEC-AGT-005` | `AGT-002` es Licitaciones; CRM/SIIO conserva su dominio, datos y runtime. | Aceptada | Plataforma futura gobierna identidad, policy, admisión y recibos mínimos; no duplica AGT-002. | [Frontera AGT-002 ↔ Plataforma](../agt002/platform-agents-integration.md) |
| `DEC-AGT-006` | `AGT-003` es Comercial y permanece separado de AGT-002. | Aceptada | Su runtime no se reactiva por registro, documentación, migración o trabajo sobre AGT-002. | [Mapa del ecosistema](./agent-ecosystem-map.md) |
| `DEC-AGT-007` | `AGT-004`, `AGT-005` y `AGT-006` son Operaciones, Reclutamiento y Programación; permanecen conceptuales. | Aceptada en cuanto a identidad; "conceptual" sigue vigente sólo para `AGT-005` | Para AGT-004 y AGT-006 ver `DEC-AGT-014` y `DEC-AGT-015`. | [ADR del mapa institucional](./ADR-2026-10-02-plataforma-y-mapa-institucional-de-agentes.md) |
| `DEC-AGT-008` | Las decisiones sensibles siguen siendo humanas. | Aceptada | Ningún agente decide automáticamente GO/NO-GO, firma, envía, publica o presenta. | [Política de revisión humana](./agt002-human-review-policy.md) |
| `DEC-AGT-009` | En AGT-002, `INITIAL` crea la primera corrida canónica; `REANALYSIS` sólo crea sucesoras y R1 es futuro. | Aceptada | No reutilizar la cola o autoridad de reanálisis para fabricar la primera corrida definitiva. | [Estado reconciliado de AGT-002](../agt002/status-2026-10-02.md) |
| `DEC-AGT-010` | La minería histórica permanece separada del producto vivo durante su piloto y, en el futuro, podrá alimentar la matriz mediante una integración append-only aprobada. | Aceptada como frontera; integración futura | No escribir hoy en oportunidades, corridas canónicas, CRM, Supabase o sistemas fuente por ese frente. | [Frontera de requisitos históricos](../agt002/historical-requirements-boundary.md) |
| `DEC-AGT-011` | `noxguard-control` sirve al CRM y a los dominios AGT-002/003; el proyecto dedicado `agente-it` corresponde a AGT-000. | Reconciliada; normalización integrada por `agente-it#18` | No convertir la base de AGT-000 en almacén central de todos los agentes. | Los pasos 5 y 6 quedaron versionados; esto no autoriza integración operacional con Plataforma. |
| `DEC-AGT-012` | Construido, verificado, desplegado, operando y autorizado son estados distintos. | Aceptada | Toda afirmación de avance debe nombrar el estado y su evidencia. | [Estado reconciliado de AGT-002](../agt002/status-2026-10-02.md) |
| `DEC-AGT-013` | `AGT-001` / Vig-IA Gerencia vive en CRM/SIIO (`sn-crm-comercial`): Torre de Control, cargue contable y recomendaciones de IA con puente dedicado `agt001-bridge`. | Aceptada | Reconoce un estado ya desplegado; no autoriza nuevas fuentes ni capacidades. | Sección 2.1 |
| `DEC-AGT-014` | `AGT-004` / Vig-IA Operaciones vive en CRM/SIIO (`sn-crm-comercial`) y lee SecurityOps como sistema fuente externo, sin escribir en él. | Aceptada | Las cifras se publican agregadas; reemplazar la sesión personal por una cuenta de servicio de sólo lectura antes de ampliar el alcance. | Sección 2.1 |
| `DEC-AGT-015` | `AGT-006` / Vig-IA Programación vive en el repositorio `programacion-personal` (esquema `programacion` de la base del SIIO, publicado en AWS Amplify); CRM/SIIO sólo administra quién entra. | Aceptada | No duplicar en el CRM lógica de turnos o nómina; las reglas de nómina siguen sin validar por Nómina. | Sección 2.1 |

### 2.1 Estado verificado de AGT-001, AGT-004 y AGT-006 (corte 2026-10-18)

Estos son hechos con evidencia, no decisiones. Reconocen que el estado real se
adelantó a `DEC-AGT-004` y `DEC-AGT-007`. Este registro no contiene un gate o
plan aprobado previo para la entrada de datos y runtime de AGT-004 y AGT-006:
`por confirmar` si existe fuera de él.

| Agente | Repositorio | Construido | Desplegado | Operativo | Evidencia |
| --- | --- | --- | --- | --- | --- |
| `AGT-001` Gerencial | `sn-crm-comercial` | Torre de Control, cargue contable (migr. 122), seguimiento gerencial (123), recomendaciones de IA (131), `ops/agt001-claude-bridge`, `ops/agt001-recommendations-weekly` | Sí: PRs #345–#355 y #374–#377 en producción (Vercel) | Recomendaciones: una corrida real (2026-10-15); la primera corrida semanal automática es el 2026-10-19 11:30 UTC (`por confirmar`) | `/root/handoffs/2026-10-15-AGT-001-cierre-gerencia.md`, `…-recomendaciones-ia.md` |
| `AGT-004` Operaciones | `sn-crm-comercial` (extractor `scripts/agt004_securityops_operations.py`, panel de Operaciones en la Torre); fuente: `SecurityOps` (Firestore, sólo lectura) | Migración 128, extractor v2, resumen en la Torre | Sí: PR #371 (`2bd384c`), migración 128 aplicada, corrida de 491 filas cargada | `por confirmar` (falta la confirmación visual en la Torre); lectura con la sesión personal de Juan como puente temporal | `/root/handoffs/2026-10-13-AGT-004-acceso-lectura-securityops.md`, `…-14-AGT-004-operaciones-torre.md` |
| `AGT-006` Programación | `programacion-personal` (app + esquema `programacion`); acceso administrado desde `sn-crm-comercial` (migración 129, PR #372; migración 130, PR #373) | Motor de cálculo Pereira, calendario, cierre, costo de extras, novedades, alertas, reglas legales por ciudad | Sí: AWS Amplify (`main`) y esquema `programacion` en la base del SIIO | No: sin usuarios de Programación; reglas de nómina sin validar por Nómina; verificado con datos de Pereira | `/root/handoffs/2026-10-17-AGT-006-cierre-jornada.md`, `…-cierre-resumen-unico.md`, `/root/handoffs/evidencia/2026-10-15-agt006-acceso-programacion/` |

`AGT-005` / Reclutamiento: sin código, repositorio ni handoffs; sigue conceptual.

Ninguno de los tres tiene todavía registro, identidad técnica o adaptador en
Plataforma Agentes. Estar desplegado no los integra a la Plataforma ni abre gates
posteriores (`DEC-AGT-012`).

## 3. Secuencia de trabajo ratificada

La secuencia vigente es obligatoria salvo nueva decisión explícita:

1. crear y versionar el mapa y este registro autoritativo;
2. diagnosticar Cali con evidencia read-only;
3. definir la recuperación individual de Cali y obtener su gate;
4. retomar P0-06;
5. normalizar `agente-it` como AGT-000;
6. reconciliar las migraciones `0016` y `0017`;
7. completar `INITIAL` reducido;
8. abrir después R1 y Plataforma Fase 2 mediante gates separados.

La minería histórica no es una fase de esta secuencia. Su integración futura se
limita al contrato append-only indicado en `DEC-AGT-010`.

## 4. Sustituciones y compatibilidad documental

| Artefacto anterior | Formulación afectada | Disposición vigente |
| --- | --- | --- |
| `ADR-2026-07-22-siio-agents-contract-ownership-and-canonical-catalog.md` | Agente IT descrito únicamente como molde técnico de la Plataforma | Se conserva la idea de reutilizar controles, pero `DEC-AGT-003` fija que el runtime es AGT-000 y no la Plataforma. |
| `agente-it/docs/architecture/ADR-002-catalogo-ownership-siio-agentes.md` | ID definitivo de Agente IT pendiente | Queda sustituido por `DEC-AGT-003`; la edición del repositorio se realizará en el paso 5. |
| Planes o informes que comiencen directamente por Cali | Omiten el cierre del mapa/registro | La secuencia de `DEC-AGT-001` a `DEC-AGT-012` y la sección 3 prevalecen. |
| `ADR-2026-10-02-plataforma-y-mapa-institucional-de-agentes.md` y `agent-ecosystem-map.md` (versión del 2026-10-02) | AGT-001 "paquete por definir"; AGT-004 y AGT-006 "conceptuales" | El ADR se conserva como historia; el estado vigente es la sección 2.1 de este registro y el mapa actualizado al 2026-10-18. |

Las decisiones de ownership de julio para AGT-002, AGT-003, SIIO y Plataforma
Agentes continúan vigentes en todo lo que no contradiga este registro.

## 5. Gate de cierre documental del paso 1

El paso 1 sólo puede declararse cerrado cuando exista evidencia de:

- mapa, ADR y registro coherentes entre sí;
- referencias cruzadas válidas;
- diff revisado sin contradicciones materiales conocidas;
- versionado mediante commit/PR aprobado o un recibo durable equivalente;
- identificación explícita de que no hubo despliegue, migración ni activación.

El commit que incorpore conjuntamente el mapa, el ADR, este registro y la nota
de vigencia constituye el recibo documental del paso 1. Su aceptación no abre
por sí sola ningún gate técnico u operativo posterior.
