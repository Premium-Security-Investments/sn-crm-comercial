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
  'Actividad y portería',
  'Salud de los procesos',
  'Efectos externos',
  'Propuestas por aprobar',
  'Avisos',
]);

// "Uso de IA": libro de uso de modelos (GET /api/platform/model-usage). El costo es equivalente: se usa la suscripción.
export type ModelUsagePoint = { day: string; uses: number; rejected: number };

export type ModelUsageCapability = {
  agent_id: string;
  capability: string;
  label: string;
  limit: { period: 'day' | 'month'; max: number } | null;
  today: number;
  month: number;
  last_7_days: { completed: number; failed: number; rejected: number };
  avg_latency_ms: number | null;
  last_used_at: string | null;
  month_tokens: { input: number; output: number };
  month_cost_usd_equivalent: number;
  daily: ModelUsagePoint[];
};

export type ModelUsagePayload = {
  generated_at: string;
  has_data: boolean;
  cost_note: string;
  capabilities: ModelUsageCapability[];
};

export const MODEL_CAPABILITY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'agt003.opportunity-copilot.preview': 'Siguiente paso (copiloto)',
  'agt003.lead-deep-analysis': 'Análisis profundo',
});

export function modelCapabilityLabel(capability: string, fallback?: string) {
  return MODEL_CAPABILITY_LABELS[capability] ?? fallback ?? capability;
}

/** Uso frente al tope del periodo (hoy para el copiloto, este mes para el análisis profundo). */
export function usageAgainstLimit(item: ModelUsageCapability) {
  if (!item.limit || item.limit.max <= 0) return null;
  const used = item.limit.period === 'day' ? item.today : item.month;
  const percent = Math.min(100, Math.round((used / item.limit.max) * 100));
  const tone: 'green' | 'amber' | 'danger' = percent >= 100 ? 'danger' : percent >= 80 ? 'amber' : 'green';
  return { used, max: item.limit.max, percent, tone, periodLabel: item.limit.period === 'day' ? 'hoy' : 'este mes' };
}

export function formatLatency(ms: number | null) {
  if (ms == null) return '—';
  return ms >= 1000 ? `${(ms / 1000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} s` : `${ms} ms`;
}

export function formatUsdEquivalent(value: number) {
  return `US$ ${value.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

export const MODEL_USAGE_EMPTY_TEXT = 'Todavía no hay usos de IA registrados por la puerta de modelos.';
export const MODEL_USAGE_COST_NOTE = 'El costo es "equivalente": Vig-IA usa la suscripción de Claude, así que no se paga por token. Es lo que costaría a la tarifa pública, para comparar.';
