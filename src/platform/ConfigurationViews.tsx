// IT → Agentes: Propuestas (por aprobar), Historial de versiones y Perfiles de uso.
// Toda acción pide confirmación y la firma el servidor con el nombre del perfil autenticado.
import { useMemo, useState } from 'react';
import { Badge, EmptyState, Panel } from '../siio/SiioUi';
import {
  PROFILE_ASSIGNMENT_NOTICE,
  PROFILES_ACROSS_AGENTS_NOTE,
  VERSION_STATUS_LABELS,
  versionLabel,
  versionStatusTone,
  type AgentConfigurationPayload,
  type ConfigurationVersion,
  type ModelUsagePayload,
} from './agentsPresentation';
import { profileSlug } from './agentConfigForm';
import { runPlatformAction, type Loadable } from './usePlatformData';

const dateTime = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' });
export function fmtDateTime(value: string | null | undefined) { return value ? dateTime.format(new Date(value)) : '—'; }
function messageOf(error: unknown) { return error instanceof Error ? error.message : String(error); }

export function AdminNotConnected({ config }: { config: AgentConfigurationPayload }) {
  if (config.admin_connected) return null;
  return <div className="notice" role="status">La administración de la plataforma no está conectada: se puede consultar, pero no proponer, aprobar ni crear perfiles.</div>;
}

export function ChangesTable({ version, config, agentNames }: { version: ConfigurationVersion; config: AgentConfigurationPayload; agentNames: Record<string, string> }) {
  const currentId = config.current[version.agent_id];
  const current = config.versions.find(item => item.id === currentId);
  const baseLabel = current ? `${versionLabel(current)} (vigente)` : 'Valores actuales del código';
  return <div className="tablewrap platform-table">
    <table aria-label={`Qué cambia en ${agentNames[version.agent_id] || version.agent_id}`}>
      <thead><tr><th>Función · dato</th><th>{baseLabel}</th><th>{versionLabel(version)} ({version.status === 'pendiente' ? 'propuesta' : VERSION_STATUS_LABELS[version.status].toLowerCase()})</th></tr></thead>
      <tbody>
        {version.changes.map((change, index) => <tr key={index}>
          <td>{change.function} · {change.field}</td>
          <td>{change.before}</td>
          <td><strong className="platform-changed">{change.after}</strong></td>
        </tr>)}
        <tr className="platform-muted-row"><td>{version.changes.length ? 'Todo lo demás' : 'Todo'}</td><td>sin cambios</td><td>sin cambios</td></tr>
      </tbody>
    </table>
  </div>;
}

function usageFacts(usage: Loadable<ModelUsagePayload>, agentId: string) {
  if (usage.status !== 'ready') return null;
  const items = usage.data.capabilities.filter(item => item.agent_id === agentId);
  const uses = items.reduce((sum, item) => sum + item.last_7_days.completed + item.last_7_days.failed, 0);
  return {
    perDay: Math.round((uses / 7) * 10) / 10,
    quota: items.reduce((sum, item) => sum + (item.last_7_days.quota_rejected ?? 0), 0),
    sessionLimit: items.reduce((sum, item) => sum + (item.last_7_days.session_limit ?? 0), 0),
  };
}

function ProposalDetail({ version, config, usage, agentNames, onBack, onDone }: {
  version: ConfigurationVersion; config: AgentConfigurationPayload; usage: Loadable<ModelUsagePayload>; agentNames: Record<string, string>; onBack: () => void; onDone: (message: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const facts = usageFacts(usage, version.agent_id);
  const name = agentNames[version.agent_id] || version.agent_id;
  const label = versionLabel(version);
  async function act(action: 'approve' | 'reject') {
    setError('');
    if (action === 'reject' && reason.trim().length < 3) { setError('Escriba el motivo del rechazo.'); return; }
    const confirmText = action === 'approve'
      ? `¿Aprobar y activar la ${label.toLowerCase()} de ${name}? Quedará vigente y registrada a su nombre.`
      : `¿Rechazar la ${label.toLowerCase()} de ${name}?`;
    setBusy(true);
    try {
      const done = await runPlatformAction(`/api/platform/agent-configuration/versions/${encodeURIComponent(version.id)}/${action}`, action === 'reject' ? { reason } : {}, confirmText);
      if (done) onDone(action === 'approve' ? `${label} de ${name} aprobada y activada.` : `${label} de ${name} rechazada.`);
    } catch (failure) { setError(messageOf(failure)); } finally { setBusy(false); }
  }
  return <div className="stack">
    <button type="button" className="link-button platform-back" onClick={onBack}>← Propuestas</button>
    <section className="panel">
      <Badge tone="amber">Pendiente de aprobación</Badge>
      <h2 className="platform-title">{name} · {label.toLowerCase()}</h2>
      <p className="platform-muted">Propuesta por {version.proposed_by || '—'} · {fmtDateTime(version.proposed_at || version.created_at)} · Motivo: “{version.proposal_reason || 'sin motivo'}”</p>
    </section>
    <Panel title="Qué cambia"><ChangesTable version={version} config={config} agentNames={agentNames} /></Panel>
    <section className="panel platform-facts-row" aria-label="Uso real de los últimos 7 días">
      <div><small>Uso real últimos 7 días</small><strong>{facts ? `${facts.perDay.toLocaleString('es-CO')} por día en promedio` : '—'}</strong></div>
      <div><small>Veces que se agotó el cupo</small><strong>{facts ? `${facts.quota} en 7 días` : '—'}</strong></div>
      <div><small>Límite de la suscripción</small><strong>{facts ? (facts.sessionLimit ? `${facts.sessionLimit} veces tocado` : 'Sin topes') : '—'}</strong></div>
    </section>
    {usage.status === 'error' && <div className="notice">No se pudo leer el uso real: {usage.message}</div>}
    <AdminNotConnected config={config} />
    {error && <div className="error" role="alert">{error}</div>}
    <section className="panel platform-proposal-bar">
      <div>
        <strong>Al aprobar, la {label.toLowerCase()} queda vigente</strong>
        <p>Queda registrado quién aprobó y cuándo. La versión anterior sigue en el historial y se puede reactivar.</p>
        {rejecting && <label className="platform-field">Motivo del rechazo
          <textarea value={reason} maxLength={500} rows={2} onChange={event => setReason(event.target.value)} />
        </label>}
      </div>
      <div className="platform-actions">
        {!rejecting && <button type="button" className="secondary" disabled={busy || !config.admin_connected} onClick={() => setRejecting(true)}>Rechazar</button>}
        {rejecting && <>
          <button type="button" className="secondary" disabled={busy} onClick={() => { setRejecting(false); setReason(''); }}>Cancelar</button>
          <button type="button" className="danger" disabled={busy || !config.admin_connected} onClick={() => act('reject')}>Confirmar rechazo</button>
        </>}
        {!rejecting && <button type="button" disabled={busy || !config.admin_connected} onClick={() => act('approve')}>Aprobar y activar</button>}
      </div>
    </section>
  </div>;
}

export function ProposalsView({ config, usage, agentNames, onDone }: {
  config: AgentConfigurationPayload; usage: Loadable<ModelUsagePayload>; agentNames: Record<string, string>; onDone: (message: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const pending = config.versions.filter(version => version.status === 'pendiente');
  const current = pending.find(version => version.id === selected);
  if (current) return <ProposalDetail version={current} config={config} usage={usage} agentNames={agentNames} onBack={() => setSelected(null)} onDone={message => { setSelected(null); onDone(message); }} />;
  return <Panel title="Propuestas por aprobar">
    {pending.length === 0 && <EmptyState title="Sin propuestas pendientes" text="Cuando alguien proponga un cambio en las funciones con IA de un agente, aparecerá aquí para aprobarlo o rechazarlo." />}
    {pending.length > 0 && <div className="tablewrap platform-table">
      <table>
        <thead><tr><th>Agente</th><th>Versión</th><th>Propuesta por</th><th>Motivo</th><th>Cambios</th><th>Acción</th></tr></thead>
        <tbody>
          {pending.map(version => <tr key={version.id}>
            <td><strong>{agentNames[version.agent_id] || version.agent_id}</strong><small className="platform-sub">{version.agent_id}</small></td>
            <td>{versionLabel(version)}</td>
            <td>{version.proposed_by || '—'}<small className="platform-sub">{fmtDateTime(version.proposed_at || version.created_at)}</small></td>
            <td>{version.proposal_reason || '—'}</td>
            <td>{version.changes.length}</td>
            <td><button type="button" className="secondary" onClick={() => setSelected(version.id)}>Revisar</button></td>
          </tr>)}
        </tbody>
      </table>
    </div>}
  </Panel>;
}

export function HistoryView({ config, agentNames, agentId, onDone }: {
  config: AgentConfigurationPayload; agentNames: Record<string, string>; agentId?: string; onDone: (message: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const versions = config.versions.filter(version => !agentId || version.agent_id === agentId);
  async function reactivate(version: ConfigurationVersion) {
    const name = agentNames[version.agent_id] || version.agent_id;
    setError('');
    setBusy(version.id);
    try {
      const done = await runPlatformAction(`/api/platform/agent-configuration/versions/${encodeURIComponent(version.id)}/reactivate`, {}, `¿Volver a la ${versionLabel(version).toLowerCase()} de ${name}? Quedará vigente en lugar de la actual.`);
      if (done) onDone(`${name} volvió a la ${versionLabel(version).toLowerCase()}.`);
    } catch (failure) { setError(messageOf(failure)); } finally { setBusy(null); }
  }
  return <Panel title={agentId ? 'Historial de versiones' : 'Historial'}>
    <AdminNotConnected config={config} />
    {error && <div className="error" role="alert">{error}</div>}
    {versions.length === 0 && <EmptyState title="Sin versiones" text="Todavía no hay configuraciones propuestas. La primera propuesta aprobada será la versión 1." />}
    {versions.length > 0 && <div className="tablewrap platform-table">
      <table>
        <thead><tr>{!agentId && <th>Agente</th>}<th>Versión</th><th>Estado</th><th>Propuesta</th><th>Resolución</th><th>Acción</th></tr></thead>
        <tbody>
          {versions.map(version => <tr key={version.id}>
            {!agentId && <td><strong>{agentNames[version.agent_id] || version.agent_id}</strong><small className="platform-sub">{version.agent_id}</small></td>}
            <td>
              {versionLabel(version)}
              {version.changes.length > 0 && <details className="platform-details"><summary>{version.status === 'pendiente' ? 'Qué cambia' : 'Diferencias con la vigente'}</summary><ChangesTable version={version} config={config} agentNames={agentNames} /></details>}
            </td>
            <td><Badge tone={versionStatusTone(version.status)}>{VERSION_STATUS_LABELS[version.status]}</Badge></td>
            <td>{version.proposed_by || '—'}<small className="platform-sub">{fmtDateTime(version.proposed_at || version.created_at)}{version.proposal_reason ? ` · ${version.proposal_reason}` : ''}</small></td>
            <td>
              {version.approved_at && <>Aprobada por {version.approved_by || '—'}<small className="platform-sub">{fmtDateTime(version.approved_at)}</small></>}
              {version.rejected_at && <>Rechazada por {version.rejected_by || '—'}<small className="platform-sub">{fmtDateTime(version.rejected_at)}{version.rejection_reason ? ` · ${version.rejection_reason}` : ''}</small></>}
              {version.activated_at && version.activated_at !== version.approved_at && <small className="platform-sub">Activada por {version.activated_by || '—'} · {fmtDateTime(version.activated_at)}</small>}
              {!version.approved_at && !version.rejected_at && '—'}
            </td>
            <td>{version.status === 'aprobada'
              ? <button type="button" className="secondary" disabled={busy !== null || !config.admin_connected} onClick={() => reactivate(version)}>Volver a esta versión</button>
              : '—'}</td>
          </tr>)}
        </tbody>
      </table>
    </div>}
  </Panel>;
}

export function ProfilesView({ config, agentNames, onDone }: { config: AgentConfigurationPayload; agentNames: Record<string, string>; onDone: (message: string) => void }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = config.profiles.filter(profile => !profile.archived_at);
  const archived = config.profiles.filter(profile => profile.archived_at);
  const effectiveSlug = slugEdited ? slug : profileSlug(name);
  const matrix = config.profile_matrix;
  const functionNames = useMemo(() => Object.fromEntries(matrix.agents.map(agentId => [agentId, (config.catalog[agentId] || []).map(item => item.label)])), [matrix.agents, config.catalog]);

  async function create() {
    setError('');
    if (name.trim().length < 2) { setError('Escriba el nombre del perfil.'); return; }
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(effectiveSlug)) { setError('El identificador debe empezar por letra y usar sólo minúsculas, números y guion bajo.'); return; }
    setBusy(true);
    try {
      const done = await runPlatformAction('/api/platform/ai-usage-profiles', { profile_id: effectiveSlug, display_name: name.trim(), description: description.trim() }, `¿Crear el perfil de uso "${name.trim()}"?`);
      if (done) { setName(''); setSlug(''); setSlugEdited(false); setDescription(''); onDone(`Perfil "${name.trim()}" creado.`); }
    } catch (failure) { setError(messageOf(failure)); } finally { setBusy(false); }
  }
  async function archive(profileId: string, displayName: string) {
    setError('');
    setBusy(true);
    try {
      const done = await runPlatformAction(`/api/platform/ai-usage-profiles/${encodeURIComponent(profileId)}/archive`, {}, `¿Archivar el perfil "${displayName}"? Ya no se podrá usar en nuevas configuraciones mientras esté archivado; puede reactivarlo después.`);
      if (done) onDone(`Perfil "${displayName}" archivado.`);
    } catch (failure) { setError(messageOf(failure)); } finally { setBusy(false); }
  }
  async function reactivateProfile(profileId: string, displayName: string) {
    setError('');
    setBusy(true);
    try {
      const done = await runPlatformAction(`/api/platform/ai-usage-profiles/${encodeURIComponent(profileId)}/reactivate`, {}, `¿Reactivar el perfil "${displayName}"? Volverá a estar disponible para nuevas configuraciones.`);
      if (done) onDone(`Perfil "${displayName}" reactivado.`);
    } catch (failure) { setError(messageOf(failure)); } finally { setBusy(false); }
  }

  return <div className="stack">
    <div className="notice">{PROFILE_ASSIGNMENT_NOTICE}</div>
    <AdminNotConnected config={config} />
    {error && <div className="error" role="alert">{error}</div>}
    <div className="platform-two-columns">
      <Panel title="Perfiles de uso de IA">
        {active.length === 0 && <EmptyState title="Sin perfiles" text="Cree el primer perfil (por ejemplo, Comercial o Gerencia comercial) para darle un cupo propio en cada agente." />}
        {active.length > 0 && <ul className="platform-profile-list">
          {active.map(profile => <li key={profile.profile_id}>
            <div><strong>{profile.display_name}</strong><small className="platform-sub">{profile.profile_id}{profile.description ? ` · ${profile.description}` : ''}</small></div>
            <button type="button" className="secondary" disabled={busy || !config.admin_connected} onClick={() => archive(profile.profile_id, profile.display_name)}>Archivar</button>
          </li>)}
        </ul>}
        {archived.length > 0 && <details className="platform-details"><summary>Archivados ({archived.length})</summary>
          <ul className="platform-profile-list">{archived.map(profile => <li key={profile.profile_id}>
            <div>{profile.display_name}<small className="platform-sub">Archivado por {profile.archived_by || '—'} · {fmtDateTime(profile.archived_at)}</small></div>
            <button type="button" className="secondary" disabled={busy || !config.admin_connected} onClick={() => reactivateProfile(profile.profile_id, profile.display_name)}>Reactivar</button>
          </li>)}</ul>
        </details>}
        <form className="platform-profile-form" onSubmit={event => { event.preventDefault(); void create(); }}>
          <h3>Crear perfil</h3>
          <label className="platform-field">Nombre<input value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder="Ej.: Gerencia comercial" /></label>
          <label className="platform-field">Identificador<input value={effectiveSlug} maxLength={41} onChange={event => { setSlug(event.target.value); setSlugEdited(true); }} /></label>
          <label className="platform-field">Descripción (opcional)<input value={description} maxLength={300} onChange={event => setDescription(event.target.value)} /></label>
          <button type="submit" disabled={busy || !config.admin_connected}>+ Crear perfil</button>
        </form>
      </Panel>
      <Panel title="Qué recibe cada perfil en cada agente">
        <p className="platform-usage-note">{PROFILES_ACROSS_AGENTS_NOTE}</p>
        {matrix.rows.length === 0 && <EmptyState title="Sin perfiles activos" text="La matriz aparece cuando exista al menos un perfil de uso." />}
        {matrix.rows.length > 0 && <div className="tablewrap platform-table">
          <table>
            <thead><tr><th>Perfil</th>{matrix.agents.map(agentId => <th key={agentId}>{agentNames[agentId] || agentId}</th>)}</tr></thead>
            <tbody>
              {matrix.rows.map(row => <tr key={row.profile_id}>
                <td><strong>{row.display_name}</strong></td>
                {matrix.agents.map(agentId => <td key={agentId}>
                  {(row.cells[agentId] || []).map((cell, index) => <div key={index} className="platform-cell-line"><small>{cell.function || functionNames[agentId]?.[index]}</small> {cell.text}</div>)}
                </td>)}
              </tr>)}
            </tbody>
          </table>
        </div>}
        <p className="platform-usage-note">Se lee de la configuración vigente de cada agente. "Sin cupo propio" = sólo lo limitan el techo de seguridad, el cupo del equipo y el límite de la suscripción. Los demás agentes: {config.no_functions_text.toLowerCase()}.</p>
      </Panel>
    </div>
    <Panel title="Cómo se decide el cupo de una persona">
      <ol className="platform-steps">
        <li><strong>1 · Excepción vigente</strong><span>Si la persona tiene una, manda (siempre con fecha de vencimiento).</span></li>
        <li><strong>2 · Su perfil</strong><span>Si no, el cupo de su perfil en ese agente.</span></li>
        <li><strong>3 · Cupo del equipo</strong><span>Nadie supera el total del agente para todos.</span></li>
        <li><strong>4 · Suscripción</strong><span>El techo real de Claude; se avisa antes de llegar.</span></li>
      </ol>
    </Panel>
  </div>;
}
