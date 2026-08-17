# AGT-002 — ledger de gobernanza de migraciones (061–067)

**Fecha:** 2026-08-17 · **Alcance:** ledger documental. Esta fase no aplica, revierte ni modifica migraciones; registra la verificación productiva sanitaria ya ejecutada por Hermes durante el cierre autorizado.

## 1. Tabla resumen

| # | Migración | Rollback | Líneas (mig./rollback) | Qué gobierna |
|---|---|---|---|---|
| 061 | `061_agt002_company_evidence_registry.sql` | `061_agt002_company_evidence_registry_rollback.sql` | 135 / 17 | Registro canónico de evidencia empresarial (17 clases), sólo metadatos — nunca archivo, secreto o URL firmada. Tres dimensiones separadas: `existence_status`, `human_review_status`, `applicability_status`. |
| 062 | `062_siio_f2_security_coherence.sql` | **no existe** | 67 / — | Reemplaza el grant implícito por defecto de Supabase por grants explícitos mínimos en las 10 tablas SIIO de F2. Ver §3 — gap documentado, no fabricado. |
| 063 | `063_agt002_canonical_promotion.sql` | `063_agt002_canonical_promotion_rollback.sql` | 222 / 126 | Canonicidad transaccional: índice único parcial (máximo un run canónico completado por oportunidad), promoción serializada, `supersedes_run_id`. |
| 064 | `064_agt002_integral_governance_overrides.sql` | `064_agt002_integral_governance_overrides_rollback.sql` | 82 / 14 | Superficie de curación humana para `category_override` y `evidence_class_link`, indexada por `opportunity_id`. Sin RPC de escritura — es una tabla de curación humana, no escribible en runtime. |
| 065 | `065_tender_document_extraction_integrity.sql` | `065_tender_document_extraction_integrity_rollback.sql` | 365 / 17 | Integridad de extracción documental (fuera del alcance directo de V3, pero parte de la cadena de evidencia que V3 consume). |
| 066 | `066_agt002_manizales_integral_governance.sql` | `066_agt002_manizales_integral_governance_rollback.sql` | 70 / 19 | Las seis filas de gobernanza curada y aprobada específicas de Manizales SA-24-2026 (tres `category_override`, tres `evidence_class_link`), fail-closed e idempotente: aborta si el estado existente no es exactamente vacío o exactamente el set aprobado. |
| 067 | `067_agt002_integral_v3_persistence.sql` | `067_agt002_integral_v3_persistence_rollback.sql` | 201 / 155 | Extiende `psi_record_agt002_canonical_analysis_run` (RPC de 063) con el gate de payload integral V3 estructuralmente completo antes de cualquier lock o democión; preserva firma, idempotencia, lock por oportunidad, promoción canónica, `supersedes_run_id` y el gate de corpus publicado de 063. |

Todas las filas de la tabla fueron confirmadas por lectura directa de los archivos en este worktree (`wc -l`, lectura íntegra de 062, 066 y del rollback de 067) durante esta sesión de fase 9.

## 2. Estado "aplicado en producción" — separación de evidencia

La tabla de arriba describe el contenido versionado. Durante el cierre productivo autorizado, Hermes aplicó 067 por el RPC administrativo existente y verificó después su firma, gate V3 y grants; por tanto, **067 está mecánicamente confirmada como aplicada** al corte. Para 061–066 este documento no equipara la presencia del archivo con entrada en `supabase_migrations.schema_migrations`; sus efectos materiales pueden estar presentes sin ledger formal, tal como documentan cortes históricos de `CURRENT.md`.

Cualquier sesión futura con acceso real a `supabase_migrations.schema_migrations` debe reconciliar esta tabla contra el ledger real antes de tratar "existe el archivo" como equivalente a "está aplicado".

## 3. Migración 062 — por qué no existe rollback, y por qué no se fabricó uno en esta sesión

`062_siio_f2_security_coherence.sql` ejecuta, para las 10 tablas SIIO de F2: `alter table ... enable row level security` (ya estaba habilitado desde la 014; esta línea es idempotente, no un cambio de estado), luego `revoke all ... from public, anon, authenticated, service_role`, y finalmente `grant select` a `service_role` en las 10 tablas más `insert, update` (nunca `delete`) en 3 de ellas.

El estado *previo* a esta migración no era "sin grants" sino el **grant implícito por defecto de Postgres/Supabase** otorgado automáticamente a tablas nuevas en el momento de su creación por la migración `014`. Ese estado implícito:

- no está capturado en ningún archivo de este repositorio como un conjunto explícito y verificable de privilegios;
- no es necesariamente reproducible con un simple `grant all ... to public, anon, authenticated, service_role` — esa sería una aproximación razonable pero **no probada como bit-a-bit idéntica** al posture original, que depende de privilegios por defecto vigentes en el momento exacto de creación de cada tabla, no de un estado documentado.

El plan de fase 9 (tarea 6) exige crear el rollback de 062 **sólo si la inversión exacta puede probarse mecánicamente**. Esa prueba no existe en el repositorio y esta sesión no tuvo acceso a un snapshot verificado del estado de grants pre-062 (ni a Supabase productivo) para construirla y probarla. Por tanto, **no se creó ningún archivo de rollback para 062 en esta sesión** — inventar uno sin esa prueba sería exactamente el tipo de evidencia fabricada que el plan prohíbe explícitamente.

**Camino para cerrar este gap en el futuro:** una sesión con acceso de lectura a Supabase productivo (o a un dump/export verificado del estado de grants inmediatamente anterior a la aplicación de 062) podría construir un rollback exacto y probarlo contra un entorno de prueba antes de comprometerlo. Hasta entonces, el mecanismo de reversión disponible para 062 es el nivel 1 de `docs/runbooks/agt002-process-rollback.md` (kill switch de flag/aplicación), no un rollback de migración.

## 4. Relación con la gobernanza curada de Manizales

Las migraciones 064 y 066 son el mismo patrón en dos capas: 064 crea la superficie de curación genérica (sin datos, sin RPC de escritura runtime); 066 inserta las seis filas curadas y aprobadas específicas de Manizales, con procedencia completa (`rationale`, `source_reference`, `curated_by`, `curated_at`, `version`) y comportamiento fail-closed ante cualquier estado que no sea exactamente vacío o exactamente el set aprobado. Cualquier proceso nuevo repetiría 064 (ya genérica, no necesita nueva migración) y necesitaría su propia migración de datos curados, análoga a 066, con la misma disciplina de procedencia — ver `docs/architecture/agt002-process-package-convention.md` §3.

## 5. Qué este documento no afirma

- No afirma el estado real de aplicación en producción de las migraciones 061–066 (§2).
- No afirma que el rollback de 062 sea imposible de construir — afirma que no fue posible probarlo mecánicamente en esta sesión, y por qué.
- No modifica, aplica ni revierte ninguna migración.
