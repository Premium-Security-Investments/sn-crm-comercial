# Remediación P0 — grants residuales de `anon` en objetos de 026/027

- **Resultado:** PASS
- **Fecha UTC:** 2026-07-26 (sesión de reparación posterior al diagnóstico Fase 1)
- **Autorización:** explícita del humano (Juan Botero, jmb@valienta.com) en esta sesión, alcance limitado a P0
- **Modalidad:** cambio productivo puntual vía RPC `exec_sql` (service_role). Sin re-apply de 026/027, sin rollback, sin deploy a Vercel, sin lectura/escritura de filas de negocio.

## 0. Contexto (diagnóstico Fase 1, mismo hilo)

Las migraciones 026 y 027 se aplicaron **completas** en producción (todas las tablas, funciones y triggers existían con las firmas correctas). El runner (`scripts/tender-document-state-migrations.mjs`) reportaba falsamente `status:"pending"` porque `classify()` exige `grants_*_unsafe = 0` en las 3 tablas nuevas, y `anon` conservaba privilegios completos por defecto de Supabase (`pg_default_acl` del schema `public`) que las migraciones nunca revocaron explícitamente (solo revocaban de `public`/`authenticated`/`service_role`). El mismo patrón dejaba `anon` con `EXECUTE` en las 5 funciones `SECURITY DEFINER` nuevas, incluida `psi_record_tender_go_no_go`.

## 1. Estado previo (catálogo, capturado antes del parche)

- `anon`: 7/7 privilegios de tabla (`SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER`) en `psi_company_procurement_documents`, `psi_tender_document_versions`, `psi_tender_document_state`.
- `anon`: `EXECUTE = true` en las 9 funciones auditadas (`psi_is_public_https_url`, `psi_record_company_procurement_document`, `psi_record_tender_document_version`, `psi_invalidate_tender_state_from_legacy_upload`, `psi_invalidate_tender_state_from_typed_version`, `psi_begin_tender_document_refresh`, `psi_record_tender_document_snapshot` 8-arg, `psi_record_tender_go_no_go` 8-arg, `psi_tender_analysis_foundation_ready`).
- `authenticated`: ya en `false`/sin grants en todo (correcto, sin cambios).
- `service_role`: `SELECT` en `psi_tender_document_versions` y `psi_tender_document_state`; nada en `psi_company_procurement_documents`; `EXECUTE` en las 6 funciones de superficie pública (no en `psi_is_public_https_url` ni en las 2 funciones de trigger, por diseño).
- RLS: `relrowsecurity = true` en las 3 tablas.
- Runner: `STATUS {"status":"pending","migration_026":false,"migration_027":false}`.

## 2. Parche ejecutado (una sola llamada `exec_sql`, sin `begin;`/`commit;`)

```sql
revoke all on table public.psi_company_procurement_documents from anon;
revoke all on table public.psi_tender_document_versions from anon;
revoke all on table public.psi_tender_document_state from anon;
revoke all on function public.psi_is_public_https_url(text) from anon;
revoke all on function public.psi_record_company_procurement_document(text,text,date,date,text,text,text,bigint,uuid,uuid) from anon;
revoke all on function public.psi_record_tender_document_version(uuid,uuid,text,text,text,text,text,text,bigint,text,text,text,uuid) from anon;
revoke all on function public.psi_invalidate_tender_state_from_legacy_upload() from anon;
revoke all on function public.psi_invalidate_tender_state_from_typed_version() from anon;
revoke all on function public.psi_begin_tender_document_refresh(uuid,uuid) from anon;
revoke all on function public.psi_record_tender_document_snapshot(uuid,uuid,text,text,jsonb,jsonb,uuid,uuid) from anon;
revoke all on function public.psi_record_tender_go_no_go(uuid,uuid,uuid,text,uuid,text,jsonb,text) from anon;
revoke all on function public.psi_tender_analysis_foundation_ready() from anon
```

Respuesta RPC: `{"ok": true, "note": "non-select statement executed", "rows": null}` (rama esperada de `exec_sql` para DDL/multi-sentencia; ejecuta la cadena completa en una transacción implícita).

## 3. Verificación posterior (catálogo)

| Comprobación | Resultado |
|---|---:|
| Grants de `anon` en las 3 tablas | **0** (ausente por completo de `information_schema.role_table_grants`) |
| `EXECUTE` de `anon` en las 9 funciones | **false** en las 9 |
| `EXECUTE`/grants de `authenticated` | sin cambios (ya en `false`/ninguno) |
| Grants de `service_role` (tablas y funciones) | **sin cambios** frente a la línea base — `SELECT` en `psi_tender_document_versions`/`psi_tender_document_state`, `EXECUTE` en las 6 funciones de superficie pública |
| RLS (`relrowsecurity`) en las 3 tablas | **true**, sin cambios |
| Estructuras 026/027 (tablas, funciones con firma exacta, triggers) | **todas presentes**, sin cambios frente a la línea base; overload de 7 args de `psi_record_tender_go_no_go` sigue **ausente** (correcto) |
| Runner `status` | `STATUS {"status":"applied","migration_026":true,"migration_027":true}` |
| Runner `verify` | `STATUS {"status":"applied","migration_026":true,"migration_027":true}` → `VERIFY_OK` |

## 4. Fuera de alcance de esta sesión (pendiente, no ejecutado)

- Actualizar `026_tender_document_versions.sql` / `027_tender_decision_current_analysis.sql` y sus rollbacks para incluir `revoke ... from anon` de forma nativa (bootstrap de entornos nuevos).
- Ajustar `classify()`/`rollback()` del runner para distinguir "objeto ausente" de "objeto presente con grants inseguros", evitando un no-op silencioso de auto-rollback.
- Ajustar `PREREQUISITES_SQL`/`preflight()` para aceptar el estado "025 ya superado por 027".

Ningún dato de negocio (expedientes, filas) fue leído ni modificado. No se ejecutó `apply`, `rollback` ni despliegue a Vercel.

## 5. Remediación de causa raíz en código fuente (P1–P3, sesión separada, sin producción)

- **Resultado:** PASS
- **Fecha UTC:** 2026-07-26 (sesión de reparación de causa raíz, posterior al parche P0 de la sección 1–4)
- **Rama:** `fix/migrations-026-027-anon-grants-hardening`, creada desde `origin/main` limpio (worktree dedicado)
- **Modalidad:** solo código fuente y pruebas. Sin `exec_sql` contra producción, sin `apply`/`rollback` reales, sin deploy. TDD focal: cada corrección tiene una prueba que falla (RED) antes del cambio y pasa (GREEN) después.

Cierra los tres pendientes de la sección 4:

### 5.1 `revoke ... from anon` nativo en 026/027 y su rollback

Se añadió `revoke all on ... from anon;` junto a cada `revoke ... from public/authenticated/service_role` preexistente, sin tocar ningún `grant ... to service_role` ni `grant select ... to service_role` ya previstos:

- `supabase/migrations/026_tender_document_versions.sql`: 2 tablas + 3 funciones (`psi_is_public_https_url`, `psi_record_company_procurement_document`, `psi_record_tender_document_version`).
- `supabase/migrations/027_tender_decision_current_analysis.sql`: 1 tabla + 6 funciones (`psi_invalidate_tender_state_from_legacy_upload`, `psi_invalidate_tender_state_from_typed_version`, `psi_begin_tender_document_refresh`, `psi_record_tender_document_snapshot` 8-arg, `psi_record_tender_go_no_go` 8-arg, `psi_tender_analysis_foundation_ready`).
- `supabase/rollbacks/027_tender_decision_current_analysis_rollback.sql`: las 3 firmas que este rollback recrea (`psi_record_tender_document_snapshot` 7-arg, `psi_record_tender_go_no_go` 7-arg, `psi_tender_analysis_foundation_ready` restaurada) reciben el mismo `revoke ... from anon`.
- `supabase/rollbacks/026_tender_document_versions_rollback.sql`: sin cambios — ese rollback no crea ni restaura ningún objeto (solo revoca `EXECUTE` de `service_role` en 2 funciones preexistentes), por lo que no hay superficie nueva que exponer a `anon`.

Prueba estática dedicada: `tests/tender-document-migrations-026-027-anon-grants.test.mjs` (nueva) — verifica por expresión regular cada `revoke ... from anon` exacto en los 4 archivos y que los `grant ... to service_role` preexistentes sobreviven intactos.

### 5.2 `classify()`/`rollback()`: distinguir "ausente" de "presente con grants inseguros"

Causa raíz del auto-rollback no-op: `classify()` calculaba `migration026`/`migration027` mezclando existencia estructural (tablas/funciones/triggers/grants a `service_role`) con postura de seguridad (RLS, ausencia de grants a `anon`/`authenticated`/`public`). Si ambas migraciones tenían grants inseguros pero estructura completa, ambos flags daban `false` y `status` caía en `"pending"` — el mismo estado que "nada se aplicó nunca" — y `rollback()` solo ejecuta el DROP de cada migración `if (before.migration02N)`, así que no ejecutaba nada y aun así reportaba `ROLLBACK_OK`.

Corrección en `scripts/tender-document-state-migrations.mjs`:

- `classify()` ahora calcula `structural026`/`structural027` (existencia de tablas, funciones, triggers y grants a `service_role`) por separado de `secure026`/`secure027` (RLS + cero grants inseguros); `migration026`/`migration027` siguen siendo `structural && secure` (sin cambio de contrato para quien ya los consume).
- `status` pasa a `'pending'` únicamente cuando **ambas** migraciones carecen de estructura (`!structural026 && !structural027`); cualquier otra combinación es `'partial'` — cubre tanto el único estado intermedio real (026 aplicada, 027 no) como el caso "estructura presente, grants inseguros".
- `rollback()` ahora decide qué archivo de rollback ejecutar mirando `before.structural02N` (no el flag `migration02N` filtrado por seguridad), así que un estado "presente pero inseguro" sí dispara el DROP real en vez de un no-op.

Prueba dedicada (RED→GREEN) en `tests/tender-document-state-migrations-classify.test.mjs`: reproduce exactamente el escenario de producción (`grants_*_unsafe = 7` en las 3 tablas, todo lo demás como `fullyApplied`) y exige `status !== 'pending'`, `status === 'partial'`, `structural026 === true`, `structural027 === true`.

### 5.3 `preflight()`/`PREREQUISITES_SQL`: aceptar el overload de 025 (7 args) o el de 027 (8 args)

Causa raíz: `PREREQUISITES_SQL` solo comprobaba `to_regprocedure('psi_record_tender_go_no_go(uuid,uuid,uuid,text,uuid,text,jsonb)')` (7 args, marcador de 025). Con 027 ya aplicada, ese overload no existe (027 lo reemplaza por el de 8 args), así que cualquier `preflight`/`apply` futuro fallaba con "Prerrequisitos de 022/025 ausentes" aunque el estado deseado ya estuviera completo — sin abrir la puerta a un reapply ciego, simplemente sin forma de confirmarlo en modo lectura.

Corrección: `PREREQUISITES_SQL` añade `fn_go_no_go_027` (overload de 8 args) y `prerequisitesOk()` exige `(fn_go_no_go_025 || fn_go_no_go_027)` en vez de solo `fn_go_no_go_025`; el resto de columnas (tablas de 022/025, `psi_safe_jsonb`) sigue siendo estrictamente obligatorio — el fail-closed no se debilita, solo se amplía la señal aceptada para esa única función que 027 reemplaza.

Prueba dedicada (RED→GREEN) en `tests/tender-document-state-migrations-classify.test.mjs`: `prerequisitesOk` con solo el overload de 8 args presente debe dar `true`; con ninguno de los dos, `false` (fail-closed intacto).

### 5.4 Pruebas ejecutadas en esta sesión

| Prueba | Resultado |
|---|---|
| `tests/tender-document-state-migrations-classify.test.mjs` (RED confirmado antes de cada fix, luego GREEN) | PASS |
| `tests/tender-document-state-migrations-runner.test.mjs` (contrato del runner, sin cambios de contrato) | PASS |
| `tests/tender-document-migrations-026-027-anon-grants.test.mjs` (nueva, estática, RED→GREEN) | PASS |
| `tests/tender-document-state-migrations-pglite.integration.test.mjs` (apply→verify→rollback→reapply + idempotencia, PGlite real; fixture ajustado para incluir el rol `anon` que Supabase provee por defecto y que faltaba en la base de pruebas) | PASS |
| `git diff --check` | sin errores de espacio en blanco |

`scripts/check_backend_parity.mjs` y el `build` de TypeScript/Vite no aplican: el cambio no toca `server/index.js`, `api/[...path].js` ni código de frontend/build.

Ningún dato de negocio fue leído ni modificado; no se ejecutó `exec_sql` contra producción, ni `apply`/`rollback` reales, ni despliegue.
