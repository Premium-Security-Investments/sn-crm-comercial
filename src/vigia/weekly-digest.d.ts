export const WEEKLY_DIGEST_CONTRACT: 'agt003-weekly-digest-v1';
export const WEEKLY_DIGEST_CAPABILITY: 'agt003.weekly_digest';
export const WEEKLY_DIGEST_RECIPIENT_RULES: Readonly<{ version: string; role: string; excludeCommercialSubareaOnly: string }>;
export const WEEKLY_DIGEST_DEFAULTS: Readonly<{ managerEmail: string; appUrl: string; previewTo: string; sender: string; managerGreeting: string }>;
export const WEEKLY_DIGEST_MODES: readonly ['preview', 'live'];
export type WeeklyDigestMode = 'preview' | 'live';
export type WeeklyDigestKind = 'salesperson' | 'manager';

export class WeeklyDigestValidationError extends Error {
  code: string;
  constructor(code: string, message: string);
}

export type DigestProfile = {
  id: string;
  full_name?: string | null;
  role?: string | null;
  active?: boolean | null;
  identity_type?: string | null;
  microsoft_email?: string | null;
  can_own_opportunities?: boolean | null;
};
export type DigestAreaAssignment = { profile_id: string; area_code: string; subarea_code?: string | null };
export type DigestOpportunity = {
  id: string;
  owner_id?: string | null;
  company_name?: string | null;
  quote_city?: string | null;
  regional_nombre?: string | null;
  service_type_code?: string | null;
  stage_code?: string | null;
  offer_value?: number | string | null;
  next_action_at?: string | null;
  last_interaction_at?: string | null;
  approved_at?: string | null;
  updated_at?: string | null;
  frozen_until?: string | null;
  delete_requested_at?: string | null;
};
export type DigestConfig = { managerEmail?: string; appUrl?: string; previewTo?: string; sender?: string; managerGreeting?: string };
export type DigestWeek = {
  timezone: 'America/Bogota';
  last_week_start: string;
  last_week_end: string;
  this_week_start: string;
  this_week_end: string;
};
export type DigestMessage = {
  id: string;
  kind: WeeklyDigestKind;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  html: string;
  recipient_profile_id: string;
  real_to: string[];
  real_cc: string[];
};
export type WeeklyDigestOutbox = {
  contract: 'agt003-weekly-digest-v1';
  capability: 'agt003.weekly_digest';
  agent: 'AGT-003';
  run_id: string;
  generated_at: string;
  generated_day_bogota: string;
  mode: WeeklyDigestMode;
  sample: number | null;
  sender: string;
  week: DigestWeek;
  rules: { recipients: string; behavior: string };
  manager_profile_id: string;
  excluded_recipients: Array<{ profile_id: string; name: string; reason: string }>;
  messages: DigestMessage[];
};

export function isValidEmail(value: unknown): boolean;
export function digestWeeks(now: Date): DigestWeek;
export function formatDayRange(start: string, end: string): string;
export function formatCop(value: number | string | null | undefined): string;
export function escapeHtml(value: unknown): string;
export function greetingName(fullName: string | null | undefined): string;
export function isCommercialTendersOnly(profileId: string, areaAssignments: DigestAreaAssignment[], rules?: typeof WEEKLY_DIGEST_RECIPIENT_RULES): boolean;
export function selectDigestRecipients(input?: { profiles?: DigestProfile[]; areaAssignments?: DigestAreaAssignment[]; rules?: typeof WEEKLY_DIGEST_RECIPIENT_RULES }): {
  included: DigestProfile[];
  excluded: Array<{ profile_id: string; name: string; reason: string }>;
};
export function resolveDigestConfig(config?: DigestConfig): Required<DigestConfig>;
export function messageId(input: { mode: WeeklyDigestMode; weekStart: string; kind: WeeklyDigestKind; recipient: string }): string;
export function buildWeeklyDigest(input: {
  profiles?: DigestProfile[];
  areaAssignments?: DigestAreaAssignment[];
  opportunities?: DigestOpportunity[];
  interactions?: Array<{ opportunity_id: string; created_by: string | null; interaction_type: string; created_at: string }>;
  decisions?: Array<{ opportunity_id: string; changed_by: string | null; created_at: string; field_name?: string }>;
  lastSeen?: Array<{ profile_id: string; last_seen_at: string | null }>;
  goals?: Array<{ user_id?: string | null; period_month?: string | null; sales_budget?: number | string | null; service_type_code?: string | null }>;
  now: Date;
  config?: DigestConfig;
  mode?: WeeklyDigestMode;
  sample?: number | null;
}): WeeklyDigestOutbox;
