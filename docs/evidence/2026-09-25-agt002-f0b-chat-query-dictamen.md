# AGT-002 F0-B — `chat_query` dictamen (2026-09-25)

## Estado: repo-only, CERO APPLY

Este slice F0-B es exclusivamente repositorio. No se ejecutó `supabase db push`.
No se ejecutó `psql` contra ninguna base de datos de producción ni de staging.
Ningún cambio descrito aquí fue aplicado a ninguna base de datos.

## Hallazgo

`public.chat_query(p_sql text)` es la función `SECURITY DEFINER` que ejecuta
SQL dinámico proporcionado por el llamador (`EXECUTE format(...)`) y que
tenía `EXECUTE` otorgado a `PUBLIC`, `anon` y `authenticated`. Esto la
convierte en la única función de la base con SQL dinámico expuesta a roles
no privilegiados.

La migración `supabase/migrations/092_agt002_f0b_chat_query_revoke.sql`
retira el cuerpo de la función (ahora únicamente `RAISE EXCEPTION`) y revoca
`EXECUTE`/`ALL` sobre `public.chat_query(text)` de `PUBLIC`, `anon`,
`authenticated` y `service_role`. Esa migración existe únicamente en el
repositorio: no ha sido aplicada. No se debe afirmar
`AGT002_CONTROL_PLANE_RECONCILED` a partir de este trabajo, porque ninguna
base de datos real refleja todavía esta revocación.

## Definición de "ejecución amplia" en este GO F0-B

A los efectos de este dictamen y de la autorización `AUTHORIZE_F0_B_CHAT_QUERY`,
"ejecución amplia" se define de forma explícita y exclusiva como la
combinación de las tres condiciones siguientes: (1) función
`SECURITY DEFINER`; (2) SQL dinámico controlado por el llamador (por
ejemplo `EXECUTE format(...)` sobre una cadena que incorpora entrada no
fijada por el propio cuerpo de la función); y (3) `EXECUTE` otorgado a
`PUBLIC` y/o `anon` y/o `authenticated`. Sólo `public.chat_query(text)`
cumple simultáneamente las tres condiciones en el catálogo capturado. Una
función que cumple sólo (1) y (3), sin SQL dinámico controlado por el
llamador, no es "ejecución amplia" bajo esta definición y no queda
cubierta por `AUTHORIZE_F0_B_CHAT_QUERY`.

## Sobre la evidencia de explotación

Este dictamen se emite sin evidencia de explotación y sin capacidad suficiente para descartarla retrospectivamente. No existe en este slice
ninguna fuente de logs de consultas históricas contra `chat_query` que
permita confirmar o descartar uso indebido pasado; la ausencia de evidencia
no equivale a evidencia de ausencia.

## Sobre las demás funciones `SECURITY DEFINER` residuales

El inventario en
`docs/evidence/2026-09-25-agt002-f0b-security-definer-inventory.json`
identifica funciones adicionales con `EXECUTE` residual para `PUBLIC`/`anon`/
`authenticated` (p. ej. `psi_assert_tender_dossier_actor`,
`psi_assert_tender_dossier_go`, `psi_profile_has_tender_permission`,
`psi_record_tender_analysis_run`). Ninguna de ellas ejecuta SQL dinámico
controlado por el llamador, por lo que ninguna cumple la definición de
"ejecución amplia" anterior: son predicados (`SECURITY DEFINER` sin SQL
dinámico), no la combinación que este GO autoriza a corregir. Su
`EXECUTE` residual sobre roles públicos/anónimos es un hallazgo
independiente, dictaminado aquí como residual F0-E —no como pendiente—, y
este documento no otorga una excepción humana para mantener SQL dinámico
ampliamente expuesto. Revocar el `EXECUTE` de estas cuatro rutinas no está
autorizado por `AUTHORIZE_F0_B_CHAT_QUERY`; cualquier acción sobre ellas
requiere su propio dictamen bajo F0-E. `F0-E` queda fuera del alcance de
este slice F0-B.

`exec_sql` es una función distinta, también con SQL dinámico, pero
restringida a `postgres`/`service_role` — no tiene `EXECUTE` para
`PUBLIC`/`anon`/`authenticated` y por tanto no es parte de F0-B.

## Fuente del catálogo

Catálogo capturado desde `SUPABASE-CATALOG-READONLY-001` en
`2026-09-25T03:13:10Z` (modo solo lectura). Este catálogo no fue
re-consultado durante este slice; toda clasificación aquí se basa en esa
captura puntual.
