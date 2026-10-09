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

// Vistas futuras de IT → Agentes: se muestran como texto "próximamente", sin enlaces.
export const UPCOMING_PLATFORM_VIEWS: readonly string[] = Object.freeze([
  'Permisos',
  'Actividad',
  'Salud',
]);

export const AGENTS_TABS = Object.freeze([
  { id: 'summary', label: 'Resumen' },
  { id: 'usage', label: 'Uso de IA' },
  { id: 'profiles', label: 'Perfiles de uso' },
  { id: 'proposals', label: 'Propuestas' },
  { id: 'history', label: 'Historial' },
] as const);
export type AgentsTab = typeof AGENTS_TABS[number]['id'];

export const AGENT_DETAIL_TABS = Object.freeze([
  { id: 'profile', label: 'Ficha' },
  { id: 'functions', label: 'Funciones, modelos y cupos' },
  { id: 'usage', label: 'Uso de IA' },
  { id: 'history', label: 'Historial de versiones' },
] as const);
export type AgentDetailTab = typeof AGENT_DETAIL_TABS[number]['id'];

export const AGENT_OWNER_PENDING = 'Por definir';
export const PROFILE_ASSIGNMENT_NOTICE = 'Los perfiles se crean aquí; en Usuarios y permisos se elige uno por persona.';

// "Uso de IA": libro de uso de modelos (GET /api/platform/model-usage). El costo es equivalente: se usa la suscripción.
export type ModelUsagePoint = { day: string; uses: number; rejected: number };

export type ModelUsageCapability = {
  agent_id: string;
  capability: string;
  label: string;
  limit: { period: 'day' | 'month'; max: number } | null;
  today: number;
  month: number;
  last_7_days: { completed: number; failed: number; rejected: number; quota_rejected?: number; session_limit?: number };
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
  session_limit_7d?: number;
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

// Configuración de funciones con IA (GET /api/platform/agent-configuration).
export type CapPeriod = 'day' | 'month';
export type ProfileCap = { per: CapPeriod; max: number } | { unlimited: true; safety_max: number };
export type CapabilityException = { person: string; extra: number; per: CapPeriod; expires: string };
export type CapabilityConfiguration = {
  enabled: boolean;
  model: string;
  fallback: string;
  team_cap: { per: CapPeriod; max: number };
  profile_caps?: Record<string, ProfileCap>;
  exceptions?: CapabilityException[];
};
export type AgentConfiguration = { timezone: string; capabilities: Record<string, CapabilityConfiguration> };
export type VersionStatus = 'vigente' | 'aprobada' | 'rechazada' | 'pendiente';
export type ConfigurationChange = { function: string; field: string; before: string; after: string };
export type ConfigurationVersion = {
  id: string;
  agent_id: string;
  environment: string | null;
  version_number: number | null;
  configuration: AgentConfiguration | null;
  created_at: string | null;
  proposed_by: string | null;
  proposal_reason: string | null;
  proposed_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejection_reason: string | null;
  rejected_at: string | null;
  activated_by: string | null;
  activated_at: string | null;
  is_current: boolean;
  status: VersionStatus;
  changes: ConfigurationChange[];
};
export type AiUsageProfile = {
  profile_id: string;
  display_name: string;
  description: string | null;
  created_by: string | null;
  created_at: string | null;
  archived_by: string | null;
  archived_at: string | null;
};
export type AiFunction = { capability: string; label: string; description: string };
export type Option = { id: string; label: string };
export type AgentConfigurationPayload = {
  generated_at: string;
  environment: string;
  admin_connected: boolean;
  today: string;
  models: Option[];
  fallbacks: Option[];
  catalog: Record<string, AiFunction[]>;
  no_functions_text: string;
  defaults: Record<string, AgentConfiguration | null>;
  profiles: AiUsageProfile[];
  people: Array<{ id: string; full_name: string }>;
  versions: ConfigurationVersion[];
  current: Record<string, string>;
  pending_count: number;
  profile_matrix: { agents: string[]; rows: Array<{ profile_id: string; display_name: string; cells: Record<string, Array<{ function: string; text: string }>> }> };
  expiring_exceptions: Array<{ agent_id: string; function: string; person: string; expires: string }>;
};

export const VERSION_STATUS_LABELS: Readonly<Record<VersionStatus, string>> = Object.freeze({
  vigente: 'Vigente',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
  pendiente: 'Pendiente de aprobación',
});
const VERSION_STATUS_TONES: Readonly<Record<VersionStatus, AgentStateTone>> = Object.freeze({
  vigente: 'green',
  aprobada: 'blue',
  rechazada: 'danger',
  pendiente: 'amber',
});
export function versionStatusTone(status: VersionStatus): AgentStateTone { return VERSION_STATUS_TONES[status] ?? 'blue'; }

export const ENVIRONMENT_LABELS: Readonly<Record<string, string>> = Object.freeze({ production: 'producción', preview: 'pruebas', development: 'desarrollo' });
export function environmentLabel(value: string | null | undefined) { return value ? ENVIRONMENT_LABELS[value] ?? value : '—'; }

export function versionLabel(version: Pick<ConfigurationVersion, 'version_number'> | null | undefined) {
  return version?.version_number ? `Versión ${version.version_number}` : 'Versión sin número';
}

/** Suma de usos hoy / mes de un agente en el libro de uso. */
export function agentUsageTotals(usage: ModelUsagePayload | null, agentId: string) {
  const items = (usage?.capabilities || []).filter(item => item.agent_id === agentId);
  return { today: items.reduce((sum, item) => sum + item.today, 0), month: items.reduce((sum, item) => sum + item.month, 0), tracked: items.length > 0 };
}
