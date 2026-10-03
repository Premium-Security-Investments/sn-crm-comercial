# AGT-002 — hoja de ruta de orden y estructura

**Estado:** propuesta activa

**Fecha base:** 2026-10-02

**Índice del subsistema:** [`README.md`](./README.md)

## 1. Resultado buscado

Convertir AGT-002, hoy distribuido por el repositorio, en un subsistema con:

- frontera y dependencias explícitas;
- módulos agrupados por capacidad, no sólo por prefijo;
- contratos y reglas de dominio independientes de HTTP, Supabase y proveedores;
- rutas delgadas que deleguen en casos de uso;
- pruebas y CI capaces de proteger cada extracción;
- operación y documentación navegables desde un único índice.

La reorganización no rediseñará simultáneamente el producto. Cada movimiento
debe mantener contratos, rutas, datos y comportamiento; las mejoras funcionales
se harán después en cambios separados.

Esta hoja de ruta estructural tampoco autoriza reanudar Cali, confirmar P0-06,
abrir R1, ejecutar minería histórica ni iniciar P3.2. Los tres planos de
ejecución están separados en
[el estado reconciliado](./status-2026-10-02.md) y
[la frontera histórica](./historical-requirements-boundary.md).

## 2. Problemas que se corrigen

1. Más de cien módulos `agt002-*` viven en la raíz y no expresan agrupación ni
   dirección de dependencias.
2. `server/index.js` compone directamente muchas capacidades de AGT-002; la
   lógica de interfaz y la de aplicación no tienen una frontera uniforme.
3. La UI de AGT-002 está repartida entre `src/main.tsx` y `src/tenders/`.
4. Contratos, migraciones, scripts, ops y documentos son ricos, pero no tenían
   un índice autoritativo común.
5. Los scripts de prueba focalizada cubren verticales concretas, pero no todo el
   conjunto de pruebas AGT-002; una reorganización amplia necesita un gate
   mecánico más completo.
6. Algunos componentes potencialmente compartidos —por ejemplo, firma del
   bridge o infraestructura documental— aún llevan el nombre de AGT-002. Antes
   de reutilizarlos se debe decidir si son dominio del agente o kernel común.

## 3. Dirección de dependencias

La estructura objetivo seguirá esta dirección:

```text
domain  ←  application  ←  infrastructure  ←  interfaces
  ↑              ↑                ↑                 ↑
reglas       casos de uso      DB/proveedor       HTTP/UI/ops
```

- `domain` no importa Express, Supabase, variables de entorno ni clientes de
  proveedor.
- `application` coordina casos de uso mediante puertos explícitos.
- `infrastructure` implementa esos puertos para base de datos, bridge,
  SharePoint y proveedores.
- `interfaces` traduce HTTP, workers, scripts y UI hacia casos de uso.
- el CRM puede invocar interfaces públicas de AGT-002; AGT-002 no debe importar
  el shell ni detalles de presentación del CRM.

## 4. Estructura objetivo

El destino propuesto para el runtime de servidor es:

```text
agt002/
  domain/
    analysis/
    evidence/
    governance/
    process/
    radar/
    review/
  application/
    analysis/
    radar/
    reanalysis/
    workbench/
  infrastructure/
    persistence/
    providers/
    bridge/
    sharepoint/
  interfaces/
    http/
    workers/
  index.js
```

Durante la transición, los archivos `agt002-*.js` de la raíz reexportarán desde
la nueva ubicación. Esos shims se retirarán sólo después de migrar consumidores
y demostrar que no quedan imports antiguos.

La presentación se agrupará sin sacar el dominio genérico de licitaciones de su
contexto:

```text
src/tenders/agt002/
  api/
  components/
  model/
```

Los artefactos que ya tienen un hogar claro lo conservan:

- contratos ejecutables: `contracts/agents/AGT-002/` y contratos auxiliares;
- datos gobernados: `data/agt002/`;
- despliegue y timers: `ops/agt002-*`;
- migraciones y rollbacks: `supabase/`;
- utilidades operativas: `scripts/agt002-*`;
- documentación: `docs/agt002/`, con enlaces a arquitectura y runbooks.

## 5. Matriz de propiedad

| Capacidad | AGT-002 posee | CRM/shared posee |
| --- | --- | --- |
| Oportunidad | selección, análisis y referencias | registro canónico y ciclo comercial |
| Documento | relevancia, evidencia y workset gobernado | almacenamiento, carga y extracción genérica |
| Identidad y acceso | identidad técnica del agente y gates propios | sesión, usuario, roles y permisos base |
| Decisión | propuesta, brecha y evidencia | determinación y aprobación humanas |
| Persistencia | runs, jobs, checkpoints y proyecciones del agente | cliente DB, conexión y entidades compartidas |
| Proveedor | puertos, presupuesto, modelo permitido y trazas | secretos y plataforma de despliegue |
| UI | vistas y estado propios de AGT-002 | navegación, layout y componentes comunes |

Una pieza sólo pasa a `shared` cuando tiene un consumidor real adicional, un
contrato neutral y pruebas que no dependan de semántica exclusiva de AGT-002.

## 6. Fases

### Frente transversal — Plataforma Agentes

Este frente acompaña la reorganización, pero no autoriza Fase 2 ni bloquea las
extracciones internas que no cambien comportamiento.

- materializar que `agente-it` es AGT-000 y que Plataforma Agentes cobija el
  catálogo AGT-000..AGT-006;
- reconciliar los dos contratos V1 de recibo sin modificar ninguno;
- definir el vínculo durable entre el run de plataforma y el run de AGT-002;
- mantener identidad/policy/auditoría en la plataforma y dominio/scope/datos en
  SIIO;
- ejecutar los gates PA-0..PA-5 descritos en
  [la frontera con Plataforma Agentes](./platform-agents-integration.md).

Ninguna fase de esta hoja de ruta debe introducir provisionalmente en el CRM
una copia del registro, PDP, PEP o ledger de Plataforma Agentes.

### Fase 0 — mapa y reglas de trabajo

**Estado:** completada con este índice y la hoja de ruta.

- definir frontera, autoridades e invariantes;
- clasificar documentación vigente e histórica;
- fijar dirección de dependencias y estrategia de compatibilidad.

Gate: enlaces válidos, diff documental limpio y cero cambio de runtime.

### Fase 1 — red de seguridad mecánica

**Estado:** en curso. El comando `test:agt002` y su gate de CI quedaron
incorporados el 2026-10-02; el inventario automatizado permanece pendiente.

- generar un inventario comprobable de módulos, consumidores, rutas, tablas,
  RPC, scripts y pruebas de AGT-002;
- ejecutar con `test:agt002` todas las pruebas `tests/*agt002*.test.mjs` sin
  depender de una lista manual incompleta;
- hacer que CI ejecute ese comando junto con paridad de backend y build;
- registrar excepciones reales (integraciones que requieren credenciales o
  servicios externos) sin convertirlas en éxitos silenciosos.

Gate: cualquier import roto, divergencia del backend o prueba AGT-002 fallida
bloquea la reorganización.

### Fase 2 — primera extracción vertical

Extraer primero el onboarding gobernado de procesos:

- `agt002-process-package.js`;
- `agt002-process-onboarding-gate.js`;
- `agt002-integral-manifest-source.js` y el delegador de Manizales;
- validadores y pruebas directamente asociados.

Razón: es una frontera pequeña, de alto valor arquitectónico, mayormente pura y
con invariantes fail-closed bien documentados.

Gate: mismos exports públicos, mismos errores observables, pruebas de identidad,
allowlist, flag apagado y regresión de Manizales.

### Fase 3 — contratos y núcleo de análisis

- agrupar inputs, políticas, manifests, categorías, ejes de decisión y
  compatibilidad en `domain/`;
- agrupar orquestación de preview, análisis integral y lotes en `application/`;
- introducir puertos para proveedor y persistencia donde hoy haya acoplamiento
  directo.

Gate: fixtures de contrato, cobertura 1:1, política de revisión humana e
idempotencia conservadas.

### Fase 4 — infraestructura y ejecución asíncrona

- mover adaptadores de persistencia, bridge, proveedor, SharePoint y retrieval;
- agrupar jobs, workers, leases, reintentos, checkpoints y reanálisis;
- conservar entrypoints operativos en `ops/` y `scripts/` como adaptadores
  delgados.

Gate: pruebas de integración, recuperación de lease, reintento, deduplicación y
SLO; ningún secreto ni cliente concreto entra al dominio.

### Fase 5 — radar y control plane

- separar dominio de confiabilidad del radar de sus adaptadores y timers;
- consolidar gates de autoridad, identidad, superficies observadas y drift;
- vincular los contratos `agt002-phase01` y `agt002-radar-reliability` desde sus
  módulos consumidores.

Gate: fixtures de confiabilidad, controles F0, grants y drift en CI.

### Fase 6 — API delgada y eliminación del espejo manual

- extraer handlers AGT-002 de `server/index.js` a `agt002/interfaces/http/`;
- dejar en el servidor sólo composición, middleware y montaje de rutas;
- reemplazar la duplicación manual entre `server/index.js` y
  `api/[...path].js` por una composición compartida, manteniendo ambos
  entrypoints de despliegue.

Gate: paridad de endpoints, autorización, cuerpos cerrados, errores y pruebas
de contrato HTTP.

### Fase 7 — UI por feature

- mover componentes y lógica específica a `src/tenders/agt002/`;
- extraer de `src/main.tsx` el montaje y estado que pertenezcan al feature;
- mantener en `src/tenders/` los tipos y componentes genuinamente compartidos.

Gate: build, pruebas de proyección/polling y QA visual autenticado de las
superficies críticas.

### Fase 8 — consolidación

- migrar todos los imports a las rutas canónicas;
- eliminar shims únicamente cuando una búsqueda mecánica demuestre cero usos;
- actualizar runbooks y diagramas afectados;
- publicar un registro final de decisiones y deuda remanente.

Gate: suite completa, build, paridad, controles de seguridad y canary acordado.

## 7. Reglas para ejecutar cada fase

Cada pull request o cambio local debe:

1. cubrir una sola capacidad o una sola frontera;
2. declarar si es refactorización o cambio funcional;
3. empezar por pruebas de caracterización cuando el comportamiento no esté
   explícitamente fijado;
4. usar reexports temporales para mantener compatibilidad de imports;
5. evitar editar migraciones ya aplicadas;
6. actualizar este mapa cuando cambie propiedad o dirección de dependencias;
7. documentar cualquier prueba omitida y su requisito externo real.

No se aceptan movimientos masivos por nombre, cambios simultáneos de esquema y
estructura, ni abstracciones `shared` creadas sólo por una similitud nominal.

## 8. Próximo corte recomendado

La siguiente entrega debe completar la **Fase 1** y no mover todavía código
productivo. Su alcance concreto:

1. inventario automatizado de AGT-002;
2. caracterización completa del paquete y onboarding que se extraerán en la
   Fase 2.

Con esa red de seguridad, la primera reubicación será pequeña, reversible y
medible.

En paralelo, sin mezclar código ni autoridad, puede prepararse la revisión de
contratos del piloto histórico. Crear la misión, consultar fuentes públicas o
programar recurrencia requiere aprobación separada.
