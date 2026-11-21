-- El lugar del empleado es su AGENCIA, no el departamento.
--
-- Cuando se escribió el mapeo (migración 0029) `hr.contract.subzone` estaba denegado, así que se usó
-- `zone_id`, que es el departamento, y se dedujo que "pereira = RISARALDA". El 2026-10-30 llegaron los
-- permisos nuevos y apareció `subzone_id`: **las nueve agencias de la empresa** (Pereira, Medellín,
-- Bogotá, Cali, Manizales, Armenia, Cartago, Valledupar, Barranquilla), declaradas en 3.141 de los
-- 3.144 contratos. Esa es la unidad operativa, y la deducción por departamento se quedaba corta:
--
--   ciudad     por departamento   por agencia
--   Pereira         1.186            1.188
--   Medellín          695              747
--   Bogotá            330              336
--
-- La diferencia tiene sentido operativo: la agencia de Medellín maneja también Barranquilla y
-- Valledupar, y la de Pereira maneja Cartago. Son personas que alguien programa desde esa agencia.
--
-- Se conserva `zone_id` en el filtro por si un contrato no trae agencia (3 de 3.144), y se dejan los
-- nombres de departamento del cliente, que es otro vocabulario y lo usa el cargue de clientes.

update programacion.integraciones
set config = jsonb_set(
      jsonb_set(config, '{empleados,lugar,campos,grupo}', '"subzone_id"'),
      '{ciudades}', jsonb_build_object(
        'pereira',  jsonb_build_object('grupos', jsonb_build_array('AGENCIA PEREIRA',  'RISARALDA',    'Risaralda (CO)'),    'ciudades', '[]'::jsonb),
        'medellin', jsonb_build_object('grupos', jsonb_build_array('AGENCIA MEDELLIN', 'ANTIOQUIA',    'Antioquia (CO)'),    'ciudades', '[]'::jsonb),
        'bogota',   jsonb_build_object('grupos', jsonb_build_array('AGENCIA BOGOTA',   'CUNDINAMARCA', 'Cundinamarca (CO)'), 'ciudades', '[]'::jsonb))),
    actualizado_en = now()
where id = 'avancys';
