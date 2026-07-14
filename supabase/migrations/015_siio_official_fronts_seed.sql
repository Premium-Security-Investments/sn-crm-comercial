-- 015_siio_official_fronts_seed.sql
-- Seed oficial de frentes SIIO / Sistema Interno de Inteligencia Operativa.
-- No ejecutar en producción sin revisión/aprobación; diseñado para alinear la nomenclatura F1-F6.

insert into public.siio_fronts (id, name, description, owner_role, status, source_id)
values
  ('F1', 'Gestión Comercial Inteligente', 'CRM comercial, pipeline, oportunidades, licitaciones, alertas, metas y señales comerciales accionables.', 'Comercial / Gerencia', 'activo', null),
  ('F2', 'Gestión Gerencial y Control', 'Centro de control gerencial para responsables, estados, prioridades, semáforos, bloqueos, riesgos, decisiones, compromisos y salidas ejecutivas.', 'Gerencia / Dirección', 'activo', null),
  ('F3', 'Gestión Operativa', 'Frente operativo general de Seguridad Nacional; agrupa operación diaria y capacidad futura de personal.', 'Operaciones / Talento Humano', 'diseño', null),
  ('F3A', 'Personal activo y operación diaria', 'Personal activo, operación diaria, cobertura, puestos, turnos, novedades, cumplimiento operativo y capacidad actual.', 'Operaciones', 'diseño', null),
  ('F3B', 'Reclutamiento, selección y contratación permanente', 'Vacantes, candidatos, reclutamiento, selección, contratación, tiempos de cubrimiento y capacidad futura.', 'Talento Humano / Operaciones', 'diseño', null),
  ('F4', 'Archivo Corporativo Inteligente', 'Fuentes, documentos, evidencia, trazabilidad, permisos de uso, restricciones, histórico institucional y memoria documental.', 'Administración / Gerencia / Archivo', 'activo', null),
  ('F5', 'Motor Interno de Razonamiento', 'Capa de razonamiento interno que cruza F1-F4, prioriza, infiere, explica, alerta y prepara decisiones.', 'Gerencia / IA', 'diseño', null),
  ('F6', 'Catálogo Institucional de Agentes', 'Inventario, gobierno y operación de agentes IA institucionales: propósito, dueño, permisos, fuentes autorizadas, acciones, canales, auditoría y estado.', 'Gerencia / IA / Tecnología', 'diseño', null)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  owner_role = excluded.owner_role,
  status = excluded.status,
  source_id = excluded.source_id,
  updated_at = now();
