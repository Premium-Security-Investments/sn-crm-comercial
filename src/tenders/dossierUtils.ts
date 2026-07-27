export type TenderDossierQueueInput = {
  document_count: number;
  missing_document_count: number;
  document_import_status: string;
  document_import_error?: string | null;
  dossier_error?: string | null;
  decision?: 'go' | 'no_go' | null;
  preparation_status?: string | null;
  tender_offer_status?: string | null;
};

export type TenderDossierQueueState = {
  process: string;
  nextAction: string;
  error: string | null;
};

export function tenderDossierQueueState(dossier: TenderDossierQueueInput): TenderDossierQueueState {
  const error = dossier.dossier_error || dossier.document_import_error || null;
  if (error || ['fallo_importacion', 'error'].includes(dossier.document_import_status)) {
    return { process: 'Requiere atención', nextAction: 'Resolver error documental', error: error || 'El procesamiento documental reportó un error.' };
  }
  if (dossier.missing_document_count > 0 || dossier.document_import_status === 'pendiente_documentos') {
    return { process: 'Expediente incompleto', nextAction: 'Completar o importar documentos', error: null };
  }
  if (dossier.document_import_status === 'documentos_cargados') {
    return { process: 'Análisis pendiente', nextAction: 'Generar o actualizar el preanálisis', error: null };
  }
  if (!dossier.decision) {
    return { process: 'Decisión humana pendiente', nextAction: 'Revisar análisis y decidir GO / NO GO', error: null };
  }
  if (dossier.decision === 'no_go') {
    return { process: 'Cerrada por decisión humana', nextAction: 'Sin acción operativa pendiente', error: null };
  }
  if (!dossier.preparation_status || dossier.preparation_status === 'pendiente') {
    return { process: 'GO autorizado; preparación pendiente', nextAction: 'Iniciar preparación de oferta', error: null };
  }
  if (dossier.tender_offer_status === 'presentada') {
    return { process: 'Oferta presentada', nextAction: 'Registrar resultado cuando sea oficial', error: null };
  }
  return { process: 'Oferta en preparación', nextAction: 'Completar pendientes humanos y checklist', error: null };
}
