type ProcessingStatusSnapshot = { job_id: string | null; status: string };

const TERMINAL_STATUSES = new Set(['no_job', 'completed', 'cancelled', 'needs_attention']);

const STATUS_LABELS: Record<string, string> = {
  no_job: 'Sin procesamiento pendiente',
  queued: 'En cola para procesamiento inmediato',
  discovering_documents: 'Descubriendo documentos oficiales',
  importing_documents: 'Importando y verificando documentos',
  building_snapshot: 'Construyendo el snapshot documental',
  waiting_agent_capacity: 'Vig-IA no está disponible todavía; el análisis permanece en cola',
  analyzing: 'Vig-IA está analizando el expediente',
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

export function shouldReloadTenderArtifacts(
  previous: ProcessingStatusSnapshot | null,
  next: ProcessingStatusSnapshot,
  lastReloadedJobId: string | null,
) {
  if (!previous || !next.job_id || previous.job_id !== next.job_id) return false;
  if (next.status !== 'completed' || previous.status === 'completed') return false;
  return lastReloadedJobId !== next.job_id;
}
