-- 016_siio_initial_executive_snapshot_seed.sql
-- Primer snapshot ejecutivo real y redacted para F2/F4.
-- Fuentes: PYG abril 2026 (SRC-011) y nómina administrativa junio 2026 (SRC-012).
-- NO ejecutar en producción sin revisión/aprobación explícita.

alter table public.siio_payroll_aggregates
  add column if not exists net_total numeric;

create unique index if not exists uq_siio_financial_metric_period_concept_source
  on public.siio_financial_metrics(period_month, concept, source_id);

create unique index if not exists uq_siio_payroll_period_area_source
  on public.siio_payroll_aggregates(period_month, area, source_id);

update public.siio_sources
set
  trust_level = 'oficial_requiere_validacion',
  restrictions = 'Información financiera agregada. Validar cifras y periodo con el responsable financiero antes de publicación ejecutiva.',
  update_frequency = 'mensual',
  related_fronts = array['F2','F4','F5'],
  updated_at = now()
where id = 'SRC-011';

update public.siio_sources
set
  trust_level = 'restringida',
  restrictions = 'Contiene datos personales y compensación individual en origen. SIIO solo puede almacenar y mostrar agregados por área; prohibido exponer nombres, cédulas, cargos o valores individuales.',
  update_frequency = 'mensual',
  related_fronts = array['F2','F4','F5'],
  updated_at = now()
where id = 'SRC-012';

update public.siio_sources
set
  trust_level = 'referencia',
  restrictions = 'Salida histórica de Junta. No es fuente de verdad para cifras; se utiliza como referencia de estructura y narrativa.',
  update_frequency = 'mensual',
  related_fronts = array['F2','F4'],
  updated_at = now()
where id = 'SRC-013';

insert into public.siio_financial_metrics
  (period_month, category, concept, value_current, value_comparison, variation_abs, variation_pct, source_id, validated_by, notes)
values
  ('2026-04-01', 'ingresos', 'INGRESOS', 51845041733.9301, 33046110285.452198, 18798931448.4779, 0.5688697182843242, 'SRC-011', null, 'Extraído de Comparat; pendiente validación humana antes de publicación.'),
  ('2026-04-01', 'costos_gastos', 'COSTOS', 41762668877.77, 25997203539.6196, 15765465338.150398, 0.6064292766767746, 'SRC-011', null, 'Extraído de Comparat; pendiente validación humana antes de publicación.'),
  ('2026-04-01', 'costos_gastos', 'GASTOS', 7268109190.9895, 6077665816.01, 1190443374.9794998, 0.1958718052321324, 'SRC-011', null, 'Extraído de Comparat; pendiente validación humana antes de publicación.'),
  ('2026-04-01', 'resultado', 'UTILIDAD OPERACIONAL', 2814263665.170603, 971240929.8225994, 1843022735.3480034, 1.897595826902227, 'SRC-011', null, 'Extraído de Comparat; pendiente validación humana antes de publicación.'),
  ('2026-04-01', 'margen', 'MARGEN OPERACIONAL', 0.05428221428798276, 0.029390476562385807, 0, 0, 'SRC-011', null, 'Extraído de Comparat; pendiente validación humana antes de publicación.'),
  ('2026-04-01', 'resultado', 'NO OPERACIONAL', -703272157.21, -267302535.05999997, -435969622.1500001, 1.630996960250079, 'SRC-011', null, 'Extraído de Comparat; pendiente validación humana antes de publicación.'),
  ('2026-04-01', 'costos_gastos', 'IMPUESTOS', 844396603.1842409, 281575357.90503883, 562821245.2792021, 1.9988299028248535, 'SRC-011', null, 'Extraído de Comparat; pendiente validación humana antes de publicación.'),
  ('2026-04-01', 'resultado', 'UTILIDAD NETA', 1266594904.776362, 422363036.85756063, 844231867.9188013, 1.9988299028248377, 'SRC-011', null, 'Extraído de Comparat; pendiente validación humana antes de publicación.'),
  ('2026-04-01', 'margen', 'MARGEN NETO', 0.024430396088338687, 0.012781021221837911, 0, 0, 'SRC-011', null, 'Extraído de Comparat; pendiente validación humana antes de publicación.')
on conflict (period_month, concept, source_id) do update set
  category = excluded.category,
  value_current = excluded.value_current,
  value_comparison = excluded.value_comparison,
  variation_abs = excluded.variation_abs,
  variation_pct = excluded.variation_pct,
  validated_by = excluded.validated_by,
  notes = excluded.notes,
  updated_at = now();

insert into public.siio_payroll_aggregates
  (period_month, area, total_people, total_accrued, total_deductions, net_total, variation_abs, alert, source_id, visibility_level)
values
  ('2026-06-01', 'Agencia Bogota', 6, 20879354, 1332204, 19547150, null, null, 'SRC-012', 'junta_agregado'),
  ('2026-06-01', 'Agencia Cali', 3, 6942275, 720754, 6221521, null, null, 'SRC-012', 'junta_agregado'),
  ('2026-06-01', 'Agencia Manizales', 3, 13681045, 1878408, 11802637, null, null, 'SRC-012', 'junta_agregado'),
  ('2026-06-01', 'Agencia Medellin', 8, 17243518, 1878180, 15365338, null, 'El total neto de origen no coincide con devengado menos deducciones; diferencia -4349095.00. Validar fuente.', 'SRC-012', 'junta_agregado'),
  ('2026-06-01', 'Comercial Electronica', 3, 14505290, 1710240, 12795050, null, null, 'SRC-012', 'junta_agregado'),
  ('2026-06-01', 'Comercial Vigilancia', 5, 52980985, 8069126, 44911859, null, null, 'SRC-012', 'junta_agregado'),
  ('2026-06-01', 'Contabilidad', 14, 39655425, 5307134, 34348291, null, null, 'SRC-012', 'junta_agregado'),
  ('2026-06-01', 'Gerencia', 6, 74329810, 17321489, 57008321, null, null, 'SRC-012', 'junta_agregado'),
  ('2026-06-01', 'Gestión Humana', 23, 60706916, 8615257, 52091659, null, null, 'SRC-012', 'junta_agregado'),
  ('2026-06-01', 'Seguridad Electronica', 48, 151401933, 17057026.88, 134344906.12, null, null, 'SRC-012', 'junta_agregado'),
  ('2026-06-01', 'Sistemas Integrados', 6, 20667525, 2886611, 17780914, null, null, 'SRC-012', 'junta_agregado'),
  ('2026-06-01', 'Vigilancia Fisica', 32, 116011071, 13641673, 102369398, null, null, 'SRC-012', 'junta_agregado')
on conflict (period_month, area, source_id) do update set
  total_people = excluded.total_people,
  total_accrued = excluded.total_accrued,
  total_deductions = excluded.total_deductions,
  net_total = excluded.net_total,
  variation_abs = excluded.variation_abs,
  alert = excluded.alert,
  visibility_level = excluded.visibility_level,
  updated_at = now();
