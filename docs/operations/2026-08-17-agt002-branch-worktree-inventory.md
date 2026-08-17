# AGT-002 fase 9 — inventario de worktrees y ramas, 2026-08-17

**Alcance:** inventario, clasificación y resultado de limpieza. La eliminación se ejecutó después de integrar/validar la Fase 9 y únicamente sobre candidatos fusionados y limpios.

## 0. Nota sobre la fuente de datos

Hermes generó `/tmp/agt002-phase9-worktree-inventory.json` recorriendo cada worktree con `git status --porcelain` y comprobando `git merge-base --is-ancestor <rama> main`. Antes de crear los dos worktrees hijos de Fase 9 registró 41 worktrees: 7 candidatos fusionados/limpios, 2 fusionados con cambios, 27 no fusionados limpios, 4 no fusionados con cambios y el worktree actual. Después de crear `agt002-phase9-docs` y `agt002-phase9-architecture`, el recuento fresco es **43**: 7 candidatos, 2 fusionados con cambios, 27 no fusionados limpios, 6 no fusionados con cambios y el worktree de consolidación.

`main`/`origin/main` en esta sesión: `960a96702e869531aad94545c137e1b3fe28c0b0` (`git rev-parse main origin/main`, ambos idénticos). Todas las comprobaciones de "fusionado" de abajo son `git merge-base --is-ancestor <sha> main`, ejecutadas una por una en esta sesión el 2026-08-17.

## 1. Worktree actual y hermanos de la misma fase 9

| Worktree | Rama | HEAD | Fusionado a `main` |
|---|---|---|---|
| `/root/worktrees/agt002-phase9-docs` | `chore/agt002-phase9-docs` | `3011ad4` | No — es esta misma sesión, un commit por delante de `main` (el plan de fase 9); este documento se añade sobre esa punta. |
| `/root/worktrees/agt002-phase9-architecture` | `feat/agt002-phase9-architecture` | `3011ad4` | No — trabajo hermano en paralelo, misma punta de partida. **No tocar.** |
| `/root/worktrees/agt002-phase9-consolidation` | `chore/agt002-phase9-consolidation` | `3011ad4` | No — trabajo hermano en paralelo, misma punta de partida. **No tocar.** |

## 2. Worktree explícitamente protegido por instrucción del plan

| Worktree | Rama | HEAD | Fusionado | Nota |
|---|---|---|---|---|
| `/root/worktrees/siio-e6-scheduler-fix` | `main` | `960a967` | Sí (es la punta de `main`) | **Preservar explícitamente** — instrucción directa del plan de fase 9. Tiene la rama `main` completa como working copy; no es candidato a ningún tipo de limpieza. |

## 3. Detached HEAD — todos ambiguos, todos preservados

| Worktree | HEAD | Fusionado | Nota |
|---|---|---|---|
| `/root/worktrees/agt002-v3-invariant-diagnostic-runtime` | `92d4114` (detached) | Sí | Mismo commit que la rama `fix/agt002-v3-invariant-subcodes-20260814` (§4) — ambigüedad de dos checkouts del mismo commit, uno con rama y otro sin ella. |
| `/root/worktrees/siio-agt002-operationalization` | `a0fc907` (detached) | Sí | Sin rama asociada visible en `git worktree list`. |
| `/root/worktrees/siio-vigia-identity-preview` | `4bd96c6` (detached) | No | Mismo commit que la rama `fix/agt002-canonical-current` en `siio-vigia-phase1-gpt` (§5) — ambigüedad de dos worktrees en el mismo commit, uno con rama y otro sin ella. |
| `/tmp/tmp.Tk3vphg3V6` | `8ab8379` (detached) | No | — |
| `/tmp/tmp.aK8TRQtWc5` | `8ab8379` (detached) | No | Mismo commit que el worktree anterior — dos checkouts detached del mismo SHA. |

Por instrucción del plan ("todo detached ambiguo" se preserva), ninguno de estos cinco se toca, esté o no fusionado.

## 4. Ramas fusionadas a `main` — limpieza no ejecutada aún

Estos worktrees tienen HEAD como ancestro de `main`. El inventario mecánico verificó además su estado local. Los dos marcados `dirty` se preservan; los seis marcados `clean` son candidatos de limpieza después de integrar y validar Fase 9.

| Worktree | Rama | HEAD | Estado | Acción segura |
|---|---|---|---|---|
| `/root/worktrees/agt002-canonical-observability` | `fix/agt002-v3-invariant-subcodes-20260814` | `92d4114` | **dirty (1 entrada)** | Preservar |
| `/root/worktrees/agt002-v3-governed-metadata-prod` | `feat/agt002-manizales-v3-complete-pilot` | `0d4e865` | clean | Candidato después de QA |
| `/root/worktrees/siio-f2-release` | `release/siio-f2-prod-20260806` | `e0c5a2f` | clean | Candidato después de QA |
| `/root/worktrees/siio-origin-main-baseline-agt002` | `qa/origin-main-baseline-agt002-20260806` | `39bef1d` | clean | Candidato después de QA |
| `/root/worktrees/siio-vigia-v3-foundations` | `docs/agt002-v3-canary-blocked-20260814` | `afbf522` | clean | Candidato después de QA |
| `/root/worktrees/sn-crm-main-deploy` | `fix/radar-go-timeline` | `701822d` | clean | Candidato después de QA |
| `/tmp/agt002-post-bridge-diagnostic` | `docs/agt002-post-bridge-diagnostic-close-20260814` | `b2196f4` | **dirty (1 entrada)** | Preservar |
| `/tmp/siio-deploy-0536746-TTvTxS` | `deploy/agt002-0536746-20260814` | `0536746` | clean | Candidato después de QA |

**Nota especial — `agt002-v3-governed-metadata-prod`:** aunque su HEAD está fusionado, su rama es la fuente directa del merge productivo `960a967` documentado en `docs/evidence/2026-08-17-agt002-v3-production-closeout.md`. Cualquier limpieza futura debe tratarla con el mismo cuidado que cualquier rama fusionada — no hay razón para preservarla más que a las demás de esta sección, pero tampoco menos.

## 5. Ramas no fusionadas a `main` (mecánicamente confirmado) — preservar

| Worktree | Rama | HEAD |
|---|---|---|
| `/root/psi-comercial/plataforma-ventas/app` | `docs/tender-opportunities-navigation-design` | `5339309` |
| `/root/psi-comercial/plataforma-ventas/app-integrate-siio-gerencial` | `feature/integrate-siio-gerencial` | `f36496f` |
| `/root/psi-comercial/plataforma-ventas/app-radar-converted` | `fix/siio-manager-filter-semantics` | `f828c55` |
| `/root/psi-comercial/plataforma-ventas/app-sensitive-tender-confirmations` | `feature/tender-sensitive-confirmations` | `6e246f3` |
| `/root/psi-comercial/plataforma-ventas/app-siio-main-integration` | `feature/siio-main-integration` | `febdfe1` |
| `/root/psi-comercial/plataforma-ventas/app-siio-nav-permissions` | `feature/siio-nav-permissions` | `4b58613` |
| `/root/psi-comercial/plataforma-ventas/app-siio-official-fronts` | `feature/siio-official-fronts` | `e419c7f` |
| `/root/psi-comercial/plataforma-ventas/app-siio-sensitive-confirmations` | `feature/siio-sensitive-confirmations` | `c090f7a` |
| `/root/siio-phase3a-p3b1` | `feat/phase3a-p3b1-delegation-verifier` | `e0e66aa` |
| `/root/siio-phase4-p4` | `feat/phase4-p4-agt003-readonly-foundation` | `ffc4f5f` |
| `/root/worktrees/agt002-v3-governed-metadata-fix` | `fix/agt002-v3-governed-metadata-20260815` | `7f47d2d` |
| `/root/worktrees/agt002-v3-governed-units-fix` | `fix/agt002-v3-governed-units-20260815` | `8b5f2a3` |
| `/root/worktrees/agt002-v3-next-invariant` | `fix/agt002-v3-next-invariant-20260815` | `ce9e2a0` |
| `/root/worktrees/siio-agt002-e4-idempotency` | `fix/agt002-e4-versioned-idempotency` | `935f763` |
| `/root/worktrees/siio-agt002-e4-retrieval-adapter` | `fix/agt002-e4-retrieval-adapter` | `189093a` |
| `/root/worktrees/siio-agt002-v3-preview-prod` | `release/agt002-v3-preview-prod-20260806` | `71dcdce` |
| `/root/worktrees/siio-agt003-vigia-functional-design` | `docs/agt003-vigia-functional-design` | `aec0af7` |
| `/root/worktrees/siio-bucaramanga-document-recovery` | `fix/bucaramanga-document-recovery` | `05f9d1d` |
| `/root/worktrees/siio-commercial-24h-operational-cut` | `feat/agt002-hetzner-runtime-bridge` | `582c53b` |
| `/root/worktrees/siio-f2-important-fixes` | `fix/siio-f2-important-fixes` | `6ee4172` |
| `/root/worktrees/siio-f2-operational-closure` | `design/siio-f2-operational-closure` | `9b33503` |
| `/root/worktrees/siio-licitaciones-ia-mvp` | `feat/licitaciones-deep-analysis` | `63fd0d2` |
| `/root/worktrees/siio-vigia-identity-current` | `docs/vigia-identity-production-20260806` | `8884ddd` |
| `/root/worktrees/siio-vigia-identity-release` | `release/vigia-identities-20260806` | `afdb92d` |
| `/root/worktrees/siio-vigia-phase1-gpt` | `fix/agt002-canonical-current` | `4bd96c6` |
| `/root/worktrees/sn-crm-go-timeline` | `design/agt002-dossier-workspace` | `df54194` |

Todos preservados por instrucción directa del plan ("cualquier no fusionado").

## 6. Resumen de clasificación

| Categoría | Cantidad | Acción tomada |
|---|---|---|
| Actual + hermanos fase 9 (§1) | 3 | Ninguna — trabajo activo |
| Protegido por instrucción explícita (§2) | 1 | Ninguna — `siio-e6-scheduler-fix` preservado |
| Detached ambiguo (§3) | 5 | Ninguna — preservado por regla general |
| Fusionado limpio, no operativo (§4) | 6 | Eliminados después de QA; ver §8 |
| Fusionado con cambios locales (§4) | 2 | Preservar |
| No fusionado (§5) | 25 | Ninguna — preservado por regla general |
| **Total antes de limpieza** | **43** | — |
| **Total después de limpieza** | **35** | 8 eliminados; remoto intacto |

## 7. Qué falta para poder ejecutar limpieza real en el futuro

1. Integrar los bloques documental y runtime de Fase 9 y completar QA.
2. Para cada uno de los seis candidatos limpios, volver a confirmar inmediatamente antes de eliminar: `git status --porcelain` vacío y `git merge-base --is-ancestor <sha> main` exitoso.
3. Eliminar el worktree, volver a comprobar la rama y sólo entonces borrar la rama local. Las ramas remotas se preservan en esta fase salvo decisión explícita separada.

## 8. Limpieza ejecutada después del gate final

Antes de cada eliminación se volvió a comprobar `git status --porcelain` vacío, rama esperada y `git merge-base --is-ancestor <sha> main`. Se eliminaron estos seis worktrees y sus ramas **locales**:

| Worktree eliminado | Rama local eliminada | HEAD absorbido |
|---|---|---|
| `/root/worktrees/agt002-v3-governed-metadata-prod` | `feat/agt002-manizales-v3-complete-pilot` | `0d4e865` |
| `/root/worktrees/siio-f2-release` | `release/siio-f2-prod-20260806` | `e0c5a2f` |
| `/root/worktrees/siio-origin-main-baseline-agt002` | `qa/origin-main-baseline-agt002-20260806` | `39bef1d` |
| `/root/worktrees/siio-vigia-v3-foundations` | `docs/agt002-v3-canary-blocked-20260814` | `afbf522` |
| `/root/worktrees/sn-crm-main-deploy` | `fix/radar-go-timeline` | `701822d` |
| `/tmp/siio-deploy-0536746-TTvTxS` | `deploy/agt002-0536746-20260814` | `0536746` |

Después de integrar mediante cherry-pick los bloques de documentación y arquitectura, `git cherry` reportó equivalencia de parche (`-`) para `f7af989`, `c366d23`, `d63b587` y `54cec05`; ambos worktrees auxiliares estaban limpios. Por esa evidencia se eliminaron también:

| Worktree auxiliar eliminado | Rama local eliminada | Evidencia de absorción |
|---|---|---|
| `/root/worktrees/agt002-phase9-docs` | `chore/agt002-phase9-docs` | `git cherry` marcó `f7af989` como equivalente |
| `/root/worktrees/agt002-phase9-architecture` | `feat/agt002-phase9-architecture` | `git cherry` marcó sus tres commits como equivalentes |

`git worktree prune` se ejecutó después. El inventario mecánico terminal reportó 35 worktrees: `candidate_remove=1` (exclusivamente el worktree `main`, protegido), `merged_but_dirty=2` (preservados), `unmerged_clean=27`, `unmerged_dirty=4`, `keep_current=1`. No se eliminó ninguna rama remota, ningún detached y ningún worktree con cambios.
