-- AGT-001 Vig-IA Gerencia: horas de servicio por cliente, desde SIIO Programación.
-- Decisión de Juan Botero 2026-10-21: la Torre toma las horas por cliente de Programación
-- (repositorio vigia-programacion, esquema `programacion` de esta misma base), que sí sabe de qué
-- cliente es cada puesto. Los pesos quedan para cuando `programacion.empleados.salario_base` esté
-- lleno; hoy son 0 de 1.290, y un costo con SMLV supuesto para todos no se publica sin decirlo.
--
-- Solo agregados: horas, turnos, puestos y número de guardas. Ninguna fila de persona.
--
-- La vista NO usa `security_invoker`: corre con los privilegios de su dueño para poder leer el
-- esquema `programacion`, que tiene RLS y no le da permisos a `service_role`. Lo que se expone es
-- el agregado, no las tablas.
--
-- Programación sigue en construcción. Si el esquema todavía no existe en el ambiente donde se
-- aplique esta migración, queda una vista vacía con la misma forma y la Torre muestra el bloque
-- como pendiente en vez de fallar.

do $programacion$
begin
  if to_regclass('programacion.turnos') is null then
    execute $vacia$
      create or replace view public.siio_programacion_horas_cliente as
      select
        null::bigint    as periodo_id,
        null::text      as ciudad,
        null::date      as periodo_inicio,
        null::date      as periodo_fin,
        null::text      as periodo_estado,
        null::bigint    as cliente_id,
        null::text      as cliente,
        null::text      as nit,
        null::bigint    as puestos,
        null::numeric   as horas_programadas,
        null::numeric   as horas_realizadas,
        null::bigint    as turnos_programados,
        null::bigint    as turnos_realizados,
        null::bigint    as turnos_sin_programado,
        null::bigint    as guardas
      where false
    $vacia$;
  else
    execute $real$
      create or replace view public.siio_programacion_horas_cliente as
      with programado as (
        select tp.periodo_id, pu.cliente_id,
          sum(extract(epoch from (tp.fin - tp.inicio)) / 3600.0) as horas,
          count(*) as turnos,
          count(distinct tp.puesto_id) as puestos,
          count(distinct tp.empleado_id) as guardas
        from programacion.turnos_programados tp
        join programacion.puestos pu on pu.id = tp.puesto_id
        where pu.cliente_id is not null and tp.fin > tp.inicio
        group by 1, 2
      ), realizado as (
        -- `turnos` no guarda el periodo: se ubica por la fecha de inicio dentro del periodo de su ciudad.
        select pe.id as periodo_id, pu.cliente_id,
          sum(extract(epoch from (t.fin - t.inicio)) / 3600.0) as horas,
          count(*) as turnos,
          -- Calidad del cargue del piloto: turno real sin plan asociado. En el periodo cerrado de
          -- Pereira son 10.973 de 28.672 (38 %), así que la diferencia entre programado y realizado
          -- se lee como dato incompleto, no como incumplimiento del servicio.
          count(*) filter (where t.turno_programado_id is null) as sin_programado,
          count(distinct t.puesto_id) as puestos,
          count(distinct t.empleado_id) as guardas
        from programacion.turnos t
        join programacion.puestos pu on pu.id = t.puesto_id
        join programacion.periodos pe on pe.ciudad_id = pu.ciudad_id
          and t.inicio::date between pe.inicio and pe.fin
        where pu.cliente_id is not null and t.fin > t.inicio
        group by 1, 2
      ), claves as (
        select periodo_id, cliente_id from programado
        union
        select periodo_id, cliente_id from realizado
      )
      select
        pe.id as periodo_id,
        ci.nombre as ciudad,
        pe.inicio as periodo_inicio,
        pe.fin as periodo_fin,
        pe.estado as periodo_estado,
        c.id as cliente_id,
        c.razon_social as cliente,
        c.nit,
        greatest(coalesce(pr.puestos, 0), coalesce(re.puestos, 0)) as puestos,
        round(coalesce(pr.horas, 0)::numeric, 1) as horas_programadas,
        round(coalesce(re.horas, 0)::numeric, 1) as horas_realizadas,
        coalesce(pr.turnos, 0) as turnos_programados,
        coalesce(re.turnos, 0) as turnos_realizados,
        coalesce(re.sin_programado, 0) as turnos_sin_programado,
        greatest(coalesce(pr.guardas, 0), coalesce(re.guardas, 0)) as guardas
      from claves k
      join programacion.periodos pe on pe.id = k.periodo_id
      join programacion.ciudades ci on ci.id = pe.ciudad_id
      join programacion.clientes c on c.id = k.cliente_id
      left join programado pr on pr.periodo_id = k.periodo_id and pr.cliente_id = k.cliente_id
      left join realizado re on re.periodo_id = k.periodo_id and re.cliente_id = k.cliente_id
    $real$;
  end if;
end
$programacion$;

revoke all on table public.siio_programacion_horas_cliente from public, anon, authenticated, service_role;
grant select on table public.siio_programacion_horas_cliente to service_role;
