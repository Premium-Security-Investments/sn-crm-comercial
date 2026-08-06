import { useCallback, useEffect, useState } from 'react';
import { AgentWorkbenchShell } from '../../agents/workbench/AgentWorkbenchShell';
import type { AgentWorkbenchHandlers, AgentWorkbenchWorkspace } from '../../agents/workbench/types';
import { VIGIA_VISIBLE_NAMES } from '../../vigia/agentIdentity';
import { loadTenderDossierWorkbench, postTenderDossierWorkbenchMessage, retryTenderDossierWorkbenchJob, reviewTenderDossierWorkbenchLearning } from '../api';
import type { TenderDossierWorkbench, TenderRequest } from '../types';

const VIGIA_DOSSIER_CONFIG = Object.freeze({
  visibleAgentName: VIGIA_VISIBLE_NAMES.tenders,
  subtitle: 'Copiloto para análisis de licitaciones',
  contextLabel: 'Expediente activo',
  capabilities: ['message', 'attach', 'draft', 'review', 'learning'],
  humanReviewRequired: true,
} as const);

const VIGIA_MESSAGE_CAPABILITY_ID = 'agt002.dossier-workbench.reply.v1';

function toShellWorkspace(data: TenderDossierWorkbench | null): AgentWorkbenchWorkspace {
  if (!data) {
    return { messages: [], jobs: [], sourceLinks: [], requiredActions: [], artifacts: [], learningProposals: [] };
  }
  return {
    messages: data.messages.map(message => ({
      id: message.id,
      authorKind: message.author_kind,
      visibleAuthorName: message.author_kind === 'agent'
        ? VIGIA_DOSSIER_CONFIG.visibleAgentName
        : message.visible_agent_name,
      content: message.content,
      createdAt: message.created_at,
    })),
    jobs: data.jobs.map(job => ({ id: job.id, summary: job.message, createdAt: job.created_at })),
    sourceLinks: data.jobs.flatMap(job => job.context_links.map(link => ({
      id: `${job.id}-${link.kind}-${link.id}`,
      label: link.label,
      sourceRef: link.source_ref,
    }))),
    requiredActions: data.required_actions.map(action => ({ id: action.id, description: action.action_text, createdAt: action.created_at })),
    artifacts: [],
    learningProposals: data.learning_proposals.map(proposal => ({
      id: proposal.id,
      proposedRule: proposal.proposed_rule,
      scope: proposal.requested_scope,
      createdAt: proposal.created_at,
      decided: false,
    })),
  };
}

export function TenderDossierVigiaWorkbench({ opportunityId, request }: { opportunityId: string; request: TenderRequest }) {
  const [data, setData] = useState<TenderDossierWorkbench | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await loadTenderDossierWorkbench(request, opportunityId));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [opportunityId, request]);

  useEffect(() => { void reload(); }, [reload]);

  const withBusy = (operation: () => Promise<unknown>) => {
    setBusy(true);
    void operation()
      .then(() => reload())
      .catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };

  const handlers: AgentWorkbenchHandlers = {
    onSendMessage: content => {
      const threadId = data?.thread_id ?? null;
      const lastJob = data && data.jobs.length > 0 ? data.jobs[data.jobs.length - 1] : null;
      if (!threadId || !lastJob) {
        setError('Aún no hay una versión de referencia para enviar mensajes.');
        return;
      }
      withBusy(() => postTenderDossierWorkbenchMessage(request, {
        opportunity_id: opportunityId,
        thread_id: threadId,
        client_message_id: crypto.randomUUID(),
        content,
        context_links: [],
        capability_id: VIGIA_MESSAGE_CAPABILITY_ID,
        snapshot_id: lastJob.snapshot_id,
        base_version_id: null,
      }));
    },
    onRetryJob: jobId => withBusy(() => retryTenderDossierWorkbenchJob(request, { opportunity_id: opportunityId, job_id: jobId })),
    onReviewLearning: (proposalId, decision, scope) => withBusy(() => reviewTenderDossierWorkbenchLearning(request, {
      opportunity_id: opportunityId,
      proposal_id: proposalId,
      decision,
      scope: decision === 'approved' ? scope : null,
      comment: null,
    })),
  };

  return <AgentWorkbenchShell config={VIGIA_DOSSIER_CONFIG} workspace={toShellWorkspace(data)} handlers={handlers} busy={busy} error={error} />;
}
