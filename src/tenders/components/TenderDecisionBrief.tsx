import { VIGIA_VISIBLE_NAMES } from '../../vigia/agentIdentity';
import {
  tenderBriefClassificationAvailable,
  tenderBriefEffortSummary,
  tenderBriefHeadline,
  tenderBriefPriorityItems,
  tenderBriefShortLabel,
  tenderBriefUnavailableCopy,
  tenderCommercialPotential,
  type TenderCommercialContext,
} from '../tenderDecisionBriefModel';
import type { TenderDecisionReview, TenderDocumentAnalysis } from '../types';
import { TenderFindingEvidence } from './TenderFindingEvidence';

export type TenderDecisionBriefProps = {
  analysis: TenderDocumentAnalysis | null;
  commercialContext?: TenderCommercialContext;
};

function openAnchor(id: string, event?: { preventDefault?: () => void }, fallback?: string) {
  event?.preventDefault?.();
  const target = document.getElementById(id) || (fallback ? document.getElementById(fallback) : null);
  if (target instanceof HTMLDetailsElement) target.open = true;
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function PriorityItem({ item, review }: { item: ReturnType<typeof tenderBriefPriorityItems>['visible'][number]; review: TenderDecisionReview }) {
  return <article className={`tender-decision-brief-item is-${item.kind}`}>
    <small>{item.kind === 'impediment' ? 'Impedimento confirmado' : 'Condición pendiente de validar'}</small>
    <strong>{item.title}</strong>
    <p>{item.body}</p>
    {item.finding && <TenderFindingEvidence finding={item.finding} review={review} preview />}
  </article>;
}

export function TenderDecisionBrief({ analysis, commercialContext = {} }: TenderDecisionBriefProps) {
  const review = analysis?.decision_review || null;
  const available = tenderBriefClassificationAvailable(review);
  const unavailable = tenderBriefUnavailableCopy();

  if (!available || !review) {
    return <section className="tender-v3-questions tender-decision-review tender-decision-brief-v3" aria-labelledby="tender-decision-review-title">
      <header>
        <div>
          <span className="eyebrow">Lectura para decidir</span>
          <h3 id="tender-decision-review-title">{unavailable.title}</h3>
          <p>{unavailable.body}</p>
        </div>
      </header>
      <p className="notice" role="status">{unavailable.impedimentNote}</p>
      <div className="tender-decision-brief-courses">
        <button type="button" className="secondary" onClick={() => openAnchor('tender-analysis')}>Validar primero</button>
        <button type="button" className="secondary" onClick={() => openAnchor('tender-go-no-go-actions')}>Continuar al registro humano</button>
        <button type="button" className="secondary" onClick={() => openAnchor('tender-decision-register-nogo', undefined, 'tender-go-no-go-actions')}>No continuar — ir al registro</button>
      </div>
      <small className="tender-executive-governance">Puede solicitar aclaraciones o soportes dentro de SIIO; la encargada responde y adjunta evidencia allí. AGT-002 no envía correos ni hace contactos externos y no decide GO / NO GO.</small>
    </section>;
  }

  const potential = tenderCommercialPotential(commercialContext, review);
  const effort = tenderBriefEffortSummary(review.preparation);
  const headline = tenderBriefHeadline(review, commercialContext);
  const { visible, overflow } = tenderBriefPriorityItems(review, commercialContext);
  const capacityPreview = review.supported.slice(0, 3);
  const capacityRest = review.supported.slice(3);

  return <section className="tender-v3-questions tender-decision-review tender-decision-brief-v3" aria-labelledby="tender-decision-review-title">
    <header>
      <div>
        <span className="eyebrow">Lectura para decidir</span>
        <h3 id="tender-decision-review-title">Brief de decisión</h3>
        <p className="tender-decision-brief-headline">{headline}</p>
        <p className="muted">{VIGIA_VISIBLE_NAMES.tenders} no dice participar ni no participar; la encargada elige el curso y registra GO o NO GO aparte.</p>
      </div>
    </header>

    <div className="tender-decision-brief-axes" aria-label="Ejes independientes">
      <article>
        <small>Potencial comercial</small>
        <strong>{potential.classified ? 'Encaje comercial explícito' : 'Sin razones priorizadas'}</strong>
        {potential.reasons.length > 0 ? <ul>{potential.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul> : <p>{potential.note}</p>}
        {potential.contextFacts.length > 0 && <ul className="tender-decision-brief-facts">{potential.contextFacts.map(fact => <li key={fact}>{fact}</li>)}</ul>}
      </article>
      <article>
        <small>Impedimentos</small>
        <strong>{review.blockers.length ? `${review.blockers.length} confirmados en esta revisión` : 'Ningún impedimento confirmado en esta revisión'}</strong>
        {review.blockers.length ? <ul>{review.blockers.map(item => <li key={item.id}>{tenderBriefShortLabel(item.label)}</li>)}</ul> : <p>La ausencia de bloqueadores no clasifica el potencial ni cierra el caso.</p>}
      </article>
      <article>
        <small>Incertidumbre</small>
        <strong>{review.decision_questions.length ? `${review.decision_questions.length} condiciones por validar` : 'Sin condiciones materiales abiertas'}</strong>
        {review.decision_questions.length ? <ul>{review.decision_questions.map(item => <li key={item.id}>{tenderBriefShortLabel(item.label)}</li>)}</ul> : <p>No hay alertas materiales pendientes de respuesta.</p>}
      </article>
    </div>

    {visible.length > 0 && <div className="tender-decision-brief-priority" aria-label="Elementos prioritarios">
      {visible.map(item => <PriorityItem key={item.id} item={item} review={review} />)}
    </div>}
    {overflow.length > 0 && <details className="tender-decision-review-trace"><summary>Más elementos fuera de la lectura prioritaria</summary><div className="tender-decision-brief-priority">{overflow.map(item => <PriorityItem key={item.id} item={item} review={review} />)}</div></details>}

    {effort.present && <div className="tender-decision-review-preparation">
      <p><strong>Trámites preparables.</strong> {effort.headline}</p>
      <details>
        <summary>Ver los {effort.count} trámites</summary>
        <p className="muted">No son impedimentos materiales ni una medición de esfuerzo comercial.</p>
        <ul>{effort.items.map(item => <li key={item.id}><strong>{item.label}</strong><span> {item.rationale}</span></li>)}</ul>
      </details>
    </div>}

    {review.supported.length > 0 && <div className="tender-decision-brief-capacity">
      <small>Evidencia de capacidad revisada</small>
      <strong>Habilitantes ya mirados. No son la razón comercial para invertir.</strong>
      <ul>{capacityPreview.map(item => <li key={item.id}><strong>{item.label}</strong><span> {item.rationale}</span><TenderFindingEvidence finding={item} review={review} /></li>)}</ul>
      {capacityRest.length > 0 && <details className="tender-decision-review-trace"><summary>{capacityRest.length} aspectos más de capacidad</summary><ul>{capacityRest.map(item => <li key={item.id}><strong>{item.label}</strong><span> {item.rationale}</span><TenderFindingEvidence finding={item} review={review} /></li>)}</ul></details>}
    </div>}

    <details className="tender-decision-review-trace">
      <summary>Trazabilidad completa</summary>
      <p className="muted"><small>{review.contract_version} · versión de fuente {review.source_fixture_version} · {review.decision_status}</small></p>
      <ul>{review.not_applicable.map(item => <li key={item.id}>{item.label}</li>)}</ul>
    </details>

    <div className="tender-decision-brief-courses">
      <button type="button" className="secondary" onClick={() => openAnchor('tender-analysis')}>Validar primero</button>
      <button type="button" className="secondary" onClick={() => openAnchor('tender-decision-register-go', undefined, 'tender-go-no-go-actions')}>Continuar — ir al registro humano</button>
      <button type="button" className="secondary" onClick={() => openAnchor('tender-decision-register-nogo', undefined, 'tender-go-no-go-actions')}>No continuar — ir al registro humano</button>
    </div>
    <small className="tender-executive-governance">Puede solicitar aclaraciones o soportes dentro de SIIO; la encargada responde y adjunta evidencia allí. AGT-002 no envía correos ni hace contactos externos y no decide GO / NO GO. Validar primero no registra una decisión.</small>
    <p className="tender-decision-brief-links"><a href="#tender-technical-analysis" onClick={event => openAnchor('tender-technical-analysis', event)}>Ver análisis técnico completo</a></p>
  </section>;
}
