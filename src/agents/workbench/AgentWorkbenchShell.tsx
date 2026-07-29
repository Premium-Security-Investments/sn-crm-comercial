import { useState } from 'react';
import './agent-workbench.css';
import type { AgentWorkbenchCapability, AgentWorkbenchShellProps } from './types';

const FRONT_LABELS: Record<AgentWorkbenchCapability, string> = {
  message: 'Mensajes',
  attach: 'Adjuntos y vínculos',
  draft: 'Borradores',
  review: 'Revisión',
  learning: 'Aprendizaje',
};

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
      <h3>Mesa de trabajo</h3>
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
        {workspace.jobs.map(job => <li key={job.id}>
          <span>{job.summary}</span>
          <button type="button" className="secondary" disabled={busy} onClick={() => handlers.onRetryJob(job.id)}>Reintentar</button>
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
      {workspace.sourceLinks.length
        ? <ul>{workspace.sourceLinks.map(link => <li key={link.id}><a href={link.sourceRef} target="_blank" rel="noreferrer">{link.label}</a></li>)}</ul>
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
              {!proposal.decided && <div className="agent-workbench-review-actions">
                <button type="button" disabled={busy} onClick={() => handlers.onReviewLearning(proposal.id, 'approved', proposal.scope)}>Aprobar</button>
                <button type="button" className="secondary" disabled={busy} onClick={() => handlers.onReviewLearning(proposal.id, 'rejected', proposal.scope)}>Rechazar</button>
              </div>}
            </li>)}</ul>
          : <p className="muted">Sin propuestas de aprendizaje.</p>}
      </div>}
    </div>

    <footer className="agent-workbench-footer">
      Control humano obligatorio: {config.visibleAgentName} prepara borradores y señala faltantes. La encargada debe revisar y aprobar cada versión antes de integrarla al paquete final.
    </footer>
  </section>;
}
