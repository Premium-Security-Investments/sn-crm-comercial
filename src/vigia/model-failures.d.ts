export type Agt003ModelFailureCategory =
  | 'AGT003_CLAUDE_LOGIN_REQUIRED'
  | 'AGT003_BRIDGE_UNAVAILABLE'
  | 'AGT003_CLAUDE_SESSION_LIMIT'
  | 'AGT003_MODEL_ERROR';
export const AGT003_MODEL_FAILURE: Readonly<{
  LOGIN_REQUIRED: 'AGT003_CLAUDE_LOGIN_REQUIRED';
  BRIDGE_UNAVAILABLE: 'AGT003_BRIDGE_UNAVAILABLE';
  SESSION_LIMIT: 'AGT003_CLAUDE_SESSION_LIMIT';
  MODEL_ERROR: 'AGT003_MODEL_ERROR';
}>;
export const AGT003_MODEL_FAILURE_CODES: readonly Agt003ModelFailureCategory[];
export function classifyAgt003ModelFailure(codeOrError: unknown): Agt003ModelFailureCategory | null;
export function agt003ModelFailureMessage(category: string | null | undefined, feature?: 'copilot' | 'lead_analysis'): string;
export const AGT003_MODEL_FAILURE_MESSAGES: readonly string[];
export function isAgt003ModelFailureMessage(message: unknown): boolean;
export const AGT003_MODEL_FAILURE_IT_TEXT: Readonly<Record<Agt003ModelFailureCategory, Readonly<{ title: string; help: string }>>>;
export const AGT003_SHARED_FAILURE_CATEGORIES: readonly Agt003ModelFailureCategory[];
