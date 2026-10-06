import type { TenderProcessingStatus } from '../types';

const DOWNLOADING = new Set(['queued', 'discovering_documents', 'importing_documents', 'retry_wait']);
const PREPARING = new Set(['ready_for_snapshot', 'snapshot_ready', 'awaiting_analysis_authorization']);

type Stage = { downloading: boolean; preparing: boolean; failed: boolean; progress: string | null };

function stageOf(processing: TenderProcessingStatus | null | undefined): Stage {
  const status = processing?.status ?? '';
  const counts = processing?.counts;
  const progress = counts && counts.discovered > 0 ? `${counts.processed} de ${counts.discovered}` : null;
  return { downloading: DOWNLOADING.has(status), preparing: PREPARING.has(status), failed: status === 'needs_attention', progress };
}

/**
 * What an opportunity shows before its first analysis exists. Since the owner decision of 2026-10-06 converting IS
 * the authorization: documents download and the analysis starts on their own, so this block reports where that stands
 * (downloading, preparing, or what failed) instead of the retired legacy engine's controls. It starts nothing itself.
 */
export function TenderPreAnalysisPanel({ documentsCount, processing = null, statusText = '', statusTone = 'status' }: {
  documentsCount: number; processing?: TenderProcessingStatus | null; statusText?: string; statusTone?: 'status' | 'error';
}) {
  const stage = stageOf(processing);
  const hasDocuments = documentsCount > 0;
  const headline = stage.failed
    ? 'Se detuvo antes de empezar'
    : stage.downloading ? 'Bajando los documentos de SECOP'
      : stage.preparing ? 'Documentos listos: el análisis arranca en unos minutos'
        : 'Todavía no se ha hecho';
  return <section className="tender-pre-analysis" aria-label="Antes del análisis">
    <small>Análisis inicial</small>
    <strong>{headline}</strong>
    <p>Al convertir la licitación, los documentos se bajan solos y el análisis arranca automáticamente (máximo 5 al día). Cuando esté listo, aquí verá el veredicto, los motivos, qué hay que hacer y las fechas clave.</p>
    <ol>
      <li className={hasDocuments && !stage.downloading ? 'is-done' : 'is-next'}>
        <b>Documentos del proceso:</b>{' '}
        {stage.downloading
          ? `bajando${stage.progress ? ` (${stage.progress})` : ''}…`
          : hasDocuments
            ? `${documentsCount} cargado${documentsCount === 1 ? '' : 's'}.`
            : 'ninguno todavía.'}
      </li>
      <li className={stage.preparing ? 'is-next' : ''}>
        <b>Análisis con el perfil de la empresa:</b>{' '}
        {stage.preparing ? 'en preparación; si ya se hicieron 5 hoy, arranca mañana.' : 'arranca cuando los documentos estén listos.'}
      </li>
    </ol>
    {stage.failed && <div className="error" role="alert">
      No se pudieron traer todos los documentos de SECOP{processing?.last_error_message ? ` (${processing.last_error_message})` : ''}. Pulse "Actualizar documentos" en el Resumen o avise a Licitaciones.
    </div>}
    {!stage.downloading && !stage.preparing && !stage.failed && !hasDocuments
      && <p className="initial-report-meta">Si los documentos no aparecen en unos minutos, pulse "Actualizar documentos" en el Resumen.</p>}
    {statusText && <div className={statusTone === 'error' ? 'error' : 'notice'} role={statusTone === 'error' ? 'alert' : 'status'}>{statusText}</div>}
  </section>;
}
