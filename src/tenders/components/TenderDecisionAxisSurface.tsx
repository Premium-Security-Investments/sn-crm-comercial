import { useEffect, useMemo, useRef, useState } from 'react';
import { VIGIA_VISIBLE_NAMES } from '../../vigia/agentIdentity';
import { focusTenderDetailSection } from './TenderDetailNavigation';
import { resolvesEligibleForNewDrawer } from '../tenderActionableReviewProjection';
import type { TenderPanelState } from '../detailNavigationState';
import {
  tenderIntegralOpenUnitsByRequirementId,
  tenderIntegralOpenUnitsPresentation,
  tenderOperationalPendingCardDomId,
  type TenderIntegralUnitPresentation,
} from '../tenderIntegralAnalysisPresentation';
import {
  AGT002_DECISION_AXES,
  tenderDecisionAxisViews,
  tenderDecisionPausedCopy,
  tenderDecisionPreparationViews,
  tenderDecisionPrimaryCta,
  tenderDecisionSurfaceState,
  type TenderDecisionAxisFindingView,
  type TenderDecisionAxisView,
} from '../tenderDecisionAxisSurface';
import type {
  TenderCurrentProfile,
  TenderDocumentAnalysis,
  TenderGoNoGoDecision,
  TenderQuestionResponse,
  TenderQuestionResponseInput,
  TenderRequest,
} from '../types';
import { TenderGoNoGoDecisionPanel } from './TenderGoNoGoDecisionPanel';
import { QuestionResponseCard, type NormalizedQuestion } from './TenderQuestionResponseCard';
import './tender-decision-axis-surface.css';

export type TenderDecisionAxisSurfaceProps = {
  opportunityId: string;
  opportunityName: string;
  analysis: TenderDocumentAnalysis | null;
  questionResponses: TenderQuestionResponse[];
  currentProfile: TenderCurrentProfile | null | undefined;
  request: TenderRequest;
  canAnswerQuestions: boolean;
  onSaveQuestionResponse?: (input: TenderQuestionResponseInput, files: File[]) => Promise<void>;
  onDecisionChanged: () => Promise<void> | void;
  decisionState: TenderPanelState<TenderGoNoGoDecision | null>;
  onDecisionNavigationStateChanged?: (state: TenderPanelState<TenderGoNoGoDecision | null>) => void;
  onOpenHelpDesk: () => void;
};

const stateClass = (state: TenderDecisionAxisView['state']) => state === 'Favorable con evidencia'
  ? 'state-favorable'
  : state === 'Impedimento material'
    ? 'state-blocker'
    : state === 'Por confirmar'
      ? 'state-pending'
      : 'state-not-evaluated';

const responseState = (response: TenderQuestionResponse | null) => response?.status === 'resolved'
  ? 'Validación registrada' as const
  : response?.status === 'not_applicable'
    ? 'No aplica' as const
    : 'Pendiente de validación' as const;

function preferredAxis(axes: TenderDecisionAxisView[]): TenderDecisionAxisView['axis'] {
  return axes.find(axis => axis.state === 'Impedimento material')?.axis
    ?? axes.find(axis => axis.state === 'Por confirmar')?.axis
    ?? axes[0]?.axis
    ?? AGT002_DECISION_AXES[0];
}

function evidenceCopy(finding: TenderDecisionAxisFindingView): string {
  const count = finding.evidence.length;
  return count > 0 ? `${count} referencia${count === 1 ? '' : 's'} gobernada${count === 1 ? '' : 's'}` : 'Sin referencia gobernada';
}

// Un eje sin hallazgos agrupados es ausencia de LECTURA, no evidencia de cumplimiento (§9.1 de la
// spec). El vacío se explica con esas palabras y nunca como "sin impedimentos".
const EMPTY_AXIS_COPY = 'Este eje no tiene hallazgos materiales leídos. La ausencia de hallazgos no equivale a cumplimiento.';
const MISSING_CROSSCHECK_COPY = 'Cruce material pendiente de documentar.';
const MISSING_ACTION_COPY = 'Sin acción específica registrada.';

// Exclusión mutua Decisión/Análisis (§8.7, §19.6): un hallazgo cuyo `requirement_id` coincide con
// una unidad V3 abierta de la corrida vigente nunca abre el editor legado, sin importar el modo de
// sólo lectura. En su lugar apunta a la tarjeta real en Análisis con `Revisar en Análisis`. Un
// hallazgo histórico o sin unidad V3 elegible conserva exactamente el botón legado existente.
function FindingActionButton({
  finding,
  eligibleUnit,
  onOpen,
  onFocusAnalysisCard,
  readOnly,
}: {
  finding: TenderDecisionAxisFindingView;
  eligibleUnit: TenderIntegralUnitPresentation | null;
  onOpen: (finding: TenderDecisionAxisFindingView, trigger: HTMLButtonElement) => void;
  onFocusAnalysisCard: (unit: TenderIntegralUnitPresentation) => void;
  readOnly: boolean;
}) {
  if (eligibleUnit) {
    return <button type="button" className="secondary tender-decision-axis-pointer-cta" onClick={() => onFocusAnalysisCard(eligibleUnit)}>Revisar en Análisis</button>;
  }
  return <button type="button" className="secondary" onClick={event => onOpen(finding, event.currentTarget)}>{readOnly ? 'Ver detalle' : 'Respuesta histórica (reanaliza)'}</button>;
}

function FindingTable({
  axis,
  onOpen,
  onFocusAnalysisCard,
  eligibleUnitOf,
  readOnly,
}: {
  axis: TenderDecisionAxisView;
  onOpen: (finding: TenderDecisionAxisFindingView, trigger: HTMLButtonElement) => void;
  onFocusAnalysisCard: (unit: TenderIntegralUnitPresentation) => void;
  eligibleUnitOf: (finding: TenderDecisionAxisFindingView) => TenderIntegralUnitPresentation | null;
  readOnly: boolean;
}) {
  return <>
    <div className="tender-decision-axis-table-wrap">
      <table className="tender-decision-axis-table">
        <caption>Hallazgos materiales de {axis.label}</caption>
        <thead><tr><th scope="col">Exigencia</th><th scope="col">Evidencia</th><th scope="col">Cruce</th><th scope="col">Efecto</th><th scope="col">Acción</th></tr></thead>
        <tbody>{axis.findings.length ? axis.findings.map(finding => <tr key={finding.key}>
          <th scope="row">{finding.title}</th>
          <td>{evidenceCopy(finding)}</td>
          <td>{finding.summary || MISSING_CROSSCHECK_COPY}</td>
          <td>{finding.effectLabel}</td>
          {/* Una sola acción por hallazgo: la acción gobernada en texto y un único punto de entrada,
              nunca dos rutas compitiendo ni una acción inventada por la vista. */}
          <td><span className="tender-decision-axis-action-copy">{finding.actionRequired || MISSING_ACTION_COPY}</span><FindingActionButton finding={finding} eligibleUnit={eligibleUnitOf(finding)} onOpen={onOpen} onFocusAnalysisCard={onFocusAnalysisCard} readOnly={readOnly} /></td>
        </tr>) : <tr><td colSpan={5}>{EMPTY_AXIS_COPY}</td></tr>}</tbody>
      </table>
    </div>
    <div className="tender-decision-axis-cards">{axis.findings.length ? axis.findings.map(finding => <article className="tender-decision-axis-card" key={finding.key}>
      <h4>{finding.title}</h4>
      <dl className="tender-decision-axis-card-fields">
        <div><dt>Exigencia</dt><dd>{finding.title}</dd></div>
        <div><dt>Evidencia</dt><dd>{evidenceCopy(finding)}</dd></div>
        <div><dt>Cruce</dt><dd>{finding.summary || MISSING_CROSSCHECK_COPY}</dd></div>
        <div><dt>Efecto</dt><dd>{finding.effectLabel}</dd></div>
        <div><dt>Acción</dt><dd>{finding.actionRequired || MISSING_ACTION_COPY}</dd></div>
      </dl>
      <FindingActionButton finding={finding} eligibleUnit={eligibleUnitOf(finding)} onOpen={onOpen} onFocusAnalysisCard={onFocusAnalysisCard} readOnly={readOnly} />
    </article>) : <p className="muted">{EMPTY_AXIS_COPY}</p>}</div>
  </>;
}

function FindingDrawer({
  analysis,
  finding,
  canAnswer,
  readOnly,
  onClose,
  onSave,
}: {
  analysis: TenderDocumentAnalysis;
  finding: TenderDecisionAxisFindingView;
  canAnswer: boolean;
  readOnly: boolean;
  onClose: () => void;
  onSave?: (input: TenderQuestionResponseInput, files: File[]) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  // `onClose` se recrea en cada render del contenedor; guardarlo en una ref evita que el efecto se
  // vuelva a montar y robe el foco al textarea de respuesta mientras una persona escribe.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Foco inicial: sólo al abrir el drawer o al cambiar de hallazgo, nunca en cada re-render.
  useEffect(() => { headingRef.current?.focus(); }, [finding.key]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const question: NormalizedQuestion = {
    id: finding.key,
    text: finding.finding.label,
    critical: false,
    evidenceRefs: [],
    decisionCopy: {
      title: finding.title,
      state: responseState(finding.latestResponse),
      missing: finding.missing,
      actionRequired: finding.actionRequired,
    },
  };

  return <div className="tender-decision-axis-drawer-backdrop" role="presentation" onMouseDown={onClose}>
    <aside className="tender-decision-axis-drawer" role="dialog" aria-modal="true" aria-labelledby="tender-decision-axis-drawer-title" ref={dialogRef} onMouseDown={event => event.stopPropagation()}>
      <header><div><span className="eyebrow">Hallazgo material</span><h3 id="tender-decision-axis-drawer-title" ref={headingRef} tabIndex={-1}>{finding.title}</h3></div><button type="button" className="secondary" onClick={onClose} aria-label="Cerrar detalle">Cerrar</button></header>
      {finding.summary && <p>{finding.summary}</p>}
      <p className="tender-decision-axis-legacy-warning" role="alert">Este mecanismo legado crea una nueva corrida; no registra una revisión del pendiente actual.</p>
      <QuestionResponseCard
        question={question}
        analysisRunId={analysis.run_id}
        responses={finding.responses}
        canAnswer={canAnswer && !readOnly}
        disabled={readOnly}
        onSave={onSave}
        criticalLabel="Material"
      />
      {/* Trazabilidad plegada: sólo las referencias gobernadas ya resueltas por
          `resolveFindingEvidence`. Los identificadores internos del hallazgo y del requisito viven
          como llave de React y de persistencia, nunca como texto frontal. */}
      <details className="tender-decision-axis-audit"><summary>Auditoría, fuentes e historial</summary>
        {finding.evidence.length
          ? <ul>{finding.evidence.map(item => <li key={item.id}><strong>{item.title}</strong><span>{item.summary}</span><small>{item.locator}</small></li>)}</ul>
          : <p className="muted">Sin fuentes gobernadas asociadas. La falta de fuente no confirma ni descarta el hallazgo.</p>}
        <p className="muted">El historial completo de validaciones humanas de este hallazgo se conserva en la tarjeta de respuesta, con autor y fecha.</p>
      </details>
    </aside>
  </div>;
}

export function TenderDecisionAxisSurface(props: TenderDecisionAxisSurfaceProps) {
  const {
    analysis,
    canAnswerQuestions,
    currentProfile,
    decisionState,
    onDecisionChanged,
    onDecisionNavigationStateChanged,
    onOpenHelpDesk,
    onSaveQuestionResponse,
    opportunityId,
    opportunityName,
    questionResponses,
    request,
  } = props;
  const decisionStateUnresolved = decisionState.phase !== 'ready';
  const decision = decisionState.phase === 'ready' ? decisionState.value : null;
  const axes = useMemo(() => tenderDecisionAxisViews(analysis, questionResponses), [analysis, questionResponses]);
  const openIntegralUnits = useMemo(
    () => tenderIntegralOpenUnitsPresentation(analysis?.integral_analysis),
    [analysis?.integral_analysis],
  );
  // Unidades V3 abiertas de la corrida vigente indexadas por `requirement_id` único (§8.7/§18):
  // única fuente de verdad para decidir, hallazgo por hallazgo, si el editor legado debe ceder el
  // paso al puntero hacia la tarjeta real en Análisis.
  const eligibleUnitsByRequirementId = useMemo(
    () => tenderIntegralOpenUnitsByRequirementId(analysis?.integral_analysis),
    [analysis?.integral_analysis],
  );
  const isCurrentRun = Boolean(analysis?.current);
  const eligibleUnitForFinding = (finding: TenderDecisionAxisFindingView): TenderIntegralUnitPresentation | null => {
    const requirementId = finding.finding.requirement_id;
    const unit = requirementId ? eligibleUnitsByRequirementId.get(requirementId) ?? null : null;
    const eligible = resolvesEligibleForNewDrawer({
      source_kind: unit ? 'integral_unit' : null,
      source_id: unit ? unit.technical.unitId : null,
      is_historical_run: !isCurrentRun,
    });
    return eligible ? unit : null;
  };
  // Este interruptor de superficie completa sigue exigiendo los cinco ejes vacíos (§8.1): cuando
  // hay lectura material por eje, la tabla de hallazgos se conserva y la exclusión mutua vive por
  // hallazgo (`eligibleUnitForFinding`), nunca reemplazando la lectura completa de Decisión.
  const useOperationalProjection = axes.length === AGT002_DECISION_AXES.length
    && axes.every(axis => axis.state === 'No evaluado' && axis.findings.length === 0)
    && openIntegralUnits.length > 0;
  const surfaceState = tenderDecisionSurfaceState(analysis, decision);
  const drawerReadOnly = decisionStateUnresolved || surfaceState.readOnly;
  const primaryCta = tenderDecisionPrimaryCta(surfaceState, axes);
  // `null` = selección automática: el eje de mayor prioridad (impedimento material confirmado,
  // luego pregunta material pendiente). Un clic de la persona la fija; una corrida nueva la
  // devuelve a automática, para que el análisis recién cargado no quede leyendo un eje viejo.
  const [pinnedAxisId, setPinnedAxisId] = useState<TenderDecisionAxisView['axis'] | null>(null);
  // Se guarda la CLAVE del hallazgo, no una copia de su vista: así el drawer refleja siempre el
  // historial de respuestas vigente después de guardar una respuesta, sin quedarse congelado.
  const [selectedFindingKey, setSelectedFindingKey] = useState<string | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const runId = analysis?.run_id ?? null;
  useEffect(() => { setPinnedAxisId(null); setSelectedFindingKey(null); }, [runId]);
  const selectedAxis = axes.find(axis => axis.axis === (pinnedAxisId ?? preferredAxis(axes))) ?? axes[0];
  const selectedFinding = selectedFindingKey
    ? axes.flatMap(axis => axis.findings).find(finding => finding.key === selectedFindingKey) ?? null
    : null;

  const openFinding = (finding: TenderDecisionAxisFindingView, trigger: HTMLButtonElement) => {
    // Backstop de exclusión mutua (§8.7/§19.6): ningún hallazgo V3 elegible de la corrida vigente
    // puede montar el drawer legado, sin importar qué punto de entrada llamó a esta función.
    if (eligibleUnitForFinding(finding)) return;
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : trigger;
    setSelectedFindingKey(finding.key);
  };
  const closeFinding = () => {
    setSelectedFindingKey(null);
    const target = previouslyFocusedRef.current;
    previouslyFocusedRef.current = null;
    requestAnimationFrame(() => target?.isConnected && target.focus());
  };
  const focusFormalDecision = () => {
    const target = document.getElementById('tender-go-no-go-actions');
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target?.focus({ preventScroll: true });
  };
  const focusDocumentAnalysis = () => {
    focusTenderDetailSection(document.getElementById('tender-analysis'));
  };
  // Enfoca la tarjeta real de Análisis con el mismo id estable que produce la tarjeta (§8/§18):
  // nunca arma un selector CSS a mano, sólo consulta el id literal con `getElementById`.
  const focusOperationalPendingCard = (unit: TenderIntegralUnitPresentation) => {
    focusTenderDetailSection(document.getElementById(tenderOperationalPendingCardDomId(unit.technical.unitId)));
  };
  const resolvePrimaryQuestion = (findingId: string, trigger: HTMLButtonElement) => {
    const owner = axes.find(axis => axis.findings.some(finding => finding.key === findingId));
    const match = owner?.findings.find(finding => finding.key === findingId);
    if (!owner || !match) return;
    // La CTA primaria comparte la misma exclusión mutua que la tabla (§8.7/§19.6): una pregunta
    // prioritaria elegible para V3 nunca abre el drawer legado, sólo enfoca la tarjeta real.
    const eligibleUnit = eligibleUnitForFinding(match);
    if (eligibleUnit) { focusOperationalPendingCard(eligibleUnit); return; }
    // La CTA lleva a la pregunta prioritaria: deja el eje que la contiene a la vista, no sólo el
    // drawer, para que al cerrarlo la lectura continúe donde corresponde.
    setPinnedAxisId(owner.axis);
    openFinding(match, trigger);
  };
  const pausedCopy = tenderDecisionPausedCopy(analysis);
  const preparation = tenderDecisionPreparationViews(analysis);
  const bannerTitle = surfaceState.state === 'paused'
    ? pausedCopy.title
    : surfaceState.state === 'post_go'
      ? 'GO humano registrado'
      : surfaceState.readOnly
        ? 'NO GO humano registrado'
        : 'Análisis para decidir';

  const formalDecisionPanel = <TenderGoNoGoDecisionPanel
    opportunityId={opportunityId}
    opportunityName={opportunityName}
    analysis={analysis}
    currentProfile={currentProfile}
    request={request}
    questionResponses={questionResponses}
    onChanged={onDecisionChanged}
    onNavigationStateChanged={onDecisionNavigationStateChanged}
  />;

  return <section className={`tender-decision-axis-surface${useOperationalProjection ? ' is-formal-primary' : ''}`} aria-labelledby="tender-decision-axis-title">
    <header className="tender-decision-axis-hero">
      <div><span className="eyebrow">{useOperationalProjection ? 'Control formal humano' : 'Cinco señales para una decisión humana'}</span><h2 id="tender-decision-axis-title">{useOperationalProjection ? 'Decisión GO / NO GO' : 'Análisis para decidir'}</h2><p>{useOperationalProjection
        ? 'La persona autorizada puede registrar su decisión. Los pendientes documentales completos permanecen disponibles en Análisis como apoyo, sin bloquear este control.'
        : 'Contrasta exigencia, evidencia, cruce, efecto y acción sin convertir el análisis en una decisión automática.'}</p></div>
      {!useOperationalProjection && <strong className={`tender-decision-axis-coverage ${surfaceState.state === 'paused' ? 'is-paused' : 'is-ready'}`}>{`Cobertura: ${surfaceState.state === 'paused' ? 'PAUSADA' : 'LISTA'}`}</strong>}
    </header>

    {!useOperationalProjection && <div className={`tender-decision-axis-banner ${surfaceState.state}`} aria-live="polite">
      <div><strong>{bannerTitle}</strong>{surfaceState.state === 'paused'
        ? <><span>{pausedCopy.detail}</span><span>{pausedCopy.nextAction}</span></>
        : surfaceState.state === 'post_go'
          ? <span>La preparación operativa puede continuar. La persona autorizada conserva el control.</span>
          : <span>{surfaceState.readOnly
            ? 'La decisión vigente de este análisis es NO GO. Cualquier decisión posterior queda registrada como reemplazo trazable en el control formal.'
            : 'Revisión humana requerida antes de registrar GO o NO GO.'}</span>}</div>
    </div>}

    {useOperationalProjection
      ? <>
        <div className="tender-decision-axis-formal tender-decision-axis-formal-primary">
          {formalDecisionPanel}
        </div>
        <aside className="tender-decision-analysis-pointer" aria-labelledby="tender-decision-analysis-pointer-title">
          <div><span className="eyebrow">Apoyo documental</span><h3 id="tender-decision-analysis-pointer-title">Pendientes documentales en Análisis</h3><p>La lista completa está en Análisis para evitar duplicidades en el expediente.</p></div>
          <div className="tender-decision-analysis-pointer-action"><strong aria-live="polite">{openIntegralUnits.length} pendiente{openIntegralUnits.length === 1 ? '' : 's'} por revisar</strong><a href="#tender-analysis" onClick={event => { event.preventDefault(); focusDocumentAnalysis(); }}>Revisar pendientes en Análisis</a></div>
        </aside>
      </>
      : <>
        <nav className="tender-decision-axis-rail" aria-label="Ejes del análisis para decidir">{axes.map(axis => <button
          type="button"
          key={axis.axis}
          className={`tender-decision-axis-chip ${stateClass(axis.state)}`}
          aria-pressed={axis.axis === selectedAxis.axis}
          onClick={() => setPinnedAxisId(axis.axis)}
        ><span>{axis.label}</span><small>{axis.state} · {axis.count}</small></button>)}</nav>

        <section className="tender-decision-axis-body" aria-labelledby={`tender-decision-axis-${selectedAxis.axis}`}>
          <header><div><span className="eyebrow">Eje seleccionado</span><h3 id={`tender-decision-axis-${selectedAxis.axis}`}>{selectedAxis.label}</h3></div><strong className={stateClass(selectedAxis.state)}>{selectedAxis.state}</strong></header>
          <FindingTable axis={selectedAxis} onOpen={openFinding} onFocusAnalysisCard={focusOperationalPendingCard} eligibleUnitOf={eligibleUnitForFinding} readOnly={drawerReadOnly} />
        </section>
      </>}

    {/* Los hallazgos ordinarios reclasificados a preparación (§7.2) no alimentan ningún eje ni
        bloquean la decisión: se conservan plegados para que esta lectura única no pierda contenido
        gobernado que antes vivía en la sección Análisis. */}
    {preparation.length > 0 && <details className="tender-decision-axis-preparation">
      <summary>Preparación ordinaria registrada ({preparation.length}) — no impide decidir</summary>
      <ul>{preparation.map(item => <li key={item.key}><strong>{item.title}</strong><span>{item.actionRequired || MISSING_ACTION_COPY}</span></li>)}</ul>
    </details>}

    {/* Barra final (§13/§15 de la spec): el control formal GO/NO GO embebido, el enlace a Mesa de
        ayuda y la ÚNICA CTA primaria, siempre al final del orden de tabulación de la sección para
        no interceptar la lectura de los cinco ejes. GO y NO GO viven dentro del panel embebido;
        nunca son dos CTAs primarias compitiendo aquí. */}
    <footer className="tender-decision-axis-final">
      {!useOperationalProjection && <div className="tender-decision-axis-formal">
        {formalDecisionPanel}
      </div>}
      <div className="tender-decision-axis-final-bar">
        <p>{VIGIA_VISIBLE_NAMES.tenders} analiza y agrupa; la decisión GO / NO GO permanece humana.</p>
        {/* Cuando la CTA primaria ya es "Abrir Mesa de ayuda" (post_go), el botón secundario al
            mismo destino queda oculto: evita dos controles duplicados hacia la misma acción y
            conserva una única CTA primaria al final del orden tabulable. */}
        {primaryCta.id !== 'open_help_desk' && <button type="button" className="tender-decision-axis-help" onClick={onOpenHelpDesk}>Mesa de ayuda</button>}
        {primaryCta.id === 'coverage' && (useOperationalProjection
          ? <button type="button" className="tender-decision-axis-cta" disabled={decisionStateUnresolved} onClick={focusFormalDecision}>Registrar decisión humana</button>
          : <button type="button" className="tender-decision-axis-cta" onClick={focusDocumentAnalysis}>Revisar documentos pendientes</button>)}
        {primaryCta.id === 'resolve_question' && <button type="button" className="tender-decision-axis-cta" disabled={decisionStateUnresolved} onClick={event => resolvePrimaryQuestion(primaryCta.findingId, event.currentTarget)}>Resolver la pregunta prioritaria</button>}
        {primaryCta.id === 'record_decision' && <button type="button" className="tender-decision-axis-cta" disabled={decisionStateUnresolved} onClick={focusFormalDecision}>Registrar decisión humana</button>}
        {primaryCta.id === 'open_help_desk' && <button type="button" className="tender-decision-axis-cta" onClick={onOpenHelpDesk}>Abrir Mesa de ayuda</button>}
      </div>
    </footer>

    {/* Guarda explícita en el punto de montaje (§8.7/§19.6), redundante con `openFinding`: ningún
        hallazgo V3 elegible de la corrida vigente monta el drawer legado ni su QuestionResponseCard. */}
    {selectedFinding && analysis && !eligibleUnitForFinding(selectedFinding) && <FindingDrawer analysis={analysis} finding={selectedFinding} canAnswer={canAnswerQuestions} readOnly={drawerReadOnly} onClose={closeFinding} onSave={onSaveQuestionResponse} />}
  </section>;
}
