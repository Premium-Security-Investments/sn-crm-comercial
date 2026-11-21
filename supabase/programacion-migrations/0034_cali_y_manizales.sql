-- Cali y Manizales entran como ciudades, con la lógica de Pereira y Bogotá.
--
-- Decisión de Juan del 2026-10-30. Las dos tienen gente en Avancys y no tienen ciudad en Programación:
-- AGENCIA CALI 339 personas con contrato vigente, AGENCIA MANIZALES 83 (medido el 2026-10-30T19:15Z).
--
-- De Pereira y Bogotá heredan todo lo que ellas comparten, que es la "lógica" que pidió Juan:
-- método de extras `legado_pereira`, corte el día 23, valor hora = SMLV/210, los mismos factores
-- (HED 1,25 · HEN 1,75 · RN 0,35 · DoF sin compensatorio 1,90 · con compensatorio 0,90 · HED DoF 2,15 ·
-- HEN DoF 2,65) y la regla de habitualidad de 3 domingos.
--
-- **Lo único que NO se hereda es la jornada, y es a propósito.** Pereira usa 43 y Bogotá 44 porque así
-- está escrito a mano en la celda `NOMINA!AI1` de cada Excel, y ninguna de las dos la ha validado
-- nómina. Copiar una de esas cifras a una ciudad nueva sería propagar un dato sin dueño. Cali y
-- Manizales no tienen Excel que copiar, así que arrancan con **la jornada legal vigente: 42 horas
-- semanales desde el 2026-07-15**, que es lo que dice la propia tabla `programacion.reglas_legales`
-- (tema `jornada_semanal`, estado `norma`, Ley 2101 de 2021 arts. 2 y 3 y Ley 2466 de 2025 art. 11).
-- La jornada diaria de la macro, 8 horas, también sale de ahí (`jornada_diaria_ordinaria`).
--
-- Consecuencia práctica: hasta que nómina responda, en la plataforma conviven tres jornadas —42 en
-- Cali, Manizales y Medellín; 43 en Pereira; 44 en Bogotá—, cada una con su fuente escrita. Eso es
-- preferible a tener cinco ciudades con el mismo número sin que nadie sepa de dónde salió.

insert into programacion.ciudades (id, nombre, dia_corte, metodo_extras, departamento_id) values
  ('cali', 'Cali', 23, 'legado_pereira', 'valle_del_cauca'),
  ('manizales', 'Manizales', 23, 'legado_pereira', 'caldas')
on conflict (id) do nothing;

insert into programacion.parametros_nomina (
  ciudad_id, vigente_desde, jornada_semanal, jornada_diaria_macro, inicio_diurno, fin_diurno,
  divisor_valor_hora, smlv, auxilio_transporte, regla_domingos, factores, fuente, nota)
select v.ciudad, date '2026-07-15', 42.00, 8.0000, time '06:00', time '19:00',
  210.00, 1750905.00, 249095.00,
  jsonb_build_object('habitualidad_domingos', 3, 'primeras_horas_festivo', 8),
  jsonb_build_object('hed', 1.25, 'hen', 1.75, 'rn', 0.35,
                     'dof_sin_compensatorio', 1.9, 'dof_con_compensatorio', 0.9,
                     'hed_dof', 2.15, 'hen_dof', 2.65),
  'Jornada: tabla reglas_legales (42 h desde el 2026-07-15). El resto, heredado de Pereira y Bogotá.',
  'Ciudad nueva sin Excel propio: no se copió la jornada de otra ciudad. Por validar con nómina, igual que las demás.'
from (values ('cali'), ('manizales')) as v(ciudad)
where not exists (
  select 1 from programacion.parametros_nomina p where p.ciudad_id = v.ciudad and p.vigente_desde = date '2026-07-15');

-- Avancys: cada ciudad nueva es su agencia.
update programacion.integraciones
set config = jsonb_set(jsonb_set(config,
      '{ciudades,cali}',      jsonb_build_object('grupos', jsonb_build_array('AGENCIA CALI',      'VALLE DEL CAUCA', 'Valle Del Cauca (CO)'), 'ciudades', '[]'::jsonb), true),
      '{ciudades,manizales}', jsonb_build_object('grupos', jsonb_build_array('AGENCIA MANIZALES', 'CALDAS',          'Caldas (CO)'),          'ciudades', '[]'::jsonb), true),
    actualizado_en = now()
where id = 'avancys';
