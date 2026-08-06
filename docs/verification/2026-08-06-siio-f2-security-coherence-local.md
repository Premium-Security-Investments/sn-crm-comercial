# Verificación local — SIIO F2 security coherence

Timestamp UTC: 2026-08-06T01:25:42Z

> Corrección post-merge: esta evidencia conserva abajo el nombre histórico
> `058_siio_f2_security_coherence.sql` tal como fue verificado originalmente.
> Antes del release, el mismo SQL —sin cambios de contenido— fue renumerado a
> `062_siio_f2_security_coherence.sql` porque `main` ya contenía las migraciones
> `058`–`061`. La prueba `migration-number-uniqueness.test.mjs` evita reincidencias.

Branch: `design/siio-f2-operational-closure`
HEAD verificado: `2926969e64be7a53a91ed93eb7e5fab368af67f2`

## Alcance (commits verificados)

| SHA | Asunto |
| --- | --- |
| `a47910e` | docs: define SIIO F2 security coherence design |
| `35ebb3b` | docs: plan SIIO F2 security coherence implementation |
| `3695f8d` | security: restrict direct SIIO table access |
| `94a626e` | fix: align Director SIIO visibility with backend scope |
| `9243afd` | fix: use canonical presented status for SIIO Board |
| `5fbe930` | security: filter restricted SIIO payroll rows |
| `79c1190` | fix: fail closed on missing SIIO foundation tables |
| `2926969` | test: keep AGT002 fixture outside F2 scope |

Esta ejecución re-corre el gate completo desde cero después de que `2926969` restauró el fixture `tests/agt002-human-authority-dynamic.test.mjs` al estado exacto de `origin/main`, corrigiendo el hallazgo de scope detectado en la corrida anterior (2026-08-06, sesión previa).

## Comandos ejecutados y resultados

### 1. Tests focales (concurrencia 1)

```
node --test --test-concurrency=1 \
  tests/siio-f2-security-coherence-pglite.integration.test.mjs \
  tests/siio-area-scope-blocker.test.mjs \
  tests/siio-manager-navigation-static.test.mjs \
  tests/siio-manager-navigation-selectors.test.mjs \
  tests/siio-board-readonly-ui.test.mjs \
  tests/siio-main-integration-static.test.mjs \
  tests/siio-migration-source-dependencies.test.mjs
```

Resultado: `# tests 7 / # pass 7 / # fail 0 / # cancelled 0 / # skipped 0` — duración total 15921.6 ms.

### 2. Suite completa SIIO (concurrencia 1)

```
node --test --test-concurrency=1 tests/siio*.test.mjs
```

Resultado: `# tests 11 / # pass 11 / # fail 0 / # cancelled 0 / # skipped 0` — duración total 16269.1 ms. Archivos cubiertos: `siio-agent-catalog-static`, `siio-area-scope-blocker`, `siio-board-draft-behavior`, `siio-board-readonly-ui`, `siio-executive-dashboard-static`, `siio-f2-security-coherence-pglite.integration`, `siio-main-integration-static`, `siio-manager-filter-semantics`, `siio-manager-navigation-selectors`, `siio-manager-navigation-static`, `siio-migration-source-dependencies`.

### 3. Backend parity

```
npm run check:backend-parity
```

Resultado: `backend parity OK`.

### 4. Build

```
npm run build
```

Resultado: `tsc` y `vite build` exitosos. Salida:

```
dist/index.html                   0.51 kB │ gzip:   0.33 kB
dist/assets/index-DBRcKbMZ.css  157.60 kB │ gzip:  26.85 kB
dist/assets/index-CmYgFhl2.js   745.38 kB │ gzip: 198.25 kB
✓ built in 373ms
```

Warning presente (no bloqueante, preexistente): `(!) Some chunks are larger than 500 kB after minification` sobre `dist/assets/index-CmYgFhl2.js`.

### 5. Diff y alcance final contra `origin/main`

`origin/main` usado tal como estaba resuelto localmente (sin `git fetch`, sin operaciones de red).

```
git diff origin/main...HEAD --check
```
Sin salida — sin conflictos de espacio en blanco.

```
git diff origin/main...HEAD --stat
```
```
 access-control.js                                  |   4 +-
 api/[...path].js                                   |  62 +-
 ...io-f2-security-coherence-implementation-plan.md | 663 +++++++++++++++++++++
 ...2026-08-04-siio-f2-security-coherence-design.md | 327 ++++++++++
 module-access.js                                   |   2 +-
 server/index.js                                    |  62 +-
 .../migrations/058_siio_f2_security_coherence.sql  |  67 +++
 tests/access-control.test.mjs                      |   7 +-
 tests/module-access.test.mjs                       |   3 +-
 tests/siio-area-scope-blocker.test.mjs             |  62 +-
 ...-security-coherence-pglite.integration.test.mjs | 175 ++++++
 tests/task-4-review-regressions.test.mjs           |   7 +-
 12 files changed, 1382 insertions(+), 59 deletions(-)
```

```
git diff origin/main...HEAD --name-only
```
```
access-control.js
api/[...path].js
docs/superpowers/plans/2026-08-04-siio-f2-security-coherence-implementation-plan.md
docs/superpowers/specs/2026-08-04-siio-f2-security-coherence-design.md
module-access.js
server/index.js
supabase/migrations/058_siio_f2_security_coherence.sql
tests/access-control.test.mjs
tests/module-access.test.mjs
tests/siio-area-scope-blocker.test.mjs
tests/siio-f2-security-coherence-pglite.integration.test.mjs
tests/task-4-review-regressions.test.mjs
```

**Alcance verificado**: 12 archivos — diseño/plan (2), módulo/access (`access-control.js`, `module-access.js`), backends (`api/[...path].js`, `server/index.js`), una única migración nueva (`058_siio_f2_security_coherence.sql`), y tests previstos/colaterales de `access-control.js`/`module-access.js` y del dominio SIIO. **Ningún archivo AGT-002/AGT-003/Mesa de producto figura en el diff.** `tests/agt002-human-authority-dynamic.test.mjs` fue verificado explícitamente y su diff contra `origin/main` es vacío (fixture restaurado por `2926969`). No se detectan referencias residuales a `publication_status` ni `'published'` en `access-control.js`, `server/index.js`, `api/[...path].js` ni `tests/siio-board-readonly-ui.test.mjs`.

## Riesgos residuales

- **Bypass de RLS por `service_role`**: los endpoints backend usan `service_role`, que ignora RLS; la coherencia de seguridad depende de la lógica de filtrado en aplicación (`access-control.js`, `server/index.js`), no de una barrera a nivel de base de datos.
- **Sin mecanismo de excepción para filas restringidas**: el filtrado de filas de nómina restringidas (`5fbe930`) no contempla un flujo de excepción auditable; una necesidad legítima de acceso puntual requeriría cambio de código, no configuración.
- **Endpoints de escritura sin UI**: la migración 058 y los backends asociados exponen contratos de escritura que aún no tienen interfaz de usuario correspondiente; el alcance actual es de solo lectura desde el frontend.
- **Junta sin ciclo de publicación**: el contrato de Board para Junta es de solo lectura sobre estado `presentado`; no existe todavía un ciclo de publicación/aprobación gestionado end-to-end (borrador → revisión → aprobado → presentado) con UI para gerencia.

## Declaración

Esta verificación es exclusivamente local, sobre el worktree `/root/worktrees/siio-f2-operational-closure`. No se realizó `git fetch`, `git push`, deploy, ni aplicación de migración remota o local contra una base de datos real. `origin/main` se usó tal como estaba resuelto en el repositorio local al momento de la corrida. No se modificó código de producto, tests, ni migraciones como parte de esta tarea — únicamente se leyó el estado del repositorio y se generó este documento de evidencia.
