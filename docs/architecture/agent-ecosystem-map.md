# Mapa del ecosistema de agentes SIIO

**Estado:** diagnóstico de arquitectura; no autoriza integración ni despliegue

**Fecha de corte:** 2026-10-02

**Repositorios revisados:**

- [`sn-crm-comercial@223a085`](https://github.com/Premium-Security-Investments/sn-crm-comercial/commit/223a085be330f099863a876ed3ccfdb56efe51a9);
- [`agente-it@988becc`](https://github.com/Premium-Security-Investments/agente-it/commit/988becc75f0e866688281db61dd3ec21e9ede17e);
- [`plataforma-agentes@1b609c4`](https://github.com/Premium-Security-Investments/plataforma-agentes/commit/1b609c47a9373b611958cd60ab9960c76b926dbc).

## 1. Conclusión

Los tres repositorios no son implementaciones equivalentes ni deben fusionarse
por nombre:

- `sn-crm-comercial` es hoy el sistema fuente y el runtime funcional de
  AGT-002 y AGT-003: contiene reglas de dominio, contratos, datos, API,
  persistencia, UI y operación;
- `agente-it` es el prototipo institucional anterior y más avanzado
  operacionalmente y constituye la implementación de `AGT-000`: tiene un
  núcleo de confianza y consulta documental desplegado en un proyecto dedicado,
  además de artefactos sintéticos de integración para AGT-002 y AGT-003;
- `plataforma-agentes` no es un agente ni sustituye el dominio de los agentes:
  es la plataforma institucional común bajo la cual estarán cobijados
  `AGT-000` a `AGT-006` mediante registro, configuración, policy, admisión,
  secretos referenciados y auditoría compartida.

La decisión de identidad y pertenencia queda fijada en el
[ADR del mapa institucional](./ADR-2026-10-02-plataforma-y-mapa-institucional-de-agentes.md).
Las decisiones vigentes, sus sustituciones y la secuencia de trabajo se
consolidan en el
[registro autoritativo de decisiones](./agent-decision-registry.md).
Permanece pendiente materializarla en contratos y adaptadores, no decidir de
nuevo si Agente IT y Plataforma Agentes son el mismo producto.

## 2. Mapa institucional canónico

El catálogo institucional separa la identidad y su etapa de integración del
grado de desarrollo que pueda existir en un sistema fuente:

| ID | Dominio | Estado institucional y siguiente frontera |
| --- | --- | --- |
| `AGT-000` | IT | Primer corte vertical; futuro adaptador P3.1 |
| `AGT-001` | Gerencial | Reconocido institucionalmente; estado técnico y paquete de integración pendientes de definición |
| `AGT-002` | Licitaciones | `INITIAL`, R1; futuro contrato P3.2 |
| `AGT-003` | Comercial | Futuro contrato P3.3; su runtime no se reactiva automáticamente |
| `AGT-004` | Operaciones | Conceptual; pendiente de gates y plan propio |
| `AGT-005` | Reclutamiento | Conceptual; pendiente de gates y plan propio |
| `AGT-006` | Programación | Conceptual; pendiente de gates y plan propio |

Este mapa no significa que todos los agentes estén implementados o activos. En
particular:

- el código funcional existente de AGT-002/003 en el CRM no promueve por sí
  solo su estado institucional;
- P3.1, P3.2 y P3.3 son fronteras futuras distintas, no una autorización para
  desplegar o conectar datos reales;
- ninguna migración, contrato encontrado, proceso local, flag heredado o
  reinicio de infraestructura reactiva AGT-003;
- AGT-004/005/006 no deben recibir runtime, secretos, datos o contratos antes
  de tener gates y planes propios aprobados.

`plataforma-agentes` queda fuera de la numeración `AGT-###`: es el plano de
control y gobierno común. Cada agente conserva su propósito, owner, runtime,
fuentes, contratos funcionales y evaluaciones; estar cobijado por la plataforma
no significa trasladar o duplicar allí toda su lógica de dominio.

## 3. Responsabilidad por sistema

| Responsabilidad | Autoridad actual | Dirección objetivo |
| --- | --- | --- |
| Datos y ciclo comercial privado | CRM/SIIO | CRM/SIIO |
| Lógica, score y contratos de AGT-003 | CRM/SIIO | CRM/SIIO |
| Datos, radar y análisis licitatorio AGT-002 | CRM/SIIO | CRM/SIIO |
| Identidad, configuración y policy institucional | Prototipo en `agente-it` y base nueva sin integrar | Plataforma Agentes |
| Admisión PEP/PDP y recibo común | Dos implementaciones incompatibles | Plataforma Agentes, con adaptador/versionado explícito |
| Consulta documental de AGT-000 | Runtime `agente-it` | AGT-000 gobernado por Plataforma Agentes |
| Decisiones, aprobación, envío y efectos externos | Humano autorizado | Humano autorizado mediante flujos gobernados |

La frontera objetivo es:

```text
Canales e interfaces
          |
          v
Plataforma Agentes (no es un AGT)
registro · identidad · policy · admisión · auditoría
          |
          +-- AGT-000 / IT ------------> runtime agente-it
          +-- AGT-001 / Gerencial -----> paquete por definir
          +-- AGT-002 / Licitaciones --> dominio CRM/SIIO
          +-- AGT-003 / Comercial -----> dominio CRM/SIIO
          +-- AGT-004 / Operaciones ---> conceptual
          +-- AGT-005 / Reclutamiento -> conceptual
          `-- AGT-006 / Programación --> conceptual
```

El Agente Comercial PSI clasifica intención y enruta. No es un cuarto motor,
no asigna permisos y no mezcla resultados:

```text
oportunidad comercial privada -> AGT-003
proceso público o licitación  -> AGT-002
```

## 4. Estado verificable por repositorio

### `sn-crm-comercial`

- AGT-002 y AGT-003 tienen desarrollo funcional real y distinto.
- SIIO posee sus contratos de entrada, salida, errores y evidencia.
- El backend Express y su entrada serverless todavía duplican composición y
  deben conservar paridad durante la extracción.
- La sesión humana, los permisos de módulo y el scope de datos se resuelven hoy
  en el CRM; aún no existe identidad técnica productiva de AGT-002/003 emitida
  por una plataforma común.

### `agente-it`

- Es la implementación existente de AGT-000 y un prototipo desplegado, pero no
  habilitado para usuarios productivos.
- Sus fases 1 y 2 implementan controles de identidad/autorización y consulta
  documental read-only, con datos y conectores reales deshabilitados.
- Las migraciones `0016` y `0017`, la solicitud institucional y el adaptador
  SIIO sintético ya modelan AGT-002 y AGT-003 como identidades separadas.
- El adaptador sólo ofrece rutas sintéticas para
  `agt002.radar.read` y `agt003.priorities.read`; no prueba una integración
  productiva.
- Su ADR-002 conserva en SIIO la inteligencia de negocio y define al Agente IT
  como molde técnico, no como superagente.

### `plataforma-agentes`

- Es la plataforma institucional común destinada a cobijar AGT-000..AGT-006;
  no recibe un identificador de agente.
- La Fase 1 está implementada únicamente contra PostgreSQL efímero/local o CI.
- Tiene namespaces, registro, configuración, policy default-deny, referencias
  a secretos, PEP multiagente y ledger append-only.
- Su único corte vertical ejecutable es AGT-000, sintético y read-only.
- AGT-002 y AGT-003 están expresamente fuera de alcance; no tienen registro
  operativo, capability, binding, adaptador, datos ni despliegue allí.

## 5. Divergencia que debe resolverse

El runtime histórico de AGT-000 en `agente-it` y la base común de
`plataforma-agentes` publican dos contratos diferentes de recibo de ejecución
V1. Comparten la intención de auditar una corrida, pero no el mismo ID, estados
ni campos. El CRM todavía fija contratos producidos por `agente-it`; no se deben
sustituir por los de `plataforma-agentes` sólo porque ambos se llamen “run
envelope”.

La integración requiere, en este orden:

1. registrar explícitamente que `agente-it` implementa AGT-000 bajo el gobierno
   futuro de Plataforma Agentes;
2. inventariar los contratos heredados que se conservan, adaptan o reemplazan;
3. publicar un contrato nuevo o adaptador explícito entre envelopes, con pruebas
   consumer/provider;
4. registro inactivo de AGT-002 y AGT-003 en la plataforma elegida;
5. piloto sintético y read-only antes de datos o secretos reales;
6. autorización separada para despliegue o Fase 2.

## 6. Reglas de no duplicación

- Plataforma Agentes no copia scoring, radar, prompts de dominio ni reglas de
  AGT-002/003.
- El CRM no implementa su propio registro institucional, PDP, PEP o ledger
  transversal provisional.
- AGT-002 y AGT-003 no comparten identidad, policy, scope, fuentes, contratos,
  tablas de runs ni evaluaciones por conveniencia técnica.
- Una utilidad sólo pasa a `shared` después de tener contrato neutral y dos
  consumidores reales; no se comparte por similitud de nombre.
- Ningún canal, body HTTP o modelo elige su rol, agente, fuente o scope.
- La indisponibilidad o incompatibilidad de cualquiera de las fronteras falla
  cerrada.

## 7. Decisiones pendientes

| Decisión | Por qué bloquea integración real |
| --- | --- |
| Adaptador P3.1 de AGT-000 | Materializa `agente-it` como AGT-000 bajo la plataforma común |
| Envelope canónico o adaptador versionado | Los V1 actuales no son intercambiables |
| Owner y aprobadores de Fase 2 | La Fase 1 nueva no autoriza datos ni despliegue |
| Vínculo entre run institucional y run funcional | Sin él no hay trazabilidad extremo a extremo |
| Identidad técnica y delegación del humano | Las sesiones humanas actuales no equivalen a identidad de agente |

Hasta resolverlas, ambos agentes pueden ordenarse internamente en el CRM sin
afirmar que ya están integrados a la plataforma.
