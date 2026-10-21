import type { Agt002InitialReport } from './src/tenders/agt002InitialReportProjection';

export type RequirementStatus = 'falta' | 'por_confirmar' | 'cumple' | 'no_aplica';
export type RequirementNote = { id?: string; title: string; impact: string; severity: string; severityLabel: string };
export type RequirementRow = {
  key: string;
  requirementIds: string[];
  category: string;
  categoryLabel: string;
  area: string;
  title: string;
  demand: string;
  sources: { documentName: string | null; locator: string }[];
  status: RequirementStatus;
  rejection: boolean;
  severity: string | null;
  severityLabel: string | null;
  company: string[];
  actions: string[];
  notes: RequirementNote[];
  findingIds: string[];
  openItems: { text: string; dueAt: string | null; critical: boolean }[];
  dueAt: string | null;
};
export type RequirementGroup = { category: string; label: string; rows: RequirementRow[] };
export type RequirementSeedItem = { item_key: string; title: string; required: boolean; target_date: string | null; instruction: string };

export const REQUIREMENT_STATUS_LABEL: Record<RequirementStatus, string>;
export const REQUIREMENT_ITEM_KEY_PREFIX: string;
export function cleanRequirementText(value: string | null | undefined): string;
export function buildRequirementRows(report: Agt002InitialReport | null | undefined): RequirementRow[];
export function decisiveRequirementRows(rows: RequirementRow[], limit?: number): RequirementRow[];
export function otherRiskNotes(report: Agt002InitialReport | null | undefined, rows: RequirementRow[]): RequirementNote[];
export function groupRowsByCategory(rows: RequirementRow[]): RequirementGroup[];
export function requirementTargetDate(row: RequirementRow, closeDate: string | null, today?: string): string | null;
export function requirementSeedItems(rows: RequirementRow[], closeDate: string | null, today?: string): RequirementSeedItem[];
