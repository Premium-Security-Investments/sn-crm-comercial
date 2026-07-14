# Task 2 — Persistencia de Seguimiento de licitaciones

## Estado

`DONE_WITH_CONCERNS`

## Commit de implementación

- Base: `e4da5578e090053a0d18ecdf178064d21acef720`
- Implementación: `a97811b312515f541dfa3b74d4a14c582da07925` — `feat: add tender tracking persistence`

## Archivos modificados

- `supabase/migrations/017_tender_tracking_workflow.sql`
  - Añade de forma idempotente las ocho columnas `tracking_*` a `public.psi_public_tenders`.
  - Crea `public.psi_tender_tracking_events` con FKs UUID compatibles, cascada al borrar la licitación, tipos de evento restringidos, RLS, políticas select/modify, grants e índices de cola/historial.
- `tests/tender-tracking-migration.test.mjs`
  - Contrato estático que exige las columnas, tabla de eventos, FK en cascada, RLS, índices, políticas y grant requeridos.

## Decisiones de esquema

- `public.psi_public_tenders.id` es `uuid` (migración `005_public_tenders_radar.sql`), por lo cual `psi_tender_tracking_events.tender_id uuid references public.psi_public_tenders(id) on delete cascade` es compatible.
- `public.psi_sales_profiles.id` ya se usa como FK UUID en las migraciones existentes, por lo cual `tracking_owner_id`, `assigned_to` y `created_by` usan UUID hacia esa tabla.
- El brief pedía `014_tender_tracking_workflow.sql`, pero `014_siio_f2_foundation.sql` ya existe y las versiones `015` y `016` ya están ocupadas. Se creó `017_tender_tracking_workflow.sql`, la siguiente versión única, para evitar una migración Supabase con versión duplicada.

## Evidencia TDD

### RED

```bash
node tests/tender-tracking-migration.test.mjs
```

Resultado: salida `1`, con el fallo esperado:

```text
AssertionError [ERR_ASSERTION]: La migración debe usar la siguiente versión disponible (017); 014 ya pertenece a SIIO.
false !== true
```

La prueba falló porque la migración 017 aún no existía.

### GREEN y regresión

```bash
node tests/tender-tracking-migration.test.mjs
# tender tracking migration contract passed

node tests/tender-search-profiles.test.mjs
# Tender search profiles persistence expectations passed

node --check tests/tender-tracking-migration.test.mjs
# exit 0

git diff --check
# exit 0

for test in tests/*.test.mjs; do node "$test"; done
# all static tests passed: 40
```

## Auto-revisión

- Confirmé que las ocho columnas solicitadas usan `add column if not exists`.
- Confirmé que la FK de licitación usa el tipo UUID real de la PK y `on delete cascade`.
- Confirmé que los perfiles usan la misma autorización existente de licitaciones: perfil activo, rol autorizado o correo de directora de licitaciones.
- Confirmé que select y modify se recrean idempotentemente y que el grant cubre select/insert/update/delete.
- Confirmé que no hay prefijos de versión de migración duplicados después de añadir 017.
- No se ejecutó ninguna migración, no se accedió a Supabase y no se modificó producción.

## Preocupaciones

- La discrepancia de nombre del brief (`014`) se resolvió con la versión única `017`; cualquier automatización externa que exija el nombre literal del brief debe actualizarse para apuntar a 017.
- La verificación es estática local. No hay un entorno Supabase aislado configurado en este worktree para ejecutar SQL sin violar la instrucción de no aplicar la migración.

## Corrección de revisión — historial inmutable y atribución auditada

### Commit de corrección

- `86e6fd2b950fece4eed81bd66233f36d614056a9` — `fix: make tender tracking history immutable`

### Cambios aplicados

- Las FKs humanas `tracking_owner_id`, `assigned_to` y `created_by` usan `on delete set null`; `tender_id` conserva `on delete cascade`.
- El historial de eventos ahora tiene únicamente políticas `select` e `insert`; la política histórica `modify` se elimina y no hay políticas `for all`, `for update` ni `for delete`.
- `authenticated` recibe sólo `select, insert`; se revocan explícitamente `update, delete`.
- La política de inserción exige que `created_by` no sea nulo y sea exactamente el `id` del perfil activo autorizado cuyo correo coincide con `auth.jwt() ->> 'email'`.
- El contrato estático ahora rechaza políticas mutables y grants `update`, `delete` o `all`.

### Evidencia TDD

#### RED

```bash
node tests/tender-tracking-migration.test.mjs
```

Resultado: salida `1`, con el fallo esperado antes de modificar la migración:

```text
AssertionError [ERR_ASSERTION]: Debe agregar idempotentemente tracking_owner_id
```

El contrato nuevo falló porque la FK de `tracking_owner_id` todavía no usaba `on delete set null`.

#### GREEN y regresiones

```bash
node tests/tender-tracking-migration.test.mjs
# tender tracking migration contract passed

node tests/tender-search-profiles.test.mjs
# Tender search profiles persistence expectations passed

for test in tests/*.test.mjs; do node "$test" || exit 1; done
# 40 pruebas estáticas aprobadas

git diff --check
# exit 0
```

No se aplicó la migración, no se accedió a Supabase y no se modificó producción.
