-- Bogotá entra como tercera ciudad de Programación.
--
-- Decisión de Juan del 2026-10-29: "vamos a ir poniendo como opción a Bogotá en la plataforma y
-- vamos a ir haciendo los ajustes".
--
-- Los parámetros NO se inventan: salen de medir su propio Excel, `PROGRAMACION EJECUTADA BOGOTA
-- SEPTIEMBRE-OCTUBRE 2026.xlsb`, el 2026-10-29 (ver docs/reglas-excel-pereira-medellin-bogota.md §9.1).
-- El hallazgo que permite abrirla sin motor nuevo: el módulo `HorasTotales` de Bogotá es idéntico al
-- de Pereira, así que su método de extras es el mismo (`legado_pereira`), con el mismo corte el día
-- 23, el mismo divisor 210 y los mismos factores, incluida la habitualidad dominical de 3 domingos.
--
-- Lo único distinto es la jornada semanal: Bogotá usa 44 donde Pereira usa 43 y Medellín 42. Las tres
-- están escritas a mano en una celda de cada Excel y ninguna está validada por nómina: queda
-- `por confirmar`, igual que las otras dos.

insert into programacion.ciudades (id, nombre, dia_corte, metodo_extras, departamento_id)
values ('bogota', 'Bogotá', 23, 'legado_pereira', 'bogota_dc')
on conflict (id) do nothing;

insert into programacion.parametros_nomina (
  ciudad_id, vigente_desde, jornada_semanal, jornada_diaria_macro, inicio_diurno, fin_diurno,
  divisor_valor_hora, smlv, auxilio_transporte, regla_domingos, factores, fuente, nota)
select 'bogota', date '2026-09-24', 44.00, 8.0000, time '06:00', time '19:00',
  210.00, 1750905.00, 249095.00,
  jsonb_build_object('habitualidad_domingos', 3, 'primeras_horas_festivo', 8),
  jsonb_build_object('hed', 1.25, 'hen', 1.75, 'rn', 0.35,
                     'dof_sin_compensatorio', 1.9, 'dof_con_compensatorio', 0.9,
                     'hed_dof', 2.15, 'hen_dof', 2.65),
  'Medidos en PROGRAMACION EJECUTADA BOGOTA SEPTIEMBRE-OCTUBRE 2026.xlsb el 2026-10-29',
  'Jornada 44/6 en las fórmulas (celda NOMINA!AI1) y 48/6 en la macro, igual que Pereira. Por validar con nómina.'
where not exists (
  select 1 from programacion.parametros_nomina where ciudad_id = 'bogota' and vigente_desde = date '2026-09-24');

-- Avancys: la operación de Bogotá es la zona CUNDINAMARCA del contrato (330 personas con contrato
-- vigente el 2026-10-29, de las cuales 324 en Bogotá D.C. y el resto en Cota, Funza, La Mesa y
-- Soacha). Su Excel tenía 329, así que la zona corresponde a la operación.
update programacion.integraciones
set config = jsonb_set(config, '{ciudades,bogota}',
      jsonb_build_object('grupos', jsonb_build_array('CUNDINAMARCA', 'Cundinamarca (CO)'),
                         'ciudades', '[]'::jsonb), true),
    actualizado_en = now()
where id = 'avancys';
