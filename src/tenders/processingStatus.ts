import { VIGIA_VISIBLE_NAMES } from '../vigia/agentIdentity';

type ProcessingStatusSnapshot = { job_id: string | null; status: string };

type ProcessingPresentationStatus = {
  job_id: string | null;
  status: string;
  idempotency_key?: string | null;
  analysis_run_id?: string | null;
  updated_at?: string | null;
};

export type TenderProcessingPrimaryAction = 'normal' | 'disabled' | 'hidden';

export type TenderProcessingPresentation = {
  visible: boolean;
  tone: 'status' | 'error';
  message: string;
  primaryAction: TenderProcessingPrimaryAction;
  showRetry: boolean;
};

type AnalysisPresentationStatus = {
  run_id?: string | null;
  status?: string | null;
  current?: boolean | null;
  completed_at?: string | null;
  created_at?: string | null;
  generated_at?: string | null;
};

const TERMINAL_STATUSES = new Set(['no_job', 'completed', 'cancelled', 'needs_attention']);
const SUPERSEDEABLE_PRESENTATION_STATUSES = new Set([
  'completed',
  'cancelled',
  'needs_attention',
  'waiting_agent_capacity',
  'retry_wait',
]);

const STATUS_LABELS: Record<string, string> = {
  no_job: 'Sin procesamiento pendiente',
  queued: 'En cola para procesamiento inmediato',
  discovering_documents: 'Descubriendo documentos oficiales',
  importing_documents: 'Importando y verificando documentos',
  building_snapshot: 'Construyendo el snapshot documental',
  waiting_agent_capacity: `${VIGIA_VISIBLE_NAMES.tenders} no está disponible todavía; el análisis permanece en cola`,
  analyzing: `${VIGIA_VISIBLE_NAMES.tenders} está analizando el expediente`,
  retry_wait: 'En espera de reintento automático',
  needs_attention: 'Requiere intervención humana',
  completed: 'Procesamiento completado',
  cancelled: 'Procesamiento cancelado',
};

export function tenderProcessingLabel(status: string | null | undefined) {
  const normalized = String(status || 'unknown').trim() || 'unknown';
  return STATUS_LABELS[normalized] || `Estado técnico: ${normalized}`;
}

export function isTenderProcessingActive(status: string | null | undefined) {
  return !TERMINAL_STATUSES.has(String(status || 'no_job'));
}

export function isTenderProcessingSuperseded(
  processingStatus: ProcessingPresentationStatus | null | undefined,
  analysis: AnalysisPresentationStatus | null | undefined,
) {
  if (!processingStatus || !analysis || analysis.status !== 'completed' || analysis.current !== true) return false;
  if (!SUPERSEDEABLE_PRESENTATION_STATUSES.has(processingStatus.status)) return false;
  if (processingStatus.analysis_run_id && analysis.run_id && processingStatus.analysis_run_id === analysis.run_id) return true;

  const analysisCompletedAt = analysis.completed_at || analysis.created_at || analysis.generated_at;
  const analysisCompletedAtMs = analysisCompletedAt ? Date.parse(analysisCompletedAt) : Number.NaN;
  const processingUpdatedAtMs = processingStatus.updated_at ? Date.parse(processingStatus.updated_at) : Number.NaN;
  return Number.isFinite(analysisCompletedAtMs)
    && Number.isFinite(processingUpdatedAtMs)
    && analysisCompletedAtMs >= processingUpdatedAtMs;
}

const NO_DURABLE_SIGNAL_STATUSES = new Set(['no_job', 'completed', 'cancelled']);
const HIDDEN_PRESENTATION: TenderProcessingPresentation = { visible: false, tone: 'status', message: '', primaryAction: 'normal', showRetry: false };

/**
 * Collapses the durable job status plus the current analysis into the single body signal
 * TenderAnalysisSection may show — never raw counts/step/ids, and never alongside a
 * duplicate "Sin documentos"/"Análisis pendiente" placeholder for the same condition.
 */
export function deriveTenderProcessingPresentation(
  processingStatus: ProcessingPresentationStatus | null | undefined,
  analysis: AnalysisPresentationStatus | null | undefined,
): TenderProcessingPresentation {
  if (!processingStatus) return HIDDEN_PRESENTATION;
  const status = String(processingStatus.status || 'no_job');
  if (NO_DURABLE_SIGNAL_STATUSES.has(status)) return HIDDEN_PRESENTATION;
  if (isTenderProcessingSuperseded(processingStatus, analysis)) return HIDDEN_PRESENTATION;

  if (status === 'waiting_agent_capacity') {
    return {
      visible: true,
      tone: 'status',
      message: `${VIGIA_VISIBLE_NAMES.tenders} está esperando capacidad disponible; el análisis continuará automáticamente en cuanto haya cupo, sin necesidad de una nueva acción.`,
      primaryAction: 'disabled',
      showRetry: false,
    };
  }

  if (status === 'retry_wait' || status === 'needs_attention') {
    return {
      visible: true,
      tone: status === 'needs_attention' ? 'error' : 'status',
      message: status === 'needs_attention'
        ? 'El procesamiento automático no pudo continuar y requiere intervención humana antes de reintentarlo.'
        : 'El procesamiento quedó en espera de un reintento automático.',
      primaryAction: 'hidden',
      showRetry: Boolean(processingStatus.idempotency_key),
    };
  }

  return {
    visible: true,
    tone: 'status',
    message: `${VIGIA_VISIBLE_NAMES.tenders} está procesando los documentos de este expediente; el resultado aparecerá aquí automáticamente al finalizar.`,
    primaryAction: 'disabled',
    showRetry: false,
  };
}

export function shouldReloadTenderArtifacts(
  previous: ProcessingStatusSnapshot | null,
  next: ProcessingStatusSnapshot,
  lastReloadedJobId: string | null,
) {
  if (!previous || !next.job_id || previous.job_id !== next.job_id) return false;
  if (next.status !== 'completed' || previous.status === 'completed') return false;
  return lastReloadedJobId !== next.job_id;
}
