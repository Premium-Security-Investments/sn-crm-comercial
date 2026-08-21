import {
  tenderBriefClassificationAvailable,
  tenderBriefHeadline,
  tenderBriefUnavailableCopy,
  tenderCommercialPotential,
  type TenderCommercialContext,
} from '../tenderDecisionBriefModel';
import { tenderDecisionBlockers, tenderDecisionConditions, type TenderDecisionSurfaceCard } from '../tenderDecisionSurface';
import type { TenderDocumentAnalysis, TenderQuestionResponse } from '../types';

export type TenderDecisionBriefProps = {
  analysis: TenderDocumentAnalysis | null;
  commercialContext?: TenderCommercialContext;
  questionResponses?: TenderQuestionResponse[];
};

function openAnchor(id: string) {
  const target = document.getElementById(id);
  if (target instanceof HTMLDetailsElement) target.open = true;
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  target?.focus({ preventScroll: true });
}

function CompactFindingList({ items, state }: { items: TenderDecisionSurfaceCard[]; state?: boolean }) {
  return items.length ? <ul>{items.map(item => <li key={item.key}><strong>{item.title}</strong>{state && item.state ? <span> · {item.state}</span> : null}</li>)}</ul> : null;
}

export function TenderDecisionBrief({ analysis, commercialContext = {}, questionResponses = [] }: TenderDecisionBriefProps) {
  const review = analysis?.decision_review || null;
  const available = tenderBriefClassificationAvailable(review);
  const unavailable = tenderBriefUnavailableCopy();
  const blockers = tenderDecisionBlockers(review, questionResponses);
  const pendingConditions = tenderDecisionConditions(review, questionResponses).filter(c => c.state === 'Pendiente de validación');

  if (!available) {
    return <section className="tender-v3-questions tender-decision-review tender-decision-brief-v3" aria-labelledby="tender-decision-review-title">
      <header><div><span className="eyebrow">Lectura para decidir</span><h3 id="tender-decision-review-title">{unavailable.title}</h3><p>{unavailable.body}</p></div></header>
      <p className="notice" role="status">{unavailable.impedimentNote}</p>
      <div className="tender-decision-brief-courses">
        <button type="button" onClick={() => openAnchor('tender-go-no-go-actions')}>Registrar decisión humana</button>
      </div>
    </section>;
  }

  const potential = tenderCommercialPotential(commercialContext);
  const headline = tenderBriefHeadline({ blockers, conditions: pendingConditions, potential });
  return <section className="tender-v3-questions tender-decision-review tender-decision-brief-v3" aria-labelledby="tender-decision-review-title">
    <header><div><span className="eyebrow">Lectura para decidir</span><h3 id="tender-decision-review-title">Brief de decisión</h3><p className="tender-decision-brief-headline">{headline}</p></div></header>

    <div className="tender-decision-brief-axes" aria-label="Síntesis para decisión humana">
      <article>
        <small>Potencial comercial</small>
        <strong>{potential.classified ? 'Encaje comercial explícito' : 'Sin razones priorizadas'}</strong>
        {potential.reasons.length ? <ul>{potential.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul> : <p>{potential.note}</p>}
        {potential.contextFacts.length ? <ul className="tender-decision-brief-facts">{potential.contextFacts.map(fact => <li key={fact}>{fact}</li>)}</ul> : null}
      </article>
      <article>
        <small>Impedimentos</small>
        <strong>{blockers.length ? `${blockers.length} confirmados` : 'Sin impedimentos confirmados'}</strong>
        {blockers.length ? <CompactFindingList items={blockers} /> : <p>La ausencia de impedimentos no clasifica el potencial comercial.</p>}
      </article>
      <article>
        <small>Condiciones pendientes</small>
        <strong>{pendingConditions.length ? `${pendingConditions.length} por validar` : 'Sin condiciones materiales abiertas'}</strong>
        {pendingConditions.length ? <CompactFindingList items={pendingConditions} state /> : <p>No hay condiciones pendientes de validación.</p>}
      </article>
    </div>

    <div className="tender-decision-brief-courses">
      {pendingConditions.length > 0 && (
        <button type="button" className="secondary" onClick={() => openAnchor('tender-analysis')}>
          Revisar {pendingConditions.length} condiciones pendientes
        </button>
      )}
      <button type="button" onClick={() => openAnchor('tender-go-no-go-actions')}>
        Registrar decisión humana
      </button>
    </div>
  </section>;
}
