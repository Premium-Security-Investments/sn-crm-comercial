-- Reglas de nómina por ciudad o para el resto del país, configurables por un administrador.
-- Cada cambio es una fila nueva con fecha de inicio, fuente, quién lo aprobó y soporte; nunca se
-- edita ni se borra una fila anterior (queda el historial). Los periodos ya abiertos conservan las
-- reglas con que se abrieron; las nuevas aplican a los periodos que se abran desde esa fecha.
-- También se registran los departamentos donde opera la empresa (imagen de Juan, 2026-10-01),
-- más Bogotá D. C. aparte (pedido de Juan, 2026-10-16).

-- ---------- Departamentos ----------
create table programacion.departamentos (
  id         text primary key,
  nombre     text not null,
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);
alter table programacion.departamentos enable row level security;
create policy ver_departamentos on programacion.departamentos for select to authenticated
  using (exists (select 1 from programacion.mi_acceso()));
grant select on programacion.departamentos to authenticated;

insert into programacion.departamentos (id, nombre) values
  ('antioquia', 'Antioquia'), ('caldas', 'Caldas'), ('caqueta', 'Caquetá'), ('cauca', 'Cauca'),
  ('cundinamarca', 'Cundinamarca'), ('huila', 'Huila'), ('narino', 'Nariño'), ('quindio', 'Quindío'),
  ('risaralda', 'Risaralda'), ('tolima', 'Tolima'), ('valle_del_cauca', 'Valle del Cauca'),
  ('bogota_dc', 'Bogotá D. C.');

alter table programacion.ciudades add column if not exists departamento_id text references programacion.departamentos(id);
update programacion.ciudades set departamento_id = 'risaralda' where id = 'pereira';
update programacion.ciudades set departamento_id = 'antioquia' where id = 'medellin';

-- ---------- Trazabilidad de las reglas ----------
alter table programacion.parametros_nomina add column if not exists fuente text;
alter table programacion.parametros_nomina add column if not exists aprobado_por text;
alter table programacion.parametros_nomina add column if not exists soporte text;
alter table programacion.parametros_nomina add column if not exists registrado_por uuid;
comment on column programacion.parametros_nomina.fuente is 'Norma, acta o decisión que respalda los valores (obligatoria desde la migración 0021).';
comment on column programacion.parametros_nomina.aprobado_por is 'Persona o área que aprobó los valores (obligatoria desde la migración 0021).';

update programacion.parametros_nomina set
  fuente = coalesce(fuente, 'Valores tomados del Excel de la ciudad (carga inicial)'),
  aprobado_por = coalesce(aprobado_por, 'Pendiente de validar con Nómina')
where fuente is null or aprobado_por is null;

-- Las reglas no se editan ni se borran: un cambio es una fila nueva.
create or replace function programacion.parametros_inmutables() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Las reglas de nómina no se editan ni se borran; registre una nueva con su fecha de inicio';
end $$;
create trigger parametros_inmutables before update or delete on programacion.parametros_nomina
  for each row execute function programacion.parametros_inmutables();
create trigger historial_parametros after insert on programacion.parametros_nomina
  for each row execute function programacion.registrar_historial();

-- Al abrir un periodo, la regla de la ciudad tiene prioridad sobre la del resto del país
-- (antes se tomaba solo la más reciente, sin importar si era de la ciudad o general).
create or replace function programacion.parametros_del_periodo() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.parametros_id := (
    select x.id from programacion.parametros_nomina x
    where (x.ciudad_id = new.ciudad_id or x.ciudad_id is null) and x.vigente_desde <= new.inicio
    order by (x.ciudad_id is null), x.vigente_desde desc limit 1);
  return new;
end $$;
create trigger parametros_del_periodo before insert on programacion.periodos
  for each row execute function programacion.parametros_del_periodo();

-- ---------- Registrar una regla nueva ----------
-- p_ciudad null = resto del país. p_valores trae los mismos campos de parametros_nomina.
create or replace function programacion.registrar_parametros(
  p_ciudad text, p_vigente_desde date, p_valores jsonb, p_fuente text, p_aprobado_por text,
  p_soporte text default null, p_nota text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_ultima date; v_id bigint;
begin
  if not programacion.es_admin() then
    raise exception 'Solo un administrador de Programación puede registrar reglas de nómina';
  end if;
  if coalesce(trim(p_fuente), '') = '' then raise exception 'Indique la fuente (norma, acta o decisión)'; end if;
  if coalesce(trim(p_aprobado_por), '') = '' then raise exception 'Indique quién aprobó la regla'; end if;
  if p_vigente_desde is null then raise exception 'Indique desde qué fecha rige'; end if;
  if p_ciudad is not null and not exists (select 1 from programacion.ciudades where id = p_ciudad) then
    raise exception 'La ciudad % no existe', p_ciudad;
  end if;
  select max(vigente_desde) into v_ultima from programacion.parametros_nomina where ciudad_id is not distinct from p_ciudad;
  if v_ultima is not null and p_vigente_desde <= v_ultima then
    raise exception 'La fecha de inicio debe ser posterior a la regla vigente (%)', to_char(v_ultima, 'DD-MM-YYYY');
  end if;
  if coalesce((p_valores ->> 'jornada_semanal')::numeric, 0) <= 0 or coalesce((p_valores ->> 'divisor_valor_hora')::numeric, 0) <= 0
     or coalesce((p_valores ->> 'smlv')::numeric, 0) <= 0 or (p_valores ->> 'auxilio_transporte') is null
     or jsonb_typeof(p_valores -> 'factores') is distinct from 'object' then
    raise exception 'Faltan valores: jornada, divisor, salario mínimo, auxilio de transporte y factores';
  end if;

  insert into programacion.parametros_nomina (
    ciudad_id, vigente_desde, jornada_semanal, jornada_diaria_macro, inicio_diurno, fin_diurno,
    divisor_valor_hora, smlv, auxilio_transporte, factores, regla_domingos, max_horas_semana, descanso_minimo_horas,
    nota, fuente, aprobado_por, soporte, registrado_por)
  values (
    p_ciudad, p_vigente_desde, (p_valores ->> 'jornada_semanal')::numeric, nullif(p_valores ->> 'jornada_diaria_macro', '')::numeric,
    coalesce(nullif(p_valores ->> 'inicio_diurno', '')::time, '06:00'), coalesce(nullif(p_valores ->> 'fin_diurno', '')::time, '19:00'),
    (p_valores ->> 'divisor_valor_hora')::numeric, (p_valores ->> 'smlv')::numeric, (p_valores ->> 'auxilio_transporte')::numeric,
    p_valores -> 'factores', case when jsonb_typeof(p_valores -> 'regla_domingos') = 'object' then p_valores -> 'regla_domingos' end,
    coalesce(nullif(p_valores ->> 'max_horas_semana', '')::numeric, 60), coalesce(nullif(p_valores ->> 'descanso_minimo_horas', '')::numeric, 8),
    nullif(trim(p_nota), ''), trim(p_fuente), trim(p_aprobado_por), nullif(trim(p_soporte), ''), public.psi_sales_current_profile_id())
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function programacion.registrar_parametros(text, date, jsonb, text, text, text, text) from anon, public;
grant execute on function programacion.registrar_parametros(text, date, jsonb, text, text, text, text) to authenticated;
