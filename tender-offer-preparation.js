export function genericTenderOfferDocuments(opportunity, analysis) {
  const sourceLabel = opportunity?.observaciones?.includes('esucontratacion.com') ? 'ESU' : opportunity?.observaciones?.includes('secop') ? 'SECOP' : 'Fuente oficial';
  return [
    { key: 'indice_expediente', name: 'Índice del expediente', folder: '00_Control', status: 'planificado_para_generacion', owner: 'Sistema', output: 'Indice_Expediente.docx', reusable: true },
    { key: 'checklist_maestro', name: 'Checklist maestro de documentos', folder: '00_Control', status: 'planificado_para_generacion', owner: 'Sistema', output: 'Checklist_Maestro.xlsx', reusable: true },
    { key: 'matriz_cumplimiento', name: 'Matriz de cumplimiento', folder: '00_Control', status: 'planificado_para_generacion', owner: 'Sistema', output: 'Matriz_Cumplimiento.xlsx', reusable: true },
    { key: 'resumen_gerencia', name: 'Resumen para gerencia', folder: '00_Control', status: 'planificado_para_generacion', owner: 'Sistema', output: 'Resumen_Gerencia.docx', reusable: true },
    { key: 'carta_presentacion', name: 'Carta de presentación', folder: '09_Borradores_IA', status: 'planificado_borrador_requiere_revision', owner: 'Licitaciones', output: 'Carta_Presentacion_Borrador.docx', reusable: true },
    { key: 'declaracion_no_inhabilidades', name: 'Declaración de no inhabilidades', folder: '09_Borradores_IA', status: 'planificado_borrador_requiere_revision', owner: 'Jurídico', output: 'Declaracion_No_Inhabilidades_Borrador.docx', reusable: true },
    { key: 'solicitud_poliza', name: 'Solicitud de póliza de seriedad a aseguradora', folder: '09_Borradores_IA', status: 'planificado_borrador_requiere_revision', owner: 'Jurídico / Aseguradora', output: 'Solicitud_Poliza_Aseguradora.docx', reusable: true },
    { key: 'correo_contabilidad', name: 'Correo a contabilidad con pendientes financieros', folder: '09_Borradores_IA', status: 'planificado_borrador_requiere_revision', owner: 'Contabilidad', output: 'Correo_Contabilidad.docx', reusable: true },
    { key: 'correo_juridico', name: 'Correo a jurídico con pendientes legales', folder: '09_Borradores_IA', status: 'planificado_borrador_requiere_revision', owner: 'Jurídico', output: 'Correo_Juridico.docx', reusable: true },
    { key: 'propuesta_tecnica_base', name: 'Propuesta técnica base', folder: '09_Borradores_IA', status: analysis?.commercial_fit?.status === 'Encaje detectado' ? 'planificado_borrador_requiere_ajuste' : 'pendiente_informacion', owner: 'Operaciones / Comercial', output: 'Propuesta_Tecnica_Base.docx', reusable: false },
    { key: 'documentos_oficiales', name: `Copia de documentos oficiales ${sourceLabel}`, folder: '01_Documentos_Oficiales', status: 'pendiente_sincronizar_sharepoint', owner: 'Sistema', output: 'Documentos oficiales descargados', reusable: false },
  ];
}

export function tenderOfferFolderStructure(opportunity) {
  const safeName = String(opportunity?.company_name || 'Licitacion').replace(/[^\p{L}\p{N}\s_-]+/gu, '').trim().slice(0, 80) || 'Licitacion';
  return {
    root_name: `Licitaciones SN/${new Date().getFullYear()}/${safeName}`,
    folders: ['00_Control', '01_Documentos_Oficiales', '02_Juridico', '03_Financiero', '04_Tecnico', '05_Experiencia', '06_Economico', '07_Polizas', '08_Formatos_Entidad', '09_Borradores_IA', '10_Final_Para_Revision', '11_Presentado'],
  };
}

export function buildTenderOfferPreparation(opportunity, documents = [], analysis = null, currentProfile = {}) {
  const planned_documents = genericTenderOfferDocuments(opportunity, analysis);
  const human_required_items = [
    { key: 'validar_experiencia', title: 'Seleccionar experiencia específica aplicable', owner: 'Licitaciones / Comercial', priority: 'alta', status: 'requiere_intervencion_humana', reason: 'El sistema puede sugerir contratos, pero la experiencia final debe aprobarse humanamente.' },
    { key: 'validar_financiero', title: 'Confirmar indicadores financieros y capital de trabajo', owner: 'Contabilidad', priority: 'alta', status: 'requiere_intervencion_humana', reason: 'Debe cruzarse contra estados financieros/RUP vigente.' },
    { key: 'poliza_seriedad', title: 'Solicitar y validar póliza de seriedad', owner: 'Jurídico / Aseguradora', priority: 'alta', status: 'requiere_tercero', reason: 'Depende de aseguradora y requiere valor/vigencia correctos.' },
    { key: 'camara_comercio', title: 'Cargar Cámara de Comercio actualizada', owner: 'Jurídico', priority: 'media', status: 'requiere_documento', reason: 'Documento genérico recurrente que debe mantenerse vigente.' },
    { key: 'propuesta_economica', title: 'Definir y aprobar propuesta económica', owner: 'Comercial / Gerencia', priority: 'alta', status: 'requiere_decision', reason: 'El sistema no debe definir valores finales sin aprobación.' },
    { key: 'revision_borradores', title: 'Revisar cartas y declaraciones después de su generación', owner: 'Licitaciones', priority: 'media', status: 'requiere_revision', reason: 'Los futuros borradores IA requerirán revisión y firma.' },
  ];
  const assistant_notes = [
    'Generar el paquete documental planificado en una etapa posterior y registrar cada archivo real.',
    'Necesitamos intervención humana para experiencia específica, financieros, póliza, propuesta económica y documentos vencibles.',
    'Los documentos genéricos reutilizables deben mantenerse actualizados y copiarse a cada expediente nuevo.',
  ];
  return {
    kind: 'tender_offer_preparation', status: 'preparacion_oferta', approved_at: new Date().toISOString(),
    approved_by: currentProfile.full_name || currentProfile.microsoft_email || currentProfile.id || 'Sistema',
    opportunity_id: opportunity.id, opportunity_name: opportunity.company_name,
    source_summary: { expected_close_date: opportunity.expected_close_date || null, offer_value: opportunity.offer_value || 0, decision: analysis?.recommendation || analysis?.go_no_go?.decision || 'Preparación aprobada por gerencia' },
    sharepoint_folder: { status: 'pendiente_configurar_integracion', provider: 'SharePoint / OneDrive', url: null, ...tenderOfferFolderStructure(opportunity) },
    planned_documents, human_required_items, assistant_notes,
    checklist_summary: { total: planned_documents.length + human_required_items.length, planned: planned_documents.length, human_required: human_required_items.length, official_documents: documents.length, has_analysis: !!analysis },
    control_message: `Plan de preparación registrado: ${planned_documents.length} documentos por generar y ${human_required_items.length} pendientes humanos críticos.`,
  };
}
