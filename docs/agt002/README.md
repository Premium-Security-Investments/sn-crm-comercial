# AGT-002 — mapa del subsistema

**Estado:** documento vivo y punto de entrada canónico

**Estado institucional:** `INITIAL`, R1; contrato P3.2 futuro

**Última revisión estructural:** 2026-10-03

## 1. Propósito

AGT-002 es el subsistema de análisis gobernado de licitaciones dentro de
`sn-crm-comercial`. El CRM es la plataforma anfitriona: aporta identidad,
autorización, oportunidades, documentos, persistencia compartida y superficies
de usuario. AGT-002 consume esas capacidades para descubrir procesos, preparar
evidencia, ejecutar análisis, presentar resultados revisables y conservar su
trazabilidad.

Este índice define la frontera del subsistema y el lugar donde buscar la
autoridad de cada decisión. No sustituye los contratos ejecutables, las
migraciones ni los runbooks.

El desarrollo funcional existente en este repositorio no promueve el estado
institucional de AGT-002 ni materializa P3.2. Ese contrato futuro requiere su
propio gate, versión, paquete de integración y autorización.

El estado operativo aportado al 2026-10-02 y su reconciliación local están en
[el registro de situación](./status-2026-10-02.md).

## 2. Límite funcional

### Pertenece a AGT-002

- radar, priorización y preanálisis de oportunidades;
- construcción de contexto y evidencia gobernada;
- contratos, validación y ejecución del análisis;
- integración con proveedores de inferencia y el bridge de Hetzner;
- persistencia, reintentos, reanálisis y observabilidad del agente;
- workbench, revisión accionable, conocimiento y proyecciones para revisión;
- gates de incorporación de procesos y controles de autoridad del agente.

### Permanece en el CRM anfitrión

- autenticación, usuarios, roles y autorización general;
- registro canónico de oportunidades y ciclo de vida comercial;
- almacenamiento documental genérico y extracción compartida;
- shell de la aplicación, navegación y componentes de propósito general;
- decisiones humanas de cumplimiento, GO/NO-GO, aprobación, firma y envío.

AGT-002 puede producir evidencia, brechas y propuestas. No puede tomar ni
simular las decisiones humanas indicadas arriba. La política completa está en
[la política de revisión humana](../architecture/agt002-human-review-policy.md).

## 3. Autoridad: dónde vive la verdad

Cuando dos artefactos discrepen, se usa este orden:

| Tema | Autoridad primaria | Papel de la documentación |
| --- | --- | --- |
| Forma de entradas y salidas | [`contracts/agents/AGT-002/`](../../contracts/agents/AGT-002/) y validadores de runtime | Explica intención y uso |
| Tablas, funciones, grants y RLS | [`supabase/migrations/`](../../supabase/migrations/) en orden de versión | Registra operación y verificación |
| Proceso habilitado | `agt002-integral-manifest-source.js`, paquete válido y allowlist server-owned | Describe el procedimiento |
| Comportamiento del runtime | Código productivo y pruebas vigentes | Conserva decisiones y límites |
| Decisiones de negocio | Usuario humano autorizado | El agente sólo prepara información |
| Operación y recuperación | [`ops/`](../../ops/) y runbook aplicable | Define pasos seguros y evidencia |

Los documentos bajo `plans/`, `specs/`, `evidence/` y `verification/` son
registros fechados. Son evidencia histórica valiosa, pero no representan por
sí solos el estado actual. Este archivo es el índice; el código ejecutable
sigue siendo la autoridad sobre el comportamiento presente.

## 4. Mapa de capacidades

El flujo principal se lee de izquierda a derecha:

```text
Radar y descubrimiento
        ↓
Ingreso documental y contexto gobernado
        ↓
Contratos + motor de análisis
        ↓
Persistencia, reintentos y reanálisis
        ↓
Proyección para revisión humana
        ↓
Workbench, conocimiento y seguimiento
```

Las responsabilidades actuales se agrupan así:

| Área | Responsabilidad | Ubicaciones actuales representativas |
| --- | --- | --- |
| Radar | escaneo, visibilidad, delta, recibos, preanálisis y aprendizaje | `agt002-radar-*`, `ops/agt002-radar-*`, `contracts/agt002-radar-reliability/` |
| Contexto y evidencia | dossier, documentos, chunks, retrieval, worksets, registros y manifiestos | `agt002-company-*`, `agt002-document-*`, `agt002-governed-*`, `agt002-retrieval-*` |
| Dominio de análisis | políticas, contratos, inputs, categorías, ejes de decisión y compatibilidad | `agt002-*-contract.js`, `agt002-*-input.js`, `agt002-integral-*`, `agt002-decision-*` |
| Ejecución | preview, análisis integral, lotes, proveedor y bridge | `agt002-preview-*`, `agt002-integral-analysis-*`, `agt002-claude-client.js`, `agt002-hetzner-bridge-*` |
| Persistencia y recuperación | claims, jobs, reintentos, reanálisis, checkpoints y SLO | `agt002-*-persistence.js`, `agt002-reanalysis-*`, `agt002-analysis-checkpoints.js`, `agt002-runtime-slo.js` |
| Revisión y conocimiento | revisión accionable, briefs, workbench y publicación de conocimiento | `agt002-actionable-review-*`, `agt002-stakeholder-brief*`, `agt002-workbench-*`, `agt002-knowledge-*` |
| Control y seguridad | identidad, autoridad, gates, observación de superficies y drift | `agt002-control-plane-*`, `agt002-f0*`, `contracts/agt002-phase01/` |
| INITIAL | primera corrida, paquete, autorización, workflow, job y persistencia propia | worktree aislado `feat/agt002-initial-analysis-p0`; no fusionado ni desplegado |
| REANALYSIS/R1 | versiones sucesoras, checkpoints y delta futuro | `agt002-reanalysis-*`, `agt002-analysis-checkpoints.js`; R1 aún es diseño |
| Minería histórica | corpus de procesos cerrados y familias metodológicas | plan aislado; no implementado ni programado |
| Integración HTTP | rutas y composición con el backend del CRM | `server/index.js` y su espejo `api/[...path].js` |
| Integración UI | análisis integral, dossier, worksets, revisión y polling | `src/tenders/` y `src/main.tsx` |
| Datos y base de datos | manifiestos gobernados, corpus, tablas, RPC, grants y rollback | `data/agt002/`, `supabase/migrations/`, `supabase/rollbacks/` |

Los prefijos de la tabla son un mapa de la distribución actual, no la
estructura objetivo. La reorganización propuesta está en
[la hoja de ruta](./refactor-roadmap.md).

## 5. Entradas de arquitectura y operación

Leer primero:

1. [Arquitectura reusable para licitaciones](../architecture/agt002-reusable-licitacion-architecture.md).
2. [Estado reconciliado al 2026-10-02](./status-2026-10-02.md).
3. [Frontera de minería histórica](./historical-requirements-boundary.md).
4. [Alcance de auditoría read-only de Supabase](./supabase-readonly-audit-scope.md).
5. [Política de revisión humana](../architecture/agt002-human-review-policy.md).
6. [Convención de paquete por proceso](../architecture/agt002-process-package-convention.md).
7. [Frontera con Plataforma Agentes](./platform-agents-integration.md).
8. [Onboarding de un proceso](../runbooks/agt002-process-onboarding-gate.md).
9. [Análisis de una licitación nueva](../runbooks/agt002-new-tender-analysis.md).
10. [Checklist de observabilidad](../runbooks/agt002-observability-checklist.md).

Operación por capacidad:

- radar: [runbook del pipeline](../runbooks/agt002-radar-pipeline.md);
- análisis V3: [canary integral](../runbooks/agt002-integral-v3-canary.md);
- bridge: [capacidad de esfuerzo](../runbooks/agt002-hetzner-bridge-effort-capability.md);
- reversión: [rollback de un proceso](../runbooks/agt002-process-rollback.md);
- controles de Fase 01: [`phase01/`](./phase01/).

## 6. Invariantes que toda reorganización debe preservar

1. **Fallo cerrado.** Un proceso desconocido, no aprobado, incompleto o no
   habilitado no llega al proveedor ni hereda datos de otro proceso.
2. **Identidad exacta.** El producto vivo usa `(opportunity_id, proceso)`;
   minería histórica usa `process_key`/`portfolio_id` y nunca inventa una
   oportunidad para reutilizar la primera clave.
3. **Autoridad humana.** El análisis no declara cumplimiento, GO/NO-GO,
   aprobación, firma, envío ni presentación.
4. **Evidencia trazable.** Una conclusión debe conservar sus fuentes, versión
   de contexto y estado de revisión.
5. **Sin autodiscovery habilitante.** La presencia de archivos en
   `data/agt002/processes/` no autoriza un proceso.
6. **Compatibilidad del backend.** `server/index.js` y `api/[...path].js`
   deben continuar en paridad mientras existan como espejos.
7. **Migraciones inmutables.** Las migraciones aplicadas no se reescriben; una
   corrección se expresa en una migración posterior y, cuando corresponda, su
   rollback.
8. **Refactor sin cambio semántico.** Mover una capacidad exige primero pruebas
   que congelen su comportamiento observable.

## 7. Protocolo mínimo para cambios

Antes de modificar una capacidad:

1. identificar su área en el mapa anterior y su autoridad primaria;
2. localizar pruebas, rutas HTTP, tablas/RPC y consumidores UI relacionados;
3. separar explícitamente refactorización de cambio funcional;
4. mantener un adaptador de compatibilidad si cambia una ruta de importación;
5. ejecutar las pruebas focalizadas y los gates transversales.

Comandos base:

```bash
corepack pnpm test
corepack pnpm run test:agt002
corepack pnpm run check:backend-parity
corepack pnpm run build
```

Según el área también aplican:

```bash
corepack pnpm run test:agt002-runtime
corepack pnpm run test:agt002-f0
corepack pnpm run test:agt002-m2-synthetic-vertical
corepack pnpm run check:agt002-grants
corepack pnpm run check:agt002-drift
```

## 8. Decisión estructural vigente

Hasta completar la fase de seguridad mecánica de la hoja de ruta:

- no se moverán en bloque los módulos `agt002-*` de la raíz;
- no se combinarán cambios de rutas con cambios de reglas de negocio;
- cada extracción conservará un shim temporal en la ubicación anterior;
- la primera extracción será una vertical pequeña, pura y con pruebas, no el
  backend monolítico completo.

Esto permite ordenar el proyecto de manera incremental y reversible mientras
el CRM continúa operativo.

## 9. Dependencia transversal: Plataforma Agentes

Plataforma Agentes será la autoridad futura para identidad institucional,
configuración, policy, admisión y recibos comunes. No reemplaza el dominio ni el
runtime funcional de AGT-002.

En el corte revisado `plataforma-agentes@1b609c47`, AGT-002 aún no está
integrado: sólo tiene namespace reservado y está expresamente fuera del alcance
de Fase 1. La relación, divergencia contractual y gates necesarios se documentan
en [la frontera AGT-002 ↔ Plataforma Agentes](./platform-agents-integration.md).
