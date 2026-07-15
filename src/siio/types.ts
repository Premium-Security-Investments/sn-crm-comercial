import type { SiioFinancialMetric, SiioManagementInsight, SiioPayrollAggregate } from '../siioExecutive';

export const SIIO_VIEWS = ['resumen', 'seguimiento', 'inteligencia', 'agentes'] as const;
export type SiioView = typeof SIIO_VIEWS[number];
export type SiioTrackingKind = 'todos' | 'decisiones' | 'bloqueos' | 'riesgos' | 'compromisos';
export type SiioRouteFiltersByView = {
  resumen: { period: string; area: string };
  seguimiento: { kind: SiioTrackingKind; status: string; semaphore: string; owner: string };
  inteligencia: { period: string; freshness: string; trust: string; sourceType: string };
  agentes: { status: string; owner: string };
};
export type SiioRouteFilters = SiioRouteFiltersByView[SiioView];
export type SiioRouteState = { [View in SiioView]: { view: View; filters: SiioRouteFiltersByView[View] } }[SiioView];

export type SiioFront = { id: string; name: string; description?: string; status?: string; owner_role?: string | null };
export type SiioRecord = { id: string; front_id: string; title: string; record_type?: string; owner?: string | null; decision_owner?: string | null; status?: string; priority?: string; semaforo?: string; next_action?: string | null; blockers?: string | null; risks?: string | null; decision_required?: string | null; source_ids?: string[] };
export type SiioDecision = { id: string; item_type: string; description: string; owner?: string | null; due_date?: string | null; status?: string; impact?: string | null; related_record_id?: string | null };
export type SiioSource = { id: string; name: string; source_type?: string; trust_level?: string; status?: string; restrictions?: string | null; related_fronts?: string[]; url?: string | null; last_reviewed_at?: string | null; next_review_at?: string | null; update_frequency?: string | null };
export type SiioBoardReport = { id: string; period_month: string; status: string; summary?: string; generated_at?: string; source_ids?: string[] };
export type SiioBoardSection = { id?: string; name: string; section_order?: number; human_review_required?: boolean };
export type SiioRecommendation = SiioManagementInsight & { sourceIds: string[]; period: string | null };
export type SiioTrackingItem = { id: string; kind: Exclude<SiioTrackingKind, 'todos'>; title: string; owner: string | null; status: string; semaphore: string; nextAction: string | null; frontId: string | null; sourceIds: string[]; dueDate: string | null };
export type SiioCurrentProfile = { role: string; full_name?: string | null };
export type SiioBootstrapPayload = { fronts: SiioFront[]; records: SiioRecord[]; sources: SiioSource[]; decisions: SiioDecision[]; boardReports: SiioBoardReport[]; boardSections: SiioBoardSection[]; financialMetrics: SiioFinancialMetric[]; commercialSignals: unknown[]; payrollAggregates: SiioPayrollAggregate[]; strategicOpportunities: unknown[]; currentProfile: SiioCurrentProfile };
