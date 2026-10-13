import type { TenderCompanyDocument, TenderCompanyProfile } from './types';

/** Empresa (fase 1): reglas puras para mostrar la base empresarial. No escriben nada ni inventan fechas en la base. */
export type CompanyRegistryEntry = {
  entry_id: string;
  document_class: string;
  existence_status?: 'verified' | 'reported' | 'not_verified' | string | null;
  human_review_status?: 'pending_human_review' | 'approved' | 'rejected' | string | null;
  vigencia_text?: string | null;
  expiry?: string | null;
};
export type CompanySite = { id: string; department: string; city?: string | null; address?: string | null; is_main: boolean; supervigilancia_authorization?: string | null; support_document_id?: string | null; notes?: string | null; source?: string | null };
export type CompanyExperience = { id: string; rup_number?: number | null; contracting_party: string; contract_object?: string | null; value_smmlv?: number | string | null; value_cop?: number | string | null; contract_year?: number | null; source: string; notes?: string | null };
export type CompanyBasePayload = { registry: CompanyRegistryEntry[]; sites: CompanySite[]; experience: CompanyExperience[]; structured_tables_available: boolean };

export type CompanyBlockState = 'vencido' | 'vence_pronto' | 'al_dia' | 'sin_verificar';
export const COMPANY_BLOCK_STATES: CompanyBlockState[] = ['al_dia', 'vence_pronto', 'vencido', 'sin_verificar'];
export const COMPANY_BLOCK_STATE_LABELS: Record<CompanyBlockState, string> = {
  al_dia: 'Al día',
  vence_pronto: 'Vence pronto',
  vencido: 'Vencido',
  sin_verificar: 'Falta o sin verificar',
};

export type CompanyArea = 'Identidad y registro' | 'Jurídico' | 'Financiero' | 'Operaciones' | 'Licitaciones' | 'Otros';
export const COMPANY_AREAS: CompanyArea[] = ['Identidad y registro', 'Jurídico', 'Financiero', 'Operaciones', 'Licitaciones', 'Otros'];
const AREA_BY_ENTRY: Record<string, CompanyArea> = {
  rup: 'Identidad y registro', rut: 'Identidad y registro',
  supervigilancia_operating_license: 'Jurídico', uniforms_resolution: 'Jurídico', no_fines_sanctions_certificate: 'Jurídico',
  corporate_background_checks: 'Jurídico', legal_representative_vault: 'Jurídico', overtime_authorization: 'Jurídico',
  financial_and_tax_pack: 'Financiero', bank_certificate: 'Financiero', rce_policy: 'Financiero', collective_life_policy: 'Financiero',
  authorized_weapons_list: 'Operaciones', communications_license: 'Operaciones', personnel_credentials_vault: 'Operaciones',
  accredited_experience: 'Licitaciones', differential_scoring_support: 'Licitaciones',
};
export function companyAreaFor(entryId: string): CompanyArea {
  return AREA_BY_ENTRY[entryId] || 'Otros';
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SOON_DAYS = 30;
// Festivos de Colombia 2026–2027 (Ley Emiliani aplicada), sólo para estimar "N días hábiles".
const CO_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03', '2026-05-01', '2026-05-18', '2026-06-08', '2026-06-15',
  '2026-06-29', '2026-07-20', '2026-08-07', '2026-08-17', '2026-10-12', '2026-11-02', '2026-11-16', '2026-12-08', '2026-12-25',
  '2027-01-01', '2027-01-11', '2027-03-22', '2027-03-25', '2027-03-26', '2027-05-01', '2027-05-10', '2027-05-31', '2027-06-07',
  '2027-07-05', '2027-07-20', '2027-08-07', '2027-08-16', '2027-10-18', '2027-11-01', '2027-11-15', '2027-12-08', '2027-12-25',
]);

function isoDay(date: Date) { return date.toISOString().slice(0, 10); }
function parseDay(value?: string | null): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}
function today(now: Date) { return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); }

function addBusinessDays(start: Date, days: number) {
  const date = new Date(start);
  let counted = 0;
  while (counted < days) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !CO_HOLIDAYS.has(isoDay(date))) counted += 1;
  }
  return date;
}

/**
 * Estima un vencimiento sólo cuando el texto registrado trae fecha de expedición y plazo
 * ("Expedido 2026-06-19; vigencia declarada de 60 días"). Es un cálculo de pantalla, siempre "por confirmar".
 */
export function estimateExpiryFromText(vigenciaText?: string | null): string | null {
  const textValue = String(vigenciaText || '');
  const issued = /expedid[oa]\s+(\d{4}-\d{2}-\d{2})/i.exec(textValue);
  const term = /(\d{1,3})\s+d[ií]as(\s+h[aá]biles)?/i.exec(textValue);
  if (!issued || !term) return null;
  const start = parseDay(issued[1]);
  if (!start) return null;
  const days = Number(term[1]);
  const end = term[2] ? addBusinessDays(start, days) : new Date(start.getTime() + days * DAY_MS);
  return isoDay(end);
}

export type CompanyBlock = {
  entryId: string;
  name: string;
  area: CompanyArea;
  state: CompanyBlockState;
  expiry: string | null;
  expirySource: 'registro' | 'documento' | 'calculada' | null;
  vigenciaText: string;
  supportLoaded: boolean;
  supportDocument: TenderCompanyDocument | null;
  review: 'Aprobado' | 'Rechazado' | 'Pendiente';
  porConfirmar: boolean;
};

export function deriveCompanyBlock(entry: CompanyRegistryEntry, documents: TenderCompanyDocument[] = [], now = new Date()): CompanyBlock {
  const supportDocument = documents.find(document => document.current && document.document_type === entry.entry_id) || null;
  let expiry: string | null = null;
  let expirySource: CompanyBlock['expirySource'] = null;
  if (parseDay(entry.expiry)) { expiry = String(entry.expiry).slice(0, 10); expirySource = 'registro'; }
  else if (parseDay(supportDocument?.expires_at)) { expiry = String(supportDocument?.expires_at).slice(0, 10); expirySource = 'documento'; }
  else {
    const estimated = estimateExpiryFromText(entry.vigencia_text);
    if (estimated) { expiry = estimated; expirySource = 'calculada'; }
  }
  let state: CompanyBlockState = 'sin_verificar';
  if (entry.existence_status !== 'not_verified' && expiry) {
    const remaining = (parseDay(expiry)!.getTime() - today(now).getTime()) / DAY_MS;
    state = remaining < 0 ? 'vencido' : remaining <= SOON_DAYS ? 'vence_pronto' : 'al_dia';
  }
  const review = entry.human_review_status === 'approved' ? 'Aprobado' : entry.human_review_status === 'rejected' ? 'Rechazado' : 'Pendiente';
  return {
    entryId: entry.entry_id,
    name: entry.document_class,
    area: companyAreaFor(entry.entry_id),
    state,
    expiry,
    expirySource,
    vigenciaText: String(entry.vigencia_text || '').trim(),
    supportLoaded: Boolean(supportDocument),
    supportDocument,
    review,
    porConfirmar: expirySource !== 'registro' && expirySource !== 'documento',
  };
}

export function deriveCompanyBlocks(registry: CompanyRegistryEntry[], documents: TenderCompanyDocument[] = [], now = new Date()) {
  return registry
    .map(entry => deriveCompanyBlock(entry, documents, now))
    .sort((left, right) => COMPANY_AREAS.indexOf(left.area) - COMPANY_AREAS.indexOf(right.area) || left.name.localeCompare(right.name, 'es'));
}

export function summarizeCompanyBlocks(blocks: CompanyBlock[]) {
  const counts: Record<CompanyBlockState, number> = { al_dia: 0, vence_pronto: 0, vencido: 0, sin_verificar: 0 };
  for (const block of blocks) counts[block.state] += 1;
  return {
    counts,
    total: blocks.length,
    withSupport: blocks.filter(block => block.supportLoaded).length,
    reviewed: blocks.filter(block => block.review !== 'Pendiente').length,
  };
}

export function groupCompanyBlocks(blocks: CompanyBlock[], filter: CompanyBlockState | null = null) {
  return COMPANY_AREAS
    .map(area => ({ area, blocks: blocks.filter(block => block.area === area && (!filter || block.state === filter)) }))
    .filter(group => group.blocks.length > 0);
}

function decimal(value: string) {
  return Number(value.replace(/\$/g, '').replace(/\./g, '').replace(',', '.').trim());
}

const INDICATORS: Array<{ key: string; label: string; pattern: RegExp; money?: boolean }> = [
  { key: 'liquidez', label: 'Liquidez', pattern: /[íi]ndice de liquidez:\s*([\d.,]+)/i },
  { key: 'endeudamiento', label: 'Endeudamiento', pattern: /[íi]ndice de endeudamiento:\s*([\d.,]+)/i },
  { key: 'cobertura', label: 'Cobertura de intereses', pattern: /cobertura de intereses:\s*([\d.,]+)/i },
  { key: 'roe', label: 'Rentabilidad del patrimonio', pattern: /rentabilidad del patrimonio(?:\s*\(ROE\))?:\s*([\d.,]+)/i },
  { key: 'roa', label: 'Rentabilidad del activo', pattern: /rentabilidad del activo(?:\s*\(ROA\))?:\s*([\d.,]+)/i },
  { key: 'patrimonio', label: 'Patrimonio', pattern: /\bpatrimonio:\s*(\$?[\d.,]+)/i, money: true },
  { key: 'activo_total', label: 'Activo total', pattern: /activo total:\s*(\$?[\d.,]+)/i, money: true },
];

/** Lee los indicadores del texto de la ficha (vienen del RUP). Capital de trabajo = activo corriente − pasivo corriente. */
export function parseFinancialIndicators(profile: Pick<TenderCompanyProfile, 'financial_capacity' | 'organizational_capacity'>) {
  const source = `${profile.financial_capacity || ''}\n${profile.organizational_capacity || ''}`;
  const cut = /corte(?: financiero)?:\s*(\d{2}\/\d{2}\/\d{4})/i.exec(source)?.[1] || null;
  const values: Array<{ key: string; label: string; value: number; money: boolean; calculated?: boolean }> = [];
  for (const indicator of INDICATORS) {
    const match = indicator.pattern.exec(source);
    if (match) values.push({ key: indicator.key, label: indicator.label, value: decimal(match[1]), money: Boolean(indicator.money) });
  }
  const currentAssets = /activo corriente:\s*(\$?[\d.,]+)/i.exec(source);
  const currentLiabilities = /pasivo corriente:\s*(\$?[\d.,]+)/i.exec(source);
  if (currentAssets && currentLiabilities) {
    values.push({ key: 'capital_trabajo', label: 'Capital de trabajo', value: decimal(currentAssets[1]) - decimal(currentLiabilities[1]), money: true, calculated: true });
  }
  return { cut, values: values.filter(item => Number.isFinite(item.value)) };
}

/** "92121500: Servicios de guardias" por línea → lista de códigos. */
export function parseUnspscCodes(text?: string | null) {
  return String(text || '')
    .split(/\n+/)
    .map(line => /^\s*(\d{8})\s*[:\-–]\s*(.+?)\s*$/.exec(line))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map(match => ({ code: match[1], description: match[2] }));
}
