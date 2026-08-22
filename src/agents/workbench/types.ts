export type AgentWorkbenchCapability = 'message' | 'attach' | 'draft' | 'review' | 'learning';

export type AgentWorkbenchConfig = {
  visibleAgentName: string;
  subtitle: string;
  workbenchTitle: string;
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

/**
 * Estado del trabajo tal como el adaptador lo recibe del servidor. Sólo `failed` es un
 * estado terminal reintentable: el shell nunca ofrece reintentar sobre `queued`, sobre
 * `in_progress`, sobre `completed` ni sobre `obsolete`.
 *
 * `obsolete` es terminal y NO reintentable a propósito: el trabajo quedó atado a una versión
 * documental que ya fue superada, y como el trabajo es inmutable, repetirlo volvería a quedar
 * obsoleto siempre. La recuperación real es pedirlo de nuevo sobre la versión vigente.
 */
export type AgentWorkbenchJobStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'obsolete';

export type AgentWorkbenchJob = {
  id: string;
  summary: string;
  status: AgentWorkbenchJobStatus;
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

/**
 * `decided` es la verdad de la revisión humana: una vez decidida, la propuesta ya no ofrece
 * botones y muestra su resultado. `approvedScope` sólo existe cuando la decisión fue aprobar.
 */
export type AgentWorkbenchLearningDecision = 'approved' | 'rejected';

export type AgentWorkbenchLearningProposal = {
  id: string;
  proposedRule: string;
  scope: string;
  createdAt: string;
  decided: boolean;
  decision: AgentWorkbenchLearningDecision | null;
  approvedScope: string | null;
};

export type AgentWorkbenchActiveLearningPolicy = {
  id: string;
  rule: string;
  scope: string;
  decidedAt: string;
};

export type AgentWorkbenchWorkspace = {
  messages: readonly AgentWorkbenchMessage[];
  jobs: readonly AgentWorkbenchJob[];
  sourceLinks: readonly AgentWorkbenchContextLink[];
  requiredActions: readonly AgentWorkbenchRequiredAction[];
  artifacts: readonly AgentWorkbenchArtifact[];
  learningProposals: readonly AgentWorkbenchLearningProposal[];
  activeLearningPolicies: readonly AgentWorkbenchActiveLearningPolicy[];
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
