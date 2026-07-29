export type AgentWorkbenchCapability = 'message' | 'attach' | 'draft' | 'review' | 'learning';

export type AgentWorkbenchConfig = {
  visibleAgentName: string;
  subtitle: string;
  contextLabel: string;
  capabilities: readonly AgentWorkbenchCapability[];
  humanReviewRequired: true;
};

export type AgentWorkbenchMessageAuthorKind = 'human' | 'agent';

export type AgentWorkbenchMessage = {
  id: string;
  authorKind: AgentWorkbenchMessageAuthorKind;
  visibleAuthorName: string | null;
  content: string;
  createdAt: string;
};

export type AgentWorkbenchJob = {
  id: string;
  summary: string;
  createdAt: string;
};

export type AgentWorkbenchContextLink = {
  id: string;
  label: string;
  sourceRef: string;
};

export type AgentWorkbenchRequiredAction = {
  id: string;
  description: string;
  createdAt: string;
};

export type AgentWorkbenchArtifact = {
  id: string;
  title: string;
  preview: string;
  createdAt: string;
};

export type AgentWorkbenchLearningProposal = {
  id: string;
  proposedRule: string;
  scope: string;
  createdAt: string;
  decided: boolean;
};

export type AgentWorkbenchWorkspace = {
  messages: readonly AgentWorkbenchMessage[];
  jobs: readonly AgentWorkbenchJob[];
  sourceLinks: readonly AgentWorkbenchContextLink[];
  requiredActions: readonly AgentWorkbenchRequiredAction[];
  artifacts: readonly AgentWorkbenchArtifact[];
  learningProposals: readonly AgentWorkbenchLearningProposal[];
};

export type AgentWorkbenchHandlers = {
  onSendMessage: (content: string) => void;
  onRetryJob: (jobId: string) => void;
  onReviewArtifact?: (artifactId: string, decision: 'aprobado' | 'rechazado') => void;
  onReviewLearning: (proposalId: string, decision: 'approved' | 'rejected', scope: string) => void;
};

export type AgentWorkbenchShellProps = {
  config: AgentWorkbenchConfig;
  workspace: AgentWorkbenchWorkspace;
  handlers: AgentWorkbenchHandlers;
  busy?: boolean;
  error?: string | null;
};
