/** Por qué el expediente sigue sin documentos, según el pipeline (tender-empty-discovery.js). */
export type TenderDocumentsPendingSource = {
  reason_code: string;
  reason?: string | null;
  next_check_at?: string | null;
  attempt?: number;
  parked?: boolean;
};

export type TenderDossierQueueInput = {
  document_count: number;
  missing_document_count: number;
  document_import_status: string;
  document_import_error?: string | null;
  dossier_error?: string | null;
  documents_pending_source?: TenderDocumentsPendingSource | null;
  decision?: 'go' | 'no_go' | null;
  preparation_status?: string | null;
  tender_offer_status?: string | null;
};

export type TenderDossierQueueState = {
  process: string;
  nextAction: string;
  error: string | null;
};

const BOGOTA_TIME = new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Bogota' });
const BOGOTA_DAY = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', timeZone: 'America/Bogota' });

/** "a las 11:20 p. m." si es hoy; con el día si cae mañana o después. Una fecha ilegible no inventa hora. */
function nextCheckAction(at: string | null | undefined, now: Date) {
  const date = at ? new Date(at) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Vig-IA vuelve a revisar automáticamente';
  const hora = BOGOTA_TIME.format(date);
  return BOGOTA_DAY.format(date) === BOGOTA_DAY.format(now)
    ? `Vig-IA vuelve a revisar a las ${hora}`
    : `Vig-IA vuelve a revisar el ${BOGOTA_DAY.format(date)} a las ${hora}`;
}

export function tenderDossierQueueState(dossier: TenderDossierQueueInput, { now = new Date() }: { now?: Date } = {}): TenderDossierQueueState {
  const error = dossier.dossier_error || dossier.document_import_error || null;
  if (error || ['fallo_importacion', 'error'].includes(dossier.document_import_status)) {
    return { process: 'Requiere atención', nextAction: 'Resolver error documental', error: error || 'El procesamiento documental reportó un error.' };
  }
  // Sin documentos porque la entidad todavía no los publicó NO es un expediente que alguien deba
  // completar: no hay nada que una persona pueda hacer, y el pipeline ya tiene cita para volver.
  // Pedirle "Completar o importar documentos" era mandarla a resolver algo que no está en su mano.
  const pendingSource = dossier.documents_pending_source || null;
  if (pendingSource) {
    if (pendingSource.parked) {
      return {
        process: 'Requiere atención',
        nextAction: 'La fuente oficial nunca publicó documentos',
        error: pendingSource.reason || 'La fuente oficial no publicó documentos en las revisiones previstas.',
      };
    }
    return {
      process: 'Esperando documentos de la entidad',
      nextAction: nextCheckAction(pendingSource.next_check_at, now),
      error: null,
    };
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
