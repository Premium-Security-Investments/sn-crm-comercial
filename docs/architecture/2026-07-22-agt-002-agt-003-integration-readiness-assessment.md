# Levantamiento verificable de AGT-003 y AGT-002 para futura integración con Plataforma Agentes

- **Fecha de corte:** 2026-07-22
- **Repositorio:** `Premium-Security-Investments/sn-crm-comercial`
- **Base de código:** `main@c3304b4` (`c3304b4126a441523aa7bb0a6e7dc288ec4eab7b`)
- **Estado del repositorio al iniciar:** limpio, sincronizado con `origin/main`
**Alcance:** levantamiento y definición de gates; **no implementa integración, endpoints, migraciones, permisos, identidades técnicas ni despliegues**.

---

## 1. Objetivo y criterio de clasificación

Este documento determina qué existe realmente para:

- **AGT-003 — Vig-IA Comercial**, motor canónico de priorización del pipeline privado.
- **AGT-002 — Copiloto de Licitaciones**, agente canónico para oportunidades públicas y licitaciones.

Se usan tres estados:

| Estado | Criterio |
|---|---|
| **Implementado** | Existe una ruta ejecutable en `main`, una migración/tabla/RPC consumida por el sistema, una UI conectada o una prueba automatizada que verifica el comportamiento. |
| **Diseñado** | Existe en catálogo, decisión, especificación o matriz, pero no hay un recorrido ejecutable completo que materialice la capacidad. |
| **Pendiente** | No existe artefacto operativo suficiente o falta un gate indispensable para exponerlo de forma segura a Plataforma Agentes. |

Una descripción en especificaciones o en el catálogo no se considera prueba de ejecución. Las migraciones se consideran implementadas **en el repositorio**; su presencia en producción solo se afirma cuando existe evidencia de QA/deploy documentada. No se hizo ninguna consulta mutante ni inspección directa con credenciales de producción.

---

## 2. Resultado ejecutivo

| Dimensión | AGT-003 — Vig-IA Comercial | AGT-002 — Copiloto de Licitaciones |
|---|---|---|
| Estado del catálogo | `operativo_parcial` | `operativo_parcial` |
| Núcleo funcional | **Implementado**: motor determinístico, versionado y read-only | **Implementado parcialmente**: radar, scoring, documentos, GO/NO GO determinístico, expediente y seguimiento |
| Contrato agregado actual | **Sí**: `GET /api/vigia/priorities` | **No**: capacidades repartidas en múltiples endpoints de lectura y mutación |
| Identidad técnica de agente | **Pendiente** | **Pendiente** |
| Autenticación actual | Usuario humano Supabase + `psi_sales_profiles` | Usuario humano Supabase + `psi_sales_profiles` |
| Scopes actuales | Pipeline completo para `admin/gerencia`; por asignaciones comerciales para otros perfiles autorizados | Predomina permiso de módulo `licitaciones`; algunas mutaciones tienen validación adicional en RPC |
| Acciones de producción | Ninguna; endpoint GET-only y motor sin escrituras | Sí existen escrituras humanas: sincronizar, seguimiento, convertir, documentos, expediente y descarte |
| Revisión humana | Declarada y visible en cada prioridad | Declarada; algunos gates están en UI/RPC, pero no uniformemente expresados por acción HTTP |
| Auditoría | Evidencia calculada en respuesta; no existe registro de ejecución del agente | Eventos inmutables de seguimiento e interacciones documentales; no existe ejecución unificada con `agent_id` |
| Preparación para Plataforma Agentes | **Alta para piloto read-only**, condicionada a identidad técnica, esquema y auditoría de ejecución | **Media para piloto read-only**; baja para mutaciones hasta separar acciones, aprobaciones y scopes |

### Conclusión ejecutiva

1. **AGT-003 puede ser el primer contrato funcional que consuma Plataforma Agentes**, siempre en modo read-only y sin duplicar su scoring.
2. **AGT-002 no debe exponerse como una única capacidad amplia.** Primero debe dividirse en capacidades de lectura/recomendación y acciones humanas aprobadas.
3. Ninguno de los dos agentes puede autenticarse hoy como identidad técnica real: la autorización reconoce el concepto `identity_type: agent`, pero `getAuthContext` solo construye perfiles humanos desde `psi_sales_profiles`.
4. No existe aún un `run_id`, `agent_id`, `policy_version`, listado de fuentes y actor/disparador persistidos por cada ejecución.
5. Las interfaces futuras deben consumir estos motores de SIIO; no deben reimplementar reglas en Plataforma Agentes, Hermes o Copilot.

**Precisión de runtime:** en ambos casos, “agente” describe la identidad institucional y el motor funcional. No existe todavía un runtime/orquestador invocable con identidad técnica AGT. AGT-003 es actualmente motor + endpoint + UI; AGT-002 es catálogo + subsistema CRM distribuido.

---

# 3. AGT-003 — Vig-IA Comercial

## 3.1 Identidad institucional

### Implementado

El manifest local de compatibilidad de SIIO actualmente define:

- ID: `AGT-003`.
- Nombre: `Vig-IA Comercial`.
- Propietario: Dirección Comercial.
- Frentes: F1 y F5.
- Acciones permitidas: leer pipeline, detectar estancamientos, priorizar seguimiento y explicar señales.
- Acciones prohibidas: modificar oportunidades, cambiar responsables, aprobar ventas y enviar comunicaciones externas.
- Revisión humana obligatoria y `can_write_production: false`.

**Evidencia:** `src/siioAgents.ts:57-71`; validación de unicidad/gobierno en `src/siioAgents.ts:75-87`.

Este manifest no es la fuente institucional canónica. Debe validarse en un gate posterior contra el registro institucional de Plataforma Agentes antes de sincronizar o activar capacidades.

### Diseñado, no materializado completamente

El catálogo declara como fuentes `CRM-F1`, `Interacciones comerciales` y `Metas comerciales` (`src/siioAgents.ts:62-64`). El contrato actual no consulta la tabla de metas. La interacción comercial solo aparece indirectamente mediante `last_interaction_at` en la vista enriquecida; no se procesa contenido de interacciones.

### Pendiente

- Registro canónico persistido/API de catálogo compartido con Plataforma Agentes.
- Identidad técnica ejecutable `AGT-003`.
- Propietario humano nominal, responsables de aprobación y SLA del agente.
- Versionado coordinado entre catálogo, motor y contratos externos.

## 3.2 Motor, reglas y salidas

### Implementado

El motor es determinístico y auditable:

- Versión de política: `gate0-v1.0`.
- Fuente canónica: `CRM-F1`.
- Estancamiento preventivo: 14 días.
- Estancamiento crítico: 30 días.
- Cierre cercano: 14 días.
- Alto valor: COP 75.000.000.
- Prioridad alta: score >= 60; media >= 30.
- Etapas terminales excluidas: aprobado, descartado, perdido.
- Etapas críticas: sustentación y negociación.

**Evidencia:** `vigia-engine.js:3-14`.

Se calculan señales con código, etiqueta, puntos y evidencia para:

- próxima acción faltante, vencida o inválida;
- fechas de actividad inválidas;
- estancamiento preventivo/crítico;
- etapa crítica;
- cierre esperado vencido, cercano o inválido;
- alto valor o valor faltante;
- regional faltante.

Cada prioridad incluye:

- score y nivel;
- `signal_codes` y objetos `signals`;
- recomendación y explicación;
- evidencia de actividad, inactividad y fechas;
- fuente y fecha de corte por fila.

El resultado se ordena por score, valor e ID para asegurar determinismo.

**Evidencia:** `vigia-engine.js:59-67`, `69-83`, `86-140`.

### Restricción implementada

El motor establece expresamente `Requiere validación humana; no ejecuta acciones.` y no contiene operaciones de inserción, actualización, borrado ni RPC.

**Evidencia:** `vigia-engine.js:127-138`; pruebas `tests/vigia-endpoint-static.test.mjs` y `tests/vigia-engine.test.mjs`.

## 3.3 Contrato HTTP actual

### Implementado

| Elemento | Contrato actual |
|---|---|
| Método/ruta | `GET /api/vigia/priorities` |
| Autenticación | Bearer Supabase de usuario humano activo |
| Autorización de módulo | `modulo_alertas_comerciales` **o** `modulo_vig_ia` |
| Scope de datos | Global para `admin/gerencia`; por asignaciones comerciales y reglas CRM para otros perfiles |
| Escritura | Ninguna |
| Métodos distintos de GET | `405 {"error":"Método no permitido."}` |
| Fuente principal | `v_psi_sales_opportunity_enriched` |
| Fuente complementaria | `psi_sales_opportunities(id, customer_segment)` |
| Paginación interna | 1.000 filas; owners en lotes de 100 |
| Política en respuesta | versión, `read_only: true`, `human_review_required: true` |

**Evidencia:**

- guard consolidado: `server/index.js:112-115`;
- scope por owner/asignación: `server/index.js:1779-1794`;
- carga paginada: `server/index.js:1796-1810`;
- segmento de cliente: `server/index.js:1813-1832`;
- handler y respuesta: `server/index.js:1835-1864`;
- paridad serverless: `api/[...path].js` y `scripts/check_backend_parity.mjs`.

### Entrada

El endpoint no acepta body ni parámetros funcionales. El alcance se deriva del perfil autenticado; el consumidor no puede solicitar un owner más amplio.

### Salida

```text
{
  generated_at,
  source: { id, label, as_of },
  policy: { version, read_only, human_review_required },
  totals: { source_rows, visible_active, prioritized, high, medium, low },
  priorities: [
    {
      campos CRM permitidos,
      customer_segment,
      score,
      level,
      signal_codes,
      signals: [{ code, label, points, evidence }],
      recommendation,
      explanation,
      evidence,
      source
    }
  ]
}
```

Los campos CRM seleccionados están limitados a identificadores, owner, empresa, etapa, tipo de servicio, regional, valores, fechas y última interacción; no incluye email/teléfono/contacto.

**Evidencia:** `server/index.js:565`, `server/index.js:1848-1861`.

### Diseñado

La decisión Gate 0 define contrato read-only, evidencia, revisión humana, fuente y fecha de corte, y excluye IA generativa/runtime institucional.

**Evidencia:** `docs/decisions/2026-07-18-vig-ia-comercial-gate.md`; `docs/superpowers/plans/2026-07-18-vig-ia-commercial-real-crm-cut.md:31-35`.

### Pendiente para integración

- Esquema machine-readable versionado (OpenAPI/JSON Schema); hoy el contrato se valida por código y pruebas estáticas.
- Namespace/versión externa estable para Plataforma Agentes.
- Límite máximo y cursor contractual para consumidores externos; la paginación actual es interna.
- Semántica formal de errores (`code`, `retryable`, `correlation_id`).
- `ETag`/idempotencia de lectura o hash de evidencia.
- Política de minimización/retención para respuestas multicanal.

## 3.4 Fuentes y linaje

### Implementado

| Fuente | Uso | Campos relevantes |
|---|---|---|
| `v_psi_sales_opportunity_enriched` | Entrada principal | owner, empresa, etapa, servicio, regional, valores, próxima acción, última interacción, actualización, creación, cierre esperado |
| `psi_sales_opportunities` | Enriquecimiento mínimo | `id`, `customer_segment` |
| `psi_profile_area_assignments` | Resolución de scope | profile, área y subárea comercial |
| `psi_sales_profiles` | Contexto de identidad humana | rol, estado, áreas y permisos derivados |

La consulta de `customer_segment` se hace explícitamente sobre la tabla base; no se asume que la vista enriquecida contenga nuevas columnas.

### Diseñado

- Metas comerciales como posible fuente de contexto.
- Contenido detallado de interacciones como fuente explicativa.
- Catálogo externo de fuentes con IDs institucionales y clasificación de sensibilidad.

### Pendiente

- Registrar por ejecución el conjunto exacto de filas/fuentes y su fecha de corte.
- Hash o snapshot reproducible de evidencia.
- Política de frescura y degradación cuando la vista o una fuente no esté disponible.
- Equivalencia formal de `CRM-F1` con el catálogo de fuentes de Plataforma Agentes.
- Recuperar/documentar el DDL, RLS y linaje de `v_psi_sales_opportunity_enriched`: este checkout permite verificar la allowlist y la consulta, pero no contiene la definición originaria completa de la vista ni de todas sus tablas base.

## 3.5 Permisos y restricciones

### Implementado

- Permisos de módulo explícitos en `module-access.js:3-12`.
- Comerciales pueden recibir `modulo_alertas_comerciales`, no `modulo_vig_ia`; el endpoint consolidado acepta cualquiera de los dos (`module-access.js:17-24`, `server/index.js:112-115`).
- Gerencia y administración tienen scope global del pipeline; otros perfiles requieren asignación comercial y lectura autorizada por owner (`server/index.js:48-50`, `1779-1794`).
- Fail-closed: ausencia de scope comercial produce 403.
- Solo lectura y 405 para métodos no permitidos.

### Restricciones que deben conservarse

- No modificar oportunidades, responsables, metas o interacciones.
- No enviar comunicaciones.
- No convertir una recomendación en acción automática.
- No ampliar el scope solicitado por una interfaz.
- No exponer contactos o datos innecesarios.
- Toda explicación debe señalar regla, evidencia, oportunidad, owner y fecha.

### Pendiente

- Autenticación de servicio/agente separada de cuentas humanas.
- Capacidad `agt003.priorities.read` con scope explícito por área/owner.
- Delegación verificable: agente + solicitante humano + canal.
- Auditoría persistente de allow/deny y respuesta filtrada.

## 3.6 Interfaces y consumidores

### Implementado

- UI React `src/vigia/VigiaCommercial.tsx`.
- Filtros/deep-links gobernados en `src/vigia/priority-filters.js`, `src/vigia/priority-filters.d.ts`, `src/vigia/dashboard-link-filters.js` y `src/vigia/dashboard-link-filters.d.ts`.
- Superficie consolidada **Prioridades Comerciales**, impulsada por Vig-IA, sin motor paralelo de alertas.
- Navegación al dashboard comercial preservando filtros permitidos y fallando cerrado para parámetros desconocidos.

### Pendiente

- Adaptador oficial para Plataforma Agentes.
- Consumidores Hermes/Copilot con paridad de políticas.
- Contrato de presentación multicanal que no reinterprete score ni señales.
- Persistencia gobernada del feedback humano. Los estados `Revisada`, `Útil` y `No útil` viven actualmente en `useState` de la UI y se pierden al recargar; no son auditoría de AGT-003.

## 3.7 Pruebas verificadas

Ejecutadas el 2026-07-22:

- `tests/vigia-api-scope.integration.test.mjs` — scope autenticado.
- `tests/vigia-dashboard-link-filters.test.mjs` — deep-links.
- `tests/vigia-endpoint-static.test.mjs` — contrato read-only y seguridad estática.
- `tests/vigia-engine.test.mjs` — determinismo/reglas.
- `tests/vigia-ui-static.test.mjs` — UI.
- `npm run check:siio-agents` — catálogo válido.
- `npm run check:nav-permissions` — matriz de navegación válida.
- `npm run check:backend-parity` — Express/serverless en paridad.

Todas pasaron.

Smoke de producción sin sesión:

- `GET /api/vigia/priorities` -> 401.
- `POST /api/vigia/priorities` -> 405.

La prueba autenticada documentada del Gate 0 está en `docs/qa/vigia-commercial-gate0-verification.md`.

---

# 4. AGT-002 — Copiloto de Licitaciones

## 4.1 Identidad institucional

### Implementado

El manifest local de compatibilidad de SIIO actualmente define:

- ID: `AGT-002`.
- Propietario: Dirección de Licitaciones.
- Propósito: priorizar procesos públicos, analizar documentos y preparar expediente controlado.
- Fuentes: SECOP I, SECOP II, TVEC, ESU y perfil corporativo.
- Acciones permitidas: priorizar, analizar, preparar GO/NO GO, borradores y checklist.
- Prohibiciones: presentar, descartar sin confirmación, convertir sin confirmación y firmar.
- Revisión humana obligatoria; sin escritura autónoma de producción.

**Evidencia:** `src/siioAgents.ts:40-54`.

Este manifest no es la fuente institucional canónica. Debe validarse en un gate posterior contra el registro institucional de Plataforma Agentes antes de sincronizar o activar capacidades.

### Aclaración crítica

El subsistema de Licitaciones sí realiza escrituras de producción cuando actúa un usuario humano autorizado. `can_write_production: false` debe interpretarse como restricción del **agente**, no del módulo humano.

### Pendiente

- Un runtime/API agregado que se identifique como AGT-002.
- Separar capacidades de recomendación de las acciones humanas.
- Vincular cada ejecución a `AGT-002`, versión de política, fuentes y solicitante.

## 4.2 Capacidades funcionales

### Implementado

#### Radar y priorización

- Consulta SECOP I/II, TVEC y ESU.
- Normaliza procesos a un modelo común.
- Calcula score, sección, razones y riesgos.
- Deduplica y conserva estado interno.
- Devuelve diagnóstico por fuente.
- Tolera fallos parciales mediante `Promise.allSettled`.
- Sincroniza resultados a `psi_public_tenders`.
- Registra cada sincronización en `psi_tender_radar_runs` con actor, modo, conteos, resumen y errores.

**Evidencia:** `server/index.js:592-624`, `640-1185`, `1273-1295`; `supabase/migrations/005_public_tenders_radar.sql:4-53`; UI `src/tenders/TenderRadarView.tsx:42-118`.

#### Seguimiento

- Cola por estado, responsable y semáforo.
- Próxima acción, vencimiento, bloqueo, nota e historial.
- Control de concurrencia optimista con `expected_tracking_updated_at`.
- Eventos inmutables de seguimiento.

**Evidencia:** `src/tenders/TenderTrackingView.tsx:67-137`; `tender-tracking-rpc.js`; migraciones `supabase/migrations/017_tender_tracking_workflow.sql` y `supabase/migrations/018_tender_tracking_rpc.sql`.

#### Conversión a oportunidad

- Conversión atómica e idempotente mediante RPC.
- Unicidad por `external_source`.
- Sincroniza licitación, oportunidad y evento convertido.
- UI exige confirmación antes del POST.
- Intenta importar documentos oficiales y reporta éxito/fallo sin ocultarlo.

**Evidencia:** `src/tenders/TenderRadarView.tsx:82-94`; `tender-tracking-rpc.js`; `supabase/migrations/018_tender_tracking_rpc.sql:269-383`; `server/index.js:2290-2343`.

#### Análisis documental y GO/NO GO

- Importa documentos de SECOP II y ESU.
- Extrae texto de PDF/DOCX/ZIP y otros formatos soportados.
- Detecta pliego, anexos técnicos, adendas, formatos, valores, SMMLV y años.
- Cruza señales con perfil corporativo.
- Genera decisión preliminar, riesgo, semáforo, matriz, bloqueadores, siguiente acción y resumen de comité.
- El análisis es **determinístico por reglas**, no IA generativa.

**Evidencia:** `server/index.js:1970-2080`, `2176-2270` y continuación del importador.

#### Expediente y preparación de oferta

- Consolida estado documental, GO/NO GO, checklist, riesgo y pendientes humanos.
- Genera metadatos de documentos/borradores y estructura de carpetas.
- Marca explícitamente experiencia, financieros, póliza, propuesta económica y revisión de borradores como intervención humana.
- Registra notas de preparación.

**Evidencia:** `server/index.js:2099-2165`, `2359-2417`; `src/tenders/TenderDossiersView.tsx:18-56`.

#### Descarte

- Conserva sincronía entre oportunidad, licitación, interacción y evento.
- Usa control de concurrencia e idempotencia en RPC.
- Registra motivo y actor.

**Evidencia:** `server/index.js:2345-2357`, `2535-2543`; `supabase/migrations/018_tender_tracking_rpc.sql:385-448`, supersedida en permisos por migración 020.

### Diseñado o simulado, no integrado completamente

- **SharePoint/OneDrive:** se genera estructura y estado `pendiente_configurar_integracion`; no se crea carpeta ni se sincronizan archivos.
- **Borradores:** el sistema crea descriptores/checklist de artefactos esperados; no se verificó generación binaria real de DOCX/XLSX para todos los ítems.
- **GO/NO GO institucional:** existe recomendación determinística, pero no una separación completa entre recomendar, aprobar y ejecutar en todos los endpoints.
- **Gate hacia preparación:** `POST /api/tender-offer-preparation-approve` puede crear el paquete después de validar que la oportunidad sea de licitación, pero no comprueba una entidad/versionado de GO/NO GO aprobado ni exige `licitaciones.go_no_go.approve`.
- **Agente conversacional:** el texto “notas para el asistente” existe, pero no hay runtime conversacional AGT-002.

### Pendiente

- Presentación externa de ofertas — debe continuar prohibida.
- Firma, envío, publicación y compromiso de PSI — deben continuar prohibidos.
- Integración real con SharePoint/Graph.
- Workflow explícito de solicitud/aprobación de GO/NO GO.
- Workflow explícito de solicitud/aprobación de descarte y conversión para Plataforma Agentes.
- Versionamiento centralizado de scoring y dictamen; hoy las reglas están embebidas en `server/index.js`.

## 4.3 Fuentes

### Implementado

| Fuente | Endpoint/origen | Uso |
|---|---|---|
| SECOP II | datos.gov.co `p6dx-8zbt` | Radar y resolución exacta de proceso |
| SECOP I | datos.gov.co `f789-7hwg` | Radar |
| Documentos SECOP II | datos.gov.co `dmgg-8hin` + URL oficial | Importación documental |
| TVEC | `operaciones.colombiacompra.gov.co/eventos-cotizacion-tvec` | Eventos de cotización de agregaciones relevantes |
| ESU directo | `esucontratacion.com/procesos/index` | Procesos y documentos |
| ESU respaldo | datos.gov.co por entidad | Tolerancia a indisponibilidad directa |
| Perfil corporativo | `psi_company_procurement_profile` | Cruce RUP/capacidades/restricciones |
| Expediente | Storage `tender-documents` + `psi_sales_interactions` | Documentos, análisis y preparación |

**Evidencia:** `server/index.js:592-624`, `1131-1164`, `2189-2247`; migraciones `supabase/migrations/012_company_procurement_profile.sql` y `supabase/migrations/013_tender_search_profiles.sql`.

### Restricciones de fuente implementadas

- Diagnóstico individual por fuente.
- Selección de documentos prioritarios; máximo 40 por importación.
- Documento individual máximo 50 MB.
- URLs firmadas de Storage por una hora.
- Importación SECOP II requiere `noticeUID` y coincidencia exacta de URL.
- Importación ESU requiere ruta de proceso válida.

### Pendiente

- Catálogo común de fuentes de Plataforma Agentes con propietario, clasificación, retención, SLA y términos de uso.
- Fecha de corte reproducible por fuente y snapshot/hash de evidencia.
- Control explícito de cuotas, backoff y caché institucional.
- Política frente a cambios de estructura HTML de TVEC/ESU.
- Verificación live automatizada de conectores.

## 4.4 Contratos HTTP y de datos actuales

### Lecturas implementadas

| Ruta | Resultado principal |
|---|---|
| `GET /api/tenders` | Radar: procesos, score, razones, riesgos, diagnósticos |
| `GET /api/tender-tracking` | Cola de seguimiento |
| `GET /api/tender-tracking-events?id=` | Historial inmutable |
| `GET /api/tender-search-profiles` | Perfiles de búsqueda del usuario |
| `GET /api/tender-company-profile` | Perfil corporativo |
| `GET /api/tender-dossiers` | Resumen paginado de expedientes |
| `GET /api/tender-documents?opportunity_id=` | Documentos y último análisis |
| `GET /api/tender-offer-preparation?opportunity_id=` | Preparación y notas |

### Mutaciones humanas implementadas

| Acción | Rutas principales | Efecto |
|---|---|---|
| Sincronizar | `POST /api/tenders/refresh`, alias `POST /api/tender-refresh` | Consulta fuentes y upsert en Radar |
| Seguimiento | `POST /api/tender-tracking-update`, `POST /api/tender-tracking-transition` | Cambia cola y registra evento |
| Estado Radar | `PATCH /api/tenders/:id/status`, alias `PATCH /api/tender-status` | Cambia estado interno |
| Convertir | `POST /api/tenders/convert`, alias `POST /api/tender-convert` | Crea/vincula oportunidad atómicamente |
| Perfil/filtros | POST/DELETE perfiles; PUT y uploads de perfil corporativo | Persistencia de configuración/documentos |
| Documentos | upload, analyze, import | Storage + interacciones + dictamen |
| Preparar oferta | approve/note | Persiste paquete y notas como interacciones |
| Descartar | `POST /api/tender-opportunity-discard` | Descarta oportunidad y sincroniza Radar |

**Evidencia:** inventario en `server/index.js:1393-1595`, `2419-2543`; tipos de cliente en `src/tenders/types.ts`; cliente en `src/tenders/api.ts`.

### Brecha contractual crítica

No existe un contrato agregado del tipo `GET /api/agents/AGT-002/...`. Tampoco hay OpenAPI/JSON Schema. La interfaz está acoplada a rutas del CRM y varios payloads se describen solo mediante tipos TypeScript y pruebas estáticas.

## 4.5 Persistencia y auditoría

### Implementado

| Artefacto | Propósito |
|---|---|
| `psi_public_tenders` | Radar y estado interno |
| `psi_tender_radar_runs` | Corridas de sincronización, actor, conteos, resumen y errores; no equivale a auditoría de ejecuciones AGT-002 |
| `psi_tender_tracking_events` | Eventos inmutables de seguimiento, conversión y descarte |
| `psi_tender_search_profiles` | Búsquedas guardadas por usuario |
| `psi_company_procurement_profile` | Ficha/RUP corporativo |
| `psi_sales_opportunities` | Oportunidades convertidas |
| `psi_sales_interactions` | Documentos, análisis, errores, preparación y notas |
| Storage `tender-documents` | Archivos del expediente |

Migraciones relevantes: `005`, `012`, `013`, `017`, `018`, `019`, `020`, `021`.

La verificación funcional de separación documenta migraciones 017/018 aplicadas y smoke autenticado en su corte: `docs/qa/tender-functional-separation/verification.md`. La migración 018 conserva en su cabecera la advertencia histórica “Prepared only”; este levantamiento toma el QA posterior como evidencia documental, pero no revalidó directamente el esquema de producción con credenciales.

### Pendiente


- Tabla/evento de ejecución de agente con `agent_id`, `run_id`, versión de política, canal, actor/disparador, fuentes, costo y estado.
- Correlación única entre una ejecución AGT-002, sus lecturas, recomendación y aprobación humana posterior.
- Registro de denies y de scopes aplicados.

- Versionado inmutable del dictamen; hoy se guardan análisis en interacciones, pero no hay contrato global de versión de reglas.

## 4.6 Permisos y restricciones

### Implementado

- Permiso de módulo: `licitaciones` (`module-access.js:10`).
- Elegible para admin, gerencia, director y comercial; no para colaborador/junta (`module-access.js:17-24`).
- El catálogo fino contiene acciones como:
  - `licitaciones.view`;
  - `licitaciones.sync`;
  - `licitaciones.discard.propose/approve`;
  - `licitaciones.go_no_go.recommend/approve`.
- Un agente conceptual solo puede recomendar con `technical_authorized: true`; no puede aprobar.

**Evidencia:** `access-control.js:22-29`, `77-88`, `188-190`, `288-300`; `tests/access-control.test.mjs:168-181`, `204-215`.

Las mutaciones críticas de tracking/conversión/descarte usan RPC de service role con validaciones de actor, estado, idempotencia y concurrencia. La migración 020 sustituye la excepción histórica por correo por verificación de permiso de licitaciones.

**Evidencia:** `supabase/migrations/018_tender_tracking_rpc.sql`; reemplazo en `supabase/migrations/020_profile_access_admin_rpc.sql:400-423`.

### Brecha implementada vs diseñada

Aunque existe el catálogo fino, la mayoría de rutas HTTP sigue usando `canViewTenders`/permiso de módulo como guard amplio. `HTTP_ACTION_MATRIX` solo registra `GET /api/tenders` para Licitaciones. Por tanto, el control por acción está **diseñado y probado como librería**, pero no aplicado uniformemente a cada endpoint.

Adicionalmente, el análisis guarda una recomendación GO/NO GO dentro de una interacción JSON, pero no existe una decisión aprobada, versionada y persistida como gate. La ruta de “aprobar preparación” registra `approved_at/approved_by` del usuario actual sin comprobar un GO/NO GO aprobado previamente. Esto impide tratar el botón o el nombre de la ruta como una aprobación institucional suficiente.

**Evidencia:**

- `server/index.js:57-93`;
- `server/index.js:647`;
- handlers `server/index.js:1393-1595`, `2419-2543`;
- brecha ya descrita en `docs/superpowers/specs/siio-permission-matrix.md:390-395`.

### Restricciones que deben conservarse

- AGT-002 puede leer, priorizar y recomendar.
- No puede aprobar GO/NO GO, descartar, convertir, preparar oficialmente, presentar, firmar o enviar.
- Toda mutación requiere actor humano autenticado, permiso de acción, confirmación explícita y auditoría.
- Licitaciones públicas no comparte scopes, fuentes ni contratos con AGT-003.

### Pendiente antes de cualquier mutación desde Plataforma Agentes

1. Guard por acción en cada endpoint, no solo por módulo.
2. Separar `recommend`, `request`, `approve` y `execute`.
3. Token de confirmación/approval record, no solo `window.confirm` o etiqueta de botón.
4. Idempotency key y `correlation_id` de extremo a extremo.
5. Scope por expediente/fuente y clasificación documental.
6. Pruebas HTTP negativas 401/403 por cada acción y perfil.
7. Prohibición técnica explícita para identidades de agente en toda aprobación/ejecución.

## 4.7 Pruebas verificadas

Ejecutadas el 2026-07-22:

- análisis automático;
- autoimport/descarte;
- aislamiento de perfil corporativo;
- conversión atómica;
- contrato de expedientes y aislamiento de fallos;
- filtros compactos;
- separación funcional de vistas;
- GO/NO GO;
- preparación de oferta;
- visibilidad de convertidas;
- estado de rutas;
- aislamiento de perfiles de búsqueda;
- contrato y migración de tracking/RPC;
- integración PGlite de migración;
- Radar y deduplicación.

Archivos ejecutados: todos los `tests/tender-*.test.mjs`. Todos pasaron.

También pasaron:

- `npm run check:siio-agents`;
- `npm run check:nav-permissions`;
- `npm run check:backend-parity`.

Smoke de producción sin sesión:

- `GET /api/tenders` -> 401.
- `POST /api/tender-refresh` -> 401.
- `POST /api/tender-convert` -> 401.

### Cobertura pendiente

- E2E autenticado por rol para **cada** endpoint mutante.
- Pruebas de identidad técnica real; hoy no puede construirse desde `getAuthContext`.
- Pruebas de expiración/revocación de aprobación.
- Pruebas de source drift para TVEC/ESU.
- Pruebas de SharePoint reales cuando exista integración.
- Prueba de no presentación/no envío externo.

---

# 5. Brechas comunes frente a Plataforma Agentes

## 5.1 Identidad y autenticación

### Implementado

La librería de autorización reconoce perfiles `identity_type: agent` y falla cerrado ante identidades inválidas (`access-control.js:69-88`). Esa identidad conceptual solo tiene capacidades específicas de análisis/recomendación cuando recibe `technical_authorized`; no existe una acción que conceda a un agente técnico lectura de Vig-IA/AGT-003.

### Pendiente

`getAuthContext` exige Bearer de Supabase, busca un usuario y construye un perfil humano desde `psi_sales_profiles`; no carga `identity_type`, `agent_id` ni identidad de servicio (`server/index.js:390-429`).

Se necesita:

- identidad técnica compartida;
- `agent_id` obligatorio;
- credencial de servicio rotatable;
- delegación de usuario/canal;
- scopes server-derived;
- revocación y expiración;
- separación de workspace/ambiente.

## 5.2 Contrato de ejecución común

### Pendiente

Para ambos agentes, cada ejecución debería registrar como mínimo:

```text
run_id
agent_id
agent_version
policy_version
capability
requester_identity
requester_channel
workspace/environment
requested_scope
resolved_scope
source_ids
source_as_of
started_at / completed_at
status
result_reference
human_review_required
approval_reference (si aplica)
correlation_id
```

No se propone persistir prompts, tokens o secretos sin política expresa.

## 5.3 Contrato mínimo de capacidades — propuesta, no implementación

### AGT-003

- `agt003.priorities.read`
- input: scope solicitado opcional, fecha de corte opcional solo si existe soporte real.
- output: contrato actual de prioridades, versionado.
- acción: exclusivamente lectura.

### AGT-002

El primer alcance candidato debe limitarse a lectura de resultados ya persistidos:

- `agt002.radar.read`;
- `agt002.dossier.read`;
- `agt002.documents.analysis.read`;
- `agt002.go_no_go.read`.

`agt002.documents.analysis.read` y `agt002.go_no_go.read` solo leen evidencia y recomendaciones existentes; no importan, cargan, extraen, analizan ni persisten documentos.

Las capacidades `agt002.radar.recommend`, `agt002.documents.analyze` y `agt002.go_no_go.recommend` quedan fuera del alcance inicial. Solo podrían proponerse en un gate posterior después de extraer funciones puras, determinísticas, versionadas y sin efectos secundarios, separadas de importación, Storage, interacciones y demás escrituras.

No habilitar inicialmente:

- sync de fuentes;
- importación, upload, extracción o análisis documental que escriba en Storage/interacciones;
- recomendación que dependa de ejecutar el flujo mutante actual;
- cambio de seguimiento;
- conversión;
- descarte;
- aprobación de preparación;
- carga/envío externo;
- presentación o firma.

## 5.4 Gobierno de reglas

SIIO debe seguir siendo propietario de:

- score y señales AGT-003;
- score Radar, análisis documental y GO/NO GO AGT-002;
- fuentes, filtros y significado funcional;
- contratos de negocio.

Plataforma Agentes debe aportar:

- registro/identidad;
- autorización y delegación;
- auditoría de ejecución;
- canales y conversaciones;
- approvals/gates;
- observabilidad.

No se deben copiar reglas a cada canal.

---

# 6. Gates recomendados

## Gate A — catálogo y ownership

- Confirmar un único registro para AGT-002 y AGT-003.
- Designar owner humano, aprobadores y custodio técnico.
- Resolver nomenclatura `Perfil corporativo PSI` vs nombres históricos `SN` en código/documentación.

## Gate B — contrato machine-readable

- Publicar esquemas versionados de entradas, salidas y errores.
- Congelar la versión inicial de cada capability.
- Definir minimización de datos y sensibilidad.

## Gate C — identidad técnica y scopes

- Autenticar agentes sin reutilizar cuentas humanas.
- Resolver scope en servidor.
- Exigir `agent_id`, delegante, canal y `correlation_id`.
- Añadir pruebas 401/403/allow por capability.

## Gate D — auditoría y evidencia

- Persistir run y versiones.
- Conservar fuente, fecha de corte y evidencia.
- Correlacionar recomendación y revisión humana.

## Gate E — piloto AGT-003 read-only

- Consumir el endpoint canónico, sin recalcular.
- Comparar resultados SIIO vs Plataforma Agentes.
- Validar scopes con Dirección Comercial.
- Prohibir toda mutación.

## Gate F — piloto AGT-002 read-only

- Exponer Radar/expediente/recomendación como capacidades separadas.
- Validar fuentes y documentos con Dirección de Licitaciones.
- Mantener conversión/descarte/aprobación exclusivamente humanos.

## Gate G — mutaciones controladas futuras

Solo después de:

- guards por acción en cada endpoint;
- solicitud/aprobación/ejecución separadas;
- approval record verificable y expiración;
- idempotencia;
- rollback/reconciliación;
- QA por rol e identidad técnica;
- autorización explícita de negocio y producción.

---

# 7. Riesgos prioritarios

| Prioridad | Riesgo | Agente | Acción requerida |
|---|---|---|---|
| Alta | No existe identidad técnica real ni `agent_id` en auth/runtime | Ambos | Gate C |
| Alta | AGT-002 usa guard de módulo amplio en múltiples mutaciones | AGT-002 | Guards por acción antes de integrar escrituras |
| Alta | UI de confirmación no sustituye approval record verificable | AGT-002 | Separar solicitud/aprobación/ejecución |
| Alta | Preparación de oferta no exige GO/NO GO aprobado y versionado | AGT-002 | Crear gate persistente antes de habilitar preparación institucional |
| Alta | Ausencia de esquema contractual machine-readable | Ambos | Gate B |
| Media | Reglas AGT-002 no tienen versión centralizada | AGT-002 | Extraer/versionar política sin cambiar resultado |
| Media | Catálogo AGT-003 declara metas/interacciones más amplias que el endpoint real | AGT-003 | Alinear catálogo o implementar fuente en fase separada |
| Media | SharePoint aparece en expediente pero sigue pendiente | AGT-002 | Mantener estado explícito; no afirmar integración |
| Media | Falta run audit común y correlación multicanal | Ambos | Gate D |
| Media | El checkout no contiene DDL/linaje completo de la vista CRM consumida | AGT-003 | Recuperar definición, RLS y ownership de la vista |
| Baja | Documentos históricos contienen brechas ya supersedidas parcialmente | Ambos | Mantener documento de estado actual y deprecaciones |

---

# 8. Evidencia y comandos de verificación

## Archivos primarios

- `src/siioAgents.ts`
- `vigia-engine.js`
- `server/index.js`
- `api/[...path].js`
- `access-control.js`
- `module-access.js`
- `tender-tracking-rpc.js`
- `src/vigia/**`
- `src/tenders/**`
- `supabase/migrations/005_public_tenders_radar.sql`
- `supabase/migrations/012_company_procurement_profile.sql`
- `supabase/migrations/013_tender_search_profiles.sql`
- `supabase/migrations/017_tender_tracking_workflow.sql`
- `supabase/migrations/018_tender_tracking_rpc.sql`
- `supabase/migrations/019_profile_area_permissions.sql`
- `supabase/migrations/020_profile_access_admin_rpc.sql`
- `supabase/migrations/021_explicit_user_modules.sql`

## Documentos de decisión/QA

- `docs/decisions/2026-07-18-vig-ia-comercial-gate.md`
- `docs/qa/vigia-commercial-gate0-verification.md`
- `docs/qa/tender-functional-separation/verification.md`
- `docs/superpowers/specs/siio-permission-matrix.md`
- `docs/superpowers/specs/siio-profile-area-model.md`
- `docs/superpowers/specs/2026-07-14-licitaciones-separacion-funcional-design.md`

## Pruebas ejecutadas

```bash
for f in tests/vigia-*.test.mjs tests/tender-*.test.mjs; do node "$f"; done
npm run check:siio-agents
npm run check:nav-permissions
npm run check:backend-parity
```

Resultado: todas pasaron. Como revisión independiente adicional, un auditor ejecutó los **81 archivos** `tests/*.test.mjs` sin fallos y `npm run build` correctamente; Vite reportó únicamente la advertencia no bloqueante de chunk JavaScript mayor de 500 kB.

## Smoke sin sesión

```text
GET  /api/vigia/priorities -> 401
POST /api/vigia/priorities -> 405
GET  /api/tenders          -> 401
POST /api/tender-refresh   -> 401
POST /api/tender-convert   -> 401
```

---

# 9. Decisión de preparación

## AGT-003

**Apto para preparar un piloto read-only con Plataforma Agentes**, condicionado a Gates A-D. El piloto debe reutilizar el contrato y motor actuales; no puede recalcular ni escribir.

## AGT-002

**Apto únicamente para diseñar y luego pilotear capacidades read-only/recommendation separadas.** No es apto todavía para que Plataforma Agentes ejecute sincronización, conversión, descarte, aprobación, preparación oficial, envío, firma o presentación.

## Prohibición de implementación en este corte

Este levantamiento no autoriza ni ejecuta:

- cambios de código funcional;
- migraciones;
- creación de credenciales o identidades;
- ampliación de permisos;
- escrituras de datos;
- despliegues;
- activación de agentes o automatizaciones externas.
