export type FollowUpInteraction = {
  id: string;
  interaction_type: string;
  notes: string | null;
  occurred_at?: string | null;
  created_at?: string | null;
  actor_label?: string | null;
  psi_sales_profiles?: { full_name?: string } | null;
};
export type FollowUpOpportunity = {
  observaciones?: string | null;
  quote_date?: string | null;
  created_at?: string | null;
};
export const INTERACTION_TYPE_LABELS: Readonly<Record<string, string>>;
export function capitalizeVisibleLabel(text?: string | null): string;
export function followUpInteractionTypeLabel(type?: string | null): string;
export function normalizeFollowUpText(text?: string | null): string;
export function isObservationCapturedInNotes(observaciones?: string | null, interactions?: FollowUpInteraction[] | null): boolean;
export function buildMigratedObservationEvent(opportunity?: FollowUpOpportunity | null): FollowUpInteraction | null;
export function buildFollowUpHistory(opportunity?: FollowUpOpportunity | null, interactions?: FollowUpInteraction[] | null): FollowUpInteraction[];
