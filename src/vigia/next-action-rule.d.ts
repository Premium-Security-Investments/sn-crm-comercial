// Tipos de la regla del próximo paso (F4). El módulo es JS porque también lo importa el servidor.
export declare const NEXT_ACTION_REQUIRED_CODE: 'CRM_NEXT_ACTION_REQUIRED';
export declare const NEXT_ACTION_REQUIRED_MESSAGE: string;
export declare const NEXT_ACTION_PAST_MESSAGE: string;
export declare const NEXT_ACTION_TERMINAL_STAGES: readonly string[];

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
