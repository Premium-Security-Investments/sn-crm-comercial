# Tender Dossier Workspace (Lote 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir el expediente post-GO de Licitaciones de un plan estático (un blob JSON en `psi_sales_interactions`) en un expediente operable, determinístico y 100% humano: checklist tipado con estado proyectado, artefactos con versiones y revisiones append-only, gate real para `lista_para_presentar`, un GET canónico de workspace y una UI compacta post-GO.

**Architecture:** Se añaden **tres migraciones** (`040`, `041`, `042`) que crean cinco tablas append-only y las RPC `security definer` que las operan, siguiendo el patrón *rename-to-core + wrapper* de la migración `039`. `041` envuelve `psi_record_tender_go_no_go` para **sembrar** el checklist/artefactos al GO (idempotente, reejecutable como backfill no destructivo). `042` envuelve `psi_transition_tender_offer_status` para exigir el **gate de readiness** antes de `lista_para_presentar`, sin tocar su autorización. El estado de cada ítem/artefacto **no se materializa**: se proyecta desde el stream append-only en las RPC de lectura/gate. Un adapter raíz `tender-dossier-rpc.js` y siete endpoints nuevos (registrados byte-idénticos en `server/index.js` y `api/[...path].js`) exponen todo; una familia de componentes React en `src/tenders/` renderiza el workspace. **No hay LLM, no se activa AGT-002; Vig-IA queda como asesor futuro.**

**Tech Stack:** PostgreSQL (Supabase, SQL `plpgsql` SECURITY DEFINER, service_role-only), Node/Express (backend gemelo Express + Vercel), React + Vite + TypeScript (CSS plano), pruebas con el runner nativo de Node (`node <archivo>.test.mjs`) + PGlite en memoria + esbuild.

---

## 0. Contexto imprescindible para el implementador (léelo antes de empezar)

Vienes sin contexto previo. Este bloque es todo lo que necesitas saber del repo antes de tocar código.

### 0.1 Estado actual del post-GO (el problema)

- Al registrar **GO**, `callTenderGoNoGoDecision` (`tender-go-no-go-rpc.js:97-132`) construye un objeto de preparación con `buildTenderOfferPreparation(...)` (`tender-offer-preparation.js:26-51`) y lo pasa como `p_preparation` a la RPC `psi_record_tender_go_no_go`.
- Esa RPC (cadena `022`/`027`) persiste la preparación como **una fila** en `psi_sales_interactions` (`interaction_type='documento'`, `notes` JSON con `"kind":"tender_offer_preparation"`) y pone `psi_sales_opportunities.tender_offer_status = 'en_preparacion'`.
- El objeto de preparación contiene dos listas que sembraremos:
  - `human_required_items[]` — cada uno `{ key, title, owner, priority ('alta'|'media'), status, reason }`.
  - `planned_documents[]` — cada uno `{ key, name, folder, status, owner, output, reusable }`.
- Hoy la UI (`TenderOfferPreparationPanel`, `src/main.tsx:944-998`) solo **muestra** ese blob y permite notas internas. No hay ítems operables, ni responsables, ni evidencia, ni versiones/revisiones de documentos, ni gate. Eso es lo que construye este Lote 2.

### 0.2 Estados de oferta y transición existente (NO se reemplazan)

- Columna `psi_sales_opportunities.tender_offer_status` con CHECK: `'pendiente_decision' | 'en_preparacion' | 'lista_para_presentar' | 'presentada' | 'adjudicada' | 'no_adjudicada' | 'cerrada_no_go'` (migración `022`).
- Camino: `en_preparacion → lista_para_presentar → presentada → {adjudicada | no_adjudicada}`.
- La transición la ejecuta `psi_transition_tender_offer_status(p_opportunity_id uuid, p_actor_id uuid, p_to_status text, p_expected_current_status text, p_note text default null)` (migración `024`), que:
  - autoriza rol `admin/gerencia/director` humano con permiso `licitaciones`;
  - exige decisión GO vigente;
  - usa concurrencia optimista con `p_expected_current_status` (errcode `40001`);
  - inserta en la tabla append-only `psi_tender_offer_status_transitions`.
- **Este Lote NO crea una transición nueva.** Añade una precondición de readiness a la transición existente hacia `lista_para_presentar`, envolviéndola (§Task 8).

### 0.3 Patrón *rename-to-core + wrapper* (migración `039`, tu plantilla)

`039_tender_business_timeline.sql` renombró `psi_record_tender_go_no_go` a `psi_record_tender_go_no_go_core_039` y creó un nuevo público con la misma firma que llama al core y además emite eventos de timeline. Guard idempotente literal (`039:6-15`):

```sql
do $$
begin
  if to_regprocedure('public.psi_record_tender_go_no_go_core_039(uuid,uuid,uuid,text,uuid,text,jsonb,text)') is null then
    if to_regprocedure('public.psi_record_tender_go_no_go(uuid,uuid,uuid,text,uuid,text,jsonb,text)') is null then
      raise exception 'Migration 039 requires the audited eight-argument psi_record_tender_go_no_go RPC.';
    end if;
    execute 'alter function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text) rename to psi_record_tender_go_no_go_core_039';
  end if;
end;
$$;
```

Usarás este mismo patrón en `041` (renombrando el wrapper `039` a `_core_041`) y en `042` (renombrando `psi_transition_tender_offer_status` a `_core_042`).

### 0.4 Función de eventos de tracking (reutilizada para auditoría comercial)

`psi_append_tender_tracking_event` (migración `035:3-57`), firma exacta (9 args):

```sql
public.psi_append_tender_tracking_event(
  p_tender_id uuid, p_event_type text, p_actor_kind text, p_created_by uuid,
  p_source_ref_type text, p_source_ref_id uuid, p_metadata jsonb, p_note text, p_singular boolean
) returns jsonb
```

- `p_actor_kind='human'` exige `p_created_by` = perfil activo; `'system'`/`'agent'` exigen `p_created_by IS NULL`.
- `p_singular=true` deduplica por `(event_type, source_ref_type, source_ref_id)` → idempotente para hitos.
- El `event_type` está restringido por un CHECK en `psi_tender_tracking_events` que **no es acumulativo**: para añadir tipos hay que `drop constraint if exists ..._event_type_check` + `add constraint` con la **lista completa** (patrón `033:10-19`).
- El backend separa `TENDER_BUSINESS_EVENT_TYPES` vs `TENDER_TECHNICAL_EVENT_TYPES` y filtra por `scope` (`business`/`technical`) en `GET /api/tender-tracking-events`.

### 0.5 Autorización (server-side, service_role-only)

- Cliente Supabase service_role único: `server/index.js:47` (`db`). Los adapters lo reciben inyectado (`database`).
- Identidad humana activa: `getAuthContext(req)` (`server/index.js:412-452`) valida Bearer → `psi_sales_profiles` por `auth_user_id`, deriva `areas`/`permissions` server-side. El `actor_id` humano se pasa **explícito** a cada RPC (`p_actor_id`); el JWT nunca se confía en la BD.
- Guard en el handler: `requireAction(currentProfile, ACTIONS.X)` (lanza `403 FORBIDDEN`).
- Matriz relevante (`access-control.js:262-337`):
  - `LICITACIONES_GO_NO_GO_APPROVE` → rol `admin/gerencia/director` + permiso `licitaciones`.
  - `canHumanTenderAction` (roles `admin/gerencia/director/comercial` + `licitaciones`) es el techo operativo amplio.
- Predicado SQL reutilizable dentro de las RPC (patrón `024:69-80`):

```sql
if not exists (
  select 1
  from public.psi_sales_profiles p
  join public.psi_profile_permissions pp on pp.profile_id = p.id and pp.permission_code = 'licitaciones'
  join public.psi_access_permissions ap on ap.code = pp.permission_code and ap.active = true
  where p.id = p_actor_id
    and p.active = true
    and coalesce(p.identity_type, 'human') = 'human'
    and p.role in (/* roles permitidos */)
) then
  raise exception 'No tiene permisos para ...' using errcode = '42501';
end if;
```

### 0.6 Paridad Express + Vercel (invariante)

`server/index.js` y `api/[...path].js` son **byte-idénticos** (misma app Express; Vercel importa `export default app`). Cualquier cambio de rutas/imports se aplica **igual** en ambos. Se valida con `npm run check:backend-parity` y `tests/backend-parity.test.mjs`. Para registrar una ruta nueva: colócala antes del `app.use(express.static(...))` final (`server/index.js:3702`).

### 0.7 Pruebas (runner nativo de Node + PGlite)

- **No hay** vitest/jest. Cada test es `tests/<name>.test.mjs` ejecutado con `node <archivo>`; usa `import { strict as assert } from 'node:assert'`; termina con `console.log('... passed')`; falla si algún `assert` lanza (exit ≠ 0).
- **No hay** `npm test`. Suite completa:
  ```bash
  for test in tests/*.test.mjs; do node "$test" || exit 1; done
  ```
- Test PGlite = autocontenido: crea `new PGlite()`, `db.exec(...)` con roles + tablas prerequisito a mano, `db.exec(migration)` **dos veces** (idempotencia), invoca RPC con `db.query('select public.fn($1) as result', [...])`, prueba grants con `set role service_role` / `reset role`, cierra con `db.close()`.
- Typecheck + build: `npm run build` (= `tsc && vite build`; `tsconfig` con `noEmit:true`, `strict:true`).
- UI: no hay testing-library. Se prueba con **source-scan** (`assert.match` sobre el `.tsx` leído como texto) y, para lógica pura TS, `esbuild.buildSync` → data-URL → `import()`.
- IDs de prueba: UUID v4 sintéticos fijos (nunca datos reales).

### 0.8 Límites innegociables (recuérdalos en cada tarea)

- Sin LLM, sin activar AGT-002. Todo humano/determinístico.
- Append-only para actuaciones/estado/versiones/revisiones: nada de UPDATE/DELETE destructivo del historial (triggers de inmutabilidad).
- Autorización server-side; RPC solo `service_role`; identidad humana activa; respetar `licitaciones` + rol limitante.
- No mover etapa comercial general por etiquetas; la oferta tiene su propio `tender_offer_status`.
- No SharePoint/SECOP/envíos en este lote. No datos reales en pruebas.
- Paridad Express/Vercel obligatoria. UI compacta/operativa, sin KPI duplicado, sin chat, sin notas internas visibles como conversación.
- No permitir `lista_para_presentar` hasta cumplir los gates humanos.

---

## 1. Modelo de datos (visión general antes de las tareas)

Cinco tablas nuevas. El **estado** de ítems y artefactos se **proyecta** desde streams append-only (no se materializa), para cumplir estrictamente append-only. La auditoría comercial de alto nivel **reutiliza** `psi_tender_tracking_events` (no se crea tabla de timeline nueva).

| Tabla | Rol | Append-only |
|---|---|---|
| `psi_tender_dossier_items` | Identidad estable de cada ítem del checklist (título, tipo, `required`). | Sí (identidad; sin updates destructivos) |
| `psi_tender_dossier_item_actions` | Stream de acciones humanas por ítem (estado, asignación, evidencia, no_aplica). Fuente de verdad del estado proyectado. | Sí (trigger inmutable) |
| `psi_tender_dossier_artifacts` | Identidad estable de cada artefacto/documento del expediente. | Sí (identidad) |
| `psi_tender_dossier_artifact_versions` | Versiones append-only del artefacto (contenido y autor humano). La vigente se proyecta por el mayor `version`; no existe puntero mutable. | Sí (nueva versión = editar) |
| `psi_tender_dossier_artifact_reviews` | Revisiones append-only por versión (`aprobado`/`rechazado` + comentario). Estado de revisión proyectado = última. | Sí (trigger inmutable) |

**Proyección de estado de ítem** (calculada en SQL, no almacenada):
- `applicability` ∈ `{'requerido','no_aplica'}`: `no_aplica` si la última acción que fija aplicabilidad es `marked_not_applicable`; `requerido` en otro caso (default). Marcar `no_aplica` **exige** `justification` (se valida en la escritura, así toda fila `no_aplica` tiene justificación).
- `status` ∈ `{'pendiente','en_progreso','listo','bloqueado'}`: último `to_status` no nulo; default `pendiente`.
- `assignee_id`: último `assignee_id` de una acción `assigned`.
- `target_date`: último `target_date` no nulo.
- `latest_evidence`: última acción `evidence_attached`.

- **Proyección de revisión de artefacto**: la versión vigente es la de mayor `version`; para cada versión, `review_status` = decisión de la última fila de `psi_tender_dossier_artifact_reviews` (`pendiente` si no hay ninguna). Ninguna fila previa se actualiza al crear una versión.

**Reglas del gate `lista_para_presentar`** (evaluadas por `psi_evaluate_tender_dossier_readiness`):
1. Todo ítem con `required=true` debe estar resuelto: `status='listo'` **o** `applicability='no_aplica'`.
2. Ningún ítem (de cualquier tipo) con `status='bloqueado'` (sin bloqueantes activos).
3. Todo artefacto con `required=true` debe tener una versión vigente (la de mayor `version`) cuya última revisión sea `aprobado` por humano. Una aprobación histórica no habilita una versión posterior pendiente.
4. `ready = (1) ∧ (2) ∧ (3)`.

**Mapeo de semilla (determinístico, definido en `041`)**:
- Ítems del checklist ← `preparation.human_required_items[]`. `item_type='pendiente_humano'`, `item_key = key`, `title = title`, `required = true`. Un pendiente humano sólo sale del gate mediante `listo` o `no_aplica` con justificación y aprobación manager.
- Ítems del checklist ← `preparation.planned_documents[]`. `item_type='documento'`, `item_key = 'doc_' || key`, `title = name`, `required = false` (el documento como artefacto lleva su propio `required`).
- Artefactos ← `preparation.planned_documents[]`. `artifact_key = key`, `title = name`, `required = (key in ('carta_presentacion','declaracion_no_inhabilidades','matriz_cumplimiento','propuesta_tecnica_base'))`.

Estas listas de `required` son constantes deterministas explícitas y ajustables; están documentadas aquí para que el gate sea predecible y testeable.

### 1.1 Correcciones vinculantes al ejecutar los snippets

- Las **cinco tablas** reciben un trigger `before update or delete` de inmutabilidad. Los grants no sustituyen esta defensa en profundidad.
- `psi_tender_dossier_artifact_versions` nunca se actualiza: la vigente se proyecta por `order by version desc, id desc limit 1`.
- `has_approved_version` conserva el nombre por compatibilidad del payload, pero significa **“la versión vigente está aprobada”**. Al crear una nueva versión vuelve a `false` hasta que esa versión sea aprobada.
- Todos los pendientes humanos sembrados son `required=true`. `marked_not_applicable` requiere manager y justificación; reabrir a `requerido` también queda auditado.
- Estas reglas prevalecen sobre cualquier snippet residual que sugiera `current`, aprobar una versión histórica o dejar pendientes medios fuera del gate.

---

## 2. Estructura de archivos (crear / modificar)

**Migraciones (crear):**
- `supabase/migrations/040_tender_dossier_workspace.sql` — 5 tablas + triggers + grants + event types + RPC de acciones/creación/lectura.
- `supabase/migrations/041_tender_dossier_go_seed.sql` — `psi_seed_tender_dossier` + wrapper de `psi_record_tender_go_no_go`.
- `supabase/migrations/042_tender_dossier_offer_gate.sql` — `psi_evaluate_tender_dossier_readiness` + wrapper de `psi_transition_tender_offer_status`.

**Backend adapter (crear):**
- `tender-dossier-rpc.js` — funciones exportadas del adapter (validación + autorización + `database.rpc`).

**Backend rutas (modificar, byte-idéntico en ambos):**
- `server/index.js` y `api/[...path].js` — imports del adapter + 7 endpoints.

**Frontend (crear):**
- `src/tenders/components/TenderDossierWorkspacePanel.tsx`
- `src/tenders/components/TenderDossierChecklist.tsx`
- `src/tenders/components/TenderDossierArtifacts.tsx`

**Frontend (modificar):**
- `src/tenders/types.ts` — tipos del dossier.
- `src/tenders/api.ts` — loaders/mutadores tipados.
- `src/main.tsx` — montar `TenderDossierWorkspacePanel` en la sección `#tender-preparation` del `OpportunityDetail`.

**Pruebas (crear) — en `tests/`:**
- `tender-dossier-workspace-migration.test.mjs` (estático sobre `040`/`041`/`042`)
- `tender-dossier-workspace-pglite.integration.test.mjs` (`040`: tablas/triggers/grants/idempotencia/acciones)
- `tender-dossier-go-seed-pglite.integration.test.mjs` (`041`: siembra al GO + idempotencia + backfill)
- `tender-dossier-offer-gate-pglite.integration.test.mjs` (`042`: gate readiness)
- `tender-dossier-api.test.mjs` (adapter + paridad de rutas en ambos backends)
- `tender-dossier-ui.test.mjs` (source-scan de los componentes)

**Docs (modificar al final):**
- `CURRENT.md` — nota breve de cierre del Lote 2 (solo si el corte se despliega; ver Task 12).

---

## 3. Tareas

> Convención de commits del repo: mensajes en español estilo `feat(tenders): ...`. Commit frecuente. No abras PR ni hagas push salvo que se pida.

### Task 1: Migración 040 — esquema append-only (5 tablas + triggers + grants)

**Files:**
- Create: `supabase/migrations/040_tender_dossier_workspace.sql`
- Test: `tests/tender-dossier-workspace-pglite.integration.test.mjs`

- [ ] **Step 1: Escribe el test PGlite que falla (tablas, triggers, grants, idempotencia)**

Create `tests/tender-dossier-workspace-pglite.integration.test.mjs`:

```js
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/040_tender_dossier_workspace.sql', import.meta.url), 'utf8');

const ids = {
  actor: '11111111-1111-4111-8111-111111111111',
  actorComercial: '1a1a1a1a-1111-4111-8111-111111111111',
  opportunity: '22222222-2222-4222-8222-222222222222',
  tender: '33333333-3333-4333-8333-333333333333',
};

async function freshDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.psi_sales_profiles (
      id uuid primary key, active boolean not null default true,
      identity_type text default 'human', role text not null, full_name text
    );
    create table public.psi_access_permissions (code text primary key, active boolean not null default true);
    create table public.psi_profile_permissions (profile_id uuid not null, permission_code text not null);
    create table public.psi_sales_opportunities (id uuid primary key, tender_offer_status text);
    create table public.psi_public_tenders (id uuid primary key, converted_opportunity_id uuid);
    insert into public.psi_access_permissions(code) values ('licitaciones');
    insert into public.psi_sales_profiles(id, role, full_name) values
      ('${ids.actor}', 'director', 'Directora Licitaciones'),
      ('${ids.actorComercial}', 'comercial', 'Comercial Uno');
    insert into public.psi_profile_permissions(profile_id, permission_code) values
      ('${ids.actor}', 'licitaciones'), ('${ids.actorComercial}', 'licitaciones');
    insert into public.psi_sales_opportunities(id, tender_offer_status) values ('${ids.opportunity}', 'en_preparacion');
    insert into public.psi_public_tenders(id, converted_opportunity_id) values ('${ids.tender}', '${ids.opportunity}');
  `);
  return db;
}

// 1) Idempotencia: aplicar dos veces no falla.
await (async function migrationIsReexecutable() {
  const db = await freshDb();
  await db.exec(migration);
  await db.exec(migration);
  const tables = (await db.query(`
    select table_name from information_schema.tables
    where table_schema='public' and table_name like 'psi_tender_dossier%' order by table_name
  `)).rows.map(r => r.table_name);
  assert.deepEqual(tables, [
    'psi_tender_dossier_artifact_reviews',
    'psi_tender_dossier_artifact_versions',
    'psi_tender_dossier_artifacts',
    'psi_tender_dossier_item_actions',
    'psi_tender_dossier_items',
  ]);
  await db.close();
})();

// 2) Grants: service_role puede ejecutar RPC; escritura directa denegada.
await (async function directDmlIsDenied() {
  const db = await freshDb();
  await db.exec(migration);
  await db.exec('set role service_role');
  await assert.rejects(
    () => db.query(`insert into public.psi_tender_dossier_items(opportunity_id, tender_id, item_key, title, item_type, required, created_by) values ('${ids.opportunity}','${ids.tender}','x','X','general',true,'${ids.actor}')`),
    /permission denied/i,
  );
  await db.exec('reset role');
  await db.close();
})();

// 3) Crear ítem por RPC y proyección inicial.
await (async function createItemProjectsPending() {
  const db = await freshDb();
  await db.exec(migration);
  const created = (await db.query(
    `select public.psi_create_tender_dossier_item($1,$2,$3,$4,$5,$6) as r`,
    [ids.opportunity, ids.actor, 'validar_experiencia', 'Validar experiencia', 'pendiente_humano', true],
  )).rows[0].r;
  assert.equal(created.item.status, 'pendiente');
  assert.equal(created.item.applicability, 'requerido');
  assert.equal(created.item.required, true);
  await db.close();
})();

// 4) Append-only: el trigger prohíbe UPDATE/DELETE del stream de acciones.
await (async function actionStreamIsAppendOnly() {
  const db = await freshDb();
  await db.exec(migration);
  await db.exec('set role service_role');
  await assert.rejects(() => db.query(`update public.psi_tender_dossier_item_actions set note='x'`), /append-only/i);
  await assert.rejects(() => db.query(`delete from public.psi_tender_dossier_item_actions`), /append-only/i);
  await db.exec('reset role');
  await db.close();
})();

console.log('PGlite tender dossier workspace schema passed');
```

- [ ] **Step 2: Corre el test y verifica que falla**

Run: `node tests/tender-dossier-workspace-pglite.integration.test.mjs`
Expected: FAIL (el archivo de migración no existe / RPC indefinida).

- [ ] **Step 3: Crea la migración con el esquema**

Create `supabase/migrations/040_tender_dossier_workspace.sql` (parte 1 — tablas, triggers, grants). Las RPC se añaden en Tasks 2–5 al mismo archivo.

```sql
-- Expediente operativo post-GO de Licitaciones (Lote 2), 100% humano/determinístico.
-- Streams append-only; el estado de ítems/artefactos se proyecta, no se materializa.
-- No usa LLM ni activa AGT-002. Additive: no cambia GO/NO GO ni la transición de oferta.
begin;

-- 1. Identidad estable de ítems del checklist.
create table if not exists public.psi_tender_dossier_items (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  item_key text not null check (nullif(btrim(item_key), '') is not null and length(item_key) <= 200),
  title text not null check (nullif(btrim(title), '') is not null and length(title) <= 400),
  item_type text not null check (item_type in ('documento', 'pendiente_humano', 'general')),
  required boolean not null default false,
  origin text not null default 'human' check (origin in ('seed_go', 'human')),
  created_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (opportunity_id, item_key)
);
create index if not exists psi_tender_dossier_items_opportunity_idx
  on public.psi_tender_dossier_items (opportunity_id, created_at, id);

-- 2. Stream append-only de acciones humanas por ítem (fuente de verdad del estado).
create table if not exists public.psi_tender_dossier_item_actions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.psi_tender_dossier_items(id) on delete restrict,
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  action_type text not null check (action_type in
    ('created','status_changed','assigned','evidence_attached','marked_not_applicable','requirement_changed','reopened')),
  to_status text check (to_status is null or to_status in ('pendiente','en_progreso','listo','bloqueado')),
  applicability text check (applicability is null or applicability in ('requerido','no_aplica')),
  assignee_id uuid references public.psi_sales_profiles(id) on delete restrict,
  target_date date,
  evidence_kind text check (evidence_kind is null or evidence_kind in ('texto','url')),
  evidence_text text check (evidence_text is null or length(evidence_text) <= 5000),
  evidence_url text check (evidence_url is null or (evidence_url ~* '^https://' and length(evidence_url) <= 2000 and evidence_url !~* '\s')),
  justification text check (justification is null or length(justification) <= 2000),
  note text check (note is null or length(note) <= 2000),
  actor_id uuid not null references public.psi_sales_profiles(id) on delete restrict,
  actor_kind text not null default 'human' check (actor_kind = 'human'),
  created_at timestamptz not null default now()
);
create index if not exists psi_tender_dossier_item_actions_cursor_idx
  on public.psi_tender_dossier_item_actions (item_id, created_at desc, id desc);

create or replace function public.psi_tender_dossier_item_actions_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'psi_tender_dossier_item_actions is append-only: UPDATE and DELETE are prohibited';
end;
$$;
drop trigger if exists psi_tender_dossier_item_actions_immutable on public.psi_tender_dossier_item_actions;
create trigger psi_tender_dossier_item_actions_immutable
  before update or delete on public.psi_tender_dossier_item_actions
  for each row execute function public.psi_tender_dossier_item_actions_prevent_mutation();

-- 3. Identidad estable de artefactos/documentos del expediente.
create table if not exists public.psi_tender_dossier_artifacts (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  artifact_key text not null check (nullif(btrim(artifact_key), '') is not null and length(artifact_key) <= 200),
  title text not null check (nullif(btrim(title), '') is not null and length(title) <= 400),
  required boolean not null default false,
  origin text not null default 'human' check (origin in ('seed_go', 'human')),
  created_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (opportunity_id, artifact_key)
);

-- 4. Versiones append-only del artefacto (nueva versión = editar). La vigente se proyecta por mayor version.
create table if not exists public.psi_tender_dossier_artifact_versions (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.psi_tender_dossier_artifacts(id) on delete restrict,
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  version integer not null check (version > 0),
  supersedes_version_id uuid references public.psi_tender_dossier_artifact_versions(id) on delete restrict,
  content_kind text not null check (content_kind in ('markdown','texto','metadata')),
  content_text text check (content_text is null or length(content_text) <= 100000),
  content_metadata jsonb check (content_metadata is null or jsonb_typeof(content_metadata) = 'object'),
  author_id uuid not null references public.psi_sales_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint psi_tender_dossier_artifact_versions_has_content check (
    (content_kind in ('markdown','texto') and nullif(btrim(content_text), '') is not null)
    or (content_kind = 'metadata' and content_metadata is not null)
  ),
  unique (artifact_id, version)
);
create index if not exists psi_tender_dossier_artifact_versions_latest_idx
  on public.psi_tender_dossier_artifact_versions (artifact_id, version desc, id desc);

-- 5. Revisiones append-only por versión (estado de revisión proyectado = última).
create table if not exists public.psi_tender_dossier_artifact_reviews (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.psi_tender_dossier_artifact_versions(id) on delete restrict,
  artifact_id uuid not null references public.psi_tender_dossier_artifacts(id) on delete restrict,
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  decision text not null check (decision in ('aprobado','rechazado')),
  comment text check (comment is null or length(comment) <= 5000),
  reviewer_id uuid not null references public.psi_sales_profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists psi_tender_dossier_artifact_reviews_cursor_idx
  on public.psi_tender_dossier_artifact_reviews (version_id, created_at desc, id desc);

create or replace function public.psi_tender_dossier_artifact_reviews_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'psi_tender_dossier_artifact_reviews is append-only: UPDATE and DELETE are prohibited';
end;
$$;
drop trigger if exists psi_tender_dossier_artifact_reviews_immutable on public.psi_tender_dossier_artifact_reviews;
create trigger psi_tender_dossier_artifact_reviews_immutable
  before update or delete on public.psi_tender_dossier_artifact_reviews
  for each row execute function public.psi_tender_dossier_artifact_reviews_prevent_mutation();

-- Grants: RLS + solo service_role lee; toda escritura pasa por RPC security definer.
do $$
declare t text;
begin
  foreach t in array array[
    'psi_tender_dossier_items','psi_tender_dossier_item_actions','psi_tender_dossier_artifacts',
    'psi_tender_dossier_artifact_versions','psi_tender_dossier_artifact_reviews'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('revoke all on table public.%I from authenticated', t);
    execute format('revoke all on table public.%I from service_role', t);
    execute format('grant select on table public.%I to service_role', t);
  end loop;
end;
$$;

commit;
```

- [ ] **Step 4: Corre el test y verifica que pasa (tras añadir la RPC de Step 5)**

Nota: el test de Step 1 también invoca `psi_create_tender_dossier_item` (aún no existe). Añádela ahora como parte de Task 2 antes de re-correr. Si prefieres verificar el esquema aislado primero, comenta temporalmente los casos `createItemProjectsPending`; pero lo recomendado es continuar a Task 2 y correr el test completo al final de Task 2.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/040_tender_dossier_workspace.sql tests/tender-dossier-workspace-pglite.integration.test.mjs
git commit -m "feat(tenders): esquema append-only del expediente post-GO (Lote 2)"
```

---

### Task 2: Migración 040 — RPC de creación y acciones de ítems

**Files:**
- Modify: `supabase/migrations/040_tender_dossier_workspace.sql` (añadir RPC antes del `commit;` final — mover el `commit;` al final de todo el archivo)
- Test: `tests/tender-dossier-workspace-pglite.integration.test.mjs` (extender)

> Estructura recomendada del archivo `040`: un solo `begin; ... commit;` con: (Task 1) tablas/triggers/grants, (Task 2) RPC ítems, (Task 3) RPC artefactos, (Task 4) event types + emisión, (Task 5) RPC de lectura. Añade cada bloque **antes** del `commit;`.

- [ ] **Step 1: Añade helper de autorización + `psi_create_tender_dossier_item`**

Inserta en `040` (antes de `commit;`):

```sql
-- Autorización compartida: humano activo con permiso licitaciones y rol dentro del techo.
create or replace function public.psi_assert_tender_dossier_actor(p_actor_id uuid, p_manager_only boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (
    select 1
    from public.psi_sales_profiles p
    join public.psi_profile_permissions pp on pp.profile_id = p.id and pp.permission_code = 'licitaciones'
    join public.psi_access_permissions ap on ap.code = pp.permission_code and ap.active = true
    where p.id = p_actor_id
      and p.active = true
      and coalesce(p.identity_type, 'human') = 'human'
      and p.role in ('admin','gerencia','director','comercial')
      and (not p_manager_only or p.role in ('admin','gerencia','director'))
  ) then
    raise exception 'No tiene permisos para operar el expediente de oferta.' using errcode = '42501';
  end if;
end;
$$;

-- Exige decisión GO vigente (no superada) para la oportunidad.
create or replace function public.psi_assert_tender_dossier_go(p_opportunity_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tender_id uuid; v_decision text;
begin
  select t.id into v_tender_id
    from public.psi_public_tenders t
    where t.converted_opportunity_id = p_opportunity_id
    order by t.id limit 1;
  if v_tender_id is null then
    raise exception 'No existe una licitación vinculada a la oportunidad.' using errcode = 'P0002';
  end if;
  select d.decision into v_decision
    from public.psi_tender_go_no_go_decisions d
    where d.opportunity_id = p_opportunity_id and d.tender_id = v_tender_id
      and not exists (select 1 from public.psi_tender_go_no_go_decisions c where c.supersedes_decision_id = d.id)
    order by d.decided_at desc, d.id desc limit 1;
  if v_decision is distinct from 'go' then
    raise exception 'El expediente requiere una decisión GO vigente.' using errcode = '23514';
  end if;
  return v_tender_id;
end;
$$;

-- Proyección del estado actual de un ítem (una fila jsonb).
create or replace function public.psi_project_tender_dossier_item(p_item_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with i as (select * from public.psi_tender_dossier_items where id = p_item_id),
  st as (
    select to_status from public.psi_tender_dossier_item_actions
    where item_id = p_item_id and to_status is not null order by created_at desc, id desc limit 1),
  ap as (
    select applicability from public.psi_tender_dossier_item_actions
    where item_id = p_item_id and applicability is not null order by created_at desc, id desc limit 1),
  asg as (
    select a.assignee_id, pr.full_name from public.psi_tender_dossier_item_actions a
    left join public.psi_sales_profiles pr on pr.id = a.assignee_id
    where a.item_id = p_item_id and a.action_type = 'assigned' order by a.created_at desc, a.id desc limit 1),
  td as (
    select target_date from public.psi_tender_dossier_item_actions
    where item_id = p_item_id and target_date is not null order by created_at desc, id desc limit 1),
  ev as (
    select evidence_kind, evidence_text, evidence_url, created_at from public.psi_tender_dossier_item_actions
    where item_id = p_item_id and action_type = 'evidence_attached' order by created_at desc, id desc limit 1)
  select jsonb_build_object(
    'id', i.id, 'item_key', i.item_key, 'title', i.title, 'item_type', i.item_type,
    'required', i.required, 'origin', i.origin,
    'status', coalesce((select to_status from st), 'pendiente'),
    'applicability', coalesce((select applicability from ap), 'requerido'),
    'assignee_id', (select assignee_id from asg), 'assignee_name', (select full_name from asg),
    'target_date', (select target_date from td),
    'latest_evidence', (select case when ev.evidence_kind is null then null else jsonb_build_object(
      'kind', ev.evidence_kind, 'text', ev.evidence_text, 'url', ev.evidence_url, 'at', ev.created_at) end from ev)
  ) from i;
$$;

create or replace function public.psi_create_tender_dossier_item(
  p_opportunity_id uuid, p_actor_id uuid, p_item_key text, p_title text, p_item_type text, p_required boolean
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tender_id uuid; v_item_id uuid;
begin
  perform public.psi_assert_tender_dossier_actor(p_actor_id, false);
  v_tender_id := public.psi_assert_tender_dossier_go(p_opportunity_id);
  if p_item_type is null or p_item_type not in ('documento','pendiente_humano','general') then
    raise exception 'Tipo de ítem inválido.' using errcode = '22023';
  end if;
  if nullif(btrim(p_title), '') is null then
    raise exception 'El ítem requiere un título.' using errcode = '22023';
  end if;
  insert into public.psi_tender_dossier_items (opportunity_id, tender_id, item_key, title, item_type, required, origin, created_by)
  values (p_opportunity_id, v_tender_id, btrim(p_item_key), btrim(p_title), p_item_type, coalesce(p_required, false), 'human', p_actor_id)
  on conflict (opportunity_id, item_key) do nothing
  returning id into v_item_id;
  if v_item_id is null then
    select id into v_item_id from public.psi_tender_dossier_items where opportunity_id = p_opportunity_id and item_key = btrim(p_item_key);
  else
    insert into public.psi_tender_dossier_item_actions (item_id, opportunity_id, action_type, to_status, applicability, actor_id)
    values (v_item_id, p_opportunity_id, 'created', 'pendiente', 'requerido', p_actor_id);
  end if;
  return jsonb_build_object('item', public.psi_project_tender_dossier_item(v_item_id));
end;
$$;

revoke all on function public.psi_create_tender_dossier_item(uuid,uuid,text,text,text,boolean) from public;
revoke all on function public.psi_create_tender_dossier_item(uuid,uuid,text,text,text,boolean) from anon;
revoke all on function public.psi_create_tender_dossier_item(uuid,uuid,text,text,text,boolean) from authenticated;
grant execute on function public.psi_create_tender_dossier_item(uuid,uuid,text,text,text,boolean) to service_role;
```

- [ ] **Step 2: Añade `psi_append_tender_dossier_item_action`**

```sql
create or replace function public.psi_append_tender_dossier_item_action(
  p_opportunity_id uuid, p_item_id uuid, p_actor_id uuid, p_action_type text,
  p_to_status text default null, p_assignee_id uuid default null, p_target_date date default null,
  p_evidence_kind text default null, p_evidence_text text default null, p_evidence_url text default null,
  p_justification text default null, p_note text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_item public.psi_tender_dossier_items%rowtype; v_applicability text; v_manager boolean;
begin
  -- marcar no_aplica de un ítem requerido es decisión de manager.
  v_manager := (p_action_type = 'marked_not_applicable');
  perform public.psi_assert_tender_dossier_actor(p_actor_id, v_manager);
  perform public.psi_assert_tender_dossier_go(p_opportunity_id);

  select * into v_item from public.psi_tender_dossier_items where id = p_item_id for share;
  if not found or v_item.opportunity_id <> p_opportunity_id then
    raise exception 'El ítem no pertenece a la oportunidad.' using errcode = 'P0002';
  end if;
  if p_action_type not in ('status_changed','assigned','evidence_attached','marked_not_applicable','requirement_changed','reopened') then
    raise exception 'Acción de ítem inválida.' using errcode = '22023';
  end if;

  v_applicability := null;
  if p_action_type = 'status_changed' then
    if p_to_status is null or p_to_status not in ('pendiente','en_progreso','listo','bloqueado') then
      raise exception 'Estado de ítem inválido.' using errcode = '22023';
    end if;
  elsif p_action_type = 'assigned' then
    if p_assignee_id is not null and not exists (
      select 1 from public.psi_sales_profiles where id = p_assignee_id and active = true and coalesce(identity_type,'human')='human'
    ) then
      raise exception 'El responsable debe ser una persona activa.' using errcode = '22023';
    end if;
  elsif p_action_type = 'evidence_attached' then
    if p_evidence_kind not in ('texto','url')
       or (p_evidence_kind = 'texto' and nullif(btrim(p_evidence_text), '') is null)
       or (p_evidence_kind = 'url' and (p_evidence_url is null or p_evidence_url !~* '^https://')) then
      raise exception 'La evidencia requiere texto o una URL https válida.' using errcode = '22023';
    end if;
  elsif p_action_type = 'marked_not_applicable' then
    if nullif(btrim(p_justification), '') is null then
      raise exception 'Marcar no aplica requiere justificación.' using errcode = '22023';
    end if;
    v_applicability := 'no_aplica';
  elsif p_action_type = 'reopened' then
    v_applicability := 'requerido';
  end if;

  insert into public.psi_tender_dossier_item_actions (
    item_id, opportunity_id, action_type, to_status, applicability, assignee_id, target_date,
    evidence_kind, evidence_text, evidence_url, justification, note, actor_id
  ) values (
    p_item_id, p_opportunity_id, p_action_type,
    case when p_action_type = 'status_changed' then p_to_status else null end,
    v_applicability,
    case when p_action_type = 'assigned' then p_assignee_id else null end,
    p_target_date,
    case when p_action_type = 'evidence_attached' then p_evidence_kind else null end,
    case when p_action_type = 'evidence_attached' then nullif(btrim(p_evidence_text), '') else null end,
    case when p_action_type = 'evidence_attached' then p_evidence_url else null end,
    nullif(btrim(p_justification), ''), nullif(btrim(p_note), ''), p_actor_id
  );
  return jsonb_build_object('item', public.psi_project_tender_dossier_item(p_item_id));
end;
$$;

revoke all on function public.psi_append_tender_dossier_item_action(uuid,uuid,uuid,text,text,uuid,date,text,text,text,text,text) from public;
revoke all on function public.psi_append_tender_dossier_item_action(uuid,uuid,uuid,text,text,uuid,date,text,text,text,text,text) from anon;
revoke all on function public.psi_append_tender_dossier_item_action(uuid,uuid,uuid,text,text,uuid,date,text,text,text,text,text) from authenticated;
grant execute on function public.psi_append_tender_dossier_item_action(uuid,uuid,uuid,text,text,uuid,date,text,text,text,text,text) to service_role;
```

- [ ] **Step 3: Extiende el test PGlite con la máquina de estados y no_aplica**

Añade a `tests/tender-dossier-workspace-pglite.integration.test.mjs` (antes del `console.log` final):

```js
// Requiere una decisión GO vigente para operar. Añade tablas + semilla GO al helper freshDb().
// (Extiende freshDb: crea psi_tender_go_no_go_decisions y una fila GO vigente.)
await (async function statusAndNotApplicableProjection() {
  const db = await freshDb();
  await db.exec(migration);
  const created = (await db.query(
    `select public.psi_create_tender_dossier_item($1,$2,$3,$4,$5,$6) as r`,
    [ids.opportunity, ids.actor, 'validar_financiero', 'Validar financiero', 'pendiente_humano', true],
  )).rows[0].r;
  const itemId = created.item.id;

  const listo = (await db.query(
    `select public.psi_append_tender_dossier_item_action($1,$2,$3,'status_changed','listo') as r`,
    [ids.opportunity, itemId, ids.actor],
  )).rows[0].r;
  assert.equal(listo.item.status, 'listo');

  // Marcar no_aplica sin justificación falla.
  await assert.rejects(
    () => db.query(`select public.psi_append_tender_dossier_item_action($1,$2,$3,'marked_not_applicable',null,null,null,null,null,null,null) as r`,
      [ids.opportunity, itemId, ids.actor]),
    /justificaci/i,
  );

  // Comercial no puede marcar no_aplica (manager-only).
  await assert.rejects(
    () => db.query(`select public.psi_append_tender_dossier_item_action($1,$2,$3,'marked_not_applicable',null,null,null,null,null,null,'no aplica por pliego') as r`,
      [ids.opportunity, itemId, ids.actorComercial]),
    /permisos/i,
  );

  const naParams = [ids.opportunity, itemId, ids.actor];
  const na = (await db.query(
    `select public.psi_append_tender_dossier_item_action($1,$2,$3,'marked_not_applicable',null,null,null,null,null,null,'no aplica por pliego') as r`,
    naParams,
  )).rows[0].r;
  assert.equal(na.item.applicability, 'no_aplica');
  await db.close();
})();
```

Actualiza `freshDb()` para incluir la tabla de decisiones y una fila GO vigente:

```js
// dentro de freshDb(), añade al db.exec(...):
//   create table public.psi_tender_go_no_go_decisions (
//     id uuid primary key default gen_random_uuid(), opportunity_id uuid, tender_id uuid,
//     decision text, decided_at timestamptz default now(), supersedes_decision_id uuid);
//   insert into public.psi_tender_go_no_go_decisions(opportunity_id, tender_id, decision)
//     values ('${ids.opportunity}', '${ids.tender}', 'go');
```

- [ ] **Step 4: Corre el test completo y verifica que pasa**

Run: `node tests/tender-dossier-workspace-pglite.integration.test.mjs`
Expected: PASS → `PGlite tender dossier workspace schema passed`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/040_tender_dossier_workspace.sql tests/tender-dossier-workspace-pglite.integration.test.mjs
git commit -m "feat(tenders): RPC de ítems del expediente (crear/estado/no aplica) append-only"
```

---

### Task 3: Migración 040 — RPC de artefactos, versiones y revisiones

**Files:**
- Modify: `supabase/migrations/040_tender_dossier_workspace.sql`
- Test: extender `tests/tender-dossier-workspace-pglite.integration.test.mjs`

- [ ] **Step 1: Añade proyección + RPC de artefactos**

Inserta en `040` (antes de `commit;`):

```sql
-- Proyección de un artefacto con su última versión append-only y estado de revisión.
create or replace function public.psi_project_tender_dossier_artifact(p_artifact_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with a as (select * from public.psi_tender_dossier_artifacts where id = p_artifact_id),
  cur as (select * from public.psi_tender_dossier_artifact_versions where artifact_id = p_artifact_id order by version desc, id desc limit 1),
  cur_review as (
    select decision from public.psi_tender_dossier_artifact_reviews
    where version_id = (select id from cur) order by created_at desc, id desc limit 1),
  approved as (
    select 1 where coalesce((select decision from cur_review), 'pendiente') = 'aprobado')
  select jsonb_build_object(
    'id', a.id, 'artifact_key', a.artifact_key, 'title', a.title, 'required', a.required, 'origin', a.origin,
    'current_version', (select case when cur.id is null then null else jsonb_build_object(
      'id', cur.id, 'version', cur.version, 'content_kind', cur.content_kind,
      'content_text', cur.content_text, 'content_metadata', cur.content_metadata,
      'author_id', cur.author_id, 'created_at', cur.created_at) end from cur),
    'review_status', coalesce((select decision from cur_review), 'pendiente'),
    'has_approved_version', exists (select 1 from approved),
    'version_count', (select count(*) from public.psi_tender_dossier_artifact_versions where artifact_id = p_artifact_id)
  ) from a;
$$;

create or replace function public.psi_create_tender_dossier_artifact(
  p_opportunity_id uuid, p_actor_id uuid, p_artifact_key text, p_title text, p_required boolean
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tender_id uuid; v_artifact_id uuid;
begin
  perform public.psi_assert_tender_dossier_actor(p_actor_id, false);
  v_tender_id := public.psi_assert_tender_dossier_go(p_opportunity_id);
  if nullif(btrim(p_title), '') is null then raise exception 'El artefacto requiere un título.' using errcode = '22023'; end if;
  insert into public.psi_tender_dossier_artifacts (opportunity_id, tender_id, artifact_key, title, required, origin, created_by)
  values (p_opportunity_id, v_tender_id, btrim(p_artifact_key), btrim(p_title), coalesce(p_required, false), 'human', p_actor_id)
  on conflict (opportunity_id, artifact_key) do nothing
  returning id into v_artifact_id;
  if v_artifact_id is null then
    select id into v_artifact_id from public.psi_tender_dossier_artifacts where opportunity_id = p_opportunity_id and artifact_key = btrim(p_artifact_key);
  end if;
  return jsonb_build_object('artifact', public.psi_project_tender_dossier_artifact(v_artifact_id));
end;
$$;

create or replace function public.psi_add_tender_dossier_artifact_version(
  p_opportunity_id uuid, p_artifact_id uuid, p_actor_id uuid,
  p_content_kind text, p_content_text text, p_content_metadata jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_artifact public.psi_tender_dossier_artifacts%rowtype; v_prev uuid; v_version integer; v_id uuid;
begin
  perform public.psi_assert_tender_dossier_actor(p_actor_id, false);
  perform public.psi_assert_tender_dossier_go(p_opportunity_id);
  perform pg_advisory_xact_lock(hashtextextended('psi_dossier_artifact:' || p_artifact_id::text, 0));
  select * into v_artifact from public.psi_tender_dossier_artifacts where id = p_artifact_id;
  if not found or v_artifact.opportunity_id <> p_opportunity_id then
    raise exception 'El artefacto no pertenece a la oportunidad.' using errcode = 'P0002';
  end if;
  if p_content_kind not in ('markdown','texto','metadata') then raise exception 'Tipo de contenido inválido.' using errcode = '22023'; end if;
  select id, version into v_prev, v_version from public.psi_tender_dossier_artifact_versions
    where artifact_id = p_artifact_id order by version desc, id desc limit 1;
  insert into public.psi_tender_dossier_artifact_versions (
    artifact_id, opportunity_id, version, supersedes_version_id, content_kind, content_text, content_metadata, author_id
  ) values (
    p_artifact_id, p_opportunity_id, coalesce(v_version, 0) + 1, v_prev, p_content_kind,
    nullif(btrim(p_content_text), ''), p_content_metadata, p_actor_id
  ) returning id into v_id;
  return jsonb_build_object('artifact', public.psi_project_tender_dossier_artifact(p_artifact_id), 'version_id', v_id);
end;
$$;

create or replace function public.psi_record_tender_dossier_artifact_review(
  p_version_id uuid, p_actor_id uuid, p_decision text, p_comment text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_version public.psi_tender_dossier_artifact_versions%rowtype;
begin
  -- Aprobar/rechazar afecta el gate: decisión de manager.
  perform public.psi_assert_tender_dossier_actor(p_actor_id, true);
  select * into v_version from public.psi_tender_dossier_artifact_versions where id = p_version_id;
  if not found then raise exception 'La versión no existe.' using errcode = 'P0002'; end if;
  perform public.psi_assert_tender_dossier_go(v_version.opportunity_id);
  if p_decision not in ('aprobado','rechazado') then raise exception 'Decisión de revisión inválida.' using errcode = '22023'; end if;
  if p_decision = 'rechazado' and nullif(btrim(p_comment), '') is null then
    raise exception 'Rechazar requiere un comentario.' using errcode = '22023';
  end if;
  insert into public.psi_tender_dossier_artifact_reviews (version_id, artifact_id, opportunity_id, decision, comment, reviewer_id)
  values (p_version_id, v_version.artifact_id, v_version.opportunity_id, p_decision, nullif(btrim(p_comment), ''), p_actor_id);
  return jsonb_build_object('artifact', public.psi_project_tender_dossier_artifact(v_version.artifact_id));
end;
$$;

revoke all on function public.psi_create_tender_dossier_artifact(uuid,uuid,text,text,boolean) from public;
revoke all on function public.psi_create_tender_dossier_artifact(uuid,uuid,text,text,boolean) from anon;
revoke all on function public.psi_create_tender_dossier_artifact(uuid,uuid,text,text,boolean) from authenticated;
grant execute on function public.psi_create_tender_dossier_artifact(uuid,uuid,text,text,boolean) to service_role;
revoke all on function public.psi_add_tender_dossier_artifact_version(uuid,uuid,uuid,text,text,jsonb) from public;
revoke all on function public.psi_add_tender_dossier_artifact_version(uuid,uuid,uuid,text,text,jsonb) from anon;
revoke all on function public.psi_add_tender_dossier_artifact_version(uuid,uuid,uuid,text,text,jsonb) from authenticated;
grant execute on function public.psi_add_tender_dossier_artifact_version(uuid,uuid,uuid,text,text,jsonb) to service_role;
revoke all on function public.psi_record_tender_dossier_artifact_review(uuid,uuid,text,text) from public;
revoke all on function public.psi_record_tender_dossier_artifact_review(uuid,uuid,text,text) from anon;
revoke all on function public.psi_record_tender_dossier_artifact_review(uuid,uuid,text,text) from authenticated;
grant execute on function public.psi_record_tender_dossier_artifact_review(uuid,uuid,text,text) to service_role;
```

- [ ] **Step 2: Extiende el test (versión → revisión → proyección)**

Añade a `tests/tender-dossier-workspace-pglite.integration.test.mjs`:

```js
await (async function artifactVersionAndReview() {
  const db = await freshDb();
  await db.exec(migration);
  const art = (await db.query(
    `select public.psi_create_tender_dossier_artifact($1,$2,$3,$4,$5) as r`,
    [ids.opportunity, ids.actor, 'carta_presentacion', 'Carta de presentación', true],
  )).rows[0].r;
  const artifactId = art.artifact.id;
  assert.equal(art.artifact.review_status, 'pendiente');

  const v1 = (await db.query(
    `select public.psi_add_tender_dossier_artifact_version($1,$2,$3,'markdown','# Carta v1', null) as r`,
    [ids.opportunity, artifactId, ids.actor],
  )).rows[0].r;
  assert.equal(v1.artifact.current_version.version, 1);

  // Rechazar sin comentario falla.
  await assert.rejects(
    () => db.query(`select public.psi_record_tender_dossier_artifact_review($1,$2,'rechazado',null) as r`, [v1.version_id, ids.actor]),
    /comentario/i,
  );

  const approved = (await db.query(
    `select public.psi_record_tender_dossier_artifact_review($1,$2,'aprobado','ok') as r`,
    [v1.version_id, ids.actor],
  )).rows[0].r;
  assert.equal(approved.artifact.review_status, 'aprobado');
  assert.equal(approved.artifact.has_approved_version, true);

  // Nueva versión: la proyección vigente avanza a v2 sin mutar v1; review_status vuelve a pendiente y la aprobación histórica no habilita v2.
  const v2 = (await db.query(
    `select public.psi_add_tender_dossier_artifact_version($1,$2,$3,'markdown','# Carta v2', null) as r`,
    [ids.opportunity, artifactId, ids.actor],
  )).rows[0].r;
  assert.equal(v2.artifact.current_version.version, 2);
  assert.equal(v2.artifact.review_status, 'pendiente');
  assert.equal(v2.artifact.has_approved_version, false);
  await db.close();
})();
```

- [ ] **Step 3: Corre y verifica PASS**

Run: `node tests/tender-dossier-workspace-pglite.integration.test.mjs`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/040_tender_dossier_workspace.sql tests/tender-dossier-workspace-pglite.integration.test.mjs
git commit -m "feat(tenders): artefactos con versiones y revisiones append-only"
```

---

### Task 4: Migración 040 — RPC de lectura del workspace + tipos de evento comercial

**Files:**
- Modify: `supabase/migrations/040_tender_dossier_workspace.sql`
- Test: extender `tests/tender-dossier-workspace-pglite.integration.test.mjs`

- [ ] **Step 1: Añade nuevos `event_type` comerciales al CHECK (patrón `033`)**

Inserta en `040` (antes de `commit;`). Reemplaza la lista completa **añadiendo** los tres nuevos tipos a la lista vigente de `027`/`033`:

```sql
-- Ampliar el catálogo de event_type con hitos comerciales del expediente (Lote 2).
-- El CHECK no es acumulativo: se re-declara con la lista completa.
alter table public.psi_tender_tracking_events drop constraint if exists psi_tender_tracking_events_event_type_check;
alter table public.psi_tender_tracking_events add constraint psi_tender_tracking_events_event_type_check
  check (event_type in (
    'entered_tracking','tracking_updated','assigned','blocked','unblocked','returned_to_radar','converted','discarded',
    'detected','pipeline_queued',
    'document_discovery_started','document_import_progress','document_import_completed','document_import_partial','document_import_failed',
    'snapshot_published',
    'analysis_queued','analysis_started','analysis_completed','analysis_failed','analysis_rules_fallback_shown',
    'requirement_pending','information_requested','addendum_reviewed','observation_recorded','internal_meeting','case_note',
    'go_decided','no_go_decided','offer_preparation_started','offer_submitted','awarded','not_awarded','cancelled','deserted',
    'dossier_seeded','dossier_artifact_approved','offer_ready_for_submission'));
```

> Nota: si tu entorno PGlite de test no crea `psi_tender_tracking_events` con el CHECK original, el `drop constraint if exists` lo tolera. Emítelo aunque la tabla se cree mínima en el test.

- [ ] **Step 2: Añade `psi_get_tender_dossier_workspace`**

```sql
-- Lectura canónica del expediente: checklist proyectado, artefactos, readiness.
-- El timeline comercial se compone en el adapter; esta RPC entrega checklist/artefactos/readiness.
create or replace function public.psi_get_tender_dossier_workspace(p_opportunity_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with items as (
    select public.psi_project_tender_dossier_item(i.id) as it
    from public.psi_tender_dossier_items i where i.opportunity_id = p_opportunity_id
    order by i.created_at, i.id),
  artifacts as (
    select public.psi_project_tender_dossier_artifact(a.id) as ar
    from public.psi_tender_dossier_artifacts a where a.opportunity_id = p_opportunity_id
    order by a.created_at, a.id)
  select jsonb_build_object(
    'opportunity_id', p_opportunity_id,
    'checklist', coalesce((select jsonb_agg(it) from items), '[]'::jsonb),
    'artifacts', coalesce((select jsonb_agg(ar) from artifacts), '[]'::jsonb),
    'readiness', public.psi_evaluate_tender_dossier_readiness(p_opportunity_id)
  );
$$;

revoke all on function public.psi_get_tender_dossier_workspace(uuid) from public;
revoke all on function public.psi_get_tender_dossier_workspace(uuid) from anon;
revoke all on function public.psi_get_tender_dossier_workspace(uuid) from authenticated;
grant execute on function public.psi_get_tender_dossier_workspace(uuid) to service_role;
```

> `psi_evaluate_tender_dossier_readiness` se define en la migración `042` (Task 8). Como `psi_get_tender_dossier_workspace` la referencia por nombre en un cuerpo `language sql`, PostgreSQL resuelve la referencia en tiempo de ejecución, así que `040` puede crearse antes que `042` sin error de dependencia **siempre que `042` exista antes de la primera invocación**. Para que el test PGlite de `040` pueda invocar la RPC de lectura de forma aislada, incluye un **stub temporal** de readiness dentro del propio `040`, que `042` reemplazará con `create or replace`:

```sql
-- Stub de readiness (definición completa en migración 042). Permite que 040 sea autoconsistente.
create or replace function public.psi_evaluate_tender_dossier_readiness(p_opportunity_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('ready', false, 'pending_required_items', '[]'::jsonb,
    'blocking_items', '[]'::jsonb, 'unapproved_artifacts', '[]'::jsonb, 'active_blockers', '[]'::jsonb);
$$;
revoke all on function public.psi_evaluate_tender_dossier_readiness(uuid) from public;
revoke all on function public.psi_evaluate_tender_dossier_readiness(uuid) from anon;
revoke all on function public.psi_evaluate_tender_dossier_readiness(uuid) from authenticated;
grant execute on function public.psi_evaluate_tender_dossier_readiness(uuid) to service_role;
```

- [ ] **Step 3: Extiende el test (workspace read)**

```js
await (async function workspaceReadComposes() {
  const db = await freshDb();
  await db.exec(migration);
  await db.query(`select public.psi_create_tender_dossier_item($1,$2,$3,$4,$5,$6)`,
    [ids.opportunity, ids.actor, 'k1', 'Item 1', 'pendiente_humano', true]);
  await db.query(`select public.psi_create_tender_dossier_artifact($1,$2,$3,$4,$5)`,
    [ids.opportunity, ids.actor, 'carta_presentacion', 'Carta', true]);
  const ws = (await db.query(`select public.psi_get_tender_dossier_workspace($1) as r`, [ids.opportunity])).rows[0].r;
  assert.equal(ws.checklist.length, 1);
  assert.equal(ws.artifacts.length, 1);
  assert.equal(ws.readiness.ready, false);
  await db.close();
})();
```

- [ ] **Step 4: Corre y verifica PASS. Commit.**

```bash
git add supabase/migrations/040_tender_dossier_workspace.sql tests/tender-dossier-workspace-pglite.integration.test.mjs
git commit -m "feat(tenders): RPC de lectura del workspace + hitos comerciales del timeline"
```

---

### Task 5: Prueba estática de la migración 040 (grants/append-only/idempotencia por regex)

**Files:**
- Create: `tests/tender-dossier-workspace-migration.test.mjs`

- [ ] **Step 1: Escribe el test estático**

```js
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
const sql = readFileSync(new URL('../supabase/migrations/040_tender_dossier_workspace.sql', import.meta.url), 'utf8');

assert.match(sql, /^begin;/m);
assert.match(sql, /commit;\s*$/);
for (const t of ['psi_tender_dossier_items','psi_tender_dossier_item_actions','psi_tender_dossier_artifacts',
  'psi_tender_dossier_artifact_versions','psi_tender_dossier_artifact_reviews']) {
  assert.match(sql, new RegExp(`create table if not exists public.${t}`), `falta tabla ${t}`);
  assert.match(sql, new RegExp(`grant select on table public.${t} to service_role`), `falta grant ${t}`);
  assert.match(sql, new RegExp(`revoke all on table public.${t} from service_role`), `falta revoke ${t}`);
}
assert.match(sql, /is append-only: UPDATE and DELETE are prohibited/);
assert.match(sql, /security definer\s+set search_path = public, pg_temp/);
// Ninguna RPC concede execute a authenticated/anon/public.
assert.doesNotMatch(sql, /grant execute on function[^\n]*to (public|anon|authenticated)/);
// Nuevos tipos de evento comercial presentes.
for (const e of ['dossier_seeded','dossier_artifact_approved','offer_ready_for_submission']) {
  assert.match(sql, new RegExp(`'${e}'`), `falta event_type ${e}`);
}
console.log('tender dossier workspace migration static checks passed');
```

- [ ] **Step 2: Corre y verifica PASS. Commit.**

Run: `node tests/tender-dossier-workspace-migration.test.mjs`

```bash
git add tests/tender-dossier-workspace-migration.test.mjs
git commit -m "test(tenders): checks estáticos de la migración 040"
```

---

### Task 6: Migración 041 — semilla al GO (idempotente) + wrapper de `psi_record_tender_go_no_go`

**Files:**
- Create: `supabase/migrations/041_tender_dossier_go_seed.sql`
- Test: `tests/tender-dossier-go-seed-pglite.integration.test.mjs`

- [ ] **Step 1: Escribe el test PGlite de siembra**

Create `tests/tender-dossier-go-seed-pglite.integration.test.mjs`. Prueba que `psi_seed_tender_dossier` siembra ítems/artefactos desde la preparación, es idempotente, y que el wrapper de GO la invoca.

```js
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const m040 = readFileSync(new URL('../supabase/migrations/040_tender_dossier_workspace.sql', import.meta.url), 'utf8');
const m041 = readFileSync(new URL('../supabase/migrations/041_tender_dossier_go_seed.sql', import.meta.url), 'utf8');

const ids = {
  actor: '11111111-1111-4111-8111-111111111111',
  opportunity: '22222222-2222-4222-8222-222222222222',
  tender: '33333333-3333-4333-8333-333333333333',
};
const preparation = {
  kind: 'tender_offer_preparation',
  human_required_items: [
    { key: 'validar_experiencia', title: 'Validar experiencia', priority: 'alta' },
    { key: 'camara_comercio', title: 'Cámara de Comercio', priority: 'media' },
  ],
  planned_documents: [
    { key: 'carta_presentacion', name: 'Carta de presentación' },
    { key: 'indice_expediente', name: 'Índice del expediente' },
  ],
};

async function seededDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.psi_sales_profiles (id uuid primary key, active boolean default true, identity_type text default 'human', role text, full_name text);
    create table public.psi_access_permissions (code text primary key, active boolean default true);
    create table public.psi_profile_permissions (profile_id uuid, permission_code text);
    create table public.psi_sales_opportunities (id uuid primary key, tender_offer_status text);
    create table public.psi_public_tenders (id uuid primary key, converted_opportunity_id uuid);
    create table public.psi_tender_go_no_go_decisions (id uuid primary key default gen_random_uuid(),
      opportunity_id uuid, tender_id uuid, decision text, decided_at timestamptz default now(), supersedes_decision_id uuid);
    create table public.psi_sales_interactions (id uuid primary key default gen_random_uuid(),
      opportunity_id uuid, interaction_type text, created_by uuid, occurred_at timestamptz default now(), notes text);
    create or replace function public.psi_safe_jsonb(p text) returns jsonb language plpgsql immutable as $$
      begin return p::jsonb; exception when others then return null; end; $$;
    insert into public.psi_access_permissions(code) values ('licitaciones');
    insert into public.psi_sales_profiles(id, role, full_name) values ('${ids.actor}','director','Dir');
    insert into public.psi_profile_permissions values ('${ids.actor}','licitaciones');
    insert into public.psi_sales_opportunities values ('${ids.opportunity}','en_preparacion');
    insert into public.psi_public_tenders values ('${ids.tender}','${ids.opportunity}');
    insert into public.psi_tender_go_no_go_decisions(opportunity_id, tender_id, decision) values ('${ids.opportunity}','${ids.tender}','go');
    insert into public.psi_sales_interactions(opportunity_id, interaction_type, created_by, notes)
      values ('${ids.opportunity}','documento','${ids.actor}', $prep$${JSON.stringify(preparation)}$prep$);
  `);
  await db.exec(m040);
  await db.exec(m041);
  return db;
}

await (async function seedFromPreparationIsIdempotent() {
  const db = await seededDb();
  const first = (await db.query(`select public.psi_seed_tender_dossier($1,$2) as r`, [ids.opportunity, ids.actor])).rows[0].r;
  assert.equal(first.seeded, true);
  const second = (await db.query(`select public.psi_seed_tender_dossier($1,$2) as r`, [ids.opportunity, ids.actor])).rows[0].r;
  // Re-ejecutar no crea duplicados.
  const items = Number((await db.query(`select count(*)::int c from public.psi_tender_dossier_items where opportunity_id=$1`, [ids.opportunity])).rows[0].c);
  const artifacts = Number((await db.query(`select count(*)::int c from public.psi_tender_dossier_artifacts where opportunity_id=$1`, [ids.opportunity])).rows[0].c);
  assert.equal(items, 4); // 2 pendientes humanos + 2 documentos como ítems
  assert.equal(artifacts, 2);
  // required correcto: todo pendiente humano sembrado, sea prioridad alta o media, queda requerido.
  const reqItem = (await db.query(`select required from public.psi_tender_dossier_items where opportunity_id=$1 and item_key='validar_experiencia'`, [ids.opportunity])).rows[0];
  assert.equal(reqItem.required, true);
  const reqMedium = (await db.query(`select required from public.psi_tender_dossier_items where opportunity_id=$1 and item_key='camara_comercio'`, [ids.opportunity])).rows[0];
  assert.equal(reqMedium.required, true);
  const reqArt = (await db.query(`select required from public.psi_tender_dossier_artifacts where opportunity_id=$1 and artifact_key='carta_presentacion'`, [ids.opportunity])).rows[0];
  assert.equal(reqArt.required, true);
  await db.close();
})();

console.log('PGlite tender dossier GO seed passed');
```

- [ ] **Step 2: Corre y verifica que falla**

Run: `node tests/tender-dossier-go-seed-pglite.integration.test.mjs`
Expected: FAIL (041 no existe).

- [ ] **Step 3: Crea la migración 041**

Create `supabase/migrations/041_tender_dossier_go_seed.sql`:

```sql
-- Siembra idempotente del expediente al GO desde la preparación de oferta vigente.
-- Reejecutable como backfill NO destructivo. Sin LLM, 100% determinístico.
begin;

-- Artefactos obligatorios (deben tener versión humana aprobada para el gate).
-- Todos los pendientes humanos sembrados son requeridos. La salida excepcional es no_aplica justificado y aprobado.
create or replace function public.psi_seed_tender_dossier(p_opportunity_id uuid, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tender_id uuid;
  v_prep jsonb;
  v_item jsonb;
  v_seeded boolean := false;
  v_required_artifacts text[] := array['carta_presentacion','declaracion_no_inhabilidades','matriz_cumplimiento','propuesta_tecnica_base'];
  v_new_item_id uuid;
  v_new_artifact_id uuid;
begin
  -- No exige rol manager: se invoca desde el wrapper de GO (ya autorizado) y como backfill de servicio.
  perform public.psi_assert_tender_dossier_actor(p_actor_id, false);
  v_tender_id := public.psi_assert_tender_dossier_go(p_opportunity_id);

  select public.psi_safe_jsonb(i.notes) into v_prep
    from public.psi_sales_interactions i
    where i.opportunity_id = p_opportunity_id and i.interaction_type = 'documento'
      and public.psi_safe_jsonb(i.notes)->>'kind' = 'tender_offer_preparation'
    order by i.occurred_at desc, i.id desc limit 1;
  if v_prep is null then
    return jsonb_build_object('seeded', false, 'reason', 'sin_preparacion');
  end if;

  -- Ítems: pendientes humanos.
  for v_item in select * from jsonb_array_elements(coalesce(v_prep->'human_required_items', '[]'::jsonb)) loop
    if nullif(btrim(v_item->>'key'), '') is null then continue; end if;
    insert into public.psi_tender_dossier_items (opportunity_id, tender_id, item_key, title, item_type, required, origin, created_by)
    values (p_opportunity_id, v_tender_id, v_item->>'key', coalesce(nullif(btrim(v_item->>'title'), ''), v_item->>'key'),
            'pendiente_humano', true, 'seed_go', p_actor_id)
    on conflict (opportunity_id, item_key) do nothing
    returning id into v_new_item_id;
    if v_new_item_id is not null then
      insert into public.psi_tender_dossier_item_actions (item_id, opportunity_id, action_type, to_status, applicability, actor_id)
      values (v_new_item_id, p_opportunity_id, 'created', 'pendiente', 'requerido', p_actor_id);
      v_seeded := true;
    end if;
  end loop;

  -- Ítems: documentos planificados (como ítem informativo) + artefactos (identidad).
  for v_item in select * from jsonb_array_elements(coalesce(v_prep->'planned_documents', '[]'::jsonb)) loop
    if nullif(btrim(v_item->>'key'), '') is null then continue; end if;
    insert into public.psi_tender_dossier_items (opportunity_id, tender_id, item_key, title, item_type, required, origin, created_by)
    values (p_opportunity_id, v_tender_id, 'doc_' || (v_item->>'key'),
            coalesce(nullif(btrim(v_item->>'name'), ''), v_item->>'key'), 'documento', false, 'seed_go', p_actor_id)
    on conflict (opportunity_id, item_key) do nothing
    returning id into v_new_item_id;
    if v_new_item_id is not null then
      insert into public.psi_tender_dossier_item_actions (item_id, opportunity_id, action_type, to_status, applicability, actor_id)
      values (v_new_item_id, p_opportunity_id, 'created', 'pendiente', 'requerido', p_actor_id);
      v_seeded := true;
    end if;

    insert into public.psi_tender_dossier_artifacts (opportunity_id, tender_id, artifact_key, title, required, origin, created_by)
    values (p_opportunity_id, v_tender_id, v_item->>'key', coalesce(nullif(btrim(v_item->>'name'), ''), v_item->>'key'),
            (v_item->>'key') = any(v_required_artifacts), 'seed_go', p_actor_id)
    on conflict (opportunity_id, artifact_key) do nothing
    returning id into v_new_artifact_id;
    if v_new_artifact_id is not null then v_seeded := true; end if;
  end loop;

  if v_seeded then
    perform public.psi_append_tender_tracking_event(
      v_tender_id, 'dossier_seeded', 'human', p_actor_id, 'dossier', p_opportunity_id,
      jsonb_build_object('opportunity_id', p_opportunity_id), 'Expediente operativo sembrado desde la preparación.', true);
  end if;
  return jsonb_build_object('seeded', v_seeded);
end;
$$;

revoke all on function public.psi_seed_tender_dossier(uuid,uuid) from public;
revoke all on function public.psi_seed_tender_dossier(uuid,uuid) from anon;
revoke all on function public.psi_seed_tender_dossier(uuid,uuid) from authenticated;
grant execute on function public.psi_seed_tender_dossier(uuid,uuid) to service_role;

-- Wrapper de GO (rename-to-core, patrón migración 039).
do $$
begin
  if to_regprocedure('public.psi_record_tender_go_no_go_core_041(uuid,uuid,uuid,text,uuid,text,jsonb,text)') is null then
    if to_regprocedure('public.psi_record_tender_go_no_go(uuid,uuid,uuid,text,uuid,text,jsonb,text)') is null then
      raise exception 'Migration 041 requires the eight-argument psi_record_tender_go_no_go RPC.';
    end if;
    execute 'alter function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text) rename to psi_record_tender_go_no_go_core_041';
  end if;
end;
$$;

revoke all on function public.psi_record_tender_go_no_go_core_041(uuid, uuid, uuid, text, uuid, text, jsonb, text) from public;
revoke all on function public.psi_record_tender_go_no_go_core_041(uuid, uuid, uuid, text, uuid, text, jsonb, text) from anon;
revoke all on function public.psi_record_tender_go_no_go_core_041(uuid, uuid, uuid, text, uuid, text, jsonb, text) from authenticated;
revoke all on function public.psi_record_tender_go_no_go_core_041(uuid, uuid, uuid, text, uuid, text, jsonb, text) from service_role;

create or replace function public.psi_record_tender_go_no_go(
  p_opportunity_id uuid, p_tender_id uuid, p_actor_id uuid, p_decision text,
  p_analysis_run_id uuid, p_justification text, p_preparation jsonb, p_document_hash text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_result jsonb;
begin
  v_result := public.psi_record_tender_go_no_go_core_041(
    p_opportunity_id, p_tender_id, p_actor_id, p_decision, p_analysis_run_id, p_justification, p_preparation, p_document_hash);
  if p_decision = 'go' then
    perform public.psi_seed_tender_dossier(p_opportunity_id, p_actor_id);
  end if;
  return v_result;
end;
$$;

revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text) from public;
revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text) from anon;
revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text) from authenticated;
revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text) from service_role;
grant execute on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text) to service_role;

commit;
```

- [ ] **Step 4: Corre y verifica PASS.**

Run: `node tests/tender-dossier-go-seed-pglite.integration.test.mjs`
Expected: PASS → `PGlite tender dossier GO seed passed`

- [ ] **Step 5: Añade caso de wrapper GO (opcional pero recomendado)**

Si tu entorno de test puede montar un stub de `psi_record_tender_go_no_go_core_041` (crea antes de `m041` una función `psi_record_tender_go_no_go(...)` mínima que inserte la preparación y devuelva `{}`), verifica que tras `psi_record_tender_go_no_go(..., 'go', ...)` existen ítems sembrados. Si el stub es demasiado costoso, cubre el wrapper con el test estático de Task 11 (regex sobre el `alter function ... rename` y la llamada a `psi_seed_tender_dossier`).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/041_tender_dossier_go_seed.sql tests/tender-dossier-go-seed-pglite.integration.test.mjs
git commit -m "feat(tenders): siembra idempotente del expediente al GO + wrapper de decisión"
```

---

### Task 7: Migración 042 — readiness + gate de `lista_para_presentar`

**Files:**
- Create: `supabase/migrations/042_tender_dossier_offer_gate.sql`
- Test: `tests/tender-dossier-offer-gate-pglite.integration.test.mjs`

- [ ] **Step 1: Escribe el test PGlite del gate**

Create `tests/tender-dossier-offer-gate-pglite.integration.test.mjs`. Debe: sembrar 1 ítem requerido + 1 artefacto requerido; verificar que la transición a `lista_para_presentar` **falla** hasta que el ítem esté `listo` (o `no_aplica`) y el artefacto tenga versión aprobada y no haya ítems `bloqueado`; luego **pasa**.

```js
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const files = ['040_tender_dossier_workspace','041_tender_dossier_go_seed','042_tender_dossier_offer_gate']
  .map(n => readFileSync(new URL(`../supabase/migrations/${n}.sql`, import.meta.url), 'utf8'));

const ids = {
  actor: '11111111-1111-4111-8111-111111111111',
  opportunity: '22222222-2222-4222-8222-222222222222',
  tender: '33333333-3333-4333-8333-333333333333',
};

async function gateDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.psi_sales_profiles (id uuid primary key, active boolean default true, identity_type text default 'human', role text, full_name text);
    create table public.psi_access_permissions (code text primary key, active boolean default true);
    create table public.psi_profile_permissions (profile_id uuid, permission_code text);
    create table public.psi_sales_opportunities (id uuid primary key, tender_offer_status text);
    create table public.psi_public_tenders (id uuid primary key, converted_opportunity_id uuid);
    create table public.psi_tender_go_no_go_decisions (id uuid primary key default gen_random_uuid(),
      opportunity_id uuid, tender_id uuid, decision text, decided_at timestamptz default now(), supersedes_decision_id uuid);
    -- tabla de transiciones append-only y función core mínima que 042 renombrará.
    create table public.psi_tender_offer_status_transitions (id uuid primary key default gen_random_uuid(),
      opportunity_id uuid, tender_id uuid, actor_id uuid, from_status text, to_status text, note text, changed_at timestamptz default now());
    create or replace function public.psi_transition_tender_offer_status(
      p_opportunity_id uuid, p_actor_id uuid, p_to_status text, p_expected_current_status text, p_note text default null)
    returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
    begin
      update public.psi_sales_opportunities set tender_offer_status = p_to_status where id = p_opportunity_id;
      return jsonb_build_object('status', p_to_status);
    end; $$;
    grant execute on function public.psi_transition_tender_offer_status(uuid,uuid,text,text,text) to service_role;
    insert into public.psi_access_permissions(code) values ('licitaciones');
    insert into public.psi_sales_profiles(id, role, full_name) values ('${ids.actor}','director','Dir');
    insert into public.psi_profile_permissions values ('${ids.actor}','licitaciones');
    insert into public.psi_sales_opportunities values ('${ids.opportunity}','en_preparacion');
    insert into public.psi_public_tenders values ('${ids.tender}','${ids.opportunity}');
    insert into public.psi_tender_go_no_go_decisions(opportunity_id, tender_id, decision) values ('${ids.opportunity}','${ids.tender}','go');
  `);
  for (const sql of files) await db.exec(sql);
  return db;
}

await (async function gateBlocksUntilReady() {
  const db = await gateDb();
  const itemId = (await db.query(`select public.psi_create_tender_dossier_item($1,$2,$3,$4,$5,$6) as r`,
    [ids.opportunity, ids.actor, 'validar_experiencia', 'Exp', 'pendiente_humano', true])).rows[0].r.item.id;
  const artId = (await db.query(`select public.psi_create_tender_dossier_artifact($1,$2,$3,$4,$5) as r`,
    [ids.opportunity, ids.actor, 'carta_presentacion', 'Carta', true])).rows[0].r.artifact.id;

  // 1) Bloqueado: ítem pendiente y artefacto sin aprobar.
  await assert.rejects(
    () => db.query(`select public.psi_transition_tender_offer_status($1,$2,'lista_para_presentar','en_preparacion',null)`,
      [ids.opportunity, ids.actor]),
    /expediente no está listo|requerido|aprobad/i,
  );

  // 2) Resolver ítem y aprobar artefacto.
  await db.query(`select public.psi_append_tender_dossier_item_action($1,$2,$3,'status_changed','listo')`, [ids.opportunity, itemId, ids.actor]);
  const vId = (await db.query(`select public.psi_add_tender_dossier_artifact_version($1,$2,$3,'markdown','# c', null) as r`,
    [ids.opportunity, artId, ids.actor])).rows[0].r.version_id;
  await db.query(`select public.psi_record_tender_dossier_artifact_review($1,$2,'aprobado','ok')`, [vId, ids.actor]);

  const ready = (await db.query(`select public.psi_evaluate_tender_dossier_readiness($1) as r`, [ids.opportunity])).rows[0].r;
  assert.equal(ready.ready, true);

  // 3) Ahora la transición pasa.
  const t = (await db.query(`select public.psi_transition_tender_offer_status($1,$2,'lista_para_presentar','en_preparacion',null) as r`,
    [ids.opportunity, ids.actor])).rows[0].r;
  assert.equal(t.status, 'lista_para_presentar');

  // 4) Otros destinos NO pasan por el gate (p.ej. presentada), delegan directo al core.
  await db.close();
})();

await (async function blockerBlocksReadiness() {
  const db = await gateDb();
  const itemId = (await db.query(`select public.psi_create_tender_dossier_item($1,$2,$3,$4,$5,$6) as r`,
    [ids.opportunity, ids.actor, 'k', 'K', 'general', false])).rows[0].r.item.id;
  await db.query(`select public.psi_append_tender_dossier_item_action($1,$2,$3,'status_changed','bloqueado')`, [ids.opportunity, itemId, ids.actor]);
  const ready = (await db.query(`select public.psi_evaluate_tender_dossier_readiness($1) as r`, [ids.opportunity])).rows[0].r;
  assert.equal(ready.ready, false);
  assert.ok(ready.active_blockers.length >= 1);
  await db.close();
})();

console.log('PGlite tender dossier offer gate passed');
```

- [ ] **Step 2: Corre y verifica que falla.**

Run: `node tests/tender-dossier-offer-gate-pglite.integration.test.mjs`
Expected: FAIL (042 no existe).

- [ ] **Step 3: Crea la migración 042**

Create `supabase/migrations/042_tender_dossier_offer_gate.sql`:

```sql
-- Gate humano determinístico para lista_para_presentar. Envuelve la transición existente
-- sin cambiar su autorización (rename-to-core, patrón 039). No permite lista_para_presentar
-- hasta que: ítems requeridos listos/no_aplica, artefactos obligatorios aprobados, sin bloqueantes.
begin;

-- Definición COMPLETA de readiness (reemplaza el stub de 040 vía create or replace).
create or replace function public.psi_evaluate_tender_dossier_readiness(p_opportunity_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with proj as (
    select i.id, i.item_key, i.title, i.required, public.psi_project_tender_dossier_item(i.id) as p
    from public.psi_tender_dossier_items i where i.opportunity_id = p_opportunity_id),
  items as (
    select id, item_key, title, required, p->>'status' as status, p->>'applicability' as applicability from proj),
  pending_required as (
    select item_key, title from items
    where required and not (status = 'listo' or applicability = 'no_aplica')),
  blockers as (
    select item_key, title from items where status = 'bloqueado'),
  art as (
    select a.artifact_key, a.title, public.psi_project_tender_dossier_artifact(a.id)->>'has_approved_version' as approved
    from public.psi_tender_dossier_artifacts a where a.opportunity_id = p_opportunity_id and a.required),
  unapproved as (select artifact_key, title from art where approved is distinct from 'true')
  select jsonb_build_object(
    'ready', not exists (select 1 from pending_required)
         and not exists (select 1 from blockers)
         and not exists (select 1 from unapproved),
    'pending_required_items', coalesce((select jsonb_agg(jsonb_build_object('item_key', item_key, 'title', title)) from pending_required), '[]'::jsonb),
    'blocking_items', coalesce((select jsonb_agg(jsonb_build_object('item_key', item_key, 'title', title)) from blockers), '[]'::jsonb),
    'active_blockers', coalesce((select jsonb_agg(jsonb_build_object('item_key', item_key, 'title', title)) from blockers), '[]'::jsonb),
    'unapproved_artifacts', coalesce((select jsonb_agg(jsonb_build_object('artifact_key', artifact_key, 'title', title)) from unapproved), '[]'::jsonb)
  );
$$;

revoke all on function public.psi_evaluate_tender_dossier_readiness(uuid) from public;
revoke all on function public.psi_evaluate_tender_dossier_readiness(uuid) from anon;
revoke all on function public.psi_evaluate_tender_dossier_readiness(uuid) from authenticated;
grant execute on function public.psi_evaluate_tender_dossier_readiness(uuid) to service_role;

-- Wrapper de transición (rename-to-core).
do $$
begin
  if to_regprocedure('public.psi_transition_tender_offer_status_core_042(uuid,uuid,text,text,text)') is null then
    if to_regprocedure('public.psi_transition_tender_offer_status(uuid,uuid,text,text,text)') is null then
      raise exception 'Migration 042 requires psi_transition_tender_offer_status.';
    end if;
    execute 'alter function public.psi_transition_tender_offer_status(uuid, uuid, text, text, text) rename to psi_transition_tender_offer_status_core_042';
  end if;
end;
$$;

revoke all on function public.psi_transition_tender_offer_status_core_042(uuid, uuid, text, text, text) from public;
revoke all on function public.psi_transition_tender_offer_status_core_042(uuid, uuid, text, text, text) from anon;
revoke all on function public.psi_transition_tender_offer_status_core_042(uuid, uuid, text, text, text) from authenticated;
revoke all on function public.psi_transition_tender_offer_status_core_042(uuid, uuid, text, text, text) from service_role;

create or replace function public.psi_transition_tender_offer_status(
  p_opportunity_id uuid, p_actor_id uuid, p_to_status text, p_expected_current_status text, p_note text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_readiness jsonb; v_result jsonb; v_tender_id uuid;
begin
  -- Gate SOLO al pasar a lista_para_presentar. El core sigue autorizando (rol admin/gerencia/director).
  if p_to_status = 'lista_para_presentar' then
    v_readiness := public.psi_evaluate_tender_dossier_readiness(p_opportunity_id);
    if coalesce((v_readiness->>'ready')::boolean, false) is not true then
      raise exception 'El expediente no está listo para presentar: %',
        v_readiness using errcode = '23514';
    end if;
  end if;

  v_result := public.psi_transition_tender_offer_status_core_042(
    p_opportunity_id, p_actor_id, p_to_status, p_expected_current_status, p_note);

  if p_to_status = 'lista_para_presentar' then
    select t.id into v_tender_id from public.psi_public_tenders t where t.converted_opportunity_id = p_opportunity_id order by t.id limit 1;
    if v_tender_id is not null then
      perform public.psi_append_tender_tracking_event(
        v_tender_id, 'offer_ready_for_submission', 'human', p_actor_id, 'offer_status', p_opportunity_id,
        jsonb_build_object('opportunity_id', p_opportunity_id), 'La oferta quedó lista para presentar.', true);
    end if;
  end if;
  return v_result;
end;
$$;

revoke all on function public.psi_transition_tender_offer_status(uuid, uuid, text, text, text) from public;
revoke all on function public.psi_transition_tender_offer_status(uuid, uuid, text, text, text) from anon;
revoke all on function public.psi_transition_tender_offer_status(uuid, uuid, text, text, text) from authenticated;
revoke all on function public.psi_transition_tender_offer_status(uuid, uuid, text, text, text) from service_role;
grant execute on function public.psi_transition_tender_offer_status(uuid, uuid, text, text, text) to service_role;

commit;
```

> Importante: el gate se ejecuta **antes** del core, pero el core sigue siendo quien autoriza el rol y valida la arista/concurrencia. Así "solo humano autorizado ejecuta la transición ya existente" se mantiene; el wrapper únicamente añade la precondición de readiness. La emisión del evento comercial ocurre tras el éxito del core.

- [ ] **Step 4: Corre y verifica PASS.**

Run: `node tests/tender-dossier-offer-gate-pglite.integration.test.mjs`
Expected: PASS → `PGlite tender dossier offer gate passed`

- [ ] **Step 5: Extiende el test estático de migración con 041 y 042**

Añade a `tests/tender-dossier-workspace-migration.test.mjs` (o crea aserciones en un bloque nuevo dentro del mismo archivo):

```js
const sql041 = readFileSync(new URL('../supabase/migrations/041_tender_dossier_go_seed.sql', import.meta.url), 'utf8');
assert.match(sql041, /rename to psi_record_tender_go_no_go_core_041/);
assert.match(sql041, /perform public\.psi_seed_tender_dossier\(p_opportunity_id, p_actor_id\)/);
assert.match(sql041, /on conflict \(opportunity_id, item_key\) do nothing/);
const sql042 = readFileSync(new URL('../supabase/migrations/042_tender_dossier_offer_gate.sql', import.meta.url), 'utf8');
assert.match(sql042, /rename to psi_transition_tender_offer_status_core_042/);
assert.match(sql042, /if p_to_status = 'lista_para_presentar' then/);
assert.match(sql042, /grant execute on function public\.psi_transition_tender_offer_status\(uuid, uuid, text, text, text\) to service_role/);
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/042_tender_dossier_offer_gate.sql tests/tender-dossier-offer-gate-pglite.integration.test.mjs tests/tender-dossier-workspace-migration.test.mjs
git commit -m "feat(tenders): gate humano de readiness para lista_para_presentar"
```

---

### Task 8: Adapter backend `tender-dossier-rpc.js`

**Files:**
- Create: `tender-dossier-rpc.js`
- Test: `tests/tender-dossier-api.test.mjs`

- [ ] **Step 1: Escribe el test del adapter con DB fake**

Create `tests/tender-dossier-api.test.mjs`. Usa un mock chainable de `database.rpc(name, args)` (patrón `tender-go-no-go-api.test.mjs`). Verifica: autorización (rechaza perfil sin permiso), construcción de args `p_*`, mapeo de errores, y **paridad de rutas** en ambos backends.

```js
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  getTenderDossierWorkspace, callCreateTenderDossierItem, callAppendTenderDossierItemAction,
  callCreateTenderDossierArtifact, callAddTenderDossierArtifactVersion, callRecordTenderDossierArtifactReview,
  callSeedTenderDossier,
} from '../tender-dossier-rpc.js';

const director = { id: '11111111-1111-4111-8111-111111111111', role: 'director', active: true, identity_type: 'human', permissions: ['licitaciones'] };
const outsider = { id: '99999999-9999-4999-8999-999999999999', role: 'colaborador', active: true, identity_type: 'human', permissions: [] };
const OPP = '22222222-2222-4222-8222-222222222222';

function fakeDb(reply) {
  return { calls: [], async rpc(name, args) { this.calls.push({ name, args }); return { data: reply(name, args), error: null }; } };
}

// 1) Autorización: colaborador sin permiso es rechazado antes de tocar la BD.
await (async function rejectsUnauthorized() {
  const db = fakeDb(() => ({}));
  await assert.rejects(() => callCreateTenderDossierItem(db, { opportunity_id: OPP, item_key: 'k', title: 'T', item_type: 'general', required: false }, outsider), /permis|forbidden/i);
  assert.equal(db.calls.length, 0);
})();

// 2) Construye args p_* correctos para crear ítem.
await (async function buildsItemArgs() {
  const db = fakeDb(() => ({ item: { id: 'x' } }));
  await callCreateTenderDossierItem(db, { opportunity_id: OPP, item_key: 'validar_experiencia', title: 'Exp', item_type: 'pendiente_humano', required: true }, director);
  assert.equal(db.calls[0].name, 'psi_create_tender_dossier_item');
  assert.deepEqual(db.calls[0].args, {
    p_opportunity_id: OPP, p_actor_id: director.id, p_item_key: 'validar_experiencia',
    p_title: 'Exp', p_item_type: 'pendiente_humano', p_required: true,
  });
})();

// 3) Workspace read: usa la RPC de lectura y devuelve el jsonb.
await (async function readsWorkspace() {
  const db = fakeDb(() => ({ checklist: [], artifacts: [], readiness: { ready: false } }));
  const ws = await getTenderDossierWorkspace(db, OPP, director);
  assert.equal(db.calls[0].name, 'psi_get_tender_dossier_workspace');
  assert.equal(ws.readiness.ready, false);
})();

// 4) Paridad de rutas: ambos backends registran los 7 endpoints e importan el adapter.
await (async function backendsRegisterRoutes() {
  for (const path of ['../server/index.js', '../api/[...path].js']) {
    const src = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(src, /from '\.\/tender-dossier-rpc\.js'|from "\.\/tender-dossier-rpc\.js"/);
    for (const route of [
      "get('/api/tender-dossier-workspace'", "post('/api/tender-dossier-item'",
      "post('/api/tender-dossier-item-action'", "post('/api/tender-dossier-artifact'",
      "post('/api/tender-dossier-artifact-version'", "post('/api/tender-dossier-artifact-review'",
      "post('/api/tender-dossier-seed'",
    ]) assert.ok(src.includes(route), `falta ruta ${route} en ${path}`);
  }
})();

console.log('tender dossier adapter + parity passed');
```

- [ ] **Step 2: Corre y verifica que falla.**

Run: `node tests/tender-dossier-api.test.mjs`
Expected: FAIL (adapter y rutas no existen).

- [ ] **Step 3: Crea el adapter**

Create `tender-dossier-rpc.js` (patrón de `tender-offer-status-rpc.js`: helpers de validación que lanzan `Error` con `.status`, autorización con `requireAction`, `database.rpc`, mapeo de errores Postgres → HTTP):

```js
import { ACTIONS, requireAction } from './access-control.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function dossierError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}
function requireUuid(value, label) {
  const text = String(value || '').trim();
  if (!UUID_PATTERN.test(text)) throw dossierError(`Debe indicar ${label}.`, 400);
  return text.toLowerCase();
}
function nullableUuid(value, label) {
  if (value === undefined || value === null || value === '') return null;
  return requireUuid(value, label);
}
function nullableText(value, max = 2000) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}
function nullableDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw dossierError('La fecha objetivo debe ser YYYY-MM-DD.', 400);
  return text;
}
function databaseError(error) {
  if (error?.status) return error;
  if (error?.code === '42501') error.status = 403;
  if (['40001', '23514', '22023'].includes(error?.code)) error.status = 409;
  return error;
}
async function rpc(database, name, args) {
  const { data, error } = await database.rpc(name, args);
  if (error) throw databaseError(error);
  return data;
}

/** Lectura canónica del workspace del expediente. Autoriza lectura de licitaciones. */
export async function getTenderDossierWorkspace(database, opportunityId, currentProfile) {
  const id = requireUuid(opportunityId, 'una oportunidad válida');
  requireAction(currentProfile, ACTIONS.LICITACIONES_VIEW);
  const workspace = await rpc(database, 'psi_get_tender_dossier_workspace', { p_opportunity_id: id });
  const canApprove = safeCan(currentProfile, ACTIONS.LICITACIONES_GO_NO_GO_APPROVE);
  const ready = workspace?.readiness?.ready === true;
  return { ...workspace, can_mark_ready: ready && canApprove };
}

function safeCan(profile, action) {
  try { requireAction(profile, action); return true; } catch { return false; }
}

export async function callCreateTenderDossierItem(database, input, currentProfile) {
  const opportunityId = requireUuid(input?.opportunity_id, 'una oportunidad válida');
  requireAction(currentProfile, ACTIONS.LICITACIONES_VIEW);
  const itemType = String(input?.item_type || '').trim();
  if (!['documento', 'pendiente_humano', 'general'].includes(itemType)) throw dossierError('Tipo de ítem inválido.', 400);
  return rpc(database, 'psi_create_tender_dossier_item', {
    p_opportunity_id: opportunityId,
    p_actor_id: requireUuid(currentProfile?.id, 'un actor válido'),
    p_item_key: nullableText(input?.item_key, 200) || crypto.randomUUID(),
    p_title: nullableText(input?.title, 400),
    p_item_type: itemType,
    p_required: input?.required === true,
  });
}

export async function callAppendTenderDossierItemAction(database, input, currentProfile) {
  const opportunityId = requireUuid(input?.opportunity_id, 'una oportunidad válida');
  const itemId = requireUuid(input?.item_id, 'un ítem válido');
  requireAction(currentProfile, ACTIONS.LICITACIONES_VIEW);
  const actionType = String(input?.action_type || '').trim();
  if (!['status_changed', 'assigned', 'evidence_attached', 'marked_not_applicable', 'requirement_changed', 'reopened'].includes(actionType)) {
    throw dossierError('Acción de ítem inválida.', 400);
  }
  return rpc(database, 'psi_append_tender_dossier_item_action', {
    p_opportunity_id: opportunityId,
    p_item_id: itemId,
    p_actor_id: requireUuid(currentProfile?.id, 'un actor válido'),
    p_action_type: actionType,
    p_to_status: nullableText(input?.to_status, 40),
    p_assignee_id: nullableUuid(input?.assignee_id, 'un responsable válido'),
    p_target_date: nullableDate(input?.target_date),
    p_evidence_kind: input?.evidence_kind ? String(input.evidence_kind).trim() : null,
    p_evidence_text: nullableText(input?.evidence_text, 5000),
    p_evidence_url: nullableText(input?.evidence_url, 2000),
    p_justification: nullableText(input?.justification, 2000),
    p_note: nullableText(input?.note, 2000),
  });
}

export async function callCreateTenderDossierArtifact(database, input, currentProfile) {
  const opportunityId = requireUuid(input?.opportunity_id, 'una oportunidad válida');
  requireAction(currentProfile, ACTIONS.LICITACIONES_VIEW);
  return rpc(database, 'psi_create_tender_dossier_artifact', {
    p_opportunity_id: opportunityId,
    p_actor_id: requireUuid(currentProfile?.id, 'un actor válido'),
    p_artifact_key: nullableText(input?.artifact_key, 200) || crypto.randomUUID(),
    p_title: nullableText(input?.title, 400),
    p_required: input?.required === true,
  });
}

export async function callAddTenderDossierArtifactVersion(database, input, currentProfile) {
  const opportunityId = requireUuid(input?.opportunity_id, 'una oportunidad válida');
  const artifactId = requireUuid(input?.artifact_id, 'un artefacto válido');
  requireAction(currentProfile, ACTIONS.LICITACIONES_VIEW);
  const contentKind = String(input?.content_kind || '').trim();
  if (!['markdown', 'texto', 'metadata'].includes(contentKind)) throw dossierError('Tipo de contenido inválido.', 400);
  let metadata = null;
  if (contentKind === 'metadata') {
    if (input?.content_metadata == null || typeof input.content_metadata !== 'object') throw dossierError('El contenido metadata requiere un objeto.', 400);
    metadata = input.content_metadata;
  }
  return rpc(database, 'psi_add_tender_dossier_artifact_version', {
    p_opportunity_id: opportunityId,
    p_artifact_id: artifactId,
    p_actor_id: requireUuid(currentProfile?.id, 'un actor válido'),
    p_content_kind: contentKind,
    p_content_text: contentKind === 'metadata' ? null : nullableText(input?.content_text, 100000),
    p_content_metadata: metadata,
  });
}

export async function callRecordTenderDossierArtifactReview(database, input, currentProfile) {
  const versionId = requireUuid(input?.version_id, 'una versión válida');
  requireAction(currentProfile, ACTIONS.LICITACIONES_GO_NO_GO_APPROVE);
  const decision = String(input?.decision || '').trim();
  if (!['aprobado', 'rechazado'].includes(decision)) throw dossierError('Decisión de revisión inválida.', 400);
  return rpc(database, 'psi_record_tender_dossier_artifact_review', {
    p_version_id: versionId,
    p_actor_id: requireUuid(currentProfile?.id, 'un actor válido'),
    p_decision: decision,
    p_comment: nullableText(input?.comment, 5000),
  });
}

export async function callSeedTenderDossier(database, input, currentProfile) {
  const opportunityId = requireUuid(input?.opportunity_id, 'una oportunidad válida');
  requireAction(currentProfile, ACTIONS.LICITACIONES_GO_NO_GO_APPROVE);
  return rpc(database, 'psi_seed_tender_dossier', {
    p_opportunity_id: opportunityId,
    p_actor_id: requireUuid(currentProfile?.id, 'un actor válido'),
  });
}
```

> Verifica que `ACTIONS.LICITACIONES_VIEW` existe en `access-control.js` (lo hace: `access-control.js:262-263`). Si el nombre exacto difiere, usa la constante real; `requireAction` es la barrera. `crypto.randomUUID()` está disponible en Node ≥ 16 sin import.

- [ ] **Step 4: Registra los 7 endpoints en `server/index.js` y `api/[...path].js` (byte-idéntico)**

En **ambos** archivos: añade el import junto a los demás adapters (cabecera, junto a `tender-offer-status-rpc.js`):

```js
import {
  getTenderDossierWorkspace, callCreateTenderDossierItem, callAppendTenderDossierItemAction,
  callCreateTenderDossierArtifact, callAddTenderDossierArtifactVersion, callRecordTenderDossierArtifactReview,
  callSeedTenderDossier,
} from './tender-dossier-rpc.js';
```

Y añade los handlers **antes** de `app.use(express.static(distPath))` (cerca del bloque de rutas tender, tras `/api/tender-offer-status`):

```js
app.get('/api/tender-dossier-workspace', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    const opportunityId = String(req.query.id || '');
    if (!opportunityId) throw new Error('Debe indicar la oportunidad.');
    await ensureTenderOpportunity(database, opportunityId, currentProfile);
    res.json(await getTenderDossierWorkspace(database, opportunityId, currentProfile));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-dossier-item', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    await ensureTenderOpportunity(database, String(req.body?.opportunity_id || ''), currentProfile);
    res.status(201).json(await callCreateTenderDossierItem(database, req.body || {}, currentProfile));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-dossier-item-action', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    await ensureTenderOpportunity(database, String(req.body?.opportunity_id || ''), currentProfile);
    res.status(201).json(await callAppendTenderDossierItemAction(database, req.body || {}, currentProfile));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-dossier-artifact', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    await ensureTenderOpportunity(database, String(req.body?.opportunity_id || ''), currentProfile);
    res.status(201).json(await callCreateTenderDossierArtifact(database, req.body || {}, currentProfile));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-dossier-artifact-version', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    await ensureTenderOpportunity(database, String(req.body?.opportunity_id || ''), currentProfile);
    res.status(201).json(await callAddTenderDossierArtifactVersion(database, req.body || {}, currentProfile));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-dossier-artifact-review', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    await ensureTenderOpportunity(database, String(req.body?.opportunity_id || ''), currentProfile);
    res.status(201).json(await callRecordTenderDossierArtifactReview(database, req.body || {}, currentProfile));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-dossier-seed', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    await ensureTenderOpportunity(database, String(req.body?.opportunity_id || ''), currentProfile);
    res.status(201).json(await callSeedTenderDossier(database, req.body || {}, currentProfile));
  } catch (error) { sendError(res, error, error?.status || 400); }
});
```

> `ensureTenderOpportunity`, `getAuthContext`, `requireDb`, `sendError` ya existen en el archivo. La revisión de artefacto (`/api/tender-dossier-artifact-review`) recibe `opportunity_id` en el body solo para el guard `ensureTenderOpportunity`; el adapter valida contra la versión en la BD.

- [ ] **Step 5: Verifica paridad byte-a-byte**

Run: `npm run check:backend-parity`
Expected: `backend parity OK`. Si difiere, copia `server/index.js` sobre `api/[...path].js` (o viceversa) hasta que sean idénticos.

- [ ] **Step 6: Corre el test del adapter.**

Run: `node tests/tender-dossier-api.test.mjs`
Expected: PASS → `tender dossier adapter + parity passed`

- [ ] **Step 7: Commit**

```bash
git add tender-dossier-rpc.js server/index.js "api/[...path].js" tests/tender-dossier-api.test.mjs
git commit -m "feat(tenders): adapter y endpoints del expediente (paridad Express/Vercel)"
```

---

### Task 9: Tipos y loaders del frontend

**Files:**
- Modify: `src/tenders/types.ts`
- Modify: `src/tenders/api.ts`

- [ ] **Step 1: Añade tipos en `src/tenders/types.ts`**

```ts
export type TenderDossierItemStatus = 'pendiente' | 'en_progreso' | 'listo' | 'bloqueado';
export type TenderDossierItemApplicability = 'requerido' | 'no_aplica';
export type TenderDossierItemType = 'documento' | 'pendiente_humano' | 'general';

export type TenderDossierItem = {
  id: string;
  item_key: string;
  title: string;
  item_type: TenderDossierItemType;
  required: boolean;
  origin: 'seed_go' | 'human';
  status: TenderDossierItemStatus;
  applicability: TenderDossierItemApplicability;
  assignee_id: string | null;
  assignee_name: string | null;
  target_date: string | null;
  latest_evidence: { kind: 'texto' | 'url'; text: string | null; url: string | null; at: string } | null;
};

export type TenderDossierArtifactVersion = {
  id: string; version: number; content_kind: 'markdown' | 'texto' | 'metadata';
  content_text: string | null; content_metadata: Record<string, unknown> | null;
  author_id: string; created_at: string;
};
export type TenderDossierArtifact = {
  id: string; artifact_key: string; title: string; required: boolean; origin: 'seed_go' | 'human';
  current_version: TenderDossierArtifactVersion | null;
  review_status: 'pendiente' | 'aprobado' | 'rechazado';
  has_approved_version: boolean; version_count: number;
};
export type TenderDossierReadiness = {
  ready: boolean;
  pending_required_items: { item_key: string; title: string }[];
  blocking_items: { item_key: string; title: string }[];
  active_blockers: { item_key: string; title: string }[];
  unapproved_artifacts: { artifact_key: string; title: string }[];
};
export type TenderDossierWorkspace = {
  opportunity_id: string;
  checklist: TenderDossierItem[];
  artifacts: TenderDossierArtifact[];
  readiness: TenderDossierReadiness;
  can_mark_ready: boolean;
};

export type TenderDossierItemActionInput = {
  opportunity_id: string; item_id: string;
  action_type: 'status_changed' | 'assigned' | 'evidence_attached' | 'marked_not_applicable' | 'requirement_changed' | 'reopened';
  to_status?: TenderDossierItemStatus | null; assignee_id?: string | null; target_date?: string | null;
  evidence_kind?: 'texto' | 'url' | null; evidence_text?: string | null; evidence_url?: string | null;
  justification?: string | null; note?: string | null;
};
```

- [ ] **Step 2: Añade loaders/mutadores en `src/tenders/api.ts`**

```ts
import type {
  TenderDossierWorkspace, TenderDossierItem, TenderDossierArtifact, TenderDossierItemActionInput,
} from './types';

export async function loadTenderDossierWorkspace(request: TenderRequest, opportunityId: string): Promise<TenderDossierWorkspace> {
  return request<TenderDossierWorkspace>(`/api/tender-dossier-workspace?id=${encodeURIComponent(opportunityId)}`);
}
export async function createTenderDossierItem(request: TenderRequest, input: {
  opportunity_id: string; item_key?: string; title: string; item_type: string; required: boolean;
}): Promise<{ item: TenderDossierItem }> {
  return request('/api/tender-dossier-item', { method: 'POST', body: JSON.stringify(input) });
}
export async function appendTenderDossierItemAction(request: TenderRequest, input: TenderDossierItemActionInput): Promise<{ item: TenderDossierItem }> {
  return request('/api/tender-dossier-item-action', { method: 'POST', body: JSON.stringify(input) });
}
export async function createTenderDossierArtifact(request: TenderRequest, input: {
  opportunity_id: string; artifact_key?: string; title: string; required: boolean;
}): Promise<{ artifact: TenderDossierArtifact }> {
  return request('/api/tender-dossier-artifact', { method: 'POST', body: JSON.stringify(input) });
}
export async function addTenderDossierArtifactVersion(request: TenderRequest, input: {
  opportunity_id: string; artifact_id: string; content_kind: string; content_text?: string | null; content_metadata?: Record<string, unknown> | null;
}): Promise<{ artifact: TenderDossierArtifact; version_id: string }> {
  return request('/api/tender-dossier-artifact-version', { method: 'POST', body: JSON.stringify(input) });
}
export async function recordTenderDossierArtifactReview(request: TenderRequest, input: {
  opportunity_id: string; version_id: string; decision: 'aprobado' | 'rechazado'; comment?: string | null;
}): Promise<{ artifact: TenderDossierArtifact }> {
  return request('/api/tender-dossier-artifact-review', { method: 'POST', body: JSON.stringify(input) });
}
```

- [ ] **Step 3: Typecheck.**

Run: `npm run build`
Expected: `tsc` sin errores + `vite build` OK. (Aún no se usan los tipos; el build valida sintaxis/tipos.)

- [ ] **Step 4: Commit**

```bash
git add src/tenders/types.ts src/tenders/api.ts
git commit -m "feat(tenders): tipos y cliente del expediente post-GO"
```

---

### Task 10: Componentes React del workspace

**Files:**
- Create: `src/tenders/components/TenderDossierChecklist.tsx`
- Create: `src/tenders/components/TenderDossierArtifacts.tsx`
- Create: `src/tenders/components/TenderDossierWorkspacePanel.tsx`
- Test: `tests/tender-dossier-ui.test.mjs`

- [ ] **Step 1: Escribe el test de UI (source-scan)**

Create `tests/tender-dossier-ui.test.mjs`:

```js
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const panel = read('src/tenders/components/TenderDossierWorkspacePanel.tsx');
const checklist = read('src/tenders/components/TenderDossierChecklist.tsx');
const artifacts = read('src/tenders/components/TenderDossierArtifacts.tsx');

// Compacto/operativo: sin chat, sin KPI duplicado.
assert.doesNotMatch(panel + checklist + artifacts, /chat|conversaci[oó]n/i);
// Usa el resumen de readiness.
assert.match(panel, /readiness|Listo para presentar|Expediente/i);
assert.match(panel, /loadTenderDossierWorkspace/);
// Checklist operable: estados y no_aplica.
assert.match(checklist, /appendTenderDossierItemAction/);
assert.match(checklist, /no_aplica|No aplica/);
assert.match(checklist, /Responsable|assignee/i);
// Artefactos: versiones y revisiones.
assert.match(artifacts, /addTenderDossierArtifactVersion/);
assert.match(artifacts, /recordTenderDossierArtifactReview/);
assert.match(artifacts, /aprobado|Aprobar/);
// Reutiliza clases compactas del repo.
assert.match(panel + checklist + artifacts, /className="(panel|badge|timeline|card|tracking-row|document-analysis)/);
// No expone AGT-002 como label operativo (este lote no usa Vig-IA).
assert.doesNotMatch(panel + checklist + artifacts, /AGT-002/);

console.log('tender dossier UI static checks passed');
```

- [ ] **Step 2: Corre y verifica que falla.**

Run: `node tests/tender-dossier-ui.test.mjs`
Expected: FAIL (componentes no existen).

- [ ] **Step 3: Crea `TenderDossierChecklist.tsx`**

Componente compacto: una fila por ítem con badge de estado, selector de estado, responsable, fecha objetivo, evidencia y acción "No aplica" (con justificación). Reutiliza `TenderStatusBadge` y clases `card`/`tracking-row`.

```tsx
import { useState } from 'react';
import type { TenderDossierItem, TenderDossierWorkspace } from '../types';
import { appendTenderDossierItemAction, createTenderDossierItem } from '../api';
import type { TenderRequest } from '../types';
import { TenderStatusBadge } from './TenderStatusBadge';

const STATUS_LABELS: Record<string, string> = {
  pendiente: 'Pendiente', en_progreso: 'En progreso', listo: 'Listo', bloqueado: 'Bloqueado',
};
const STATUS_TONE: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = {
  pendiente: 'warning', en_progreso: 'neutral', listo: 'success', bloqueado: 'danger',
};

export function TenderDossierChecklist({ opportunityId, workspace, request, canApprove, onChanged }: {
  opportunityId: string; workspace: TenderDossierWorkspace; request: TenderRequest;
  canApprove: boolean; onChanged: () => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const act = async (item: TenderDossierItem, patch: Parameters<typeof appendTenderDossierItemAction>[1]) => {
    setBusyId(item.id); setError('');
    try { await appendTenderDossierItemAction(request, { opportunity_id: opportunityId, item_id: item.id, ...patch }); await onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusyId(null); }
  };

  return (
    <section className="document-analysis-card">
      <small>Checklist del expediente</small>
      {error && <div className="notice">{error}</div>}
      <div className="timeline">
        {workspace.checklist.map((item) => (
          <div className="card tracking-row" key={item.id}>
            <div className="tracking-row-head">
              <div>
                <div className="tender-card-kickers">
                  <TenderStatusBadge label={STATUS_LABELS[item.status]} tone={STATUS_TONE[item.status]} />
                  {item.required && <TenderStatusBadge label="Requerido" tone="neutral" />}
                  {item.applicability === 'no_aplica' && <TenderStatusBadge label="No aplica" tone="neutral" />}
                </div>
                <h3>{item.title}</h3>
                <p>{item.assignee_name ? `Responsable: ${item.assignee_name}` : 'Sin responsable'}{item.target_date ? ` · Objetivo: ${item.target_date}` : ''}</p>
              </div>
            </div>
            <div className="row-actions">
              <select disabled={busyId === item.id} value={item.status}
                onChange={(e) => act(item, { action_type: 'status_changed', to_status: e.target.value as TenderDossierItem['status'] })}>
                {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              {item.applicability === 'requerido'
                ? <button className="secondary" disabled={busyId === item.id || !canApprove}
                    onClick={() => { const j = window.prompt('Justificación para "no aplica":'); if (j) act(item, { action_type: 'marked_not_applicable', justification: j }); }}>
                    No aplica
                  </button>
                : <button className="secondary" disabled={busyId === item.id}
                    onClick={() => act(item, { action_type: 'reopened' })}>Reabrir</button>}
            </div>
          </div>
        ))}
        {!workspace.checklist.length && <p className="muted">Aún no hay ítems en el expediente.</p>}
      </div>
    </section>
  );
}
```

> Nota UX: los formularios de responsable/fecha/evidencia pueden añadirse como controles inline adicionales; el mínimo verificado por el test es estado, no_aplica y responsable visible. Mantén todo dentro de `document-analysis-card` para conservar la estética compacta. Evita `window.prompt` si el equipo prefiere un `<textarea>` inline; ambos cumplen el DoD.

- [ ] **Step 4: Crea `TenderDossierArtifacts.tsx`**

```tsx
import { useState } from 'react';
import type { TenderDossierArtifact, TenderRequest } from '../types';
import { addTenderDossierArtifactVersion, recordTenderDossierArtifactReview } from '../api';
import { TenderStatusBadge } from './TenderStatusBadge';

const REVIEW_TONE: Record<string, 'success' | 'danger' | 'warning'> = { aprobado: 'success', rechazado: 'danger', pendiente: 'warning' };

export function TenderDossierArtifacts({ opportunityId, artifacts, request, canApprove, onChanged }: {
  opportunityId: string; artifacts: TenderDossierArtifact[]; request: TenderRequest; canApprove: boolean; onChanged: () => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const saveVersion = async (artifact: TenderDossierArtifact) => {
    const text = (drafts[artifact.id] || '').trim();
    if (!text) return;
    setBusyId(artifact.id); setError('');
    try {
      await addTenderDossierArtifactVersion(request, { opportunity_id: opportunityId, artifact_id: artifact.id, content_kind: 'markdown', content_text: text });
      setDrafts((d) => ({ ...d, [artifact.id]: '' })); await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusyId(null); }
  };
  const review = async (artifact: TenderDossierArtifact, decision: 'aprobado' | 'rechazado') => {
    if (!artifact.current_version) return;
    const comment = decision === 'rechazado' ? window.prompt('Comentario de rechazo:') || '' : (window.prompt('Comentario (opcional):') || '');
    if (decision === 'rechazado' && !comment.trim()) { setError('Rechazar requiere comentario.'); return; }
    setBusyId(artifact.id); setError('');
    try { await recordTenderDossierArtifactReview(request, { opportunity_id: opportunityId, version_id: artifact.current_version.id, decision, comment }); await onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusyId(null); }
  };

  return (
    <section className="document-analysis-card">
      <small>Documentos del expediente</small>
      {error && <div className="notice">{error}</div>}
      <div className="timeline">
        {artifacts.map((artifact) => (
          <div className="card" key={artifact.id}>
            <div className="tender-card-kickers">
              <TenderStatusBadge label={artifact.review_status} tone={REVIEW_TONE[artifact.review_status]} />
              {artifact.required && <TenderStatusBadge label="Obligatorio" tone="neutral" />}
              <TenderStatusBadge label={`v${artifact.current_version?.version ?? 0}`} tone="neutral" />
            </div>
            <h3>{artifact.title}</h3>
            {artifact.current_version?.content_text && <pre className="artifact-preview">{artifact.current_version.content_text}</pre>}
            <textarea placeholder="Nueva versión (markdown)…" value={drafts[artifact.id] || ''}
              onChange={(e) => setDrafts((d) => ({ ...d, [artifact.id]: e.target.value }))} />
            <div className="row-actions">
              <button disabled={busyId === artifact.id} onClick={() => saveVersion(artifact)}>Guardar nueva versión</button>
              {canApprove && artifact.current_version && <>
                <button className="secondary" disabled={busyId === artifact.id} onClick={() => review(artifact, 'aprobado')}>Aprobar</button>
                <button className="secondary" disabled={busyId === artifact.id} onClick={() => review(artifact, 'rechazado')}>Rechazar</button>
              </>}
            </div>
          </div>
        ))}
        {!artifacts.length && <p className="muted">Sin documentos en el expediente.</p>}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Crea `TenderDossierWorkspacePanel.tsx`**

Contenedor que carga el workspace, muestra el resumen de readiness (qué falta para `lista_para_presentar`), y compone checklist + artefactos. Reutiliza `Panel` no está exportado desde `main.tsx`, así que usa `<section className="panel">` con `<h2>`.

```tsx
import { useEffect, useState } from 'react';
import type { TenderDossierWorkspace, TenderRequest } from '../types';
import { loadTenderDossierWorkspace } from '../api';
import { TenderDossierChecklist } from './TenderDossierChecklist';
import { TenderDossierArtifacts } from './TenderDossierArtifacts';

export function TenderDossierWorkspacePanel({ opportunityId, request, canApprove, offerStatus }: {
  opportunityId: string; request: TenderRequest; canApprove: boolean; offerStatus: string | null;
}) {
  const [workspace, setWorkspace] = useState<TenderDossierWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = async () => {
    try { setWorkspace(await loadTenderDossierWorkspace(request, opportunityId)); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  };
  useEffect(() => { setLoading(true); void reload(); /* eslint-disable-next-line */ }, [opportunityId]);

  if (offerStatus === 'pendiente_decision' || offerStatus === 'cerrada_no_go' || !offerStatus) {
    return (
      <section className="panel" id="tender-dossier">
        <h2>Expediente de oferta</h2>
        <p className="muted">El expediente operativo se habilita al registrar GO.</p>
      </section>
    );
  }

  const readiness = workspace?.readiness;
  return (
    <section className="panel" id="tender-dossier">
      <h2>Expediente de oferta</h2>
      {error && <div className="notice">{error}</div>}
      {loading && !workspace && <p className="muted">Cargando expediente…</p>}
      {workspace && (
        <>
          <div className="document-status-card">
            <small>Estado para presentar</small>
            <strong>{readiness?.ready ? 'Listo para presentar' : 'Faltan requisitos'}</strong>
            {!readiness?.ready && (
              <ul className="muted">
                {readiness?.pending_required_items.map((i) => <li key={`p-${i.item_key}`}>Pendiente requerido: {i.title}</li>)}
                {readiness?.active_blockers.map((i) => <li key={`b-${i.item_key}`}>Bloqueante: {i.title}</li>)}
                {readiness?.unapproved_artifacts.map((a) => <li key={`a-${a.artifact_key}`}>Documento sin aprobar: {a.title}</li>)}
              </ul>
            )}
          </div>
          <div className="document-analysis-grid">
            <TenderDossierChecklist opportunityId={opportunityId} workspace={workspace} request={request} canApprove={canApprove} onChanged={reload} />
            <TenderDossierArtifacts opportunityId={opportunityId} artifacts={workspace.artifacts} request={request} canApprove={canApprove} onChanged={reload} />
          </div>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Corre el test de UI y verifica PASS.**

Run: `node tests/tender-dossier-ui.test.mjs`
Expected: PASS → `tender dossier UI static checks passed`

- [ ] **Step 7: Commit**

```bash
git add src/tenders/components/TenderDossierChecklist.tsx src/tenders/components/TenderDossierArtifacts.tsx src/tenders/components/TenderDossierWorkspacePanel.tsx tests/tender-dossier-ui.test.mjs
git commit -m "feat(tenders): UI operable del expediente post-GO (checklist + documentos)"
```

---

### Task 11: Montar el workspace en el detalle de oportunidad

**Files:**
- Modify: `src/main.tsx` (`OpportunityDetail`, sección `#tender-preparation`)

- [ ] **Step 1: Importa y monta el panel**

En `src/main.tsx`, junto a los imports de componentes de tenders, añade:

```tsx
import { TenderDossierWorkspacePanel } from './tenders/components/TenderDossierWorkspacePanel';
```

Dentro de `OpportunityDetail`, en el bloque de licitación (donde hoy se renderiza `TenderOfferPreparationPanel` en `#tender-preparation`, `main.tsx:805`), monta el nuevo panel **debajo** del existente (no lo elimines: la preparación estática sigue siendo la fuente de la semilla y una vista de referencia). Usa el `api` local y el `tender_offer_status` de la oportunidad:

```tsx
{/* Expediente operativo post-GO (Lote 2) */}
<TenderDossierWorkspacePanel
  opportunityId={opportunity.id}
  request={api}
  canApprove={can(currentProfile, ACTIONS.LICITACIONES_GO_NO_GO_APPROVE)}
  offerStatus={(opportunity as { tender_offer_status?: string | null }).tender_offer_status ?? null}
/>
```

> `can` y `ACTIONS` ya se importan en `main.tsx` (se usan en otros paneles). Si `opportunity` no expone `tender_offer_status` en su tipo local, usa el cast mostrado; el backend ya lo entrega en el detalle. Verifica en el archivo cómo se pasa `api` a los otros paneles (prop `request`/`api`) y usa el mismo símbolo.

- [ ] **Step 2: Typecheck + build.**

Run: `npm run build`
Expected: `tsc` sin errores + `vite build` OK.

- [ ] **Step 3: Commit**

```bash
git add src/main.tsx
git commit -m "feat(tenders): montar expediente operativo en el detalle post-GO"
```

---

### Task 12: Verificación integral y cierre

**Files:**
- (Opcional) Modify: `CURRENT.md`

- [ ] **Step 1: Suite completa de tests**

Run:
```bash
for test in tests/*.test.mjs; do node "$test" || exit 1; done
```
Expected: todos PASS (incluidos los 6 nuevos y los existentes sin regresión).

- [ ] **Step 2: Paridad de backends**

Run: `npm run check:backend-parity`
Expected: `backend parity OK`.

- [ ] **Step 3: Typecheck + build**

Run: `npm run build`
Expected: OK.

- [ ] **Step 4: Checks estáticos adicionales del repo**

Run:
```bash
npm run check:nav-permissions
npm run check:siio-integration
```
Expected: PASS (no deberían verse afectados; confirma que no hay regresión).

- [ ] **Step 5: Escaneo manual de invariantes (revisión de ojos frescos)**

Verifica a mano:
- Ninguna RPC nueva concede `execute` a `anon`/`authenticated`/`public` (grep en `040`/`041`/`042`).
- Todas las tablas nuevas: RLS on + `grant select ... to service_role` + sin grants de escritura directa.
- Sin datos reales en tests (solo UUID sintéticos).
- Sin referencias a SharePoint/SECOP/envíos en el código nuevo.
- La UI no muestra `AGT-002` como label operativo ni chat.

- [ ] **Step 6 (opcional): Nota de cierre en `CURRENT.md`**

Si se decide desplegar el corte, añade una sección breve en `CURRENT.md` describiendo Lote 2 (migraciones 040–042, endpoints nuevos, gate humano). No inventes IDs de despliegue; deja placeholders explícitos hasta que exista el deploy real. Commit:

```bash
git add CURRENT.md
git commit -m "docs(tenders): registrar Lote 2 del expediente operativo"
```

---

## 4. Matriz de permisos (resumen)

| Acción | RPC / endpoint | Rol requerido | Notas |
|---|---|---|---|
| Ver workspace | `GET /api/tender-dossier-workspace` → `psi_get_tender_dossier_workspace` | `admin/gerencia/director/comercial` + `licitaciones` (`LICITACIONES_VIEW`) | Solo lectura; `ensureTenderOpportunity` valida acceso. |
| Crear ítem | `POST /api/tender-dossier-item` → `psi_create_tender_dossier_item` | idem (`psi_assert_tender_dossier_actor(actor, false)`) | Requiere GO vigente. Idempotente por `item_key`. |
| Cambiar estado / asignar / evidencia | `POST /api/tender-dossier-item-action` | idem | Append-only. `comercial` incluido (operativo). |
| Marcar "no aplica" | `POST /api/tender-dossier-item-action` (`marked_not_applicable`) | **manager** `admin/gerencia/director` (`assert_actor(..., true)`) | Exige justificación. |
| Crear artefacto | `POST /api/tender-dossier-artifact` | `admin/gerencia/director/comercial` + `licitaciones` | Idempotente por `artifact_key`. |
| Nueva versión de artefacto | `POST /api/tender-dossier-artifact-version` | idem | Append-only; la versión vigente se proyecta por el mayor número. |
| Aprobar/rechazar versión | `POST /api/tender-dossier-artifact-review` | **manager** (`LICITACIONES_GO_NO_GO_APPROVE` en adapter + `assert_actor(..., true)` en RPC) | Rechazo exige comentario. |
| Sembrar/backfill | `POST /api/tender-dossier-seed` | **manager** (`LICITACIONES_GO_NO_GO_APPROVE`) | Idempotente; no destructivo. |
| Transición a `lista_para_presentar` | `POST /api/tender-offer-status` (existente) → wrapper `042` | **manager** (core `024` sin cambios) | Gate de readiness antes del core. |

Doble defensa: el adapter autoriza en JS (`requireAction`) y cada RPC re-verifica en SQL (`psi_assert_tender_dossier_actor`). El JWT nunca se confía en la BD; `p_actor_id` se pasa explícito desde la identidad server-side.

## 5. Reglas del gate `lista_para_presentar` (canónicas)

`ready = A ∧ B ∧ C` donde:
- **A** — todo ítem con `required=true` tiene `status='listo'` **o** `applicability='no_aplica'` (con justificación, garantizada en escritura).
- **B** — ningún ítem (cualquier tipo) con `status='bloqueado'`.
- **C** — todo artefacto con `required=true` tiene ≥1 versión cuya última revisión es `aprobado`.

El wrapper `042` bloquea la transición a `lista_para_presentar` si `ready` no es `true`, con `errcode 23514` y un mensaje que incluye el detalle de lo que falta. Otros destinos (`presentada`, `adjudicada`, `no_adjudicada`) delegan directo al core sin gate. La autorización del rol permanece en el core (`024`).

## 6. Rollout / reversibilidad

- **Orden de aplicación:** `040` → `041` → `042`. `041` y `042` dependen de que existan (respectivamente) `psi_record_tender_go_no_go` (8 args, migración `039`) y `psi_transition_tender_offer_status` (migración `024`); ambos guards abortan con mensaje claro si falta la dependencia.
- **Reejecutables:** las tres migraciones usan `create table if not exists`, `create or replace function`, `drop trigger if exists`, guards `if to_regprocedure(...) is null` y `on conflict do nothing`. Aplicarlas dos veces es seguro (verificado en PGlite con doble `db.exec`).
- **Backfill no destructivo:** para las oportunidades ya en GO (p.ej. las 3 de `CURRENT.md`), ejecutar `POST /api/tender-dossier-seed` (o llamar `psi_seed_tender_dossier`) siembra el expediente desde su preparación vigente sin duplicar ni tocar el historial. No hay UPDATE/DELETE de datos existentes.
- **Reversibilidad de los wrappers:** para revertir el comportamiento de `041`/`042` sin perder datos, restaurar el core como público:
  - `041`: `alter function public.psi_record_tender_go_no_go_core_041(...) rename to psi_record_tender_go_no_go;` (tras `drop function` del wrapper) y re-otorgar `execute` a `service_role`.
  - `042`: `alter function public.psi_transition_tender_offer_status_core_042(...) rename to psi_transition_tender_offer_status;` análogamente.
  - Las tablas de `040` pueden conservarse (inertes) o `drop ... cascade` si se decide retirar por completo. El adapter y las rutas se quitan de **ambos** backends (mantener paridad).
- **Frontend:** el panel se auto-oculta cuando `tender_offer_status` es `pendiente_decision`/`cerrada_no_go`/nulo, así que es seguro desplegar la UI antes de sembrar expedientes.
- **Sin acoplar a etapa comercial:** el expediente vive sobre `tender_offer_status`; nunca modifica `stage_code`/etapa general de la oportunidad.

## 7. Estrategia de pruebas (mapa)

| Capa | Archivo | Cubre |
|---|---|---|
| Migración estática | `tests/tender-dossier-workspace-migration.test.mjs` | `begin/commit`, tablas, grants, append-only, sin execute a anon/auth/public, event types, renames `041`/`042`. |
| PGlite `040` | `tests/tender-dossier-workspace-pglite.integration.test.mjs` | idempotencia (doble apply), grants (DML directo denegado), triggers append-only, RPC de ítems/artefactos/proyección/lectura. |
| PGlite `041` | `tests/tender-dossier-go-seed-pglite.integration.test.mjs` | siembra desde preparación, `required` correcto, idempotencia/no duplicados. |
| PGlite `042` | `tests/tender-dossier-offer-gate-pglite.integration.test.mjs` | gate bloquea/permite, bloqueantes, readiness. |
| Adapter + paridad | `tests/tender-dossier-api.test.mjs` | autorización, args `p_*`, rutas en ambos backends, byte-identidad. |
| UI estática | `tests/tender-dossier-ui.test.mjs` | checklist operable, artefactos, sin chat/AGT-002, clases compactas. |
| Build | `npm run build` | typecheck `tsc` + `vite build`. |
| Paridad | `npm run check:backend-parity` | Express == Vercel. |

## 8. Riesgos y mitigaciones

- **Dependencia cruzada `040`↔`042` (`psi_evaluate_tender_dossier_readiness`):** mitigada con un **stub** en `040` que `042` reemplaza vía `create or replace`. El test PGlite de `040` corre autoconsistente; el de `042` valida la versión completa.
- **Firma de argumentos por defecto en RPC (`p_target_date`, etc.):** PGlite/Postgres resuelven overloads por número de args con defaults; el adapter siempre pasa **todos** los `p_*` para evitar ambigüedad. Mantén la firma exacta de 12 args en `psi_append_tender_dossier_item_action`.
- **Paridad Express/Vercel:** cualquier edición debe copiarse byte-a-byte; `check:backend-parity` es obligatorio antes de cada commit que toque los backends.
- **Semilla de `required`:** todos los pendientes humanos son obligatorios; los artefactos obligatorios iniciales (`carta_presentacion/declaracion_no_inhabilidades/matriz_cumplimiento/propuesta_tecnica_base`) son deterministas y explícitos. Cualquier excepción exige `no_aplica` justificado y aprobado; no se hace backfill destructivo.
- **Evidencia URL:** solo `https://` y sin espacios (CHECK en `040` + validación en adapter) para evitar `javascript:`/`data:`; no se descargan ni renderizan URLs, solo se guardan como texto.
- **Concurrencia de versiones:** `pg_advisory_xact_lock` por `artifact_id` + `unique (artifact_id, version)` serializan el siguiente número sin actualizar versiones previas.
- **No romper el timeline existente:** los 3 nuevos `event_type` se añaden a la lista completa del CHECK; hay que registrarlos también en `TENDER_BUSINESS_EVENT_TYPES` del backend si se quieren ver en `scope=business` (verifica esa constante en `server/index.js`; si existe, añádelos en **ambos** backends y cúbrelo con el test de paridad).

## 9. Explícitamente fuera de alcance (este lote)

- LLM, activación de AGT-002, cualquier decisión automática de Vig-IA (GO/NO GO, firma, envío, presentación, aprobación, cambio de estado). Vig-IA queda como asesor **futuro**.
- SharePoint / OneDrive real, SECOP, TVEC, ESU, descargas o envíos de documentos, generación automática de borradores.
- Chat / conversación en la UI; notas internas mostradas como conversación.
- Mover la etapa comercial general (`stage_code`) por etiquetas del expediente.
- KPIs nuevos o duplicados en el detalle (los KPI viven en los dashboards existentes).
- Cambios a la autorización del core GO/NO GO o de la transición de oferta (solo se añaden precondiciones/semillas por wrapper).
- Backfill destructivo de datos históricos; migración de la preparación estática existente a otro formato (se conserva y se usa como fuente de semilla).

## 10. Definition of Done

- [ ] Migraciones `040`, `041`, `042` creadas, reejecutables en PGlite (doble apply sin error) y con grants solo `service_role`.
- [ ] 5 tablas append-only con triggers de inmutabilidad y RLS; estado de ítems/artefactos proyectado (no materializado).
- [ ] Semilla al GO idempotente desde la preparación vigente, sin duplicados; wrapper de `psi_record_tender_go_no_go` conserva firma y resultado.
- [ ] RPCs de acciones humanas (crear ítem, cambiar estado, asignar, evidencia texto/URL, no_aplica con justificación) y de artefactos (crear, nueva versión, revisión aprobado/rechazado con comentarios) — todas append-only, autorización humana + `licitaciones` + rol limitante.
- [ ] Gate de `lista_para_presentar` operativo: bloquea hasta ítems requeridos `listo`/`no_aplica`, artefactos obligatorios aprobados y sin bloqueantes; solo humano autorizado ejecuta la transición existente.
- [ ] `GET /api/tender-dossier-workspace` devuelve checklist proyectado, artefactos/versiones/revisiones, readiness y `can_mark_ready`.
- [ ] 7 endpoints registrados byte-idénticos en `server/index.js` y `api/[...path].js`; `npm run check:backend-parity` OK.
- [ ] UI post-GO compacta: resumen de readiness, checklist operable con responsables/evidencias, documentos con versiones y revisiones; sin chat; sin `AGT-002` visible; sin KPI duplicado.
- [ ] Auditoría comercial append-only (streams del dossier + hitos `dossier_seeded`/`dossier_artifact_approved`/`offer_ready_for_submission`), separada de eventos técnicos.
- [ ] Suite `for test in tests/*.test.mjs; do node "$test"; done` PASS; `npm run build` PASS; checks estáticos del repo sin regresión.
- [ ] Compatibilidad con preparación existente y decisiones históricas; backfill vía `psi_seed_tender_dossier` no destructivo.

---

## Self-Review (checklist ejecutado por el autor del plan)

- **Cobertura de spec:** cada capacidad mínima (1–10) mapea a tareas: (1) Task 6; (2) Task 2; (3) Task 2; (4) Task 3; (5) Task 7; (6) Task 4 + Task 8; (7) Tasks 10–11; (8) Task 4 (event types) + streams append-only; (9) Tasks 1/6 (idempotencia, PGlite); (10) Task 6 + §6 (backfill no destructivo).
- **Sin placeholders:** todas las RPC, adapter, tipos, componentes y tests llevan código completo; los `required` y reglas del gate están definidos explícitamente.
- **Consistencia de tipos/nombres:** firmas SQL usadas en tests coinciden con las definidas (`psi_create_tender_dossier_item(uuid,uuid,text,text,text,boolean)`, `psi_append_tender_dossier_item_action` 12 args, `psi_add_tender_dossier_artifact_version(uuid,uuid,uuid,text,text,jsonb)`, `psi_record_tender_dossier_artifact_review(uuid,uuid,text,text)`, `psi_get_tender_dossier_workspace(uuid)`, `psi_evaluate_tender_dossier_readiness(uuid)`, `psi_seed_tender_dossier(uuid,uuid)`); nombres de endpoints y adapter idénticos entre adapter, backends y test de paridad.
