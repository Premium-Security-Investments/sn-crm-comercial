import { normalizeTenderEvidence, tenderAnalysisMethodLabel, tenderDecisionStatusTone, tenderNextAction } from '../tenderDecisionBrief';
import type { TenderDocumentAnalysis, TenderDocumentRecord, TenderDocumentsPayload } from '../types';

type TenderAnalysisSectionProps = {
  analysis: TenderDocumentAnalysis | null;
  documents: TenderDocumentRecord[];
  busy: boolean;
  onAnalyze: () => void;
  canRunPreview: boolean;
  onAnalyzePreview: () => void;
  analysisEngine?: TenderDocumentsPayload['analysis_engine'];
};

function EvidenceList({ items, empty }: { items: unknown; empty: string }) {
  const visible = normalizeTenderEvidence(items);
  return visible.length ? <ul>{visible.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <p className="muted">{empty}</p>;
}

export function TenderAnalysisSection({ analysis, documents, busy, onAnalyze, canRunPreview, onAnalyzePreview, analysisEngine }: TenderAnalysisSectionProps) {
  const strengths = analysis?.strengths ?? analysis?.commercial_fit?.positives ?? [];
  const weaknesses = analysis?.weaknesses ?? analysis?.blockers ?? analysis?.commercial_fit?.concerns ?? [];
  const questions = analysis?.questions ?? [];
  const unverified = analysis?.unverified ?? analysis?.company_profile_crosscheck?.gaps ?? [];
  const hasDocuments = documents.length > 0;
  const failed = analysis?.status === 'failed';
  const stale = Boolean(analysis && !analysis.current);
  const state = !hasDocuments ? 'Sin documentos' : failed ? 'Análisis fallido' : stale ? 'Análisis desactualizado' : !analysis ? 'Análisis pendiente' : 'Análisis vigente';
  const actionLabel = analysis ? 'Actualizar análisis' : 'Generar análisis preliminar';
  const citedEvidence = [...new Set([analysis?.strengths, analysis?.weaknesses, analysis?.blockers, analysis?.questions, analysis?.unverified]
    .flatMap(items => Array.isArray(items) ? items : [])
    .flatMap(item => typeof item === 'object' && item && Array.isArray(item.evidence_refs) ? item.evidence_refs : []))];

  return <section id="tender-analysis" className="tender-analysis-section tender-detail-anchor" aria-labelledby="tender-analysis-title">
    <header className="tender-analysis-header"><div><span className="eyebrow">Paso previo a la decisión humana</span><h3 id="tender-analysis-title">Análisis / preanálisis</h3><p>Organiza la evidencia disponible y señala pendientes. No registra ni autoriza GO / NO GO.</p></div><div className={`tender-analysis-state state-${failed ? 'failed' : stale ? 'stale' : analysis ? 'ready' : 'pending'}`}><strong>{state}</strong>{analysis && <span>{tenderAnalysisMethodLabel(analysis.producer)}</span>}</div></header>
    {!hasDocuments && <div className="document-empty-state"><strong>Sin documentos</strong><span>Actualice o cargue documentos antes de generar el análisis preliminar.</span></div>}
    {hasDocuments && !analysis && <div className="document-empty-state"><strong>Análisis pendiente</strong><span>Hay documentos vigentes, pero todavía no existe una conclusión preliminar para revisar.</span></div>}
    {failed && <div className="error" role="alert"><strong>Análisis fallido.</strong> El último intento no produjo una conclusión utilizable. Puede intentarlo nuevamente sin afectar la decisión humana.</div>}
    {stale && <div className="notice" role="status"><strong>Análisis desactualizado.</strong> El contenido histórico se conserva para trazabilidad, pero los documentos vigentes cambiaron.</div>}
    {analysis && analysis.status !== 'failed' && <article className="tender-decision-brief" aria-label="Conclusión preliminar de licitación">
      <header className="tender-decision-brief-head"><div><small>Recomendación preliminar</small><strong>{analysis.recommendation || 'Requiere revisión'}</strong><p>{analysis.summary || 'Sin resumen documental disponible.'}</p></div><div className="tender-decision-brief-status"><span className={`badge badge-${tenderDecisionStatusTone(analysis.recommendation)}`}>{analysis.current ? 'Vigente' : 'Obsoleto'}</span><span>{tenderAnalysisMethodLabel(analysis.producer)}</span><small>{analysis.completed_at ? `Actualizado: ${new Date(analysis.completed_at).toLocaleString('es-CO')}` : analysis.generated_at ? `Generado: ${new Date(analysis.generated_at).toLocaleString('es-CO')}` : 'Fecha no informada'}</small></div></header>
      <div className="tender-decision-brief-grid"><section><h4>Fortalezas</h4><EvidenceList items={strengths} empty="Sin fortalezas documentales registradas."/></section><section><h4>Debilidades y bloqueadores</h4><EvidenceList items={weaknesses} empty="Sin debilidades o bloqueadores documentales registrados."/></section><section><h4>Dudas abiertas</h4><EvidenceList items={questions} empty="Sin dudas abiertas registradas."/></section><section><h4>Información no verificada</h4><EvidenceList items={unverified} empty="Sin información no verificada registrada."/></section><section className="tender-decision-next-action"><h4>Siguiente acción</h4><p>{tenderNextAction(analysis.next_action) || 'Sin siguiente acción documentada; revisar el expediente con Licitaciones.'}</p></section></div>
      <details className="tender-decision-brief-help"><summary>Cómo funciona</summary><p>Esta conclusión preliminar organiza únicamente la evidencia disponible. No autoriza GO / NO GO; una persona con permiso formal debe tomar esa decisión.</p></details>
      {citedEvidence.length > 0 && <details className="tender-decision-brief-help"><summary>Citas de evidencia ({citedEvidence.length})</summary><ul>{citedEvidence.map(reference => <li key={reference}><code>{reference}</code></li>)}</ul></details>}
    </article>}
    {analysisEngine?.fallback && <div className="notice" role="status"><strong>Fallback seguro aplicado.</strong> AGT-002 Preview no estuvo disponible ({analysisEngine.reason === 'not_configured' ? 'no configurado' : 'servicio no disponible'}); se conservó el preanálisis determinístico por reglas.</div>}
    {analysisEngine?.used === 'AGT-002' && <div className="notice" role="status"><strong>Revisión humana obligatoria.</strong> AGT-002 produjo una recomendación preliminar{analysisEngine.reused ? ' reutilizada por idempotencia' : ''}; no autoriza GO / NO GO.</div>}
    <div className="tender-analysis-actions"><button type="button" onClick={onAnalyze} disabled={busy || !hasDocuments}>{busy ? 'Procesando…' : actionLabel}</button>{canRunPreview && <button type="button" onClick={onAnalyzePreview} disabled={busy || !hasDocuments}>{busy ? 'Procesando…' : 'Ejecutar AGT-002 Preview'}</button>}{analysis && <small>Productor real: {tenderAnalysisMethodLabel(analysis.producer)}</small>}</div>
  </section>;
}
