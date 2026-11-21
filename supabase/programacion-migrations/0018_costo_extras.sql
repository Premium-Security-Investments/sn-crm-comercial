-- Costo en pesos de las horas extra y recargos del periodo, por guarda y por puesto.
-- Valor hora = SMLV / divisor del valor hora (como el Excel; el salario real por guarda está por confirmar).
-- Cada concepto se reparte entre los puestos donde el guarda trabajó, según la traza del cálculo día
-- por día (si un día tuvo dos puestos, en proporción a las horas). No incluye prestaciones ni seguridad social.

create or replace function programacion.costo_extras(p_periodo bigint)
returns table (empleado_id bigint, puesto_id bigint, concepto text, horas numeric, valor numeric)
language sql stable security definer set search_path = '' as $$
  with per as (
    select p.* from programacion.periodos p where p.id = p_periodo and programacion.puede_ver(p.ciudad_id)
  ),
  par as (
    select coalesce(
      (select to_jsonb(x) from programacion.parametros_nomina x, per where x.id = per.parametros_id),
      (select to_jsonb(x) from programacion.parametros_nomina x, per where (x.ciudad_id = per.ciudad_id or x.ciudad_id is null)
         and x.vigente_desde <= per.fin order by x.ciudad_id nulls last, x.vigente_desde desc limit 1)) as j
  ),
  conceptos (concepto, fila_traza, factor) as (values
    ('hed', 'hed', 'hed'), ('hen', 'hen', 'hen'), ('hedDoF', 'hedDoF', 'hed_dof'), ('henDoF', 'henDoF', 'hen_dof'),
    ('recargoNocturno', 'recargoNocturno', 'rn'),
    ('dofSinCompensatorio', 'horasFestivas', 'dof_sin_compensatorio'), ('dofConCompensatorio', 'horasFestivas', 'dof_con_compensatorio')
  ),
  res as (
    select r.empleado_id, r.totales, r.traza from programacion.resultados_nomina r, per where r.periodo_id = per.id
  ),
  -- Horas por guarda, día y puesto (lo realizado).
  dia_puesto as (
    select t.empleado_id, (t.inicio::date - per.inicio) as c, t.puesto_id,
      sum(extract(epoch from t.fin - t.inicio) / 3600) as h
    from programacion.turnos t, per
    where t.inicio::date between per.inicio and per.fin and t.empleado_id in (select empleado_id from res)
    group by 1, 2, 3
  ),
  principal as (
    select distinct on (empleado_id) empleado_id, puesto_id from dia_puesto group by empleado_id, puesto_id
    order by empleado_id, sum(h) desc
  ),
  parte as (
    select dp.*, dp.h / nullif(sum(dp.h) over (partition by dp.empleado_id, dp.c), 0) as fraccion from dia_puesto dp
  ),
  -- Peso de cada puesto en cada concepto, según la traza día por día.
  pesos as (
    select r.empleado_id, k.concepto, coalesce(pa.puesto_id, pr.puesto_id) as puesto_id, sum(v.x * coalesce(pa.fraccion, 1)) as peso
    from res r cross join conceptos k
    cross join lateral (select (e.value)::numeric as x, (e.ordinality - 1)::int as c
                        from jsonb_array_elements_text(r.traza -> k.fila_traza) with ordinality e(value, ordinality)) v
    left join parte pa on pa.empleado_id = r.empleado_id and pa.c = v.c
    left join principal pr on pr.empleado_id = r.empleado_id
    where v.x <> 0 and coalesce((r.totales ->> k.concepto)::numeric, 0) <> 0
    group by 1, 2, 3
  ),
  repartido as (
    -- Si la traza no muestra el concepto (p. ej. compensatorios), todo va al puesto principal.
    select r.empleado_id, k.concepto, coalesce(p.puesto_id, pr.puesto_id) as puesto_id,
      (r.totales ->> k.concepto)::numeric * coalesce(p.peso / nullif(sum(p.peso) over (partition by r.empleado_id, k.concepto), 0), 1) as horas,
      k.factor
    from res r cross join conceptos k
    left join pesos p on p.empleado_id = r.empleado_id and p.concepto = k.concepto
    left join principal pr on pr.empleado_id = r.empleado_id
    where coalesce((r.totales ->> k.concepto)::numeric, 0) <> 0
  )
  select x.empleado_id, x.puesto_id, x.concepto, round(x.horas, 2) as horas,
    round(x.horas * ((par.j ->> 'smlv')::numeric / nullif((par.j ->> 'divisor_valor_hora')::numeric, 0)) * (par.j -> 'factores' ->> x.factor)::numeric) as valor
  from repartido x, par
$$;
revoke execute on function programacion.costo_extras(bigint) from anon, public;
grant execute on function programacion.costo_extras(bigint) to authenticated;
