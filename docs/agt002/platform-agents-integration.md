# AGT-002 ↔ Plataforma Agentes — frontera e integración futura

**Estado:** diagnóstico de arquitectura; no autoriza integración ni despliegue

**Estado institucional asignado:** `INITIAL`, R1; contrato P3.2 futuro

**Corte revisado:**
[`Premium-Security-Investments/plataforma-agentes@1b609c47`](https://github.com/Premium-Security-Investments/plataforma-agentes/commit/1b609c47a9373b611958cd60ab9960c76b926dbc)
del 2026-09-29.

## 1. Conclusión

Plataforma Agentes es una dependencia arquitectónica futura de AGT-002, pero no
es hoy una dependencia operativa de su runtime.

- `sn-crm-comercial` contiene actualmente la lógica de negocio, contratos de
  análisis, datos, persistencia, API, UI y operación de AGT-002.
- `plataforma-agentes` contiene la frontera transversal de identidad,
  configuración, política, admisión y recibos de ejecución.
- el corte revisado de Plataforma Agentes no está desplegado, no usa una base
  persistente o productiva y limita su único corte vertical a AGT-000 con datos
  sintéticos;
- AGT-002 sólo aparece allí en el gobierno de namespace (`agt002.`) y en límites
  explícitos de no interferencia. No tiene registro activo, configuración,
  política, binding, capability ni adaptador implementado en ese repositorio.

Por tanto, ordenar AGT-002 no debe trasladar su dominio a Plataforma Agentes.
Debe preparar una interfaz gobernada para que la plataforma pueda identificar,
autorizar y auditar una ejecución sin copiar reglas licitatorias.

La existencia de runtime funcional, contratos locales o pilotos en el CRM no
equivale a completar R1 ni autoriza el futuro contrato P3.2.

## 2. Propiedad por repositorio

| Responsabilidad | Autoridad |
| --- | --- |
| Identidad institucional `AGT-002` y namespace `agt002.` | Plataforma Agentes |
| Registro y ciclo de vida institucional del agente | Plataforma Agentes |
| Configuración y política versionadas por ambiente | Plataforma Agentes |
| Binding principal + contrato + agente | Plataforma Agentes |
| Admisión PEP/PDP y recibo común de ejecución | Plataforma Agentes |
| Fuentes, scope licitatorio y minimización de datos | SIIO/CRM |
| Contratos funcionales V1/V2/V3 de AGT-002 | SIIO/CRM |
| Radar, evidencia, análisis, reanálisis y workbench | SIIO/CRM |
| Persistencia del resultado funcional | SIIO/CRM |
| Cumplimiento, GO/NO-GO, aprobación, firma y envío | Humano autorizado en SIIO/CRM |

La autorización futura es una intersección, no una sustitución:

```text
admisión institucional de Plataforma Agentes
∩ autorización y scope resueltos por SIIO
∩ gates funcionales de AGT-002
= ejecución permitida
```

Una negación, incompatibilidad o dependencia no disponible en cualquiera de las
tres fronteras produce abstención o denegación cerrada.

## 3. Estado real de Plataforma Agentes

El corte revisado implementa:

- gobierno de namespaces `AGT-000`..`AGT-006`;
- contrato `platform.agent-descriptor.v1`;
- registro canónico de agentes;
- configuración versionada, aprobada y activada mediante eventos append-only;
- PDP con denegación por defecto y reglas exactas, sin comodines;
- referencias versionadas a secretos, sin valores secretos inline;
- PEP que liga principal, contrato y ambiente a un agente;
- ledger append-only y contrato `platform.agent-run-envelope.v1`;
- JWT RS256 y un corte vertical sintético de solo lectura para AGT-000.

No implementa para AGT-002:

- fila canónica ni estado operacional;
- contrato de entrada funcional;
- catálogo de capabilities;
- policy/configuración/bindings;
- adaptador SIIO;
- despliegue, secretos, identidad o datos reales;
- ejecución o auditoría de corridas reales.

La propia documentación del repositorio indica que Fase 2 no ha sido iniciada
ni autorizada. Esta revisión respeta ese gate.

## 4. Dos linajes contractuales que deben reconciliarse

El CRM todavía conserva pins cuyo productor es
`Premium-Security-Investments/agente-it`, no `plataforma-agentes`:

- `contracts/agents/agent-run-envelope/v1/manifest.json`;
- `contracts/agents/institutional-agent-request/v1/manifest.json`;
- `contracts/agents/siio-adapter/v1/manifest.json`.

El repositorio `agente-it`, implementación de AGT-000, continúa accesible y su `main` revisado apunta a
`988becc75f0e866688281db61dd3ec21e9ede17e`, que coincide con el pin del
adaptador SIIO. Plataforma Agentes es la plataforma común de AGT-000..AGT-006,
pero aún no materializa la compatibilidad o migración desde esos contratos.

Los dos contratos llamados "agent run envelope" no son equivalentes:

| Dimensión | Pin heredado de `agente-it` | `plataforma-agentes` Fase 1 |
| --- | --- | --- |
| ID | URL `agente-it.local/.../v1` | `platform.agent-run-envelope`, versión `1.0.0` |
| Estados | requested, denied, running, completed, abstained, failed | completed, failed |
| Correlación/canal | `correlation_id`, `requester_channel` | no presentes |
| Scope/fuentes | digests de recurso y scope, fuentes y corte | `request_digest` metadata-only |
| Versión de agente | `agent_version` | no presente |
| Política | `policy_version` textual | `policy_version_id` y `policy_digest` |
| Revisión/aprobación | `human_review_required`, `approval_reference` | no presentes |
| Uso/costo | `cost` | no presente |
| Identidad adicional | sin namespace ni action | `namespace`, `action`, `contract_id` |

No se debe reemplazar un pin por el otro ni adaptar campos silenciosamente.
Ambos V1 son inmutables. La convergencia necesita el adaptador P3.1 de AGT-000
y un contrato nuevo o un adaptador explícito con pruebas consumer/provider.

## 5. Modelo de integración recomendado

La integración debe conservar tres artefactos distintos:

1. **Solicitud institucional.** Identidad verificada, principal, capability,
   ambiente y correlación; no contiene roles ni scopes elegidos por el cliente.
2. **Contrato funcional AGT-002.** Input/output versionado, contexto gobernado,
   evidencia, abstenciones y revisión humana. Sigue perteneciendo al CRM.
3. **Recibo de plataforma.** Metadatos y digests de admisión/ejecución, sin
   copiar prompts, documentos ni resultados funcionales.

Entre el recibo y el resultado funcional debe existir un vínculo durable, por
ejemplo un contrato versionado que relacione:

- `platform_run_id`;
- `agt002_analysis_run_id` o job durable;
- `correlation_id`;
- versiones de contrato, configuración y política;
- digest de la solicitud, scope resuelto, contexto y resultado;
- timestamps y estado final.

El nombre y la forma definitiva de ese contrato requieren decisión conjunta;
no deben inferirse ni implementarse como parte de una simple reorganización de
archivos.

## 6. Secuencia de integración

### Gate PA-0 — identidad y herencia contractual

- registrar que `agente-it` implementa AGT-000 y que Plataforma Agentes cobija
  el catálogo AGT-000..AGT-006 sin ser un agente;
- declarar qué contratos heredados se conservan, reemplazan o adaptan;
- nombrar owner y aprobadores de la integración AGT-002.

### Gate PA-1 — contrato entre repositorios

- fijar el commit y digest del contrato de plataforma consumido por SIIO;
- publicar el contrato de vínculo corrida-plataforma ↔ corrida-AGT-002;
- agregar pruebas consumer/provider en ambos repositorios.

### Gate PA-2 — registro inactivo

- registrar `AGT-002`/`agt002.` en estado no operacional;
- declarar capabilities exactas y inicialmente read-only;
- crear configuración, policy y bindings sintéticos por ambiente.

### Gate PA-3 — doble autorización

- verificar identidad técnica en Plataforma Agentes;
- resolver usuario, permisos, oportunidad, proceso y fuentes server-side en
  SIIO;
- rechazar cualquier intento del body de ampliar agente, rol, capability,
  fuentes o scope.

### Gate PA-4 — auditoría enlazada

- abrir/cerrar el recibo de plataforma y vincularlo con el run durable de
  AGT-002;
- probar idempotencia, replay, denegación, abstención, timeout y cierre fallido;
- impedir que una falla de auditoría produzca una ejecución no registrada.

### Gate PA-5 — piloto sintético y canary

- ejecutar primero fixtures sin documentos, datos ni secretos reales;
- probar una capability read-only contra resultados canónicos ya persistidos;
- comparar digests y trazabilidad entre ambos repositorios;
- exigir aprobación separada antes de piloto con datos reales o despliegue.

## 7. Invariantes de integración

- Plataforma Agentes no copia radar, análisis, evidencia ni reglas de GO/NO-GO.
- SIIO no inventa una identidad o decisión de policy de la plataforma.
- No se comparte `service_role`, cuenta humana, secreto o conexión de base de
  datos entre repositorios.
- Ningún body selecciona su propio agente, rol, fuente o scope.
- La indisponibilidad de identidad, policy, ledger o validación SIIO falla
  cerrada.
- Los contratos publicados son inmutables; los cambios se versionan.
- El primer piloto es read-only y no habilita firma, envío, presentación,
  conversión, descarte ni aprobación.

## 8. Bloqueos actuales

1. Fase 2 de Plataforma Agentes no está autorizada.
2. La decisión `agente-it` = AGT-000 aún no está materializada mediante el
   adaptador P3.1 en Plataforma Agentes.
3. Los envelopes V1 existentes son incompatibles.
4. AGT-002 no está registrado ni configurado en la plataforma.
5. No existe contrato de vínculo entre un run institucional y el run durable de
   AGT-002.
6. La conexión GitHub de Composio está autenticada, pero la organización bloquea
   su OAuth app; el acceso directo de Git sí funciona. Esto afecta automatización
   futura mediante Composio, no la revisión local realizada.

Ninguno de estos bloqueos impide ordenar internamente AGT-002. Sí impiden afirmar
que ya existe una integración operativa con Plataforma Agentes.
