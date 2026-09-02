const DB_KEY_LABEL: Record<string, string> = {
  last_interaction_at: 'última interacción registrada',
  updated_at: 'última actualización del registro',
  created_at: 'creación del registro',
  offer_value: 'valor de la oferta',
};
const DB_KEY_PATTERN = new RegExp(`\\b(${Object.keys(DB_KEY_LABEL).join('|')})\\b`, 'g');
const ISO_DATETIME = /\b(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)(Z|[+-]\d{2}:?\d{2})\b/g;
const COP_AMOUNT = /(?:COP\s*(\d[\d.,]{2,}\d))|(?:(?<![$\d.,])\b(\d[\d.,]{2,}\d)\s*COP\b)/gi;
const BOGOTA_DATETIME_LABEL = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' });
const COP_GROUPING = new Intl.NumberFormat('es-CO');

export { DB_KEY_LABEL };

export function humanizeVigiaText(text: string | null | undefined): string {
  let result = String(text ?? '');
  result = result.replace(DB_KEY_PATTERN, match => DB_KEY_LABEL[match] || match);
  result = result.replace(ISO_DATETIME, match => {
    const parsed = new Date(match);
    return Number.isNaN(parsed.getTime()) ? match : BOGOTA_DATETIME_LABEL.format(parsed);
  });
  result = result.replace(COP_AMOUNT, (match, prefixDigits, suffixDigits) => {
    const digits = prefixDigits ?? suffixDigits;
    const amount = Number(String(digits).replace(/[.,]/g, ''));
    return Number.isFinite(amount) && amount > 0 ? `$${COP_GROUPING.format(amount)} COP` : match;
  });
  return result;
}
