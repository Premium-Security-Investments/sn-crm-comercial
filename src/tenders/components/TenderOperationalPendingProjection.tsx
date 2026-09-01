import type {
  TenderIntegralOperationalGroup,
  TenderIntegralUnitPresentation,
} from '../tenderIntegralAnalysisPresentation';
import { AGT002_DECISION_AXES, type TenderDecisionAxisView } from '../tenderDecisionAxisSurface';
import './tender-decision-axis-surface.css';

export function shouldShowTenderOperationalPendingProjection(
  axes: TenderDecisionAxisView[],
  openUnits: TenderIntegralUnitPresentation[],
) {
  return axes.length === AGT002_DECISION_AXES.length
    && axes.every(axis => axis.state === 'No evaluado' && axis.findings.length === 0)
    && openUnits.length > 0;
}

function TenderOperationalPendingCard({ card, headingId }: { card: TenderIntegralUnitPresentation; headingId: string }) {
  const title = card.title?.trim() || 'Requisito sin título registrado.';
  const known = card.conclusionSummary?.trim() || 'No hay una conclusión documental registrada.';
  const impact = card.commercialImpactSummary?.trim() || 'No hay impacto comercial documentado.';
  const missing = card.missingEvidenceReasons.filter(reason => reason.trim().length > 0);
  const actions = card.actionSummaries.filter(action => action.trim().length > 0);
  const references = card.citedEvidenceCount > 0
    ? `${card.citedEvidenceCount} referencia${card.citedEvidenceCount === 1 ? '' : 's'} documental${card.citedEvidenceCount === 1 ? '' : 'es'}: ${card.evidenceSourceLabels.length > 0 ? card.evidenceSourceLabels.join(' · ') : 'fuente documental registrada'}`
    : 'Sin referencias documentales legibles asociadas.';

  return <article className="tender-decision-operational-card" aria-labelledby={headingId}>
    <span className="tender-decision-operational-label">Requisito</span>
    <h5 id={headingId}>{title}</h5>
    <dl>
      <div><dt>Qué sabemos</dt><dd>{known}</dd></div>
      <div><dt>Qué falta por confirmar o aportar</dt><dd>{missing.length > 0
        ? <ul>{missing.map((reason, index) => <li key={`${card.key}-missing-${index}`}>{reason}</li>)}</ul>
        : 'No hay un faltante específico registrado; la validación humana continúa pendiente.'}</dd></div>
      <div><dt>Por qué importa</dt><dd>{impact}</dd></div>
      <div><dt>Siguiente acción</dt><dd>{actions.length > 0
        ? <ul>{actions.map((action, index) => <li key={`${card.key}-action-${index}`}>{action}</li>)}</ul>
        : 'No hay una siguiente acción específica registrada; asignar revisión humana.'}</dd></div>
      <div><dt>Referencias</dt><dd>{references}</dd></div>
    </dl>
  </article>;
}

export function TenderOperationalPendingProjection({ groups, count }: { groups: TenderIntegralOperationalGroup[]; count: number }) {
  return <section id="tender-analysis-operational-pending" className="tender-decision-operational" aria-labelledby="tender-analysis-operational-title">
    <header>
      <div><span className="eyebrow">Pendientes para revisión humana</span><h3 id="tender-analysis-operational-title">Lectura documental incompleta</h3><p>Priorice confirmar o aportar la información pendiente. Esta lectura organiza el trabajo y no equivale a cumplimiento ni decide GO / NO GO.</p></div>
      <strong aria-live="polite">{count} pendiente{count === 1 ? '' : 's'} accionable{count === 1 ? '' : 's'}</strong>
    </header>
    <div className="tender-decision-operational-groups">{groups.map((group, groupIndex) => <section className="tender-decision-operational-group" key={group.key} aria-labelledby={`tender-analysis-operational-group-${groupIndex + 1}`}>
      <header><h4 id={`tender-analysis-operational-group-${groupIndex + 1}`}>{group.label}</h4><span>{group.units.length} pendiente{group.units.length === 1 ? '' : 's'}</span></header>
      <div className="tender-decision-operational-cards">{group.units.map((card, cardIndex) => <TenderOperationalPendingCard key={card.key} card={card} headingId={`tender-analysis-operational-card-${groupIndex + 1}-${cardIndex + 1}`} />)}</div>
    </section>)}</div>
  </section>;
}
