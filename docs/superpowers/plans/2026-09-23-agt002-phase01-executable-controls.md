# AGT-002 Fase 01 — Controles ejecutables (gate v1 / authority registry / VALID_LINK)

> **Para workers agénticos:** SUB-SKILL REQUERIDO: `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans`. Ejecutar tarea por tarea, en orden, sin saltar pasos RED. Los pasos usan checkbox (`- [ ]`).

**Goal:** dejar en el repo, para AGT-002 Fase 01, tres controles **ejecutables** — `gate` (schema v1 con ciclo de vida separado del resultado), `authority-registry` (versionado, con grants durables y vigencia) y `VALID_LINK` (álgebra de tres veredictos sobre términos nombrados) — implementados como JSON Schemas versionados + un validador Node sin dependencias nuevas + fixtures aislados + una matriz de negativos obligatorios. Todo lo que no se pueda comprobar contra un hecho durable resuelve a `UNVERIFIED`; nada resuelve a `VALID` por omisión.

**Architecture:** cuatro capas, todas locales, cero red, cero Supabase:

1. **Contratos versionados** — `contracts/agt002-phase01/v1/*.schema.json` (gate, authority-registry, binding-registry, valid-link-claim, fixture-context) más los dos registros de datos: `authority-registry.json` y `binding-registry.json`.
2. **Validador Node** — `agt002-phase01-executable-controls.js` (raíz del repo, junto a los ~132 módulos `agt002-*.js` existentes). Motor de JSON Schema de subconjunto + semántica de los tres controles + canonicalización/hash. ESM, sin dependencias nuevas.
3. **Fixtures aislados** — `contracts/agt002-phase01/v1/fixtures/**` con `environment: "isolated_fixture"`, `synthetic: true`, `active_case: null`, UUIDs del namespace sintético `f1c70000-…`, locators `fixture://`. Jamás evidencia productiva.
4. **Diseño de almacenamiento NO aplicable** — `supabase/migration-designs/2026-09-23-agt002-phase01-gate-ledger.design.sql`, con banner `DO NOT APPLY` y una guarda SQL que aborta si alguien la ejecuta. Fuera de `supabase/migrations/`, fuera del orden de migraciones.

**Tech Stack:** Node.js ESM, `node:test`, `node:assert/strict`, `node:crypto` (SHA-256), `node:fs`/`node:path`. Cero cambios en `package.json`, cero cambios en `src/`, `server/`, `api/`, `supabase/migrations/`.

**Spec:** este plan es autocontenido. Las secciones “Hechos vivos”, “Contrato gate v1”, “Authority registry v1” y “Álgebra VALID_LINK” son normativas: los tests las citan literalmente.

---

## Línea base verificada (no re-derivar)

| Hecho | Valor | Cómo se confirma |
|---|---|---|
| Suite completa | **2109 pass, 0 fail, 10 skipped** | `npm test` (Task 0, Step 3) |
| Migración máxima aplicada | `091_agt002_validation_recovery_slot.sql` | `ls supabase/migrations` |
| Script `lint` | **no existe** en `package.json` | `npm run` / lectura de `package.json` |
| Gates técnicos disponibles | `npm run check:backend-parity`, `npx tsc --noEmit`, `npm run build` | `package.json:9,16` |
| Artefactos Fase 01 en el árbol | ninguno | `git ls-files | grep agt002-phase01` |

Al cierre (Task 10) la suite debe quedar en **0 fail, 10 skipped** y `pass ≥ 2109 + (tests nuevos de este plan)`. Cualquier cambio en `skipped` es un fallo del plan y se detiene.

---

## Hechos vivos (evidencia durable en repo, con locator exacto)

Estos son los únicos hechos que este plan puede usar para elevar un término a `VALID`. Cada uno se cita por `archivo:línea` y se verifica en test (`tests/agt002-phase01-binding-registry.test.mjs`, Task 6) leyendo el archivo y comprobando que el fragmento aparece en el rango declarado.

| ID durable | Hecho | Locator | Fragmento verificable |
|---|---|---|---|
| `AGT002-P1-FACT-0001` | Binding inverso real tender→oportunidad | `supabase/migrations/005_public_tenders_radar.sql:27` | `converted_opportunity_id uuid references public.psi_sales_opportunities(id) on delete set null` |
| `AGT002-P1-FACT-0002` | Unicidad del binding inverso (cardinalidad ≤ 1 por oportunidad) | `supabase/migrations/018_tender_tracking_rpc.sql:42-44` | `psi_public_tenders_converted_opportunity_id_unique` |
| `AGT002-P1-FACT-0003` | Estado vigente/live de la licitación | `supabase/migrations/005_public_tenders_radar.sql:26` | `internal_status text not null default 'nueva' check (internal_status in ('nueva','en_revision','descartada','convertida_oportunidad'))` |
| `AGT002-P1-FACT-0004` | Estados cerrados de oportunidad | `supabase/migrations/022_tender_go_no_go_workflow.sql:42-48` | `'presentada', 'adjudicada', 'no_adjudicada', 'cerrada_no_go'` |
| `AGT002-P1-FACT-0005` | Oportunidad descartada | `supabase/migrations/018_tender_tracking_rpc.sql:427` | `stage_code = 'descartado'` |
| `AGT002-P1-FACT-0006` | Filtro “cerradas” en la lectura paginada oficial | `supabase/migrations/088_tender_opportunity_primary_stage_filters.sql:48` | `in ('cerrada_no_go', 'adjudicada', 'no_adjudicada')` |
| `AGT002-P1-FACT-0007` | Identidad de principal: humano o agente | `supabase/migrations/022_tender_go_no_go_workflow.sql:38-41` | `identity_type is null or identity_type in ('human', 'agent')` |
| `AGT002-P1-FACT-0008` | Catálogo de roles (rol ≠ persona) | `supabase/migrations/019_profile_area_permissions.sql:23` | `'admin', 'gerencia', 'director', 'comercial', 'colaborador', 'junta'` |
| `AGT002-P1-FACT-0009` | Permisos por perfil **sin** vigencia ni `grant_id` | `supabase/migrations/019_profile_area_permissions.sql:144-150` | `primary key (profile_id, permission_code)` |
| `AGT002-P1-FACT-0010` | Catálogo de permisos **sin** vigencia | `supabase/migrations/019_profile_area_permissions.sql:119-125` | `code text primary key` |
| `AGT002-P1-FACT-0011` | El único ledger de gate existente es de dominio Radar, no genérico | `supabase/migrations/071_agt002_radar_gate.sql` | `psi_agt002_radar_gate_evaluations` |

**Hechos negativos (ausencias), igualmente normativos:**

| ID durable | Ausencia | Consecuencia en el validador |
|---|---|---|
| `AGT002-P1-GAP-0001` | No existe entidad/tabla/endpoint `L` (término **A**, `ENTITY_L`) | término A ⇒ `UNVERIFIED` (`link.term_a.entity_l_absent`), nunca `VALID`, nunca `INVALID` |
| `AGT002-P1-GAP-0002` | No existe la columna literal `psi_sales_opportunities.tender_id` (término **B**, `FK O.tender_id`) | término B literal ⇒ `UNVERIFIED` (`link.term_b.literal_fk_absent`) salvo sustitución aprobada en binding registry |
| `AGT002-P1-GAP-0003` | No hay tabla productiva apta para instancias de gate (`status`/`outcome`/receipt único) | `gate` no se persiste; diseño SQL NO aplicable (Task 8) |
| `AGT002-P1-GAP-0004` | No hay almacén productivo apto para authority grants (sin `grant_id`, sin vigencia — ver `AGT002-P1-FACT-0009/0010`) | authority registry vive como contrato versionado en repo; diseño SQL NO aplicable (Task 8) |

**Endpoint vivo citado:** `GET /rest/v1/psi_public_tenders` (expone `converted_opportunity_id`). El registro de bindings lo declara como evidencia **de soporte, no decisoria**: sólo la evidencia de migración (en repo, durable, con hash de contenido) puede elevar un término a `VALID`. Ver `live_metadata_get` en Task 5.

---

## Restricciones globales (prohibiciones duras)

Todas se verifican con guardas estáticas en `tests/agt002-phase01-no-production-guards.test.mjs` (Task 9).

- **Cero escrituras Supabase.** `agt002-phase01-executable-controls.js` no contiene `@supabase/supabase-js`, `createClient(`, `SUPABASE_SERVICE_ROLE_KEY`, `.insert(`, `.update(`, `.upsert(`, `.delete(`, `.rpc(`.
- **Cero red.** Ningún archivo del plan usa `fetch(`, `node:http`, `node:https`, `undici`.
- **Cero reloj ambiente.** Ningún archivo del plan usa `Date.now()` ni `new Date()` sin argumento; el instante siempre entra por `context.now_utc`.
- **Nada operacional.** Este plan no ejecuta ni crea: migraciones (`supabase migration`, `supabase db push`), deploys, merges, canary, servicios, timers, schedulers, workers, integraciones SharePoint, correo. No hay E2E real: ningún archivo creado termina en `.integration.test.mjs` ni `.e2e.test.mjs`.
- **`active_case: null`** en todo fixture. Los casos reales quedan **estacionados**: no se abre, avanza ni cierra ninguno durante este plan.
- **Aislamiento de datos.** Todo fixture declara `environment: "isolated_fixture"` y `synthetic: true`. Prohibido en `contracts/agt002-phase01/v1/fixtures/**` (case-insensitive): `DANE`, `Fondo Único`/`Fondo Unico`, `Cali`, `seguridadnacional.co`, `http://`, `https://`. Todo string con forma UUID en fixtures debe empezar por `f1c70000-`.
- **Ninguna migración nueva.** `supabase/migrations/` no gana ningún archivo; el máximo sigue siendo `091`. El diseño SQL vive en `supabase/migration-designs/` y no se enlaza al orden de migraciones.
- **El skill no se toca.** Ninguna tarea modifica definiciones de skill. Si el inventario demuestra que un cambio de skill es indispensable, se aplica el procedimiento de escalamiento de Task 11, Step 5 (plan separado, worktree sobre `origin/main` de `juan-skills-hub`), **nunca** dentro de este plan.
- **TDD estricto.** Cada tarea de código: test primero → RED observado → implementación mínima → GREEN → commit.
- **Fail-closed contractual.** Sólo `VALID` autoriza. `INVALID` y `UNVERIFIED` **ambos** deniegan; se distinguen para auditoría (violación probada vs. imposibilidad de probar), no para permitir.

---

## Contrato `gate` v1 (normativo)

`schema_version` fijo: `"agt002-phase01-gate/1.0.0"`. Objeto raíz `additionalProperties: false`.

| Campo | Tipo / forma | Regla |
|---|---|---|
| `gate_id` | string, `^[A-Z][A-Z0-9_]{3,63}$` | identificador durable del gate |
| `schema_version` | const `agt002-phase01-gate/1.0.0` | pinned |
| `type` | enum `AGT002_PHASE01_GATE_TYPES` | ver catálogo abajo |
| `authority` | objeto `{principal, grant_id, delegation}` | ver Authority registry |
| `authority.principal` | `{principal_id, principal_kind, durable_ref, display_label}` | `principal_kind ∈ {human, agent, synthetic}` |
| `authority.principal.durable_ref` | `{source, locator, verifiable}` | `source ∈ {psi_sales_profiles, agent_identity, fixture_registry}`; `verifiable` boolean |
| `authority.grant_id` | string `^GRANT-[A-Z0-9-]{4,48}$` | debe existir en el registry inyectado |
| `authority.delegation` | `null` o `{grant_id, delegated_by, delegate_of}` | `delegate_of` **debe** ser `null` (profundidad máxima 1) |
| `objective` | string `minLength: 8` | qué decide este gate |
| `environment` | enum `{production, isolated_fixture}` | |
| `synthetic` | boolean | `true` obligatorio cuando `environment = isolated_fixture` |
| `scope` | `{resource_kind, resource_ids[], actions[]}` | `resource_ids` `minItems: 1`, `uniqueItems: true` |
| `preconditions` | array `minItems: 1` de `{precondition_id, statement, verdict, evidence_ids[]}` | `verdict ∈ {VALID, INVALID, UNVERIFIED}` |
| `evidence` | array `minItems: 1` de `{evidence_id, kind, locator, durable, content_hash, captured_at_utc}` | `kind ∈ {repo_file, migration_locator, openapi_metadata, fixture_record}` |
| `expires_at_utc` | string ISO-8601 `Z` | obligatorio, no nulo |
| `consumption_policy` | `{max_consumptions: const 1, receipt_required: const true, idempotency_key}` | `idempotency_key` string `minLength: 8` |
| `rollback` | `{supported, procedure, locator}` | `procedure` `minLength: 8` siempre (si `supported:false`, describe la compensación) |
| `issued_at_utc` | string ISO-8601 `Z` | |
| `status` | enum `{DRAFT, OPEN, CONSUMED, EXPIRED, REVOKED}` | **ciclo de vida** |
| `outcome` | enum `{PASS, REJECTED, CANCELLED}` o `null` | **resultado**, nunca mezclado con ciclo de vida |
| `consumption` | `null` o `{receipt_id, consumed_at_utc, consumed_by}` | `receipt_id` `^RCPT-[A-Z0-9-]{4,48}$` |
| `revocation` | `null` o `{revoked_at_utc, revoked_by, reason}` | `reason` `minLength: 8` |
| `artifact_set_hash` | string `^[0-9a-f]{64}$` | SHA-256 canónico (ver abajo) |
| `active_case` | `null` | siempre nulo en este alcance |

### Ciclo de vida separado del resultado

Transiciones permitidas — `AGT002_PHASE01_ALLOWED_TRANSITIONS`:

```
DRAFT    -> OPEN
OPEN     -> CONSUMED | EXPIRED | REVOKED
CONSUMED -> (terminal)
EXPIRED  -> (terminal)
REVOKED  -> (terminal)
```

Cualquier otra transición ⇒ `INVALID` / `gate.transition.not_allowed` (incluye `DRAFT -> CONSUMED`, `CONSUMED -> OPEN`, `EXPIRED -> CONSUMED`, `REVOKED -> CONSUMED`).

Invariantes por estado (cada violación tiene código propio):

| `status` | `outcome` | `consumption` | `revocation` | Regla temporal |
|---|---|---|---|---|
| `DRAFT` | `null` | `null` | `null` | `issued_at_utc <= now_utc` |
| `OPEN` | `null` | `null` | `null` | `now_utc < expires_at_utc` (si no, `gate.status.open_but_expired`) |
| `CONSUMED` | **no nulo** | **no nulo** | `null` | `issued_at_utc <= consumed_at_utc <= now_utc` y `consumed_at_utc <= expires_at_utc` |
| `EXPIRED` | `null` | `null` | `null` | `expires_at_utc <= now_utc` |
| `REVOKED` | `null` | `null` | **no nulo** | `issued_at_utc <= revoked_at_utc <= now_utc` |

`CONSUMED` exige además, contra `context.consumption_ledger` (array inyectado de `{gate_id, receipt_id, consumed_at_utc}`):
- receipt **único a nivel global**: ningún otro asiento con el mismo `receipt_id` ⇒ si lo hay, `INVALID` / `gate.consumption.receipt_not_unique`;
- **un solo consumo por gate** (`max_consumptions: 1`): ningún asiento previo con el mismo `gate_id` y `receipt_id` distinto ⇒ si lo hay, `INVALID` / `gate.consumption.exceeds_policy`;
- si `context.consumption_ledger` **no se inyecta** ⇒ `UNVERIFIED` / `gate.consumption.ledger_absent` (fail-closed: no se puede probar unicidad).

Coherencia `outcome` ↔ `preconditions`:
- `PASS` con alguna precondición distinta de `VALID` ⇒ `INVALID` / `gate.outcome.pass_with_unmet_precondition`.
- `REJECTED` sin ninguna precondición `INVALID` ⇒ `INVALID` / `gate.outcome.rejected_without_failed_precondition`.
- `CANCELLED` con alguna precondición `INVALID` ⇒ `INVALID` / `gate.outcome.cancelled_with_failed_precondition`.

**Auditoría final Fase 0.** El gate `FINAL_AUDIT_PHASE_0` se modela como fixture con `status: "CONSUMED"`, `outcome: "REJECTED"`, `consumption` completo y al menos una precondición `INVALID` (la precondición `AGT002-P1-GAP-0003` “existe almacenamiento productivo apto para instancias de gate” evalúa `INVALID`). La guarda de Task 9 recorre **todo** `fixtures/**` y falla si algún fixture tiene `gate_id === "FINAL_AUDIT_PHASE_0"` con `status !== "CONSUMED"` u `outcome !== "REJECTED"`. **No hay excepción nombrada**: el negativo “Fase 0 en OPEN” vive como literal inline en `tests/agt002-phase01-gate-lifecycle.test.mjs`, nunca como archivo en el árbol de fixtures.

### Catálogo de gate types (`AGT002_PHASE01_GATE_TYPES`)

| `type` | Qué autoriza | Autoridad mínima |
|---|---|---|
| `PHASE_AUDIT` | cierre/rechazo de auditoría de fase | grant `PHASE_AUDIT` vigente |
| `LINK_VERIFICATION` | aceptar un veredicto `VALID_LINK` como base de decisión | grant `LINK_VERIFICATION` vigente |
| `AUTHORITY_DELEGATION` | emitir un grant delegado (profundidad 1) | grant `AUTHORITY_DELEGATION` vigente, principal no sintético |
| `STORAGE_DESIGN_REVIEW` | aceptar un diseño SQL no aplicado | grant `STORAGE_DESIGN_REVIEW` vigente |
| `PRODUCTION_ACTION` | cualquier acción sobre datos productivos | grant vigente + `principal.durable_ref.verifiable === true` + `principal_kind !== "synthetic"` |

El catálogo completo, con el mapeo a la cláusula del contrato del skill, vive en `docs/agt002/phase01/gate-catalog.md` (Task 11) y su cobertura se prueba por igualdad de conjuntos contra el `enum` del schema.

### Hash canónico

`canonicalizeAgt002Phase01(value)` = `JSON.stringify` con claves de objeto ordenadas lexicográficamente de forma recursiva, arrays en su orden original, sin espacios.
`computeAgt002Phase01Hash(value)` = SHA-256 hex minúscula de la forma canónica.
`computeAgt002Phase01ArtifactSetHash(gate)` = hash canónico del subconjunto **inmutable**: `gate_id`, `schema_version`, `type`, `authority`, `objective`, `environment`, `synthetic`, `scope`, `preconditions`, `evidence`, `expires_at_utc`, `consumption_policy`, `rollback`, `issued_at_utc`. Excluye `status`, `outcome`, `consumption`, `revocation`, `artifact_set_hash`, `active_case`. Diferencia ⇒ `INVALID` / `gate.artifact_set_hash.mismatch`.

---

## Authority registry v1 (normativo)

`schema_version` fijo: `"agt002-phase01-authority-registry/1.0.0"`.

```
{
  schema_version, registry_version (int >= 1), supersedes_registry_version (int|null),
  issued_at_utc,
  grants: [
    {
      grant_id, gate_type, principal {principal_id, principal_kind, durable_ref, display_label},
      delegate_of (grant_id|null),
      valid_from_utc, valid_until_utc,
      scope {environments[], resource_kind, resource_ids[], actions[]},
      revoked_at_utc (string|null)
    }
  ]
}
```

Cadena normativa: **gate type → principal/delegado durable → `grant_id` → vigencia → scope**.

Reglas (`resolveAgt002Phase01Authority`):

1. `registry_version` entero ≥ 1; `supersedes_registry_version`, si no es nulo, estrictamente menor. Violación ⇒ `INVALID` / `authority.registry.version_not_monotonic`.
2. `grant_id` único en el registry ⇒ duplicado `INVALID` / `authority.registry.duplicate_grant_id`.
3. `grant.gate_type` debe coincidir con `gate.type` ⇒ `INVALID` / `authority.grant.gate_type_mismatch`.
4. `grant_id` referenciado inexistente ⇒ `INVALID` / `authority.grant.not_found`. Registry no inyectado ⇒ `UNVERIFIED` / `authority.registry.absent`.
5. **Rol ≠ persona.** Un `principal` cuyo `principal_id` sea uno de los roles de `AGT002-P1-FACT-0008` (`admin`, `gerencia`, `director`, `comercial`, `colaborador`, `junta`), o que carezca de `durable_ref.locator`, ⇒ `INVALID` / `authority.principal.role_is_not_person`.
6. **Principal sintético.** `principal_kind === "synthetic"` sólo es admisible si `gate.environment === "isolated_fixture"` **y** `"isolated_fixture" ∈ grant.scope.environments`. En cualquier otro caso ⇒ `INVALID` / `authority.principal.synthetic_outside_isolated_fixture`.
7. **Acción real sin principal comprobable.** `gate.environment === "production"` y (`durable_ref.verifiable !== true` o `principal_kind === "synthetic"`) ⇒ `INVALID` / `authority.principal.not_verifiable_in_production`.
8. **Vigencia.** `valid_from_utc <= now_utc < valid_until_utc` y `revoked_at_utc === null`. Fuera de ventana ⇒ `INVALID` / `authority.grant.out_of_validity_window`; revocado ⇒ `INVALID` / `authority.grant.revoked`.
9. **Delegación.** Si `gate.authority.delegation !== null`: su `grant_id` debe existir, tener `delegate_of` apuntando al grant del delegante, estar vigente, y `delegation.delegate_of` en el gate debe ser `null` (profundidad 1). Delegación fuera de ventana ⇒ `INVALID` / `authority.delegation.expired`; profundidad > 1 ⇒ `INVALID` / `authority.delegation.depth_exceeded`.
10. **Scope.** Todo `id ∈ gate.scope.resource_ids` debe estar en `grant.scope.resource_ids`, y todo `action ∈ gate.scope.actions` en `grant.scope.actions`; `gate.environment ∈ grant.scope.environments`. Violación ⇒ `INVALID` / `authority.scope.resource_out_of_scope` (o `.action_out_of_scope`, `.environment_out_of_scope`).

---

## Álgebra `VALID_LINK` (normativo)

`validateAgt002Phase01ValidLink(claim, context)` evalúa **términos nombrados** y agrega con `aggregateAgt002Phase01Verdict`:

```
any INVALID      -> INVALID
else any UNVERIFIED -> UNVERIFIED
else all VALID   -> VALID
sin términos     -> UNVERIFIED   (fail-closed)
```

Regla transversal: **un término sólo puede ser `INVALID` si el dato autoritativo y exhaustivo existe**. Si falta evidencia, falta observación, o la consulta no es exhaustiva/paginada, el término es `UNVERIFIED`.

### Términos A y B, modelados como lo que son

- **Término A — `ENTITY_L`.** El claim puede declarar `term_a: {claimed_entity: "L", …}`. Hecho vivo `AGT002-P1-GAP-0001`: **no existe** entidad, tabla ni endpoint `L`. El término A **siempre** resuelve `UNVERIFIED` / `link.term_a.entity_l_absent`. Nunca `VALID` (no hay dato) y nunca `INVALID` (no hay dato autoritativo que refute). “A no enlazado” es, por construcción, `UNVERIFIED`.
- **Término B — `FK O.tender_id`.** El claim puede declarar `term_b: {claimed_column: "psi_sales_opportunities.tender_id", direction: "forward"}`. Hecho vivo `AGT002-P1-GAP-0002`: esa columna **no existe**. El término B literal resuelve `UNVERIFIED` / `link.term_b.literal_fk_absent`.
- **Binding inverso real.** `psi_public_tenders.converted_opportunity_id -> psi_sales_opportunities.id`, `UNIQUE` parcial (`AGT002-P1-FACT-0002`), `ON DELETE SET NULL` (`AGT002-P1-FACT-0001`), endpoint `GET /rest/v1/psi_public_tenders`. Este binding **puede probar el vínculo lógico B** —y sólo B, nunca A— **únicamente** si el binding registry inyectado declara explícitamente la sustitución:

```json
{
  "binding_id": "BIND-TENDER-OPPORTUNITY-INVERSE",
  "logical_term": "B",
  "direction": "inverse",
  "substitution_approved": true,
  "source": {"table": "psi_public_tenders", "column": "converted_opportunity_id", "endpoint": "/rest/v1/psi_public_tenders"},
  "target": {"table": "psi_sales_opportunities", "column": "id"},
  "cardinality": "exactly_one",
  "on_delete": "set_null",
  "unique_constraint": "psi_public_tenders_converted_opportunity_id_unique",
  "evidence": [{"fact_id": "AGT002-P1-FACT-0001", "...": "locators de la tabla de hechos vivos"}]
}
```

Sin entrada aprobada en el registry ⇒ `UNVERIFIED` / `link.binding.not_registered`. Con entrada cuyo `source`/`target`/`direction` no corresponde al claim ⇒ `INVALID` / `link.binding.incompatible` (hay dato autoritativo y contradice el claim).

Prohibido inventar A o B: ningún artefacto de este plan declara una tabla `entity_l` ni una columna `psi_sales_opportunities.tender_id` como existentes. Guarda estática en Task 9.

### Términos de sustancia (se evalúan sobre la observación inyectada)

`context.observation = {rows: [...], query: {paginated, pages_fetched, page_size, rows_total_declared, truncated, filter}, authoritative: boolean}`.

| Término | `VALID` cuando | `INVALID` cuando | `UNVERIFIED` cuando |
|---|---|---|---|
| `binding_registered` | entrada aprobada y compatible | entrada incompatible | registry ausente o sin entrada |
| `query_exhaustive` | `paginated === true`, `truncated === false`, `pages_fetched >= 1`, `rows_total_declared === rows.length` | — | descriptor ausente, `truncated === true`, o `rows_total_declared !== rows.length` ⇒ `link.query.not_exhaustive` |
| `authoritative_source` | `observation.authoritative === true` | — | ausente/`false` ⇒ `link.observation.not_authoritative` |
| `cardinality_exactly_one` | `rows.length === 1` | `rows.length === 0` ⇒ `link.cardinality.zero`; `rows.length > 1` ⇒ `link.cardinality.multiple` | observación ausente o no exhaustiva/no autoritativa |
| `identity_no_conflict` | `rows[0].tender_id === claim.source_id` y `rows[0].converted_opportunity_id === claim.target_id` | discrepancia ⇒ `link.identity.conflict` | sin fila única observada |
| `state_live` | `rows[0].internal_status === "convertida_oportunidad"` | `"descartada"` ⇒ `link.state.tender_discarded`; `"nueva"`/`"en_revision"` ⇒ `link.state.tender_not_live` | campo ausente |
| `opportunity_open` | `opportunity.stage_code !== "descartado"` y `tender_offer_status ∉ {cerrada_no_go, adjudicada, no_adjudicada}` | `descartado` ⇒ `link.opportunity.discarded`; estado cerrado ⇒ `link.opportunity.closed` | `opportunity` ausente en la observación |
| `evidence_durable` | ≥1 evidencia con `durable === true`, `content_hash` no nulo y `locator` con esquema `repo://`/`migration://`/`fixture://` | evidencia presente pero toda con `durable === false` ⇒ `link.evidence.not_durable` | `evidence` ausente o vacío ⇒ `link.evidence.absent` |
| `term_a_entity_l` | nunca | nunca | siempre (`AGT002-P1-GAP-0001`) |
| `term_b_logical` | binding inverso aprobado + todos los términos de sustancia `VALID` | binding incompatible | FK literal ausente sin sustitución aprobada |

`context.observation` ausente ⇒ todos los términos de sustancia `UNVERIFIED`; el claim entero `UNVERIFIED`. Nunca `VALID`.

Consecuencia esperada y probada: un claim que pida A **y** B literal jamás puede ser `VALID`; el máximo alcanzable para el vínculo lógico B, con binding inverso aprobado y observación exhaustiva/autoritativa/durable, es `VALID` con `term_a_entity_l` excluido del claim (`claim.terms` no incluye A).

### Códigos de razón (`AGT002_PHASE01_REASON_CODES`, congelado)

`schema.*` (`missing_required`, `additional_property`, `type_mismatch`, `enum_mismatch`, `const_mismatch`, `pattern_mismatch`, `min_length`, `min_items`, `max_items`, `not_unique`), `gate.transition.not_allowed`, `gate.status.open_but_expired`, `gate.status.invalid_outcome_for_status`, `gate.status.consumption_not_allowed`, `gate.status.revocation_required`, `gate.consumption.missing`, `gate.consumption.receipt_not_unique`, `gate.consumption.exceeds_policy`, `gate.consumption.ledger_absent`, `gate.consumption.timestamp_out_of_range`, `gate.outcome.pass_with_unmet_precondition`, `gate.outcome.rejected_without_failed_precondition`, `gate.outcome.cancelled_with_failed_precondition`, `gate.artifact_set_hash.mismatch`, `authority.registry.absent`, `authority.registry.version_not_monotonic`, `authority.registry.duplicate_grant_id`, `authority.grant.not_found`, `authority.grant.gate_type_mismatch`, `authority.grant.out_of_validity_window`, `authority.grant.revoked`, `authority.delegation.expired`, `authority.delegation.depth_exceeded`, `authority.principal.role_is_not_person`, `authority.principal.synthetic_outside_isolated_fixture`, `authority.principal.not_verifiable_in_production`, `authority.scope.resource_out_of_scope`, `authority.scope.action_out_of_scope`, `authority.scope.environment_out_of_scope`, `link.term_a.entity_l_absent`, `link.term_b.literal_fk_absent`, `link.binding.not_registered`, `link.binding.incompatible`, `link.query.not_exhaustive`, `link.observation.not_authoritative`, `link.observation.absent`, `link.cardinality.zero`, `link.cardinality.multiple`, `link.identity.conflict`, `link.state.tender_discarded`, `link.state.tender_not_live`, `link.opportunity.closed`, `link.opportunity.discarded`, `link.evidence.absent`, `link.evidence.not_durable`.

Los tests asertan **códigos**, no prosa.

---

### Task 0: Línea base y confirmación de árbol limpio

**Files:** ninguno.

- [ ] **Step 1: Dependencias exactas**

Run: `npm ci --ignore-scripts`
Expected: exit 0.

- [ ] **Step 2: Sin artefactos previos de Fase 01**

Run: `git ls-files | grep -E 'agt002-phase01|migration-designs' || echo CLEAN`
Expected: `CLEAN`. Si aparece algo, detenerse y reconciliar antes de continuar.

- [ ] **Step 3: Suite completa de partida**

Run: `npm test`
Expected: **2109 pass, 0 fail, 10 skipped**. Si difiere, detenerse: la línea base declarada en este plan no corresponde al árbol y hay que reconciliar antes de escribir código.

- [ ] **Step 4: Confirmar ausencia de `lint` y máximo de migraciones**

Run: `node -e "const p=require('./package.json');console.log('lint:', Boolean(p.scripts.lint))" && ls supabase/migrations | sort | tail -1`
Expected: `lint: false` y `091_agt002_validation_recovery_slot.sql`. Se registra: el gate de lint equivalente en este repo es `npx tsc --noEmit` + `npm run build`.

---

### Task 1: Motor de schema, canonicalización y hash

**Files:**
- Create: `agt002-phase01-executable-controls.js`
- Test: `tests/agt002-phase01-schema-engine.test.mjs`

**Interfaces (exportadas desde el módulo, estables para todo el plan):**

```js
export const AGT002_PHASE01_VERDICTS = Object.freeze(['VALID', 'INVALID', 'UNVERIFIED']);
export const AGT002_PHASE01_GATE_STATUSES = Object.freeze(['DRAFT', 'OPEN', 'CONSUMED', 'EXPIRED', 'REVOKED']);
export const AGT002_PHASE01_GATE_OUTCOMES = Object.freeze(['PASS', 'REJECTED', 'CANCELLED']);
export const AGT002_PHASE01_GATE_TYPES = Object.freeze([
  'PHASE_AUDIT', 'LINK_VERIFICATION', 'AUTHORITY_DELEGATION', 'STORAGE_DESIGN_REVIEW', 'PRODUCTION_ACTION',
]);
export const AGT002_PHASE01_ALLOWED_TRANSITIONS = Object.freeze({
  DRAFT: Object.freeze(['OPEN']),
  OPEN: Object.freeze(['CONSUMED', 'EXPIRED', 'REVOKED']),
  CONSUMED: Object.freeze([]), EXPIRED: Object.freeze([]), REVOKED: Object.freeze([]),
});
export const AGT002_PHASE01_SCHEMA_VERSIONS = Object.freeze({
  gate: 'agt002-phase01-gate/1.0.0',
  authorityRegistry: 'agt002-phase01-authority-registry/1.0.0',
  bindingRegistry: 'agt002-phase01-binding-registry/1.0.0',
  validLinkClaim: 'agt002-phase01-valid-link-claim/1.0.0',
  fixtureContext: 'agt002-phase01-fixture-context/1.0.0',
});
export const AGT002_PHASE01_REASON_CODES = Object.freeze([/* lista congelada de la sección anterior */]);
export const AGT002_PHASE01_SYNTHETIC_UUID_PREFIX = 'f1c70000-';
export const AGT002_PHASE01_FINAL_AUDIT_GATE_ID = 'FINAL_AUDIT_PHASE_0';

export function validateAgt002Phase01Schema(schema, value); // -> { ok: boolean, errors: [{ path, code, detail }] }
export function canonicalizeAgt002Phase01(value);           // -> string JSON canónico (claves ordenadas)
export function computeAgt002Phase01Hash(value);            // -> sha256 hex minúscula
export function aggregateAgt002Phase01Verdict(terms);       // terms: [{ term, verdict, reasons }] -> { verdict, reasons }
```

Subconjunto de JSON Schema soportado (y **sólo** ese): `type` (string o array de strings, incluido `"null"`), `required`, `properties`, `additionalProperties: false`, `enum`, `const`, `pattern`, `minLength`, `minItems`, `maxItems`, `uniqueItems`, `items`. Cualquier keyword desconocida en un schema cargado lanza `Error` (no se ignora en silencio) — esto evita que un schema crea validar algo que el motor no mira.

- [ ] **Step 1: Write the failing test**

`tests/agt002-phase01-schema-engine.test.mjs`:
1. Constantes congeladas: `Object.isFrozen` en las 7 exportaciones de constantes; `AGT002_PHASE01_VERDICTS` exactamente `['VALID','INVALID','UNVERIFIED']`; `AGT002_PHASE01_ALLOWED_TRANSITIONS` exactamente la tabla normativa (comparación profunda).
2. `validateAgt002Phase01Schema`: acepta objeto conforme; rechaza propiedad extra con `code: 'schema.additional_property'` y `path: '/extra'`; rechaza `required` faltante con `schema.missing_required`; rechaza tipo, `enum`, `const`, `pattern`, `minLength`, `minItems`, `maxItems`, `uniqueItems` con sus códigos; acepta `null` cuando `type: ["object","null"]` y en ese caso **no** aplica `required`.
3. Keyword desconocida (`{"format": "uuid"}`) ⇒ `assert.throws`.
4. `canonicalizeAgt002Phase01`: `{b:1,a:{d:2,c:3}}` y `{a:{c:3,d:2},b:1}` producen el **mismo** string; el orden de arrays se preserva (`[2,1]` ≠ `[1,2]`).
5. `computeAgt002Phase01Hash`: determinista, 64 hex minúscula, cambia ante cualquier cambio de valor.
6. `aggregateAgt002Phase01Verdict`: `[]` ⇒ `UNVERIFIED`; todos `VALID` ⇒ `VALID`; un `UNVERIFIED` ⇒ `UNVERIFIED`; un `INVALID` junto a `UNVERIFIED` ⇒ `INVALID`; `reasons` acumula los códigos de los términos no-`VALID` en orden de aparición.
7. Guarda de fuente: `readFileSync` del módulo y `assert.doesNotMatch` contra `/@supabase\/supabase-js|createClient\(|SUPABASE_SERVICE_ROLE_KEY|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|fetch\(|node:https?|Date\.now\(\)|new Date\(\)/`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agt002-phase01-schema-engine.test.mjs`
Expected: FAIL — `agt002-phase01-executable-controls.js` no existe (`ERR_MODULE_NOT_FOUND`).

- [ ] **Step 3: Write minimal implementation**

Crear `agt002-phase01-executable-controls.js` con constantes, motor de schema recursivo, canonicalización, hash (`createHash('sha256')` de `node:crypto`) y agregación. Nada más todavía.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agt002-phase01-schema-engine.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agt002-phase01-executable-controls.js tests/agt002-phase01-schema-engine.test.mjs
git commit -m "feat(agt002-phase01): add subset JSON Schema engine, canonical hash and fail-closed verdict algebra"
```

---

### Task 2: `gate.schema.json` v1

**Files:**
- Create: `contracts/agt002-phase01/v1/gate.schema.json`
- Test: `tests/agt002-phase01-gate-schema.test.mjs`

- [ ] **Step 1: Write the failing test**

`tests/agt002-phase01-gate-schema.test.mjs`:
1. Carga el schema y asserta `$id === "https://seguridadnacional.internal/contracts/agt002-phase01/v1/gate.schema.json"`, `$schema === "https://json-schema.org/draft/2020-12/schema"`, `properties.schema_version.const === AGT002_PHASE01_SCHEMA_VERSIONS.gate`.
2. Cobertura de campos: `Object.keys(schema.properties)` es **exactamente** el conjunto de la tabla normativa, 20 claves: `gate_id`, `schema_version`, `type`, `authority`, `objective`, `environment`, `synthetic`, `scope`, `preconditions`, `evidence`, `expires_at_utc`, `consumption_policy`, `rollback`, `issued_at_utc`, `status`, `outcome`, `consumption`, `revocation`, `artifact_set_hash`, `active_case`. `required` contiene las 20: no hay campos opcionales — la ausencia se modela como `null` explícito.
3. Enums pinneados: `status.enum` === `AGT002_PHASE01_GATE_STATUSES`; `outcome` es `{type:["string","null"], enum:[...AGT002_PHASE01_GATE_OUTCOMES, null]}`; `type.enum` === `AGT002_PHASE01_GATE_TYPES`; `environment.enum` === `['production','isolated_fixture']`.
4. Cierre estructural: recorrido recursivo — todo nodo con `properties` declara `additionalProperties: false`.
5. `authority.properties.delegation` admite `null` y, como objeto, exige `delegate_of` con `type: "null"` (profundidad 1 impuesta también en forma).
6. `consumption_policy.properties.max_consumptions.const === 1` y `receipt_required.const === true`.
7. `active_case` es `{ "type": "null" }`.
8. El schema completo pasa por `validateAgt002Phase01Schema` sobre un gate mínimo bien formado inline, y falla con `schema.missing_required` al quitar `artifact_set_hash`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agt002-phase01-gate-schema.test.mjs`
Expected: FAIL — el schema no existe.

- [ ] **Step 3: Write minimal implementation**

Autoría de `contracts/agt002-phase01/v1/gate.schema.json` siguiendo la tabla normativa, usando sólo keywords soportadas por el motor.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agt002-phase01-gate-schema.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add contracts/agt002-phase01/v1/gate.schema.json tests/agt002-phase01-gate-schema.test.mjs
git commit -m "contracts(agt002-phase01): add gate schema v1 with lifecycle separated from outcome"
```

---

### Task 3: Validador de ciclo de vida del gate

**Files:**
- Modify: `agt002-phase01-executable-controls.js`
- Test: `tests/agt002-phase01-gate-lifecycle.test.mjs`

**Interfaces añadidas:**

```js
export function computeAgt002Phase01ArtifactSetHash(gate); // -> sha256 hex del subconjunto inmutable
export function validateAgt002Phase01GateTransition(from, to); // -> { verdict, reasons }
export function validateAgt002Phase01Gate(gate, context);
// context: { now_utc, gate_schema, consumption_ledger?, authority_registry?, previous_status? }
// -> { verdict, reasons: string[], checked_terms: [{ term, verdict, reasons }] }
```

`validateAgt002Phase01Gate` evalúa, en este orden y **sin cortocircuito** (acumula todos los términos): `schema`, `transition` (sólo si `context.previous_status` está presente), `lifecycle_invariants`, `temporal_invariants`, `consumption_receipt`, `outcome_precondition_coherence`, `artifact_set_hash`, `authority` (Task 4). Agrega con `aggregateAgt002Phase01Verdict`.

- [ ] **Step 1: Write the failing test**

`tests/agt002-phase01-gate-lifecycle.test.mjs`, todo con literales inline y `now_utc = '2026-09-23T18:00:00Z'`:
1. Camino feliz `OPEN`: `VALID`.
2. Camino feliz `CONSUMED`/`PASS` con receipt nuevo y ledger vacío: `VALID`.
3. Fase 0: `gate_id: 'FINAL_AUDIT_PHASE_0'`, `status: 'CONSUMED'`, `outcome: 'REJECTED'`, precondición `INVALID`: `VALID` (el gate está bien gobernado; el rechazo es su resultado legítimo).
4. **Prohibido `OPEN` para Fase 0**: el mismo gate con `status:'OPEN'`, `outcome:null` ⇒ `INVALID` con `gate.status.invalid_outcome_for_status` **o** —si además vence— `gate.status.open_but_expired`; el test asserta explícitamente que el veredicto **no** es `VALID` y deja constancia de que este caso vive inline y nunca como fixture.
5. Transiciones: `DRAFT→OPEN` y `OPEN→CONSUMED|EXPIRED|REVOKED` ⇒ `VALID`; `DRAFT→CONSUMED`, `CONSUMED→OPEN`, `EXPIRED→CONSUMED`, `REVOKED→CONSUMED`, `OPEN→DRAFT` ⇒ `INVALID` / `gate.transition.not_allowed`.
6. `OPEN` con `outcome:'PASS'` ⇒ `gate.status.invalid_outcome_for_status`.
7. `CONSUMED` sin `consumption` ⇒ `gate.consumption.missing`; sin `outcome` ⇒ `gate.status.invalid_outcome_for_status`.
8. `CONSUMED` con `receipt_id` ya presente en `consumption_ledger` ⇒ `gate.consumption.receipt_not_unique`.
9. `CONSUMED` con asiento previo del mismo `gate_id` y receipt distinto ⇒ `gate.consumption.exceeds_policy`.
10. `CONSUMED` sin `consumption_ledger` inyectado ⇒ `UNVERIFIED` / `gate.consumption.ledger_absent`.
11. `consumed_at_utc` posterior a `now_utc` o anterior a `issued_at_utc` ⇒ `gate.consumption.timestamp_out_of_range`.
12. `OPEN` con `expires_at_utc` pasado ⇒ `gate.status.open_but_expired`.
13. `EXPIRED` con `expires_at_utc` futuro ⇒ `gate.status.invalid_outcome_for_status`; `REVOKED` sin `revocation` ⇒ `gate.status.revocation_required`.
14. Coherencia outcome/preconditions: `PASS` con precondición `UNVERIFIED` ⇒ `gate.outcome.pass_with_unmet_precondition`; `REJECTED` sin ninguna `INVALID` ⇒ `gate.outcome.rejected_without_failed_precondition`; `CANCELLED` con una `INVALID` ⇒ `gate.outcome.cancelled_with_failed_precondition`.
15. `artifact_set_hash` alterado un carácter ⇒ `gate.artifact_set_hash.mismatch`; mover `status` de `OPEN` a `CONSUMED` **no** cambia el hash (el subconjunto inmutable lo excluye).
16. Campo requerido ausente (`objective`) ⇒ `INVALID` con `schema.missing_required` en `reasons`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agt002-phase01-gate-lifecycle.test.mjs`
Expected: FAIL — `validateAgt002Phase01Gate` no está exportada.

- [ ] **Step 3: Write minimal implementation**

Añadir al módulo `computeAgt002Phase01ArtifactSetHash`, `validateAgt002Phase01GateTransition` y `validateAgt002Phase01Gate` con los términos descritos.

Sobre el término `authority` mientras Task 4 no existe: su resolución completa llega en Task 4, pero su comportamiento fail-closed se implementa ya aquí — `context.authority_registry` ausente o nulo ⇒ término `UNVERIFIED` / `authority.registry.absent`; presente ⇒ se comprueban, en esta tarea, únicamente la existencia del `grant_id` y la coincidencia `grant.gate_type === gate.type`. Los casos 1–3 del test inyectan un registry mínimo válido definido inline (un grant por `gate_type` usado), de modo que el veredicto agregado sea `VALID` sin banderas de omisión. **No existe ningún interruptor para saltarse la autoridad**: no se añade `skip_authority_term` ni equivalente en ninguna tarea del plan.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agt002-phase01-gate-lifecycle.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agt002-phase01-executable-controls.js tests/agt002-phase01-gate-lifecycle.test.mjs
git commit -m "feat(agt002-phase01): enforce gate lifecycle, unique consumption receipt and artifact-set hash"
```

---

### Task 4: Authority registry versionado

**Files:**
- Create: `contracts/agt002-phase01/v1/authority-registry.schema.json`
- Create: `contracts/agt002-phase01/v1/authority-registry.json`
- Modify: `agt002-phase01-executable-controls.js`
- Test: `tests/agt002-phase01-authority-registry.test.mjs`

**Interfaces añadidas:**

```js
export function validateAgt002Phase01AuthorityRegistry(registry, context); // context: { now_utc, registry_schema }
export function resolveAgt002Phase01Authority(registry, request);
// request: { gate_type, environment, grant_id, delegation, principal, resource_ids, actions, now_utc }
// -> { verdict, reasons, grant }
```

`contracts/agt002-phase01/v1/authority-registry.json` (datos, `registry_version: 1`, `supersedes_registry_version: null`) contiene exactamente cinco grants, uno por `gate_type`, todos con `principal_kind: "synthetic"`, `scope.environments: ["isolated_fixture"]`, `durable_ref.source: "fixture_registry"`, `durable_ref.verifiable: true`, vigencia `2026-09-01T00:00:00Z` → `2027-09-01T00:00:00Z`, `principal_id` en el namespace `f1c70000-`. Es el registry que consumen los fixtures; **no** habilita nada productivo (regla 6: sintético sólo en `isolated_fixture`).

- [ ] **Step 1: Write the failing test**

`tests/agt002-phase01-authority-registry.test.mjs` (`now_utc = '2026-09-23T18:00:00Z'`):
1. Schema: `$id`, `$schema`, `const` de `schema_version`, cierre recursivo `additionalProperties:false`, `registry_version` entero ≥ 1, `grants` `minItems: 1`.
2. El JSON de datos valida contra su schema y cubre **los cinco** `gate_type` de `AGT002_PHASE01_GATE_TYPES` (igualdad de conjuntos).
3. Cadena completa: para cada grant, `resolveAgt002Phase01Authority` con petición conforme ⇒ `VALID` y devuelve el grant correcto por `grant_id`.
4. `grant_id` duplicado ⇒ `authority.registry.duplicate_grant_id`.
5. `registry_version: 1` con `supersedes_registry_version: 1` ⇒ `authority.registry.version_not_monotonic`.
6. `grant_id` inexistente ⇒ `authority.grant.not_found`; registry `null`/ausente ⇒ `UNVERIFIED` / `authority.registry.absent`.
7. `gate_type` del grant distinto del pedido ⇒ `authority.grant.gate_type_mismatch`.
8. Rol como principal: `principal_id: 'gerencia'` (o `durable_ref.locator` ausente) ⇒ `authority.principal.role_is_not_person`. Se prueba con los seis roles de `AGT002-P1-FACT-0008`.
9. Sintético fuera de fixture: `environment:'production'` con `principal_kind:'synthetic'` ⇒ `authority.principal.synthetic_outside_isolated_fixture`.
10. Acción real sin principal comprobable: `environment:'production'`, `principal_kind:'human'`, `durable_ref.verifiable:false` ⇒ `authority.principal.not_verifiable_in_production`.
11. Vigencia: `now_utc` antes de `valid_from_utc` y en/después de `valid_until_utc` ⇒ `authority.grant.out_of_validity_window`; `revoked_at_utc` no nulo ⇒ `authority.grant.revoked`.
12. Delegación: grant delegado vigente con `delegate_of` correcto ⇒ `VALID`; `valid_until_utc` pasado ⇒ `authority.delegation.expired`; `delegate_of` de un grant que a su vez tiene `delegate_of` ⇒ `authority.delegation.depth_exceeded`.
13. Scope: `resource_ids` con un id fuera del grant ⇒ `authority.scope.resource_out_of_scope`; acción fuera ⇒ `.action_out_of_scope`; entorno fuera ⇒ `.environment_out_of_scope`.
14. Integración con el gate: `validateAgt002Phase01Gate` con `context.authority_registry` inyectado y un `grant_id` inexistente ⇒ `INVALID` con `authority.grant.not_found` presente en `reasons`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agt002-phase01-authority-registry.test.mjs`
Expected: FAIL — schema, datos y funciones no existen.

- [ ] **Step 3: Write minimal implementation**

Autoría del schema, del JSON de datos y de las dos funciones; enganchar el término `authority` de `validateAgt002Phase01Gate` a `resolveAgt002Phase01Authority`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agt002-phase01-authority-registry.test.mjs tests/agt002-phase01-gate-lifecycle.test.mjs`
Expected: PASS en ambos (el segundo confirma que enganchar autoridad no rompió el ciclo de vida).

- [ ] **Step 5: Commit**

```bash
git add contracts/agt002-phase01/v1/authority-registry.schema.json contracts/agt002-phase01/v1/authority-registry.json agt002-phase01-executable-controls.js tests/agt002-phase01-authority-registry.test.mjs
git commit -m "feat(agt002-phase01): add versioned authority registry with durable principals, grants, validity and scope"
```

---

### Task 5: Binding registry (A/B modelados, sin inventar)

**Files:**
- Create: `contracts/agt002-phase01/v1/binding-registry.schema.json`
- Create: `contracts/agt002-phase01/v1/binding-registry.json`
- Test: `tests/agt002-phase01-binding-registry.test.mjs`

`binding-registry.json` (`schema_version: agt002-phase01-binding-registry/1.0.0`, `registry_version: 1`) contiene exactamente tres entradas:

| `binding_id` | `logical_term` | `status` | Contenido |
|---|---|---|---|
| `BIND-TENDER-OPPORTUNITY-INVERSE` | `B` | `confirmed_durable` | binding inverso real con `direction: "inverse"`, `substitution_approved: true`, `cardinality: "exactly_one"`, `on_delete: "set_null"`, `unique_constraint`, `evidence[]` citando `AGT002-P1-FACT-0001/0002/0003`, `live_endpoint: "/rest/v1/psi_public_tenders"` |
| `BIND-ENTITY-L` | `A` | `absent_live` | `table: null`, `substitution_approved: false`, `gap_id: "AGT002-P1-GAP-0001"` |
| `BIND-OPPORTUNITY-TENDER-ID-FORWARD` | `B` | `absent_live` | `column: null`, `substitution_approved: false`, `gap_id: "AGT002-P1-GAP-0002"`, nota de que la columna literal no existe |

Cada entrada lleva `cutoff_utc`, `verified_at_utc` y `live_metadata_get: {method: "GET", endpoint, observed_at_utc, artifact}` con `artifact ∈ {attached, not_attached}`.

**Reconciliación `cutoff_utc` / `verified_at_utc` (regla probada):** ambos ISO-8601 `Z`; `verified_at_utc >= cutoff_utc`; la diferencia no supera 24 h; `cutoff_utc = "2026-09-23T00:00:00Z"` para las tres entradas. Si `live_metadata_get.artifact === "attached"`, debe existir `contracts/agt002-phase01/v1/evidence/openapi-live-metadata.json` y `observed_at_utc` debe coincidir con `verified_at_utc`; si es `not_attached`, ese archivo **no** debe existir y la entrada no puede tener `evidence[].kind === "openapi_metadata"` con `durable: true`. En ambos casos el registry es consistente y el test lo verifica. Se autoriza (opcional, sólo lectura) capturar el GET de metadata del OpenAPI y adjuntarlo; si no se captura, se deja `not_attached` — no es un pendiente, es el estado declarado.

- [ ] **Step 1: Write the failing test**

`tests/agt002-phase01-binding-registry.test.mjs`:
1. Schema válido, cerrado, `$id`/`$schema`/`const` pinneados; el JSON de datos valida contra él.
2. Exactamente tres `binding_id`, con los `logical_term` y `status` de la tabla.
3. **Guarda anti-invención:** `JSON.stringify(registry)` no contiene `entity_l` como nombre de tabla existente — concretamente, ninguna entrada con `status: "confirmed_durable"` menciona `entity_l` ni `psi_sales_opportunities.tender_id`; y toda entrada que los mencione tiene `status: "absent_live"` con `table`/`column` en `null` y `gap_id` poblado.
4. **Locators verificables:** por cada `evidence[]` con `kind: "migration_locator"`, leer el archivo citado, cortar el rango `line_start..line_end` y asertar que contiene el `snippet` declarado. Cubre los 11 hechos `AGT002-P1-FACT-*` de la tabla normativa.
5. Reconciliación temporal: las tres reglas `cutoff_utc`/`verified_at_utc` de arriba, más la coherencia `artifact` ↔ existencia de `evidence/openapi-live-metadata.json`.
6. El binding inverso declara `unique_constraint: "psi_public_tenders_converted_opportunity_id_unique"` y `on_delete: "set_null"`, y su `live_endpoint` es `/rest/v1/psi_public_tenders`.
7. Ningún `evidence[].locator` usa `http://`/`https://`; los esquemas admitidos son `migration://`, `repo://`, `fixture://`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agt002-phase01-binding-registry.test.mjs`
Expected: FAIL — el registry no existe.

- [ ] **Step 3: Write minimal implementation**

Autoría del schema y del JSON con las tres entradas y los locators exactos de la tabla “Hechos vivos”.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agt002-phase01-binding-registry.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add contracts/agt002-phase01/v1/binding-registry.schema.json contracts/agt002-phase01/v1/binding-registry.json tests/agt002-phase01-binding-registry.test.mjs
git commit -m "contracts(agt002-phase01): register real inverse tender-opportunity binding and record absent A / literal FK as gaps"
```

---

### Task 6: `VALID_LINK` ejecutable

**Files:**
- Create: `contracts/agt002-phase01/v1/valid-link-claim.schema.json`
- Modify: `agt002-phase01-executable-controls.js`
- Test: `tests/agt002-phase01-valid-link.test.mjs`

**Interfaces añadidas:**

```js
export const AGT002_PHASE01_LINK_TERMS = Object.freeze([
  'binding_registered', 'query_exhaustive', 'authoritative_source', 'cardinality_exactly_one',
  'identity_no_conflict', 'state_live', 'opportunity_open', 'evidence_durable',
  'term_a_entity_l', 'term_b_logical',
]);
export function validateAgt002Phase01ValidLink(claim, context);
// claim: { schema_version, claim_id, terms[], source_id, target_id, term_a?, term_b?, evidence[] }
// context: { now_utc, binding_registry?, observation?, claim_schema }
// -> { verdict, reasons, terms: [{ term, verdict, reasons }] }
```

`claim.terms` enumera qué términos se piden; sólo esos se evalúan (y `term_a_entity_l` sólo aparece si el claim pretende probar A). Un término pedido sin insumo ⇒ `UNVERIFIED`.

- [ ] **Step 1: Write the failing test**

`tests/agt002-phase01-valid-link.test.mjs` (`now_utc = '2026-09-23T18:00:00Z'`, binding registry real de Task 5 cargado desde disco):
1. Camino `VALID`: claim del vínculo lógico **B** vía binding inverso aprobado, observación con `rows.length === 1`, `internal_status: 'convertida_oportunidad'`, `opportunity.stage_code: 'activo'`, `tender_offer_status: 'en_preparacion'`, `query: {paginated:true, truncated:false, pages_fetched:2, page_size:50, rows_total_declared:1}`, `authoritative: true`, evidencia durable con `content_hash` ⇒ `VALID`.
2. `term_a_entity_l` incluido en `claim.terms` ⇒ veredicto agregado `UNVERIFIED` con `link.term_a.entity_l_absent`, **incluso** con la observación perfecta del caso 1. Nunca `VALID`, nunca `INVALID`.
3. Claim que pide la FK literal `psi_sales_opportunities.tender_id` sin sustitución ⇒ `UNVERIFIED` / `link.term_b.literal_fk_absent`.
4. Binding registry no inyectado ⇒ `UNVERIFIED` / `link.binding.not_registered`.
5. Claim cuyo `source`/`direction` no corresponde a la entrada aprobada (p. ej. `direction: 'forward'` contra `BIND-TENDER-OPPORTUNITY-INVERSE`) ⇒ `INVALID` / `link.binding.incompatible`.
6. `rows: []` con observación autoritativa y exhaustiva ⇒ `INVALID` / `link.cardinality.zero`.
7. `rows` con dos filas ⇒ `INVALID` / `link.cardinality.multiple`.
8. `rows[0].converted_opportunity_id` distinto de `claim.target_id` ⇒ `INVALID` / `link.identity.conflict`.
9. `internal_status: 'descartada'` ⇒ `INVALID` / `link.state.tender_discarded`; `'nueva'` ⇒ `link.state.tender_not_live`.
10. `opportunity.tender_offer_status: 'cerrada_no_go'` (y por separado `'adjudicada'`, `'no_adjudicada'`) ⇒ `INVALID` / `link.opportunity.closed`; `stage_code: 'descartado'` ⇒ `INVALID` / `link.opportunity.discarded`.
11. `evidence: []` ⇒ `UNVERIFIED` / `link.evidence.absent`; evidencia presente con `durable:false` ⇒ `INVALID` / `link.evidence.not_durable`.
12. `query.truncated: true` ⇒ `UNVERIFIED` / `link.query.not_exhaustive`; `rows_total_declared: 3` con `rows.length: 1` ⇒ `UNVERIFIED` / `link.query.not_exhaustive`; `query` ausente ⇒ mismo código.
13. `authoritative: false` ⇒ `UNVERIFIED` / `link.observation.not_authoritative`; `observation` ausente ⇒ `UNVERIFIED` / `link.observation.absent` y **todos** los términos de sustancia en `UNVERIFIED`.
14. Precedencia probada: observación con `rows: []` (INVALID) **y** `term_a_entity_l` (UNVERIFIED) ⇒ agregado `INVALID`; el detalle por término conserva ambos veredictos.
15. `claim.terms: []` ⇒ `UNVERIFIED` (fail-closed).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agt002-phase01-valid-link.test.mjs`
Expected: FAIL — `validateAgt002Phase01ValidLink` no existe.

- [ ] **Step 3: Write minimal implementation**

Autoría del schema de claim y de la función con los diez términos y la regla “INVALID sólo con dato autoritativo y exhaustivo”.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agt002-phase01-valid-link.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add contracts/agt002-phase01/v1/valid-link-claim.schema.json agt002-phase01-executable-controls.js tests/agt002-phase01-valid-link.test.mjs
git commit -m "feat(agt002-phase01): implement VALID_LINK three-verdict algebra over named terms A and B"
```

---

### Task 7: Fixtures aislados, contextos declarativos y runner de validación

**Files:**
- Create: `contracts/agt002-phase01/v1/fixture-context.schema.json`
- Create: `contracts/agt002-phase01/v1/fixtures/contexts.json`
- Create: `contracts/agt002-phase01/v1/fixtures/expectations.json`
- Create: 32 fixtures bajo `contracts/agt002-phase01/v1/fixtures/` (lista exacta abajo)
- Create: `scripts/agt002-phase01-validate-fixtures.mjs`
- Modify: `agt002-phase01-executable-controls.js`
- Test: `tests/agt002-phase01-fixtures.test.mjs`

**Interfaces añadidas:**

```js
export function buildAgt002Phase01Context(descriptor); // descriptor declarativo -> context para los validadores
export function evaluateAgt002Phase01Fixture(entry, { fixtureDir }); // -> { verdict, reasons }
```

`contexts.json` define contextos **declarativos** nombrados (`now_utc`, `consumption_ledger`, `authority_registry_ref`, `binding_registry_ref`, `observation`); `buildAgt002Phase01Context` los convierte en el contexto real. No hay funciones en los fixtures: todo es dato.

`expectations.json` es la tabla de verdad ejecutable: `[{ file, control, context, expected_verdict, expected_reasons[] }]`, con `control ∈ {gate, authority_registry, valid_link}`.

**Fixtures (32), todos con `environment: "isolated_fixture"`, `synthetic: true`, `active_case: null`, UUIDs `f1c70000-…`, locators `fixture://`:**

Gate (16):
1. `gate-valid-open.json` → `VALID`
2. `gate-valid-consumed-pass.json` → `VALID`
3. `gate-valid-consumed-rejected-final-audit-phase-0.json` → `VALID` (`gate_id: FINAL_AUDIT_PHASE_0`, `status: CONSUMED`, `outcome: REJECTED`)
4. `gate-invalid-missing-objective.json` → `INVALID` / `schema.missing_required`
5. `gate-invalid-open-with-outcome.json` → `INVALID` / `gate.status.invalid_outcome_for_status`
6. `gate-invalid-consumed-without-receipt.json` → `INVALID` / `gate.consumption.missing`
7. `gate-invalid-consumed-duplicate-receipt.json` → `INVALID` / `gate.consumption.receipt_not_unique`
8. `gate-invalid-consumed-second-consumption.json` → `INVALID` / `gate.consumption.exceeds_policy`
9. `gate-unverified-consumption-ledger-absent.json` → `UNVERIFIED` / `gate.consumption.ledger_absent`
10. `gate-invalid-open-but-expired.json` → `INVALID` / `gate.status.open_but_expired`
11. `gate-invalid-revoked-without-revocation.json` → `INVALID` / `gate.status.revocation_required`
12. `gate-invalid-artifact-set-hash.json` → `INVALID` / `gate.artifact_set_hash.mismatch`
13. `gate-invalid-authority-grant-not-found.json` → `INVALID` / `authority.grant.not_found`
14. `gate-invalid-delegation-expired.json` → `INVALID` / `authority.delegation.expired`
15. `gate-invalid-scope-ids-out-of-grant.json` → `INVALID` / `authority.scope.resource_out_of_scope`
16. `gate-unverified-authority-registry-absent.json` → `UNVERIFIED` / `authority.registry.absent`

Authority registry (6):
17. `authority-registry-valid.json` → `VALID`
18. `authority-registry-invalid-duplicate-grant-id.json` → `INVALID` / `authority.registry.duplicate_grant_id`
19. `authority-registry-invalid-role-as-principal.json` → `INVALID` / `authority.principal.role_is_not_person`
20. `authority-registry-invalid-synthetic-scoped-to-production.json` → `INVALID` / `authority.principal.synthetic_outside_isolated_fixture`
21. `authority-registry-invalid-delegation-depth.json` → `INVALID` / `authority.delegation.depth_exceeded`
22. `authority-registry-unverified-schema-absent.json` → `UNVERIFIED` / `authority.registry.schema_unavailable`

VALID_LINK (10):
23. `link-valid-inverse-binding.json` → `VALID`
24. `link-unverified-term-a-entity-l.json` → `UNVERIFIED` / `link.term_a.entity_l_absent`
25. `link-unverified-literal-fk-o-tender-id.json` → `UNVERIFIED` / `link.term_b.literal_fk_absent`
26. `link-invalid-binding-incompatible.json` → `INVALID` / `link.binding.incompatible`
27. `link-invalid-cardinality-zero.json` → `INVALID` / `link.cardinality.zero`
28. `link-invalid-cardinality-multiple.json` → `INVALID` / `link.cardinality.multiple`
29. `link-invalid-identity-conflict.json` → `INVALID` / `link.identity.conflict`
30. `link-invalid-opportunity-closed.json` → `INVALID` / `link.opportunity.closed`
31. `link-invalid-evidence-not-durable.json` → `INVALID` / `link.evidence.not_durable`
32. `link-unverified-query-not-exhaustive.json` → `UNVERIFIED` / `link.query.not_exhaustive`

(Los negativos restantes de la lista obligatoria —`link.state.tender_discarded`, `link.opportunity.discarded`, `link.evidence.absent`, `link.observation.absent`, el `FINAL_AUDIT_PHASE_0` en `OPEN` y `DRAFT→CONSUMED`— ya viven como literales inline en Tasks 3 y 6; Task 8 prueba que la matriz completa está cubierta entre fixtures e inline.)

- [ ] **Step 1: Write the failing test**

`tests/agt002-phase01-fixtures.test.mjs`:
1. `expectations.json` referencia **exactamente** los archivos presentes en `fixtures/` salvo `contexts.json` y el propio `expectations.json` (igualdad de conjuntos en ambos sentidos: ni fixtures huérfanos ni expectativas sin archivo).
2. Cada fixture valida contra el schema de su control **salvo** los declarados como `schema_negative: true` (caso 4), que deben fallar la forma con el código esperado.
3. Por cada fila: `evaluateAgt002Phase01Fixture` ⇒ `verdict === expected_verdict` y `expected_reasons ⊆ reasons` (subconjunto, comparando códigos).
4. Cobertura de veredictos: la tabla contiene al menos un `VALID`, un `INVALID` y un `UNVERIFIED` por cada uno de los tres controles.
5. `contexts.json` valida contra `fixture-context.schema.json` y todo `context` citado en `expectations.json` existe.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agt002-phase01-fixtures.test.mjs`
Expected: FAIL — fixtures y tablas no existen.

- [ ] **Step 3: Write minimal implementation**

Autoría de los 32 fixtures, `contexts.json`, `expectations.json`, `fixture-context.schema.json`, `buildAgt002Phase01Context`, `evaluateAgt002Phase01Fixture` y `scripts/agt002-phase01-validate-fixtures.mjs` (recorre `expectations.json`, imprime tabla `file | control | expected | actual` y sale con código 1 ante cualquier discrepancia; sólo lectura, sin red).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agt002-phase01-fixtures.test.mjs && node scripts/agt002-phase01-validate-fixtures.mjs`
Expected: PASS y exit 0 con 32 filas conformes.

- [ ] **Step 5: Commit**

```bash
git add contracts/agt002-phase01/v1/fixture-context.schema.json contracts/agt002-phase01/v1/fixtures scripts/agt002-phase01-validate-fixtures.mjs agt002-phase01-executable-controls.js tests/agt002-phase01-fixtures.test.mjs
git commit -m "test(agt002-phase01): add isolated synthetic fixtures, declarative contexts and fixture validator runner"
```

---

### Task 8: Matriz de negativos obligatorios (cobertura probada)

**Files:**
- Test: `tests/agt002-phase01-negative-matrix.test.mjs`

Esta tarea no añade lógica: prueba que los negativos obligatorios están cubiertos por al menos un caso ejecutable y que ninguno resuelve `VALID`. Los 14 negativos exigidos se despliegan en **17 filas verificables** (los compuestos —“vencido/revocado/consumido”, “cerrada/descartada”, “A no enlazado” y “`O.tender_id` ausente”— se separan en filas propias para que cada código tenga su aserción).

| # | Negativo obligatorio | Código esperado | Dónde |
|---|---|---|---|
| 1 | campo faltante | `schema.missing_required` | fixture 4 + inline Task 3.16 |
| 2 | autoridad incorrecta/inexistente | `authority.grant.not_found`, `authority.grant.gate_type_mismatch` | fixture 13 + Task 4.6/4.7 |
| 3 | delegación vencida | `authority.delegation.expired` | fixture 14 |
| 4 | gate vencido | `gate.status.open_but_expired` | fixture 10 |
| 5 | gate revocado | `gate.status.revocation_required`, `gate.transition.not_allowed` (`REVOKED→CONSUMED`) | fixture 11 + Task 3.5 |
| 6 | gate consumido (re-consumo) | `gate.consumption.exceeds_policy`, `gate.consumption.receipt_not_unique` | fixtures 7 y 8 |
| 7 | hash incorrecto | `gate.artifact_set_hash.mismatch` | fixture 12 |
| 8 | IDs fuera de alcance | `authority.scope.resource_out_of_scope` | fixture 15 |
| 9 | cero vínculos | `link.cardinality.zero` | fixture 26 |
| 10 | múltiples vínculos | `link.cardinality.multiple` | fixture 27 |
| 11 | vínculo incompatible | `link.binding.incompatible` | fixture 25 |
| 12 | identidad conflictiva | `link.identity.conflict` | fixture 28 |
| 13 | oportunidad cerrada/descartada | `link.opportunity.closed`, `link.opportunity.discarded` | fixture 29 + Task 6.10 |
| 14 | evidencia no durable | `link.evidence.not_durable` | fixture 30 |
| 15 | consulta no exhaustiva | `link.query.not_exhaustive` | fixture 32 |
| 16 | A no enlazado | `link.term_a.entity_l_absent` | fixture 23 |
| 17 | `O.tender_id` ausente | `link.term_b.literal_fk_absent` | fixture 24 |

- [ ] **Step 1: Write the failing test**

`tests/agt002-phase01-negative-matrix.test.mjs`: declara la tabla de 17 filas como array `REQUIRED_NEGATIVES` con `{ id, codes[] }`. Para cada fila: recorre `expectations.json` y los casos inline reexportados desde los tests de Tasks 3/4/6 vía `contracts/agt002-phase01/v1/fixtures/expectations.json` + un mapa `INLINE_NEGATIVES` definido en este mismo archivo (cada entrada construye el registro inline y corre el validador). Asserta que cada código requerido aparece al menos una vez, que el veredicto asociado nunca es `VALID`, y que todo código emitido pertenece a `AGT002_PHASE01_REASON_CODES` (no hay códigos huérfanos ni prosa libre).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agt002-phase01-negative-matrix.test.mjs`
Expected: FAIL — el archivo no existe.

- [ ] **Step 3: Write minimal implementation**

Autoría del test con las 17 filas y los constructores inline. Si algún código requerido no aparece, se corrige el **artefacto** (fixture o validador), nunca la matriz.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agt002-phase01-negative-matrix.test.mjs`
Expected: PASS, con los 17 negativos cubiertos.

- [ ] **Step 5: Commit**

```bash
git add tests/agt002-phase01-negative-matrix.test.mjs
git commit -m "test(agt002-phase01): prove coverage of the 17 mandatory negative cases"
```

---

### Task 9: Guardas de prohibición, aislamiento y no-producción

**Files:**
- Test: `tests/agt002-phase01-no-production-guards.test.mjs`

- [ ] **Step 1: Write the failing test**

`tests/agt002-phase01-no-production-guards.test.mjs`, con `ARTIFACTS` = `agt002-phase01-executable-controls.js`, `scripts/agt002-phase01-validate-fixtures.mjs`, todo `contracts/agt002-phase01/v1/**` y todo `tests/agt002-phase01-*.test.mjs`:
1. **Cero Supabase / cero red / cero reloj.** Para cada artefacto `.js`/`.mjs`: `assert.doesNotMatch` contra `/@supabase\/supabase-js|createClient\(|SUPABASE_SERVICE_ROLE_KEY|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|fetch\(|node:https?|undici|Date\.now\(\)|new Date\(\)/`.
2. **Nada operacional.** Ningún artefacto menciona `supabase db push`, `supabase migration`, `deploy`, `canary`, `scheduler`, `setInterval(`, `setTimeout(`, `cron`, `SharePoint`, `smtp`, `sendmail`.
3. **Sin E2E real.** `readdirSync('tests').filter(n => n.startsWith('agt002-phase01-'))` no contiene `.integration.test.mjs` ni `.e2e.test.mjs`.
4. **Aislamiento de fixtures.** Todo `fixtures/**.json` (salvo `expectations.json` y `contexts.json`, que se validan por separado): `environment === 'isolated_fixture'`, `synthetic === true`, `active_case === null`.
5. **No-producción.** Sobre el texto crudo de cada fixture: no matchea `/DANE|Fondo\s*[UÚuú]nico|Cali|seguridadnacional\.co|https?:\/\//i`; todo string con forma UUID (`/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi`) empieza por `f1c70000-`; todo `locator` empieza por `fixture://`.
6. **Auditoría Fase 0.** Todo fixture con `gate_id === 'FINAL_AUDIT_PHASE_0'` tiene `status === 'CONSUMED'` y `outcome === 'REJECTED'`; además existe al menos uno. **Sin excepciones nombradas**: si aparece uno con `status: 'OPEN'`, la prueba falla.
7. **Anti-invención A/B.** Ningún artefacto del plan afirma la existencia de `entity_l` ni de `psi_sales_opportunities.tender_id`: cualquier mención va acompañada, en el mismo objeto JSON, de `status: "absent_live"` o de un `gap_id` `AGT002-P1-GAP-0001|0002`.
8. **Migraciones intactas.** `readdirSync('supabase/migrations')`: ningún archivo con prefijo numérico ≥ `092`, ninguno cuyo nombre contenga `phase01`, `phase_01` o `executable-controls`; el máximo sigue siendo `091_agt002_validation_recovery_slot.sql`.
9. **Diseño fuera del orden de migraciones.** `supabase/migration-designs/` no contiene archivos con prefijo numérico de migración, y ningún archivo bajo `scripts/` o `tests/` (fuera del test estático de Task 10) referencia `migration-designs`.
10. **Higiene de referencias.** Ningún artefacto del plan contiene la cadena `CONTRADICTIONS.md#`; las referencias a hallazgos usan IDs durables `AGT002-P1-FACT-\d{4}` o `AGT002-P1-GAP-\d{4}`.
11. **Sin marcadores.** Ningún artefacto del plan contiene `TODO`, `TBD`, `FIXME`, `placeholder`, `XXX`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agt002-phase01-no-production-guards.test.mjs`
Expected: FAIL — el archivo no existe (las guardas 8–9 pasarían ya, pero el archivo aún no).

- [ ] **Step 3: Write minimal implementation**

Autoría del archivo con las 11 guardas. Si alguna falla, se corrige el artefacto ofensor, **nunca** la guarda.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agt002-phase01-no-production-guards.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/agt002-phase01-no-production-guards.test.mjs
git commit -m "test(agt002-phase01): guard isolation, zero-writes, Phase-0 audit consumption and untouched migrations"
```

---

### Task 10: Diseño SQL NO aplicable (gate instances + authority grants)

**Files:**
- Create: `supabase/migration-designs/README.md`
- Create: `supabase/migration-designs/2026-09-23-agt002-phase01-gate-ledger.design.sql`
- Test: `tests/agt002-phase01-migration-design.test.mjs`

Justificación registrada: `AGT002-P1-GAP-0003` y `AGT002-P1-GAP-0004` — no existe almacenamiento productivo apto (`psi_profile_permissions` no tiene `grant_id` ni vigencia, `AGT002-P1-FACT-0009/0010`; `psi_agt002_radar_gate_evaluations` es específico del Radar, `AGT002-P1-FACT-0011`).

**Contenido obligatorio del `.design.sql`** (en este orden):

1. Banner de cabecera, primeras líneas, literal:
```
-- DO NOT APPLY
-- DO NOT APPLY: design-only artifact for AGT-002 Phase 01. Not a migration.
-- It lives outside supabase/migrations/ on purpose and is NOT part of the migration order.
-- Reason: AGT002-P1-GAP-0003 (no production store for gate instances) and
--         AGT002-P1-GAP-0004 (no production store for authority grants).
```
2. Guarda ejecutable fail-closed (aborta si alguien lo corre de todos modos):
```sql
do $$ begin
  raise exception 'DO NOT APPLY: 2026-09-23-agt002-phase01-gate-ledger.design.sql is a design artifact, not a migration'
    using errcode = '0A000';
end $$;
```
3. Tablas propuestas, **sin** `begin;`/`commit;` envolventes:
   - `agt002_phase01_gate_instances`: `gate_id text primary key`, `schema_version text not null check (schema_version = 'agt002-phase01-gate/1.0.0')`, `type text not null check (type in (…5 tipos…))`, `grant_id text not null references agt002_phase01_authority_grants(grant_id) on delete restrict`, `environment text not null check (environment in ('production','isolated_fixture'))`, `objective text not null check (btrim(objective) <> '')`, `issued_at_utc timestamptz not null`, `expires_at_utc timestamptz not null check (expires_at_utc > issued_at_utc)`, `status text not null check (status in ('DRAFT','OPEN','CONSUMED','EXPIRED','REVOKED'))`, `outcome text check (outcome in ('PASS','REJECTED','CANCELLED'))`, `artifact_set_hash text not null check (artifact_set_hash ~ '^[0-9a-f]{64}$')`, `scope jsonb not null`, `preconditions jsonb not null`, `evidence jsonb not null`, `rollback jsonb not null`, y el **check de separación ciclo/resultado**: `check ((status in ('DRAFT','OPEN','EXPIRED','REVOKED') and outcome is null) or (status = 'CONSUMED' and outcome is not null))`.
   - `agt002_phase01_authority_grants`: `grant_id text primary key`, `registry_version int not null check (registry_version >= 1)`, `gate_type text not null`, `principal_id text not null`, `principal_kind text not null check (principal_kind in ('human','agent','synthetic'))`, `durable_ref jsonb not null`, `delegate_of text references agt002_phase01_authority_grants(grant_id) on delete restrict`, `valid_from_utc timestamptz not null`, `valid_until_utc timestamptz not null check (valid_until_utc > valid_from_utc)`, `scope jsonb not null`, `revoked_at_utc timestamptz`, y check de profundidad 1 documentado como trigger propuesto.
   - `agt002_phase01_gate_consumption_receipts`: `receipt_id text primary key`, `gate_id text not null references agt002_phase01_gate_instances(gate_id) on delete restrict`, `consumed_at_utc timestamptz not null`, `consumed_by text not null`, `outcome text not null check (outcome in ('PASS','REJECTED','CANCELLED'))`, **`unique (gate_id)`** (impone `max_consumptions = 1` a nivel de motor) y `unique (receipt_id)` implícito por PK.
4. **RLS conceptual**, en comentarios (no `alter table … enable row level security` ejecutable fuera de la guarda, y de todas formas inalcanzable): las tres tablas serían `enable row level security` + `force row level security`, sin política para `anon`/`authenticated`, lectura y escritura exclusivas de `service_role` vía funciones `security definer` con `set search_path = public, pg_temp`, y trigger `before update or delete` que rechaza mutaciones (ledger append-only), en la línea de `071_agt002_radar_gate.sql`.
5. Cierre: nota de que aplicar este diseño requiere un plan separado, su propia migración numerada, su rollback en `supabase/rollbacks/` y aprobación explícita — nada de eso ocurre en Fase 01.

`supabase/migration-designs/README.md` explica en tres párrafos qué es el directorio, por qué está fuera del orden de migraciones y la regla: los archivos terminan en `.design.sql`, nunca llevan prefijo numérico de migración y nunca se ejecutan.

- [ ] **Step 1: Write the failing test**

`tests/agt002-phase01-migration-design.test.mjs`:
1. El archivo existe, termina en `.design.sql`, y su nombre **no** empieza por dígitos.
2. Las dos primeras líneas contienen `DO NOT APPLY`; el texto cita `AGT002-P1-GAP-0003` y `AGT002-P1-GAP-0004`.
3. Contiene la guarda `raise exception 'DO NOT APPLY` y **no** contiene `begin;`/`commit;` de nivel superior.
4. Declara las tres tablas con sus nombres exactos; contiene el check de separación ciclo/resultado literal, el `unique (gate_id)` del ledger de receipts, y los `references … on delete restrict`.
5. Menciona `row level security`, `service_role`, `security definer`, `set search_path = public, pg_temp` y `append-only` en la sección conceptual.
6. `supabase/migrations/` no contiene ningún archivo cuyo nombre incluya `gate-ledger`, `gate_ledger` o `phase01`; el máximo sigue siendo `091`.
7. Ningún script del repo referencia el archivo de diseño: `grep` recursivo sobre `scripts/` y `server/` sin coincidencias de `migration-designs`.
8. `supabase/migration-designs/README.md` existe y contiene `DO NOT APPLY` y `.design.sql`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agt002-phase01-migration-design.test.mjs`
Expected: FAIL — el diseño y el README no existen.

- [ ] **Step 3: Write minimal implementation**

Autoría de `supabase/migration-designs/README.md` y del `.design.sql` con el contenido obligatorio.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agt002-phase01-migration-design.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migration-designs tests/agt002-phase01-migration-design.test.mjs
git commit -m "design(agt002-phase01): add DO-NOT-APPLY SQL design for gate instances, authority grants and consumption receipts"
```

---

### Task 11: Higiene documental versionada (inventario, catálogo de gates, hallazgos durables)

**Files:**
- Create: `docs/agt002/phase01/binding-inventory.md`
- Create: `docs/agt002/phase01/gate-catalog.md`
- Create: `docs/agt002/phase01/findings-index.md`
- Test: `tests/agt002-phase01-docs.test.mjs`

`binding-inventory.md`: inventario en prosa del `binding-registry.json` — las tres entradas, el binding inverso real con sus locators de migración y el endpoint `GET /rest/v1/psi_public_tenders`, la reconciliación `cutoff_utc`/`verified_at_utc` y el estado de `live_metadata_get.artifact`, y por qué `psi_agt002_radar_gate_evaluations` (`AGT002-P1-FACT-0011`) no se reutiliza como gate genérico.

`gate-catalog.md`: catálogo completo de los cinco `gate_type`, con su objetivo, autoridad mínima, política de consumo, y la **cláusula del contrato del skill** que cada uno satisface, citada por identificador de cláusula (no por número de línea ni por ancla frágil). Incluye la sección “Cobertura”: el catálogo cubre exactamente el `enum` de `gate.schema.json`.

`findings-index.md`: índice de IDs durables `AGT002-P1-FACT-0001..0011` y `AGT002-P1-GAP-0001..0004`, cada uno con enunciado, locator y estado. Regla explícita: las referencias se hacen por ID durable; **no** se usa `CONTRADICTIONS.md#6` ni ninguna ancla posicional.

- [ ] **Step 1: Write the failing test**

`tests/agt002-phase01-docs.test.mjs`:
1. Los tres documentos existen y ninguno contiene `TODO|TBD|FIXME|placeholder|CONTRADICTIONS\.md#`.
2. `findings-index.md` contiene los 11 `AGT002-P1-FACT-\d{4}` y los 4 `AGT002-P1-GAP-\d{4}`, y el conjunto de IDs del documento **coincide exactamente** con el conjunto de `fact_id`/`gap_id` usados en `binding-registry.json` más los referenciados por los fixtures.
3. `gate-catalog.md` cubre, por igualdad de conjuntos, el `enum` de `gate.schema.json` (`AGT002_PHASE01_GATE_TYPES`); cada tipo tiene una línea de cláusula del contrato del skill con el patrón `skill-contract:[a-z0-9.-]+`.
4. `binding-inventory.md` menciona `psi_public_tenders.converted_opportunity_id`, `psi_sales_opportunities.id`, `psi_public_tenders_converted_opportunity_id_unique`, `/rest/v1/psi_public_tenders`, `AGT002-P1-GAP-0001`, `AGT002-P1-GAP-0002` y `psi_agt002_radar_gate_evaluations`.
5. `binding-inventory.md` declara el mismo `cutoff_utc` que `binding-registry.json` (comparación literal del string extraído).
6. Guarda de skill: `assert.equal(existsSync('.claude/skills'), false)` **o**, si existiera, que `git status --porcelain .claude/skills` esté vacío — este plan no lo modifica en ningún caso.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agt002-phase01-docs.test.mjs`
Expected: FAIL — los documentos no existen.

- [ ] **Step 3: Write minimal implementation**

Autoría de los tres documentos.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agt002-phase01-docs.test.mjs`
Expected: PASS.

- [ ] **Step 5: Decisión sobre el skill (obligatoria, documentada)**

Criterio único: si —y sólo si— `gate-catalog.md` no puede citar una cláusula existente del contrato del skill para alguno de los cinco `gate_type`, entonces el inventario demuestra que falta un enlace contractual indispensable. En ese caso:
- **no** se modifica el skill en este plan ni en este repo;
- se registra el vacío en `gate-catalog.md` bajo “Brecha contractual pendiente”, citando el `gate_type` y el ID durable del hallazgo;
- se reporta al usuario y se propone un **plan separado**, a ejecutarse en un worktree sobre `origin/main` de `juan-skills-hub`, fuera de este repositorio.

Si todos los tipos tienen cláusula, se deja constancia en el documento y no se toca nada.

- [ ] **Step 6: Commit**

```bash
git add docs/agt002/phase01 tests/agt002-phase01-docs.test.mjs
git commit -m "docs(agt002-phase01): document binding inventory, full gate catalog and durable findings index"
```

---

### Task 12: Verificación final y auditoría read-only

**Files:** ninguno.

- [ ] **Step 1: Suite dirigida de Fase 01**

Run:
```bash
node --test \
  tests/agt002-phase01-schema-engine.test.mjs \
  tests/agt002-phase01-gate-schema.test.mjs \
  tests/agt002-phase01-gate-lifecycle.test.mjs \
  tests/agt002-phase01-authority-registry.test.mjs \
  tests/agt002-phase01-binding-registry.test.mjs \
  tests/agt002-phase01-valid-link.test.mjs \
  tests/agt002-phase01-fixtures.test.mjs \
  tests/agt002-phase01-negative-matrix.test.mjs \
  tests/agt002-phase01-no-production-guards.test.mjs \
  tests/agt002-phase01-migration-design.test.mjs \
  tests/agt002-phase01-docs.test.mjs
```
Expected: 0 fail, 0 skipped.

- [ ] **Step 2: Validador sobre fixtures**

Run: `node scripts/agt002-phase01-validate-fixtures.mjs`
Expected: exit 0, 32 filas, `expected === actual` en todas.

- [ ] **Step 3: Suite completa**

Run: `npm test`
Expected: **0 fail**, **10 skipped** (idéntico a la línea base) y `pass ≥ 2109 + tests nuevos`. Cualquier desviación en `fail`/`skipped` detiene el plan.

- [ ] **Step 4: Gates técnicos (lint equivalente + build)**

Run: `npm run check:backend-parity && npx tsc --noEmit && npm run build && git diff --check`
Expected: exit 0 en los cuatro. No existe script `lint` en este repo (Task 0, Step 4): `tsc --noEmit` + `build` son el gate equivalente. Ningún archivo de este plan toca `src/`, `server/` ni `api/`, así que backend-parity y build deben seguir verdes por no-modificación.

- [ ] **Step 5: Prueba de no producción**

Run:
```bash
git status --porcelain supabase/migrations && \
grep -rIl -e 'DANE' -e 'Fondo Ún' -e 'Fondo Un' -e 'Cali' -e 'seguridadnacional.co' contracts/agt002-phase01 || echo NO_PRODUCTION_EVIDENCE
```
Expected: sin salida para `supabase/migrations` (cero migraciones nuevas) y `NO_PRODUCTION_EVIDENCE`. Confirmar además, leyendo `git status --porcelain`, que sólo aparecen rutas bajo `contracts/agt002-phase01/`, `agt002-phase01-executable-controls.js`, `scripts/agt002-phase01-validate-fixtures.mjs`, `tests/agt002-phase01-*.test.mjs`, `supabase/migration-designs/` y `docs/agt002/phase01/`. Cualquier otra ruta detiene el plan.

- [ ] **Step 6: Auditoría read-only (Opus) antes de commit final / push / PR**

Solicitar al usuario una auditoría **de sólo lectura** sobre el diff acumulado (`git diff main...HEAD --stat` y el diff completo), ejecutada con Opus y sin herramientas de escritura. La auditoría revisa, como mínimo: separación ciclo de vida/resultado, unicidad de receipt, fail-closed del registry de autoridad, que `VALID_LINK` no eleva A ni la FK literal a `VALID`, ausencia de evidencia productiva en fixtures y que el diseño SQL sigue fuera del orden de migraciones.

**No** se hace `git push` ni se abre PR dentro de este plan. El commit final sólo ocurre después de que la auditoría no reporte hallazgos bloqueantes; si los reporta, se corrigen con TDD (test RED que reproduce el hallazgo → fix → GREEN) y se repite desde Step 1.

- [ ] **Step 7: Commit final**

```bash
git add -A
git status
git commit -m "chore(agt002-phase01): close executable controls phase after read-only audit"
```
Revisar `git status` antes de comitear: si aparece cualquier ruta fuera de la lista de Step 5, detenerse y entenderlo antes de continuar.

---

## Anexo — Qué queda explícitamente fuera de Fase 01

- Persistir gates o grants en Supabase (bloqueado por `AGT002-P1-GAP-0003`/`AGT002-P1-GAP-0004`; el diseño existe, no aplicado).
- Cualquier lectura o escritura contra el proyecto Supabase real, cualquier E2E, cualquier worker, timer o scheduler.
- Cualquier modificación de skill (ver Task 11, Step 5 para el procedimiento de escalamiento).
- Reabrir, avanzar o cerrar casos reales: quedan estacionados, `active_case: null` en todo el alcance.
