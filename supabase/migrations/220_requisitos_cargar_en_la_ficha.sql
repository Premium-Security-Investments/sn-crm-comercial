-- 220 — Requisitos: lo que falta se carga en la ficha desde la tarjeta.
--
-- Juan Botero, 2026-11-15: «si la ficha no lo tiene significa que no lo tenemos» y «que al Katherine revisar la ficha
-- tenga la opción de cargar documentos y de una vez eso quede resuelto» («ok vamos con eso»). Dos piezas:
--
-- 1. `psi_company_requirement_facts`: los datos que un papel no dice por sí solo y que deciden si un pliego nos
--    inhabilita —cuántas armas con salvoconducto están libres, qué zonas cubre el permiso MinTIC, en qué ciudades
--    estamos inscritos en la Red de Apoyo, dónde hay unidad canina autorizada y el puntaje del SG-SST—. Los escribe
--    sólo el servidor, con quien decide GO/NO-GO, igual que el estado de las tarjetas (215).
-- 2. Cuatro bloques nuevos en el registro de evidencia, para que esos soportes tengan dónde cargarse (el tipo de
--    documento que se escoge al cargar ES el `entry_id`, ver 166): unidad canina, Red de Apoyo, autoevaluación del
--    SG-SST y registro de comercializador o soporte técnico. Abrir un bloque es un acto de gobierno del catálogo y por
--    eso viaja en una migración (la 061 dejó el registro sin INSERT para la aplicación).

begin;

create table if not exists public.psi_company_requirement_facts (
  fact_key text primary key check (fact_key in ('armas_libres', 'mintic_cobertura', 'red_apoyo_ciudades', 'unidad_canina_ciudades', 'sgsst_puntaje')),
  value jsonb not null,
  note text check (note is null or char_length(note) <= 500),
  updated_by uuid references public.psi_sales_profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.psi_company_requirement_facts enable row level security;
revoke all on table public.psi_company_requirement_facts from public, anon, authenticated, service_role;
grant select, insert, update on table public.psi_company_requirement_facts to service_role;

insert into public.psi_agt002_company_evidence_registry (
  entry_id, version, current, document_class, classification, estado_integracion, sensibilidad, source_reference,
  zona_almacenamiento, utilidad_decisional, accion_humana, human_gate, control_de_uso, metadata_only,
  vigente_para_habilitacion, existence_status, human_review_status, applicability_status, vigencia_text, expiry,
  integration_active, source_manifest_version, notes
)
select * from (values
  (
    'canine_unit', 1, true, 'Unidad o sede canina autorizada',
    'base_corporativa_reutilizable_con_actualizacion', 'BLOQUE_ABIERTO_PENDIENTE_CARGA_DEL_SOPORTE', 'corporativa_restringida',
    'Bloque abierto por decisión de Juan Botero (2026-11-15) desde la pestaña Requisitos. Los archivos entran por carga manual.',
    'base_maestra_restringida',
    'Habilita en los pliegos que piden unidad canina con resolución de la Supervigilancia, a veces cerca de la ciudad del contrato',
    'Gate: juridico_y_operaciones. Acción recomendada: cargar la resolución de cada unidad canina y anotar sus ciudades en la tarjeta.',
    'juridico_y_operaciones',
    'Uso interno exclusivo para apoyo a decisión; sin autoridad de presentación externa; sin aprobación final automática. Revalidar antes de cada oferta.',
    false, true, 'reported', 'pending_human_review', 'pending_case_validation',
    'Sin soporte cargado al abrir el bloque.', null, true, 'v0.3.3-requisitos-20261115',
    'Las ciudades de la unidad se guardan en psi_company_requirement_facts (unidad_canina_ciudades).'
  ),
  (
    'police_support_network', 1, true, 'Inscripción en la Red de Apoyo de la Policía',
    'base_corporativa_reutilizable_con_actualizacion', 'BLOQUE_ABIERTO_PENDIENTE_CARGA_DEL_SOPORTE', 'corporativa_restringida',
    'Bloque abierto por decisión de Juan Botero (2026-11-15) desde la pestaña Requisitos. Los archivos entran por carga manual.',
    'base_maestra_restringida',
    'Habilita en los pliegos que piden certificar la inscripción en la Red de Apoyo de la Policía de la ciudad del contrato',
    'Gate: juridico_y_operaciones. Acción recomendada: cargar la constancia de cada ciudad y anotar las ciudades en la tarjeta.',
    'juridico_y_operaciones',
    'Uso interno exclusivo para apoyo a decisión; sin autoridad de presentación externa; sin aprobación final automática. Revalidar antes de cada oferta.',
    false, true, 'reported', 'pending_human_review', 'pending_case_validation',
    'Sin soporte cargado al abrir el bloque.', null, true, 'v0.3.3-requisitos-20261115',
    'Las ciudades inscritas se guardan en psi_company_requirement_facts (red_apoyo_ciudades).'
  ),
  (
    'sgsst_self_assessment', 1, true, 'Autoevaluación del SG-SST',
    'base_corporativa_reutilizable_con_actualizacion', 'BLOQUE_ABIERTO_PENDIENTE_CARGA_DEL_SOPORTE', 'corporativa_restringida',
    'Bloque abierto por decisión de Juan Botero (2026-11-15) desde la pestaña Requisitos. Los archivos entran por carga manual.',
    'base_maestra_restringida',
    'Habilita en los pliegos que piden la autoevaluación del SG-SST por encima de un puntaje (Res. 0312), su registro ante el Ministerio del Trabajo y la constancia de la ARL',
    'Gate: juridico_y_talento_humano. Acción recomendada: cargar la autoevaluación del año con su porcentaje y anotar el puntaje en la tarjeta.',
    'juridico_y_talento_humano',
    'Uso interno exclusivo para apoyo a decisión; sin autoridad de presentación externa; sin aprobación final automática. Revalidar antes de cada oferta.',
    false, true, 'reported', 'pending_human_review', 'pending_case_validation',
    'Sin soporte cargado al abrir el bloque.', null, true, 'v0.3.3-requisitos-20261115',
    'El puntaje se guarda en psi_company_requirement_facts (sgsst_puntaje).'
  ),
  (
    'tech_support_registry', 1, true, 'Registro de comercializador o soporte técnico de equipos',
    'base_corporativa_reutilizable_con_actualizacion', 'BLOQUE_ABIERTO_PENDIENTE_CARGA_DEL_SOPORTE', 'corporativa_restringida',
    'Bloque abierto por decisión de Juan Botero (2026-11-15) desde la pestaña Requisitos. Los archivos entran por carga manual.',
    'base_maestra_restringida',
    'Habilita en los procesos de tecnología que piden el registro de comercializador ante la Supervigilancia o un taller de soporte técnico',
    'Gate: juridico_y_comercial. Acción recomendada: cargar el registro o la certificación del taller de soporte.',
    'juridico_y_comercial',
    'Uso interno exclusivo para apoyo a decisión; sin autoridad de presentación externa; sin aprobación final automática. Revalidar antes de cada oferta.',
    false, true, 'reported', 'pending_human_review', 'pending_case_validation',
    'Sin soporte cargado al abrir el bloque.', null, true, 'v0.3.3-requisitos-20261115',
    'Con el soporte cargado y vigente, la pestaña Requisitos da el registro por cumplido.'
  )
) as nuevo(
  entry_id, version, current, document_class, classification, estado_integracion, sensibilidad, source_reference,
  zona_almacenamiento, utilidad_decisional, accion_humana, human_gate, control_de_uso, metadata_only,
  vigente_para_habilitacion, existence_status, human_review_status, applicability_status, vigencia_text, expiry,
  integration_active, source_manifest_version, notes
)
where not exists (
  select 1 from public.psi_agt002_company_evidence_registry r where r.entry_id = nuevo.entry_id
);

do $$
declare v_abiertos integer;
begin
  select count(*) into v_abiertos
  from public.psi_agt002_company_evidence_registry
  where entry_id in ('canine_unit', 'police_support_network', 'sgsst_self_assessment', 'tech_support_registry')
    and current = true and integration_active = true;
  if v_abiertos <> 4 then
    raise exception 'Se esperaban 4 bloques vigentes y activos; hay %.', v_abiertos;
  end if;
end $$;

commit;
