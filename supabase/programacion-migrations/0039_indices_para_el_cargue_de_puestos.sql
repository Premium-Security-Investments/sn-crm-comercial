-- Índices para que el cargue de puestos no se pase de los 8 segundos.
--
-- El 2026-11-03 el cargue empezó a devolver 500. La causa no estaba en Avancys: la función leía bien
-- y la que fallaba era la consulta de la base.
--
-- La 0037 cambió los `join` por `left join lateral … limit 1` para que una fila de entrada no se
-- multiplicara. Era correcto, pero convirtió el cruce en un bucle: por cada puesto que llega, un
-- recorrido completo de `clientes` aplicando una expresión regular. Con 144 clientes no se notaba.
-- El 2026-11-02 entraron los de Avancys y pasaron a 1.440, y 1.035 puestos × 1.440 clientes son un
-- millón y medio de evaluaciones de regex. El rol `authenticated` tiene `statement_timeout = 8s`.
--
-- Medido después de crear los índices: un cruce equivalente de 1.035 filas pasa de segundos a 41 ms,
-- con `Index Scan` en las dos búsquedas en vez de `Seq Scan`. No se midió con el cargue real desde
-- la pantalla.
--
-- Las dos funciones son `immutable`, que es lo que permite indexar por su resultado.

create index if not exists clientes_nit_normal
  on programacion.clientes (programacion.normalizar_nit(nit));

create index if not exists puestos_ciudad_nombre_normal
  on programacion.puestos (ciudad_id, programacion.normalizar_nombre(nombre));

analyze programacion.clientes;
analyze programacion.puestos;
