import type { TenderPanelState } from '../detailNavigationState';
import type { TenderCommercialContext } from '../tenderDecisionBriefModel';
import type {
  TenderCurrentProfile,
  TenderDocumentAnalysis,
  TenderGoNoGoDecision,
  TenderQuestionResponse,
  TenderQuestionResponseInput,
  TenderRequest,
} from '../types';
import { TenderDecisionAxisSurface } from './TenderDecisionAxisSurface';
import { TenderDecisionBrief } from './TenderDecisionBrief';
import { TenderGoNoGoDecisionPanel } from './TenderGoNoGoDecisionPanel';
import { TenderInitialDecisionSummary } from './TenderInitialDecisionSummary';
import type { Agt002InitialReport } from '../agt002InitialReportProjection';

export type TenderDecisionExperienceProps = {
  decisionAxisSurfaceEnabled: boolean;
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
  commercialContext?: TenderCommercialContext;
  initialReport?: Agt002InitialReport | null;
};

export function TenderDecisionExperience(props: TenderDecisionExperienceProps) {
  const {
    analysis,
    canAnswerQuestions,
    commercialContext,
    currentProfile,
    decisionAxisSurfaceEnabled,
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
  const initialReport = props.initialReport ?? null;

  // The legacy five-axis surface reads the legacy engine's analysis; with an INITIAL report it would only say "pausado"
  // and contradict the verdict, so the INITIAL summary takes its place.
  // Nothing analyzed yet (no INITIAL report, no legacy analysis): a plain notice instead of five empty axes.
  const nothingAnalyzed = !initialReport && !analysis;
  if (decisionAxisSurfaceEnabled && !initialReport && !nothingAnalyzed) {
    return <TenderDecisionAxisSurface
      opportunityId={opportunityId}
      opportunityName={opportunityName}
      analysis={analysis}
      questionResponses={questionResponses}
      currentProfile={currentProfile}
      request={request}
      canAnswerQuestions={canAnswerQuestions}
      onSaveQuestionResponse={onSaveQuestionResponse}
      onDecisionChanged={onDecisionChanged}
      decisionState={decisionState}
      onDecisionNavigationStateChanged={onDecisionNavigationStateChanged}
      onOpenHelpDesk={onOpenHelpDesk}
    />;
  }

  return <>
    {/* With an INITIAL analysis, its verdict replaces the legacy-engine brief (which would only say "no disponible"). */}
    {initialReport
      ? <TenderInitialDecisionSummary report={initialReport} />
      : nothingAnalyzed
        ? <section className="initial-decision-summary is-empty" aria-label="Resultado del análisis inicial">
          <small>Resultado del análisis inicial</small>
          <strong>Todavía no hay análisis</strong>
          <p>Cuando el análisis esté listo, aquí verá el veredicto, cómo está la empresa frente a cada eje y lo que impide avanzar.</p>
        </section>
        : <TenderDecisionBrief analysis={analysis} questionResponses={questionResponses} commercialContext={commercialContext} />}
    <TenderGoNoGoDecisionPanel
      opportunityId={opportunityId}
      opportunityName={opportunityName}
      analysis={analysis}
      currentProfile={currentProfile}
      request={request}
      questionResponses={questionResponses}
      onNavigationStateChanged={onDecisionNavigationStateChanged}
      onChanged={onDecisionChanged}
    />
  </>;
}
