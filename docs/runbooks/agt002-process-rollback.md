# AGT-002 — runbook de rollback (proceso, flag, migración)

**Fecha:** 2026-08-17 · **Alcance:** documental. Describe procedimientos de reversión; no ejecuta ninguno. Ningún comando de este runbook fue corrido contra producción en esta sesión — esta sesión no tiene acceso de red a Vercel ni a Supabase.

## 1. Niveles de rollback, del más barato al más costoso

1. **Kill switch de flag** — apagar `AGT002_INTEGRAL_CONTRACT_V3` (o, cuando exista, el flag por proceso de la tarea 3) en el entorno afectado. No requiere migración ni deploy de código; es el mecanismo preferido ante cualquier duda operativa.
2. **Revert de aplicación** — revertir el merge/PR correspondiente sobre `main`, con pruebas frescas y nuevo deployment. No reescribir historia ni forzar ramas.
3. **Rollback de migración** — ejecutar el `.sql` de `supabase/rollbacks/` correspondiente, sólo cuando exista y esté probado, y sólo con autorización humana explícita.
4. **Reconciliación de gobernanza curada** — remover o corregir filas de `psi_agt002_integral_governance_overrides` para un proceso, siempre con autorización humana y sin sobreescribir gobernanza vigente por accidente (patrón fail-closed de la migración `066`: aborta si el estado existente no es exactamente vacío o exactamente el set aprobado).

## 2. Rollback de migración — estado real por versión (ledger completo en `docs/migrations/agt002-process-governance-ledger.md`)

| Migración | Rollback | Qué revierte |
|---|---|---|
| `061_agt002_company_evidence_registry.sql` | `061_agt002_company_evidence_registry_rollback.sql` | existe |
| `062_siio_f2_security_coherence.sql` | **no existe** | ver §3 — gap documentado, no fabricado en esta sesión |
| `063_agt002_canonical_promotion.sql` | `063_agt002_canonical_promotion_rollback.sql` | existe |
| `064_agt002_integral_governance_overrides.sql` | `064_agt002_integral_governance_overrides_rollback.sql` | existe |
| `065_tender_document_extraction_integrity.sql` | `065_tender_document_extraction_integrity_rollback.sql` | existe |
| `066_agt002_manizales_integral_governance.sql` | `066_agt002_manizales_integral_governance_rollback.sql` | existe |
| `067_agt002_integral_v3_persistence.sql` | `067_agt002_integral_v3_persistence_rollback.sql` | existe — restaura el cuerpo exacto de la función `psi_record_agt002_canonical_analysis_run` de la migración 063 (sin el gate de payload integral V3 que añade 067), sin tocar filas, el índice único de 063 ni `supersedes_run_id` |

**Verificado en esta sesión:** cada archivo listado como "existe" fue leído o confirmado por `ls`/`wc -l` en este worktree. El rollback de 067 fue leído íntegro (155 líneas) y su descripción arriba corresponde exactamente a su comentario de cabecera y cuerpo SQL.

## 2.1 Anexo posterior al corte — migraciones que no cambian el esquema (2026-08-30)

La tabla de §2 se cerró en el corte 061–067 y no se actualiza aquí. Este anexo existe por una razón concreta: `077` **no crea, altera ni elimina ningún objeto de esquema ni ninguna fila**, así que no es visible en un diff de esquema, en `information_schema` ni en una inspección de `pg_proc`/`pg_class`. Su efecto completo son dos entradas de GUC sobre un rol en `pg_db_role_setting`. Sin este anexo, un operador que compare esquemas no vería que existe.

| Migración | Rollback | Qué revierte |
|---|---|---|
| `077_agt002_canonical_persistence_statement_timeout.sql` | `077_agt002_canonical_persistence_statement_timeout_rollback.sql` | existe — devuelve `service_role` al comportamiento EFECTIVO previo (`statement_timeout = '8s'`, `lock_timeout = '8s'`) creando entradas explícitas donde antes no había ninguna. No toca esquema, filas, grants, políticas RLS ni el cuerpo de `psi_record_agt002_canonical_analysis_run` |

**Línea base real, previa a 077:** `service_role` no tiene ninguna entrada explícita en `pg_db_role_setting`/`rolconfig`; su presupuesto de statement efectivo de 8s hoy lo aplica PostgREST por herencia, no un valor fijado en el catálogo. `anon` tiene 3s explícitos y `authenticated` tiene 8s explícitos — ninguno de los dos cambia con 077. El rollback de 077 restaura el comportamiento efectivo 8s/8s para `service_role`, **no** la postura exacta del catálogo (que era "sin entradas"), y puede sobreescribir silenciosamente un cambio de `service_role` hecho por fuera de este par migración/rollback entre el apply y el rollback. Un operador debe inspeccionar la fila actual de `service_role` en `pg_db_role_setting` antes de ejecutar el rollback.

Cuatro advertencias operativas propias de una migración de ajustes de rol:

1. **Requiere `notify pgrst, 'reload config'`** — tanto al aplicar como al revertir. PostgREST cachea los ajustes por rol junto con su configuración; sin la notificación la instancia en ejecución sigue aplicando el presupuesto anterior hasta reiniciarse. Ambos archivos la emiten al final de su transacción.
2. **Revertir 077 reintroduce el incidente**, no lo mitiga: la persistencia canónica de una carga V3 de ~6 MB vuelve a fallar con SQLSTATE 57014 (`persistence_statement_timeout`) en ambos intentos, exactamente como se observó el 2026-08-30. Úsese sólo para deshacer 077.
3. **`lock_timeout` se queda en 8s en ambas direcciones.** El presupuesto de statement ampliado sólo es seguro porque una espera real de lock sigue muriendo en 8s con 55P03 en vez de colgarse 30s. `tests/agt002-canonical-persistence-statement-timeout-migration-static.test.mjs` falla si alguna de las dos direcciones lo sube.
4. **El rollback no es una reversión bit a bit del catálogo** — ver "línea base real" arriba. Inspeccione `pg_db_role_setting` antes de revertir.

Ambos archivos verifican su propio resultado dentro de la misma transacción contra `pg_db_role_setting` y abortan (fail-closed) si el par resultante no es exactamente el esperado, o si existe un ajuste `in database` de `statement_timeout`/`lock_timeout` sobre `service_role` que anularía el ajuste a nivel de rol — un ajuste `in database` de otro GUC no relacionado no bloquea ni la migración ni el rollback.

**Prerrequisito de privilegios:** `alter role service_role set ...` exige aplicar la migración con un rol que pueda alterar `service_role` (en Supabase, `postgres`, que tiene `ADMIN OPTION` sobre él — el mismo camino que usa el RPC administrativo `exec_sql`). Si el rol aplicador no lo tiene, la migración falla en su primera sentencia y no commitea nada: es un fallo ruidoso, no un cambio parcial.

## 3. Migración 062 — por qué no se creó un rollback en esta sesión

`062_siio_f2_security_coherence.sql` reemplaza el grant implícito por defecto de Supabase (`ALL` a `anon`/`authenticated`/`service_role` sobre tablas nuevas) por grants explícitos mínimos: `REVOKE ALL` seguido de `GRANT SELECT` (y `INSERT`/`UPDATE` en 3 tablas) sólo a `service_role`. Un rollback exacto requeriría reproducir bit a bit el estado de grants implícitos previo a la migración — no un simple `GRANT ALL`, que sería una aproximación no probada, no necesariamente idéntica al posture original (depende de privilegios por defecto de Postgres/Supabase en el momento de creación de cada tabla en la migración `014`, no de un estado capturado explícitamente en ningún lugar del repositorio).

**Decisión de esta sesión:** no fabricar un rollback aproximado. El plan de fase 9 (tarea 6) exige crear el rollback de 062 "sólo si la inversión exacta puede probarse mecánicamente"; esa prueba no existe hoy en el repositorio ni fue posible construirla desde este sandbox sin acceso a un snapshot verificado del estado de grants pre-062. El gap queda documentado aquí y en el ledger; cerrarlo requiere una sesión con acceso de lectura a Supabase productivo (o a un dump del estado pre-062) para construir y probar la reversión exacta antes de comprometerla como `.sql`.

## 4. Procedimiento de rollback de proceso (cuando exista el paquete reusable de la tarea 3)

1. Apagar el flag específico del proceso afectado (nivel 1 — preferido).
2. Si el paquete de proceso tiene un defecto estructural, no editar la gobernanza curada en caliente: revertir el paquete a su última versión aprobada y re-ejecutar el gate de onboarding (`docs/runbooks/agt002-process-onboarding-gate.md`) antes de reactivar.
3. Si la gobernanza curada necesita corrección, seguir el mismo patrón fail-closed que `066`: la corrección debe ser un nuevo registro versionado (`version` incremental), nunca una sobreescritura silenciosa de filas `current=true` existentes.
4. Nunca usar un rollback de migración para "arreglar" una gobernanza mal curada — el rollback de `066` elimina exactamente las seis filas de Manizales, no reemplaza gobernanza por otra distinta.

## 5. Qué este runbook no autoriza

- No autoriza ejecutar ningún rollback en producción — cualquier ejecución real requiere autorización humana separada y verificación previa fuera de este sandbox.
- No autoriza fabricar el rollback de 062 sin la prueba mecánica exacta descrita en §3.
- No autoriza usar el kill switch de flag como sustituto de investigar la causa raíz de un incidente — es la mitigación inmediata, no el cierre.
