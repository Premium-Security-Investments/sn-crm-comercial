# Flujo durable de licitaciones públicas y AGT-002 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implement en el orden de entregables; cada tarea es un bloque cerrado RED → GREEN → commit.

**Goal:** Convertir `POST /api/tender-convert` en una operación inmediata e idempotente que crea la oportunidad y un **job durable**, y mover la importación documental de 40 archivos (hoy síncrona dentro de la petición, `server/index.js:2360-2462`) a un **worker por lotes** reanudable, con eventos visibles, autorización nominal de análisis (custodia Katherine/Juan por permisos, no por nombres en código), historial unificado, UI de proceso público, y disparo real de AGT-002 solo tras publicar un snapshot vigente — sin fallback silencioso, sin analizar procesos terminales, con cuota 20 y concurrencia 1, y sin ninguna acción contractual automática.

**Architecture:** Persistencia durable en Supabase (`psi_tender_processing_jobs`, `psi_tender_document_import_items`, extensión de `psi_tender_tracking_events`) con leases atómicos e idempotencia; RPCs `security definer` service-role que reutilizan sin sustituir el registro tipado existente (`psi_record_tender_document_version`, `psi_begin_tender_document_refresh`, `psi_record_tender_document_snapshot`, `psi_record_tender_analysis_run`, `psi_claim_agt002_preview_run`, `psi_record_tender_go_no_go`); dominio puro en módulos ESM pequeños (máquina de estados, backoff, idempotencia, agregación de progreso) probados sin red; un worker service-only que reclama trabajo en DB y procesa lotes ≤3 con presupuesto de tiempo; endpoints nuevos escritos **idénticos** en `server/index.js` y `api/[...path].js` (paridad byte-a-byte verificada por `scripts/check_backend_parity.mjs`); UI React condicional por `service_type_code === 'licitacion_publica'` sin afectar el CRM privado; y el puente AGT-002 ya existente (`agt002-hetzner-bridge-*.js`) invocado únicamente contra el snapshot vigente. Ninguna tarea de código despliega, migra en remoto, accede a Hetzner por SSH ni ejecuta Aerocivil real: esas acciones quedan tras gates humanos explícitos (Entregable 7).

**Tech Stack:** Node.js ESM (`"type":"module"`); PostgreSQL vía `supabase/migrations/NNN_*.sql` + `supabase/rollbacks/NNN_*_rollback.sql` aplicados por runners `scripts/*-migrations.mjs` sobre el RPC `exec_sql`; pruebas con `node tests/<archivo>.test.mjs` (no hay script `test` agregado) y PGlite `@electric-sql/pglite` para integración DB offline; frontend React 18 + TypeScript + Vite (`src/main.tsx`, `src/tenders/`) probado por aserciones estáticas de fuente + `esbuild.buildSync`; `npm run build` = `tsc && vite build`; cero dependencias npm nuevas.

## Global Constraints

- **Paridad:** todo endpoint o handler nuevo/modificado se escribe **byte-idéntico** en `server/index.js` y en `api/[...path].js`. Tras cada tarea de backend correr `npm run check:backend-parity` y `node tests/backend-parity.test.mjs`; ambos deben pasar. No existe módulo de handler compartido: se pega el mismo texto en ambos archivos.
- **No fallback silencioso:** el flujo automático nunca reporta "análisis completado" con reglas. `quota`/`saturated`/`busy`/transporte llevan a `waiting_agent_capacity` o `needs_attention` con razón segura; un run `siio_rules_v1/rules` jamás completa el paso AGT-002.
- **No analizar terminales:** antes de importar y antes de analizar, el worker revalida el estado oficial con `isTenderTrackableStatus`/`revalidateTenderOfficialStatus` (ya existentes). Cancelado/revocado/desierto → estado `cancelled`, evento auditable, sin análisis ni reactivación.
- **Snapshot vigente antes de AGT-002:** AGT-002 consume solo `psi_tender_document_state.current_snapshot_id`, publicado por `psi_record_tender_document_snapshot` con token gobernado. Un run se ancla a ese `snapshot_id`.
- **Cuota 20 / concurrencia 1:** se mantienen `AGT002_PREVIEW_DAILY_MAX_RUNS=20` y `AGT002_PREVIEW_MAX_CONCURRENT=1` a través del RPC `psi_claim_agt002_preview_run` ya existente. Ninguna tarea de código cambia estas variables en Vercel; su ajuste efectivo es un gate (Entregable 7).
- **Autorización nominal sin hardcodear nombres:** la elegibilidad de `AI_ANALYSIS_RUN` sigue siendo el gate por custodia `canTenderCustodyAction` (permisos `licitaciones` + `licitaciones_custodia`) de `access-control.js`. NO se codifican "Katherine"/"Juan" en `access-control.js` ni en SQL. La correspondencia "exactamente esos dos perfiles" se comprueba mecánicamente por un script de auditoría contra un export de perfiles (Tarea 3.6 + gate).
- **Sin acciones contractuales automáticas:** ningún componente decide GO/NO GO, firma, envía, carga ni presenta. `human_review_required: true` invariante; GO/NO GO conserva su gate humano existente.
- **OAuth aislado / sin secretos:** OAuth y `codex app-server` permanecen en `/opt/agt002-bridge` (Hetzner); no se alojan en Vercel/Supabase. Logs y respuestas de API nunca contienen documentos, prompts, HMAC, tokens, cookies, connection strings ni cuerpo crudo del proveedor; representaciones documentales usan `[REDACTED]`.
- **Reutilizar, no duplicar:** no se crea un segundo registro documental, de snapshots, runs, decisiones o historial que compita con las tablas tipadas existentes.
- **Migraciones aditivas con rollback:** cada migración nueva trae su rollback en `supabase/rollbacks/`; los rollbacks nunca borran filas append-only (versiones, snapshots, runs, decisiones ni eventos ya escritos): solo retiran funciones/índices/columnas nuevas y vacías, fail-closed.
- **Sin efectos externos en tareas de código:** ninguna tarea 1–6 hace push, deploy, `apply` de migración remota, acceso SSH a Hetzner ni ejecución real sobre Aerocivil. El worktree ya autoriza implementar, commitear, pushear y desplegar, pero **migración remota, reparación Hetzner, corrida real de Aerocivil y deploy** quedan tras los gates explícitos del Entregable 7; no se asume acceso remoto ni credenciales sin ese gate.
- **Comando para observar RED:** cada tarea indica el `node tests/<archivo>.test.mjs` exacto que debe fallar antes de implementar y pasar después.
- **Flags fail-closed:** el pipeline durable, la UI pública y el análisis automático se activan por variables de entorno independientes (Tarea 7.1), por defecto apagadas, siguiendo el patrón de `isAgt002PreviewConfigured`.

---

# Entregable 1 — Migración durable (jobs / items / eventos) + RPCs + rollback

Numeración de migraciones: la última existente es `031`. Este entregable añade `032`–`035`. Todas envueltas en `begin; … commit;` (el runner las despoja para `exec_sql`). Prerrequisitos que las pruebas PGlite siembran/aplican antes: roles `authenticated`/`service_role`/`anon`, `psi_sales_profiles`, `psi_sales_opportunities`, `psi_public_tenders`, y migraciones `017`,`018`,`022`,`025`,`026`,`027`,`028` (según lo que cada RPC referencia).

### Task 1.1: Migración 032 — tablas `psi_tender_processing_jobs` + `psi_tender_document_import_items`

**Files:**
- Create: `supabase/migrations/032_tender_processing_jobs.sql`
- Create: `supabase/rollbacks/032_tender_processing_jobs_rollback.sql`
- Create: `tests/tender-processing-jobs-pglite.integration.test.mjs`

**Interfaces:**
- Produces (DDL): tablas `public.psi_tender_processing_jobs` y `public.psi_tender_document_import_items` con constraints, índice parcial de un job activo por oportunidad, y grants revocados (solo `service_role select`).
- Consumido por: Tasks 1.3, 1.4 (RPCs), Entregable 2 (worker).

- [ ] **Step 1: Prueba roja**

```js
// tests/tender-processing-jobs-pglite.integration.test.mjs
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/032_tender_processing_jobs.sql', import.meta.url), 'utf8')
  .replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const rollback = readFileSync(new URL('../supabase/rollbacks/032_tender_processing_jobs_rollback.sql', import.meta.url), 'utf8');

const ids = {
  tender: '33333333-3333-4333-8333-333333333333',
  opp: '55555555-5555-4555-8555-555555555555',
  actor: '11111111-1111-4111-8111-111111111111',
};

async function db() {
  const pg = new PGlite();
  await pg.exec(`
    create role authenticated; create role service_role; create role anon;
    create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true, role text not null, microsoft_email text not null);
    create table public.psi_sales_opportunities (id uuid primary key, company_name text not null);
    create table public.psi_public_tenders (id uuid primary key, stable_key text not null unique);
    insert into public.psi_sales_profiles values ('${ids.actor}', true, 'admin', 'a@x.co');
    insert into public.psi_sales_opportunities values ('${ids.opp}', 'ACME');
    insert into public.psi_public_tenders values ('${ids.tender}', 'k1');
  `);
  await pg.exec(migration);
  return pg;
}

async function run() {
  const pg = await db();
  // Un job queued por oportunidad
  await pg.exec(`insert into public.psi_tender_processing_jobs
    (id, tender_id, opportunity_id, pipeline_version, idempotency_key, status, current_step, requested_by)
    values (gen_random_uuid(), '${ids.tender}', '${ids.opp}', 'v1', 'k-a', 'queued', 'documents', '${ids.actor}');`);

  // Índice parcial: un segundo job ACTIVO para la misma oportunidad debe fallar
  await assert.rejects(
    pg.exec(`insert into public.psi_tender_processing_jobs
      (id, tender_id, opportunity_id, pipeline_version, idempotency_key, status, current_step, requested_by)
      values (gen_random_uuid(), '${ids.tender}', '${ids.opp}', 'v1', 'k-b', 'discovering_documents', 'documents', '${ids.actor}');`),
    /psi_tender_processing_jobs_one_active/,
  );

  // Lease completo o nulo: poblar solo lease_id sin expiración debe fallar el check
  await assert.rejects(
    pg.exec(`update public.psi_tender_processing_jobs set lease_id = gen_random_uuid() where idempotency_key='k-a';`),
    /lease/i,
  );

  // Contadores no negativos
  await assert.rejects(
    pg.exec(`update public.psi_tender_processing_jobs set documents_failed = -1 where idempotency_key='k-a';`),
    /documents_failed/i,
  );

  // idempotency_key único
  await assert.rejects(
    pg.exec(`insert into public.psi_tender_processing_jobs
      (id, tender_id, opportunity_id, pipeline_version, idempotency_key, status, current_step, requested_by)
      values (gen_random_uuid(), '${ids.tender}', '${ids.opp}', 'v1', 'k-a', 'cancelled', 'documents', '${ids.actor}');`),
    /idempotency_key/i,
  );

  // Import items: unique (job_id, source, source_document_id)
  const job = (await pg.query(`select id from public.psi_tender_processing_jobs where idempotency_key='k-a'`)).rows[0].id;
  await pg.exec(`insert into public.psi_tender_document_import_items
    (id, job_id, tender_id, opportunity_id, source, source_document_id, name, status)
    values (gen_random_uuid(), '${job}', '${ids.tender}', '${ids.opp}', 'SECOP II', 'doc-1', 'Pliego', 'pending');`);
  await assert.rejects(
    pg.exec(`insert into public.psi_tender_document_import_items
      (id, job_id, tender_id, opportunity_id, source, source_document_id, name, status)
      values (gen_random_uuid(), '${job}', '${ids.tender}', '${ids.opp}', 'SECOP II', 'doc-1', 'Pliego dup', 'pending');`),
    /import_items/i,
  );

  // Estado inválido rechazado por CHECK
  await assert.rejects(
    pg.exec(`insert into public.psi_tender_document_import_items
      (id, job_id, tender_id, opportunity_id, source, source_document_id, name, status)
      values (gen_random_uuid(), '${job}', '${ids.tender}', '${ids.opp}', 'SECOP II', 'doc-2', 'X', 'bogus');`),
    /status/i,
  );

  // Rollback deja el esquema limpio
  await pg.exec(rollback);
  const remaining = (await pg.query(`select to_regclass('public.psi_tender_processing_jobs') as t`)).rows[0].t;
  assert.equal(remaining, null);

  console.log('tender-processing-jobs pglite integration passed');
}
run();
```

- [ ] **Step 2: Ejecutar y comprobar fallo**

Run: `node tests/tender-processing-jobs-pglite.integration.test.mjs`
Expected: FAIL — `Cannot find module`/`ENOENT` sobre `032_tender_processing_jobs.sql` (aún no existe).

- [ ] **Step 3: Implementar la migración**

`supabase/migrations/032_tender_processing_jobs.sql` (contrato normativo, sección 6.1–6.2 de la spec):

```sql
begin;

create table if not exists public.psi_tender_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  pipeline_version text not null check (length(btrim(pipeline_version)) > 0),
  idempotency_key text not null unique check (length(btrim(idempotency_key)) > 0),
  status text not null check (status in (
    'queued','discovering_documents','importing_documents','retry_wait','needs_attention',
    'ready_for_snapshot','snapshot_ready','awaiting_analysis_authorization','waiting_agent_capacity',
    'analyzing','completed','cancelled')),
  current_step text not null check (length(btrim(current_step)) > 0),
  requested_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
  analysis_authorized_by uuid references public.psi_sales_profiles(id) on delete restrict,
  analysis_authorized_at timestamptz,
  lease_id uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz,
  documents_discovered integer not null default 0 check (documents_discovered >= 0),
  documents_processed integer not null default 0 check (documents_processed >= 0),
  documents_imported integer not null default 0 check (documents_imported >= 0),
  documents_unchanged integer not null default 0 check (documents_unchanged >= 0),
  documents_failed integer not null default 0 check (documents_failed >= 0),
  snapshot_id uuid references public.psi_tender_document_snapshots(id) on delete restrict,
  analysis_run_id uuid references public.psi_tender_analysis_runs(id) on delete restrict,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint psi_tender_processing_jobs_lease_all_or_none check (
    (lease_id is null and lease_expires_at is null) or (lease_id is not null and lease_expires_at is not null)),
  constraint psi_tender_processing_jobs_auth_all_or_none check (
    (analysis_authorized_by is null and analysis_authorized_at is null) or
    (analysis_authorized_by is not null and analysis_authorized_at is not null))
);

create unique index if not exists psi_tender_processing_jobs_one_active
  on public.psi_tender_processing_jobs (opportunity_id)
  where status not in ('completed','cancelled');
create index if not exists psi_tender_processing_jobs_claimable_idx
  on public.psi_tender_processing_jobs (status, next_attempt_at, lease_expires_at);

create table if not exists public.psi_tender_document_import_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.psi_tender_processing_jobs(id) on delete cascade,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  source text not null check (length(btrim(source)) > 0),
  source_document_id text not null check (length(btrim(source_document_id)) > 0),
  source_url text,
  name text not null check (length(btrim(name)) > 0),
  status text not null default 'pending' check (status in (
    'pending','processing','imported','unchanged','failed_retryable','failed_terminal')),
  critical boolean not null default false,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz,
  lease_id uuid,
  lease_expires_at timestamptz,
  document_version_id uuid references public.psi_tender_document_versions(id) on delete restrict,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint psi_tender_document_import_items_identity unique (job_id, source, source_document_id),
  constraint psi_tender_document_import_items_lease_all_or_none check (
    (lease_id is null and lease_expires_at is null) or (lease_id is not null and lease_expires_at is not null))
);
create index if not exists psi_tender_document_import_items_job_status_idx
  on public.psi_tender_document_import_items (job_id, status, next_attempt_at);

alter table public.psi_tender_processing_jobs enable row level security;
alter table public.psi_tender_document_import_items enable row level security;
revoke all on public.psi_tender_processing_jobs from public, authenticated, anon;
revoke all on public.psi_tender_document_import_items from public, authenticated, anon;
grant select on public.psi_tender_processing_jobs to service_role;
grant select on public.psi_tender_document_import_items to service_role;

commit;
```

`supabase/rollbacks/032_tender_processing_jobs_rollback.sql`:

```sql
do $$
begin
  if exists (select 1 from public.psi_tender_processing_jobs where status not in ('cancelled','completed') limit 1) then
    raise exception 'Rollback 032 bloqueado: existen jobs activos.';
  end if;
end $$;
drop table if exists public.psi_tender_document_import_items;
drop table if exists public.psi_tender_processing_jobs;
```

- [ ] **Step 4: Verificar**

Run: `node tests/tender-processing-jobs-pglite.integration.test.mjs`
Expected: PASS — imprime `tender-processing-jobs pglite integration passed`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/032_tender_processing_jobs.sql supabase/rollbacks/032_tender_processing_jobs_rollback.sql tests/tender-processing-jobs-pglite.integration.test.mjs
git commit -m "feat(tenders): add durable processing jobs and import items tables"
```

---

### Task 1.2: Migración 033 — extensión unificada de `psi_tender_tracking_events`

**Files:**
- Create: `supabase/migrations/033_tender_tracking_events_unified.sql`
- Create: `supabase/rollbacks/033_tender_tracking_events_unified_rollback.sql`
- Create: `tests/tender-tracking-events-unified-pglite.integration.test.mjs`

**Interfaces:**
- Produces (DDL): columnas `actor_kind`, `source_ref_type`, `source_ref_id`, `metadata jsonb`, `visibility`; CHECK de `event_type` ampliado preservando los 8 valores actuales; índice `(tender_id, created_at desc, id desc)`; trigger append-only (bloquea UPDATE/DELETE).
- Consumido por: Task 1.4 (RPC de eventos), Entregable 4 (historial/backfill).

- [ ] **Step 1: Prueba roja**

```js
// tests/tender-tracking-events-unified-pglite.integration.test.mjs
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const strip = (s) => s.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const base = strip(readFileSync(new URL('../supabase/migrations/017_tender_tracking_workflow.sql', import.meta.url), 'utf8'));
const ext = strip(readFileSync(new URL('../supabase/migrations/033_tender_tracking_events_unified.sql', import.meta.url), 'utf8'));
const rollback = readFileSync(new URL('../supabase/rollbacks/033_tender_tracking_events_unified_rollback.sql', import.meta.url), 'utf8');

const tender = '33333333-3333-4333-8333-333333333333';

async function db() {
  const pg = new PGlite();
  await pg.exec(`
    create role authenticated; create role service_role;
    create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true, role text not null, microsoft_email text not null);
    create table public.psi_sales_opportunities (id uuid primary key, company_name text not null);
    create table public.psi_public_tenders (id uuid primary key, stable_key text not null unique, internal_status text not null default 'nueva',
      tracking_owner_id uuid, tracking_status text, tracking_next_action text, tracking_due_at timestamptz, tracking_blocker text,
      tracking_last_note text, tracking_started_at timestamptz, tracking_updated_at timestamptz);
    insert into public.psi_public_tenders (id, stable_key) values ('${tender}', 'k1');
  `);
  await pg.exec(base);
  await pg.exec(ext);
  return pg;
}

async function run() {
  const pg = await db();
  // Preserva y amplía event_type: un evento legado sigue siendo válido
  await pg.exec(`insert into public.psi_tender_tracking_events (id, tender_id, event_type, actor_kind, visibility)
    values (gen_random_uuid(), '${tender}', 'entered_tracking', 'human', 'internal');`);
  // Nuevo tipo de proceso
  await pg.exec(`insert into public.psi_tender_tracking_events (id, tender_id, event_type, actor_kind, source_ref_type, source_ref_id, metadata, visibility)
    values (gen_random_uuid(), '${tender}', 'document_import_completed', 'system', 'job', gen_random_uuid(), '{"imported":38,"failed":2}'::jsonb, 'internal');`);
  // actor_kind inválido rechazado
  await assert.rejects(
    pg.exec(`insert into public.psi_tender_tracking_events (id, tender_id, event_type, actor_kind) values (gen_random_uuid(), '${tender}', 'snapshot_published', 'robot');`),
    /actor_kind/i);
  // event_type desconocido rechazado
  await assert.rejects(
    pg.exec(`insert into public.psi_tender_tracking_events (id, tender_id, event_type, actor_kind) values (gen_random_uuid(), '${tender}', 'not_a_type', 'system');`),
    /event_type/i);
  // Append-only: UPDATE y DELETE bloqueados
  await assert.rejects(pg.exec(`update public.psi_tender_tracking_events set note='x' where tender_id='${tender}';`), /append-only|inmutable|immutable/i);
  await assert.rejects(pg.exec(`delete from public.psi_tender_tracking_events where tender_id='${tender}';`), /append-only|inmutable|immutable/i);
  // Rollback retira columnas nuevas y restaura CHECK original (evento nuevo ya no cabría)
  await pg.exec(rollback);
  const cols = (await pg.query(`select count(*)::int as c from information_schema.columns
    where table_schema='public' and table_name='psi_tender_tracking_events' and column_name in ('actor_kind','source_ref_type','source_ref_id','metadata','visibility')`)).rows[0].c;
  assert.equal(cols, 0);
  console.log('tender-tracking-events-unified pglite integration passed');
}
run();
```

- [ ] **Step 2: Ejecutar y comprobar fallo**

Run: `node tests/tender-tracking-events-unified-pglite.integration.test.mjs`
Expected: FAIL — `ENOENT` sobre `033_tender_tracking_events_unified.sql`.

- [ ] **Step 3: Implementar la migración**

`supabase/migrations/033_tender_tracking_events_unified.sql`:

```sql
begin;

alter table public.psi_tender_tracking_events
  add column if not exists actor_kind text not null default 'human',
  add column if not exists source_ref_type text,
  add column if not exists source_ref_id uuid,
  add column if not exists metadata jsonb,
  add column if not exists visibility text not null default 'internal';

alter table public.psi_tender_tracking_events drop constraint if exists psi_tender_tracking_events_event_type_check;
alter table public.psi_tender_tracking_events add constraint psi_tender_tracking_events_event_type_check
  check (event_type in (
    'entered_tracking','tracking_updated','assigned','blocked','unblocked','returned_to_radar','converted','discarded',
    'detected','pipeline_queued',
    'document_discovery_started','document_import_progress','document_import_completed','document_import_partial','document_import_failed',
    'snapshot_published',
    'analysis_queued','analysis_started','analysis_completed','analysis_failed','analysis_rules_fallback_shown',
    'requirement_pending','information_requested','addendum_reviewed','observation_recorded','internal_meeting','case_note',
    'go_decided','no_go_decided','offer_preparation_started','offer_submitted','awarded','not_awarded','cancelled','deserted'));

alter table public.psi_tender_tracking_events add constraint psi_tender_tracking_events_actor_kind_check
  check (actor_kind in ('human','agent','system'));
alter table public.psi_tender_tracking_events add constraint psi_tender_tracking_events_visibility_check
  check (visibility in ('internal'));
alter table public.psi_tender_tracking_events add constraint psi_tender_tracking_events_metadata_object_check
  check (metadata is null or jsonb_typeof(metadata) = 'object');

create index if not exists psi_tender_tracking_events_tender_cursor_idx
  on public.psi_tender_tracking_events (tender_id, created_at desc, id desc);

create or replace function public.psi_tender_tracking_events_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'psi_tender_tracking_events es append-only: % no permitido', tg_op;
end $$;
drop trigger if exists psi_tender_tracking_events_immutable on public.psi_tender_tracking_events;
create trigger psi_tender_tracking_events_immutable
  before update or delete on public.psi_tender_tracking_events
  for each row execute function public.psi_tender_tracking_events_append_only();

commit;
```

`supabase/rollbacks/033_tender_tracking_events_unified_rollback.sql`:

```sql
drop trigger if exists psi_tender_tracking_events_immutable on public.psi_tender_tracking_events;
drop function if exists public.psi_tender_tracking_events_append_only();
drop index if exists public.psi_tender_tracking_events_tender_cursor_idx;
alter table public.psi_tender_tracking_events drop constraint if exists psi_tender_tracking_events_metadata_object_check;
alter table public.psi_tender_tracking_events drop constraint if exists psi_tender_tracking_events_visibility_check;
alter table public.psi_tender_tracking_events drop constraint if exists psi_tender_tracking_events_actor_kind_check;
alter table public.psi_tender_tracking_events drop constraint if exists psi_tender_tracking_events_event_type_check;
alter table public.psi_tender_tracking_events add constraint psi_tender_tracking_events_event_type_check
  check (event_type in ('entered_tracking','tracking_updated','assigned','blocked','unblocked','returned_to_radar','converted','discarded'));
alter table public.psi_tender_tracking_events
  drop column if exists actor_kind,
  drop column if exists source_ref_type,
  drop column if exists source_ref_id,
  drop column if exists metadata,
  drop column if exists visibility;
```

- [ ] **Step 4: Verificar**

Run: `node tests/tender-tracking-events-unified-pglite.integration.test.mjs`
Expected: PASS. Regresión (no debe romperse): `node tests/tender-tracking-pglite.integration.test.mjs` (usa migración 018 sobre el esquema base; el esquema base de ese test no incluye las nuevas columnas, así que confirmar que sigue verde).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/033_tender_tracking_events_unified.sql supabase/rollbacks/033_tender_tracking_events_unified_rollback.sql tests/tender-tracking-events-unified-pglite.integration.test.mjs
git commit -m "feat(tenders): extend tracking events into unified append-only process history"
```

---

### Task 1.3: Migración 034 — RPCs de ciclo de vida y claim del job

**Files:**
- Create: `supabase/migrations/034_tender_processing_rpc.sql`
- Create: `supabase/rollbacks/034_tender_processing_rpc_rollback.sql`
- Create: `tests/tender-processing-rpc-pglite.integration.test.mjs`

**Interfaces:**
- Produces (RPC, `security definer`, execute solo `service_role`):
  - `psi_create_tender_processing_job(p_tender_id uuid, p_opportunity_id uuid, p_pipeline_version text, p_idempotency_key text, p_requested_by uuid) returns jsonb` — idempotente; si ya hay job activo por la oportunidad devuelve `{status:'existing', job_id}`; en creación inserta eventos `converted` (si no existe) y `pipeline_queued` atómicamente.
  - `psi_claim_tender_processing_job(p_lease_seconds integer) returns jsonb` — advisory lock, libera leases expirados, `for update skip locked`, asigna `lease_id`/`lease_expires_at`, devuelve un job o `{status:'empty'}`.
  - `psi_update_tender_processing_job(p_job_id uuid, p_lease_id uuid, p_patch jsonb) returns jsonb` — exige `lease_id` coincidente; aplica status/current_step/contadores/errores/snapshot_id/analysis_run_id del `p_patch`; rechaza worker tardío con lease distinto.

- [ ] **Step 1: Prueba roja** (`tests/tender-processing-rpc-pglite.integration.test.mjs`) — cubre: creación idempotente (dos llamadas con misma key → mismo `job_id`, un solo job activo); `psi_claim_tender_processing_job` devuelve un job y marca lease; un segundo claim inmediato devuelve `{status:'empty'}` (job ya arrendado); tras expirar el lease (`p_lease_seconds` corto + `update ... lease_expires_at = now() - interval '1s'`) el claim vuelve a entregarlo; `psi_update_tender_processing_job` con `lease_id` correcto avanza `status`; con `lease_id` ajeno lanza excepción `lease`. Cargar migraciones `017,018,032,033,034` sobre el esquema sembrado. Asertar sobre el JSON devuelto y sobre filas.

```js
// tests/tender-processing-rpc-pglite.integration.test.mjs — esqueleto de aserciones clave
// (cargar 017,018,032,033,034 con strip begin/commit; sembrar profiles/opportunities/tenders)
const a = (await pg.query(`select public.psi_create_tender_processing_job('${T}','${O}','v1','k1','${U}') as r`)).rows[0].r;
const b = (await pg.query(`select public.psi_create_tender_processing_job('${T}','${O}','v1','k1','${U}') as r`)).rows[0].r;
assert.equal(a.job_id, b.job_id);
assert.equal((await pg.query(`select count(*)::int c from public.psi_tender_processing_jobs where opportunity_id='${O}' and status not in ('completed','cancelled')`)).rows[0].c, 1);
assert.ok((await pg.query(`select count(*)::int c from public.psi_tender_tracking_events where event_type='pipeline_queued'`)).rows[0].c >= 1);
const claim1 = (await pg.query(`select public.psi_claim_tender_processing_job(60) as r`)).rows[0].r;
assert.equal(claim1.job_id, a.job_id);
const claim2 = (await pg.query(`select public.psi_claim_tender_processing_job(60) as r`)).rows[0].r;
assert.equal(claim2.status, 'empty');
await pg.exec(`update public.psi_tender_processing_jobs set lease_expires_at = now() - interval '1 second' where id='${a.job_id}';`);
const claim3 = (await pg.query(`select public.psi_claim_tender_processing_job(60) as r`)).rows[0].r;
assert.equal(claim3.job_id, a.job_id);
const upd = (await pg.query(`select public.psi_update_tender_processing_job('${a.job_id}', '${claim3.lease_id}', '{"status":"discovering_documents","current_step":"documents"}'::jsonb) as r`)).rows[0].r;
assert.equal(upd.status, 'ok');
await assert.rejects(pg.query(`select public.psi_update_tender_processing_job('${a.job_id}', gen_random_uuid(), '{"status":"needs_attention"}'::jsonb)`), /lease/i);
console.log('tender-processing-rpc pglite integration passed');
```

- [ ] **Step 2: Ejecutar y comprobar fallo** — Run: `node tests/tender-processing-rpc-pglite.integration.test.mjs`; Expected: FAIL — `ENOENT` sobre `034_tender_processing_rpc.sql`.

- [ ] **Step 3: Implementar la migración** — `supabase/migrations/034_tender_processing_rpc.sql` con las tres funciones. Puntos normativos de implementación:
  - Las tres `create or replace function ... language plpgsql security definer set search_path = public, pg_temp;`.
  - `psi_create_tender_processing_job`: `pg_advisory_xact_lock(hashtext('psi_tender_processing_jobs:'||p_opportunity_id::text))`; si existe job activo por oportunidad → devolver `{status:'existing', job_id}`; si no, `insert ... on conflict (idempotency_key) do nothing returning id`; si conflictó, `select id`; insertar evento `pipeline_queued` (`actor_kind='system'`, `source_ref_type='job'`, `source_ref_id=job`), y `converted` solo si no existe ya para ese tender; devolver `{status:'created'|'existing', job_id}`.
  - `psi_claim_tender_processing_job`: `pg_advisory_xact_lock(hashtext('psi_tender_processing_jobs:claim'))`; `update ... set lease_id=null, lease_expires_at=null where lease_expires_at < now()`; seleccionar un job elegible (`status in ('queued','discovering_documents','importing_documents','retry_wait','ready_for_snapshot','snapshot_ready','waiting_agent_capacity','analyzing')` y `(next_attempt_at is null or next_attempt_at <= now())` y `lease_id is null`) con `order by created_at for update skip locked limit 1`; asignar `lease_id=gen_random_uuid()`, `lease_expires_at=now()+make_interval(secs=>least(p_lease_seconds,600))`, `started_at=coalesce(started_at,now())`; devolver `{status:'claimed', job_id, lease_id, ...}` o `{status:'empty'}`.
  - `psi_update_tender_processing_job`: `select ... for update`; si `lease_id <> p_lease_id` → `raise exception 'lease inválido'`; aplicar campos presentes en `p_patch` (whitelist: status, current_step, attempt_count, next_attempt_at, documents_*, snapshot_id, analysis_run_id, last_error_code, last_error_message, lease_id, lease_expires_at, completed_at); validar que `snapshot_id`/`analysis_run_id` referidos correspondan al mismo tender/oportunidad (join); `updated_at=now()`; devolver `{status:'ok'}`.
  - `grant execute ... to service_role;` `revoke all ... from public, authenticated, anon;`.

`supabase/rollbacks/034_tender_processing_rpc_rollback.sql`: `drop function if exists` de las tres firmas exactas.

- [ ] **Step 4: Verificar** — Run: `node tests/tender-processing-rpc-pglite.integration.test.mjs`; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/034_tender_processing_rpc.sql supabase/rollbacks/034_tender_processing_rpc_rollback.sql tests/tender-processing-rpc-pglite.integration.test.mjs
git commit -m "feat(tenders): add job create/claim/update RPCs with atomic lease and idempotency"
```

---

### Task 1.4: Migración 035 — RPC de eventos automáticos, ítems de importación y autorización de análisis

**Files:**
- Create: `supabase/migrations/035_tender_analysis_authorization.sql`
- Create: `supabase/rollbacks/035_tender_analysis_authorization_rollback.sql`
- Create: `tests/tender-analysis-authorization-pglite.integration.test.mjs`

**Interfaces:**
- Produces (RPC service-role):
  - `psi_append_tender_tracking_event(p_tender_id uuid, p_event_type text, p_actor_kind text, p_created_by uuid, p_source_ref_type text, p_source_ref_id uuid, p_metadata jsonb, p_note text, p_singular boolean) returns jsonb` — inserta evento; si `p_actor_kind='human'` exige `p_created_by` humano activo; si `system|agent` exige `p_created_by is null` (o identidad agente); con `p_singular=true` deduplica por `(event_type, source_ref_type, source_ref_id)` (`{status:'exists'}`).
  - `psi_record_tender_import_item(p_job_id uuid, p_source text, p_source_document_id text, p_source_url text, p_name text, p_status text, p_critical boolean, p_document_version_id uuid, p_last_error_code text, p_last_error_message text) returns jsonb` — upsert idempotente por `(job_id, source, source_document_id)`; deriva tender/oportunidad del job.
  - `psi_authorize_tender_analysis(p_job_id uuid, p_authorized_by uuid) returns jsonb` — valida `p_authorized_by` humano activo; fija `analysis_authorized_by`/`analysis_authorized_at`; si el job estaba en `awaiting_analysis_authorization` lo avanza a `waiting_agent_capacity` cuando ya hay snapshot; inserta evento `analysis_queued`. La elegibilidad nominal (custodia) se hace en el endpoint (Task 3.4) y se audita (Task 3.6); esta RPC no codifica nombres.

- [ ] **Step 1: Prueba roja** (`tests/tender-analysis-authorization-pglite.integration.test.mjs`): evento `human` sin `created_by` humano → excepción; evento `system` con `created_by` no nulo → excepción; evento singular repetido → `{status:'exists'}` y una sola fila; `psi_record_tender_import_item` dos veces con misma identidad → una fila, estado actualizado; `psi_authorize_tender_analysis` fija `analysis_authorized_by` e inserta `analysis_queued`. Cargar `017,018,032,033,034,035`.

```js
// aserciones clave
await assert.rejects(pg.query(`select public.psi_append_tender_tracking_event('${T}','case_note','human',null,null,null,null,'x',false)`), /humano|human/i);
await assert.rejects(pg.query(`select public.psi_append_tender_tracking_event('${T}','snapshot_published','system','${U}',null,null,null,null,false)`), /system|agent/i);
const s1 = (await pg.query(`select public.psi_append_tender_tracking_event('${T}','snapshot_published','system',null,'snapshot','${SNAP}',null,null,true) as r`)).rows[0].r;
const s2 = (await pg.query(`select public.psi_append_tender_tracking_event('${T}','snapshot_published','system',null,'snapshot','${SNAP}',null,null,true) as r`)).rows[0].r;
assert.equal(s2.status, 'exists');
assert.equal((await pg.query(`select count(*)::int c from public.psi_tender_tracking_events where event_type='snapshot_published'`)).rows[0].c, 1);
await pg.query(`select public.psi_record_tender_import_item('${JOB}','SECOP II','d1',null,'Pliego','imported',false,null,null,null)`);
await pg.query(`select public.psi_record_tender_import_item('${JOB}','SECOP II','d1',null,'Pliego','unchanged',false,null,null,null)`);
assert.equal((await pg.query(`select status from public.psi_tender_document_import_items where job_id='${JOB}' and source_document_id='d1'`)).rows[0].status, 'unchanged');
const auth = (await pg.query(`select public.psi_authorize_tender_analysis('${JOB_ID}','${U}') as r`)).rows[0].r;
assert.equal(auth.status, 'ok');
assert.ok((await pg.query(`select analysis_authorized_by from public.psi_tender_processing_jobs where id='${JOB_ID}'`)).rows[0].analysis_authorized_by);
console.log('tender-analysis-authorization pglite integration passed');
```

- [ ] **Step 2: Ejecutar y comprobar fallo** — Run: `node tests/tender-analysis-authorization-pglite.integration.test.mjs`; Expected: FAIL — `ENOENT` sobre `035_tender_analysis_authorization.sql`.

- [ ] **Step 3: Implementar la migración** con las tres funciones (`security definer`, execute `service_role`), validando reglas de actor descritas arriba, y su rollback (`drop function` de las tres firmas).

- [ ] **Step 4: Verificar** — Run: `node tests/tender-analysis-authorization-pglite.integration.test.mjs`; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/035_tender_analysis_authorization.sql supabase/rollbacks/035_tender_analysis_authorization_rollback.sql tests/tender-analysis-authorization-pglite.integration.test.mjs
git commit -m "feat(tenders): add automatic-event, import-item and analysis-authorization RPCs"
```

---

### Task 1.5: Runner de migración remota `scripts/tender-durable-pipeline-migrations.mjs` (artefacto del gate, no aplica en remoto)

**Files:**
- Create: `scripts/tender-durable-pipeline-migrations.mjs`
- Create: `tests/tender-durable-pipeline-migrations-runner.test.mjs`

**Interfaces:**
- Produces (exportables puros, sin red): `stripTopLevelTransactionWrapper(sql)`, `MIGRATION_FILES` (lista ordenada 032–035), `ROLLBACK_FILES` (orden inverso), `apply(execSql)`, `rollback(execSql)`, `verify(execSql)`, `preflight(execSql)`. `main()` (solo si se ejecuta como CLI) usa `exec_sql` remoto como `scripts/tender-tracking-migrations.mjs`. **Ninguna prueba llama a `main()` ni toca red**: inyectan un `execSql` falso (o PGlite) — mismo patrón que `tests/tender-document-state-migrations-runner.test.mjs`.

- [ ] **Step 1: Prueba roja** — el test importa `stripTopLevelTransactionWrapper` y `MIGRATION_FILES`, y verifica: el wrapper elimina el `begin;`/`commit;` de nivel superior de `032`; `MIGRATION_FILES` lista exactamente `['032_tender_processing_jobs.sql','033_tender_tracking_events_unified.sql','034_tender_processing_rpc.sql','035_tender_analysis_authorization.sql']`; `ROLLBACK_FILES` es el inverso; `apply(fakeExec)` invoca `fakeExec` una vez por migración en orden. Run esperado FAIL: `Cannot find module '../scripts/tender-durable-pipeline-migrations.mjs'`.

- [ ] **Step 2: Ejecutar y comprobar fallo** — Run: `node tests/tender-durable-pipeline-migrations-runner.test.mjs`; Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar** el runner replicando la estructura de `scripts/tender-tracking-migrations.mjs` (carga `.env.local`, `exec_sql`, modos `preflight|apply|verify|rollback`) pero con `MIGRATION_FILES`/`ROLLBACK_FILES` de este entregable y `verify` que comprueba `to_regclass` de las dos tablas + `count` de las 8 funciones nuevas. Exportar las funciones puras; ejecutar `main()` solo si `import.meta.url === pathToFileURL(process.argv[1]).href`.

- [ ] **Step 4: Verificar** — Run: `node tests/tender-durable-pipeline-migrations-runner.test.mjs`; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/tender-durable-pipeline-migrations.mjs tests/tender-durable-pipeline-migrations-runner.test.mjs
git commit -m "feat(tenders): add durable-pipeline migration runner (remote apply gated)"
```

> La aplicación de estas migraciones al **Supabase remoto** es el **Gate 7.4** (Entregable 7). Este runner no se ejecuta contra remoto en ninguna tarea de código.

---

# Entregable 2 — Dominio y worker por lotes

Módulos ESM puros en la raíz (junto a `tender-analysis-domain.js`, `tender-document-versioning.js`), sin acceso a red ni DB; el worker recibe todas sus dependencias inyectadas para ser probable con fakes.

### Task 2.1: Máquina de estados del pipeline

**Files:**
- Create: `tender-pipeline-state.js`
- Create: `tests/tender-pipeline-state.test.mjs`

**Interfaces:**
- Produces: `PIPELINE_STATES` (Set), `nextPipelineState(current, event)` → estado destino, `assertValidTransition(current, event)` (lanza en transición inválida), `isTerminalState(state)`.
- Transiciones normativas (spec §7): `queued -(discover)-> discovering_documents -(import)-> importing_documents`; `importing_documents -(retry)-> retry_wait -(resume)-> importing_documents`; `importing_documents -(exhausted)-> needs_attention`; `importing_documents -(usable)-> ready_for_snapshot -(published)-> snapshot_ready -(authorized?)-> awaiting_analysis_authorization|waiting_agent_capacity`; `waiting_agent_capacity -(capacity)-> analyzing`; `analyzing -(busy)-> waiting_agent_capacity`; `analyzing -(ai_run)-> completed`; `analyzing -(exhausted)-> needs_attention`; `* -(cancel)-> cancelled`. `completed`/`cancelled` terminales.

- [ ] **Step 1: Prueba roja** — casos: cada transición válida devuelve el destino esperado; `assertValidTransition('completed','discover')` lanza `/transición inválida/`; una regla nunca completa (`nextPipelineState('analyzing','rules_shown')` no es `completed`); `isTerminalState('cancelled')===true`. Run esperado FAIL: `Cannot find module`.

- [ ] **Step 2: Ejecutar y comprobar fallo** — Run: `node tests/tender-pipeline-state.test.mjs`; Expected: FAIL.

- [ ] **Step 3: Implementar** `tender-pipeline-state.js` como tabla de transición `Map` de `${state}:${event}` → destino, con `assertValidTransition` que lanza `Error('transición inválida: '+current+' + '+event)` si no existe.

- [ ] **Step 4: Verificar** — Run: `node tests/tender-pipeline-state.test.mjs`; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tender-pipeline-state.js tests/tender-pipeline-state.test.mjs
git commit -m "feat(tenders): add durable pipeline state machine"
```

---

### Task 2.2: Clasificación de errores y backoff

**Files:**
- Create: `tender-pipeline-backoff.js`
- Create: `tests/tender-pipeline-backoff.test.mjs`

**Interfaces:**
- Produces: `classifyPipelineError(error)` → `'retryable'|'terminal'|'operational'` (retryable: timeout/429/5xx/DNS/busy/quota/saturated; terminal: URL inválida/privada, tipo/tamaño no permitido, contenido vacío tras extracción, contrato de proveedor inválido repetido; operational: TLS/credencial/sesión); `computeBackoffMs({ attempt, baseMs=2000, maxMs=300000, jitter })` con backoff exponencial acotado + jitter inyectable; `MAX_ATTEMPTS` (p.ej. 6, no ilimitado).

- [ ] **Step 1: Prueba roja** — `classifyPipelineError({code:'AGT002_CODEX_TIMEOUT'})==='retryable'`; `{code:'AGT002_CODEX_LOGIN_REQUIRED'}==='operational'`; `{code:'TENDER_DOC_EMPTY_TEXT'}==='terminal'`; `computeBackoffMs({attempt:1,jitter:()=>0})` < `computeBackoffMs({attempt:5,jitter:()=>0})` y ambos ≤ `maxMs`; jitter determinista con `jitter:()=>1`. Run esperado FAIL.

- [ ] **Step 2: Ejecutar y comprobar fallo** — Run: `node tests/tender-pipeline-backoff.test.mjs`; Expected: FAIL.

- [ ] **Step 3: Implementar** el módulo con un mapa de códigos y `Math.min(maxMs, baseMs*2**(attempt-1)) + jitter()*baseMs`.

- [ ] **Step 4: Verificar** — Run: `node tests/tender-pipeline-backoff.test.mjs`; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tender-pipeline-backoff.js tests/tender-pipeline-backoff.test.mjs
git commit -m "feat(tenders): add pipeline error classification and bounded backoff"
```

---

### Task 2.3: Claves de idempotencia

**Files:**
- Create: `tender-pipeline-idempotency.js`
- Create: `tests/tender-pipeline-idempotency.test.mjs`

**Interfaces:**
- Produces: `jobIdempotencyKey({ tenderId, opportunityId, pipelineVersion })` = `tender:{tender}:conversion:{opportunity}:pipeline:{version}`; `documentIdentity({ opportunityId, source, sourceDocumentId })`; `singularEventKey({ eventType, sourceRefType, sourceRefId })`. Deterministas y estables.

- [ ] **Step 1: Prueba roja** — igualdad exacta de la cadena `jobIdempotencyKey` para entradas fijas; determinismo (dos llamadas iguales → misma clave); `documentIdentity` distinta al cambiar `sourceDocumentId`. Run esperado FAIL.

- [ ] **Step 2: Ejecutar y comprobar fallo** — Run: `node tests/tender-pipeline-idempotency.test.mjs`; Expected: FAIL.

- [ ] **Step 3: Implementar** el módulo (interpolación de plantillas literales).

- [ ] **Step 4: Verificar** — Run: `node tests/tender-pipeline-idempotency.test.mjs`; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tender-pipeline-idempotency.js tests/tender-pipeline-idempotency.test.mjs
git commit -m "feat(tenders): add stable pipeline idempotency keys"
```

---

### Task 2.4: Agregación de progreso para UI/eventos

**Files:**
- Create: `tender-pipeline-progress.js`
- Create: `tests/tender-pipeline-progress.test.mjs`

**Interfaces:**
- Produces: `summarizeImportProgress(job)` → `{ label, imported, unchanged, failed, discovered, processed, remaining, status_kind }` donde `label` agrupa (p.ej. `'38 importados · 2 fallidos'`) sin exponer 40 logs; `analysisLabel(analysisEngine)` → una de las etiquetas normativas (`'Análisis con IA · AGT-002'`, `'Preanálisis por reglas · SIIO'`, `'AGT-002 no disponible'`, `'Esperando capacidad/cuota de AGT-002'`).

- [ ] **Step 1: Prueba roja** — `summarizeImportProgress({documents_imported:38,documents_failed:2,...}).label==='38 importados · 2 fallidos'`; `analysisLabel({requested:'AGT-002',used:'siio_rules_v1',fallback:true,reason:'quota'})==='Esperando capacidad/cuota de AGT-002'`; `analysisLabel({used:'AGT-002',fallback:false})==='Análisis con IA · AGT-002'`. Run esperado FAIL.

- [ ] **Step 2: Ejecutar y comprobar fallo** — Run: `node tests/tender-pipeline-progress.test.mjs`; Expected: FAIL.

- [ ] **Step 3: Implementar** el módulo con las reglas de etiqueta (mapear `reason` `quota|saturated`→esperando capacidad; `not_configured|preview_unavailable`→`AGT-002 no disponible`).

- [ ] **Step 4: Verificar** — Run: `node tests/tender-pipeline-progress.test.mjs`; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tender-pipeline-progress.js tests/tender-pipeline-progress.test.mjs
git commit -m "feat(tenders): add progress aggregation and normative analysis labels"
```

---

### Task 2.5: Worker de procesamiento por lotes

**Files:**
- Create: `tender-processing-worker.js`
- Create: `tests/tender-processing-worker.test.mjs`

**Interfaces:**
- Consumes: los módulos 2.1–2.4; deps inyectadas `{ database, claimJob, updateJob, recordImportItem, appendEvent, revalidateOfficialStatus, discoverDocuments, importOneDocument, publishSnapshot, requestAgt002, now }`.
- Produces: `createTenderProcessingWorker(deps)` → `{ runOnce({ batchSize=3, timeBudgetMs=90000 }) }` que: (1) reclama un job; (2) revalida estado oficial y, si terminal, transita a `cancelled` + evento y termina sin analizar; (3) por `current_step`, descubre (una vez), importa un lote ≤`batchSize` respetando `timeBudgetMs`, o publica snapshot cuando es utilizable (≥1 doc actual con texto y sin fallo `critical`), o pide capacidad AGT-002; (4) nunca sustituye AGT-002 por reglas; (5) reintenta/`needs_attention` según clasificación; (6) toda escritura pasa el `lease_id`.

- [ ] **Step 1: Prueba roja** — con fakes en memoria:
  - job en `queued` con estado oficial terminal → worker deja `status:'cancelled'`, `appendEvent` recibió `cancelled`, `requestAgt002` NO fue llamado.
  - job `importing_documents` con 5 docs y `batchSize:2` → procesa 2, deja el resto `pending`, incrementa `documents_processed`.
  - `importOneDocument` que lanza `AGT002_CODEX_TIMEOUT`-like retryable → item `failed_retryable` con `next_attempt_at`, job no `needs_attention` aún.
  - snapshot utilizable → `publishSnapshot` llamado y evento `snapshot_published`.
  - capacidad `quota` → `requestAgt002` retorna `{status:'quota'}` → job `waiting_agent_capacity`, evento `analysis_rules_fallback_shown` NO marca completado; `status` nunca pasa a `completed` por reglas.
  Run esperado FAIL: `Cannot find module`.

- [ ] **Step 2: Ejecutar y comprobar fallo** — Run: `node tests/tender-processing-worker.test.mjs`; Expected: FAIL.

- [ ] **Step 3: Implementar** `tender-processing-worker.js` orquestando los módulos puros y las deps; sin llamadas directas a red (todo por deps). Mantener el presupuesto de tiempo comparando `now()` contra `timeBudgetMs`.

- [ ] **Step 4: Verificar** — Run: `node tests/tender-processing-worker.test.mjs`; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tender-processing-worker.js tests/tender-processing-worker.test.mjs
git commit -m "feat(tenders): add batched durable processing worker (deps injected)"
```

---

### Task 2.6: Observabilidad — logging sanitizado y métricas derivables

**Files:**
- Create: `tender-pipeline-observability.js`
- Create: `tests/tender-pipeline-observability.test.mjs`

**Interfaces:**
- Produces: `logPipelineEvent(event, fields)` — emite JSON con SOLO claves seguras (`correlation_id`, `job_id`, `tender_id`, `code`, `status`, `current_step`, `latency_ms`, `attempt_count`, conteos); descarta en silencio cualquier otra clave (documentos, prompts, HMAC, tokens, `extracted_text`, `result` crudo), patrón de `agt002-hetzner-bridge-log.js`. `deriveJobMetrics(jobs, now)` → métricas mínimas de spec §14: jobs por estado y antigüedad, jobs con lease expirado, proporción AGT-002 vs reglas, expedientes cuyo `analysis_run.snapshot_id` ≠ `current_snapshot_id`. `pipelineAlerts(metrics, thresholds)` → alertas (`stalled_job`, `needs_attention`, `bridge_unhealthy`, `zero_agt002_runs`, `rules_fallback_in_auto`, `stale_analysis`).

- [ ] **Step 1: Prueba roja** — `logPipelineEvent` con una clave `extracted_text` NO la emite (parsear la línea y asertar ausencia); `deriveJobMetrics` agrupa por estado y detecta un lease expirado; `pipelineAlerts` marca `stalled_job` cuando la antigüedad supera el umbral y `rules_fallback_in_auto` cuando un flujo automático mostró reglas. Run esperado FAIL: `Cannot find module`.
- [ ] **Step 2: Ejecutar y comprobar fallo** — Run: `node tests/tender-pipeline-observability.test.mjs`; Expected: FAIL.
- [ ] **Step 3: Implementar** el módulo con una whitelist de claves y agregaciones puras.
- [ ] **Step 4: Verificar** — Run: `node tests/tender-pipeline-observability.test.mjs`; Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add tender-pipeline-observability.js tests/tender-pipeline-observability.test.mjs
git commit -m "feat(tenders): add sanitized pipeline logging and derivable metrics"
```

---

# Entregable 3 — Endpoints y autorización nominal (custodia Katherine/Juan)

Todo handler se escribe **idéntico** en `server/index.js` y `api/[...path].js`. Tras cada tarea correr `npm run check:backend-parity` y `node tests/backend-parity.test.mjs`.

### Task 3.1: `POST /api/tender-convert` responde inmediato con job durable

**Files:**
- Modify: `server/index.js` (handler `/api/tender-convert` :1704; `convertTenderToOpportunity` :2463-2493)
- Modify: `api/[...path].js` (idéntico)
- Create: `tests/tender-convert-durable-static.test.mjs`

**Interfaces:**
- **Depende de Task 7.1** (`tender-durable-flags.js`): crear ese módulo antes de esta tarea (el import `isTenderDurablePipelineEnabled` debe existir para compilar y para el test).
- Produces: `convertTenderToOpportunity` deja de invocar `refreshTenderDocumentsFromOfficialSource` síncrono; tras crear/recuperar la oportunidad, llama `psi_create_tender_processing_job(...)` (vía nuevo wrapper `callCreateTenderProcessingJob(database, {...})` en `tender-tracking-rpc.js` o inline) detrás del flag `isTenderDurablePipelineEnabled(process.env)` (Task 7.1); responde `{ id, tender_id, duplicate, processing: { job_id, status:'queued', current_step:'documents', automatic_analysis } }`. Conserva `requireAction(currentProfile, ACTIONS.LICITACIONES_CONVERT)` y el guard de estado terminal (:2468-2470). Con el flag apagado conserva el comportamiento actual (compat).

- [ ] **Step 1: Prueba roja** (`tests/tender-convert-durable-static.test.mjs`) — lee ambos backends como texto y asegura, en los dos: que el handler `/api/tender-convert` referencia `psi_create_tender_processing_job` (o el wrapper) y devuelve una clave `processing`; que **no** llama `refreshTenderDocumentsFromOfficialSource` dentro de `convertTenderToOpportunity` cuando el flag durable está activo (asertar la presencia de la rama `isTenderDurablePipelineEnabled`); y que ambos archivos son byte-idénticos (`buffersAreEqual`). Run esperado FAIL (aún no implementado).

- [ ] **Step 2: Ejecutar y comprobar fallo** — Run: `node tests/tender-convert-durable-static.test.mjs`; Expected: FAIL — falta la rama durable en el código.

- [ ] **Step 3: Implementar** el cambio idéntico en ambos archivos: bajo `isTenderDurablePipelineEnabled(process.env)`, sustituir el bloque síncrono de importación por la creación del job y la respuesta inmediata; mantener el guard terminal y la custodia. (El scheduler/worker inmediato es una optimización opcional; la garantía es el scheduler de Task 3.5.)

- [ ] **Step 4: Verificar** — Run: `node tests/tender-convert-durable-static.test.mjs`; luego `npm run check:backend-parity` y `node tests/backend-parity.test.mjs`; también `node tests/tender-auto-analysis-contract.test.mjs` (compat con flag apagado). Expected: PASS todos.

- [ ] **Step 5: Commit**

```bash
git add server/index.js api/[...path].js tests/tender-convert-durable-static.test.mjs
git commit -m "feat(tenders): make tender-convert return immediately with durable job"
```

---

### Task 3.2: `GET /api/tender-processing-status`

**Files:**
- Modify: `server/index.js` + `api/[...path].js` (nuevo handler idéntico, junto a los `/api/tender-*` :2664+)
- Create: `tests/tender-processing-status-static.test.mjs`

**Interfaces:**
- Produces: `GET /api/tender-processing-status?opportunity_id=...` → estado seguro: `{ job_id, status, current_step, counts:{discovered,processed,imported,unchanged,failed}, snapshot_id, analysis_run_id, last_error_code, last_error_message, updated_at, analysis_engine? }`. Requiere acceso de seguimiento; **nunca** devuelve secretos, prompts, cuerpo del proveedor ni `extracted_text`.

- [ ] **Step 1: Prueba roja** — el test estático (ambos archivos) exige: ruta registrada, selección de una whitelist de columnas, ausencia de `extracted_text`/`result`/`usage` crudos en la respuesta, y guard de acceso. Run esperado FAIL.
- [ ] **Step 2:** Run: `node tests/tender-processing-status-static.test.mjs`; Expected: FAIL.
- [ ] **Step 3:** Implementar handler idéntico en ambos archivos (whitelist de campos, `requireTenderTrackingAccess`).
- [ ] **Step 4:** Run test + `npm run check:backend-parity` + `node tests/backend-parity.test.mjs`; Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add server/index.js api/[...path].js tests/tender-processing-status-static.test.mjs
git commit -m "feat(tenders): add safe processing-status endpoint"
```

---

### Task 3.3: `POST /api/tender-processing-retry`

**Files:** Modify ambos backends; Create `tests/tender-processing-retry-static.test.mjs`.

**Interfaces:** `POST /api/tender-processing-retry` — acción humana; requiere `requireAction(profile, ACTIONS.LICITACIONES_CONVERT)` (custodia), `opportunity_id`, paso/ítems fallidos e `idempotency_key`; reactiva `failed_retryable`/`needs_attention` poniendo `next_attempt_at=now()` y estado a `retry_wait`/`importing_documents` o `waiting_agent_capacity`; inserta evento de reintento; no reactiva procesos terminales.

- [ ] **Step 1:** Prueba roja estática (ambos archivos): ruta, guard de custodia, requisito de `idempotency_key`, inserción de evento de reintento, rechazo si el job está `cancelled`. FAIL esperado.
- [ ] **Step 2:** Run: `node tests/tender-processing-retry-static.test.mjs`; Expected: FAIL.
- [ ] **Step 3:** Implementar idéntico en ambos archivos.
- [ ] **Step 4:** Run test + parity checks; Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add server/index.js api/[...path].js tests/tender-processing-retry-static.test.mjs
git commit -m "feat(tenders): add human-authorized processing retry endpoint"
```

---

### Task 3.4: `POST /api/tender-analysis-authorize` (custodia, sin nombres en código)

**Files:** Modify ambos backends; Create `tests/tender-analysis-authorize-static.test.mjs`.

**Interfaces:** `POST /api/tender-analysis-authorize` — requiere `requireAction(profile, ACTIONS.AI_ANALYSIS_RUN)` que ya resuelve a `canTenderCustodyAction(profile)` (commit `72ec1c1`). Llama `psi_authorize_tender_analysis(job_id, profile.id)`, registrando `analysis_authorized_by = profile.id`. No autoriza GO/NO GO, envío ni presentación. **No** contiene literales "Katherine"/"Juan": la elegibilidad es el permiso de custodia; la correspondencia exacta con los dos perfiles se audita en Task 3.6.

- [ ] **Step 1:** Prueba roja estática (ambos archivos): ruta presente, guard `ACTIONS.AI_ANALYSIS_RUN`, llamada a `psi_authorize_tender_analysis`, ausencia de literales de nombres propios (`assert(!src.includes('Katherine') && !src.includes('Juan Botero'))`), y que no toca GO/NO GO. FAIL esperado.
- [ ] **Step 2:** Run: `node tests/tender-analysis-authorize-static.test.mjs`; Expected: FAIL.
- [ ] **Step 3:** Implementar idéntico en ambos archivos.
- [ ] **Step 4:** Run test + parity checks + `node tests/access-control.test.mjs` (sin regresión de custodia); Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add server/index.js api/[...path].js tests/tender-analysis-authorize-static.test.mjs
git commit -m "feat(tenders): add custody-gated analysis authorization endpoint"
```

---

### Task 3.5: Worker interno `POST /api/internal/tender-processing-worker`

**Files:** Modify ambos backends; Create `tests/tender-processing-worker-endpoint-static.test.mjs`.

**Interfaces:** `POST /api/internal/tender-processing-worker` — server-only, protegido por secreto de scheduler (`TENDER_WORKER_SCHEDULER_SECRET` en header, comparación en tiempo constante), **sin sesión de navegador**, service role, body mínimo; reclama trabajo en DB vía el worker (Task 2.5); no acepta un expediente arbitrario del cliente. Detrás de `isTenderDurablePipelineEnabled`. Responde `{ processed: n }` con datos no sensibles.

- [ ] **Step 1:** Prueba roja estática (ambos): ruta bajo `/api/internal/`, verificación del secreto con `timingSafeEqual` (no `===`), ausencia de `getAuthContext`/sesión, uso de service role, y que no lee un expediente del body. FAIL esperado.
- [ ] **Step 2:** Run: `node tests/tender-processing-worker-endpoint-static.test.mjs`; Expected: FAIL.
- [ ] **Step 3:** Implementar idéntico en ambos archivos. La frecuencia real del scheduler (Vercel Cron u equivalente) se decide en el gate del Entregable 7; el endpoint es recuperación-first.
- [ ] **Step 4:** Run test + parity checks; Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add server/index.js api/[...path].js tests/tender-processing-worker-endpoint-static.test.mjs
git commit -m "feat(tenders): add scheduler-secret internal worker endpoint"
```

---

### Task 3.6: Auditoría nominal mecánica de autorizadores

**Files:**
- Create: `scripts/check_tender_analysis_authorizers.mjs`
- Create: `tests/tender-analysis-authorizers-audit.test.mjs`

**Interfaces:**
- Produces (lógica pura, sin Supabase): `findCustodyEligibleProfiles(profiles)` (perfiles activos humanos con permisos `licitaciones`+`licitaciones_custodia`), `diffAuthorizers(eligibleIds, expectedIds)` → `{ ok, missing, extra }`. `main(perfilesJsonPath, expectedIdsCsv)` imprime `TENDER_AUTHORIZERS_OK` o `TENDER_AUTHORIZERS_FAILED`. Reutiliza el patrón de `agt002-hetzner-bridge-rbac-audit.js` / `scripts/check_agt002_bridge_rbac_eligibility.mjs`. **No** consulta Supabase (el export de perfiles es un gate humano); **no** hardcodea nombres — recibe los UUID esperados por argumento.

- [ ] **Step 1: Prueba roja** — con un fixture de perfiles en memoria: dos perfiles con custodia + un tercero sin custodia → `findCustodyEligibleProfiles` devuelve exactamente los dos; `diffAuthorizers([id1,id2],[id1,id2]).ok===true`; con un tercer elegible inesperado `diffAuthorizers(...).extra` no vacío y `ok===false`. Run esperado FAIL.
- [ ] **Step 2:** Run: `node tests/tender-analysis-authorizers-audit.test.mjs`; Expected: FAIL.
- [ ] **Step 3:** Implementar el módulo/script.
- [ ] **Step 4:** Run: `node tests/tender-analysis-authorizers-audit.test.mjs`; Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add scripts/check_tender_analysis_authorizers.mjs tests/tender-analysis-authorizers-audit.test.mjs
git commit -m "feat(tenders): add mechanical authorizer eligibility audit (no hardcoded names)"
```

> El **run real** contra el export de perfiles productivos es el **Gate 7.4/7.7**: confirma mecánicamente que exactamente Katherine y Juan poseen la custodia (spec §19 pregunta 3).

---

# Entregable 4 — Historial unificado y backfill privado-excluido

### Task 4.1: Lectura unificada con paginación por cursor

**Files:** Modify ambos backends (`GET /api/tender-tracking-events` :1467); Create `tests/tender-tracking-events-unified-api-static.test.mjs`.

**Interfaces:** el GET amplía la selección a todos los eventos del proceso (los nuevos `event_type`), ordena `created_at desc, id desc`, y pagina por cursor estable (`?cursor=<created_at>,<id>&limit=`). Devuelve `{ events:[...], next_cursor }`. Mapea `actor_kind`/`source_ref_*`/`metadata` para la UI. No expone datos privados.

- [ ] **Step 1:** Prueba roja estática (ambos): selección incluye columnas nuevas, orden por `(created_at desc, id desc)`, parámetro `cursor`/`limit`, respuesta con `next_cursor`. FAIL esperado.
- [ ] **Step 2:** Run: `node tests/tender-tracking-events-unified-api-static.test.mjs`; Expected: FAIL.
- [ ] **Step 3:** Implementar idéntico en ambos archivos.
- [ ] **Step 4:** Run test + parity checks + `node tests/tender-tracking-api.test.mjs`; Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add server/index.js api/[...path].js tests/tender-tracking-events-unified-api-static.test.mjs
git commit -m "feat(tenders): unify tracking-events read with cursor pagination"
```

---

### Task 4.2: Escritura de actuación pública tipada

**Files:** Modify ambos backends (nuevo `POST /api/tender-actuation`); Create `tests/tender-actuation-types.test.mjs`.

**Interfaces:** `POST /api/tender-actuation` — actor automático (perfil autenticado como `created_by`, `actor_kind='human'`); tipos permitidos SOLO del vocabulario licitatorio público (`requirement_pending`,`information_requested`,`addendum_reviewed`,`observation_recorded`,`internal_meeting`,`case_note`); rechaza tipos comerciales/privados (`llamada`,`correo`,`whatsapp`) con 400; escribe vía `psi_append_tender_tracking_event`. Módulo puro `tender-actuation-types.js` con `PUBLIC_ACTUATION_TYPES` y `assertPublicActuationType(type)`.

- [ ] **Step 1: Prueba roja** — `assertPublicActuationType('case_note')` ok; `assertPublicActuationType('llamada')` lanza; el handler (ambos archivos) referencia `PUBLIC_ACTUATION_TYPES` y `actor_kind='human'`. FAIL esperado.
- [ ] **Step 2:** Run: `node tests/tender-actuation-types.test.mjs`; Expected: FAIL.
- [ ] **Step 3:** Crear `tender-actuation-types.js` (import en ambos backends) + handler idéntico.
- [ ] **Step 4:** Run test + parity checks; Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add tender-actuation-types.js server/index.js api/[...path].js tests/tender-actuation-types.test.mjs
git commit -m "feat(tenders): add typed public actuation write with fixed actor"
```

---

### Task 4.3: Backfill idempotente privado-excluido (dry-run por defecto)

**Files:**
- Create: `tender-tracking-backfill.js`
- Create: `tests/tender-tracking-backfill.test.mjs`

**Interfaces:**
- Produces: `selectBackfillableInteractions(interactions)` — filtra `psi_sales_interactions` legadas y conserva solo `kind ∈ {tender_document_upload, tender_document_analysis}` y notas públicas del expediente; **excluye** `interaction_type ∈ {llamada,correo,whatsapp}` y cualquier dato de decisor/teléfono/correo/comisión; `mapToTrackingEvent(interaction)` → payload con `source_ref_type='legacy_sales_interaction'`, `source_ref_id`, `actor_kind='system'`, preservando la fecha histórica (`occurred_at`), sin falsear timestamps; `runBackfill(deps, { dryRun=true })` — idempotente por `source_ref_id` (no reinserta si ya existe), reporta plan en dry-run sin escribir.

- [ ] **Step 1: Prueba roja** — una interacción `llamada` se excluye; una `documento`/`tender_document_upload` se incluye pero su payload mapeado NO contiene teléfono/correo/decisor; `runBackfill` en `dryRun:true` no invoca el `appendEvent`; segunda corrida con el mismo `source_ref_id` ya presente → 0 inserciones (idempotente). Run esperado FAIL.
- [ ] **Step 2:** Run: `node tests/tender-tracking-backfill.test.mjs`; Expected: FAIL.
- [ ] **Step 3:** Implementar `tender-tracking-backfill.js` (puro + deps inyectadas).
- [ ] **Step 4:** Run: `node tests/tender-tracking-backfill.test.mjs`; Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add tender-tracking-backfill.js tests/tender-tracking-backfill.test.mjs
git commit -m "feat(tenders): add idempotent private-excluded history backfill (dry-run default)"
```

> La **ejecución escritura** del backfill sobre datos productivos es parte del **Gate 7.6** (Aerocivil), nunca en una tarea de código.

---

# Entregable 5 — UI: Resumen / Seguimiento / Documentos / Análisis

Pruebas estáticas de fuente (`node:fs` + regex + `esbuild.buildSync`), patrón de `tests/tender-guided-workspace-ui.test.mjs`. Discriminador: `service_type_code === 'licitacion_publica'`. No afectar el CRM privado.

### Task 5.1: Resumen especializado del expediente

**Files:** Modify `src/main.tsx` (grid privado `:790`, hero `:785`); Create `tests/tender-summary-public-fields.test.mjs`.

**Interfaces:** para `service_type_code==='licitacion_publica'`, reemplazar el grid privado por cuatro grupos (Proceso oficial / Cronograma y cuantía / Gestión interna / Expediente y análisis, spec §11.1). El grid privado (`Tipo de cliente`, `Decisor`, `Correo decisor`, `Teléfono`, `Cierre estimado`) se gatea para NO renderizarse en licitaciones. Las oportunidades privadas conservan su grid intacto.

- [ ] **Step 1: Prueba roja** — el test lee `src/main.tsx` y asegura: existe una rama condicional por `service_type_code === 'licitacion_publica'` alrededor de las tarjetas privadas; el bloque público incluye labels `Entidad`, `Cierre oficial`, `Días restantes`, `Snapshot`, `Productor`; y `buildSync` compila `main.tsx`. FAIL esperado (hoy el grid es incondicional).
- [ ] **Step 2:** Run: `node tests/tender-summary-public-fields.test.mjs`; Expected: FAIL.
- [ ] **Step 3:** Implementar el render condicional en `src/main.tsx`.
- [ ] **Step 4:** Run test + `node tests/tender-detail-layout-order.test.mjs` (sin regresión) + `npm run build`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/main.tsx tests/tender-summary-public-fields.test.mjs
git commit -m "feat(tenders): specialize public Resumen and hide private CRM fields"
```

---

### Task 5.2: Seguimiento del expediente (proceso + actuación + historial)

**Files:** Modify `src/main.tsx` (`:794-795` Datos comerciales/Observaciones/FollowUpForm/Línea de seguimientos) y `src/tenders/api.ts`; Create `tests/tender-follow-up-public.test.mjs`.

**Interfaces:** para licitaciones: (1) `Datos del proceso` estructurado (sin blob `Observaciones`, sin `Sede` mal mapeada); (2) formulario `Registrar actuación o novedad` con tipos públicos (Task 4.2), actor actual automático (no seleccionable); (3) `Historial del proceso` paginado (cursor) más reciente primero, con actor/sistema/fecha/tipo/enlace, agrupando eventos técnicos (usa `summarizeImportProgress`). Añadir en `src/tenders/api.ts` `postActuation()` y paginación de `loadTrackingEvents`.

- [ ] **Step 1: Prueba roja** — el test asegura (en `main.tsx`): rama licitación que NO renderiza `interactionTypes` comerciales en el formulario y usa tipos públicos; el actor no es un `<select>` libre (actor actual automático); el historial se alimenta de `loadTrackingEvents` con cursor. En `api.ts`: existe `postActuation` y `loadTrackingEvents` acepta `cursor`. FAIL esperado.
- [ ] **Step 2:** Run: `node tests/tender-follow-up-public.test.mjs`; Expected: FAIL.
- [ ] **Step 3:** Implementar cambios en `main.tsx` y `api.ts`.
- [ ] **Step 4:** Run test + `npm run build`; Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/main.tsx src/tenders/api.ts tests/tender-follow-up-public.test.mjs
git commit -m "feat(tenders): rebuild follow-up as public actuation + unified history"
```

---

### Task 5.3: `TenderDocumentSection` con progreso de job

**Files:** Modify `src/tenders/components/TenderDocumentSection.tsx`, `src/tenders/api.ts`; Create `tests/tender-document-section-progress.test.mjs`.

**Interfaces:** progreso del job, conteos por estado, fallos con causa segura, botón `Reintentar fallidos` (→ `/api/tender-processing-retry`), versiones vigentes/históricas, estado de extracción, fuente oficial. Añadir `loadProcessingStatus()` en `api.ts` (→ `/api/tender-processing-status`).

- [ ] **Step 1: Prueba roja** — el test asegura que `TenderDocumentSection.tsx` referencia conteos (`imported`/`failed`), un CTA de reintento y `loadProcessingStatus`; y que `api.ts` exporta `loadProcessingStatus`. FAIL esperado.
- [ ] **Step 2:** Run: `node tests/tender-document-section-progress.test.mjs`; Expected: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Run test + `npm run build`; Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/tenders/components/TenderDocumentSection.tsx src/tenders/api.ts tests/tender-document-section-progress.test.mjs
git commit -m "feat(tenders): show durable job progress in document section"
```

---

### Task 5.4: `TenderAnalysisSection` con productor/fallback explícitos

**Files:** Modify `src/tenders/components/TenderAnalysisSection.tsx`; Create `tests/tender-analysis-section-labels.test.mjs`.

**Interfaces:** CTA por estado (`Esperando documentos`, `Análisis AGT-002 en cola`, `Analizando con AGT-002`, `Reintentar AGT-002`, `Ver análisis AGT-002`); etiquetas normativas de productor/método/fallback (`analysisLabel`, Task 2.4); preanálisis por reglas como recurso secundario claramente etiquetado, nunca CTA principal.

- [ ] **Step 1: Prueba roja** — el test asegura que el componente contiene las cadenas de CTA por estado y las etiquetas normativas, y que el botón de reglas está marcado como secundario. FAIL esperado.
- [ ] **Step 2:** Run: `node tests/tender-analysis-section-labels.test.mjs`; Expected: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Run test + `npm run build`; Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/tenders/components/TenderAnalysisSection.tsx tests/tender-analysis-section-labels.test.mjs
git commit -m "feat(tenders): make analysis producer and fallback explicit in UI"
```

---

### Task 5.5: Cola general y flujo de conversión con job

**Files:** Modify `src/tenders/TenderTrackingView.tsx` (convert `:112-124`), `src/tenders/types.ts` (`:30`); Create `tests/tender-tracking-view-durable.test.mjs`.

**Interfaces:** el resultado de `convert` ahora expone `processing.job_id`; tras convertir, la vista navega al expediente y el detalle consulta `/api/tender-processing-status` (progreso sobrevive recarga porque vive en estado servidor, no local). La fila de la cola muestra estado documental y estado de análisis derivados del mismo estado/historial (no un segundo historial). `TenderConversionResult` gana `processing?: { job_id; status; current_step; automatic_analysis }`.

- [ ] **Step 1: Prueba roja** — el test asegura: `types.ts` declara `processing` en `TenderConversionResult`; `TenderTrackingView.tsx` lee `conversion.processing?.job_id`; y la fila muestra columnas de estado documental/análisis. FAIL esperado.
- [ ] **Step 2:** Run: `node tests/tender-tracking-view-durable.test.mjs`; Expected: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Run test + `node tests/tender-functional-views.test.mjs` + `npm run build`; Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/tenders/TenderTrackingView.tsx src/tenders/types.ts tests/tender-tracking-view-durable.test.mjs
git commit -m "feat(tenders): derive queue status from durable job and unified state"
```

---

# Entregable 6 — Aerocivil dry-run y host TLS declarativo

### Task 6.1: Host TLS declarativo (reconciliar guion vs punto)

**Files:**
- Create: `agt002-bridge-host.js`
- Modify: `ops/agt002-hetzner-bridge/run-server.mjs`, `ops/agt002-hetzner-bridge/Caddyfile` (artefacto de configuración, no aplicado)
- Create: `tests/agt002-bridge-host-declarative.test.mjs`

**Interfaces:** un único origen de verdad `AGT002_BRIDGE_HOST` (constante exportada con default `agt002.5-78-140-24.sslip.io`, override por env), consumido por el default del cliente, el generador del `Caddyfile` y `run-server.mjs`; `bridgeRunUrl(host)` → `https://{host}/v1/agt002-preview/run`. El test verifica que cliente, Caddyfile artefacto y pruebas coincidan en un solo string y que la forma con puntos observada en producción se documente como override explícito (nunca dos hosts divergentes en silencio).

- [ ] **Step 1: Prueba roja** — `bridgeRunUrl(AGT002_BRIDGE_HOST)` termina en `/v1/agt002-preview/run`; el `Caddyfile` versionado y `AGT002_BRIDGE_HOST` contienen exactamente el mismo host (leer ambos archivos y comparar). FAIL esperado (módulo no existe).
- [ ] **Step 2:** Run: `node tests/agt002-bridge-host-declarative.test.mjs`; Expected: FAIL.
- [ ] **Step 3:** Crear `agt002-bridge-host.js`; hacer que `run-server.mjs` lo importe; añadir comentario en `Caddyfile` documentando que la forma con puntos (`agt002.5.78.140.24.sslip.io`) solo se usa si el DNS efectivo del servidor lo exige, vía `AGT002_BRIDGE_HOST`. No aplicar Caddy.
- [ ] **Step 4:** Run test + `node tests/agt002-hetzner-bridge-client.test.mjs` (sin regresión). Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add agt002-bridge-host.js ops/agt002-hetzner-bridge/run-server.mjs ops/agt002-hetzner-bridge/Caddyfile tests/agt002-bridge-host-declarative.test.mjs
git commit -m "feat(agt002): make bridge TLS host declarative and reconcile hyphen/dot"
```

> La **reparación TLS real** en Hetzner (aplicar Caddy, ACME, verificar vhost/cert) es el **Gate 7.5**; ninguna tarea de código lo ejecuta.

---

### Task 6.2: Dry-run de backfill de Aerocivil (solo lectura)

**Files:**
- Create: `aerocivil-backfill-dryrun.js`
- Create: `scripts/aerocivil-backfill-dryrun.mjs`
- Create: `tests/aerocivil-backfill-dryrun.test.mjs`

**Interfaces:** lógica pura `planAerocivilBackfill({ interactions, expectedCount = 40 })` (spec §12): valida cada entrada legada del evento `tender_document_upload` (storage/path, tamaño, MIME, hash, texto, fuente); deriva `source_document_id` estable o `legacy:<hash-or-id>` documentado; devuelve `{ ready:[], excluded:[{reason}], expected:40, found }` y explica cada exclusión/fallo. **No escribe nada**; `psi_record_tender_document_version` NO se llama en dry-run. El script `.mjs` localiza por UUID (no por nombre) y solo imprime el plan.

- [ ] **Step 1: Prueba roja** — 40 entradas válidas → `ready.length===40`, `excluded.length===0`; una entrada sin `extracted_text` → excluida con `reason:'empty_text'`; una sin `source_document_id` → `ready` con identidad `legacy:<hash>`; `planAerocivilBackfill` nunca invoca escritura (no hay deps de escritura). FAIL esperado.
- [ ] **Step 2:** Run: `node tests/aerocivil-backfill-dryrun.test.mjs`; Expected: FAIL.
- [ ] **Step 3:** Implementar el módulo + script de lectura.
- [ ] **Step 4:** Run: `node tests/aerocivil-backfill-dryrun.test.mjs`; Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add aerocivil-backfill-dryrun.js scripts/aerocivil-backfill-dryrun.mjs tests/aerocivil-backfill-dryrun.test.mjs
git commit -m "feat(tenders): add read-only Aerocivil backfill dry-run planner"
```

---

### Task 6.3: Retiro gobernado de snapshot para rollback de backfill

**Files:**
- Create: `tender-snapshot-retire.js`
- Create: `tests/tender-snapshot-retire.test.mjs`

**Interfaces:** `planSnapshotRetirement({ jobId, currentSnapshotId, targetSnapshotId })` — construye el plan de rollback del backfill sin borrar filas append-only: retira el snapshot como vigente vía el mecanismo gobernado (`psi_begin_tender_document_refresh` + `psi_record_tender_document_snapshot` para re-anclar a un snapshot previo o dejar `current_snapshot_id` anterior) y marca el job `needs_attention`/`revertido`. Devuelve las llamadas RPC previstas; no ejecuta.

- [ ] **Step 1: Prueba roja** — el plan nunca incluye `delete`/`drop` sobre versiones/snapshots/runs; incluye la apertura de refresh gobernado y el marcado del job; con `targetSnapshotId` nulo deja el `current_snapshot_id` previo sin destruir el nuevo. FAIL esperado.
- [ ] **Step 2:** Run: `node tests/tender-snapshot-retire.test.mjs`; Expected: FAIL.
- [ ] **Step 3:** Implementar el planificador puro.
- [ ] **Step 4:** Run: `node tests/tender-snapshot-retire.test.mjs`; Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add tender-snapshot-retire.js tests/tender-snapshot-retire.test.mjs
git commit -m "feat(tenders): add governed snapshot retirement plan for backfill rollback"
```

---

# Entregable 7 — QA, flags, rollout y deploy (con gates)

### Task 7.1: Flags fail-closed del pipeline durable

**Files:**
- Create: `tender-durable-flags.js`
- Create: `tests/tender-durable-flags.test.mjs`

**Interfaces:** `isTenderDurablePipelineEnabled(env=process.env)`, `isTenderPublicUiEnabled(env)`, `isTenderAutoAnalysisEnabled(env)` — cada uno true solo si su variable (`TENDER_DURABLE_PIPELINE`, `TENDER_PUBLIC_UI`, `TENDER_AUTO_ANALYSIS`) es exactamente `'on'`. Por defecto (ausente) → false (fail-closed), patrón de `isAgt002PreviewConfigured`.

> Esta tarea se implementa **antes** que las Tasks 3.1/3.5 en tiempo de ejecución (esos handlers ya la importan). Si se sigue el orden numérico, crear este módulo primero o dejar el import listo; el test de 3.1 exige su existencia.

- [ ] **Step 1: Prueba roja** — `isTenderDurablePipelineEnabled({})===false`; `isTenderDurablePipelineEnabled({TENDER_DURABLE_PIPELINE:'on'})===true`; valores `'true'`/`'1'` → false (solo `'on'`). FAIL esperado.
- [ ] **Step 2:** Run: `node tests/tender-durable-flags.test.mjs`; Expected: FAIL.
- [ ] **Step 3:** Implementar el módulo.
- [ ] **Step 4:** Run: `node tests/tender-durable-flags.test.mjs`; Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add tender-durable-flags.js tests/tender-durable-flags.test.mjs
git commit -m "feat(tenders): add fail-closed durable-pipeline feature flags"
```

---

### Task 7.2: Suite completa, paridad y build (puente inactivo, flags apagadas)

**Files:** ninguno nuevo (tarea de verificación).

- [ ] **Step 1: Correr toda la suite de tests**

```bash
for t in tests/*.test.mjs; do node "$t" || { echo "FALLÓ: $t"; exit 1; }; done
```
Expected: todos PASS.

- [ ] **Step 2: Correr los checks estáticos y paridad**

```bash
npm run check:backend-parity
node tests/backend-parity.test.mjs
npm run check:nav-permissions
node scripts/check_backend_permission_guards.mjs
```
Expected: todos PASS.

- [ ] **Step 3: Build de TypeScript + Vite**

```bash
npm run build
```
Expected: `tsc && vite build` sin errores.

- [ ] **Step 4: Confirmar fail-closed por defecto**

Con las variables `TENDER_DURABLE_PIPELINE`/`TENDER_PUBLIC_UI`/`TENDER_AUTO_ANALYSIS` ausentes y `TENDER_ANALYSIS_ENGINE` sin `agt002_codex_preview`, el comportamiento productivo no cambia (convert sigue funcionando en modo compat; AGT-002 cae a reglas etiquetadas). No se requiere código nuevo; documentar la corrida.

- [ ] **Step 5: Commit** (si hubo ajustes menores para verde; si no, omitir)

```bash
git commit --allow-empty -m "test(tenders): full suite, parity and build green with durable pipeline inactive"
```

---

### Task 7.3 (Gate, manual — NO ejecutada ahora): Migración remota de 032–035

- [ ] **Paso 1 (manual):** Con credenciales autorizadas (`.env.local` con `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`), correr el preflight:

```bash
node scripts/tender-durable-pipeline-migrations.mjs preflight
```

- [ ] **Paso 2 (manual, con aprobación explícita):** aplicar en remoto:

```bash
node scripts/tender-durable-pipeline-migrations.mjs apply
node scripts/tender-durable-pipeline-migrations.mjs verify
```
Rollback disponible: `node scripts/tender-durable-pipeline-migrations.mjs rollback`.

- [ ] **Paso 3 (manual):** correr la auditoría nominal de autorizadores contra un export local de perfiles (nunca commiteado):

```bash
node scripts/check_tender_analysis_authorizers.mjs /ruta/local/perfiles.json <id-katherine>,<id-juan>
```
Expected: `TENDER_AUTHORIZERS_OK`. Si `TENDER_AUTHORIZERS_FAILED` con `extra` no vacío, corregir custodia por el modelo RBAC (nunca hardcodeando nombres) antes de activar.

> Bloquea la activación del pipeline (flag `TENDER_DURABLE_PIPELINE`) en producción. No se asume acceso remoto ni credenciales sin este gate.

---

### Task 7.4 (Gate, manual — NO ejecutada ahora): Reparación Hetzner/TLS + smoke sintético

- [ ] **Paso 1 (manual):** acceso autorizado o intervención del administrador de Hetzner; aplicar `ops/agt002-hetzner-bridge/Caddyfile` con el host efectivo (`AGT002_BRIDGE_HOST`), corregir ACME, verificar que Node escucha solo tras Caddy y que HMAC/sesión/modelo están configurados (spec §10.1).
- [ ] **Paso 2 (manual):** ejecutar un smoke sintético autorizado y comprobar un run persistido con productor/método/modelo/uso/duración y citas válidas.

> Bloquea el análisis automático real. Nunca se ejecuta desde una tarea de código.

---

### Task 7.5 (Gate, manual — NO ejecutada ahora): Corrida real única de Aerocivil

- [ ] **Paso 1 (manual):** correr el dry-run de solo lectura y validar 40 entradas o explicar cada exclusión:

```bash
node scripts/aerocivil-backfill-dryrun.mjs <opportunity-uuid> <tender-uuid>
```

- [ ] **Paso 2 (gate humano, Juan/Katherine):** aprobar; ejecutar el backfill escritura (fuera de tareas de código), abrir refresh gobernado y publicar snapshot; ejecutar UNA corrida real de AGT-002; verificar evidencia/productor/modelo/uso/vigencia; mostrar el run por reglas como histórico, no como IA; NO registrar GO/NO GO automáticamente.
- [ ] **Paso 3 (manual):** rollback disponible vía `planSnapshotRetirement` (Task 6.3) sin borrar filas append-only.

---

### Task 7.6 (Gate, manual — NO ejecutada ahora): Cuota 20, deploy y rollout de flags

- [ ] **Paso 1 (manual, con aprobación de Juan):** en Vercel, fijar `AGT002_PREVIEW_DAILY_MAX_RUNS=20`, mantener `AGT002_PREVIEW_MAX_CONCURRENT=1`, y verificar el valor efectivo tras deploy.
- [ ] **Paso 2 (manual):** activar por fases las flags `TENDER_DURABLE_PIPELINE=on`, luego `TENDER_PUBLIC_UI=on`, luego `TENDER_AUTO_ANALYSIS=on`, con el scheduler autenticado (`TENDER_WORKER_SCHEDULER_SECRET`) apuntando a `/api/internal/tender-processing-worker`; confirmar la frecuencia real que admite el plan Vercel (spec §18, riesgo Cron).
- [ ] **Paso 3 (manual):** deploy productivo; validación funcional por Juan/Katherine (spec §17). Rollback: apagar flags no elimina jobs ni datos; detener scheduler no destruye estado.

---

## Resumen de gates humanos (ninguno se ejecuta en tareas de código 1–6)

| Gate | Naturaleza | Bloquea |
|---|---|---|
| 7.3 | Migración remota 032–035 + auditoría nominal de autorizadores | Activación del pipeline durable en producción |
| 7.4 | Reparación TLS/Hetzner + smoke sintético | Análisis automático real de AGT-002 |
| 7.5 | Backfill + corrida real única de Aerocivil (revisión Juan/Katherine) | Cierre funcional de Aerocivil |
| 7.6 | Cuota 20, deploy y rollout de flags | Producción real |

Ninguna tarea de este plan hace push, deploy, aplica migración remota, accede a Hetzner por SSH ni ejecuta Aerocivil real. Las Tareas de los Entregables 1–6 son código puro probado offline (PGlite, node assert, esbuild); las Tareas 7.3–7.6 son runbooks humanos con gate explícito y credenciales/aprobación requeridas.
