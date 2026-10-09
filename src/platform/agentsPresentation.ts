// Presentación de la vista IT → Agentes: etiquetas en español y textos fijos. Sin lógica de permisos.

export type PlatformAgent = {
  id: string;
  namespace: string | null;
  name: string;
  state: string | null;
  active: boolean;
  created_at: string | null;
  updated_at: string | null;
  retired_at: string | null;
  counts: { policy_versions: number; configuration_versions: number; open_runs: number };
};

export type PlatformAgentsPayload = { agents: PlatformAgent[] };

export const AGENT_STATE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  declared: 'Declarado',
  controlled_pilot: 'Piloto controlado',
  partial_operation: 'Operación parcial',
  full_operation: 'Operación completa',
  retired: 'Retirado',
});

export type AgentStateTone = 'blue' | 'green' | 'amber' | 'danger' | 'purple';

const AGENT_STATE_TONES: Readonly<Record<string, AgentStateTone>> = Object.freeze({
  declared: 'blue',
  controlled_pilot: 'purple',
  partial_operation: 'amber',
  full_operation: 'green',
  retired: 'danger',
});

export function agentStateLabel(state: string | null | undefined) {
  if (!state) return 'Sin estado';
  return AGENT_STATE_LABELS[state] ?? state;
}

export function agentStateTone(state: string | null | undefined): AgentStateTone {
  return (state && AGENT_STATE_TONES[state]) || 'blue';
}

export const AGENT_COUNT_LABELS = Object.freeze({
  policy_versions: 'Permisos',
  configuration_versions: 'Configuraciones',
  open_runs: 'Actividad',
});

export const UPCOMING_PLATFORM_VIEWS: readonly string[] = Object.freeze([
  'Permisos',
  'Configuración y modelos',
  'Uso de IA',
  'Actividad y portería',
  'Salud de los procesos',
  'Efectos externos',
  'Propuestas por aprobar',
  'Avisos',
]);
