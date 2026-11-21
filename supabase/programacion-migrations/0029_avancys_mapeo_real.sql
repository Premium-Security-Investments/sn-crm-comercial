-- Mapeo real de Avancys, medido contra la instancia de producción el 2026-10-29 (solo lectura).
-- El mapeo que había era el de Odoo estándar, escrito el 2026-10-10 sin tener acceso a la instancia.
-- Tres de sus campos estaban equivocados y uno no existe:
--   * clientes.nit: `vat` lo tiene 1 cliente de 1.439; el NIT vive en `ref_num` (1.432 de 1.439),
--     con el tipo en `ref_type_id` y el dígito de verificación aparte en `verification_code`;
--   * empleados.telefono: `mobile_phone` ("Work Mobile") está en 2.665 de 3.133; `cellphone`
--     ("Celular") está en 3.033;
--   * empleados.ciudad: `work_location_id` NO EXISTE en esta instancia. El empleado no tiene ciudad:
--     la ciudad está en su contrato (`hr.contract.work_city_id`, 3.140 de 3.141) junto con la zona
--     (`zone_id`, 3.138 de 3.141). Ningún empleado tiene dos contratos abiertos, así que el contrato
--     vigente es una sola respuesta.
-- Y la ciudad de Programación corresponde a la ZONA del contrato, no al municipio: "pereira" es la
-- operación de Risaralda (1.287 contratos: Pereira 1.084, Dosquebradas 60, Armenia 38, Cartago 25,
-- Santa Rosa 17, La Virginia 17 y doce municipios más). Por eso el filtro se declara por ciudad de
-- Programación y acepta los nombres de los dos vocabularios: la zona del contrato (RISARALDA) y el
-- departamento del cliente (Risaralda (CO)).

insert into programacion.integraciones (id, activa, config)
select 'avancys', false, '{}'::jsonb
where not exists (select 1 from programacion.integraciones where id = 'avancys');

update programacion.integraciones set config = jsonb_build_object(
  'tipo', 'odoo_jsonrpc',
  'medido_en', '2026-10-29',
  'empleados', jsonb_build_object(
    'modelo', 'hr.employee',
    'dominio', '[]'::jsonb,
    'campos', jsonb_build_object(
      'documento', 'identification_id', 'nombre', 'name', 'cargo', 'job_id',
      'telefono', 'cellphone', 'activo', 'active', 'fecha_ingreso', 'first_contract_date'),
    'lugar', jsonb_build_object(
      'desde', 'hr.contract',
      'campos', jsonb_build_object('registro', 'employee_id', 'ciudad', 'work_city_id', 'grupo', 'zone_id', 'estado', 'state'),
      'estadoVigente', 'open')),
  'clientes', jsonb_build_object(
    'modelo', 'res.partner',
    'dominio', '[["customer_rank", ">", 0]]'::jsonb,
    'campos', jsonb_build_object('nit', 'ref_num', 'razon_social', 'name', 'activo', 'active'),
    'lugar', jsonb_build_object(
      'desde', 'propio',
      'campos', jsonb_build_object('ciudad', 'city_id', 'grupo', 'state_id'))),
  'ciudades', jsonb_build_object(
    'pereira', jsonb_build_object('grupos', jsonb_build_array('RISARALDA', 'Risaralda (CO)'), 'ciudades', '[]'::jsonb),
    'medellin', jsonb_build_object('grupos', jsonb_build_array('ANTIOQUIA', 'Antioquia (CO)'), 'ciudades', '[]'::jsonb)),
  'nota', 'Mapeo medido contra Avancys (Odoo 14) el 2026-10-29 con search_count, read_group y fields_get. '
       || 'Avancys no dice quién se retiró: departure_date está en 0 de 3.133 y solo 4 empleados están '
       || 'inactivos, así que el cargue no retira a nadie: quien no venga queda marcado para revisar. '
       || 'Odoo 14 está fuera de soporte; si el proveedor actualiza, hay que volver a medir este mapeo.'
), actualizado_en = now() where id = 'avancys';
