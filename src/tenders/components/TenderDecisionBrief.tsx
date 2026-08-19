import { VIGIA_VISIBLE_NAMES } from '../../vigia/agentIdentity';
import {
  tenderBriefClassificationAvailable,
  tenderBriefEffortSummary,
  tenderBriefPriorityItems,
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
    <small>{item.kind === 'impediment' ? 'Impedimento confirmado' : item.kind === 'condition' ? 'Condición pendiente de validar' : item.kind === 'potential' ? 'Potencial comercial' : 'Esfuerzo inmediato'}</small>
    <strong>{item.title}</strong>
    <p>{item.body}</p>
    {item.finding && <TenderFindingEvidence finding={item.finding} review={review} />}
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
  const { visible, overflow } = tenderBriefPriorityItems(review, commercialContext);

  return <section className="tender-v3-questions tender-decision-review tender-decision-brief-v3" aria-labelledby="tender-decision-review-title">
    <header>
      <div>
        <span className="eyebrow">Lectura para decidir</span>
        <h3 id="tender-decision-review-title">Brief de decisión</h3>
        <p>Tres ejes independientes: potencial comercial, impedimentos e incertidumbre. {VIGIA_VISIBLE_NAMES.tenders} no dice participar ni no participar; la encargada elige el curso y registra GO o NO GO aparte.</p>
      </div>
    </header>

    <div className="tender-decision-brief-axes" aria-label="Ejes independientes">
      <article>
        <small>Potencial comercial</small>
        <strong>{potential.classified ? 'Hay razones comerciales explícitas' : 'Sin clasificación priorizada'}</strong>
        <p>{potential.note}</p>
        {potential.reasons.length > 0 && <ul>{potential.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
        {potential.contextFacts.length > 0 && <p className="muted">{potential.contextFacts.join(' · ')}</p>}
      </article>
      <article>
        <small>Impedimentos</small>
        <strong>{review.blockers.length ? 'Hay impedimentos confirmados' : 'Ningún impedimento confirmado en esta revisión'}</strong>
        <p>Este eje no degrada el potencial. Un caso atractivo puede tener un impedimento subsanable.</p>
      </article>
      <article>
        <small>Incertidumbre</small>
        <strong>{review.decision_questions.length ? 'Hay condiciones por validar' : 'Sin condiciones materiales abiertas'}</strong>
        <p>Las condiciones pendientes no convierten el potencial en condicionado.</p>
      </article>
    </div>

    <div className="tender-decision-brief-priority" aria-label="Elementos prioritarios">
      {visible.map(item => <PriorityItem key={item.id} item={item} review={review} />)}
    </div>
    {overflow.length > 0 && <details className="tender-decision-review-trace"><summary>Más elementos fuera de la lectura prioritaria</summary><div className="tender-decision-brief-priority">{overflow.map(item => <PriorityItem key={item.id} item={item} review={review} />)}</div></details>}

    {effort.present && <details className="tender-decision-review-preparation">
      <summary>Trámites preparables (detalle)</summary>
      <p className="muted">No son impedimentos materiales ni una medición de esfuerzo comercial.</p>
      <ul>{effort.items.map(item => <li key={item.id}><strong>{item.label}</strong><span> {item.rationale}</span></li>)}</ul>
    </details>}

    {review.supported.length > 0 && <details className="tender-decision-review-trace">
      <summary>Evidencia de capacidad revisada</summary>
      <p className="muted">Capacidad ya revisada. No se presenta como razón comercial priorizada.</p>
      <ul>{review.supported.map(item => <li key={item.id}><strong>{item.label}</strong><span> {item.rationale}</span><TenderFindingEvidence finding={item} review={review} /></li>)}</ul>
    </details>}

    <details className="tender-decision-review-trace">
      <summary>Trazabilidad completa</summary>
      <p className="muted"><small>{review.contract_version} · versión de fuente {review.source_fixture_version} · {review.decision_status}</small></p>
      <ul>{review.not_applicable.map(item => <li key={item.id}>{item.label}</li>)}</ul>
    </details>

    <div className="tender-decision-brief-courses">
      <button type="button" onClick={() => openAnchor('tender-analysis')}>Validar primero</button>
      <button type="button" className="secondary" onClick={() => openAnchor('tender-decision-register-go', undefined, 'tender-go-no-go-actions')}>Continuar — ir al registro humano</button>
      <button type="button" className="secondary" onClick={() => openAnchor('tender-decision-register-nogo', undefined, 'tender-go-no-go-actions')}>No continuar — ir al registro humano</button>
    </div>
    <small className="tender-executive-governance">Puede solicitar aclaraciones o soportes dentro de SIIO; la encargada responde y adjunta evidencia allí. AGT-002 no envía correos ni hace contactos externos y no decide GO / NO GO. Validar primero no registra una decisión.</small>
    <p className="tender-decision-brief-links"><a href="#tender-technical-analysis" onClick={event => openAnchor('tender-technical-analysis', event)}>Ver análisis técnico completo</a></p>
  </section>;
}
