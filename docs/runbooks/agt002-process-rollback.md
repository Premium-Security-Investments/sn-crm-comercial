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
