import { useCallback, useEffect, useState } from 'react';
import { AgentWorkbenchShell } from '../../agents/workbench/AgentWorkbenchShell';
import type { AgentWorkbenchHandlers, AgentWorkbenchWorkspace } from '../../agents/workbench/types';
import { VIGIA_VISIBLE_NAMES } from '../../vigia/agentIdentity';
import { loadTenderDossierWorkbench, postTenderDossierWorkbenchMessage, retryTenderDossierWorkbenchJob, reviewTenderDossierWorkbenchLearning } from '../api';
import type { TenderDossierWorkbench, TenderRequest } from '../types';

const VIGIA_DOSSIER_CONFIG = Object.freeze({
  visibleAgentName: VIGIA_VISIBLE_NAMES.tenders,
  subtitle: 'Preparación de oferta',
  workbenchTitle: 'Mesa de ayuda',
  contextLabel: 'Expediente activo',
  capabilities: ['message', 'attach', 'draft', 'review', 'learning'],
  humanReviewRequired: true,
} as const);

const VIGIA_MESSAGE_CAPABILITY_ID = 'agt002.dossier-workbench.reply.v1';

const EMPTY_WORKSPACE: AgentWorkbenchWorkspace = Object.freeze({
  messages: [], jobs: [], sourceLinks: [], requiredActions: [],
  artifacts: [], learningProposals: [], activeLearningPolicies: [],
});

/**
 * Los vínculos seguros del servidor viajan con cada mensaje, así que un expediente con
 * varios trabajos repetiría la misma fuente una vez por trabajo. Se conserva la primera
 * aparición de cada recurso, en orden, para que el panel de fuentes siga siendo legible.
 */
function dedupeSourceLinks(links: { id: string; label: string; sourceRef: string }[]) {
  const seen = new Set<string>();
  return links.filter(link => {
    const key = `${link.label}|${link.sourceRef}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toShellWorkspace(data: TenderDossierWorkbench | null): AgentWorkbenchWorkspace {
  if (!data) return EMPTY_WORKSPACE;
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
    // El estado del trabajo lo proyecta el servidor; el adaptador nunca lo infiere ni lo
    // ablanda, porque de él depende que sólo un fallo terminal ofrezca reintentar.
    jobs: data.jobs.map(job => ({ id: job.id, summary: job.message, status: job.status, createdAt: job.created_at })),
    // Las fuentes visibles combinan los vínculos seguros que el servidor derivó del análisis
    // canónico con los que cada trabajo congeló, de modo que un expediente sin trabajos
    // todavía muestre su contexto de origen.
    sourceLinks: dedupeSourceLinks([
      ...data.reference.context_links.map(link => ({
        id: `reference-${link.kind}-${link.id}`,
        label: link.label,
        sourceRef: link.source_ref,
      })),
      ...data.jobs.flatMap(job => job.context_links.map(link => ({
        id: `${job.id}-${link.kind}-${link.id}`,
        label: link.label,
        sourceRef: link.source_ref,
      }))),
    ]),
    requiredActions: data.required_actions.map(action => ({ id: action.id, description: action.action_text, createdAt: action.created_at })),
    artifacts: [],
    // La revisión humana ya decidida se refleja tal cual la proyecta el RPC: `pendiente`
    // significa sin decidir, y sólo una aprobación trae alcance aprobado.
    learningProposals: data.learning_proposals.map(proposal => ({
      id: proposal.id,
      proposedRule: proposal.proposed_rule,
      scope: proposal.requested_scope,
      createdAt: proposal.created_at,
      decided: proposal.review_status !== 'pendiente',
      decision: proposal.review_status === 'pendiente' ? null : proposal.review_status,
      approvedScope: proposal.approved_scope,
    })),
    activeLearningPolicies: data.active_learning_policies.map(policy => ({
      id: policy.proposal_id,
      rule: policy.proposed_rule,
      scope: policy.scope,
      decidedAt: policy.decided_at,
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
      // El hilo y la referencia canónica los entrega el GET del servidor, así que un
      // expediente recién abierto (jobs=[]) puede enviar su primer mensaje: ya no se exige
      // un trabajo previo, que era la espera circular que bloqueaba la Mesa.
      if (!data) {
        setError('Aún no se ha cargado la Mesa para enviar mensajes.');
        return;
      }
      withBusy(() => postTenderDossierWorkbenchMessage(request, {
        opportunity_id: opportunityId,
        thread_id: data.thread_id,
        client_message_id: crypto.randomUUID(),
        content,
        // Snapshot y vínculos son siempre los de la referencia canónica que sirvió el GET,
        // nunca los del último trabajo: congelar un mensaje nuevo sobre el snapshot de un
        // trabajo viejo lo ataría a un expediente documental ya superado. La autoridad sigue
        // siendo del servidor, que vuelve a derivar la referencia en cada POST y sobrescribe
        // ambos campos; enviarlos coherentes evita además que el cliente muestre una cosa y
        // la Mesa registre otra.
        context_links: data.reference.context_links,
        capability_id: VIGIA_MESSAGE_CAPABILITY_ID,
        snapshot_id: data.reference.snapshot_id,
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
