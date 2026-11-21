-- Reglas legales nacionales con vigencia y fuente. Son la referencia contra la que se comparan los
-- parámetros de cada ciudad (parametros_nomina): no cambian ningún cálculo ni pago, solo permiten
-- avisar cuando una ciudad usa un valor distinto del legal vigente.
-- Un cambio legal es una fila nueva (tema + vigente_desde). Fuente: Leyes.zip de Juan (2026-10-16),
-- estudio en /root/projects/_fuentes-siio/legal-programacion/2026-10-16/.
--   estado = 'norma'          → texto de la norma, con artículo.
--   estado = 'por_confirmar'  → depende de una lectura que debe confirmar Jurídica o Nómina.

create table programacion.reglas_legales (
  id             bigint generated always as identity primary key,
  tema           text not null check (tema in (
                   'jornada_semanal', 'jornada_diaria_ordinaria', 'inicio_nocturno', 'fin_nocturno',
                   'recargo_descanso_obligatorio', 'habitualidad_dias_mes',
                   'extras_max_dia', 'extras_max_semana',
                   'vigilancia_acuerdo_max_dia', 'vigilancia_acuerdo_max_semana')),
  vigente_desde  date not null,
  valor          numeric(8,4) not null,
  unidad         text not null check (unidad in ('horas', 'hora_del_dia', 'fraccion', 'dias')),
  fuente         text not null,
  estado         text not null default 'norma' check (estado in ('norma', 'por_confirmar')),
  nota           text,
  creado_en      timestamptz not null default now(),
  unique (tema, vigente_desde)
);
comment on table programacion.reglas_legales is
  'Valores legales nacionales con vigencia y fuente. Referencia para comparar los parámetros de cada ciudad; no se usan para liquidar.';

alter table programacion.reglas_legales enable row level security;
create policy ver_reglas_legales on programacion.reglas_legales for select to authenticated
  using (exists (select 1 from programacion.mi_acceso()));
grant select on programacion.reglas_legales to authenticated;
-- Sin políticas de escritura: las filas se cargan por migración, con su fuente.

insert into programacion.reglas_legales (tema, vigente_desde, valor, unidad, fuente, estado, nota) values
  -- Jornada ordinaria semanal (Ley 2101 de 2021, vigente desde el 15-jul-2021, arts. 2 y 3).
  ('jornada_semanal', '1990-01-01', 48, 'horas', 'CST art. 161 (texto anterior a la Ley 2101 de 2021)', 'por_confirmar', 'Solo sirve para recalcular periodos antiguos.'),
  ('jornada_semanal', '2023-07-15', 47, 'horas', 'Ley 2101 de 2021, art. 3', 'norma', null),
  ('jornada_semanal', '2024-07-15', 46, 'horas', 'Ley 2101 de 2021, art. 3', 'norma', null),
  ('jornada_semanal', '2025-07-15', 44, 'horas', 'Ley 2101 de 2021, art. 3', 'norma', null),
  ('jornada_semanal', '2026-07-15', 42, 'horas', 'Ley 2101 de 2021, arts. 2 y 3; Ley 2466 de 2025, art. 11', 'norma', 'La reducción no puede bajar el salario ni el valor de la hora ordinaria (Ley 2101, art. 4).'),
  ('jornada_diaria_ordinaria', '2025-06-25', 8, 'horas', 'Ley 2466 de 2025, art. 11 (CST art. 161)', 'norma', 'La jornada semanal se reparte de común acuerdo en 5 o 6 días.'),
  -- Trabajo nocturno (Ley 2466 de 2025, art. 10; rige seis meses después del 25-jun-2025).
  ('inicio_nocturno', '1990-01-01', 21, 'hora_del_dia', 'CST art. 160 (texto de la Ley 1846 de 2017)', 'por_confirmar', 'Solo sirve para recalcular periodos antiguos.'),
  ('inicio_nocturno', '2025-12-25', 19, 'hora_del_dia', 'Ley 2466 de 2025, art. 10 (CST art. 160)', 'por_confirmar', 'La ley rige seis meses después de su promulgación (25-jun-2025); el día exacto lo confirma Jurídica.'),
  ('fin_nocturno', '1990-01-01', 6, 'hora_del_dia', 'CST art. 160', 'norma', null),
  -- Recargo por trabajar en día de descanso obligatorio o festivo (Ley 2466 de 2025, art. 14, parágrafo transitorio).
  ('recargo_descanso_obligatorio', '1990-01-01', 0.75, 'fraccion', 'CST art. 179 (texto anterior a la Ley 2466 de 2025)', 'por_confirmar', 'Solo sirve para recalcular periodos antiguos.'),
  ('recargo_descanso_obligatorio', '2025-07-01', 0.80, 'fraccion', 'Ley 2466 de 2025, art. 14, parágrafo transitorio', 'norma', null),
  ('recargo_descanso_obligatorio', '2026-07-01', 0.90, 'fraccion', 'Ley 2466 de 2025, art. 14, parágrafo transitorio', 'norma', null),
  ('recargo_descanso_obligatorio', '2027-07-01', 1.00, 'fraccion', 'Ley 2466 de 2025, art. 14', 'norma', 'Recargo pleno del 100 %.'),
  ('habitualidad_dias_mes', '2025-06-25', 3, 'dias', 'Ley 2466 de 2025, art. 14, parágrafo 1', 'norma', 'Tres o más días de descanso obligatorio trabajados en el mes calendario = trabajo habitual. Sin pacto escrito, el día de descanso es el domingo (parágrafo 3).'),
  -- Límite general de horas extra (Ley 2466 de 2025, art. 13).
  ('extras_max_dia', '2025-06-25', 2, 'horas', 'Ley 2466 de 2025, art. 13 (Ley 50 de 1990, art. 22)', 'por_confirmar', 'El mismo artículo exceptúa al sector de seguridad "de conformidad con la Ley 1920 de 2018". Jurídica debe confirmar si la excepción aplica a guardas sin el acuerdo escrito de la Ley 1920.'),
  ('extras_max_semana', '2025-06-25', 12, 'horas', 'Ley 2466 de 2025, art. 13 (Ley 50 de 1990, art. 22)', 'por_confirmar', 'Misma excepción del sector de seguridad (ver extras_max_dia).'),
  -- Régimen especial de vigilancia: solo con acuerdo escrito firmado por las dos partes (Ley 1920 de 2018, art. 7).
  ('vigilancia_acuerdo_max_dia', '2018-07-12', 12, 'horas', 'Ley 1920 de 2018, art. 7', 'norma', 'Requiere acuerdo previo escrito y firmado. Ocho horas ordinarias más hasta cuatro suplementarias por día.'),
  ('vigilancia_acuerdo_max_semana', '2018-07-12', 60, 'horas', 'Ley 1920 de 2018, art. 7', 'norma', 'Incluye las horas suplementarias. Requiere acuerdo previo escrito y firmado.');
