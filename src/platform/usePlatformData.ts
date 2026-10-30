// Carga de datos de IT → Agentes: registro de agentes, libro de uso de IA y configuración de funciones con IA.
// Cada fuente falla por separado (un 503 en una no oculta las demás). `reload` vuelve a pedir las tres.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../apiClient';
import type { AgentConfigurationPayload, ModelUsagePayload, PlatformAgent, PlatformAgentsPayload } from './agentsPresentation';

export type Loadable<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };

function messageOf(error: unknown) { return error instanceof Error ? error.message : String(error); }

export function usePlatformData() {
  const [agents, setAgents] = useState<Loadable<PlatformAgent[]>>({ status: 'loading' });
  const [usage, setUsage] = useState<Loadable<ModelUsagePayload>>({ status: 'loading' });
  const [config, setConfig] = useState<Loadable<AgentConfigurationPayload>>({ status: 'loading' });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion(value => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    api<PlatformAgentsPayload>('/api/platform/agents')
      .then(payload => { if (!cancelled) setAgents({ status: 'ready', data: Array.isArray(payload?.agents) ? payload.agents : [] }); })
      .catch((error: unknown) => { if (!cancelled) setAgents({ status: 'error', message: messageOf(error) }); });
    api<ModelUsagePayload>('/api/platform/model-usage')
      .then(payload => { if (!cancelled) setUsage({ status: 'ready', data: payload }); })
      .catch((error: unknown) => { if (!cancelled) setUsage({ status: 'error', message: messageOf(error) }); });
    api<AgentConfigurationPayload>('/api/platform/agent-configuration')
      .then(payload => { if (!cancelled) setConfig({ status: 'ready', data: payload }); })
      .catch((error: unknown) => { if (!cancelled) setConfig({ status: 'error', message: messageOf(error) }); });
    return () => { cancelled = true; };
  }, [version]);

  return { agents, usage, config, reload };
}

/** Ejecuta una acción de administración con confirmación previa. Devuelve true si se completó. */
export async function runPlatformAction(url: string, body: unknown, confirmText: string): Promise<boolean> {
  if (!window.confirm(confirmText)) return false;
  await api(url, { method: 'POST', body: JSON.stringify(body ?? {}) });
  return true;
}
