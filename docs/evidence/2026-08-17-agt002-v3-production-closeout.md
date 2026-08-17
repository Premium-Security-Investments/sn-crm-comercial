# AGT-002 — cierre productivo V3 (piloto gobernado Manizales), 2026-08-17

**Autor:** Hermes, Fase 9 abierta desde `agt002-phase9-consolidation`; consolidación documental en `agt002-phase9-docs`.
**Alcance:** cierre de evidencia y documentación. Cero escrituras a datos de negocio durante este cierre; las verificaciones remotas fueron sanitarias/read-only salvo la migración y el deploy ya autorizados y ejecutados en el cierre productivo anterior.

## 1. Por qué existe este documento

El plan `docs/plans/2026-08-17-agt002-phase9-consolidation.md` exige registrar la evidencia mecánica del corte productivo sin convertir mensajes humanos en sustituto de herramientas. Este documento distingue las verificaciones locales de las remotas y registra qué no fue re-ejecutado.

## 2. Evidencia mecánica (verificada en esta sesión, reproducible)

| Afirmación | Comando/lectura | Resultado en esta sesión |
|---|---|---|
| `main`/`origin/main` apuntan al mismo commit | `git rev-parse main origin/main HEAD` | ambos `960a96702e869531aad94545c137e1b3fe28c0b0`; `HEAD` de esta rama es `3011ad48c2c6da183cd639ecfba9882952671e87`, un commit por delante (el plan de fase 9) |
| `960a967` es el merge del piloto Manizales | `git log -1 --format='%H %P' 960a967` | padres `837b5742055be7a56a9097c203c75f7393082fb7` (punta previa de `main`) y `0d4e865189a6c95d7a53eef6970444c685fab306` (punta de `feat/agt002-manizales-v3-complete-pilot`) |
| El merge trae la migración 067 y su rollback | `git show --stat 960a967` | `supabase/migrations/067_agt002_integral_v3_persistence.sql` (201 líneas) y `supabase/rollbacks/067_agt002_integral_v3_persistence_rollback.sql` (155 líneas) están en el diff del merge |
| El rollback de 067 es una inversión real, no un stub | lectura íntegra de `067_agt002_integral_v3_persistence_rollback.sql` | recrea `psi_record_agt002_canonical_analysis_run` con el cuerpo exacto de 063 (sin el gate de payload integral V3), toca únicamente esa función, no filas ni el índice único de 063 |
| El proceso V3 habilitado está cerrado por código a Manizales | lectura íntegra de `agt002-manizales-manifest-source.js` | `selectAgt002ManizalesManifestSource` retorna `null` si `integralContractV3 !== true`; si es `true` pero `opportunityId`/`process` no coinciden con el piloto, lanza `AGT002_MANIZALES_PILOT_SCOPE_MISMATCH` antes de tocar el proveedor |
| El nombre exacto del flag | `grep AGT002_INTEGRAL_CONTRACT_V3 agt002-analysis-config.js` | literal `AGT002_INTEGRAL_CONTRACT_V3` (sin sufijo `_ENABLED`); depende de `AGT002_CANONICAL_ONLY`, `AGT002_CONTEXT_V2`, `AGT002_DOCUMENT_RETRIEVAL` |
| `schema_version` y contract id del piloto | `agt002-preview-contract.js`, `agt002-integral-analysis-v3.js` | `AGT002_INTEGRAL_ENVELOPE_SCHEMA_VERSION = '3.0.0'`; el identificador `agt002-integral-analysis-v3` aparece en 7 módulos de runtime, no sólo en documentación |
| Migración 062 no tiene rollback versionado | `ls supabase/rollbacks/` | no existe `062_*_rollback.sql`; ver `docs/migrations/agt002-process-governance-ledger.md` para el porqué y por qué no se fabricó uno en esta sesión |
| Suite/gates del piloto | cita de `docs/verification/2026-08-15-agt002-manizales-v3-pilot.md`, incorporado en el mismo merge `960a967` | **410/410** AGT-002 focal tras agregar 067; suite completa 655/660 (3 fallos baseline pre-existentes, 2 idénticos en `HEAD` limpio, ninguno introducido por el piloto); backend parity, build, `git diff --check`, `npm audit --audit-level=high` (0 vulnerabilidades) y revisión independiente Sonnet (sin P0/P1) — **esta sesión no re-ejecutó esos comandos; los cita del documento ya fusionado a `main`, que es evidencia mecánica de su propia sesión de trabajo** |

## 3. Evidencia mecánica remota del cierre productivo

| Afirmación | Verificación sanitaria ejecutada | Resultado |
|---|---|---|
| Deployment productivo | `vercel inspect dpl_6jMm4YBn1sAiWBM1T5YoYzTeFv7t` y alias del proyecto | target `production`, estado `Ready`, alias `https://seguridad-nacional-crm.vercel.app` |
| Frontend/API vivos | navegador sobre alias y `/api/tender-opportunities` sin sesión | login real cargó; API devolvió JSON protegido `{"error":"Debe iniciar sesión."}` |
| Flag consumido por runtime | `vercel env pull` + parser que imprimió sólo presencia/booleano | `AGT002_INTEGRAL_CONTRACT_V3`: presente y `true`; `AGT002_INTEGRAL_CONTRACT_V3_ENABLED`: ausente |
| Migración 067 activa | precheck/apply/postcheck sanitizado vía RPC productivo autorizado | firma y gate V3 presentes; permisos restringidos a `service_role` |
| Canonical Manizales | consulta de metadatos booleanos/contractuales, sin payload | oportunidad y vínculo presentes; `schema_version=3.0.0`; contrato `agt002-integral-analysis-v3` |

Los archivos temporales de entorno y scripts sanitarios se eliminaron después de las comprobaciones. Una sesión futura debe repetir estas verificaciones porque el estado remoto puede cambiar; este documento registra el corte, no una garantía perpetua.

## 4. Qué este documento no afirma

- No afirma que el canary real fue re-ejecutado en esta sesión (no lo fue; se cita el resultado ya documentado del piloto).
- No afirma cumplimiento, GO/NO-GO, ni ninguna conclusión sustantiva sobre Manizales SA-24-2026 — eso sigue siendo exclusivamente humano (`docs/architecture/agt002-human-review-policy.md`).
- No declara cerrado el gap de la migración 062 (ver §2 y el ledger de migraciones); no inventa una reversión que no puede probarse.
- No autoriza habilitar V3 para ningún proceso distinto de Manizales; el gate de onboarding (`docs/runbooks/agt002-process-onboarding-gate.md`) sigue siendo un requisito separado y no ejecutado para ningún otro proceso.
