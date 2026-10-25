# Aplicación de migraciones a la base del SIIO

**Decisión de Juan Botero, 2026-10-25:** se dejan de pedir migraciones aplicadas a mano. Las aplica
el agente con la herramienta, una por una y con autorización de Juan para cada una.

## Por qué existe este documento

El camino anterior era: el agente dejaba la migración en el repositorio, abría el PR y le pasaba a
Juan el enlace del archivo para que lo pegara en el editor SQL de Supabase. Se acordó así el
2026-10-22, cuando el clasificador de modo automático rechazó una migración y a Juan no le llegó
ninguna ventana de aprobación.

Ese camino tiene un costo que no estaba escrito en ninguna parte: **el editor SQL no registra nada
en `supabase_migrations.schema_migrations`**. Dos migraciones aplicadas así —la 153 y la 155— quedaron
hechas y sin registro, y el 2026-10-25 eso llevó a dos diagnósticos equivocados en el mismo día:

- se dio por aplicada la `154_agt002_workbench_politica_v2` porque el libro mostraba otro 154 (había
  dos con el mismo número), y la Mesa quedó rota en producción durante un día: el código estampaba
  `policy.v2` y la base aceptaba sólo `v1`;
- se dio por no aplicada la 155 porque no estaba en el libro, cuando sus efectos sí estaban. Actuar
  sobre ese diagnóstico habría hecho fallar su `rename` contra una columna que ya no existe.

## Procedimiento vigente

1. La migración y su reversa van en el repositorio: `supabase/migrations/<n>_<tema>.sql` y
   `supabase/rollbacks/<n>_<tema>_rollback.sql`. El número no se repite (lo verifica
   `tests/migration-number-uniqueness.test.mjs`).
2. El agente **pide autorización a Juan para esa migración**, nombrando qué cambia.
3. Con el sí, el agente la aplica con `apply_migration`, que la deja registrada en el libro con su
   nombre y su versión.
4. El agente **verifica el efecto con `select`** y lo escribe: la restricción, la función o la
   columna que debía cambiar, leídas de la base y no del archivo.
5. Si la herramienta se frena, no se reintenta la misma llamada: se dice y se decide con Juan. El
   camino manual queda como excepción, y **cuando se use hay que registrar la migración en el libro
   después**, o el libro vuelve a mentir.

## Lo que no se debe hacer

- Aplicar DDL con `execute_sql`. Esa herramienta se usa sólo para `select`; el DDL va con su archivo
  de migración, para que exista en el repositorio y en el libro.
- Volver a correr una migración "por si acaso" sin medir sus efectos: las de esta base no son todas
  idempotentes. De 152 migraciones, 29 no van envueltas en `begin;`/`commit;`, y un `rename column`
  falla en la segunda corrida.
- Concluir que una migración no se aplicó porque no está en el libro. El libro es incompleto por el
  camino manual: la pregunta se responde midiendo el esquema.

## Verificado el 2026-10-25

`apply_migration` **pasó** desde una sesión de puente: la `156_agt002_workbench_politica_v2` quedó
aplicada y registrada como versión `20261025201613`. No se sabe si el clasificador cambió o si fue
cuestión de esa sesión; la prueba barata es que otra sesión intente una y lo reporte.
