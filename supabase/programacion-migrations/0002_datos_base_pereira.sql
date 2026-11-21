-- Datos base del piloto: ciudades, festivos 2026 de Colombia y parámetros
-- con los que el Excel de Pereira liquidó el periodo 24-jul a 23-ago-2026.
-- Los parámetros NO están validados por nómina (ver preguntas en docs/).

insert into programacion.ciudades (id, nombre, dia_corte, metodo_extras) values
  ('pereira', 'Pereira', 23, 'legado_pereira'),
  ('medellin', 'Medellín', null, 'por_dia');

-- Festivos oficiales de Colombia 2026 (Ley 51 de 1983). El Excel tenía además
-- el 13-jul-2026, que no es festivo: no se carga.
insert into programacion.festivos (fecha, nombre) values
  ('2026-01-01', 'Año Nuevo'),
  ('2026-01-12', 'Reyes Magos'),
  ('2026-03-23', 'San José'),
  ('2026-04-02', 'Jueves Santo'),
  ('2026-04-03', 'Viernes Santo'),
  ('2026-05-01', 'Día del Trabajo'),
  ('2026-05-18', 'Ascensión del Señor'),
  ('2026-06-08', 'Corpus Christi'),
  ('2026-06-15', 'Sagrado Corazón'),
  ('2026-06-29', 'San Pedro y San Pablo'),
  ('2026-07-20', 'Independencia'),
  ('2026-08-07', 'Batalla de Boyacá'),
  ('2026-08-17', 'Asunción de la Virgen'),
  ('2026-10-12', 'Día de la Raza'),
  ('2026-11-02', 'Todos los Santos'),
  ('2026-11-16', 'Independencia de Cartagena'),
  ('2026-12-08', 'Inmaculada Concepción'),
  ('2026-12-25', 'Navidad');

insert into programacion.parametros_nomina
  (ciudad_id, vigente_desde, jornada_semanal, jornada_diaria_macro, inicio_diurno, fin_diurno,
   divisor_valor_hora, smlv, auxilio_transporte, factores, regla_domingos, nota)
values
  ('pereira', '2026-07-24', 43, 8, '06:00', '19:00', 210, 1750905, 249095,
   '{"hed":1.25,"hen":1.75,"rn":0.35,"dof_sin_compensatorio":1.9,"dof_con_compensatorio":0.9,"hed_dof":2.15,"hen_dof":2.65}',
   '{"habitualidad_domingos":3,"primeras_horas_festivo":8}',
   'Tal como los usa el Excel de Pereira (jornada 43/6 en fórmulas y 48/6 en la macro). Por validar con nómina.'),
  ('medellin', '2026-08-01', 42, null, '06:00', '19:00', 220, 1750905, 249095,
   '{"hed":1.25,"hen":1.75,"rn":0.35,"rdf":0.8,"rnf":1.15,"hed_dof":2.05,"hen_dof":2.55}',
   null,
   'Tal como los usa el Excel de Medellín. Por validar con nómina.');
