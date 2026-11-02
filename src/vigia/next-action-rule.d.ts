// Tipos de la regla del próximo paso (F4). El módulo es JS porque también lo importa el servidor.
export declare const NEXT_ACTION_REQUIRED_CODE: 'CRM_NEXT_ACTION_REQUIRED';
export declare const NEXT_ACTION_REQUIRED_MESSAGE: string;
export declare const NEXT_ACTION_PAST_MESSAGE: string;
export declare const NEXT_ACTION_TERMINAL_STAGES: readonly string[];
export declare const NEXT_ACTION_MAX_DAYS: number;
export declare const NEXT_ACTION_TOO_FAR_CODE: 'CRM_NEXT_ACTION_TOO_FAR';
export declare const NEXT_ACTION_TOO_FAR_MESSAGE: string;
export declare const FOLLOW_UP_DATE_CODE: 'CRM_FOLLOW_UP_DATE_FUTURE';
export declare const FOLLOW_UP_DATE_FUTURE_MESSAGE: string;

export type NextActionVerdict = { ok: true } | { ok: false; code: string; message: string };

export declare function nextActionRequirement(input?: {
  stageCode?: string | null;
  currentNextActionAt?: string | null;
  proposedNextActionAt?: string | null;
  now?: Date | string;
}): NextActionVerdict;

export declare function hasLiveNextAction(input?: {
  nextActionAt?: string | null;
  now?: Date | string;
}): boolean;

export declare function followUpDateRequirement(input?: {
  occurredAt?: string | null;
  now?: Date | string;
}): NextActionVerdict;
