# AGT-003 — mapa del subsistema Vig-IA Comercial

**Identidad:** `AGT-003`

**Dominio:** oportunidades comerciales privadas

**Owner funcional:** Dirección Comercial

**Estado funcional en CRM:** operativo parcial

**Estado institucional:** contrato P3.3 futuro; el runtime no se reactiva
automáticamente

## 1. Propósito y frontera

AGT-003 prioriza el pipeline comercial privado, explica señales y prepara apoyo
para el siguiente contacto. Sus resultados requieren revisión humana.

El código, las rutas, los contratos locales y los artefactos operativos
existentes no constituyen activación institucional. P3.3 requiere un gate y una
autorización propios; ninguna migración, variable heredada, reinicio o despliegue
del CRM puede reactivar el runtime automáticamente.

AGT-003 puede:

- leer oportunidades dentro del scope resuelto por el servidor;
- calcular prioridades y señales determinísticas;
- generar un preanálisis de apoyo;
- preparar un borrador editable de seguimiento;
- registrar runs y feedback de la capacidad de generación gobernada.

AGT-003 no puede:

- cambiar oportunidades o responsables por decisión propia;
- enviar correos, WhatsApp u otra comunicación;
- aprobar ventas o comprometer a la organización;
- ampliar el scope indicado por la sesión y las asignaciones del CRM;
- absorber el radar o análisis de licitaciones de AGT-002.

## 2. Capacidades actuales

| Capacidad | Contrato | Estado |
| --- | --- | --- |
| `agt003.priorities.read` | `contracts/agents/AGT-003/v1/` | V1 inmutable, read-only |
| `agt003.opportunity-copilot.preview` | `contracts/agents/AGT-003/v2-draft/` | draft inactivo; revisión humana |
| `agt003.opportunity-preflight.preview` | `contracts/agents/AGT-003/v2-draft/` | draft inactivo; no persiste resultado |
| `agt003.lead-deep-analysis` | `src/vigia/lead-analysis.js` (contrato 1.0, `LEAD_ANALYSIS_OUTPUT_SCHEMA`) | premio por perfil completo; lee sólo la web pública del cliente (HTTPS, su dominio); revisión humana; registro inmutable `psi_agt003_lead_analyses` (migración 114); tope mensual `AGT003_LEAD_ANALYSIS_MONTHLY_MAX` (30) |

Las rutas visibles actuales son:

- `GET /api/vigia/priorities`;
- `POST /api/vigia/copilot/preflight`;
- `POST /api/vigia/copilot/generate`;
- `POST /api/vigia/copilot/feedback`.

El backend resuelve autenticación, permiso, ownership y contexto fresco; el
cliente no puede elegir libremente el owner ni suministrar un snapshot de
autoridad.

## 3. Inventario de implementación

En el corte revisado existen:

- 24 módulos de servidor `agt003-*`/`agent-agt003-*` en la raíz;
- 15 archivos de presentación y estado bajo `src/vigia/`;
- 21 archivos de contratos y fixtures bajo `contracts/agents/AGT-003/`;
- 48 archivos de prueba nombrados `*agt003*`, más 13 pruebas heredadas
  `vigia-*` incluidas en el gate del subsistema;
- dos migraciones propias (`043` y `044`) y un rollback;
- cinco artefactos operativos del bridge bajo `ops/agt003-claude-bridge/`;
- cuatro endpoints compuestos tanto en `server/index.js` como en
  `api/[...path].js`.

Mapa de responsabilidades:

| Área | Implementación actual |
| --- | --- |
| Priorización determinística | `vigia-engine.js`, `agt003-priorities-service.js` |
| Contratos externos | `contracts/agents/AGT-003/` |
| Copiloto | `agt003-copilot-*` |
| Preflight | `agt003-preflight-*` |
| Proveedor y bridge | `agt003-claude-*`, `ops/agt003-claude-bridge/` |
| Persistencia y auditoría funcional | `agt003-copilot-persistence.js`, migración `043` |
| API | `server/index.js`, `api/[...path].js` |
| UI | `src/vigia/`, montaje en `src/main.tsx` |
| Integración sintética institucional | `agent-agt003-synthetic-responder.js` |

Los conteos son una fotografía para dimensionar la separación; no son una
allowlist permanente.

## 4. Dependencias permitidas

```text
domain  <-  application  <-  infrastructure  <-  interfaces
 reglas      casos de uso     DB/proveedor       HTTP/UI/ops
```

- El dominio no importa Express, Supabase, variables de entorno ni clientes de
  proveedor.
- La aplicación coordina prioridades, preflight y generación mediante puertos.
- Infraestructura implementa persistencia, bridge y proveedor.
- Las interfaces traducen HTTP, operaciones y UI hacia casos de uso.
- El shell del CRM puede consumir la interfaz pública de AGT-003; AGT-003 no
  importa el shell.
- El código licitatorio de AGT-002 no importa utilidades con identidad AGT-003.

## 5. Acoplamientos conocidos

1. `agt003-copilot-runtime.js` admite temporalmente `wireProtocol=agt002` y
   reutiliza variables `AGT002_*`. Esto permite compartir infraestructura de
   bridge, pero mezcla identidad operativa y debe sustituirse por un contrato
   neutral o un bridge propio antes de declarar separación completa.
2. Dos módulos de AGT-002 importan `redactAgt003CopilotText` desde
   `agt003-copilot-input.js`. El redactor puede extraerse a `shared` sólo con
   nombre neutral, contrato puro y pruebas de ambos consumidores.
3. Las rutas AGT-003 siguen embebidas en dos backends espejo. La extracción
   debe producir un router compartido antes de retirar la comprobación de
   paridad.
4. La UI vive bajo `src/vigia/`, pero montaje, navegación y parte del estado
   permanecen en `src/main.tsx`.
5. El contrato V2 continúa como `draft_inactive`; su runtime en el CRM no lo
   convierte automáticamente en contrato institucional activo.

Estos acoplamientos se registran para eliminarlos gradualmente; no justifican
un movimiento masivo de archivos.

## 6. Invariantes

1. La prioridad es explicable, determinística y ordenada por score, valor e ID.
2. Toda salida declara revisión humana y no ejecuta acciones externas.
3. El scope se calcula server-side a partir de identidad y asignaciones.
4. El preflight no escribe en las tablas de runs, oportunidades o
   interacciones.
5. La generación persiste runs inmutables y feedback append-only según su
   contrato vigente.
6. Un error, contexto inválido, proveedor no configurado o respuesta fuera de
   contrato falla cerrado.
7. AGT-003 y AGT-002 conservan identidades, fuentes, permisos, contratos,
   auditoría y evaluaciones separados.
8. `server/index.js` y `api/[...path].js` permanecen en paridad mientras ambos
   sean entrypoints activos.

## 7. Verificación del subsistema

El gate focalizado incluye tanto el nombre institucional nuevo como las pruebas
heredadas que aún usan “Vig-IA”:

```bash
corepack pnpm run test:agt003
corepack pnpm run check:backend-parity
corepack pnpm run build
```

CI ejecuta estos tres comandos en el workflow `agt003-boundary`. Las pruebas
transversales que cubren conjuntamente catálogo, delegación o contratos de
plataforma siguen perteneciendo a la suite completa y no se consideran
propiedad exclusiva de AGT-003.

## 8. Documentos de entrada

1. [Hoja de ruta de separación](./refactor-roadmap.md).
2. [Mapa del ecosistema](../architecture/agent-ecosystem-map.md).
3. [Assessment AGT-002/003](../architecture/2026-07-22-agt-002-agt-003-integration-readiness-assessment.md).
4. [ADR de ownership contractual](../architecture/ADR-2026-07-22-siio-agents-contract-ownership-and-canonical-catalog.md).
5. [Diseño del copiloto](../superpowers/specs/2026-07-28-vigia-commercial-presales-copilot-design.md).
6. [Diseño de preflight](../superpowers/specs/2026-08-26-agt003-preflight-alerts-design.md).
7. [Operación del bridge](../../ops/agt003-claude-bridge/README.md).

## 9. Decisión estructural vigente

Hasta completar la red de seguridad y caracterización:

- no se moverán en bloque los módulos `agt003-*` de la raíz;
- los cambios estructurales no alterarán simultáneamente contratos o reglas;
- toda extracción conservará temporalmente los imports públicos mediante
  reexports;
- la primera extracción será el dominio puro de prioridades, no el backend o
  la UI completos.
