-- Catorce municipios más en el mapa de puestos, asignados por departamento.
--
-- El cargue de puestos del 2026-11-03 dejó 48 en error porque su municipio no estaba en el mapa:
-- 29 de Armenia y 19 de pueblos donde ningún contrato de Avancys decía a qué agencia pertenecen.
-- La 0036 dedujo el mapa de los contratos; estos no tenían de dónde deducirse, así que se asignan
-- por el departamento, con la aprobación de Juan Botero el 2026-11-04:
--
--   Risaralda → Pereira:      Quinchía (la 0036 lo había dejado fuera porque sus contratos están
--                             repartidos entre dos agencias; Juan decidió que va con Pereira).
--   Antioquia → Medellín:     Envigado, Guarne, Támesis.
--   Valle → Cali:             La Victoria, El Dovio, La Paila, Ginebra, Cerrito, Restrepo.
--   Cauca → Cali:             Miranda (por confirmar: es del Cauca, no del Valle).
--   Caldas → Manizales:       Pácora, Palestina, Salamina.
--
-- Montenegro y Barcelona son del Quindío y quedan por fuera, igual que Armenia, hasta que se decida
-- si Armenia se abre como ciudad.
--
-- Los nombres van como los escribe Avancys (sin tildes), que es contra lo que se compara.

update programacion.integraciones i
set config = jsonb_set(i.config, '{municipios}', (
      select jsonb_object_agg(ciudad, (
               select jsonb_agg(distinct m order by m)
               from (select jsonb_array_elements_text(coalesce(i.config->'municipios'->ciudad, '[]'::jsonb)) m
                     union select jsonb_array_elements_text(coalesce(nuevos->ciudad, '[]'::jsonb))) t))
      from (select jsonb_build_object(
                     'pereira',   jsonb_build_array('Quinchia'),
                     'medellin',  jsonb_build_array('Envigado', 'Guarne', 'Tamesis'),
                     'cali',      jsonb_build_array('La Victoria', 'El Dovio', 'La Paila', 'Ginebra', 'Cerrito', 'Restrepo', 'Miranda'),
                     'manizales', jsonb_build_array('Pacora', 'Palestina', 'Salamina')) nuevos) n,
           lateral (select jsonb_object_keys(i.config->'municipios') ciudad) c), true),
    actualizado_en = now()
where i.id = 'avancys';
