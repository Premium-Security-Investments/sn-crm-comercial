-- 166 — Tres bloques nuevos en el registro de evidencia empresarial.
--
-- Autorización de Juan Botero, 2026-10-30: "Autorizo abrir tres bloques nuevos en el registro de evidencia
-- empresarial. Es lo primero de hoy: bloquea siete documentos que ya tenemos en la mano y 250 de los 1.000 puntos de
-- Terminal, que cierra el 4 de noviembre."
--
-- Por qué una migración y no una escritura de la aplicación: la 061 dejó el registro **sin INSERT para
-- `service_role`** a propósito —la aplicación puede registrar la decisión humana sobre un bloque, pero no inventar
-- bloques—, y eso no se toca. Abrir un bloque es un acto de gobierno del catálogo y por eso viaja en una migración,
-- firmada y reversible.
--
-- Qué desbloquea, en concreto: el tipo de documento que una persona escoge al cargar en la pantalla de Empresa **es**
-- el `entry_id` de este registro (`/api/tender-company-document-process-upload` pasa `metadata.documentType` como
-- `entryId` a `recordUploadAsVerification`). Sin bloque no hay dónde cargar, y los siete documentos tendrían que
-- entrar como "Otro", que es trabajo que después hay que repetir.
--
-- Los tres nacen `reported` / `pending_human_review`, que es lo cierto: los datos están verificados contra los PDF
-- originales, pero el archivo todavía no está cargado. Al cargarlo, la ficha queda aprobada y amarrada a ESE
-- documento (158 y 159), sin que esta migración tenga que anticipar nada.
--
-- Una nota sobre la vigencia, porque aquí es fácil equivocarse: `expiry` de este registro **no se puede actualizar
-- desde la aplicación** (la 158 abrió sólo las columnas de la decisión humana). La fecha que manda en cada oferta es
-- la del documento cargado (`psi_company_procurement_documents.expires_at`), y así la lee el puente de la ficha de
-- empresa. El `expiry` del bloque es la foto del manifiesto: para `quality_certifications` se pone **la más próxima a
-- vencer**, que es la del BASC.

begin;

insert into public.psi_agt002_company_evidence_registry (
  entry_id, version, current, document_class, classification, estado_integracion, sensibilidad, source_reference,
  zona_almacenamiento, utilidad_decisional, accion_humana, human_gate, control_de_uso, metadata_only,
  vigente_para_habilitacion, existence_status, human_review_status, applicability_status, vigencia_text, expiry,
  integration_active, source_manifest_version, notes
)
select * from (values
  (
    'quality_certifications', 1, true, 'Certificaciones de calidad',
    'base_corporativa_reutilizable_con_actualizacion', 'BLOQUE_ABIERTO_PENDIENTE_CARGA_DEL_SOPORTE',
    'corporativa_restringida',
    'Bloque abierto por decisión de Juan Botero (2026-10-30); datos verificados contra los PDF originales. Los archivos entran por carga manual.',
    'base_maestra_restringida',
    'Puntaje en los pliegos que lo califican (250 de los 1.000 puntos en TT-SPO-07-2026); revalidar vigencia antes de cada oferta',
    'Gate: juridico_y_comercial. Acción recomendada: cargar el BASC y las tres ISO vigentes y vigilar el vencimiento más próximo.',
    'juridico_y_comercial',
    'Uso interno exclusivo para apoyo a decisión; sin autoridad de presentación externa; sin aprobación final automática. Conservar original restringido; publicar sólo metadatos y estado en capa general. El estado ''vigente'' observado no constituye aprobación final; revalidar antes de cada oferta.',
    false,
    -- Suma puntos, no habilita: un pliego que no las califique no se cae por no tenerlas.
    false,
    'reported', 'pending_human_review', 'pending_case_validation',
    'BASC Versión 6-2022 N.º COLPEI00007-1-21, expedido 2026-06-17, vence 2027-06-17 (World BASC Organization). ISO 9001 CO25.07944, ISO 14001 CO25.07945 e ISO 45001 CO25.07946, las tres de BVQI (Bureau Veritas), expedidas 2025-12-23, vencen 2028-12-22, con alcance de vigilancia fija y móvil, escolta, con y sin armas y medios tecnológicos. El BASC es el primero en caer.',
    date '2027-06-17',
    true, 'v0.3.2-bloques-nuevos-20261030',
    'Cuatro certificados en un solo bloque: la fecha del bloque es la más próxima a vencer. La vigencia que manda en cada oferta es la del documento cargado.'
  ),
  (
    'agency_authorizations', 1, true, 'Autorizaciones de agencia por ciudad',
    'base_corporativa_reutilizable', 'BLOQUE_ABIERTO_PENDIENTE_CARGA_DEL_SOPORTE', 'corporativa_restringida',
    'Bloque abierto por decisión de Juan Botero (2026-10-30); resoluciones verificadas contra los actos originales. Los archivos entran por carga manual.',
    'base_maestra_restringida',
    'Acreditar la agencia en la ciudad del proceso; una ciudad puede estar acreditada por resolución propia o por la tabla de agencias de la licencia de funcionamiento',
    'Gate: juridico_y_comercial. Acción recomendada: cargar las resoluciones de Bogotá, Medellín y Cali y enlazarlas a su sede.',
    'juridico_y_comercial',
    'Uso interno exclusivo para apoyo a decisión; sin autoridad de presentación externa; sin aprobación final automática. Conservar original restringido; publicar sólo metadatos y estado en capa general. El estado ''vigente'' observado no constituye aprobación final; revalidar antes de cada oferta.',
    false,
    -- La agencia en la ciudad sí habilita: sin ella no se puede operar allí.
    true,
    'reported', 'pending_human_review', 'pending_case_validation',
    'Resoluciones de la SuperVigilancia que NO vencen: Bogotá 2020-0049297 (2020-08-27), Medellín 20244100009267 y Cali 20244100009287 (ambas 2024-02-07). Pereira, Cartago y Manizales no tienen resolución propia: están amparadas en la tabla de agencias de la licencia de funcionamiento (Res. 20194100030597). En Medellín manda la de 2024: la agencia de 2014 se cerró a solicitud de la empresa en 2019.',
    null,
    true, 'v0.3.2-bloques-nuevos-20261030',
    'Dos formas válidas de acreditar una ciudad —resolución propia o amparo en la licencia— y las dos valen. No confundir con la licencia de funcionamiento, que es su propio bloque.'
  ),
  (
    'chamber_of_commerce', 1, true, 'Cámara de Comercio',
    'base_corporativa_reutilizable_con_actualizacion', 'BLOQUE_ABIERTO_PENDIENTE_CARGA_DEL_SOPORTE',
    'corporativa_restringida',
    'Bloque abierto por decisión de Juan Botero (2026-10-30). Hueco detectado al construir el puente ficha de empresa → expediente: lo piden los tres pliegos vivos y no tenía bloque.',
    'base_maestra_restringida',
    'Existencia y representación legal; los pliegos la exigen con expedición reciente (15, 30, 60 o 90 días según el proceso)',
    'Gate: juridico. Acción recomendada: cargar el certificado vigente y repetirlo cuando el pliego exija uno más reciente.',
    'juridico',
    'Uso interno exclusivo para apoyo a decisión; sin autoridad de presentación externa; sin aprobación final automática. Conservar original restringido; publicar sólo metadatos y estado en capa general. El estado ''vigente'' observado no constituye aprobación final; revalidar antes de cada oferta.',
    false,
    true,
    'reported', 'pending_human_review', 'pending_case_validation',
    'El certificado no vence por sí mismo: lo que caduca es su antigüedad frente a lo que exige cada pliego. Los dos soportes anteriores (2026-09-01 y 2026-10-06) están cargados bajo el tipo legado "certificado".',
    null,
    true, 'v0.3.2-bloques-nuevos-20261030',
    'Los dos soportes anteriores se conservan bajo el tipo legado "certificado" y el puente los sigue reconociendo; lo nuevo entra ya con este bloque.'
  )
) as nuevo(
  entry_id, version, current, document_class, classification, estado_integracion, sensibilidad, source_reference,
  zona_almacenamiento, utilidad_decisional, accion_humana, human_gate, control_de_uso, metadata_only,
  vigente_para_habilitacion, existence_status, human_review_status, applicability_status, vigencia_text, expiry,
  integration_active, source_manifest_version, notes
)
-- Idempotente y prudente: si el bloque ya existe —por esta migración repetida o por cualquier otro camino— no se
-- inserta otra versión ni se pisa lo que haya decidido una persona.
where not exists (
  select 1 from public.psi_agt002_company_evidence_registry r where r.entry_id = nuevo.entry_id
);

-- Falla ruidosamente si el registro no quedó como se esperaba, en vez de dejar un bloque a medias que nadie note.
do $$
declare v_abiertos integer;
begin
  select count(*) into v_abiertos
  from public.psi_agt002_company_evidence_registry
  where entry_id in ('quality_certifications', 'agency_authorizations', 'chamber_of_commerce')
    and current = true and integration_active = true;
  if v_abiertos <> 3 then
    raise exception 'Se esperaban 3 bloques vigentes y activos; hay %.', v_abiertos;
  end if;
end $$;

commit;
