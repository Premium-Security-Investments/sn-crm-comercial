# AGT-003 — hoja de ruta de separación

**Estado:** propuesta activa

**Fecha base:** 2026-10-02

**Índice:** [`README.md`](./README.md)

## 1. Resultado buscado

Convertir AGT-003 en un subsistema reconocible dentro del monorepo, con dominio,
casos de uso, infraestructura e interfaces separados, sin cambiar su
comportamiento durante los movimientos.

La separación lógica precede a una eventual extracción a otro repositorio. No
hay evidencia suficiente para recomendar hoy esa extracción física: AGT-003
depende de identidad, scope, oportunidades, interacciones, navegación y base de
datos del CRM.

## 2. Estructura objetivo

```text
agt003/
  domain/
    priorities/
    copilot/
    preflight/
  application/
    priorities/
    copilot/
    preflight/
  infrastructure/
    persistence/
    providers/
    bridge/
  interfaces/
    http/
    workers/
  index.js

src/vigia/agt003/
  api/
  components/
  model/
  presentation/
```

Contratos, migraciones y operación mantienen sus ubicaciones especializadas:

- `contracts/agents/AGT-003/`;
- `supabase/migrations/` y `supabase/rollbacks/`;
- `ops/agt003-claude-bridge/`;
- `docs/agt003/`.

Los módulos actuales de la raíz funcionan como reexports temporales mientras
se migran consumidores.

## 3. Matriz de propiedad

| Capacidad | AGT-003 posee | CRM/shared posee |
| --- | --- | --- |
| Oportunidad | lectura minimizada para análisis | entidad, ciclo comercial y escritura humana |
| Prioridad | score, señales, orden y explicación | consulta autorizada y scope de filas |
| Copiloto | contratos, policy, validación y propuesta | datos frescos, permisos y registro humano final |
| Preflight | análisis efímero y límites de costo | contexto de la oportunidad y sesión |
| Persistencia | runs, claims y feedback propios | conexión, migraciones y operación de base |
| Proveedor | puerto, schema y presupuesto | secretos y entorno de despliegue |
| UI | componentes y presentación propios | navegación, layout y componentes neutrales |
| Identidad institucional | nombre/capabilities funcionales | Plataforma Agentes, cuando se autorice integrar |

## 4. Fases

### Fase 0 — mapa y gate focalizado

**Estado:** completada por esta entrega.

- índice único del subsistema;
- inventario inicial e invariantes;
- comando `test:agt003` que incluye pruebas `*agt003*` y `vigia-*`;
- workflow independiente con suite focalizada, paridad y build;
- mapa de responsabilidades entre los tres repositorios.

Gate: documentación enlazada, pruebas focalizadas, paridad de backend y build.

### Fase 1 — inventario mecánico de frontera

- generar un inventario versionado de módulos, exports, consumidores, rutas,
  tablas, RPC, variables de entorno, contratos y pruebas;
- clasificar pruebas transversales que mencionan AGT-003 sin asignarlas
  artificialmente al subsistema;
- congelar el API público actual y los errores observables;
- agregar una prueba de arquitectura que impida nuevos imports AGT-003 ->
  AGT-002.

Gate: cualquier import desconocido o nueva dependencia cruzada falla CI.

### Fase 2 — dominio puro de prioridades

- mover `vigia-engine.js` y la proyección/validación de prioridades a
  `agt003/domain/priorities/`;
- separar consulta de filas del cálculo determinístico;
- conservar reexports desde las rutas actuales;
- mantener exactamente score, señales, orden, fechas y explicación.

Gate: fixtures V1, determinismo, zonas horarias, scope y endpoint sin cambios.

### Fase 3 — contratos y casos de uso

- agrupar contratos, inputs y engines de copiloto/preflight en dominio y
  aplicación;
- hacer explícitos puertos de contexto, conteo de cuota, reloj y persistencia;
- mantener preflight efímero y generación auditable como capacidades distintas;
- decidir el ciclo de promoción o retiro del contrato `v2-draft`.

Gate: schemas, prompt injection, idempotencia, concurrencia, timeout, cuota y
revisión humana.

### Fase 4 — infraestructura propia y neutralización compartida

- mover persistencia, cliente Claude, bridge, auth, nonce y logging a
  infraestructura;
- reemplazar el fallback `AGT003_* -> AGT002_*` por configuración neutral o
  explícita de AGT-003;
- extraer el redactor usado por AGT-002 a un paquete shared neutral, con pruebas
  de ambos consumidores; no mantener el nombre AGT-003 en una dependencia
  compartida;
- conservar entrypoints de `ops/` como adaptadores delgados.

Gate: aislamiento de protocolo, replay, firma, secretos, logs, compatibilidad y
canary offline.

### Fase 5 — API delgada

- extraer las cuatro rutas a `agt003/interfaces/http/`;
- compartir la composición entre Express y serverless;
- dejar en los entrypoints sólo middleware general y montaje;
- eliminar duplicación únicamente después de comprobar paridad.

Gate: métodos, autorización, ownership, cuerpos cerrados, errores y contratos
HTTP sin cambios.

### Fase 6 — UI por feature

- agrupar componentes, presentación, filtros y estado bajo
  `src/vigia/agt003/`;
- extraer de `src/main.tsx` el estado y montaje específicos;
- conservar en `src/vigia/` sólo identidad visible o utilidades realmente
  compartidas y neutrales.

Gate: build, DOM, foco, acción única, fechas, filtros, deep-links y QA visual.

### Fase 7 — integración institucional

Esta fase no empieza hasta materializar el mapa institucional descrito en el
[mapa del ecosistema](../architecture/agent-ecosystem-map.md).

Corresponde al futuro contrato P3.3. La reorganización interna, la presencia de
un runtime histórico o el despliegue del CRM no activan ni reactivan AGT-003.

- exigir el gobierno de Plataforma Agentes y la identidad separada de AGT-003;
- registrar AGT-003 inactivo y declarar capabilities exactas;
- reconciliar/adaptar envelopes de ejecución;
- enlazar el run institucional con el run funcional;
- ejecutar primero `agt003.priorities.read` con datos sintéticos y sin secretos
  productivos.

Gate: pruebas consumer/provider, doble autorización, replay, abstención,
auditoría enlazada y aprobación explícita separada.

### Fase 8 — consolidación

- migrar consumidores a rutas canónicas;
- retirar reexports sólo con cero usos demostrados;
- actualizar runbooks y contratos afectados;
- evaluar extracción de repositorio únicamente con métricas de acoplamiento,
  ownership operativo y despliegue independientes.

Gate: suite completa, pruebas AGT-003, paridad, build y canary acordado.

## 5. Reglas de ejecución

Cada cambio debe:

1. cubrir una capacidad o frontera pequeña;
2. declarar si es refactor o cambio funcional;
3. comenzar con caracterización cuando el contrato no sea explícito;
4. conservar imports mediante reexports temporales;
5. no reescribir migraciones aplicadas ni contratos inmutables;
6. no crear un paquete `shared` sin contrato neutral y segundo consumidor;
7. registrar pruebas omitidas y el requisito externo concreto.

## 6. Próximo corte recomendado

Completar la Fase 1 y preparar la Fase 2:

1. inventario automatizado de la frontera;
2. prueba de arquitectura para detener nuevos acoplamientos con AGT-002;
3. pruebas de caracterización de todos los exports de prioridades;
4. propuesta de movimientos y reexports para esa vertical pura.

Este corte aumenta seguridad sin tocar runtime productivo, contratos ni datos.
