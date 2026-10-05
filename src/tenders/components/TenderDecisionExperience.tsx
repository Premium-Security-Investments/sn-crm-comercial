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

  if (decisionAxisSurfaceEnabled) {
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
