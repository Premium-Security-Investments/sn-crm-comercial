import type { PublicTender, TenderDeadlineFilter, TenderRegionKey, TenderSortKey } from './types';

export const TENDER_OFFICIAL_SOURCES = ['SECOP I', 'SECOP II', 'TVEC', 'ESU Contratación'];

export const TENDER_SN_REGIONS: Array<{ key: TenderRegionKey; label: string; aliases: string[] }> = [
  { key: 'todas', label: 'Todas las regiones', aliases: [] },
  { key: 'bog_cundinamarca', label: 'BOG - Bogotá/Cundinamarca', aliases: ['bogota', 'bogotá', 'cundinamarca', 'soacha', 'mosquera', 'chia', 'chía', 'funza', 'facatativa', 'zipaquira', 'zipaquirá'] },
  { key: 'med_antioquia', label: 'MED - Medellín/Antioquia', aliases: ['medellin', 'medellín', 'antioquia', 'envigado', 'bello', 'itagui', 'itagüí', 'sabaneta', 'rio negro', 'rionegro'] },
  { key: 'eje_cafetero', label: 'EJE C - Eje Cafetero', aliases: ['caldas', 'manizales', 'risaralda', 'pereira', 'quindio', 'quindío', 'armenia'] },
  { key: 'cali_valle', label: 'CALI - Valle del Cauca', aliases: ['valle del cauca', 'cali', 'palmira', 'yumbo', 'buenaventura', 'tulua', 'tuluá'] },
  { key: 'costa_caribe', label: 'Costa Caribe', aliases: ['atlantico', 'atlántico', 'barranquilla', 'bolivar', 'bolívar', 'cartagena', 'magdalena', 'santa marta', 'cesar', 'cordoba', 'córdoba', 'sucre', 'la guajira'] },
  { key: 'santanderes', label: 'Santanderes', aliases: ['santander', 'bucaramanga', 'norte de santander', 'cucuta', 'cúcuta'] },
  { key: 'sur_occidente', label: 'Sur occidente', aliases: ['cauca', 'popayan', 'popayán', 'nariño', 'narino', 'pasto', 'huila', 'neiva', 'putumayo'] },
  { key: 'otros', label: 'Otros / validar cobertura', aliases: [] },
];

export function normalizeTenderText(value?: string | null): string {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function canonicalTenderKey(tender: PublicTender): string {
  const source = String(tender.source || '').trim().toLowerCase();
  const entity = normalizeTenderText(tender.entity || '').replace(/\s+/g, ' ').trim();
  const ref = String(tender.ref || tender.process_id || tender.id || '')
    .replace(/\(presentación de oferta\)/gi, '')
    .replace(/\(presentacion de oferta\)/gi, '')
    .replace(/[.\s]+$/g, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').toLowerCase().trim();
  return `${source}|${entity}|${ref}`;
}

function tenderStatusRank(tender: PublicTender): number {
  return tender.converted_opportunity_id || tender.internal_status === 'convertida_oportunidad' ? 4 : tender.internal_status === 'en_revision' ? 3 : tender.internal_status === 'nueva' ? 2 : tender.internal_status === 'descartada' ? 1 : 0;
}

export function deduplicateTenders(tenders: PublicTender[]): PublicTender[] {
  if (!Array.isArray(tenders)) return [];
  const byKey = new Map<string, PublicTender>();
  const order: string[] = [];
  for (const tender of tenders) {
    const key = canonicalTenderKey(tender);
    if (!byKey.has(key)) { byKey.set(key, tender); order.push(key); continue; }
    const current = byKey.get(key)!;
    const currentDate = String(current.last_seen_at || current.detected_at || current.published || '');
    const nextDate = String(tender.last_seen_at || tender.detected_at || tender.published || '');
    if (tenderStatusRank(tender) > tenderStatusRank(current) || (tenderStatusRank(tender) === tenderStatusRank(current) && nextDate > currentDate)) byKey.set(key, tender);
  }
  return order.map(key => byKey.get(key)!).filter(Boolean);
}

export function tenderMatchesRegion(tender: PublicTender, regionKey: TenderRegionKey): boolean {
  if (regionKey === 'todas') return true;
  const haystack = normalizeTenderText(`${tender.dept || ''} ${tender.city || ''} ${tender.entity || ''} ${tender.title || ''}`);
  const known = TENDER_SN_REGIONS.filter(region => region.key !== 'todas' && region.key !== 'otros').some(region => region.aliases.some(alias => haystack.includes(normalizeTenderText(alias))));
  if (regionKey === 'otros') return !known;
  return TENDER_SN_REGIONS.find(region => region.key === regionKey)?.aliases.some(alias => haystack.includes(normalizeTenderText(alias))) || false;
}

export function tenderDeadlineBucket(tender: PublicTender): TenderDeadlineFilter | '31_plus' {
  if (!tender.deadline) return 'sin_fecha';
  const days = Math.ceil((new Date(tender.deadline).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return 'vencida';
  if (days <= 7) return '0_7';
  if (days <= 15) return '8_15';
  if (days <= 30) return '16_30';
  return '31_plus';
}

export function sortTenderCards(rows: PublicTender[], key: TenderSortKey, direction: 'asc' | 'desc'): PublicTender[] {
  const value = (tender: PublicTender): string | number => key === 'deadline' ? tender.deadline || '9999-12-31' : key === 'value' ? Number(tender.value || 0) : key === 'score' ? Number(tender.score || 0) : key === 'entity' ? tender.entity : tender.source;
  return [...rows].sort((left, right) => {
    const a = value(left); const b = value(right);
    const comparison = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'es');
    return direction === 'asc' ? comparison : -comparison;
  });
}
