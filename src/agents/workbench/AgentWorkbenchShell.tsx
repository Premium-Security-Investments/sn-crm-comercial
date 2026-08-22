import { useState } from 'react';
import './agent-workbench.css';
import type {
  AgentWorkbenchCapability,
  AgentWorkbenchJobStatus,
  AgentWorkbenchLearningDecision,
  AgentWorkbenchShellProps,
} from './types';

const FRONT_LABELS: Record<AgentWorkbenchCapability, string> = {
  message: 'Mensajes',
  attach: 'Adjuntos y vínculos',
  draft: 'Borradores',
  review: 'Revisión',
  learning: 'Aprendizaje',
};

const JOB_STATUS_LABELS: Record<AgentWorkbenchJobStatus, string> = {
  queued: 'En cola',
  in_progress: 'En curso',
  completed: 'Completado',
  failed: 'Fallido',
  obsolete: 'Obsoleto',
};

const LEARNING_DECISION_LABELS: Record<AgentWorkbenchLearningDecision, string> = {
  approved: 'Aprobada',
  rejected: 'Rechazada',
};

/** Sólo http/https son destinos navegables; el resto son referencias internas de expediente. */
function isNavigable(sourceRef: string) {
  return /^https?:\/\//i.test(sourceRef);
}

export function AgentWorkbenchShell({ config, workspace, handlers, busy = false, error = null }: AgentWorkbenchShellProps) {
  const [draftMessage, setDraftMessage] = useState('');
  // Fail-closed: humanReviewRequired is the shell's non-negotiable guarantee. If a
  // misconfigured adapter ever supplies anything other than literal true, refuse to render.
  if (config.humanReviewRequired !== true) return null;
  const has = (capability: AgentWorkbenchCapability) => config.capabilities.includes(capability);

  const submitMessage = () => {
    const content = draftMessage.trim();
    if (!content) return;
    handlers.onSendMessage(content);
    setDraftMessage('');
  };

  return <section className="agent-workbench" aria-label={`${config.visibleAgentName} · ${config.subtitle}`}>
    <header className="agent-workbench-header">
      <span className="agent-workbench-eyebrow">{config.visibleAgentName} · {config.subtitle}</span>
      <h3>{config.workbenchTitle}</h3>
    </header>
    {error && <div className="notice" role="alert">{error}</div>}

    <div className="agent-workbench-panel agent-workbench-fronts" aria-label="Frentes de trabajo">
      <small>Frentes activos</small>
      <ul>{config.capabilities.map(capability => <li key={capability}>{FRONT_LABELS[capability] || capability}</li>)}</ul>
    </div>

    {has('message') && <div className="agent-workbench-panel agent-workbench-thread" aria-label="Hilo">
      <small>Hilo</small>
      <ul className="agent-workbench-messages">
        {workspace.messages.map(message => <li key={message.id} className={`agent-workbench-message agent-workbench-message-${message.authorKind}`}>
          <strong>{message.authorKind === 'agent' ? (message.visibleAuthorName || config.visibleAgentName) : 'Encargada'}</strong>
          <p>{message.content}</p>
          <span className="muted">{message.createdAt}</span>
        </li>)}
        {workspace.messages.length === 0 && <li className="muted">Sin mensajes todavía.</li>}
      </ul>
      {workspace.jobs.length > 0 && <ul className="agent-workbench-jobs">
        {workspace.jobs.map(job => <li key={job.id} className={`agent-workbench-job agent-workbench-job-${job.status}`}>
          <span>{job.summary}</span>
          <span className="agent-workbench-job-status">{JOB_STATUS_LABELS[job.status] || job.status}</span>
          {/* Reintentar es una acción sobre un fallo terminal: un trabajo en cola, en curso o
              ya completado nunca puede ofrecerla, porque el reintento lo rechazaría igualmente. */}
          {job.status === 'failed' && <button type="button" className="secondary" disabled={busy} onClick={() => handlers.onRetryJob(job.id)}>Reintentar</button>}
          {/* Un trabajo obsoleto tampoco ofrece reintento: quedó congelado sobre una versión
              del documento ya superada, así que repetirlo volvería a quedar obsoleto. Lo que
              sí recupera el trabajo es volver a pedirlo sobre la versión vigente. */}
          {job.status === 'obsolete' && <span className="muted agent-workbench-job-hint">El documento cambió mientras se trabajaba; vuelva a pedirlo sobre la versión vigente.</span>}
        </li>)}
      </ul>}
      {has('attach') && <p className="muted agent-workbench-attach-hint">Puede vincular fuentes activas al enviar un mensaje.</p>}
      <div className="agent-workbench-composer">
        <textarea value={draftMessage} maxLength={12000} disabled={busy} onChange={event => setDraftMessage(event.target.value)} placeholder="Escriba un mensaje…" />
        <button type="button" disabled={busy || !draftMessage.trim()} onClick={submitMessage}>Enviar</button>
      </div>
    </div>}

    <div className="agent-workbench-panel agent-workbench-context" aria-label="Contexto y fuentes">
      <small>{config.contextLabel}</small>
      {/* Una fuente sólo se ofrece como enlace cuando su referencia es realmente navegable.
          Las referencias internas de expediente se muestran tal cual, sin fingir un destino. */}
      {workspace.sourceLinks.length
        ? <ul>{workspace.sourceLinks.map(link => <li key={link.id}>{isNavigable(link.sourceRef)
            ? <a href={link.sourceRef} target="_blank" rel="noreferrer">{link.label}</a>
            : <><span>{link.label}</span> <code className="muted">{link.sourceRef}</code></>}</li>)}</ul>
        : <p className="muted">Sin fuentes vinculadas.</p>}
    </div>

    <div className="agent-workbench-panel agent-workbench-actions" aria-label="Acciones requeridas">
      <small>Acciones requeridas</small>
      {workspace.requiredActions.length
        ? <ul>{workspace.requiredActions.map(action => <li key={action.id}>{action.description}</li>)}</ul>
        : <p className="muted">Sin acciones pendientes.</p>}
    </div>

    <div className="agent-workbench-panel agent-workbench-artifacts" aria-label="Artefactos y revisión">
      <small>Artefactos y revisión</small>
      {has('draft')
        ? (workspace.artifacts.length
          ? <ul>{workspace.artifacts.map(artifact => <li key={artifact.id} className="agent-workbench-artifact">
              <strong>{artifact.title}</strong>
              <p>{artifact.preview}</p>
              {has('review') && handlers.onReviewArtifact && <div className="agent-workbench-review-actions">
                <button type="button" disabled={busy} onClick={() => handlers.onReviewArtifact?.(artifact.id, 'aprobado')}>Aprobar</button>
                <button type="button" className="secondary" disabled={busy} onClick={() => handlers.onReviewArtifact?.(artifact.id, 'rechazado')}>Rechazar</button>
              </div>}
            </li>)}</ul>
          : <p className="muted">Sin borradores todavía.</p>)
        : <p className="muted">Este frente no está habilitado.</p>}

      {has('learning') && <div className="agent-workbench-learning">
        <small>Propuestas de aprendizaje</small>
        {workspace.learningProposals.length
          ? <ul>{workspace.learningProposals.map(proposal => <li key={proposal.id}>
              <p>{proposal.proposedRule}</p>
              <span className="muted">Alcance propuesto: {proposal.scope}</span>
              {/* Una propuesta ya decidida muestra su resultado y retira los controles:
                  la decisión humana es única y no se vuelve a ofrecer. */}
              {proposal.decided
                ? <span className={`agent-workbench-learning-state agent-workbench-learning-state-${proposal.decision || 'decidida'}`}>
                    {proposal.decision ? LEARNING_DECISION_LABELS[proposal.decision] : 'Decidida'}
                    {proposal.decision === 'approved' && proposal.approvedScope ? ` · Alcance aprobado: ${proposal.approvedScope}` : ''}
                  </span>
                : <div className="agent-workbench-review-actions">
                    <button type="button" disabled={busy} onClick={() => handlers.onReviewLearning(proposal.id, 'approved', proposal.scope)}>Aprobar</button>
                    <button type="button" className="secondary" disabled={busy} onClick={() => handlers.onReviewLearning(proposal.id, 'rejected', proposal.scope)}>Rechazar</button>
                  </div>}
            </li>)}</ul>
          : <p className="muted">Sin propuestas de aprendizaje.</p>}

        <small>Políticas de aprendizaje activas</small>
        {workspace.activeLearningPolicies.length
          ? <ul className="agent-workbench-learning-policies">{workspace.activeLearningPolicies.map(policy => <li key={policy.id}>
              <p>{policy.rule}</p>
              <span className="muted">Alcance aprobado: {policy.scope} · Decidida: {policy.decidedAt}</span>
            </li>)}</ul>
          : <p className="muted">Sin políticas de aprendizaje activas.</p>}
      </div>}
    </div>

    <footer className="agent-workbench-footer">
      Control humano obligatorio: {config.visibleAgentName} prepara borradores y señala faltantes. La encargada debe revisar y aprobar cada versión antes de integrarla al paquete final.
    </footer>
  </section>;
}
