export type ClosureFormFieldKind = 'texto' | 'correo' | 'fecha' | 'si_no' | 'opcion' | 'dinero';

export type ClosureFormField = {
  key: string;
  label: string;
  kind: ClosureFormFieldKind;
  max?: number;
  options?: string[];
  required: boolean | ((form: ClosureForm | null) => boolean);
  auto?: boolean;
};

export type ClosureForm = Partial<Record<string, string | number | boolean | null>>;
export type ClosureFormSite = { address?: string | null; city?: string | null; phone?: string | null; contact_name?: string | null; position?: number };
export type ClosureFormPost = {
  description?: string | null;
  shift_start?: string | null;
  shift_end?: string | null;
  days_per_month?: number | null;
  guards_required?: number | null;
  armed?: boolean | null;
  monthly_value?: number | string | null;
  notes?: string | null;
  position?: number;
};

export type ClosureFormMoney = {
  subtotal: number;
  aiu: number | null;
  iva: number | null;
  total: number;
  aiuMissing: boolean;
  ivaRate: number;
  posts: number;
};

export type ClosureFormCompleteness = { complete: boolean; missing: string[]; filled: number; required: number };
export type ClosureFormWinVerdict = { ok: true } | { ok: false; code: string; message: string; missing: string[] };

export const CLOSURE_FORM_FORMAT: string;
export const CLOSURE_FORM_VERSION: number;
export const CLOSURE_FORM_IVA_RATE: number;
export const CLOSURE_FORM_FIELDS: readonly ClosureFormField[];
export const CLOSURE_FORM_FIELD_KEYS: readonly string[];
export const CLOSURE_FORM_POST_REQUIRED: readonly string[];

export function autofillClosureForm(opportunity?: Record<string, unknown>): ClosureForm;
export function autofillClosureSites(opportunity?: Record<string, unknown>): ClosureFormSite[];
export function closureFormMoney(input?: { posts?: ClosureFormPost[]; aiuValue?: number | string | null }): ClosureFormMoney;
export function closureFormDurationDays(startDay?: string | null, endDay?: string | null): number | null;
export function closureFormCompleteness(input?: { form?: ClosureForm; sites?: ClosureFormSite[]; posts?: ClosureFormPost[] }): ClosureFormCompleteness;
export function closureFormWinVerdict(input?: { form?: ClosureForm | null; sites?: ClosureFormSite[]; posts?: ClosureFormPost[] }): ClosureFormWinVerdict;
