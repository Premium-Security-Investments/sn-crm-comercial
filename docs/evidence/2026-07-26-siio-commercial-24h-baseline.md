# SIIO Comercial — baseline del corte operativo de 24 horas

**Fecha UTC:** 2026-07-26T22:22:18+00:00  
**Rama:** `feat/siio-commercial-24h-operational-cut`  
**Base productiva:** `ea6117bd2a6d75f1c21fb5938a79d1134fe49b24` (`origin/main`)  
**Commits documentales previos:** `746c464`, `3da0eb1`  
**Modalidad:** local; sin push, deploy, migración remota, secretos, datos reales ni consumo OpenAI.

## Preparación

```text
npm install
added 144 packages
0 vulnerabilities
```

El worktree fue confirmado como linked worktree aislado y se creó la rama de implementación sobre los dos commits documentales.

## Resultado automatizado

| Verificación | Resultado |
|---|---:|
| Archivos `tests/*.test.mjs` | 131 |
| PASS | 129 |
| FAIL | 2 |
| `npx tsc --noEmit` | PASS |
| `npm run check:backend-parity` | PASS |
| `npm run build` | PASS |
| `git diff --check` | PASS |
| Cambios de producto durante baseline | 0 |

## Fallas reproducidas

1. `tests/tender-analysis-go-gate-pglite.integration.test.mjs`
2. `tests/tender-document-versions-pglite.integration.test.mjs`

Ambas fallan al aplicar las migraciones endurecidas 026/027 con:

```text
error: role "anon" does not exist
PostgreSQL code: 42704
```

## Clasificación

**Preexisting en `origin/main`, no introducidas por este corte.**

La rama sólo contiene documentación; no se había modificado código, SQL ni fixtures al ejecutar el baseline. La causa es que esos dos fixtures PGlite no crean el rol Supabase `anon`, mientras las migraciones 026/027 vigentes correctamente ejecutan `revoke ... from anon` como parte del hardening aplicado en producción.

La migración no debe relajarse. La corrección requerida está en los fixtures de prueba: deben reproducir los roles que Supabase aporta en el entorno real, igual que ya hace `tests/tender-document-state-migrations-pglite.integration.test.mjs`.

## Gate

- No existe una regresión nueva del corte.
- La base compila, mantiene paridad y construye.
- El baseline inicial no era verde hasta corregir los dos fixtures PGlite.
- El gate productivo permanece condicionado a conservar estas pruebas verdes.

## Remediación local del baseline

Se confirmó el patrón en `tests/tender-document-state-migrations-pglite.integration.test.mjs`, cuyo bootstrap sí crea los tres roles Supabase relevantes. Se añadió únicamente `create role anon` a los dos fixtures fallidos; no se modificó SQL productivo, migraciones ni aserciones.

Verificación posterior fresca:

| Verificación | Resultado |
|---|---:|
| Archivos `tests/*.test.mjs` | 131/131 PASS |
| Matriz `tests/*pglite*.test.mjs` | PASS |
| `npx tsc --noEmit` | PASS |
| `npm run check:backend-parity` | PASS |
| `npm run build` | PASS |
| `git diff --check` | PASS |

## Estado del gate

**BASELINE_PASS.** Las dos fallas preexistentes quedaron cerradas en fixtures locales y la rama está habilitada para iniciar cambios de producto mediante TDD.
