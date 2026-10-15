export type ChatChannel = 'llamada' | 'whatsapp' | 'correo' | 'reunion' | 'nota';
export type ChatData = Partial<Record<
  'economic_sector' | 'quote_city' | 'decision_maker_name' | 'decision_maker_title' | 'decision_maker_email' |
  'decision_maker_phone' | 'decision_maker_linkedin' | 'company_website' | 'company_nit' | 'current_security_provider' |
  'current_contract_end_date', string>> & { current_security_provider_none?: boolean };
export type ChatAction =
  | { tipo: 'registrar_seguimiento'; ref: string; canal: ChatChannel; fecha: string; nota: string }
  | { tipo: 'proximo_seguimiento'; ref: string; fecha: string }
  | { tipo: 'actualizar_datos'; ref: string; datos: ChatData }
  | { tipo: 'crear_oportunidad'; nueva: ChatData & { company_name: string; service_type_code: string; regional_nombre: string }; nota?: string; canal?: ChatChannel; fecha?: string; proxima_fecha?: string };

export const CHAT_REGISTRO_CAPABILITY_ID: string;
export const CHAT_REGISTRO_CONTRACT_VERSION: string;
export const CHAT_REGISTRO_DEFAULT_DAILY_MAX: number;
export const CHAT_MESSAGE_MAX_CHARS: number;
export const CHAT_MAX_ACTIONS: number;
export const CHAT_PAST_DAYS: number;
export const CHAT_NEXT_MAX_DAYS: number;
export const CHAT_ACTION_TYPES: readonly string[];
export const CHAT_CHANNELS: readonly ChatChannel[];
export const CHAT_DATA_FIELDS: Readonly<Record<string, { label: string; max: number }>>;
export const NEW_OPPORTUNITY_FIELDS: readonly string[];
export function chatRegistroOutputSchema(serviceCodes?: string[]): Record<string, unknown>;
export function addDays(isoDay: string, days: number): string;
export function weekdayName(isoDay: string): string;
export function chatCalendar(today: string, days?: number): string[];
export function humanDay(isoDay: string): string;
export function normalizeChatOutput(raw: unknown, options?: { refs?: Map<string, { label: string }>; today?: string; serviceCodes?: string[] }): { respuesta: string; acciones: ChatAction[]; avisos: string[] };
export function describeChatAction(action: ChatAction, options?: { labelFor?: (ref: string) => string; serviceName?: (code: string) => string }): { cliente: string; lineas: string[] };
