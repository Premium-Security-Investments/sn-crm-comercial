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
    <TenderDecisionBrief analysis={analysis} questionResponses={questionResponses} commercialContext={commercialContext} />
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
