# Revisión independiente final — SIIO F2 seguridad y coherencia

Fecha UTC: 2026-08-06

> Corrección post-merge: el SQL revisado no cambió, pero el archivo F2 fue
> renumerado de `058` a `062` al detectarse que `main` ya contenía migraciones
> numeradas `058`, `059`, `060` y `061`.

## Alcance revisado

- Rama: `design/siio-f2-operational-closure`
- HEAD de producto y evidencia local revisado: `3d7f7aa05f073617e4cec1a6c704876252c6b279`
- Base de comparación: `origin/main` local, sin `fetch`
- Revisor independiente: Claude Code CLI con Claude Opus 4.8
- Evidencia de ejecución del revisor: `/root/.hermes/metrics/claude-primary-canary/20260806T012724Z-siio-f2-task7-review-opus.json`
- Modo: sólo lectura; sin edición, commit, red, push, deploy ni migración

## Veredicto

**APPROVED_WITH_MINOR**

- Critical: **0**
- Important: **0**
- Minor: **3**
- Bloqueantes para gate humano: **0**

## Confirmaciones independientes

1. **Migración 062:** transaccional, fail-closed ante tablas faltantes, sin DML ni pérdida de datos; revoca privilegios directos a `public`, `anon` y `authenticated`; `service_role` conserva `SELECT` en las 10 tablas y escritura mínima sin `DELETE` únicamente en las tres tablas usadas por endpoints mutables.
2. **Director:** deja de ser elegible para `modulo_siio_gerencial` sin perder módulos no-SIIO; backend conserva bloqueo `403` antes de leer tablas.
3. **Junta:** sólo consume filas con `status = 'presentado'`; rechaza `borrador`, `en_revision`, `aprobado` y el alias legado `publication_status = 'published'`.
4. **Nómina agregada:** Admin y Gerencia sólo reciben `gerencia` y `junta_agregado`; `restringido` no se serializa; Junta recibe cero filas crudas.
5. **Fundación SIIO:** tabla/relación ausente produce `503` sanitizado; consulta válida vacía conserva `200` con `[]`.
6. **Paridad:** `server/index.js` y `api/[...path].js` fueron verificados byte a byte como idénticos.
7. **Alcance:** no hay archivos AGT-002, AGT-003 ni Mesa de producto en el diff final.
8. **Evidencia contra disco:** no se detectaron discrepancias entre el documento de verificación y el árbol revisado.

## Hallazgos Minor no bloqueantes

### M1 — detección textual amplia de tabla ausente

`siioFoundationUnavailable` acepta el substring `does not exist`, que podría clasificar como `503` un error de columna inexistente además de una relación faltante. El comportamiento sigue siendo fail-closed y sanitizado.

Remedio opcional futuro: priorizar exclusivamente `42P01` y `PGRST205`, o anclar el texto a `relation ... does not exist`.

### M2 — filtro de nómina en aplicación

Las filas `restringido` se leen al proceso backend y se eliminan antes de serializar, en lugar de filtrarse en la consulta. No se encontró fuga en la respuesta y el diseño aprobado eligió explícitamente el filtrado server-side previo a `res.json`.

Remedio opcional futuro: añadir defensa en profundidad con filtro de consulta por `visibility_level`.

### M3 — limitación del entorno del revisor

El revisor Opus no pudo volver a ejecutar tests/build debido a sus permisos de sólo lectura y se apoyó en la evidencia existente para esos resultados. Sí revalidó paridad por hash e inspeccionó el código real.

Hermes compensó esta limitación ejecutando un gate fresco después de la revisión, documentado a continuación.

## Gate mecánico fresco posterior a la revisión

Ejecutado por Hermes sobre `HEAD = 3d7f7aa05f073617e4cec1a6c704876252c6b279`:

```text
focal SIIO: 7 tests, 7 pass, 0 fail
suite tests/siio*.test.mjs: 11 tests, 11 pass, 0 fail
backend parity: OK
build: tsc + vite build OK
git diff origin/main...HEAD --check: OK
git diff --check: OK
worktree antes de este documento: limpio
```

Build generado:

```text
dist/index.html                   0.51 kB | gzip 0.33 kB
dist/assets/index-DBRcKbMZ.css  157.60 kB | gzip 26.85 kB
dist/assets/index-CmYgFhl2.js   745.38 kB | gzip 198.25 kB
```

Aviso no bloqueante y preexistente: chunk JavaScript superior a 500 kB.

## Riesgos residuales aceptados para este bloque

- `service_role` evita RLS; los guards de aplicación siguen siendo el control efectivo del backend.
- No existe mecanismo auditable de excepción para nómina `restringido`.
- Los endpoints mutables F2 continúan sin UI operativa.
- Junta no tiene todavía ciclo end-to-end de borrador, revisión, aprobación y publicación.

## Gate

El bloque local está listo para decisión humana sobre **push/PR**. Esta evidencia no autoriza por sí misma push, PR, merge, aplicación de migración ni deploy.

No se realizó ninguna acción remota durante esta revisión.
