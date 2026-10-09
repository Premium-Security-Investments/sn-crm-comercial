// IT → Agentes → detalle de un agente (#/agents/AGT-003): Ficha | Funciones, modelos y cupos | Uso de IA |
// Historial de versiones. Los cambios no se aplican al guardar: se crea una propuesta que un administrador aprueba.
import { useEffect, useMemo, useState } from 'react';
import { Badge, EmptyState, Panel } from '../siio/SiioUi';
import {
  AGENT_DETAIL_TABS,
  AGENT_OWNER_PENDING,
  agentModelAlerts,
  agentStateLabel,
  agentStateTone,
  versionLabel,
  type AgentConfigurationPayload,
  type AgentDetailTab,
  type CapPeriod,
  type ModelUsagePayload,
  type PlatformAgent,
} from './agentsPresentation';
import { DEFAULT_SAFETY_MAX, buildConfiguration, formFromConfiguration, newExceptionKey, validateForms, type CapabilityForm } from './agentConfigForm';
import { AdminNotConnected, HistoryView, fmtDateTime } from './ConfigurationViews';
import { ModelUsageSection } from './ModelUsageSection';
import { ModelAlertsPanel } from './ModelAlerts';
import { runPlatformAction, type Loadable } from './usePlatformData';

function messageOf(error: unknown) { return error instanceof Error ? error.message : String(error); }
const PERIOD_OPTIONS: Array<[CapPeriod, string]> = [['day', 'por día'], ['month', 'por mes']];

function PeriodSelect({ value, onChange, label }: { value: CapPeriod; onChange: (value: CapPeriod) => void; label: string }) {
  return <select aria-label={label} value={value} onChange={event => onChange(event.target.value as CapPeriod)}>
    {PERIOD_OPTIONS.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
  </select>;
}

function CapabilityEditor({ form, config, onChange }: { form: CapabilityForm; config: AgentConfigurationPayload; onChange: (next: CapabilityForm) => void }) {
  const description = Object.values(config.catalog).flat().find(item => item.capability === form.capability)?.description;
  const activeProfiles = config.profiles.filter(profile => !profile.archived_at);
  const profileName = (id: string) => config.profiles.find(profile => profile.profile_id === id)?.display_name || id;
  const archivedIds = new Set(config.profiles.filter(profile => profile.archived_at).map(profile => profile.profile_id));
  const unusedProfiles = activeProfiles.filter(profile => !form.profiles.some(row => row.profileId === profile.profile_id));
  const update = (patch: Partial<CapabilityForm>) => onChange({ ...form, ...patch });
  const id = form.capability.replace(/[^a-z0-9]/gi, '-');
  return <section className="panel platform-function" aria-label={form.label}>
    <header className="platform-function-head">
      <div>
        <h3>{form.label}</h3>
        {description && <p className="platform-muted">{description}</p>}
      </div>
      <label className="platform-toggle">
        <input type="checkbox" checked={form.enabled} onChange={event => update({ enabled: event.target.checked })} />
        <Badge tone={form.enabled ? 'green' : 'danger'}>{form.enabled ? 'Encendida' : 'Apagada'}</Badge>
      </label>
    </header>
    <div className="platform-function-grid">
      <label className="platform-field" htmlFor={`${id}-model`}>Modelo
        <select id={`${id}-model`} value={form.model} onChange={event => update({ model: event.target.value })}>
          {config.models.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>
      <label className="platform-field" htmlFor={`${id}-fallback`}>Plan B si el modelo falla
        <select id={`${id}-fallback`} value={form.fallback} onChange={event => update({ fallback: event.target.value })}>
          {config.fallbacks.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>
      <div className="platform-field">
        <label htmlFor={`${id}-team`}>Cupo total del equipo</label>
        <div className="platform-inline">
          <input id={`${id}-team`} type="number" min={0} max={1000} step={1} value={form.teamMax} onChange={event => update({ teamMax: event.target.value })} />
          <PeriodSelect label="Periodo del cupo del equipo" value={form.teamPer} onChange={teamPer => update({ teamPer })} />
          <span className="platform-muted">(hora Bogotá)</span>
        </div>
      </div>
    </div>

    <h4>Cupo por persona según su perfil</h4>
    <div className="tablewrap platform-table">
      <table>
        <thead><tr><th>Perfil</th><th>Cupo por persona</th><th>Nota</th><th>Quitar</th></tr></thead>
        <tbody>
          {form.profiles.length === 0 && <tr><td colSpan={4} className="platform-muted">Sin cupos por perfil: sólo aplica el cupo del equipo.</td></tr>}
          {form.profiles.map((row, index) => {
            const setRow = (patch: Partial<typeof row>) => update({ profiles: form.profiles.map((item, i) => (i === index ? { ...item, ...patch } : item)) });
            return <tr key={`${row.profileId}-${index}`}>
              <td>{!activeProfiles.some(p => p.profile_id === row.profileId)
                ? <>{profileName(row.profileId)}<small className="platform-sub platform-warning">{archivedIds.has(row.profileId) ? 'Perfil archivado' : 'Perfil inexistente'}: quítelo para proponer.</small></>
                : <select aria-label="Perfil" value={row.profileId} onChange={event => setRow({ profileId: event.target.value })}>
                  {[...activeProfiles.filter(p => p.profile_id === row.profileId), ...unusedProfiles].map(profile => <option key={profile.profile_id} value={profile.profile_id}>{profile.display_name}</option>)}
                </select>}
              </td>
              <td>
                <div className="platform-inline">
                  <select aria-label="Tipo de cupo" value={row.mode} onChange={event => setRow({ mode: event.target.value as 'cap' | 'unlimited' })}>
                    <option value="cap">Cupo propio</option>
                    <option value="unlimited">Sin cupo propio</option>
                  </select>
                  {row.mode === 'cap' && <>
                    <input aria-label="Cupo por persona" type="number" min={0} max={1000} step={1} value={row.max} onChange={event => setRow({ max: event.target.value })} />
                    <PeriodSelect label="Periodo del cupo por persona" value={row.per} onChange={per => setRow({ per })} />
                  </>}
                  {row.mode === 'unlimited' && <>
                    <span className="platform-muted">techo de seguridad</span>
                    <input aria-label="Techo de seguridad" type="number" min={0} max={1000} step={1} value={row.safetyMax} onChange={event => setRow({ safetyMax: event.target.value })} />
                  </>}
                </div>
              </td>
              <td className="platform-muted">{row.mode === 'unlimited' ? 'Sólo lo limita el cupo del equipo (y el techo de seguridad)' : '—'}</td>
              <td><button type="button" className="link-button" onClick={() => update({ profiles: form.profiles.filter((_, i) => i !== index) })}>Quitar</button></td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
    <button type="button" className="link-button" disabled={unusedProfiles.length === 0}
      onClick={() => update({ profiles: [...form.profiles, { profileId: unusedProfiles[0].profile_id, mode: 'cap', max: '5', per: form.teamPer, safetyMax: String(DEFAULT_SAFETY_MAX) }] })}>
      + Agregar perfil
    </button>
    {activeProfiles.length === 0 && <small className="platform-sub">Primero cree perfiles en la pestaña "Perfiles de uso".</small>}

    <h4>Excepciones temporales</h4>
    <div className="tablewrap platform-table">
      <table>
        <thead><tr><th>Persona</th><th>Cupo extra</th><th>Vence</th><th>Quitar</th></tr></thead>
        <tbody>
          {form.exceptions.length === 0 && <tr><td colSpan={4} className="platform-muted">Sin excepciones.</td></tr>}
          {form.exceptions.map((row, index) => {
            const setRow = (patch: Partial<typeof row>) => update({ exceptions: form.exceptions.map((item, i) => (i === index ? { ...item, ...patch } : item)) });
            const known = config.people.some(person => person.id === row.person);
            return <tr key={row.key}>
              <td><select aria-label="Persona" value={row.person} onChange={event => setRow({ person: event.target.value })}>
                <option value="">Elija una persona…</option>
                {!known && row.person && <option value={row.person}>Persona inactiva o sin nombre</option>}
                {config.people.map(person => <option key={person.id} value={person.id}>{person.full_name}</option>)}
              </select></td>
              <td><div className="platform-inline">
                <span>+</span>
                <input aria-label="Cupo extra" type="number" min={0} max={1000} step={1} value={row.extra} onChange={event => setRow({ extra: event.target.value })} />
                <PeriodSelect label="Periodo de la excepción" value={row.per} onChange={per => setRow({ per })} />
              </div></td>
              <td><input aria-label="Fecha de vencimiento" type="date" required min={config.today} value={row.expires} onChange={event => setRow({ expires: event.target.value })} /></td>
              <td><button type="button" className="link-button" onClick={() => update({ exceptions: form.exceptions.filter((_, i) => i !== index) })}>Quitar</button></td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
    <button type="button" className="link-button" onClick={() => update({ exceptions: [...form.exceptions, { key: newExceptionKey(), person: '', extra: '5', per: form.teamPer, expires: '' }] })}>
      + Agregar excepción (siempre con fecha de vencimiento)
    </button>
  </section>;
}

function FunctionsTab({ agent, config, onDone }: { agent: PlatformAgent; config: AgentConfigurationPayload; onDone: (message: string) => void }) {
  const functions = useMemo(() => config.catalog[agent.id] || [], [config.catalog, agent.id]);
  const currentId = config.current[agent.id];
  const current = config.versions.find(version => version.id === currentId) || null;
  const initial = useMemo(() => formFromConfiguration(current?.configuration || null, functions, config.defaults[agent.id] || null), [current, functions, config.defaults, agent.id]);
  const [forms, setForms] = useState<CapabilityForm[]>(initial);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  useEffect(() => { setForms(initial); }, [initial]);

  if (!functions.length) return <Panel title="Funciones, modelos y cupos"><EmptyState title={config.no_functions_text} text="Este agente todavía no usa la IA por la puerta de modelos." /></Panel>;
  const agentVersions = config.versions.filter(version => version.agent_id === agent.id);
  const nextNumber = Math.max(0, ...agentVersions.map(version => version.version_number || 0)) + 1;
  const pending = agentVersions.filter(version => version.status === 'pendiente');

  async function propose() {
    const found = validateForms(forms, config.today);
    if (reason.trim().length < 3) found.push('Escriba el motivo del cambio.');
    setProblems(found);
    if (found.length) return;
    setBusy(true);
    try {
      const done = await runPlatformAction('/api/platform/agent-configuration/proposals', { agent_id: agent.id, configuration: buildConfiguration(forms), reason: reason.trim() },
        `¿Proponer la versión ${nextNumber} de ${agent.name}? No se aplica hasta que un administrador la apruebe.`);
      if (done) { setReason(''); onDone(`Versión ${nextNumber} propuesta: queda pendiente de aprobación.`); }
    } catch (failure) { setProblems([messageOf(failure)]); } finally { setBusy(false); }
  }

  return <div className="stack">
    {!current && <div className="notice">{agent.name} todavía no tiene configuración aprobada: el formulario muestra los valores actuales del código. La primera propuesta será la versión 1.</div>}
    {pending.length > 0 && <div className="notice">Hay {pending.length === 1 ? 'una propuesta pendiente' : `${pending.length} propuestas pendientes`} ({pending.map(versionLabel).join(', ')}). Revísela en la pestaña Propuestas de Agentes.</div>}
    <AdminNotConnected config={config} />
    {forms.map((form, index) => <CapabilityEditor key={form.capability} form={form} config={config} onChange={next => setForms(forms.map((item, i) => (i === index ? next : item)))} />)}
    {problems.length > 0 && <div className="error" role="alert"><ul className="platform-problems">{problems.map(problem => <li key={problem}>{problem}</li>)}</ul></div>}
    <section className="panel platform-proposal-bar">
      <div>
        <strong>Los cambios no se aplican al guardar</strong>
        <p>Se crea la versión {nextNumber} como propuesta. Se activa sólo cuando un administrador la aprueba{current ? `; la ${versionLabel(current).toLowerCase()} queda en el historial para volver atrás` : ''}.</p>
        <label className="platform-field">Motivo del cambio
          <textarea value={reason} maxLength={500} rows={2} onChange={event => setReason(event.target.value)} placeholder="Ej.: cierre de mes, más demanda del equipo comercial" />
        </label>
      </div>
      <div className="platform-actions">
        <button type="button" className="secondary" disabled={busy} onClick={() => { setForms(initial); setProblems([]); }}>Descartar cambios</button>
        <button type="button" disabled={busy || !config.admin_connected} onClick={() => void propose()}>Proponer cambio</button>
      </div>
    </section>
  </div>;
}

export function AgentDetail({ agentId, agents, usage, config, agentNames, onDone, message }: {
  agentId: string;
  agents: Loadable<PlatformAgent[]>;
  usage: Loadable<ModelUsagePayload>;
  config: Loadable<AgentConfigurationPayload>;
  agentNames: Record<string, string>;
  onDone: (message: string) => void;
  message: string;
}) {
  const [tab, setTab] = useState<AgentDetailTab>('functions');
  const agent = agents.status === 'ready' ? agents.data.find(item => item.id === agentId) : undefined;
  const currentVersion = config.status === 'ready' ? config.data.versions.find(version => version.id === config.data.current[agentId]) : undefined;
  return <div className="stack platform-agents">
    <a className="platform-back" href="#/agents">← Agentes</a>
    {agents.status === 'loading' && <div className="notice">Cargando agente…</div>}
    {agents.status === 'error' && <div className="error" role="alert">{agents.message}</div>}
    {agents.status === 'ready' && !agent && <Panel title="Agente no encontrado"><EmptyState title="No existe ese agente" text="Vuelva a la lista de agentes y elija uno del registro." /></Panel>}
    {agent && <>
      <section className="executive-hero platform-agents-hero">
        <div>
          <span className="eyebrow">IT · Agentes · {agent.id}</span>
          <h2>{agent.name}</h2>
          <p>{agent.id} · {agentStateLabel(agent.state)} · Dueño: {AGENT_OWNER_PENDING}</p>
        </div>
        <div className="hero-facts">
          <div><small>Configuración vigente</small><strong>{currentVersion ? versionLabel(currentVersion) : 'Sin configurar'}</strong></div>
          {currentVersion && <div><small>Aprobada por</small><strong>{currentVersion.approved_by || '—'}</strong><small>{fmtDateTime(currentVersion.activated_at || currentVersion.approved_at)}</small></div>}
        </div>
      </section>
      <nav className="module-segmented-nav platform-tabs platform-tabs-4" aria-label="Secciones del agente">
        {AGENT_DETAIL_TABS.map(item => <button key={item.id} type="button" className={tab === item.id ? 'active' : ''} aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)}>{item.label}</button>)}
      </nav>
      {message && <div className="notice" role="status">{message}</div>}
      <ModelAlertsPanel alerts={agentModelAlerts(usage.status === 'ready' ? usage.data : null, agent.id)} title="Avisos: fallas recientes de la IA" />
      {tab === 'profile' && <Panel title="Ficha">
        <p><Badge tone={agentStateTone(agent.state)}>{agentStateLabel(agent.state)}</Badge></p>
        <EmptyState title="Ficha en construcción (Fase 1)" text="Aquí irán el propósito, el dueño y los límites del agente." />
      </Panel>}
      {tab === 'functions' && (config.status === 'ready'
        ? <FunctionsTab agent={agent} config={config.data} onDone={onDone} />
        : config.status === 'error' ? <div className="error" role="alert">{config.message}</div> : <div className="notice">Cargando configuración…</div>)}
      {tab === 'usage' && <ModelUsageSection usage={usage} agentId={agent.id} agentNames={agentNames} />}
      {tab === 'history' && (config.status === 'ready'
        ? <HistoryView config={config.data} agentNames={agentNames} agentId={agent.id} onDone={onDone} />
        : config.status === 'error' ? <div className="error" role="alert">{config.message}</div> : <div className="notice">Cargando historial…</div>)}
    </>}
  </div>;
}
