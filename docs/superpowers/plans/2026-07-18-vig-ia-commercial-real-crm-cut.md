# CRM real gobernado → Visual Gerencial Comercial → Vig-IA Comercial — Plan de implementación
## Estado verificado

El plan se construyó sobre `main` en `174a4eb` y cubre exclusivamente:

**CRM real gobernado (lectura) → `#/dashboard2` / `ManagerDashboardV2` existente → Vig-IA Comercial `AGT-003`.**

Este documento planifica el corte; no autoriza despliegue ni escritura productiva.

### Verificación de realidad

| Contexto / requisito | Verificado en disco |
|---|---|
| Base actual | `main` en `174a4eb fix(auth): share Supabase browser client (#17)` |
| Dashboard existente | `src/main.tsx:1389` contiene `ManagerDashboardV2` con filtros `period`, `q`, `owner`, `regional`, `stage`, `service`, `onlyActive`. |
| Ruta vigente | `#/dashboard2` renderiza `ManagerDashboardV2` (`src/main.tsx:449`); no se debe crear ruta nueva. |
| Vig-IA / AGT-003 | `src/siioAgents.ts:57-71`: `AGT-003`, “Vig-IA Comercial”, solo lectura, siguiente gate de umbrales con Dirección Comercial. |
| Autorización | `server/index.js:getAuthContext` deriva perfil, áreas y permisos server-side desde Auth UUID; `access-control.js` aplica módulos y alcance. |
| Minimización actual | `/api/bootstrap` filtra respuesta según módulo y alcance (`filterBootstrapForProfile`), pero carga un payload amplio y Vig-IA hoy reutiliza `CentinelAssistant` del cliente. |
| Vig-IA actual | `src/main.tsx:2132-2423`: intérprete de texto/quick actions; mezcla CRM, metas y licitaciones. No satisface aún el corte comercial gobernado. |
| Datos CRM disponibles | `/api/bootstrap` lee `v_psi_sales_opportunity_enriched`, etapas, perfiles, metas y KPIs existentes. Para este corte basta un subconjunto minimizado de oportunidades CRM. |
| Migración 021 | Solo fija permisos explícitos de módulos. El permiso `modulo_vig_ia` ya existe. |
| Pruebas existentes | Hay harnesses sintéticos HTTP/Supabase para autorización (`tests/siio-area-scope-blocker.test.mjs`, `tests/auth-context-access.test.mjs`) y pruebas de build/esbuild. |

**Baseline ejecutado:** pasaron `backend-module-guards`, `manager-dashboard-v2-static`, `centinel-static`, `siio-area-scope-blocker` y `npm run build`. Único aviso: bundle JS de 644 kB supera el umbral de Vite; no bloquea este corte, pero la extracción de Vig-IA evita seguir inflando `main.tsx`.

---

## Plan ejecutable

> **Para ejecución:** aplicar TDD estricto; cada cambio productivo se escribe después de un test RED observado. No implementar ni desplegar hasta cerrar el Gate 0.

**Objetivo:** entregar Vig-IA Comercial AGT-003 de lectura gobernada sobre CRM real existente, con reglas determinísticas auditables y navegación desde prioridades hacia el `ManagerDashboardV2` vigente filtrado.

**No incluido:** Licitaciones, SECOP, SharePoint, F3A, SIIO financiero/nómina, IA generativa, runtime institucional, envío de comunicaciones, persistencia de feedback, creación/edición de oportunidades, cambios de responsables, metas o interacciones.

## Gate 0 — acuerdo obligatorio con Dirección Comercial, antes de código

**Entregable de negocio:** aprobación escrita versionada, por ejemplo `docs/decisions/2026-07-18-vig-ia-comercial-gate.md`, firmada/confirmada por Dirección Comercial.

Debe cerrar exactamente:

1. **Dataset mínimo aprobado**
   - `id`, `owner_id`, `owner_name`, `company_name`, `stage_code`, `stage_name`, `stage_order`, `service_type_code`, `service_type_name`, `regional_nombre`;
   - `offer_value`, `weighted_pipeline_value`;
   - `next_action_at`, `last_interaction_at`, `updated_at`, `created_at`, `expected_close_date`;
   - catálogo de etapas y probabilidades, solo si la regla aprobada lo consume.
   - Excluir correo, teléfono, notas, texto de interacciones, datos personales y campos no necesarios.

2. **Fuente y fecha**
   - Fuente declarada: `CRM-F1 / v_psi_sales_opportunity_enriched`.
   - Fecha de generación server-side (`generated_at`) y fecha por evidencia (`last_interaction_at`, o fallback explícito a `updated_at` / `created_at`).
   - Definición de “sin datos”, “sin fecha” y “dato incompleto”.

3. **Mappings**
   - Etapas activas/terminales.
   - Etapas críticas oficiales.
   - Mapeo de servicio y regional.
   - Definición oficial de oportunidad activa.

4. **Fórmulas y umbrales**
   - Pesos determinísticos, niveles Alto/Medio/Bajo, días de estancamiento, criterio de cierre vencido/cercano y criterio de alto valor.
   - No codificar números definitivos antes de la aprobación.

5. **Feedback humano sin escritura**
   - Confirmar que V1 usa estado local de sesión: `Pendiente`, `Revisada`, `Útil`, `No útil`.
   - No se persiste, no altera score, no modifica CRM y se pierde al recargar.
   - Cada tarjeta declara: “requiere validación humana; no ejecuta acciones”.

**Stop condition:** sin esta aprobación no se crea endpoint, UI, regla ni migración.

---

## Contratos propuestos

### `GET /api/vig-ia/commercial-snapshot`

Autenticación: Bearer Supabase obligatorio.

Autorización server-side:
1. `getAuthContext(req)`.
2. `requireModuleAction(profile, 'vigia')`.
3. Scope CRM derivado exclusivamente de `psi_profile_area_assignments`, usando la lógica existente `canReadCrmRow`.
4. Sin parámetros de usuario capaces de ampliar alcance.
5. Denegar `401/403` **antes** de consultar datos CRM si falta sesión, módulo o alcance.

Respuesta minimizada:

```ts
type VigIaCommercialSnapshot = {
  contract_version: 'vigia-commercial-v1';
  generated_at: string;
  source: {
    id: 'CRM-F1';
    label: 'CRM comercial';
    as_of: string | null;
    evidence_policy:
      'last_interaction_at|updated_at|created_at; next_action_at se conserva como evidencia de agenda';
  };
  scope: {
    kind: 'global' | 'assigned';
    visible_owner_count: number;
    visible_opportunity_count: number;
  };
  stages: Array<{
    code: string;
    name: string;
    stage_order: number;
    close_probability: number;
  }>;
  opportunities: Array<{
    id: string;
    owner_id: string | null;
    owner_name: string | null;
    company_name: string;
    stage_code: string;
    stage_name: string;
    stage_order: number;
    service_type_code: string | null;
    service_type_name: string | null;
    regional_nombre: string | null;
    offer_value: number;
    weighted_pipeline_value: number;
    next_action_at: string | null;
    last_interaction_at: string | null;
    updated_at: string;
    created_at: string;
    expected_close_date: string | null;
  }>;
};
```

No incluye `interactions`, correos, teléfonos, notas, motivos de pérdida, campos de edición ni payload de licitaciones.

### Regla determinística compartida

Nuevo contrato puro, sin I/O:

```ts
type VigIaRuleConfig = {
  stale_warning_days: number;
  stale_critical_days: number;
  high_value_threshold: number;
  critical_stage_codes: string[];
  score_weights: {
    missing_next_action: number;
    overdue_next_action: number;
    stale_warning: number;
    stale_critical: number;
    critical_stage: number;
    overdue_expected_close: number;
    high_value: number;
  };
  thresholds: { high: number; medium: number };
};

type VigIaPriority = {
  opportunity_id: string;
  risk_level: 'alto' | 'medio' | 'bajo';
  score: number;
  reasons: Array<{
    code: string;
    label: string;
    evidence: string;
    observed_at: string | null;
    source_id: 'CRM-F1';
  }>;
  suggested_action: string;
  evidence: {
    source_id: 'CRM-F1';
    as_of: string | null;
    last_activity_at: string | null;
    next_action_at: string | null;
  };
};
```

Las fórmulas se definen por Gate 0. El motor no llama modelos, no usa texto libre y no modifica datos.

---

## Tareas TDD y commits

### 1. Contrato y motor determinístico aislado

**Crear**
- `src/vigia/types.ts`
- `src/vigia/rules.ts`
- `tests/fixtures/vig-ia-commercial.fixture.mjs`
- `tests/vig-ia-commercial-rules.test.mjs`

**Modificar**
- Ningún componente aún.

**RED**
- Fixture sintético con: sin agenda, acción vencida, acción hoy, 6/11 días sin actividad, etapa crítica, cierre estimado vencido, alto valor, fila terminal y fila con fechas ausentes.
- Testear:
  - oportunidad terminal no es priorizable;
  - cada señal agrega razón/evidencia/fuente;
  - nivel y score son deterministas;
  - la fecha de evidencia usa `last_interaction_at`, luego `updated_at`, luego `created_at`;
  - nunca se emite una cifra, fecha o fuente inventada;
  - “sin datos” no se traduce a cero.

**GREEN**
- Implementar funciones puras:
  - `deriveActivityDate`
  - `deriveVigIaSignals`
  - `scoreVigIaOpportunity`
  - `buildVigIaPriorities`
  - `matchesVigIaPriorityFilter`

**Comandos**
```bash
node tests/vig-ia-commercial-rules.test.mjs
npm run build
```

**Commit**
```bash
git add src/vigia tests/fixtures/vig-ia-commercial.fixture.mjs tests/vig-ia-commercial-rules.test.mjs
git commit -m "feat(vig-ia): add deterministic commercial priority rules"
```

---

### 2. Endpoint server-side de lectura minimizada y alcance

**Crear**
- `tests/vig-ia-commercial-api-scope.test.mjs`

**Modificar**
- `server/index.js`
- `api/[...path].js` solo si requiere mantener la paridad existente del adaptador serverless.
- `tests/backend-module-guards.test.mjs`

**RED**
Usar un Supabase HTTP falso, siguiendo el patrón de `tests/siio-area-scope-blocker.test.mjs`.

Casos obligatorios:
1. sin Bearer → `401`, cero lecturas CRM;
2. perfil sin `modulo_vig_ia` → `403`, cero lecturas CRM;
3. `comercial` con permiso forjado → `403`, por techo de rol;
4. `director` con subárea comercial → solo oportunidades de dueños dentro de asignación;
5. `gerencia`/`admin` con `modulo_vig_ia` → alcance global;
6. respuesta no contiene `owner_email`, `notes`, interacciones ni campos fuera del allow-list;
7. endpoint permite solo `GET`; `POST`, `PUT`, `PATCH`, `DELETE` dan `404/405`;
8. `HTTP_ACTION_MATRIX` y `MODULE_ENDPOINT_ACTIONS` incluyen el endpoint/familia `vigia`.

**GREEN**
- Añadir `vigia: ACTIONS.MODULE_VIGIA_VIEW` a `MODULE_ENDPOINT_ACTIONS`.
- Añadir `GET /api/vig-ia/commercial-snapshot`.
- Reutilizar `getAuthContext`, `canReadCrmRow`, `assignmentsByProfile` y la misma semántica de alcance del CRM.
- Consultar `v_psi_sales_opportunity_enriched` con una cadena `select` mínima, no `*`.
- Devolver solo oportunidades visibles y catálogo de etapas necesario para las reglas.
- Agregar `generated_at` y `source` desde el servidor.
- No insertar auditoría, no guardar feedback, no hacer RPC de escritura.

**Comandos**
```bash
node tests/vig-ia-commercial-api-scope.test.mjs
node tests/backend-module-guards.test.mjs
node tests/auth-context-access.test.mjs
npm run build
```

**Commit**
```bash
git add server/index.js api/[...path].js tests/vig-ia-commercial-api-scope.test.mjs tests/backend-module-guards.test.mjs
git commit -m "feat(vig-ia): add scoped read-only commercial snapshot"
```

---

### 3. Sustituir la superficie Vig-IA por AGT-003 comercial

**Crear**
- `src/vigia/VigIaCommercialView.tsx`
- `src/vigia/vigia.css`
- `tests/vig-ia-commercial-view.test.mjs`

**Modificar**
- `src/main.tsx`
- `src/styles.css` únicamente para importar/componer estilos si el patrón vigente lo necesita.
- `tests/centinel-static.test.mjs` → renombrar o reemplazar por prueba funcional de Vig-IA Comercial.

**RED**
Verificar:
- `#/vig-ia` continúa como única ruta;
- renderiza `VigIaCommercialView`, no una ruta/página paralela;
- no hace fetch a `/api/tenders`;
- muestra fuente, corte/fecha, alcance, evidencia y estado de carga/error/reintento;
- solo muestra etiquetas de recomendación y “requiere validación humana”;
- contiene feedback local `Revisada`, `Útil`, `No útil`, sin `fetch`/mutación;
- muestra estado vacío honesto;
- no contiene botones de editar, reasignar, enviar, crear seguimiento o guardar.

**GREEN**
- Reemplazar el render actual de `CentinelAssistant` en la rama `centinel` por `VigIaCommercialView`.
- Eliminar del flujo `#/vig-ia` toda carga, copy y acciones de licitaciones.
- Cargar exclusivamente `/api/vig-ia/commercial-snapshot`.
- Calcular tarjetas/lista usando `buildVigIaPriorities`.
- Mostrar por prioridad:
  - nivel, score y recomendación;
  - razones;
  - fecha observada;
  - fuente `CRM-F1`;
  - evidencia de agenda/actividad;
  - CTA de lectura “Ver en Dashboard” y “Ver oportunidad”.
- El feedback se conserva solo en `useState`/`sessionStorage` si Dirección Comercial lo aprueba; no se persiste al backend.

**Comandos**
```bash
node tests/vig-ia-commercial-view.test.mjs
node tests/centinel-static.test.mjs
npm run build
```

**Commit**
```bash
git add src/main.tsx src/vigia tests/vig-ia-commercial-view.test.mjs tests/centinel-static.test.mjs
git commit -m "feat(vig-ia): render governed commercial priority view"
```

---

### 4. Hacer que prioridades filtren el dashboard existente

**Crear**
- `src/vigia/dashboardFilterLink.ts`
- `tests/vig-ia-dashboard-filter-link.test.mjs`

**Modificar**
- `src/main.tsx` (`parseHash`, tipo `Route`, `ManagerDashboardV2`)
- `tests/manager-dashboard-v2-static.test.mjs`

**RED**
Casos:
1. `#/dashboard2?priority=vigia_risk` conserva `#/dashboard2` y filtra `ManagerDashboardV2`; no crea ruta nueva.
2. Parámetros `owner`, `regional`, `service`, `stage`, `period`, `only_active` se normalizan contra catálogos válidos.
3. Parámetros desconocidos o manipulados fallan cerrados a filtro vacío, no amplían datos.
4. “Ver en Dashboard” de una prioridad Vig-IA conserva la misma vista y aplica sus filtros.
5. Los cuatro botones de “Prioridades gerenciales de hoy” dejan de ser solo scroll: actualizan el filtro/estado del dashboard vigente.
6. Los KPIs no se duplican: la prioridad solo reduce/ordena el dataset existente.
7. “Limpiar” elimina también el filtro de prioridad.

**GREEN**
- Introducir serialización/deserialización explícita de filtros de dashboard.
- Añadir un único campo de filtro local `priority`, sin KPI ni panel duplicado.
- Aplicar `matchesVigIaPriorityFilter` al dataset de oportunidades de `ManagerDashboardV2`.
- Mantener semántica actual: filtros de etapa/“Pipeline activo” reducen tablas de pipeline, mientras desempeño aprobado conserva la regla existente.
- Los CTA de Vig-IA generan hash a `#/dashboard2?...`; no inventan una URL “Vig-IA resultados”.
- Para un registro individual, `#/detail/:id` conserva la autorización existente del backend.

**Comandos**
```bash
node tests/vig-ia-dashboard-filter-link.test.mjs
node tests/manager-dashboard-v2-static.test.mjs
node tests/navigation-dashboard-default-static.test.mjs
npm run build
```

**Commit**
```bash
git add src/main.tsx src/vigia/dashboardFilterLink.ts tests/vig-ia-dashboard-filter-link.test.mjs tests/manager-dashboard-v2-static.test.mjs
git commit -m "feat(dashboard): filter existing view from Vig-IA priorities"
```

---

### 5. Regresión de gobierno, no escritura y QA

**Crear**
- `tests/vig-ia-no-write-regression.test.mjs`
- `docs/qa/vig-ia-comercial-qa.md`

**Modificar**
- `README.md` solo si se requiere registrar el endpoint y comando de prueba, sin divulgar secretos.

**Pruebas**
- búsqueda estática contra `src/vigia/**`, `server/index.js` y `api/[...path].js` para asegurar:
  - no `insert`, `update`, `upsert`, `delete`, RPC de mutación, ni métodos HTTP de escritura asociados a Vig-IA;
  - no referencias a `tenders`, `SharePoint`, `F3A`, runtime institucional;
  - no uso de `SUPABASE_SERVICE_ROLE_KEY` en cliente;
  - no exposición de campos prohibidos en el contrato.
- QA manual autenticado con datos reales:
  - admin/gerencia con permiso;
  - director con subárea comercial;
  - usuario sin módulo;
  - usuario sin área;
  - CRM vacío;
  - oportunidad sin fechas;
  - prioridad → dashboard filtrado → detalle autorizado.
- Verificar visualmente desktop y móvil que no haya duplicación de KPIs.

**Comandos de cierre**
```bash
node tests/vig-ia-commercial-rules.test.mjs
node tests/vig-ia-commercial-api-scope.test.mjs
node tests/vig-ia-commercial-view.test.mjs
node tests/vig-ia-dashboard-filter-link.test.mjs
node tests/vig-ia-no-write-regression.test.mjs
for test in tests/*.test.mjs; do node "$test"; done
npm run build
git diff --check
git status --short
```

**Commit**
```bash
git add tests/vig-ia-no-write-regression.test.mjs docs/qa/vig-ia-comercial-qa.md README.md
git commit -m "test(vig-ia): lock read-only governance regression coverage"
```

---

## Decisión de migración

**No crear migración posterior a `021`.**

Justificación:
- `021_explicit_user_modules.sql` ya contiene `modulo_vig_ia`.
- El corte consume vistas/tablas CRM existentes en lectura.
- Feedback humano es local/no persistente por la restricción explícita de **cero escritura**.
- Crear tabla de feedback, auditoría de recomendaciones, configuración editable de umbrales o historización requeriría escritura y queda fuera de este corte.

Una migración `022` solo sería válida en un corte posterior si Dirección Comercial aprueba explícitamente persistir configuración/versiones o feedback auditado y se redefine “cero escritura”.

## Gates de entrega

1. **Gate 0:** Dirección Comercial aprueba dataset, fórmulas, mappings, umbrales y feedback local.
2. **Gate seguridad:** autorización y minimización pasan con fixtures sintéticos; denegaciones ocurren antes de lecturas CRM.
3. **Gate producto:** Vig-IA muestra fuente, fecha, evidencia y recomendación humana; no mezcla licitaciones.
4. **Gate UX:** cada prioridad lleva a `#/dashboard2` existente con filtro aplicado; sin nueva vista ni KPI duplicado.
5. **Gate técnico:** suite completa, TypeScript, build y `git diff --check` pasan.
6. **Gate publicación:** revisión humana de diff y autorización explícita antes de cualquier deploy.

## Incidencias / hallazgos

- Vig-IA actual todavía contiene flujo de licitaciones y una consulta manual basada en texto; debe quedar fuera del flujo `#/vig-ia` de este corte.
- `ManagerDashboardV2` ya calcula señales similares, pero sus cards de prioridad actualmente hacen scroll; el plan las convierte en filtros de la vista existente, sin crear otro dashboard.
- El bundle actual supera el warning de 500 kB de Vite; no bloquea el alcance, aunque extraer Vig-IA de `main.tsx` es la decisión correcta para no aumentar el acoplamiento.