/**
 * What an opportunity shows before its first analysis exists: where it stands and the three steps to get one. It
 * replaces the retired legacy engine's blocks (its "processing" notice, its 12-document freeze form, the paused
 * five-axis surface), which only confused a new opportunity. It starts nothing: the analysis is authorized apart.
 */
export function TenderPreAnalysisPanel({ documentsCount, statusText = '', statusTone = 'status' }: {
  documentsCount: number; statusText?: string; statusTone?: 'status' | 'error';
}) {
  const hasDocuments = documentsCount > 0;
  return <section className="tender-pre-analysis" aria-label="Antes del análisis">
    <small>Análisis inicial</small>
    <strong>Todavía no se ha hecho</strong>
    <p>Cuando esté listo, aquí verá el veredicto, los motivos, qué hay que hacer y las fechas clave.</p>
    <ol>
      <li className={hasDocuments ? 'is-done' : 'is-next'}>
        <b>Documentos del proceso:</b>{' '}
        {hasDocuments
          ? `${documentsCount} cargado${documentsCount === 1 ? '' : 's'}.`
          : 'ninguno todavía. Pulse "Actualizar documentos" en el Resumen para traerlos de SECOP.'}
      </li>
      <li className={hasDocuments ? 'is-next' : ''}>
        <b>Lista de documentos y costo:</b> Licitaciones prepara la lista con todo lo que define requisitos y el costo estimado del análisis.
      </li>
      <li>
        <b>Autorización:</b> la corrida la autoriza Administración o el responsable de licitaciones; el resultado aparece aquí.
      </li>
    </ol>
    {statusText && <div className={statusTone === 'error' ? 'error' : 'notice'} role={statusTone === 'error' ? 'alert' : 'status'}>{statusText}</div>}
  </section>;
}
