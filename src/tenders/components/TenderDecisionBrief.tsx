import { VIGIA_VISIBLE_NAMES } from '../../vigia/agentIdentity';
import { tenderRecommendationCopy, tenderRecommendationKind, tenderRecommendationLabel } from '../tenderDecisionGate';
import type { TenderDecisionReview, TenderDecisionReviewFinding, TenderQuestionResponse, TenderQuestionResponseInput } from '../types';
import { QuestionResponseCard, type NormalizedQuestion } from './TenderQuestionResponseCard';

export type TenderDecisionBriefProps = {
  decisionReview: TenderDecisionReview;
  analysisRunId: string;
  questionResponses: TenderQuestionResponse[];
  canAnswerQuestions: boolean;
  busy: boolean;
  onSaveQuestionResponse?: (input: TenderQuestionResponseInput, files: File[]) => Promise<void>;
};

type NormalizedDecisionQuestion = NormalizedQuestion & { rationale: string };

function normalizeDecisionQuestion(entry: TenderDecisionReview['decision_questions'][number]): NormalizedDecisionQuestion {
  return { id: entry.id, text: entry.label, critical: true, evidenceRefs: [], rationale: entry.rationale };
}

function FindingList({ items, empty }: { items: TenderDecisionReviewFinding[]; empty: string }) {
  if (!items.length) return <p className="muted">{empty}</p>;
  return <ul className="tender-decision-brief-findings">{items.map(item => <li key={item.id}><strong>{item.label}</strong><span>{item.rationale}</span></li>)}</ul>;
}

function openAnchor(id: string, event: { preventDefault: () => void }) {
  event.preventDefault();
  const target = document.getElementById(id);
  if (target instanceof HTMLDetailsElement) target.open = true;
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function TenderDecisionBrief({
  decisionReview,
  analysisRunId,
  questionResponses,
  canAnswerQuestions,
  busy,
  onSaveQuestionResponse,
}: TenderDecisionBriefProps) {
  const decisionQuestions = decisionReview.decision_questions.map(normalizeDecisionQuestion);
  const pendingQuestions = decisionQuestions.filter(question => {
    const latest = questionResponses.find(item => item.question_id === question.id);
    return !latest || latest.status === 'pending';
  });
  const posture = tenderRecommendationLabel(decisionReview.recommendation);
  const postureKind = tenderRecommendationKind(decisionReview.recommendation);

  return <section className="tender-v3-questions tender-decision-review tender-decision-brief-v3" aria-labelledby="tender-decision-review-title">
    <header>
      <div>
        <span className="eyebrow">Lectura para decidir</span>
        <h3 id="tender-decision-review-title">Brief de decisión</h3>
        <p>Postura de {VIGIA_VISIBLE_NAMES.tenders} sobre el flujo de evidencia. No dice participar ni no participar; la encargada registra GO o NO GO aparte.</p>
      </div>
      <div className={`tender-decision-brief-posture tone-${postureKind}`}>
        <small>Postura</small>
        <strong>{posture}</strong>
        <span>{tenderRecommendationCopy(decisionReview.recommendation)}</span>
      </div>
    </header>

    {decisionReview.blockers.length > 0 && <section className="error tender-decision-review-blockers tender-decision-brief-bucket" aria-labelledby="tender-decision-brief-blockers-title" role="alert">
      <h4 id="tender-decision-brief-blockers-title">Impedimento confirmado</h4>
      <p>Hechos materiales que ya están acreditados en el expediente. No son un contador del motor.</p>
      <FindingList items={decisionReview.blockers} empty="Sin impedimento confirmado." />
    </section>}

    <section className="tender-decision-brief-bucket is-supported" aria-labelledby="tender-decision-brief-supported-title">
      <h4 id="tender-decision-brief-supported-title">Por qué vale la pena considerarla</h4>
      <p>Evidencia favorable ya revisada. No requiere respuesta adicional.</p>
      <FindingList items={decisionReview.supported} empty="Sin evidencia favorable clasificada en esta lectura." />
    </section>

    <section className="tender-decision-brief-bucket is-questions" aria-labelledby="tender-decision-brief-questions-title">
      <h4 id="tender-decision-brief-questions-title">Condición pendiente de validar</h4>
      <p>{pendingQuestions.length ? 'Sólo estas condiciones materiales requieren respuesta de la encargada.' : 'No hay condiciones materiales pendientes de respuesta humana.'}</p>
      {decisionQuestions.length ? <div className="tender-question-list">{decisionQuestions.map(question => <article key={question.id} className="tender-decision-review-question"><p className="tender-decision-review-rationale">{question.rationale}</p><QuestionResponseCard question={question} analysisRunId={analysisRunId} responses={questionResponses.filter(item => item.question_id === question.id)} canAnswer={canAnswerQuestions} disabled={busy} onSave={onSaveQuestionResponse} criticalLabel="Alerta material"/></article>)}</div> : <p className="muted">Sin condiciones pendientes de validar.</p>}
    </section>

    <section className="tender-decision-brief-bucket is-preparation" aria-labelledby="tender-decision-brief-preparation-title">
      <h4 id="tender-decision-brief-preparation-title">Esfuerzo comercial inmediato</h4>
      <p>Documentos y trámites obtenibles o preparables; no son impedimentos materiales.</p>
      <FindingList items={decisionReview.preparation} empty="Sin esfuerzo comercial inmediato identificado." />
    </section>

    <details className="tender-decision-review-trace">
      <summary>Trazabilidad completa ({decisionReview.not_applicable.length} no aplican)</summary>
      <p className="muted"><small>{decisionReview.contract_version} · versión de fuente {decisionReview.source_fixture_version} · {decisionReview.decision_status}</small></p>
      <ul>{decisionReview.not_applicable.map(item => <li key={item.id}>{item.label}</li>)}</ul>
    </details>

    <small className="tender-executive-governance">Puede solicitar aclaraciones o soportes dentro de SIIO; la encargada responde y adjunta evidencia allí. AGT-002 no envía correos ni hace contactos externos y no decide GO / NO GO.</small>
    <div className="tender-decision-brief-links">
      <a href="#tender-decision" onClick={event => openAnchor('tender-decision', event)}>Registrar decisión humana</a>
      <a href="#tender-technical-analysis" onClick={event => openAnchor('tender-technical-analysis', event)}>Ver análisis técnico completo</a>
    </div>
  </section>;
}
