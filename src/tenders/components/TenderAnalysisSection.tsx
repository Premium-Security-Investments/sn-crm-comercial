import { useState } from 'react';
import { normalizeTenderEvidence, tenderAnalysisMethodLabel, tenderAnalysisProducerDisclosure, tenderDecisionStatusTone, tenderNextAction } from '../tenderDecisionBrief';
import { tenderRecommendationLabel } from '../tenderDecisionGate';
import type { TenderAnalysisFinding, TenderDocumentAnalysis, TenderDocumentRecord, TenderDocumentsPayload, TenderEvidenceCoverage, TenderEvidenceOmissionReason, TenderLegalCitation, TenderLegalEvidence, TenderLegalFinding, TenderLegalFindingClassification, TenderQuestionResponse, TenderQuestionResponseInput, TenderQuestionResponseStatus } from '../types';

const EVIDENCE_OMISSION_REASON_LABELS: Record<TenderEvidenceOmissionReason, string> = {
  budget_exhausted: 'Presupuesto de evidencia agotado',
  lower_relevance: 'Relevancia menor frente a la evidencia usada',
  superseded_for_current_requirement: 'Reemplazado por una adenda vigente',
  gap_unavailable: 'Documento no disponible para extracción',
};

function isValidEvidenceCoverage(value: unknown): value is TenderEvidenceCoverage {
  if (!value || typeof value !== 'object') return false;
  const coverage = value as Partial<TenderEvidenceCoverage>;
  return Array.isArray(coverage.selected_chunks)
    && Array.isArray(coverage.omitted_chunks)
    && typeof coverage.material_omissions === 'boolean'
    && Boolean(coverage.coverage_manifest)
    && Array.isArray(coverage.coverage_manifest?.by_requirement);
}

function EvidenceCoveragePanel({ coverage, documents }: { coverage: TenderEvidenceCoverage; documents: TenderDocumentRecord[] }) {
  const requirements = coverage.coverage_manifest.by_requirement;
  const totalRequirements = requirements.length;
  const coveredRequirements = requirements.filter(requirement => requirement.status === 'covered').length;
  const usedCount = coverage.selected_chunks.length;
  const omittedCount = coverage.omitted_chunks.length;
  return <section className="tender-evidence-coverage" aria-label="Cobertura de evidencia documental">
    <header><h4>Cobertura de evidencia</h4></header>
    <div className="tender-evidence-coverage-metrics">
      <span><strong>{usedCount}</strong> Usados</span>
      <span><strong>{coveredRequirements}/{totalRequirements}</strong> Requisitos cubiertos</span>
      <span><strong>{omittedCount}</strong> Omitidos</span>
    </div>
    {coverage.material_omissions && <div className="error" role="alert"><strong>Este análisis no es integral.</strong> Hay omisiones materiales de evidencia; requiere revisión humana de las omisiones antes de considerarse completo.</div>}
    {usedCount > 0 && <ul className="tender-evidence-coverage-list">
      {coverage.selected_chunks.map(chunk => {
        const document = documents.find(item => item.id === chunk.document_id);
        const label = `${chunk.name} · pág. ${chunk.page}, sec. ${chunk.section} · v${chunk.version} · ${chunk.precedence === 'addendum' ? 'Adenda' : 'Base'}${chunk.superseded_by_addendum ? ' (superada por adenda)' : ''}`;
        return <li key={chunk.evidence_ref}>{document?.signed_url ? <a href={document.signed_url} target="_blank" rel="noopener noreferrer">{label}</a> : <span>{label}</span>}</li>;
      })}
    </ul>}
    {omittedCount > 0 && <details className="tender-evidence-coverage-omissions"><summary>Omisiones ({omittedCount})</summary><ul>
      {coverage.omitted_chunks.map((omission, index) => {
        const document = documents.find(item => item.id === omission.document_id);
        const label = document?.name || omission.document_type || omission.document_id;
        return <li key={`${omission.document_id}-${index}`}>{label}: {EVIDENCE_OMISSION_REASON_LABELS[omission.reason] || omission.reason}</li>;
      })}
    </ul></details>}
  </section>;
}

// AGT002_LEGAL_CORPUS (Task34): the exact fixed statement rendered whenever a legal source's
// vigencia/applicability could not be confirmed (design 7.6). Never derived from finding.text.
const AGT002_LEGAL_HUMAN_REVIEW_STATEMENT = 'No verificado jurídicamente; requiere revisión humana';

// Closed, client-side mirror of AGT002_LEGAL_OFFICIAL_HOSTS (agt002-legal-corpus.js): a link is
// only ever rendered as an official legal source when it is HTTPS and on this exact allowlist.
// A citation is never trusted from finding.text; it is only ever resolved through
// legal_citation_ids against analysis.legal_evidence.
const LEGAL_OFFICIAL_HOSTS = ['funcionpublica.gov.co', 'suin-juriscol.gov.co', 'colombiacompra.gov.co', 'supervigilancia.gov.co'];

function isOfficialLegalUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return LEGAL_OFFICIAL_HOSTS.some(root => host === root || host.endsWith(`.${root}`));
}

function isValidLegalCitation(value: unknown): value is TenderLegalCitation {
  if (!value || typeof value !== 'object') return false;
  const citation = value as Partial<TenderLegalCitation>;
  return typeof citation.citation_id === 'string' && citation.citation_id.length > 0
    && typeof citation.source_id === 'string' && citation.source_id.length > 0
    && typeof citation.norm_type === 'string' && citation.norm_type.length > 0
    && typeof citation.norm_number === 'string' && citation.norm_number.length > 0
    && typeof citation.article_or_section === 'string' && citation.article_or_section.length > 0
    && typeof citation.issuing_authority === 'string' && citation.issuing_authority.length > 0
    && typeof citation.verified_at === 'string' && citation.verified_at.length > 0
    && typeof citation.corpus_version === 'string' && citation.corpus_version.length > 0
    && isOfficialLegalUrl(citation.official_url);
}

function isValidLegalEvidence(value: unknown): value is TenderLegalEvidence {
  if (!value || typeof value !== 'object') return false;
  const evidence = value as Partial<TenderLegalEvidence>;
  return typeof evidence.corpus_version === 'string' && evidence.corpus_version.length > 0
    && typeof evidence.as_of === 'string' && evidence.as_of.length > 0
    && Array.isArray(evidence.verified_legal_evidence)
    && Array.isArray(evidence.human_legal_review_items)
    && Array.isArray(evidence.citation_allowlist)
    && (evidence.abstention_state === 'grounded' || evidence.abstention_state === 'abstained');
}

const LEGAL_FINDING_CLASSIFICATIONS: TenderLegalFindingClassification[] = ['tender_requirement', 'legal_obligation', 'company_evidence', 'inference', 'human_legal_review'];

function isValidLegalFinding(value: unknown): value is TenderLegalFinding {
  if (!value || typeof value !== 'object') return false;
  const finding = value as Partial<TenderLegalFinding>;
  return LEGAL_FINDING_CLASSIFICATIONS.includes(finding.classification as TenderLegalFindingClassification)
    && typeof finding.text === 'string' && finding.text.length > 0
    && Array.isArray(finding.evidence_refs)
    && Array.isArray(finding.legal_citation_ids);
}

const LEGAL_CLASSIFICATION_LABELS: Record<TenderLegalFindingClassification, string> = {
  tender_requirement: 'Requisito del pliego',
  legal_obligation: 'Obligación normativa',
  company_evidence: 'Evidencia empresarial',
  inference: 'Interpretación de Vig-IA',
  human_legal_review: 'Revisión jurídica humana',
};

type LegalCitationEntry = { citation: TenderLegalCitation; verified: boolean };

/** Only citations that pass isValidLegalCitation (HTTPS + official allowlist) ever enter the index. */
function buildLegalCitationIndex(evidence: TenderLegalEvidence): Map<string, LegalCitationEntry> {
  const index = new Map<string, LegalCitationEntry>();
  for (const item of evidence.verified_legal_evidence) {
    if (isValidLegalCitation(item?.citation)) index.set(item.citation.citation_id, { citation: item.citation, verified: true });
  }
  for (const item of evidence.human_legal_review_items) {
    if (isValidLegalCitation(item?.citation) && !index.has(item.citation.citation_id)) index.set(item.citation.citation_id, { citation: item.citation, verified: false });
  }
  return index;
}

function LegalCitationBadge({ entry }: { entry: LegalCitationEntry | undefined }) {
  if (!entry) return null;
  const { citation, verified } = entry;
  return <div className="tender-legal-citation">
    <span className={`badge badge-${verified ? 'green' : 'amber'}`}>{verified ? 'Fuente oficial verificada' : AGT002_LEGAL_HUMAN_REVIEW_STATEMENT}</span>
    <a href={citation.official_url} target="_blank" rel="noopener noreferrer">{citation.norm_type} {citation.norm_number} de {citation.year}, {citation.article_or_section}</a>
    <small>{citation.issuing_authority} · corpus {citation.corpus_version} · verificado {citation.verified_at}</small>
  </div>;
}

function LegalFindingCard({ finding, citationIndex }: { finding: TenderLegalFinding; citationIndex: Map<string, LegalCitationEntry> }) {
  const isHumanReview = finding.classification === 'human_legal_review';
  return <li className={`tender-legal-finding tender-legal-finding-${finding.classification}`}>
    <p>{isHumanReview ? AGT002_LEGAL_HUMAN_REVIEW_STATEMENT : finding.text}</p>
    {finding.legal_citation_ids.length > 0 && <div className="tender-legal-finding-citations">
      {finding.legal_citation_ids.map(id => <LegalCitationBadge key={id} entry={citationIndex.get(id)}/>)}
    </div>}
    {finding.evidence_refs.length > 0 && <small className="muted">Evidencia: {finding.evidence_refs.join(', ')}</small>}
  </li>;
}

/**
 * Panel separating legal findings into the five closed classes (design 7.6). Gated on a
 * validated legal_evidence package: legacy/corrupt analysis runs (no legal_evidence, or a
 * malformed one) never render this panel instead of showing partial/misleading content.
 */
function LegalFindingsPanel({ findings, evidence }: { findings: TenderLegalFinding[]; evidence: TenderLegalEvidence }) {
  const citationIndex = buildLegalCitationIndex(evidence);
  const grouped = LEGAL_FINDING_CLASSIFICATIONS
    .map(classification => ({ classification, items: findings.filter(item => item.classification === classification) }))
    .filter(group => group.items.length > 0);
  if (!grouped.length) return null;
  return <section className="tender-legal-findings" aria-label="Evidencia jurídica y revisión humana">
    <header><h4>Evidencia jurídica</h4><p className="muted">Separa requisito del pliego, obligación normativa, evidencia empresarial, interpretación de Vig-IA y revisión jurídica humana. Organiza evidencia únicamente: no autoriza GO / NO GO ni sustituye asesoría jurídica definitiva.</p></header>
    {evidence.abstention_state === 'abstained' && <div className="notice" role="status"><strong>Sin fuente jurídica elegible.</strong> No hay norma oficial vigente confirmada para este alcance; toda afirmación jurídica queda en revisión humana.</div>}
    {grouped.map(group => <div key={group.classification} className={`tender-legal-findings-group tender-legal-findings-${group.classification}`}>
      <h5>{LEGAL_CLASSIFICATION_LABELS[group.classification]}</h5>
      <ul>{group.items.map((finding, index) => <LegalFindingCard key={`${group.classification}-${index}`} finding={finding} citationIndex={citationIndex}/>)}</ul>
    </div>)}
  </section>;
}

type TenderAnalysisSectionProps = {
  analysis: TenderDocumentAnalysis | null;
  documents: TenderDocumentRecord[];
  busy: boolean;
  canRunPreview: boolean;
  onAnalyzePreview: () => void;
  analysisEngine?: TenderDocumentsPayload['analysis_engine'];
  questionResponses?: TenderQuestionResponse[];
  canAnswerQuestions?: boolean;
  onSaveQuestionResponse?: (input: TenderQuestionResponseInput) => Promise<void>;
};

type NormalizedQuestion = { id: string; text: string; critical: boolean; evidenceRefs: string[] };

function EvidenceList({ items, empty }: { items: unknown; empty: string }) {
  const visible = normalizeTenderEvidence(items);
  return visible.length ? <ul>{visible.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <p className="muted">{empty}</p>;
}

function normalizeQuestion(item: TenderAnalysisFinding, index: number): NormalizedQuestion {
  if (typeof item === 'string') return { id: `question-${index + 1}`, text: item, critical: false, evidenceRefs: [] };
  return {
    id: String(item.id || `question-${index + 1}`),
    text: String(item.text || `Duda abierta ${index + 1}`),
    critical: Boolean(item.critical),
    evidenceRefs: Array.isArray(item.evidence_refs) ? item.evidence_refs : [],
  };
}

const questionStatusLabel = (status: TenderQuestionResponseStatus) => status === 'resolved' ? 'Resuelta' : status === 'not_applicable' ? 'No aplica' : 'Pendiente';
const responseDate = (value: string) => new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

function QuestionResponseCard({ question, analysisRunId, responses, canAnswer, disabled, onSave }: {
  question: NormalizedQuestion;
  analysisRunId: string;
  responses: TenderQuestionResponse[];
  canAnswer: boolean;
  disabled: boolean;
  onSave?: (input: TenderQuestionResponseInput) => Promise<void>;
}) {
  const latest = responses[0];
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<TenderQuestionResponseStatus>(latest?.status || 'pending');
  const [response, setResponse] = useState(latest?.response || '');
  const [evidence, setEvidence] = useState(latest?.evidence_notes || '');
  const [error, setError] = useState('');
  const beginEdit = () => {
    setStatus(latest?.status || 'pending');
    setResponse(latest?.response || '');
    setEvidence(latest?.evidence_notes || '');
    setError('');
    setEditing(true);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!response.trim() || !onSave) return;
    setSaving(true); setError('');
    try {
      await onSave({ analysis_run_id: analysisRunId, question_id: question.id, question_text: question.text, status, response: response.trim(), evidence_notes: evidence.trim() || null });
      setEditing(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };
  return <article className="tender-question-response-card">
    <header><div><strong>{question.text}</strong>{question.critical && <span className="badge badge-red">Crítica</span>}</div><span className={`tender-question-status status-${latest?.status || 'pending'}`}>{questionStatusLabel(latest?.status || 'pending')}</span></header>
    {question.evidenceRefs.length > 0 && <small className="muted">Referencias: {question.evidenceRefs.join(', ')}</small>}
    {latest ? <div className="tender-question-current"><p>{latest.response}</p>{latest.evidence_notes && <small><strong>Evidencia o notas:</strong> {latest.evidence_notes}</small>}<small>{latest.responded_by_name || 'Persona registrada'} · {responseDate(latest.responded_at)}</small></div> : <p className="muted">Aún no hay respuesta humana registrada.</p>}
    {!editing && canAnswer && <button type="button" className="secondary" disabled={disabled} onClick={beginEdit}>{latest ? 'Actualizar respuesta' : 'Responder duda'}</button>}
    {editing && <form className="tender-question-form" onSubmit={submit}>
      <label>Estado<select value={status} onChange={event => setStatus(event.target.value as TenderQuestionResponseStatus)}><option value="pending">Pendiente</option><option value="resolved">Resuelta</option><option value="not_applicable">No aplica</option></select></label>
      <label>Respuesta<textarea required maxLength={10000} value={response} onChange={event => setResponse(event.target.value)} placeholder="Registre la respuesta de Licitaciones…"/></label>
      <label>Evidencia o notas (opcional)<textarea maxLength={5000} value={evidence} onChange={event => setEvidence(event.target.value)} placeholder="Documento, enlace, folio o contexto de soporte…"/></label>
      <small>El autor y la fecha se registran automáticamente desde la sesión. No autoriza GO / NO GO.</small>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="row-actions"><button type="submit" disabled={saving || disabled || !response.trim()}>{saving ? 'Guardando…' : 'Guardar respuesta'}</button><button type="button" className="secondary" disabled={saving} onClick={() => setEditing(false)}>Cancelar</button></div>
    </form>}
    {responses.length > 1 && <details className="tender-question-history"><summary>Historial de respuestas ({responses.length})</summary><ol>{responses.map(item => <li key={item.id}><strong>{questionStatusLabel(item.status)}</strong><p>{item.response}</p>{item.evidence_notes && <small>Evidencia o notas: {item.evidence_notes}</small>}<small>{item.responded_by_name || 'Persona registrada'} · {responseDate(item.responded_at)}</small></li>)}</ol></details>}
  </article>;
}

export function TenderAnalysisSection({ analysis, documents, busy, canRunPreview, onAnalyzePreview, analysisEngine, questionResponses = [], canAnswerQuestions = false, onSaveQuestionResponse }: TenderAnalysisSectionProps) {
  const strengths = analysis?.strengths ?? analysis?.commercial_fit?.positives ?? [];
  const weaknesses = analysis?.weaknesses ?? analysis?.blockers ?? analysis?.commercial_fit?.concerns ?? [];
  const questions = (analysis?.questions ?? []).map(normalizeQuestion);
  const unverified = analysis?.unverified ?? analysis?.company_profile_crosscheck?.gaps ?? [];
  const hasDocuments = documents.length > 0;
  const failed = analysis?.status === 'failed';
  const stale = Boolean(analysis && !analysis.current);
  const state = !hasDocuments ? 'Sin documentos' : failed ? 'Análisis fallido' : stale ? 'Análisis desactualizado' : !analysis ? 'Análisis pendiente' : 'Análisis vigente';
  const actionLabel = failed || stale ? 'Volver a analizar con Vig-IA' : analysis ? 'Actualizar con Vig-IA' : 'Analizar con Vig-IA';
  const citedEvidence = [...new Set([analysis?.strengths, analysis?.weaknesses, analysis?.blockers, analysis?.questions, analysis?.unverified]
    .flatMap(items => Array.isArray(items) ? items : [])
    .flatMap(item => typeof item === 'object' && item && Array.isArray(item.evidence_refs) ? item.evidence_refs : []))];

  return <section id="tender-analysis" className="tender-analysis-section tender-detail-anchor" aria-labelledby="tender-analysis-title">
    <header className="tender-analysis-header"><div><span className="eyebrow">Paso previo a la decisión humana</span><h3 id="tender-analysis-title">Análisis con Vig-IA</h3><p>Organiza la evidencia disponible y señala pendientes. No registra ni autoriza GO / NO GO.</p></div><div className={`tender-analysis-state state-${failed ? 'failed' : stale ? 'stale' : analysis ? 'ready' : 'pending'}`}><strong>{state}</strong>{analysis && <span>{tenderAnalysisMethodLabel(analysis.producer)}</span>}</div></header>
    {!hasDocuments && <div className="document-empty-state"><strong>Sin documentos</strong><span>Actualice o cargue documentos antes de analizar con Vig-IA.</span></div>}
    {hasDocuments && !analysis && <div className="document-empty-state"><strong>Análisis pendiente</strong><span>Hay documentos vigentes, pero todavía no existe una conclusión preliminar para revisar.</span></div>}
    {failed && <div className="error" role="alert"><strong>Análisis fallido.</strong> El último intento no produjo una conclusión utilizable. Puede intentarlo nuevamente sin afectar la decisión humana.</div>}
    {stale && <div className="notice" role="status"><strong>Análisis desactualizado.</strong> El contenido histórico se conserva para trazabilidad, pero los documentos vigentes cambiaron.</div>}
    {analysis && analysis.status !== 'failed' && <article className="tender-decision-brief" aria-label="Conclusión preliminar de licitación">
      <header className="tender-decision-brief-head"><div><small>Recomendación preliminar</small><strong>{tenderRecommendationLabel(analysis.recommendation)}</strong><p>{analysis.summary || 'Sin resumen documental disponible.'}</p></div><div className="tender-decision-brief-status"><span className={`badge badge-${tenderDecisionStatusTone(analysis.recommendation)}`}>{analysis.current ? 'Vigente' : 'Obsoleto'}</span><span>{tenderAnalysisMethodLabel(analysis.producer)}</span><small>{analysis.completed_at ? `Actualizado: ${new Date(analysis.completed_at).toLocaleString('es-CO')}` : analysis.generated_at ? `Generado: ${new Date(analysis.generated_at).toLocaleString('es-CO')}` : 'Fecha no informada'}</small></div></header>
      <div className="tender-decision-brief-grid"><section><h4>Fortalezas</h4><EvidenceList items={strengths} empty="Sin fortalezas documentales registradas."/></section><section><h4>Debilidades y bloqueadores</h4><EvidenceList items={weaknesses} empty="Sin debilidades o bloqueadores documentales registrados."/></section><section className="tender-question-responses"><h4>Dudas abiertas</h4>{questions.length ? <div className="tender-question-list">{questions.map(question => <QuestionResponseCard key={question.id} question={question} analysisRunId={analysis.run_id} responses={questionResponses.filter(item => item.question_id === question.id)} canAnswer={canAnswerQuestions} disabled={busy} onSave={onSaveQuestionResponse}/>)}</div> : <p className="muted">Sin dudas abiertas registradas.</p>}</section><section><h4>Información no verificada</h4><EvidenceList items={unverified} empty="Sin información no verificada registrada."/></section><section className="tender-decision-next-action"><h4>Siguiente acción</h4><p>{tenderNextAction(analysis.next_action) || 'Sin siguiente acción documentada; revisar el expediente con Licitaciones.'}</p></section></div>
      <details className="tender-decision-brief-help"><summary>Cómo funciona</summary><p>Esta conclusión preliminar organiza únicamente la evidencia disponible. No autoriza GO / NO GO; una persona con permiso formal debe tomar esa decisión.</p></details>
      {citedEvidence.length > 0 && <details className="tender-decision-brief-help"><summary>Citas de evidencia ({citedEvidence.length})</summary><ul>{citedEvidence.map(reference => <li key={reference}><code>{reference}</code></li>)}</ul></details>}
    </article>}
    {analysis && isValidEvidenceCoverage(analysis.evidence_coverage) && <EvidenceCoveragePanel coverage={analysis.evidence_coverage} documents={documents}/>}
    {analysis && isValidLegalEvidence(analysis.legal_evidence) && <LegalFindingsPanel findings={(analysis.legal_findings ?? []).filter(isValidLegalFinding)} evidence={analysis.legal_evidence}/>}
    {analysisEngine?.fallback && <div className="notice" role="status"><strong>Fallback seguro aplicado.</strong> Vig-IA no estuvo disponible ({analysisEngine.reason === 'not_configured' ? 'no configurado' : 'servicio no disponible'}); se conservó el preanálisis determinístico por reglas.</div>}
    {analysisEngine?.used === 'AGT-002' && <div className="notice" role="status"><strong>Revisión humana obligatoria.</strong> Vig-IA produjo una recomendación preliminar{analysisEngine.reused ? ' reutilizada por idempotencia' : ''}; no autoriza GO / NO GO.</div>}
    <div className="tender-analysis-actions">
      {canRunPreview && <button type="button" className="tender-analysis-primary-cta" onClick={onAnalyzePreview} disabled={busy || !hasDocuments}>{busy ? 'Procesando…' : actionLabel}</button>}
      {analysis && <small>Productor real: {tenderAnalysisMethodLabel(analysis.producer)} · {tenderAnalysisProducerDisclosure(analysis.producer)}</small>}
    </div>
    {canRunPreview && <details className="tender-analysis-technical"><summary>Detalles técnicos y auditoría (Vig-IA)</summary><p>Vig-IA se ejecuta mediante el motor AGT-002 con revisión humana obligatoria. Nombre técnico de esta acción para auditoría: «Ejecutar AGT-002 Preview».</p></details>}
  </section>;
}
